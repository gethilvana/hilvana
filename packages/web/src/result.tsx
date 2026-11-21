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

export function ResultPanel({ s, result, onReset }: { s: Strings; result: Result; onReset: () => void }) {
  const [copied, setCopied] = useState(false);
  const json = result.recipe ? JSON.stringify(result.recipe, null, 2) : '';
  return (
    <section class="result" aria-labelledby="result-title" tabIndex={-1} id="result">
      <h2 id="result-title">{s.result.title}</h2>
      <ol class="files">{result.outputs.map((o) => <OutputRow key={o.name} s={s} out={o} />)}</ol>
      {result.outputs.length > 1 && <ZipLink s={s} outputs={result.outputs} name={result.zipName ?? 'hilvana.zip'} />}
      {result.notes.length > 0 && <ul class="notes">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {result.warnings.length > 0 && (
        <details class="file-warnings">
          <summary>{s.result.warnings}</summary>
          <ul>{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
      {json && (
        <details class="recipe">
          <summary>{s.result.recipe}</summary>
          <p class="hint">{s.result.recipeHint.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</p>
          <pre><code>{json}</code></pre>
          <button type="button" class="btn btn-quiet btn-small" onClick={async () => {
            try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
          }}>{copied ? s.result.copied : s.result.copy}</button>
        </details>
      )}
      <button type="button" class="btn btn-quiet" onClick={onReset}>{s.result.again}</button>
    </section>
  );
}
