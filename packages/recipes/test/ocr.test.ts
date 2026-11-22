import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { plan, run } from '@hilvana/recipes';

const scan = () => new Uint8Array(readFileSync(new URL('../../office/test/fixtures/ocr/escaneo-jpeg.pdf', import.meta.url)));

describe('ocr step', { timeout: 60_000 }, () => {
  it('makes a scan searchable, and a following step can redact it by text', async () => {
    const recipe = { version: 1, steps: [{ op: 'ocr' }, { op: 'redact', terms: ['123 456 789'] }] };
    const files = [{ name: 'extracto.pdf', bytes: scan() }];
    const p = await plan(recipe, files, 'es');
    expect(p.steps).toEqual([
      '1. Unir todos los PDF en el orden recibido',
      '2. Reconocer el texto de las páginas escaneadas (OCR en español)',
      '3. Tachar de verdad: 1 texto (borra contenido o información; requiere confirmación)',
    ]);
    const res = await run(recipe, files, { confirmed: true });
    expect(res.notes[0]).toMatch(/^OCR: páginas 1, \d+ palabras, confianza media \d+ %/);
    expect(res.notes).toContain('El OCR puede equivocarse: revisa las cifras y los nombres importantes.');
    expect(res.notes.some((n) => n.startsWith('Tachado: 1 coincidencias'))).toBe(true);
  });

  it('says when nothing needed OCR', async () => {
    const res = await run({ version: 1, steps: [{ op: 'ocr', language: 'eng' }] }, [{ name: 'a.pdf', bytes: readFileSync(new URL('../../core/test/fixtures/encrypted/permisos-aes256.pdf', import.meta.url)) }], { lang: 'en' });
    expect(res.notes).toEqual(['Every page already had text; no OCR was needed.']);
  });
});
