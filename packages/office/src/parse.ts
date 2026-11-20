import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import type { Block, DocModel, Inline, PageSetup, Paragraph, ParagraphStyle, RunStyle, Table, TableCell, TableRow } from './model.js';

/* ------------------------------------------------------------------ XML helpers */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

type El = Element;

function parseXml(text: string): Document {
  return new DOMParser({ onError: () => undefined }).parseFromString(text, 'text/xml') as unknown as Document;
}

function kids(el: El | null | undefined, name?: string): El[] {
  if (!el) return [];
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as El).localName === name)) out.push(n as El);
  }
  return out;
}

const kid = (el: El | null | undefined, name: string): El | undefined => kids(el, name)[0];

function attr(el: El | null | undefined, name: string): string | undefined {
  if (!el) return undefined;
  const v = el.getAttributeNS(W_NS, name) || el.getAttribute(`w:${name}`) || el.getAttribute(name);
  return v === null || v === '' ? undefined : v;
}

function rAttr(el: El | null | undefined, name: string): string | undefined {
  if (!el) return undefined;
  return el.getAttributeNS(R_NS, name) || el.getAttribute(`r:${name}`) || undefined;
}

/** First descendant with this local name (depth-first). */
function find(el: El | null | undefined, name: string): El | undefined {
  if (!el) return undefined;
  for (const c of kids(el)) {
    if (c.localName === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return undefined;
}

/** Toggle properties: <w:b/> is on; w:val="0"/"false"/"none" is off. */
function toggle(el: El | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, 'val');
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}

const twip = (v: string | undefined) => (v === undefined ? undefined : Number(v) / 20);

/* ------------------------------------------------------------------ Props */

type RunProps = Partial<RunStyle> & { charStyle?: string; fontTheme?: 'major' | 'minor' };
type ParaProps = Partial<Omit<ParagraphStyle, 'line'>> & {
  line?: ParagraphStyle['line'];
  numId?: string;
  ilvl?: number;
  styleId?: string;
};

const HIGHLIGHT: Record<string, string> = {
  yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000',
  darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000',
  darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF',
};

function readRPr(rPr: El | undefined): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  const fonts = kid(rPr, 'rFonts');
  if (fonts) {
    const name = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi');
    const theme = attr(fonts, 'asciiTheme') ?? attr(fonts, 'hAnsiTheme');
    if (name) p.font = name;
    else if (theme) p.fontTheme = theme.startsWith('major') ? 'major' : 'minor';
  }
  const sz = attr(kid(rPr, 'sz'), 'val');
  if (sz) p.size = Number(sz) / 2;
  const b = toggle(kid(rPr, 'b')); if (b !== undefined) p.bold = b;
  const i = toggle(kid(rPr, 'i')); if (i !== undefined) p.italic = i;
  const u = kid(rPr, 'u'); if (u) p.underline = attr(u, 'val') !== 'none';
  const s = toggle(kid(rPr, 'strike')) ?? toggle(kid(rPr, 'dstrike')); if (s !== undefined) p.strike = s;
  const caps = toggle(kid(rPr, 'caps')) ?? toggle(kid(rPr, 'smallCaps')); if (caps !== undefined) p.caps = caps;
  const color = attr(kid(rPr, 'color'), 'val');
  if (color && /^[0-9a-f]{6}$/i.test(color)) p.color = color.toUpperCase();
  else if (color === 'auto') p.color = 'auto';
  const hl = attr(kid(rPr, 'highlight'), 'val');
  if (hl && HIGHLIGHT[hl]) p.highlight = HIGHLIGHT[hl];
  const shd = attr(kid(rPr, 'shd'), 'fill');
  if (shd && /^[0-9a-f]{6}$/i.test(shd) && !p.highlight) p.highlight = shd.toUpperCase();
  const va = attr(kid(rPr, 'vertAlign'), 'val');
  if (va === 'superscript' || va === 'subscript') p.vertAlign = va;
  const rs = attr(kid(rPr, 'rStyle'), 'val'); if (rs) p.charStyle = rs;
  if (toggle(kid(rPr, 'vanish'))) p.size = 0; // hidden text
  return p;
}

function readPPr(pPr: El | undefined): ParaProps {
  const p: ParaProps = {};
  if (!pPr) return p;
  const jc = attr(kid(pPr, 'jc'), 'val');
  if (jc) p.align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : 'left';
  const sp = kid(pPr, 'spacing');
  if (sp) {
    const before = twip(attr(sp, 'before')); if (before !== undefined) p.spaceBefore = before;
    const after = twip(attr(sp, 'after')); if (after !== undefined) p.spaceAfter = after;
    if (attr(sp, 'beforeAutospacing') === '1') p.spaceBefore = 14;
    if (attr(sp, 'afterAutospacing') === '1') p.spaceAfter = 14;
    const line = attr(sp, 'line');
    if (line) {
      const rule = attr(sp, 'lineRule') ?? 'auto';
      p.line = rule === 'auto' ? { rule: 'auto', value: Number(line) / 240 } : { rule: rule === 'exact' ? 'exact' : 'atLeast', value: Number(line) / 20 };
    }
  }
  const ind = kid(pPr, 'ind');
  if (ind) {
    const left = twip(attr(ind, 'left') ?? attr(ind, 'start')); if (left !== undefined) p.indentLeft = left;
    const right = twip(attr(ind, 'right') ?? attr(ind, 'end')); if (right !== undefined) p.indentRight = right;
    const first = twip(attr(ind, 'firstLine')); if (first !== undefined) p.firstLine = first;
    const hanging = twip(attr(ind, 'hanging')); if (hanging !== undefined) p.firstLine = -hanging;
  }
  const pb = toggle(kid(pPr, 'pageBreakBefore')); if (pb !== undefined) p.pageBreakBefore = pb;
  const kn = toggle(kid(pPr, 'keepNext')); if (kn !== undefined) p.keepNext = kn;
  const cs = toggle(kid(pPr, 'contextualSpacing')); if (cs !== undefined) p.contextualSpacing = cs;
  const numPr = kid(pPr, 'numPr');
  if (numPr) {
    const numId = attr(kid(numPr, 'numId'), 'val');
    if (numId !== undefined) p.numId = numId;
    const ilvl = attr(kid(numPr, 'ilvl'), 'val');
    if (ilvl !== undefined) p.ilvl = Number(ilvl);
  }
  const shd = attr(kid(pPr, 'shd'), 'fill');
  if (shd && /^[0-9a-f]{6}$/i.test(shd)) p.shading = shd.toUpperCase();
  const bottom = kid(kid(pPr, 'pBdr'), 'bottom');
  if (bottom && attr(bottom, 'val') !== 'none' && attr(bottom, 'val') !== 'nil') {
    const c = attr(bottom, 'color');
    p.borderBottom = { width: Number(attr(bottom, 'sz') ?? 4) / 8, color: c && c !== 'auto' ? c : '000000' };
  }
  const ps = attr(kid(pPr, 'pStyle'), 'val'); if (ps) p.styleId = ps;
  return p;
}

const clean = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/* ------------------------------------------------------------------ Styles, theme, numbering */

interface StyleDef {
  type: string;
  basedOn?: string;
  ppr: ParaProps;
  rpr: RunProps;
  borders?: { on: boolean; color: string };
}

interface NumLevel {
  start: number;
  fmt: string;
  text: string;
  ppr: ParaProps;
  rpr: RunProps;
}

class Context {
  styles = new Map<string, StyleDef>();
  defaultParaStyle?: string;
  docRPr: RunProps = {};
  docPPr: ParaProps = {};
  theme = { major: 'Calibri Light', minor: 'Calibri' };
  abstract = new Map<string, Map<number, NumLevel>>();
  nums = new Map<string, { abstractId: string; overrides: Map<number, number> }>();
  counters = new Map<string, number[]>();
  defaultTab = 36;
  /** Word compatibility mode: 15 = Word 2013+. Older modes shift tables left by their cell padding. */
  compatMode = 14;
  /** Paragraph/run properties from the enclosing table's style, applied to cell paragraphs in the default style. */
  cellStyle: { ppr: ParaProps; rpr: RunProps } | null = null;
  warnings = new Set<string>();
  /** Complex field state across runs: inside the instruction part, or showing a PAGE/NUMPAGES result. */
  field: { phase: 'instr' | 'result'; instr: string; dynamic?: 'PAGE' | 'NUMPAGES' } | null = null;

  constructor(readonly files: Record<string, Uint8Array>) {}

  text(path: string): string | undefined {
    const f = this.files[path];
    return f ? strFromU8(f) : undefined;
  }

  styleChain(id: string | undefined): StyleDef[] {
    const chain: StyleDef[] = [];
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const s = this.styles.get(id);
      if (!s) break;
      chain.unshift(s);
      id = s.basedOn;
    }
    return chain;
  }

  resolveFont(p: RunProps): string | undefined {
    if (p.font) return p.font;
    if (p.fontTheme) return this.theme[p.fontTheme];
    return undefined;
  }
}

function loadStyles(ctx: Context) {
  const theme = ctx.text('word/theme/theme1.xml');
  if (theme) {
    const doc = parseXml(theme).documentElement as El;
    const major = attr(kid(find(doc, 'majorFont'), 'latin'), 'typeface');
    const minor = attr(kid(find(doc, 'minorFont'), 'latin'), 'typeface');
    if (major) ctx.theme.major = major;
    if (minor) ctx.theme.minor = minor;
  }
  const settings = ctx.text('word/settings.xml');
  if (settings) {
    const root = parseXml(settings).documentElement as El;
    const tab = attr(find(root, 'defaultTabStop'), 'val');
    if (tab) ctx.defaultTab = Number(tab) / 20 || 36;
    for (const cs of kids(find(root, 'compat'), 'compatSetting')) {
      if (attr(cs, 'name') === 'compatibilityMode') ctx.compatMode = Number(attr(cs, 'val') ?? 15);
    }
  }
  const stylesXml = ctx.text('word/styles.xml');
  if (stylesXml) {
    const root = parseXml(stylesXml).documentElement as El;
    const defaults = kid(root, 'docDefaults');
    ctx.docRPr = readRPr(kid(kid(defaults, 'rPrDefault'), 'rPr'));
    ctx.docPPr = readPPr(kid(kid(defaults, 'pPrDefault'), 'pPr'));
    for (const s of kids(root, 'style')) {
      const id = attr(s, 'styleId');
      if (!id) continue;
      const type = attr(s, 'type') ?? 'paragraph';
      const def: StyleDef = { type, basedOn: attr(kid(s, 'basedOn'), 'val'), ppr: readPPr(kid(s, 'pPr')), rpr: readRPr(kid(s, 'rPr')) };
      const tblBorders = kid(kid(s, 'tblPr'), 'tblBorders');
      if (tblBorders) def.borders = readBorders(tblBorders);
      ctx.styles.set(id, def);
      if (type === 'paragraph' && attr(s, 'default') === '1') ctx.defaultParaStyle = id;
    }
  }
  const numbering = ctx.text('word/numbering.xml');
  if (numbering) {
    const root = parseXml(numbering).documentElement as El;
    for (const a of kids(root, 'abstractNum')) {
      const levels = new Map<number, NumLevel>();
      for (const l of kids(a, 'lvl')) {
        levels.set(Number(attr(l, 'ilvl') ?? 0), {
          start: Number(attr(kid(l, 'start'), 'val') ?? 1),
          fmt: attr(kid(l, 'numFmt'), 'val') ?? 'decimal',
          text: attr(kid(l, 'lvlText'), 'val') ?? '',
          ppr: readPPr(kid(l, 'pPr')),
          rpr: readRPr(kid(l, 'rPr')),
        });
      }
      ctx.abstract.set(attr(a, 'abstractNumId') ?? '', levels);
    }
    for (const n of kids(root, 'num')) {
      const overrides = new Map<number, number>();
      for (const o of kids(n, 'lvlOverride')) {
        const start = attr(kid(o, 'startOverride'), 'val');
        if (start !== undefined) overrides.set(Number(attr(o, 'ilvl') ?? 0), Number(start));
      }
      ctx.nums.set(attr(n, 'numId') ?? '', { abstractId: attr(kid(n, 'abstractNumId'), 'val') ?? '', overrides });
    }
  }
}

function readBorders(el: El): { on: boolean; color: string } {
  let on = false;
  let color = '000000';
  for (const b of kids(el)) {
    const v = attr(b, 'val');
    if (v && v !== 'nil' && v !== 'none') {
      on = true;
      const c = attr(b, 'color');
      if (c && c !== 'auto') color = c;
    }
  }
  return { on, color };
}

/* ------------------------------------------------------------------ List labels */

function roman(n: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

function letters(n: number): string {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    case 'none': return '';
    default: return String(n);
  }
}

/** Word bullets often use private-use characters from the Symbol/Wingdings fonts. */
function bulletText(text: string): string {
  // Geometric shapes (●○■□◆➢✓…) and Symbol/Wingdings private-use characters are not in text fonts.
  return [...text].map((c) => {
    const cp = c.codePointAt(0)!;
    if (c === '\u25CB' || c === '\u25E6') return 'o';
    if ((cp >= 0xf000 && cp <= 0xf0ff) || (cp >= 0x2190 && cp <= 0x27bf) || (cp >= 0x25a0 && cp <= 0x25ff)) return '\u2022';
    return c;
  }).join('');
}

function listLabel(ctx: Context, numId: string, ilvl: number): { text: string; level: NumLevel } | undefined {
  const num = ctx.nums.get(numId);
  if (!num || numId === '0') return undefined;
  const levels = ctx.abstract.get(num.abstractId);
  const level = levels?.get(ilvl);
  if (!levels || !level) return undefined;
  const counters = ctx.counters.get(numId) ?? [];
  const startOf = (l: number) => num.overrides.get(l) ?? levels.get(l)?.start ?? 1;
  counters[ilvl] = counters[ilvl] === undefined ? startOf(ilvl) : counters[ilvl]! + 1;
  for (let l = ilvl + 1; l < 9; l++) counters[l] = undefined as unknown as number;
  ctx.counters.set(numId, counters);
  if (level.fmt === 'bullet') return { text: bulletText(level.text), level };
  const text = level.text.replace(/%(\d)/g, (_, d: string) => {
    const l = Number(d) - 1;
    return formatNumber(counters[l] ?? startOf(l), levels.get(l)?.fmt ?? 'decimal');
  });
  return { text, level };
}

/* ------------------------------------------------------------------ Body */

interface Part {
  path: string;
  rels: Map<string, string>;
}

function loadRels(ctx: Context, partPath: string): Map<string, string> {
  const dir = partPath.slice(0, partPath.lastIndexOf('/'));
  const relsPath = `${dir}/_rels/${partPath.slice(dir.length + 1)}.rels`;
  const map = new Map<string, string>();
  const xml = ctx.text(relsPath);
  if (!xml) return map;
  for (const r of kids(parseXml(xml).documentElement as El, 'Relationship')) {
    const id = r.getAttribute('Id');
    const target = r.getAttribute('Target');
    if (!id || !target || r.getAttribute('TargetMode') === 'External') continue;
    map.set(id, target.startsWith('/') ? target.slice(1) : normalize(`${dir}/${target}`));
  }
  return map;
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

function paragraphStyle(ctx: Context, pp: ParaProps, styleId: string | undefined): { style: ParagraphStyle; runBase: RunProps } {
  const chain = ctx.styleChain(styleId ?? ctx.defaultParaStyle);
  const merged: ParaProps = { ...clean(ctx.docPPr) };
  let runBase: RunProps = { ...clean(ctx.docRPr) };
  for (const s of chain) {
    Object.assign(merged, clean(s.ppr));
    runBase = { ...runBase, ...clean(s.rpr) };
    if (s.rpr.font) delete runBase.fontTheme;
  }
  const effectiveStyle = styleId ?? ctx.defaultParaStyle;
  if (ctx.cellStyle && (effectiveStyle === ctx.defaultParaStyle || effectiveStyle === undefined)) {
    // Word lets the table style override Normal inside cells (e.g. Table Grid removes spacing after).
    Object.assign(merged, clean(ctx.cellStyle.ppr));
    runBase = { ...runBase, ...clean(ctx.cellStyle.rpr) };
  }
  Object.assign(merged, clean(pp));
  const style: ParagraphStyle = {
    align: merged.align ?? 'left',
    spaceBefore: merged.spaceBefore ?? 0,
    spaceAfter: merged.spaceAfter ?? 0,
    line: merged.line ?? { rule: 'auto', value: 1 },
    indentLeft: merged.indentLeft ?? 0,
    indentRight: merged.indentRight ?? 0,
    firstLine: merged.firstLine ?? 0,
    pageBreakBefore: merged.pageBreakBefore ?? false,
    keepNext: merged.keepNext ?? false,
    contextualSpacing: merged.contextualSpacing ?? false,
    styleId: styleId ?? ctx.defaultParaStyle,
    shading: merged.shading,
    borderBottom: merged.borderBottom,
  };
  return { style, runBase };
}

function finalizeRun(ctx: Context, base: RunProps, direct: RunProps): RunStyle {
  let props: RunProps = { ...base };
  const charStyle = direct.charStyle;
  for (const s of ctx.styleChain(charStyle)) {
    props = { ...props, ...clean(s.rpr) };
    if (s.rpr.font) delete props.fontTheme;
  }
  props = { ...props, ...clean(direct) };
  if (direct.font) delete props.fontTheme;
  // Word's built-in fallback when nothing sets a font or size: Times New Roman, 10 pt.
  const font = ctx.resolveFont(props) ?? 'Times New Roman';
  const autoColor = !props.color || props.color === 'auto';
  return {
    font,
    size: props.size ?? 10,
    bold: props.bold ?? false,
    italic: props.italic ?? false,
    underline: props.underline ?? false,
    strike: props.strike ?? false,
    color: autoColor ? '000000' : props.color!,
    autoColor,
    highlight: props.highlight,
    vertAlign: props.vertAlign,
    caps: props.caps ?? false,
  };
}

function readImage(ctx: Context, part: Part, drawing: El): Inline | undefined {
  const extent = find(drawing, 'extent');
  const blip = find(drawing, 'blip');
  if (find(drawing, 'txbx') || find(drawing, 'txbxContent')) ctx.warnings.add('TEXTBOX_SKIPPED');
  if (!blip) return undefined;
  if (kid(drawing, 'anchor')) ctx.warnings.add('FLOATING_IMAGE_INLINED');
  const target = part.rels.get(rAttr(blip, 'embed') ?? '');
  const bytes = target ? ctx.files[target] : undefined;
  if (!bytes) return undefined;
  const format = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : undefined;
  if (!format) {
    ctx.warnings.add('UNSUPPORTED_IMAGE_FORMAT');
    return undefined;
  }
  const cx = Number(extent?.getAttribute('cx') ?? 0) / 12700;
  const cy = Number(extent?.getAttribute('cy') ?? 0) / 12700;
  if (!cx || !cy) return undefined;
  return { kind: 'image', bytes, format, width: cx, height: cy };
}

function readRunContent(ctx: Context, part: Part, r: El, base: RunProps, out: Inline[]) {
  const style = finalizeRun(ctx, base, readRPr(kid(r, 'rPr')));
  if (style.size === 0) return; // hidden text
  const push = (text: string) => {
    if (ctx.field?.phase === 'instr') return;
    if (ctx.field?.phase === 'result' && ctx.field.dynamic) return; // replaced by the live value
    if (!text) return;
    if (style.caps) text = text.toUpperCase();
    const last = out[out.length - 1];
    if (last?.kind === 'text' && last.style === style) last.text += text;
    else out.push({ kind: 'text', text, style });
  };
  for (const c of kids(r)) {
    switch (c.localName) {
      case 't': push(c.textContent ?? ''); break;
      case 'tab': if (!ctx.field || ctx.field.phase === 'result') out.push({ kind: 'tab', style }); break;
      case 'br': {
        const type = attr(c, 'type');
        if (type === 'page') out.push({ kind: 'break', style: { ...style, size: -1 } });
        else out.push({ kind: 'break', style });
        break;
      }
      case 'cr': out.push({ kind: 'break', style }); break;
      case 'noBreakHyphen': push('-'); break;
      case 'softHyphen': break;
      case 'sym': push('•'); break;
      case 'fldChar': {
        const t = attr(c, 'fldCharType');
        if (t === 'begin') ctx.field = { phase: 'instr', instr: '' };
        else if (t === 'separate' && ctx.field) {
          ctx.field.phase = 'result';
          const instr = ctx.field.instr.trim().split(/\s+/)[0]?.toUpperCase();
          if (instr === 'PAGE' || instr === 'NUMPAGES') {
            ctx.field.dynamic = instr;
            out.push({ kind: 'text', text: `\u0001${instr}\u0001`, style });
          }
        } else if (t === 'end') ctx.field = null;
        break;
      }
      case 'instrText': if (ctx.field) ctx.field.instr += c.textContent ?? ''; break;
      case 'drawing': {
        const img = readImage(ctx, part, c);
        if (img) out.push(img);
        break;
      }
      case 'pict': ctx.warnings.add('LEGACY_SHAPE_SKIPPED'); break;
      case 'footnoteReference': case 'endnoteReference': ctx.warnings.add('NOTES_SKIPPED'); break;
      case 'AlternateContent': {
        const choice = kid(c, 'Choice') ?? kid(c, 'Fallback');
        const drawing = choice && find(choice, 'drawing');
        if (drawing) { const img = readImage(ctx, part, drawing); if (img) out.push(img); }
        break;
      }
      default: break;
    }
  }
}

function readInlines(ctx: Context, part: Part, container: El, base: RunProps, out: Inline[]) {
  for (const c of kids(container)) {
    switch (c.localName) {
      case 'r': readRunContent(ctx, part, c, base, out); break;
      case 'hyperlink': case 'ins': case 'smartTag': case 'customXml': case 'dir': case 'bdo':
        readInlines(ctx, part, c, base, out); break;
      case 'sdt': readInlines(ctx, part, kid(c, 'sdtContent') ?? c, base, out); break;
      case 'fldSimple': {
        const instr = (attr(c, 'instr') ?? '').trim().split(/\s+/)[0]?.toUpperCase();
        if (instr === 'PAGE' || instr === 'NUMPAGES') {
          const r = find(c, 'r');
          out.push({ kind: 'text', text: `\u0001${instr}\u0001`, style: finalizeRun(ctx, base, readRPr(kid(r, 'rPr'))) });
        } else readInlines(ctx, part, c, base, out);
        break;
      }
      case 'del': case 'moveFrom': break;
      default: break;
    }
  }
}

function readParagraph(ctx: Context, part: Part, p: El): Paragraph {
  const pPr = kid(p, 'pPr');
  const direct = readPPr(pPr);
  const styleId = direct.styleId;
  // Numbering may come from the paragraph or from its style.
  let numId = direct.numId;
  let ilvl = direct.ilvl;
  if (numId === undefined) {
    for (const s of ctx.styleChain(styleId ?? ctx.defaultParaStyle)) {
      if (s.ppr.numId !== undefined) { numId = s.ppr.numId; ilvl = s.ppr.ilvl ?? ilvl; }
    }
  }
  const label = numId !== undefined ? listLabel(ctx, numId, ilvl ?? 0) : undefined;
  // Indents: style < numbering level < direct formatting.
  const withNumbering: ParaProps = { ...clean(label?.level.ppr ?? {}), ...clean(direct) };
  const { style, runBase } = paragraphStyle(ctx, withNumbering, styleId);
  if (label && direct.indentLeft === undefined && label.level.ppr.indentLeft !== undefined) {
    style.indentLeft = label.level.ppr.indentLeft;
    style.firstLine = label.level.ppr.firstLine ?? style.firstLine;
  }
  const paraMark = readRPr(kid(pPr, 'rPr'));
  const inlines: Inline[] = [];
  readInlines(ctx, part, p, runBase, inlines);
  const para: Paragraph = { type: 'paragraph', style, inlines };
  if (label?.text) {
    const labelProps = { ...runBase, ...clean(paraMark), ...clean(label.level.rpr) };
    const st = finalizeRun(ctx, labelProps, {});
    if (label.level.fmt === 'bullet') {
      // Symbol/Wingdings bullets render larger than a text bullet; compensate a little.
      const fromSymbolFont = /symbol|wingdings/i.test(label.level.rpr.font ?? '');
      st.font = ctx.resolveFont(runBase) ?? ctx.theme.minor;
      if (fromSymbolFont && label.text === '\u2022') st.size *= 1.3;
    }
    para.label = { text: label.text, style: st };
  }
  // An empty paragraph still takes one line in the font of its paragraph mark.
  if (inlines.length === 0) para.inlines.push({ kind: 'text', text: '', style: finalizeRun(ctx, runBase, paraMark) });
  return para;
}

function isDark(hex: string): boolean {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Word draws "automatic" text color as white on dark shading. */
function whitenAuto(blocks: Block[]) {
  for (const b of blocks) {
    if (b.type !== 'paragraph') continue;
    for (const i of b.inlines) if (i.kind !== 'image' && i.style.autoColor) i.style = { ...i.style, color: 'FFFFFF' };
    if (b.label?.style.autoColor) b.label.style = { ...b.label.style, color: 'FFFFFF' };
  }
}

function readTable(ctx: Context, part: Part, tbl: El): Table {
  const tblPr = kid(tbl, 'tblPr');
  const styleId = attr(kid(tblPr, 'tblStyle'), 'val');
  let borders = { on: false, color: '000000' };
  const tableStyle = { ppr: {} as ParaProps, rpr: {} as RunProps };
  for (const s of ctx.styleChain(styleId)) {
    if (s.borders) borders = s.borders;
    Object.assign(tableStyle.ppr, clean(s.ppr));
    Object.assign(tableStyle.rpr, clean(s.rpr));
  }
  const outerCellStyle = ctx.cellStyle;
  ctx.cellStyle = tableStyle;
  const direct = kid(tblPr, 'tblBorders');
  if (direct) borders = readBorders(direct);
  const columns = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => twip(attr(g, 'w')) ?? 0);
  const mar = kid(tblPr, 'tblCellMar');
  const pad = (side: string, alt: string, d: number) => twip(attr(kid(mar, side) ?? kid(mar, alt), 'w')) ?? d;
  const rows: TableRow[] = [];
  for (const tr of kids(tbl, 'tr')) {
    const trPr = kid(tr, 'trPr');
    const cells: TableCell[] = [];
    for (const tc of kids(tr).filter((c) => c.localName === 'tc' || c.localName === 'sdt')) {
      const cell = tc.localName === 'sdt' ? find(tc, 'tc') : tc;
      if (!cell) continue;
      const tcPr = kid(cell, 'tcPr');
      const vm = kid(tcPr, 'vMerge');
      const shading = attr(kid(tcPr, 'shd'), 'fill');
      const cellBlocks = readBlocks(ctx, part, cell);
      const tcBorders = kid(tcPr, 'tcBorders');
      let cellBorders: TableCell['borders'];
      if (tcBorders) {
        cellBorders = {};
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
          const el = kid(tcBorders, side) ?? kid(tcBorders, side === 'left' ? 'start' : side === 'right' ? 'end' : side);
          if (!el) continue;
          const v = attr(el, 'val');
          const c = attr(el, 'color');
          cellBorders[side] = !v || v === 'nil' || v === 'none' ? null : { width: Math.max(0.25, Number(attr(el, 'sz') ?? 4) / 8), color: c && c !== 'auto' ? c : '000000' };
        }
      }
      if (shading && /^[0-9a-f]{6}$/i.test(shading) && isDark(shading)) whitenAuto(cellBlocks);
      cells.push({
        blocks: cellBlocks,
        span: Number(attr(kid(tcPr, 'gridSpan'), 'val') ?? 1),
        vMerge: vm ? (attr(vm, 'val') === 'restart' ? 'restart' : 'continue') : undefined,
        shading: shading && /^[0-9a-f]{6}$/i.test(shading) ? shading.toUpperCase() : undefined,
        vAlign: (attr(kid(tcPr, 'vAlign'), 'val') as 'top' | 'center' | 'bottom') ?? 'top',
        borders: cellBorders,
      });
    }
    rows.push({ cells, minHeight: twip(attr(kid(trPr, 'trHeight'), 'val')) ?? 0, header: !!toggle(kid(trPr, 'tblHeader')) });
  }
  ctx.cellStyle = outerCellStyle;
  return {
    type: 'table',
    columns,
    rows,
    borders: borders.on,
    borderColor: borders.color,
    indent: (twip(attr(kid(tblPr, 'tblInd'), 'w')) ?? 0) - (ctx.compatMode < 15 ? pad('left', 'start', 5.4) : 0),
    cellPadding: { top: pad('top', 'top', 0), bottom: pad('bottom', 'bottom', 0), left: pad('left', 'start', 5.4), right: pad('right', 'end', 5.4) },
  };
}

function readBlocks(ctx: Context, part: Part, container: El): Block[] {
  const blocks: Block[] = [];
  for (const c of kids(container)) {
    if (c.localName === 'p') {
      blocks.push(readParagraph(ctx, part, c));
      // A section break inside a paragraph starts a new page (next-page sections).
      const sect = kid(kid(c, 'pPr'), 'sectPr');
      if (sect && attr(kid(sect, 'type'), 'val') !== 'continuous') blocks.push({ type: 'pageBreak' });
    } else if (c.localName === 'tbl') blocks.push(readTable(ctx, part, c));
    else if (c.localName === 'sdt') blocks.push(...readBlocks(ctx, part, kid(c, 'sdtContent') ?? c));
    else if (c.localName === 'customXml') blocks.push(...readBlocks(ctx, part, c));
  }
  return blocks;
}

function readPage(sect: El | undefined): PageSetup & { header: number; footer: number } {
  const pgSz = kid(sect, 'pgSz');
  const pgMar = kid(sect, 'pgMar');
  const w = twip(attr(pgSz, 'w')) ?? 612;
  const h = twip(attr(pgSz, 'h')) ?? 792;
  const landscape = attr(pgSz, 'orient') === 'landscape';
  return {
    width: landscape ? Math.max(w, h) : w,
    height: landscape ? Math.min(w, h) : h,
    margin: {
      top: Math.abs(twip(attr(pgMar, 'top')) ?? 72),
      right: twip(attr(pgMar, 'right')) ?? 72,
      bottom: Math.abs(twip(attr(pgMar, 'bottom')) ?? 72),
      left: (twip(attr(pgMar, 'left')) ?? 72) + (twip(attr(pgMar, 'gutter')) ?? 0),
    },
    header: twip(attr(pgMar, 'header')) ?? 36,
    footer: twip(attr(pgMar, 'footer')) ?? 36,
  };
}

export interface ParsedDocx extends DocModel {
  header?: Block[];
  footer?: Block[];
  headerDistance: number;
  footerDistance: number;
}

export class DocxError extends Error {
  constructor(readonly code: 'NOT_DOCX' | 'ENCRYPTED_DOCX' | 'CORRUPT_DOCX', message?: string) {
    super(message ?? code);
    this.name = 'DocxError';
  }
}

/** True when the bytes look like a Word .docx package. */
export function isDocx(bytes: Uint8Array): boolean {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) return false;
  try {
    let found = false;
    unzipSync(bytes, { filter: (f) => { if (f.name === 'word/document.xml') found = true; return false; } });
    return found;
  } catch {
    return false;
  }
}

export function parseDocx(bytes: Uint8Array): ParsedDocx {
  // Encrypted Office files are OLE containers, not zips.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new DocxError('ENCRYPTED_DOCX');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (err) {
    throw new DocxError('CORRUPT_DOCX', String((err as Error).message));
  }
  if (!files['word/document.xml']) throw new DocxError('NOT_DOCX');
  const ctx = new Context(files);
  loadStyles(ctx);
  const docPart: Part = { path: 'word/document.xml', rels: loadRels(ctx, 'word/document.xml') };
  const body = kid(parseXml(ctx.text(docPart.path)!).documentElement as El, 'body');
  if (!body) throw new DocxError('CORRUPT_DOCX', 'missing body');
  const blocks = readBlocks(ctx, docPart, body);
  const sect = kid(body, 'sectPr');
  const page = readPage(sect);

  const readHf = (kind: 'header' | 'footer'): Block[] | undefined => {
    const ref = kids(sect, `${kind}Reference`).find((r) => (attr(r, 'type') ?? 'default') === 'default');
    const target = ref ? docPart.rels.get(rAttr(ref, 'id') ?? '') : undefined;
    const xml = target ? ctx.text(target) : undefined;
    if (!target || !xml) return undefined;
    ctx.field = null;
    const part: Part = { path: target, rels: loadRels(ctx, target) };
    const content = readBlocks(ctx, part, parseXml(xml).documentElement as El);
    const hasText = content.some((b) => b.type !== 'paragraph' || b.inlines.some((i) => i.kind !== 'text' || i.text.trim()));
    return hasText ? content : undefined;
  };
  if (kid(sect, 'titlePg')) ctx.warnings.add('FIRST_PAGE_HEADER_IGNORED');

  return {
    page: { width: page.width, height: page.height, margin: page.margin },
    blocks,
    defaultTab: ctx.defaultTab,
    warnings: [...ctx.warnings],
    header: readHf('header'),
    footer: readHf('footer'),
    headerDistance: page.header,
    footerDistance: page.footer,
  };
}
