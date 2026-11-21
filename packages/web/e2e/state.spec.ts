// R4 · Interface state and races: what people actually do (double clicks, changing their mind mid-way).
import { test, expect } from './test';
import { addBuffers, addFiles, download, makePdf, open, pageTexts, runTool } from './helpers';

test('a double click runs the tool once', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  await page.locator('.action .btn-primary').dblclick();
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.result .output')).toHaveCount(1);
});

test('switching tools while working never shows the old result in the new tool', async ({ page }) => {
  await open(page, 'merge');
  const big = await makePdf(400, 'Grande');
  await addBuffers(page, [{ name: 'a.pdf', buffer: big }, { name: 'b.pdf', buffer: big }]);
  await page.locator('.action .btn-primary').click();
  await page.getByRole('link', { name: 'Numerar páginas' }).click();
  await expect(page.locator('h1')).toHaveText('Numerar páginas');
  await page.waitForTimeout(4000); // longer than the merge takes
  await expect(page.locator('.result')).toHaveCount(0);
  await expect(page.locator('.action .btn-primary')).toHaveText('Numerar páginas');
});

test('replacing the file in a single-file tool resets the page choices', async ({ page }) => {
  await open(page, 'pages');
  await addFiles(page, 'escaneo.pdf');
  await page.getByRole('button', { name: 'Página 6', exact: true }).click();
  await expect(page.locator('.grid-summary')).toHaveText('Quedan 5 de 6 páginas');
  await addFiles(page, 'factura-noviembre.pdf');
  await expect(page.locator('.page')).toHaveCount(3);
  await expect(page.locator('.grid-summary')).toHaveText('Quedan 3 de 3 páginas');
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
  await page.getByRole('button', { name: 'Página 1', exact: true }).click();
  await runTool(page);
  expect((await download(page)).pdf.getPageCount()).toBe(2);
});

test('a document always keeps at least one page', async ({ page }) => {
  await open(page, 'pages');
  await addFiles(page, 'factura-octubre.pdf');
  await page.getByRole('button', { name: 'Página 1', exact: true }).click();
  await page.getByRole('button', { name: 'Página 2', exact: true }).click();
  await expect(page.locator('.grid-summary')).toHaveText('Quedan 1 de 2 páginas');
});

test('removing a file while it is still being read leaves no trace', async ({ page }) => {
  await open(page, 'merge');
  await page.locator('.drop input[type=file]').setInputFiles([{ name: 'grande.pdf', mimeType: 'application/pdf', buffer: await makePdf(600) }]);
  await page.getByRole('button', { name: 'Quitar grande.pdf' }).click();
  await expect(page.locator('.file')).toHaveCount(0);
  await page.waitForTimeout(3000);
  await expect(page.locator('.file')).toHaveCount(0);
});

test('changing an option after a result and running again replaces the result', async ({ page }) => {
  await open(page, 'number');
  await addFiles(page, 'factura-octubre.pdf');
  await runTool(page);
  await page.getByLabel('Formato').fill('Hoja {n}');
  await runTool(page);
  await expect(page.locator('.result')).toHaveCount(1);
  const texts = await pageTexts((await download(page)).bytes);
  expect(texts[1]).toContain('Hoja 2');
});

test('"Start over" clears files, signature and result', async ({ page }) => {
  await open(page, 'sign');
  await addFiles(page, 'factura-octubre.pdf');
  const box = (await page.locator('.signature-pad').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 60);
  await page.mouse.up();
  await runTool(page);
  await page.getByRole('button', { name: 'Empezar de nuevo' }).click();
  await expect(page.locator('.file')).toHaveCount(0);
  await expect(page.locator('.result')).toHaveCount(0);
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.blocker')).toHaveText('Dibuja o sube una firma.');
});

test('clearing the drawn signature disables signing again', async ({ page }) => {
  await open(page, 'sign');
  await addFiles(page, 'factura-octubre.pdf');
  const box = (await page.locator('.signature-pad').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 60);
  await page.mouse.up();
  await expect(page.locator('.action .btn-primary')).toBeEnabled();
  await page.getByRole('button', { name: 'Borrar' }).click();
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
});

test('changing language keeps the files and the work in progress', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('.file')).toHaveCount(2);
  await expect(page.locator('.file-meta').first()).toContainText('2 pages');
  await runTool(page);
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
});

test('drag and drop adds files like the file picker', async ({ page }) => {
  await open(page, 'merge');
  const bytes = [...(await makePdf(1))];
  const dt = await page.evaluateHandle((data) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(data)], 'arrastrado.pdf', { type: 'application/pdf' }));
    return t;
  }, bytes);
  await page.locator('.drop').dispatchEvent('dragover', { dataTransfer: dt });
  await expect(page.locator('.drop')).toHaveClass(/is-over/);
  await page.locator('.drop').dispatchEvent('drop', { dataTransfer: dt });
  await expect(page.locator('.file-name')).toHaveText('arrastrado.pdf');
  await expect(page.locator('.drop')).not.toHaveClass(/is-over/);
});

test('the recipe can be copied', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, 'metadata');
  await addFiles(page, 'factura-octubre.pdf');
  await runTool(page);
  await page.locator('.recipe summary').click();
  await page.getByRole('button', { name: 'Copiar receta' }).click();
  await expect(page.getByRole('button', { name: 'Receta copiada' })).toBeVisible();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toMatchObject({ steps: [{ op: 'stripMetadata' }] });
});
