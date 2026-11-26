/** Protected PDFs: unlocked locally, with the password only when the file needs one. */
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { HilvanaError, compress, inspect, load, merge, removeProtection, stampText, unlock } from '@hilvana/core';

const dir = new URL('./fixtures/encrypted/', import.meta.url);
const read = async (name: string) => new Uint8Array(await readFile(new URL(name, dir)));
const original = async () => new Uint8Array(await readFile(new URL('../../web/e2e/fixtures/factura-noviembre.pdf', import.meta.url)));

async function texts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  await task.destroy();
  return out;
}

describe('unlock', () => {
  it('leaves unencrypted files untouched, without loading the decryption library', async () => {
    const bytes = await original();
    const res = await unlock(bytes);
    expect(res.protection).toBe('none');
    expect(res.bytes).toBe(bytes);
  });

  it.each(['permisos-aes256.pdf', 'permisos-aes128.pdf', 'permisos-rc4-128.pdf', 'permisos-rc4-40.pdf', 'permisos-aes256-objstm.pdf'])(
    'opens %s without a password, with every page and word intact', async (name) => {
      const res = await unlock(await read(name));
      expect(res.protection).toBe('permissions');
      expect((await PDFDocument.load(res.bytes)).isEncrypted).toBe(false);
      expect(await texts(res.bytes)).toEqual(await texts(await original()));
    },
  );

  it.each(['contrasena-aes256.pdf', 'contrasena-rc4-128.pdf'])('%s: asks for the password, rejects a wrong one, opens with the right one', async (name) => {
    const bytes = await read(name);
    await expect(unlock(bytes)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    await expect(unlock(bytes, 'mala')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    const res = await unlock(bytes, 'abierto');
    expect(res.protection).toBe('password');
    expect(await texts(res.bytes)).toEqual(await texts(await original()));
  });

  it('the owner password also opens a password-protected file', async () => {
    expect((await unlock(await read('contrasena-aes256.pdf'), 'dueno')).protection).toBe('password');
  });

  it('reports a file with only restrictions as such even when a password is given', async () => {
    expect((await unlock(await read('permisos-aes256.pdf'), 'cualquiera')).protection).toBe('permissions');
  });
});

describe('protected files in every operation', () => {
  it('inspect reads files with restrictions and says how they were protected', async () => {
    const info = await inspect(await read('permisos-aes256.pdf'));
    expect(info).toMatchObject({ pageCount: 3, encrypted: true, protection: 'permissions' });
    expect((await inspect(await original())).protection).toBe('none');
  });

  it('operations work on files with restrictions, and results are not encrypted', async () => {
    const locked = await read('permisos-aes256.pdf');
    for (const out of [await merge([locked, await original()]), await stampText(locked, { text: 'Recibido' }), (await compress(locked, { level: 'lossless' })).bytes]) {
      const info = await inspect(out);
      expect(info.encrypted).toBe(false);
    }
    expect((await inspect(await merge([locked, await original()]))).pageCount).toBe(6);
  });

  it('operations on a file that needs a password fail with PASSWORD_REQUIRED, not "invalid"', async () => {
    const err = await load(await read('contrasena-aes256.pdf')).catch((e) => e);
    expect(err).toBeInstanceOf(HilvanaError);
    expect(err.code).toBe('PASSWORD_REQUIRED');
  });

  it('unsupported protection schemes (e.g. certificates) are reported as ENCRYPTED', async () => {
    await expect(unlock(await read('certificado-no-soportado.pdf'))).rejects.toMatchObject({ code: 'ENCRYPTED' });
    await expect(inspect(await read('certificado-no-soportado.pdf'))).rejects.toMatchObject({ code: 'ENCRYPTED' });
  });

  it('a file that only mentions /Encrypt in its content is not treated as encrypted', async () => {
    const { PDFDocument: D, StandardFonts } = await import('pdf-lib');
    const doc = await D.create();
    doc.addPage().drawText('See /Encrypt in the PDF spec', { font: await doc.embedFont(StandardFonts.Helvetica), x: 50, y: 700 });
    // A name object written in plain text, so the bytes really contain "/Encrypt" outside a trailer.
    doc.catalog.set((await import('pdf-lib')).PDFName.of('Note'), (await import('pdf-lib')).PDFName.of('Encrypt'));
    const bytes = await doc.save({ useObjectStreams: false });
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/Encrypt');
    const res = await unlock(bytes);
    expect(res.protection).toBe('none');
  });

  it('every fixture is described in the README', async () => {
    const readme = await readFile(new URL('README.md', dir), 'utf8');
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.pdf'))) expect(readme).toContain(f);
  });
});

describe('removeProtection', () => {
  it('returns the document without restrictions, with every page, word and catalog entry', async () => {
    const locked = await read('permisos-aes256.pdf');
    const res = await removeProtection(locked);
    expect(res.protection).toBe('permissions');
    expect((await PDFDocument.load(res.bytes)).isEncrypted).toBe(false);
    expect(await texts(res.bytes)).toEqual(await texts(await original()));
    const keys = async (b: Uint8Array) => (await PDFDocument.load(b)).catalog.keys().map(String).sort();
    expect(await keys(res.bytes)).toEqual(await keys((await unlock(locked)).bytes));
  });

  it('opens a file that needs a password only with it', async () => {
    const bytes = await read('contrasena-aes256.pdf');
    await expect(removeProtection(bytes)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    await expect(removeProtection(bytes, 'mala')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    const res = await removeProtection(bytes, 'abierto');
    expect(res.protection).toBe('password');
    expect((await inspect(res.bytes)).encrypted).toBe(false);
  });

  it('says when a file had no protection', async () => {
    const res = await removeProtection(await original());
    expect(res.protection).toBe('none');
    expect((await inspect(res.bytes)).pageCount).toBe(3);
  });
});
