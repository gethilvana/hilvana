import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Lang } from '@hilvana/recipes';
import { Engine } from './engine';
import { DropZone, FileList, type Doc } from './files';
import { initialLang, saveLang, strings, type ToolId } from './i18n';
import { PageGrid, SignaturePad, ToolOptions } from './options';
import { ResultPanel, type Result } from './result';
import { openPreview } from './thumbs';
import { GROUPS, TOOLS, accepts, buildRecipe, defaultOptions, type Options } from './tools';
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef(docs);
  docsRef.current = docs;

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
    setResult(null);
    setError(null);
    setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [] }));
    setDocs((current) => {
      const keep = current.filter((d) => d.status !== 'ready' || (d.kind && accepts(tool, d.kind)));
      const final = tool.single ? keep.slice(0, 1) : keep;
      for (const d of current) if (!final.includes(d)) drop(d);
      return final;
    });
  }, [toolId]);

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
    if (tool.id === 'pages' || tool.id === 'rotate') setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [] }));
    await Promise.all(chosen.map(async (file, i) => {
      const doc = fresh[i]!;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const added = await engine.add(doc.id, doc.name, bytes, lang);
      if (added.error) return update(doc.id, { status: 'error', kind: added.kind, error: added.error });
      const patch: Partial<Doc> = { status: 'ready', kind: added.kind, info: added.info, warnings: added.warnings };
      if (added.kind === 'image') patch.imageUrl = URL.createObjectURL(file);
      if (added.preview) {
        try { patch.preview = await openPreview(added.preview); } catch { /* previews are optional */ }
      }
      update(doc.id, patch);
    }));
  }

  const usable = docs.filter((d) => d.status === 'ready' && d.kind && accepts(tool, d.kind));
  const reading = docs.some((d) => d.status === 'reading');
  const first = usable[0];

  let blocker: string | null = null;
  if (!usable.length) blocker = s.needFiles({ docs: s.accepts.pdfWord, word: s.accepts.word, images: s.accepts.images }[tool.accept]);
  else if (tool.id === 'merge' && usable.length < 2) blocker = s.needTwo;
  else if (tool.id === 'sign' && !signature) blocker = s.signature.missing;
  const nothingToDo = tool.id === 'pages' && !options.pagesOrder;
  const canRun = !blocker && !reading && !busy && !nothingToDo;

  async function runTool() {
    if (!canRun) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let res: Result;
      if (tool.id === 'split') {
        const ranges = options.splitMode === 'ranges' ? options.ranges.split(';').map((r) => r.trim()).filter(Boolean) : undefined;
        const r = await engine.split(first!.id, ranges, lang);
        res = { ...r, zipName: `${first!.name.replace(/\.[^.]+$/, '')}-${lang === 'es' ? 'partes' : 'parts'}.zip` };
      } else if (tool.id === 'word') {
        const all = await Promise.all(usable.map((d) => {
          const recipe = buildRecipe('word', options, [d.name], lang);
          return engine.run(recipe, [{ id: d.id, name: d.name }], lang).then((r) => ({ ...r, recipe }));
        }));
        res = {
          outputs: all.flatMap((r) => r.outputs),
          notes: all.flatMap((r) => r.notes),
          warnings: all.flatMap((r) => r.warnings),
          recipe: all.length === 1 ? all[0]!.recipe : undefined,
          zipName: lang === 'es' ? 'documentos.zip' : 'documents.zip',
        };
      } else {
        const inputs = tool.single ? [first!] : usable;
        const files = inputs.map((d) => ({ id: d.id, name: d.name }));
        const sigName = '__firma.png';
        if (tool.id === 'sign') {
          await engine.add('signature', sigName, signature!.slice(), lang);
          files.push({ id: 'signature', name: sigName });
        }
        const recipe = buildRecipe(tool.id, options, inputs.map((d) => d.name), lang, sigName);
        const r = await engine.run(recipe, files, lang);
        res = { ...r, recipe: tool.id === 'sign' ? buildRecipe('sign', options, [], lang) : recipe };
      }
      setResult(res);
      requestAnimationFrame(() => resultRef.current?.querySelector<HTMLElement>('#result')?.focus());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
                if (tool.id === 'pages' || tool.id === 'rotate') setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [] }));
                return list.filter((x) => x.id !== id);
              })}
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
                {busy ? text.busy : text.action}
              </button>
              <Stitch running={busy} class="action-stitch" />
              {error && <p class="error" role="alert"><strong>{s.result.error}.</strong> {error}</p>}
            </div>
          </div>

          <div ref={resultRef} aria-live="polite">
            {result && <ResultPanel s={s} result={result} onReset={() => {
              setResult(null);
              setDocs((list) => { list.forEach(drop); return []; });
              setSignature(null);
              setOptions((o) => ({ ...o, pagesOrder: null, rotatePages: [] }));
            }} />}
          </div>
        </main>
      </div>

      <footer class="foot">
        <PrivacyNote s={s} onOpen={() => setPrivacyOpen(true)} />
        <p class="foot-meta"><a class="link" href={SOURCE} rel="noopener">{s.openSource}</a></p>
      </footer>

      <Dialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} title={s.privacyTitle} closeLabel={s.close}>
        {s.privacyBody.map((p) => <p key={p}>{p}</p>)}
      </Dialog>
    </div>
  );
}
