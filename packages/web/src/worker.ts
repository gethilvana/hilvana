/// <reference lib="webworker" />
// All document processing happens here, off the main thread, with the same engine as the CLI and the MCP server.
// Nothing in this file can reach the network: the page's Content-Security-Policy only allows its own origin,
// and the only requests made are for the bundled open fonts.
import * as core from '@hilvana/core';
import { HilvanaError } from '@hilvana/core';
import { fallbackTextFonts, wordToPdf, type FontLoader } from '@hilvana/office';
import { kindOf, run, RecipeError, t, type InputFile, type Lang, type WordConverter } from '@hilvana/recipes';
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
const files = new Map<string, { name: string; bytes: Uint8Array }>();
const word: WordConverter = (docx) => wordToPdf(docx, { fonts: fontLoader });
const converted = new WeakMap<Uint8Array, ReturnType<WordConverter>>();
const convertOnce: WordConverter = (docx) => {
  let p = converted.get(docx);
  if (!p) converted.set(docx, (p = word(docx)));
  return p;
};

function message(err: unknown, lang: Lang): string {
  if (err instanceof RecipeError) return err.issues.map((i) => i.message).join(' ');
  if (err instanceof HilvanaError) return t(lang, err.code, err.details);
  return String((err as Error)?.message ?? err);
}

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case 'add': {
      files.set(msg.id, { name: msg.name, bytes: msg.bytes });
      const kind = kindOf(msg.bytes);
      try {
        if (kind === 'pdf') {
          const info = await core.inspect(msg.bytes);
          // Copy for previews: the worker keeps its own bytes.
          const preview = msg.bytes.slice();
          return post({ type: 'added', id: msg.id, kind, info, preview }, [preview.buffer]);
        }
        if (kind === 'word') {
          const res = await convertOnce(msg.bytes);
          const info = await core.inspect(res.pdf);
          const preview = res.pdf.slice();
          return post({ type: 'added', id: msg.id, kind, info, preview, warnings: res.warnings.map((w) => t(msg.lang, `word.${w}`)) }, [preview.buffer]);
        }
        return post({ type: 'added', id: msg.id, kind });
      } catch (err) {
        return post({ type: 'added', id: msg.id, kind, error: message(err, msg.lang) });
      }
    }
    case 'remove':
      files.delete(msg.id);
      return;
    case 'run': {
      try {
        const inputs: InputFile[] = msg.files.map((f) => ({ name: f.name, bytes: files.get(f.id)!.bytes }));
        const res = await run(msg.recipe, inputs, { lang: msg.lang, word: convertOnce, textFonts: loadTextFonts, confirmed: true });
        const out: Output = { name: res.filename, bytes: res.bytes, pageCount: res.pageCount };
        return post({ type: 'done', job: msg.job, outputs: [out], notes: [...res.notes, ...res.goals.filter((g) => !g.met).map((g) => g.message)], warnings: res.warnings }, [res.bytes.buffer]);
      } catch (err) {
        return post({ type: 'failed', job: msg.job, error: message(err, msg.lang) });
      }
    }
    case 'split': {
      try {
        const src = files.get(msg.file)!;
        const base = src.name.replace(/\.[^.]+$/, '');
        const pdf = kindOf(src.bytes) === 'word' ? (await convertOnce(src.bytes)).pdf : src.bytes;
        const parts = msg.ranges ? await core.split(pdf, msg.ranges) : await core.burst(pdf);
        const labels = msg.ranges ?? parts.map((_, i) => String(i + 1));
        const outputs: Output[] = await Promise.all(parts.map(async (bytes, i) => ({
          name: `${base}-${labels[i]!.replace(/[^\w-]+/g, '_')}.pdf`,
          bytes,
          pageCount: (await core.inspect(bytes)).pageCount,
        })));
        return post({ type: 'done', job: msg.job, outputs, notes: [], warnings: [] }, outputs.map((o) => o.bytes.buffer));
      } catch (err) {
        return post({ type: 'failed', job: msg.job, error: message(err, msg.lang) });
      }
    }
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  void handle(e.data);
};
