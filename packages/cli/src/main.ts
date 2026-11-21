#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import * as core from '@hilvana/core';
import { UnsafeOutputError, safeWrite } from './safewrite.js';
import { HilvanaError } from '@hilvana/core';
import { convertWord, fallbackTextFonts, isDocx, type WordEngine } from '@hilvana/office';
import { RecipeError, localDate, plan, recipeJsonSchema, run, t, type Lang, type WordConverter } from '@hilvana/recipes';

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
  hilvana compress <archivo.pdf> [--level lossless|balanced|strong|max] [--target 2MB] -o <salida.pdf>
  hilvana images <a.png> <b.jpg> ... [--page-size image|a4|letter] -o <salida.pdf>
  hilvana run <receta.json> <archivos...> [-o <salida.pdf>] [--dry-run] [--yes]
  hilvana schema

Rangos: "1-3,5", "last", "last-1", "4-last", "odd", "even", "all".
Opciones: --lang es|en, --force (reemplaza la salida; nunca una entrada).
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
  hilvana compress <file.pdf> [--level lossless|balanced|strong|max] [--target 2MB] -o <out.pdf>
  hilvana images <a.png> <b.jpg> ... [--page-size image|a4|letter] -o <out.pdf>
  hilvana run <recipe.json> <files...> [-o <out.pdf>] [--dry-run] [--yes]
  hilvana schema

Ranges: "1-3,5", "last", "last-1", "4-last", "odd", "even", "all".
Options: --lang es|en, --force (replace the output; never an input).
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
async function write(out: string, bytes: Uint8Array, inputs: string[], force: boolean | undefined, lang: Lang) {
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
  const info = await core.inspect(bytes);
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

function printWarnings(name: string, warnings: string[], lang: Lang) {
  for (const w of warnings) process.stdout.write(`  ⚠ ${name}: ${t(lang, `word.${w}`)}\n`);
}

const SINGLE = ['pages', 'rotate', 'sign', 'stamp', 'watermark', 'number', 'strip', 'compress'];

async function single(cmd: string, positionals: string[], v: Values, lang: Lang) {
  if (!SINGLE.includes(cmd)) throw new UsageError(`✗ ${lang === 'es' ? `Comando desconocido: "${cmd}". Usa hilvana --help.` : `Unknown command: "${cmd}". Run hilvana --help.`}`);
  const [input] = positionals;
  if (!input) throw new UsageError(HELP[lang]);
  const src = await read(input);
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

async function main(argv: string[]) {
  const { values: v, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const lang = detectLang(v.lang);
  const [cmd, ...rest] = positionals;
  if (v.version) return void process.stdout.write(VERSION + '\n');
  if (v.help || !cmd) return void process.stdout.write(HELP[lang]);

  switch (cmd) {
    case 'inspect': {
      if (!rest[0]) throw new UsageError(HELP[lang]);
      const info = await core.inspect(await read(rest[0]));
      if (v.json) return void process.stdout.write(JSON.stringify(info, null, 2) + '\n');
      const lines = lang === 'es'
        ? [`Páginas: ${info.pageCount}`, `Tamaño: ${(info.byteLength / 1024).toFixed(1)} KB`, `Protegido: ${info.encrypted ? 'sí' : 'no'}`, `Metadatos: ${info.hasMetadata ? JSON.stringify(info.metadata) : 'ninguno'}`]
        : [`Pages: ${info.pageCount}`, `Size: ${(info.byteLength / 1024).toFixed(1)} KB`, `Encrypted: ${info.encrypted ? 'yes' : 'no'}`, `Metadata: ${info.hasMetadata ? JSON.stringify(info.metadata) : 'none'}`];
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
        } else parts.push(bytes);
      }
      const out = await core.merge(parts);
      return write(v.output ?? defaultOutput(rest[0]!, 'merged'), out, rest, v.force, lang);
    }
    case 'images': {
      if (rest.length < 1) throw new UsageError(HELP[lang]);
      const out = await core.imagesToPdf(await Promise.all(rest.map(read)), { pageSize: v['page-size'] as 'a4' | undefined });
      return write(v.output ?? defaultOutput(rest[0]!, 'images'), out, rest, v.force, lang);
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
      const files = await Promise.all(inputs.map(async (p) => ({ name: path.basename(p), bytes: await read(p) })));
      const word = wordConverter(v, lang);
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
      const outPath = v.output ?? path.join(path.dirname(inputs[0]!), res.filename);
      await write(outPath, res.bytes, inputs, v.force, lang);
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
  else if (err instanceof HilvanaError) process.stderr.write(`✗ ${t(lang, err.code, err.details)}\n`);
  else if ((err as { name?: string }).name === 'DocxError') process.stderr.write(`✗ ${t(lang, (err as { code: string }).code, { name: 'docx' })}\n`);
  else if ((err as NodeJS.ErrnoException).code === 'ENOENT') process.stderr.write(`✗ ${(lang === 'es' ? 'No encuentro el archivo: ' : 'File not found: ') + (err as NodeJS.ErrnoException).path}\n`);
  else process.stderr.write(`✗ ${(err as Error).message}\n`);
  process.exit(err instanceof UsageError ? 2 : 1);
});
