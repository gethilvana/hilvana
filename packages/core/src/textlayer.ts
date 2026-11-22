import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, type PDFFont } from 'pdf-lib';
import jpeg from 'jpeg-js';
import { components, decodeStream } from './compress.js';
import { parseContent } from './content.js';
import { load, type PdfBytes } from './operations.js';
import { openPdfJs } from './redact.js';

/**
 * Pieces for OCR: which pages have no text, the scanned images on a page (decoded, with where
 * they sit), and an invisible text layer that makes recognized words searchable and selectable.
 * Recognition itself lives in @hilvana/office.
 */

/** RGBA pixels, like ImageData. */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Maps a pixel (x right, y down, origin top-left) to a point on the page (PDF user space). */
export type PixelToPage = [number, number, number, number, number, number];

export const pixelToPage = (m: PixelToPage, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A recognized word, as a quadrilateral on the page: its baseline start, baseline end and top-left. */
export interface LayerWord {
  text: string;
  /** Bottom-left, bottom-right and top-left corners, in PDF user space. */
  quad: [[number, number], [number, number], [number, number]];
}

/** Pages (1-based) whose text a reader would extract is shorter than `minChars`. */
export async function pagesWithoutText(bytes: PdfBytes, minChars = 10): Promise<number[]> {
  const pdfjs = await openPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false });
  const out: number[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const items = (await (await doc.getPage(n)).getTextContent()).items as { str?: string }[];
      const chars = items.reduce((s, it) => s + (it.str ?? '').replace(/\s/g, '').length, 0);
      if (chars < minChars) out.push(n);
    }
  } finally {
    await task.destroy();
  }
  return out;
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Decodes an image XObject to RGBA, or undefined when its format is not supported here. */
function decodeRgba(doc: PDFDocument, img: PDFRawStream): RgbaImage | undefined {
  const d = img.dict;
  const W = d.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
  const H = d.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
  const bpc = d.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber() ?? 8;
  if (!W || !H || W * H > 60_000_000) return undefined;
  const filter = d.get(PDFName.of('Filter'));
  const f = filter instanceof PDFArray ? filter.asArray().map((x) => (x as PDFName).asString()) : filter instanceof PDFName ? [filter.asString()] : [];
  const out = new Uint8ClampedArray(W * H * 4);
  if (f.length === 1 && f[0] === '/DCTDecode') {
    try {
      const px = jpeg.decode(img.contents, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
      if (px.width !== W || px.height !== H) return { data: new Uint8ClampedArray(px.data), width: px.width, height: px.height };
      out.set(px.data);
      return { data: out, width: W, height: H };
    } catch {
      return undefined;
    }
  }
  if (f.length > 1 || (f.length === 1 && f[0] !== '/FlateDecode')) return undefined; // CCITT, JBIG2, JPX…
  const raw = decodeStream(img);
  if (!raw) return undefined;
  const mask = String(d.get(PDFName.of('ImageMask'))) === 'true';
  const n = mask ? 1 : components(doc, d.get(PDFName.of('ColorSpace')));
  if (!n || (bpc !== 8 && bpc !== 1)) return undefined;
  const rowBytes = Math.ceil((W * n * bpc) / 8);
  if (raw.length < rowBytes * H) return undefined;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r: number, g: number, b: number;
      if (bpc === 1) {
        const bit = (raw[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        r = g = b = mask ? (bit ? 255 : 0) : bit * 255;
      } else if (n === 1) {
        r = g = b = raw[y * rowBytes + x]!;
      } else {
        const i = y * rowBytes + x * 3;
        r = raw[i]!; g = raw[i + 1]!; b = raw[i + 2]!;
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

export interface ScannedImage {
  image: RgbaImage;
  toPage: PixelToPage;
}

/**
 * The images on a page large enough to be a scan (a quarter of the page or more), decoded, with
 * the mapping from their pixels to the page. `unsupported` counts large images in formats that
 * cannot be decoded here (CCITT, JBIG2, JPEG 2000): render the page instead to read those.
 */
export async function scannedImages(bytes: PdfBytes, page: number): Promise<{ images: ScannedImage[]; unsupported: number }> {
  const doc = await load(bytes);
  const p = doc.getPage(page - 1);
  const node = p.node;
  const { width, height } = p.getSize();
  const contents = node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : contents ? [contents] : [];
  const parts: Uint8Array[] = [];
  for (const s of streams) if (s instanceof PDFRawStream) { const dd = decodeStream(s); if (dd) parts.push(dd); }
  const src = new Uint8Array(parts.reduce((a, b) => a + b.length + 1, 0));
  let o = 0;
  for (const part of parts) { src.set(part, o); o += part.length; src[o++] = 10; }

  const images: ScannedImage[] = [];
  let unsupported = 0;
  const walk = (content: Uint8Array, res: PDFDict | undefined, start: Matrix, depth: number) => {
    let ops;
    try { ops = parseContent(content); } catch { return; }
    let ctm = start;
    const stack: Matrix[] = [];
    for (const op of ops) {
      const num = (i: number) => (op.args[i]?.type === 'number' ? (op.args[i] as { value: number }).value : 0);
      if (op.op === 'q') stack.push(ctm);
      else if (op.op === 'Q') ctm = stack.pop() ?? start;
      else if (op.op === 'cm' && op.args.length === 6) ctm = mul([0, 1, 2, 3, 4, 5].map(num) as Matrix, ctm);
      else if (op.op === 'Do' && op.args[0]?.type === 'name') {
        const ref = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.get(PDFName.of(op.args[0].value));
        const xo = ref instanceof PDFRef ? doc.context.lookup(ref) : undefined;
        if (!(xo instanceof PDFRawStream)) continue;
        const sub = xo.dict.get(PDFName.of('Subtype'));
        if (sub === PDFName.of('Image')) {
          const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
          if (area < width * height * 0.25) continue;
          const img = decodeRgba(doc, xo);
          if (!img) { unsupported++; continue; }
          // Pixel (x, y) → unit square (x / W, 1 - y / H) → page.
          const unit: Matrix = [1 / img.width, 0, 0, -1 / img.height, 0, 1];
          images.push({ image: img, toPage: mul(unit, ctm) });
        } else if (sub === PDFName.of('Form') && depth < 6) {
          const inner = decodeStream(xo);
          const fm = (xo.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)?.asArray().map((x) => (doc.context.lookup(x) as PDFNumber).asNumber()) ?? [1, 0, 0, 1, 0, 0]) as Matrix;
          if (inner) walk(inner, xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? res, mul(fm, ctm), depth + 1);
        }
      }
    }
  };
  walk(src, node.Resources(), [1, 0, 0, 1, 0, 0], 0);
  return { images, unsupported };
}

/** Characters the standard font cannot draw are replaced; the layer is invisible anyway. */
function encodable(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += ch.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]/g, '?'); }
  }
  return out;
}

/**
 * Adds an invisible text layer (render mode 3, like scanners do) with the recognized words, so
 * the pages can be searched, selected and copied. The page looks exactly the same.
 */
export async function addTextLayer(bytes: PdfBytes, pages: { page: number; words: LayerWord[] }[]): Promise<PdfBytes> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontKey = 'HilvanaOCR';
  for (const { page, words } of pages) {
    if (!words.length) continue;
    const p = doc.getPage(page - 1);
    const lines = ['q', 'BT', '3 Tr'];
    for (const w of words) {
      const text = encodable(font, w.text);
      if (!text.trim()) continue;
      const [[x0, y0], [x1, y1], [x2, y2]] = w.quad;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const tall = Math.hypot(x2 - x0, y2 - y0);
      if (len < 0.5 || tall < 0.5) continue;
      const dir = [(x1 - x0) / len, (y1 - y0) / len];
      const up = [(x2 - x0) / tall, (y2 - y0) / tall];
      const size = tall * 0.82;
      const natural = font.widthOfTextAtSize(text, size);
      const tz = natural > 0 ? (100 * len) / natural : 100;
      const e = x0 + up[0]! * tall * 0.16, f = y0 + up[1]! * tall * 0.16;
      const r = (v: number) => Math.round(v * 1000) / 1000;
      lines.push(`/${fontKey} ${r(size)} Tf`, `${r(tz)} Tz`, `${r(dir[0]!)} ${r(dir[1]!)} ${r(up[0]!)} ${r(up[1]!)} ${r(e)} ${r(f)} Tm`, `${font.encodeText(text).toString()} Tj`);
    }
    lines.push('ET', 'Q');
    const res = p.node.Resources() ?? doc.context.obj({});
    const fonts = res.lookupMaybe(PDFName.of('Font'), PDFDict) ?? doc.context.obj({});
    fonts.set(PDFName.of(fontKey), font.ref);
    res.set(PDFName.of('Font'), fonts);
    p.node.set(PDFName.of('Resources'), res);
    // Wrap the existing content so its graphics state cannot leak into the layer.
    const stream = doc.context.register(doc.context.flateStream(lines.join('\n')));
    const before = doc.context.register(doc.context.flateStream('q'));
    const after = doc.context.register(doc.context.flateStream('Q'));
    const existing = p.node.get(PDFName.of('Contents'));
    const resolved = existing instanceof PDFRef ? doc.context.lookup(existing) : existing;
    const list = resolved instanceof PDFArray ? resolved.asArray() : existing instanceof PDFRef ? [existing] : [];
    p.node.set(PDFName.of('Contents'), doc.context.obj([before, ...list, after, stream]));
  }
  return doc.save({ useObjectStreams: true });
}
