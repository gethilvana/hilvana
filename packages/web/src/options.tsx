import { useEffect, useRef, useState } from 'preact/hooks';
import type { Strings } from './i18n';
import type { Preview } from './thumbs';
import type { Anchor, Options, PagesChoice } from './tools';

type Set = <K extends keyof Options>(key: K, value: Options[K]) => void;

let uid = 0;
const useId = () => useRef(`f${++uid}`).current;

function Field({ label, hint, children, id }: { label: string; hint?: preact.ComponentChildren; children: preact.ComponentChildren; id: string }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {hint && <p class="hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <Field label={label} id={id}>
      <select id={id} value={String(value)} onChange={(e) => {
        const raw = e.currentTarget.value;
        const match = options.find(([v]) => String(v) === raw);
        if (match) onChange(match[0]);
      }}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </Field>
  );
}

function Text({ label, value, hint, onChange, placeholder }: { label: string; value: string; hint?: preact.ComponentChildren; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <input id={id} type="text" value={value} placeholder={placeholder} aria-describedby={hint ? `${id}-hint` : undefined} onInput={(e) => onChange(e.currentTarget.value)} />
    </Field>
  );
}

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <Field label={`${label}: ${format(value)}`} id={id}>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number(e.currentTarget.value))} />
    </Field>
  );
}

function PagesHint({ s }: { s: Strings }) {
  return <>{s.pagesHintLabel} {s.pagesHint.map((h, i) => <span key={h}>{i > 0 && ', '}<code>{h}</code></span>)}</>;
}

function PagesField({ s, value, onChange }: { s: Strings; value: PagesChoice; onChange: (v: PagesChoice) => void }) {
  const f = s.fields;
  return (
    <div class="field-group">
      <Select<PagesChoice['mode']> label={f.pages} value={value.mode} onChange={(mode) => onChange({ ...value, mode })}
        options={[['all', f.allPages], ['first', f.firstPage], ['last', f.lastPage], ['custom', f.custom]]} />
      {value.mode === 'custom' && <Text label={f.custom} value={value.custom} placeholder="1-3,5" hint={<PagesHint s={s} />} onChange={(custom) => onChange({ ...value, custom })} />}
    </div>
  );
}

function AnchorField({ s, value, onChange, allowCenter }: { s: Strings; value: Anchor; onChange: (v: Anchor) => void; allowCenter?: boolean }) {
  const anchors = (Object.keys(s.anchors) as Anchor[]).filter((a) => allowCenter || a !== 'center');
  return <Select<Anchor> label={s.fields.position} value={value} options={anchors.map((a) => [a, s.anchors[a]])} onChange={onChange} />;
}

/** Page thumbnails for arranging (remove, reorder) or choosing pages to rotate. */
export function PageGrid({ s, preview, mode, o, set }: { s: Strings; preview: Preview; mode: 'arrange' | 'rotate'; o: Options; set: Set }) {
  const total = preview.pageCount;
  const all = Array.from({ length: total }, (_, i) => i + 1);
  const [order, setOrder] = useState<number[]>(o.pagesOrder ? [...o.pagesOrder, ...all.filter((p) => !o.pagesOrder!.includes(p))] : all);
  const kept = o.pagesOrder ?? all;
  const removed = new globalThis.Set(order.filter((p) => !kept.includes(p)));
  const [dragging, setDragging] = useState<number | null>(null);

  const commit = (nextOrder: number[], nextRemoved: globalThis.Set<number>) => {
    setOrder(nextOrder);
    const keep = nextOrder.filter((p) => !nextRemoved.has(p));
    set('pagesOrder', keep.length === total && keep.every((p, i) => p === i + 1) ? null : keep);
  };
  const move = (page: number, to: number) => {
    const next = order.filter((p) => p !== page);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, page);
    commit(next, removed);
  };

  return (
    <div class="grid-wrap">
      <div class="grid-head">
        <p class="hint">{mode === 'arrange' ? s.grid.help : s.grid.rotateHelp}</p>
        {mode === 'arrange' && <p class="grid-summary" aria-live="polite">{s.grid.summary(total - removed.size, total)}</p>}
        {((mode === 'arrange' && o.pagesOrder) || (mode === 'rotate' && o.rotatePages.length > 0)) && (
          <button type="button" class="btn btn-quiet btn-small" onClick={() => {
            if (mode === 'arrange') { setOrder(all); set('pagesOrder', null); } else set('rotatePages', []);
          }}>{s.grid.restore}</button>
        )}
      </div>
      <ol class="grid">
        {order.map((page, i) => {
          const isRemoved = mode === 'arrange' && removed.has(page);
          const isChosen = mode === 'rotate' && o.rotatePages.includes(page);
          const rotated = mode === 'rotate' && (isChosen || o.rotatePages.length === 0);
          return (
            <li
              key={page}
              class={`page ${isRemoved ? 'is-removed' : ''} ${isChosen ? 'is-chosen' : ''} ${dragging === page ? 'is-dragging' : ''}`}
              draggable={mode === 'arrange'}
              onDragStart={(e) => { setDragging(page); e.dataTransfer?.setData('text/plain', String(page)); }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { if (dragging !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragging !== null && dragging !== page) move(dragging, order.indexOf(page)); setDragging(null); }}
            >
              <button
                type="button"
                class="page-toggle"
                aria-pressed={mode === 'arrange' ? isRemoved : isChosen}
                aria-label={`${s.grid.page(page)}${isRemoved ? `, ${s.grid.removed}` : ''}${isChosen ? `, ${s.grid.selected}` : ''}`}
                onClick={() => {
                  if (mode === 'arrange') {
                    const next = new globalThis.Set(removed);
                    if (next.has(page)) next.delete(page); else next.add(page);
                    if (next.size === total) return; // a document needs at least one page
                    commit(order, next);
                  } else {
                    set('rotatePages', isChosen ? o.rotatePages.filter((p) => p !== page) : [...o.rotatePages, page]);
                  }
                }}
              >
                <PageImage preview={preview} page={page} turn={rotated ? o.angle : 0} />
                {isRemoved && <span class="page-flag">{s.grid.removed}</span>}
              </button>
              <span class="page-foot">
                {mode === 'arrange' && <button type="button" class="icon-btn icon-btn-small" disabled={i === 0} aria-label={s.grid.moveLeft(page)} onClick={() => move(page, i - 1)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5z" /></svg>
                </button>}
                <span class="page-num">{page}</span>
                {mode === 'arrange' && <button type="button" class="icon-btn icon-btn-small" disabled={i === order.length - 1} aria-label={s.grid.moveRight(page)} onClick={() => move(page, i + 1)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3 10.5 8l-5 5z" /></svg>
                </button>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PageImage({ preview, page, turn }: { preview: Preview; page: number; turn: number }) {
  const [url, setUrl] = useState<string>();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let live = true;
    const el = ref.current;
    if (!el) return;
    // Only draw pages as they scroll into view.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        preview.page(page, 132).then((u) => live && setUrl(u), () => undefined);
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [preview, page]);
  return <span ref={ref} class={`page-img ${turn % 180 ? 'is-quarter' : ''}`} style={turn ? `--turn:${turn}deg` : undefined}>{url ? <img src={url} alt="" /> : null}</span>;
}

/** Draw a signature, or pick an image. Produces a transparent PNG trimmed to the ink. */
export function SignaturePad({ s, onChange }: { s: Strings; onChange: (png: Uint8Array | null) => void }) {
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [uploaded, setUploaded] = useState<string>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c || mode !== 'draw') return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1c2f6b';
  }, [mode]);

  const point = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const exportPng = () => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return onChange(null);
    const pad = 6;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1 + pad * 2;
    out.height = y1 - y0 + 1 + pad * 2;
    out.getContext('2d')!.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
    out.toBlob((b) => b && b.arrayBuffer().then((buf) => onChange(new Uint8Array(buf))), 'image/png');
  };

  return (
    <div class="field signature">
      <div class="segmented" role="group" aria-label={s.signature.chosen}>
        <button type="button" aria-pressed={mode === 'draw'} onClick={() => { setMode('draw'); setUploaded(undefined); onChange(null); }}>{s.signature.draw}</button>
        <button type="button" aria-pressed={mode === 'upload'} onClick={() => { setMode('upload'); onChange(null); }}>{s.signature.upload}</button>
      </div>
      {mode === 'draw' ? (
        <>
          <canvas
            ref={canvas}
            class="signature-pad"
            role="img"
            aria-label={s.signature.canvas}
            onPointerDown={(e) => {
              const [x, y] = point(e);
              const ctx = canvas.current!.getContext('2d')!;
              canvas.current!.setPointerCapture(e.pointerId);
              drawing.current = true;
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x + 0.1, y + 0.1);
              ctx.stroke();
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const [x, y] = point(e);
              const ctx = canvas.current!.getContext('2d')!;
              ctx.lineTo(x, y);
              ctx.stroke();
              dirty.current = true;
            }}
            onPointerUp={() => { if (drawing.current) { drawing.current = false; exportPng(); } }}
          />
          <div class="signature-foot">
            <p class="hint">{s.signature.hint}</p>
            <button type="button" class="btn btn-quiet btn-small" onClick={() => {
              const c = canvas.current!;
              c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
              dirty.current = false;
              onChange(null);
            }}>{s.signature.clear}</button>
          </div>
        </>
      ) : (
        <div class="signature-upload">
          <input type="file" accept="image/png,image/jpeg" aria-label={s.signature.upload} onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            if (!f) return;
            const bytes = new Uint8Array(await f.arrayBuffer());
            if (uploaded) URL.revokeObjectURL(uploaded);
            setUploaded(URL.createObjectURL(f));
            onChange(bytes);
          }} />
          {uploaded && <img class="signature-preview" src={uploaded} alt={s.signature.chosen} />}
        </div>
      )}
    </div>
  );
}

export function ToolOptions({ s, tool, o, set }: { s: Strings; tool: string; o: Options; set: Set }) {
  const f = s.fields;
  switch (tool) {
    case 'rotate':
      return <Select<90 | 180 | 270> label={f.angle} value={o.angle} onChange={(v) => set('angle', v)} options={[[90, s.angles[90]], [180, s.angles[180]], [270, s.angles[270]]]} />;
    case 'split':
      return (
        <div class="field-group">
          <Select<'each' | 'ranges'> label={f.splitMode} value={o.splitMode} onChange={(v) => set('splitMode', v)} options={[['each', s.split.each], ['ranges', s.split.ranges]]} />
          {o.splitMode === 'ranges' && <Text label={f.ranges} value={o.ranges} placeholder="1-3; 4-last" hint={f.rangesHint} onChange={(v) => set('ranges', v)} />}
        </div>
      );
    case 'images':
      return <Select<Options['pageSize']> label={f.pageSize} value={o.pageSize} onChange={(v) => set('pageSize', v)} options={[['image', s.pageSizes.image], ['a4', s.pageSizes.a4], ['letter', s.pageSizes.letter]]} />;
    case 'sign':
      return (
        <div class="field-group">
          <PagesField s={s} value={o.signPages} onChange={(v) => set('signPages', v)} />
          <AnchorField s={s} value={o.signAnchor} onChange={(v) => set('signAnchor', v)} allowCenter />
          <Range label={f.width} value={o.signWidth} min={60} max={300} step={10} format={(v) => `${v} pt`} onChange={(v) => set('signWidth', v)} />
        </div>
      );
    case 'stamp':
      return (
        <div class="field-group">
          <Text label={f.text} value={o.stampText} hint={s.stampHint} onChange={(v) => set('stampText', v)} />
          <PagesField s={s} value={o.stampPages} onChange={(v) => set('stampPages', v)} />
          <AnchorField s={s} value={o.stampAnchor} onChange={(v) => set('stampAnchor', v)} allowCenter />
          <Range label={f.size} value={o.stampSize} min={7} max={36} step={1} format={(v) => `${v} pt`} onChange={(v) => set('stampSize', v)} />
        </div>
      );
    case 'number':
      return (
        <div class="field-group">
          <Text label={f.format} value={o.numberFormat} hint={s.numberHint} onChange={(v) => set('numberFormat', v)} />
          <AnchorField s={s} value={o.numberAnchor} onChange={(v) => set('numberAnchor', v)} />
        </div>
      );
    case 'watermark':
      return (
        <div class="field-group">
          <Text label={f.text} value={o.watermarkText} onChange={(v) => set('watermarkText', v)} />
          <Range label={f.opacity} value={o.watermarkOpacity} min={0.05} max={0.6} step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set('watermarkOpacity', v)} />
        </div>
      );
    case 'compress':
      return (
        <div class="field-group">
          <Select<Options['level']> label={f.level} value={o.level} onChange={(v) => set('level', v)}
            options={[['balanced', s.levels.balanced], ['strong', s.levels.strong], ['max', s.levels.max], ['lossless', s.levels.lossless], ['target', s.levels.target]]} />
          {o.level === 'target' && <Range label={f.target} value={o.targetMB} min={0.5} max={20} step={0.5} format={(v) => `${v} MB`} onChange={(v) => set('targetMB', v)} />}
        </div>
      );
    default:
      return null;
  }
}
