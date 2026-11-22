import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { plan, run } from '@hilvana/recipes';

async function letter(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('Cuenta 987654321 a nombre de Luis', { x: 72, y: 760, size: 12, font });
  page.drawText('Escribir a luis@example.com', { x: 72, y: 730, size: 12, font });
  doc.addPage([595, 842]).drawText('Página dos sin datos', { x: 72, y: 760, size: 12, font });
  return doc.save();
}

async function text(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n';
  await task.destroy();
  return out;
}

describe('redact step', () => {
  it('describes itself without repeating the sensitive text, and needs confirmation', async () => {
    const files = [{ name: 'carta.pdf', bytes: await letter() }];
    const recipe = { version: 1, steps: [{ op: 'redact', terms: ['987654321'], patterns: ['email'], areas: [{ page: 2, x: 0, y: 0, width: 50, height: 50 }] }] };
    const p = await plan(recipe, files, 'es');
    expect(p.ok).toBe(true);
    expect(p.steps[1]).toBe('2. Tachar de verdad: 1 texto, correos, 1 área (borra contenido o información; requiere confirmación)');
    expect(p.steps.join(' ')).not.toContain('987654321');
    expect(p.destructiveSteps).toEqual([1]);
    await expect(run(recipe, files)).rejects.toMatchObject({ issues: [{ code: 'CONFIRMATION_REQUIRED' }] });
  });

  it('removes what it finds, reports it and keeps the rest', async () => {
    const files = [{ name: 'carta.pdf', bytes: await letter() }];
    const res = await run({ version: 1, steps: [{ op: 'redact', terms: ['987 654 321'], patterns: ['email'] }] }, files, { confirmed: true, lang: 'en' });
    const out = await text(res.bytes);
    expect(out).not.toContain('987654321');
    expect(out).not.toContain('luis@example.com');
    expect(out).toContain('a nombre de Luis');
    expect(out).toContain('Página dos sin datos');
    expect(res.notes).toEqual([
      'Redacted: 2 matches and 0 drawn areas, on pages 1. What was underneath was removed from the file.',
      'Checked: reading the result back, there is no text left inside the redacted areas.',
    ]);
  });

  it('says when there was nothing to redact, and rejects steps that name nothing or pages that do not exist', async () => {
    const files = [{ name: 'carta.pdf', bytes: await letter() }];
    const res = await run({ version: 1, steps: [{ op: 'redact', terms: ['no aparece'] }] }, files, { confirmed: true });
    expect(res.notes).toEqual(['No se encontró nada que tachar; el documento quedó igual.']);
    const empty = await plan({ version: 1, steps: [{ op: 'redact' }] }, files, 'en');
    expect(empty.issues.map((i) => i.code)).toEqual(['NOTHING_TO_REDACT']);
    const far = await plan({ version: 1, steps: [{ op: 'redact', areas: [{ page: 9, x: 0, y: 0, width: 5, height: 5 }] }] }, files, 'en');
    expect(far.issues.map((i) => i.code)).toEqual(['PAGE_OUT_OF_RANGE']);
  });
});
