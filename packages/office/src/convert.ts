import { PDFDocument } from 'pdf-lib';
import { wordToPdf, type WordToPdfOptions, type WordToPdfResult, type WordWarning } from './word.js';

export type WordEngine = 'auto' | 'native' | 'libreoffice';

/** Warnings that mean the native engine left content out (not just approximated it). */
const CONTENT_LOSS: WordWarning[] = ['TEXTBOX_SKIPPED', 'LEGACY_SHAPE_SKIPPED', 'NOTES_SKIPPED', 'UNSUPPORTED_IMAGE_FORMAT', 'FLOATING_IMAGE_INLINED'];

/**
 * Word → PDF with engine selection, for Node surfaces (CLI, MCP):
 * - native: built-in engine, fast and dependency-free.
 * - libreoffice: a local LibreOffice install, for maximum fidelity.
 * - auto: native, unless it had to drop content and LibreOffice is installed.
 * Both engines run on this machine; nothing is uploaded.
 */
export async function convertWord(docx: Uint8Array, opts: WordToPdfOptions & { engine?: WordEngine } = {}): Promise<WordToPdfResult> {
  const engine = opts.engine ?? 'auto';
  if (engine === 'libreoffice') return viaLibreOffice(docx);
  const native = await wordToPdf(docx, opts);
  if (engine === 'native' || !native.warnings.some((w) => CONTENT_LOSS.includes(w))) return native;
  const { findLibreOffice } = await import('./libreoffice.js');
  if (!(await findLibreOffice())) return native;
  try {
    return await viaLibreOffice(docx);
  } catch {
    return native;
  }
}

async function viaLibreOffice(docx: Uint8Array): Promise<WordToPdfResult> {
  const { libreOfficeToPdf } = await import('./libreoffice.js');
  const pdf = await libreOfficeToPdf(docx);
  const pageCount = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
  return { pdf, pageCount, warnings: [], engine: 'libreoffice' };
}
