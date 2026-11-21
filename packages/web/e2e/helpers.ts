import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

export const fx = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

/** Opens a tool and records every request, so tests can prove nothing leaves the site. */
export async function open(page: Page, tool: string, lang: 'es' | 'en' = 'es') {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`./?lang=${lang}#/${tool}`);
  await expect(page.locator('h1')).toBeVisible();
  return {
    external: () => requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:')),
  };
}

export async function addFiles(page: Page, ...names: string[]) {
  await page.locator('.drop input[type=file]').setInputFiles(names.map(fx));
  await expect(page.locator('.file-meta', { hasText: /Leyendo|Reading/ })).toHaveCount(0);
}

export async function runTool(page: Page) {
  await page.locator('.action .btn-primary').click();
  await expect(page.locator('.result')).toBeVisible({ timeout: 45_000 });
}

/** Downloads the n-th result and opens it with pdf-lib. */
export async function download(page: Page, n = 0) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.result .output .btn').nth(n).click()]);
  const bytes = await readFile((await dl.path())!);
  return { name: dl.suggestedFilename(), bytes, pdf: await PDFDocument.load(bytes, { updateMetadata: false }) };
}

export async function recipe(page: Page) {
  await page.locator('.recipe summary').click();
  return JSON.parse((await page.locator('.recipe pre').textContent())!);
}

/** Text of each page, as a reader (or a screen reader) would get it. */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  }
  await task.destroy();
  return out;
}

/** Where images are drawn on a page, in page units (origin bottom-left). */
export async function imagePlacements(bytes: Uint8Array, pageNumber: number) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(pageNumber);
  const ops = await page.getOperatorList();
  const { OPS } = pdfjs;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const mul = (a: number[], b: number[]) => [
    a[0]! * b[0]! + a[1]! * b[2]!, a[0]! * b[1]! + a[1]! * b[3]!,
    a[2]! * b[0]! + a[3]! * b[2]!, a[2]! * b[1]! + a[3]! * b[3]!,
    a[4]! * b[0]! + a[5]! * b[2]! + b[4]!, a[4]! * b[1]! + a[5]! * b[3]! + b[5]!,
  ];
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ops.argsArray[i] as number[], ctm);
    else if (fn === OPS.paintImageXObject) out.push({ x: ctm[4]!, y: ctm[5]!, w: ctm[0]!, h: ctm[3]! });
  });
  const view = page.view;
  await task.destroy();
  return { images: out, width: view[2]! - view[0]!, height: view[3]! - view[1]! };
}

/** A plain PDF with `pages` pages, each saying "Página N". */
export async function makePdf(pages: number, title = 'Documento'): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) d.addPage([595, 842]).drawText(`${title} Página ${i}`, { x: 50, y: 760, size: 20, font: f });
  return Buffer.from(await d.save());
}

export async function addBuffers(page: Page, files: { name: string; buffer: Buffer; mimeType?: string }[]) {
  await page.locator('.drop input[type=file]').setInputFiles(files.map((f) => ({ mimeType: 'application/pdf', ...f })));
  await expect(page.locator('.file-meta', { hasText: /Leyendo|Reading/ })).toHaveCount(0, { timeout: 60_000 });
}
