import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, PDFHexString, degrees, rgb, type PDFPage } from 'pdf-lib';
import { drawVisualText, prepareText, textWidth, visualFrame, type FontSource, type VisualFrame } from './text.js';
import { HilvanaError } from './errors.js';
import { parsePageRange } from './pages.js';

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
  /** True when any of the identifying metadata fields above is set. */
  hasMetadata: boolean;
}

/** Fails with INVALID_PDF unless the document has a readable page tree. */
function assertStructure(doc: PDFDocument) {
  try {
    if (!doc.catalog || doc.getPageCount() < 1) throw new Error('no pages');
    doc.getPages();
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
    if (/encrypt/i.test(message)) throw new HilvanaError('ENCRYPTED');
    throw new HilvanaError('INVALID_PDF', { reason: message.slice(0, 200) });
  }
  assertStructure(doc);
  return doc;
}

/** Saves without injecting a producer/creator fingerprint. */
async function save(doc: PDFDocument, opts: { objectStreams?: boolean } = {}): Promise<PdfBytes> {
  return doc.save({ useObjectStreams: opts.objectStreams ?? true });
}

/**
 * Reads structural information only. It never returns page text or images,
 * so it is safe to share with a planning model.
 */
export async function inspect(bytes: PdfBytes): Promise<PdfInfo> {
  let encrypted = false;
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    encrypted = doc.isEncrypted;
  } catch (err) {
    throw new HilvanaError('INVALID_PDF', { reason: String((err as Error)?.message ?? err).slice(0, 200) });
  }
  // An encrypted file often cannot even be walked without decrypting it: say so, not "invalid" (D17).
  try {
    assertStructure(doc);
  } catch (err) {
    if (encrypted) throw new HilvanaError('ENCRYPTED');
    throw err;
  }
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
    encrypted,
    pages: doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle })),
    metadata: clean,
    hasMetadata: Object.keys(clean).length > 0,
  };
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

/** Places an image such as a handwritten signature. Defaults to the last page, bottom-right. */
export async function stampImage(bytes: PdfBytes, stamp: ImageStamp): Promise<PdfBytes> {
  const doc = await load(bytes);
  let img;
  try {
    img = imageKind(stamp.image) === 'png' ? await doc.embedPng(stamp.image) : await doc.embedJpg(stamp.image);
  } catch (err) {
    if (err instanceof HilvanaError) throw err;
    throw new HilvanaError('UNSUPPORTED_IMAGE', { reason: String((err as Error)?.message ?? err).slice(0, 120) });
  }
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
  // Drop the XMP metadata stream, which often duplicates author and tool names.
  doc.catalog.delete(PDFName.of('Metadata'));
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
    const img = imageKind(bytes) === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    if ((opts.pageSize ?? 'image') === 'image') {
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const [W, H] = sizes[opts.pageSize as 'a4' | 'letter'];
      const m = opts.margin ?? 36;
      const scale = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const page = doc.addPage([W, H]);
      page.drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
    }
  }
  return save(doc);
}
