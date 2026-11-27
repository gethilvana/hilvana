#!/usr/bin/env node
// The agent harness: asks each candidate model to plan every corpus case, grades the answers and
// writes bench/results/agent/<model>.json plus the results table in docs/agent-benchmark.md.
//
// Usage (after npm run build):
//   node bench/agent/run.mjs --model reference
//   GROQ_API_KEY=… node bench/agent/run.mjs --model groq-gpt-oss-20b --repeat 3
//   node bench/agent/run.mjs --model ollama-gpt-oss-20b --only kdp,combo --lang es
// Options: --model <id> (repeatable, or "all" for every model with its key set), --only <ids or
// categories, comma-separated>, --lang es|en, --repeat <n>, --concurrency <n>, --fresh, --no-docs,
// --set main|holdout (holdout: the requests that are never used to tune the prompt).
//
// Progress is saved after every answer in bench/results/agent/progress/<model>.json (not committed).
// Running the same command again only asks what is missing, so a run cut short by a time limit or a
// daily quota resumes where it stopped, and --only runs on different days add up. The result in
// bench/results/agent/<model>.json and the docs table are written only once the whole corpus has an
// answer for every repetition. --fresh discards the saved progress.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24). Sandboxes that
// only reach the internet through a proxy need it, so restart once with it set.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== '1') {
  const child = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(child.status ?? 1);
}
import { corpus as main } from './corpus.mjs';
import { holdout } from './holdout.mjs';
import { grade } from './grade.mjs';
import { systemPrompt, userMessage, PROMPT_VERSION } from './prompt.mjs';
import { ask } from './providers.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const resultsDir = path.join(repo, 'bench/results/agent');
const progressDir = path.join(resultsDir, 'progress');
const docsFile = path.join(repo, 'docs/agent-benchmark.md');
const SETS = { main, holdout };
const THRESHOLD = 0.9; // PRD section 10.2: the planner must get at least 90 % of the corpus right

function args(argv) {
  const out = { models: [], only: [], lang: undefined, repeat: 1, concurrency: 4, docs: true, fresh: false, set: 'main' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.models.push(argv[++i]);
    else if (a === '--only') out.only.push(...argv[++i].split(','));
    else if (a === '--lang') out.lang = argv[++i];
    else if (a === '--repeat') out.repeat = Number(argv[++i]);
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--no-docs') out.docs = false;
    else if (a === '--fresh') out.fresh = true;
    else if (a === '--set') out.set = argv[++i];
    else if (a === '--regrade') out.regrade = argv[++i];
    else throw new Error(`Unknown option ${a}`);
  }
  return out;
}

const percentile = (xs, p) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ratio = (rows) => (rows.length ? rows.filter((r) => r.pass).length / rows.length : undefined);

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Results and progress files: <model>.p<prompt version>[.holdout].json, so earlier prompts stay on record. */
const fileFor = (model, set) => `${model.id}.p${PROMPT_VERSION}${set === 'main' ? '' : `.${set}`}.json`;
const key = (r) => `${r.id}#${r.run}`;
/** A provider saying the account is out of quota or credit: asking again today will not help. */
const isQuota = (message = '') => /\b429\b|quota|daily free allocation|rate limit|insufficient|billing|credit/i.test(message);

function loadProgress(model, opts) {
  const file = path.join(progressDir, fileFor(model, opts.set));
  if (opts.fresh || !existsSync(file)) return new Map();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  // Answers to an older prompt or for repetitions beyond the current count no longer apply.
  if (saved.promptVersion !== PROMPT_VERSION || saved.model !== model.model) return new Map();
  return new Map(saved.rows.filter((r) => r.run < opts.repeat && SETS[opts.set].some((c) => c.id === r.id)).map((r) => [key(r), r]));
}

function saveProgress(model, rows, opts) {
  mkdirSync(progressDir, { recursive: true });
  writeFileSync(path.join(progressDir, fileFor(model, opts.set)), JSON.stringify({ model: model.model, promptVersion: PROMPT_VERSION, rows: [...rows.values()] }));
}

/** Asks for every selected answer that is still missing. Stops early when the provider is out of quota or keeps failing. */
async function collect(model, cases, opts) {
  const rows = loadProgress(model, opts);
  const system = systemPrompt();
  const jobs = cases.flatMap((tc) => Array.from({ length: opts.repeat }, (_, run) => ({ tc, run }))).filter((j) => !rows.has(key({ id: j.tc.id, run: j.run })));
  const already = cases.length * opts.repeat - jobs.length;
  if (already) process.stderr.write(`  ${already} answers already saved; ${jobs.length} to go\n`);
  let done = 0;
  let failedInARow = 0;
  let stop;
  await pool(jobs, model.provider === 'reference' ? 16 : opts.concurrency, async ({ tc, run }) => {
    if (stop) return;
    const started = performance.now();
    let answer;
    try {
      answer = await ask(model, { system, user: userMessage(tc), testCase: tc });
    } catch (err) {
      failedInARow++;
      if (isQuota(err.message)) stop ??= `the provider is out of quota or credit: ${err.message.slice(0, 200)}`;
      else if (failedInARow >= 5) stop ??= `5 calls in a row failed: ${err.message.slice(0, 200)}`;
      return; // not saved: it is asked again next time
    }
    failedInARow = 0;
    const ms = Math.round(performance.now() - started);
    const g = await grade(tc, answer.text);
    rows.set(key({ id: tc.id, run }), { id: tc.id, lang: tc.lang, category: tc.category, run, ms, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, ...g, answer: g.pass ? undefined : answer.text?.slice(0, 2000) });
    if (model.provider !== 'reference') saveProgress(model, rows, opts);
    done++;
    if (done % 25 === 0) process.stderr.write(`  ${model.id}: ${done}/${jobs.length}\n`);
  });
  if (model.provider !== 'reference') saveProgress(model, rows, opts);
  return { rows, stop };
}

function summarize(model, rowsMap, opts) {
  const rows = [...rowsMap.values()].sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run);
  const group = (k) => Object.fromEntries([...new Set(rows.map((r) => r[k]))].sort().map((v) => [v, ratio(rows.filter((r) => r[k] === v))]));
  const reasons = {};
  for (const r of rows.filter((x) => !x.pass)) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const avg = (k) => (rows.length ? Math.round(rows.reduce((sum, r) => sum + (r[k] ?? 0), 0) / rows.length) : undefined);
  const inputTokens = avg('inputTokens');
  const outputTokens = avg('outputTokens');
  const byCase = new Map();
  for (const r of rows) byCase.set(r.id, (byCase.get(r.id) ?? true) && r.pass);
  return {
    model: { ...model },
    date: new Date().toISOString().slice(0, 10),
    promptVersion: PROMPT_VERSION,
    set: opts.set,
    cases: byCase.size,
    repeat: opts.repeat,
    accuracy: ratio(rows),
    allRunsRight: [...byCase.values()].filter(Boolean).length / byCase.size,
    passesThreshold: ratio(rows) >= THRESHOLD,
    byLang: group('lang'),
    byCategory: group('category'),
    failures: reasons,
    latencyMs: { p50: percentile(rows.map((r) => r.ms), 50), p95: percentile(rows.map((r) => r.ms), 95) },
    tokens: { input: inputTokens, output: outputTokens },
    costPerPlanUsd: model.price && inputTokens !== undefined ? (inputTokens * model.price[0] + outputTokens * model.price[1]) / 1e6 : undefined,
    rows,
  };
}

/* ------------------------------------------------------------------ docs */

const pct = (x) => (x === undefined ? '—' : `${(x * 100).toFixed(1)} %`);
const usd = (x) => (x === undefined ? '—' : `USD ${x.toFixed(5)}`);

function table(results) {
  if (!results.length) return '_Sin corridas completas todavía._';
  const lines = [
    `Umbral: ${pct(THRESHOLD)} del corpus (sección 10.2 del PRD). Solo se publican corridas con el corpus completo y todas sus repeticiones. Las de prompts anteriores quedan como historial.`,
    '',
    '| Modelo | Prompt | Escenario | Fecha | Casos × repeticiones | Acierto | Español | Inglés | Siempre bien | Fallos más comunes | Latencia p50 / p95 | Tokens entrada / salida | Costo por plan |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    const fails = Object.entries(r.failures).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
    const lat = r.latencyMs.p50 === undefined ? '—' : `${(r.latencyMs.p50 / 1000).toFixed(1)} s / ${(r.latencyMs.p95 / 1000).toFixed(1)} s`;
    lines.push(`| ${r.model.id}${r.passesThreshold ? ' ✓' : ''} | v${r.promptVersion} | ${r.model.scenario ?? '—'} | ${r.date}${r.regraded ? ` (recalificada ${r.regraded})` : ''} | ${r.cases} × ${r.repeat} | ${pct(r.accuracy)} | ${pct(r.byLang.es)} | ${pct(r.byLang.en)} | ${pct(r.allRunsRight)} | ${fails} | ${lat} | ${r.tokens.input ?? '—'} / ${r.tokens.output ?? '—'} | ${usd(r.costPerPlanUsd)} |`);
  }
  const models = results.filter((r) => r.model.id !== 'reference').map((r) => ({ ...r, model: { ...r.model, id: `${r.model.id} (v${r.promptVersion})` } }));
  const cats = [...new Set(models.flatMap((r) => Object.keys(r.byCategory)))].sort();
  if (models.length && cats.length) {
    lines.push('', '### Acierto por categoría', '', `| Categoría | ${models.map((r) => r.model.id).join(' | ')} |`, `|---|${models.map(() => '---').join('|')}|`);
    for (const cat of cats) lines.push(`| ${cat} | ${models.map((r) => pct(r.byCategory[cat])).join(' | ')} |`);
  }
  return lines.join('\n');
}

function updateDocs() {
  const all = readdirSync(resultsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(resultsDir, f), 'utf8')))
    .filter((r) => r.cases === SETS[r.set ?? 'main'].length)
    .sort((a, b) => (a.model.id === 'reference') - (b.model.id === 'reference') || b.promptVersion - a.promptVersion || (b.accuracy ?? 0) - (a.accuracy ?? 0));
  let doc = readFileSync(docsFile, 'utf8');
  for (const [set, marker] of [['main', 'agent-results'], ['holdout', 'agent-holdout']]) {
    const start = `<!-- ${marker}:start -->`;
    const end = `<!-- ${marker}:end -->`;
    doc = doc.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${table(all.filter((r) => (r.set ?? 'main') === set))}\n${end}`);
  }
  writeFileSync(docsFile, doc);
}

/* ------------------------------------------------------------------ main */

const opts = args(process.argv.slice(2));

// --regrade <result file>: grades the saved failed answers again with the current grader (after a
// documented grading change), so old and new runs compare fairly. Passing answers stay passing:
// every grading change only accepts more equivalent forms.
if (opts.regrade) {
  const file = path.resolve(opts.regrade);
  const old = JSON.parse(readFileSync(file, 'utf8'));
  const set = SETS[old.set ?? 'main'];
  let changed = 0;
  for (const r of old.rows) {
    if (r.pass || r.answer === undefined) continue;
    const g = await grade(set.find((c) => c.id === r.id), r.answer);
    if (g.pass) { Object.assign(r, g, { message: undefined, answer: undefined }); changed++; }
  }
  const result = summarize(old.model, new Map(old.rows.map((r) => [key(r), r])), { repeat: old.repeat, set: old.set ?? 'main' });
  Object.assign(result, { date: old.date, promptVersion: old.promptVersion, regraded: new Date().toISOString().slice(0, 10) });
  writeFileSync(file, JSON.stringify(result, null, 1) + '\n');
  console.log(`${path.basename(file)}: ${changed} answers now pass; ${pct(old.accuracy)} → ${pct(result.accuracy)}`);
  updateDocs();
  process.exit(0);
}
const catalog = JSON.parse(readFileSync(path.join(here, 'models.json'), 'utf8')).models;
let models = opts.models.includes('all') ? catalog : catalog.filter((m) => opts.models.includes(m.id));
if (opts.models.length === 0) models = catalog.filter((m) => m.id === 'reference');
const unknown = opts.models.filter((id) => id !== 'all' && !catalog.some((m) => m.id === id));
if (unknown.length) throw new Error(`Unknown model(s): ${unknown.join(', ')}. See bench/agent/models.json.`);

if (!SETS[opts.set]) throw new Error(`Unknown set ${opts.set}: use main or holdout.`);
const corpus = SETS[opts.set];
let cases = corpus;
if (opts.only.length) cases = cases.filter((tc) => opts.only.includes(tc.id) || opts.only.includes(tc.category));
if (opts.lang) cases = cases.filter((tc) => tc.lang === opts.lang);
if (!cases.length) throw new Error('No cases selected.');

mkdirSync(resultsDir, { recursive: true });
let published = false;
for (const model of models) {
  process.stderr.write(`${model.id} (${opts.set}): ${cases.length} cases × ${opts.repeat}\n`);
  let collected;
  try {
    collected = await collect(model, cases, opts);
  } catch (err) {
    process.stderr.write(`  skipped: ${err.message}\n`);
    continue;
  }
  const { rows, stop } = collected;
  const missing = corpus.length * opts.repeat - [...rows.values()].length;
  const selected = [...rows.values()].filter((r) => cases.some((c) => c.id === r.id));
  if (selected.length) {
    const part = summarize(model, new Map(selected.map((r) => [key(r), r])), opts);
    console.log(`${model.id}: ${pct(part.accuracy)} on ${selected.length} answers (es ${pct(part.byLang.es)}, en ${pct(part.byLang.en)})`, part.failures);
    for (const r of selected.filter((x) => !x.pass).slice(0, 15)) console.log(`  ✗ ${r.id} [${r.reason}] ${r.message?.slice(0, 160)}`);
  }
  if (stop) console.log(`  stopped: ${stop}`);
  if (missing > 0) {
    console.log(`  ${missing} of ${corpus.length * opts.repeat} answers still missing for the full result. Run the same command again to continue${stop && isQuota(stop) ? ' once the quota resets' : ''}.`);
    continue;
  }
  const result = summarize(model, rows, opts);
  writeFileSync(path.join(resultsDir, fileFor(model, opts.set)), JSON.stringify(result, null, 1) + '\n');
  if (model.provider !== 'reference') rmSync(path.join(progressDir, fileFor(model, opts.set)), { force: true });
  published = true;
  console.log(`  full corpus done: ${pct(result.accuracy)}, written to bench/results/agent/${fileFor(model, opts.set)}`);
}
if (opts.docs && published) updateDocs();
