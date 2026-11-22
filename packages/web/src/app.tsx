import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Lang } from '@hilvana/recipes';
import type { PageWords } from '@hilvana/office';
import { Engine } from './engine';
import { DropZone, FileList, type Doc } from './files';
import { initialLang, saveLang, strings, type ToolId } from './i18n';
import { PageGrid, SignaturePad, ToolOptions } from './options';
import { ResultPanel, type Result } from './result';
import { CertificatePanel, ProtectPanel, type Certificate } from './security';
import { RecipesPanel, type ApplyMode } from './recipes';
import { RedactPanel } from './redact';
import { hidePasswords, imagesIn, loadRecipes, saveRecipe, secretIn, type SavedRecipe } from './saved';
import { openPreview } from './thumbs';
import { GROUPS, TOOLS, accepts, buildRecipe, defaultOptions, redactTerms, splitRanges, type Options } from './tools';
import { Dialog, PrivacyNote, Stitch, Wordmark } from './ui';

const SOURCE = 'https://github.com/gethilvana/hilvana';
const toolFromHash = (): ToolId => {
  const id = location.hash.replace(/^#\/?/, '') as ToolId;
  return TOOLS.some((t) => t.id === id) ? id : 'merge';
};

let seq = 0;
const nextId = () => `d${++seq}`;

export function App() {
  const engine = useMemo(() => new Engine(), []);
  const [lang, setLang] = useState<Lang>(initialLang);
  const s = strings[lang];
  const [toolId, setToolId] = useState<ToolId>(toolFromHash);
  const tool = TOOLS.find((t) => t.id === toolId)!;
  const text = s.tools_[toolId];
  const [docs, setDocs] = useState<Doc[]>([]);
  const [options, setOptions] = useState<Options>(() => defaultOptions(s));
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  // Secrets live only in memory, on this page and in the worker, and are cleared when leaving the tool.
  const [cert, setCert] = useState<Certificate | null>(null);
  const certPassword = useRef('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [recipes, setRecipes] = useState<SavedRecipe[]>(loadRecipes);
  const [recipeId, setRecipeId] = useState<string | null>(() => loadRecipes()[0]?.id ?? null);
  const [applyMode, setApplyMode] = useState<ApplyMode>('each');
  // Images a saved recipe refers to by name (its signature), chosen for this run: name → file name.
  const [recipeImages, setRecipeImages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef(docs);
  docsRef.current = docs;
  // Each run gets a number; switching tools or starting over makes older runs stale (D19).
  const runId = useRef(0);

  useEffect(() => {
    const onHash = () => setToolId(toolFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${text.name} · Hilvana`;
  }, [lang, text.name]);

  // Default texts follow the language until the person edits them.
  useEffect(() => {
    const other = strings[lang === 'es' ? 'en' : 'es'];
    setOptions((o) => ({
      ...o,
      stampText: o.stampText === other.stampDefault ? s.stampDefault : o.stampText,
      numberFormat: o.numberFormat === other.numberDefault ? s.numberDefault : o.numberFormat,
      watermarkText: o.watermarkText === other.watermarkDefault ? s.watermarkDefault : o.watermarkText,
    }));
  }, [lang]);

  // Switching tools keeps the files that still make sense.
  useEffect(() => {
    runId.current++;
    setBusy(false);
    setResult(null);
    setError(null);
    setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [], redactAreas: [] }));
    clearSecrets();
    setRecipes(loadRecipes()); // another tab may have saved some
    setDocs((current) => {
      const keep = current.filter((d) => d.status !== 'ready' || (d.kind && accepts(tool, d.kind)));
      const final = tool.single ? keep.slice(0, 1) : keep;
      for (const d of current) if (!final.includes(d)) drop(d);
      return final;
    });
  }, [toolId]);

  function clearSecrets() {
    engine.remove('certificate');
    certPassword.current = '';
    setCert(null);
    setNewPassword('');
    setNewPassword2('');
  }

  async function chooseCertificate(file: File) {
    certPassword.current = '';
    setCert({ name: file.name, status: 'chosen' });
    await engine.add('certificate', file.name, new Uint8Array(await file.arrayBuffer()), lang);
  }

  async function openCertificate(password: string) {
    setCert((c) => c && { ...c, status: 'opening', error: undefined });
    try {
      const info = await engine.certificate('certificate', password, lang);
      certPassword.current = password;
      setCert((c) => c && { ...c, status: 'ready', info });
    } catch (err) {
      setCert((c) => c && { ...c, status: 'error', error: (err as Error).message });
    }
  }

  function drop(d: Doc) {
    engine.remove(d.id);
    d.preview?.destroy();
    if (d.imageUrl) URL.revokeObjectURL(d.imageUrl);
  }

  function update(id: string, patch: Partial<Doc>) {
    setDocs((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setResult(null);
    setError(null);
    const chosen = tool.single ? files.slice(0, 1) : files;
    const taken = new Set((tool.single ? [] : docsRef.current).map((d) => d.name));
    const fresh: Doc[] = chosen.map((f) => {
      let name = f.name;
      for (let n = 2; taken.has(name); n++) name = f.name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
      taken.add(name);
      return { id: nextId(), name, size: f.size, status: 'reading' };
    });
    setDocs((list) => {
      if (tool.single) list.forEach(drop);
      return tool.single ? fresh : [...list, ...fresh];
    });
    if (tool.id === 'pages' || tool.id === 'rotate' || tool.id === 'redact') setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [], redactAreas: [] }));
    await Promise.all(chosen.map(async (file, i) => {
      const doc = fresh[i]!;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const added = await engine.add(doc.id, doc.name, bytes, lang);
      await applyAdded(doc.id, added, file);
    }));
  }

  async function applyAdded(id: string, added: Awaited<ReturnType<Engine['add']>>, file?: File) {
    if (added.error) return update(id, { status: added.needsPassword ? 'locked' : 'error', kind: added.kind, error: added.error });
    const patch: Partial<Doc> = { status: 'ready', kind: added.kind, info: added.info, warnings: added.warnings, error: undefined };
    if (added.kind === 'image' && file) patch.imageUrl = URL.createObjectURL(file);
    if (added.preview) {
      try { patch.preview = await openPreview(added.preview); } catch { /* previews are optional */ }
    }
    update(id, patch);
  }

  async function unlockFile(id: string, password: string) {
    update(id, { status: 'reading', error: undefined });
    await applyAdded(id, await engine.unlock(id, password, lang));
  }

  async function chooseRecipeImage(name: string, file: File) {
    await engine.add(`img:${name}`, name, new Uint8Array(await file.arrayBuffer()), lang);
    setRecipeImages((m) => ({ ...m, [name]: file.name }));
  }

  const savedRecipe = recipes.find((r) => r.id === recipeId);
  const usable = docs.filter((d) => d.status === 'ready' && d.kind && accepts(tool, d.kind));
  const reading = docs.some((d) => d.status === 'reading');
  const first = usable[0];

  let blocker: string | null = null;
  if (docs.some((d) => d.status === 'locked')) blocker = s.needUnlock;
  else if (!usable.length) blocker = s.needFiles({ docs: s.accepts.pdfWord, word: s.accepts.word, images: s.accepts.images }[tool.accept]);
  else if (tool.id === 'merge' && usable.length < 2) blocker = s.needTwo;
  else if (tool.id === 'sign' && !signature) blocker = s.signature.missing;
  else if (tool.id === 'split' && options.splitMode === 'ranges' && !splitRanges(options)) blocker = s.needRanges;
  else if (tool.id === 'certify' && cert?.status !== 'ready') blocker = s.certify.missing;
  else if (tool.id === 'redact' && !redactTerms(options).length && !options.redactPatterns.length && !options.redactAreas.length) blocker = s.redact.nothing;
  else if (tool.id === 'recipes' && !savedRecipe) blocker = s.saved.pick;
  else if (tool.id === 'recipes' && imagesIn(savedRecipe!.recipe).some((n) => !recipeImages[n])) blocker = s.saved.imageMissing(imagesIn(savedRecipe!.recipe).find((n) => !recipeImages[n])!);
  else if (tool.id === 'protect' && newPassword && newPassword !== newPassword2) blocker = s.protect.mismatch;
  else if (tool.id === 'protect' && !newPassword && options.allowPrint && options.allowCopy && options.allowModify) blocker = s.protect.nothing;
  const nothingToDo = tool.id === 'pages' && !options.pagesOrder;
  const canRun = !blocker && !reading && !busy && !nothingToDo;

  async function runTool() {
    if (!canRun) return;
    const mine = ++runId.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let res: Result;
      if (tool.id === 'ocr') {
        // Pages are drawn here, one at a time, and read in the worker: memory stays flat on phones.
        const preview = first!.preview;
        const words: Record<number, PageWords> = {};
        if (preview) {
          const scans: number[] = [];
          for (let n = 1; n <= preview.pageCount; n++) if ((await preview.textLength(n)) < 10) scans.push(n);
          setProgress(s.ocr.preparing);
          for (const [i, n] of scans.entries()) {
            if (mine !== runId.current) return;
            const raster = await preview.raster(n);
            setProgress(s.ocr.progress(i + 1, scans.length));
            words[n] = await engine.ocrPage(raster, options.ocrLanguage, lang);
          }
        }
        const recipe = buildRecipe('ocr', options, [first!.name], lang);
        res = { ...(await engine.run(recipe, [{ id: first!.id, name: first!.name }], lang, words)), recipe };
      } else if (tool.id === 'recipes') {
        const recipe = savedRecipe!.recipe;
        const files = [...usable.map((d) => ({ id: d.id, name: d.name })), ...imagesIn(recipe).map((n) => ({ id: `img:${n}`, name: n }))];
        const each = applyMode === 'each' && usable.length > 1;
        const r = await (each ? engine.batch(recipe, files, lang) : engine.run(recipe, files, lang));
        res = { ...r, recipe, recipeEach: each, zipName: `${savedRecipe!.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.zip` };
      } else if (tool.id === 'word') {
        const all = await Promise.all(usable.map((d) => {
          const recipe = buildRecipe('word', options, [d.name], lang);
          return engine.run(recipe, [{ id: d.id, name: d.name }], lang).then((r) => ({ ...r, recipe }));
        }));
        res = {
          outputs: all.flatMap((r) => r.outputs),
          notes: all.flatMap((r) => r.notes),
          warnings: all.flatMap((r) => r.warnings),
          recipe: all[0]!.recipe,
          recipeEach: all.length > 1,
          zipName: lang === 'es' ? 'documentos.zip' : 'documents.zip',
        };
      } else {
        const inputs = tool.single ? [first!] : usable;
        const files: { id: string; name: string; password?: string }[] = inputs.map((d) => ({ id: d.id, name: d.name }));
        const sigName = '__firma.png';
        if (tool.id === 'sign') {
          await engine.add('signature', sigName, signature!.slice(), lang);
          files.push({ id: 'signature', name: sigName });
        }
        if (tool.id === 'certify') files.push({ id: 'certificate', name: cert!.name, password: certPassword.current });
        const recipe = buildRecipe(tool.id, options, inputs.map((d) => d.name), lang, { signature: sigName, certificate: cert?.name, password: newPassword || undefined });
        const r = await engine.run(recipe, files, lang);
        res = {
          ...r,
          // The recipe shown can be copied and shared: no secrets, and the usual signature name.
          recipe: tool.id === 'sign' ? buildRecipe('sign', options, [], lang) : hidePasswords(recipe),
          ...(tool.id === 'split' ? { zipName: `${first!.name.replace(/\.[^.]+$/, '')}-${lang === 'es' ? 'partes' : 'parts'}.zip` } : {}),
        };
      }
      if (mine !== runId.current) return;
      setResult(res);
      requestAnimationFrame(() => resultRef.current?.querySelector<HTMLElement>('#result')?.focus());
    } catch (err) {
      if (mine === runId.current) setError((err as Error).message);
    } finally {
      if (mine === runId.current) { setBusy(false); setProgress(null); }
    }
  }

  function chooseLang(l: Lang) {
    setLang(l);
    saveLang(l);
  }

  function goTool(id: ToolId) {
    if (location.hash !== `#/${id}`) location.hash = `/${id}`;
    else setToolId(id);
  }

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const gridMode = tool.id === 'pages' ? 'arrange' : tool.id === 'rotate' ? 'rotate' : null;

  return (
    <div class="app">
      <header class="top">
        <a class="brand" href="./" aria-label="Hilvana"><Wordmark /></a>
        <p class="tagline">{s.tagline}</p>
        <div class="top-actions">
          <div class="segmented" role="group" aria-label={s.language}>
            <button type="button" lang="es" aria-pressed={lang === 'es'} onClick={() => chooseLang('es')}>Español</button>
            <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => chooseLang('en')}>English</button>
          </div>
          <a class="link" href={SOURCE} rel="noopener">{s.sourceCode}</a>
        </div>
      </header>

      <div class="body">
        <nav class="tools" aria-label={s.tools}>
          {GROUPS.map((g) => (
            <section key={g} class="tool-group">
              <h2>{s.groups[g]}</h2>
              <ul>
                {TOOLS.filter((t) => t.group === g).map((t) => (
                  <li key={t.id}>
                    <a href={`#/${t.id}`} aria-current={t.id === toolId ? 'page' : undefined} onClick={(e) => { e.preventDefault(); goTool(t.id); }}>
                      {s.tools_[t.id].name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <main class="work" id="main">
          <div class="tools-mobile">
            <select aria-label={s.tools} value={toolId} onChange={(e) => goTool(e.currentTarget.value as ToolId)}>
              {GROUPS.map((g) => (
                <optgroup key={g} label={s.groups[g]}>
                  {TOOLS.filter((t) => t.group === g).map((t) => <option key={t.id} value={t.id}>{s.tools_[t.id].name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <h1>{text.name}</h1>
          <p class="purpose">{text.purpose}</p>

          <div class="sheet">
            <DropZone s={s} tool={tool} compact={docs.length > 0} onFiles={addFiles} />
            <FileList
              s={s}
              docs={docs}
              ordered={tool.id === 'merge' || tool.id === 'images'}
              wrongKind={(d) => !!d.kind && !accepts(tool, d.kind)}
              onRemove={(id) => setDocs((list) => {
                const d = list.find((x) => x.id === id);
                if (d) drop(d);
                if (tool.id === 'pages' || tool.id === 'rotate' || tool.id === 'redact') setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [], redactAreas: [] }));
                return list.filter((x) => x.id !== id);
              })}
              onUnlock={unlockFile}
              keepsSignatures={tool.id === 'certify'}
              onMove={(id, by) => setDocs((list) => {
                const i = list.findIndex((d) => d.id === id);
                const j = i + by;
                if (i < 0 || j < 0 || j >= list.length) return list;
                const next = [...list];
                [next[i], next[j]] = [next[j]!, next[i]!];
                return next;
              })}
            />

            {gridMode && first?.preview && <PageGrid key={first.id} s={s} preview={first.preview} mode={gridMode} o={options} set={setOption} />}

            {tool.id === 'sign' && first && <SignaturePad s={s} onChange={setSignature} />}

            {tool.id === 'certify' && first && <CertificatePanel s={s} lang={lang} cert={cert} o={options} set={setOption} onChoose={chooseCertificate} onOpen={openCertificate} />}

            {tool.id === 'recipes' && (
              <RecipesPanel s={s} lang={lang} engine={engine} recipes={recipes} setRecipes={(list) => {
                setRecipes(list);
                if (!list.some((r) => r.id === recipeId)) setRecipeId(list[0]?.id ?? null);
              }} selected={recipeId} onSelect={setRecipeId} mode={applyMode} onMode={setApplyMode}
              manyFiles={usable.length > 1} images={recipeImages} onImage={chooseRecipeImage} />
            )}

            {tool.id === 'redact' && first && <RedactPanel key={first.id} s={s} lang={lang} engine={engine} docId={first.id} preview={first.preview} o={options} set={setOption} />}

            {tool.id === 'protect' && first && <ProtectPanel s={s} password={newPassword} confirm={newPassword2} onPassword={setNewPassword} onConfirm={setNewPassword2} o={options} set={setOption} />}

            {usable.length > 0 && tool.id === 'metadata' && first?.info && (
              <div class="meta-list">
                {first.info.hasMetadata ? (
                  <>
                    <h2>{s.metadataFound}</h2>
                    <dl>
                      {(Object.keys(s.metadataFields) as (keyof typeof s.metadataFields)[]).filter((k) => first.info!.metadata[k]).map((k) => (
                        <div key={k}><dt>{s.metadataFields[k]}</dt><dd>{first.info!.metadata[k]}</dd></div>
                      ))}
                    </dl>
                  </>
                ) : <p>{s.metadataNone}</p>}
              </div>
            )}

            {usable.length > 0 && <ToolOptions s={s} tool={tool.id} o={options} set={setOption} />}

            <div class="action">
              {blocker && docs.length > 0 && !reading && <p class="blocker">{blocker}</p>}
              <button type="button" class="btn btn-primary btn-large" disabled={!canRun} aria-busy={busy} onClick={runTool}>
                {busy ? progress ?? text.busy : text.action}
              </button>
              <Stitch running={busy} class="action-stitch" />
              {error && <p class="error" role="alert"><strong>{s.result.error}.</strong> {error}</p>}
            </div>
          </div>

          <div ref={resultRef} aria-live="polite">
            {result && <ResultPanel s={s} result={result} save={tool.id === 'recipes' || !result.recipe ? undefined
              : secretIn(result.recipe as SavedRecipe['recipe']) ? { blocked: true }
              : { defaultName: s.saved.defaultName(text.name), onSave: (name) => {
                const item = saveRecipe(name, result.recipe as SavedRecipe['recipe']);
                if (item) setRecipes(loadRecipes());
                if (item) setRecipeId(item.id);
                return !!item;
              } }} onReset={() => {
              runId.current++;
              setResult(null);
              setDocs((list) => { list.forEach(drop); return []; });
              setSignature(null);
              clearSecrets();
              setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [], redactAreas: [] }));
            }} />}
          </div>
        </main>
      </div>

      <footer class="foot">
        <PrivacyNote s={s} onOpen={() => setPrivacyOpen(true)} />
        <p class="foot-meta">
          <a class="link" href={SOURCE} rel="noopener">{s.openSource}</a>
          <a class="link" href="./THIRD_PARTY_NOTICES.txt">{s.thirdParty}</a>
        </p>
      </footer>

      <Dialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} title={s.privacyTitle} closeLabel={s.close}>
        {s.privacyBody.map((p) => <p key={p}>{p}</p>)}
      </Dialog>
    </div>
  );
}
