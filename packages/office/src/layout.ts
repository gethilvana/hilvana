import { PDFDocument, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import { FontManager, type Segment } from './fonts.js';
import type { Block, Inline, Paragraph, RunStyle, Table } from './model.js';
import type { ParsedDocx } from './parse.js';

const color = (hex: string | undefined) => {
  const n = parseInt(hex && /^[0-9a-f]{6}$/i.test(hex) ? hex : '000000', 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Page numbers for PAGE / NUMPAGES fields while laying out headers and footers. */
interface FieldValues { page?: number; total?: number }

/* ------------------------------------------------------------------ Atoms and lines */

type Atom =
  | { t: 'text'; segs: Segment[]; style: RunStyle; size: number; width: number; space: boolean }
  | { t: 'tab'; style: RunStyle }
  | { t: 'image'; image: Extract<Inline, { kind: 'image' }>; width: number; height: number }
  | { t: 'break'; page: boolean; style: RunStyle };

type Placed =
  | { kind: 'text'; segs: Segment[]; style: RunStyle; size: number; x: number; width: number; space: boolean }
  | { kind: 'image'; image: Extract<Inline, { kind: 'image' }>; x: number; width: number; height: number };

interface Line {
  items: Placed[];
  width: number;
  /** x where this line starts, relative to the paragraph box. */
  start: number;
  avail: number;
  ascent: number;
  descent: number;
  gap: number;
  height: number;
  baseline: number; // distance from line top to baseline
  forcedEnd: boolean;
  pageBreakAfter: boolean;
  label?: { segs: Segment[]; style: RunStyle; x: number };
}

/** Something with a height that can be drawn at a position; the unit of pagination. */
interface Slice {
  height: number;
  draw: (page: PDFPage, x: number, top: number) => void;
  /** Collapses at the top of a page (paragraph spacing). */
  spacer?: boolean;
  breakBefore?: boolean;
  keepWithNext?: boolean;
}

export class LayoutEngine {
  private images = new Map<Uint8Array, PDFImage>();
  readonly warnings = new Set<string>();

  constructor(private doc: PDFDocument, private fonts: FontManager, private model: ParsedDocx) {}

  /* --------------------------------------------- preparation (async) */

  async prepare(): Promise<void> {
    const uses: { style: RunStyle; text: string }[] = [];
    const imgs: Extract<Inline, { kind: 'image' }>[] = [];
    const visit = (blocks: Block[] | undefined) => {
      for (const b of blocks ?? []) {
        if (b.type === 'paragraph') {
          if (b.label) uses.push({ style: b.label.style, text: b.label.text });
          for (const i of b.inlines) {
            if (i.kind === 'text') uses.push({ style: i.style, text: i.text.includes('\u0001') ? '0123456789' : i.text });
            else if (i.kind === 'image') imgs.push(i);
            else uses.push({ style: i.style, text: ' ' });
          }
        } else if (b.type === 'table') {
          for (const r of b.rows) for (const c of r.cells) visit(c.blocks);
        }
      }
    };
    visit(this.model.blocks);
    visit(this.model.header);
    visit(this.model.footer);
    await this.fonts.prepare(uses);
    for (const img of imgs) {
      if (this.images.has(img.bytes)) continue;
      try {
        this.images.set(img.bytes, img.format === 'png' ? await this.doc.embedPng(img.bytes) : await this.doc.embedJpg(img.bytes));
      } catch {
        this.warnings.add('UNSUPPORTED_IMAGE_FORMAT');
      }
    }
  }

  /* --------------------------------------------- paragraphs */

  private textAtoms(text: string, style: RunStyle, out: Atom[]) {
    const size = style.vertAlign ? style.size * 0.65 : style.size;
    for (const token of text.split(/(\s+)/)) {
      if (!token) continue;
      const space = /^\s+$/.test(token);
      const t = space ? token.replace(/[\t\n\r]/g, ' ') : token;
      const segs = this.fonts.segment(t, style);
      const width = segs.reduce((w, s) => w + s.font.widthOfTextAtSize(s.text, size), 0);
      out.push({ t: 'text', segs, style, size, width, space });
    }
  }

  private atoms(p: Paragraph, fields: FieldValues): Atom[] {
    const out: Atom[] = [];
    for (const i of p.inlines) {
      if (i.kind === 'text') {
        let text = i.text;
        if (text.includes('\u0001')) {
          text = text.replace(/\u0001(PAGE|NUMPAGES)\u0001/g, (_, f: string) => {
            const v = f === 'PAGE' ? fields.page : fields.total;
            if (v === undefined) this.warnings.add('PAGE_FIELD_IN_BODY');
            return v === undefined ? '' : String(v);
          });
        }
        this.textAtoms(text, i.style, out);
      } else if (i.kind === 'tab') out.push({ t: 'tab', style: i.style });
      else if (i.kind === 'break') out.push({ t: 'break', page: i.style.size === -1, style: i.style });
      else if (this.images.has(i.bytes)) out.push({ t: 'image', image: i, width: i.width, height: i.height });
    }
    return out;
  }

  private lineMetrics(line: Line, p: Paragraph, fallback: RunStyle) {
    let ascent = 0, descent = 0, gap = 0;
    const consider = (style: RunStyle) => {
      const m = this.fonts.metrics(style);
      ascent = Math.max(ascent, m.ascent * style.size);
      descent = Math.max(descent, m.descent * style.size);
      gap = Math.max(gap, m.lineGap * style.size);
    };
    for (const it of line.items) {
      if (it.kind === 'text') consider(it.style);
      else ascent = Math.max(ascent, it.height);
    }
    // The list label never makes the line taller (Word sizes the line from the text).
    if (ascent === 0) consider(line.label && !line.items.length ? line.label.style : fallback);
    const natural = ascent + descent + gap;
    const rule = p.style.line;
    let height: number;
    let baseline: number;
    if (rule.rule === 'auto') {
      height = natural * rule.value;
      baseline = ascent + (height - natural);
    } else if (rule.rule === 'exact') {
      height = rule.value;
      baseline = Math.max(0, height - descent - gap);
    } else {
      height = Math.max(rule.value, natural);
      baseline = height - descent - gap;
    }
    Object.assign(line, { ascent, descent, gap, height, baseline });
  }

  private layoutParagraph(p: Paragraph, width: number, fields: FieldValues): Line[] {
    const s = p.style;
    const atoms = this.atoms(p, fields);
    const fallback = p.inlines.find((i): i is Extract<Inline, { kind: 'text' }> => i.kind === 'text')?.style
      ?? p.label?.style ?? { font: 'Calibri', size: 11, bold: false, italic: false, underline: false, strike: false, color: '000000', caps: false };
    const lines: Line[] = [];
    const tab = this.model.defaultTab || 36;

    const newLine = (first: boolean): Line => {
      const start = first ? s.indentLeft + s.firstLine : s.indentLeft;
      const avail = Math.max(10, width - s.indentRight - start);
      return { items: [], width: 0, start, avail, ascent: 0, descent: 0, gap: 0, height: 0, baseline: 0, forcedEnd: false, pageBreakAfter: false };
    };
    let line = newLine(true);
    if (p.label) {
      // The label sits at the hanging position; text starts at the left indent (or after the label).
      const segs = this.fonts.segment(p.label.text, p.label.style);
      const lw = segs.reduce((w, sg) => w + sg.font.widthOfTextAtSize(sg.text, p.label!.style.size), 0);
      line.label = { segs, style: p.label.style, x: 0 };
      const textStart = Math.max(s.indentLeft, line.start + lw + 3);
      const offset = textStart - line.start;
      line.width = offset;
    }
    let pendingSpaces: Atom[] = [];

    const finish = (forced: boolean, pageBreak = false) => {
      // Trailing spaces never count toward the line width.
      while (line.items.length && line.items[line.items.length - 1]!.kind === 'text' && (line.items[line.items.length - 1] as { space: boolean }).space) {
        const sp = line.items.pop() as { width: number };
        line.width -= sp.width;
      }
      line.forcedEnd = forced;
      line.pageBreakAfter = pageBreak;
      this.lineMetrics(line, p, fallback);
      lines.push(line);
      line = newLine(false);
      pendingSpaces = [];
    };

    const place = (a: Atom) => {
      if (a.t === 'text') {
        line.items.push({ kind: 'text', segs: a.segs, style: a.style, size: a.size, x: line.width, width: a.width, space: a.space });
        line.width += a.width;
      } else if (a.t === 'image') {
        line.items.push({ kind: 'image', image: a.image, x: line.width, width: a.width, height: a.height });
        line.width += a.width;
      }
    };

    // Group atoms into words (consecutive non-space text or images) separated by spaces, tabs and breaks.
    let i = 0;
    while (i < atoms.length) {
      const a = atoms[i]!;
      if (a.t === 'break') { finish(true, a.page); i++; continue; }
      if (a.t === 'tab') {
        const pos = line.start + line.width;
        const next = (Math.floor((pos - s.indentLeft) / tab + 1e-6) + 1) * tab + s.indentLeft;
        const w = Math.max(next - pos, 2);
        if (line.width + w > line.avail && line.items.length) finish(false);
        line.items.push({ kind: 'text', segs: [], style: a.style, size: a.style.size, x: line.width, width: w, space: false });
        line.width += w;
        pendingSpaces = [];
        i++;
        continue;
      }
      if (a.t === 'text' && a.space) { pendingSpaces.push(a); i++; continue; }
      const word: Atom[] = [];
      while (i < atoms.length) {
        const b = atoms[i]!;
        if ((b.t === 'text' && !b.space) || b.t === 'image') { word.push(b); i++; } else break;
      }
      // Images wider than the column are scaled down to fit.
      for (const w of word) {
        if (w.t === 'image' && w.width > line.avail) {
          const k = line.avail / w.width;
          w.width *= k; w.height *= k;
        }
      }
      const spaceW = pendingSpaces.reduce((acc, sp) => acc + (sp as { width: number }).width, 0);
      const wordW = word.reduce((acc, w) => acc + (w as { width: number }).width, 0);
      if (line.items.length > 0 && line.width + spaceW + wordW > line.avail) {
        finish(false);
      } else {
        pendingSpaces.forEach(place);
      }
      pendingSpaces = [];
      if (wordW > line.avail && word.length) {
        // A single word longer than the line: break it by characters.
        for (const w of word) {
          if (w.t !== 'text') { const ww = w.t === 'image' ? w.width : 0; if (line.width + ww > line.avail && line.items.length) finish(false); place(w); continue; }
          for (const seg of w.segs) {
            for (const ch of seg.text) {
              const cw = seg.font.widthOfTextAtSize(ch, w.size);
              if (line.width + cw > line.avail && line.items.length) finish(false);
              place({ ...w, segs: [{ text: ch, font: seg.font }], width: cw });
            }
          }
        }
      } else word.forEach(place);
    }
    finish(true);
    return lines;
  }

  private drawLine(page: PDFPage, line: Line, p: Paragraph, x0: number, top: number, width: number) {
    const s = p.style;
    let offset = 0;
    let extraPerSpace = 0;
    const free = line.avail - line.width;
    if (s.align === 'center') offset = free / 2;
    else if (s.align === 'right') offset = free;
    else if (s.align === 'justify' && !line.forcedEnd) {
      const spaces = line.items.filter((it) => it.kind === 'text' && it.space).length;
      if (spaces > 0 && free > 0) extraPerSpace = free / spaces;
    }
    if (s.shading) page.drawRectangle({ x: x0 + s.indentLeft, y: top - line.height, width: width - s.indentLeft - s.indentRight, height: line.height, color: color(s.shading) });
    const baseY = top - line.baseline;
    if (line.label) {
      let lx = x0 + line.start;
      for (const sg of line.label.segs) {
        page.drawText(sg.text, { x: lx, y: baseY, size: line.label.style.size, font: sg.font, color: color(line.label.style.color) });
        lx += sg.font.widthOfTextAtSize(sg.text, line.label.style.size);
      }
    }
    let shift = 0;
    for (const it of line.items) {
      const x = x0 + line.start + offset + it.x + shift;
      if (it.kind === 'image') {
        const img = this.images.get(it.image.bytes);
        if (img) page.drawImage(img, { x, y: baseY, width: it.width, height: it.height });
        continue;
      }
      const w = it.width + (it.space ? extraPerSpace : 0);
      if (it.space) shift += extraPerSpace;
      const st = it.style;
      const rise = st.vertAlign === 'superscript' ? st.size * 0.33 : st.vertAlign === 'subscript' ? -st.size * 0.14 : 0;
      if (st.highlight) {
        const m = this.fonts.metrics(st);
        page.drawRectangle({ x, y: baseY - m.descent * st.size, width: w, height: (m.ascent + m.descent) * st.size, color: color(st.highlight) });
      }
      let tx = x;
      if (!it.space) {
        for (const sg of it.segs) {
          if (sg.text) page.drawText(sg.text, { x: tx, y: baseY + rise, size: it.size, font: sg.font, color: color(st.color) });
          tx += sg.font.widthOfTextAtSize(sg.text, it.size);
        }
      }
      if (st.underline && it.width > 0) page.drawLine({ start: { x, y: baseY - st.size * 0.12 }, end: { x: x + w, y: baseY - st.size * 0.12 }, thickness: Math.max(0.5, st.size * 0.05), color: color(st.color) });
      if (st.strike && it.width > 0) page.drawLine({ start: { x, y: baseY + st.size * 0.28 }, end: { x: x + w, y: baseY + st.size * 0.28 }, thickness: Math.max(0.5, st.size * 0.05), color: color(st.color) });
    }
  }

  private paragraphSlices(p: Paragraph, width: number, fields: FieldValues, prev?: Block, next?: Block): Slice[] {
    const s = p.style;
    const lines = this.layoutParagraph(p, width, fields);
    const slices: Slice[] = [];
    // "Don't add space between paragraphs of the same style" applies on both sides.
    const sameStyleAsPrev = s.contextualSpacing && prev?.type === 'paragraph' && prev.style.styleId === s.styleId;
    const sameStyleAsNext = s.contextualSpacing && next?.type === 'paragraph' && next.style.styleId === s.styleId;
    if (s.spaceBefore > 0 && !sameStyleAsPrev) slices.push({ height: s.spaceBefore, draw: () => {}, spacer: true });
    lines.forEach((line, idx) => {
      slices.push({
        height: line.height,
        draw: (page, x, top) => this.drawLine(page, line, p, x, top, width),
        breakBefore: idx === 0 && s.pageBreakBefore,
        keepWithNext: s.keepNext || idx < lines.length - 1 && lines.length <= 3,
      });
      if (line.pageBreakAfter) slices.push({ height: 0, draw: () => {}, breakBefore: false, spacer: false, keepWithNext: false, ...{ pageBreak: true } } as Slice);
    });
    if (s.borderBottom) {
      const bb = s.borderBottom;
      slices.push({ height: bb.width + 2, draw: (page, x, top) => page.drawLine({ start: { x: x + s.indentLeft, y: top - 1 }, end: { x: x + width - s.indentRight, y: top - 1 }, thickness: bb.width, color: color(bb.color) }) });
    }
    if (s.spaceAfter > 0 && !sameStyleAsNext) slices.push({ height: s.spaceAfter, draw: () => {}, spacer: true });
    return slices;
  }

  /* --------------------------------------------- tables */

  private tableSlices(t: Table, width: number, fields: FieldValues): Slice[] {
    let cols = t.columns.length ? [...t.columns] : [];
    const gridCount = Math.max(cols.length, ...t.rows.map((r) => r.cells.reduce((n, c) => n + c.span, 0)));
    if (cols.length < gridCount) {
      const rest = Math.max(0, width - cols.reduce((a, b) => a + b, 0));
      const add = gridCount - cols.length;
      cols = [...cols, ...Array(add).fill(rest / add || width / gridCount)];
    }
    const total = cols.reduce((a, b) => a + b, 0) || width;
    const avail = width - t.indent;
    if (total > avail) cols = cols.map((c) => (c * avail) / total);
    const xs = cols.reduce<number[]>((acc, c) => [...acc, acc[acc.length - 1]! + c], [0]);
    const pad = t.cellPadding;

    return t.rows.map((row, rowIndex) => {
      let gi = 0;
      const cells = row.cells.map((cell) => {
        const x = xs[gi] ?? 0;
        const w = (xs[Math.min(gi + cell.span, xs.length - 1)] ?? width) - x;
        gi += cell.span;
        const content = cell.vMerge === 'continue' ? [] : this.measureBlocks(cell.blocks, Math.max(10, w - pad.left - pad.right), fields);
        const h = content.reduce((a, s) => a + s.height, 0);
        return { cell, x, w, content, h, gridIndex: gi - cell.span };
      });
      const height = Math.max(row.minHeight, ...cells.map((c) => c.h + pad.top + pad.bottom), 6);
      const next = t.rows[rowIndex + 1];
      return {
        height,
        keepWithNext: row.header,
        draw: (page: PDFPage, x0: number, top: number) => {
          const left = x0 + t.indent;
          for (const c of cells) {
            if (c.cell.shading) page.drawRectangle({ x: left + c.x, y: top - height, width: c.w, height, color: color(c.cell.shading) });
          }
          for (const c of cells) {
            let y = top - pad.top;
            if (c.cell.vAlign === 'center') y -= (height - pad.top - pad.bottom - c.h) / 2;
            else if (c.cell.vAlign === 'bottom') y -= height - pad.top - pad.bottom - c.h;
            for (const s of c.content) { s.draw(page, left + c.x + pad.left, y); y -= s.height; }
          }
          const tableEdge = t.borders ? { width: 0.5, color: t.borderColor } : null;
          for (const c of cells) {
            const xL = left + c.x;
            const xR = xL + c.w;
            const continuesBelow = !!next?.cells.find((n, idx) => {
              let g = 0;
              for (let k = 0; k < idx; k++) g += next.cells[k]!.span;
              return g === c.gridIndex && n.vMerge === 'continue';
            });
            // A side drawn on the cell wins; otherwise the table's borders apply.
            const side = (k: 'top' | 'right' | 'bottom' | 'left') => {
              const own = c.cell.borders?.[k];
              return own === undefined ? tableEdge : own;
            };
            const line = (b: { width: number; color: string } | null, x1: number, y1: number, x2: number, y2: number) => {
              if (b) page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: b.width, color: color(b.color) });
            };
            if (c.cell.vMerge !== 'continue') line(side('top'), xL, top, xR, top);
            if (!continuesBelow) line(side('bottom'), xL, top - height, xR, top - height);
            line(side('left'), xL, top, xL, top - height);
            line(side('right'), xR, top, xR, top - height);
          }
        },
      } satisfies Slice;
    });
  }

  /* --------------------------------------------- blocks and pages */

  measureBlocks(blocks: Block[], width: number, fields: FieldValues = {}): Slice[] {
    const out: Slice[] = [];
    let prev: Block | undefined;
    blocks.forEach((b, idx) => {
      if (b.type === 'paragraph') out.push(...this.paragraphSlices(b, width, fields, prev, blocks[idx + 1]));
      else if (b.type === 'table') {
        // Space between a table and the next paragraph comes from that paragraph.
        out.push(...this.tableSlices(b, width, fields));
      } else out.push({ height: 0, draw: () => {}, ...{ pageBreak: true } } as Slice);
      prev = b;
    });
    return out;
  }

  /** Lays out the whole document into new pages of `doc` and returns the page count. */
  render(): number {
    const { page: setup } = this.model;
    const contentWidth = setup.width - setup.margin.left - setup.margin.right;
    const top = setup.height - setup.margin.top;
    const bottom = setup.margin.bottom;
    const slices = this.measureBlocks(this.model.blocks, contentWidth);

    const pages: PDFPage[] = [];
    let page = this.doc.addPage([setup.width, setup.height]);
    pages.push(page);
    let y = top;
    const atTop = () => y === top;
    const newPage = () => {
      page = this.doc.addPage([setup.width, setup.height]);
      pages.push(page);
      y = top;
    };

    for (let k = 0; k < slices.length; k++) {
      const s = slices[k]!;
      if ((s as Slice & { pageBreak?: boolean }).pageBreak) { if (!atTop()) newPage(); continue; }
      if (s.breakBefore && !atTop()) newPage();
      if (s.spacer && atTop()) continue;
      // Keep headings (and short paragraphs) with what follows when it would not fit.
      if (s.keepWithNext && !atTop()) {
        let need = s.height;
        for (let j = k + 1; j < slices.length && j < k + 6; j++) {
          const n = slices[j]!;
          need += n.height;
          if (!n.spacer && !n.keepWithNext) break;
        }
        if (y - need < bottom && need < top - bottom) newPage();
      }
      if (y - s.height < bottom - 0.01 && !atTop()) {
        newPage();
        if (s.spacer) continue;
      }
      if (s.height > top - bottom) this.warnings.add('CONTENT_TALLER_THAN_PAGE');
      s.draw(page, setup.margin.left, y);
      y -= s.height;
    }

    // Headers and footers, now that the page count is known.
    const total = pages.length;
    pages.forEach((pg, idx) => {
      const fields = { page: idx + 1, total };
      if (this.model.header) {
        let hy = setup.height - this.model.headerDistance;
        for (const s of this.measureBlocks(this.model.header, contentWidth, fields)) { s.draw(pg, setup.margin.left, hy); hy -= s.height; }
      }
      if (this.model.footer) {
        const fs = this.measureBlocks(this.model.footer, contentWidth, fields).filter((s, i, arr) => !(s.spacer && i === arr.length - 1));
        let fy = this.model.footerDistance + fs.reduce((a, s) => a + s.height, 0);
        for (const s of fs) { s.draw(pg, setup.margin.left, fy); fy -= s.height; }
      }
    });
    return total;
  }
}
