import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Recipe } from '@hilvana/recipes';
import { parsePageRange } from '@hilvana/core';
import { strings } from '../src/i18n';
import { TOOLS, buildRecipe, compactRange, defaultOptions, pagesExpr, type Options } from '../src/tools';


const anchor = fc.constantFrom('top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'center' as const);
const pagesChoice = fc.record({ mode: fc.constantFrom('all', 'first', 'last', 'custom' as const), custom: fc.constantFrom('', '1', '1-3,5', 'last', 'odd', ' 2-last ') });
const text = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);

const options: fc.Arbitrary<Options> = fc.record({
  pagesOrder: fc.option(fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 20 }), { nil: null }),
  rotatePages: fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 10 }),
  angle: fc.constantFrom(90, 180, 270 as const),
  splitMode: fc.constantFrom('each', 'ranges' as const),
  ranges: fc.string(),
  pageSize: fc.constantFrom('image', 'a4', 'letter' as const),
  signPages: pagesChoice,
  signAnchor: anchor,
  signWidth: fc.integer({ min: 60, max: 300 }),
  stampText: text,
  stampPages: pagesChoice,
  stampAnchor: anchor,
  stampSize: fc.integer({ min: 7, max: 36 }),
  numberFormat: fc.string({ maxLength: 30 }),
  numberAnchor: anchor,
  watermarkText: text,
  watermarkOpacity: fc.double({ min: 0.05, max: 0.6, noNaN: true }),
  level: fc.constantFrom('balanced', 'strong', 'max', 'lossless', 'target' as const),
  targetMB: fc.double({ min: 0.5, max: 20, noNaN: true }),
  certVisible: fc.boolean(),
  certReason: fc.string({ maxLength: 200 }),
  certLocation: fc.string({ maxLength: 200 }),
  allowPrint: fc.boolean(),
  allowCopy: fc.boolean(),
  allowModify: fc.boolean(),
}) as fc.Arbitrary<Options>;

describe('recipes built by the web tools', () => {
  const recipeTools = TOOLS.filter((t) => t.id !== 'recipes'); // every tool but saved recipes builds one

  it('are always valid against the recipe schema, for any option the UI can produce', () => {
    fc.assert(fc.property(options, fc.constantFrom(...recipeTools.map((t) => t.id)), fc.constantFrom('es', 'en' as const), (o, tool, lang) => {
      if (tool === 'pages' && !o.pagesOrder) return; // the button is disabled until something changes
      if ((tool === 'sign' || tool === 'stamp') && (o.signPages.mode === 'custom' || o.stampPages.mode === 'custom') && !o.signPages.custom.trim() && !o.stampPages.custom.trim()) return;
      const r = buildRecipe(tool, o, ['a.pdf', 'b.pdf'], lang);
      const parsed = Recipe.safeParse(r);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }), { numRuns: 400 });
  });

  it('use the default options of each language without errors', () => {
    for (const lang of ['es', 'en'] as const) {
      const o = { ...defaultOptions(strings[lang]), pagesOrder: [2, 1] };
      for (const t of recipeTools) expect(Recipe.safeParse(buildRecipe(t.id, o, ['a.pdf'], lang)).success).toBe(true);
    }
  });

  it('name outputs per language without unsafe characters', () => {
    const o = { ...defaultOptions(strings.es), pagesOrder: [1] };
    for (const t of recipeTools) {
      for (const lang of ['es', 'en'] as const) expect(buildRecipe(t.id, o, ['a.pdf'], lang).output?.filename).toMatch(/^\{name\}(-[a-z-]+)?$/);
    }
  });

  it('keep the order of merged files', () => {
    const r = buildRecipe('merge', defaultOptions(strings.es), ['c.pdf', 'a.docx', 'b.pdf'], 'es');
    expect(r.steps[0]).toEqual({ op: 'merge', files: ['c.pdf', 'a.docx', 'b.pdf'] });
  });

  it('turn the target size into bytes', () => {
    const r = buildRecipe('compress', { ...defaultOptions(strings.es), level: 'target', targetMB: 1.5 }, ['a.pdf'], 'es');
    expect(r.steps[0]).toEqual({ op: 'compress', targetBytes: 1572864 });
  });

  it('split by page or by the typed ranges', () => {
    const o = defaultOptions(strings.es);
    expect(buildRecipe('split', o, ['a.pdf'], 'es').steps).toEqual([{ op: 'split' }]);
    expect(buildRecipe('split', { ...o, splitMode: 'ranges', ranges: ' 1-3 ;; 4-last ' }, ['a.pdf'], 'es').steps).toEqual([{ op: 'split', ranges: ['1-3', '4-last'] }]);
    expect(buildRecipe('split', { ...o, splitMode: 'ranges', ranges: ' ; ' }, ['a.pdf'], 'es').steps).toEqual([{ op: 'split' }]);
  });

  it('convert any Word file with the same recipe', () => {
    const o = defaultOptions(strings.es);
    expect(buildRecipe('word', o, ['x.docx'], 'es')).toEqual(buildRecipe('word', o, ['y.docx'], 'es'));
  });

  it('rotate every page when none is chosen', () => {
    const r = buildRecipe('rotate', { ...defaultOptions(strings.es), rotatePages: [] }, ['a.pdf'], 'es');
    expect(r.steps[0]).toEqual({ op: 'rotate', angle: 90 });
  });
});

describe('compactRange', () => {
  it('round-trips through the engine page-range parser, keeping order', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 40 }), (pages) => {
      // The engine returns 0-based indices; selectPages keeps the given order.
      expect(parsePageRange(compactRange(pages), 60, true)).toEqual(pages.map((p) => p - 1));
    }), { numRuns: 500 });
  });

  it('collapses consecutive runs', () => {
    expect(compactRange([1, 2, 3, 5, 7, 8])).toBe('1-3,5,7-8');
    expect(compactRange([3, 2, 1])).toBe('3,2,1');
  });
});

describe('page choices', () => {
  it('map to engine expressions', () => {
    expect(pagesExpr({ mode: 'all', custom: '' })).toBe('all');
    expect(pagesExpr({ mode: 'first', custom: '' })).toBe('1');
    expect(pagesExpr({ mode: 'last', custom: '' })).toBe('last');
    expect(pagesExpr({ mode: 'custom', custom: ' 2-3 ' })).toBe('2-3');
    expect(pagesExpr({ mode: 'custom', custom: '  ' })).toBeUndefined();
  });
});

describe('interface texts', () => {
  const shape = (v: unknown, path = ''): string[] => {
    if (typeof v === 'function') return [`${path}()${v.length}`];
    if (Array.isArray(v)) return [`${path}[${v.length}]`];
    if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => shape(x, `${path}.${k}`)).sort();
    return [path];
  };

  it('exist in both languages with the same keys and arguments', () => {
    expect(shape(strings.en)).toEqual(shape(strings.es));
  });

  it('are never empty and differ between languages where they should', () => {
    const leaves = (v: unknown, out: string[] = []): string[] => {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => leaves(x, out));
      return out;
    };
    for (const lang of ['es', 'en'] as const) for (const s of leaves(strings[lang])) expect(s.trim()).not.toBe('');
    for (const t of TOOLS) {
      expect(strings.en.tools_[t.id].name).not.toBe(strings.es.tools_[t.id].name);
      expect(strings.en.tools_[t.id].action).not.toBe(strings.es.tools_[t.id].action);
    }
  });

  it('keep each button label consistent with its progress label', () => {
    for (const lang of ['es', 'en'] as const) for (const t of TOOLS) expect(strings[lang].tools_[t.id].busy).toMatch(/…$/);
  });
});

describe('security tools', () => {
  const o = defaultOptions(strings.es);
  it('build a signDigital recipe that names the certificate input and carries no password', () => {
    expect(buildRecipe('certify', o, ['a.pdf'], 'es', { certificate: 'mi firma.p12' }).steps).toEqual([{ op: 'signDigital', certificate: 'mi firma.p12' }]);
    const r = buildRecipe('certify', { ...o, certVisible: false, certReason: ' Aprobado ', certLocation: '' }, ['a.pdf'], 'en', { certificate: 'c.pfx' });
    expect(r.steps).toEqual([{ op: 'signDigital', certificate: 'c.pfx', visible: false, reason: 'Aprobado' }]);
  });

  it('build a protect recipe with only what changes, and redact its password for display', async () => {
    const { redactRecipe } = await import('@hilvana/recipes');
    const r = buildRecipe('protect', { ...o, allowCopy: false }, ['a.pdf'], 'es', { password: 'secreto' });
    expect(r.steps).toEqual([{ op: 'protect', password: 'secreto', allowCopy: false }]);
    expect(JSON.stringify(redactRecipe(r))).not.toContain('secreto');
    expect(buildRecipe('protect', { ...o, allowPrint: false }, ['a.pdf'], 'es').steps).toEqual([{ op: 'protect', allowPrint: false }]);
  });
});

describe('saved recipes', async () => {
  const { reusable, secretIn, imagesIn, fileNameFor } = await import('../src/saved');
  it('forget the files a merge was made with, so they apply to new files', () => {
    expect(reusable({ version: 1, steps: [{ op: 'merge', files: ['a.pdf'] }, { op: 'numberPages' }] }).steps).toEqual([{ op: 'merge' }, { op: 'numberPages' }]);
  });
  it('are never saved with a secret', () => {
    expect(secretIn({ version: 1, steps: [{ op: 'signDigital', certificate: 'c.p12' }] })).toBe('certificate');
    expect(secretIn({ version: 1, steps: [{ op: 'protect', password: '••••••' }] })).toBe('password');
    expect(secretIn({ version: 1, steps: [{ op: 'protect', allowCopy: false }] })).toBeUndefined();
  });
  it('know which images they need, and get a safe file name', () => {
    expect(imagesIn({ version: 1, steps: [{ op: 'sign', image: 'firma.png' }, { op: 'sign', image: 'firma.png' }] })).toEqual(['firma.png']);
    expect(fileNameFor('Sello «Recibido» / 2026')).toBe('sello-recibido-2026.json');
  });
});
