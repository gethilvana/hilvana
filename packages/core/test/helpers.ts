import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Builds a test PDF whose page N contains the text "Page N" (or `label`-N). */
export async function makePdf(pages: number, opts: { label?: string; title?: string; author?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${opts.label ?? 'Page'} ${i}`, { x: 72, y: 760, size: 24, font });
  }
  if (opts.title) doc.setTitle(opts.title);
  if (opts.author) doc.setAuthor(opts.author);
  return doc.save();
}

/** A 2x1 red PNG. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8Dwn4EBAAj+Af9IxWaQAAAAAElFTkSuQmCC',
    'base64',
  ),
);

/**
 * A PDF with the structure of a digitally signed document: a signature field whose value is a
 * signature dictionary (/Type /Sig, /SubFilter, /ByteRange, /Contents), as PDF readers expect.
 * The signature bytes are placeholders: enough to test detection, not a valid signature.
 */
export async function makeSignedPdf(pages = 2, signatures = 1): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFHexString, PDFString } = await import('pdf-lib');
  const doc = await PDFDocument.load(await makePdf(pages, { label: 'Firmado' }));
  const ctx = doc.context;
  const fields = [];
  for (let i = 0; i < signatures; i++) {
    const sig = ctx.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'ETSI.CAdES.detached',
      ByteRange: [0, 100, 200, 300],
      Contents: PDFHexString.of('00'.repeat(64)),
      M: PDFString.of('D:20261121000000Z'),
    });
    const field = ctx.obj({ FT: 'Sig', T: PDFString.of(`Firma${i + 1}`), V: ctx.register(sig), Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 0, 0], F: 4 });
    const ref = ctx.register(field);
    doc.getPage(0).node.addAnnot(ref);
    fields.push(ref);
  }
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: fields, SigFlags: 3 }));
  return doc.save({ useObjectStreams: true });
}
