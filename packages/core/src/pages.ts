import { HilvanaError } from './errors.js';

/**
 * Parses a 1-based page range expression into sorted, unique, 0-based indices.
 *
 * Supported syntax (comma-separated): `3`, `2-5`, `last`, `last-2` (the third
 * from the end), `4-last`, `odd`, `even`, `all`.
 *
 * Order is preserved for reordering use cases when `keepOrder` is true.
 */
export function parsePageRange(expr: string, pageCount: number, keepOrder = false): number[] {
  if (pageCount < 1) throw new HilvanaError('EMPTY_DOCUMENT', { pageCount });
  const out: number[] = [];
  const tokens = expr.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) throw new HilvanaError('INVALID_RANGE', { expr });

  const resolve = (tok: string): number => {
    if (tok === 'last') return pageCount;
    const m = /^last-(\d+)$/.exec(tok);
    if (m) return pageCount - Number(m[1]);
    if (/^\d+$/.test(tok)) return Number(tok);
    throw new HilvanaError('INVALID_RANGE', { expr });
  };

  for (const tok of tokens) {
    if (tok === 'all') {
      for (let i = 1; i <= pageCount; i++) out.push(i);
      continue;
    }
    if (tok === 'odd' || tok === 'even') {
      for (let i = tok === 'odd' ? 1 : 2; i <= pageCount; i += 2) out.push(i);
      continue;
    }
    // A range "a-b" where b may itself be "last" or "last-n".
    const range = /^(\d+|last(?:-\d+)?)-(\d+|last(?:-\d+)?)$/.exec(tok);
    if (range && !/^last-\d+$/.test(tok)) {
      const a = resolve(range[1]!);
      const b = resolve(range[2]!);
      if (a > b) throw new HilvanaError('INVALID_RANGE', { expr });
      for (let i = a; i <= b; i++) out.push(i);
      continue;
    }
    out.push(resolve(tok));
  }

  for (const n of out) {
    if (n < 1 || n > pageCount) throw new HilvanaError('PAGE_OUT_OF_RANGE', { page: n, pageCount });
  }
  const zeroBased = out.map((n) => n - 1);
  return keepOrder ? zeroBased : [...new Set(zeroBased)].sort((a, b) => a - b);
}
