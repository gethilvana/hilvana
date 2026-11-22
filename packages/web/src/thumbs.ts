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

/** A page drawn for OCR: RGBA pixels and the matrix from pixels (y down) to the page (PDF points). */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  toPage: [number, number, number, number, number, number];
  dpi: number;
}

export interface Preview {
  pageCount: number;
  geometry(n: number): Promise<PageGeometry>;
  /** Characters a reader would extract from the page (spaces excluded). */
  textLength(n: number): Promise<number>;
  /** The page drawn at up to `dpi`, never wider or taller than `maxSide` pixels. */
  raster(n: number, dpi?: number, maxSide?: number): Promise<Raster>;
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
    async textLength(n) {
      const items = (await (await doc.getPage(n)).getTextContent()).items as { str?: string }[];
      return items.reduce((s, it) => s + (it.str ?? '').replace(/\s/g, '').length, 0);
    },
    raster(n, dpi = 200, maxSide = 2400) {
      return serial(async () => {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(dpi / 72, maxSide / Math.max(base.width, base.height));
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport: vp }).promise;
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        page.cleanup();
        const [e, f] = vp.convertToPdfPoint(0, 0) as [number, number];
        const [ax, ay] = vp.convertToPdfPoint(1, 0) as [number, number];
        const [cx, cy] = vp.convertToPdfPoint(0, 1) as [number, number];
        canvas.width = canvas.height = 0; // free the memory now, phones are tight
        return { data: img.data, width: img.width, height: img.height, toPage: [ax - e, ay - f, cx - e, cy - f, e, f], dpi: scale * 72 };
      });
    },
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
