/**
 * Amazon KDP print interiors: what KDP checks on a manuscript PDF (trim size and bleed, page count,
 * margins and gutter, embedded fonts, image resolution, transparency, and non-printing content), and
 * the corrections that can be made safely. Specifications from KDP's help pages ("Set Trim Size,
 * Bleed, and Margins", "Paperback Submission Guidelines"), checked on 2026-11-26.
 *
 * Geometry is read with pdf.js; nothing leaves the device and no page text is returned.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream } from 'pdf-lib';
import { HilvanaError } from './errors.js';
import { inspect, load, stripMetadata } from './operations.js';
import { openPdfJs } from './redact.js';

export type KdpBinding = 'paperback' | 'hardcover';
export type KdpInk = 'black-white' | 'black-cream' | 'black-groundwood' | 'standard-color' | 'premium-color';

export interface KdpSpec {
  binding: KdpBinding;
  /** Trim size in inches: "8.5x11", or a custom { width, height } (paperback only). */
  trim: string | { width: number; height: number };
  /** True when anything is printed to the page edge. The whole file then carries bleed. */
  bleed?: boolean;
  /** Ink and paper. Defaults to black ink on white paper. */
  ink?: KdpInk;
}

export type KdpCode =
  | 'KDP_TRIM_UNSUPPORTED'
  | 'KDP_INK_UNSUPPORTED'
  | 'KDP_PAGE_SIZE'
  | 'KDP_PAGE_ROTATED'
  | 'KDP_PAGE_COUNT_LOW'
  | 'KDP_PAGE_COUNT_HIGH'
  | 'KDP_PAGE_COUNT_ODD'
  | 'KDP_MARGINS'
  | 'KDP_FONTS_NOT_EMBEDDED'
  | 'KDP_LOW_RESOLUTION'
  | 'KDP_TRANSPARENCY'
  | 'KDP_ENCRYPTED'
  | 'KDP_ANNOTATIONS'
  | 'KDP_BOOKMARKS'
  | 'KDP_METADATA';

export interface KdpIssue {
  code: KdpCode;
  /** error: KDP rejects the file or prints it wrong. warning: KDP accepts it, with a caveat. */
  severity: 'error' | 'warning';
  /** Pages affected (1-based), when the issue is per page. */
  pages?: number[];
  details?: Record<string, string | number>;
}

export interface KdpReport {
  ok: boolean;
  issues: KdpIssue[];
  pageCount: number;
  /** The page size KDP expects, in inches (trim plus bleed when set). */
  pageSize: { width: number; height: number };
  /** Required margins for this page count, in inches. */
  margins: { inside: number; outside: number; top: number; bottom: number };
  pageRange: { min: number; max: number };
}

export interface KdpPrepareOptions {
  /** Scale content that crosses the margins into the safe area (books without bleed). Default true. */
  fitMargins?: boolean;
  /** Add blank pages at the end up to KDP's minimum page count. Default false. */
  padToMinimum?: boolean;
}

export interface KdpPrepareReport {
  /** Pages scaled to the trim size. */
  resized: number[];
  /** Pages whose content was scaled into the margins, with the factor used. */
  fitted: { page: number; scale: number }[];
  /** Blank pages added at the end. */
  added: number;
  annotationsRemoved: number;
  bookmarksRemoved: boolean;
  metadataRemoved: boolean;
}

const PAPERBACK_TRIMS = ['5x8', '5.06x7.81', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '6.69x9.61', '7x10', '7.44x9.69', '7.5x9.25', '8x10', '8.25x6', '8.25x8.25', '8.25x11', '8.5x8.5', '8.5x11', '8.27x11.69'];
const HARDCOVER_TRIMS = ['5.5x8.5', '6x9', '6.14x9.21', '7x10', '8.25x11'];
/** Margin tiers: up to this page count, this gutter (inches). */
const GUTTER: [number, number][] = [[150, 0.375], [300, 0.5], [500, 0.625], [700, 0.75], [Infinity, 0.875]];
const BLEED_W = 0.125;
const BLEED_H = 0.25;
/** Page sizes may be rounded by the exporting program (Word writes 0.13" for 0.125"): 1.5 pt of slack. */
const SIZE_TOLERANCE = 1.5;
const MIN_DPI = 300;

function trimOf(spec: KdpSpec): { width: number; height: number; label: string; custom: boolean } {
  if (typeof spec.trim !== 'string') return { ...spec.trim, label: `${spec.trim.width}x${spec.trim.height}`, custom: true };
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*$/i.exec(spec.trim);
  if (!m) throw new HilvanaError('KDP_TRIM_UNSUPPORTED', { trim: spec.trim });
  const width = Number(m[1]);
  const height = Number(m[2]);
  const label = `${width}x${height}`;
  const list = spec.binding === 'hardcover' ? HARDCOVER_TRIMS : PAPERBACK_TRIMS;
  return { width, height, label, custom: !list.includes(label) };
}

/** Minimum and maximum page counts for a binding, trim and ink (KDP's trim size table). */
export function kdpPageRange(spec: KdpSpec): { min: number; max: number } | undefined {
  const t = trimOf(spec);
  const ink = spec.ink ?? 'black-white';
  if (spec.binding === 'hardcover') {
    if (t.custom || ink === 'black-groundwood' || ink === 'standard-color') return undefined;
    return { min: 75, max: 550 };
  }
  // Custom paperback trims follow KDP's limits for its size range (4"–8.5" wide, 6"–11.69" tall).
  if (t.custom && (t.width < 4 || t.width > 8.5 || t.height < 6 || t.height > 11.69)) return undefined;
  const a4 = t.label === '8.27x11.69';
  const w85 = t.width === 8.5;
  const w825 = t.width === 8.25;
  const pick = (base: number, wide825: number, wide85: number, aFour: number) => (a4 ? aFour : w85 ? wide85 : w825 ? wide825 : base);
  switch (ink) {
    case 'black-white': return { min: 24, max: pick(828, 800, 590, 780) };
    case 'black-cream': return { min: 24, max: pick(776, 750, 550, 730) };
    case 'black-groundwood': return { min: 24, max: pick(812, 784, 578, 764) };
    case 'standard-color': return a4 ? undefined : { min: 72, max: 600 };
    case 'premium-color': return { min: 24, max: pick(828, 800, 590, 590) };
  }
}

/** The margins KDP requires for a page count, in inches. Outside, top and bottom are measured from the page edge. */
export function kdpMargins(pageCount: number, bleed: boolean) {
  const inside = GUTTER.find(([upTo]) => pageCount <= upTo)![1];
  const edge = bleed ? 0.375 : 0.25;
  return { inside, outside: edge, top: edge, bottom: edge };
}

type Box = [number, number, number, number]; // x0, y0, x1, y1
type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function boxThrough(m: Matrix, b: Box): Box {
  const pts = [apply(m, b[0], b[1]), apply(m, b[2], b[1]), apply(m, b[0], b[3]), apply(m, b[2], b[3])];
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

interface PageGeometry {
  /** Page size as shown, in points, and its MediaBox origin. */
  width: number;
  height: number;
  rotation: number;
  /** Boxes of what is drawn, in page space (origin at the MediaBox's lower-left corner). */
  text: Box[];
  art: Box[];
  /** Images: placed box and resolution in dots per inch (the lower of the two axes). */
  images: { box: Box; dpi: number }[];
}

/**
 * What each page draws, as boxes: text, vector art and images (with their resolution at the size they
 * are printed). Clipping is not applied, so content hidden by a clip still counts.
 */
/**
 * A box that covers most of the page: as a plain fill, it is a background (often white), not content
 * near the edge. 90 % rather than 100 %, so a background scaled into the margins by kdpPrepare still counts as one.
 */
const covers = (b: Box, w: number, h: number) => b[2] - b[0] >= w * 0.9 && b[3] - b[1] >= h * 0.9;

async function pageGeometry(bytes: Uint8Array): Promise<PageGeometry[]> {
  const pdfjs = await openPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const OPS = pdfjs.OPS as Record<string, number>;
  const out: PageGeometry[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [vx0, vy0, vx1, vy1] = page.view as number[];
      const origin: Matrix = [1, 0, 0, 1, -vx0!, -vy0!];
      const g: PageGeometry = { width: vx1! - vx0!, height: vy1! - vy0!, rotation: page.rotate, text: [], art: [], images: [] };
      const ol = await page.getOperatorList();
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      const imageAt = (pxW: number, pxH: number) => {
        const m = mul(ctm, origin);
        const box = boxThrough(m, [0, 0, 1, 1]);
        const wIn = Math.hypot(ctm[0], ctm[1]) / 72;
        const hIn = Math.hypot(ctm[2], ctm[3]) / 72;
        if (wIn > 0 && hIn > 0) g.images.push({ box, dpi: Math.min(pxW / wIn, pxH / hIn) });
        else g.art.push(box);
      };
      for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i];
        const args = ol.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = mul(args as unknown as Matrix, ctm);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm);
          const matrix = args[0] as Matrix | null;
          if (matrix) ctm = mul(Array.from(matrix) as Matrix, ctm);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.constructPath) {
          const paint = Number(args[0]);
          const mm = args[2] as ArrayLike<number> | null;
          // A path that only clips draws nothing; a filled (not stroked) path that covers the page is a background.
          if (paint === OPS.endPath || !mm || !Number.isFinite(mm[0]) || mm[0]! > mm[2]!) continue;
          const box = boxThrough(mul(ctm, origin), [mm[0]!, mm[1]!, mm[2]!, mm[3]!]);
          if ((paint === OPS.fill || paint === OPS.eoFill) && covers(box, g.width, g.height)) continue;
          g.art.push(box);
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
          imageAt(Number(args[1]) || 0, Number(args[2]) || 0);
        } else if (fn === OPS.paintInlineImageXObject) {
          const img = args[0] as { width?: number; height?: number } | undefined;
          imageAt(img?.width ?? 0, img?.height ?? 0);
        } else if (fn === OPS.paintImageMaskXObject || fn === OPS.paintSolidColorImageMask) {
          g.art.push(boxThrough(mul(ctm, origin), [0, 0, 1, 1]));
        }
      }
      const text = await page.getTextContent();
      for (const it of text.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const [a, b, , , e, f] = it.transform as number[];
        const angle = Math.atan2(b!, a!);
        const w = it.width;
        const h = it.height || Math.hypot(a!, b!);
        // Baseline from (e, f) along the text direction; boxes allow for descenders.
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const corners = [[0, -0.25 * h], [w, -0.25 * h], [0, h], [w, h]].map(([u, v]) => [e! + u! * cos - v! * sin - vx0!, f! + u! * sin + v! * cos - vy0!]);
        g.text.push([Math.min(...corners.map((c) => c[0]!)), Math.min(...corners.map((c) => c[1]!)), Math.max(...corners.map((c) => c[0]!)), Math.max(...corners.map((c) => c[1]!))]);
      }
      page.cleanup();
      out.push(g);
    }
  } finally {
    await task.destroy();
  }
  return out;
}


/** The area content must stay inside, in points, for a page (page 1 is a right-hand page: gutter on the left). */
function safeBox(pageNumber: number, width: number, height: number, m: KdpReport['margins']): Box {
  const recto = pageNumber % 2 === 1;
  const left = (recto ? m.inside : m.outside) * 72;
  const right = (recto ? m.outside : m.inside) * 72;
  return [left, m.bottom * 72, width - right, height - m.top * 72];
}

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
}

/** The content box a page must keep inside its margins: text always; art and images only without bleed. */
function contentBox(g: PageGeometry, bleed: boolean): Box | undefined {
  const boxes = bleed ? g.text : [...g.text, ...g.art, ...g.images.map((i) => i.box)];
  return union(boxes.filter((b) => b[2] > b[0] && b[3] > b[1]));
}

const outside = (b: Box, s: Box) => b[0] < s[0] - 0.5 || b[1] < s[1] - 0.5 || b[2] > s[2] + 0.5 || b[3] > s[3] + 0.5;

/** Fonts used by pages that are not embedded (KDP needs every font embedded). Type 3 fonts are drawn by the file itself. */
function unembeddedFonts(doc: PDFDocument): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const lookup = <T>(o: unknown, type: { prototype: T }): T | undefined => {
    const v = o instanceof PDFRef ? doc.context.lookup(o) : o;
    return v instanceof (type as unknown as typeof Object) ? (v as T) : undefined;
  };
  const embedded = (font: PDFDict): boolean => {
    const subtype = font.get(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Type3')) return true;
    if (subtype === PDFName.of('Type0')) {
      const kids = lookup(font.get(PDFName.of('DescendantFonts')), PDFArray);
      const kid = kids ? lookup(kids.get(0), PDFDict) : undefined;
      return kid ? embedded(kid) : false;
    }
    const desc = lookup(font.get(PDFName.of('FontDescriptor')), PDFDict);
    return !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.has(PDFName.of(k)));
  };
  const visit = (resources: PDFDict | undefined, page: number, seen: Set<PDFDict>) => {
    if (!resources || seen.has(resources)) return;
    seen.add(resources);
    const fonts = lookup(resources.get(PDFName.of('Font')), PDFDict);
    for (const [, ref] of fonts?.entries() ?? []) {
      const font = lookup(ref, PDFDict);
      if (!font || embedded(font)) continue;
      const name = String(font.get(PDFName.of('BaseFont')) ?? '(sin nombre)').replace(/^\//, '');
      const pages = found.get(name) ?? [];
      if (!pages.includes(page)) pages.push(page);
      found.set(name, pages);
    }
    // Forms (and the patterns and Type 3 glyphs they hold) carry resources of their own.
    const xobjects = lookup(resources.get(PDFName.of('XObject')), PDFDict);
    for (const [, ref] of xobjects?.entries() ?? []) {
      const x = lookup(ref, PDFStream);
      if (x?.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) visit(lookup(x.dict.get(PDFName.of('Resources')), PDFDict), page, seen);
    }
  };
  doc.getPages().forEach((p, i) => visit(p.node.Resources(), i + 1, new Set()));
  return found;
}

/** Pages that use transparency (soft masks, or fill or stroke opacity below 1). KDP asks for it flattened. */
function transparentPages(doc: PDFDocument): number[] {
  const pages: number[] = [];
  const lookup = <T>(o: unknown, type: { prototype: T }): T | undefined => {
    const v = o instanceof PDFRef ? doc.context.lookup(o) : o;
    return v instanceof (type as unknown as typeof Object) ? (v as T) : undefined;
  };
  const uses = (resources: PDFDict | undefined, seen: Set<PDFDict>): boolean => {
    if (!resources || seen.has(resources)) return false;
    seen.add(resources);
    const gs = lookup(resources.get(PDFName.of('ExtGState')), PDFDict);
    for (const [, ref] of gs?.entries() ?? []) {
      const s = lookup(ref, PDFDict);
      if (!s) continue;
      for (const k of ['ca', 'CA']) {
        const v = s.get(PDFName.of(k));
        if (v instanceof PDFNumber && v.asNumber() < 1) return true;
      }
      const mask = s.get(PDFName.of('SMask'));
      if (mask && mask !== PDFName.of('None')) return true;
    }
    const xobjects = lookup(resources.get(PDFName.of('XObject')), PDFDict);
    for (const [, ref] of xobjects?.entries() ?? []) {
      const x = lookup(ref, PDFStream);
      if (!x) continue;
      if (x.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') && x.dict.has(PDFName.of('SMask'))) return true;
      if (x.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') && uses(lookup(x.dict.get(PDFName.of('Resources')), PDFDict), seen)) return true;
    }
    return false;
  };
  doc.getPages().forEach((p, i) => { if (uses(p.node.Resources(), new Set())) pages.push(i + 1); });
  return pages;
}

/** Checks a print interior against KDP's requirements. Returns structure only, never page text. */
export async function kdpCheck(bytes: Uint8Array, spec: KdpSpec): Promise<KdpReport> {
  const trim = trimOf(spec);
  const range = kdpPageRange(spec);
  const bleed = !!spec.bleed;
  const pageSize = { width: trim.width + (bleed ? BLEED_W : 0), height: trim.height + (bleed ? BLEED_H : 0) };
  const doc = await load(bytes);
  const pageCount = doc.getPageCount();
  const margins = kdpMargins(Math.max(pageCount, 24), bleed);
  const issues: KdpIssue[] = [];
  const add = (code: KdpCode, severity: KdpIssue['severity'], pages?: number[], details?: KdpIssue['details']) =>
    issues.push({ code, severity, ...(pages?.length ? { pages } : {}), ...(details ? { details } : {}) });

  if (!range) {
    // Hardcovers only come in KDP's sizes; paperbacks also take custom sizes within its range.
    const sizeOk = spec.binding === 'hardcover' ? !trim.custom : trim.width >= 4 && trim.width <= 8.5 && trim.height >= 6 && trim.height <= 11.69;
    add(sizeOk ? 'KDP_INK_UNSUPPORTED' : 'KDP_TRIM_UNSUPPORTED', 'error', undefined, { binding: spec.binding, trim: trim.label, ink: spec.ink ?? 'black-white' });
  }
  const pr = range ?? { min: spec.binding === 'hardcover' ? 75 : 24, max: spec.binding === 'hardcover' ? 550 : 828 };
  if (pageCount < pr.min) add('KDP_PAGE_COUNT_LOW', 'error', undefined, { count: pageCount, min: pr.min });
  if (pageCount > pr.max) add('KDP_PAGE_COUNT_HIGH', 'error', undefined, { count: pageCount, max: pr.max });
  if (pageCount % 2 === 1) add('KDP_PAGE_COUNT_ODD', 'warning', undefined, { count: pageCount });

  const geometry = await pageGeometry(bytes);
  const wrongSize: number[] = [];
  const rotated: number[] = [];
  const crossing: number[] = [];
  const lowDpi: number[] = [];
  let minDpi = Infinity;
  geometry.forEach((g, i) => {
    const n = i + 1;
    if (g.rotation % 180 !== 0) rotated.push(n);
    const sized = Math.abs(g.width - pageSize.width * 72) <= SIZE_TOLERANCE && Math.abs(g.height - pageSize.height * 72) <= SIZE_TOLERANCE;
    if (!sized) wrongSize.push(n);
    // Margins only make sense on a page of the right size; the others are reported (and fitted) first.
    const content = sized ? contentBox(g, bleed) : undefined;
    if (content && outside(content, safeBox(n, g.width, g.height, margins))) crossing.push(n);
    for (const img of g.images) {
      // Tiny decorations (under a quarter inch) do not show resolution problems.
      const wIn = (img.box[2] - img.box[0]) / 72;
      const hIn = (img.box[3] - img.box[1]) / 72;
      if (wIn < 0.25 || hIn < 0.25) continue;
      if (img.dpi < MIN_DPI - 0.5) {
        if (!lowDpi.includes(n)) lowDpi.push(n);
        minDpi = Math.min(minDpi, img.dpi);
      }
    }
  });
  if (wrongSize.length) add('KDP_PAGE_SIZE', 'error', wrongSize, { width: pageSize.width, height: pageSize.height });
  if (rotated.length) add('KDP_PAGE_ROTATED', 'error', rotated);
  if (crossing.length) add('KDP_MARGINS', 'error', crossing, { inside: margins.inside, outside: margins.outside });
  if (lowDpi.length) add('KDP_LOW_RESOLUTION', 'error', lowDpi, { dpi: Math.round(minDpi), min: MIN_DPI });

  const fonts = unembeddedFonts(doc);
  if (fonts.size) add('KDP_FONTS_NOT_EMBEDDED', 'error', [...new Set([...fonts.values()].flat())].sort((a, b) => a - b), { fonts: [...fonts.keys()].join(', ') });
  const transparent = transparentPages(doc);
  if (transparent.length) add('KDP_TRANSPARENCY', 'warning', transparent);

  const annotated = doc.getPages().map((p, i) => ((p.node.Annots()?.size() ?? 0) > 0 ? i + 1 : 0)).filter(Boolean);
  if (annotated.length) add('KDP_ANNOTATIONS', 'error', annotated);
  if (doc.catalog.has(PDFName.of('Outlines'))) add('KDP_BOOKMARKS', 'error');
  const info = await inspect(bytes);
  if (info.encrypted) add('KDP_ENCRYPTED', 'error');
  if (info.hasMetadata) add('KDP_METADATA', 'warning');

  return { ok: !issues.some((x) => x.severity === 'error'), issues, pageCount, pageSize, margins, pageRange: pr };
}

/**
 * Corrects what can be corrected safely for KDP: pages scaled to the trim size (centered, never
 * stretched), content scaled into the margins (books without bleed), an even page count (and, if
 * asked, KDP's minimum) with blank pages at the end, and annotations, bookmarks and metadata removed.
 * What cannot be fixed here (fonts that are not embedded, low-resolution images, transparency) is left
 * for kdpCheck() to report.
 */
export async function kdpPrepare(bytes: Uint8Array, spec: KdpSpec, opts: KdpPrepareOptions = {}): Promise<{ bytes: Uint8Array; report: KdpPrepareReport }> {
  const trim = trimOf(spec);
  const bleed = !!spec.bleed;
  const W = (trim.width + (bleed ? BLEED_W : 0)) * 72;
  const H = (trim.height + (bleed ? BLEED_H : 0)) * 72;
  const report: KdpPrepareReport = { resized: [], fitted: [], added: 0, annotationsRemoved: 0, bookmarksRemoved: false, metadataRemoved: false };

  // Metadata first (it rewrites the file), then everything else on one document.
  const before = await inspect(bytes);
  if (before.hasMetadata) { bytes = await stripMetadata(bytes); report.metadataRemoved = true; }
  const doc = await load(bytes);

  // Non-printing content KDP asks to remove.
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (annots?.size()) { report.annotationsRemoved += annots.size(); page.node.delete(PDFName.of('Annots')); }
  }
  if (doc.catalog.has(PDFName.of('Outlines'))) {
    doc.catalog.delete(PDFName.of('Outlines'));
    if (doc.catalog.get(PDFName.of('PageMode')) === PDFName.of('UseOutlines')) doc.catalog.delete(PDFName.of('PageMode'));
    report.bookmarksRemoved = true;
  }

  // Page size: scale to fit the trim (plus bleed) and center. Rotated pages are left for the check to report.
  doc.getPages().forEach((page, i) => {
    if (page.getRotation().angle % 180 !== 0) return;
    const box = page.getMediaBox();
    if (Math.abs(box.width - W) <= SIZE_TOLERANCE && Math.abs(box.height - H) <= SIZE_TOLERANCE && box.x === 0 && box.y === 0) return;
    const s = Math.min(W / box.width, H / box.height);
    page.translateContent(-box.x, -box.y);
    page.scaleContent(s, s);
    page.translateContent((W - box.width * s) / 2, (H - box.height * s) / 2);
    page.setMediaBox(0, 0, W, H);
    for (const k of ['CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) page.node.delete(PDFName.of(k));
    report.resized.push(i + 1);
  });

  // Page count: even, and the minimum when asked. Blank pages go at the end.
  const range = kdpPageRange(spec);
  let target = doc.getPageCount();
  if (opts.padToMinimum && range && target < range.min) target = range.min;
  if (target % 2 === 1) target += 1;
  while (doc.getPageCount() < target) { doc.addPage([W, H]); report.added++; }

  let out = await doc.save({ useObjectStreams: true });

  // Margins: scale what crosses them into the safe area, page by page. Only without bleed: with bleed,
  // art that reaches the edge is meant to, and scaling it would leave a white border.
  if ((opts.fitMargins ?? true) && !bleed) {
    const geometry = await pageGeometry(out);
    const margins = kdpMargins(Math.max(geometry.length, 24), false);
    const fitted = await PDFDocument.load(out, { updateMetadata: false });
    let changed = false;
    geometry.forEach((g, i) => {
      const n = i + 1;
      const c = contentBox(g, false);
      const safe = safeBox(n, g.width, g.height, margins);
      if (!c || !outside(c, safe) || g.rotation % 180 !== 0) return;
      const s = Math.min((safe[2] - safe[0]) / (c[2] - c[0]), (safe[3] - safe[1]) / (c[3] - c[1]), 1);
      // Keep the content where it was when it already fits along an axis; otherwise center it in the safe area.
      const place = (lo: number, hi: number, slo: number, shi: number, size: number) =>
        size <= shi - slo + 0.01 ? Math.min(Math.max(lo, slo), shi - size) : slo + (shi - slo - size) / 2;
      const tx = place(c[0], c[2], safe[0], safe[2], (c[2] - c[0]) * s) - s * c[0];
      const ty = place(c[1], c[3], safe[1], safe[3], (c[3] - c[1]) * s) - s * c[1];
      const page = fitted.getPage(i);
      page.scaleContent(s, s);
      page.translateContent(tx, ty);
      report.fitted.push({ page: n, scale: Math.round(s * 1000) / 1000 });
      changed = true;
    });
    if (changed) out = await fitted.save({ useObjectStreams: true });
  }
  return { bytes: out, report };
}
