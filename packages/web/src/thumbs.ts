// Page previews drawn with pdf.js, entirely in the browser. Only used for looking at pages:
// every change to a document goes through the Hilvana engine in the worker.
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const assets = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

/** A page's size in points and conversions between view and PDF coordinates (view: scale 1, y down). */
export interface PageGeometry {
  width: number;
  height: number;
  toPdf(x: number, y: number): [number, number];
  toView(x: number, y: number): [number, number];
}

export interface Preview {
  pageCount: number;
  geometry(n: number): Promise<PageGeometry>;
  /** Object URL of a PNG of the page, at roughly `width` CSS pixels. */
  page(n: number, width: number): Promise<string>;
  destroy(): void;
}

// One page at a time keeps memory flat on phones, even with long documents.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export async function openPreview(bytes: Uint8Array): Promise<Preview> {
  const task = getDocument({
    data: bytes,
    cMapUrl: assets('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assets('standard_fonts'),
    wasmUrl: assets('wasm'),
    iccUrl: assets('iccs'),
    enableXfa: false,
  });
  const doc: PDFDocumentProxy = await task.promise;
  const urls = new Map<string, Promise<string>>();
  return {
    pageCount: doc.numPages,
    async geometry(n) {
      const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
      return {
        width: vp.width,
        height: vp.height,
        toPdf: (x, y) => vp.convertToPdfPoint(x, y) as [number, number],
        toView: (x, y) => vp.convertToViewportPoint(x, y) as [number, number],
      };
    },
    page(n, width) {
      const key = `${n}@${width}`;
      let url = urls.get(key);
      if (!url) {
        url = serial(async () => {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: (width * dpr) / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
          page.cleanup();
          return URL.createObjectURL(blob);
        });
        urls.set(key, url);
      }
      return url;
    },
    destroy() {
      for (const u of urls.values()) void u.then((x) => URL.revokeObjectURL(x), () => undefined);
      urls.clear();
      // Let a page that is drawing finish first, so pdf.js does not report a cancelled render.
      void queue.then(() => task.destroy()).catch(() => undefined);
    },
  };
}
