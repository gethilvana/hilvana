// R3 · Unusual and hostile inputs: the app must explain, never crash, hang or run injected code.
import { test, expect } from './test';
import { strToU8, zipSync } from 'fflate';
import { addBuffers, addFiles, download, fx, makePdf, open, pageTexts, runTool } from './helpers';

test('a password-protected PDF is explained, not processed', async ({ page }) => {
  await open(page, 'compress');
  await addFiles(page, 'con-contrasena.pdf');
  await expect(page.locator('.file-error')).toContainText('El PDF está protegido (con contraseña o con restricciones de uso)');
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
});

test('a PDF with only permission restrictions is explained, not processed', async ({ page }) => {
  // Known limitation (phase 1 roadmap): opened without a password, but restricted. Rejected with a clear message for now.
  await open(page, 'merge');
  await addFiles(page, 'solo-permisos.pdf', 'factura-noviembre.pdf');
  await expect(page.locator('.file').first().locator('.file-error')).toContainText('restricciones de uso');
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
});

test('an empty file is explained', async ({ page }) => {
  await open(page, 'compress');
  await addBuffers(page, [{ name: 'vacio.pdf', buffer: Buffer.alloc(0) }]);
  await expect(page.locator('.file-error')).toBeVisible();
});

test('an image renamed to .pdf is recognised by its content', async ({ page }) => {
  await open(page, 'merge');
  const png = await import('node:fs/promises').then((fs) => fs.readFile(fx('foto.png')));
  await addBuffers(page, [{ name: 'no-soy-pdf.pdf', buffer: png }]);
  await expect(page.locator('.file-error')).toHaveText('Esta herramienta no usa este tipo de archivo.');
});

test('a zip that is not a Word document is explained', async ({ page }) => {
  await open(page, 'word');
  const zip = Buffer.from(zipSync({ 'hola.txt': strToU8('hola') }));
  await addBuffers(page, [{ name: 'falso.docx', buffer: zip, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]);
  await expect(page.locator('.file-error')).toBeVisible();
});

test('a Word "zip bomb" is refused quickly, with a readable message (D15, D16)', async ({ page }) => {
  await open(page, 'word');
  const docx = Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/big.bin"/></Relationships>'),
    'word/media/big.bin': new Uint8Array(300 * 1024 * 1024),
  }, { level: 9 }));
  expect(docx.byteLength).toBeLessThan(1_000_000);
  const t = Date.now();
  await addBuffers(page, [{ name: 'bomba.docx', buffer: docx, mimeType: 'application/octet-stream' }]);
  await expect(page.locator('.file-error')).toHaveText('"bomba.docx" se expande a un tamaño excesivo al abrirlo; no se procesó para proteger tu equipo.');
  expect(Date.now() - t).toBeLessThan(10_000);
});

test('file names and metadata are shown as text, never run as code', async ({ page }) => {
  await open(page, 'metadata');
  let alerted = false;
  page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.setTitle('<img src=x onerror="alert(1)">');
  doc.setAuthor('<script>alert(2)</script>');
  const name = '<img src=x onerror=alert(3)>.pdf';
  await addBuffers(page, [{ name, buffer: Buffer.from(await doc.save()) }]);
  await expect(page.locator('.file-name')).toHaveText(name);
  await expect(page.locator('.meta-list')).toContainText('<script>alert(2)</script>');
  await expect(page.locator('.meta-list img, .file-main img')).toHaveCount(0);
  expect(alerted).toBe(false);
});

// Accented names need a UTF-8 system locale in the browser process (set in playwright.config.ts);
// under the bare "C" locale Chrome falls back to a file called "download".
test('odd file names produce safe download names', async ({ page }) => {
  await open(page, 'compress');
  await addBuffers(page, [{ name: '../../etc/Información: "final" v2?.pdf', buffer: await makePdf(1) }]);
  await runTool(page);
  const { name } = await download(page);
  expect(name).not.toMatch(/[\\/:"?*<>|]/);
  // Safari also turns spaces into underscores; both are safe.
  expect(name.replace(/_/g, ' ')).toBe('Información- -final- v2--comprimido.pdf');
});

test('files with the same name are kept apart', async ({ page }) => {
  await open(page, 'merge');
  await addBuffers(page, [{ name: 'a.pdf', buffer: await makePdf(1, 'Uno') }]);
  await addBuffers(page, [{ name: 'a.pdf', buffer: await makePdf(2, 'Dos') }]);
  await expect(page.locator('.file-name')).toHaveText(['a.pdf', 'a (2).pdf']);
  await runTool(page);
  const texts = await pageTexts((await download(page)).bytes);
  expect(texts.map((t) => t.split(' ')[0])).toEqual(['Uno', 'Dos', 'Dos']);
});

test('merging 40 files keeps all 40, in order', async ({ page }) => {
  await open(page, 'merge');
  const files = await Promise.all(Array.from({ length: 40 }, async (_, i) => ({ name: `doc-${String(i + 1).padStart(2, '0')}.pdf`, buffer: await makePdf(1, `Doc${i + 1}`) })));
  await addBuffers(page, files);
  await expect(page.locator('.file')).toHaveCount(40);
  await runTool(page);
  const texts = await pageTexts((await download(page)).bytes);
  expect(texts.map((t) => t.split(' ')[0])).toEqual(Array.from({ length: 40 }, (_, i) => `Doc${i + 1}`));
});

test('unsupported images (WebP) are explained in the images tool', async ({ page }) => {
  await open(page, 'images');
  const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
  await addBuffers(page, [{ name: 'foto.webp', buffer: webp, mimeType: 'image/webp' }]);
  await expect(page.locator('.file-error')).toBeVisible();
  await expect(page.locator('.action .btn-primary')).toBeDisabled();
});

test('a digitally signed PDF is flagged before and after, and the result carries no broken signature', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'contrato-firmado.pdf', 'factura-octubre.pdf');
  await expect(page.locator('.file').first().locator('.file-note')).toHaveText('Firmado digitalmente: el resultado será un archivo nuevo sin esa firma. Guarda también el original.');
  await expect(page.locator('.file').nth(1).locator('.file-note')).toHaveCount(0);
  await runTool(page);
  await expect(page.locator('.result .notes-warn')).toContainText('"contrato-firmado.pdf" está firmado digitalmente');
  const { inspect } = await import('@hilvana/core');
  expect((await inspect(new Uint8Array((await download(page)).bytes))).signatures).toBe(0);
});
