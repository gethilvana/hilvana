import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { HilvanaError, inspect, merge, parsePageRange, removePages, rotate, selectPages } from '@hilvana/core';

/** PDF whose page i (1-based) has a MediaBox width of 100 + i, so page identity survives every operation. */
async function labeled(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) doc.addPage([100 + i, 200]).drawText(String(i), { x: 10, y: 10, size: 8, font });
  return doc.save();
}
const ids = async (b: Uint8Array) => (await inspect(b)).pages.map((p) => p.width - 100);

/** Generates valid range expressions for a document of n pages, with the pages they denote. */
const rangeFor = (n: number) => fc.array(
  fc.oneof(
    fc.integer({ min: 1, max: n }).map((p) => ({ expr: String(p), pages: [p] })),
    fc.tuple(fc.integer({ min: 1, max: n }), fc.integer({ min: 1, max: n })).map(([a, b]) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { expr: `${lo}-${hi}`, pages: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) };
    }),
    fc.constant({ expr: 'last', pages: [n] }),
    fc.integer({ min: 0, max: n - 1 }).map((k) => ({ expr: `last-${k}`, pages: [n - k] })),
    fc.integer({ min: 1, max: n }).map((a) => ({ expr: `${a}-last`, pages: Array.from({ length: n - a + 1 }, (_, k) => a + k) })),
    fc.constant({ expr: 'odd', pages: Array.from({ length: n }, (_, k) => k + 1).filter((p) => p % 2 === 1) }),
    fc.constant({ expr: 'even', pages: Array.from({ length: n }, (_, k) => k + 1).filter((p) => p % 2 === 0) }),
    fc.constant({ expr: 'all', pages: Array.from({ length: n }, (_, k) => k + 1) }),
  ),
  { minLength: 1, maxLength: 5 },
).filter((parts) => parts.some((p) => p.pages.length > 0));

describe('page ranges (property-based)', () => {
  it('parse to exactly the pages they denote, in order when asked', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 60 }).chain((n) => fc.tuple(fc.constant(n), rangeFor(n))), ([n, parts]) => {
      const expr = parts.map((p) => p.expr).join(',');
      const expected = parts.flatMap((p) => p.pages);
      expect(parsePageRange(expr, n, true).map((i) => i + 1)).toEqual(expected);
      expect(parsePageRange(expr, n).map((i) => i + 1)).toEqual([...new Set(expected)].sort((a, b) => a - b));
    }), { numRuns: 2000 });
  });

  it('never accept a page outside the document, and fail with a stable code', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 40 }), (n, extra) => {
      expect(() => parsePageRange(String(n + extra), n)).toThrow(HilvanaError);
      expect(() => parsePageRange(`1-${n + extra}`, n)).toThrow(/PAGE_OUT_OF_RANGE/);
      expect(() => parsePageRange(`last-${n}`, n)).toThrow(HilvanaError);
    }), { numRuns: 500 });
  });

  it('reject arbitrary garbage without crashing', () => {
    fc.assert(fc.property(fc.string({ maxLength: 20 }), (s) => {
      try { parsePageRange(s, 10); } catch (e) { expect(e).toBeInstanceOf(HilvanaError); }
    }), { numRuns: 3000 });
  });
});

describe('page operations (property-based)', { timeout: 120_000 }, () => {
  it('select keeps exactly the chosen pages in order; remove keeps the complement', async () => {
    const n = 12;
    const src = await labeled(n);
    await fc.assert(fc.asyncProperty(rangeFor(n), async (parts) => {
      const expr = parts.map((p) => p.expr).join(',');
      expect(await ids(await selectPages(src, expr))).toEqual(parts.flatMap((p) => p.pages));
      const chosen = new Set(parts.flatMap((p) => p.pages));
      const rest = Array.from({ length: n }, (_, k) => k + 1).filter((p) => !chosen.has(p));
      if (rest.length === 0) await expect(removePages(src, expr)).rejects.toThrow(/WOULD_REMOVE_ALL_PAGES/);
      else expect(await ids(await removePages(src, expr))).toEqual(rest);
    }), { numRuns: 60 });
  });

  it('merge concatenates in order; rotating four times is the identity', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 4 }), async (sizes) => {
      const docs = await Promise.all(sizes.map(labeled));
      const merged = await merge(docs);
      expect(await ids(merged)).toEqual(sizes.flatMap((s) => Array.from({ length: s }, (_, k) => k + 1)));
      let r = merged;
      for (let i = 0; i < 4; i++) r = await rotate(r, 90);
      expect((await inspect(r)).pages.map((p) => p.rotation)).toEqual((await inspect(merged)).pages.map((p) => p.rotation));
    }), { numRuns: 25 });
  });
});
