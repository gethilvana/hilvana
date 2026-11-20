import { describe, expect, it } from 'vitest';
import {
  HilvanaError,
  burst,
  imagesToPdf,
  inspect,
  merge,
  numberPages,
  parsePageRange,
  removePages,
  rotate,
  selectPages,
  split,
  stampImage,
  stampText,
  stripMetadata,
  watermark,
} from '@hilvana/core';
import { TINY_PNG, makePdf } from './helpers.js';

describe('parsePageRange', () => {
  it('parses numbers, ranges and keywords (1-based in, 0-based out)', () => {
    expect(parsePageRange('1,3-4', 5)).toEqual([0, 2, 3]);
    expect(parsePageRange('last', 5)).toEqual([4]);
    expect(parsePageRange('last-1', 5)).toEqual([3]);
    expect(parsePageRange('4-last', 5)).toEqual([3, 4]);
    expect(parsePageRange('odd', 5)).toEqual([0, 2, 4]);
    expect(parsePageRange('even', 5)).toEqual([1, 3]);
    expect(parsePageRange('all', 3)).toEqual([0, 1, 2]);
  });

  it('keeps the given order when asked (for reordering)', () => {
    expect(parsePageRange('3,1-2', 3, true)).toEqual([2, 0, 1]);
  });

  it('rejects pages that do not exist and malformed expressions', () => {
    expect(() => parsePageRange('6', 5)).toThrow(HilvanaError);
    expect(() => parsePageRange('3-1', 5)).toThrow(/INVALID_RANGE/);
    expect(() => parsePageRange('abc', 5)).toThrow(/INVALID_RANGE/);
    expect(() => parsePageRange('', 5)).toThrow(/INVALID_RANGE/);
  });
});

describe('operations', () => {
  it('inspects structure without exposing content', async () => {
    const info = await inspect(await makePdf(3, { title: 'Contrato', author: 'Ana' }));
    expect(info.pageCount).toBe(3);
    expect(info.encrypted).toBe(false);
    expect(info.metadata.title).toBe('Contrato');
    expect(info.hasMetadata).toBe(true);
    expect(info.pages[0]).toMatchObject({ width: 595, height: 842, rotation: 0 });
  });

  it('merges in order', async () => {
    const out = await merge([await makePdf(2), await makePdf(3)]);
    expect((await inspect(out)).pageCount).toBe(5);
  });

  it('does not stamp a pdf-lib producer on merged output', async () => {
    const out = await merge([await makePdf(1)]);
    expect((await inspect(out)).metadata.producer).toBeUndefined();
  });

  it('selects, reorders, removes, splits and bursts pages', async () => {
    const src = await makePdf(5);
    expect((await inspect(await selectPages(src, '5,1'))).pageCount).toBe(2);
    expect((await inspect(await removePages(src, '2-3'))).pageCount).toBe(3);
    const parts = await split(src, ['1-2', '3-last']);
    expect(await Promise.all(parts.map(async (p) => (await inspect(p)).pageCount))).toEqual([2, 3]);
    expect((await burst(src)).length).toBe(5);
  });

  it('refuses to remove every page', async () => {
    await expect(removePages(await makePdf(2), 'all')).rejects.toThrow(/WOULD_REMOVE_ALL_PAGES/);
  });

  it('rotates relative to the current rotation', async () => {
    const once = await rotate(await makePdf(2), 90, '1');
    const twice = await rotate(once, 90, '1');
    const info = await inspect(twice);
    expect(info.pages.map((p) => p.rotation)).toEqual([180, 0]);
  });

  it('stamps text and images without changing page count', async () => {
    const src = await makePdf(2);
    const withText = await stampText(src, { text: '2026-11-19', anchor: 'top-right' });
    const signed = await stampImage(withText, { image: TINY_PNG, width: 120 });
    const marked = await watermark(signed, 'CONFIDENCIAL');
    const numbered = await numberPages(marked, { format: 'Página {n} de {total}' });
    expect((await inspect(numbered)).pageCount).toBe(2);
    expect(numbered.byteLength).toBeGreaterThan(src.byteLength);
  });

  it('rejects images that are not PNG or JPEG', async () => {
    await expect(stampImage(await makePdf(1), { image: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/UNSUPPORTED_IMAGE/);
  });

  it('strips identifying metadata', async () => {
    const clean = await stripMetadata(await makePdf(1, { title: 'Secreto', author: 'Ana' }));
    const info = await inspect(clean);
    expect(info.hasMetadata).toBe(false);
  });

  it('builds a PDF from images', async () => {
    const out = await imagesToPdf([TINY_PNG, TINY_PNG], { pageSize: 'a4' });
    const info = await inspect(out);
    expect(info.pageCount).toBe(2);
    expect(Math.round(info.pages[0]!.width)).toBe(595);
  });

  it('reports invalid input with a stable code', async () => {
    await expect(inspect(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'INVALID_PDF' });
  });
});
