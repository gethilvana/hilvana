import { test as base, expect } from '@playwright/test';
import { CoverageReport } from 'monocart-coverage-reports';
import { coverageOptions } from './coverage-options';

/** Every request the app may make: its own files, its fonts and pdf.js data. Nothing else, ever. */
const ALLOWED = /^http:\/\/localhost:\d+\/(\?[^#]*)?$|^http:\/\/localhost:\d+\/(index\.html|sw\.js|manifest\.webmanifest|icon[\w-]*\.(svg|png)|assets\/[\w.-]+|fonts\/[\w-]+\/[\w.-]+\.woff|pdfjs\/[\w/.-]+|ocr\/[\w.-]+\/[\w.-]+\.(wasm|gz))(\?[^#]*)?$/;

export const test = base.extend<{ coverage: void; networkGuard: void; allowExternal: boolean }>({
  allowExternal: [false, { option: true }],

  /**
   * Privacy guard on every test: the page and its workers may only request the app's own files.
   * Fails the test if any other request is made (by the page, a worker or the service worker).
   */
  networkGuard: [async ({ context, page, allowExternal }, use) => {
    const seen: string[] = [];
    context.on('request', (r) => seen.push(r.url()));
    // Uncaught errors are bugs even when the screen looks fine.
    const uncaught: string[] = [];
    page.on('pageerror', (e) => uncaught.push(String(e)));
    await use();
    expect(uncaught, 'uncaught errors in the page').toEqual([]);
    if (allowExternal) return;
    const bad = seen.filter((u) => !u.startsWith('blob:') && !u.startsWith('data:') && !ALLOWED.test(u));
    expect(bad, 'requests outside the app\'s own files').toEqual([]);
  }, { auto: true }],

  /** With COVERAGE=1, records which app code each test ran (Chromium only). */
  coverage: [async ({ page, browserName }, use) => {
    const on = process.env.COVERAGE === '1' && browserName === 'chromium';
    if (on) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use();
    if (on) {
      // Only the app served by the test server (the update test serves a copy on another port).
      const entries = (await page.coverage.stopJSCoverage()).filter((e) => e.url.startsWith('http://localhost:4173/assets/index-'));
      if (entries.length) await new CoverageReport(coverageOptions as never).add(entries);
    }
  }, { auto: true }],
});

export { expect };
