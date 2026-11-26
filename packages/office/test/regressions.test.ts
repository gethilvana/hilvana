/** Regression tests for Word defects found in the phase-0 QA pass (docs/qa/fase-0.md). */
import { describe, expect, it } from 'vitest';
import { Document, Packer, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, InsertedTextRun, DeletedTextRun, WidthType } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { DOCX_LIMITS, wordToPdf } from '@hilvana/office';
import { strToU8, zipSync } from 'fflate';

const p = (t: string, o: object = {}) => new Paragraph({ children: [new TextRun(t)], ...o });
const build = async (doc: Document) => new Uint8Array(await Packer.toBuffer(doc));
async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: pdf.slice(), isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  return out;
}

describe('Word regressions', { timeout: 60_000 }, () => {
  it('D11 · each section keeps its own orientation', async () => {
    const res = await wordToPdf(await build(new Document({ sections: [
      { children: [p('Vertical')] },
      { properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } }, children: [p('Horizontal')] },
    ] })));
    const doc = await PDFDocument.load(res.pdf);
    const [a, b] = doc.getPages();
    expect(a!.getWidth()).toBeLessThan(a!.getHeight());
    expect(b!.getWidth()).toBeGreaterThan(b!.getHeight());
    const texts = await pageTexts(res.pdf);
    expect(texts[0]).toContain('Vertical');
    expect(texts[1]).toContain('Horizontal');
  });

  it('D12 · header rows repeat on every page a table continues on; no row is lost', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => new TableRow({ tableHeader: i === 0, children: [new TableCell({ children: [p(i === 0 ? 'ENCABEZADO' : `Fila ${i}`)] })] }));
    const res = await wordToPdf(await build(new Document({ sections: [{ children: [new Table({ width: { size: 9000, type: WidthType.DXA }, rows })] }] })));
    const texts = await pageTexts(res.pdf);
    expect(texts.length).toBeGreaterThan(2);
    for (const t of texts) expect(t.startsWith('ENCABEZADO')).toBe(true);
    const all = texts.join(' ');
    for (let i = 1; i < 150; i++) expect(all).toMatch(new RegExp(`Fila ${i}\\b`));
  });

  it('D13 · multi-column sections warn instead of failing silently', async () => {
    const res = await wordToPdf(await build(new Document({ sections: [{ properties: { column: { space: 708, count: 2 } }, children: [p('Columnas')] }] })));
    expect(res.warnings).toContain('COLUMNS_IGNORED');
  });

  it('tracked changes: insertions shown, deletions hidden', async () => {
    const res = await wordToPdf(await build(new Document({ sections: [{ children: [new Paragraph({ children: [
      new TextRun('Base '), new InsertedTextRun({ text: 'NUEVO', id: 1, author: 'A', date: '2026-01-01T00:00:00Z' }),
      new DeletedTextRun({ text: 'VIEJO', id: 2, author: 'A', date: '2026-01-01T00:00:00Z' }),
    ] })] }] })));
    const t = (await pageTexts(res.pdf)).join(' ');
    expect(t).toContain('NUEVO');
    expect(t).not.toContain('VIEJO');
  });

  it('symbols like ✓ ☐ ★ render with the symbols fallback font', async () => {
    const res = await wordToPdf(await build(new Document({ sections: [{ children: [p('Hecho ✓ pendiente ☐ destacado ★')] }] })));
    expect(res.warnings).not.toContain('MISSING_GLYPHS');
    expect((await pageTexts(res.pdf)).join('').replace(/\s+/g, '')).toContain('Hecho✓pendiente☐destacado★');
  });

  it('a long chain of keep-with-next paragraphs terminates and keeps every paragraph', async () => {
    const res = await wordToPdf(await build(new Document({ sections: [{ children: Array.from({ length: 80 }, (_, i) => p(`Título ${i}`, { keepNext: true })) }] })));
    const all = (await pageTexts(res.pdf)).join(' ');
    for (let i = 0; i < 80; i++) expect(all).toMatch(new RegExp(`Título ${i}\\b`));
  });
});

// D15: a .docx is a zip; a few MB can declare gigabytes. Conversion must refuse before inflating.
describe('Word archives that expand too much (D15)', () => {
  const skeleton = (extra: Record<string, Uint8Array>) => zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hola</w:t></w:r></w:p></w:body></w:document>'),
    // Referenced from the document, so the converter would have to read them.
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      Object.keys(extra).map((k, i) => `<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${k.replace('word/', '')}"/>`).join('')}</Relationships>`),
    ...extra,
  }, { level: 9 });

  it('rejects a part larger than the limit without converting', async () => {
    const huge = new Uint8Array(DOCX_LIMITS.partBytes + 1);
    const docx = skeleton({ 'word/media/huge.bin': huge });
    expect(docx.byteLength).toBeLessThan(200_000);
    await expect(wordToPdf(docx)).rejects.toMatchObject({ name: 'DocxError', code: 'DOCX_TOO_LARGE' });
  });

  it('rejects when the parts add up past the total limit', async () => {
    const part = new Uint8Array(DOCX_LIMITS.partBytes - 1);
    const parts = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`word/media/p${i}.bin`, part]));
    await expect(wordToPdf(skeleton(parts))).rejects.toMatchObject({ code: 'DOCX_TOO_LARGE' });
  });

  it('ignores parts the converter never reads', async () => {
    const big = new Uint8Array(DOCX_LIMITS.partBytes + 1);
    const res = await wordToPdf(skeleton({ 'customXml/blob.bin': big }));
    expect(res.pageCount).toBe(1);
  });
});

describe('Word archives that lie about their sizes (D15)', () => {
  it('never inflates media the document does not reference', async () => {
    const zeros = new Uint8Array(DOCX_LIMITS.partBytes - 1);
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hola</w:t></w:r></w:p></w:body></w:document>'),
      'word/media/unused.bin': zeros,
    }, { level: 9 });
    const t = Date.now();
    expect((await wordToPdf(docx)).pageCount).toBe(1);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('rejects a referenced part whose header understates its size', async () => {
    const zeros = new Uint8Array(8 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24); // incompressible
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hola</w:t></w:r></w:p></w:body></w:document>'),
      'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img.bin"/></Relationships>'),
      'word/media/img.bin': zeros,
    }, { level: 1 });
    // Rewrite the declared (uncompressed) size of img.bin in both zip headers.
    const dv = new DataView(docx.buffer);
    const name = strToU8('word/media/img.bin');
    const at = (i: number) => name.every((c, k) => docx[i + k] === c);
    for (let i = 0; i < docx.length - 50; i++) {
      if (dv.getUint32(i, true) === 0x04034b50 && at(i + 30)) dv.setUint32(i + 22, 1000, true);
      if (dv.getUint32(i, true) === 0x02014b50 && at(i + 46)) dv.setUint32(i + 24, 1000, true);
    }
    await expect(wordToPdf(docx)).rejects.toMatchObject({ code: 'DOCX_TOO_LARGE' });
  });
});

// D21: broken XML inside a .docx surfaced the XML parser's message instead of a stable code.
describe('damaged Word documents (D21)', () => {
  it('reports broken XML as CORRUPT_DOCX', async () => {
    const docx = zipSync({ 'word/document.xml': strToU8('<not-xml') });
    await expect(wordToPdf(docx)).rejects.toMatchObject({ name: 'DocxError', code: 'CORRUPT_DOCX' });
  });
});

// Found by the public benchmark (docs/benchmark.md) on Apache POI's test documents.
describe('Word documents from the public benchmark', { timeout: 60_000 }, () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const raw = (body: string) => zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
  });

  it('draws no-break spaces (some embedded fonts lack them)', async () => {
    const res = await wordToPdf(await build(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'Total a pagar: $ 1.000', font: 'Arial', bold: true, italics: true })] })] }] })));
    expect((await pageTexts(res.pdf))[0]).toMatch(/Total a pagar: \$ ?1\.000/);
  });

  it('converts a document whose only paragraph has no text', async () => {
    const res = await wordToPdf(raw('<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:pPr></w:p>'));
    expect(res.pageCount).toBe(1);
  });

  it('keeps table rows and cells wrapped in content controls', async () => {
    const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const sdt = (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    const res = await wordToPdf(raw(`<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${cell('Nota')}${cell('Detalle')}</w:tr>${sdt(sdt(`<w:tr>${sdt(cell('Elija un elemento.'))}${cell('Fila dentro de un control')}</w:tr>`))}</w:tbl>`));
    const [text] = await pageTexts(res.pdf);
    for (const s of ['Nota', 'Detalle', 'Elija un elemento.', 'Fila dentro de un control']) expect(text).toContain(s);
  });
});

// Audit 2026-11-24 (docs/qa/auditoria-2026-11-24.md).
describe('Word findings of the 2026-11-24 audit', { timeout: 60_000 }, () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const docx = (body: string, header?: string) => zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${header ? '<Relationship Id="h1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ''}</Relationships>`),
    ...(header ? { 'word/header1.xml': strToU8(`<?xml version="1.0"?><w:hdr ${W}>${header}</w:hdr>`) } : {}),
  });
  async function positions(bytes: Uint8Array) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((x) => 'str' in x && x.str.trim()) as { str: string; transform: number[] }[];
    return new Map(items.map((x) => [x.str, { x: x.transform[4]!, y: x.transform[5]! }]));
  }

  it('finding 3: takes column widths from the cells when the table has no grid', async () => {
    const tc = (w: number, t: string) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${p(t)}</w:tc>`;
    const res = await wordToPdf(docx(`<w:tbl><w:tr>${tc(1440, 'Uno')}${tc(7200, 'Dos')}</w:tr><w:tr>${tc(1440, 'Tres')}${tc(7200, 'Cuatro')}</w:tr></w:tbl>`));
    const at = await positions(res.pdf);
    // The second column starts one inch (72 pt) after the first, as the cells declare; not at half the width.
    expect(Math.round(at.get('Dos')!.x - at.get('Uno')!.x)).toBe(72);
    expect(Math.round(at.get('Cuatro')!.x - at.get('Tres')!.x)).toBe(72);
  });

  it('finding 7: honors center and right tab stops, as in Word headers', async () => {
    const res = await wordToPdf(docx('<w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr><w:r><w:t>Izq</w:t></w:r><w:r><w:tab/><w:t>Centro</w:t></w:r><w:r><w:tab/><w:t>Der</w:t></w:r></w:p>'));
    const at = await positions(res.pdf);
    const margin = 72;
    // "Der" ends at the right stop (468 pt from the margin); "Centro" is centered on 234 pt.
    expect(at.get('Der')!.x).toBeGreaterThan(margin + 440);
    expect(at.get('Der')!.x).toBeLessThan(margin + 468);
    expect(Math.abs(at.get('Centro')!.x - (margin + 234 - 14))).toBeLessThan(6);
  });

  it('finding 7: a style can clear an inherited tab stop', async () => {
    const res = await wordToPdf(docx('<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/><w:tab w:val="clear" w:pos="9360"/></w:tabs></w:pPr><w:r><w:t>A</w:t></w:r><w:r><w:tab/><w:t>B</w:t></w:r></w:p>'));
    const at = await positions(res.pdf);
    expect(at.get('B')!.x).toBeLessThan(72 + 40); // back to the default half-inch tabs
  });

  it('finding 9: each section keeps its own header; a cover section without one has none', async () => {
    const res = await wordToPdf(docx(`${p('Portada')}<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>${p('Capitulo')}<w:sectPr><w:headerReference w:type="default" r:id="h1"/></w:sectPr>`, p('Encabezado del capitulo')));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: res.pdf.slice(), verbosity: 0 }).promise;
    const text = async (n: number) => (await (await doc.getPage(n)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ');
    expect(await text(1)).not.toContain('Encabezado');
    expect(await text(2)).toContain('Encabezado del capitulo');
  });

  it('finding 8: a header taller than its margin pushes the body down instead of printing over it', async () => {
    const header = Array.from({ length: 8 }, (_, i) => p(`Encabezado ${i + 1}`)).join('');
    const res = await wordToPdf(docx(`${p('Cuerpo')}<w:sectPr><w:headerReference w:type="default" r:id="h1"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/></w:sectPr>`, header));
    const at = await positions(res.pdf);
    expect(at.get('Cuerpo')!.y).toBeLessThan(at.get('Encabezado 8')!.y - 8);
  });
});
