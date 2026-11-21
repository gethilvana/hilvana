import { test, expect } from './test';
import { addFiles, download, open, runTool } from './helpers';

test('on a phone, tools are picked from a menu and merging works', async ({ page }) => {
  await open(page, 'merge', 'en');
  await expect(page.locator('nav.tools')).toBeHidden();
  const menu = page.locator('.tools-mobile select');
  await expect(menu).toBeVisible();
  await menu.selectOption('compress');
  await expect(page.locator('h1')).toHaveText('Compress');
  await menu.selectOption('merge');
  await addFiles(page, 'factura-octubre.pdf', 'contrato.docx');
  await runTool(page);
  expect((await download(page)).pdf.getPageCount()).toBe(3);
});
