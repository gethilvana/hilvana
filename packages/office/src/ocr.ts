import { gunzipSync } from 'fflate';
import * as core from '@hilvana/core';

/**
 * OCR on this device, with Tesseract compiled to WebAssembly (tesseract-wasm, BSD-2-Clause) and
 * the integer "best" Spanish and English models (Apache-2.0). Nothing is sent anywhere: the
 * engine and the models are loaded from the package (Node) or from the site itself (browser).
 */

export type OcrLanguage = 'spa' | 'eng';
export const OCR_LANGUAGES: OcrLanguage[] = ['spa', 'eng'];

/** Where the engine and models come from. Node reads them from the installed packages. */
export interface OcrAssets {
  /** The WebAssembly engine; `simd` asks for the faster build when the runtime supports it. */
  wasm(simd: boolean): Promise<Uint8Array>;
  /** A model, gzip-compressed (as published) or plain. */
  model(lang: OcrLanguage): Promise<Uint8Array>;
}

export const nodeOcrAssets: OcrAssets = {
  async wasm(simd) {
    const { readFile } = await import('node:fs/promises');
    const { createRequire } = await import('node:module');
    const path = await import('node:path');
    const dir = path.dirname(createRequire(import.meta.url).resolve('tesseract-wasm'));
    return new Uint8Array(await readFile(path.join(dir, simd ? 'tesseract-core.wasm' : 'tesseract-core-fallback.wasm')));
  },
  async model(lang) {
    const { readFile } = await import('node:fs/promises');
    const { createRequire } = await import('node:module');
    const path = await import('node:path');
    const pkg = createRequire(import.meta.url).resolve(`@tesseract.js-data/${lang}/package.json`);
    return new Uint8Array(await readFile(path.join(path.dirname(pkg), '4.0.0_best_int', `${lang}.traineddata.gz`)));
  },
};

export interface OcrWord {
  text: string;
  /** 0 to 1. */
  confidence: number;
  /** In image pixels, origin top-left. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Engine = {
  loadModel(m: Uint8Array): void;
  loadImage(img: { data: Uint8ClampedArray; width: number; height: number }): void;
  setVariable(name: string, value: string): void;
  getTextBoxes(unit: 'word' | 'line'): { text: string; confidence: number; rect: { left: number; top: number; right: number; bottom: number } }[];
  clearImage(): void;
};
const engines = new Map<string, Promise<Engine>>();

function engineFor(lang: OcrLanguage, assets: OcrAssets): Promise<Engine> {
  let e = engines.get(lang);
  if (!e) {
    e = (async () => {
      const lib = await import('tesseract-wasm');
      const engine = (await lib.createOCREngine({ wasmBinary: await assets.wasm(lib.supportsFastBuild()) })) as unknown as Engine;
      const model = await assets.model(lang);
      engine.loadModel(model[0] === 0x1f && model[1] === 0x8b ? gunzipSync(model) : model);
      return engine;
    })();
    engines.set(lang, e);
    e.catch(() => engines.delete(lang));
  }
  return e;
}

/** Recognizes the words in an image. `dpi` helps Tesseract size its expectations. */
export async function recognize(image: core.RgbaImage, opts: { lang?: OcrLanguage; assets?: OcrAssets; dpi?: number } = {}): Promise<OcrWord[]> {
  const engine = await engineFor(opts.lang ?? 'spa', opts.assets ?? nodeOcrAssets);
  engine.setVariable('user_defined_dpi', String(Math.round(Math.min(600, Math.max(70, opts.dpi ?? 200)))));
  engine.loadImage(image);
  try {
    return engine.getTextBoxes('word')
      .filter((w) => w.text.trim())
      .map((w) => ({ text: w.text.trim(), confidence: w.confidence, ...w.rect }));
  } finally {
    engine.clearImage();
  }
}

/** Words of one page, already placed on the page (for surfaces that render pages themselves). */
export interface PageWords {
  words: core.LayerWord[];
  confidences: number[];
}

/**
 * Turns words found in an image into words on the page. Every word is kept by default, even the
 * doubtful ones: a mangled e-mail address often scores near zero, and leaving it out of the text
 * layer would hide it from search, and so from redaction. The layer is invisible either way.
 */
export function placeWords(words: OcrWord[], toPage: core.PixelToPage, minConfidence = 0): PageWords {
  const kept = words.filter((w) => w.confidence >= minConfidence);
  return {
    words: kept.map((w) => ({
      text: w.text,
      quad: [core.pixelToPage(toPage, w.left, w.bottom), core.pixelToPage(toPage, w.right, w.bottom), core.pixelToPage(toPage, w.left, w.top)],
    })),
    confidences: kept.map((w) => w.confidence),
  };
}

export interface SearchableOptions {
  lang?: OcrLanguage;
  assets?: OcrAssets;
  /**
   * Words for a page found elsewhere (the browser renders pages and recognizes them one by one).
   * When it returns undefined, the page's scanned images are read directly.
   */
  pageWords?: (page: number) => Promise<PageWords | undefined>;
  /** Also read pages that already have text. */
  force?: boolean;
  onPage?: (done: number, total: number) => void;
}

export interface SearchableReport {
  /** Pages that got a text layer. */
  pages: number[];
  words: number;
  /** Mean confidence of the kept words, 0 to 1. */
  confidence: number;
  /** Pages skipped because they already had text. */
  alreadyText: number;
  /** Pages whose scan is in a format that cannot be read here (render it in the browser instead). */
  unreadable: number[];
}

/**
 * Makes scanned pages searchable: reads each page without text and adds an invisible layer
 * with the words, so the PDF looks the same but its text can be found, selected and copied
 * (and redacted).
 */
export async function makeSearchable(bytes: Uint8Array, opts: SearchableOptions = {}): Promise<{ bytes: Uint8Array; report: SearchableReport }> {
  const lang = opts.lang ?? 'spa';
  const total = (await core.inspect(bytes)).pageCount;
  const todo = opts.force ? Array.from({ length: total }, (_, i) => i + 1) : await core.pagesWithoutText(bytes);
  const layers: { page: number; words: core.LayerWord[] }[] = [];
  const confidences: number[] = [];
  const unreadable: number[] = [];
  let done = 0;
  for (const page of todo) {
    let found = await opts.pageWords?.(page);
    if (!found) {
      const { images, unsupported } = await core.scannedImages(bytes, page);
      if (!images.length && unsupported) unreadable.push(page);
      found = { words: [], confidences: [] };
      for (const { image, toPage } of images) {
        // Pixels per inch of this image on the page.
        const [ax, ay] = core.pixelToPage(toPage, 0, 0);
        const [bx, by] = core.pixelToPage(toPage, image.width, 0);
        const dpi = (image.width / Math.max(1, Math.hypot(bx - ax, by - ay))) * 72;
        const placed = placeWords(await recognize(image, { lang, assets: opts.assets, dpi }), toPage);
        found.words.push(...placed.words);
        found.confidences.push(...placed.confidences);
      }
    }
    if (found.words.length) layers.push({ page, words: found.words });
    confidences.push(...found.confidences);
    opts.onPage?.(++done, todo.length);
  }
  const out = layers.length ? await core.addTextLayer(bytes, layers) : bytes;
  return {
    bytes: out,
    report: {
      pages: layers.map((l) => l.page),
      words: layers.reduce((n, l) => n + l.words.length, 0),
      confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0,
      alreadyText: total - todo.length,
      unreadable,
    },
  };
}
