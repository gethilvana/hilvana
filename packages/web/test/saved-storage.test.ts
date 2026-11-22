/**
 * Saved recipes in localStorage: what is written, what survives damaged or blocked storage, and
 * that a secret never reaches the browser's storage.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteRecipe, loadRecipes, saveRecipe } from '../src/saved';

const KEY = 'hilvana.recipes.v1';

class MemoryStorage {
  data = new Map<string, string>();
  full = false;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.full) throw new DOMException('quota', 'QuotaExceededError'); this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); (globalThis as { localStorage?: unknown }).localStorage = storage; });
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

describe('saved recipes in the browser', () => {
  it('saves newest first, without the files of a merge, and deletes by id', () => {
    const a = saveRecipe('  Facturas del mes  ', { version: 1, steps: [{ op: 'merge', files: ['enero.pdf', 'febrero.pdf'] }, { op: 'compress' }] })!;
    const b = saveRecipe('Sello', { version: 1, steps: [{ op: 'stampText', text: 'Recibido {date}' }] })!;
    expect(a.name).toBe('Facturas del mes');
    expect(loadRecipes().map((r) => r.name)).toEqual(['Sello', 'Facturas del mes']);
    expect(storage.getItem(KEY)).not.toContain('enero.pdf'); // file names are not kept
    deleteRecipe(b.id);
    expect(loadRecipes().map((r) => r.id)).toEqual([a.id]);
  });

  it('never writes a password or a certificate recipe to storage', () => {
    expect(saveRecipe('Con clave', { version: 1, steps: [{ op: 'protect', password: 'Secreto-123' }] })).toBeUndefined();
    expect(saveRecipe('Firma', { version: 1, steps: [{ op: 'signDigital', certificate: 'yo.p12' }] })).toBeUndefined();
    expect(storage.getItem(KEY)).toBeNull();
    // Restrictions alone carry no secret and can be saved.
    expect(saveRecipe('Solo lectura', { version: 1, steps: [{ op: 'protect', allowCopy: false }] })).toBeDefined();
    expect(storage.getItem(KEY)).not.toContain('Secreto');
  });

  it('starts empty when storage is damaged, has foreign entries or is blocked', () => {
    storage.setItem(KEY, '{no es json');
    expect(loadRecipes()).toEqual([]);
    storage.setItem(KEY, JSON.stringify({ not: 'a list' }));
    expect(loadRecipes()).toEqual([]);
    storage.setItem(KEY, JSON.stringify([null, { name: 1 }, { name: 'ok', recipe: { version: 1, steps: [] } }, { name: 'sin pasos', recipe: {} }]));
    expect(loadRecipes().map((r) => r.name)).toEqual(['ok']);
    delete (globalThis as { localStorage?: unknown }).localStorage; // e.g. storage disabled by the browser
    expect(loadRecipes()).toEqual([]);
  });

  it('reports a failed save (storage full) instead of pretending it worked', () => {
    storage.full = true;
    expect(saveRecipe('Lleno', { version: 1, steps: [{ op: 'compress' }] })).toBeUndefined();
  });
});
