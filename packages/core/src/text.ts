import { StandardFonts, degrees, type Color, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { HilvanaError } from './errors.js';

/**
 * Where something is drawn, described the way the user sees the page: the visible box
 * (CropBox, else MediaBox), after the page's /Rotate is applied.
 */
export interface VisualFrame {
  width: number;
  height: number;
  /** Clockwise display rotation of the page: 0, 90, 180 or 270. */
  rotation: number;
  /** Maps a point in the visual frame (origin bottom-left, as displayed) to page coordinates. */
  toPage(u: number, v: number): { x: number; y: number };
}

export function visualFrame(page: PDFPage): VisualFrame {
  const box = page.getCropBox();
  const r = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360;
  const { x: x0, y: y0, width: w, height: h } = box;
  const toPage = (u: number, v: number) => {
    switch (r) {
      case 90: return { x: x0 + w - v, y: y0 + u };
      case 180: return { x: x0 + w - u, y: y0 + h - v };
      case 270: return { x: x0 + v, y: y0 + h - u };
      default: return { x: x0 + u, y: y0 + v };
    }
  };
  return { width: r % 180 ? h : w, height: r % 180 ? w : h, rotation: r, toPage };
}

/** A font able to draw some characters, with a glyph check. */
interface Face {
  font: PDFFont;
  has: (cp: number) => boolean;
}

/** Font bytes (TTF/OTF/WOFF) used when text has characters outside the standard PDF fonts, tried in order. */
export type FontSource = Uint8Array[] | (() => Promise<Uint8Array[]>);

function winAnsiEncodable(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepares the fonts to draw `texts`: the standard Helvetica when it can encode everything (small files),
 * otherwise the given fonts with per-character fallback. Characters no font has become "?".
 */
export async function prepareText(doc: PDFDocument, texts: string[], opts: { bold?: boolean; fonts?: FontSource }): Promise<Face[]> {
  const standard = await doc.embedFont(opts.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  if (texts.every((t) => winAnsiEncodable(standard, t))) {
    return [{ font: standard, has: (cp) => winAnsiEncodable(standard, String.fromCodePoint(cp)) }];
  }
  if (!opts.fonts) {
    const chars = [...new Set([...texts.join('')].filter((c) => !winAnsiEncodable(standard, c)))];
    throw new HilvanaError('UNSUPPORTED_CHARACTERS', { chars: chars.join('') });
  }
  const sources = typeof opts.fonts === 'function' ? await opts.fonts() : opts.fonts;
  doc.registerFontkit(fontkit);
  const needed = new Set([...texts.join('')].map((c) => c.codePointAt(0)!));
  const faces: Face[] = [];
  for (const bytes of sources) {
    const kit = fontkit.create(bytes as never) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    const covers = [...needed].some((cp) => kit.hasGlyphForCodePoint(cp));
    if (!covers && faces.length > 0) continue;
    faces.push({ font: await doc.embedFont(bytes, { subset: true }), has: (cp) => kit.hasGlyphForCodePoint(cp) });
  }
  faces.push({ font: standard, has: (cp) => winAnsiEncodable(standard, String.fromCodePoint(cp)) });
  return faces;
}

interface Run { text: string; font: PDFFont }

function segment(text: string, faces: Face[]): Run[] {
  const out: Run[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const face = faces.find((f) => f.has(cp));
    const font = face?.font ?? faces[faces.length - 1]!.font;
    const c = face ? ch : '?';
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += c;
    else out.push({ text: c, font });
  }
  return out;
}

export function textWidth(text: string, faces: Face[], size: number): number {
  return segment(text, faces).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
}

/**
 * Draws text whose baseline starts at visual point (u, v), upright as the page is displayed,
 * optionally rotated by `angle` degrees (counterclockwise, as seen).
 */
export function drawVisualText(
  page: PDFPage,
  frame: VisualFrame,
  text: string,
  faces: Face[],
  at: { u: number; v: number; size: number; color: Color; opacity?: number; angle?: number },
) {
  const visualAngle = at.angle ?? 0;
  const pageAngle = visualAngle + frame.rotation;
  const rad = (visualAngle * Math.PI) / 180;
  let advance = 0;
  for (const run of segment(text, faces)) {
    const p = frame.toPage(at.u + advance * Math.cos(rad), at.v + advance * Math.sin(rad));
    page.drawText(run.text, { x: p.x, y: p.y, size: at.size, font: run.font, color: at.color, opacity: at.opacity ?? 1, rotate: degrees(pageAngle) });
    advance += run.font.widthOfTextAtSize(run.text, at.size);
  }
}
