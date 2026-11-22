// Copies the files the browser loads on demand into public/ (generated, not committed):
// - the open fonts @hilvana/office embeds when converting Word and stamping text;
// - pdf.js character maps and standard fonts, used only to draw page previews;
// - the OCR engine (Tesseract as WebAssembly) and its Spanish and English models.
// Folder names carry versions, so the service worker can cache them for good.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pub = new URL('../public/', import.meta.url).pathname;
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));

rmSync(path.join(pub, 'fonts'), { recursive: true, force: true });
for (const family of ['carlito', 'caladea', 'arimo', 'tinos', 'cousine', 'noto-sans-symbols-2']) {
  const src = path.join(pkgDir(`@fontsource/${family}`), 'files');
  const dst = path.join(pub, 'fonts', family);
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) if (f.endsWith('.woff')) cpSync(path.join(src, f), path.join(dst, f));
}

const pdfjs = path.dirname(require.resolve('pdfjs-dist/package.json'));
rmSync(path.join(pub, 'pdfjs'), { recursive: true, force: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(path.join(pdfjs, dir))) cpSync(path.join(pdfjs, dir), path.join(pub, 'pdfjs', dir), { recursive: true });
}
rmSync(path.join(pub, 'ocr'), { recursive: true, force: true });
// tesseract-wasm hides its package.json behind "exports": find it from the main file.
const tessDir = path.resolve(path.dirname(require.resolve('tesseract-wasm')), '..');
const tess = JSON.parse(readFileSync(path.join(tessDir, 'package.json'), 'utf8')).version;
const engineDir = path.join(pub, 'ocr', `tesseract-${tess}`);
mkdirSync(engineDir, { recursive: true });
for (const f of ['tesseract-core.wasm', 'tesseract-core-fallback.wasm']) cpSync(path.join(tessDir, 'dist', f), path.join(engineDir, f));
for (const lang of ['spa', 'eng']) {
  const dir = pkgDir(`@tesseract.js-data/${lang}`);
  const version = require(path.join(dir, 'package.json')).version;
  const dst = path.join(pub, 'ocr', `tessdata-${version}`);
  mkdirSync(dst, { recursive: true });
  cpSync(path.join(dir, '4.0.0_best_int', `${lang}.traineddata.gz`), path.join(dst, `${lang}.traineddata.gz`));
}
console.log('Copied fonts, pdf.js assets and the OCR engine to public/');
