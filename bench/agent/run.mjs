#!/usr/bin/env node
// The agent harness: asks each candidate model to plan every corpus case, grades the answers and
// writes bench/results/agent/<model>.json plus the results table in docs/agent-benchmark.md.
//
// Usage (after npm run build):
//   node bench/agent/run.mjs --model reference
//   GROQ_API_KEY=… node bench/agent/run.mjs --model groq-gpt-oss-20b --repeat 3
//   node bench/agent/run.mjs --model ollama-gpt-oss-20b --only kdp,combo --lang es
// Options: --model <id> (repeatable, or "all" for every model with its key set), --only <ids or
// categories, comma-separated>, --lang es|en, --repeat <n>, --concurrency <n>, --no-docs.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { corpus } from './corpus.mjs';
import { grade } from './grade.mjs';
import { systemPrompt, userMessage, PROMPT_VERSION } from './prompt.mjs';
import { ask } from './providers.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const resultsDir = path.join(repo, 'bench/results/agent');
const docsFile = path.join(repo, 'docs/agent-benchmark.md');
const THRESHOLD = 0.9; // PRD section 10.2: the planner must get at least 90 % of the corpus right

function args(argv) {
  const out = { models: [], only: [], lang: undefined, repeat: 1, concurrency: 4, docs: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.models.push(argv[++i]);
    else if (a === '--only') out.only.push(...argv[++i].split(','));
    else if (a === '--lang') out.lang = argv[++i];
    else if (a === '--repeat') out.repeat = Number(argv[++i]);
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--no-docs') out.docs = false;
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

async function runModel(model, cases, opts) {
  const system = systemPrompt();
  const jobs = cases.flatMap((tc) => Array.from({ length: opts.repeat }, (_, run) => ({ tc, run })));
  let done = 0;
  const rows = await pool(jobs, model.provider === 'reference' ? 16 : opts.concurrency, async ({ tc, run }) => {
    const started = performance.now();
    let answer;
    try {
      answer = await ask(model, { system, user: userMessage(tc), testCase: tc });
    } catch (err) {
      answer = { text: '', error: err.message, inputTokens: 0, outputTokens: 0 };
    }
    const ms = Math.round(performance.now() - started);
    const g = answer.error ? { pass: false, reason: 'error', message: answer.error } : await grade(tc, answer.text);
    done++;
    if (done % 25 === 0 || done === jobs.length) process.stderr.write(`  ${model.id}: ${done}/${jobs.length}\n`);
    return { id: tc.id, lang: tc.lang, category: tc.category, run, ms, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, ...g, answer: g.pass ? undefined : answer.text?.slice(0, 2000) };
  });

  const group = (key) => Object.fromEntries([...new Set(rows.map((r) => r[key]))].sort().map((k) => [k, ratio(rows.filter((r) => r[key] === k))]));
  const reasons = {};
  for (const r of rows.filter((r) => !r.pass)) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const timed = rows.filter((r) => r.reason !== 'error');
  const avg = (k) => (timed.length ? Math.round(timed.reduce((s, r) => s + (r[k] ?? 0), 0) / timed.length) : undefined);
  const inputTokens = avg('inputTokens');
  const outputTokens = avg('outputTokens');
  const costPerPlan = model.price && inputTokens !== undefined ? (inputTokens * model.price[0] + outputTokens * model.price[1]) / 1e6 : undefined;
  const byCase = new Map();
  for (const r of rows) byCase.set(r.id, (byCase.get(r.id) ?? true) && r.pass);

  return {
    model: { ...model },
    date: new Date().toISOString().slice(0, 10),
    promptVersion: PROMPT_VERSION,
    cases: cases.length,
    fullCorpus: cases.length === corpus.length,
    repeat: opts.repeat,
    accuracy: ratio(rows),
    allRunsRight: [...byCase.values()].filter(Boolean).length / byCase.size,
    passesThreshold: ratio(rows) >= THRESHOLD,
    byLang: group('lang'),
    byCategory: group('category'),
    failures: reasons,
    latencyMs: { p50: percentile(timed.map((r) => r.ms), 50), p95: percentile(timed.map((r) => r.ms), 95) },
    tokens: { input: inputTokens, output: outputTokens },
    costPerPlanUsd: costPerPlan,
    rows,
  };
}

/* ------------------------------------------------------------------ docs */

const pct = (x) => (x === undefined ? '—' : `${(x * 100).toFixed(1)} %`);
const usd = (x) => (x === undefined ? '—' : `USD ${x.toFixed(5)}`);

function table(results) {
  const lines = [
    `Umbral: ${pct(THRESHOLD)} del corpus (sección 10.2 del PRD). Solo cuentan para la decisión las corridas con el corpus completo.`,
    '',
    '| Modelo | Escenario | Fecha | Casos × repeticiones | Acierto | Español | Inglés | Siempre bien | Fallos más comunes | Latencia p50 / p95 | Tokens entrada / salida | Costo por plan |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    const fails = Object.entries(r.failures).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
    const lat = r.latencyMs.p50 === undefined ? '—' : `${(r.latencyMs.p50 / 1000).toFixed(1)} s / ${(r.latencyMs.p95 / 1000).toFixed(1)} s`;
    lines.push(`| ${r.model.id}${r.passesThreshold ? ' ✓' : ''} | ${r.model.scenario ?? '—'} | ${r.date} | ${r.cases} × ${r.repeat}${r.fullCorpus ? '' : ' (parcial)'} | ${pct(r.accuracy)} | ${pct(r.byLang.es)} | ${pct(r.byLang.en)} | ${pct(r.allRunsRight)} | ${fails} | ${lat} | ${r.tokens.input ?? '—'} / ${r.tokens.output ?? '—'} | ${usd(r.costPerPlanUsd)} |`);
  }
  const models = results.filter((r) => r.model.id !== 'reference');
  const cats = [...new Set(models.flatMap((r) => Object.keys(r.byCategory)))].sort();
  if (models.length && cats.length) {
    lines.push('', '### Acierto por categoría', '', `| Categoría | ${models.map((r) => r.model.id).join(' | ')} |`, `|---|${models.map(() => '---').join('|')}|`);
    for (const cat of cats) lines.push(`| ${cat} | ${models.map((r) => pct(r.byCategory[cat])).join(' | ')} |`);
  }
  return lines.join('\n');
}

function updateDocs() {
  const results = readdirSync(resultsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(resultsDir, f), 'utf8')))
    .sort((a, b) => (a.model.id === 'reference') - (b.model.id === 'reference') || (b.accuracy ?? 0) - (a.accuracy ?? 0));
  const doc = readFileSync(docsFile, 'utf8');
  const start = '<!-- agent-results:start -->';
  const end = '<!-- agent-results:end -->';
  const next = doc.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${table(results)}\n${end}`);
  writeFileSync(docsFile, next);
}

/* ------------------------------------------------------------------ main */

const opts = args(process.argv.slice(2));
const catalog = JSON.parse(readFileSync(path.join(here, 'models.json'), 'utf8')).models;
let models = opts.models.includes('all') ? catalog : catalog.filter((m) => opts.models.includes(m.id));
if (opts.models.length === 0) models = catalog.filter((m) => m.id === 'reference');
const unknown = opts.models.filter((id) => id !== 'all' && !catalog.some((m) => m.id === id));
if (unknown.length) throw new Error(`Unknown model(s): ${unknown.join(', ')}. See bench/agent/models.json.`);

let cases = corpus;
if (opts.only.length) cases = cases.filter((tc) => opts.only.includes(tc.id) || opts.only.includes(tc.category));
if (opts.lang) cases = cases.filter((tc) => tc.lang === opts.lang);
if (!cases.length) throw new Error('No cases selected.');

mkdirSync(resultsDir, { recursive: true });
for (const model of models) {
  process.stderr.write(`${model.id}: ${cases.length} cases × ${opts.repeat}\n`);
  let result;
  try {
    result = await runModel(model, cases, opts);
  } catch (err) {
    process.stderr.write(`  skipped: ${err.message}\n`);
    continue;
  }
  if (result.rows.every((r) => r.reason === 'error')) {
    process.stderr.write(`  skipped: every call failed (${result.rows[0]?.message})\n`);
    continue;
  }
  writeFileSync(path.join(resultsDir, `${model.id}.json`), JSON.stringify(result, null, 1) + '\n');
  console.log(`${model.id}: ${pct(result.accuracy)} (es ${pct(result.byLang.es)}, en ${pct(result.byLang.en)})`, result.failures);
  for (const r of result.rows.filter((x) => !x.pass).slice(0, 15)) console.log(`  ✗ ${r.id} [${r.reason}] ${r.message?.slice(0, 160)}`);
}
if (opts.docs) updateDocs();
