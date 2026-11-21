// Regenerates the e2e fixtures: node e2e/fixtures/make.mjs e2e/fixtures (from the repo root, where pdf-lib and docx are installed).
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } from 'docx';
import fs from 'node:fs';
const out = process.argv[2];
async function pdf(name, pages, title, opts = {}) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.HelveticaBold);
  const r = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = d.addPage([595, 842]);
    p.drawRectangle({ x: 0, y: 760, width: 595, height: 82, color: rgb(0.08, 0.14, 0.23) });
    p.drawText(`${title}`, { x: 50, y: 790, size: 24, font: f, color: rgb(1, 1, 1) });
    p.drawText(`Página ${i}`, { x: 50, y: 700, size: 60, font: f, color: rgb(0.06, 0.52, 0.47) });
    for (let l = 0; l < 18; l++) p.drawText('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.', { x: 50, y: 640 - l * 22, size: 12, font: r });
    if (opts.sideways && i === 2) p.setRotation(degrees(90));
  }
  if (opts.meta) { d.setTitle('Extracto confidencial'); d.setAuthor('Jorge Prueba'); d.setCreator('Microsoft Word'); }
  fs.writeFileSync(`${out}/${name}`, await d.save());
}
await pdf('factura-octubre.pdf', 2, 'Factura octubre', { meta: true });
await pdf('factura-noviembre.pdf', 3, 'Factura noviembre');
await pdf('escaneo.pdf', 6, 'Escaneo', { sideways: true });
const doc = new Document({ sections: [{ children: [
  new Paragraph({ text: 'Contrato de prestación de servicios', heading: HeadingLevel.HEADING_1 }),
  new Paragraph({ children: [new TextRun('Entre las partes, '), new TextRun({ text: 'Hilvana S.A.S.', bold: true }), new TextRun(' y el cliente, se acuerda lo siguiente. Ñandú, acción, café ✓.')] }),
  new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Servicio')] }), new TableCell({ children: [new Paragraph('Valor')] })] }), new TableRow({ children: [new TableCell({ children: [new Paragraph('Consultoría')] }), new TableCell({ children: [new Paragraph('$ 1.200.000')] })] })] }),
] }] });
fs.writeFileSync(`${out}/contrato.docx`, await Packer.toBuffer(doc));
