#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import * as core from '@hilvana/core';
import { UnsafeOutputError, safeWrite } from './safewrite.js';
import { HilvanaError } from '@hilvana/core';
import { convertWord, fallbackTextFonts, isDocx, makeSearchable, type WordEngine } from '@hilvana/office';
import { RecipeError, localDate, plan, planBatch, recipeJsonSchema, run, runBatch, t, type Lang, type WordConverter } from '@hilvana/recipes';

// Read from the package itself (dist/ sits next to package.json), so it never drifts from the release.
const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const HELP: Record<Lang, string> = {
  es: `hilvana ${VERSION}: flujos de PDF privados, en tu equipo.

Uso:
  hilvana inspect <archivo.pdf> [--json]
  hilvana word <documento.docx> [-o <salida.pdf>] [--engine auto|native|libreoffice]
  hilvana merge <a.pdf> <b.docx> ... -o <salida.pdf>
  hilvana pages <archivo.pdf> (--keep <rango> | --remove <rango>) -o <salida.pdf>
  hilvana rotate <archivo.pdf> --angle 90|180|270 [--pages <rango>] -o <salida.pdf>
  hilvana sign <archivo.pdf> --image <firma.png> [--pages last] [--anchor bottom-right] [--width 150] -o <salida.pdf>
  hilvana stamp <archivo.pdf> --text "Recibido {date}" [--pages all] [--anchor top-right] -o <salida.pdf>
  hilvana watermark <archivo.pdf> --text "CONFIDENCIAL" -o <salida.pdf>
  hilvana number <archivo.pdf> [--format "{n} / {total}"] -o <salida.pdf>
  hilvana strip <archivo.pdf> -o <salida.pdf>
  hilvana unlock <archivo.pdf> [--password …] -o <salida.pdf>   (quita contraseña y restricciones)
  hilvana compress <archivo.pdf> [--level lossless|balanced|strong|max] [--target 2MB] -o <salida.pdf>
  hilvana images <a.png> <b.jpg> ... [--page-size image|a4|letter] -o <salida.pdf>
  hilvana ocr <escaneo.pdf> [--language spa|eng] [--force] -o <salida.pdf>
  hilvana redact <archivo.pdf> [--find "texto"]... [--pattern email,card,number,phone] [--area "página:x,y,ancho,alto"]... [--list] -o <salida.pdf>
  hilvana protect <archivo.pdf> [--restrict print,copy,modify] -o <salida.pdf>
  hilvana certify <archivo.pdf> --cert <certificado.p12> [--reason "…"] [--location "…"] [--invisible] [--pages last] [--anchor bottom-right] -o <salida.pdf>
  hilvana run <receta.json> <archivos...> [-o <salida.pdf | carpeta si la receta termina en split>] [--dry-run] [--yes]
  hilvana run <receta.json> <documentos...> --each [-o <carpeta>]   (la receta a cada documento por separado)
  hilvana schema

Rangos: "1-3,5", "last", "last-1", "4-last", "odd", "even", "all".
Opciones: --lang es|en, --force (reemplaza la salida; nunca una entrada).
PDF protegidos: los que solo tienen restricciones se abren solos. Para los que piden contraseña,
  usa --password <contraseña> o la variable HILVANA_PDF_PASSWORD (no queda en el historial).
OCR: agrega a las páginas escaneadas una capa de texto invisible para buscar, copiar y tachar. Todo en tu equipo.
Tachar: elimina del archivo el texto, las imágenes y las formas bajo cada coincidencia o área (no solo las tapa),
  y comprueba el resultado. --list solo muestra lo que encontraría. Las áreas van en puntos desde abajo a la izquierda.
Proteger: la contraseña nueva se pide al ejecutar (o HILVANA_NEW_PASSWORD); --restrict solo quita permisos.
Firma digital: certificado .p12/.pfx; su contraseña se pide al ejecutar (o HILVANA_CERT_PASSWORD).
  La clave privada no sale de tu equipo. En "run", los .p12/.pfx usan esa contraseña.
Word: --engine native usa el motor integrado; libreoffice usa LibreOffice si está instalado;
      auto (por defecto) usa el integrado y recurre a LibreOffice si tuvo que omitir contenido.
Todo se procesa en tu equipo. Ningún archivo sale de él.
`,
  en: `hilvana ${VERSION}: private PDF workflows, on your machine.

Usage:
  hilvana inspect <file.pdf> [--json]
  hilvana word <document.docx> [-o <out.pdf>] [--engine auto|native|libreoffice]
  hilvana merge <a.pdf> <b.docx> ... -o <out.pdf>
  hilvana pages <file.pdf> (--keep <range> | --remove <range>) -o <out.pdf>
  hilvana rotate <file.pdf> --angle 90|180|270 [--pages <range>] -o <out.pdf>
  hilvana sign <file.pdf> --image <signature.png> [--pages last] [--anchor bottom-right] [--width 150] -o <out.pdf>
  hilvana stamp <file.pdf> --text "Received {date}" [--pages all] [--anchor top-right] -o <out.pdf>
  hilvana watermark <file.pdf> --text "CONFIDENTIAL" -o <out.pdf>
  hilvana number <file.pdf> [--format "{n} / {total}"] -o <out.pdf>
  hilvana strip <file.pdf> -o <out.pdf>
  hilvana unlock <file.pdf> [--password …] -o <out.pdf>   (removes password and restrictions)
  hilvana compress <file.pdf> [--level lossless|balanced|strong|max] [--target 2MB] -o <out.pdf>
  hilvana images <a.png> <b.jpg> ... [--page-size image|a4|letter] -o <out.pdf>
  hilvana ocr <scan.pdf> [--language spa|eng] [--force] -o <out.pdf>
  hilvana redact <file.pdf> [--find "text"]... [--pattern email,card,number,phone] [--area "page:x,y,width,height"]... [--list] -o <out.pdf>
  hilvana protect <file.pdf> [--restrict print,copy,modify] -o <out.pdf>
  hilvana certify <file.pdf> --cert <certificate.p12> [--reason "…"] [--location "…"] [--invisible] [--pages last] [--anchor bottom-right] -o <out.pdf>
  hilvana run <recipe.json> <files...> [-o <out.pdf | folder when the recipe ends with split>] [--dry-run] [--yes]
  hilvana run <recipe.json> <documents...> --each [-o <folder>]   (the recipe on each document separately)
  hilvana schema

Ranges: "1-3,5", "last", "last-1", "4-last", "odd", "even", "all".
Options: --lang es|en, --force (replace the output; never an input).
Protected PDFs: files with only usage restrictions open on their own. For files that need a password,
  use --password <password> or the HILVANA_PDF_PASSWORD variable (kept out of your shell history).
OCR: adds an invisible text layer to scanned pages so they can be searched, copied and redacted. All on your machine.
Redact: removes the text, images and shapes under each match or area from the file (not just covers them),
  then checks the result. --list only shows what it would find. Areas are in points from the bottom-left corner.
Protect: the new password is asked for when it runs (or HILVANA_NEW_PASSWORD); --restrict only removes permissions.
Digital signature: a .p12/.pfx certificate; its password is asked for when it runs (or HILVANA_CERT_PASSWORD).
  The private key never leaves your machine. In "run", .p12/.pfx inputs use that password.
Word: --engine native uses the built-in engine; libreoffice uses a local LibreOffice install;
      auto (default) uses the built-in one and falls back to LibreOffice if it had to drop content.
Everything runs on your machine. No file leaves it.
`,
};

const options = {
  output: { type: 'string', short: 'o' },
  keep: { type: 'string' },
  remove: { type: 'string' },
  angle: { type: 'string' },
  pages: { type: 'string' },
  image: { type: 'string' },
  anchor: { type: 'string' },
  width: { type: 'string' },
  text: { type: 'string' },
  format: { type: 'string' },
  'page-size': { type: 'string' },
  engine: { type: 'string' },
  level: { type: 'string' },
  target: { type: 'string' },
  lang: { type: 'string' },
  json: { type: 'boolean' },
  force: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  'dry-run': { type: 'boolean' },
  each: { type: 'boolean' },
  password: { type: 'string' },
  restrict: { type: 'string' },
  find: { type: 'string', multiple: true },
  pattern: { type: 'string' },
  area: { type: 'string', multiple: true },
  list: { type: 'boolean' },
  language: { type: 'string' },
  cert: { type: 'string' },
  reason: { type: 'string' },
  location: { type: 'string' },
  invisible: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>['values'];

function detectLang(flag?: string): Lang {
  if (flag === 'es' || flag === 'en') return flag;
  const env = process.env.HILVANA_LANG ?? process.env.LC_ALL ?? process.env.LANG ?? '';
  return env.toLowerCase().startsWith('en') ? 'en' : 'es';
}

class UsageError extends Error {}

const read = async (p: string) => new Uint8Array(await fs.readFile(p));

/** Writes a new file. Never overwrites an input (even through links); replaces other files only with --force. */
async function write(out: string, bytes: Uint8Array, inputs: string[], force: boolean | undefined, lang: Lang, openPassword?: string) {
  const target = path.resolve(out);
  try {
    await safeWrite(target, bytes, { inputs: inputs.map((i) => path.resolve(i)), overwrite: force });
  } catch (err) {
    if (err instanceof UnsafeOutputError) {
      const es = { OUTPUT_IS_INPUT: 'No sobrescribo archivos de entrada. Elige otro nombre de salida.', OUTPUT_IS_SYMLINK: `${out} es un enlace simbólico; no escribo a través de enlaces.`, OUTPUT_EXISTS: `${out} ya existe. Usa --force para reemplazarlo.` };
      const en = { OUTPUT_IS_INPUT: 'Refusing to overwrite an input file. Choose another output name.', OUTPUT_IS_SYMLINK: `${out} is a symbolic link; refusing to write through it.`, OUTPUT_EXISTS: `${out} already exists. Use --force to replace it.` };
      throw new UsageError((lang === 'es' ? es : en)[err.code]);
    }
    throw err;
  }
  const info = await core.inspect(openPassword ? (await core.unlock(bytes, openPassword)).bytes : bytes);
  const unit = lang === 'es' ? (info.pageCount === 1 ? 'página' : 'páginas') : info.pageCount === 1 ? 'page' : 'pages';
  process.stdout.write(`✓ ${out} · ${info.pageCount} ${unit} · ${(bytes.byteLength / 1024).toFixed(1)} KB\n`);
}

function defaultOutput(input: string, suffix: string): string {
  const parsed = path.parse(input);
  return path.join(parsed.dir, `${parsed.name}-${suffix}.pdf`);
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^(s|si|sí|y|yes)$/i.test(answer.trim());
}

const num = (v?: string) => (v === undefined ? undefined : Number(v));

function engineOf(v: Values, lang: Lang): WordEngine {
  const e = v.engine ?? 'auto';
  if (e === 'auto' || e === 'native' || e === 'libreoffice') return e;
  throw new UsageError(lang === 'es' ? '--engine debe ser auto, native o libreoffice.' : '--engine must be auto, native or libreoffice.');
}

function wordConverter(v: Values, lang: Lang): WordConverter {
  const engine = engineOf(v, lang);
  return async (docx) => {
    try {
      return await convertWord(docx, { engine });
    } catch (err) {
      if (String((err as Error).message).startsWith('LIBREOFFICE_NOT_FOUND')) {
        throw new UsageError(lang === 'es' ? 'No encuentro LibreOffice. Instálalo o usa --engine native.' : 'LibreOffice was not found. Install it or use --engine native.');
      }
      throw err;
    }
  };
}

/** Parses sizes like "2MB", "500 KB", "1.5mb" or a plain number of bytes. */
function parseSize(v: string, lang: Lang): number {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(b|kb|k|mb|m|gb|g)?\s*$/i.exec(v);
  if (!m) throw new UsageError(lang === 'es' ? `Tamaño no válido: "${v}". Ejemplos: 2MB, 500KB.` : `Invalid size: "${v}". Examples: 2MB, 500KB.`);
  const n = Number(m[1]!.replace(',', '.'));
  const unit = (m[2] ?? 'b').toLowerCase()[0];
  return Math.floor(n * (unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1));
}

const passwordOf = (v: Values) => v.password ?? process.env.HILVANA_PDF_PASSWORD ?? '';

/** Asks for a secret on the terminal without showing it. Returns undefined when there is no terminal. */
async function askSecret(question: string): Promise<string | undefined> {
  const stdin = process.stdin;
  if (!stdin.isTTY || !process.stderr.isTTY) return undefined;
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const done = (result: string | undefined) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      resolve(result);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(value);
        if (ch === '\u0003') { done(undefined); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Secrets come from the environment or a hidden prompt, never from a flag that stays in the shell history. */
async function secret(envName: string, question: string, lang: Lang, missing: string): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const typed = await askSecret(question);
  if (!typed) throw new UsageError(`✗ ${missing} ${lang === 'es' ? `Escríbela cuando se pida, o usa la variable ${envName}.` : `Type it when asked, or use the ${envName} variable.`}`);
  return typed;
}

const certPassword = (file: string, lang: Lang) =>
  secret('HILVANA_CERT_PASSWORD', lang === 'es' ? `Contraseña del certificado ${path.basename(file)}: ` : `Password for the certificate ${path.basename(file)}: `, lang,
    lang === 'es' ? 'Falta la contraseña del certificado.' : 'The certificate password is missing.');

const RESTRICTIONS = ['print', 'copy', 'modify'] as const;

function restrictionsOf(v: Values, lang: Lang): Set<string> {
  const list = (v.restrict ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const bad = list.filter((x) => !(RESTRICTIONS as readonly string[]).includes(x));
  if (bad.length) throw new UsageError(lang === 'es' ? `--restrict acepta print, copy y modify (no "${bad.join(', ')}").` : `--restrict takes print, copy and modify (not "${bad.join(', ')}").`);
  return new Set(list);
}

/** Opens a protected PDF here (restrictions on their own, a password when given) and says what was removed. */
async function openPdf(file: string, bytes: Uint8Array, v: Values, lang: Lang): Promise<Uint8Array> {
  const res = await core.unlock(bytes, passwordOf(v));
  if (res.protection === 'permissions') process.stderr.write(`⚠ ${t(lang, 'UNLOCKED_PERMISSIONS', { name: path.basename(file) })}\n`);
  if (res.protection === 'password') process.stderr.write(`⚠ ${t(lang, 'UNLOCKED_PASSWORD', { name: path.basename(file) })}\n`);
  return res.bytes;
}

/** Changing a signed PDF always produces a new, unsigned file: say so before the person relies on it. */
async function warnIfSigned(file: string, bytes: Uint8Array, lang: Lang) {
  const info = await core.inspect(bytes).catch(() => undefined);
  if (info && info.signatures > 0) process.stderr.write(`⚠ ${t(lang, 'SIGNED_INPUT', { name: path.basename(file) })}\n`);
}

function printWarnings(name: string, warnings: string[], lang: Lang) {
  for (const w of warnings) process.stdout.write(`  ⚠ ${name}: ${t(lang, `word.${w}`)}\n`);
}

const SINGLE = ['pages', 'rotate', 'sign', 'stamp', 'watermark', 'number', 'strip', 'unlock', 'compress'];

async function single(cmd: string, positionals: string[], v: Values, lang: Lang) {
  if (!SINGLE.includes(cmd)) throw new UsageError(`✗ ${lang === 'es' ? `Comando desconocido: "${cmd}". Usa hilvana --help.` : `Unknown command: "${cmd}". Run hilvana --help.`}`);
  const [input] = positionals;
  if (!input) throw new UsageError(HELP[lang]);
  const raw = await read(input);
  const src = await openPdf(input, raw, v, lang);
  await warnIfSigned(input, src, lang);
  const anchor = v.anchor as core.Anchor | undefined;
  let out: Uint8Array;
  switch (cmd) {
    case 'pages':
      if (!!v.keep === !!v.remove) throw new UsageError(lang === 'es' ? 'Usa --keep o --remove (uno de los dos).' : 'Use either --keep or --remove.');
      out = v.keep ? await core.selectPages(src, v.keep) : await core.removePages(src, v.remove!);
      break;
    case 'rotate': {
      const angle = Number(v.angle ?? 90);
      if (![90, 180, 270, -90].includes(angle)) throw new UsageError(lang === 'es' ? '--angle debe ser 90, 180 o 270.' : '--angle must be 90, 180 or 270.');
      out = await core.rotate(src, angle as 90, v.pages ?? 'all');
      break;
    }
    case 'sign':
      if (!v.image) throw new UsageError(lang === 'es' ? 'Falta --image <firma.png>.' : 'Missing --image <signature.png>.');
      out = await core.stampImage(src, { image: await read(v.image), pages: v.pages, anchor, width: num(v.width) });
      break;
    case 'stamp':
      if (!v.text) throw new UsageError(lang === 'es' ? 'Falta --text.' : 'Missing --text.');
      out = await core.stampText(src, { text: v.text.replace('{date}', localDate()), pages: v.pages, anchor, fonts: () => fallbackTextFonts() });
      break;
    case 'watermark':
      if (!v.text) throw new UsageError(lang === 'es' ? 'Falta --text.' : 'Missing --text.');
      out = await core.watermark(src, v.text, { pages: v.pages, fonts: () => fallbackTextFonts() });
      break;
    case 'number':
      out = await core.numberPages(src, { format: v.format, anchor, pages: v.pages, fonts: () => fallbackTextFonts() });
      break;
    case 'strip':
      out = await core.stripMetadata(src);
      break;
    case 'unlock':
      // openPdf already said what was removed; an unprotected file comes back as the same bytes.
      if (src === raw) process.stderr.write(`⚠ ${t(lang, 'NOT_PROTECTED', { name: path.basename(input) })}\n`);
      out = (await core.removeProtection(src)).bytes;
      break;
    case 'compress': {
      const level = v.level as core.CompressionLevel | undefined;
      if (level && !['lossless', 'balanced', 'strong', 'max'].includes(level)) throw new UsageError(lang === 'es' ? '--level debe ser lossless, balanced, strong o max.' : '--level must be lossless, balanced, strong or max.');
      const targetBytes = v.target ? parseSize(v.target, lang) : undefined;
      const { bytes, report } = await core.compress(src, { level, targetBytes });
      out = bytes;
      const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
      const lvl = t(lang, `level.${report.level}`);
      process.stdout.write(lang === 'es'
        ? `  ${kb(report.before)} → ${kb(report.after)} (${Math.round(100 * (1 - report.after / report.before))}% menos; nivel ${lvl}; ${report.images.recompressed} imágenes optimizadas)\n`
        : `  ${kb(report.before)} → ${kb(report.after)} (${Math.round(100 * (1 - report.after / report.before))}% smaller; ${lvl} level; ${report.images.recompressed} images optimized)\n`);
      if (report.targetMet === false) process.stdout.write(`  ⚠ ${t(lang, 'note.targetMissed', { target: kb(targetBytes!), after: kb(report.after) })}\n`);
      break;
    }
    default:
      throw new UsageError(`✗ ${lang === 'es' ? `Comando desconocido: "${cmd}". Usa hilvana --help.` : `Unknown command: "${cmd}". Run hilvana --help.`}`);
  }
  await write(v.output ?? defaultOutput(input, cmd), out, [input, ...(v.image ? [v.image] : [])], v.force, lang);
}

/** `run --each`: the recipe on each document separately, every result into one folder. */
async function runEach(recipe: unknown, files: { name: string; bytes: Uint8Array; password?: string }[], inputs: string[], v: Values, lang: Lang, word: WordConverter) {
  const p = await planBatch(recipe, files, { lang, word });
  process.stdout.write(p.steps.join('\n') + '\n');
  if (p.items.length) process.stdout.write((lang === 'es' ? `Para cada uno de ${p.items.length} documentos.` : `For each of ${p.items.length} documents.`) + '\n');
  for (const w of p.warnings) process.stdout.write(`  ⚠ ${w}\n`);
  // Documents that cannot run are reported and skipped; only a broken recipe stops the batch.
  const fatal = p.issues.filter((i) => !p.items.length || i.code === 'SCHEMA' || i.code.startsWith('BATCH_') || i.code === 'NO_PDF_INPUTS');
  if (fatal.length) throw new RecipeError(fatal);
  for (const i of p.issues) process.stdout.write(`  ✗ ${i.message}\n`);
  if (v['dry-run']) return;
  let confirmed = !!v.yes;
  if (p.destructiveSteps.length > 0 && !confirmed) {
    confirmed = await confirm(lang === 'es' ? '¿Ejecutar? Hay pasos que eliminan contenido [s/N] ' : 'Run it? Some steps remove content [y/N] ');
    if (!confirmed) throw new RecipeError([{ code: 'CONFIRMATION_REQUIRED', message: t(lang, 'CONFIRMATION_REQUIRED', { steps: p.destructiveSteps.join(', ') }) + (lang === 'es' ? ' (usa --yes)' : ' (use --yes)') }]);
  }
  const res = await runBatch(recipe, files, { lang, confirmed, word });
  const dir = v.output ?? path.dirname(inputs[0]!);
  await fs.mkdir(dir, { recursive: true });
  for (const o of res.outputs) await write(path.join(dir, o.filename), o.bytes, inputs, v.force, lang);
  for (const item of res.items) for (const i of item.issues ?? []) process.stderr.write(`✗ ${i.message}\n`);
  process.stdout.write(`  ${t(lang, 'batch.done', { ok: res.succeeded, total: res.items.length })}\n`);
  if (res.failed > 0) process.exitCode = 1;
  else if (res.items.some((i) => i.result && !i.result.allGoalsMet)) process.exitCode = 3;
}

async function main(argv: string[]) {
  const { values: v, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const lang = detectLang(v.lang);
  const [cmd, ...rest] = positionals;
  if (v.version) return void process.stdout.write(VERSION + '\n');
  if (v.help || !cmd) return void process.stdout.write(HELP[lang]);

  switch (cmd) {
    case 'inspect': {
      if (!rest[0]) throw new UsageError(HELP[lang]);
      const raw = await read(rest[0]);
      const open = await core.unlock(raw, passwordOf(v));
      const info = { ...(await core.inspect(open.bytes)), byteLength: raw.byteLength, encrypted: open.protection !== 'none', protection: open.protection };
      if (v.json) return void process.stdout.write(JSON.stringify(info, null, 2) + '\n');
      const lines = lang === 'es'
        ? [`Páginas: ${info.pageCount}`, `Tamaño: ${(info.byteLength / 1024).toFixed(1)} KB`, `Protegido: ${{ none: 'no', permissions: 'sí, solo restricciones de uso', password: 'sí, con contraseña' }[info.protection]}`, `Metadatos: ${info.hasMetadata ? JSON.stringify(info.metadata) : 'ninguno'}`, `Firmas digitales: ${info.signatures}`, ...(info.missingPages ? [`⚠ Dañado: ${info.missingPages} página(s) declarada(s) no se pudieron leer`] : [])]
        : [`Pages: ${info.pageCount}`, `Size: ${(info.byteLength / 1024).toFixed(1)} KB`, `Encrypted: ${{ none: 'no', permissions: 'yes, usage restrictions only', password: 'yes, with a password' }[info.protection]}`, `Metadata: ${info.hasMetadata ? JSON.stringify(info.metadata) : 'none'}`, `Digital signatures: ${info.signatures}`, ...(info.missingPages ? [`⚠ Damaged: ${info.missingPages} declared page(s) could not be read`] : [])];
      return void process.stdout.write(lines.join('\n') + '\n');
    }
    case 'word': {
      const [input] = rest;
      if (!input) throw new UsageError(HELP[lang]);
      const bytes = await read(input);
      if (!isDocx(bytes)) throw new UsageError(`✗ ${t(lang, 'NOT_DOCX', { name: path.basename(input) })}`);
      const res = await wordConverter(v, lang)(bytes);
      const parsed = path.parse(input);
      await write(v.output ?? path.join(parsed.dir, `${parsed.name}.pdf`), res.pdf, [input], v.force, lang);
      if (res.engine) process.stdout.write(`  ${lang === 'es' ? 'Motor' : 'Engine'}: ${res.engine === 'native' ? 'Hilvana' : 'LibreOffice'}\n`);
      printWarnings(path.basename(input), res.warnings, lang);
      return;
    }
    case 'merge': {
      if (rest.length < 1) throw new UsageError(HELP[lang]);
      const convert = wordConverter(v, lang);
      const parts: Uint8Array[] = [];
      for (const p of rest) {
        const bytes = await read(p);
        if (isDocx(bytes)) {
          const res = await convert(bytes);
          printWarnings(path.basename(p), res.warnings, lang);
          parts.push(res.pdf);
        } else {
          const open = await openPdf(p, bytes, v, lang);
          await warnIfSigned(p, open, lang);
          parts.push(open);
        }
      }
      const out = await core.merge(parts);
      return write(v.output ?? defaultOutput(rest[0]!, 'merged'), out, rest, v.force, lang);
    }
    case 'images': {
      if (rest.length < 1) throw new UsageError(HELP[lang]);
      const out = await core.imagesToPdf(await Promise.all(rest.map(read)), { pageSize: v['page-size'] as 'a4' | undefined });
      return write(v.output ?? defaultOutput(rest[0]!, 'images'), out, rest, v.force, lang);
    }
    case 'ocr': {
      const [input] = rest;
      if (!input) throw new UsageError(HELP[lang]);
      const language = v.language ?? 'spa';
      if (language !== 'spa' && language !== 'eng') throw new UsageError(lang === 'es' ? '--language debe ser spa o eng.' : '--language must be spa or eng.');
      const src = await openPdf(input, await read(input), v, lang);
      await warnIfSigned(input, src, lang);
      const { bytes, report } = await makeSearchable(src, {
        lang: language,
        force: v.force,
        onPage: (done, total) => { if (process.stderr.isTTY) process.stderr.write(`\r  OCR ${done}/${total}`); if (done === total && process.stderr.isTTY) process.stderr.write('\n'); },
      });
      if (!report.pages.length) {
        process.stdout.write(`  ${t(lang, report.unreadable.length ? 'note.ocrUnreadable' : 'note.ocrNone', { pages: report.unreadable.join(', ') })}\n`);
        return;
      }
      await write(v.output ?? defaultOutput(input, 'ocr'), bytes, [input], v.force, lang);
      process.stdout.write(`  ${t(lang, 'note.ocr', { pages: report.pages.join(', '), words: report.words, confidence: Math.round(report.confidence * 100) })}\n`);
      process.stdout.write(`  ${t(lang, 'note.ocrCheck')}\n`);
      if (report.unreadable.length) process.stdout.write(`  ⚠ ${t(lang, 'note.ocrUnreadable', { pages: report.unreadable.join(', ') })}\n`);
      return;
    }
    case 'redact': {
      const [input] = rest;
      if (!input) throw new UsageError(HELP[lang]);
      const PATTERNS = ['email', 'card', 'number', 'phone'] as const;
      const patterns = (v.pattern ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const bad = patterns.filter((x) => !(PATTERNS as readonly string[]).includes(x));
      if (bad.length) throw new UsageError(lang === 'es' ? `--pattern acepta email, card, number y phone (no "${bad.join(', ')}").` : `--pattern takes email, card, number and phone (not "${bad.join(', ')}").`);
      const areas = (v.area ?? []).map((spec) => {
        const m = /^\s*(\d+)\s*:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*$/.exec(spec);
        if (!m) throw new UsageError(lang === 'es' ? `Área no válida: "${spec}". Formato: página:x,y,ancho,alto (por ejemplo 1:72,700,200,20).` : `Invalid area: "${spec}". Format: page:x,y,width,height (for example 1:72,700,200,20).`);
        return { page: Number(m[1]), x: Number(m[2]), y: Number(m[3]), width: Number(m[4]), height: Number(m[5]) };
      });
      const terms = v.find ?? [];
      if (!terms.length && !patterns.length && !areas.length) throw new UsageError(lang === 'es' ? '✗ Di qué tachar: --find, --pattern o --area.' : '✗ Say what to redact: --find, --pattern or --area.');
      const src = await openPdf(input, await read(input), v, lang);
      await warnIfSigned(input, src, lang);
      const matches = terms.length || patterns.length ? await core.findText(src, { terms, patterns: patterns as core.RedactPattern[] }) : [];
      for (const m of matches) process.stdout.write(`  ${lang === 'es' ? 'pág.' : 'p.'} ${m.page}: ${m.text}\n`);
      process.stdout.write(lang === 'es' ? `  ${matches.length} coincidencias, ${areas.length} áreas.\n` : `  ${matches.length} matches, ${areas.length} areas.\n`);
      if (v.list) return;
      const all = [...matches.flatMap((m) => m.areas), ...areas];
      if (!all.length) return void process.stdout.write(`  ${t(lang, 'note.redactNothing')}\n`);
      const { bytes, report } = await core.redact(src, { areas: all });
      await write(v.output ?? defaultOutput(input, 'redacted'), bytes, [input], v.force, lang);
      process.stdout.write(`  ${t(lang, 'note.redactChecked')}\n`);
      if (report.imagesRemoved) process.stdout.write(`  ${t(lang, 'note.redactImagesRemoved', { count: report.imagesRemoved })}\n`);
      if (report.structureRemoved) process.stdout.write(`  ${t(lang, 'note.redactStructure')}\n`);
      return;
    }
    case 'protect': {
      const [input] = rest;
      if (!input) throw new UsageError(HELP[lang]);
      const restricted = restrictionsOf(v, lang);
      let password = process.env.HILVANA_NEW_PASSWORD;
      if (!password && restricted.size === 0) {
        const first = await askSecret(lang === 'es' ? 'Contraseña nueva: ' : 'New password: ');
        if (first) {
          const again = await askSecret(lang === 'es' ? 'Repítela: ' : 'Repeat it: ');
          if (again !== first) throw new UsageError(lang === 'es' ? '✗ Las contraseñas no coinciden.' : '✗ The passwords do not match.');
          password = first;
        }
      }
      if (!password && restricted.size === 0) {
        throw new UsageError(lang === 'es'
          ? '✗ Nada que proteger: escribe una contraseña cuando se pida (o usa HILVANA_NEW_PASSWORD), o usa --restrict.'
          : '✗ Nothing to protect: type a password when asked (or use HILVANA_NEW_PASSWORD), or use --restrict.');
      }
      const src = await openPdf(input, await read(input), v, lang);
      await warnIfSigned(input, src, lang);
      const out = await core.protect(src, { password, allowPrint: !restricted.has('print'), allowCopy: !restricted.has('copy'), allowModify: !restricted.has('modify') });
      await write(v.output ?? defaultOutput(input, 'protected'), out, [input], v.force, lang, password);
      if (password) process.stdout.write(`  ${t(lang, 'note.protected')}\n`);
      return;
    }
    case 'certify': {
      const [input] = rest;
      if (!input) throw new UsageError(HELP[lang]);
      if (!v.cert) throw new UsageError(lang === 'es' ? 'Falta --cert <certificado.p12>.' : 'Missing --cert <certificate.p12>.');
      const certificate = await read(v.cert);
      const password = await certPassword(v.cert, lang);
      const raw = await read(input);
      // Signed files are signed as they are, so their signatures (and any protection) stay valid.
      const opened = await core.unlock(raw, passwordOf(v));
      const who = await core.readCertificate(certificate, password);
      const res = await core.signWithCertificate(raw, {
        certificate,
        password,
        openPassword: passwordOf(v) || undefined,
        reason: v.reason,
        location: v.location,
        visible: v.invisible ? false : { text: t(lang, 'visible.signed', { name: who.name, date: localDate() }), pages: v.pages, anchor: v.anchor as core.Anchor | undefined, fonts: () => fallbackTextFonts() },
      });
      const name = path.basename(input);
      if (res.protection !== 'none') process.stderr.write(`⚠ ${t(lang, 'PROTECTION_KEPT', { name })}\n`);
      else if (opened.protection === 'permissions') process.stderr.write(`⚠ ${t(lang, 'UNLOCKED_PERMISSIONS', { name })}\n`);
      else if (opened.protection === 'password') process.stderr.write(`⚠ ${t(lang, 'UNLOCKED_PASSWORD', { name })}\n`);
      await write(v.output ?? defaultOutput(input, 'signed'), res.bytes, [input, v.cert], v.force, lang, res.protection === 'password' ? passwordOf(v) : undefined);
      process.stdout.write(`  ${t(lang, 'note.signed', { name: res.signer.name, issuer: res.signer.issuer, to: localDate(res.signer.validTo) })}\n`);
      if (res.previousSignatures > 0) process.stdout.write(`  ${t(lang, 'SIGNATURES_KEPT', { name })}\n`);
      else if (!res.visible) process.stdout.write(`  ${t(lang, 'note.signedInvisible')}\n`);
      if (res.signer.selfSigned) process.stdout.write(`  ⚠ ${t(lang, 'SELF_SIGNED_CERTIFICATE', { name: path.basename(v.cert) })}\n`);
      return;
    }
    case 'schema':
      return void process.stdout.write(JSON.stringify(recipeJsonSchema(), null, 2) + '\n');
    case 'run': {
      const [recipePath, ...inputs] = rest;
      if (!recipePath || inputs.length === 0) throw new UsageError(HELP[lang]);
      let recipe: unknown;
      try {
        recipe = JSON.parse(await fs.readFile(recipePath, 'utf8'));
      } catch (err) {
        if (err instanceof SyntaxError) throw new UsageError(`✗ ${lang === 'es' ? 'La receta no es un JSON válido' : 'The recipe is not valid JSON'}: ${err.message}`);
        throw err;
      }
      const password = passwordOf(v) || undefined;
      const isCert = (p: string) => /\.(p12|pfx)$/i.test(p);
      const certPw = inputs.some(isCert) ? await certPassword(inputs.find(isCert)!, lang) : undefined;
      const files = await Promise.all(inputs.map(async (p) => ({ name: path.basename(p), bytes: await read(p), password: isCert(p) ? certPw : password })));
      const word = wordConverter(v, lang);
      if (v.each) return runEach(recipe, files, inputs, v, lang, word);
      const p = await plan(recipe, files, { lang, word });
      process.stdout.write(p.steps.join('\n') + '\n');
      if (p.goals.length) process.stdout.write((lang === 'es' ? 'Objetivos:\n' : 'Goals:\n') + p.goals.map((g) => `  • ${g}`).join('\n') + '\n');
      for (const w of p.warnings) process.stdout.write(`  ⚠ ${w}\n`);
      if (!p.ok) throw new RecipeError(p.issues);
      if (v['dry-run']) return;
      let confirmed = !!v.yes;
      if (p.destructiveSteps.length > 0 && !confirmed) {
        confirmed = await confirm(lang === 'es' ? '¿Ejecutar? Hay pasos que eliminan contenido [s/N] ' : 'Run it? Some steps remove content [y/N] ');
        if (!confirmed) throw new RecipeError([{ code: 'CONFIRMATION_REQUIRED', message: t(lang, 'CONFIRMATION_REQUIRED', { steps: p.destructiveSteps.join(', ') }) + (lang === 'es' ? ' (usa --yes)' : ' (use --yes)') }]);
      }
      const res = await run(recipe, files, { lang, confirmed, word });
      if (res.outputs.length > 1) {
        // A recipe that ends with split writes its parts into a folder (-o), created if needed.
        const dir = v.output ?? path.dirname(inputs[0]!);
        await fs.mkdir(dir, { recursive: true });
        for (const o of res.outputs) await write(path.join(dir, o.filename), o.bytes, inputs, v.force, lang);
      } else {
        const outPath = v.output ?? path.join(path.dirname(inputs[0]!), res.filename);
        const last = p.recipe!.steps.at(-1)!;
        await write(outPath, res.bytes, inputs, v.force, lang, last.op === 'protect' ? last.password : undefined);
      }
      for (const n of res.notes) process.stdout.write(`  ${n}\n`);
      for (const g of res.goals) process.stdout.write(`  ${g.message}\n`);
      if (!res.allGoalsMet) process.exitCode = 3;
      return;
    }
    default:
      return single(cmd, rest, v, lang);
  }
}

// Piping into `head` and similar closes stdout early; that is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') process.exit(0); throw err; });

main(process.argv.slice(2)).catch((err) => {
  const lang = detectLang(process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : undefined);
  if (err instanceof UsageError) process.stderr.write(err.message + '\n');
  else if (err instanceof RecipeError) process.stderr.write(err.issues.map((i) => `✗ ${i.step ? `[${i.step}] ` : ''}${i.message}`).join('\n') + '\n');
  else if (err instanceof HilvanaError) {
    process.stderr.write(`✗ ${t(lang, err.code, err.details)}\n`);
    if (err.code === 'PASSWORD_REQUIRED' || err.code === 'WRONG_PASSWORD') {
      process.stderr.write(lang === 'es' ? '  Usa --password <contraseña> (o la variable HILVANA_PDF_PASSWORD).\n' : '  Use --password <password> (or the HILVANA_PDF_PASSWORD variable).\n');
    }
  }
  else if ((err as { name?: string }).name === 'DocxError') process.stderr.write(`✗ ${t(lang, (err as { code: string }).code, { name: 'docx' })}\n`);
  else if ((err as NodeJS.ErrnoException).code === 'ENOENT') process.stderr.write(`✗ ${(lang === 'es' ? 'No encuentro el archivo: ' : 'File not found: ') + (err as NodeJS.ErrnoException).path}\n`);
  else process.stderr.write(`✗ ${(err as Error).message}\n`);
  process.exit(err instanceof UsageError ? 2 : 1);
});
