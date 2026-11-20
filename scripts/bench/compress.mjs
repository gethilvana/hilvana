#!/usr/bin/env node
// Compression benchmark: runs every level on every PDF in a folder and writes bench.json
// (sizes, time, image counts). Pair with quality.py for SSIM and text checks.
// Usage: node scripts/bench/compress.mjs <folder-with-pdfs>
import { compress } from '@hilvana/core';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: compress.mjs <folder>'); process.exit(2); }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf') && !f.startsWith('out-')).sort();
const rows = [];
for (const f of files) {
  const src = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  for (const level of ['lossless', 'balanced', 'strong', 'max']) {
    const t = Date.now();
    const { bytes, report } = await compress(src, { level });
    fs.writeFileSync(path.join(dir, `out-${level}-${f}`), bytes);
    rows.push({ f, level, before: src.length, after: bytes.length, ms: Date.now() - t, used: report.level, img: report.images });
  }
}
fs.writeFileSync(path.join(dir, 'bench.json'), JSON.stringify(rows, null, 2));
console.log(`${rows.length} runs written to ${path.join(dir, 'bench.json')}`);
