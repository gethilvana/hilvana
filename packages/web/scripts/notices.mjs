// Writes dist/THIRD_PARTY_NOTICES.txt: the license of every third-party package bundled into the
// web app (code, fonts and pdf.js data), as their licenses ask when they are redistributed.
// Runs after `vite build`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const webDir = path.resolve(here, '..');
const out = path.join(webDir, 'dist', 'THIRD_PARTY_NOTICES.txt');

function pkgDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

const seen = new Map();
function walk(name, fromDir) {
  const dir = pkgDir(name, fromDir);
  if (!dir || seen.has(dir)) return;
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  seen.set(dir, pkg);
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, dir);
}
const web = JSON.parse(readFileSync(path.join(webDir, 'package.json'), 'utf8'));
for (const dep of Object.keys(web.dependencies)) walk(dep, webDir);

const licenseFiles = (dir) => readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort();
const entries = [...seen.entries()].filter(([, p]) => !p.name.startsWith('@hilvana/')).sort(([, a], [, b]) => a.name.localeCompare(b.name));

let text = `Hilvana web app: third-party notices
=====================================

Hilvana is MIT-licensed (https://github.com/gethilvana/hilvana/blob/main/LICENSE).
The web app also includes the following third-party software, fonts and data,
each under its own license, reproduced below.

`;
text += entries.map(([, p]) => `- ${p.name} ${p.version} (${typeof p.license === 'string' ? p.license : 'see below'})`).join('\n') + '\n';

for (const [dir, p] of entries) {
  text += `\n\n${'='.repeat(72)}\n${p.name} ${p.version}\n${p.homepage ?? p.repository?.url ?? ''}\n${'='.repeat(72)}\n`;
  const files = licenseFiles(dir);
  if (files.length === 0) text += `License: ${p.license}\n`;
  for (const f of files) text += `\n${readFileSync(path.join(dir, f), 'utf8').trim()}\n`;
  // pdf.js ships fonts with their own licenses (PDFium/Foxit and Liberation).
  const fontsDir = path.join(dir, 'standard_fonts');
  if (p.name === 'pdfjs-dist' && existsSync(fontsDir)) {
    for (const f of licenseFiles(fontsDir).concat(readdirSync(fontsDir).filter((x) => /^LICENSE_/.test(x))).filter((v, i, a) => a.indexOf(v) === i)) {
      text += `\n--- standard_fonts/${f} ---\n${readFileSync(path.join(fontsDir, f), 'utf8').trim()}\n`;
    }
  }
}
writeFileSync(out, text);
console.log(`Wrote ${path.relative(webDir, out)} (${entries.length} packages)`);
