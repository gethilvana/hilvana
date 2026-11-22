import * as core from '@hilvana/core';
import { HilvanaError, parsePageRange } from '@hilvana/core';
import { DocxError, fallbackTextFonts, isDocx, makeSearchable, wordToPdf, type OcrAssets, type PageWords } from '@hilvana/office';
import { DESTRUCTIVE_OPS, FINAL_OPS, Recipe, type Goals, type Step } from './schema.js';
import { describeStep, formatBytes, localDate, t, type Lang } from './i18n.js';

export type FileKind = 'pdf' | 'word' | 'image' | 'certificate' | 'other';

const CERTIFICATE_NAME = /\.(p12|pfx)$/i;

/** Turns a .docx into PDF bytes. Surfaces choose the engine; the default is the built-in one. */
export type WordConverter = (docx: Uint8Array) => Promise<{ pdf: Uint8Array; pageCount: number; warnings: string[]; engine?: string }>;

export interface EngineOptions {
  lang?: Lang;
  word?: WordConverter;
  /** Fonts for stamped text outside the standard PDF fonts. Defaults to the bundled open fonts (Node). */
  textFonts?: core.FontSource;
  /** OCR: where the engine and models come from (default: the installed packages), and words found elsewhere. */
  ocr?: { assets?: OcrAssets; pageWords?: (page: number) => Promise<PageWords | undefined> };
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
  /** Password to open this PDF, when it needs one. Used only to decrypt it here, never stored or sent. */
  password?: string;
}

// Each protected file is unlocked once, even though plan() and run() both need it.
const unlocked = new WeakMap<Uint8Array, Map<string, Promise<core.UnlockResult>>>();
function unlockOnce(bytes: Uint8Array, password = ''): Promise<core.UnlockResult> {
  let byPassword = unlocked.get(bytes);
  if (!byPassword) unlocked.set(bytes, (byPassword = new Map()));
  let p = byPassword.get(password);
  if (!p) byPassword.set(password, (p = core.unlock(bytes, password)));
  return p;
}

/**
 * Replaces protected PDFs with their unlocked copies. Files with only usage restrictions open on
 * their own; files that need a password open with the one given for them. Says what was removed.
 */
async function unlockInputs(files: InputFile[], lang: Lang): Promise<{ files: InputFile[]; warnings: string[]; issues: Issue[]; failed: Set<string>; protections: Map<string, core.Protection> }> {
  const out: InputFile[] = [];
  const warnings: string[] = [];
  const protections = new Map<string, core.Protection>();
  const issues: Issue[] = [];
  const failed = new Set<string>();
  for (const f of files) {
    if (kindOf(f.bytes) !== 'pdf') { out.push(f); continue; }
    try {
      const res = await unlockOnce(f.bytes, f.password);
      protections.set(f.name, res.protection);
      if (res.protection === 'permissions') warnings.push(t(lang, 'UNLOCKED_PERMISSIONS', { name: f.name }));
      if (res.protection === 'password') warnings.push(t(lang, 'UNLOCKED_PASSWORD', { name: f.name }));
      out.push({ name: f.name, bytes: res.bytes, password: f.password });
    } catch (err) {
      failed.add(f.name);
      const issue = issueFromError(err, lang);
      issues.push({ ...issue, message: `"${f.name}": ${issue.message}` });
      out.push(f);
    }
  }
  return { files: out, warnings, issues, failed, protections };
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
  /** How many files the recipe will produce (more than one when it ends with `split`). */
  outputCount?: number;
  /** Simplifications made while converting Word files, in plain language. */
  warnings: string[];
  /** Who will sign, when the recipe ends with `signDigital` and the certificate opened. */
  signer?: core.CertificateInfo;
}

export interface GoalResult {
  goal: keyof Goals;
  expected: unknown;
  actual: unknown;
  met: boolean;
  message: string;
}

export interface RunOutput {
  bytes: Uint8Array;
  filename: string;
  pageCount: number;
  byteLength: number;
}

export interface RunResult {
  /** Every file the recipe produced: one, or one per part when the recipe ends with `split`. */
  outputs: RunOutput[];
  /** The first output (the only one unless the recipe splits); kept for single-output callers. */
  bytes: Uint8Array;
  filename: string;
  pageCount: number;
  byteLength: number;
  goals: GoalResult[];
  allGoalsMet: boolean;
  steps: string[];
  warnings: string[];
  /** What some steps did, in plain language (e.g. compression results). */
  notes: string[];
}

/** What kind of file an input is. Certificates have no magic number, so they are told by their name. */
export function kindOfFile(f: { name: string; bytes: Uint8Array }): FileKind {
  const kind = kindOf(f.bytes);
  return kind === 'other' && CERTIFICATE_NAME.test(f.name) ? 'certificate' : kind;
}

/**
 * A recipe made only of `signDigital` on one PDF signs that file as it is, so the signatures it
 * already has stay valid. Any other recipe builds a new file first.
 */
function signsInPlace(recipe: Recipe, docNames: string[], kinds: Map<string, FileKind>): boolean {
  return recipe.steps.length === 1 && recipe.steps[0]!.op === 'signDigital' && docNames.length === 1 && kinds.get(docNames[0]!) === 'pdf';
}

// Each certificate is opened once per password, even though plan() and run() both need it.
const certificates = new WeakMap<Uint8Array, Map<string, Promise<core.CertificateInfo>>>();
function readCertificateOnce(bytes: Uint8Array, password: string): Promise<core.CertificateInfo> {
  let byPassword = certificates.get(bytes);
  if (!byPassword) certificates.set(bytes, (byPassword = new Map()));
  let p = byPassword.get(password);
  if (!p) {
    byPassword.set(password, (p = core.readCertificate(bytes, password)));
    p.catch(() => byPassword!.delete(password));
  }
  return p;
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
  const prepared = await unlockInputs(files, lang);
  files = prepared.files;
  const issues: Issue[] = [...prepared.issues];
  const byName = new Map(files.map((f) => [f.name, f]));
  const kinds = new Map(files.map((f) => [f.name, kindOfFile(f)]));
  const docNames = files.filter((f) => ['pdf', 'word'].includes(kinds.get(f.name)!)).map((f) => f.name);
  const imageNames = files.filter((f) => kinds.get(f.name) === 'image').map((f) => f.name);
  const hasWord = docNames.some((n) => kinds.get(n) === 'word');
  const inPlace = signsInPlace(recipe, docNames, kinds);

  const pageCounts = new Map<string, number>();
  const warnings: string[] = [...prepared.warnings];
  for (const name of docNames) {
    if (prepared.failed.has(name)) continue; // already explained
    try {
      if (kinds.get(name) === 'word') {
        const res = await convertOnce(convert, byName.get(name)!.bytes);
        pageCounts.set(name, res.pageCount);
        for (const w of res.warnings) warnings.push(`${name}: ${t(lang, `word.${w}`)}`);
      } else {
        const info = await core.inspect(byName.get(name)!.bytes);
        pageCounts.set(name, info.pageCount);
        if (info.signatures > 0) warnings.push(t(lang, inPlace ? 'SIGNATURES_KEPT' : 'SIGNED_INPUT', { name }));
        if (info.missingPages) warnings.push(t(lang, 'MISSING_PAGES', { name, count: info.missingPages }));
        // Signed in place, a protected file keeps its protection: earlier signatures depend on it.
        const protection = prepared.protections.get(name);
        if (inPlace && info.signatures > 0 && protection && protection !== 'none') {
          const removed = t(lang, protection === 'password' ? 'UNLOCKED_PASSWORD' : 'UNLOCKED_PERMISSIONS', { name });
          warnings.splice(warnings.indexOf(removed), 1, t(lang, 'PROTECTION_KEPT', { name }));
        }
      }
    } catch (err) {
      if (err instanceof DocxError) issues.push({ code: err.code, message: t(lang, err.code, { name }) });
      else issues.push(issueFromError(err, lang));
    }
  }

  const steps = withSource(recipe.steps);
  const offset = steps.length - recipe.steps.length; // 1 when a merge was prepended
  let pages: number | undefined;
  let outputCount: number | undefined = 1;
  const predicted: number[] = [];
  let certificateCheck: { name: string; step: number } | undefined;

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
      case 'protect': {
        if (i !== steps.length - 1) issues.push({ code: 'FINAL_NOT_LAST', message: t(lang, 'FINAL_NOT_LAST', { index: n }), step: n });
        if (!step.password && step.allowPrint !== false && step.allowCopy !== false && step.allowModify !== false) {
          issues.push({ code: 'NOTHING_TO_PROTECT', message: t(lang, 'NOTHING_TO_PROTECT', { index: n }), step: n });
        }
        break;
      }
      case 'signDigital': {
        if (i !== steps.length - 1) issues.push({ code: 'FINAL_NOT_LAST', message: t(lang, 'FINAL_NOT_LAST', { index: n }), step: n });
        const cert = byName.get(step.certificate);
        if (!cert) issues.push({ code: 'UNKNOWN_INPUT', message: t(lang, 'UNKNOWN_INPUT', { name: step.certificate }), step: n });
        else if (kinds.get(step.certificate) !== 'certificate') issues.push({ code: 'NOT_A_CERTIFICATE', message: t(lang, 'NOT_A_CERTIFICATE', { name: step.certificate }), step: n });
        else if (!cert.password) issues.push({ code: 'CERTIFICATE_PASSWORD_REQUIRED', message: t(lang, 'CERTIFICATE_PASSWORD_REQUIRED', { name: step.certificate }), step: n });
        else certificateCheck = { name: step.certificate, step: n };
        if (step.visible !== false) checkRange(step.pages ?? 'last');
        break;
      }
      case 'redact': {
        if (!step.terms?.length && !step.patterns?.length && !step.areas?.length) issues.push({ code: 'NOTHING_TO_REDACT', message: t(lang, 'NOTHING_TO_REDACT', { index: n }), step: n });
        for (const a of step.areas ?? []) {
          if (pages !== undefined && a.page > pages) issues.push({ code: 'PAGE_OUT_OF_RANGE', message: t(lang, 'PAGE_OUT_OF_RANGE', { page: a.page, pageCount: pages }), step: n });
        }
        break;
      }
      case 'split': {
        if (i !== steps.length - 1) issues.push({ code: 'SPLIT_NOT_LAST', message: t(lang, 'SPLIT_NOT_LAST', { index: n }), step: n });
        for (const r of step.ranges ?? []) {
          const sel = checkRange(r);
          if (pages !== undefined && sel.length === 0) issues.push({ code: 'INVALID_RANGE', message: t(lang, 'INVALID_RANGE', { expr: r }), step: n });
        }
        outputCount = step.ranges ? step.ranges.length : pages;
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

  // Only one step can produce the final file(s).
  const finals = recipe.steps.filter((s) => FINAL_OPS.has(s.op));
  if (finals.length > 1 && !issues.some((x) => x.code === 'FINAL_NOT_LAST' || x.code === 'SPLIT_NOT_LAST')) {
    const n = recipe.steps.findIndex((s) => FINAL_OPS.has(s.op)) + 1;
    issues.push({ code: 'FINAL_NOT_LAST', message: t(lang, 'FINAL_NOT_LAST', { index: n }), step: n });
  }

  // Open the certificate now, so a wrong password or an expired certificate shows before running.
  let signer: core.CertificateInfo | undefined;
  if (certificateCheck) {
    const { name, step: n } = certificateCheck;
    try {
      signer = await readCertificateOnce(byName.get(name)!.bytes, byName.get(name)!.password!);
      const now = new Date();
      if (now < signer.validFrom) issues.push({ code: 'CERTIFICATE_NOT_YET_VALID', message: t(lang, 'CERTIFICATE_NOT_YET_VALID', { from: localDate(signer.validFrom) }), step: n });
      else if (now > signer.validTo) issues.push({ code: 'CERTIFICATE_EXPIRED', message: t(lang, 'CERTIFICATE_EXPIRED', { to: localDate(signer.validTo) }), step: n });
      if (signer.selfSigned) warnings.push(t(lang, 'SELF_SIGNED_CERTIFICATE', { name }));
    } catch (err) {
      issues.push(issueFromError(err, lang, n));
    }
  }

  const destructiveSteps = recipe.steps
    .map((s, i) => (DESTRUCTIVE_OPS.has(s.op) ? i + 1 : 0))
    .filter(Boolean);

  return {
    ok: issues.length === 0,
    recipe,
    issues,
    steps: steps.map((s, i) => {
      let text = describeStep(s, lang);
      if (s.op === 'compress' && !s.level && s.targetBytes === undefined && recipe.goals?.maxBytes) {
        text = t(lang, 'step.compressTarget', { target: formatBytes(recipe.goals.maxBytes) });
      }
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
    outputCount,
    signer,
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
 * Recipes can be shared, so their output name is only ever a file name: no folders, no "..",
 * no characters Windows forbids, no leading dots.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]+/).filter(Boolean).pop() ?? '';
  const cleaned = base
    .replace(/[<>:"|?*\u0000-\u001f]/g, '-')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 150);
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned) || !cleaned ? 'documento-hilvana' : cleaned;
}

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
  const originals = files;
  files = (await unlockInputs(files, lang)).files; // cached: already unlocked during plan()
  // Word inputs become their converted PDF; everything downstream only sees PDFs.
  const byName = new Map<string, Uint8Array>();
  const docs: InputFile[] = [];
  const passwords = new Map(files.map((f) => [f.name, f.password]));
  for (const f of files) {
    const kind = kindOfFile(f);
    const bytes = kind === 'word' ? (await convertOnce(convert, f.bytes)).pdf : f.bytes;
    byName.set(f.name, bytes);
    if (kind === 'pdf' || kind === 'word') docs.push({ name: f.name, bytes });
  }
  const pdfs = docs;
  const images = files.filter((f) => kindOfFile(f) === 'image');
  const kinds = new Map(files.map((f) => [f.name, kindOfFile(f)]));
  const inPlace = signsInPlace(recipe, docs.map((d) => d.name), kinds);

  let doc: Uint8Array | undefined;
  const notes: string[] = [];
  const steps = withSource(recipe.steps);
  for (const [i, step] of steps.entries()) {
    if (inPlace && step.op === 'merge') { doc = originals.find((f) => f.name === docs[0]!.name)!.bytes; continue; }
    try {
      doc = await apply(step, doc, { byName, pdfs, images, notes, lang, goals: recipe.goals, fonts: opts.textFonts ?? (() => fallbackTextFonts()), passwords, ocr: opts.ocr });
    } catch (err) {
      throw new RecipeError([issueFromError(err, lang, i + 1)]);
    }
  }
  const firstName = (files[0]?.name ?? 'documento').replace(/\.[^.]+$/, '');
  const named = safeFilename((recipe.output?.filename ?? '{name}-hilvana.pdf').replace('{date}', today()).replace('{name}', firstName));
  const base = named.replace(/\.pdf$/i, '');

  // A final split turns the document into parts; every other recipe has exactly one output.
  const last = steps[steps.length - 1]!;
  const parts: { bytes: Uint8Array; label?: string }[] = [];
  if (last.op === 'split') {
    try {
      const pieces = last.ranges ? await core.split(doc!, last.ranges) : await core.burst(doc!);
      pieces.forEach((bytes, i) => parts.push({ bytes, label: last.ranges ? last.ranges[i]! : String(i + 1) }));
    } catch (err) {
      throw new RecipeError([issueFromError(err, lang, steps.length - (steps.length - recipe.steps.length))]);
    }
  } else {
    parts.push({ bytes: doc! });
  }

  const outputs: RunOutput[] = [];
  const goals: GoalResult[] = [];
  // A result protected with a password is opened with it, only to check it here.
  const openWith = last.op === 'protect' ? last.password : inPlace ? passwords.get(docs[0]!.name) : undefined;
  for (const part of parts) {
    const info = await core.inspect(openWith ? (await core.unlock(part.bytes, openWith)).bytes : part.bytes);
    const filename = safeFilename(part.label ? `${base}-${part.label.replace(/[^\w-]+/g, '_')}` : base) + '.pdf';
    outputs.push({ bytes: part.bytes, filename, pageCount: info.pageCount, byteLength: part.bytes.byteLength });
    for (const g of verify(recipe.goals, part.bytes, info, lang)) goals.push(parts.length > 1 ? { ...g, message: `${filename}: ${g.message}` } : g);
  }

  return {
    outputs,
    bytes: outputs[0]!.bytes,
    filename: outputs[0]!.filename,
    pageCount: outputs[0]!.pageCount,
    byteLength: outputs[0]!.byteLength,
    goals,
    allGoalsMet: goals.every((g) => g.met),
    steps: p.steps,
    warnings: p.warnings,
    notes,
  };
}

async function apply(
  step: Step,
  doc: Uint8Array | undefined,
  ctx: { byName: Map<string, Uint8Array>; pdfs: InputFile[]; images: InputFile[]; notes: string[]; lang: Lang; goals?: Goals; fonts: core.FontSource; passwords: Map<string, string | undefined>; ocr?: EngineOptions['ocr'] },
): Promise<Uint8Array> {
  const need = () => doc as Uint8Array;
  switch (step.op) {
    case 'merge': return core.merge(step.files ? step.files.map((n) => ctx.byName.get(n)!) : ctx.pdfs.map((f) => f.bytes));
    case 'fromImages': return core.imagesToPdf(step.files ? step.files.map((n) => ctx.byName.get(n)!) : ctx.images.map((f) => f.bytes), { pageSize: step.pageSize });
    case 'select': return core.selectPages(need(), step.pages);
    case 'remove': return core.removePages(need(), step.pages);
    case 'rotate': return core.rotate(need(), step.angle, step.pages);
    case 'stampText': return core.stampText(need(), { ...step, text: step.text.replace('{date}', today()), fonts: ctx.fonts });
    case 'sign': return core.stampImage(need(), { image: ctx.byName.get(step.image)!, pages: step.pages, anchor: step.anchor, width: step.width });
    case 'watermark': return core.watermark(need(), step.text, { ...step, fonts: ctx.fonts });
    case 'numberPages': return core.numberPages(need(), { ...step, fonts: ctx.fonts });
    case 'stripMetadata': return core.stripMetadata(need());
    case 'setMetadata': return core.setMetadata(need(), step);
    case 'optimize': return core.optimize(need());
    case 'split': return need(); // applied after every other step, see run()
    case 'ocr': {
      const { lang } = ctx;
      const { bytes, report } = await makeSearchable(need(), { lang: step.language, force: step.force, assets: ctx.ocr?.assets, pageWords: ctx.ocr?.pageWords });
      if (report.pages.length) {
        ctx.notes.push(t(lang, 'note.ocr', { pages: report.pages.join(', '), words: report.words, confidence: Math.round(report.confidence * 100) }));
        ctx.notes.push(t(lang, 'note.ocrCheck'));
      } else if (!report.unreadable.length) ctx.notes.push(t(lang, 'note.ocrNone'));
      if (report.unreadable.length) ctx.notes.push(t(lang, 'note.ocrUnreadable', { pages: report.unreadable.join(', ') }));
      return bytes;
    }
    case 'redact': {
      const { lang } = ctx;
      const matches = step.terms?.length || step.patterns?.length ? await core.findText(need(), { terms: step.terms, patterns: step.patterns }) : [];
      const areas = [...matches.flatMap((m) => m.areas), ...(step.areas ?? [])];
      if (!areas.length) {
        ctx.notes.push(t(lang, 'note.redactNothing'));
        return need();
      }
      const { bytes, report } = await core.redact(need(), { areas });
      const pagesList = report.pages.join(', ');
      ctx.notes.push(t(lang, 'note.redact', { matches: matches.length, areas: step.areas?.length ?? 0, pages: pagesList }));
      ctx.notes.push(t(lang, 'note.redactChecked'));
      if (report.imagesRemoved) ctx.notes.push(t(lang, 'note.redactImagesRemoved', { count: report.imagesRemoved }));
      if (report.structureRemoved) ctx.notes.push(t(lang, 'note.redactStructure'));
      return bytes;
    }
    case 'protect': {
      const out = await core.protect(need(), step);
      if (step.password) ctx.notes.push(t(ctx.lang, 'note.protected'));
      return out;
    }
    case 'signDigital': {
      const certificate = ctx.byName.get(step.certificate)!;
      const password = ctx.passwords.get(step.certificate) ?? '';
      const who = await readCertificateOnce(certificate, password);
      const res = await core.signWithCertificate(need(), {
        certificate,
        password,
        // Only a document signed as it is can still be protected; its own password opens it.
        openPassword: ctx.pdfs.length === 1 ? ctx.passwords.get(ctx.pdfs[0]!.name) : undefined,
        reason: step.reason,
        location: step.location,
        visible: step.visible === false ? false : {
          text: t(ctx.lang, 'visible.signed', { name: who.name, date: today() }),
          pages: step.pages,
          anchor: step.anchor,
          fonts: ctx.fonts,
        },
      });
      ctx.notes.push(t(ctx.lang, 'note.signed', { name: res.signer.name, issuer: res.signer.issuer, to: localDate(res.signer.validTo) }));
      if (!res.visible) ctx.notes.push(t(ctx.lang, 'note.signedInvisible'));
      return res.bytes;
    }
    case 'compress': {
      // With no explicit level, aim for the recipe's size goal if there is one.
      const target = step.targetBytes ?? (step.level ? undefined : ctx.goals?.maxBytes);
      const { bytes, report } = await core.compress(need(), { level: step.level, targetBytes: target });
      const { lang } = ctx;
      if (report.level === 'none') ctx.notes.push(t(lang, 'note.compressNone'));
      else ctx.notes.push(t(lang, 'note.compress', { before: formatBytes(report.before), after: formatBytes(report.after), level: t(lang, `level.${report.level}`), images: report.images.recompressed }));
      if (report.targetMet === false) ctx.notes.push(t(lang, 'note.targetMissed', { target: formatBytes(target!), after: formatBytes(bytes.byteLength) }));
      return bytes;
    }
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
