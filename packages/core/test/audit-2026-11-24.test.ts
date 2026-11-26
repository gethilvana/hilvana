/** Regressions for the findings of qa/pdf-generator-audit-2026-11-24.md (see docs/qa/auditoria-2026-11-24.md). */
import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { PDFDocument, PDFName } from 'pdf-lib';
import { HilvanaError, imagesToPdf, inspect, jpegOrientation, stripMetadata } from '@hilvana/core';
import { makePdf } from './helpers.js';

/** A JPEG `w`×`h`, left half red and right half blue, with an EXIF orientation tag. */
function photo(w: number, h: number, orientation?: number): Uint8Array {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = x < w / 2 ? 255 : 0; data[i + 2] = x < w / 2 ? 0 : 255; data[i + 3] = 255;
  }
  const jpg = new Uint8Array(jpeg.encode({ data, width: w, height: h }, 90).data);
  if (!orientation) return jpg;
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload, ...jpg.slice(2)]);
}
const size = async (bytes: Uint8Array) => (await inspect(bytes)).pages.map((p) => [Math.round(p.width), Math.round(p.height)]);

describe('audit 2026-11-24 · images to PDF (findings 13 and 16)', () => {
  it('gives landscape images a landscape A4 or Letter page, and portrait ones a portrait page', async () => {
    expect(await size(await imagesToPdf([photo(400, 200), photo(200, 400)], { pageSize: 'a4' }))).toEqual([[842, 595], [595, 842]]);
    expect(await size(await imagesToPdf([photo(400, 200)], { pageSize: 'letter' }))).toEqual([[792, 612]]);
  });

  it('reads the EXIF orientation and turns sideways photos as phones show them', async () => {
    for (const o of [1, 3, 6, 8]) expect(jpegOrientation(photo(40, 20, o))).toBe(o);
    expect(jpegOrientation(photo(40, 20))).toBeUndefined();
    // Orientation 6 and 8 swap width and height; 1 and 3 keep them.
    expect(await size(await imagesToPdf([photo(40, 20, 1), photo(40, 20, 3), photo(40, 20, 6), photo(40, 20, 8)]))).toEqual([[40, 20], [40, 20], [20, 40], [20, 40]]);
    // A sideways landscape photo is shown portrait, so it gets a portrait A4 page.
    expect(await size(await imagesToPdf([photo(400, 200, 6)], { pageSize: 'a4' }))).toEqual([[595, 842]]);
  });

  it('reports a damaged image as UNSUPPORTED_IMAGE, not a raw parser error', async () => {
    const png = await (await PDFDocument.create()).embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8Dwn4EBAAj+Af9IxWaQAAAAAElFTkSuQmCC', 'base64')).then(() => 'ok');
    expect(png).toBe('ok');
    const truncated = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjd', 'base64'));
    const err = await imagesToPdf([truncated]).catch((e) => e);
    expect(err).toBeInstanceOf(HilvanaError);
    expect(err.code).toBe('UNSUPPORTED_IMAGE');
  });
});

describe('audit 2026-11-24 · XMP metadata anywhere in the file (finding 6)', () => {
  async function withPageXmp(): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await makePdf(2));
    const xmp = (who: string) => doc.context.register(doc.context.flateStream(`<x:xmpmeta><dc:creator>${who}</dc:creator></x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' }));
    doc.getPage(0).node.set(PDFName.of('Metadata'), xmp('Ana Perez'));
    doc.catalog.set(PDFName.of('Metadata'), xmp('Ana Perez'));
    return doc.save();
  }

  it('inspect counts XMP on pages and the document as metadata', async () => {
    const info = await inspect(await withPageXmp());
    expect(info.xmpStreams).toBe(2);
    expect(info.hasMetadata).toBe(true);
  });

  it('stripMetadata removes every XMP stream, not only the document one', async () => {
    const out = await stripMetadata(await withPageXmp());
    const info = await inspect(out);
    expect(info).toMatchObject({ xmpStreams: 0, hasMetadata: false });
    expect((await PDFDocument.load(out)).getPage(0).node.get(PDFName.of('Metadata'))).toBeUndefined();
  });
});
