import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from 'pdf-lib';
import jpeg from 'jpeg-js';
import { compress, inspect, optimize } from '@hilvana/core';

/** A photo-like image: smooth gradients plus sensor-style noise (hard to compress, like real photos). */
function photoJpeg(w: number, h: number, quality = 92): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 24;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = Math.max(0, Math.min(255, 128 + 100 * Math.sin(x / 70) + rand()));
      data[i + 1] = Math.max(0, Math.min(255, 128 + 100 * Math.cos(y / 50) + rand()));
      data[i + 2] = Math.max(0, Math.min(255, (x + y) % 256 + rand()));
      data[i + 3] = 255;
    }
  }
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, quality).data);
}

let cachedPhoto: Uint8Array | undefined;
async function pdfWithPhoto(drawWidth: number, opts: { withText?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg((cachedPhoto ??= photoJpeg(2400, 1600)));
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 36, y: 300, width: drawWidth, height: (drawWidth * 1600) / 2400 });
  if (opts.withText) page.drawText('Texto que debe sobrevivir', { x: 36, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

async function imageSizes(bytes: Uint8Array): Promise<{ w: number; h: number; filter: string }[]> {
  const doc = await PDFDocument.load(bytes);
  const out: { w: number; h: number; filter: string }[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') && !obj.dict.get(PDFName.of('ColorSpace'))?.toString().includes('Gray')) {
      out.push({
        w: obj.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(),
        h: obj.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(),
        filter: String(obj.dict.get(PDFName.of('Filter'))),
      });
    }
  }
  return out;
}

describe('compress', { timeout: 60_000 }, () => {
  it('shrinks a large photo to the resolution it is displayed at', async () => {
    const src = await pdfWithPhoto(540, { withText: true }); // 7.5 in wide → 1125 px at 150 dpi
    const { bytes, report } = await compress(src, { level: 'balanced' });
    expect(report).toMatchObject({ level: 'balanced', images: { found: 1, downsampled: 1 } });
    expect(bytes.byteLength).toBeLessThan(src.byteLength * 0.4);
    const [img] = await imageSizes(bytes);
    expect(img!.w).toBe(1125);
    expect(img!.filter).toBe('/DCTDecode');
    expect((await inspect(bytes)).pageCount).toBe(1);
  });

  it('uses the displayed size: a thumbnail of a big photo becomes tiny', async () => {
    const big = await compress(await pdfWithPhoto(540), { level: 'balanced' });
    const thumb = await compress(await pdfWithPhoto(144), { level: 'balanced' }); // 2 inches
    const [img] = await imageSizes(thumb.bytes);
    expect(img!.w).toBe(300);
    expect(thumb.bytes.byteLength).toBeLessThan(big.bytes.byteLength / 5);
  });

  it('gets smaller with stronger levels', async () => {
    const src = await pdfWithPhoto(540);
    const sizes = [];
    for (const level of ['balanced', 'strong', 'max'] as const) sizes.push((await compress(src, { level })).bytes.byteLength);
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    expect(sizes[1]).toBeGreaterThan(sizes[2]!);
  });

  it('keeps a soft mask (transparency) in step with its image', async () => {
    const doc = await PDFDocument.create();
    const data = new Uint8Array(1600 * 1600 * 4);
    for (let i = 0; i < 1600 * 1600; i++) { data[i * 4] = (i * 7) % 256; data[i * 4 + 1] = (i * 13) % 256; data[i * 4 + 2] = (i * 3) % 256; data[i * 4 + 3] = (i % 1600) % 256; }
    const { encode } = await import('fast-png');
    const png = encode({ width: 1600, height: 1600, data, channels: 4 });
    const img = await doc.embedPng(png);
    doc.addPage([612, 792]).drawImage(img, { x: 156, y: 250, width: 300, height: 300 });
    const { bytes } = await compress(await doc.save(), { level: 'balanced' });
    const out = await PDFDocument.load(bytes);
    const dims: string[] = [];
    for (const [, obj] of out.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
        dims.push(`${obj.dict.get(PDFName.of('Width'))}x${obj.dict.get(PDFName.of('Height'))}`);
      }
    }
    expect(dims).toEqual(['625x625', '625x625']); // image and its mask, both at 150 dpi for 300 pt
  });

  it('never makes a file bigger: text-only PDFs come back unchanged', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText('Solo texto', { x: 50, y: 700, size: 12, font });
    const src = await doc.save();
    const { bytes, report } = await compress(src, { level: 'max' });
    expect(report.level).toBe('none');
    expect(bytes).toBe(src);
  });

  it('compresses uncompressed streams losslessly and drops unreachable objects', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const big = new TextEncoder().encode('0 0 m 100 100 l S\n'.repeat(5000));
    doc.catalog.set(PDFName.of('HilvanaTest'), doc.context.register(doc.context.stream(big, {})));
    doc.context.register(doc.context.stream(big, {})); // orphan: nothing points to it
    const src = await doc.save({ useObjectStreams: false });
    const { bytes, report } = await compress(src, { level: 'lossless' });
    expect(report.level).toBe('lossless');
    expect(bytes.byteLength).toBeLessThan(src.byteLength / 10);
    expect(await optimize(src)).toEqual(bytes);
  });

  it('tries stronger levels until a target size is met, and says so', async () => {
    const src = await pdfWithPhoto(540);
    const strongSize = (await compress(src, { level: 'strong' })).bytes.byteLength;
    const met = await compress(src, { targetBytes: strongSize + 1000 });
    expect(met.report.targetMet).toBe(true);
    expect(met.bytes.byteLength).toBeLessThanOrEqual(strongSize + 1000);
    expect(met.report.settings!.dpi).toBeGreaterThanOrEqual(110); // no stronger than needed
    const impossible = await compress(src, { targetBytes: 500 });
    expect(impossible.report.targetMet).toBe(false);
    expect(impossible.report.level).toBe('max'); // the smallest it could do
  });

  it('keeps text extractable (only images change)', async () => {
    const { bytes } = await compress(await pdfWithPhoto(540, { withText: true }), { level: 'max' });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
    expect(text).toContain('Texto que debe sobrevivir');
  });
});
