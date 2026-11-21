import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Restricts every file the server touches to folders the user authorized.
 * Paths are resolved through symlinks before the check, so a link inside an
 * allowed folder cannot point outside it.
 */
export class FolderGuard {
  private constructor(readonly roots: string[]) {}

  static async create(rawRoots: string[]): Promise<FolderGuard> {
    const roots: string[] = [];
    for (const r of rawRoots) {
      const expanded = r.startsWith('~') ? path.join(os.homedir(), r.slice(1)) : r;
      const real = await fs.realpath(path.resolve(expanded));
      const stat = await fs.stat(real);
      if (!stat.isDirectory()) throw new Error(`Not a folder: ${r}`);
      roots.push(real);
    }
    if (roots.length === 0) throw new Error('At least one allowed folder is required.');
    return new FolderGuard(roots);
  }

  private inside(real: string): boolean {
    return this.roots.some((root) => real === root || real.startsWith(root + path.sep));
  }

  private expand(p: string): string {
    const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
    // Relative paths are resolved against the first allowed folder, not the server's cwd.
    return path.isAbsolute(expanded) ? expanded : path.join(this.roots[0]!, expanded);
  }

  /** Resolves an existing file for reading. */
  async readable(p: string): Promise<string> {
    let real: string;
    try {
      real = await fs.realpath(this.expand(p));
    } catch {
      throw new Error(`File not found: ${p}`);
    }
    if (!this.inside(real)) throw new Error(`Outside the allowed folders: ${p}`);
    const stat = await fs.stat(real);
    if (!stat.isFile()) throw new Error(`Not a file: ${p}`);
    return real;
  }

  /** Resolves an existing folder inside the allowed roots (for listing, and for the parts of a split). */
  async folder(p: string): Promise<string> {
    const real = await fs.realpath(this.expand(p)).catch(() => {
      throw new Error(`Folder not found: ${p}`);
    });
    if (!this.inside(real)) throw new Error(`Outside the allowed folders: ${p}`);
    if (!(await fs.stat(real)).isDirectory()) throw new Error(`Not a folder: ${p}`);
    return real;
  }

  /**
   * Resolves an output path. The parent folder must exist inside an allowed folder,
   * the target must not be one of the inputs, and an existing file is only replaced
   * when `overwrite` is true.
   */
  async writable(p: string, opts: { inputs: string[]; overwrite?: boolean }): Promise<string> {
    const target = this.expand(p);
    if (!target.toLowerCase().endsWith('.pdf')) throw new Error('The output must be a .pdf file.');
    const parent = await fs.realpath(path.dirname(target)).catch(() => {
      throw new Error(`Output folder not found: ${path.dirname(p)}`);
    });
    if (!this.inside(parent)) throw new Error(`Outside the allowed folders: ${p}`);
    const real = path.join(parent, path.basename(target));
    // A symlink at the output name could point anywhere (outside the allowed folders, or at an input).
    const lst = await fs.lstat(real).catch(() => undefined);
    if (lst?.isSymbolicLink()) throw new Error(`The output is a symbolic link; refusing to write through it: ${p}`);
    if (opts.inputs.includes(real)) throw new Error('Refusing to overwrite an input file. Choose a new output name.');
    if (lst && !opts.overwrite) throw new Error(`The output already exists: ${p}. Choose another name or set overwrite.`);
    return real;
  }
}
