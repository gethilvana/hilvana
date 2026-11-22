import { readFileSync } from 'node:fs';
import * as core from '@hilvana/core';
Error.stackTraceLimit = 30;
const b = new Uint8Array(readFileSync(`bench/.cache/pdfjs/test/pdfs/${process.argv[2]}`));
for (const [n, fn] of [['stamp', () => core.stampText(b, { text: 'x', pages: 'all' })], ['compress', () => core.compress(b)], ['redact', () => core.redact(b, { areas: [{ page: 1, x: 100, y: 300, width: 200, height: 80 }] })]]) {
  try { await fn(); console.log(n, 'ok'); } catch (e) { console.log(n, e.stack.split('\n').filter((l) => !l.includes('node:internal')).slice(0, 8).join('\n')); }
}
