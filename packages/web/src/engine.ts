import type { Lang } from '@hilvana/recipes';
import type { FromWorker, Output, ToWorker } from './protocol';

type Added = Extract<FromWorker, { type: 'added' }>;
export interface JobResult { outputs: Output[]; notes: string[]; warnings: string[] }

/** Talks to the processing worker. Bytes are transferred, never copied through anything else. */
export class Engine {
  private _worker?: Worker;
  private added = new Map<string, (m: Added) => void>();
  private jobs = new Map<number, { resolve: (r: JobResult) => void; reject: (e: Error) => void }>();
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
    else job.reject(new Error(m.error));
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

  remove(id: string) {
    if (this._worker) this.send({ type: 'remove', id });
  }

  private job(build: (job: number) => ToWorker): Promise<JobResult> {
    const job = this.nextJob++;
    return new Promise((resolve, reject) => {
      this.jobs.set(job, { resolve, reject });
      this.send(build(job));
    });
  }

  run(recipe: unknown, files: { id: string; name: string }[], lang: Lang) {
    return this.job((job) => ({ type: 'run', job, recipe, files, lang }));
  }
}
