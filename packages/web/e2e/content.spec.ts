// R2 · Wrong output that looks right. Every check here reads the downloaded PDF's content,
// not just its page count.
import { test, expect } from './test';
import { addFiles, download, fx, imagePlacements, open, pageTexts, recipe, runTool } from './helpers';
import { readFile } from 'node:fs/promises';

const titles = (texts: string[]) => texts.map((t) => /(Factura \w+|Escaneo|Contrato)/.exec(t)?.[1] + ' ' + (/Página (\d+)/.exec(t)?.[1] ?? '-'));

test('merge keeps every page, in the order shown', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf', 'contrato.docx');
  await page.getByRole('button', { name: 'Bajar factura-octubre.pdf' }).click();
  await runTool(page);
  const texts = await pageTexts((await download(page)).bytes);
  expect(titles(texts)).toEqual([
    'Factura noviembre 1', 'Factura noviembre 2', 'Factura noviembre 3',
    'Factura octubre 1', 'Factura octubre 2',
    'Contrato -',
  ]);
});

test('Word conversion keeps the text selectable, accents and symbols included', async ({ page }) => {
  await open(page, 'word');
  await addFiles(page, 'contrato.docx');
  await runTool(page);
  const [text] = await pageTexts((await download(page)).bytes);
  expect(text).toContain('Contrato de prestación de servicios');
  expect(text).toContain('Hilvana S.A.S.');
  expect(text).toContain('Ñandú, acción, café ✓');
  expect(text).toContain('$ 1.200.000');
});

test('arranging pages produces exactly the pages kept, in the new order', async ({ page }) => {
  await open(page, 'pages');
  await addFiles(page, 'escaneo.pdf');
  for (const n of [1, 4]) await page.getByRole('button', { name: `Página ${n}`, exact: true }).click();
  await page.getByRole('button', { name: 'Mover la página 6 antes' }).click();
  await page.getByRole('button', { name: 'Mover la página 6 antes' }).click();
  await runTool(page);
  expect(titles(await pageTexts((await download(page)).bytes))).toEqual(['Escaneo 2', 'Escaneo 3', 'Escaneo 6', 'Escaneo 5']);
});

test('split by ranges puts each page in the right part', async ({ page }) => {
  await open(page, 'split');
  await addFiles(page, 'escaneo.pdf');
  await page.getByLabel('Cómo dividir').selectOption('ranges');
  await page.getByLabel('Rangos').fill('5-last; 1, 3');
  await runTool(page);
  expect(titles(await pageTexts((await download(page, 0)).bytes))).toEqual(['Escaneo 5', 'Escaneo 6']);
  expect(titles(await pageTexts((await download(page, 1)).bytes))).toEqual(['Escaneo 1', 'Escaneo 3']);
});

test('the zip of split parts holds every part, intact', async ({ page }) => {
  await open(page, 'split');
  await addFiles(page, 'factura-noviembre.pdf');
  await runTool(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Descargar todo (.zip)' }).click()]);
  const { unzipSync } = await import('fflate');
  const entries = unzipSync(new Uint8Array(await readFile((await dl.path())!)));
  expect(Object.keys(entries).sort()).toEqual(['factura-noviembre-1.pdf', 'factura-noviembre-2.pdf', 'factura-noviembre-3.pdf']);
  expect(titles(await pageTexts(entries['factura-noviembre-2.pdf']!))).toEqual(['Factura noviembre 2']);
});

test('the stamp lands only on the chosen page, with today\'s date', async ({ page }) => {
  await open(page, 'stamp');
  await addFiles(page, 'factura-noviembre.pdf');
  await page.getByLabel('Texto').fill('✓ Recibido {date}');
  await page.getByLabel('Páginas').selectOption('last');
  await runTool(page);
  const texts = await pageTexts((await download(page)).bytes);
  const today = new Date().toLocaleDateString('sv-SE'); // the browser and this test share the machine's time zone
  expect(texts[2]).toContain(`✓ Recibido ${today}`);
  expect(texts[0]).not.toContain('Recibido');
  expect(texts[1]).not.toContain('Recibido');
});

test('a custom page range for the stamp is respected', async ({ page }) => {
  await open(page, 'stamp');
  await addFiles(page, 'escaneo.pdf');
  await page.getByLabel('Texto').fill('COPIA');
  await page.getByLabel('Páginas').selectOption('custom');
  await page.getByRole('textbox', { name: 'Elegir' }).fill('even');
  await runTool(page);
  const texts = await pageTexts((await download(page)).bytes);
  expect(texts.map((t) => t.includes('COPIA'))).toEqual([false, true, false, true, false, true]);
});

test('page numbers say the right number on every page', async ({ page }) => {
  await open(page, 'number');
  await addFiles(page, 'factura-noviembre.pdf');
  await page.getByLabel('Formato').fill('{n} de {total}');
  await runTool(page);
  const texts = await pageTexts((await download(page)).bytes);
  texts.forEach((t, i) => expect(t).toContain(`${i + 1} de 3`));
});

test('the watermark appears on every page', async ({ page }) => {
  await open(page, 'watermark');
  await addFiles(page, 'factura-noviembre.pdf');
  await page.getByLabel('Texto').fill('BORRADOR');
  await runTool(page);
  for (const t of await pageTexts((await download(page)).bytes)) expect(t).toContain('BORRADOR');
});

test('the signature is drawn in the chosen corner of the chosen page', async ({ page }) => {
  await open(page, 'sign');
  await addFiles(page, 'factura-noviembre.pdf');
  await page.getByRole('button', { name: 'Subir imagen' }).click();
  await page.getByLabel('Subir imagen', { exact: true }).last().setInputFiles(fx('foto.png'));
  await expect(page.locator('.signature-preview')).toBeVisible();
  await page.getByLabel('Páginas').selectOption('first');
  await page.getByLabel('Posición').selectOption('top-left');
  await runTool(page);
  const bytes = (await download(page)).bytes;
  const first = await imagePlacements(bytes, 1);
  expect(first.images).toHaveLength(1);
  const sig = first.images[0]!;
  expect(sig.x).toBeLessThan(first.width / 2);
  expect(sig.y).toBeGreaterThan(first.height / 2);
  expect(Math.round(sig.w)).toBe(150);
  expect((await imagePlacements(bytes, 3)).images).toHaveLength(0);
});

test('compression never changes the text', async ({ page }) => {
  await open(page, 'compress');
  await addFiles(page, 'escaneo.pdf');
  await page.getByLabel('Nivel').selectOption('max');
  await runTool(page);
  const after = await pageTexts((await download(page)).bytes);
  expect(after).toEqual(await pageTexts(new Uint8Array(await readFile(fx('escaneo.pdf')))));
});

test('compression to a target size reports whether it was met', async ({ page }) => {
  await open(page, 'compress');
  await addFiles(page, 'escaneo.pdf');
  await page.getByLabel('Nivel').selectOption('target');
  await expect(page.getByText('Tamaño máximo: 2 MB')).toBeVisible();
  await runTool(page);
  expect((await recipe(page)).steps[0]).toEqual({ op: 'compress', targetBytes: 2 * 1024 * 1024 });
  await expect(page.locator('.notes')).toBeVisible();
});

test('removing metadata also removes the creator and producer', async ({ page }) => {
  await open(page, 'metadata');
  await addFiles(page, 'factura-octubre.pdf');
  await runTool(page);
  const pdf = (await download(page)).pdf;
  expect([pdf.getTitle(), pdf.getAuthor(), pdf.getCreator(), pdf.getProducer()]).toEqual([undefined, undefined, undefined, undefined]);
  expect(titles(await pageTexts((await download(page)).bytes))).toEqual(['Factura octubre 1', 'Factura octubre 2']);
});

test('images keep their order and, at "same as image", their proportions', async ({ page }) => {
  await open(page, 'images');
  await page.locator('.drop input[type=file]').setInputFiles([fx('foto.png'), fx('foto.png')]);
  await expect(page.locator('.file')).toHaveCount(2);
  await expect(page.locator('.file').nth(1)).toContainText('foto (2).png');
  await runTool(page);
  const pdf = (await download(page)).pdf;
  expect(pdf.getPageCount()).toBe(2);
  const p = pdf.getPage(0);
  expect(p.getWidth() / p.getHeight()).toBeCloseTo(800 / 600, 2);
});

test.describe('dates follow the person\'s clock, not UTC', () => {
  test.use({ timezoneId: 'Pacific/Kiritimati' }); // UTC+14: almost always a different day than UTC

  test('{date} is the local date', async ({ page }) => {
    await open(page, 'stamp');
    await addFiles(page, 'factura-octubre.pdf');
    await page.getByLabel('Texto').fill('Fecha {date}');
    await runTool(page);
    const [text] = await pageTexts((await download(page)).bytes);
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    expect(text).toContain(`Fecha ${local}`);
  });
});
