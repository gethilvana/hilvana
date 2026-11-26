import { describe, expect, it } from 'vitest';
import { inspect } from '@hilvana/core';
import { RecipeError, plan, run } from '@hilvana/recipes';
import { makePdf } from '../../core/test/helpers.js';

const pdfjsTexts = async (bytes: Uint8Array) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  await task.destroy();
  return out;
};

const inputs = async () => [
  { name: 'a.pdf', bytes: await makePdf(2, { label: 'A' }) },
  { name: 'b.pdf', bytes: await makePdf(3, { label: 'B' }) },
];

describe('split step', () => {
  it('splits into one file per page by default, named by page', async () => {
    const res = await run({ version: 1, steps: [{ op: 'split' }] }, [{ name: 'doc.pdf', bytes: await makePdf(3) }]);
    expect(res.outputs.map((o) => [o.filename, o.pageCount])).toEqual([['doc-hilvana-1.pdf', 1], ['doc-hilvana-2.pdf', 1], ['doc-hilvana-3.pdf', 1]]);
    expect(res.bytes).toBe(res.outputs[0]!.bytes); // single-output callers still get a file
  });

  it('splits by ranges, after other steps, with the right pages in each part', async () => {
    const recipe = { version: 1, steps: [{ op: 'merge' }, { op: 'numberPages', format: 'p{n}' }, { op: 'split', ranges: ['4-last', '1, 3'] }], output: { filename: 'lote' } };
    const p = await plan(recipe, await inputs(), 'es');
    expect(p.ok).toBe(true);
    expect(p.outputCount).toBe(2);
    expect(p.steps.at(-1)).toBe('3. Dividir en 2 archivos: 4-last; 1, 3');
    const res = await run(recipe, await inputs());
    expect(res.outputs.map((o) => o.filename)).toEqual(['lote-4-last.pdf', 'lote-1_3.pdf']);
    expect(await pdfjsTexts(res.outputs[0]!.bytes)).toEqual(['B 2 p4', 'B 3 p5']);
    expect(await pdfjsTexts(res.outputs[1]!.bytes)).toEqual(['A 1 p1', 'B 1 p3']);
  });

  it('predicts one output per page when splitting without ranges', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'remove', pages: '1' }, { op: 'split' }] }, await inputs(), 'en');
    expect(p.outputCount).toBe(4);
    expect(p.steps.at(-1)).toBe('3. Split into one file per page');
  });

  it('only allows split as the last step', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'split' }, { op: 'numberPages' }] }, await inputs(), 'en');
    expect(p.ok).toBe(false);
    expect(p.issues[0]).toMatchObject({ code: 'SPLIT_NOT_LAST', step: 1 });
  });

  it('rejects ranges outside the document before running', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'split', ranges: ['1-2', '9'] }] }, await inputs(), 'en');
    expect(p.ok).toBe(false);
    expect(p.issues[0]).toMatchObject({ code: 'PAGE_OUT_OF_RANGE', step: 1 });
    await expect(run({ version: 1, steps: [{ op: 'split', ranges: ['1-2', '9'] }] }, await inputs())).rejects.toBeInstanceOf(RecipeError);
  });

  it('checks goals on every part', async () => {
    const res = await run({ version: 1, steps: [{ op: 'split', ranges: ['1-2', '3-5'] }], goals: { maxPages: 2 } }, await inputs());
    expect(res.allGoalsMet).toBe(false);
    expect(res.goals.filter((g) => !g.met).map((g) => g.message)).toEqual([expect.stringMatching(/^a-hilvana-3-5\.pdf: /)]);
  });

  it('keeps part names safe even with odd ranges and names', async () => {
    const res = await run({ version: 1, steps: [{ op: 'split', ranges: ['last', 'odd'] }], output: { filename: '../x/{name}' } }, await inputs());
    for (const o of res.outputs) expect(o.filename).toMatch(/^[\w.-]+\.pdf$/);
    expect((await inspect(res.outputs[1]!.bytes)).pageCount).toBe(3);
  });

  it('describes the step in the JSON schema for agents', async () => {
    const { recipeJsonSchema } = await import('@hilvana/recipes');
    expect(JSON.stringify(recipeJsonSchema())).toContain('Last step only: splits the document into several output files.');
  });
});

// Audit 2026-11-24, finding 15: repeated ranges used to produce the same file name twice.
describe('split parts always get distinct names', () => {
  it('numbers repeated ranges and ranges that read the same once cleaned', async () => {
    const { makePdf } = await import('../../core/test/helpers.js');
    const res = await run({ version: 1, steps: [{ op: 'split', ranges: ['1', '1', '1,2', '1, 2', '1', '2'] }] }, [{ name: 'muestra.pdf', bytes: await makePdf(2) }]);
    const names = res.outputs.map((o) => o.filename);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names).toEqual(['muestra-hilvana-1.pdf', 'muestra-hilvana-1 (2).pdf', 'muestra-hilvana-1_2.pdf', 'muestra-hilvana-1_2 (2).pdf', 'muestra-hilvana-1 (3).pdf', 'muestra-hilvana-2.pdf']);
  });
});

