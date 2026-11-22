import { useRef, useState } from 'preact/hooks';
import type { CertificateInfo } from '@hilvana/core';
import type { Strings } from './i18n';
import type { Options } from './tools';

type Set = <K extends keyof Options>(key: K, value: Options[K]) => void;

export interface Certificate {
  name: string;
  status: 'chosen' | 'opening' | 'ready' | 'error';
  info?: CertificateInfo;
  error?: string;
}

const day = (d: Date, lang: string) => d.toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}{hint && <span class="hint check-hint">{hint}</span>}</span>
    </label>
  );
}

/** Choose a .p12/.pfx, open it with its password, and see who will sign before signing. */
export function CertificatePanel({ s, lang, cert, o, set, onChoose, onOpen }: {
  s: Strings;
  lang: string;
  cert: Certificate | null;
  o: Options;
  set: Set;
  onChoose: (file: File) => void;
  onOpen: (password: string) => void;
}) {
  const c = s.certify;
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const ready = cert?.status === 'ready' && cert.info;
  return (
    <div class="security">
      <div class="field">
        <span class="field-label">{c.file}</span>
        <div class="cert-row">
          {cert && <span class="cert-name">{cert.name}</span>}
          <button type="button" class="btn btn-quiet btn-small" onClick={() => input.current?.click()}>{cert ? c.change : c.choose}</button>
        </div>
        <input ref={input} type="file" class="visually-hidden" tabIndex={-1} aria-hidden="true" accept=".p12,.pfx,application/x-pkcs12"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) { setPassword(''); onChoose(f); }
          }} />
      </div>

      {cert && !ready && (
        <form class="file-password" onSubmit={(e) => { e.preventDefault(); if (password) onOpen(password); }}>
          <label for="cert-password">{c.password}</label>
          <div class="file-password-row">
            <input id="cert-password" type="password" autocomplete="off" value={password} aria-describedby="cert-password-hint"
              onInput={(e) => setPassword(e.currentTarget.value)} />
            <button type="submit" class="btn btn-thread btn-small" disabled={!password || cert.status === 'opening'}>
              {cert.status === 'opening' ? c.opening : c.open}
            </button>
          </div>
          {cert.error && <p class="file-error" role="alert">{cert.error}</p>}
          <p class="hint" id="cert-password-hint">{c.hint}</p>
        </form>
      )}

      {ready && (
        <div class="meta-list cert-card">
          <dl>
            <div><dt>{c.signer}</dt><dd>{cert.info!.name}</dd></div>
            <div><dt>{c.issuer}</dt><dd>{cert.info!.issuer}</dd></div>
            <div><dt>{c.validTo}</dt><dd>{day(new Date(cert.info!.validTo), lang)}</dd></div>
          </dl>
          {cert.info!.selfSigned && <p class="file-note">{c.selfSigned}</p>}
        </div>
      )}

      {ready && (
        <Check label={c.visible} hint={c.visibleHint} checked={o.certVisible} onChange={(v) => set('certVisible', v)} />
      )}
      {ready && (
        <div class="field-group">
          <div class="field">
            <label for="cert-reason">{c.reason}</label>
            <input id="cert-reason" type="text" value={o.certReason} placeholder={c.reasonPlaceholder} onInput={(e) => set('certReason', e.currentTarget.value)} />
          </div>
          <div class="field">
            <label for="cert-location">{c.location}</label>
            <input id="cert-location" type="text" value={o.certLocation} placeholder={c.locationPlaceholder} onInput={(e) => set('certLocation', e.currentTarget.value)} />
          </div>
        </div>
      )}
      {ready && <p class="hint">{c.noTimestamp}</p>}
    </div>
  );
}

/** A new password (typed twice) and the permissions the protected file keeps. */
export function ProtectPanel({ s, password, confirm, onPassword, onConfirm, o, set }: {
  s: Strings;
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  o: Options;
  set: Set;
}) {
  const p = s.protect;
  const mismatch = !!confirm && password !== confirm;
  return (
    <div class="security">
      <div class="field-group">
        <div class="field">
          <label for="new-password">{p.password}</label>
          <input id="new-password" type="password" autocomplete="new-password" value={password} aria-describedby="new-password-hint" onInput={(e) => onPassword(e.currentTarget.value)} />
          <p class="hint" id="new-password-hint">{p.hint}</p>
        </div>
        <div class="field">
          <label for="new-password-2">{p.confirm}</label>
          <input id="new-password-2" type="password" autocomplete="new-password" value={confirm} aria-invalid={mismatch} aria-describedby={mismatch ? 'new-password-2-error' : undefined} onInput={(e) => onConfirm(e.currentTarget.value)} />
          {mismatch && <p class="file-error" id="new-password-2-error">{p.mismatch}</p>}
        </div>
      </div>
      <fieldset class="checks">
        <legend>{p.permissions}</legend>
        <Check label={p.allowPrint} checked={o.allowPrint} onChange={(v) => set('allowPrint', v)} />
        <Check label={p.allowCopy} checked={o.allowCopy} onChange={(v) => set('allowCopy', v)} />
        <Check label={p.allowModify} checked={o.allowModify} onChange={(v) => set('allowModify', v)} />
        <p class="hint">{p.permissionsHint}</p>
      </fieldset>
    </div>
  );
}
