// Grades a planner answer against a corpus case.
//
// An answer is right when it is valid for the real engine (plan() on stand-in files with the same
// names, kinds and page counts) and means the same as the expected one. Equivalent forms count as
// the same: "1-3" and "1,2,3", "last" and "12" on a 12-page file, an explicit merge of every input
// in the given order and no merge at all, optimize and compress "lossless".
import { plan } from '@hilvana/recipes';
import { parsePageRange } from '@hilvana/core';
import { fixtures } from './fixtures.mjs';

const SOURCE_OPS = new Set(['merge', 'unlock', 'fromImages']);
const DEFAULT_PAGES = { stampText: 'all', watermark: 'all', numberPages: 'all', rotate: 'all', sign: 'last' };
/** Placeholder for a password the person would type on their device. */
const DEVICE_PASSWORD = 'typed-on-device';

/** Pulls the JSON object out of a model answer (with or without a code fence or text around it). */
export function parseAnswer(text) {
  if (typeof text !== 'string') return { error: 'empty answer' };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return { error: 'no JSON object' };
  try {
    const value = JSON.parse(body.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'not an object' };
    return { value };
  } catch (err) {
    return { error: `invalid JSON: ${err.message}` };
  }
}

/**
 * recipe | question | unsupported, or an error when the envelope is not one of them.
 * A bare recipe ({"version": 1, "steps": [...]}) without the envelope is unambiguous and the app
 * accepts it too, so it counts as {"recipe": ...} (rule added after the first run, 2026-11-26).
 */
export function unwrap(answer) {
  if (answer && answer.recipe === undefined && answer.question === undefined && answer.unsupported === undefined && Array.isArray(answer.steps)) return { recipe: answer };
  return answer;
}

export function outcomeOf(answer) {
  const kinds = ['recipe', 'question', 'unsupported'].filter((k) => answer[k] !== undefined && answer[k] !== null);
  if (kinds.length !== 1) return { error: `expected exactly one of recipe, question, unsupported (got ${kinds.join(', ') || 'none'})` };
  const kind = kinds[0];
  if (kind === 'recipe' && (typeof answer.recipe !== 'object' || Array.isArray(answer.recipe))) return { error: 'recipe is not an object' };
  if (kind !== 'recipe' && (typeof answer[kind] !== 'string' || !answer[kind].trim())) return { error: `${kind} must be a non-empty string` };
  return { kind };
}

/* ------------------------------------------------------------------ values */

const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Redaction terms: numbers compare by their digits, text by its letters. */
const foldTerm = (s) => {
  const f = fold(s);
  const digits = f.replace(/[\s.\-]/g, '');
  return /^\d+$/.test(digits) ? digits : f;
};
const foldTrim = (s) => String(s).replace(/,/g, '.').replace(/\s+/g, '').replace('×', 'x').toLowerCase()
  .split('x').map((n) => String(Number(n))).join('x');
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a, b) => sameList([...a].sort(), [...b].sort());

function pagesOf(expr, count, keepOrder) {
  if (typeof expr !== 'string' || count === undefined) return undefined;
  try { return parsePageRange(expr, count, keepOrder); } catch { return undefined; }
}

const isMatcher = (m) => m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).some((k) => k.startsWith('$'));

/** Does `actual` satisfy `want` for field `key` of a step? ctx: { op, pages } (page count before the step). */
export function matchValue(want, actual, key, ctx = {}) {
  if (isMatcher(want)) {
    if ('$in' in want) return want.$in.some((v) => (v === undefined ? actual === undefined : matchValue(v, actual, key, ctx)));
    if ('$between' in want) return typeof actual === 'number' && actual >= want.$between[0] && actual <= want.$between[1];
    if ('$has' in want) return typeof actual === 'string' && want.$has.every((p) => fold(actual).includes(fold(p)));
    if ('$present' in want) return actual !== undefined;
    if ('$absent' in want) return actual === undefined || (Array.isArray(actual) && actual.length === 0);
    if ('$set' in want) return Array.isArray(actual) && sameSet(actual.map(String), want.$set.map(String));
    if ('$terms' in want) return Array.isArray(actual) && sameSet([...new Set(actual.map(foldTerm))], want.$terms.map(foldTerm));
    if ('$rangesAnyOrder' in want) {
      if (!Array.isArray(actual) || actual.length !== want.$rangesAnyOrder.length) return false;
      const a = actual.map((r) => JSON.stringify(pagesOf(r, ctx.pages)));
      const w = want.$rangesAnyOrder.map((r) => JSON.stringify(pagesOf(r, ctx.pages)));
      return !a.includes(undefined) && sameSet(a, w);
    }
    throw new Error(`Unknown matcher ${JSON.stringify(want)}`);
  }
  if (key === 'pages' && typeof want === 'string') {
    const keepOrder = ctx.op === 'select';
    const w = pagesOf(want, ctx.pages, keepOrder);
    const a = pagesOf(actual, ctx.pages, keepOrder);
    return !!w && !!a && sameList(w, a);
  }
  if (key === 'ranges' && Array.isArray(want)) {
    return Array.isArray(actual) && actual.length === want.length
      && want.every((r, i) => { const w = pagesOf(r, ctx.pages); const a = pagesOf(actual[i], ctx.pages); return !!w && !!a && sameList(w, a); });
  }
  if (key === 'trim') return typeof actual === 'string' && foldTrim(actual) === foldTrim(want);
  if (Array.isArray(want)) return Array.isArray(actual) && actual.length === want.length && want.every((w, i) => matchValue(w, actual[i], undefined, ctx));
  if (want && typeof want === 'object') return matchFields(want, actual, ctx, true);
  return want === actual;
}

/** Every field of `want` matches; with `exact`, `actual` has no other fields. */
function matchFields(want, actual, ctx, exact = false) {
  if (!actual || typeof actual !== 'object') return false;
  if (exact && Object.keys(actual).some((k) => !(k in want))) return false;
  return Object.entries(want).every(([k, w]) => matchValue(w, actual[k] ?? (k === 'pages' ? DEFAULT_PAGES[ctx.op] : undefined), k, ctx));
}

export function matchStep(want, actual) {
  return want.op === actual.step.op && matchFields(Object.fromEntries(Object.entries(want).filter(([k]) => k !== 'op')), actual.step, { op: actual.step.op, pages: actual.pages });
}

/** Matches expected items (steps or anyOrder groups) against the actual steps, all of them, in order. */
function matchSequence(items, actual) {
  if (items.length === 0) return actual.length === 0;
  const [head, ...rest] = items;
  if (head && head.$anyOrder) {
    const group = head.$anyOrder;
    const slice = actual.slice(0, group.length);
    if (slice.length < group.length) return false;
    const used = new Set();
    const assign = (i) => {
      if (i === slice.length) return true;
      for (let j = 0; j < group.length; j++) {
        if (used.has(j) || !matchStep(group[j], slice[i])) continue;
        used.add(j);
        if (assign(i + 1)) return true;
        used.delete(j);
      }
      return false;
    };
    return assign(0) && matchSequence(rest, actual.slice(group.length));
  }
  return actual.length > 0 && matchStep(head, actual[0]) && matchSequence(rest, actual.slice(1));
}

/* ------------------------------------------------------------------ normalizing */

const docNames = (inputs) => inputs.filter((i) => i.kind === 'pdf' || i.kind === 'word').map((i) => i.name);
const imageNames = (inputs) => inputs.filter((i) => i.kind === 'image').map((i) => i.name);

function normalizeStep(step, inputs) {
  if (step.op === 'optimize') return { op: 'compress', level: 'lossless' };
  if (step.op === 'merge') return { ...step, files: step.files ?? docNames(inputs) };
  if (step.op === 'fromImages') return { ...step, files: step.files ?? imageNames(inputs) };
  return step;
}

/** A leading merge of every document in the order given is the same as no merge. */
function isDefaultMerge(step, inputs) {
  return step?.op === 'merge' && (step.files === undefined || sameList(step.files, docNames(inputs)));
}

function normalizeExpected(steps, inputs) {
  const first = steps[0];
  if (first && !first.$anyOrder && isDefaultMerge(first, inputs)) return steps.slice(1);
  return steps;
}

/* ------------------------------------------------------------------ grading */

function expectations(expect) {
  return expect.$either ? expect.$either : [expect];
}

const fail = (reason, message, extra = {}) => ({ pass: false, reason, message, ...extra });

/**
 * Grades one answer. Returns { pass, outcome, reason?, message? }.
 * Reasons: secret, format, outcome, invalid, password, steps, size, goals, output.
 */
export async function grade(testCase, text) {
  for (const secret of testCase.secrets ?? []) {
    if (typeof text === 'string' && text.includes(secret)) return fail('secret', `the answer repeats a secret ("${secret}")`);
  }
  const parsed = parseAnswer(text);
  if (parsed.error) return fail('format', parsed.error);
  const answer = unwrap(parsed.value);
  const outcome = outcomeOf(answer);
  if (outcome.error) return fail('format', outcome.error);

  const wantOutcome = testCase.expect.outcome ?? 'recipe';
  const outcomeOk = typeof wantOutcome === 'string' ? wantOutcome === outcome.kind : matchValue(wantOutcome, outcome.kind);
  if (!outcomeOk) return fail('outcome', `expected ${JSON.stringify(wantOutcome)}, got ${outcome.kind}`, { outcome: outcome.kind });
  if (outcome.kind !== 'recipe') return { pass: true, outcome: outcome.kind };

  const inputs = testCase.inputs;
  const recipe = structuredClone(answer.recipe);
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const onDevice = answer.passwordOnDevice === true;

  // What the app would run: the password typed on the device goes into the final protect step.
  const runnable = structuredClone(recipe);
  if (onDevice) {
    const last = runnable.steps?.at?.(-1);
    if (last?.op !== 'protect' || last.password !== undefined) return fail('password', 'passwordOnDevice needs a final protect step without a password', { outcome: 'recipe' });
    last.password = DEVICE_PASSWORD;
  }
  if (Array.isArray(runnable.steps) && runnable.steps.length && !SOURCE_OPS.has(runnable.steps[0]?.op) && docNames(inputs).length) {
    runnable.steps.unshift({ op: 'merge' }); // the engine's implicit merge, made explicit so page counts line up
  }
  const files = await fixtures(inputs);
  const checked = await plan(runnable, files, 'en');
  if (!checked.ok) return fail('invalid', checked.issues.map((i) => `${i.code}: ${i.message}`).join(' | '), { outcome: 'recipe' });

  const predicted = checked.predictedPages ?? [];
  const actualAll = runnable.steps.map((s, i) => ({ step: normalizeStep(s, inputs), pages: i === 0 ? undefined : predicted[i - 1] }));
  const actual = isDefaultMerge(actualAll[0]?.step, inputs) ? actualAll.slice(1) : actualAll;
  if (onDevice) actual.at(-1).step = { ...actual.at(-1).step, password: undefined };
  const finalPages = predicted.at(-1);

  const misses = [];
  for (const want of expectations(testCase.expect)) {
    if (!!want.passwordOnDevice !== onDevice) { misses.push(fail('password', want.passwordOnDevice ? 'the password must be asked on the device (passwordOnDevice)' : 'passwordOnDevice set without a reason')); continue; }
    if (!matchSequence(normalizeExpected(want.steps, inputs), actual)) {
      misses.push(fail('steps', `steps do not match: got ${JSON.stringify(actual.map((a) => a.step))}`));
      continue;
    }
    const sizes = [...steps.filter((s) => s.op === 'compress' && s.targetBytes !== undefined).map((s) => s.targetBytes), recipe.goals?.maxBytes].filter((v) => v !== undefined);
    if (want.size) {
      if (sizes.length === 0) { misses.push(fail('size', 'no size limit (compress targetBytes or goals.maxBytes)')); continue; }
      if (sizes.some((v) => v < want.size[0] || v > want.size[1])) { misses.push(fail('size', `size limit ${sizes.join(', ')} outside ${want.size.join('–')}`)); continue; }
    } else if (sizes.length) { misses.push(fail('size', `invented size limit ${sizes.join(', ')}`)); continue; }
    const goals = recipe.goals ?? {};
    if (want.goals && !matchFields(want.goals, goals, {})) { misses.push(fail('goals', `goals do not match: ${JSON.stringify(goals)}`)); continue; }
    if (goals.pageCount !== undefined && finalPages !== undefined && goals.pageCount !== finalPages) { misses.push(fail('goals', `goals.pageCount ${goals.pageCount} but the result has ${finalPages} pages`)); continue; }
    if (goals.maxPages !== undefined && finalPages !== undefined && finalPages > goals.maxPages) { misses.push(fail('goals', `goals.maxPages ${goals.maxPages} but the result has ${finalPages} pages`)); continue; }
    if (want.output && !matchFields(want.output, recipe.output ?? {}, {})) { misses.push(fail('output', `output does not match: ${JSON.stringify(recipe.output ?? {})}`)); continue; }
    return { pass: true, outcome: 'recipe' };
  }
  return { ...misses[0], outcome: 'recipe' };
}
