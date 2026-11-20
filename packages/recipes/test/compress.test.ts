import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import jpeg from 'jpeg-js';
import { plan, run } from '@hilvana/recipes';

let photoPdf: Uint8Array | undefined;
async function photo(): Promise<Uint8Array> {
  if (photoPdf) return photoPdf;
  const w = 2000, h = 1300;
  const data = new Uint8Array(w * h * 4);
  let s = 1;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 40) - 20;
  for (let i = 0; i < w * h; i++) { data[i * 4] = 120 + r(); data[i * 4 + 1] = ((i % w) / 8 + r()) & 255; data[i * 4 + 2] = 90 + r(); data[i * 4 + 3] = 255; }
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(new Uint8Array(jpeg.encode({ data, width: w, height: h }, 92).data));
  doc.addPage([612, 792]).drawImage(img, { x: 36, y: 300, width: 540, height: 351 });
  return (photoPdf = await doc.save());
}

describe('compress step', { timeout: 60_000 }, () => {
  it('describes itself, and aims for goals.maxBytes when no level is given', async () => {
    const files = [{ name: 'escaneo.pdf', bytes: await photo() }];
    const recipe = { version: 1, steps: [{ op: 'compress' }], goals: { maxBytes: 300_000 } };
    const p = await plan(recipe, files, 'es');
    expect(p.steps[1]).toBe('2. Comprimir hasta 293.0 KB como máximo');
    const res = await run(recipe, files);
    expect(res.allGoalsMet).toBe(true);
    expect(res.notes[0]).toMatch(/^Compresión: .* → .*nivel/);
  });

  it('reports honestly when the goal cannot be reached', async () => {
    const res = await run({ version: 1, steps: [{ op: 'compress' }], goals: { maxBytes: 2_000 } }, [{ name: 'e.pdf', bytes: await photo() }], { lang: 'en' });
    expect(res.allGoalsMet).toBe(false);
    expect(res.notes.join(' ')).toMatch(/was not reached/);
  });

  it('respects an explicit level and is not a destructive step', async () => {
    const p = await plan({ version: 1, steps: [{ op: 'compress', level: 'lossless' }] }, [{ name: 'e.pdf', bytes: await photo() }], 'en');
    expect(p.steps[1]).toBe('2. Compress (lossless level)');
    expect(p.destructiveSteps).toEqual([]);
  });
});
