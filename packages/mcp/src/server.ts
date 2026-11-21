import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { inspect } from '@hilvana/core';
import { convertWord, type WordEngine } from '@hilvana/office';
import { RecipeError, kindOf, plan, recipeJsonSchema, run, t, type InputFile, type Lang, type WordConverter } from '@hilvana/recipes';
import { FolderGuard } from './fsguard.js';
import { safeWrite } from './safewrite.js';

// Read from the package itself (dist/ sits next to package.json), so it never drifts from the release.
export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const PRIVACY_NOTE =
  'All processing happens on this computer. Hilvana never uploads files and never returns page text or images, only structure (page count, sizes, metadata presence).';

const fileRef = z.object({
  path: z.string().describe('Path to the file, inside an allowed folder. Relative paths start at the first allowed folder.'),
  name: z.string().optional().describe('Name the recipe uses for this file. Defaults to the file name.'),
});

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

async function loadFiles(guard: FolderGuard, refs: { path: string; name?: string }[]) {
  const files: InputFile[] = [];
  const realPaths: string[] = [];
  for (const ref of refs) {
    const real = await guard.readable(ref.path);
    realPaths.push(real);
    files.push({ name: ref.name ?? path.basename(real), bytes: new Uint8Array(await fs.readFile(real)) });
  }
  const names = files.map((f) => f.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`Two inputs share the name "${dup}". Give them distinct names.`);
  return { files, realPaths };
}

const engineInput = z.enum(['auto', 'native', 'libreoffice']).optional()
  .describe('Word engine. native: built-in; libreoffice: local LibreOffice install; auto (default): built-in, falling back to LibreOffice if content had to be dropped. All local.');

function converter(engine: WordEngine | undefined): WordConverter {
  return (docx) => convertWord(docx, { engine: engine ?? 'auto' });
}

export function createServer(guard: FolderGuard, defaults: { lang?: Lang; engine?: WordEngine } = {}): McpServer {
  const server = new McpServer(
    { name: 'hilvana', version: VERSION },
    {
      instructions: [
        'Hilvana runs PDF workflows locally as recipes: a JSON list of steps (merge, select, remove, rotate, stampText, sign, watermark, numberPages, stripMetadata, setMetadata, optimize, fromImages) plus optional goals (maxBytes, pageCount, maxPages, noMetadata).',
        'To make files smaller use the compress step: {"op":"compress"} with goals.maxBytes aims for that size automatically; levels are lossless, balanced (150 dpi images, default), strong (110 dpi) and max (72 dpi). Text is never rasterized.',
        'Word documents (.docx) are accepted anywhere a PDF is: they are converted locally first. Use word_to_pdf for a plain conversion, or include .docx files in a recipe (e.g. merge a .docx with PDFs).',
        'Workflow: 1) pdf_list or pdf_inspect to learn page counts; 2) recipe_plan to validate and show the user the steps; 3) recipe_run. Steps marked destructive (select, remove, stripMetadata, setMetadata) need confirm=true, and you should only set it after the user agrees.',
        'Inputs are never modified; results are written to a new file. ' + PRIVACY_NOTE,
        `Allowed folders: ${guard.roots.join(', ')}`,
      ].join('\n'),
    },
  );

  server.registerResource(
    'recipe-schema',
    'hilvana://recipe-schema',
    { title: 'Hilvana recipe JSON Schema', description: 'The schema every recipe must follow (version 1).', mimeType: 'application/schema+json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/schema+json', text: JSON.stringify(recipeJsonSchema(), null, 2) }] }),
  );

  server.registerTool(
    'pdf_list',
    {
      title: 'List PDFs and images',
      description: 'Lists PDF, Word (.docx) and image files (PNG/JPEG) in an allowed folder, with page counts for PDFs. Does not read content.',
      inputSchema: { folder: z.string().optional().describe('Folder to list. Defaults to the first allowed folder.') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ folder }) => {
      try {
        const dir = await guard.folder(folder ?? guard.roots[0]!);
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const rows: unknown[] = [];
        // Regular files only: symlinks are skipped so listing can never read outside the allowed folders.
        for (const e of entries.filter((x) => x.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
          if (!/\.(pdf|docx|png|jpe?g)$/i.test(e.name) || e.name.startsWith('~$')) continue;
          const full = path.join(dir, e.name);
          const bytes = new Uint8Array(await fs.readFile(full));
          const kind = kindOf(bytes);
          let pages: number | undefined;
          if (kind === 'pdf') pages = await inspect(bytes).then((i) => i.pageCount, () => undefined);
          rows.push({ name: e.name, path: full, kind, bytes: bytes.byteLength, pages });
        }
        return text({ folder: dir, files: rows });
      } catch (err) {
        return fail(String((err as Error).message));
      }
    },
  );

  server.registerTool(
    'pdf_inspect',
    {
      title: 'Inspect a PDF',
      description: 'Returns structure only: page count, page sizes and rotation, encryption, metadata fields and file size. Never returns text or images.',
      inputSchema: { path: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: p }) => {
      try {
        const real = await guard.readable(p);
        return text({ path: real, ...(await inspect(new Uint8Array(await fs.readFile(real)))) });
      } catch (err) {
        return fail(String((err as Error).message));
      }
    },
  );

  const recipeInput = z.record(z.string(), z.unknown()).describe('A Hilvana recipe object (see resource hilvana://recipe-schema). Example: {"version":1,"steps":[{"op":"merge"},{"op":"sign","image":"firma.png"}],"goals":{"maxBytes":2000000}}');
  const langInput = z.enum(['es', 'en']).optional().describe('Language for the step descriptions and messages.');

  server.registerTool(
    'recipe_plan',
    {
      title: 'Validate and explain a recipe',
      description: 'Checks a recipe against the actual files without changing anything: schema, file names, page ranges after each step, and which steps are destructive. Returns the steps in plain language to show the user before running.',
      inputSchema: { recipe: recipeInput, files: z.array(fileRef).min(1), lang: langInput, engine: engineInput },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ recipe, files: refs, lang, engine }) => {
      try {
        const { files } = await loadFiles(guard, refs);
        const p = await plan(recipe, files, { lang: lang ?? defaults.lang ?? 'es', word: converter(engine ?? defaults.engine) });
        const { recipe: _ignored, ...rest } = p;
        return text(rest);
      } catch (err) {
        return fail(String((err as Error).message));
      }
    },
  );

  server.registerTool(
    'recipe_run',
    {
      title: 'Run a recipe',
      description:
        'Runs a recipe locally and writes the result to a NEW file (or, when the recipe ends with split, one new file per part in the output folder), then verifies the goals. Inputs are never modified. If the recipe has destructive steps it returns the plan and asks for confirmation instead of running; set confirm=true only after the user agreed.',
      inputSchema: {
        recipe: recipeInput,
        files: z.array(fileRef).min(1),
        output: z.string().describe('Path of the new PDF, inside an allowed folder. Must not be an input. When the recipe ends with a split step, an existing folder for the parts instead.'),
        confirm: z.boolean().optional().describe('Required when the recipe has destructive steps, after the user agreed.'),
        overwrite: z.boolean().optional().describe('Replace the output if it already exists (never an input).'),
        lang: langInput,
        engine: engineInput,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ recipe, files: refs, output, confirm, overwrite, lang, engine }) => {
      const l = lang ?? defaults.lang ?? 'es';
      const word = converter(engine ?? defaults.engine);
      try {
        const { files, realPaths } = await loadFiles(guard, refs);
        const p = await plan(recipe, files, { lang: l, word });
        if (!p.ok) return fail(JSON.stringify({ ok: false, issues: p.issues }, null, 2));
        const splits = p.recipe?.steps.at(-1)?.op === 'split';
        const folder = splits ? await guard.folder(output) : undefined;
        const target = splits ? undefined : await guard.writable(output, { inputs: realPaths, overwrite });
        if (p.destructiveSteps.length > 0 && !confirm) {
          return text({
            ran: false,
            needsConfirmation: true,
            message: l === 'es'
              ? 'La receta elimina contenido o información. Muéstrale estos pasos al usuario y vuelve a llamar con confirm=true si está de acuerdo.'
              : 'This recipe removes content or information. Show these steps to the user and call again with confirm=true if they agree.',
            steps: p.steps,
            destructiveSteps: p.destructiveSteps,
          });
        }
        const res = await run(recipe, files, { lang: l, confirmed: true, word });
        // Check every destination before writing any, so a refused name never leaves half the parts behind.
        const targets = folder
          ? await Promise.all(res.outputs.map((o) => guard.writable(path.join(folder, o.filename), { inputs: realPaths, overwrite })))
          : [target!];
        for (const [i, t] of targets.entries()) await safeWrite(t, res.outputs[i]!.bytes, { inputs: realPaths, overwrite });
        return text({
          ran: true,
          output: folder ?? target,
          outputs: res.outputs.map((o, i) => ({ path: targets[i], pageCount: o.pageCount, bytes: o.byteLength })),
          pageCount: res.pageCount,
          bytes: res.byteLength,
          allGoalsMet: res.allGoalsMet,
          goals: res.goals.map((g) => g.message),
          steps: res.steps,
          warnings: res.warnings,
          notes: res.notes,
        });
      } catch (err) {
        if (err instanceof RecipeError) return fail(JSON.stringify({ ok: false, issues: err.issues }, null, 2));
        return fail(String((err as Error).message));
      }
    },
  );

  server.registerTool(
    'word_to_pdf',
    {
      title: 'Convert Word to PDF',
      description: 'Converts a Word document (.docx) to a NEW PDF on this computer, with real, selectable text. Returns the page count and any simplifications made (e.g. skipped text boxes). Never uploads the file.',
      inputSchema: {
        path: z.string().describe('The .docx file, inside an allowed folder.'),
        output: z.string().optional().describe('Path of the new PDF. Defaults to the same name with .pdf.'),
        engine: engineInput,
        overwrite: z.boolean().optional(),
        lang: langInput,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: p, output, engine, overwrite, lang }) => {
      const l = lang ?? defaults.lang ?? 'es';
      try {
        const input = await guard.readable(p);
        const bytes = new Uint8Array(await fs.readFile(input));
        if (kindOf(bytes) !== 'word') return fail(t(l, 'NOT_DOCX', { name: path.basename(input) }));
        const target = await guard.writable(output ?? input.replace(/\.docx$/i, '.pdf'), { inputs: [input], overwrite });
        const res = await converter(engine ?? defaults.engine)(bytes);
        await safeWrite(target, res.pdf, { inputs: [input], overwrite });
        return text({
          output: target,
          pageCount: res.pageCount,
          bytes: res.pdf.byteLength,
          engine: res.engine,
          warnings: res.warnings.map((w) => t(l, `word.${w}`)),
        });
      } catch (err) {
        const e = err as { name?: string; code?: string; message: string };
        if (e.name === 'DocxError' && e.code) return fail(t(l, e.code, { name: path.basename(p) }));
        if (e.message.startsWith('LIBREOFFICE_NOT_FOUND')) return fail(l === 'es' ? 'LibreOffice no está instalado en este equipo. Usa engine "native".' : 'LibreOffice is not installed on this computer. Use engine "native".');
        return fail(e.message);
      }
    },
  );

  return server;
}
