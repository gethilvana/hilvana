/**
 * The writer shared by the CLI and the MCP server (same file in both packages): it must never
 * write through a symbolic link or onto an input, and only replaces a file when asked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as mcp from '../src/safewrite';
import * as cli from '../../cli/src/safewrite';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'hilvana-sw-')); dirs.push(d); return d; };
const bytes = (s: string) => new TextEncoder().encode(s);

for (const [name, { safeWrite, UnsafeOutputError }] of [['mcp', mcp], ['cli', cli]] as const) {
  describe(`safeWrite (${name})`, () => {
    it('writes a new file, and refuses an existing one unless asked to overwrite', async () => {
      const d = tmp();
      const out = path.join(d, 'salida.pdf');
      await safeWrite(out, bytes('uno'), { inputs: [] });
      await expect(safeWrite(out, bytes('dos'), { inputs: [] })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
      await safeWrite(out, bytes('dos'), { inputs: [], overwrite: true });
      expect(readFileSync(out, 'utf8')).toBe('dos');
      expect(readdirSync(d)).toEqual(['salida.pdf']); // no temporary file left behind
    });

    it('never overwrites an input, even through a hard link or with overwrite', async () => {
      const d = tmp();
      const input = path.join(d, 'original.pdf');
      writeFileSync(input, 'original');
      const alias = path.join(d, 'alias.pdf');
      linkSync(input, alias);
      for (const target of [input, alias]) {
        await expect(safeWrite(target, bytes('x'), { inputs: [input], overwrite: true })).rejects.toBeInstanceOf(UnsafeOutputError);
      }
      expect(readFileSync(input, 'utf8')).toBe('original');
    });

    it.skipIf(process.platform === 'win32')('never writes through a symbolic link', async () => { // symlinks need admin rights on Windows
      const d = tmp();
      const victim = path.join(d, 'otro.txt');
      writeFileSync(victim, 'intacto');
      const link = path.join(d, 'salida.pdf');
      symlinkSync(victim, link);
      await expect(safeWrite(link, bytes('x'), { inputs: [], overwrite: true })).rejects.toMatchObject({ code: 'OUTPUT_IS_SYMLINK' });
      expect(readFileSync(victim, 'utf8')).toBe('intacto');
    });
  });
}
