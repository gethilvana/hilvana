// R8 · Accessibility: automated WCAG 2.1 AA checks on every tool, plus a keyboard-only flow.
import { test, expect } from './test';
import AxeBuilder from '@axe-core/playwright';
import { addFiles, open, runTool } from './helpers';

const TOOLS: [string, string[]][] = [
  ['merge', ['factura-octubre.pdf', 'contrato.docx']], ['pages', ['escaneo.pdf']], ['split', ['escaneo.pdf']], ['rotate', ['escaneo.pdf']],
  ['word', ['contrato.docx']], ['images', ['foto.png']], ['sign', ['factura-octubre.pdf']], ['stamp', ['factura-octubre.pdf']],
  ['number', ['factura-octubre.pdf']], ['watermark', ['factura-octubre.pdf']], ['compress', ['escaneo.pdf']], ['metadata', ['factura-octubre.pdf']],
];

const axe = (page: import('@playwright/test').Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
const summary = (r: Awaited<ReturnType<typeof axe>>) => r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const [tool, files] of TOOLS) {
  test(`${tool}: no WCAG 2.1 AA violations, empty and with files`, async ({ page }) => {
    await open(page, tool);
    expect(summary(await axe(page))).toEqual([]);
    await addFiles(page, ...files);
    expect(summary(await axe(page))).toEqual([]);
  });
}

test('result panel and privacy dialog have no violations', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  await runTool(page);
  await page.locator('.recipe summary').click();
  expect(summary(await axe(page))).toEqual([]);
  await page.getByRole('button', { name: 'Cómo comprobarlo' }).click();
  expect(summary(await axe(page))).toEqual([]);
});

test('English pages have no violations either', async ({ page }) => {
  await open(page, 'stamp', 'en');
  await addFiles(page, 'factura-octubre.pdf');
  expect(summary(await axe(page))).toEqual([]);
});

test('merging works with the keyboard alone, and focus lands on the result', async ({ page }) => {
  await open(page, 'merge');
  await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
  // Reorder with the keyboard: focus "move down" on the first file and press Enter.
  await page.getByRole('button', { name: 'Bajar factura-octubre.pdf' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.file-name')).toHaveText(['factura-noviembre.pdf', 'factura-octubre.pdf']);
  // Tab forward to the main button.
  for (let i = 0; i < 12; i++) {
    if (await page.locator('.action .btn-primary').evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(page.locator('.action .btn-primary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Descargar' })).toBeFocused();
});

test('pages can be removed and moved with the keyboard', async ({ page }) => {
  await open(page, 'pages');
  await addFiles(page, 'factura-noviembre.pdf');
  await page.getByRole('button', { name: 'Página 1', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Página 1, Se quita' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Mover la página 3 antes' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.page-num')).toHaveText(['1', '3', '2']);
});

test('visible focus on every interactive element', async ({ page }) => {
  await open(page, 'stamp');
  await addFiles(page, 'factura-octubre.pdf');
  const missing: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const visible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      return { visible, label: `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? ''}` };
    });
    if (info && !info.visible) missing.push(info.label);
  }
  expect(missing).toEqual([]);
});

test.describe('motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the working stitch does not animate when reduced motion is requested', async ({ page }) => {
    await open(page, 'merge');
    await addFiles(page, 'factura-octubre.pdf', 'factura-noviembre.pdf');
    const anim = await page.locator('.action-stitch line').evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
  });
});
