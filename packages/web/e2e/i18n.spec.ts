// R9 · Language: everything the person reads follows the chosen language, engine messages included.
import { test, expect } from './test';
import { addBuffers, addFiles, download, open, recipe, runTool } from './helpers';

test('engine errors are in English when the page is in English', async ({ page }) => {
  await open(page, 'compress', 'en');
  await addFiles(page, 'con-contrasena.pdf');
  await expect(page.locator('.file-error')).toHaveText('This PDF needs a password to open.');
  await expect(page.getByLabel('Password for this PDF')).toBeVisible();
});

test('Word errors are in English too (D16)', async ({ page }) => {
  await open(page, 'word', 'en');
  const { strToU8, zipSync } = await import('fflate');
  await addBuffers(page, [{ name: 'broken.docx', buffer: Buffer.from(zipSync({ 'word/document.xml': strToU8('<not-xml') })), mimeType: 'application/octet-stream' }]);
  await expect(page.locator('.file-error')).toHaveText(/^"broken\.docx" is (damaged|not a Word document)/);
});

test('compression notes and output names follow the language', async ({ page }) => {
  await open(page, 'compress', 'en');
  await addFiles(page, 'escaneo.pdf');
  await runTool(page);
  await expect(page.locator('.notes')).not.toContainText(/imágenes|nivel/);
  expect((await download(page)).name).toBe('escaneo-compressed.pdf');
  expect((await recipe(page)).output.filename).toBe('{name}-compressed');
});

test('default stamp texts switch language until the person edits them', async ({ page }) => {
  await open(page, 'stamp', 'es');
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.getByLabel('Texto')).toHaveValue('Recibido {date}');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByLabel('Text')).toHaveValue('Received {date}');
  await page.getByLabel('Text').fill('Pagado {date}');
  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.getByLabel('Texto')).toHaveValue('Pagado {date}');
});

test('no Spanish interface text is left on English pages', async ({ page }) => {
  for (const tool of ['merge', 'pages', 'sign', 'compress', 'metadata']) {
    await open(page, tool, 'en');
    await addFiles(page, tool === 'merge' ? 'factura-noviembre.pdf' : 'factura-octubre.pdf');
    const text = await page.locator('body').innerText();
    // Words that only appear in the Spanish interface (file names and document content excluded).
    for (const word of ['Agrega', 'Suelta', 'páginas,', 'Página ', 'Herramientas', 'Quitar', 'Firma', 'Comprim', 'Tus archivos']) {
      expect(text, `"${word}" on the English ${tool} page`).not.toContain(word);
    }
  }
});
