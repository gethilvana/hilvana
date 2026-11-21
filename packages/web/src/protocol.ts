import type { PdfInfo } from '@hilvana/core';
import type { Lang } from '@hilvana/recipes';

export type Kind = 'pdf' | 'word' | 'image' | 'other';

export interface Output {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export type ToWorker =
  | { type: 'add'; id: string; name: string; bytes: Uint8Array; lang: Lang }
  | { type: 'remove'; id: string }
  | { type: 'run'; job: number; recipe: unknown; files: { id: string; name: string }[]; lang: Lang };

export type FromWorker =
  | { type: 'added'; id: string; kind: Kind; info?: PdfInfo; preview?: Uint8Array; warnings?: string[]; error?: string }
  | { type: 'done'; job: number; outputs: Output[]; notes: string[]; warnings: string[] }
  | { type: 'failed'; job: number; error: string };
