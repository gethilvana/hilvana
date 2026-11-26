import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, PDFHexString, degrees, rgb, type PDFObject, type PDFPage } from 'pdf-lib';
import { drawVisualText, prepareText, textWidth, visualFrame, type FontSource, type VisualFrame } from './text.js';
import { HilvanaError } from './errors.js';
import { parsePageRange } from './pages.js';
import { unlock, type Protection } from './unlock.js';

/** Raw PDF bytes. Every operation takes bytes and returns new bytes; inputs are never mutated. */
export type PdfBytes = Uint8Array;

export interface PdfInfo {
  pageCount: number;
  byteLength: number;
  encrypted: boolean;
  /** Page sizes in PDF points (1/72 inch). */
  pages: { width: number; height: number; rotation: number }[];
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
  };
  /**
   * XMP metadata streams anywhere in the file: on the document, pages, images or fonts. They can
   * repeat author, tool and file names, so they count as identifying metadata.
   */
  xmpStreams: number;
  /** True when any of the identifying metadata fields above is set, or the file carries XMP metadata. */
  hasMetadata: boolean;
  /**
   * How the original file was protected. 'permissions': usage restrictions only (it opens without a
   * password); Hilvana unlocks these automatically and the result no longer carries the restrictions.
   * 'password': it was opened with its password (see unlock()).
   */
  protection: Protection;
  /**
   * Digital signatures in the file (signature dictionaries, including document timestamps).
   * Any change Hilvana makes rewrites the file, so the result no longer carries a valid signature.
   */
  signatures: number;
  /**
   * Pages the file declares but that could not be read (a damaged page tree). Every operation
   * works on the readable pages only, so the result would lack these: say so before going on.
   */
  missingPages?: number;
}

function isSignatureDict(obj: unknown): obj is PDFDict {
  if (!(obj instanceof PDFDict)) return false;
  const type = obj.get(PDFName.of('Type'));
  const typed = type === PDFName.of('Sig') || type === PDFName.of('DocTimeStamp');
  return obj.has(PDFName.of('ByteRange')) && obj.has(PDFName.of('Contents')) && (typed || obj.has(PDFName.of('SubFilter')));
}

/** Counts digital signatures: signature dictionaries (the signed /ByteRange and /Contents), stored on their own or inline. */
export function countSignatures(doc: PDFDocument): number {
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (isSignatureDict(obj)) n++;
    else if (obj instanceof PDFDict && isSignatureDict(obj.get(PDFName.of('V')))) n++;
  }
  return n;
}

/**
 * Removes digital signatures before a changed file is saved. A signature covers exact bytes; after any
 * change it can only show as broken, which readers present as tampering. The signature's visible
 * appearance stays on the page; only the cryptographic part goes. Surfaces warn about this beforehand.
 */
export function dropSignatures(doc: PDFDocument): number {
  const sigRefs = new Set<string>();
  const refs: PDFRef[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (isSignatureDict(obj)) { sigRefs.add(ref.toString()); refs.push(ref); }
  }
  let dropped = refs.length;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const v = obj.get(PDFName.of('V'));
    if ((v instanceof PDFRef && sigRefs.has(v.toString())) || isSignatureDict(v)) {
      if (!(v instanceof PDFRef)) dropped++;
      obj.delete(PDFName.of('V'));
    }
  }
  if (dropped === 0) return 0;
  for (const ref of refs) doc.context.delete(ref);
  doc.catalog.delete(PDFName.of('Perms')); // certification (DocMDP) refers to the removed signature
  doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.delete(PDFName.of('SigFlags'));
  return dropped;
}

/** Fails with INVALID_PDF unless the document has a readable page tree. */
/**
 * Repairs page resources that real-world files sometimes get wrong (found by the public
 * benchmark): a /Resources that is a stream instead of a dictionary, or not an object at all.
 * Every operation reads the resources, so without this they would all fail.
 */
function repairResources(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    let node: PDFDict | undefined = page.node;
    let raw: PDFObject | undefined;
    for (let depth = 0; node && depth < 32 && raw === undefined; depth++) {
      raw = node.get(PDFName.of('Resources'));
      node = node.lookupMaybe(PDFName.of('Parent'), PDFDict);
    }
    if (raw === undefined) continue;
    const value = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (value instanceof PDFDict) continue;
    let fixed: PDFDict = doc.context.obj({});
    if (value instanceof PDFRawStream) {
      fixed = value.dict.clone(doc.context);
      for (const k of ['Length', 'Filter', 'DecodeParms']) fixed.delete(PDFName.of(k));
    }
    page.node.set(PDFName.of('Resources'), fixed);
  }
}

function assertStructure(doc: PDFDocument) {
  try {
    if (!doc.catalog || doc.getPageCount() < 1) throw new Error('no pages');
    doc.getPages();
    repairResources(doc);
  } catch (err) {
    throw new HilvanaError('INVALID_PDF', { reason: String((err as Error)?.message ?? err).slice(0, 200) });
  }
}

export async function load(bytes: PdfBytes): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    // Files with only usage restrictions open without a password: unlock them and carry on.
    // A file that needs a password raises PASSWORD_REQUIRED; callers unlock it first with unlock().
    if (/encrypt/i.test(message)) return load((await unlock(bytes)).bytes);
    throw new HilvanaError('INVALID_PDF', { reason: message.slice(0, 200) });
  }
  assertStructure(doc);
  return doc;
}

/** Saves without injecting a producer/creator fingerprint. */
async function save(doc: PDFDocument, opts: { objectStreams?: boolean } = {}): Promise<PdfBytes> {
  dropSignatures(doc);
  return doc.save({ useObjectStreams: opts.objectStreams ?? true });
}

/**
 * Reads structural information only. It never returns page text or images,
 * so it is safe to share with a planning model.
 */
export async function inspect(bytes: PdfBytes): Promise<PdfInfo> {
  // Encrypted files are read through their unlocked copy (D17: never report them as invalid).
  // Those that need a password raise PASSWORD_REQUIRED.
  const { bytes: open, protection } = await unlock(bytes);
  if (protection !== 'none') return { ...(await inspect(open)), byteLength: bytes.byteLength, encrypted: true, protection };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch (err) {
    throw new HilvanaError('INVALID_PDF', { reason: String((err as Error)?.message ?? err).slice(0, 200) });
  }
  if (doc.isEncrypted) throw new HilvanaError('ENCRYPTED'); // encrypted, but unlock() could not say how
  assertStructure(doc);
  const metadata = {
    title: doc.getTitle(),
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    keywords: doc.getKeywords(),
    creator: doc.getCreator(),
    producer: doc.getProducer(),
  };
  const clean = Object.fromEntries(Object.entries(metadata).filter(([, v]) => v !== undefined && v !== ''));
  return {
    pageCount: doc.getPageCount(),
    byteLength: bytes.byteLength,
    pages: doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle })),
    metadata: clean,
    xmpStreams: metadataRefs(doc).streams.length,
    hasMetadata: Object.keys(clean).length > 0 || metadataRefs(doc).streams.length > 0,
    signatures: countSignatures(doc),
    encrypted: false,
    protection: 'none',
    ...missingPages(doc),
  };
}

/**
 * Every XMP metadata stream in the file and every dictionary that points at one. PDF allows them
 * on the catalog, on pages, and on images, forms and fonts, not only on the document.
 */
function metadataRefs(doc: PDFDocument): { streams: PDFRef[]; holders: PDFDict[] } {
  const streams = new Set<PDFRef>();
  const holders: PDFDict[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : undefined;
    if (!dict) continue;
    if (obj instanceof PDFStream && dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) streams.add(ref);
    const m = dict.get(PDFName.of('Metadata'));
    if (m) {
      holders.push(dict);
      if (m instanceof PDFRef) streams.add(m);
    }
  }
  return { streams: [...streams], holders };
}

function missingPages(doc: PDFDocument): { missingPages?: number } {
  try {
    const declared = doc.catalog.lookupMaybe(PDFName.of('Pages'), PDFDict)?.lookupMaybe(PDFName.of('Count'), PDFNumber)?.asNumber();
    const missing = declared !== undefined ? declared - doc.getPageCount() : 0;
    return missing > 0 && missing < 100_000 ? { missingPages: missing } : {};
  } catch {
    return {};
  }
}

/**
 * Copying pages keeps form widgets but drops them from the document's form (pdf-lib copies pages,
 * not the AcroForm). Re-register the copied fields so they stay fillable; when documents share a
 * field name, later copies get a suffix so values do not get linked by accident.
 */
function carryFormFields(src: PDFDocument, out: PDFDocument, pages: PDFPage[], usedNames: Set<string>) {
  const fields: PDFRef[] = [];
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (!(ref instanceof PDFRef)) continue;
      let node = out.context.lookup(ref, PDFDict);
      if (node.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
      // Walk up to the top-level field.
      let top = ref;
      for (let guard = 0; guard < 32; guard++) {
        const parent = node.get(PDFName.of('Parent'));
        if (!(parent instanceof PDFRef)) break;
        top = parent;
        node = out.context.lookup(parent, PDFDict);
      }
      if (!node.get(PDFName.of('T')) || fields.some((f) => f === top || f.toString() === top.toString())) continue;
      fields.push(top);
    }
  }
  if (fields.length === 0) return;
  const srcForm = src.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  let form = out.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!form) {
    form = out.context.obj({ Fields: [] }) as PDFDict;
    out.catalog.set(PDFName.of('AcroForm'), out.context.register(form));
    for (const key of ['DR', 'DA', 'NeedAppearances']) {
      const v = srcForm?.get(PDFName.of(key));
      if (v !== undefined) {
        // Default resources may be indirect in the source; copy them into this document.
        form.set(PDFName.of(key), v instanceof PDFRef ? out.context.register(src.context.lookup(v)!.clone(out.context)) : v);
      }
    }
  }
  const list = form.lookup(PDFName.of('Fields'), PDFArray);
  for (const ref of fields) {
    const node = out.context.lookup(ref, PDFDict);
    const t = node.get(PDFName.of('T'));
    const name = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
    let unique = name;
    for (let k = 2; usedNames.has(unique); k++) unique = `${name}_${k}`;
    if (unique !== name) node.set(PDFName.of('T'), PDFHexString.fromText(unique));
    usedNames.add(unique);
    list.push(ref);
  }
}

/** Concatenates documents in the given order. */
export async function merge(inputs: PdfBytes[]): Promise<PdfBytes> {
  if (inputs.length === 0) throw new HilvanaError('NO_INPUTS');
  const out = await PDFDocument.create({ updateMetadata: false });
  const names = new Set<string>();
  for (const bytes of inputs) {
    const src = await load(bytes);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
    carryFormFields(src, out, copied, names);
  }
  return save(out);
}

/**
 * The document as it is, without encryption: opens it (with `password` when it needs one) and saves
 * it again with nothing else changed. Pages, bookmarks, forms and metadata stay. Digital signatures
 * cannot survive the rewrite, so their cryptographic part is dropped and their visible image kept.
 */
export async function removeProtection(bytes: PdfBytes, password = ''): Promise<{ bytes: PdfBytes; protection: Protection }> {
  const open = await unlock(bytes, password);
  return { bytes: await save(await load(open.bytes)), protection: open.protection };
}

/** Keeps only the selected pages, in the order given by the expression (e.g. "3,1-2"). */
export async function selectPages(bytes: PdfBytes, range: string): Promise<PdfBytes> {
  const src = await load(bytes);
  const indices = parsePageRange(range, src.getPageCount(), true);
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  carryFormFields(src, out, copied, new Set<string>());
  copyMetadata(src, out);
  return save(out);
}

/** Removes the selected pages. Refuses to produce an empty document. */
export async function removePages(bytes: PdfBytes, range: string): Promise<PdfBytes> {
  const doc = await load(bytes);
  const indices = parsePageRange(range, doc.getPageCount());
  if (indices.length >= doc.getPageCount()) throw new HilvanaError('WOULD_REMOVE_ALL_PAGES');
  for (const i of [...indices].reverse()) doc.removePage(i);
  return save(doc);
}

/** Splits into several documents, one per range expression. */
export async function split(bytes: PdfBytes, ranges: string[]): Promise<PdfBytes[]> {
  if (ranges.length === 0) throw new HilvanaError('INVALID_ARGUMENT', { ranges });
  return Promise.all(ranges.map((r) => selectPages(bytes, r)));
}

/** Splits into one document per page. */
export async function burst(bytes: PdfBytes): Promise<PdfBytes[]> {
  const info = await inspect(bytes);
  return split(bytes, Array.from({ length: info.pageCount }, (_, i) => String(i + 1)));
}

/** Rotates pages clockwise by a multiple of 90 degrees, relative to their current rotation. */
export async function rotate(bytes: PdfBytes, angle: 90 | 180 | 270 | -90, range = 'all'): Promise<PdfBytes> {
  if (![90, 180, 270, -90].includes(angle)) throw new HilvanaError('INVALID_ARGUMENT', { angle });
  const doc = await load(bytes);
  for (const i of parsePageRange(range, doc.getPageCount())) {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + angle + 360) % 360));
  }
  return save(doc);
}

export type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'bottom-center' | 'top-center';

/**
 * Positions are relative to what the reader sees: the visible box (CropBox), after page rotation.
 * Stamps on rotated or cropped pages land in the expected corner, upright.
 */
export interface Placement {
  /** Page range expression; defaults to "last" for signatures and "all" for text stamps. */
  pages?: string;
  anchor?: Anchor;
  /** Margin from the anchor edge, in points. */
  margin?: number;
  /** Explicit position in points from the bottom-left of the visible page; overrides anchor. */
  x?: number;
  y?: number;
}

/** Bottom-left corner (in the visual frame) of a w×h box placed per `p`. */
function position(frame: VisualFrame, w: number, h: number, p: Placement): { u: number; v: number } {
  if (p.x !== undefined && p.y !== undefined) return { u: p.x, v: p.y };
  const m = p.margin ?? 36;
  const W = frame.width;
  const H = frame.height;
  switch (p.anchor ?? 'bottom-right') {
    case 'top-left': return { u: m, v: H - m - h };
    case 'top-right': return { u: W - m - w, v: H - m - h };
    case 'top-center': return { u: (W - w) / 2, v: H - m - h };
    case 'bottom-left': return { u: m, v: m };
    case 'bottom-center': return { u: (W - w) / 2, v: m };
    case 'center': return { u: (W - w) / 2, v: (H - h) / 2 };
    case 'bottom-right':
    default: return { u: W - m - w, v: m };
  }
}

export interface TextOptions {
  /** Fonts for characters outside the standard PDF fonts (e.g. ✓, Greek, Cyrillic). Without them such text fails with UNSUPPORTED_CHARACTERS. */
  fonts?: FontSource;
}

export interface TextStamp extends Placement, TextOptions {
  text: string;
  size?: number;
  /** Hex color like "#1f3864". */
  color?: string;
  opacity?: number;
}

function hex(color = '#000000') {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) throw new HilvanaError('INVALID_ARGUMENT', { color });
  const n = parseInt(m[1]!, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Adds text (a date, a name, a reference number) to the selected pages. */
export async function stampText(bytes: PdfBytes, stamp: TextStamp): Promise<PdfBytes> {
  if (!stamp.text) throw new HilvanaError('INVALID_ARGUMENT', { text: stamp.text });
  const doc = await load(bytes);
  const faces = await prepareText(doc, [stamp.text], { fonts: stamp.fonts });
  const size = stamp.size ?? 10;
  const color = hex(stamp.color);
  const w = textWidth(stamp.text, faces, size);
  for (const i of parsePageRange(stamp.pages ?? 'all', doc.getPageCount())) {
    const page = doc.getPage(i);
    const frame = visualFrame(page);
    const { u, v } = position(frame, w, size, stamp);
    drawVisualText(page, frame, stamp.text, faces, { u, v, size, color, opacity: stamp.opacity });
  }
  return save(doc);
}

export interface ImageStamp extends Placement {
  /** PNG or JPEG bytes (a signature, a seal, a logo). */
  image: Uint8Array;
  /** Rendered width in points; height keeps the aspect ratio. */
  width?: number;
  opacity?: number;
}

function imageKind(bytes: Uint8Array): 'png' | 'jpg' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  throw new HilvanaError('UNSUPPORTED_IMAGE');
}

/** Embeds a PNG or JPEG, turning a damaged one into UNSUPPORTED_IMAGE instead of a raw parser error. */
async function embedImage(doc: PDFDocument, bytes: Uint8Array) {
  try {
    return imageKind(bytes) === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (err) {
    if (err instanceof HilvanaError) throw err;
    throw new HilvanaError('UNSUPPORTED_IMAGE', { reason: String((err as Error)?.message ?? err).slice(0, 120) });
  }
}

/**
 * The EXIF orientation of a JPEG (1 = as stored), read from its APP1 segment. Phones store photos
 * sideways and set this tag so viewers turn them. Undefined when there is none.
 */
export function jpegOrientation(bytes: Uint8Array): number | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]!;
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker === 0xda || len < 2) return undefined; // image data starts: no EXIF before it
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
      const t = i + 10; // TIFF header, after "Exif\0\0"
      const le = bytes[t] === 0x49;
      const u16 = (o: number) => (le ? bytes[o]! | (bytes[o + 1]! << 8) : (bytes[o]! << 8) | bytes[o + 1]!);
      const u32 = (o: number) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
      if (t + 8 > bytes.length) return undefined;
      const ifd = t + u32(t + 4);
      if (ifd + 2 > bytes.length) return undefined;
      const count = u16(ifd);
      for (let e = 0; e < count; e++) {
        const at = ifd + 2 + e * 12;
        if (at + 12 > bytes.length) return undefined;
        if (u16(at) === 0x0112) {
          const v = u16(at + 8);
          return v >= 1 && v <= 8 ? v : undefined;
        }
      }
      return undefined;
    }
    i += 2 + len;
  }
  return undefined;
}

/** Places an image such as a handwritten signature. Defaults to the last page, bottom-right. */
export async function stampImage(bytes: PdfBytes, stamp: ImageStamp): Promise<PdfBytes> {
  const doc = await load(bytes);
  const img = await embedImage(doc, stamp.image);
  for (const i of parsePageRange(stamp.pages ?? 'last', doc.getPageCount())) {
    const page = doc.getPage(i);
    const frame = visualFrame(page);
    // Never wider than the visible page minus margins.
    const width = Math.min(stamp.width ?? 150, frame.width - 2 * (stamp.margin ?? 36));
    const height = (img.height / img.width) * width;
    const { u, v } = position(frame, width, height, stamp);
    const p = frame.toPage(u, v);
    page.drawImage(img, { x: p.x, y: p.y, width, height, opacity: stamp.opacity ?? 1, rotate: degrees(frame.rotation) });
  }
  return save(doc);
}

/** Diagonal text watermark across the selected pages. */
export async function watermark(bytes: PdfBytes, text: string, opts: { pages?: string; opacity?: number; color?: string } & TextOptions = {}): Promise<PdfBytes> {
  if (!text) throw new HilvanaError('INVALID_ARGUMENT', { text });
  const doc = await load(bytes);
  const faces = await prepareText(doc, [text], { bold: true, fonts: opts.fonts });
  const color = hex(opts.color ?? '#888888');
  for (const i of parsePageRange(opts.pages ?? 'all', doc.getPageCount())) {
    const page = doc.getPage(i);
    const frame = visualFrame(page);
    // Fit the text to ~70% of the visible diagonal, capped so short words do not become huge.
    const diagonal = Math.hypot(frame.width, frame.height);
    const size = Math.min((0.7 * diagonal) / textWidth(text, faces, 1), Math.min(frame.width, frame.height) / 4);
    const w = textWidth(text, faces, size);
    const angle = (Math.atan2(frame.height, frame.width) * 180) / Math.PI;
    const a = (angle * Math.PI) / 180;
    // Start point so the text's center sits at the page center.
    const u = frame.width / 2 - (w / 2) * Math.cos(a) + (size / 3) * Math.sin(a);
    const v = frame.height / 2 - (w / 2) * Math.sin(a) - (size / 3) * Math.cos(a);
    drawVisualText(page, frame, text, faces, { u, v, size, color, opacity: opts.opacity ?? 0.2, angle });
  }
  return save(doc);
}

/** Adds page numbers. `format` accepts {n} and {total}, e.g. "Página {n} de {total}". */
export async function numberPages(bytes: PdfBytes, opts: { format?: string; anchor?: Anchor; size?: number; pages?: string } & TextOptions = {}): Promise<PdfBytes> {
  const doc = await load(bytes);
  const total = doc.getPageCount();
  const format = opts.format ?? '{n} / {total}';
  const label = (n: number) => format.replace('{n}', String(n)).replace('{total}', String(total));
  const indices = parsePageRange(opts.pages ?? 'all', total);
  const faces = await prepareText(doc, indices.map((i) => label(i + 1)), { fonts: opts.fonts });
  const size = opts.size ?? 9;
  for (const i of indices) {
    const page = doc.getPage(i);
    const frame = visualFrame(page);
    const text = label(i + 1);
    const { u, v } = position(frame, textWidth(text, faces, size), size, { anchor: opts.anchor ?? 'bottom-center', margin: 24 });
    drawVisualText(page, frame, text, faces, { u, v, size, color: rgb(0.3, 0.3, 0.3) });
  }
  return save(doc);
}

function copyMetadata(from: PDFDocument, to: PDFDocument) {
  const t = from.getTitle(); if (t) to.setTitle(t);
  const a = from.getAuthor(); if (a) to.setAuthor(a);
  const s = from.getSubject(); if (s) to.setSubject(s);
}

/** Removes identifying document metadata (title, author, subject, keywords, creator, producer, dates). */
export async function stripMetadata(bytes: PdfBytes): Promise<PdfBytes> {
  const doc = await load(bytes);
  // Empty the Info dictionary instead of leaving blank strings behind.
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const key of info.keys()) info.delete(key);
  }
  // Drop every XMP metadata stream, which often duplicates author and tool names: the document's,
  // and those on pages, images, forms and fonts. The streams themselves go too, not just the links.
  doc.catalog.delete(PDFName.of('Metadata'));
  const { streams, holders } = metadataRefs(doc);
  for (const dict of holders) dict.delete(PDFName.of('Metadata'));
  for (const ref of streams) doc.context.delete(ref);
  return save(doc);
}

export async function setMetadata(bytes: PdfBytes, meta: { title?: string; author?: string; subject?: string; keywords?: string[] }): Promise<PdfBytes> {
  const doc = await load(bytes);
  if (meta.title !== undefined) doc.setTitle(meta.title);
  if (meta.author !== undefined) doc.setAuthor(meta.author);
  if (meta.subject !== undefined) doc.setSubject(meta.subject);
  if (meta.keywords !== undefined) doc.setKeywords(meta.keywords);
  return save(doc);
}

/** Lossless optimization: compresses uncompressed streams, drops unreachable objects, uses object streams. */
export async function optimize(bytes: PdfBytes): Promise<PdfBytes> {
  const { compress } = await import('./compress.js');
  return (await compress(bytes, { level: 'lossless' })).bytes;
}

/** Builds a PDF with one image per page, each page sized to the image (or to A4/Letter with fit). */
export async function imagesToPdf(images: Uint8Array[], opts: { pageSize?: 'image' | 'a4' | 'letter'; margin?: number } = {}): Promise<PdfBytes> {
  if (images.length === 0) throw new HilvanaError('NO_INPUTS');
  const doc = await PDFDocument.create({ updateMetadata: false });
  const sizes = { a4: [595.28, 841.89], letter: [612, 792] } as const;
  for (const bytes of images) {
    const img = await embedImage(doc, bytes);
    // Photos stored sideways are turned as phones show them (EXIF 3, 6 and 8; mirrored ones stay as stored).
    const turn = ({ 3: 180, 6: 90, 8: 270 } as Record<number, number>)[jpegOrientation(bytes) ?? 1] ?? 0;
    const sideways = turn === 90 || turn === 270;
    const shownW = sideways ? img.height : img.width;
    const shownH = sideways ? img.width : img.height;
    let W: number, H: number, scale: number;
    if ((opts.pageSize ?? 'image') === 'image') {
      [W, H, scale] = [shownW, shownH, 1];
    } else {
      // Landscape images get a landscape page, as other converters do.
      const [a, b] = sizes[opts.pageSize as 'a4' | 'letter'];
      [W, H] = shownW > shownH ? [b, a] : [a, b];
      const m = opts.margin ?? 36;
      scale = Math.min((W - 2 * m) / shownW, (H - 2 * m) / shownH, 1);
    }
    const page = doc.addPage([W, H]);
    // The box the image occupies as shown, centered; then where its stored lower-left corner goes.
    const bw = shownW * scale;
    const bh = shownH * scale;
    const X = (W - bw) / 2;
    const Y = (H - bh) / 2;
    const w = img.width * scale;
    const h = img.height * scale;
    // pdf-lib rotates counterclockwise around (x, y); a clockwise turn is a negative angle.
    if (turn === 90) page.drawImage(img, { x: X, y: Y + bh, width: w, height: h, rotate: degrees(-90) });
    else if (turn === 270) page.drawImage(img, { x: X + bw, y: Y, width: w, height: h, rotate: degrees(90) });
    else if (turn === 180) page.drawImage(img, { x: X + bw, y: Y + bh, width: w, height: h, rotate: degrees(180) });
    else page.drawImage(img, { x: X, y: Y, width: w, height: h });
  }
  return save(doc);
}
