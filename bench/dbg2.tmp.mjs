import { readFileSync } from 'node:fs';
import * as core from '@hilvana/core';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const b = new Uint8Array(readFileSync('bench/.cache/pdfjs/test/pdfs/issue22011.pdf'));
const c = async (x) => { const t = pdfjs.getDocument({ data: x.slice(), verbosity: 0 }); const n = (await t.promise).numPages; await t.destroy(); return n; };
console.log('pdflib', (await core.inspect(b)).pageCount, 'pdfjs', await c(b), 'merged pdfjs', await c(await core.merge([b])));
