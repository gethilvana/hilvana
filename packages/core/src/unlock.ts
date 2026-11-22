import { HilvanaError } from './errors.js';

/** How a PDF was protected: not at all, only with usage restrictions (no password to open), or with a password to open. */
export type Protection = 'none' | 'permissions' | 'password';

export interface UnlockResult {
  /** The document without encryption (the same bytes when it was not encrypted). */
  bytes: Uint8Array;
  protection: Protection;
}

const ENCRYPT = new TextEncoder().encode('/Encrypt');

/**
 * The decryption library logs a warning for every string it cannot decrypt. Signature values are
 * never encrypted (the PDF standard says so), so signed encrypted files would flood the console
 * with false alarms. Those messages, and only those, are dropped while `fn` runs.
 */
export async function quietDecryption<T>(fn: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  const filter = (log: (...args: unknown[]) => void) => (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Failed to decrypt object')) return;
    log(...args);
  };
  console.warn = filter(warn);
  console.error = filter(error);
  try {
    return await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

/** Cheap pre-check: an encrypted PDF names its /Encrypt dictionary in the trailer. */
function mentionsEncrypt(bytes: Uint8Array): boolean {
  outer: for (let i = 0; i <= bytes.length - ENCRYPT.length; i++) {
    for (let j = 0; j < ENCRYPT.length; j++) if (bytes[i + j] !== ENCRYPT[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Names the protection scheme from the /Encrypt dictionary, read straight from the bytes: that
 * dictionary is never encrypted or compressed. (Parsing with pdf-lib first would print warnings
 * for every encrypted object.) Undefined when it cannot be found; the decryption library decides then.
 */
function securityFilter(bytes: Uint8Array): string | undefined {
  // Latin-1 keeps one character per byte, so offsets match.
  const text = new TextDecoder('latin1').decode(bytes);
  const refs = [...text.matchAll(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/g)];
  let dict: string | undefined;
  const ref = refs.at(-1); // the latest trailer wins
  if (ref) {
    const start = text.search(new RegExp(`(^|[^0-9])${ref[1]}\\s+${ref[2]}\\s+obj\\b`));
    if (start >= 0) dict = text.slice(start, text.indexOf('endobj', start));
  } else {
    dict = /\/Encrypt\s*<<([\s\S]*?)>>/.exec(text)?.[1]; // inline in the trailer
  }
  return dict ? /\/Filter\s*\/([^\s/<>[\]()]+)/.exec(dict)?.[1] : undefined;
}

/**
 * Removes a PDF's encryption, locally. Files protected only with usage restrictions (they open
 * without a password, as many bank statements do) need no password. Files that need a password
 * to open are only unlocked with that password.
 *
 * Throws PASSWORD_REQUIRED when a password is needed and none was given, WRONG_PASSWORD when the
 * given one does not open the file, and ENCRYPTED for protection schemes other than passwords
 * (for example certificate-based encryption), which are not supported.
 *
 * The decryption library is loaded only when a file is actually encrypted.
 */
export async function unlock(bytes: Uint8Array, password = ''): Promise<UnlockResult> {
  if (!mentionsEncrypt(bytes)) return { bytes, protection: 'none' };
  const filter = securityFilter(bytes);
  if (filter && filter !== 'Standard') throw new HilvanaError('ENCRYPTED', { filter });

  const { PDF } = await import('@libpdf/core');
  const open = async (pw: string) => {
    try {
      const pdf = await quietDecryption(() => PDF.load(bytes, { credentials: pw }));
      return pdf.isAuthenticated ? pdf : undefined;
    } catch {
      return undefined; // without the right password the document cannot even be parsed
    }
  };
  // Try without a password first, so a file that only has restrictions is reported as such.
  const free = await open('');
  const pdf = free ?? (password ? await open(password) : undefined);
  if (!pdf) {
    // The word "/Encrypt" can appear in a file that is not encrypted, and then fails here for other reasons.
    if (!filter) return { bytes, protection: 'none' };
    throw new HilvanaError(password ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED');
  }
  if (!pdf.isEncrypted) return { bytes, protection: 'none' };
  // Restrictions are removed along with the encryption: the person opened the file themselves,
  // and every surface tells them the result no longer carries those restrictions.
  pdf.removeProtection({ ignorePermissions: true });
  const out = await quietDecryption(() => pdf.save());
  return { bytes: out, protection: free ? 'permissions' : 'password' };
}
