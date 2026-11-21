import { test, expect } from '@playwright/test';
import { PDFName, PDFDict } from 'pdf-lib';
import { addFiles, download, fx, open, recipe, runTool } from './helpers';

test('merges PDFs and a Word document in the chosen order', async ({ page }) => {
  const net = await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf', 'contrato.docx');
  await expect(page.locator('.file')).toHaveCount(3);
  await expect(page.locator('.file').nth(2)).toContainText('Convertido desde Word');
  await page.getByRole('button', { name: 'Subir contrato.docx' }).click();
  await runTool(page);
  const out = await download(page);
  expect(out.name).toBe('factura-octubre-unido.pdf');
  expect(out.pdf.getPageCount()).toBe(6);
  expect((await recipe(page)).steps[0]).toEqual({ op: 'merge', files: ['factura-octubre.pdf', 'contrato.docx', 'factura-noviembre.pdf'] });
  expect(net.external()).toEqual([]);
});

test('needs two files to merge', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.blocker')).toHaveText('Agrega al menos dos archivos para unirlos.');
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
});

test('removes and reorders pages from the grid', async ({ page }) => {
  await open(page, 'pages');
  await addFiles(page, 'escaneo.pdf');
  await expect(page.locator('.page')).toHaveCount(6);
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
  await page.getByRole('button', { name: 'Página 2', exact: true }).click();
  await page.getByRole('button', { name: 'Página 3', exact: true }).click();
  await expect(page.locator('.grid-summary')).toHaveText('Quedan 4 de 6 páginas');
  await page.getByRole('button', { name: 'Mover la página 6 antes' }).click();
  await runTool(page);
  const out = await download(page);
  expect(out.pdf.getPageCount()).toBe(4);
  expect((await recipe(page)).steps[0]).toEqual({ op: 'select', pages: '1,4,6,5' });
});

test('splits into one file per page, with a zip of all parts', async ({ page }) => {
  await open(page, 'split');
  await addFiles(page, 'factura-noviembre.pdf');
  await runTool(page);
  await expect(page.locator('.result .output')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Descargar todo (.zip)' })).toHaveAttribute('download', 'factura-noviembre-partes.zip');
  expect((await download(page, 2)).pdf.getPageCount()).toBe(1);
});

test('splits by ranges', async ({ page }) => {
  await open(page, 'split');
  await addFiles(page, 'escaneo.pdf');
  await page.getByLabel('Cómo dividir').selectOption('ranges');
  await page.getByLabel('Rangos').fill('1-2; 3-last');
  await runTool(page);
  await expect(page.locator('.result .output')).toHaveCount(2);
  expect((await download(page, 1)).pdf.getPageCount()).toBe(4);
});

test('rotates only the chosen pages', async ({ page }) => {
  await open(page, 'rotate');
  await addFiles(page, 'escaneo.pdf');
  await page.getByRole('button', { name: 'Página 1', exact: true }).click();
  await page.getByLabel('Giro').selectOption('180');
  await runTool(page);
  const pages = (await download(page)).pdf.getPages();
  expect(pages.map((p) => p.getRotation().angle)).toEqual([180, 90, 0, 0, 0, 0]);
});

test('converts Word to PDF with embedded fonts', async ({ page }) => {
  const net = await open(page, 'word');
  await addFiles(page, 'contrato.docx');
  await runTool(page);
  const out = await download(page);
  expect(out.name).toBe('contrato.pdf');
  expect(out.pdf.getPageCount()).toBe(1);
  expect(net.external()).toEqual([]);
});

test('turns images into a PDF', async ({ page }) => {
  await open(page, 'images');
  await addFiles(page, 'foto.png');
  await page.getByLabel('Tamaño de página').selectOption('a4');
  await runTool(page);
  const p = (await download(page)).pdf.getPage(0);
  expect(Math.round(p.getWidth())).toBe(595);
});

test('signs the last page with a drawn signature', async ({ page }) => {
  await open(page, 'sign');
  await addFiles(page, 'factura-noviembre.pdf');
  await expect(page.locator('.blocker')).toHaveText('Dibuja o sube una firma.');
  const pad = page.locator('.signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 110);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 40 + i * 18, box.y + 110 - Math.sin(i) * 30);
  await page.mouse.up();
  await expect(page.locator('.action .btn-primary')).toBeEnabled();
  await runTool(page);
  const pdf = (await download(page)).pdf;
  const xobjects = (p: number) => {
    const res = pdf.getPage(p).node.Resources();
    const x = res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    return x ? x.keys().length : 0;
  };
  expect(xobjects(2)).toBeGreaterThan(0);
  expect(xobjects(0)).toBe(0);
});

test('stamps text with symbols outside the standard fonts', async ({ page }) => {
  const net = await open(page, 'stamp');
  await addFiles(page, 'factura-octubre.pdf');
  await page.getByLabel('Texto').fill('✓ Aprobado {date}');
  await runTool(page);
  expect((await download(page)).pdf.getPageCount()).toBe(2);
  expect((await recipe(page)).steps[0]).toMatchObject({ op: 'stampText', text: '✓ Aprobado {date}', pages: '1', anchor: 'top-right' });
  expect(net.external()).toEqual([]);
});

test('numbers pages and adds a watermark', async ({ page }) => {
  await open(page, 'number');
  await addFiles(page, 'escaneo.pdf');
  await runTool(page);
  expect((await recipe(page)).steps[0]).toMatchObject({ op: 'numberPages', format: 'Página {n} de {total}' });
  await page.goto('./?lang=es#/watermark');
  await addFiles(page, 'escaneo.pdf');
  await runTool(page);
  expect((await download(page)).pdf.getPageCount()).toBe(6);
});

test('compresses and reports the result', async ({ page }) => {
  await open(page, 'compress');
  await addFiles(page, 'escaneo.pdf');
  await page.getByLabel('Nivel').selectOption('lossless');
  await runTool(page);
  await expect(page.locator('.notes')).toBeVisible();
  expect((await recipe(page)).steps[0]).toEqual({ op: 'compress', level: 'lossless' });
});

test('shows and removes identifying metadata', async ({ page }) => {
  await open(page, 'metadata');
  await addFiles(page, 'factura-octubre.pdf');
  await expect(page.locator('.meta-list')).toContainText('Jorge Prueba');
  await runTool(page);
  const pdf = (await download(page)).pdf;
  expect(pdf.getAuthor()).toBeUndefined();
  expect(pdf.getTitle()).toBeUndefined();
});

test('explains files it cannot read', async ({ page }) => {
  await open(page, 'compress');
  await page.locator('.drop input[type=file]').setInputFiles({ name: 'roto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nnot really a pdf') });
  await expect(page.locator('.file-error')).toBeVisible();
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
});

test('keeps compatible files when switching tools', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  await page.getByRole('link', { name: 'Comprimir' }).click();
  await expect(page.locator('.file')).toHaveCount(1);
  await page.getByRole('link', { name: 'Imágenes a PDF' }).click();
  await expect(page.locator('.file')).toHaveCount(0);
});
