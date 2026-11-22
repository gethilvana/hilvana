/** OCR that makes scans searchable, on this machine. Results are read back with pdf.js. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import jpeg from 'jpeg-js';
import { findText, redact } from '@hilvana/core';
import { makeSearchable } from '@hilvana/office';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/ocr/${name}`, import.meta.url)));

async function text(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  await task.destroy();
  return out;
}

// "@" in a 150 dpi JPEG is read as "Q" with low confidence: real OCR is not perfect, and the
// interface says so. The rest must be exact.
const EXPECTED = ['Extracto de cuenta de ahorros', 'Ana María Pérez Gómez', '123 456 789', '1.234.567,89', 'ana.perez', 'example.com', 'Bogotá, noviembre de 2026'];

describe('makeSearchable', { timeout: 60_000 }, () => {
  it('reads a phone-style JPEG scan in Spanish and adds an invisible text layer', async () => {
    const src = fixture('escaneo-jpeg.pdf');
    expect((await text(src))[0]).toBe('');
    const { bytes, report } = await makeSearchable(src);
    expect(report).toMatchObject({ pages: [1], alreadyText: 0, unreadable: [] });
    expect(report.words).toBeGreaterThanOrEqual(20);
    expect(report.confidence).toBeGreaterThan(0.85);
    const [page] = await text(bytes);
    for (const s of EXPECTED) expect(page).toContain(s);
  });

  it('places the words where they are on the page, so search finds them in the right spot', async () => {
    const { bytes } = await makeSearchable(fixture('escaneo-jpeg.pdf'));
    const [m] = await findText(bytes, { terms: ['123456789'] });
    // On the source page the line sits at x 60, y ≈ 700 (points).
    expect(m!.areas[0]!.x).toBeGreaterThan(50);
    expect(m!.areas[0]!.x).toBeLessThan(160);
    expect(m!.areas[0]!.y).toBeGreaterThan(690);
    expect(m!.areas[0]!.y).toBeLessThan(712);
  });

  it('reads a scan drawn sideways on a rotated page', async () => {
    const { bytes, report } = await makeSearchable(fixture('escaneo-rotado.pdf'));
    expect(report.pages).toEqual([1]);
    const [page] = await text(bytes);
    for (const s of EXPECTED.slice(0, 3)) expect(page).toContain(s);
  });

  it('reads a 1-bit black-and-white scan', async () => {
    // Threshold the JPEG scan into a 1-bit image, as office scanners produce.
    const src = await PDFDocument.load(fixture('escaneo-jpeg.pdf'));
    const img = [...src.context.enumerateIndirectObjects()].map(([, o]) => o).find((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))!;
    const px = jpeg.decode(img.contents, { useTArray: true, formatAsRGBA: true });
    const rowBytes = Math.ceil(px.width / 8);
    const bits = new Uint8Array(rowBytes * px.height);
    for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) if (px.data[(y * px.width + x) * 4]! > 128) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const stream = doc.context.flateStream(bits, { Type: 'XObject', Subtype: 'Image', Width: px.width, Height: px.height, ColorSpace: 'DeviceGray', BitsPerComponent: 1 });
    page.node.setXObject(PDFName.of('Scan'), doc.context.register(stream));
    const ops = doc.context.flateStream('q 595 0 0 842 0 0 cm /Scan Do Q');
    page.node.set(PDFName.of('Contents'), doc.context.register(ops));
    const { bytes, report } = await makeSearchable(await doc.save());
    expect(report.pages).toEqual([1]);
    expect((await text(bytes))[0]).toContain('123 456 789');
  });

  it('leaves pages that already have text alone, unless asked', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont('Helvetica');
    doc.addPage().drawText('Este documento ya tiene texto seleccionable', { x: 50, y: 700, size: 12, font });
    const bytes = await doc.save();
    const { report } = await makeSearchable(bytes);
    expect(report).toMatchObject({ pages: [], alreadyText: 1 });
  });

  it('lets a scan be redacted by text, removing the words and the pixels under them', async () => {
    const { bytes } = await makeSearchable(fixture('escaneo-jpeg.pdf'));
    const matches = await findText(bytes, { terms: ['123 456 789'] });
    const { bytes: out, report } = await redact(bytes, { areas: matches.flatMap((m) => m.areas) });
    expect(report.imagesPainted).toBe(1);
    const [page] = await text(out);
    expect(page).not.toContain('456');
    expect(page).toContain('Cuenta No.');
    // Reading the redacted scan again finds no trace of the number.
    const again = await makeSearchable(out, { force: true });
    const [reread] = await text(again.bytes);
    expect(reread).not.toMatch(/123|456|789/);
  });
});
