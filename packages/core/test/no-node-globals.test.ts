/**
 * D22: the engine runs in browsers, where Node globals (Buffer, process) do not exist.
 * These tests remove them and exercise every path that touches images, fonts and Word,
 * so a hidden dependency on Node fails here instead of in someone's browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { compress, imagesToPdf, inspect, stampImage, stampText } from '@hilvana/core';
import { fallbackTextFonts, nodeFontLoader, wordToPdf, type FontLoader } from '@hilvana/office';
import { run } from '@hilvana/recipes';
import { Document, ImageRun, Packer, Paragraph } from 'docx';
import { encode } from 'fast-png';

function noisyPng(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 3);
  let x = 7;
  for (let i = 0; i < data.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; data[i] = (x >>> 24) & 0xff; }
  return new Uint8Array(encode({ width: w, height: h, data, channels: 3 }));
}

// Only Buffer: removing process would break the test runner itself. The engine reads process only in
// the LibreOffice adapter, which browsers never load.
const GLOBALS = ['Buffer'] as const;
const saved = new Map<string, unknown>();
const fontFiles = new Map<string, Uint8Array>();
/** Serves fonts from memory, the way the browser serves them over fetch. */
const memoryFonts: FontLoader = async (family, file) => fontFiles.get(`${family}/${file}`);

let photoPdf: Uint8Array;
let smallPng: Uint8Array;
let docx: Uint8Array;
let textFonts: Uint8Array[];

beforeAll(async () => {
  // Everything that needs Node (test tools, reading font files) happens first.
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]).drawImage(await doc.embedPng(noisyPng(1200, 900)), { x: 0, y: 0, width: 400, height: 300 });
  photoPdf = await doc.save();
  smallPng = noisyPng(120, 60);
  docx = new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph('Hola ✓ Ñandú'),
    new Paragraph({ children: [new ImageRun({ type: 'png', data: noisyPng(200, 100), transformation: { width: 200, height: 100 } })] }),
  ] }] })));
  const require = createRequire(import.meta.url);
  for (const family of ['carlito', 'caladea', 'arimo', 'tinos', 'cousine', 'noto-sans-symbols-2'] as const) {
    const dir = path.join(path.dirname(require.resolve(`@fontsource/${family}/package.json`)), 'files');
    for (const f of await readdir(dir)) if (f.endsWith('.woff')) fontFiles.set(`${family}/${f}`, (await nodeFontLoader(family, f))!);
  }
  textFonts = await fallbackTextFonts(memoryFonts);

  // Then the Node globals go away, as in a browser.
  for (const k of GLOBALS) {
    saved.set(k, (globalThis as Record<string, unknown>)[k]);
    delete (globalThis as Record<string, unknown>)[k];
  }
}, 60_000);

afterAll(() => {
  for (const [k, v] of saved) if (v !== undefined) (globalThis as Record<string, unknown>)[k] = v;
});

describe('engine without Node globals (browser-like)', () => {
  it('has really removed them', () => {
    expect(typeof (globalThis as { Buffer?: unknown }).Buffer).toBe('undefined');
  });

  it('compresses photos to JPEG, and leaves no global behind', async () => {
    const { bytes, report } = await compress(photoPdf, { level: 'balanced' });
    expect(report.images.recompressed).toBe(1);
    expect(bytes.byteLength).toBeLessThan(photoPdf.byteLength);
    expect((await inspect(bytes)).pageCount).toBe(1);
    expect(typeof (globalThis as { Buffer?: unknown }).Buffer).toBe('undefined');
  });

  it('reaches a target size', async () => {
    const { report } = await compress(photoPdf, { targetBytes: 150_000 });
    expect(report.targetMet).toBe(true);
  });

  it('converts Word with images and symbols', async () => {
    expect((await wordToPdf(docx, { fonts: memoryFonts })).pageCount).toBe(1);
  });

  it('stamps text with fallback fonts, and signs with an image', async () => {
    const stamped = await stampText(photoPdf, { text: '✓ Recibido', fonts: textFonts });
    const signed = await stampImage(stamped, { image: smallPng, pages: 'last' });
    expect((await inspect(signed)).pageCount).toBe(1);
  });

  it('turns images into a PDF', async () => {
    expect((await inspect(await imagesToPdf([smallPng]))).pageCount).toBe(1);
  });

  it('runs a whole recipe: Word + PDF, compress, number', async () => {
    const res = await run(
      { version: 1, steps: [{ op: 'merge' }, { op: 'compress', level: 'strong' }, { op: 'numberPages' }] },
      [{ name: 'a.pdf', bytes: photoPdf }, { name: 'b.docx', bytes: docx }],
      { word: (d) => wordToPdf(d, { fonts: memoryFonts }), textFonts },
    );
    expect(res.pageCount).toBe(2);
  });
});
