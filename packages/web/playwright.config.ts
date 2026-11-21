import { defineConfig, devices } from '@playwright/test';

// Runs against the production build (vite preview), so the Content-Security-Policy and the
// service worker are the real ones. Set CHROME_PATH to use an installed Chrome instead of
// Playwright's own browser.
export default defineConfig({
  testDir: 'e2e',
  globalTeardown: './e2e/coverage-report.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    acceptDownloads: true,
    launchOptions: {
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      // Like a real computer: without a UTF-8 locale, Chrome drops accented download names.
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } as Record<string, string>,
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], locale: 'es-CO' }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], locale: 'en-US' }, testMatch: /mobile\.spec\.ts/ },
    // Other engines run in CI (or with ALL_BROWSERS=1), where Playwright installs them.
    ...(process.env.CI || process.env.ALL_BROWSERS ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'], locale: 'es-CO' }, testIgnore: /mobile\.spec\.ts/ },
      { name: 'webkit', use: { ...devices['Desktop Safari'], locale: 'es-CO' }, testIgnore: /mobile\.spec\.ts/ },
      { name: 'iphone', use: { ...devices['iPhone 14'], locale: 'en-US' }, testMatch: /mobile\.spec\.ts/ },
    ] : []),
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
});
