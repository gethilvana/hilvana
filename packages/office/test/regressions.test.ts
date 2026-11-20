/** Regression tests for Word defects found in the phase-0 QA pass (docs/qa/fase-0.md). */
import { describe, expect, it } from 'vitest';
import { Document, Packer, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, InsertedTextRun, DeletedTextRun, WidthType } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { wordToPdf } from '@hilvana/office';

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
