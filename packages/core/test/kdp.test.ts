/** Amazon KDP print interiors: the checks KDP runs, and the corrections Hilvana can make. */
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import { kdpCheck, kdpMargins, kdpPageRange, kdpPrepare, type KdpSpec } from '@hilvana/core';
import { TINY_PNG } from './helpers.js';

const LETTER: KdpSpec = { binding: 'paperback', trim: '8.5x11' };
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

/** A book of `pages` pages of `w`×`h` points, each with a drawing inside the KDP margins. */
async function book(pages: number, w = 612, h = 792, draw?: (p: import('pdf-lib').PDFPage, i: number, doc: PDFDocument) => Promise<void> | void) {
  const doc = await PDFDocument.create({ updateMetadata: false }); // no producer: metadata is tested on its own
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([w, h]);
    p.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(1, 1, 1) }); // white background: not content
    p.drawCircle({ x: w / 2, y: h / 2, size: Math.min(w, h) / 4, borderColor: rgb(0, 0, 0), borderWidth: 2 });
    await draw?.(p, i, doc);
  }
  return doc.save();
}

describe('KDP specifications', () => {
  it('knows the page ranges by binding, trim and ink', () => {
    expect(kdpPageRange(LETTER)).toEqual({ min: 24, max: 590 });
    expect(kdpPageRange({ binding: 'paperback', trim: '6x9' })).toEqual({ min: 24, max: 828 });
    expect(kdpPageRange({ binding: 'paperback', trim: '6x9', ink: 'black-cream' })).toEqual({ min: 24, max: 776 });
    expect(kdpPageRange({ binding: 'paperback', trim: '6x9', ink: 'standard-color' })).toEqual({ min: 72, max: 600 });
    expect(kdpPageRange({ binding: 'paperback', trim: '8.27x11.69', ink: 'standard-color' })).toBeUndefined();
    expect(kdpPageRange({ binding: 'hardcover', trim: '8.25x11' })).toEqual({ min: 75, max: 550 });
    expect(kdpPageRange({ binding: 'hardcover', trim: '8.5x11' })).toBeUndefined();
    expect(kdpPageRange({ binding: 'paperback', trim: '7.2x10' })).toEqual({ min: 24, max: 828 }); // custom size
  });

  it('widens the gutter with the page count', () => {
    expect(kdpMargins(24, false)).toEqual({ inside: 0.375, outside: 0.25, top: 0.25, bottom: 0.25 });
    expect(kdpMargins(151, false).inside).toBe(0.5);
    expect(kdpMargins(400, true)).toEqual({ inside: 0.625, outside: 0.375, top: 0.375, bottom: 0.375 });
    expect(kdpMargins(828, false).inside).toBe(0.875);
  });
});

describe('kdpCheck', () => {
  it('passes a clean 8.5x11 paperback without bleed', async () => {
    const r = await kdpCheck(await book(24), LETTER);
    expect(r).toMatchObject({ ok: true, issues: [], pageCount: 24, pageSize: { width: 8.5, height: 11 } });
  });

  it('expects bleed added to the width and twice to the height', async () => {
    const r = await kdpCheck(await book(24, 8.625 * 72, 11.25 * 72), { ...LETTER, bleed: true });
    expect(codes(r)).toEqual([]);
    expect(codes(await kdpCheck(await book(24), { ...LETTER, bleed: true }))).toContain('KDP_PAGE_SIZE');
  });

  it('reports page count, size, margins, fonts, resolution, annotations, bookmarks and metadata', async () => {
    const bytes = await book(23, 612, 792, async (p, i, doc) => {
      if (i === 0) p.drawText('Titulo', { x: 4, y: 700, size: 20, font: await doc.embedFont(StandardFonts.Helvetica) });
      if (i === 2) p.drawImage(await doc.embedPng(TINY_PNG), { x: 200, y: 200, width: 144, height: 72 });
      if (i === 3) {
        const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 300, 320, 320], Contents: PDFString.of('nota') });
        p.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
      }
      if (i === 0) { doc.setTitle('Mi libro'); doc.catalog.set(PDFName.of('Outlines'), doc.context.register(doc.context.obj({ Type: 'Outlines', Count: 0 }))); }
    });
    const r = await kdpCheck(bytes, LETTER);
    expect(r.ok).toBe(false);
    expect(Object.fromEntries(r.issues.map((i) => [i.code, i.pages ?? i.severity]))).toEqual({
      KDP_PAGE_COUNT_LOW: 'error',
      KDP_PAGE_COUNT_ODD: 'warning',
      KDP_MARGINS: [1],
      KDP_LOW_RESOLUTION: [3],
      KDP_FONTS_NOT_EMBEDDED: [1],
      KDP_ANNOTATIONS: [4],
      KDP_BOOKMARKS: 'error',
      KDP_METADATA: 'warning',
    });
    expect(r.issues.find((i) => i.code === 'KDP_FONTS_NOT_EMBEDDED')!.details).toEqual({ fonts: 'Helvetica' });
  });

  it('checks the gutter on the inside of each page: left on right-hand pages, right on left-hand ones', async () => {
    // A mark 0.3" from the left edge: fine on page 2 (outside margin 0.25"), too close on page 1 (gutter 0.375").
    const bytes = await book(24, 612, 792, (p) => p.drawRectangle({ x: 0.3 * 72, y: 300, width: 10, height: 10, color: rgb(0, 0, 0) }));
    expect((await kdpCheck(bytes, LETTER)).issues.find((i) => i.code === 'KDP_MARGINS')!.pages).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);
  });

  it('with bleed, art may reach the edges but text may not', async () => {
    const W = 8.625 * 72, H = 11.25 * 72;
    const art = await book(24, W, H, (p) => p.drawRectangle({ x: 0, y: 0, width: W, height: 40, color: rgb(0.2, 0.4, 0.8) }));
    expect(codes(await kdpCheck(art, { ...LETTER, bleed: true }))).toEqual([]);
  });

  it('rejects formats KDP does not offer', async () => {
    expect(codes(await kdpCheck(await book(24), { binding: 'hardcover', trim: '8.5x11' }))).toContain('KDP_TRIM_UNSUPPORTED');
    expect(codes(await kdpCheck(await book(80, 6 * 72, 9 * 72), { binding: 'hardcover', trim: '6x9', ink: 'standard-color' }))).toContain('KDP_INK_UNSUPPORTED');
  });
});

describe('kdpPrepare', () => {
  it('fits letter pages to 6x9 without distorting them, evens the page count and cleans the file', async () => {
    const src = await book(25, 612, 792, (p, i, doc) => { if (i === 0) doc.setTitle('Mi libro'); });
    const { bytes, report } = await kdpPrepare(src, { binding: 'paperback', trim: '6x9' });
    expect(report.resized).toHaveLength(25);
    expect(report.added).toBe(1);
    expect(report.metadataRemoved).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(26);
    expect(doc.getPages().every((p) => Math.round(p.getWidth()) === 432 && Math.round(p.getHeight()) === 648)).toBe(true);
    expect((await kdpCheck(bytes, { binding: 'paperback', trim: '6x9' })).ok).toBe(true);
  });

  it('moves or scales content that crosses the margins into the safe area, page by page', async () => {
    const frame = await book(24, 612, 792, (p) => p.drawRectangle({ x: 1, y: 1, width: 610, height: 790, borderColor: rgb(0, 0, 0), borderWidth: 1 }));
    expect(codes(await kdpCheck(frame, LETTER))).toEqual(['KDP_MARGINS']);
    const { bytes, report } = await kdpPrepare(frame, LETTER);
    expect(report.fitted).toHaveLength(24);
    expect(report.fitted[0]!.scale).toBeLessThan(1);
    expect((await kdpCheck(bytes, LETTER)).ok).toBe(true);
  });

  it('adds pages up to the minimum only when asked', async () => {
    expect((await kdpPrepare(await book(10), LETTER)).report.added).toBe(0);
    const { bytes, report } = await kdpPrepare(await book(10), LETTER, { padToMinimum: true });
    expect(report.added).toBe(14);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(24);
  });

  it('removes annotations and bookmarks, and leaves fitting to books without bleed', async () => {
    const src = await book(24, 8.625 * 72, 11.25 * 72, (p, i, doc) => {
      if (i === 0) doc.catalog.set(PDFName.of('Outlines'), doc.context.register(doc.context.obj({ Type: 'Outlines', Count: 0 })));
      p.drawRectangle({ x: 0, y: 0, width: 30, height: 30, color: rgb(0, 0, 0) }); // art in the bleed: meant to be there
    });
    const { report } = await kdpPrepare(src, { ...LETTER, bleed: true });
    expect(report).toMatchObject({ resized: [], fitted: [], bookmarksRemoved: true });
  });
});
