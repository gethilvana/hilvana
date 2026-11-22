import { test, expect } from './test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { addFiles, fx, open, pageTexts, runTool } from './helpers';

test('saves a recipe from a result and applies it to each of several files', async ({ page }) => {
  const net = await open(page, 'stamp');
  await addFiles(page, 'factura-octubre.pdf');
  await page.getByLabel('Texto').fill('Pagado');
  await runTool(page);
  await page.getByRole('button', { name: 'Guardar receta' }).click();
  await page.getByLabel('Nombre de la receta').fill('Marcar pagado');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('.result')).toContainText('Guardada como "Marcar pagado"');

  // It survives a reload: it lives in this browser.
  await page.goto('./?lang=es#/recipes');
  await page.reload();
  await expect(page.locator('.saved-item')).toHaveCount(1);
  await expect(page.locator('.saved-item')).toContainText('Marcar pagado');
  await expect(page.locator('.saved-steps')).toContainText('Escribir "Pagado"');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  await expect(page.getByLabel('Cómo aplicarla')).toHaveValue('each');
  await runTool(page);
  await expect(page.locator('.result .output')).toHaveCount(2);
  await expect(page.locator('.result .notes').first()).toContainText('2 de 2 archivos procesados.');
  await expect(page.getByRole('link', { name: 'Descargar todo (.zip)' })).toHaveAttribute('download', 'Marcar-pagado.zip');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.result .output .btn').nth(1).click()]);
  expect(dl.suggestedFilename()).toBe('factura-noviembre-sellado.pdf');
  expect((await pageTexts(new Uint8Array(await readFile((await dl.path())!))))[0]).toContain('Pagado');
  expect(net.external()).toEqual([]);
});

test('merges the files and applies the recipe once, when asked', async ({ page }) => {
  await page.goto('./?lang=es#/recipes');
  await page.evaluate(() => localStorage.setItem('hilvana.recipes.v1', JSON.stringify([{ id: 'r1', name: 'Numerar', savedAt: '', recipe: { version: 1, steps: [{ op: 'merge' }, { op: 'numberPages' }] } }])));
  await page.reload();
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  await page.getByLabel('Cómo aplicarla').selectOption('together');
  await runTool(page);
  await expect(page.locator('.result .output')).toHaveCount(1);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.result .output .btn').first().click()]);
  expect((await PDFDocument.load(await readFile((await dl.path())!))).getPageCount()).toBe(5);
});

test('asks for the image a signing recipe needs', async ({ page }) => {
  await page.goto('./?lang=es#/recipes');
  await page.evaluate(() => localStorage.setItem('hilvana.recipes.v1', JSON.stringify([{ id: 'r1', name: 'Firmar', savedAt: '', recipe: { version: 1, steps: [{ op: 'sign', image: 'firma.png' }] } }])));
  await page.reload();
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.blocker')).toHaveText('Elige la imagen que la receta llama "firma.png".');
  await page.locator('.saved input[type=file][accept^=image]').setInputFiles(fx('foto.png'));
  await expect(page.locator('.action .btn-primary')).toBeEnabled();
  await runTool(page);
  await expect(page.locator('.result .output')).toHaveCount(1);
});

test('imports and exports recipes, and refuses invalid ones or ones with secrets', async ({ page }) => {
  await open(page, 'recipes');
  await expect(page.locator('.saved-empty')).toBeVisible();
  const dir = await mkdtemp(path.join(tmpdir(), 'hilvana-recipes-'));
  const good = path.join(dir, 'limpiar.json');
  await writeFile(good, JSON.stringify({ version: 1, name: 'Limpiar y comprimir', steps: [{ op: 'stripMetadata' }, { op: 'compress' }] }));
  const bad = path.join(dir, 'mala.json');
  await writeFile(bad, '{"version": 2}');
  const secret = path.join(dir, 'secreta.json');
  await writeFile(secret, JSON.stringify({ version: 1, steps: [{ op: 'protect', password: 'x' }] }));

  const importer = page.locator('.saved-foot input[type=file]');
  await importer.setInputFiles(bad);
  await expect(page.locator('.saved .file-error')).toHaveText('Ese archivo no es una receta de Hilvana válida.');
  await importer.setInputFiles(secret);
  await expect(page.locator('.saved .file-error')).toContainText('no se guardan');
  await importer.setInputFiles(good);
  await expect(page.locator('.saved-item')).toContainText('Limpiar y comprimir');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar la receta Limpiar y comprimir' }).click()]);
  expect(dl.suggestedFilename()).toBe('limpiar-y-comprimir.json');
  expect(JSON.parse(await readFile((await dl.path())!, 'utf8')).steps).toEqual([{ op: 'stripMetadata' }, { op: 'compress' }]);

  await page.getByRole('button', { name: 'Eliminar la receta Limpiar y comprimir' }).click();
  await expect(page.locator('.saved-empty')).toBeVisible();
});

test('does not offer to save recipes that need a secret', async ({ page }) => {
  await open(page, 'protect');
  await addFiles(page, 'factura-octubre.pdf');
  await page.getByLabel('Contraseña nueva').fill('abc');
  await page.getByLabel('Repite la contraseña').fill('abc');
  await runTool(page);
  await expect(page.locator('.result')).toContainText('Las recetas con firma digital o contraseña no se guardan.');
  await expect(page.getByRole('button', { name: 'Guardar receta' })).toHaveCount(0);
});
