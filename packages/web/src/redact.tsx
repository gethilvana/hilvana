import { useEffect, useRef, useState } from 'preact/hooks';
import type { TextMatch } from '@hilvana/core';
import type { Lang } from '@hilvana/recipes';
import type { Engine } from './engine';
import type { Strings } from './i18n';
import type { PageGeometry, Preview } from './thumbs';
import { redactTerms, type Options, type RedactArea, type RedactPattern } from './tools';

type Set = <K extends keyof Options>(key: K, value: Options[K]) => void;
const PATTERNS: RedactPattern[] = ['number', 'card', 'email', 'phone'];

/** A rectangle in PDF points, as a box in view coordinates (y down, scale 1). */
function toView(g: PageGeometry, a: { x: number; y: number; width: number; height: number }) {
  const [x0, y0] = g.toView(a.x, a.y);
  const [x1, y1] = g.toView(a.x + a.width, a.y + a.height);
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** One page, large, with the matches outlined and the drawn areas filled; drag to draw. */
function PageCanvas({ s, preview, page, matches, areas, onDraw }: {
  s: Strings;
  preview: Preview;
  page: number;
  matches: TextMatch[];
  areas: { area: RedactArea; index: number }[];
  onDraw: (a: RedactArea) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<PageGeometry>();
  const [url, setUrl] = useState<string>();
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    preview.geometry(page).then((g) => live && setGeo(g), () => undefined);
    preview.page(page, 720).then((u) => live && setUrl(u), () => undefined);
    return () => { live = false; };
  }, [preview, page]);

  // Pointer position in view coordinates (points, y down).
  const at = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const k = geo!.width / r.width;
    return { x: Math.max(0, Math.min(geo!.width, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(geo!.height, (e.clientY - r.top) * k)) };
  };
  const pct = (v: { left: number; top: number; width: number; height: number }) => geo && ({
    left: `${(v.left / geo.width) * 100}%`, top: `${(v.top / geo.height) * 100}%`,
    width: `${(v.width / geo.width) * 100}%`, height: `${(v.height / geo.height) * 100}%`,
  });

  return (
    <div
      ref={box}
      class="redact-page"
      role="img"
      aria-label={s.redact.canvas(page)}
      style={geo ? { aspectRatio: `${geo.width} / ${geo.height}` } : undefined}
      onPointerDown={(e) => {
        if (!geo || e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const p = at(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => { if (drag) { const p = at(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
      onPointerUp={() => {
        if (!drag || !geo) return;
        setDrag(null);
        if (Math.abs(drag.x1 - drag.x0) < 4 || Math.abs(drag.y1 - drag.y0) < 4) return; // a tap, not a box
        const [ax, ay] = geo.toPdf(drag.x0, drag.y0);
        const [bx, by] = geo.toPdf(drag.x1, drag.y1);
        onDraw({ page, x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) });
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span class="thumb-blank" />}
      {geo && matches.flatMap((m) => m.areas).map((a, i) => <span key={`m${i}`} class="redact-match" style={pct(toView(geo, a))} />)}
      {geo && areas.map(({ area, index }) => <span key={`a${index}`} class="redact-area" style={pct(toView(geo, area))}><span class="redact-area-n">{index + 1}</span></span>)}
      {drag && pct({ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }) && (
        <span class="redact-area is-drawing" style={pct({ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) })} />
      )}
    </div>
  );
}

export function RedactPanel({ s, lang, engine, docId, preview, o, set }: {
  s: Strings;
  lang: Lang;
  engine: Engine;
  docId: string;
  preview?: Preview;
  o: Options;
  set: Set;
}) {
  const r = s.redact;
  const [matches, setMatches] = useState<TextMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);
  const terms = redactTerms(o);
  const key = JSON.stringify([docId, terms, o.redactPatterns]);

  // Search as the person types, a moment after they stop.
  useEffect(() => {
    if (!terms.length && !o.redactPatterns.length) { setMatches(null); return; }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      engine.find(docId, terms, o.redactPatterns, lang)
        .then((m) => { if (live) setMatches(m); }, () => { if (live) setMatches([]); })
        .finally(() => { if (live) setSearching(false); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [key]);

  const total = preview?.pageCount ?? 1;
  const pagesWith = [...new Set((matches ?? []).map((m) => m.page))].sort((a, b) => a - b);
  return (
    <div class="security redact">
      <p class="hint">{r.how}</p>
      <div class="field-group">
        <div class="field">
          <label for="redact-terms">{r.terms}</label>
          <textarea id="redact-terms" rows={3} value={o.redactTerms} aria-describedby="redact-terms-hint" autocomplete="off" spellcheck={false}
            onInput={(e) => set('redactTerms', e.currentTarget.value)} />
          <p class="hint" id="redact-terms-hint">{r.termsHint}</p>
        </div>
        <fieldset class="checks">
          <legend>{r.patterns}</legend>
          {PATTERNS.map((p) => (
            <label key={p} class="check">
              <input type="checkbox" checked={o.redactPatterns.includes(p)} onChange={(e) => {
                const on = e.currentTarget.checked;
                set('redactPatterns', on ? [...o.redactPatterns, p] : o.redactPatterns.filter((x) => x !== p));
              }} />
              <span>{r[p]}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <p class="redact-status" role="status">
        {searching ? r.searching : matches ? r.found(matches.length, pagesWith.join(', ')) : ''}
      </p>
      {matches && matches.length > 0 && (
        <details class="file-warnings">
          <summary>{r.list}</summary>
          <ul>{matches.map((m, i) => <li key={i}><button type="button" class="link-button" onClick={() => setPage(m.page)}>{s.redact.page(m.page, total)}</button>: {m.text}</li>)}</ul>
        </details>
      )}

      {preview && (
        <div class="redact-viewer">
          <p class="hint">{r.draw}</p>
          <div class="redact-nav">
            <button type="button" class="btn btn-quiet btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={r.prev}>‹</button>
            <span aria-live="polite">{r.page(page, total)}</span>
            <button type="button" class="btn btn-quiet btn-small" disabled={page >= total} onClick={() => setPage(page + 1)} aria-label={r.next}>›</button>
          </div>
          <PageCanvas s={s} preview={preview} page={page}
            matches={(matches ?? []).filter((m) => m.page === page)}
            areas={o.redactAreas.map((area, index) => ({ area, index })).filter((x) => x.area.page === page)}
            onDraw={(a) => set('redactAreas', [...o.redactAreas, a])} />
          {o.redactAreas.length > 0 && (
            <div class="redact-areas">
              <span class="field-label">{r.areas}</span>
              <ul>
                {o.redactAreas.map((a, i) => (
                  <li key={i}>
                    <button type="button" class="link-button" onClick={() => setPage(a.page)}>{r.area(i + 1, a.page)}</button>
                    <button type="button" class="icon-btn" aria-label={r.removeArea(i + 1, a.page)} title={r.removeArea(i + 1, a.page)}
                      onClick={() => set('redactAreas', o.redactAreas.filter((_, j) => j !== i))}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 3 3 4.2 6.8 8 3 11.8 4.2 13 8 9.2l3.8 3.8 1.2-1.2L9.2 8 13 4.2 11.8 3 8 6.8z" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
