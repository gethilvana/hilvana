import { useEffect, useRef, useState } from 'preact/hooks';
import type { PdfInfo } from '@hilvana/core';
import type { Strings } from './i18n';
import type { Kind } from './protocol';
import type { Preview } from './thumbs';
import { FILE_INPUT_ACCEPT, type Tool } from './tools';
import { Stitch, formatSize } from './ui';

export interface Doc {
  id: string;
  name: string;
  size: number;
  status: 'reading' | 'ready' | 'error';
  kind?: Kind;
  info?: PdfInfo;
  preview?: Preview;
  /** Kept for images, so they can be shown without pdf.js. */
  imageUrl?: string;
  warnings?: string[];
  error?: string;
}

export function DropZone({ s, tool, compact, onFiles }: { s: Strings; tool: Tool; compact: boolean; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accepts = { docs: s.accepts.pdfWord, word: s.accepts.word, images: s.accepts.images }[tool.accept];
  return (
    <div
      class={`drop ${over ? 'is-over' : ''} ${compact ? 'is-compact' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...(e.dataTransfer?.files ?? [])]);
      }}
    >
      <svg class="drop-frame" aria-hidden="true"><rect x="1.5" y="1.5" rx="14" /></svg>
      {compact ? (
        <button type="button" class="btn btn-quiet" onClick={() => input.current?.click()}>{s.drop.again}</button>
      ) : (
        <>
          <p class="drop-title">{s.drop.title}</p>
          <p class="drop-sub">
            {s.drop.or}{' '}
            <button type="button" class="btn btn-thread" onClick={() => input.current?.click()}>{s.drop.choose}</button>
          </p>
          <p class="drop-accepts">{tool.single ? (tool.accept === 'docs' ? s.accepts.one : accepts) : accepts}</p>
        </>
      )}
      <input
        ref={input}
        type="file"
        class="visually-hidden"
        accept={FILE_INPUT_ACCEPT[tool.accept]}
        multiple={!tool.single}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const el = e.currentTarget;
          onFiles([...(el.files ?? [])]);
          el.value = '';
        }}
      />
    </div>
  );
}

function Thumb({ doc }: { doc: Doc }) {
  const [url, setUrl] = useState<string | undefined>(doc.imageUrl);
  useEffect(() => {
    let live = true;
    if (doc.preview) doc.preview.page(1, 64).then((u) => live && setUrl(u), () => undefined);
    return () => { live = false; };
  }, [doc.preview]);
  return <span class="thumb">{url ? <img src={url} alt="" /> : <span class="thumb-blank" />}</span>;
}

export function FileList({ s, docs, ordered, wrongKind, onRemove, onMove }: {
  s: Strings;
  docs: Doc[];
  ordered: boolean;
  wrongKind: (d: Doc) => boolean;
  onRemove: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
}) {
  if (!docs.length) return null;
  return (
    <ol class={`files ${ordered && docs.length > 1 ? 'is-stitched' : ''}`}>
      {ordered && docs.length > 1 && <Stitch vertical class="files-stitch" />}
      {docs.map((d, i) => {
        const bad = d.status === 'ready' && wrongKind(d);
        return (
          <li key={d.id} class={`file ${bad || d.status === 'error' ? 'is-bad' : ''}`}>
            <Thumb doc={d} />
            <div class="file-main">
              <span class="file-name">{d.name}</span>
              <span class="file-meta">
                {d.status === 'reading' && s.file.reading}
                {d.status === 'ready' && [
                  d.info ? s.file.pages(d.info.pageCount) : null,
                  formatSize(d.size),
                  d.kind === 'word' ? s.file.converted : null,
                ].filter(Boolean).join(', ')}
              </span>
              {d.status === 'error' && <span class="file-error" role="alert">{d.error}</span>}
              {bad && <span class="file-error">{s.file.wrongKind}</span>}
              {!bad && d.info && d.info.signatures > 0 && <span class="file-note">{s.file.signed}</span>}
              {d.warnings && d.warnings.length > 0 && (
                <details class="file-warnings">
                  <summary>{s.result.warnings}</summary>
                  <ul>{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </details>
              )}
            </div>
            <div class="file-actions">
              {ordered && docs.length > 1 && (
                <>
                  <button type="button" class="icon-btn" disabled={i === 0} aria-label={s.file.up(d.name)} title={s.file.up(d.name)} onClick={() => onMove(d.id, -1)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5 3.5 8h3V12.5h3V8h3z" /></svg>
                  </button>
                  <button type="button" class="icon-btn" disabled={i === docs.length - 1} aria-label={s.file.down(d.name)} title={s.file.down(d.name)} onClick={() => onMove(d.id, 1)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5 12.5 8h-3V3.5h-3V8h-3z" /></svg>
                  </button>
                </>
              )}
              <button type="button" class="icon-btn" aria-label={s.file.remove(d.name)} title={s.file.remove(d.name)} onClick={() => onRemove(d.id)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 3 3 4.2 6.8 8 3 11.8 4.2 13 8 9.2l3.8 3.8 1.2-1.2L9.2 8 13 4.2 11.8 3 8 6.8z" /></svg>
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
