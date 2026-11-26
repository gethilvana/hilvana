/** Amazon KDP in recipes: the kdpPrepare step and the kdp goal. */
import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { plan, run } from '@hilvana/recipes';

async function book(pages: number, w = 612, h = 792) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < pages; i++) doc.addPage([w, h]).drawRectangle({ x: 2, y: 2, width: w - 4, height: h - 4, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  return doc.save();
}
const prepare = { op: 'kdpPrepare', binding: 'paperback', trim: '8.5x11' } as const;

describe('KDP in recipes', () => {
  it('plans kdpPrepare as destructive and predicts an even page count', async () => {
    const p = await plan({ version: 1, steps: [prepare] }, [{ name: 'libro.pdf', bytes: await book(25) }], 'es');
    expect(p.ok).toBe(true);
    expect(p.destructiveSteps).toEqual([1]);
    expect(p.predictedPages).toEqual([25, 26]);
    expect(p.steps[1]).toMatch(/Preparar el interior para KDP \(tapa blanda 8.5x11" sin sangrado\)/);
  });

  it('refuses formats KDP does not offer, before running', async () => {
    const p = await plan({ version: 1, steps: [{ ...prepare, binding: 'hardcover' }] }, [{ name: 'libro.pdf', bytes: await book(80) }], 'en');
    expect(p.issues).toEqual([{ code: 'KDP_UNSUPPORTED', message: 'KDP does not print 8.5x11" hardcover books with black ink on white paper.', step: 1 }]);
  });

  it('prepares the interior, says what it changed, and checks the result as a goal', async () => {
    const res = await run({ version: 1, steps: [prepare] }, [{ name: 'libro.pdf', bytes: await book(25) }], { confirmed: true, lang: 'es' });
    expect(res.pageCount).toBe(26);
    expect(res.notes.join(' ')).toMatch(/dentro de los márgenes/);
    expect(res.notes).toContain('Se agregó una página en blanco al final.');
    expect(res.goals.map((g) => g.message)).toEqual(['✓ Cumple los requisitos de KDP para tapa blanda 8.5x11" sin sangrado']);
    expect(res.allGoalsMet).toBe(true);
    expect(res.kdp?.ok).toBe(true);
  });

  it('as a goal alone, reports every problem with its pages', async () => {
    const res = await run({ version: 1, steps: [{ op: 'merge' }], goals: { kdp: { binding: 'paperback', trim: '6x9' } } }, [{ name: 'libro.pdf', bytes: await book(23) }], { lang: 'en' });
    expect(res.allGoalsMet).toBe(false);
    expect(res.goals.map((g) => g.message)).toEqual([
      '✗ It has 23 pages and KDP needs at least 24. kdpPrepare can add blank pages (padToMinimum, or --fix --pad in the CLI).',
      '⚠ It has 23 pages: KDP adds a blank one at the end to make them even.',
      '✗ Pages 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12… (23): the page size must be 6 × 9". The kdpPrepare step (or --fix in the CLI) fits them.',
    ]);
  });
});
