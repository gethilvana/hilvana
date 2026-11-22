import { test, expect } from './test';
import { readFile } from 'node:fs/promises';
import { open, addFiles, pageTexts, recipe, runTool } from './helpers';

async function downloadBytes(page: import('@playwright/test').Page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.result .output .btn').first().click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile((await dl.path())!)) };
}

test('finds text, shows it on the page, and removes it from the file for real', async ({ page }) => {
  const net = await open(page, 'redact');
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.blocker')).toHaveText('Escribe qué tachar, elige un tipo de dato o dibuja un área.');
  await page.getByLabel('Textos o números a tachar').fill('octubre');
  await expect(page.locator('.redact-status')).toHaveText('2 coincidencias, en las páginas 1, 2.');
  await expect(page.locator('.redact-match')).toHaveCount(1);
  await runTool(page);
  const out = await downloadBytes(page);
  expect(out.name).toBe('factura-octubre-tachado.pdf');
  const texts = await pageTexts(out.bytes);
  for (const t of texts) {
    expect(t).not.toMatch(/octubre/i);
    expect(t).toContain('Factura');
  }
  await expect(page.locator('.result .notes').first()).toContainText('Verificado');
  expect((await recipe(page)).steps).toEqual([{ op: 'redact', terms: ['octubre'] }]);
  expect(net.external()).toEqual([]);
});

test('redacts an area drawn on the page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2000 });
  await open(page, 'redact');
  await addFiles(page, 'factura-octubre.pdf');
  const canvas = page.locator('.redact-page');
  await expect(canvas.locator('img')).toBeVisible();
  const box = (await canvas.boundingBox())!;
  // Over the big "Página 1" heading.
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.09);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.redact-area')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Área 1, página 1' })).toBeVisible();
  await runTool(page);
  const texts = await pageTexts((await downloadBytes(page)).bytes);
  expect(texts[0]).not.toContain('Página 1');
  expect(texts[1]).toContain('Página 2');
  const steps = (await recipe(page)).steps;
  expect(steps[0].op).toBe('redact');
  expect(steps[0].areas).toHaveLength(1);
  expect(steps[0].areas[0].page).toBe(1);
});

test('removes a drawn area with its button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2000 });
  await open(page, 'redact', 'en');
  await addFiles(page, 'factura-octubre.pdf');
  const box = (await page.locator('.redact-page').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Remove area 1 (page 1)' }).click();
  await expect(page.locator('.redact-area')).toHaveCount(0);
  await expect(page.locator('.blocker')).toHaveText('Type what to redact, choose a kind of data or draw an area.');
});
