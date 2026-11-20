import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Device + inode of an existing file (catches symlinks, hard links and case-variant paths), or undefined. */
export async function fileId(p: string): Promise<string | undefined> {
  try {
    const s = await fs.stat(p, { bigint: true });
    return `${s.dev}:${s.ino}`;
  } catch {
    return undefined;
  }
}

export class UnsafeOutputError extends Error {
  constructor(readonly code: 'OUTPUT_IS_INPUT' | 'OUTPUT_IS_SYMLINK' | 'OUTPUT_EXISTS', message: string) {
    super(message);
    this.name = 'UnsafeOutputError';
  }
}

/**
 * Writes a new file without ever writing through a symbolic link or onto an input:
 * - refuses when the target is a symlink, or is the same file as any input (by device/inode);
 * - without `overwrite`, refuses when the target exists;
 * - with `overwrite`, writes a temporary file next to it and renames it into place.
 */
export async function safeWrite(target: string, bytes: Uint8Array, opts: { inputs: string[]; overwrite?: boolean }): Promise<void> {
  const lst = await fs.lstat(target).catch(() => undefined);
  if (lst?.isSymbolicLink()) throw new UnsafeOutputError('OUTPUT_IS_SYMLINK', `The output is a symbolic link: ${target}`);
  if (lst) {
    const id = await fileId(target);
    const inputIds = await Promise.all(opts.inputs.map(fileId));
    if (id && inputIds.includes(id)) throw new UnsafeOutputError('OUTPUT_IS_INPUT', 'Refusing to overwrite an input file. Choose a new output name.');
    if (!opts.overwrite) throw new UnsafeOutputError('OUTPUT_EXISTS', `The output already exists: ${target}. Choose another name or set overwrite.`);
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, bytes, { flag: 'wx' });
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return;
  }
  try {
    await fs.writeFile(target, bytes, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new UnsafeOutputError('OUTPUT_EXISTS', `The output already exists: ${target}. Choose another name or set overwrite.`);
    throw err;
  }
}
