import { PDFDocument } from 'pdf-lib';
import { encode } from 'fast-png';
import * as core from '@hilvana/core';
const doc = await PDFDocument.create();
const w = 1600, h = 1200;
for (let p = 0; p < 4; p++) {
  const data = new Uint8Array(w * h * 3); let x = 12345 + p;
  for (let i = 0; i < data.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; data[i] = (x >>> 24) & 0xff; }
  const png = await doc.embedPng(encode({ width: w, height: h, data, channels: 3 }));
  doc.addPage([595, 446]).drawImage(png, { x: 0, y: 0, width: 595, height: 446 });
}
const bytes = await doc.save();
console.log('input MB', (bytes.length / 1e6).toFixed(1));
for (const level of ['balanced']) {
  const t = Date.now();
  const { bytes: out, report } = await core.compress(bytes, { level });
  console.log(level, 'ms', Date.now() - t, 'out MB', (out.length / 1e6).toFixed(2), JSON.stringify(report.images).slice(0, 200));
}
