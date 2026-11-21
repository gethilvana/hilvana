// R5 · Offline use and updates. R11 · What gets deployed.
import { test, expect } from './test';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addFiles, download, open, pageTexts, runTool } from './helpers';

const dist = new URL('../dist/', import.meta.url).pathname;

test('Word conversion works offline once its fonts were used', async ({ page, context }) => {
  await open(page, 'word');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await addFiles(page, 'contrato.docx'); // online: fonts are fetched and kept
  await context.setOffline(true);
  await page.reload();
  await addFiles(page, 'contrato.docx');
  await runTool(page);
  expect((await pageTexts((await download(page)).bytes))[0]).toContain('Contrato de prestación de servicios');
});

test('the service worker never stores documents or results', async ({ page }) => {
  await open(page, 'merge');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await addFiles(page, 'factura-octubre.pdf', 'contrato.docx');
  await runTool(page);
  await download(page);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached.length).toBeGreaterThan(5);
  for (const u of cached) expect(u).toMatch(/^\/($|index\.html|manifest\.webmanifest|icon[\w-]*\.(svg|png)|assets\/|fonts\/|pdfjs\/)/);
});

/** Serves a copy of the build from a temp folder, so a test can "deploy" a new version. */
async function serveCopy(): Promise<{ root: string; url: string; server: Server }> {
  const root = await mkdtemp(path.join(tmpdir(), 'hilvana-site-'));
  await cp(dist, root, { recursive: true });
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    const file = path.join(root, p.endsWith('/') ? `${p}index.html` : p);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  return { root, url: `http://localhost:${port}/`, server };
}

test('a new deployment replaces the cached app, and old caches are deleted', async ({ page }) => {
  const site = await serveCopy();
  try {
    await page.goto(`${site.url}?lang=es#/merge`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const before = await page.evaluate(() => caches.keys());
    expect(before.filter((k) => k.startsWith('hilvana-shell-'))).toHaveLength(1);

    // Deploy: new page title and a new service worker version.
    const index = path.join(site.root, 'index.html');
    await writeFile(index, (await readFile(index, 'utf8')).replace('<title>Hilvana</title>', '<title>Hilvana v2</title>'));
    const swPath = path.join(site.root, 'sw.js');
    await writeFile(swPath, (await readFile(swPath, 'utf8')).replace(/const VERSION = '[^']+'/, "const VERSION = 'next-version'"));

    await page.reload(); // the browser notices the new service worker, which takes over at once
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('hilvana-shell-'))), { timeout: 15_000 })
      .toEqual(['hilvana-shell-next-version']);
    await page.reload();
    expect(await page.evaluate(async () => (await (await caches.match('./', { ignoreSearch: true }))!.text()).includes('Hilvana v2'))).toBe(true);
  } finally {
    site.server.close();
    await rm(site.root, { recursive: true, force: true });
  }
});

test.describe('the build that gets deployed', () => {
  test('sends the same strict policy as a header, plus frame and referrer protection', async () => {
    const headers = await readFile(path.join(dist, '_headers'), 'utf8');
    const html = await readFile(path.join(dist, 'index.html'), 'utf8');
    const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(headers).toContain(`Content-Security-Policy: ${meta}; frame-ancestors 'none'`);
    for (const h of ['X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Permissions-Policy: camera=()']) expect(headers).toContain(h);
    expect(meta).not.toMatch(/'unsafe-inline'|'unsafe-eval'|https?:|\*/);
  });

  test('contains no address of any other site in code or styles', async () => {
    const files = (await readdir(path.join(dist, 'assets'))).filter((f) => /\.(js|mjs|css)$/.test(f));
    const html = await readFile(path.join(dist, 'index.html'), 'utf8');
    // Tripwire for new domains. Known identifiers that are never fetched: links people may click,
    // XML/XFA namespaces, JSON-Schema ids (zod), license comments and examples inside library code.
    // Even if code tried to load one, the Content-Security-Policy would block it.
    const allowed = /^https?:\/\/(github\.com\/gethilvana\/hilvana|www\.w3\.org\/|ns\.adobe\.com\/|purl\.org\/|schemas\.openxmlformats\.org\/|schemas\.microsoft\.com\/|mozilla\.github\.io\/pdf\.js|github\.com\/mozilla\/pdf\.js|bugzil\.la|crbug\.com|github\.com\/Hopding\/pdf-lib|feross\.org|github\.com\/ashtuchkin\/iconv-lite\/wiki|www\.xfa\.org\/schema\/|json-schema\.org\/draft|www\.apache\.org\/licenses\/|example\.com|foo\.bar|\$\{|\[\$\{)/;
    const found = new Set<string>();
    for (const f of [...files.map((x) => path.join(dist, 'assets', x))]) {
      for (const m of (await readFile(f, 'utf8')).matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) if (!allowed.test(m[0])) found.add(m[0]);
    }
    for (const m of html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)) found.add(m[1]!);
    expect([...found]).toEqual([]);
  });

  test('includes the license of every bundled third-party package, linked from the page', async ({ page }) => {
    const notices = await readFile(path.join(dist, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    for (const name of ['pdf-lib', 'pdfjs-dist', 'jpeg-js', 'fflate', 'preact', 'zod', '@pdf-lib/fontkit', '@fontsource/carlito', '@fontsource-variable/bricolage-grotesque']) {
      expect(notices, name).toContain(`\n- ${name} `);
    }
    expect(notices).toContain('SIL Open Font License');
    expect(notices).toContain('Apache License');
    expect(notices).toContain('standard_fonts/LICENSE_FOXIT');
    await page.goto('./?lang=es#/merge');
    const href = await page.getByRole('link', { name: 'Licencias de terceros' }).getAttribute('href');
    const res = await page.request.get(new URL(href!, page.url()).href);
    expect(res.ok()).toBe(true);
  });

  test('ships no source maps', async () => {
    test.skip(process.env.COVERAGE === '1', 'coverage builds include maps on purpose');
    const files = await readdir(path.join(dist, 'assets'));
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
  });
});
