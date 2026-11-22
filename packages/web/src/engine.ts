import type { CertificateInfo, TextMatch } from '@hilvana/core';
import type { Lang } from '@hilvana/recipes';
import type { FromWorker, Output, ToWorker } from './protocol';

type Added = Extract<FromWorker, { type: 'added' }>;
export interface JobResult { outputs: Output[]; notes: string[]; warnings: string[] }

/** Talks to the processing worker. Bytes are transferred, never copied through anything else. */
export class Engine {
  private _worker?: Worker;
  private added = new Map<string, (m: Added) => void>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private jobs = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  private nextJob = 1;

  /** The engine (~1.4 MB) only loads when the first file is added. */
  private get worker(): Worker {
    if (this._worker) return this._worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    return (this._worker = w);
  }

  private receive(m: FromWorker) {
    if (m.type === 'added') {
      this.added.get(m.id)?.(m);
      this.added.delete(m.id);
      return;
    }
    const job = this.jobs.get(m.job);
    this.jobs.delete(m.job);
    if (!job) return;
    if (m.type === 'done') job.resolve({ outputs: m.outputs, notes: m.notes, warnings: m.warnings });
    else if (m.type === 'certificate') job.resolve(m.info);
    else if (m.type === 'described') job.resolve(m.steps);
    else if (m.type === 'found') job.resolve(m.matches);
    else job.reject(Object.assign(new Error(m.error), { code: m.code }));
  }

  private send(msg: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  add(id: string, name: string, bytes: Uint8Array, lang: Lang): Promise<Added> {
    return new Promise((resolve) => {
      this.added.set(id, resolve);
      this.send({ type: 'add', id, name, bytes, lang }, [bytes.buffer]);
    });
  }

  /** Opens a password-protected PDF already added under `id`. The password stays in this browser. */
  unlock(id: string, password: string, lang: Lang): Promise<Added> {
    return new Promise((resolve) => {
      this.added.set(id, resolve);
      this.send({ type: 'unlock', id, password, lang });
    });
  }

  remove(id: string) {
    if (this._worker) this.send({ type: 'remove', id });
  }

  private job<T = JobResult>(build: (job: number) => ToWorker): Promise<T> {
    const job = this.nextJob++;
    return new Promise((resolve, reject) => {
      this.jobs.set(job, { resolve, reject });
      this.send(build(job));
    });
  }

  /** Passwords in `files` (certificates) are used inside the worker only, never stored. */
  run(recipe: unknown, files: { id: string; name: string; password?: string }[], lang: Lang) {
    return this.job((job) => ({ type: 'run', job, recipe, files, lang }));
  }

  /** Runs the recipe on each document separately; documents that fail are reported in `warnings`. */
  batch(recipe: unknown, files: { id: string; name: string }[], lang: Lang) {
    return this.job((job) => ({ type: 'batch', job, recipe, files, lang }));
  }

  /** Finds text to redact in a file already added under `id`. */
  find(id: string, terms: string[], patterns: string[], lang: Lang) {
    return this.job<TextMatch[]>((job) => ({ type: 'find', job, id, terms, patterns, lang }));
  }

  /** Validates a recipe and describes its steps, without any file. */
  describe(recipe: unknown, lang: Lang) {
    return this.job<string[]>((job) => ({ type: 'describe', job, recipe, lang }));
  }

  /** Opens a certificate already added under `id`, to show who will sign. */
  certificate(id: string, password: string, lang: Lang) {
    return this.job<CertificateInfo>((job) => ({ type: 'certificate', job, id, password, lang }));
  }
}
