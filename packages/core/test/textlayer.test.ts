/**
 * Reading scans for OCR without rendering: lossless (Flate) grey and colour scans, scans inside a
 * form XObject, small images that are not scans, and formats that need rendering instead.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { scannedImages, pixelToPage } from '@hilvana/core';

async function pageWithImages(images: { cs: string; bytes: number[]; w: number; h: number; filter?: string; cm: string; inForm?: boolean }[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const xobjects: Record<string, unknown> = {};
  let content = '';
  images.forEach((im, i) => {
    const data = im.filter === 'none' ? Uint8Array.from(im.bytes) : zlibSync(Uint8Array.from(im.bytes));
    const dict = { Type: 'XObject', Subtype: 'Image', Width: im.w, Height: im.h, BitsPerComponent: 8, ColorSpace: im.cs, ...(im.filter === 'none' ? {} : { Filter: im.filter ?? 'FlateDecode' }) };
    const ref = doc.context.register(doc.context.stream(data, dict));
    if (im.inForm) {
      const inner = doc.context.stream(new TextEncoder().encode(`q ${im.cm} cm /I Do Q`), {
        Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 200], Resources: { XObject: { I: ref } },
      });
      xobjects[`F${i}`] = doc.context.register(inner);
      content += `/F${i} Do\n`;
    } else {
      xobjects[`I${i}`] = ref;
      content += `q ${im.cm} cm /I${i} Do Q\n`;
    }
  });
  page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: xobjects }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return doc.save();
}

describe('scannedImages', () => {
  it('decodes lossless grey and colour scans to RGBA, with the mapping to the page', async () => {
    const bytes = await pageWithImages([
      { cs: 'DeviceGray', bytes: [0, 255, 128, 64], w: 2, h: 2, cm: '200 0 0 200 0 0' },
      { cs: 'DeviceRGB', bytes: [10, 20, 30], w: 1, h: 1, cm: '200 0 0 100 0 100' },
    ]);
    const { images, unsupported } = await scannedImages(bytes, 1);
    expect(unsupported).toBe(0);
    expect(images).toHaveLength(2);
    expect([...images[0]!.image.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 64, 64, 64, 255]);
    expect([...images[1]!.image.data]).toEqual([10, 20, 30, 255]);
    // The top-left pixel of the first image is the top-left of the page; its bottom-right, the bottom-right.
    expect(pixelToPage(images[0]!.toPage, 0, 0)).toEqual([0, 200]);
    expect(pixelToPage(images[0]!.toPage, 2, 2)).toEqual([200, 0]);
    expect(pixelToPage(images[1]!.toPage, 1, 1)).toEqual([200, 100]);
  });

  it('finds a scan inside a form XObject, and skips small images that are not scans', async () => {
    const bytes = await pageWithImages([
      { cs: 'DeviceGray', bytes: [200], w: 1, h: 1, cm: '200 0 0 200 0 0', inForm: true },
      { cs: 'DeviceGray', bytes: [50], w: 1, h: 1, cm: '20 0 0 20 10 10' }, // a logo, not a scan
    ]);
    const { images } = await scannedImages(bytes, 1);
    expect(images.map((i) => [...i.image.data])).toEqual([[200, 200, 200, 255]]);
  });

  it('counts scans it cannot decode, so the page is rendered instead', async () => {
    const bytes = await pageWithImages([
      { cs: 'DeviceGray', bytes: [1, 2, 3, 4], w: 2, h: 2, filter: 'CCITTFaxDecode', cm: '200 0 0 200 0 0' },
      { cs: 'DeviceGray', bytes: [1], w: 2, h: 2, filter: 'none', cm: '200 0 0 200 0 0' }, // truncated data
    ]);
    const { images, unsupported } = await scannedImages(bytes, 1);
    expect(images).toEqual([]);
    expect(unsupported).toBe(2);
  });
});
