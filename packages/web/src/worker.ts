/// <reference lib="webworker" />
// All document processing happens here, off the main thread, with the same engine as the CLI and the MCP server.
// Nothing in this file can reach the network: the page's Content-Security-Policy only allows its own origin,
// and the only requests made are for the bundled open fonts.
import * as core from '@hilvana/core';
import { HilvanaError } from '@hilvana/core';
import { DocxError, fallbackTextFonts, wordToPdf, type FontLoader } from '@hilvana/office';
import { Recipe, describeStep, kindOf, run, runBatch, RecipeError, t, type InputFile, type Lang, type WordConverter } from '@hilvana/recipes';
import type { FromWorker, ToWorker, Output } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const fontLoader: FontLoader = async (family, file) => {
  // The worker script lives one folder below the site root, both in development and in the build.
  const res = await fetch(new URL(`../fonts/${family}/${file}`, self.location.href));
  if (!res.ok) return undefined;
  return new Uint8Array(await res.arrayBuffer());
};

let textFonts: Promise<Uint8Array[]> | undefined;
const loadTextFonts = () => (textFonts ??= fallbackTextFonts(fontLoader));

// Files stay here, by id, so each Word file is converted once and bytes cross threads once.
// `original` and `password` are kept for signing a protected, signed PDF as it is.
const files = new Map<string, { name: string; bytes: Uint8Array; original: Uint8Array; password?: string; protection?: core.Protection }>();
const word: WordConverter = (docx) => wordToPdf(docx, { fonts: fontLoader });
const converted = new WeakMap<Uint8Array, ReturnType<WordConverter>>();
const convertOnce: WordConverter = (docx) => {
  let p = converted.get(docx);
  if (!p) converted.set(docx, (p = word(docx)));
  return p;
};

function message(err: unknown, lang: Lang, name = ''): string {
  if (err instanceof RecipeError) return err.issues.map((i) => i.message).join(' ');
  if (err instanceof HilvanaError) return t(lang, err.code, err.details);
  if (err instanceof DocxError) return t(lang, err.code, { name });
  return String((err as Error)?.message ?? err);
}

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case 'unlock':
    case 'add': {
      if (msg.type === 'add') files.set(msg.id, { name: msg.name, bytes: msg.bytes, original: msg.bytes });
      const file = files.get(msg.id);
      if (!file) return;
      const kind = kindOf(file.bytes);
      try {
        if (kind === 'pdf') {
          // Protected PDFs are unlocked here, once; the worker keeps the unlocked copy, so recipes
          // never need the password again. Files with only usage restrictions open on their own.
          const password = msg.type === 'unlock' ? msg.password : '';
          const open = await core.unlock(file.original, password);
          file.bytes = open.bytes;
          file.protection = open.protection;
          file.password = password || undefined;
          const info = { ...(await core.inspect(open.bytes)), protection: open.protection };
          // Copy for previews: the worker keeps its own bytes.
          const preview = open.bytes.slice();
          return post({ type: 'added', id: msg.id, kind, info, preview }, [preview.buffer]);
        }
        if (kind === 'word') {
          const res = await convertOnce(file.bytes);
          const info = await core.inspect(res.pdf);
          const preview = res.pdf.slice();
          return post({ type: 'added', id: msg.id, kind, info, preview, warnings: res.warnings.map((w) => t(msg.lang, `word.${w}`)) }, [preview.buffer]);
        }
        return post({ type: 'added', id: msg.id, kind });
      } catch (err) {
        const needsPassword = err instanceof HilvanaError && (err.code === 'PASSWORD_REQUIRED' || err.code === 'WRONG_PASSWORD');
        return post({ type: 'added', id: msg.id, kind, error: message(err, msg.lang, file.name), needsPassword });
      }
    }
    case 'remove':
      files.delete(msg.id);
      return;
    case 'run': {
      try {
        // The engine gets each file as it arrived (with its password), so it can say what protection
        // it removed, or sign a protected, signed PDF as it is. Unlocking again is cached by bytes.
        const inputs: InputFile[] = msg.files.map((f) => {
          const file = files.get(f.id)!;
          return { name: f.name, bytes: file.original, password: f.password ?? file.password };
        });
        const res = await run(msg.recipe, inputs, { lang: msg.lang, word: convertOnce, textFonts: loadTextFonts, confirmed: true });
        const outputs: Output[] = res.outputs.map((o) => ({ name: o.filename, bytes: o.bytes, pageCount: o.pageCount }));
        return post({ type: 'done', job: msg.job, outputs, notes: [...res.notes, ...res.goals.filter((g) => !g.met).map((g) => g.message)], warnings: res.warnings }, outputs.map((o) => o.bytes.buffer));
      } catch (err) {
        return post({ type: 'failed', job: msg.job, error: message(err, msg.lang) });
      }
    }
    case 'batch': {
      try {
        const inputs: InputFile[] = msg.files.map((f) => {
          const file = files.get(f.id)!;
          return { name: f.name, bytes: file.original, password: file.password };
        });
        const res = await runBatch(msg.recipe, inputs, { lang: msg.lang, word: convertOnce, textFonts: loadTextFonts, confirmed: true });
        const outputs: Output[] = res.outputs.map((o) => ({ name: o.filename, bytes: o.bytes, pageCount: o.pageCount }));
        const done = res.items.filter((i) => i.result);
        const notes = [t(msg.lang, 'batch.done', { ok: res.succeeded, total: res.items.length }), ...done.flatMap((i) => i.result!.goals.filter((g) => !g.met).map((g) => `${i.input}: ${g.message}`))];
        const warnings = [...res.items.flatMap((i) => (i.issues ?? []).map((x) => x.message)), ...new Set(done.flatMap((i) => i.result!.warnings))];
        if (!outputs.length) return post({ type: 'failed', job: msg.job, error: warnings.join(' ') });
        return post({ type: 'done', job: msg.job, outputs, notes, warnings }, outputs.map((o) => o.bytes.buffer));
      } catch (err) {
        return post({ type: 'failed', job: msg.job, error: message(err, msg.lang) });
      }
    }
    case 'find': {
      try {
        const file = files.get(msg.id);
        if (!file) return post({ type: 'found', job: msg.job, matches: [] });
        const pdf = kindOf(file.bytes) === 'word' ? (await convertOnce(file.bytes)).pdf : file.bytes;
        const matches = await core.findText(pdf, { terms: msg.terms, patterns: msg.patterns as core.RedactPattern[] });
        return post({ type: 'found', job: msg.job, matches });
      } catch (err) {
        return post({ type: 'failed', job: msg.job, error: message(err, msg.lang) });
      }
    }
    case 'describe': {
      const parsed = Recipe.safeParse(msg.recipe);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        return post({ type: 'failed', job: msg.job, error: t(msg.lang, 'SCHEMA', { issues }) });
      }
      return post({ type: 'described', job: msg.job, steps: parsed.data.steps.map((st) => describeStep(st, msg.lang)) });
    }
    case 'certificate': {
      // The certificate and its password stay in this worker; only who signs goes back to the page.
      try {
        const info = await core.readCertificate(files.get(msg.id)!.bytes, msg.password);
        return post({ type: 'certificate', job: msg.job, info });
      } catch (err) {
        return post({ type: 'failed', job: msg.job, error: message(err, msg.lang), code: err instanceof HilvanaError ? err.code : undefined });
      }
    }
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  void handle(e.data);
};
