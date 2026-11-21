import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Strings } from './i18n';

/** The basting stitch: Hilvana's one visual signature. */
export function Stitch({ vertical, running, class: cls }: { vertical?: boolean; running?: boolean; class?: string }) {
  return (
    <svg class={`stitch ${vertical ? 'stitch-v' : 'stitch-h'} ${running ? 'is-running' : ''} ${cls ?? ''}`} aria-hidden="true" preserveAspectRatio="none" viewBox={vertical ? '0 0 4 100' : '0 0 100 4'}>
      {vertical ? <line x1="2" y1="0" x2="2" y2="100" /> : <line x1="0" y1="2" x2="100" y2="2" />}
    </svg>
  );
}

export function Wordmark() {
  return (
    <span class="wordmark">
      Hilvana
      <svg class="wordmark-stitch" aria-hidden="true" viewBox="0 0 120 8" preserveAspectRatio="none">
        <path d="M2 5 Q 30 1, 60 4 T 118 3" />
      </svg>
    </span>
  );
}

export function Dialog({ open, onClose, title, children, closeLabel }: { open: boolean; onClose: () => void; title: string; children: ComponentChildren; closeLabel: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="dialog" onClose={onClose} aria-labelledby="dialog-title">
      <h2 id="dialog-title">{title}</h2>
      {children}
      <form method="dialog">
        <button class="btn btn-quiet">{closeLabel}</button>
      </form>
    </dialog>
  );
}

export function PrivacyNote({ s, onOpen }: { s: Strings; onOpen: () => void }) {
  return (
    <p class="privacy">
      <svg aria-hidden="true" viewBox="0 0 16 16" class="privacy-icon"><path d="M8 1.5 2.5 4v4c0 3.2 2.3 5.6 5.5 6.5 3.2-.9 5.5-3.3 5.5-6.5V4z" /></svg>
      <span>{s.privacy}</span>
      <button type="button" class="link" onClick={onOpen}>{s.privacyLink}</button>
    </p>
  );
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
