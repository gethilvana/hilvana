import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream,
  type PDFObject,
} from 'pdf-lib';
import { unzlibSync, zlibSync } from 'fflate';
import jpeg from 'jpeg-js';
import { dropSignatures, load, type PdfBytes } from './operations.js';

export type CompressionLevel = 'lossless' | 'balanced' | 'strong' | 'max';

/** Target resolution and JPEG quality per level. Lossless never touches image pixels. */
const LEVELS: Record<Exclude<CompressionLevel, 'lossless'>, { dpi: number; quality: number }> = {
  balanced: { dpi: 150, quality: 75 },
  strong: { dpi: 110, quality: 60 },
  max: { dpi: 72, quality: 45 },
};

/** Finer settings used when aiming for a target size, from gentlest to strongest. */
const LADDER = [
  { dpi: 150, quality: 75 }, { dpi: 135, quality: 70 }, { dpi: 120, quality: 65 }, { dpi: 110, quality: 60 },
  { dpi: 100, quality: 55 }, { dpi: 90, quality: 52 }, { dpi: 80, quality: 48 }, { dpi: 72, quality: 45 },
];

const levelOf = (s: { dpi: number }): CompressionLevel => (s.dpi >= 140 ? 'balanced' : s.dpi >= 100 ? 'strong' : 'max');

export interface CompressionReport {
  /** Level that produced the returned bytes; "none" when nothing made the file smaller. */
  level: CompressionLevel | 'none';
  /** Image resolution and JPEG quality used (absent for lossless). */
  settings?: { dpi: number; quality: number };
  before: number;
  after: number;
  images: { found: number; recompressed: number; downsampled: number; skipped: number };
  /** Only when a target was given. */
  targetMet?: boolean;
}

export interface CompressOptions {
  level?: CompressionLevel;
  /** Try increasingly strong levels until the file is at most this many bytes. */
  targetBytes?: number;
}

/**
 * Makes a PDF smaller. Text and vectors are never rasterized: only image pixels change
 * (downsampled to the level's resolution at their displayed size, and re-encoded), plus lossless
 * clean-up: compressing uncompressed streams, dropping unreachable objects and object streams.
 * Returns the original bytes if no level makes the file smaller.
 */
export async function compress(bytes: PdfBytes, opts: CompressOptions = {}): Promise<{ bytes: PdfBytes; report: CompressionReport }> {
  const before = bytes.byteLength;
  let result: { bytes: PdfBytes; report: CompressionReport };
  if (opts.targetBytes === undefined) {
    const level = opts.level ?? 'balanced';
    result = await compressAt(bytes, level === 'lossless' ? null : LEVELS[level]);
  } else {
    // Gentlest setting that meets the target: lossless first, then a binary search on the ladder
    // (file size shrinks monotonically along it). If nothing meets it, the strongest result.
    const target = opts.targetBytes;
    result = await compressAt(bytes, null);
    if (result.bytes.byteLength > target) {
      let lo = 0, hi = LADDER.length - 1;
      const strongest = await compressAt(bytes, LADDER[hi]!);
      result = strongest;
      if (strongest.bytes.byteLength <= target) {
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const attempt = await compressAt(bytes, LADDER[mid]!);
          if (attempt.bytes.byteLength <= target) { result = attempt; hi = mid; } else lo = mid + 1;
        }
        if (result.report.settings !== LADDER[lo]) result = await compressAt(bytes, LADDER[lo]!);
      }
    }
  }
  if (result.bytes.byteLength >= before) {
    result = { bytes, report: { ...result.report, level: 'none', after: before } };
  }
  if (opts.targetBytes !== undefined) result.report.targetMet = result.bytes.byteLength <= opts.targetBytes;
  return result;
}

async function compressAt(input: PdfBytes, settings: { dpi: number; quality: number } | null): Promise<{ bytes: PdfBytes; report: CompressionReport }> {
  const doc = await load(input);
  const images = { found: 0, recompressed: 0, downsampled: 0, skipped: 0 };
  if (settings) {
    const usage = measureImageUsage(doc);
    const fallback = Math.max(...doc.getPages().map((p) => Math.max(p.getWidth(), p.getHeight())), 612);
    const smasks = new Set<string>();
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        const sm = obj.dict.get(PDFName.of('SMask'));
        if (sm instanceof PDFRef) smasks.add(sm.toString());
      }
    }
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      if (smasks.has(ref.toString())) continue; // handled with its parent image
      images.found++;
      const outcome = recompressImage(doc, ref, obj, settings, usage.get(ref.toString()) ?? { w: fallback, h: fallback });
      if (outcome === 'skipped') images.skipped++;
      else {
        images.recompressed++;
        if (outcome === 'downsampled') images.downsampled++;
      }
    }
  }
  deflateUncompressedStreams(doc);
  dropSignatures(doc);
  removeUnreachable(doc);
  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    report: { level: settings ? levelOf(settings) : 'lossless', settings: settings ?? undefined, before: input.byteLength, after: out.byteLength, images },
  };
}

/* ------------------------------------------------------------------ stream helpers */

function filters(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of('Filter'));
  if (f instanceof PDFName) return [f.asString()];
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.asString() : '?'));
  return [];
}

/** Decoded bytes of a stream, or undefined when its filter is not supported here. */
export function decodeStream(s: PDFRawStream): Uint8Array | undefined {
  const f = filters(s.dict);
  if (f.length === 0) return s.contents;
  if (f.length === 1 && f[0] === '/FlateDecode') {
    try {
      const raw = unzlibSync(s.contents);
      const parms = s.dict.lookupMaybe(PDFName.of('DecodeParms'), PDFDict);
      const predictor = parms?.lookupMaybe(PDFName.of('Predictor'), PDFNumber)?.asNumber() ?? 1;
      if (predictor >= 10) {
        const colors = parms?.lookupMaybe(PDFName.of('Colors'), PDFNumber)?.asNumber() ?? 1;
        const bpc = parms?.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber() ?? 8;
        const columns = parms?.lookupMaybe(PDFName.of('Columns'), PDFNumber)?.asNumber() ?? 1;
        return unpredictPng(raw, Math.ceil((colors * bpc * columns) / 8), Math.max(1, Math.ceil((colors * bpc) / 8)));
      }
      if (predictor !== 1) return undefined;
      return raw;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Reverses PNG row filters (PDF predictors 10–15). */
function unpredictPng(data: Uint8Array, rowBytes: number, bpp: number): Uint8Array {
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowBytes + 1)]!;
    const src = r * (rowBytes + 1) + 1;
    const dst = r * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = data[src + i]!;
      const a = i >= bpp ? out[dst + i - bpp]! : 0;
      const b = r > 0 ? out[dst - rowBytes + i]! : 0;
      const c = r > 0 && i >= bpp ? out[dst - rowBytes + i - bpp]! : 0;
      let v: number;
      switch (type) {
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = x;
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ how big each image is drawn */

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

/**
 * Walks page content streams (and form XObjects) tracking the transformation matrix,
 * to know the largest size, in points, at which each image is displayed.
 */
function measureImageUsage(doc: PDFDocument): Map<string, { w: number; h: number }> {
  const usage = new Map<string, { w: number; h: number }>();
  const record = (ref: PDFRef, m: Matrix) => {
    const w = Math.hypot(m[0], m[1]);
    const h = Math.hypot(m[2], m[3]);
    const prev = usage.get(ref.toString());
    usage.set(ref.toString(), { w: Math.max(prev?.w ?? 0, w), h: Math.max(prev?.h ?? 0, h) });
  };

  const walk = (content: Uint8Array, resources: PDFDict | undefined, start: Matrix, depth: number) => {
    if (depth > 6) return;
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    const stack: Matrix[] = [];
    let ctm = start;
    const operands: string[] = [];
    for (const tok of tokenize(content)) {
      if (tok.kind === 'operand') { operands.push(tok.value); continue; }
      switch (tok.value) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() ?? start; break;
        case 'cm': {
          const n = operands.slice(-6).map(Number);
          if (n.length === 6 && n.every(Number.isFinite)) ctm = multiply(n as Matrix, ctm);
          break;
        }
        case 'Do': {
          const name = operands[operands.length - 1];
          const ref = name && xobjects?.get(PDFName.of(name.slice(1)));
          if (ref instanceof PDFRef) {
            const xo = doc.context.lookup(ref);
            if (xo instanceof PDFRawStream) {
              const subtype = xo.dict.get(PDFName.of('Subtype'));
              if (subtype === PDFName.of('Image')) record(ref, ctm);
              else if (subtype === PDFName.of('Form')) {
                const inner = decodeStream(xo);
                const mArr = xo.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
                const fm = (mArr?.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) ?? [1, 0, 0, 1, 0, 0]) as Matrix;
                const res = xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources;
                if (inner) walk(inner, res, multiply(fm, ctm), depth + 1);
              }
            }
          }
          break;
        }
        default: break;
      }
      operands.length = 0;
    }
  };

  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    const parts: Uint8Array[] = [];
    for (const s of streams) {
      if (s instanceof PDFRawStream) { const d = decodeStream(s); if (d) parts.push(d); }
    }
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
    let o = 0;
    for (const p of parts) { joined.set(p, o); o += p.length; joined[o++] = 10; }
    walk(joined, page.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
  }
  return usage;
}

/** Minimal content-stream tokenizer: enough to follow q/Q/cm/Do, skipping strings and inline images. */
function* tokenize(buf: Uint8Array): Generator<{ kind: 'operand' | 'op'; value: string }> {
  const n = buf.length;
  let i = 0;
  const isWs = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  while (i < n) {
    const c = buf[i]!;
    if (isWs(c)) { i++; continue; }
    if (c === 37) { while (i < n && buf[i] !== 10 && buf[i] !== 13) i++; continue; } // comment
    if (c === 40) { // (string) with nesting and escapes
      let depth = 1; i++;
      while (i < n && depth > 0) { const d = buf[i]!; if (d === 92) i++; else if (d === 40) depth++; else if (d === 41) depth--; i++; }
      yield { kind: 'operand', value: '()' };
      continue;
    }
    if (c === 60 && buf[i + 1] !== 60) { while (i < n && buf[i] !== 62) i++; i++; yield { kind: 'operand', value: '<>' }; continue; }
    if ((c === 60 && buf[i + 1] === 60) || (c === 62 && buf[i + 1] === 62)) { i += 2; continue; }
    if (c === 91 || c === 93 || c === 123 || c === 125) { i++; continue; }
    let j = i + 1;
    while (j < n && !isWs(buf[j]!) && !isDelim(buf[j]!)) j++;
    let word = '';
    for (let k = i; k < j; k++) word += String.fromCharCode(buf[k]!);
    i = j;
    if (c === 47) { yield { kind: 'operand', value: word }; continue; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { yield { kind: 'operand', value: word }; continue; }
    if (word === 'ID') {
      // Inline image data runs until whitespace + "EI" + whitespace.
      i++;
      while (i < n - 2 && !(isWs(buf[i - 1]!) && buf[i] === 69 && buf[i + 1] === 73 && (i + 2 >= n || isWs(buf[i + 2]!)))) i++;
      i += 2;
      yield { kind: 'op', value: 'EI' };
      continue;
    }
    yield { kind: 'op', value: word };
  }
}

/* ------------------------------------------------------------------ images */

export function components(doc: PDFDocument, cs: PDFObject | undefined): number | undefined {
  const v = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (v === PDFName.of('DeviceRGB') || v === PDFName.of('CalRGB')) return 3;
  if (v === PDFName.of('DeviceGray') || v === PDFName.of('CalGray')) return 1;
  if (v instanceof PDFArray && v.get(0) === PDFName.of('ICCBased')) {
    const icc = doc.context.lookup(v.get(1));
    const n = icc instanceof PDFRawStream ? icc.dict.lookupMaybe(PDFName.of('N'), PDFNumber)?.asNumber() : undefined;
    return n === 1 || n === 3 ? n : undefined;
  }
  return undefined; // CMYK, Indexed, Separation, DeviceN, Lab: left untouched
}

/** Area-averaging downscale; channels = samples per pixel. */
function downsample(src: Uint8Array, w: number, h: number, channels: number, nw: number, nh: number): Uint8Array {
  const out = new Uint8Array(nw * nh * channels);
  const sx = w / nw;
  const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * sy)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * sx)));
      const count = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) {
          let idx = (yy * w + x0) * channels + c;
          for (let xx = x0; xx < x1; xx++, idx += channels) sum += src[idx]!;
        }
        out[(y * nw + x) * channels + c] = Math.round(sum / count);
      }
    }
  }
  return out;
}

/** Photos have many distinct colors; screenshots, charts and line art have few and compress better losslessly. */
function looksLikePhoto(px: Uint8Array, channels: number): boolean {
  const total = px.length / channels;
  const step = Math.max(1, Math.floor(total / 4096));
  const seen = new Set<number>();
  for (let i = 0; i < total; i += step) {
    const o = i * channels;
    seen.add(channels === 1 ? px[o]! : (px[o]! << 16) | (px[o + 1]! << 8) | px[o + 2]!);
    if (seen.size > 600) return true;
  }
  return false;
}

function toRgba(px: Uint8Array, channels: number): Uint8Array {
  const n = px.length / channels;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (channels === 1) { const g = px[i]!; out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; }
    else { out[i * 4] = px[i * 3]!; out[i * 4 + 1] = px[i * 3 + 1]!; out[i * 4 + 2] = px[i * 3 + 2]!; }
    out[i * 4 + 3] = 255;
  }
  return out;
}

function fromRgba(rgba: Uint8Array, channels: number): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * channels);
  for (let i = 0; i < n; i++) {
    if (channels === 1) out[i] = rgba[i * 4]!;
    else { out[i * 3] = rgba[i * 4]!; out[i * 3 + 1] = rgba[i * 4 + 1]!; out[i * 3 + 2] = rgba[i * 4 + 2]!; }
  }
  return out;
}

function recompressImage(
  doc: PDFDocument,
  ref: PDFRef,
  img: PDFRawStream,
  target: { dpi: number; quality: number },
  displayed: { w: number; h: number },
): 'skipped' | 'recompressed' | 'downsampled' {
  const d = img.dict;
  const W = d.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
  const H = d.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
  const bpc = d.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber();
  const f = filters(d);
  if (W * H < 64 * 64 || img.contents.length < 16 * 1024) return 'skipped';
  if (d.get(PDFName.of('ImageMask')) || d.get(PDFName.of('Decode')) || d.get(PDFName.of('Mask'))) return 'skipped';
  const ch = components(doc, d.get(PDFName.of('ColorSpace')));
  if (!ch || bpc !== 8) return 'skipped';
  const isJpeg = f.length === 1 && f[0] === '/DCTDecode';
  if (!isJpeg && !(f.length === 0 || (f.length === 1 && f[0] === '/FlateDecode'))) return 'skipped';

  // Decode to raw samples.
  let px: Uint8Array | undefined;
  if (isJpeg) {
    try {
      const decoded = jpeg.decode(img.contents, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
      if (decoded.width !== W || decoded.height !== H) return 'skipped';
      px = fromRgba(decoded.data, ch);
    } catch {
      return 'skipped';
    }
  } else {
    px = decodeStream(img);
    if (!px || px.length < W * H * ch) return 'skipped';
  }

  // Target size from the largest size the image is drawn at.
  const needW = Math.ceil((displayed.w / 72) * target.dpi);
  const needH = Math.ceil((displayed.h / 72) * target.dpi);
  const scale = Math.min(1, needW / W, needH / H);
  let nw = W, nh = H;
  if (scale < 0.9) { nw = Math.max(1, Math.round(W * scale)); nh = Math.max(1, Math.round(H * scale)); }

  // A soft mask (transparency) must follow the image size.
  const smaskRef = d.get(PDFName.of('SMask'));
  let newMask: PDFRawStream | undefined;
  if (smaskRef instanceof PDFRef && (nw !== W || nh !== H)) {
    const sm = doc.context.lookup(smaskRef);
    const mw = sm instanceof PDFRawStream ? sm.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() : undefined;
    const mh = sm instanceof PDFRawStream ? sm.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() : undefined;
    const mbpc = sm instanceof PDFRawStream ? sm.dict.lookupMaybe(PDFName.of('BitsPerComponent'), PDFNumber)?.asNumber() : undefined;
    const mpx = sm instanceof PDFRawStream && mbpc === 8 && mw === W && mh === H ? decodeStream(sm) : undefined;
    if (!mpx || mpx.length < W * H) { nw = W; nh = H; }
    else {
      newMask = doc.context.flateStream(downsample(mpx, W, H, 1, nw, nh), {
        Type: 'XObject', Subtype: 'Image', Width: nw, Height: nh, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
      }) as unknown as PDFRawStream;
    }
  }

  const resized = nw !== W || nh !== H ? downsample(px.subarray(0, W * H * ch), W, H, ch, nw, nh) : px.subarray(0, W * H * ch);
  const sameSize = nw === W && nh === H;
  // JPEG sources stay JPEG. Otherwise compare: lossless keeps text and edges crisp (screenshots,
  // charts, logos), so it wins unless JPEG is much smaller, which happens with real photos.
  const jpegData = isJpeg || looksLikePhoto(resized, ch)
    ? encodeJpeg(toRgba(resized, ch), nw, nh, target.quality)
    : undefined;
  const flateData = !isJpeg && !(sameSize && jpegData === undefined) ? zlibSync(resized, { level: 9 }) : undefined;
  if (!jpegData && !flateData) return 'skipped';
  const useJpeg = !!jpegData && (!flateData || flateData.length > jpegData.length * 1.5);

  let encoded: Uint8Array;
  let filter: string;
  let colorSpace: PDFObject = d.get(PDFName.of('ColorSpace'))!;
  if (useJpeg) {
    encoded = jpegData!;
    filter = 'DCTDecode';
    if (ch === 1) colorSpace = PDFName.of('DeviceRGB'); // the encoder writes 3-channel JPEGs
  } else {
    encoded = flateData!;
    filter = 'FlateDecode';
  }
  if (encoded.length >= img.contents.length * 0.95) return 'skipped';

  const dict: Record<string, unknown> = { Type: 'XObject', Subtype: 'Image', Width: nw, Height: nh, BitsPerComponent: 8, Filter: filter };
  const stream = doc.context.stream(encoded, dict as never);
  stream.dict.set(PDFName.of('ColorSpace'), colorSpace);
  if (smaskRef instanceof PDFRef) {
    stream.dict.set(PDFName.of('SMask'), smaskRef);
    if (newMask) doc.context.assign(smaskRef, newMask);
  }
  const interp = d.get(PDFName.of('Interpolate'));
  if (interp) stream.dict.set(PDFName.of('Interpolate'), interp);
  doc.context.assign(ref, stream);
  return nw !== W || nh !== H ? 'downsampled' : 'recompressed';
}

/* ------------------------------------------------------------------ lossless clean-up */

function deflateUncompressedStreams(doc: PDFDocument) {
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (filters(obj.dict).length > 0 || obj.contents.length < 256) continue;
    if (obj.dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) continue; // XMP stays readable
    const packed = zlibSync(obj.contents, { level: 9 });
    if (packed.length >= obj.contents.length * 0.9) continue;
    const s = doc.context.stream(packed, {});
    for (const [k, v] of obj.dict.entries()) if (k !== PDFName.of('Length')) s.dict.set(k, v);
    s.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    doc.context.assign(ref, s);
  }
}

/** Deletes objects no longer reachable from the document catalog or info dictionary (e.g. replaced images). */
export function removeUnreachable(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<string>();
  const queue: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean) as PDFObject[];
  while (queue.length) {
    const o = queue.pop()!;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const v = ctx.lookup(o);
      if (v) queue.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) queue.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) queue.push(v);
    } else if (o instanceof PDFStream) {
      queue.push(o.dict);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) ctx.delete(ref);
  }
}

/**
 * jpeg-js returns a Node Buffer whenever a CommonJS `module` exists, which bundlers define in browsers
 * too, where Buffer does not exist (D22). Lend it the one method it calls, only for this synchronous call.
 */
export function encodeJpeg(rgba: Uint8Array, width: number, height: number, quality: number): Uint8Array {
  const g = globalThis as { Buffer?: unknown };
  const lend = typeof g.Buffer === 'undefined';
  if (lend) g.Buffer = { from: (bytes: ArrayLike<number>) => Uint8Array.from(bytes) };
  try {
    return new Uint8Array(jpeg.encode({ data: rgba, width, height }, quality).data);
  } finally {
    if (lend) delete g.Buffer;
  }
}
