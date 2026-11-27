import { describe, expect, it } from 'vitest';
// The agent harness lives in bench/agent (plain ESM); these tests keep its corpus and grader honest.
// @ts-expect-error untyped benchmark module
import { corpus } from '../../../bench/agent/corpus.mjs';
// @ts-expect-error untyped benchmark module
import { grade, parseAnswer } from '../../../bench/agent/grade.mjs';
// @ts-expect-error untyped benchmark module
import { holdout } from '../../../bench/agent/holdout.mjs';
// @ts-expect-error untyped benchmark module
import { referenceAnswer } from '../../../bench/agent/reference.mjs';
// @ts-expect-error untyped benchmark module
import { systemPrompt, userMessage } from '../../../bench/agent/prompt.mjs';

type Case = { id: string; lang: string; category: string; inputs: { name: string }[] };
const get = (id: string) => (corpus as Case[]).find((c) => c.id === id)!;
const R = (steps: object[], extra: { r?: object; e?: object } = {}) => JSON.stringify({ recipe: { version: 1, steps, ...extra.r }, ...extra.e });

describe('agent corpus', () => {
  it('has 150 unique cases in both languages', () => {
    expect(corpus).toHaveLength(150);
    expect(new Set((corpus as Case[]).map((c) => c.id)).size).toBe(150);
    expect((corpus as Case[]).filter((c) => c.lang === 'es').length).toBeGreaterThan(60);
    expect((corpus as Case[]).filter((c) => c.lang === 'en').length).toBeGreaterThan(60);
  });

  it('accepts every reference answer (valid for the engine and graded right)', async () => {
    const failures = [];
    for (const c of corpus as Case[]) {
      const r = await grade(c, referenceAnswer(c));
      if (!r.pass) failures.push(`${c.id}: ${r.reason} ${r.message}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('keeps 40 held-out requests apart from the corpus', async () => {
    expect(holdout).toHaveLength(40);
    const ids = new Set((corpus as Case[]).map((c) => c.id));
    const instructions = new Set((corpus as { instruction: string }[]).map((c) => c.instruction));
    for (const c of holdout as (Case & { instruction: string })[]) {
      expect(ids.has(c.id)).toBe(false);
      expect(instructions.has(c.instruction)).toBe(false);
      const r = await grade(c, referenceAnswer(c));
      expect(r.pass, `${c.id}: ${r.message}`).toBe(true);
    }
  }, 60_000);

  it('never offers the model steps it may not use', () => {
    expect(systemPrompt()).not.toContain('signDigital');
  });

  it('never shows the model anything but names, kinds, pages and sizes', () => {
    const msg = JSON.parse(userMessage(get('unlock-04')));
    expect(Object.keys(msg)).toEqual(['request', 'inputs']);
    expect(JSON.stringify(msg.inputs)).not.toContain('hunter2');
    expect(systemPrompt()).toContain('"passwordOnDevice": true');
  });
});

describe('agent grader', () => {
  const cases: [string, string, boolean][] = [
  ['select-01', R([{ op: 'select', pages: '3,4,5,6,7' }]), true],
  ['select-01', R([{ op: 'select', pages: '3-8' }]), false],
  ['select-01', '```json\n' + R([{ op: 'merge' }, { op: 'select', pages: '3-7' }]) + '\n```', true],
  ['remove-02', R([{ op: 'remove', pages: '12' }]), true],
  ['remove-02', R([{ op: 'select', pages: '1-11' }]), true],
  ['remove-02', R([{ op: 'remove', pages: '1' }]), false],
  ['protect-02', JSON.stringify({ recipe: { version: 1, steps: [{ op: 'protect', password: 'Gato2026!' }] } }), false],
  ['protect-02', JSON.stringify({ recipe: { version: 1, steps: [{ op: 'protect' }] }, passwordOnDevice: true }), true],
  ['protect-02', JSON.stringify({ recipe: { version: 1, steps: [{ op: 'protect', allowPrint: false }] } }), false],
  ['merge-02', R([{ op: 'merge', files: ['contrato.pdf', 'factura.pdf', 'anexo.pdf'] }]), false],
  ['merge-02', R([{ op: 'merge', files: ['anexo.pdf', 'factura.pdf', 'contrato.pdf'] }]), true],
  ['combo-11', R([{ op: 'numberPages' }, { op: 'remove', pages: '1-5' }]), false],
  ['rotate-03', R([{ op: 'rotate', angle: 90, pages: '2,4' }]), false],
  ['rotate-03', R([{ op: 'rotate', angle: -90, pages: '4,2' }]), true],
  ['compress-01', R([{ op: 'compress', targetBytes: 5000000 }]), false],
  ['compress-03', R([{ op: 'compress', level: 'strong' }], { r: { goals: { maxBytes: 2000000 } } }), true],
  ['compress-03', R([{ op: 'compress' }], { r: { goals: { maxBytes: 20000000 } } }), false],
  ['compress-05', R([{ op: 'optimize' }]), true],
  ['select-02', JSON.stringify({ question: '¿cuál?' }), false],
  ['ask-01', JSON.stringify({ question: '¿Cuáles páginas?' }), true],
  ['ask-01', R([{ op: 'remove', pages: '12' }]), false],
  ['combo-15', R([{ op: 'remove', pages: '2-3' }, { op: 'numberPages', pages: '2-last' }]), true],
  ['combo-15', R([{ op: 'numberPages', pages: '2-last' }, { op: 'remove', pages: '2-3' }]), false],
  ['combo-06', R([{ op: 'compress' }, { op: 'remove', pages: '5' }, { op: 'rotate', angle: 90, pages: '2' }]), true],
  ['redact-01', R([{ op: 'redact', terms: ['1.020.345.678'] }]), true],
  ['redact-01', R([{ op: 'redact', terms: ['1020345678'], patterns: ['number'] }]), false],
  ['kdp-01', R([{ op: 'kdpPrepare', binding: 'paperback', trim: '8.5 x 11' }]), true],
  ['kdp-01', R([{ op: 'kdpPrepare', binding: 'hardcover', trim: '8.5x11' }]), false],
  ['combo-14', R([{ op: 'fromImages' }, { op: 'sign', image: 'signature.png' }]), false],
  ['sign-07', R([{ op: 'sign', image: 'firma.png', pages: 'last' }, { op: 'sign', image: 'firma.png', pages: '2' }]), true],
  ['select-03', 'Claro, aquí está: {"recipe": {"version":1,"steps":[{"op":"select","pages":"last"}]}} listo', true],
  ['select-03', '{"recipe": {"version":1,"steps":[{"op":"select","pages":"13"}]}}', false],
  ['unlock-04', R([{ op: 'unlock' }]), true],
  ['merge-03', R([{ op: 'merge' }], { r: { output: { filename: 'Q3-report.pdf' } } }), true],
  ['merge-03', R([{ op: 'merge' }]), false],
];
  it.each(cases)('%s: %s → %s', async (id, text, pass) => {
    expect((await grade(get(id), text)).pass).toBe(pass);
  });

  it('accepts a bare recipe and either answer where the request is ambiguous', async () => {
    expect((await grade(get('compress-05'), JSON.stringify({ version: 1, steps: [{ op: 'optimize' }] }))).pass).toBe(true);
    expect((await grade(get('combo-15'), JSON.stringify({ question: '¿Desde la página 2 o desde el número 2?' }))).pass).toBe(true);
    expect((await grade(get('combo-15'), R([{ op: 'remove', pages: '2-3' }, { op: 'numberPages', pages: '2-last' }]))).pass).toBe(true);
    expect((await grade(get('combo-15'), JSON.stringify({ unsupported: 'no' }))).pass).toBe(false);
  });

  it('reads JSON inside text or a code fence', () => {
    expect(parseAnswer('Here you go:\n```json\n{"question":"¿Cuáles?"}\n```').value).toEqual({ question: '¿Cuáles?' });
    expect(parseAnswer('no json').error).toBeTruthy();
  });

  it('gives a reason when it fails', async () => {
    expect((await grade(get('protect-02'), R([{ op: 'protect', password: 'Gato2026!' }]))).reason).toBe('secret');
    expect((await grade(get('select-03'), R([{ op: 'select', pages: '13' }]))).reason).toBe('invalid');
    expect((await grade(get('select-02'), JSON.stringify({ question: '¿?' }))).reason).toBe('outcome');
    expect((await grade(get('compress-01'), R([{ op: 'compress', targetBytes: 5000000 }]))).reason).toBe('size');
    expect((await grade(get('merge-03'), R([{ op: 'merge' }]))).reason).toBe('output');
    expect((await grade(get('select-01'), '{"recipe":{},"question":"x"}')).reason).toBe('format');
  });
});
