import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FolderGuard } from '../src/fsguard.js';
import { createServer } from '../src/server.js';
import { TINY_PNG, makePdf } from '../../core/test/helpers.js';
import { sampleContract } from '../../office/test/fixtures.js';

let dir: string;
let outside: string;
let client: Client;
let hasSymlink = true;

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult;
const json = (r: ToolResult) => JSON.parse(r.content[0]!.text);

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hilvana-mcp-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hilvana-outside-'));
  await fs.writeFile(path.join(dir, 'a.pdf'), await makePdf(2, { author: 'Ana' }));
  await fs.writeFile(path.join(dir, 'b.pdf'), await makePdf(3));
  await fs.writeFile(path.join(dir, 'firma.png'), TINY_PNG);
  await fs.writeFile(path.join(dir, 'contrato.docx'), await sampleContract());
  await fs.writeFile(path.join(outside, 'secret.pdf'), await makePdf(1));
  // Windows CI runners usually cannot create symlinks without admin rights.
  await fs.symlink(path.join(outside, 'secret.pdf'), path.join(dir, 'link.pdf')).catch(() => { hasSymlink = false; });

  const server = createServer(await FolderGuard.create([dir]), { lang: 'en', engine: 'native' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client?.close();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe('hilvana-mcp', () => {
  it('exposes the tools and the recipe schema', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['pdf_inspect', 'pdf_list', 'recipe_plan', 'recipe_run', 'word_to_pdf']);
    const res = await client.readResource({ uri: 'hilvana://recipe-schema' });
    expect((res.contents[0] as { text: string }).text).toContain('"steps"');
  });

  it('lists regular files with page counts and skips symlinks', async () => {
    const res = json(await call('pdf_list', {}));
    expect(res.files.map((f: { name: string; pages?: number }) => [f.name, f.pages])).toEqual([
      ['a.pdf', 2], ['b.pdf', 3], ['contrato.docx', undefined], ['firma.png', undefined],
    ]);
  });

  it('refuses paths outside the allowed folders, including through symlinks', async () => {
    expect((await call('pdf_inspect', { path: path.join(outside, 'secret.pdf') })).isError).toBe(true);
    if (!hasSymlink) return;
    const viaLink = await call('pdf_inspect', { path: 'link.pdf' });
    expect(viaLink.isError).toBe(true);
    expect(viaLink.content[0]!.text).toMatch(/Outside the allowed folders/);
  });

  it('plans without writing anything', async () => {
    const before = await fs.readdir(dir);
    const res = json(await call('recipe_plan', {
      recipe: { version: 1, steps: [{ op: 'merge' }, { op: 'sign', image: 'firma.png' }] },
      files: [{ path: 'a.pdf' }, { path: 'b.pdf' }, { path: 'firma.png' }],
    }));
    expect(res.ok).toBe(true);
    expect(res.steps).toHaveLength(2);
    expect(await fs.readdir(dir)).toEqual(before);
  });

  it('runs a recipe into a new file and verifies goals', async () => {
    const res = json(await call('recipe_run', {
      recipe: { version: 1, steps: [{ op: 'merge' }, { op: 'numberPages' }, { op: 'sign', image: 'firma.png' }], goals: { pageCount: 5 } },
      files: [{ path: 'a.pdf' }, { path: 'b.pdf' }, { path: 'firma.png' }],
      output: 'out.pdf',
    }));
    expect(res).toMatchObject({ ran: true, pageCount: 5, allGoalsMet: true });
    expect((await fs.stat(path.join(dir, 'out.pdf'))).size).toBeGreaterThan(0);
  });

  it('asks for confirmation before destructive steps', async () => {
    const args = {
      recipe: { version: 1, steps: [{ op: 'remove', pages: '1' }] },
      files: [{ path: 'b.pdf' }],
      output: 'trimmed.pdf',
    };
    const first = json(await call('recipe_run', args));
    expect(first).toMatchObject({ ran: false, needsConfirmation: true, destructiveSteps: [1] });
    await expect(fs.stat(path.join(dir, 'trimmed.pdf'))).rejects.toThrow();
    const second = json(await call('recipe_run', { ...args, confirm: true }));
    expect(second).toMatchObject({ ran: true, pageCount: 2 });
  });

  it('never overwrites inputs or existing files', async () => {
    const recipe = { version: 1, steps: [{ op: 'rotate', angle: 90 }] };
    const onInput = await call('recipe_run', { recipe, files: [{ path: 'a.pdf' }], output: 'a.pdf' });
    expect(onInput.content[0]!.text).toMatch(/overwrite an input/);
    const existing = await call('recipe_run', { recipe, files: [{ path: 'a.pdf' }], output: 'out.pdf' });
    expect(existing.content[0]!.text).toMatch(/already exists/);
  });

  it('returns validation issues instead of throwing', async () => {
    const res = await call('recipe_run', {
      recipe: { version: 1, steps: [{ op: 'select', pages: '9' }] },
      files: [{ path: 'a.pdf' }],
      output: 'nine.pdf',
      confirm: true,
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).issues[0].code).toBe('PAGE_OUT_OF_RANGE');
  });

  it('converts Word to a new PDF', async () => {
    const res = json(await call('word_to_pdf', { path: 'contrato.docx' }));
    expect(res).toMatchObject({ pageCount: 2, engine: 'native', warnings: [] });
    expect(res.output).toMatch(/contrato\.pdf$/);
    const again = await call('word_to_pdf', { path: 'contrato.docx' });
    expect(again.content[0]!.text).toMatch(/already exists/);
  });

  it('rejects non-Word files in word_to_pdf', async () => {
    const res = await call('word_to_pdf', { path: 'a.pdf', output: 'x.pdf' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/not a Word document/);
  });

  it('runs recipes that mix Word and PDF', async () => {
    const res = json(await call('recipe_run', {
      recipe: { version: 1, steps: [{ op: 'merge', files: ['contrato.docx', 'a.pdf'] }], goals: { pageCount: 4 } },
      files: [{ path: 'contrato.docx' }, { path: 'a.pdf' }],
      output: 'mixto.pdf',
    }));
    expect(res).toMatchObject({ ran: true, pageCount: 4, allGoalsMet: true });
  });

  it('reports compression results as notes', async () => {
    const res = json(await call('recipe_run', {
      recipe: { version: 1, steps: [{ op: 'merge' }, { op: 'compress', level: 'lossless' }] },
      files: [{ path: 'a.pdf' }, { path: 'b.pdf' }],
      output: 'comprimido.pdf',
    }));
    expect(res.ran).toBe(true);
    expect(res.notes).toHaveLength(1);
  });
});
