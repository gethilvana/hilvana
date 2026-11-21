// R6 · Big documents: the page must stay responsive and memory flat while the engine works.
import { test, expect } from './test';
import { encode } from 'fast-png';
import { addBuffers, download, makePdf, open, runTool } from './helpers';

/** A PDF of photo-like noise: large, and hard to compress. */
async function heavyPdf(pages: number): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const w = 1600, h = 1200;
  for (let p = 0; p < pages; p++) {
    const data = new Uint8Array(w * h * 3);
    let x = 12345 + p;
    for (let i = 0; i < data.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; data[i] = (x >>> 24) & 0xff; }
    const png = await doc.embedPng(encode({ width: w, height: h, data, channels: 3 }));
    doc.addPage([595, 446]).drawImage(png, { x: 0, y: 0, width: 595, height: 446 });
  }
  return Buffer.from(await doc.save());
}

test('a 300-page document opens in the page grid without drawing every page', async ({ page }) => {
  await open(page, 'pages');
  const t = Date.now();
  await addBuffers(page, [{ name: 'largo.pdf', buffer: await makePdf(300) }]);
  await expect(page.locator('.page')).toHaveCount(300);
  expect(Date.now() - t).toBeLessThan(15_000);
  await page.waitForTimeout(1500);
  const drawn = await page.locator('.page-img img').count();
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(80); // lazy: only pages near the screen
  await page.getByRole('button', { name: 'Página 300', exact: true }).click();
  await runTool(page);
  expect((await download(page)).pdf.getPageCount()).toBe(299);
});

test('the page stays responsive while a heavy file is compressed', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Long Tasks API is Chromium-only');
  test.setTimeout(120_000);
  await open(page, 'compress');
  const heavy = await heavyPdf(4);
  expect(heavy.byteLength).toBeGreaterThan(15_000_000);
  await addBuffers(page, [{ name: 'fotos.pdf', buffer: heavy }]);
  await page.evaluate(() => {
    (window as unknown as { longest: number }).longest = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as unknown as { longest: number }).longest = Math.max((window as unknown as { longest: number }).longest, e.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  await page.locator('.action .btn-primary').click();
  // While the engine works, the interface still answers.
  await expect(page.locator('.action .btn-primary')).toHaveText('Comprimiendo…');
  const t = Date.now();
  await page.getByRole('button', { name: 'English' }).click();
  expect(Date.now() - t).toBeLessThan(1000);
  await expect(page.locator('.result')).toBeVisible({ timeout: 100_000 });
  const longest = await page.evaluate(() => (window as unknown as { longest: number }).longest);
  expect(longest).toBeLessThan(500);
  const out = await download(page);
  expect(out.bytes.byteLength).toBeLessThan(heavy.byteLength / 2);
});
