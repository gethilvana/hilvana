import { useEffect, useMemo, useState } from 'preact/hooks';
import { zipSync } from 'fflate';
import type { Strings } from './i18n';
import type { Output } from './protocol';
import { openPreview } from './thumbs';
import { formatSize } from './ui';

export interface Result {
  outputs: Output[];
  notes: string[];
  warnings: string[];
  recipe?: unknown;
  /** The recipe ran once per input file (Word batch). */
  recipeEach?: boolean;
  zipName?: string;
}

function useObjectUrl(bytes: Uint8Array, type: string) {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes as BlobPart], { type })), [bytes, type]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

function OutputRow({ s, out }: { s: Strings; out: Output }) {
  const url = useObjectUrl(out.bytes, 'application/pdf');
  const [thumb, setThumb] = useState<string>();
  useEffect(() => {
    let live = true;
    let destroy: (() => void) | undefined;
    // Previews are optional: if the result goes away while one is still drawing, pdf.js cancels it.
    openPreview(out.bytes.slice())
      .then(async (p) => {
        if (!live) return p.destroy();
        destroy = p.destroy;
        const u = await p.page(1, 64);
        if (live) setThumb(u);
      })
      .catch(() => undefined);
    return () => { live = false; destroy?.(); };
  }, [out.bytes]);
  return (
    <li class="file output">
      <span class="thumb">{thumb ? <img src={thumb} alt="" /> : <span class="thumb-blank" />}</span>
      <div class="file-main">
        <span class="file-name">{out.name}</span>
        <span class="file-meta">{[s.result.pages(out.pageCount), formatSize(out.bytes.byteLength)].join(', ')}</span>
      </div>
      <a class="btn btn-thread" href={url} download={out.name}>{s.result.download}</a>
    </li>
  );
}

function ZipLink({ s, outputs, name }: { s: Strings; outputs: Output[]; name: string }) {
  const zip = useMemo(() => zipSync(Object.fromEntries(outputs.map((o) => [o.name, [o.bytes, { level: 0 }] as [Uint8Array, { level: 0 }]]))), [outputs]);
  const url = useObjectUrl(zip, 'application/zip');
  return <a class="btn btn-primary" href={url} download={name}>{s.result.downloadZip}</a>;
}

/** Save the recipe of this result for later, in this browser, under a name the person chooses. */
function SaveRecipe({ s, defaultName, onSave }: { s: Strings; defaultName: string; onSave: (name: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  if (status?.ok) return <p class="hint" role="status">{status.text}</p>;
  if (!open) return <button type="button" class="btn btn-quiet" onClick={() => setOpen(true)}>{s.saved.save}</button>;
  return (
    <form class="save-recipe" onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim()) return;
      const ok = onSave(name.trim());
      setStatus({ ok, text: ok ? s.saved.savedOk(name.trim()) : s.saved.saveFailed });
    }}>
      <label for="recipe-name">{s.saved.saveName}</label>
      <div class="file-password-row">
        <input id="recipe-name" type="text" maxLength={120} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button type="submit" class="btn btn-thread btn-small" disabled={!name.trim()}>{s.saved.saveAction}</button>
      </div>
      {status && !status.ok && <p class="file-error" role="alert">{status.text}</p>}
    </form>
  );
}

export function ResultPanel({ s, result, onReset, save }: {
  s: Strings;
  result: Result;
  onReset: () => void;
  /** Offered when the recipe can be saved; `blocked` explains why it cannot. */
  save?: { defaultName: string; onSave: (name: string) => boolean } | { blocked: true };
}) {
  const [copied, setCopied] = useState(false);
  const json = result.recipe ? JSON.stringify(result.recipe, null, 2) : '';
  return (
    <section class="result" aria-labelledby="result-title" tabIndex={-1} id="result">
      <h2 id="result-title">{s.result.title}</h2>
      <ol class="files">{result.outputs.map((o) => <OutputRow key={o.name} s={s} out={o} />)}</ol>
      {result.outputs.length > 1 && <ZipLink s={s} outputs={result.outputs} name={result.zipName ?? 'hilvana.zip'} />}
      {result.notes.length > 0 && <ul class="notes">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {result.warnings.length > 0 && (
        <ul class="notes notes-warn">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {json && (
        <details class="recipe">
          <summary>{s.result.recipe}</summary>
          <p class="hint">{(result.recipeEach ? s.result.recipeEachHint : s.result.recipeHint).split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</p>
          <pre><code>{json}</code></pre>
          <button type="button" class="btn btn-quiet btn-small" onClick={async () => {
            try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
          }}>{copied ? s.result.copied : s.result.copy}</button>
        </details>
      )}
      {save && ('blocked' in save ? <p class="hint">{s.saved.cannotSave}</p> : <SaveRecipe s={s} defaultName={save.defaultName} onSave={save.onSave} />)}
      <button type="button" class="btn btn-quiet" onClick={onReset}>{s.result.again}</button>
    </section>
  );
}
