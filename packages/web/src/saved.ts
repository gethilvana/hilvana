// Saved recipes live only in this browser (localStorage). Nothing is sent anywhere, and recipes
// that need a secret (a certificate or a password) are never saved.

export interface SavedRecipe {
  id: string;
  name: string;
  recipe: { version: 1; steps: { op: string; [k: string]: unknown }[]; [k: string]: unknown };
  savedAt: string;
}

const KEY = 'hilvana.recipes.v1';

export function loadRecipes(): SavedRecipe[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.name === 'string' && r.recipe && Array.isArray(r.recipe.steps)) : [];
  } catch {
    return []; // storage blocked or damaged: start empty
  }
}

function store(list: SavedRecipe[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Why a recipe cannot be saved: it needs a secret, which is never stored. */
export function secretIn(recipe: SavedRecipe['recipe']): 'certificate' | 'password' | undefined {
  for (const s of recipe.steps) {
    if (s.op === 'signDigital') return 'certificate';
    if (s.op === 'protect' && s.password !== undefined) return 'password';
  }
  return undefined;
}

/**
 * Makes a recipe reusable with other files: the merge step no longer names the files it was
 * made with (it takes the documents in the order they are added), and the output name follows
 * each document.
 */
export function reusable(recipe: SavedRecipe['recipe']): SavedRecipe['recipe'] {
  return {
    ...recipe,
    steps: recipe.steps.map((s) => {
      if (s.op !== 'merge' || !('files' in s)) return s;
      const { files: _files, ...rest } = s;
      return rest;
    }),
  };
}

/** Image inputs a recipe refers to by name (the signature of a "sign" step). */
export function imagesIn(recipe: SavedRecipe['recipe']): string[] {
  return [...new Set(recipe.steps.filter((s) => s.op === 'sign' && typeof s.image === 'string').map((s) => s.image as string))];
}

export function saveRecipe(name: string, recipe: SavedRecipe['recipe']): SavedRecipe | undefined {
  if (secretIn(recipe)) return undefined;
  const item: SavedRecipe = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 120),
    recipe: reusable({ ...recipe, name: name.trim().slice(0, 120) }),
    savedAt: new Date().toISOString(),
  };
  return store([item, ...loadRecipes()]) ? item : undefined;
}

export function deleteRecipe(id: string): void {
  store(loadRecipes().filter((r) => r.id !== id));
}

export function fileNameFor(name: string): string {
  return `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'receta'}.json`;
}
