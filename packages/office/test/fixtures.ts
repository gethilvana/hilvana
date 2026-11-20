import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer,
  PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { deflateSync } from 'node:zlib';

/** A small valid PNG (solid color) generated without dependencies. */
export function solidPng(w: number, h: number, rgbHex = '0F7C80'): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(rgbHex.slice(i, i + 2), 16));
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r!, g!, b!]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const LOREM =
  'Las partes acuerdan que el arrendatario usará el inmueble exclusivamente como vivienda, conservándolo en buen estado y respondiendo por los daños que no provengan del uso normal. ' +
  'El canon se pagará dentro de los cinco primeros días de cada mes mediante transferencia a la cuenta indicada por el arrendador, quien expedirá el recibo correspondiente.';

export async function sampleContract(): Promise<Uint8Array> {
  const cell = (text: string, opts: { bold?: boolean; fill?: string; width?: number } = {}) =>
    new TableCell({
      width: { size: opts.width ?? 3000, type: WidthType.DXA },
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold })] })],
    });

  const doc = new Document({
    creator: 'Hilvana tests',
    title: 'Contrato de prueba',
    numbering: {
      config: [{
        reference: 'clausulas',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      }],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Hilvana · Documento de prueba', size: 16, color: '7F8C9D' })] })] }) },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 18 })],
          })],
        }),
      },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('Contrato de arrendamiento')] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Partes y objeto')] }),
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          children: [
            new TextRun('Entre '),
            new TextRun({ text: 'Ana María Pérez', bold: true }),
            new TextRun(', mayor de edad, y '),
            new TextRun({ text: 'José Núñez', bold: true, italics: true }),
            new TextRun(', se celebra el presente contrato sobre el inmueble ubicado en la '),
            new TextRun({ text: 'Calle 100 # 15-20', underline: {} }),
            new TextRun(' de Bogotá. ¿Acuerdo? ¡Sí! El área es de 80 m'),
            new TextRun({ text: '2', superScript: true }),
            new TextRun('.'),
          ],
        }),
        new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun(LOREM)] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Cláusulas')] }),
        new Paragraph({ numbering: { reference: 'clausulas', level: 0 }, children: [new TextRun('Duración de doce (12) meses.')] }),
        new Paragraph({ numbering: { reference: 'clausulas', level: 0 }, children: [new TextRun('Canon mensual de $2.500.000.')] }),
        new Paragraph({ numbering: { reference: 'clausulas', level: 0 }, children: [new TextRun('Depósito equivalente a un mes.')] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun('Servicios públicos a cargo del arrendatario.')] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun('Administración incluida.')] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Inventario')] }),
        new Table({
          columnWidths: [4000, 2680, 2680],
          rows: [
            new TableRow({ tableHeader: true, children: [cell('Elemento', { bold: true, fill: '1F3864', width: 4000 }), cell('Cantidad', { bold: true, fill: '1F3864', width: 2680 }), cell('Estado', { bold: true, fill: '1F3864', width: 2680 })] }),
            new TableRow({ children: [cell('Llaves', { width: 4000 }), cell('3', { width: 2680 }), cell('Bueno', { width: 2680 })] }),
            new TableRow({ children: [cell('Control del portón eléctrico', { width: 4000 }), cell('1', { width: 2680 }), cell('Nuevo', { width: 2680, fill: 'E6F3F3' })] }),
          ],
        }),
        new Paragraph({ children: [] }),
        new Paragraph({ children: [new ImageRun({ type: 'png', data: solidPng(60, 30), transformation: { width: 120, height: 60 } })] }),
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Firmas')] }),
        ...Array.from({ length: 12 }, () => new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun(LOREM)] })),
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } }, children: [new TextRun('Arrendador')] }),
      ],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
