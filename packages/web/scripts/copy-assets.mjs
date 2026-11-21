// Copies the files the browser loads on demand into public/ (generated, not committed):
// - the open fonts @hilvana/office embeds when converting Word and stamping text;
// - pdf.js character maps and standard fonts, used only to draw page previews.
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
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
console.log('Copied fonts and pdf.js assets to public/');
