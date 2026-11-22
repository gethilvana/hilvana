import { plan, run, kindOfFile, RecipeError, type EngineOptions, type InputFile, type Issue, type Plan, type RunOutput, type RunResult } from './engine.js';
import { Recipe } from './schema.js';
import { t, type Lang } from './i18n.js';

/**
 * Batches apply one recipe to each document separately: "number and stamp every invoice".
 * Documents are the PDF and Word inputs; every other input (a signature image, a certificate)
 * is shared by all runs.
 */

export interface BatchPlan {
  ok: boolean;
  /** Problems that stop the whole batch (the recipe itself). */
  issues: Issue[];
  /** The plan for each document, in order. */
  items: { input: string; plan: Plan }[];
  /** The steps, described once (they are the same for every document). */
  steps: string[];
  goals: string[];
  destructiveSteps: number[];
  /** Files the batch will write in total. */
  outputCount?: number;
  warnings: string[];
}

export interface BatchItem {
  input: string;
  ok: boolean;
  result?: RunResult;
  /** Why this document failed; the others still ran. */
  issues?: Issue[];
}

export interface BatchResult {
  items: BatchItem[];
  /** Every file produced, with names made unique across documents. */
  outputs: RunOutput[];
  succeeded: number;
  failed: number;
}

function split(files: InputFile[]) {
  const docs: InputFile[] = [];
  const shared: InputFile[] = [];
  for (const f of files) {
    const kind = kindOfFile(f);
    (kind === 'pdf' || kind === 'word' ? docs : shared).push(f);
  }
  return { docs, shared };
}

/** A batch recipe cannot name documents: each run sees only one. */
function batchIssues(raw: unknown, lang: Lang): Issue[] {
  const parsed = Recipe.safeParse(raw);
  if (!parsed.success) return [];
  const issues: Issue[] = [];
  parsed.data.steps.forEach((s, i) => {
    if (s.op === 'merge' && s.files) issues.push({ code: 'BATCH_NAMED_FILES', message: t(lang, 'BATCH_NAMED_FILES', { index: i + 1 }), step: i + 1 });
    if (s.op === 'fromImages') issues.push({ code: 'BATCH_FROM_IMAGES', message: t(lang, 'BATCH_FROM_IMAGES', { index: i + 1 }), step: i + 1 });
  });
  return issues;
}

const prefixed = (name: string, issues: Issue[]) => issues.map((i) => ({ ...i, message: `"${name}": ${i.message}` }));

export async function planBatch(raw: unknown, files: InputFile[], opts: EngineOptions = {}): Promise<BatchPlan> {
  const lang = opts.lang ?? 'es';
  const { docs, shared } = split(files);
  const issues = batchIssues(raw, lang);
  if (docs.length === 0) issues.push({ code: 'NO_PDF_INPUTS', message: t(lang, 'NO_PDF_INPUTS') });
  if (issues.length) return { ok: false, issues, items: [], steps: [], goals: [], destructiveSteps: [], warnings: [] };

  const items: BatchPlan['items'] = [];
  for (const doc of docs) items.push({ input: doc.name, plan: await plan(raw, [doc, ...shared], opts) });
  const first = items[0]!.plan;
  // A problem with the recipe itself (schema) shows once; problems with a document name it.
  if (first.issues.some((i) => i.code === 'SCHEMA')) return { ok: false, issues: first.issues, items, steps: [], goals: [], destructiveSteps: [], warnings: [] };
  const perDoc = items.flatMap((it) => prefixed(it.input, it.plan.issues));
  const counts = items.map((it) => it.plan.outputCount);
  return {
    ok: perDoc.length === 0,
    issues: perDoc,
    items,
    steps: first.steps,
    goals: first.goals,
    destructiveSteps: first.destructiveSteps,
    outputCount: counts.every((c) => c !== undefined) ? counts.reduce((a, b) => a! + b!, 0) : undefined,
    warnings: [...new Set(items.flatMap((it) => it.plan.warnings))],
  };
}

/**
 * Runs the recipe once per document. A document that fails does not stop the others: its
 * problems are reported in its item. Throws only when the recipe itself cannot run as a batch.
 */
export async function runBatch(raw: unknown, files: InputFile[], opts: EngineOptions & { confirmed?: boolean } = {}): Promise<BatchResult> {
  const lang = opts.lang ?? 'es';
  const { docs, shared } = split(files);
  const issues = batchIssues(raw, lang);
  if (docs.length === 0) issues.push({ code: 'NO_PDF_INPUTS', message: t(lang, 'NO_PDF_INPUTS') });
  if (issues.length) throw new RecipeError(issues);

  const items: BatchItem[] = [];
  const outputs: RunOutput[] = [];
  const taken = new Set<string>();
  for (const doc of docs) {
    try {
      const result = await run(raw, [doc, ...shared], opts);
      for (const out of result.outputs) {
        let filename = out.filename;
        for (let n = 2; taken.has(filename.toLowerCase()); n++) filename = out.filename.replace(/(\.pdf)?$/i, ` (${n})$1`);
        taken.add(filename.toLowerCase());
        out.filename = filename;
        outputs.push(out);
      }
      items.push({ input: doc.name, ok: true, result });
    } catch (err) {
      // The recipe itself is wrong (not this document): stop, as a single run would.
      if (err instanceof RecipeError && err.issues.some((i) => i.code === 'SCHEMA' || i.code === 'CONFIRMATION_REQUIRED')) throw err;
      const problems = err instanceof RecipeError ? err.issues : [{ code: 'UNKNOWN', message: String((err as Error)?.message ?? err) }];
      items.push({ input: doc.name, ok: false, issues: prefixed(doc.name, problems) });
    }
  }
  return { items, outputs, succeeded: items.filter((i) => i.ok).length, failed: items.filter((i) => !i.ok).length };
}
