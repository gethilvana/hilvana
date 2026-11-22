import { HilvanaError } from './errors.js';
import { countSignatures, dropSignatures, load, stampText, type Anchor, type PdfBytes, type TextOptions } from './operations.js';
import { quietDecryption, unlock, type Protection } from './unlock.js';

// ---------------------------------------------------------------------------------------------
// Protecting with a password
// ---------------------------------------------------------------------------------------------

export interface ProtectOptions {
  /** Password needed to open the result. Omit to only restrict what readers allow. */
  password?: string;
  /** Password that lifts the restrictions. Generated at random when omitted. */
  ownerPassword?: string;
  /** Allow printing (default true). */
  allowPrint?: boolean;
  /** Allow copying text and images (default true). */
  allowCopy?: boolean;
  /** Allow changes: editing, annotations, forms and page assembly (default true). */
  allowModify?: boolean;
}

/**
 * Encrypts a PDF with AES-256. With `password`, the result needs it to open; restrictions
 * (no printing, copying or changes) are honored by PDF readers. The input is never modified.
 */
export async function protect(bytes: PdfBytes, opts: ProtectOptions): Promise<PdfBytes> {
  const restricted = opts.allowPrint === false || opts.allowCopy === false || opts.allowModify === false;
  if (!opts.password && !restricted) throw new HilvanaError('INVALID_ARGUMENT', { protect: 'nothing to protect' });
  // Start from an unencrypted copy without signatures: encryption rewrites the whole file anyway.
  let open = (await unlock(bytes)).bytes;
  const doc = await load(open);
  if (dropSignatures(doc) > 0) open = await doc.save({ useObjectStreams: true });
  const { PDF } = await import('@libpdf/core');
  const pdf = await PDF.load(open);
  const modify = opts.allowModify ?? true;
  pdf.setProtection({
    userPassword: opts.password ?? '',
    ...(opts.ownerPassword ? { ownerPassword: opts.ownerPassword } : {}),
    algorithm: 'AES-256',
    permissions: {
      print: opts.allowPrint ?? true,
      printHighQuality: opts.allowPrint ?? true,
      copy: opts.allowCopy ?? true,
      accessibility: true, // screen readers keep working, whatever else is restricted
      modify,
      annotate: modify,
      fillForms: modify,
      assemble: modify,
    },
  });
  return pdf.save();
}

// ---------------------------------------------------------------------------------------------
// Signing with a digital certificate
// ---------------------------------------------------------------------------------------------

export interface CertificateInfo {
  /** The signer's name (the certificate subject's common name). */
  name: string;
  /** Who issued the certificate (for example Certicámara or GSE). */
  issuer: string;
  validFrom: Date;
  validTo: Date;
  /** True when the certificate signs itself: PDF readers will not know who issued it. */
  selfSigned: boolean;
}

interface Der { tag: number; start: number; end: number; next: number }

function der(buf: Uint8Array, at: number): Der {
  const tag = buf[at]!;
  let len = buf[at + 1]!;
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[start + i]!;
    start += n;
  }
  return { tag, start, end: start + len, next: start + len };
}

function children(buf: Uint8Array, node: Der): Der[] {
  const out: Der[] = [];
  for (let at = node.start; at < node.end; ) {
    const c = der(buf, at);
    out.push(c);
    at = c.next;
  }
  return out;
}

function derString(buf: Uint8Array, node: Der): string {
  const bytes = buf.subarray(node.start, node.end);
  if (node.tag === 0x1e) { // BMPString: UTF-16BE
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return s;
  }
  return new TextDecoder(node.tag === 0x0c ? 'utf-8' : 'latin1').decode(bytes);
}

function commonName(buf: Uint8Array, name: Der): string {
  let cn = '';
  let org = '';
  for (const rdn of children(buf, name)) {
    for (const attr of children(buf, rdn)) {
      const [oid, value] = children(buf, attr);
      if (!oid || !value) continue;
      const id = Array.from(buf.subarray(oid.start, oid.end)).join('.');
      if (id === '85.4.3') cn = derString(buf, value); // 2.5.4.3 commonName
      if (id === '85.4.10') org = derString(buf, value); // 2.5.4.10 organizationName
    }
  }
  return cn || org;
}

function derTime(buf: Uint8Array, node: Der): Date {
  const s = new TextDecoder('latin1').decode(buf.subarray(node.start, node.end));
  const full = node.tag === 0x17 ? (Number(s.slice(0, 2)) < 50 ? '20' : '19') + s : s; // UTCTime has a 2-digit year
  return new Date(Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +(full.slice(12, 14) || 0)));
}

/** Reads name, issuer and validity from an X.509 certificate (DER). */
export function describeCertificate(cert: Uint8Array): CertificateInfo {
  try {
    const tbs = children(cert, children(cert, der(cert, 0))[0]!);
    const fields = tbs[0]!.tag === 0xa0 ? tbs.slice(1) : tbs; // skip the optional version
    const [, , issuer, validity, subject] = fields;
    const [from, to] = children(cert, validity!);
    const issuerName = commonName(cert, issuer!);
    const subjectName = commonName(cert, subject!);
    const same = cert.subarray(issuer!.start, issuer!.end).join() === cert.subarray(subject!.start, subject!.end).join();
    return { name: subjectName, issuer: issuerName, validFrom: derTime(cert, from!), validTo: derTime(cert, to!), selfSigned: same };
  } catch {
    throw new HilvanaError('INVALID_CERTIFICATE');
  }
}

async function loadSigner(p12: Uint8Array, password: string) {
  const { P12Signer } = await import('@libpdf/core');
  try {
    return await P12Signer.create(p12, password);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/integrity|mac|password|decrypt/i.test(message)) throw new HilvanaError('WRONG_CERTIFICATE_PASSWORD');
    throw new HilvanaError('INVALID_CERTIFICATE', { reason: message.slice(0, 160) });
  }
}

/** Opens a .p12/.pfx file and describes its certificate, to show the person who will sign. */
export async function readCertificate(p12: Uint8Array, password: string): Promise<CertificateInfo> {
  return describeCertificate((await loadSigner(p12, password)).certificate);
}

export interface VisibleSignature {
  /** The line drawn on the page, e.g. "Firmado digitalmente por Ana Pérez · 2026-11-21". */
  text: string;
  /** Page range; defaults to "last". */
  pages?: string;
  anchor?: Anchor;
  size?: number;
  fonts?: TextOptions['fonts'];
}

export interface CertificateSignOptions {
  /** The .p12/.pfx file. */
  certificate: Uint8Array;
  /** Its password. Used only here to unlock the private key. */
  password: string;
  reason?: string;
  location?: string;
  /** A visible line on the page. Skipped when the document already has signatures, to keep them valid. */
  visible?: VisibleSignature | false;
  /** Signing time (defaults to now). It is the device's clock, not a trusted timestamp. */
  now?: Date;
  /** Password to open the document, when it needs one. */
  openPassword?: string;
}

export interface CertificateSignResult {
  bytes: PdfBytes;
  signer: CertificateInfo;
  /** Whether the visible line was drawn. */
  visible: boolean;
  /** Signatures the document already had; they stay valid. */
  previousSignatures: number;
  /**
   * The protection the result keeps. A protected document that was already signed is signed as
   * it is, encryption included, because removing the encryption would break its signatures.
   * Otherwise protection is removed ('none').
   */
  protection: Protection;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type Ctor = Function;

/**
 * Works around @libpdf/core 0.5: objects read from an encrypted file come back marked as changed,
 * so an incremental save writes them again. For a signature dictionary that re-encrypts its value
 * (which the PDF standard keeps unencrypted) and breaks the signature. Here every object read from
 * the file starts clean; only what signing really changes is written in the new revision.
 */
function keepReadObjectsUnchanged(pdf: unknown, PdfDict: Ctor, PdfArray: Ctor, PdfRef: Ctor) {
  type Obj = { clearDirty?: () => void; [Symbol.iterator]?: () => Iterator<unknown> };
  const registry = (pdf as { ctx?: { registry?: { resolver?: (ref: unknown) => unknown; setResolver?: (r: (ref: unknown) => unknown) => void; getLoadedObjects?: () => Map<unknown, unknown> } } }).ctx?.registry;
  if (!registry?.resolver || !registry.setResolver || !registry.getLoadedObjects) {
    // Without the workaround the earlier signatures would break: refuse rather than damage them.
    throw new HilvanaError('ENCRYPTED', { reason: 'signing an encrypted, signed PDF is not supported by this version' });
  }
  const clean = (obj: unknown): void => {
    if (!(obj instanceof PdfDict) && !(obj instanceof PdfArray)) return;
    (obj as Obj).clearDirty?.();
    for (const item of obj as Iterable<unknown>) {
      const value = Array.isArray(item) && obj instanceof PdfDict ? item[1] : item;
      if (!(value instanceof PdfRef)) clean(value);
    }
  };
  for (const obj of registry.getLoadedObjects().values()) clean(obj);
  const read = registry.resolver;
  registry.setResolver((ref) => {
    const obj = read(ref);
    clean(obj);
    return obj;
  });
  // Signing reloads the document after writing the signature and saves once more: without this,
  // that last save would rewrite the decrypted objects as a revision the signature does not cover.
  const doc = pdf as { reload?: (bytes: Uint8Array) => Promise<void> };
  const reload = doc.reload?.bind(pdf);
  if (reload) {
    doc.reload = async (bytes) => {
      await reload(bytes);
      keepReadObjectsUnchanged(pdf, PdfDict, PdfArray, PdfRef);
    };
  }
}

/**
 * Signs a PDF with a digital certificate (PAdES B-B, ETSI.CAdES.detached), entirely on this device:
 * the private key never leaves it, and no time-stamping server is contacted.
 *
 * Existing signatures stay valid: the new one is appended without rewriting the file. That is why
 * the visible line is only drawn on documents that have no signatures yet.
 */
export async function signWithCertificate(bytes: PdfBytes, opts: CertificateSignOptions): Promise<CertificateSignResult> {
  const signer = await loadSigner(opts.certificate, opts.password);
  const info = describeCertificate(signer.certificate);
  const now = opts.now ?? new Date();
  if (now < info.validFrom) throw new HilvanaError('CERTIFICATE_NOT_YET_VALID', { from: info.validFrom.toISOString().slice(0, 10) });
  if (now > info.validTo) throw new HilvanaError('CERTIFICATE_EXPIRED', { to: info.validTo.toISOString().slice(0, 10) });

  const opened = await unlock(bytes, opts.openPassword);
  let base = opened.bytes;
  const previous = countSignatures(await load(base));
  const { PDF, PdfDict, PdfArray, PdfRef } = await import('@libpdf/core');
  if (previous > 0 && opened.protection !== 'none') {
    // Sign the original, still encrypted, as a new revision: its signatures stay valid.
    const pdf = await quietDecryption(() => PDF.load(bytes, { credentials: opts.openPassword ?? '' }));
    keepReadObjectsUnchanged(pdf, PdfDict, PdfArray, PdfRef);
    const res = await quietDecryption(() => pdf.sign({ signer, reason: opts.reason, location: opts.location, signingTime: now, level: 'B-B' }));
    return { bytes: res.bytes, signer: info, visible: false, previousSignatures: previous, protection: opened.protection };
  }
  const drawVisible = !!opts.visible && previous === 0;
  if (drawVisible && opts.visible) {
    const v = opts.visible;
    base = await stampText(base, { text: v.text, pages: v.pages ?? 'last', anchor: v.anchor ?? 'bottom-right', size: v.size ?? 8, color: '#1c2f6b', fonts: v.fonts });
  }
  const pdf = await PDF.load(base);
  const res = await pdf.sign({ signer, reason: opts.reason, location: opts.location, signingTime: now, level: 'B-B' });
  return { bytes: res.bytes, signer: info, visible: drawVisible, previousSignatures: previous, protection: 'none' };
}
