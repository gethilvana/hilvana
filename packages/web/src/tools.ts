import type { Lang, Recipe } from '@hilvana/recipes';
import type { ToolId } from './i18n';
import type { Kind } from './protocol';

export type Group = 'arrange' | 'convert' | 'mark' | 'reduce' | 'automate';
export type Accept = 'docs' | 'word' | 'images';
export type Anchor = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'center';
export type PagesChoice = { mode: 'all' | 'first' | 'last' | 'custom'; custom: string };

export interface Tool {
  id: ToolId;
  group: Group;
  accept: Accept;
  /** Single-file tools replace the file when a new one is added. */
  single: boolean;
}

export const TOOLS: Tool[] = [
  { id: 'merge', group: 'arrange', accept: 'docs', single: false },
  { id: 'pages', group: 'arrange', accept: 'docs', single: true },
  { id: 'split', group: 'arrange', accept: 'docs', single: true },
  { id: 'rotate', group: 'arrange', accept: 'docs', single: true },
  { id: 'word', group: 'convert', accept: 'word', single: false },
  { id: 'images', group: 'convert', accept: 'images', single: false },
  { id: 'sign', group: 'mark', accept: 'docs', single: true },
  { id: 'certify', group: 'mark', accept: 'docs', single: true },
  { id: 'stamp', group: 'mark', accept: 'docs', single: true },
  { id: 'number', group: 'mark', accept: 'docs', single: true },
  { id: 'watermark', group: 'mark', accept: 'docs', single: true },
  { id: 'compress', group: 'reduce', accept: 'docs', single: true },
  { id: 'metadata', group: 'reduce', accept: 'docs', single: true },
  { id: 'protect', group: 'reduce', accept: 'docs', single: true },
  { id: 'recipes', group: 'automate', accept: 'docs', single: false },
];

export const GROUPS: Group[] = ['arrange', 'convert', 'mark', 'reduce', 'automate'];

export function accepts(tool: Tool, kind: Kind): boolean {
  if (tool.accept === 'docs') return kind === 'pdf' || kind === 'word';
  if (tool.accept === 'word') return kind === 'word';
  return kind === 'image';
}

export const FILE_INPUT_ACCEPT: Record<Accept, string> = {
  docs: '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  word: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  images: 'image/png,image/jpeg,.png,.jpg,.jpeg',
};

export interface Options {
  pagesOrder: number[] | null; // pages tool: kept pages, in order (1-based); null = unchanged
  rotatePages: number[]; // rotate tool: chosen pages; empty = all
  angle: 90 | 180 | 270;
  splitMode: 'each' | 'ranges';
  ranges: string;
  pageSize: 'image' | 'a4' | 'letter';
  signPages: PagesChoice;
  signAnchor: Anchor;
  signWidth: number;
  stampText: string;
  stampPages: PagesChoice;
  stampAnchor: Anchor;
  stampSize: number;
  numberFormat: string;
  numberAnchor: Anchor;
  watermarkText: string;
  watermarkOpacity: number;
  level: 'balanced' | 'strong' | 'max' | 'lossless' | 'target';
  targetMB: number;
  certVisible: boolean;
  certReason: string;
  certLocation: string;
  allowPrint: boolean;
  allowCopy: boolean;
  allowModify: boolean;
}

export function defaultOptions(s: { stampDefault: string; numberDefault: string; watermarkDefault: string }): Options {
  return {
    pagesOrder: null,
    rotatePages: [],
    angle: 90,
    splitMode: 'each',
    ranges: '',
    pageSize: 'image',
    signPages: { mode: 'last', custom: '' },
    signAnchor: 'bottom-right',
    signWidth: 150,
    stampText: s.stampDefault,
    stampPages: { mode: 'first', custom: '' },
    stampAnchor: 'top-right',
    stampSize: 11,
    numberFormat: s.numberDefault,
    numberAnchor: 'bottom-center',
    watermarkText: s.watermarkDefault,
    watermarkOpacity: 0.15,
    level: 'balanced',
    targetMB: 2,
    certVisible: true,
    certReason: '',
    certLocation: '',
    allowPrint: true,
    allowCopy: true,
    allowModify: true,
  };
}

export function pagesExpr(p: PagesChoice): string | undefined {
  if (p.mode === 'all') return 'all';
  if (p.mode === 'first') return '1';
  if (p.mode === 'last') return 'last';
  return p.custom.trim() || undefined;
}

/** The ranges typed for "split by ranges" ("1-3; 4-last"), or undefined for one file per page. */
export function splitRanges(o: Pick<Options, 'splitMode' | 'ranges'>): string[] | undefined {
  if (o.splitMode !== 'ranges') return undefined;
  const ranges = o.ranges.split(';').map((r) => r.trim()).filter(Boolean);
  return ranges.length ? ranges : undefined;
}

/** Compacts [1,2,3,5,7,8] into "1-3,5,7-8" for readable recipes. */
export function compactRange(pages: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j + 1;
  }
  return parts.join(',');
}

const SUFFIX: Record<Lang, Partial<Record<ToolId, string>>> = {
  es: { merge: 'unido', pages: 'paginas', rotate: 'girado', images: 'imagenes', sign: 'firmado', stamp: 'sellado', number: 'numerado', watermark: 'marca-de-agua', compress: 'comprimido', metadata: 'limpio', certify: 'firmado-digital', protect: 'protegido' },
  en: { merge: 'merged', pages: 'pages', rotate: 'rotated', images: 'images', sign: 'signed', stamp: 'stamped', number: 'numbered', watermark: 'watermarked', compress: 'compressed', metadata: 'clean', certify: 'digitally-signed', protect: 'protected' },
};

/** Names of the extra inputs some tools use, and the new password for "protect" (never kept in Options). */
export interface Refs {
  signature?: string;
  certificate?: string;
  password?: string;
}

/** The recipe a tool runs: the same JSON the CLI, the MCP server and agents use. */
export function buildRecipe(tool: ToolId, o: Options, names: string[], lang: Lang, refs: Refs = {}): Recipe {
  const signatureName = refs.signature ?? 'firma.png';
  const out = (suffix?: string) => ({ filename: suffix ? `{name}-${suffix}` : '{name}' });
  const suffix = SUFFIX[lang][tool];
  const base = (steps: Recipe['steps']): Recipe => ({ version: 1, steps, output: out(suffix) });
  switch (tool) {
    case 'merge': return base([{ op: 'merge', files: names }]);
    // The same recipe converts any single Word file, so it applies to each document of a batch.
    case 'word': return { version: 1, steps: [{ op: 'merge' }], output: out() };
    case 'images': return base([{ op: 'fromImages', files: names, pageSize: o.pageSize }]);
    case 'pages': return base([{ op: 'select', pages: compactRange(o.pagesOrder ?? []) }]);
    case 'rotate': return base([{ op: 'rotate', angle: o.angle, ...(o.rotatePages.length ? { pages: compactRange([...o.rotatePages].sort((a, b) => a - b)) } : {}) }]);
    case 'sign': return base([{ op: 'sign', image: signatureName, pages: pagesExpr(o.signPages), anchor: o.signAnchor, width: o.signWidth }]);
    case 'stamp': return base([{ op: 'stampText', text: o.stampText, pages: pagesExpr(o.stampPages), anchor: o.stampAnchor, size: o.stampSize }]);
    case 'number': return base([{ op: 'numberPages', format: o.numberFormat, anchor: o.numberAnchor }]);
    case 'watermark': return base([{ op: 'watermark', text: o.watermarkText, opacity: o.watermarkOpacity }]);
    case 'compress': return base([o.level === 'target'
      ? { op: 'compress', targetBytes: Math.round(o.targetMB * 1024 * 1024) }
      : { op: 'compress', level: o.level }]);
    case 'metadata': return base([{ op: 'stripMetadata' }]);
    case 'certify': return base([{
      op: 'signDigital',
      certificate: refs.certificate ?? 'certificado.p12',
      ...(o.certVisible ? {} : { visible: false }),
      ...(o.certReason.trim() ? { reason: o.certReason.trim() } : {}),
      ...(o.certLocation.trim() ? { location: o.certLocation.trim() } : {}),
    }]);
    case 'protect': return base([{
      op: 'protect',
      ...(refs.password ? { password: refs.password } : {}),
      ...(o.allowPrint ? {} : { allowPrint: false }),
      ...(o.allowCopy ? {} : { allowCopy: false }),
      ...(o.allowModify ? {} : { allowModify: false }),
    }]);
    case 'recipes': throw new Error('Saved recipes are run as saved, not built from options.');
    case 'split': {
      const ranges = splitRanges(o);
      return { version: 1, steps: [{ op: 'split', ...(ranges ? { ranges } : {}) }], output: out() };
    }
  }
}
