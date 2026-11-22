/**
 * The content-stream parser under redaction and the OCR text layer. A mistake here either leaks
 * text (a string read wrong is not matched) or damages the page (an operator rewritten wrong), so
 * every syntax the PDF spec allows in a content stream gets a case.
 */
import { describe, expect, it } from 'vitest';
import { parseContent, rewriteContent, serializeOp, ContentSyntaxError, type Operand } from '../src/content';

const enc = (s: string) => new TextEncoder().encode(s);
const latin = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const str = (o: Operand | undefined) => (o && typeof o !== 'string' && o.type === 'string' ? String.fromCharCode(...o.value) : undefined);

describe('parseContent', () => {
  it('reads literal strings with every escape, nested parentheses and line continuations', () => {
    const ops = parseContent(latin('(a\\(b\\)c) Tj (x(y)z) Tj (\\n\\r\\t\\b\\f\\\\) Tj (\\101\\102C\\7) Tj (uno\\\r\ndos) Tj (\\q) Tj'));
    expect(ops.map((o) => o.op)).toEqual(['Tj', 'Tj', 'Tj', 'Tj', 'Tj', 'Tj']);
    expect(ops.map((o) => str(o.args[0]))).toEqual(['a(b)c', 'x(y)z', '\n\r\t\b\f\\', 'ABC\x07', 'unodos', 'q']);
  });

  it('reads hex strings, odd length included, and arrays with kerning', () => {
    const [hex, odd, tj] = parseContent(enc('<48 6f6C61> Tj <414> Tj [(Ho) -120 (la) 3.5] TJ'));
    expect(str(hex!.args[0])).toBe('Hola');
    expect(str(odd!.args[0])).toBe('A@'); // a missing last digit counts as 0
    const arr = tj!.args[0];
    expect(arr && typeof arr !== 'string' && arr.type === 'array' ? arr.value.map((v) => (v.type === 'number' ? v.value : str(v))) : []).toEqual(['Ho', -120, 'la', 3.5]);
  });

  it('reads dictionaries in marked content and keeps names, booleans and comments apart', () => {
    const ops = parseContent(enc('% a comment (not a string\n/Span <</ActualText (secreto) /MCID 3 /Flag true>> BDC EMC /P0 gs'));
    expect(ops.map((o) => o.op)).toEqual(['BDC', 'EMC', 'gs']);
    const dict = ops[0]!.args[1];
    expect(dict && typeof dict !== 'string' && dict.type === 'dict' ? str(dict.value.get('ActualText')) : undefined).toBe('secreto');
  });

  it('skips inline images whole, even when the binary data holds bytes that look like operators', () => {
    const data = latin('xx EI) Tj ( \x00\xff');
    const src = new Uint8Array([...enc('q 10 0 0 10 50 50 cm BI /W 2 /H 2 /BPC 8 /CS /G ID '), ...data, ...enc(' EI Q (after) Tj')]);
    const ops = parseContent(src);
    expect(ops.map((o) => o.op)[0]).toBe('q');
    const bi = ops.find((o) => o.op === 'BI')!;
    expect(bi.inline?.get('W')).toEqual({ type: 'number', value: 2 });
    expect(ops.at(-1)!.op).toBe('Tj');
  });

  it('keeps byte spans, so a rewrite changes only the operators it is told to', () => {
    const src = enc('BT /F1 12 Tf 72 700 Td (secreto) Tj ( publico) Tj ET');
    const ops = parseContent(src);
    const secret = ops.find((o) => str(o.args[0]) === 'secreto')!;
    const out = new TextDecoder().decode(rewriteContent(src, ops, new Map([[secret, [serializeOp('TJ', [{ type: 'array', value: [{ type: 'number', value: -3000 }] }])]]])));
    expect(out).not.toContain('secreto');
    expect(out).toContain('( publico) Tj');
    expect(out).toContain('/F1 12 Tf\n72 700 Td\n'); // untouched operators are copied byte for byte
    // The rewritten stream parses again.
    expect(parseContent(enc(out)).map((o) => o.op)).toEqual(['BT', 'Tf', 'Td', 'TJ', 'Tj', 'ET']);
  });

  it('serializes strings so that they read back the same', () => {
    const bytes = Uint8Array.from([0x28, 0x29, 0x5c, 0x0a, 0x00, 0xe9, 0x41]);
    const line = serializeOp('Tj', [{ type: 'string', value: bytes }]);
    expect([...((parseContent(latin(line))[0]!.args[0] as { value: Uint8Array }).value)]).toEqual([...bytes]);
  });

  it('rejects broken syntax with a ContentSyntaxError instead of guessing', () => {
    for (const bad of ['(sin cerrar Tj', '<</A 1 Tj', '/X <<1 2>> BDC', 'BI /W 2 ID xx', '<4G> Tj']) {
      expect(() => parseContent(enc(bad)), bad).toThrow(ContentSyntaxError);
    }
  });
});
