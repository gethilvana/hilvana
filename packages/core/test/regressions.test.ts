/**
 * Regression tests for defects found in the phase-0 QA pass (docs/qa/fase-0.md).
 * Each test names the defect it guards.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { inspect, load, merge, numberPages, selectPages, stampImage, stampText, stripMetadata, watermark } from '@hilvana/core';
import { TINY_PNG, makePdf } from './helpers.js';

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => new Uint8Array(readFileSync(path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files', file)));
const FONTS = [font('carlito', 'carlito-latin-400-normal.woff'), font('carlito', 'carlito-greek-400-normal.woff'), font('noto-sans-symbols-2', 'noto-sans-symbols-2-symbols-400-normal.woff')];

/** Text items with their position as displayed (after page rotation), via pdf.js. */
async function displayedText(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const out: { page: number; str: string; x: number; y: number; w: number; h: number; vertical: boolean }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    for (const it of (await page.getTextContent()).items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      // Text direction as displayed: the baseline vector rotated by the viewport.
      const [x2, y2] = vp.convertToViewportPoint(it.transform[4] + it.transform[0], it.transform[5] + it.transform[1]);
      out.push({ page: i, str: it.str, x, y, w: vp.width, h: vp.height, vertical: Math.abs(y2 - y) > Math.abs(x2 - x) });
    }
  }
  return out;
}

async function rotatedPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (const r of [0, 90, 180, 270]) {
    const p = doc.addPage([612, 792]);
    p.drawText(`rotada ${r}`, { x: 72, y: 700, size: 12, font: f });
    p.setRotation(degrees(r));
  }
  return doc.save();
}

describe('D1 · text outside the standard fonts', () => {
  it('stamps ✓, Greek and accents with fallback fonts', async () => {
    const out = await stampText(await makePdf(1), { text: '✓ Aprobado Ελλάδα ñ', fonts: FONTS });
    const items = await displayedText(out);
    // pdf.js splits text where the font changes; compare ignoring the split points.
    expect(items.map((i) => i.str).join('').replace(/\s+/g, '')).toContain('✓AprobadoΕλλάδαñ');
  });

  it('fails with a stable code (not a crash) when no fonts are given', async () => {
    await expect(stampText(await makePdf(1), { text: 'Listo ✓' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CHARACTERS', details: { chars: '✓' } });
    await expect(watermark(await makePdf(1), 'Ελλάδα')).rejects.toMatchObject({ code: 'UNSUPPORTED_CHARACTERS' });
  });

  it('keeps the small standard font when text is plain', async () => {
    const plain = await stampText(await makePdf(1), { text: 'Recibido — señor Núñez €', fonts: FONTS });
    const doc = await PDFDocument.load(plain);
    expect(doc.context.enumerateIndirectObjects().some(([, o]) => String(o).includes('FontFile'))).toBe(false);
  });
});

describe('D2 · damaged PDFs', () => {
  it('reports a truncated file as INVALID_PDF instead of crashing', async () => {
    const good = await makePdf(3);
    const truncated = good.slice(0, Math.floor(good.length / 3));
    await expect(inspect(truncated)).rejects.toMatchObject({ code: 'INVALID_PDF' });
    await expect(stripMetadata(truncated)).rejects.toMatchObject({ code: 'INVALID_PDF' });
  });
});

describe('D3 · rotated pages', () => {
  it('puts stamps upright in the displayed corner on 0/90/180/270° pages', async () => {
    let out = await stampText(await rotatedPages(), { text: 'SELLO', anchor: 'top-right' });
    out = await numberPages(out, { format: 'p{n}' });
    const items = await displayedText(out);
    for (let page = 1; page <= 4; page++) {
      const stamp = items.find((i) => i.page === page && i.str === 'SELLO')!;
      expect(stamp.vertical).toBe(false); // reads left to right as displayed
      expect(stamp.x).toBeGreaterThan(stamp.w / 2); // right half
      expect(stamp.y).toBeLessThan(stamp.h / 4); // top quarter (viewport y grows downwards)
      const num = items.find((i) => i.page === page && i.str === `p${page}`)!;
      expect(num.vertical).toBe(false);
      expect(num.y).toBeGreaterThan(num.h * 0.9); // bottom
      expect(Math.abs(num.x - num.w / 2)).toBeLessThan(30); // centered
    }
  });

  it('places the signature bottom-right as displayed', async () => {
    const out = await stampImage(await rotatedPages(), { image: TINY_PNG, pages: 'all', width: 100 });
    expect((await inspect(out)).pageCount).toBe(4); // drawn on every rotated page without errors
  });
});

describe('D4 · visible box not at the origin', () => {
  it('stamps inside the CropBox and an offset MediaBox', async () => {
    const doc = await PDFDocument.create();
    const a = doc.addPage([612, 792]);
    a.setMediaBox(100, 200, 512, 592);
    const b = doc.addPage([612, 792]);
    b.setCropBox(50, 50, 300, 300);
    const out = await numberPages(await stampText(await doc.save(), { text: 'SELLO', anchor: 'top-right' }), { format: 'n{n}' });
    for (const it of await displayedText(out)) {
      expect(it.x).toBeGreaterThan(0);
      expect(it.x).toBeLessThan(it.w);
      expect(it.y).toBeGreaterThan(0);
      expect(it.y).toBeLessThan(it.h);
    }
    expect((await displayedText(out)).filter((i) => i.str === 'SELLO')).toHaveLength(2);
  });
});

describe('D14 · form fields survive merge and page selection', () => {
  async function formPdf(name: string, value: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const tf = doc.getForm().createTextField(name);
    tf.setText(value);
    tf.addToPage(page, { x: 72, y: 600, width: 200, height: 24 });
    const cb = doc.getForm().createCheckBox('acepta');
    cb.check();
    cb.addToPage(page, { x: 72, y: 560, width: 18, height: 18 });
    doc.addPage([612, 792]);
    return doc.save();
  }

  it('keeps fields fillable after merging, renaming duplicates', async () => {
    const out = await PDFDocument.load(await merge([await formPdf('nombre', 'Ana'), await formPdf('nombre', 'José')]));
    const fields = out.getForm().getFields();
    expect(fields.map((f) => f.getName()).sort()).toEqual(['acepta', 'acepta_2', 'nombre', 'nombre_2']);
    expect(out.getForm().getTextField('nombre').getText()).toBe('Ana');
    expect(out.getForm().getTextField('nombre_2').getText()).toBe('José');
    out.getForm().getTextField('nombre').setText('Cambiado'); // still fillable
  });

  it('keeps fields on the selected pages only', async () => {
    const src = await formPdf('nombre', 'Ana');
    expect((await PDFDocument.load(await selectPages(src, '1'))).getForm().getFields()).toHaveLength(2);
    expect((await PDFDocument.load(await selectPages(src, '2'))).getForm().getFields()).toHaveLength(0);
  });
});

// D17: qpdf-style encrypted files (object streams) were reported as invalid instead of protected.
describe('encrypted PDFs are reported as protected (D17)', () => {
  it.each(['con-contrasena.pdf', 'solo-permisos.pdf'])('%s', async (name) => {
    const { readFile } = await import('node:fs/promises');
    const bytes = new Uint8Array(await readFile(new URL(`../../web/e2e/fixtures/${name}`, import.meta.url)));
    await expect(inspect(bytes)).rejects.toMatchObject({ code: 'ENCRYPTED' });
    await expect(load(bytes)).rejects.toMatchObject({ code: 'ENCRYPTED' });
  });
});

// Signed PDFs: Hilvana rewrites files, so a signature never survives a change. Detect it so surfaces can warn.
describe('digital signatures are detected', () => {
  it('counts signature dictionaries, inside object streams too', async () => {
    const { makeSignedPdf } = await import('./helpers.js');
    expect((await inspect(await makeSignedPdf(2, 1))).signatures).toBe(1);
    expect((await inspect(await makeSignedPdf(3, 2))).signatures).toBe(2);
  });

  it('does not count unsigned files or look-alike dictionaries', async () => {
    const { makePdf } = await import('./helpers.js');
    const { PDFDocument } = await import('pdf-lib');
    expect((await inspect(await makePdf(2))).signatures).toBe(0);
    const doc = await PDFDocument.load(await makePdf(1));
    doc.context.register(doc.context.obj({ ByteRange: [0, 1, 2, 3] })); // no /Contents: not a signature
    expect((await inspect(await doc.save())).signatures).toBe(0);
  });

  it('a changed file no longer carries the signature (why the warning exists)', async () => {
    const { makeSignedPdf } = await import('./helpers.js');
    const merged = await merge([await makeSignedPdf(2, 1)]);
    expect((await inspect(merged)).signatures).toBe(0);
  });
});

describe('changed files never carry a broken signature', () => {
  it.each([
    ['merge', async (b: Uint8Array) => merge([b])],
    ['stamp', async (b: Uint8Array) => stampText(b, { text: 'Recibido' })],
    ['select', async (b: Uint8Array) => selectPages(b, '1')],
    ['strip metadata', async (b: Uint8Array) => stripMetadata(b)],
    ['compress', async (b: Uint8Array) => (await (await import('@hilvana/core')).compress(b, { level: 'lossless' })).bytes],
  ])('%s', async (_name, op) => {
    const { makeSignedPdf } = await import('./helpers.js');
    const out = await op(await makeSignedPdf(2, 2));
    const info = await inspect(out);
    expect(info.signatures).toBe(0);
    const doc = await PDFDocument.load(out);
    expect(doc.catalog.has((await import('pdf-lib')).PDFName.of('Perms'))).toBe(false);
  });
});
