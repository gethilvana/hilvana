import { test, expect } from './test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect, signWithCertificate, unlock } from '@hilvana/core';
import { addFiles, fx, open, pageTexts, recipe, runTool } from './helpers';

const certificate = (name: string) => fileURLToPath(new URL(`../../core/test/fixtures/certificates/${name}`, import.meta.url));

let hasPdfsig = true;
try { execFileSync('pdfsig', ['-v'], { stdio: 'ignore' }); } catch { hasPdfsig = false; }

async function pdfsig(bytes: Uint8Array) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'hilvana-e2e-')), 'doc.pdf');
  await writeFile(file, bytes);
  let out = '';
  try { out = execFileSync('pdfsig', [file], { encoding: 'utf8' }); } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
  return out.split(/Signature #\d+:/).slice(1).map((b) => [/Common Name: (.+)/.exec(b)?.[1]?.trim(), /Signature is Valid/.test(b)]);
}

async function downloadBytes(page: import('@playwright/test').Page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.result .output .btn').first().click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile((await dl.path())!)) };
}

async function openCertificate(page: import('@playwright/test').Page, file: string, password: string) {
  await page.locator('.security input[type=file]').setInputFiles(certificate(file));
  await page.getByLabel('Contraseña del certificado').fill(password);
  await page.getByRole('button', { name: 'Abrir certificado' }).click();
}

test('signs with a certificate, showing who signs first, without the secret leaving the page', async ({ page }) => {
  const net = await open(page, 'certify');
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
  await expect(page.locator('.blocker')).toHaveText('Elige tu certificado y ábrelo con su contraseña.');

  await openCertificate(page, 'ana.p12', 'mala');
  await expect(page.locator('.security .file-error')).toHaveText('La contraseña no abre el certificado.');
  await page.getByLabel('Contraseña del certificado').fill('clave-ana');
  await page.getByRole('button', { name: 'Abrir certificado' }).click();
  await expect(page.locator('.cert-card')).toContainText('Ana Prueba');
  await expect(page.locator('.cert-card')).toContainText('autofirmado');

  await page.getByLabel('Motivo (opcional)').fill('Aprobado');
  await runTool(page);
  const out = await downloadBytes(page);
  expect(out.name).toBe('factura-octubre-firmado-digital.pdf');
  expect((await inspect(out.bytes)).signatures).toBe(1);
  expect((await pageTexts(out.bytes)).at(-1)).toMatch(/Firmado digitalmente por Ana Prueba · \d{4}-\d{2}-\d{2}/);
  if (hasPdfsig) expect(await pdfsig(out.bytes)).toEqual([['Ana Prueba', true]]);
  await expect(page.locator('.result .notes').first()).toContainText('Firmado por Ana Prueba');

  const r = await recipe(page);
  expect(r.steps).toEqual([{ op: 'signDigital', certificate: 'ana.p12', reason: 'Aprobado' }]);
  expect(JSON.stringify(r)).not.toContain('clave-ana');
  expect(net.external()).toEqual([]);
});

test('countersigns a signed PDF and keeps the first signature valid', async ({ page }) => {
  const original = new Uint8Array(await readFile(fx('factura-noviembre.pdf')));
  const signed = (await signWithCertificate(original, { certificate: new Uint8Array(await readFile(certificate('ana.p12'))), password: 'clave-ana' })).bytes;
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'hilvana-e2e-')), 'firmado-por-ana.pdf');
  await writeFile(file, signed);

  await open(page, 'certify');
  await page.locator('.drop input[type=file]').setInputFiles(file);
  await expect(page.locator('.file-note')).toContainText('las anteriores siguen válidas');
  await openCertificate(page, 'luis.p12', 'clave-luis');
  await runTool(page);
  const out = await downloadBytes(page);
  expect((await inspect(out.bytes)).signatures).toBe(2);
  if (hasPdfsig) expect(await pdfsig(out.bytes)).toEqual([['Ana Prueba', true], ['Luis Prueba', true]]);
});

test('signs a signed, restricted PDF as it is, keeping its protection and its first signature', async ({ page }) => {
  const { PDF, P12Signer } = await import('@libpdf/core');
  const { protect } = await import('@hilvana/core');
  const restricted = await protect(new Uint8Array(await readFile(fx('factura-noviembre.pdf'))), { allowModify: false });
  const pdf = await PDF.load(restricted);
  const signed = (await pdf.sign({ signer: await P12Signer.create(new Uint8Array(await readFile(certificate('ana.p12'))), 'clave-ana'), level: 'B-B' })).bytes;
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'hilvana-e2e-')), 'extracto-firmado.pdf');
  await writeFile(file, signed);

  await open(page, 'certify');
  await page.locator('.drop input[type=file]').setInputFiles(file);
  await expect(page.locator('.file-note').nth(1)).toHaveText('Está protegido y firmado: se firma tal cual, así que conserva su protección.');
  await openCertificate(page, 'luis.p12', 'clave-luis');
  await runTool(page);
  await expect(page.locator('.result')).toContainText('conserva su protección');
  const out = await downloadBytes(page);
  expect((await inspect(out.bytes)).protection).toBe('permissions');
  if (hasPdfsig) expect(await pdfsig(out.bytes)).toEqual([['Ana Prueba', true], ['Luis Prueba', true]]);
});

test('protects with a password typed twice, and never shows it in the recipe', async ({ page }) => {
  const net = await open(page, 'protect');
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.blocker')).toHaveText('Escribe una contraseña o quita algún permiso.');
  await page.getByLabel('Contraseña nueva').fill('secreto-1');
  await page.getByLabel('Repite la contraseña').fill('secreto-2');
  await expect(page.locator('.blocker')).toHaveText('Las contraseñas no coinciden.');
  await page.getByLabel('Repite la contraseña').fill('secreto-1');
  await page.getByLabel('Copiar texto e imágenes').uncheck();
  await runTool(page);
  const out = await downloadBytes(page);
  expect(out.name).toBe('factura-octubre-protegido.pdf');
  await expect(unlock(out.bytes)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
  expect((await unlock(out.bytes, 'secreto-1')).protection).toBe('password');
  const r = await recipe(page);
  expect(r.steps).toEqual([{ op: 'protect', password: '••••••', allowCopy: false }]);
  expect(await page.content()).not.toContain('secreto-1');
  expect(net.external()).toEqual([]);
});

test('restricts use without a password', async ({ page }) => {
  await open(page, 'protect', 'en');
  await addFiles(page, 'factura-octubre.pdf');
  await page.getByLabel('Changes, annotations and form filling').uncheck();
  await runTool(page);
  const out = await downloadBytes(page);
  expect((await inspect(out.bytes)).protection).toBe('permissions');
  expect((await recipe(page)).steps).toEqual([{ op: 'protect', allowModify: false }]);
});

test('forgets the certificate when leaving the tool', async ({ page }) => {
  await open(page, 'certify');
  await addFiles(page, 'factura-octubre.pdf');
  await openCertificate(page, 'ana.p12', 'clave-ana');
  await expect(page.locator('.cert-card')).toBeVisible();
  await page.goto('./?lang=es#/stamp');
  await page.goto('./?lang=es#/certify');
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.cert-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Elegir certificado (.p12 o .pfx)' })).toBeVisible();
});
