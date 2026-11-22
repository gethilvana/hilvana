/**
 * Real redaction: what is under an area must be gone from the file, not just covered. Every test
 * reads the result back with pdf.js, as any reader (or anyone trying to recover the text) would.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument, PDFName, PDFArray, StandardFonts, rgb, PDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import jpeg from 'jpeg-js';
import { findText, redact, HilvanaError } from '@hilvana/core';

const require = createRequire(import.meta.url);
const arimo = () => readFileSync(require.resolve('@fontsource/arimo/files/arimo-latin-400-normal.woff'));

/** A minimal RGBA PNG encoder for tests. */
function png(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const { zlibSync } = require('fflate') as typeof import('fflate');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function texts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((x) => ('str' in x ? x.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  }
  await task.destroy();
  return out;
}

/** A bank-statement-like page with a standard font, an embedded font and a hidden OCR line. */
async function statement(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const embedded = await doc.embedFont(arimo(), { subset: true });
  const page = doc.addPage([595, 842]);
  page.drawText('Cuenta de ahorros No. 123 456 789 activa', { x: 72, y: 760, size: 12, font: helv });
  page.drawText('Titular: Ana María Pérez, cédula 1.020.304.050', { x: 72, y: 730, size: 12, font: embedded });
  page.drawText('Saldo disponible $ 1.234.567,89', { x: 72, y: 700, size: 12, font: helv });
  page.drawText('Correo ana.perez@example.com', { x: 72, y: 670, size: 12, font: embedded });
  page.drawText('texto oculto 99887766', { x: 72, y: 640, size: 12, font: helv, opacity: 1 });
  // Make the last line invisible (render mode 3), like an OCR text layer.
  const contents = page.node.Contents();
  void contents;
  return doc.save();
}

describe('findText', () => {
  it('finds numbers with or without separators, emails, and leaves money alone', async () => {
    const bytes = await statement();
    const byTerm = await findText(bytes, { terms: ['123456789'] });
    expect(byTerm.map((m) => m.text)).toEqual(['123 456 789']);
    const byPattern = await findText(bytes, { patterns: ['email', 'number'] });
    expect(byPattern.map((m) => m.text).sort()).toEqual(['1.020.304.050', '123 456 789', '99887766', 'ana.perez@example.com']);
    expect(byPattern.every((m) => m.page === 1 && m.areas.length === 1)).toBe(true);
  });

  it('ignores case and accents in words', async () => {
    const matches = await findText(await statement(), { terms: ['ana maria perez'] });
    expect(matches.map((m) => m.text)).toEqual(['ana maria perez']);
  });
});

describe('redact', () => {
  it('removes the matched text from the file and keeps the rest of the line in place', async () => {
    const bytes = await statement();
    const matches = await findText(bytes, { terms: ['123 456 789', 'Ana María Pérez'], patterns: ['email'] });
    const { bytes: out, report } = await redact(bytes, { areas: matches.flatMap((m) => m.areas) });
    const [text] = await texts(out);
    expect(text).not.toMatch(/123|456|789/);
    expect(text).not.toMatch(/Ana|María|Pérez|ana\.perez|example/);
    expect(text).toContain('Cuenta de ahorros No.');
    expect(text).toContain('activa');
    expect(text).toContain('Titular:');
    expect(text).toContain('cédula 1.020.304.050');
    expect(text).toContain('Saldo disponible $ 1.234.567,89');
    expect(report).toMatchObject({ areas: 3, pages: [1], strictPass: false });
    expect(report.glyphs).toBe(11 + 15 + 21);
    // "activa" did not move: it starts where it did.
    const where = async (b: Uint8Array, word: string) => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ data: b.slice(), verbosity: 0 });
      const items = (await (await (await task.promise).getPage(1)).getTextContent()).items as { str: string; transform: number[]; width: number }[];
      const it = items.find((x) => x.str.includes(word))!;
      const x = it.transform[4]! + (it.width * it.str.indexOf(word)) / it.str.length;
      await task.destroy();
      return x;
    };
    expect(Math.abs((await where(out, 'activa')) - (await where(bytes, 'activa')))).toBeLessThan(3);
  });

  it('removes invisible text (like an OCR layer) too', async () => {
    const doc = await PDFDocument.load(await statement());
    // Turn the hidden line into render mode 3 by prefixing the page content.
    const page = doc.getPage(0);
    const ops = doc.context.flateStream('3 Tr\n');
    const contents = page.node.Contents();
    const arr = contents instanceof PDFArray ? contents.asArray() : [page.node.get(PDFName.of('Contents'))!];
    page.node.set(PDFName.of('Contents'), doc.context.obj([doc.context.register(ops), ...arr]));
    const bytes = await doc.save();
    const matches = await findText(bytes, { terms: ['99887766'] });
    expect(matches).toHaveLength(1);
    const { bytes: out } = await redact(bytes, { areas: matches[0]!.areas });
    expect((await texts(out))[0]).not.toContain('99887766');
  });

  it('paints over the pixels of an image under an area, and nothing else', async () => {
    const W = 100, H = 50;
    const px = new Uint8Array(W * H * 4).fill(255);
    const img = new Uint8Array(jpeg.encode({ data: px, width: W, height: H }, 95).data);
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    page.drawImage(await doc.embedJpg(img), { x: 100, y: 100, width: 100, height: 50 });
    const bytes = await doc.save();
    // Cover the left half of the image.
    const { bytes: out, report } = await redact(bytes, { areas: [{ page: 1, x: 90, y: 90, width: 60, height: 70 }] });
    expect(report.imagesPainted).toBe(1);
    const after = await PDFDocument.load(out);
    const images = [...after.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(1); // the original image is gone from the file
    const decoded = jpeg.decode(images[0]!.contents, { useTArray: true });
    const at = (x: number, y: number) => decoded.data[(y * W + x) * 4]!;
    expect(at(10, 25)).toBeLessThan(30); // painted
    expect(at(90, 25)).toBeGreaterThan(220); // untouched
  });

  it('removes a shape held in the transparency of an image (a signature on a plain colour)', async () => {
    // 60x20 PNG: every pixel dark blue; the "signature" lives only in the alpha channel.
    const W = 60, H = 20;
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      rgba.set([20, 30, 120, Math.abs(y - 10 - Math.round(8 * Math.sin(x / 5))) < 2 ? 255 : 0], o);
    }
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).drawImage(await doc.embedPng(png(W, H, rgba)), { x: 20, y: 20, width: 120, height: 40 });
    const bytes = await doc.save();
    const { bytes: out, report } = await redact(bytes, { areas: [{ page: 1, x: 10, y: 10, width: 150, height: 60 }] });
    expect(report.imagesPainted).toBe(1);
    const after = await PDFDocument.load(out);
    const { unzlibSync } = await import('fflate');
    const masks = [...after.context.enumerateIndirectObjects()].map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') && o.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceGray'));
    expect(masks).toHaveLength(1);
    // The whole image was under the area: the mask is fully opaque, so no shape is left.
    expect(unzlibSync(masks[0]!.contents).every((v) => v === 255)).toBe(true);
  });

  it('redacts text inside a form drawn on the page, without touching other pages that use it', async () => {
    const src = await PDFDocument.create();
    const helv = await src.embedFont(StandardFonts.Helvetica);
    src.addPage([300, 100]).drawText('Secreto 4242', { x: 10, y: 40, size: 14, font: helv });
    const doc = await PDFDocument.create();
    const [form] = await doc.embedPdf(await src.save());
    doc.addPage([300, 100]).drawPage(form!, { x: 0, y: 0 });
    doc.addPage([300, 100]).drawPage(form!, { x: 0, y: 0 });
    const bytes = await doc.save();
    const matches = await findText(bytes, { terms: ['4242'] });
    const { bytes: out } = await redact(bytes, { areas: matches.filter((m) => m.page === 1).flatMap((m) => m.areas) });
    expect(await texts(out)).toEqual(['Secreto', 'Secreto 4242']);
  });

  it('removes annotations over an area and draws the boxes', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    const field = form.createTextField('cuenta');
    field.setText('000-111-222');
    field.addToPage(page, { x: 50, y: 150, width: 120, height: 20 });
    const bytes = await doc.save();
    const { bytes: out, report } = await redact(bytes, { areas: [{ page: 1, x: 40, y: 140, width: 150, height: 40 }], color: '#000000' });
    expect(report.annotations).toBe(1);
    const after = await PDFDocument.load(out);
    expect(after.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(JSON.stringify(await texts(out))).not.toContain('000-111-222');
  });

  it('rejects areas outside the document', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawRectangle({ x: 0, y: 0, width: 10, height: 10, color: rgb(1, 0, 0) });
    const bytes = await doc.save();
    await expect(redact(bytes, { areas: [{ page: 2, x: 0, y: 0, width: 10, height: 10 }] })).rejects.toBeInstanceOf(HilvanaError);
    await expect(redact(bytes, { areas: [] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
