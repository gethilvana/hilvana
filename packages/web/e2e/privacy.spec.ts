import { test, expect } from '@playwright/test';
import { addFiles, download, open, runTool } from './helpers';

test('the page declares a policy that only allows its own origin', async ({ page }) => {
  await open(page, 'merge');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("default-src 'self'");
});

test('the browser blocks any attempt to send data elsewhere', async ({ page }) => {
  await open(page, 'merge');
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/collect', { method: 'POST', body: 'x' });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test('works offline once loaded', async ({ page, context }) => {
  await open(page, 'merge');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  await runTool(page);
  expect((await download(page)).pdf.getPageCount()).toBe(5);
});

test('switches language and remembers it', async ({ page }) => {
  await page.goto('./#/merge');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('h1')).toHaveText('Merge PDF');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Merge PDF');
});

test('explains how to check the privacy claim', async ({ page }) => {
  await open(page, 'merge');
  await page.getByRole('button', { name: 'Cómo comprobarlo' }).click();
  await expect(page.getByRole('dialog')).toContainText('pestaña Red');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
