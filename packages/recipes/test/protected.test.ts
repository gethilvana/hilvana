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
});
