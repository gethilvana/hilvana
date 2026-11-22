import { test, expect } from './test';
import { readFile } from 'node:fs/promises';
import { open, addFiles, pageTexts, recipe, runTool } from './helpers';

test('recognizes a scan on this device and makes its text searchable', async ({ page }) => {
  const net = await open(page, 'ocr');
  await addFiles(page, 'escaneo-ocr.pdf');
  await expect(page.getByLabel('Idioma del documento')).toHaveValue('spa');
  await runTool(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.result .output .btn').first().click()]);
  expect(dl.suggestedFilename()).toBe('escaneo-ocr-buscable.pdf');
  const bytes = new Uint8Array(await readFile((await dl.path())!));
  const [text] = await pageTexts(bytes);
  for (const s of ['Extracto de cuenta de ahorros', 'Ana María Pérez Gómez', '123 456 789']) expect(text).toContain(s);
  await expect(page.locator('.result .notes').first()).toContainText(/OCR: páginas 1, \d+ palabras/);
  expect((await recipe(page)).steps).toEqual([{ op: 'ocr', language: 'spa' }]);
  // The engine and the model come from this site.
  expect(net.external()).toEqual([]);
});

test('redaction search points to OCR when a scan has no text', async ({ page }) => {
  await open(page, 'redact');
  await addFiles(page, 'escaneo-ocr.pdf');
  await page.getByLabel('Textos o números a tachar').fill('123456789');
  await expect(page.locator('.redact-status')).toContainText('usa primero Reconocer texto (OCR)');
});
