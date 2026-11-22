// Independent signature validation with poppler's pdfsig.
import { it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let hasPdfsig = true;
try { execFileSync('pdfsig', ['-v'], { stdio: 'ignore' }); } catch { hasPdfsig = false; }
if (!hasPdfsig && process.env.HILVANA_REQUIRE_PDFSIG) throw new Error('pdfsig (poppler-utils) is required here: HILVANA_REQUIRE_PDFSIG is set.');
// CI installs poppler-utils; locally the checks are skipped if pdfsig is missing.
export const withPdfsig = hasPdfsig ? it : it.skip;

/** What an independent validator says about each signature. */
export function pdfsig(bytes: Uint8Array, password?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hilvana-sig-'));
  const file = path.join(dir, 'doc.pdf');
  writeFileSync(file, bytes);
  let out: string;
  try { out = execFileSync('pdfsig', [...(password ? ['-upw', password] : []), file], { encoding: 'utf8' }); } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
  return out.split(/Signature #\d+:/).slice(1).map((block) => ({
    name: /Signer Certificate Common Name: (.+)/.exec(block)?.[1]?.trim(),
    valid: /Signature Validation: Signature is Valid/.test(block),
    wholeFile: /Total document signed/.test(block),
    type: /Signature Type: (.+)/.exec(block)?.[1]?.trim(),
  }));
}

