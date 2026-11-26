/** Saved recipes: a folder of .json recipes the agent can list, read and run by id, without touching documents. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FolderGuard } from '../src/fsguard.js';
import { RecipeShelf } from '../src/recipes.js';
import { createServer } from '../src/server.js';
import { makePdf } from '../../core/test/helpers.js';

let dir: string;
let shelfDir: string;
let client: Client;
let bare: Client;

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as ToolResult;
const json = (r: ToolResult) => JSON.parse(r.content[0]!.text);

async function connect(server: ReturnType<typeof createServer>) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), c.connect(b)]);
  return c;
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hilvana-mcp-saved-'));
  shelfDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hilvana-recetas-'));
  await fs.writeFile(path.join(dir, 'factura.pdf'), await makePdf(3));
  // As the web app exports them: the recipe itself, with its name.
  await fs.writeFile(path.join(shelfDir, 'numerar-facturas.json'), JSON.stringify({ version: 1, name: 'Numerar facturas', steps: [{ op: 'numberPages', format: '{n} / {total}' }], output: { filename: '{name}-numerado' } }));
  await fs.writeFile(path.join(shelfDir, 'cerrar.json'), JSON.stringify({ version: 1, name: 'Cerrar con clave', steps: [{ op: 'protect', password: 'mi-clave-secreta' }] }));
  await fs.writeFile(path.join(shelfDir, 'roto.json'), '{ esto no es json');
  await fs.writeFile(path.join(shelfDir, 'notas.txt'), 'no es una receta');
  const guard = await FolderGuard.create([dir]);
  client = await connect(createServer(guard, { lang: 'es', engine: 'native', recipes: await RecipeShelf.open(shelfDir) }));
  bare = await connect(createServer(guard, { lang: 'es', engine: 'native' }));
});

afterAll(async () => {
  await client?.close();
  await bare?.close();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(shelfDir, { recursive: true, force: true });
});

describe('saved recipes in hilvana-mcp', () => {
  it('lists them with their steps in plain language, flags broken files and never shows passwords', async () => {
    const res = json(await call(client, 'recipe_list', {}));
    expect(res.folder).toBe(await fs.realpath(shelfDir));
    expect(res.recipes).toEqual([
      { id: 'cerrar', name: 'Cerrar con clave', steps: [expect.any(String)], needsSecret: true },
      { id: 'numerar-facturas', name: 'Numerar facturas', steps: [expect.stringMatching(/Numerar/)], needsSecret: false },
      { id: 'roto', invalid: 'Not valid JSON.' },
    ]);
    expect(JSON.stringify(res)).not.toContain('mi-clave-secreta');
  });

  it('exposes valid recipes as resources, with passwords replaced', async () => {
    const { resources } = await client.listResources();
    expect(resources.filter((r) => r.uri.startsWith('hilvana://recipes/')).map((r) => [r.uri, r.title])).toEqual([
      ['hilvana://recipes/cerrar', 'Cerrar con clave'],
      ['hilvana://recipes/numerar-facturas', 'Numerar facturas'],
    ]);
    const read = await client.readResource({ uri: 'hilvana://recipes/cerrar' });
    const text = (read.contents[0] as { text: string }).text;
    expect(text).not.toContain('mi-clave-secreta');
    expect(JSON.parse(text).steps[0].password).toBe('••••••');
    await expect(client.readResource({ uri: 'hilvana://recipes/no-existe' })).rejects.toThrow();
  });

  it('plans and runs a saved recipe by id', async () => {
    const p = json(await call(client, 'recipe_plan', { saved: 'numerar-facturas', files: [{ path: 'factura.pdf' }] }));
    expect(p.ok).toBe(true);
    const res = json(await call(client, 'recipe_run', { saved: 'numerar-facturas', files: [{ path: 'factura.pdf' }], output: 'factura-numerada.pdf' }));
    expect(res).toMatchObject({ ran: true, pageCount: 3 });
    expect((await fs.readFile(path.join(dir, 'factura-numerada.pdf'))).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('refuses saved recipes that need a secret, and ids that are not plain names', async () => {
    const secret = await call(client, 'recipe_run', { saved: 'cerrar', files: [{ path: 'factura.pdf' }], output: 'x.pdf' });
    expect(json(secret).issues[0].code).toBe('SECRET_NOT_ALLOWED');
    for (const id of ['../cerrar', 'sub/receta', '.oculta']) {
      const r = await call(client, 'recipe_plan', { saved: id, files: [{ path: 'factura.pdf' }] });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/No saved recipe/);
    }
  });

  it('needs exactly one of recipe and saved', async () => {
    const both = await call(client, 'recipe_plan', { saved: 'numerar-facturas', recipe: { version: 1, steps: [{ op: 'merge' }] }, files: [{ path: 'factura.pdf' }] });
    expect(both.content[0]!.text).toMatch(/either recipe or saved/);
    expect((await call(client, 'recipe_plan', { files: [{ path: 'factura.pdf' }] })).content[0]!.text).toMatch(/either recipe or saved/);
  });

  it('without a recipes folder there is no recipe_list, and saved explains how to set one', async () => {
    expect((await bare.listTools()).tools.map((t) => t.name)).not.toContain('recipe_list');
    const r = await call(bare, 'recipe_plan', { saved: 'numerar-facturas', files: [{ path: 'factura.pdf' }] });
    expect(r.content[0]!.text).toMatch(/--recipes/);
  });

  it('a missing folder given explicitly is an error; the default one is optional', async () => {
    await expect(RecipeShelf.open(path.join(shelfDir, 'no-existe'))).rejects.toThrow(/not found/);
  });

  it('removes restrictions with the unlock step, writing a new file', async () => {
    const { readFile } = await import('node:fs/promises');
    await fs.writeFile(path.join(dir, 'extracto.pdf'), await readFile(new URL('../../core/test/fixtures/encrypted/permisos-aes256.pdf', import.meta.url)));
    const res = json(await call(client, 'recipe_run', { recipe: { version: 1, steps: [{ op: 'unlock' }] }, files: [{ path: 'extracto.pdf' }], output: 'extracto-libre.pdf' }));
    expect(res).toMatchObject({ ran: true, pageCount: 3 });
    const { inspect } = await import('@hilvana/core');
    expect((await inspect(new Uint8Array(await fs.readFile(path.join(dir, 'extracto-libre.pdf'))))).protection).toBe('none');
  });
});
