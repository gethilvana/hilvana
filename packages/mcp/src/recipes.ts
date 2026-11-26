import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Recipe, redactRecipe } from '@hilvana/recipes';

/** The default folder for saved recipes, used when it exists and no other folder is given. */
export const DEFAULT_RECIPES_FOLDER = path.join(os.homedir(), '.hilvana', 'recetas');

/** Larger files are not recipes; skipping them keeps a stray file from slowing every listing. */
const MAX_BYTES = 256 * 1024;

export interface SavedRecipe {
  /** File name without .json: what tools and resource URIs use to refer to the recipe. */
  id: string;
  name: string;
  description?: string;
  path: string;
  /** The recipe with any password replaced, safe to show to a model. Undefined when the file is not a valid recipe. */
  recipe?: Recipe;
  /** Why the file is not a valid recipe. */
  problem?: string;
}

/**
 * A folder of saved recipes (.json files, as the web app exports them), read only.
 * Recipes are instructions, never documents, so reading them does not touch any PDF. Passwords a
 * hand-written recipe may carry are replaced before anything leaves this class.
 */
export class RecipeShelf {
  private constructor(readonly folder: string) {}

  /** Opens `folder`, or the default folder when none is given and it exists. Undefined when there is none. */
  static async open(folder?: string): Promise<RecipeShelf | undefined> {
    const raw = folder ?? DEFAULT_RECIPES_FOLDER;
    const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
    const real = await fs.realpath(path.resolve(expanded)).catch(() => undefined);
    if (!real || !(await fs.stat(real)).isDirectory()) {
      if (folder) throw new Error(`Recipes folder not found: ${folder}`);
      return undefined;
    }
    return new RecipeShelf(real);
  }

  async list(): Promise<SavedRecipe[]> {
    const entries = await fs.readdir(this.folder, { withFileTypes: true });
    const out: SavedRecipe[] = [];
    // Regular files only: a symlink could point at anything on the machine.
    for (const e of entries.filter((x) => x.isFile() && /\.json$/i.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(await this.read(e.name));
    }
    return out;
  }

  /** One recipe by id (its file name without .json). */
  async get(id: string): Promise<SavedRecipe | undefined> {
    if (!/^[^/\\]+$/.test(id) || id.startsWith('.')) return undefined; // no paths, no hidden files
    const file = `${id}.json`;
    const st = await fs.lstat(path.join(this.folder, file)).catch(() => undefined);
    if (!st?.isFile()) return undefined;
    return this.read(file);
  }

  private async read(file: string): Promise<SavedRecipe> {
    const full = path.join(this.folder, file);
    const id = file.replace(/\.json$/i, '');
    const base = { id, name: id, path: full };
    const st = await fs.stat(full);
    if (st.size > MAX_BYTES) return { ...base, problem: `Too large for a recipe (${st.size} bytes).` };
    let json: unknown;
    try {
      json = JSON.parse(await fs.readFile(full, 'utf8'));
    } catch {
      return { ...base, problem: 'Not valid JSON.' };
    }
    const parsed = Recipe.safeParse(json);
    if (!parsed.success) {
      return { ...base, problem: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
    }
    const recipe = redactRecipe(parsed.data);
    return { ...base, name: recipe.name ?? id, ...(recipe.description ? { description: recipe.description } : {}), recipe };
  }
}
