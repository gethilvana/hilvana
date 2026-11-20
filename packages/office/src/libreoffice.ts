/**
 * Optional high-fidelity engine: uses a LibreOffice installation on the same machine.
 * Still fully local (no network). Node only; import lazily.
 */

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ],
  darwin: ['/Applications/LibreOffice.app/Contents/MacOS/soffice'],
  linux: ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice', '/snap/bin/libreoffice', '/opt/libreoffice/program/soffice'],
};

let cached: Promise<string | undefined> | undefined;

/** Finds the LibreOffice binary: HILVANA_SOFFICE, then the usual install locations, then PATH. */
export function findLibreOffice(): Promise<string | undefined> {
  cached ??= (async () => {
    const { access } = await import('node:fs/promises');
    const { constants } = await import('node:fs');
    const path = await import('node:path');
    const exists = async (p: string) => access(p, constants.X_OK).then(() => true, () => false);
    const fromEnv = process.env.HILVANA_SOFFICE;
    if (fromEnv) return (await exists(fromEnv)) ? fromEnv : undefined;
    for (const c of CANDIDATES[process.platform] ?? []) if (await exists(c)) return c;
    const names = process.platform === 'win32' ? ['soffice.exe'] : ['soffice', 'libreoffice'];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      for (const n of names) {
        const full = path.join(dir, n);
        if (dir && (await exists(full))) return full;
      }
    }
    return undefined;
  })();
  return cached;
}

/** Converts .docx bytes to PDF with LibreOffice in a private temporary profile and folder. */
export async function libreOfficeToPdf(docx: Uint8Array, opts: { timeoutMs?: number } = {}): Promise<Uint8Array> {
  const soffice = await findLibreOffice();
  if (!soffice) throw new Error('LIBREOFFICE_NOT_FOUND');
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { execFile } = await import('node:child_process');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'hilvana-lo-'));
  try {
    const input = path.join(dir, 'input.docx');
    await writeFile(input, docx);
    const profile = pathToFileURL(path.join(dir, 'profile')).href;
    await new Promise<void>((resolve, reject) => {
      execFile(
        soffice,
        [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input],
        { timeout: opts.timeoutMs ?? 90_000, env: { ...process.env, SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN ?? 'svp' } },
        (err) => (err ? reject(new Error(`LIBREOFFICE_FAILED: ${err.message.slice(0, 200)}`)) : resolve()),
      );
    });
    return new Uint8Array(await readFile(path.join(dir, 'input.pdf')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
