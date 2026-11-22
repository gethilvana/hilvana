/**
 * Redaction against content streams written by hand, the way other PDF producers write them:
 * kerning arrays, the ' and " operators, escaped strings, inline images and filled shapes. The
 * pdf-lib fixtures in redact.test.ts only use Tj, so these paths need their own cases.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { findText, redact, type RedactArea } from '@hilvana/core';

async function pageWith(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return doc.save();
}

async function text(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const c = await (await (await task.promise).getPage(1)).getTextContent();
  await task.destroy();
  return c.items.map((x) => ('str' in x ? x.str : '')).join(' ').replace(/\s+/g, ' ').trim();
}

const areasOf = async (bytes: Uint8Array, terms: string[]) => (await findText(bytes, { terms })).flatMap((m) => m.areas);

describe('redaction of hand-written content streams', () => {
  it('removes text inside kerning arrays and the \' and " operators, and keeps the rest', async () => {
    const bytes = await pageWith([
      'BT /F1 12 Tf 14 TL 72 700 Td',
      '[(Cuenta ) -250 (12345678) 120 ( fin)] TJ',
      "(Linea \\(dos\\) 87654321 ok) '",
      '2 0 (tres 11223344 \\101BC) "',
      'ET',
    ].join('\n'));
    const before = await text(bytes);
    expect(before).toContain('12345678');
    const areas = await areasOf(bytes, ['12345678', '87654321', '11223344']);
    expect(areas).toHaveLength(3);
    const { bytes: out, report } = await redact(bytes, { areas });
    const after = await text(out);
    for (const n of ['12345678', '87654321', '11223344']) expect(after).not.toContain(n);
    for (const kept of ['Cuenta', 'fin', 'Linea (dos)', 'ok', 'tres', 'ABC']) expect(after).toContain(kept);
    expect(report.glyphs).toBeGreaterThanOrEqual(24); // 3 × 8 digits, plus at most a neighbouring space each
    expect(report.glyphs).toBeLessThanOrEqual(27);
    expect(report.strictPass).toBe(false);
  });

  it('removes an inline image and a filled shape that lie inside an area, and keeps those outside', async () => {
    const img = 'BI /W 2 /H 2 /BPC 8 /CS /G ID \x00\xff\xff\x00 EI';
    const bytes = await pageWith([
      `q 40 0 0 40 100 600 cm ${img} Q`, // inside
      `q 40 0 0 40 300 600 cm ${img} Q`, // outside
      '0 0 1 rg 100 500 40 20 re f', // inside
      '0 0 1 rg 300 500 40 20 re f', // outside
      '0 0 1 rg 90 400 200 20 re f', // crosses the edge of the area: kept
    ].join('\n'));
    const area: RedactArea = { page: 1, x: 95, y: 395, width: 60, height: 260 };
    const { bytes: out, report } = await redact(bytes, { areas: [area] });
    expect(report).toMatchObject({ imagesRemoved: 1, shapes: 1 });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: out.slice(), verbosity: 0 });
    const page = await (await task.promise).getPage(1);
    const ops = await page.getOperatorList();
    await task.destroy();
    const OPS = pdfjs.OPS;
    // One inline image left (the outside one); the black boxes are drawn on top.
    expect(ops.fnArray.filter((f) => f === OPS.paintInlineImageXObject).length).toBe(1);
  });

  it('refuses a page whose content it cannot read, instead of leaving text behind', async () => {
    const bytes = await pageWith('BT /F1 12 Tf 72 700 Td (12345678) Tj ET\n(sin cerrar');
    await expect(redact(bytes, { areas: [{ page: 1, x: 60, y: 690, width: 200, height: 30 }] }))
      .rejects.toMatchObject({ code: 'REDACTION_UNSUPPORTED' });
  });
});

describe('findText patterns', () => {
  it('finds card numbers only when the check digit is right', async () => {
    const bytes = await pageWith('BT /F1 12 Tf 72 700 Td (Tarjeta 4111 1111 1111 1111 y 4111 1111 1111 1112) Tj ET');
    const cards = await findText(bytes, { patterns: ['card'] });
    expect(cards.map((m) => m.text)).toEqual(['4111 1111 1111 1111']);
  });

  it('finds phone numbers', async () => {
    const bytes = await pageWith('BT /F1 12 Tf 72 700 Td (Llame al +57 310 555 1234 hoy) Tj ET');
    const phones = await findText(bytes, { patterns: ['phone'] });
    expect(phones.map((m) => m.text)).toEqual(['+57 310 555 1234']);
  });
});
