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
