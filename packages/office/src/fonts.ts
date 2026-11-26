import type { PDFDocument, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { RunStyle } from './model.js';

/**
 * Open fonts that are metric-compatible with the common Office fonts, so line breaks and
 * page counts stay close to Word's. All are SIL OFL 1.1, distributed through Fontsource.
 */
export type Family = 'carlito' | 'caladea' | 'arimo' | 'tinos' | 'cousine' | 'noto-sans-symbols-2';

/** Last-resort fonts for symbols no text font has (✓ ✗ ☐ ★ ● → …). */
const SYMBOL_FILES = ['noto-sans-symbols-2-symbols-400-normal.woff', 'noto-sans-symbols-2-math-400-normal.woff'];

const SUBSETS = ['latin', 'latin-ext', 'greek', 'greek-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese', 'hebrew'];

export function familyFor(name: string): Family {
  const n = name.toLowerCase();
  if (/courier|consolas|mono|code|lucida console|menlo/.test(n)) return 'cousine';
  if (/cambria|georgia|garamond|book antiqua|palatino|constantia/.test(n)) return 'caladea';
  if (/times|serif|baskerville|minion/.test(n)) return 'tinos';
  if (/arial|helvetica|verdana|tahoma|trebuchet|liberation sans|roboto|open sans|segoe/.test(n)) return 'arimo';
  return 'carlito'; // Calibri, Aptos and anything unknown
}

/** Loads a font file such as ("carlito", "carlito-latin-400-normal.woff"). Return undefined if it does not exist. */
export type FontLoader = (family: Family, file: string) => Promise<Uint8Array | undefined>;

/** Font files already read in this process: every conversion embeds the same few, so each is read once. */
const nodeFontCache = new Map<string, Promise<Uint8Array | undefined>>();

/** Default loader for Node: reads the files from the installed @fontsource packages (once per process). */
export const nodeFontLoader: FontLoader = (family, file) => {
  const key = `${family}/${file}`;
  let p = nodeFontCache.get(key);
  if (!p) nodeFontCache.set(key, (p = readFontFile(family, file)));
  return p;
};

async function readFontFile(family: Family, file: string): Promise<Uint8Array | undefined> {
  const { createRequire } = await import('node:module');
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const require = createRequire(import.meta.url);
  try {
    const pkgJson = require.resolve(`@fontsource/${family}/package.json`);
    return new Uint8Array(await readFile(path.join(path.dirname(pkgJson), 'files', file)));
  } catch {
    return undefined;
  }
}

interface Face {
  pdf: PDFFont;
  kit: { hasGlyphForCodePoint(cp: number): boolean; ascent: number; descent: number; lineGap: number; unitsPerEm: number };
}

export interface Metrics {
  ascent: number; // per 1pt of font size
  descent: number; // positive
  lineGap: number;
}

export interface Segment {
  text: string;
  font: PDFFont;
}

/** Embeds only the font files and glyphs a document needs, with per-character fallback across subsets. */
export class FontManager {
  private faces = new Map<string, Face[]>();
  missingGlyphs = false;

  constructor(private doc: PDFDocument, private loader: FontLoader) {
    doc.registerFontkit(fontkit);
  }

  private key(style: Pick<RunStyle, 'font' | 'bold' | 'italic'>) {
    return `${familyFor(style.font)}-${style.bold ? 700 : 400}-${style.italic ? 'italic' : 'normal'}`;
  }

  /** Loads every font needed for the given (style, text) pairs. Call before layout. */
  async prepare(uses: { style: RunStyle; text: string }[]): Promise<void> {
    const byKey = new Map<string, { style: RunStyle; chars: Set<number> }>();
    for (const u of uses) {
      const k = this.key(u.style);
      const entry = byKey.get(k) ?? { style: u.style, chars: new Set<number>() };
      for (const ch of u.text) entry.chars.add(ch.codePointAt(0)!);
      byKey.set(k, entry);
    }
    for (const [k, { style, chars }] of byKey) {
      if (this.faces.has(k)) continue;
      const family = familyFor(style.font);
      const weight = style.bold ? 700 : 400;
      const italic = style.italic ? 'italic' : 'normal';
      const faces: Face[] = [];
      const pending = new Set([...chars].filter((c) => c > 32));
      for (const subset of SUBSETS) {
        if (faces.length > 0 && pending.size === 0) break;
        const bytes = await this.loader(family, `${family}-${subset}-${weight}-${italic}.woff`);
        if (!bytes) continue;
        const kit = fontkit.create(bytes as never) as unknown as Face['kit'];
        const covers = [...pending].filter((c) => kit.hasGlyphForCodePoint(c));
        if (faces.length > 0 && covers.length === 0) continue;
        const pdf = await this.doc.embedFont(bytes, { subset: true });
        faces.push({ pdf, kit });
        covers.forEach((c) => pending.delete(c));
      }
      if (faces.length === 0) throw new Error(`No font files found for ${family}. Is @fontsource/${family} installed?`);
      for (const file of SYMBOL_FILES) {
        if (pending.size === 0) break;
        const bytes = await this.loader('noto-sans-symbols-2', file);
        if (!bytes) continue;
        const kit = fontkit.create(bytes as never) as unknown as Face['kit'];
        const covers = [...pending].filter((c) => kit.hasGlyphForCodePoint(c));
        if (covers.length === 0) continue;
        faces.push({ pdf: await this.doc.embedFont(bytes, { subset: true }), kit });
        covers.forEach((c) => pending.delete(c));
      }
      if (pending.size > 0) this.missingGlyphs = true;
      this.faces.set(k, faces);
    }
  }

  private facesFor(style: RunStyle): Face[] {
    const f = this.faces.get(this.key(style));
    if (!f) throw new Error(`Font not prepared: ${this.key(style)}`);
    return f;
  }

  metrics(style: RunStyle): Metrics {
    const k = this.facesFor(style)[0]!.kit;
    return { ascent: k.ascent / k.unitsPerEm, descent: Math.abs(k.descent) / k.unitsPerEm, lineGap: k.lineGap / k.unitsPerEm };
  }

  /** Splits text into runs drawable with a single embedded font; unknown characters become "?". */
  segment(text: string, style: RunStyle): Segment[] {
    const faces = this.facesFor(style);
    const out: Segment[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let face = faces.find((f) => f.kit.hasGlyphForCodePoint(cp));
      let c = ch;
      if (!face) {
        face = faces[0]!;
        c = cp === 0xa0 ? ' ' : '?';
      }
      const last = out[out.length - 1];
      if (last && last.font === face.pdf) last.text += c;
      else out.push({ text: c, font: face.pdf });
    }
    return out;
  }
}

/**
 * Fonts for stamping text with characters outside the standard PDF fonts (✓, Greek, Cyrillic, Vietnamese),
 * in fallback order. For @hilvana/core text operations (`fonts` option).
 */
export async function fallbackTextFonts(loader: FontLoader = nodeFontLoader): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const subset of ['latin', 'latin-ext', 'greek', 'cyrillic', 'vietnamese']) {
    const bytes = await loader('carlito', `carlito-${subset}-400-normal.woff`);
    if (bytes) out.push(bytes);
  }
  for (const file of SYMBOL_FILES) {
    const bytes = await loader('noto-sans-symbols-2', file);
    if (bytes) out.push(bytes);
  }
  return out;
}
