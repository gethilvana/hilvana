/**
 * A small reader and writer for PDF content streams (the drawing instructions of a page).
 * Each operator keeps the byte span it came from, so a stream can be rewritten by copying the
 * operators that do not change and serializing only the ones that do.
 */

export type Operand =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'string'; value: Uint8Array }
  | { type: 'array'; value: Operand[] }
  | { type: 'dict'; value: Map<string, Operand> }
  | { type: 'bool'; value: boolean }
  | { type: 'null' };

export interface Op {
  /** The operator, e.g. "Tj", "cm", "Do". Inline images are a single "BI" operator. */
  op: string;
  args: Operand[];
  /** Byte span of the operator and its operands in the source. */
  start: number;
  end: number;
  /** Inline images only: the image dictionary. */
  inline?: Map<string, Operand>;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (c: number) => !WS.has(c) && !DELIM.has(c);

export class ContentSyntaxError extends Error {}

/** Parses a content stream into operators. Throws ContentSyntaxError on input it cannot read safely. */
export function parseContent(buf: Uint8Array): Op[] {
  let i = 0;
  const n = buf.length;
  const ops: Op[] = [];
  let args: Operand[] = [];
  let argStart = -1;

  const skipSpace = () => {
    while (i < n) {
      const c = buf[i]!;
      if (WS.has(c)) i++;
      else if (c === 0x25) { while (i < n && buf[i] !== 0x0a && buf[i] !== 0x0d) i++; } // comment
      else break;
    }
  };

  const readWord = () => {
    const s = i;
    while (i < n && isRegular(buf[i]!)) i++;
    return String.fromCharCode(...buf.subarray(s, i));
  };

  const readLiteral = (): Uint8Array => {
    i++; // (
    const out: number[] = [];
    let depth = 1;
    while (i < n) {
      const c = buf[i++]!;
      if (c === 0x5c) {
        const e = buf[i++];
        if (e === undefined) break;
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (e in map) out.push(map[e]!);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let k = 0; k < 2 && i < n && buf[i]! >= 0x30 && buf[i]! <= 0x37; k++) v = v * 8 + (buf[i++]! - 0x30);
          out.push(v & 0xff);
        } else if (e === 0x0d) { if (buf[i] === 0x0a) i++; } // line continuation
        else if (e !== 0x0a) out.push(e);
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29 && --depth === 0) return Uint8Array.from(out);
      out.push(c);
    }
    throw new ContentSyntaxError('unterminated string');
  };

  const readHex = (): Uint8Array => {
    i++; // <
    const digits: number[] = [];
    while (i < n && buf[i] !== 0x3e) {
      const c = buf[i++]!;
      if (WS.has(c)) continue;
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
      if (v < 0) throw new ContentSyntaxError('bad hex string');
      digits.push(v);
    }
    i++; // >
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = (digits[2 * k]! << 4) | digits[2 * k + 1]!;
    return out;
  };

  const readOperand = (): Operand | string => {
    skipSpace();
    const c = buf[i]!;
    if (c === 0x2f) { i++; return { type: 'name', value: readWord() }; }
    if (c === 0x28) return { type: 'string', value: readLiteral() };
    if (c === 0x3c && buf[i + 1] === 0x3c) {
      i += 2;
      const dict = new Map<string, Operand>();
      for (;;) {
        skipSpace();
        if (buf[i] === 0x3e && buf[i + 1] === 0x3e) { i += 2; break; }
        if (i >= n) throw new ContentSyntaxError('unterminated dictionary');
        const key = readOperand();
        if (typeof key === 'string' || key.type !== 'name') throw new ContentSyntaxError('bad dictionary key');
        const val = readOperand();
        if (typeof val === 'string') throw new ContentSyntaxError('bad dictionary value');
        dict.set(key.value, val);
      }
      return { type: 'dict', value: dict };
    }
    if (c === 0x3c) return { type: 'string', value: readHex() };
    if (c === 0x5b) {
      i++;
      const items: Operand[] = [];
      for (;;) {
        skipSpace();
        if (buf[i] === 0x5d) { i++; break; }
        if (i >= n) throw new ContentSyntaxError('unterminated array');
        const v = readOperand();
        if (typeof v === 'string') throw new ContentSyntaxError(`operator ${v} inside an array`);
        items.push(v);
      }
      return { type: 'array', value: items };
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) { i++; throw new ContentSyntaxError('unexpected delimiter'); }
    const word = readWord();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { type: 'number', value: Number(word) };
    if (word === 'true' || word === 'false') return { type: 'bool', value: word === 'true' };
    if (word === 'null') return { type: 'null' };
    return word; // an operator
  };

  while (true) {
    skipSpace();
    if (i >= n) break;
    const start = i;
    const tok = readOperand();
    if (typeof tok !== 'string') {
      if (argStart < 0) argStart = start;
      args.push(tok);
      continue;
    }
    if (tok === '') throw new ContentSyntaxError('empty token');
    const opStart = argStart < 0 ? start : argStart;
    if (tok === 'BI') {
      // Inline image: key/value pairs, ID, binary data, EI.
      const dict = new Map<string, Operand>();
      for (;;) {
        skipSpace();
        const save = i;
        const key = readOperand();
        if (key === 'ID') break;
        if (typeof key === 'string' || key.type !== 'name') { i = save; throw new ContentSyntaxError('bad inline image'); }
        const val = readOperand();
        if (typeof val === 'string') throw new ContentSyntaxError('bad inline image value');
        dict.set(key.value, val);
      }
      i++; // single whitespace after ID
      // EI preceded by whitespace and followed by whitespace or the end.
      let end = -1;
      for (let k = i; k < n - 1; k++) {
        if (buf[k] === 0x45 && buf[k + 1] === 0x49 && WS.has(buf[k - 1]!) && (k + 2 >= n || WS.has(buf[k + 2]!))) { end = k + 2; break; }
      }
      if (end < 0) throw new ContentSyntaxError('unterminated inline image');
      i = end;
      ops.push({ op: 'BI', args: [], start: opStart, end, inline: dict });
    } else {
      ops.push({ op: tok, args, start: opStart, end: i });
    }
    args = [];
    argStart = -1;
  }
  if (args.length) throw new ContentSyntaxError('operands without an operator');
  return ops;
}

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e5) / 1e5));
const hex = (b: Uint8Array) => `<${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}>`;

export function serializeOperand(o: Operand): string {
  switch (o.type) {
    case 'number': return num(o.value);
    case 'name': return `/${o.value}`;
    case 'string': return hex(o.value);
    case 'array': return `[${o.value.map(serializeOperand).join(' ')}]`;
    case 'dict': return `<<${[...o.value].map(([k, v]) => `/${k} ${serializeOperand(v)}`).join(' ')}>>`;
    case 'bool': return String(o.value);
    case 'null': return 'null';
  }
}

export const serializeOp = (op: string, args: Operand[]) => (args.length ? `${args.map(serializeOperand).join(' ')} ${op}` : op);

/**
 * Rebuilds a content stream: operators listed in `replace` are written as given (an empty list
 * drops them), and every other operator is copied byte for byte from the source.
 */
export function rewriteContent(src: Uint8Array, ops: Op[], replace: Map<Op, string[]>, prefix = '', suffix = ''): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [enc.encode(prefix)];
  for (const op of ops) {
    const r = replace.get(op);
    if (r === undefined) parts.push(src.subarray(op.start, op.end), enc.encode('\n'));
    else if (r.length) parts.push(enc.encode(r.join('\n') + '\n'));
  }
  parts.push(enc.encode(suffix));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
