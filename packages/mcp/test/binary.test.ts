/** Runs the built `hilvana-mcp` binary as Claude Desktop does (stdio). Requires `npm run build`. */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { makePdf } from '../../core/test/helpers.js';

const BIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const exec = (args: string[], env: NodeJS.ProcessEnv = {}) => new Promise<{ code: number; err: string; out: string }>((resolve) =>
  execFile(process.execPath, [BIN, ...args], { env: { ...process.env, HILVANA_ROOTS: '', ...env } }, (e, out, err) => resolve({ code: e ? (e as { code?: number }).code ?? 1 : 0, out, err })));

describe('hilvana-mcp binary', { timeout: 60_000 }, () => {
  it('refuses to start without an authorized folder', async () => {
    const r = await exec([]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no folder authorized/);
  });

  it('fails clearly when the folder does not exist', async () => {
    const r = await exec(['--root', path.join(os.tmpdir(), 'no-existe-hilvana-xyz')]);
    expect(r.code).toBe(1);
  });

  it('prints help and version', async () => {
    expect((await exec(['--help'])).out).toMatch(/--root <folder>/);
    expect((await exec(['--version'])).out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('serves tools over stdio with a folder from HILVANA_ROOTS', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hilvana-mcp-bin-'));
    await fs.writeFile(path.join(dir, 'x.pdf'), await makePdf(2));
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, '--lang', 'en'], env: { ...process.env, HILVANA_ROOTS: dir } as Record<string, string>, stderr: 'pipe' }));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('recipe_run');
    const listed = JSON.parse(((await client.callTool({ name: 'pdf_list', arguments: {} })) as { content: { text: string }[] }).content[0]!.text);
    expect(listed.files[0]).toMatchObject({ name: 'x.pdf', pages: 2 });
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
