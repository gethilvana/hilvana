import { describe, expect, it } from 'vitest';
import { inspect } from '@hilvana/core';
import { planBatch, runBatch } from '@hilvana/recipes';
import { TINY_PNG, makePdf } from '../../core/test/helpers.js';
import { sampleContract } from '../../office/test/fixtures.js';

describe('batches: one recipe, each document separately', () => {
  it('plans once per document and predicts every output', async () => {
    const recipe = { version: 1, steps: [{ op: 'numberPages' }, { op: 'split' }] };
    const p = await planBatch(recipe, [{ name: 'a.pdf', bytes: await makePdf(2) }, { name: 'b.pdf', bytes: await makePdf(3) }], { lang: 'en' });
    expect(p.ok).toBe(true);
    expect(p.items.map((i) => i.input)).toEqual(['a.pdf', 'b.pdf']);
    expect(p.outputCount).toBe(5);
    expect(p.steps).toEqual(['1. Merge every PDF in the order received', '2. Number the pages', '3. Split into one file per page']);
  });

  it('runs each PDF and Word file, sharing the other inputs', async () => {
    const recipe = { version: 1, steps: [{ op: 'sign', image: 'firma.png' }], output: { filename: '{name}-firmado' } };
    const files = [{ name: 'a.pdf', bytes: await makePdf(2) }, { name: 'contrato.docx', bytes: await sampleContract() }, { name: 'firma.png', bytes: TINY_PNG }];
    const res = await runBatch(recipe, files);
    expect(res.succeeded).toBe(2);
    expect(res.outputs.map((o) => [o.filename, o.pageCount])).toEqual([['a-firmado.pdf', 2], ['contrato-firmado.pdf', 2]]);
  });

  it('keeps going when one document fails, and says which one', async () => {
    const recipe = { version: 1, steps: [{ op: 'remove', pages: '3' }] };
    const files = [{ name: 'corto.pdf', bytes: await makePdf(2) }, { name: 'largo.pdf', bytes: await makePdf(4) }];
    const p = await planBatch(recipe, files, { lang: 'es' });
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.message).toMatch(/^"corto\.pdf": /);
    const res = await runBatch(recipe, files, { confirmed: true });
    expect(res).toMatchObject({ succeeded: 1, failed: 1 });
    expect(res.items[0]!.issues![0]!.message).toMatch(/^"corto\.pdf": /);
    expect((await inspect(res.outputs[0]!.bytes)).pageCount).toBe(3);
  });

  it('makes output names unique, and asks for confirmation like a single run', async () => {
    const files = [{ name: 'a.pdf', bytes: await makePdf(1) }, { name: 'a.docx', bytes: await sampleContract() }];
    const res = await runBatch({ version: 1, steps: [{ op: 'numberPages' }] }, files);
    expect(res.outputs.map((o) => o.filename)).toEqual(['a-hilvana.pdf', 'a-hilvana (2).pdf']);
    await expect(runBatch({ version: 1, steps: [{ op: 'stripMetadata' }] }, files)).rejects.toMatchObject({ issues: [{ code: 'CONFIRMATION_REQUIRED' }] });
  });

  it('refuses recipes that name documents or build from images', async () => {
    const files = [{ name: 'a.pdf', bytes: await makePdf(1) }];
    const named = await planBatch({ version: 1, steps: [{ op: 'merge', files: ['a.pdf'] }] }, files, { lang: 'en' });
    expect(named.issues.map((i) => i.code)).toEqual(['BATCH_NAMED_FILES']);
    await expect(runBatch({ version: 1, steps: [{ op: 'fromImages' }] }, files)).rejects.toMatchObject({ issues: [{ code: 'BATCH_FROM_IMAGES' }] });
    expect((await planBatch({ version: 1, steps: [] }, files)).issues[0]!.code).toBe('SCHEMA');
  });
});
