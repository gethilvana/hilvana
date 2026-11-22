/** Recipes that protect the result or sign it with a certificate. Signatures are checked with pdfsig. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspect, signWithCertificate, unlock } from '@hilvana/core';
import { plan, redactRecipe, run } from '@hilvana/recipes';
import { makePdf } from '../../core/test/helpers.js';
import { pdfsig, withPdfsig } from '../../core/test/pdfsig.js';

const fixture = (dir: string, name: string) => new Uint8Array(readFileSync(new URL(`../../core/test/fixtures/${dir}/${name}`, import.meta.url)));
const ana = () => ({ name: 'ana.p12', bytes: fixture('certificates', 'ana.p12'), password: 'clave-ana' });
const luis = () => ({ name: 'luis.p12', bytes: fixture('certificates', 'luis.p12'), password: 'clave-luis' });

describe('protect step', () => {
  it('protects the result with a password, says so, and checks goals by opening it', async () => {
    const recipe = { version: 1, steps: [{ op: 'numberPages' }, { op: 'protect', password: 'secreto' }], goals: { pageCount: 3 } };
    const files = [{ name: 'informe.pdf', bytes: await makePdf(3) }];
    const p = await plan(recipe, files, 'es');
    expect(p.ok).toBe(true);
    expect(p.steps.at(-1)).toBe('3. Proteger con contraseña (AES-256)');
    expect(p.steps.join(' ')).not.toContain('secreto');
    const res = await run(recipe, files);
    expect(res.allGoalsMet).toBe(true);
    expect(res.pageCount).toBe(3);
    expect(res.notes).toContain('Para abrir el resultado se necesita la contraseña. Si la olvidas, no hay forma de recuperarla.');
    await expect(unlock(res.bytes)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    expect((await unlock(res.bytes, 'secreto')).protection).toBe('password');
  });

  it('restricts use without a password', async () => {
    const recipe = { version: 1, steps: [{ op: 'protect', allowCopy: false, allowModify: false }] };
    const files = [{ name: 'a.pdf', bytes: await makePdf(1) }];
    const p = await plan(recipe, files, 'en');
    expect(p.steps.at(-1)).toBe('2. Restrict use: no copying, no changes');
    const res = await run(recipe, files);
    expect((await inspect(res.bytes)).protection).toBe('permissions');
  });

  it('rejects a protect step that protects nothing, or that is not last', async () => {
    const files = [{ name: 'a.pdf', bytes: await makePdf(2) }];
    const empty = await plan({ version: 1, steps: [{ op: 'protect', allowPrint: true }] }, files, 'en');
    expect(empty.issues.map((i) => i.code)).toEqual(['NOTHING_TO_PROTECT']);
    const early = await plan({ version: 1, steps: [{ op: 'protect', password: 'x' }, { op: 'numberPages' }] }, files, 'en');
    expect(early.issues).toEqual([{ code: 'FINAL_NOT_LAST', message: 'Step 1 produces the final file; it can only come last.', step: 1 }]);
    const both = await plan({ version: 1, steps: [{ op: 'split' }, { op: 'protect', password: 'x' }] }, files, 'en');
    expect(both.ok).toBe(false);
  });

  it('redacts the password in a recipe meant to be shown', () => {
    const recipe = { version: 1 as const, steps: [{ op: 'merge' as const }, { op: 'protect' as const, password: 'secreto', allowPrint: false }] };
    expect(JSON.stringify(redactRecipe(recipe))).not.toContain('secreto');
    expect(redactRecipe(recipe).steps[1]).toEqual({ op: 'protect', password: '••••••', allowPrint: false });
    expect(recipe.steps[1]!.password).toBe('secreto');
  });
});

describe('signDigital step', () => {
  withPdfsig('signs the result after other steps, with a visible line, and names the signer', async () => {
    const recipe = { version: 1, steps: [{ op: 'merge', files: ['a.pdf', 'b.pdf'] }, { op: 'signDigital', certificate: 'ana.p12', reason: 'Aprobado' }] };
    const files = [{ name: 'a.pdf', bytes: await makePdf(1) }, { name: 'b.pdf', bytes: await makePdf(2) }, ana()];
    const p = await plan(recipe, files, 'es');
    expect(p.ok).toBe(true);
    expect(p.signer).toMatchObject({ name: 'Ana Prueba', selfSigned: true });
    expect(p.warnings.join(' ')).toContain('autofirmado');
    expect(p.steps.at(-1)).toBe('2. Firmar digitalmente con el certificado "ana.p12"');
    const res = await run(recipe, files);
    expect(res.pageCount).toBe(3);
    expect(res.notes[0]).toMatch(/^Firmado por Ana Prueba \(emitido por Ana Prueba; válido hasta \d{4}-\d{2}-\d{2}\)\.$/);
    expect(pdfsig(res.bytes)).toEqual([{ name: 'Ana Prueba', valid: true, wholeFile: true, type: 'ETSI.CAdES.detached' }]);
  });

  withPdfsig('countersigns a signed PDF in place, so the first signature stays valid', async () => {
    const signed = (await signWithCertificate(await makePdf(2), { certificate: ana().bytes, password: 'clave-ana' })).bytes;
    const recipe = { version: 1, steps: [{ op: 'signDigital', certificate: 'luis.p12' }] };
    const files = [{ name: 'contrato.pdf', bytes: signed }, luis()];
    const p = await plan(recipe, files, 'en');
    expect(p.ok).toBe(true);
    expect(p.warnings.join(' ')).toContain('"contrato.pdf" already has signatures');
    expect(p.warnings.join(' ')).not.toContain('does not keep that signature');
    const res = await run(recipe, files, { lang: 'en' });
    expect(res.notes).toContain('The signature has no visible mark: it shows in the PDF reader\'s signature panel.');
    expect(pdfsig(res.bytes).map((s) => [s.name, s.valid])).toEqual([['Ana Prueba', true], ['Luis Prueba', true]]);
  });

  it('explains a missing or wrong certificate password, and a file that is not a certificate', async () => {
    const doc = { name: 'a.pdf', bytes: await makePdf(1) };
    const recipe = { version: 1, steps: [{ op: 'signDigital', certificate: 'ana.p12' }] };
    const missing = await plan(recipe, [doc, { ...ana(), password: undefined }], 'es');
    expect(missing.issues.map((i) => i.code)).toEqual(['CERTIFICATE_PASSWORD_REQUIRED']);
    const wrong = await plan(recipe, [doc, { ...ana(), password: 'mala' }], 'es');
    expect(wrong.issues).toEqual([{ code: 'WRONG_CERTIFICATE_PASSWORD', message: 'La contraseña no abre el certificado.', step: 1 }]);
    const notCert = await plan({ version: 1, steps: [{ op: 'signDigital', certificate: 'a.pdf' }] }, [doc], 'en');
    expect(notCert.issues.map((i) => i.code)).toEqual(['NOT_A_CERTIFICATE']);
    await expect(run(recipe, [doc, { ...ana(), password: 'mala' }])).rejects.toMatchObject({ issues: [{ code: 'WRONG_CERTIFICATE_PASSWORD' }] });
  });

  it('does not treat the certificate as a document to merge', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'numberPages' }, { op: 'signDigital', certificate: 'ana.p12', visible: false }] }, [{ name: 'a.pdf', bytes: await makePdf(2) }, ana()], 'en');
    expect(p.ok).toBe(true);
    expect(p.predictedPages).toEqual([2, 2, 2]);
  });
});
