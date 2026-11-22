import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef,
  type PDFObject,
} from 'pdf-lib';
import { zlibSync } from 'fflate';
import jpeg from 'jpeg-js';
import { Font, Encodings, type FontNames } from '@pdf-lib/standard-fonts';
import { HilvanaError } from './errors.js';
import { ContentSyntaxError, parseContent, rewriteContent, serializeOp, type Op, type Operand } from './content.js';
import { components, decodeStream, encodeJpeg, removeUnreachable } from './compress.js';
import { dropSignatures, load, type PdfBytes } from './operations.js';

/**
 * Real redaction: what lies under each area is removed from the file, not just covered.
 *
 * - Text: every glyph whose box falls mostly inside an area is deleted from the page's drawing
 *   instructions (the glyphs around it keep their place). Invisible text, like an OCR layer, too.
 * - Images: the pixels under the area are painted over in the image itself (JPEG and Flate
 *   images, their transparency masks included); images in other formats are removed whole.
 * - Shapes drawn entirely inside an area, inline images and annotations that touch it are removed.
 * - Thumbnails and the accessibility structure (which can repeat the text) are removed, and so
 *   are unused objects, so nothing of the old content stays in the file.
 * A black box is then drawn over each area. The result is checked by reading its text again.
 */

export interface RedactArea {
  /** 1-based page number. */
  page: number;
  /** In PDF points, origin at the bottom-left corner of the page (unrotated user space). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RedactOptions {
  areas: RedactArea[];
  /** Fill of the boxes; defaults to black. */
  color?: string;
}

export interface RedactReport {
  areas: number;
  pages: number[];
  /** Characters removed. */
  glyphs: number;
  /** Images whose pixels under an area were painted over. */
  imagesPainted: number;
  /** Images removed whole because their format cannot be edited here. */
  imagesRemoved: number;
  shapes: number;
  annotations: number;
  /** The accessibility structure was removed (it could repeat the redacted text). */
  structureRemoved: boolean;
  /** A second, stricter pass removed whole text runs that the first left behind. */
  strictPass: boolean;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m: Matrix): Matrix | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return undefined;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const boxOf = (pts: [number, number][]): Box => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
});
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const intersects = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const contains = (outer: Box, inner: Box, tol = 1) => inner.x0 >= outer.x0 - tol && inner.y0 >= outer.y0 - tol && inner.x1 <= outer.x1 + tol && inner.y1 <= outer.y1 + tol;

/** A glyph goes when its center is inside an area or a third of it is covered. */
function glyphHit(g: Box, rects: Box[]): boolean {
  const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
  const area = Math.max(1e-6, (g.x1 - g.x0) * (g.y1 - g.y0));
  return rects.some((r) => (cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1) || overlap(g, r) / area >= 0.34);
}

/* ------------------------------------------------------------------ fonts */

interface FontInfo {
  twoByte: boolean;
  vertical: boolean;
  /** Advance width of a code in thousandths of the font size. */
  width: (code: number) => number;
  ascent: number;
  descent: number;
}

let standardNames: Map<number, string> | undefined;
function winAnsiName(code: number): string | undefined {
  if (!standardNames) {
    standardNames = new Map();
    const enc = Encodings.WinAnsi;
    for (const cp of enc.supportedCodePoints) {
      const { code: c, name } = enc.encodeUnicodeCodePoint(cp);
      if (!standardNames.has(c)) standardNames.set(c, name);
    }
  }
  return standardNames.get(code);
}

const STANDARD = new Set(['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Symbol', 'ZapfDingbats']);
const ALIASES: Record<string, string> = { Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', TimesNewRoman: 'Times-Roman', CourierNew: 'Courier' };

function fontInfo(doc: PDFDocument, font: PDFDict | undefined): FontInfo {
  const fallback: FontInfo = { twoByte: false, vertical: false, width: () => 600, ascent: 800, descent: -200 };
  if (!font) return fallback;
  const lookupNum = (d: PDFDict | undefined, k: string) => d?.lookupMaybe(PDFName.of(k), PDFNumber)?.asNumber();
  const subtype = font.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString();
  const metrics = (descriptor: PDFDict | undefined) => {
    const a = lookupNum(descriptor, 'Ascent');
    const d = lookupNum(descriptor, 'Descent');
    return { ascent: a && a > 0 ? a : 800, descent: d && d < 0 ? d : -200 };
  };

  if (subtype === '/Type0') {
    const enc = font.lookup(PDFName.of('Encoding'));
    const encName = enc instanceof PDFName ? enc.asString() : '';
    const descendant = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0, PDFDict);
    const dw = lookupNum(descendant, 'DW') ?? 1000;
    const widths = new Map<number, number>();
    const w = descendant?.lookupMaybe(PDFName.of('W'), PDFArray);
    if (w) {
      const items = w.asArray().map((x) => doc.context.lookup(x) as PDFObject);
      for (let k = 0; k < items.length;) {
        const first = items[k];
        const second = items[k + 1];
        if (!(first instanceof PDFNumber)) break;
        if (second instanceof PDFArray) {
          second.asArray().forEach((v, j) => { const n = doc.context.lookup(v); if (n instanceof PDFNumber) widths.set(first.asNumber() + j, n.asNumber()); });
          k += 2;
        } else {
          const last = second instanceof PDFNumber ? second.asNumber() : first.asNumber();
          const value = items[k + 2] instanceof PDFNumber ? (items[k + 2] as PDFNumber).asNumber() : dw;
          for (let c = first.asNumber(); c <= last && c - first.asNumber() < 65536; c++) widths.set(c, value);
          k += 3;
        }
      }
    }
    return { twoByte: true, vertical: encName.endsWith('-V'), width: (c) => widths.get(c) ?? dw, ...metrics(descendant?.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)) };
  }

  const descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  const first = lookupNum(font, 'FirstChar') ?? 0;
  const list = font.lookupMaybe(PDFName.of('Widths'), PDFArray)?.asArray().map((x) => { const n = doc.context.lookup(x); return n instanceof PDFNumber ? n.asNumber() : 0; });
  const missing = lookupNum(descriptor, 'MissingWidth');
  let scale = 1;
  let m = metrics(descriptor);
  if (subtype === '/Type3') {
    const fm = font.lookupMaybe(PDFName.of('FontMatrix'), PDFArray)?.asArray().map((x) => (doc.context.lookup(x) as PDFNumber).asNumber());
    scale = (fm?.[0] ?? 0.001) * 1000;
    const bb = font.lookupMaybe(PDFName.of('FontBBox'), PDFArray)?.asArray().map((x) => (doc.context.lookup(x) as PDFNumber).asNumber());
    if (bb && fm) m = { ascent: Math.max(bb[3]! * fm[3]! * 1000, 100), descent: Math.min(bb[1]! * fm[3]! * 1000, 0) };
  }
  let standard: Font | undefined;
  const base = font.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.asString().slice(1).replace(/^[A-Z]{6}\+/, '');
  if (!list && base) {
    const name = STANDARD.has(base) ? base : ALIASES[base];
    if (name) standard = Font.load(name as FontNames);
  }
  return {
    twoByte: false,
    vertical: false,
    width: (c) => {
      const fromList = list?.[c - first];
      if (fromList !== undefined) return fromList * scale;
      if (standard) {
        const glyph = winAnsiName(c);
        const w = glyph ? standard.getWidthOfGlyph(glyph) : undefined;
        if (typeof w === 'number') return w;
      }
      return missing ?? 600;
    },
    ...m,
  };
}

/* ------------------------------------------------------------------ images */

interface PendingImage {
  ref: PDFRef;
  stream: PDFRawStream;
  /** Areas to paint, in image pixel coordinates. */
  boxes: Box[];
}

/** A new stream with the given bytes and every entry of `dict` (but its length). */
function streamWith(doc: PDFDocument, bytes: Uint8Array, dict: PDFDict, flate = false): PDFRawStream {
  const s = (flate ? doc.context.flateStream(bytes, {}) : doc.context.stream(bytes, {})) as unknown as PDFRawStream;
  for (const [k, v] of dict.entries()) {
    if (k === PDFName.of('Length') || (flate && (k === PDFName.of('Filter') || k === PDFName.of('DecodeParms')))) continue;
    s.dict.set(k, v);
  }
  return s;
}

/** Paints the boxes into an image (and its transparency mask). Undefined when the format is not editable here. */
function paintImage(doc: PDFDocument, img: PDFRawStream, boxes: Box[]): PDFRawStream | undefined {
  const dict = img.dict;
  const W = dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
  const H = dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
  const bpc = dict.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber() ?? 8;
  if (!W || !H) return undefined;
  const filter = dict.get(PDFName.of('Filter'));
  const f = filter instanceof PDFArray ? filter.asArray().map((x) => (x as PDFName).asString()) : filter instanceof PDFName ? [filter.asString()] : [];
  const clip = (b: Box) => ({ x0: Math.max(0, Math.floor(b.x0)), y0: Math.max(0, Math.floor(b.y0)), x1: Math.min(W, Math.ceil(b.x1)), y1: Math.min(H, Math.ceil(b.y1)) });
  const copy = () => {
    const d = dict.clone(doc.context);
    for (const k of ['Filter', 'DecodeParms', 'Length']) d.delete(PDFName.of(k));
    return d;
  };

  let out: PDFRawStream | undefined;
  if (f.length === 1 && f[0] === '/DCTDecode' && bpc === 8) {
    const n = components(doc, dict.get(PDFName.of('ColorSpace')));
    if (n !== 1 && n !== 3) return undefined; // CMYK JPEGs and others: removed whole instead
    let px: { data: Uint8Array; width: number; height: number };
    try {
      px = jpeg.decode(img.contents, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 }) as typeof px;
    } catch {
      return undefined;
    }
    for (const b of boxes.map(clip)) {
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
        const o = (y * px.width + x) * 4;
        px.data[o] = px.data[o + 1] = px.data[o + 2] = 0;
      }
    }
    const d = copy();
    d.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    d.delete(PDFName.of('Decode'));
    out = streamWith(doc, encodeJpeg(px.data, px.width, px.height, 92), d);
  } else if (f.length === 0 || (f.length === 1 && f[0] === '/FlateDecode')) {
    const raw = decodeStream(img);
    if (!raw) return undefined;
    const isMask = String(dict.get(PDFName.of('ImageMask'))) === 'true';
    const cs = dict.get(PDFName.of('ColorSpace'));
    const csv = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
    const n = isMask ? 1 : csv instanceof PDFArray && csv.get(0) === PDFName.of('Indexed') ? 1 : csv === PDFName.of('DeviceCMYK') ? 4 : components(doc, cs);
    if (!n || (bpc !== 8 && bpc !== 1)) return undefined;
    const px = new Uint8Array(raw);
    const rowBytes = Math.ceil((W * n * bpc) / 8);
    if (px.length < rowBytes * H) return undefined;
    for (const b of boxes.map(clip)) {
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) {
          if (bpc === 8) px.fill(0, y * rowBytes + x * n, y * rowBytes + x * n + n);
          else px[y * rowBytes + (x >> 3)]! &= ~(0x80 >> (x & 7)); // 1-bit: set to 0
        }
      }
    }
    const d = copy();
    d.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    out = streamWith(doc, zlibSync(px), d);
  } else {
    return undefined;
  }

  // A transparency mask can hold a shape by itself (a signature on a plain colour): make the
  // painted part opaque so the shape is gone too.
  const smaskRef = dict.get(PDFName.of('SMask'));
  const smask = smaskRef instanceof PDFRef ? doc.context.lookup(smaskRef) : undefined;
  if (smask instanceof PDFRawStream) {
    const mw = smask.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? W;
    const mh = smask.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? H;
    const raw = decodeStream(smask);
    if (!raw || (smask.dict.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber() ?? 8) !== 8) {
      out.dict.delete(PDFName.of('SMask')); // cannot edit the mask: drop it, the image becomes opaque
    } else {
      const m = new Uint8Array(raw);
      const sx = mw / W, sy = mh / H;
      for (const b of boxes.map(clip)) {
        for (let y = Math.floor(b.y0 * sy); y < Math.ceil(b.y1 * sy); y++) m.fill(255, y * mw + Math.floor(b.x0 * sx), y * mw + Math.ceil(b.x1 * sx));
      }
      const md = smask.dict.clone(doc.context);
      for (const k of ['Filter', 'DecodeParms', 'Length']) md.delete(PDFName.of(k));
      md.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      out.dict.set(PDFName.of('SMask'), doc.context.register(streamWith(doc, zlibSync(m), md)));
    }
  }
  if (dict.get(PDFName.of('Mask')) instanceof PDFRef) out.dict.delete(PDFName.of('Mask'));
  return out;
}

/* ------------------------------------------------------------------ content */

interface Counters { glyphs: number; imagesPainted: number; imagesRemoved: number; shapes: number }

interface Scope {
  doc: PDFDocument;
  rects: Box[];
  counters: Counters;
  strict: boolean;
  fonts: Map<PDFDict, FontInfo>;
}

/**
 * Redacts one content stream (a page, or a form it draws). Returns the new stream bytes and the
 * resources it needs, or undefined when nothing under the areas was found.
 */
function redactStream(scope: Scope, src: Uint8Array, resources: PDFDict | undefined, start: Matrix, depth: number): { bytes: Uint8Array; resources: PDFDict | undefined } | undefined {
  const { doc, rects, counters } = scope;
  let ops: Op[];
  try {
    ops = parseContent(src);
  } catch (err) {
    if (err instanceof ContentSyntaxError) throw new HilvanaError('REDACTION_UNSUPPORTED', { reason: err.message });
    throw err;
  }
  const replace = new Map<Op, string[]>();
  let res = resources;
  let resCloned = false;
  const ownResources = () => {
    if (!resCloned) {
      res = (res ?? doc.context.obj({})).clone(doc.context);
      const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (xo) res.set(PDFName.of('XObject'), xo.clone(doc.context));
      resCloned = true;
    }
    return res!;
  };
  const xobjects = () => res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const pending = new Map<string, PendingImage>();

  // Graphics and text state.
  interface GState { ctm: Matrix; tc: number; tw: number; tz: number; tl: number; ts: number; font?: PDFDict; size: number }
  let gs: GState = { ctm: start, tc: 0, tw: 0, tz: 100, tl: 0, ts: 0, size: 0 };
  const stack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let path: [number, number][] = [];
  const num = (o: Operand | undefined) => (o?.type === 'number' ? o.value : 0);

  const fontOf = (): FontInfo => {
    const f = gs.font;
    if (!f) return fontInfo(doc, undefined);
    let info = scope.fonts.get(f);
    if (!info) scope.fonts.set(f, (info = fontInfo(doc, f)));
    return info;
  };

  /** Walks a string's glyphs from the current text matrix; returns which codes to keep. */
  const show = (bytes: Uint8Array, collect: (code: Uint8Array, advance: number, hit: boolean) => void) => {
    const font = fontOf();
    const th = gs.tz / 100;
    const step = font.twoByte ? 2 : 1;
    for (let k = 0; k + step <= bytes.length; k += step) {
      const code = step === 2 ? (bytes[k]! << 8) | bytes[k + 1]! : bytes[k]!;
      const w0 = font.width(code) / 1000;
      const space = step === 1 && code === 32 ? gs.tw : 0;
      const advance = (w0 * gs.size + gs.tc + space) * th;
      const m = mul(tm, gs.ctm);
      const gw = Math.max(w0 * gs.size, gs.size * 0.05) * th;
      const y0 = (font.descent / 1000) * gs.size + gs.ts;
      const y1 = (font.ascent / 1000) * gs.size + gs.ts;
      const box = font.vertical
        ? boxOf([apply(m, -gs.size / 2, 0), apply(m, gs.size / 2, 0), apply(m, -gs.size / 2, -gs.size), apply(m, gs.size / 2, -gs.size)])
        : boxOf([apply(m, 0, y0), apply(m, gw, y0), apply(m, 0, y1), apply(m, gw, y1)]);
      collect(bytes.subarray(k, k + step), advance, glyphHit(box, rects));
      tm = font.vertical ? mul([1, 0, 0, 1, 0, -(gs.size + gs.tc + space)], tm) : mul([1, 0, 0, 1, advance, 0], tm);
    }
  };

  /** Rewrites a text-showing operator without the glyphs under the areas. */
  const showOp = (op: Op, items: Operand[], before: string[]) => {
    const out: Operand[] = [];
    let removed = 0;
    let kept = 0;
    // Total displacement of the operator in TJ units, for the strict pass.
    let total = 0;
    const th = gs.tz / 100 || 1;
    const units = (advance: number) => (gs.size ? -(advance / th) * 1000 / gs.size : 0);
    const pushNum = (v: number) => {
      const last = out[out.length - 1];
      if (last?.type === 'number') last.value += v;
      else out.push({ type: 'number', value: v });
    };
    for (const it of items) {
      if (it.type === 'number') {
        tm = fontOf().vertical ? mul([1, 0, 0, 1, 0, -(it.value / 1000) * gs.size], tm) : mul([1, 0, 0, 1, -(it.value / 1000) * gs.size * th, 0], tm);
        pushNum(it.value);
        total += it.value;
      } else if (it.type === 'string') {
        let buf: number[] = [];
        const flush = () => { if (buf.length) { out.push({ type: 'string', value: Uint8Array.from(buf) }); buf = []; } };
        show(it.value, (code, advance, hit) => {
          total += units(advance);
          if (hit) {
            removed++;
            flush();
            pushNum(units(advance));
          } else {
            kept++;
            buf.push(...code);
          }
        });
        flush();
      }
    }
    if (!removed) return;
    if (scope.strict) {
      // Strict pass: the whole run goes; the position still advances as before.
      counters.glyphs += removed + kept;
      replace.set(op, [...before, serializeOp('TJ', [{ type: 'array', value: [{ type: 'number', value: total }] }])]);
      return;
    }
    counters.glyphs += removed;
    replace.set(op, [...before, serializeOp('TJ', [{ type: 'array', value: out }])]);
  };

  for (const op of ops) {
    const a = op.args;
    switch (op.op) {
      case 'q': stack.push({ ...gs }); break;
      case 'Q': gs = stack.pop() ?? gs; break;
      case 'cm': if (a.length === 6) gs.ctm = mul(a.map(num) as Matrix, gs.ctm); break;
      case 'BT': tm = tlm = IDENTITY; break;
      case 'Tf': {
        const name = a[0]?.type === 'name' ? a[0].value : '';
        gs.font = res?.lookupMaybe(PDFName.of('Font'), PDFDict)?.lookupMaybe(PDFName.of(name), PDFDict);
        gs.size = num(a[1]);
        break;
      }
      case 'Tc': gs.tc = num(a[0]); break;
      case 'Tw': gs.tw = num(a[0]); break;
      case 'Tz': gs.tz = num(a[0]); break;
      case 'TL': gs.tl = num(a[0]); break;
      case 'Ts': gs.ts = num(a[0]); break;
      case 'Td': tm = tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); break;
      case 'TD': gs.tl = -num(a[1]); tm = tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); break;
      case 'Tm': if (a.length === 6) tm = tlm = a.map(num) as Matrix; break;
      case 'T*': tm = tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); break;
      case 'Tj': if (a[0]?.type === 'string') showOp(op, [a[0]], []); break;
      case 'TJ': if (a[0]?.type === 'array') showOp(op, a[0].value, []); break;
      case "'":
        tm = tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        if (a[0]?.type === 'string') showOp(op, [a[0]], ['T*']);
        break;
      case '"':
        gs.tw = num(a[0]); gs.tc = num(a[1]);
        tm = tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        if (a[2]?.type === 'string') showOp(op, [a[2]], [`${a[0] && a[0].type === 'number' ? a[0].value : 0} Tw`, `${a[1] && a[1].type === 'number' ? a[1].value : 0} Tc`, 'T*']);
        break;

      // Paths: a shape drawn entirely inside an area is not painted.
      case 'm': case 'l': path.push(apply(gs.ctm, num(a[0]), num(a[1]))); break;
      case 'c': path.push(apply(gs.ctm, num(a[0]), num(a[1])), apply(gs.ctm, num(a[2]), num(a[3])), apply(gs.ctm, num(a[4]), num(a[5]))); break;
      case 'v': case 'y': path.push(apply(gs.ctm, num(a[0]), num(a[1])), apply(gs.ctm, num(a[2]), num(a[3]))); break;
      case 're': {
        const [x, y, w, h] = a.map(num) as [number, number, number, number];
        path.push(apply(gs.ctm, x, y), apply(gs.ctm, x + w, y), apply(gs.ctm, x, y + h), apply(gs.ctm, x + w, y + h));
        break;
      }
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': {
        if (path.length) {
          const b = boxOf(path);
          if (rects.some((r) => contains(r, b))) { replace.set(op, ['n']); counters.shapes++; }
        }
        path = [];
        break;
      }
      case 'n': path = []; break;

      case 'BI': {
        const box = boxOf([apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)]);
        if (rects.some((r) => intersects(r, box))) { replace.set(op, []); counters.imagesRemoved++; }
        break;
      }
      case 'Do': {
        const name = a[0]?.type === 'name' ? a[0].value : '';
        const ref = xobjects()?.get(PDFName.of(name));
        const xo = ref instanceof PDFRef ? doc.context.lookup(ref) : undefined;
        if (!(xo instanceof PDFRawStream) || !(ref instanceof PDFRef)) break;
        const subtype = xo.dict.get(PDFName.of('Subtype'));
        if (subtype === PDFName.of('Image')) {
          const box = boxOf([apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)]);
          const hits = rects.filter((r) => intersects(r, box));
          if (!hits.length) break;
          const inv = invert(gs.ctm);
          const W = xo.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 1;
          const H = xo.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 1;
          if (!inv) break;
          const boxes = hits.map((r) => {
            const pts = [apply(inv, r.x0, r.y0), apply(inv, r.x1, r.y0), apply(inv, r.x0, r.y1), apply(inv, r.x1, r.y1)];
            const u = boxOf(pts);
            return { x0: u.x0 * W, x1: u.x1 * W, y0: (1 - u.y1) * H, y1: (1 - u.y0) * H };
          });
          const p = pending.get(name) ?? { ref, stream: xo, boxes: [] };
          p.boxes.push(...boxes);
          pending.set(name, p);
          (op as Op & { image?: string }).image = name;
        } else if (subtype === PDFName.of('Form') && depth < 8) {
          const inner = decodeStream(xo);
          if (!inner) throw new HilvanaError('REDACTION_UNSUPPORTED', { reason: 'form with an unsupported filter' });
          const fm = (xo.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)?.asArray().map((x) => (doc.context.lookup(x) as PDFNumber).asNumber()) ?? IDENTITY) as Matrix;
          const formRes = xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? res;
          const done = redactStream(scope, inner, formRes, mul(fm, gs.ctm), depth + 1);
          if (!done) break;
          // Copy on write: other pages that draw this form keep the original.
          const d = xo.dict.clone(doc.context);
          for (const k of ['Filter', 'DecodeParms', 'Length']) d.delete(PDFName.of(k));
          if (done.resources) d.set(PDFName.of('Resources'), done.resources);
          const copyRef = doc.context.register(streamWith(doc, done.bytes, d, true));
          ownResources().lookup(PDFName.of('XObject'), PDFDict).set(PDFName.of(name), copyRef);
        }
        break;
      }
      default: break;
    }
  }

  // Images under an area: painted once, with every area that touched them.
  for (const [name, p] of pending) {
    const painted = paintImage(doc, p.stream, p.boxes);
    if (painted) {
      ownResources().lookup(PDFName.of('XObject'), PDFDict).set(PDFName.of(name), doc.context.register(painted));
      counters.imagesPainted++;
    } else {
      for (const op of ops) if ((op as Op & { image?: string }).image === name) replace.set(op, []);
      counters.imagesRemoved++;
    }
  }

  if (!replace.size && !resCloned) return undefined;
  return { bytes: rewriteContent(src, ops, replace), resources: resCloned ? res : undefined };
}

/* ------------------------------------------------------------------ document */

function pageContent(doc: PDFDocument, node: PDFDict): Uint8Array {
  const contents = node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : contents ? [contents] : [];
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (!(s instanceof PDFRawStream)) continue;
    const d = decodeStream(s);
    if (!d) throw new HilvanaError('REDACTION_UNSUPPORTED', { reason: 'page content with an unsupported filter' });
    parts.push(d);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

function parseColor(hex = '#000000'): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toBox = (a: RedactArea): Box => ({
  x0: Math.min(a.x, a.x + a.width), x1: Math.max(a.x, a.x + a.width),
  y0: Math.min(a.y, a.y + a.height), y1: Math.max(a.y, a.y + a.height),
});

export async function redactOnce(bytes: PdfBytes, opts: RedactOptions, strict: Set<number>): Promise<{ bytes: PdfBytes; report: RedactReport }> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  const counters: Counters = { glyphs: 0, imagesPainted: 0, imagesRemoved: 0, shapes: 0 };
  let annotations = 0;
  const byPage = new Map<number, Box[]>();
  for (const a of opts.areas) {
    if (!Number.isInteger(a.page) || a.page < 1 || a.page > pages.length) throw new HilvanaError('PAGE_OUT_OF_RANGE', { page: a.page, pageCount: pages.length });
    if (![a.x, a.y, a.width, a.height].every(Number.isFinite) || a.width === 0 || a.height === 0) throw new HilvanaError('INVALID_ARGUMENT', { area: a });
    byPage.set(a.page, [...(byPage.get(a.page) ?? []), toBox(a)]);
  }
  const fonts = new Map<PDFDict, FontInfo>();
  const [r, g, b] = parseColor(opts.color);
  for (const [n, rects] of byPage) {
    const page = pages[n - 1]!;
    const node = page.node;
    const src = pageContent(doc, node);
    const done = redactStream({ doc, rects, counters, strict: strict.has(n), fonts }, src, node.Resources(), IDENTITY, 0);
    const boxes = rects.map((x) => `${x.x0} ${x.y0} ${x.x1 - x.x0} ${x.y1 - x.y0} re`).join(' ');
    const fill = `\nq ${r} ${g} ${b} rg ${boxes} f Q\n`;
    const body = done ? done.bytes : src;
    const enc = new TextEncoder();
    const head = enc.encode('q\n'), tail = enc.encode(`\nQ${fill}`);
    const content = new Uint8Array(head.length + body.length + tail.length);
    content.set(head); content.set(body, head.length); content.set(tail, head.length + body.length);
    node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
    if (done?.resources) node.set(PDFName.of('Resources'), done.resources);
    node.delete(PDFName.of('Thumb'));
    node.delete(PDFName.of('PieceInfo'));

    // Annotations over an area go, form fields with their values.
    const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
      const keep: PDFObject[] = [];
      for (const ref of annots.asArray()) {
        const an = doc.context.lookup(ref);
        const rect = an instanceof PDFDict ? an.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray().map((x) => (doc.context.lookup(x) as PDFNumber).asNumber()) : undefined;
        if (an instanceof PDFDict && rect && rect.length === 4 && rects.some((x) => intersects(x, { x0: Math.min(rect[0]!, rect[2]!), y0: Math.min(rect[1]!, rect[3]!), x1: Math.max(rect[0]!, rect[2]!), y1: Math.max(rect[1]!, rect[3]!) }))) {
          annotations++;
          const field = an.has(PDFName.of('T')) ? an : an.lookupMaybe(PDFName.of('Parent'), PDFDict);
          field?.delete(PDFName.of('V'));
          an.delete(PDFName.of('AP'));
          continue;
        }
        keep.push(ref);
      }
      if (keep.length !== annots.size()) node.set(PDFName.of('Annots'), doc.context.obj(keep));
    }
  }

  // Tags can repeat the text (alternate text, actual text): they go with it.
  const catalog = doc.catalog;
  const structureRemoved = catalog.has(PDFName.of('StructTreeRoot'));
  catalog.delete(PDFName.of('StructTreeRoot'));
  catalog.delete(PDFName.of('MarkInfo'));
  dropSignatures(doc);
  removeUnreachable(doc);
  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    report: { areas: opts.areas.length, pages: [...byPage.keys()].sort((x, y) => x - y), ...counters, annotations, structureRemoved, strictPass: strict.size > 0 },
  };
}

/**
 * Text that is still readable inside an area, per page (as a reader would extract it).
 * Used to check the result: it must be empty.
 */
export async function textInAreas(bytes: PdfBytes, areas: RedactArea[]): Promise<Map<number, string>> {
  const pdfjs = await openPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false });
  const left = new Map<number, string>();
  try {
    const doc = await task.promise;
    const byPage = new Map<number, Box[]>();
    for (const a of areas) byPage.set(a.page, [...(byPage.get(a.page) ?? []), toBox(a)]);
    for (const [n, rects] of byPage) {
      const content = await (await doc.getPage(n)).getTextContent();
      let found = '';
      for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (!it.str || !it.transform) continue;
        for (const c of charBoxes(it)) {
          if (!c.ch.trim()) continue;
          const cx = (c.box.x0 + c.box.x1) / 2, cy = (c.box.y0 + c.box.y1) / 2;
          if (rects.some((r) => cx > r.x0 + 0.5 && cx < r.x1 - 0.5 && cy > r.y0 + 0.5 && cy < r.y1 - 0.5)) found += c.ch;
        }
      }
      if (found) left.set(n, found);
    }
  } finally {
    await task.destroy();
  }
  return left;
}

/**
 * Removes everything under the areas and covers them. The result is checked by extracting its
 * text again; pages that still show text inside an area get a stricter pass (whole text runs that
 * touch the area are removed). Throws REDACTION_INCOMPLETE rather than return a file that leaks.
 */
export async function redact(bytes: PdfBytes, opts: RedactOptions): Promise<{ bytes: PdfBytes; report: RedactReport }> {
  if (!opts.areas.length) throw new HilvanaError('INVALID_ARGUMENT', { redact: 'no areas' });
  let res = await redactOnce(bytes, opts, new Set());
  let left = await textInAreas(res.bytes, opts.areas);
  if (left.size) {
    res = await redactOnce(bytes, opts, new Set(left.keys()));
    left = await textInAreas(res.bytes, opts.areas);
    if (left.size) throw new HilvanaError('REDACTION_INCOMPLETE', { pages: [...left.keys()].join(', ') });
  }
  return res;
}

/* ------------------------------------------------------------------ search */

export type RedactPattern = 'email' | 'card' | 'number' | 'phone';

export interface TextQuery {
  /** Words or numbers to find. Numbers match with or without spaces, dots or dashes between digits. */
  terms?: string[];
  patterns?: RedactPattern[];
}

export interface TextMatch {
  page: number;
  text: string;
  areas: RedactArea[];
}

const PATTERNS: Record<RedactPattern, RegExp> = {
  email: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
  card: /\b(?:\d[ -]?){12,18}\d\b/g,
  phone: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\b\d{3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g,
  // Six or more digits, possibly grouped: account and ID numbers. Money (decimals, $) is left alone.
  number: /(?<![\d$])(?<!\$\s)\b\d(?:[\d.\- ]?\d){5,}\b(?![.,]\d{2}\b)/g,
};

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termRegex(term: string): RegExp | undefined {
  const t = fold(term.trim());
  if (!t) return undefined;
  if (/^[\d\s.\-]+$/.test(t)) {
    const digits = t.replace(/\D/g, '');
    if (!digits) return undefined;
    return new RegExp(`(?<!\\d)${digits.split('').join('[\\s.\\-]?')}(?!\\d)`, 'g');
  }
  return new RegExp(t.split(/\s+/).map(escape).join('\\s+'), 'gu');
}

// Helvetica widths, to spread a text run's width over its characters more faithfully than evenly.
let helvetica: Font | undefined;
function relativeWidth(ch: string): number {
  helvetica ??= Font.load('Helvetica' as FontNames);
  const cp = ch.codePointAt(0)!;
  const enc = Encodings.WinAnsi;
  if (enc.canEncodeUnicodeCodePoint(cp)) {
    const w = helvetica.getWidthOfGlyph(enc.encodeUnicodeCodePoint(cp).name);
    if (typeof w === 'number' && w > 0) return w;
  }
  return 556;
}

function charBoxes(it: { str?: string; transform?: number[]; width?: number; height?: number }): { ch: string; box: Box }[] {
  const str = it.str ?? '';
  const [a, b, c, d, e, f] = it.transform as Matrix;
  const chars = [...str];
  const total = chars.reduce((s, ch) => s + relativeWidth(ch), 0) || 1;
  const width = it.width ?? 0;
  const size = Math.hypot(c, d) || it.height || 10;
  const dir = Math.hypot(a, b) ? [a / Math.hypot(a, b), b / Math.hypot(a, b)] : [1, 0];
  const up = [-dir[1]!, dir[0]!];
  let along = 0;
  return chars.map((ch) => {
    const w = (relativeWidth(ch) / total) * width;
    const p = (s: number, t: number): [number, number] => [e + dir[0]! * s + up[0]! * t, f + dir[1]! * s + up[1]! * t];
    const box = boxOf([p(along, -0.22 * size), p(along + w, -0.22 * size), p(along, 0.9 * size), p(along + w, 0.9 * size)]);
    along += w;
    return { ch, box };
  });
}

/** pdf.js 6 uses Promise.withResolvers, which Node.js only has from version 22. */
export function ensurePromiseWithResolvers() {
  const P = Promise as unknown as { withResolvers?: unknown };
  if (typeof P.withResolvers === 'function') return;
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

export async function openPdfJs() {
  ensurePromiseWithResolvers();
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/**
 * Finds words, numbers and common personal data in a PDF's text and returns the areas that cover
 * them, ready for redact(). Scanned pages without a text layer have nothing to find.
 */
export async function findText(bytes: PdfBytes, query: TextQuery): Promise<TextMatch[]> {
  const regexes: { re: RegExp; check?: (s: string) => boolean }[] = [];
  for (const t of query.terms ?? []) { const re = termRegex(t); if (re) regexes.push({ re }); }
  for (const p of query.patterns ?? []) regexes.push({ re: new RegExp(PATTERNS[p].source, PATTERNS[p].flags), check: p === 'card' ? (s) => luhn(s.replace(/\D/g, '')) : undefined });
  if (!regexes.length) return [];

  const pdfjs = await openPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false });
  const matches: TextMatch[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      // The page's text as one string, with each character's box (undefined for added separators).
      let text = '';
      const boxes: (Box | undefined)[] = [];
      const items = (content.items as { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }[]).filter((it) => it.transform);
      items.forEach((it, i) => {
        for (const c of charBoxes(it)) {
          const folded = fold(c.ch);
          for (const ch of folded.length ? folded : ' ') { text += ch; boxes.push(c.box); }
        }
        const next = items[i + 1];
        if (it.hasEOL || !next) { text += '\n'; boxes.push(undefined); }
        else {
          const sameLine = Math.abs((next.transform![5] ?? 0) - (it.transform![5] ?? 0)) < (it.height || 10) * 0.5;
          const gap = (next.transform![4] ?? 0) - ((it.transform![4] ?? 0) + (it.width ?? 0));
          if (!sameLine) { text += '\n'; boxes.push(undefined); }
          else if (gap > (it.height || 10) * 0.15) { text += ' '; boxes.push(undefined); }
        }
      });
      for (const { re, check } of regexes) {
        for (const m of text.matchAll(re)) {
          if (check && !check(m[0])) continue;
          const span = boxes.slice(m.index!, m.index! + m[0].length);
          // One area per line of the match.
          const lines: Box[] = [];
          for (const bx of span) {
            if (!bx) continue;
            const line = lines.find((l) => Math.abs((l.y0 + l.y1) / 2 - (bx.y0 + bx.y1) / 2) < (bx.y1 - bx.y0) * 0.5);
            if (line) { line.x0 = Math.min(line.x0, bx.x0); line.x1 = Math.max(line.x1, bx.x1); line.y0 = Math.min(line.y0, bx.y0); line.y1 = Math.max(line.y1, bx.y1); }
            else lines.push({ ...bx });
          }
          if (!lines.length) continue;
          matches.push({
            page: n,
            text: m[0],
            areas: lines.map((l) => ({ page: n, x: l.x0 - 0.5, y: l.y0, width: l.x1 - l.x0 + 1, height: l.y1 - l.y0 })),
          });
        }
      }
    }
  } finally {
    await task.destroy();
  }
  return matches;
}
