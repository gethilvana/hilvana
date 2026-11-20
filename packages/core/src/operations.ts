import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb, type PDFPage } from 'pdf-lib';
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

export async function load(bytes: PdfBytes): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/encrypt/i.test(message)) throw new HilvanaError('ENCRYPTED');
    throw new HilvanaError('INVALID_PDF', { reason: message.slice(0, 200) });
  }
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

/** Concatenates documents in the given order. */
export async function merge(inputs: PdfBytes[]): Promise<PdfBytes> {
  if (inputs.length === 0) throw new HilvanaError('NO_INPUTS');
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const bytes of inputs) {
    const src = await load(bytes);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
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

export interface Placement {
  /** Page range expression; defaults to "last" for signatures and "all" for text stamps. */
  pages?: string;
  anchor?: Anchor;
  /** Margin from the anchor edge, in points. */
  margin?: number;
  /** Explicit position in points from the bottom-left corner; overrides anchor. */
  x?: number;
  y?: number;
}

function position(page: PDFPage, w: number, h: number, p: Placement): { x: number; y: number } {
  if (p.x !== undefined && p.y !== undefined) return { x: p.x, y: p.y };
  const m = p.margin ?? 36;
  const W = page.getWidth();
  const H = page.getHeight();
  switch (p.anchor ?? 'bottom-right') {
    case 'top-left': return { x: m, y: H - m - h };
    case 'top-right': return { x: W - m - w, y: H - m - h };
    case 'top-center': return { x: (W - w) / 2, y: H - m - h };
    case 'bottom-left': return { x: m, y: m };
    case 'bottom-center': return { x: (W - w) / 2, y: m };
    case 'center': return { x: (W - w) / 2, y: (H - h) / 2 };
    case 'bottom-right':
    default: return { x: W - m - w, y: m };
  }
}

export interface TextStamp extends Placement {
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
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = stamp.size ?? 10;
  for (const i of parsePageRange(stamp.pages ?? 'all', doc.getPageCount())) {
    const page = doc.getPage(i);
    const w = font.widthOfTextAtSize(stamp.text, size);
    const { x, y } = position(page, w, size, stamp);
    page.drawText(stamp.text, { x, y, size, font, color: hex(stamp.color), opacity: stamp.opacity ?? 1 });
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
  const img = imageKind(stamp.image) === 'png' ? await doc.embedPng(stamp.image) : await doc.embedJpg(stamp.image);
  const width = stamp.width ?? 150;
  const height = (img.height / img.width) * width;
  for (const i of parsePageRange(stamp.pages ?? 'last', doc.getPageCount())) {
    const page = doc.getPage(i);
    const { x, y } = position(page, width, height, stamp);
    page.drawImage(img, { x, y, width, height, opacity: stamp.opacity ?? 1 });
  }
  return save(doc);
}

/** Diagonal text watermark across the selected pages. */
export async function watermark(bytes: PdfBytes, text: string, opts: { pages?: string; opacity?: number; color?: string } = {}): Promise<PdfBytes> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const i of parsePageRange(opts.pages ?? 'all', doc.getPageCount())) {
    const page = doc.getPage(i);
    // Fit the text to ~70% of the page diagonal, capped so short words do not become huge.
    const diagonal = Math.hypot(page.getWidth(), page.getHeight());
    const size = Math.min((0.7 * diagonal) / font.widthOfTextAtSize(text, 1), Math.min(page.getWidth(), page.getHeight()) / 4);
    const w = font.widthOfTextAtSize(text, size);
    const cx = page.getWidth() / 2;
    const cy = page.getHeight() / 2;
    const a = Math.PI / 4;
    page.drawText(text, {
      x: cx - (w / 2) * Math.cos(a) + (size / 2) * Math.sin(a),
      y: cy - (w / 2) * Math.sin(a) - (size / 2) * Math.cos(a),
      size,
      font,
      rotate: degrees(45),
      color: hex(opts.color ?? '#888888'),
      opacity: opts.opacity ?? 0.2,
    });
  }
  return save(doc);
}

/** Adds page numbers. `format` accepts {n} and {total}, e.g. "Página {n} de {total}". */
export async function numberPages(bytes: PdfBytes, opts: { format?: string; anchor?: Anchor; size?: number; pages?: string } = {}): Promise<PdfBytes> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  const size = opts.size ?? 9;
  for (const i of parsePageRange(opts.pages ?? 'all', total)) {
    const page = doc.getPage(i);
    const text = (opts.format ?? '{n} / {total}').replace('{n}', String(i + 1)).replace('{total}', String(total));
    const w = font.widthOfTextAtSize(text, size);
    const { x, y } = position(page, w, size, { anchor: opts.anchor ?? 'bottom-center', margin: 24 });
    page.drawText(text, { x, y, size, font, color: rgb(0.3, 0.3, 0.3) });
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

/**
 * Lossless structural optimization (object streams, unused objects dropped on re-save).
 * Real image recompression is planned; see docs/roadmap.md.
 */
export async function optimize(bytes: PdfBytes): Promise<PdfBytes> {
  const doc = await load(bytes);
  const out = await save(doc, { objectStreams: true });
  return out.byteLength < bytes.byteLength ? out : bytes;
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
