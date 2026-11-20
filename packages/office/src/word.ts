import { PDFDocument } from 'pdf-lib';
import { FontManager, nodeFontLoader, type FontLoader } from './fonts.js';
import { LayoutEngine } from './layout.js';
import { parseDocx } from './parse.js';

export type WordWarning =
  | 'TEXTBOX_SKIPPED'
  | 'FLOATING_IMAGE_INLINED'
  | 'UNSUPPORTED_IMAGE_FORMAT'
  | 'LEGACY_SHAPE_SKIPPED'
  | 'NOTES_SKIPPED'
  | 'FIRST_PAGE_HEADER_IGNORED'
  | 'PAGE_FIELD_IN_BODY'
  | 'CONTENT_TALLER_THAN_PAGE'
  | 'MISSING_GLYPHS';

export interface WordToPdfResult {
  pdf: Uint8Array;
  pageCount: number;
  /** Things the native engine simplified or skipped, as stable codes. */
  warnings: WordWarning[];
  engine: 'native' | 'libreoffice';
}

export interface WordToPdfOptions {
  /** Where to load fonts from. Defaults to the installed @fontsource packages (Node). Browsers pass a fetch-based loader. */
  fonts?: FontLoader;
}

/**
 * Converts a .docx to PDF entirely in-process (no network, no external programs).
 * Text is real and selectable; fonts are embedded and subset.
 * Covers paragraphs, styles, lists, tables, inline images, page/section breaks, headers and footers with page numbers.
 */
export async function wordToPdf(docx: Uint8Array, opts: WordToPdfOptions = {}): Promise<WordToPdfResult> {
  const model = parseDocx(docx);
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts = new FontManager(doc, opts.fonts ?? nodeFontLoader);
  const engine = new LayoutEngine(doc, fonts, model);
  await engine.prepare();
  const pageCount = engine.render();
  const warnings = new Set<WordWarning>([...(model.warnings as WordWarning[]), ...(engine.warnings as Set<WordWarning>)]);
  if (fonts.missingGlyphs) warnings.add('MISSING_GLYPHS');
  return { pdf: await doc.save({ useObjectStreams: true }), pageCount, warnings: [...warnings], engine: 'native' };
}

