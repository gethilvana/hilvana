import * as core from '@hilvana/core';
import { fallbackTextFonts } from '@hilvana/office';
const fonts = await fallbackTextFonts();
import fs from 'node:fs';
const dir = '/tmp/qa/in/', outDir = '/tmp/qa/out/';
fs.mkdirSync(outDir, { recursive: true });
const png = fs.readFileSync('/tmp/e2e/firma.png');
const ops = {
  inspect: async (b) => { const i = await core.inspect(b); return { info: `${i.pageCount}p enc=${i.encrypted}` }; },
  mergeSelf: (b) => core.merge([b, b]),
  select1: (b) => core.selectPages(b, '1'),
  removeLast: async (b) => ((await core.inspect(b)).pageCount > 1 ? core.removePages(b, 'last') : 'skip'),
  rotate90: (b) => core.rotate(b, 90),
  stampText: (b) => core.stampText(b, { text: 'Recibido 2026-11-19 — señor Núñez €', anchor: 'top-right' }),
  stampUnicode: (b) => core.stampText(b, { text: 'Aprobado ✓ Ελληνικά Кирилл 😀', anchor: 'top-left', fonts }),
  stampNoFonts: (b) => core.stampText(b, { text: 'Aprobado ✓', anchor: 'top-left' }),
  sign: (b) => core.stampImage(b, { image: png, width: 100 }),
  watermark: (b) => core.watermark(b, 'BORRADOR'),
  number: (b) => core.numberPages(b, { format: 'Página {n} de {total}' }),
  strip: (b) => core.stripMetadata(b),
  compress: async (b) => (await core.compress(b, { level: 'balanced' })).bytes,
  optimize: (b) => core.optimize(b),
};
const results = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pdf')).sort()) {
  const bytes = new Uint8Array(fs.readFileSync(dir + f));
  for (const [name, fn] of Object.entries(ops)) {
    const t = Date.now();
    try {
      const r = await fn(bytes);
      if (r === 'skip') { results.push({ f, name, status: 'skip' }); continue; }
      if (r instanceof Uint8Array) {
        const out = `${outDir}${name}__${f}`; fs.writeFileSync(out, r);
        results.push({ f, name, status: 'ok', ms: Date.now() - t, out });
      } else results.push({ f, name, status: 'ok', ms: Date.now() - t, info: r.info });
    } catch (e) {
      results.push({ f, name, status: e?.code ? `err:${e.code}` : `CRASH:${String(e?.message ?? e).slice(0, 90)}`, ms: Date.now() - t });
    }
  }
}
fs.writeFileSync('/tmp/qa/explore.json', JSON.stringify(results, null, 1));
console.log('done', results.length);
