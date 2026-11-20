import * as core from '@hilvana/core';
import { HilvanaError, parsePageRange } from '@hilvana/core';
import { DocxError, isDocx, wordToPdf } from '@hilvana/office';
import { DESTRUCTIVE_OPS, Recipe, type Goals, type Step } from './schema.js';
import { describeStep, formatBytes, localDate, t, type Lang } from './i18n.js';

export type FileKind = 'pdf' | 'word' | 'image' | 'other';

/** Turns a .docx into PDF bytes. Surfaces choose the engine; the default is the built-in one. */
export type WordConverter = (docx: Uint8Array) => Promise<{ pdf: Uint8Array; pageCount: number; warnings: string[]; engine?: string }>;

export interface EngineOptions {
  lang?: Lang;
  word?: WordConverter;
}

const defaultWord: WordConverter = (docx) => wordToPdf(docx);

// Each Word file is converted once per converter, even though plan() and run() both need it.
const conversions = new WeakMap<WordConverter, WeakMap<Uint8Array, ReturnType<WordConverter>>>();
function convertOnce(convert: WordConverter, bytes: Uint8Array): ReturnType<WordConverter> {
  let byBytes = conversions.get(convert);
  if (!byBytes) conversions.set(convert, (byBytes = new WeakMap()));
  let p = byBytes.get(bytes);
  if (!p) byBytes.set(bytes, (p = convert(bytes)));
  return p;
}

/** An input file. Names are what recipes refer to; bytes never leave the caller's machine. */
export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export interface Issue {
  code: string;
  message: string;
  step?: number;
}

export interface Plan {
  ok: boolean;
  recipe?: Recipe;
  issues: Issue[];
  /** Human-readable steps in the requested language. */
  steps: string[];
  goals: string[];
  /** 1-based indices of steps that drop content or overwrite information. */
  destructiveSteps: number[];
  /** Page count predicted after each step (when it could be computed). */
  predictedPages?: number[];
  /** Simplifications made while converting Word files, in plain language. */
  warnings: string[];
}

export interface GoalResult {
  goal: keyof Goals;
  expected: unknown;
  actual: unknown;
  met: boolean;
  message: string;
}

export interface RunResult {
  bytes: Uint8Array;
  filename: string;
  pageCount: number;
  byteLength: number;
  goals: GoalResult[];
  allGoalsMet: boolean;
  steps: string[];
  warnings: string[];
}

export function kindOf(bytes: Uint8Array): FileKind {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && isDocx(bytes)) return 'word';
  return 'other';
}

const SOURCE_OPS = new Set<Step['op']>(['merge', 'fromImages']);

function issueFromError(err: unknown, lang: Lang, step?: number): Issue {
  if (err instanceof HilvanaError) return { code: err.code, message: t(lang, err.code, err.details), step };
  return { code: 'UNKNOWN', message: String((err as Error)?.message ?? err), step };
}

/** Normalizes a recipe: if it does not start with a source step, prepend "merge all PDFs". */
function withSource(steps: Step[]): Step[] {
  return SOURCE_OPS.has(steps[0]!.op) ? steps : [{ op: 'merge' }, ...steps];
}

/**
 * Validates a recipe against the actual inputs without running it:
 * schema, file references, page ranges (by simulating page counts) and destructive steps.
 * Only file names, kinds and page counts are read.
 */
export async function plan(raw: unknown, files: InputFile[], langOrOpts: Lang | EngineOptions = 'es'): Promise<Plan> {
  const opts: EngineOptions = typeof langOrOpts === 'string' ? { lang: langOrOpts } : langOrOpts;
  const lang = opts.lang ?? 'es';
  const convert = opts.word ?? defaultWord;
  const parsed = Recipe.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { ok: false, issues: [{ code: 'SCHEMA', message: t(lang, 'SCHEMA', { issues }) }], steps: [], goals: [], destructiveSteps: [], warnings: [] };
  }
  const recipe = parsed.data;
  const issues: Issue[] = [];
  const byName = new Map(files.map((f) => [f.name, f]));
  const kinds = new Map(files.map((f) => [f.name, kindOf(f.bytes)]));
  const docNames = files.filter((f) => ['pdf', 'word'].includes(kinds.get(f.name)!)).map((f) => f.name);
  const imageNames = files.filter((f) => kinds.get(f.name) === 'image').map((f) => f.name);
  const hasWord = docNames.some((n) => kinds.get(n) === 'word');

  const pageCounts = new Map<string, number>();
  const warnings: string[] = [];
  for (const name of docNames) {
    try {
      if (kinds.get(name) === 'word') {
        const res = await convertOnce(convert, byName.get(name)!.bytes);
        pageCounts.set(name, res.pageCount);
        for (const w of res.warnings) warnings.push(`${name}: ${t(lang, `word.${w}`)}`);
      } else {
        pageCounts.set(name, (await core.inspect(byName.get(name)!.bytes)).pageCount);
      }
    } catch (err) {
      if (err instanceof DocxError) issues.push({ code: err.code, message: t(lang, err.code, { name }) });
      else issues.push(issueFromError(err, lang));
    }
  }

  const steps = withSource(recipe.steps);
  const offset = steps.length - recipe.steps.length; // 1 when a merge was prepended
  let pages: number | undefined;
  const predicted: number[] = [];

  steps.forEach((step, i) => {
    const n = i + 1 - offset; // step number as the user wrote it (0 = implicit merge)
    if (i > 0 && SOURCE_OPS.has(step.op)) issues.push({ code: 'SOURCE_NOT_FIRST', message: t(lang, 'SOURCE_NOT_FIRST', { index: n }), step: n });
    const checkRange = (expr: string | undefined) => {
      if (expr === undefined || pages === undefined) return [] as number[];
      try { return parsePageRange(expr, pages); } catch (err) { issues.push(issueFromError(err, lang, n)); return []; }
    };
    switch (step.op) {
      case 'merge': {
        const names = step.files ?? docNames;
        if (names.length === 0) issues.push({ code: 'NO_PDF_INPUTS', message: t(lang, 'NO_PDF_INPUTS'), step: n });
        let total = 0;
        for (const name of names) {
          if (!byName.has(name)) issues.push({ code: 'UNKNOWN_INPUT', message: t(lang, 'UNKNOWN_INPUT', { name }), step: n });
          else if (!['pdf', 'word'].includes(kinds.get(name)!)) issues.push({ code: 'NOT_A_PDF', message: t(lang, 'NOT_A_PDF', { name }), step: n });
          else total += pageCounts.get(name) ?? 0;
        }
        pages = total || undefined;
        break;
      }
      case 'fromImages': {
        const names = step.files ?? imageNames;
        if (names.length === 0) issues.push({ code: 'NO_INPUTS', message: t(lang, 'NO_INPUTS'), step: n });
        for (const name of names) {
          if (!byName.has(name)) issues.push({ code: 'UNKNOWN_INPUT', message: t(lang, 'UNKNOWN_INPUT', { name }), step: n });
          else if (kinds.get(name) !== 'image') issues.push({ code: 'NOT_AN_IMAGE', message: t(lang, 'NOT_AN_IMAGE', { name }), step: n });
        }
        pages = names.length || undefined;
        break;
      }
      case 'select': {
        const sel = pages === undefined ? [] : (() => { try { return parsePageRange(step.pages, pages!, true); } catch (err) { issues.push(issueFromError(err, lang, n)); return []; } })();
        if (sel.length) pages = sel.length;
        break;
      }
      case 'remove': {
        const sel = checkRange(step.pages);
        if (pages !== undefined && sel.length >= pages) issues.push({ code: 'WOULD_REMOVE_ALL_PAGES', message: t(lang, 'WOULD_REMOVE_ALL_PAGES'), step: n });
        else if (pages !== undefined) pages -= sel.length;
        break;
      }
      case 'sign': {
        if (!byName.has(step.image)) issues.push({ code: 'UNKNOWN_INPUT', message: t(lang, 'UNKNOWN_INPUT', { name: step.image }), step: n });
        else if (kinds.get(step.image) !== 'image') issues.push({ code: 'NOT_AN_IMAGE', message: t(lang, 'NOT_AN_IMAGE', { name: step.image }), step: n });
        checkRange(step.pages ?? 'last');
        break;
      }
      case 'rotate':
      case 'stampText':
      case 'watermark':
      case 'numberPages':
        checkRange(step.pages);
        break;
      default:
        break;
    }
    if (pages !== undefined) predicted.push(pages);
  });

  const destructiveSteps = recipe.steps
    .map((s, i) => (DESTRUCTIVE_OPS.has(s.op) ? i + 1 : 0))
    .filter(Boolean);

  return {
    ok: issues.length === 0,
    recipe,
    issues,
    steps: steps.map((s, i) => {
      let text = describeStep(s, lang);
      if (s.op === 'merge') {
        const names = s.files ?? docNames;
        if (names.length === 1 && kinds.get(names[0]!) === 'word') text = t(lang, 'step.convertWord', { file: names[0] });
        else if (!s.files && hasWord) text = t(lang, 'step.mergeAllDocs');
      }
      return `${i + 1}. ${text}${DESTRUCTIVE_OPS.has(s.op) ? ' ' + t(lang, 'destructive') : ''}`;
    }),
    warnings,
    goals: describeGoals(recipe.goals, lang),
    destructiveSteps,
    predictedPages: predicted,
  };
}

function describeGoals(goals: Goals | undefined, lang: Lang): string[] {
  if (!goals) return [];
  return (Object.entries(goals) as [keyof Goals, unknown][])
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => t(lang, `goal.${k}`, { expected: k === 'maxBytes' ? formatBytes(v as number) : v }));
}

export class RecipeError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => i.message).join(' '));
    this.name = 'RecipeError';
    this.issues = issues;
  }
}

const today = () => localDate();

/**
 * Validates, then executes a recipe locally and verifies its goals.
 * Recipes with destructive steps only run with `confirmed: true`.
 * Input byte arrays are never modified.
 */
export async function run(
  raw: unknown,
  files: InputFile[],
  opts: EngineOptions & { confirmed?: boolean } = {},
): Promise<RunResult> {
  const lang = opts.lang ?? 'es';
  const convert = opts.word ?? defaultWord;
  const p = await plan(raw, files, { lang, word: convert });
  if (!p.ok || !p.recipe) throw new RecipeError(p.issues);
  if (p.destructiveSteps.length > 0 && !opts.confirmed) {
    throw new RecipeError([{ code: 'CONFIRMATION_REQUIRED', message: t(lang, 'CONFIRMATION_REQUIRED', { steps: p.destructiveSteps.join(', ') }) }]);
  }
  const recipe = p.recipe;
  // Word inputs become their converted PDF; everything downstream only sees PDFs.
  const byName = new Map<string, Uint8Array>();
  const docs: InputFile[] = [];
  for (const f of files) {
    const kind = kindOf(f.bytes);
    const bytes = kind === 'word' ? (await convertOnce(convert, f.bytes)).pdf : f.bytes;
    byName.set(f.name, bytes);
    if (kind === 'pdf' || kind === 'word') docs.push({ name: f.name, bytes });
  }
  const pdfs = docs;
  const images = files.filter((f) => kindOf(f.bytes) === 'image');

  let doc: Uint8Array | undefined;
  const steps = withSource(recipe.steps);
  for (const [i, step] of steps.entries()) {
    try {
      doc = await apply(step, doc, { byName, pdfs, images });
    } catch (err) {
      throw new RecipeError([issueFromError(err, lang, i + 1)]);
    }
  }
  const result = doc!;
  const info = await core.inspect(result);
  const goals = verify(recipe.goals, result, info, lang);
  const firstName = (files[0]?.name ?? 'documento').replace(/\.[^.]+$/, '');
  const filename = (recipe.output?.filename ?? '{name}-hilvana.pdf').replace('{date}', today()).replace('{name}', firstName);

  return {
    bytes: result,
    filename: filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`,
    pageCount: info.pageCount,
    byteLength: result.byteLength,
    goals,
    allGoalsMet: goals.every((g) => g.met),
    steps: p.steps,
    warnings: p.warnings,
  };
}

async function apply(
  step: Step,
  doc: Uint8Array | undefined,
  ctx: { byName: Map<string, Uint8Array>; pdfs: InputFile[]; images: InputFile[] },
): Promise<Uint8Array> {
  const need = () => doc as Uint8Array;
  switch (step.op) {
    case 'merge': return core.merge(step.files ? step.files.map((n) => ctx.byName.get(n)!) : ctx.pdfs.map((f) => f.bytes));
    case 'fromImages': return core.imagesToPdf(step.files ? step.files.map((n) => ctx.byName.get(n)!) : ctx.images.map((f) => f.bytes), { pageSize: step.pageSize });
    case 'select': return core.selectPages(need(), step.pages);
    case 'remove': return core.removePages(need(), step.pages);
    case 'rotate': return core.rotate(need(), step.angle, step.pages);
    case 'stampText': return core.stampText(need(), { ...step, text: step.text.replace('{date}', today()) });
    case 'sign': return core.stampImage(need(), { image: ctx.byName.get(step.image)!, pages: step.pages, anchor: step.anchor, width: step.width });
    case 'watermark': return core.watermark(need(), step.text, step);
    case 'numberPages': return core.numberPages(need(), step);
    case 'stripMetadata': return core.stripMetadata(need());
    case 'setMetadata': return core.setMetadata(need(), step);
    case 'optimize': return core.optimize(need());
  }
}

/** Checks the result against the recipe goals and explains each outcome. */
export function verify(goals: Goals | undefined, bytes: Uint8Array, info: core.PdfInfo, lang: Lang = 'es'): GoalResult[] {
  if (!goals) return [];
  const out: GoalResult[] = [];
  const add = (goal: keyof Goals, expected: unknown, actual: unknown, met: boolean, fmt: ((v: unknown) => unknown) | null = (v) => v) =>
    out.push({ goal, expected, actual, met, message: `${met ? '✓' : '✗'} ${t(lang, `goal.${goal}`, { expected: fmt ? fmt(expected) : expected })}${fmt ? ` (${fmt(actual)})` : ''}` });
  if (goals.maxBytes !== undefined) add('maxBytes', goals.maxBytes, bytes.byteLength, bytes.byteLength <= goals.maxBytes, (v) => formatBytes(v as number));
  if (goals.pageCount !== undefined) add('pageCount', goals.pageCount, info.pageCount, info.pageCount === goals.pageCount);
  if (goals.maxPages !== undefined) add('maxPages', goals.maxPages, info.pageCount, info.pageCount <= goals.maxPages);
  if (goals.noMetadata) add('noMetadata', true, !info.hasMetadata, !info.hasMetadata, null);
  return out;
}
