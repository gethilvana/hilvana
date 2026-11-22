import type { CertificateInfo, PdfInfo } from '@hilvana/core';
import type { Lang } from '@hilvana/recipes';

export type Kind = 'pdf' | 'word' | 'image' | 'certificate' | 'other';

export interface Output {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export type ToWorker =
  | { type: 'add'; id: string; name: string; bytes: Uint8Array; lang: Lang }
  | { type: 'remove'; id: string }
  | { type: 'unlock'; id: string; password: string; lang: Lang }
  | { type: 'run'; job: number; recipe: unknown; files: { id: string; name: string; password?: string }[]; lang: Lang }
  | { type: 'certificate'; job: number; id: string; password: string; lang: Lang }
  | { type: 'batch'; job: number; recipe: unknown; files: { id: string; name: string }[]; lang: Lang }
  | { type: 'describe'; job: number; recipe: unknown; lang: Lang };

export type FromWorker =
  | { type: 'added'; id: string; kind: Kind; info?: PdfInfo; preview?: Uint8Array; warnings?: string[]; error?: string; needsPassword?: boolean }
  | { type: 'done'; job: number; outputs: Output[]; notes: string[]; warnings: string[] }
  | { type: 'certificate'; job: number; info: CertificateInfo }
  | { type: 'described'; job: number; steps: string[] }
  | { type: 'failed'; job: number; error: string; code?: string };
