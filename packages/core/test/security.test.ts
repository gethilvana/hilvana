/**
 * Protecting with a password and signing with a certificate. Signatures are checked with pdfsig
 * (Poppler), an independent validator, not with the library that made them.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HilvanaError, countSignatures, inspect, load, protect, readCertificate, signWithCertificate, unlock } from '@hilvana/core';
import { makePdf, makeSignedPdf } from './helpers.js';
import { pdfsig, withPdfsig } from './pdfsig.js';

const cert = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/certificates/${name}`, import.meta.url)));
const encrypted = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/encrypted/${name}`, import.meta.url)));

async function texts(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  await task.destroy();
  return out;
}

describe('certificates', () => {
  it('reads who signs, who issued it and until when', async () => {
    const info = await readCertificate(cert('ana.p12'), 'clave-ana');
    expect(info).toMatchObject({ name: 'Ana Prueba', issuer: 'Ana Prueba', selfSigned: true });
    expect(info.validTo.getUTCFullYear()).toBeGreaterThan(2100);
  });

  it('opens legacy (.pfx) and elliptic-curve certificates', async () => {
    expect((await readCertificate(cert('ana-legacy.pfx'), 'clave-ana')).name).toBe('Ana Prueba');
    expect((await readCertificate(cert('ec.p12'), 'clave-ec')).name).toBe('Firma EC Prueba');
  });

  it('explains a wrong password and a file that is not a certificate', async () => {
    await expect(readCertificate(cert('ana.p12'), 'mala')).rejects.toMatchObject({ code: 'WRONG_CERTIFICATE_PASSWORD' });
    await expect(readCertificate(await makePdf(1), 'x')).rejects.toBeInstanceOf(HilvanaError);
  });
});

describe('signing with a certificate', () => {
  withPdfsig('produces a signature an independent validator accepts, covering the whole file', async () => {
    const res = await signWithCertificate(await makePdf(2), { certificate: cert('ana.p12'), password: 'clave-ana', reason: 'Aprobado', location: 'Bogotá', visible: { text: 'Firmado digitalmente por Ana Prueba' } });
    expect(res).toMatchObject({ visible: true, previousSignatures: 0, signer: { name: 'Ana Prueba' } });
    expect(pdfsig(res.bytes)).toEqual([{ name: 'Ana Prueba', valid: true, wholeFile: true, type: 'ETSI.CAdES.detached' }]);
    const t = await texts(res.bytes);
    expect(t[1]).toContain('Firmado digitalmente por Ana Prueba');
    expect(t[0]).not.toContain('Firmado');
  });

  withPdfsig('adds a second signature without breaking the first, and without drawing on the page', async () => {
    const first = await signWithCertificate(await makePdf(1), { certificate: cert('ana.p12'), password: 'clave-ana', visible: { text: 'Firmado por Ana' } });
    const second = await signWithCertificate(first.bytes, { certificate: cert('luis.p12'), password: 'clave-luis', visible: { text: 'Firmado por Luis' } });
    expect(second).toMatchObject({ visible: false, previousSignatures: 1 });
    const sigs = pdfsig(second.bytes);
    expect(sigs.map((s) => [s.name, s.valid])).toEqual([['Ana Prueba', true], ['Luis Prueba', true]]);
    expect(sigs[1]!.wholeFile).toBe(true);
    expect((await texts(second.bytes))[0]).not.toContain('Luis');
  });

  withPdfsig('signs with legacy and elliptic-curve certificates too', async () => {
    for (const [file, pw, who] of [['ana-legacy.pfx', 'clave-ana', 'Ana Prueba'], ['ec.p12', 'clave-ec', 'Firma EC Prueba']] as const) {
      const res = await signWithCertificate(await makePdf(1), { certificate: cert(file), password: pw, visible: false });
      expect(pdfsig(res.bytes)).toEqual([expect.objectContaining({ name: who, valid: true })]);
    }
  });

  withPdfsig('signs a PDF that only had usage restrictions', async () => {
    const res = await signWithCertificate(encrypted('permisos-aes256.pdf'), { certificate: cert('ana.p12'), password: 'clave-ana', visible: false });
    expect(pdfsig(res.bytes)[0]!.valid).toBe(true);
  });

  /** A document signed after it was protected, like bank statements that are signed and restricted. */
  async function signedProtected(opts: { password?: string; allowModify?: boolean }) {
    const { PDF, P12Signer } = await import('@libpdf/core');
    const prot = await protect(await makePdf(2), { allowCopy: false, ...opts });
    const pdf = await PDF.load(prot, { credentials: opts.password ?? '' });
    return (await pdf.sign({ signer: await P12Signer.create(cert('ana.p12'), 'clave-ana'), level: 'B-B' })).bytes;
  }

  withPdfsig('countersigns a signed, restricted PDF as it is: both signatures and the restrictions stay', async () => {
    const original = await signedProtected({ allowModify: false });
    expect(pdfsig(original).map((x) => x.valid)).toEqual([true]);
    const noise: unknown[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a) => { noise.push(a); });
    try {
      const res = await signWithCertificate(original, { certificate: cert('luis.p12'), password: 'clave-luis' });
      expect(res).toMatchObject({ previousSignatures: 1, protection: 'permissions', visible: false });
      expect(pdfsig(res.bytes).map((x) => [x.name, x.valid])).toEqual([['Ana Prueba', true], ['Luis Prueba', true]]);
      // Nothing is written after the new signature: it covers the whole file.
      expect(pdfsig(res.bytes)[1]!.wholeFile).toBe(true);
      expect((await unlock(res.bytes)).protection).toBe('permissions');
    } finally {
      spy.mockRestore();
    }
    expect(noise).toEqual([]);
  });

  withPdfsig('countersigns a signed PDF that needs a password, only with that password, and keeps it', async () => {
    const original = await signedProtected({ password: 'abierto' });
    await expect(signWithCertificate(original, { certificate: cert('luis.p12'), password: 'clave-luis' })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    const res = await signWithCertificate(original, { certificate: cert('luis.p12'), password: 'clave-luis', openPassword: 'abierto' });
    expect(res.protection).toBe('password');
    await expect(unlock(res.bytes)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    expect(pdfsig(res.bytes, 'abierto').map((x) => [x.name, x.valid])).toEqual([['Ana Prueba', true], ['Luis Prueba', true]]);
  });

  it('refuses expired and not-yet-valid certificates, before touching the document', async () => {
    const pdf = await makePdf(1);
    await expect(signWithCertificate(pdf, { certificate: cert('ana.p12'), password: 'clave-ana', now: new Date('2200-01-01') })).rejects.toMatchObject({ code: 'CERTIFICATE_EXPIRED' });
    await expect(signWithCertificate(pdf, { certificate: cert('ana.p12'), password: 'clave-ana', now: new Date('2000-01-01') })).rejects.toMatchObject({ code: 'CERTIFICATE_NOT_YET_VALID' });
  });

  it('keeps the signing time it was given', async () => {
    const when = new Date('2030-05-04T10:00:00Z');
    const res = await signWithCertificate(await makePdf(1), { certificate: cert('ana.p12'), password: 'clave-ana', visible: false, now: when });
    expect(new TextDecoder('latin1').decode(res.bytes)).toContain('D:20300504');
  });
});

describe('protecting with a password', () => {
  it('the result needs the password to open, and keeps every word', async () => {
    const original = await makePdf(2, { label: 'Secreto' });
    const locked = await protect(original, { password: 'abrir' });
    await expect(unlock(locked)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    await expect(inspect(locked)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    const opened = await unlock(locked, 'abrir');
    expect(opened.protection).toBe('password');
    expect(await texts(opened.bytes)).toEqual(await texts(original));
    expect(new TextDecoder('latin1').decode(locked)).toMatch(/\/V 5|\/R 6/); // AES-256 (PDF 2.0 handler)
  });

  it('restrictions without a password: opens freely, and readers get the restrictions', async () => {
    const locked = await protect(await makePdf(1), { allowCopy: false, allowModify: false });
    expect((await unlock(locked)).protection).toBe('permissions');
    const { PDF } = await import('@libpdf/core');
    const perms = (await PDF.load(locked)).getPermissions();
    expect(perms).toMatchObject({ copy: false, modify: false, print: true, accessibility: true });
  });

  it('refuses to "protect" with nothing to protect', async () => {
    await expect(protect(await makePdf(1), {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('never leaves a broken signature inside the encrypted result', async () => {
    const locked = await protect(await makeSignedPdf(1), { password: 'abrir' });
    expect(countSignatures(await load((await unlock(locked, 'abrir')).bytes))).toBe(0);
  });
});
