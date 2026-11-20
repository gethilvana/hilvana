import { describe, expect, it } from 'vitest';
import { inspect } from '@hilvana/core';
import { kindOf, plan, run, type WordConverter } from '@hilvana/recipes';
import { TINY_PNG, makePdf } from '../../core/test/helpers.js';
import { sampleContract } from '../../office/test/fixtures.js';

describe('recipes with Word documents', () => {
  it('detects .docx inputs', async () => {
    expect(kindOf(await sampleContract())).toBe('word');
  });

  it('describes a single .docx as a conversion and predicts its pages', async () => {
    const files = [{ name: 'contrato.docx', bytes: await sampleContract() }];
    const p = await plan({ version: 1, steps: [{ op: 'numberPages' }] }, files, 'es');
    expect(p.ok).toBe(true);
    expect(p.steps[0]).toBe('1. Convertir contrato.docx de Word a PDF');
    expect(p.predictedPages?.[0]).toBe(2);
  });

  it('merges Word and PDF in the given order', async () => {
    const files = [
      { name: 'portada.pdf', bytes: await makePdf(1) },
      { name: 'contrato.docx', bytes: await sampleContract() },
      { name: 'firma.png', bytes: TINY_PNG },
    ];
    const recipe = { version: 1, steps: [{ op: 'merge' }, { op: 'sign', image: 'firma.png' }], goals: { pageCount: 3 } };
    const p = await plan(recipe, files, 'en');
    expect(p.steps[0]).toBe('1. Merge every document (PDF and Word) in the order received');
    const res = await run(recipe, files);
    expect(res.allGoalsMet).toBe(true);
    expect((await inspect(res.bytes)).pageCount).toBe(3);
  });

  it('converts each Word file once and surfaces converter warnings in plain language', async () => {
    let calls = 0;
    const real = (await import('@hilvana/office')).wordToPdf;
    const word: WordConverter = async (b) => { calls++; return { ...(await real(b)), warnings: ['TEXTBOX_SKIPPED'] }; };
    const files = [{ name: 'informe.docx', bytes: await sampleContract() }];
    const res = await run({ version: 1, steps: [{ op: 'optimize' }] }, files, { lang: 'es', word });
    expect(calls).toBe(1);
    expect(res.warnings).toEqual(['informe.docx: se omitieron cuadros de texto']);
  });

  it('rejects files that are neither PDF nor Word in merge', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'merge', files: ['firma.png'] }] }, [{ name: 'firma.png', bytes: TINY_PNG }], 'es');
    expect(p.issues[0]).toMatchObject({ code: 'NOT_A_PDF' });
    expect(p.issues[0]!.message).toContain('documento de Word');
  });
});
