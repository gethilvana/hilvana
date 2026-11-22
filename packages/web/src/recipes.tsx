import { useEffect, useRef, useState } from 'preact/hooks';
import type { Lang } from '@hilvana/recipes';
import type { Engine } from './engine';
import type { Strings } from './i18n';
import { deleteRecipe, fileNameFor, imagesIn, loadRecipes, saveRecipe, secretIn, type SavedRecipe } from './saved';

export type ApplyMode = 'each' | 'together';

function ImageSlot({ s, name, chosen, onImage }: { s: Strings; name: string; chosen?: string; onImage: (name: string, file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div class="field">
      <span class="field-label">{s.saved.image(name)}</span>
      <div class="cert-row">
        {chosen && <span class="cert-name">{chosen}</span>}
        <button type="button" class="btn btn-quiet btn-small" onClick={() => input.current?.click()}>{chosen ? s.saved.changeImage : s.saved.chooseImage}</button>
      </div>
      <input ref={input} type="file" class="visually-hidden" tabIndex={-1} aria-hidden="true" accept="image/png,image/jpeg" aria-label={s.saved.image(name)}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) onImage(name, f);
        }} />
    </div>
  );
}

/** Lists the recipes saved in this browser, imports and exports them, and picks one to apply. */
export function RecipesPanel({ s, lang, engine, recipes, setRecipes, selected, onSelect, mode, onMode, manyFiles, images, onImage }: {
  s: Strings;
  lang: Lang;
  engine: Engine;
  recipes: SavedRecipe[];
  setRecipes: (list: SavedRecipe[]) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  mode: ApplyMode;
  onMode: (m: ApplyMode) => void;
  manyFiles: boolean;
  images: Record<string, string>;
  onImage: (name: string, file: File) => void;
}) {
  const t = s.saved;
  const [steps, setSteps] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // Steps are described by the engine, in the current language.
  useEffect(() => {
    let live = true;
    setSteps({});
    for (const r of recipes) {
      engine.describe(r.recipe, lang).then((list) => live && setSteps((m) => ({ ...m, [r.id]: list })), () => undefined);
    }
    return () => { live = false; };
  }, [recipes, lang]);

  async function importFile(file: File) {
    setMessage(null);
    let recipe: SavedRecipe['recipe'];
    try {
      recipe = JSON.parse(await file.text());
      await engine.describe(recipe, lang);
    } catch {
      return setMessage({ text: t.invalid, error: true });
    }
    if (secretIn(recipe)) return setMessage({ text: t.secret, error: true });
    const name = (typeof recipe.name === 'string' && recipe.name.trim()) || file.name.replace(/\.json$/i, '');
    const item = saveRecipe(name, recipe);
    if (!item) return setMessage({ text: t.saveFailed, error: true });
    setRecipes(loadRecipes());
    onSelect(item.id);
    setMessage({ text: t.imported(name) });
  }

  function exportRecipe(r: SavedRecipe) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.recipe, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(r.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const chosen = recipes.find((r) => r.id === selected);
  return (
    <div class="saved">
      {recipes.length === 0 ? <p class="saved-empty">{t.empty}</p> : (
        <fieldset class="saved-list">
          <legend>{t.list}</legend>
          {recipes.map((r) => (
            <div key={r.id} class={`saved-item ${r.id === selected ? 'is-chosen' : ''}`}>
              <label class="saved-pick">
                <input type="radio" name="saved-recipe" checked={r.id === selected} onChange={() => onSelect(r.id)} aria-label={t.choose(r.name)} />
                <span class="saved-text">
                  <span class="saved-name">{r.name}</span>
                  {steps[r.id] && <span class="saved-steps">{steps[r.id]!.join(' · ')}</span>}
                </span>
              </label>
              <div class="saved-actions">
                <button type="button" class="btn btn-quiet btn-small" aria-label={t.exportLabel(r.name)} onClick={() => exportRecipe(r)}>{t.export}</button>
                <button type="button" class="btn btn-quiet btn-small" aria-label={t.removeLabel(r.name)} onClick={() => {
                  deleteRecipe(r.id);
                  setRecipes(loadRecipes());
                }}>{t.remove}</button>
              </div>
            </div>
          ))}
        </fieldset>
      )}

      <div class="saved-foot">
        <button type="button" class="btn btn-quiet btn-small" onClick={() => importInput.current?.click()}>{t.import}</button>
        <input ref={importInput} type="file" class="visually-hidden" tabIndex={-1} aria-hidden="true" accept=".json,application/json"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void importFile(f);
          }} />
        <p class="hint">{t.local}</p>
      </div>
      {message && <p class={message.error ? 'file-error' : 'hint'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}

      {chosen && imagesIn(chosen.recipe).map((name) => <ImageSlot key={name} s={s} name={name} chosen={images[name]} onImage={onImage} />)}

      {chosen && manyFiles && (
        <div class="field">
          <label for="apply-mode">{t.mode}</label>
          <select id="apply-mode" value={mode} onChange={(e) => onMode(e.currentTarget.value as ApplyMode)}>
            <option value="each">{t.each}</option>
            <option value="together">{t.together}</option>
          </select>
        </div>
      )}
    </div>
  );
}
