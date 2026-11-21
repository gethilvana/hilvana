/**
 * Runs the real `hilvana` binary (built dist) end to end: behavior, exit codes and safety rules.
 * Requires `npm run build` first (CI does it).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TINY_PNG, makePdf } from '../../core/test/helpers.js';
import { sampleContract } from '../../office/test/fixtures.js';

const BIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));
let dir: string;

function hilvana(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: dir, env: { ...process.env, LANG: 'es_CO.UTF-8', HILVANA_LANG: '' } }, (error, stdout, stderr) => {
      resolve({ code: error ? (error as { code?: number }).code ?? 1 : 0, out: stdout, err: stderr });
    });
  });
}
const md5 = async (f: string) => (await import('node:crypto')).createHash('md5').update(await fs.readFile(path.join(dir, f))).digest('hex');

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hilvana cli ñ-'));
  await fs.writeFile(path.join(dir, 'a.pdf'), await makePdf(3, { author: 'Ana' }));
  await fs.writeFile(path.join(dir, 'b con espacio.pdf'), await makePdf(2));
  await fs.writeFile(path.join(dir, 'firma.png'), TINY_PNG);
  await fs.writeFile(path.join(dir, 'contrato.docx'), await sampleContract());
});
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('hilvana CLI', { timeout: 60_000 }, () => {
  it('prints help in Spanish or English', async () => {
    expect((await hilvana('--help')).out).toContain('flujos de PDF privados');
    expect((await hilvana('--help', '--lang', 'en')).out).toContain('private PDF workflows');
  });

  it('merges, including Word and paths with spaces and accents', async () => {
    const r = await hilvana('merge', 'a.pdf', 'b con espacio.pdf', 'contrato.docx', '-o', 'todo ñ.pdf');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/todo ñ\.pdf · 7 páginas/);
  });

  it('converts Word, stamps unicode text, numbers, signs, compresses', async () => {
    expect((await hilvana('word', 'contrato.docx')).out).toMatch(/contrato\.pdf · 2 páginas/);
    expect((await hilvana('stamp', 'a.pdf', '--text', '✓ Aprobado Ελλάδα', '-o', 's.pdf')).code).toBe(0);
    expect((await hilvana('number', 'a.pdf', '--format', 'Página {n} de {total}', '-o', 'n.pdf')).code).toBe(0);
    expect((await hilvana('sign', 'a.pdf', '--image', 'firma.png', '-o', 'f.pdf')).code).toBe(0);
    expect((await hilvana('compress', 'a.pdf', '--target', '1MB', '-o', 'c.pdf')).out).toMatch(/→/);
  });

  it('never overwrites an input, not even with --force or through a link', async () => {
    const before = await md5('a.pdf');
    expect((await hilvana('rotate', 'a.pdf', '-o', './a.pdf', '--force')).err).toMatch(/No sobrescribo archivos de entrada/);
    try {
      await fs.link(path.join(dir, 'a.pdf'), path.join(dir, 'duro.pdf'));
      expect((await hilvana('rotate', 'a.pdf', '-o', 'duro.pdf', '--force')).err).toMatch(/No sobrescribo/);
    } catch { /* hard links unsupported on this filesystem */ }
    try {
      await fs.symlink('a.pdf', path.join(dir, 'enlace.pdf'));
      expect((await hilvana('rotate', 'a.pdf', '-o', 'enlace.pdf', '--force')).err).toMatch(/enlace simbólico/);
    } catch { /* symlinks need admin rights on Windows */ }
    expect(await md5('a.pdf')).toBe(before);
  });

  it('does not replace existing outputs without --force', async () => {
    await hilvana('rotate', 'a.pdf', '--angle', '90', '-o', 'r.pdf');
    const r = await hilvana('rotate', 'a.pdf', '--angle', '90', '-o', 'r.pdf');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/ya existe/);
  });

  it('keeps recipe output names inside the input folder (D5)', async () => {
    await fs.writeFile(path.join(dir, 'mala.json'), JSON.stringify({ version: 1, steps: [{ op: 'rotate', angle: 90 }], output: { filename: '../../ESCAPE' } }));
    const r = await hilvana('run', 'mala.json', 'a.pdf');
    expect(r.code).toBe(0);
    await expect(fs.stat(path.join(dir, 'ESCAPE.pdf'))).resolves.toBeTruthy();
  });

  it('asks for confirmation on destructive recipes and accepts --yes', async () => {
    await fs.writeFile(path.join(dir, 'borrar.json'), JSON.stringify({ version: 1, steps: [{ op: 'remove', pages: '1' }] }));
    const no = await hilvana('run', 'borrar.json', 'a.pdf', '-o', 'x1.pdf');
    expect(no.code).toBe(1);
    expect(no.err).toMatch(/usa --yes/);
    expect((await hilvana('run', 'borrar.json', 'a.pdf', '-o', 'x1.pdf', '--yes')).out).toMatch(/2 páginas/);
  });

  it('gives clear errors and exit codes (D8–D10)', async () => {
    expect(await hilvana('noexiste.pdf')).toMatchObject({ code: 2, err: expect.stringMatching(/Comando desconocido/) });
    expect(await hilvana('rotate', 'a.pdf', '--angle', '45', '-o', 'z.pdf')).toMatchObject({ code: 2, err: expect.stringMatching(/90, 180 o 270/) });
    expect(await hilvana('compress', 'a.pdf', '--target', '2XB')).toMatchObject({ code: 2 });
    expect(await hilvana('inspect', 'no-esta.pdf')).toMatchObject({ code: 1, err: expect.stringMatching(/No encuentro el archivo/) });
    await fs.writeFile(path.join(dir, 'rota.json'), '{malo');
    expect((await hilvana('run', 'rota.json', 'a.pdf')).err).toMatch(/no es un JSON válido/);
    await fs.writeFile(path.join(dir, 'falso.pdf'), 'hola');
    expect((await hilvana('inspect', 'falso.pdf')).err).toMatch(/no es un PDF válido/);
    expect((await hilvana('word', 'a.pdf')).err).toMatch(/no es un documento de Word/);
  });

  it('exits 3 when a recipe runs but misses a goal', async () => {
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ version: 1, steps: [{ op: 'rotate', angle: 90 }], goals: { pageCount: 99 } }));
    expect((await hilvana('run', 'meta.json', 'a.pdf', '-o', 'm.pdf')).code).toBe(3);
  });
});

// D24: the version was hard-coded and stayed at 0.1.0 in the 0.1.1 release.
describe('version', () => {
  it('CLI and MCP server report the version of their package', async () => {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const root = new URL('../../', import.meta.url);
    for (const [pkg, bin] of [['cli', 'dist/main.js'], ['mcp', 'dist/main.js']] as const) {
      const expected = JSON.parse(readFileSync(new URL(`${pkg}/package.json`, root), 'utf8')).version;
      const out = execFileSync(process.execPath, [new URL(`${pkg}/${bin}`, root).pathname, '--version'], { encoding: 'utf8' }).trim();
      expect(out).toBe(expected);
    }
  });
});
