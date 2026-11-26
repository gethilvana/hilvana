import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspect } from '@hilvana/core';
import { plan, run } from '@hilvana/recipes';
import { makePdf } from '../../core/test/helpers.js';

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`../../core/test/fixtures/encrypted/${name}`, import.meta.url)));

describe('recipes with protected PDFs', () => {
  it('unlock files with only restrictions on their own, and say the result drops them', async () => {
    const files = [{ name: 'extracto.pdf', bytes: await fixture('permisos-aes256.pdf') }, { name: 'otro.pdf', bytes: await makePdf(1) }];
    const recipe = { version: 1, steps: [{ op: 'merge' }, { op: 'numberPages' }] };
    const p = await plan(recipe, files, 'es');
    expect(p.ok).toBe(true);
    expect(p.predictedPages).toEqual([4, 4]);
    expect(p.warnings).toEqual(['"extracto.pdf" tenía restricciones de uso (por ejemplo, no permitir cambios). El resultado se guarda sin ellas: hazlo solo con documentos que tengas derecho a modificar.']);
    const res = await run(recipe, files);
    expect(res.pageCount).toBe(4);
    expect((await inspect(res.bytes)).encrypted).toBe(false);
  });

  it('explain which file needs a password, without throwing', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'merge' }] }, [{ name: 'privado.pdf', bytes: await fixture('contrasena-aes256.pdf') }], 'en');
    expect(p.ok).toBe(false);
    expect(p.issues).toEqual([{ code: 'PASSWORD_REQUIRED', message: '"privado.pdf": This PDF needs a password to open.' }]);
  });

  it('open a file with the password given for it, and reject a wrong one', async () => {
    const bytes = await fixture('contrasena-aes256.pdf');
    const wrong = await plan({ version: 1, steps: [{ op: 'merge' }] }, [{ name: 'privado.pdf', bytes, password: 'mala' }], 'es');
    expect(wrong.issues[0]).toMatchObject({ code: 'WRONG_PASSWORD' });
    const res = await run({ version: 1, steps: [{ op: 'split' }] }, [{ name: 'privado.pdf', bytes, password: 'abierto' }]);
    expect(res.outputs).toHaveLength(3);
    expect(res.warnings).toEqual(['"privado.pdf" se abrió con su contraseña. El resultado se guarda sin contraseña.']);
  });

  it('the unlock step returns the same document without its protection, keeping its metadata', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const res = await run({ version: 1, steps: [{ op: 'unlock' }], output: { filename: '{name}-desbloqueado' } }, [{ name: 'extracto.pdf', bytes: await fixture('permisos-aes256.pdf') }]);
    expect(res.filename).toBe('extracto-desbloqueado.pdf');
    expect(res.pageCount).toBe(3);
    expect((await inspect(res.bytes)).encrypted).toBe(false);
    const { unlock } = await import('@hilvana/core');
    const before = await PDFDocument.load((await unlock(await fixture('permisos-aes256.pdf'))).bytes);
    const after = await PDFDocument.load(res.bytes);
    expect(after.getTitle()).toBe(before.getTitle());
    expect(after.catalog.keys().map(String).sort()).toEqual(before.catalog.keys().map(String).sort());
  });

  it('the unlock step opens a file that needs a password only with it', async () => {
    const bytes = await fixture('contrasena-aes256.pdf');
    expect((await plan({ version: 1, steps: [{ op: 'unlock' }] }, [{ name: 'privado.pdf', bytes }], 'es')).issues[0]).toMatchObject({ code: 'PASSWORD_REQUIRED' });
    const res = await run({ version: 1, steps: [{ op: 'unlock' }] }, [{ name: 'privado.pdf', bytes, password: 'abierto' }]);
    expect((await inspect(res.bytes)).encrypted).toBe(false);
  });

  it('the unlock step works on exactly one PDF and says when there was nothing to remove', async () => {
    const two = await plan({ version: 1, steps: [{ op: 'unlock' }] }, [{ name: 'a.pdf', bytes: await makePdf(1) }, { name: 'b.pdf', bytes: await makePdf(1) }], 'en');
    expect(two.issues).toEqual([{ code: 'UNLOCK_ONE_PDF', message: 'Removing protection works on one PDF at a time.', step: 1 }]);
    const plain = await plan({ version: 1, steps: [{ op: 'unlock' }, { op: 'numberPages' }] }, [{ name: 'a.pdf', bytes: await makePdf(2) }], 'es');
    expect(plain.ok).toBe(true);
    expect(plain.predictedPages).toEqual([2, 2]);
    expect(plain.warnings).toEqual(['"a.pdf" no tiene contraseña ni restricciones: el resultado es el mismo documento.']);
    expect(plain.destructiveSteps).toEqual([]);
  });

  it('the unlock step must come first', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'rotate', angle: 90 }, { op: 'unlock' }] }, [{ name: 'a.pdf', bytes: await makePdf(1) }], 'en');
    expect(p.issues.map((i) => i.code)).toContain('SOURCE_NOT_FIRST');
  });
});
