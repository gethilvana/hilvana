import { defineConfig, type Plugin } from 'vite';
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

/**
 * The privacy promise, enforced by the browser: the page may only talk to its own origin.
 * No analytics, no CDNs, no APIs. Added only to the production build (the dev server needs inline scripts).
 * The same policy is sent as an HTTP header by Cloudflare Pages (dist/_headers, written below).
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Cloudflare Pages headers. frame-ancestors only works as a header, not in the meta tag. */
const HEADERS = `/*
  Content-Security-Policy: ${CSP}; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache
`;

function csp(): Plugin {
  return {
    name: 'hilvana-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

/**
 * Writes dist/sw.js: the app shell is cached on install so the site works offline;
 * fonts, pdf.js assets and the OCR engine are cached the first time they are used.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'hilvana-sw',
    apply: 'build',
    configResolved: (c) => { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = path.join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(path.relative(outDir, p).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      const shell = ['./', ...files.filter((f) => !/^(fonts|pdfjs|ocr)\//.test(f) && !/^(sw\.js|_headers|_redirects)$/.test(f)).map((f) => `./${f}`)];
      const version = createHash('sha256').update(shell.join('\n')).update(files.map((f) => statSync(path.join(outDir, f)).size).join(',')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8');
      writeFileSync(path.join(outDir, 'sw.js'), template.replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell)));
      writeFileSync(path.join(outDir, '_headers'), HEADERS);
    },
  };
}

const require = createRequire(import.meta.url);
const versionOf = (name: string) => (require(`${name}/package.json`) as { version: string }).version;
// tesseract-wasm hides its package.json behind "exports": read it from its main file's folder.
const tesseractVersion = (JSON.parse(readFileSync(path.join(path.dirname(require.resolve('tesseract-wasm')), '..', 'package.json'), 'utf8')) as { version: string }).version;

export default defineConfig({
  base: './',
  // Versioned folders for the OCR engine and models (see scripts/copy-assets.mjs).
  define: {
    __TESSERACT_VERSION__: JSON.stringify(tesseractVersion),
    __TESSDATA_VERSION__: JSON.stringify(versionOf('@tesseract.js-data/spa')),
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  worker: { format: 'es' },
  resolve: {
    // The engine uses pdf.js's legacy build so it also runs on Node 20. Browsers get the modern
    // build, the same one the page uses for previews: smaller, and without polyfills.
    alias: [
      { find: /^pdfjs-dist\/legacy\/build\/pdf\.mjs$/, replacement: 'pdfjs-dist/build/pdf.mjs' },
      { find: /^pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs$/, replacement: 'pdfjs-dist/build/pdf.worker.mjs' },
    ],
  },
  build: {
    target: 'es2022',
    // Source maps only for coverage runs; the published site ships without them.
    sourcemap: process.env.COVERAGE === '1',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [csp(), serviceWorker()],
});
