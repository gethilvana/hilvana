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
