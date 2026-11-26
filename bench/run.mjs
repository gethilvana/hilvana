#!/usr/bin/env node
// Hilvana public benchmark. Runs every task on the public corpus (bench/corpus.mjs) and the
// synthetic Spanish scans (bench/scans.mjs), compares with local open-source references where one
// exists (native Tesseract, LibreOffice, qpdf), writes bench/results/latest.json and updates the
// results section of docs/benchmark.md.
//
// Usage: npm run build && node bench/corpus.mjs && node bench/scans.mjs && node bench/run.mjs [ocr|redact|word|pdf|compress]...
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import * as core from '@hilvana/core';
import { makeSearchable, wordToPdf } from '@hilvana/office';

const root = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(root, '..');
const out = path.join(root, 'out');
const only = new Set(process.argv.slice(2));
const want = (t) => only.size === 0 || only.has(t);
const results = { date: new Date().toISOString().slice(0, 10), node: process.version, cpu: cpus()[0]?.model, versions: {}, tasks: {} };
results.versions.hilvana = JSON.parse(readFileSync(path.join(repo, 'packages/core/package.json'), 'utf8')).version;
const has = (cmd, args = ['--version']) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
const version = (cmd, args = ['--version']) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).split('\n')[0].trim(); } catch { return undefined; } };

/* ------------------------------------------------------------------ helpers */

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
async function pdfText(bytes, maxPages = Infinity) {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      // Join text pieces as a reader would: no space between pieces that touch on the same line
      // (a word drawn with two fonts is one word), a space for a gap, a line break otherwise.
      const items = (await (await doc.getPage(i)).getTextContent()).items.filter((x) => x.transform);
      let text = '';
      items.forEach((it, k) => {
        text += it.str ?? '';
        const next = items[k + 1];
        if (!next) return;
        const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
        const sameLine = Math.abs(next.transform[5] - it.transform[5]) < h * 0.5;
        const gap = next.transform[4] - (it.transform[4] + (it.width ?? 0));
        text += it.hasEOL || !sameLine ? '\n' : gap > h * 0.15 ? ' ' : '';
      });
      pages.push(text);
    }
    return { pageCount: doc.numPages, text: pages.join('\n') };
  } finally {
    await task.destroy();
  }
}
const norm = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const tokens = (s) => (s.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);

function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = new Uint32Array(n + 1).map((_, j) => j);
  let cur = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)} %` : '—');
const secs = (ms) => (!Number.isFinite(ms) ? '—' : ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`);
async function timed(fn) { const t = performance.now(); const v = await fn(); return [v, performance.now() - t]; }

/**
 * OCR quality against the exact text. Words are compared as a bag (F1), because OCR may read a
 * table column by column: the words are right even when their order differs from the source.
 * Numbers must be read exactly. The character error rate is reported for letters (prose), where
 * the reading order is unambiguous.
 */
function ocrScore(found, truthLines, prose) {
  const truth = norm(truthLines.join(' '));
  const got = norm(found);
  const strip = (w) => w.replace(/^[^\p{L}\p{N}$-]+|[^\p{L}\p{N}]+$/gu, '');
  const tw = truth.split(' ').map(strip).filter(Boolean), gw = got.split(' ').map(strip).filter(Boolean);
  const bag = new Map();
  for (const w of tw) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of gw) { const n = bag.get(w) ?? 0; if (n) { hit++; bag.set(w, n - 1); } }
  const precision = gw.length ? hit / gw.length : 0, rec = tw.length ? hit / tw.length : 0;
  const numbers = tw.filter((w) => /\d/.test(w));
  const gotSet = new Set(gw);
  return {
    words: precision + rec ? (2 * precision * rec) / (precision + rec) : 0,
    numbers: numbers.length ? numbers.filter((w) => gotSet.has(w)).length / numbers.length : 1,
    cer: prose ? lev(got, truth) / truth.length : undefined,
  };
}

/* ------------------------------------------------------------------ OCR */

const truth = existsSync(path.join(out, 'truth.json')) ? JSON.parse(readFileSync(path.join(out, 'truth.json'), 'utf8')) : [];
if (want('ocr') && truth.length) {
  const native = has('tesseract') && has('pdfimages', ['-v']);
  results.versions.tesseract = version('tesseract');
  const rows = [];
  for (const cond of readdirSync(path.join(out, 'scans')).sort()) {
    for (const doc of truth) {
      const file = path.join(out, 'scans', cond, `${doc.id}.pdf`);
      const src = new Uint8Array(readFileSync(file));
      const [{ bytes }, ms] = await timed(() => makeSearchable(src, { lang: 'spa' }));
      const prose = doc.kind === 'carta';
      const row = { cond, doc: doc.id, kind: doc.kind, ms, ...ocrScore((await pdfText(bytes)).text, doc.text, prose) };
      if (native) {
        const tmp = mkdtempSync(path.join(tmpdir(), 'hb-'));
        execFileSync('pdfimages', ['-png', file, path.join(tmp, 'p')]);
        const img = path.join(tmp, readdirSync(tmp).sort()[0]);
        const [txt, nms] = await timed(async () => execFileSync('tesseract', [img, '-', '-l', 'spa'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
        const s = ocrScore(txt, doc.text, prose);
        Object.assign(row, { nativeMs: nms, nativeWords: s.words, nativeCer: s.cer, nativeNumbers: s.numbers });
        rmSync(tmp, { recursive: true, force: true });
      }
      rows.push(row);
      process.stdout.write(`\rOCR ${rows.length}/${truth.length * 5}`);
    }
  }
  console.log();
  const byCond = [...new Set(rows.map((r) => r.cond))].map((cond) => {
    const rs = rows.filter((r) => r.cond === cond);
    const defined = (xs) => xs.filter((x) => x !== undefined);
    return { cond, pages: rs.length, words: mean(rs.map((r) => r.words)), numbers: mean(rs.map((r) => r.numbers)), cer: mean(defined(rs.map((r) => r.cer))), ms: median(rs.map((r) => r.ms)),
      nativeWords: mean(defined(rs.map((r) => r.nativeWords))), nativeNumbers: mean(defined(rs.map((r) => r.nativeNumbers))), nativeCer: mean(defined(rs.map((r) => r.nativeCer))), nativeMs: median(defined(rs.map((r) => r.nativeMs))) };
  });
  results.tasks.ocr = { byCond, rows };
}

/* ------------------------------------------------------------------ redaction */

function leaks(text, s) {
  const t = norm(text).toLowerCase();
  const flat = t.replace(/[\s.\-]/g, '');
  const found = [];
  for (const [k, v] of Object.entries(s)) {
    const value = v.toLowerCase();
    const digitsOnly = value.replace(/\D/g, '');
    const asText = k === 'name' ? value.split(' ').some((w) => w.length > 3 && t.includes(w)) : t.includes(value);
    if (asText || (digitsOnly.length >= 6 && flat.includes(digitsOnly))) found.push(k);
  }
  return found;
}
if (want('redact') && truth.length) {
  const rows = [];
  const query = (doc) => ({ terms: [doc.sensitive.name], patterns: ['number', 'email', 'phone'] });
  for (const doc of truth) {
    const nonSensitive = tokens(doc.text.join(' ')).filter((w) => !/\d/.test(w) && w.length >= 3 && !tokens(doc.sensitive.name).includes(w) && !tokens(doc.sensitive.email).includes(w));
    // Digital document.
    const digital = new Uint8Array(readFileSync(path.join(out, 'digital', `${doc.id}.pdf`)));
    const [res, ms] = await timed(async () => {
      const m = await core.findText(digital, query(doc));
      return core.redact(digital, { areas: m.flatMap((x) => x.areas) });
    });
    const text = (await pdfText(res.bytes)).text;
    const kept = new Set(tokens(text));
    rows.push({ doc: doc.id, source: 'digital', ms, leaks: leaks(text, doc.sensitive), preserved: nonSensitive.filter((w) => kept.has(w)).length / nonSensitive.length });
    // Phone-quality scan: OCR, then redact; check the text and a second OCR of the result.
    const scan = new Uint8Array(readFileSync(path.join(out, 'scans', 'movil-200', `${doc.id}.pdf`)));
    const [r2, ms2] = await timed(async () => {
      const { bytes } = await makeSearchable(scan, { lang: 'spa' });
      const m = await core.findText(bytes, query(doc));
      return core.redact(bytes, { areas: m.flatMap((x) => x.areas) });
    });
    const t2 = (await pdfText(r2.bytes)).text;
    const reread = (await pdfText((await makeSearchable(r2.bytes, { lang: 'spa', force: true })).bytes)).text;
    const kept2 = new Set(tokens(t2));
    rows.push({ doc: doc.id, source: 'escaneo', ms: ms2, leaks: [...new Set([...leaks(t2, doc.sensitive), ...leaks(reread, doc.sensitive)])], preserved: nonSensitive.filter((w) => kept2.has(w)).length / nonSensitive.length });
    process.stdout.write(`\rRedacción ${rows.length}/${truth.length * 2}`);
  }
  console.log();
  const summary = ['digital', 'escaneo'].map((source) => {
    const rs = rows.filter((r) => r.source === source);
    const fields = rs.length * 5;
    return { source, docs: rs.length, fieldsLeaked: rs.reduce((n, r) => n + r.leaks.length, 0), fields, preserved: mean(rs.map((r) => r.preserved)), ms: median(rs.map((r) => r.ms)) };
  });
  results.tasks.redact = { summary, rows };
}

/* ------------------------------------------------------------------ Word → PDF */

const corpus = existsSync(path.join(root, 'corpus.json')) ? JSON.parse(readFileSync(path.join(root, 'corpus.json'), 'utf8')) : { files: [] };
function docxTokens(bytes) {
  try {
    const zip = unzipSync(bytes);
    const xml = Object.entries(zip).filter(([k]) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(k)).map(([, v]) => strFromU8(v)).join(' ');
    return tokens([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).join(' '));
  } catch {
    return [];
  }
}
const recall = (want, got) => { const set = new Set(got); const uniq = [...new Set(want)]; return uniq.length ? uniq.filter((w) => set.has(w)).length / uniq.length : NaN; };

if (want('word')) {
  const docs = corpus.files.filter((f) => f.source === 'poi');
  const lo = has('soffice');
  results.versions.libreoffice = lo ? version('soffice') : undefined;
  let loDir;
  if (lo) {
    loDir = mkdtempSync(path.join(tmpdir(), 'hb-lo-'));
    const profile = mkdtempSync(path.join(tmpdir(), 'hb-lop-'));
    for (let i = 0; i < docs.length; i += 25) {
      try {
        execFileSync('soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', loDir, ...docs.slice(i, i + 25).map((d) => path.join(root, d.path))], { stdio: 'ignore', timeout: 600_000 });
      } catch { /* files it could not convert are simply missing */ }
    }
  }
  const rows = [];
  for (const d of docs) {
    const bytes = new Uint8Array(readFileSync(path.join(root, d.path)));
    const want = docxTokens(bytes);
    const row = { doc: d.name, words: new Set(want).size };
    try {
      const [res, ms] = await timed(() => wordToPdf(bytes));
      const t = await pdfText(res.pdf);
      Object.assign(row, { ok: true, ms, pages: t.pageCount, recall: recall(want, tokens(t.text)), warnings: res.warnings });
    } catch (err) {
      Object.assign(row, { ok: false, error: String(err?.code ?? err?.message ?? err).slice(0, 80) });
    }
    if (lo) {
      const f = path.join(loDir, d.name.replace(/\.docx$/i, '.pdf'));
      if (existsSync(f)) {
        const t = await pdfText(new Uint8Array(readFileSync(f)));
        Object.assign(row, { loOk: true, loPages: t.pageCount, loRecall: recall(want, tokens(t.text)) });
      } else row.loOk = false;
    }
    rows.push(row);
    process.stdout.write(`\rWord ${rows.length}/${docs.length}`);
  }
  console.log();
  const both = rows.filter((r) => r.ok && r.loOk);
  const withText = (rs, k) => rs.filter((r) => r.words >= 5 && Number.isFinite(r[k])).map((r) => r[k]);
  results.tasks.word = {
    summary: {
      docs: rows.length,
      ok: rows.filter((r) => r.ok).length,
      loOk: lo ? rows.filter((r) => r.loOk).length : undefined,
      recall: mean(withText(rows.filter((r) => r.ok), 'recall')),
      loRecall: lo ? mean(withText(rows.filter((r) => r.loOk), 'loRecall')) : undefined,
      recallBoth: mean(withText(both, 'recall')),
      loRecallBoth: mean(withText(both, 'loRecall')),
      samePages: both.length ? both.filter((r) => r.pages === r.loPages).length / both.length : NaN,
      withinOnePage: both.length ? both.filter((r) => Math.abs(r.pages - r.loPages) <= 1).length / both.length : NaN,
      both: both.length,
      ms: median(rows.filter((r) => r.ok).map((r) => r.ms)),
      refusedBoth: rows.filter((r) => !r.ok && r.loOk === false).length,
    },
    rows,
  };
}

/* ------------------------------------------------------------------ real-world PDFs */

const EXPECTED = new Set(['ENCRYPTED', 'PASSWORD_REQUIRED', 'WRONG_PASSWORD', 'INVALID_PDF', 'EMPTY_DOCUMENT', 'REDACTION_UNSUPPORTED', 'REDACTION_INCOMPLETE']);
const outcome = (err) => (err?.code && EXPECTED.has(err.code) ? `rechazo explicado (${err.code})` : 'fallo');

if (want('pdf') || want('compress')) {
  const docs = corpus.files.filter((f) => f.source === 'pdfjs');
  const rows = [];
  for (const d of docs) {
    const bytes = new Uint8Array(readFileSync(path.join(root, d.path)));
    const row = { doc: d.name, bytes: bytes.length, ops: {} };
    let info;
    try { info = await core.inspect(bytes); row.pages = info.pageCount; } catch (err) { row.inspect = outcome(err); rows.push(row); continue; }
    let before = '';
    try { before = (await pdfText(bytes, 5)).text; } catch { /* unreadable by pdf.js too */ }
    const check = async (name, fn, { text = true } = {}) => {
      try {
        const [res, ms] = await timed(fn);
        const outBytes = res.bytes ?? res;
        const after = await pdfText(outBytes, 5);
        const lost = text ? [...new Set(tokens(before))].filter((w) => !new Set(tokens(after.text)).has(w)).length : 0;
        const ok = after.pageCount === info.pageCount;
        // A damaged file that declares pages it cannot read is reported before processing.
        row.ops[name] = ok || !info.missingPages
          ? { ok, ms, size: outBytes.length, textKept: !lost, report: res.report }
          : { ok: false, outcome: 'rechazo explicado (MISSING_PAGES)' };
      } catch (err) {
        row.ops[name] = { ok: false, outcome: outcome(err), error: String(err?.message ?? err).slice(0, 120) };
      }
    };
    if (want('pdf')) {
      await check('unir', () => core.merge([bytes]));
      await check('sello', () => core.stampText(bytes, { text: 'Recibido 2026-11-22', pages: 'all' }));
      await check('tachar', () => core.redact(bytes, { areas: [{ page: 1, x: 100, y: 300, width: 200, height: 80 }] }), { text: false });
    }
    if (want('compress')) {
      await check('comprimir', () => core.compress(bytes, { level: 'balanced' }));
      if (has('qpdf')) {
        const tmp = mkdtempSync(path.join(tmpdir(), 'hb-q-'));
        try {
          execFileSync('qpdf', ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', path.join(root, d.path), path.join(tmp, 'o.pdf')], { stdio: 'ignore' });
        } catch { /* qpdf exits 3 on warnings but still writes */ }
        if (existsSync(path.join(tmp, 'o.pdf'))) row.qpdf = readFileSync(path.join(tmp, 'o.pdf')).length;
        rmSync(tmp, { recursive: true, force: true });
      }
      // Ghostscript with /ebook (images at 150 dpi), the closest to Hilvana's balanced level. Only as a
      // local reference: it is AGPL, so Hilvana never ships or links it (decision D15).
      if (has('gs')) {
        const tmp = mkdtempSync(path.join(tmpdir(), 'hb-g-'));
        const out = path.join(tmp, 'o.pdf');
        try {
          execFileSync('gs', ['-sDEVICE=pdfwrite', '-dPDFSETTINGS=/ebook', '-dCompatibilityLevel=1.6', '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', `-sOutputFile=${out}`, path.join(root, d.path)], { stdio: 'ignore', timeout: 120_000 });
        } catch { /* a file Ghostscript cannot read leaves no column */ }
        if (existsSync(out)) {
          const gsBytes = new Uint8Array(readFileSync(out));
          row.gs = gsBytes.length;
          try {
            const after = await pdfText(gsBytes, 5);
            row.gsTextKept = ![...new Set(tokens(before))].some((w) => !new Set(tokens(after.text)).has(w));
          } catch { row.gsTextKept = false; }
        }
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    rows.push(row);
    process.stdout.write(`\rPDF ${rows.length}/${docs.length}`);
  }
  console.log();
  const opNames = [...new Set(rows.flatMap((r) => Object.keys(r.ops)))];
  results.tasks.pdf = {
    docs: rows.length,
    unreadable: rows.filter((r) => r.inspect).length,
    ops: Object.fromEntries(opNames.map((op) => {
      const rs = rows.filter((r) => r.ops[op]);
      return [op, {
        tried: rs.length,
        ok: rs.filter((r) => r.ops[op].ok).length,
        textKept: rs.filter((r) => r.ops[op].ok && r.ops[op].textKept).length,
        refused: rs.filter((r) => r.ops[op].outcome?.startsWith('rechazo')).length,
        failed: rs.filter((r) => !r.ops[op].ok && !r.ops[op].outcome?.startsWith('rechazo')).length,
        ms: median(rs.filter((r) => r.ops[op].ok).map((r) => r.ops[op].ms)),
      }];
    })),
    rows,
  };
  if (want('compress')) {
    // Files with images worth compressing: over 100 KB.
    const rs = rows.filter((r) => r.ops.comprimir?.ok && r.bytes > 100 * 1024 && (r.ops.comprimir.report?.images?.found ?? 0) > 0);
    results.tasks.compress = {
      docs: rs.length,
      ratio: median(rs.map((r) => r.ops.comprimir.size / r.bytes)),
      smaller: rs.filter((r) => r.ops.comprimir.size < r.bytes).length,
      textKept: rs.filter((r) => r.ops.comprimir.textKept).length,
      qpdfRatio: median(rs.filter((r) => r.qpdf).map((r) => r.qpdf / r.bytes)),
      gsRatio: median(rs.filter((r) => r.gs).map((r) => r.gs / r.bytes)),
      gsSmaller: rs.filter((r) => r.gs && r.gs < r.bytes).length,
      gsTextKept: rs.filter((r) => r.gs && r.gsTextKept).length,
      gsDocs: rs.filter((r) => r.gs).length,
    };
    results.versions.ghostscript = has('gs') ? version('gs') : undefined;
    results.versions.qpdf = has('qpdf') ? version('qpdf') : undefined;
  }
}

/* ------------------------------------------------------------------ write */

mkdirSync(path.join(root, 'results'), { recursive: true });
const prevFile = path.join(root, 'results', 'latest.json');
const merged = existsSync(prevFile) && only.size ? { ...JSON.parse(readFileSync(prevFile, 'utf8')), ...results, tasks: { ...JSON.parse(readFileSync(prevFile, 'utf8')).tasks, ...results.tasks } } : results;
writeFileSync(prevFile, JSON.stringify(merged, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v), 2) + '\n');

// The results section of docs/benchmark.md.
const R = merged.tasks;
const lines = [`Última ejecución: ${merged.date} · Hilvana ${merged.versions.hilvana} · Node ${merged.node} · ${merged.cpu ?? ''}`, ''];
if (R.ocr) {
  const ORDER = ['limpio-300', 'movil-200', 'torcido-200', 'byn-200', 'baja-150'];
  lines.push('### OCR en español (12 documentos sintéticos por condición)', '', 'Palabras: F1 de las palabras leídas frente al texto exacto, sin importar el orden. Números: cifras leídas exactamente (cuentas, cédulas, montos, fechas). Errores por carácter: solo en las cartas, donde el orden de lectura no es ambiguo.', '', '| Condición | Palabras (Hilvana) | Números (Hilvana) | Errores por carácter (Hilvana) | Tiempo por página (Hilvana) | Palabras (Tesseract nativo) | Números (Tesseract nativo) | Errores por carácter (Tesseract nativo) |', '|---|---|---|---|---|---|---|---|');
  for (const c of [...R.ocr.byCond].sort((a, b) => ORDER.indexOf(a.cond) - ORDER.indexOf(b.cond))) lines.push(`| ${c.cond} | ${pct(c.words)} | ${pct(c.numbers)} | ${pct(c.cer)} | ${secs(c.ms)} | ${pct(c.nativeWords)} | ${pct(c.nativeNumbers)} | ${pct(c.nativeCer)} |`);
  lines.push('');
}
if (R.redact) {
  lines.push('### Tachado (nombre, cédula, cuenta, correo y celular de cada documento)', '', '| Origen | Documentos | Datos que siguen legibles | Resto del texto conservado | Tiempo |', '|---|---|---|---|---|');
  for (const s of R.redact.summary) lines.push(`| ${s.source === 'digital' ? 'PDF digital' : 'Escaneo de celular, con OCR'} | ${s.docs} | ${s.fieldsLeaked} de ${s.fields} | ${pct(s.preserved)} | ${secs(s.ms)} |`);
  lines.push('');
}
if (R.word) {
  const w = R.word.summary;
  lines.push('### Word a PDF (130 documentos de prueba de Apache POI)', '', '| | Hilvana | LibreOffice |', '|---|---|---|',
    `| Convertidos | ${w.ok} de ${w.docs} | ${w.loOk ?? '—'} de ${w.docs} |`,
    `| Palabras del documento presentes en el PDF (donde ambos convierten, ${w.both} docs) | ${pct(w.recallBoth)} | ${pct(w.loRecallBoth)} |`,
    `| Mismo número de páginas que LibreOffice | ${pct(w.samePages)} (± 1 página: ${pct(w.withinOnePage)}) | — |`,
    `| Tiempo mediano por documento | ${secs(w.ms)} | — |`, '');
}
if (R.pdf) {
  lines.push(`### PDF reales (${R.pdf.docs} archivos de prueba de pdf.js, muestra fija)`, '', `${R.pdf.unreadable} archivos no se pudieron abrir y se rechazaron con un mensaje.`, '', '| Operación | Correctos | Texto intacto | Rechazados con explicación | Fallos | Tiempo mediano |', '|---|---|---|---|---|---|');
  for (const [op, o] of Object.entries(R.pdf.ops)) lines.push(`| ${op} | ${o.ok} de ${o.tried} | ${op === 'tachar' ? '—' : `${o.textKept} de ${o.ok}`} | ${o.refused} | ${o.failed} | ${secs(o.ms)} |`);
  lines.push('');
}
if (R.compress) {
  const c = R.compress;
  const gs = c.gsDocs ? [`${pct(c.gsRatio)} del original`, `${c.gsSmaller} de ${c.gsDocs}`, `${c.gsTextKept} de ${c.gsDocs}`] : ['—', '—', '—'];
  lines.push(`### Compresión (${c.docs} PDF reales con imágenes y más de 100 KB, nivel equilibrado)`, '', '| | Hilvana | qpdf (sin pérdida) | Ghostscript (/ebook, 150 ppp) |', '|---|---|---|---|', `| Tamaño mediano del resultado | ${pct(c.ratio)} del original | ${pct(c.qpdfRatio)} del original | ${gs[0]} |`, `| Archivos más pequeños | ${c.smaller} de ${c.docs} | — | ${gs[1]} |`, `| Texto intacto | ${c.textKept} de ${c.docs} | — | ${gs[2]} |`, '');
}
const doc = path.join(repo, 'docs', 'benchmark.md');
if (existsSync(doc)) {
  const s = readFileSync(doc, 'utf8');
  writeFileSync(doc, s.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, `<!-- results:start -->\n${lines.join('\n')}\n<!-- results:end -->`));
}
console.log(lines.join('\n'));
