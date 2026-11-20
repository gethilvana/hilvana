import { describe, expect, it } from 'vitest';
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { DocxError, convertWord, findLibreOffice, isDocx, wordToPdf } from '@hilvana/office';
import { sampleContract } from './fixtures.js';

/** Extracts the text of every page with pdf.js, the way a reader or search engine would. */
async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  return pages;
}

async function simpleDoc(...paragraphs: Paragraph[]): Promise<Uint8Array> {
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] })));
}

describe('wordToPdf (native engine)', () => {
  it('converts a realistic contract with real, selectable text', async () => {
    const res = await wordToPdf(await sampleContract());
    expect(res.engine).toBe('native');
    expect(res.pageCount).toBe(2);
    expect(res.warnings).toEqual([]);
    const pages = await pdfText(res.pdf);
    const all = pages.join(' ');
    for (const s of ['Contrato de arrendamiento', 'Ana María Pérez', 'José Núñez', '¿Acuerdo? ¡Sí!', 'Control del portón eléctrico', 'Duración de doce (12) meses.']) {
      expect(all).toContain(s);
    }
    expect(all).not.toContain('? ?');
  });

  it('numbers lists and fills header/footer fields per page', async () => {
    const pages = await pdfText((await wordToPdf(await sampleContract())).pdf);
    expect(pages[0]).toMatch(/1\.\s*Duración/);
    expect(pages[0]).toMatch(/3\.\s*Depósito/);
    expect(pages[0]).toContain('Hilvana · Documento de prueba');
    expect(pages[0]).toContain('Página 1 de 2');
    expect(pages[1]).toContain('Página 2 de 2');
  });

  it('honors page breaks', async () => {
    const pages = await pdfText((await wordToPdf(await sampleContract())).pdf);
    expect(pages[0]).not.toContain('Firmas');
    expect(pages[1]).toContain('Firmas');
  });

  it('uses the page size and margins from the document', async () => {
    const res = await wordToPdf(await sampleContract());
    const page = (await PDFDocument.load(res.pdf)).getPage(0);
    expect(Math.round(page.getWidth())).toBe(612);
    expect(Math.round(page.getHeight())).toBe(792);
  });

  it('wraps long justified text across pages', async () => {
    const long = 'Texto de prueba con palabras suficientemente largas para llenar varias líneas. '.repeat(400);
    const res = await wordToPdf(await simpleDoc(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun(long)] })));
    expect(res.pageCount).toBeGreaterThan(2);
    const text = (await pdfText(res.pdf)).join(' ');
    expect(text.split('Texto de prueba').length - 1).toBe(400);
  });

  it('falls back across font subsets (Greek, Cyrillic) and reports characters no font has', async () => {
    const ok = await wordToPdf(await simpleDoc(new Paragraph({ children: [new TextRun('Ελληνικά и кириллица')] })));
    expect(ok.warnings).not.toContain('MISSING_GLYPHS');
    expect((await pdfText(ok.pdf)).join(' ')).toContain('Ελληνικά и кириллица');
    const emoji = await wordToPdf(await simpleDoc(new Paragraph({ children: [new TextRun('Listo ✅')] })));
    expect(emoji.warnings).toContain('MISSING_GLYPHS');
  });

  it('produces an empty-but-valid page for an empty document', async () => {
    const res = await wordToPdf(await simpleDoc(new Paragraph({ children: [] })));
    expect(res.pageCount).toBe(1);
  });

  it('does not leak author metadata into the PDF', async () => {
    const pdf = await PDFDocument.load((await wordToPdf(await sampleContract())).pdf, { updateMetadata: false });
    expect(pdf.getAuthor()).toBeUndefined();
    expect(pdf.getProducer()).toBeUndefined();
  });
});

describe('isDocx and errors', () => {
  it('detects Word files', async () => {
    expect(isDocx(await sampleContract())).toBe(true);
    expect(isDocx(new TextEncoder().encode('%PDF-1.7'))).toBe(false);
  });

  it('rejects files that are not Word documents with a stable code', async () => {
    await expect(wordToPdf(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(DocxError);
    await expect(wordToPdf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toMatchObject({ code: 'ENCRYPTED_DOCX' });
  });
});

const hasLibreOffice = !!(await findLibreOffice());

describe.skipIf(!hasLibreOffice)('convertWord with LibreOffice', () => {
  it('uses LibreOffice when asked', async () => {
    const res = await convertWord(await sampleContract(), { engine: 'libreoffice' });
    expect(res.engine).toBe('libreoffice');
    expect((await pdfText(res.pdf)).join(' ')).toContain('Contrato de arrendamiento');
  }, 120_000);

  it('auto keeps the native engine when nothing was dropped', async () => {
    const res = await convertWord(await sampleContract(), { engine: 'auto' });
    expect(res.engine).toBe('native');
  });
});
