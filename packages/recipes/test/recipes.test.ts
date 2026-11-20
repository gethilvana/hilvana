import { describe, expect, it } from 'vitest';
import { inspect } from '@hilvana/core';
import { RecipeError, plan, recipeJsonSchema, run } from '@hilvana/recipes';
import { TINY_PNG, makePdf } from '../../core/test/helpers.js';

const files = async () => [
  { name: 'factura-1.pdf', bytes: await makePdf(2, { author: 'Contabilidad' }) },
  { name: 'factura-2.pdf', bytes: await makePdf(3) },
  { name: 'firma.png', bytes: TINY_PNG },
];

describe('plan', () => {
  it('describes a valid recipe in Spanish and English without running it', async () => {
    const recipe = { version: 1, steps: [{ op: 'sign', image: 'firma.png' }], goals: { pageCount: 5 } };
    const es = await plan(recipe, await files(), 'es');
    expect(es.ok).toBe(true);
    expect(es.steps[0]).toMatch(/Unir todos los PDF/); // implicit merge is shown
    expect(es.steps[1]).toMatch(/Firmar con "firma.png"/);
    expect(es.goals[0]).toMatch(/exactamente 5 páginas/);
    const en = await plan(recipe, await files(), 'en');
    expect(en.steps[1]).toMatch(/Sign with "firma.png" on the last page/);
  });

  it('rejects unknown fields and operations (schema)', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'explode' }] }, await files(), 'en');
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.code).toBe('SCHEMA');
  });

  it('catches page ranges that will not exist after earlier steps', async () => {
    const recipe = { version: 1, steps: [{ op: 'merge' }, { op: 'select', pages: '1-2' }, { op: 'stampText', text: 'x', pages: '3' }] };
    const p = await plan(recipe, await files(), 'es');
    expect(p.ok).toBe(false);
    expect(p.issues[0]).toMatchObject({ code: 'PAGE_OUT_OF_RANGE', step: 3 });
    expect(p.predictedPages).toEqual([5, 2, 2]);
  });

  it('catches references to missing or wrong-kind files', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'merge', files: ['nope.pdf', 'firma.png'] }, { op: 'sign', image: 'factura-1.pdf' }] }, await files(), 'en');
    expect(p.issues.map((i) => i.code)).toEqual(['UNKNOWN_INPUT', 'NOT_A_PDF', 'NOT_AN_IMAGE']);
  });

  it('flags destructive steps', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'merge' }, { op: 'remove', pages: '1' }, { op: 'stripMetadata' }] }, await files());
    expect(p.destructiveSteps).toEqual([2, 3]);
  });

  it('exports a JSON Schema for agents', () => {
    const schema = recipeJsonSchema() as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('steps');
  });
});

describe('run', () => {
  it('runs a full chain and verifies goals', async () => {
    const recipe = {
      version: 1,
      name: 'Expediente',
      steps: [
        { op: 'merge', files: ['factura-2.pdf', 'factura-1.pdf'] },
        { op: 'stampText', text: 'Recibido {date}', pages: '1', anchor: 'top-right' },
        { op: 'numberPages', format: '{n}/{total}' },
        { op: 'sign', image: 'firma.png' },
        { op: 'stripMetadata' },
      ],
      output: { filename: 'expediente-{date}' },
      goals: { pageCount: 5, maxBytes: 5_000_000, noMetadata: true },
    };
    const res = await run(recipe, await files(), { confirmed: true });
    expect(res.pageCount).toBe(5);
    expect(res.allGoalsMet).toBe(true);
    expect(res.filename).toMatch(/^expediente-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect((await inspect(res.bytes)).hasMetadata).toBe(false);
  });

  it('refuses destructive recipes without confirmation', async () => {
    const recipe = { version: 1, steps: [{ op: 'remove', pages: '1' }] };
    await expect(run(recipe, await files())).rejects.toBeInstanceOf(RecipeError);
    await expect(run(recipe, await files())).rejects.toMatchObject({ issues: [{ code: 'CONFIRMATION_REQUIRED' }] });
    const res = await run(recipe, await files(), { confirmed: true });
    expect(res.pageCount).toBe(4);
  });

  it('reports unmet goals honestly instead of failing silently', async () => {
    const res = await run({ version: 1, steps: [{ op: 'optimize' }], goals: { maxBytes: 10 } }, await files(), { lang: 'en' });
    expect(res.allGoalsMet).toBe(false);
    expect(res.goals[0]!.message).toMatch(/^✗ Is at most 10 B/);
  });

  it('never mutates the input bytes', async () => {
    const input = await files();
    const before = input.map((f) => Buffer.from(f.bytes).toString('base64'));
    await run({ version: 1, steps: [{ op: 'rotate', angle: 90 }] }, input);
    expect(input.map((f) => Buffer.from(f.bytes).toString('base64'))).toEqual(before);
  });

  it('builds a PDF from images', async () => {
    const res = await run({ version: 1, steps: [{ op: 'fromImages', pageSize: 'letter' }] }, await files());
    expect(res.pageCount).toBe(1);
  });
});
