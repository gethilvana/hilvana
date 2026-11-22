#!/usr/bin/env node
// Builds the Spanish OCR and redaction corpus: synthetic statements, invoices and letters with
// invented people and numbers (no real data), their exact text as ground truth, and scans of them
// under conditions that range from clean to poor. Deterministic: same seed, same files.
//
// Needs Poppler (pdftoppm) and ImageMagick (convert) to rasterize and degrade the pages.
// Output: bench/out/scans/<condition>/<doc>.pdf, bench/out/digital/<doc>.pdf, bench/out/truth.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, 'out');
const require = createRequire(import.meta.url);

// Seeded random numbers (mulberry32).
let seed = 20261122;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');
const money = (v) => `$ ${Math.round(v).toLocaleString('es-CO')},${digits(2)}`;

const NAMES = ['Ana María Pérez Gómez', 'Luis Fernando Rojas Díaz', 'Carolina Muñoz Herrera', 'Andrés Felipe Ortiz Peña', 'Valentina Gutiérrez Ríos', 'Julián Esteban Castaño', 'María José Londoño Vélez', 'Sebastián Cárdenas Ruiz', 'Natalia Jiménez Acuña', 'Camilo Andrés Suárez Niño'];
const STREETS = ['Calle 127 # 15-30', 'Carrera 7 # 72-41', 'Avenida 19 # 104-55', 'Calle 93B # 13-92', 'Transversal 60 # 115-58', 'Carrera 45 # 26-85'];
const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga', 'Pereira'];
const SHOPS = ['Supermercado El Ahorro', 'Droguería La Salud', 'Pago de servicios públicos', 'Transferencia recibida', 'Retiro en cajero', 'Restaurante Doña Lucía', 'Librería Panamericana', 'Estación de servicio', 'Pago tarjeta de crédito', 'Compra en línea'];
const PHRASES = [
  'Por medio de la presente nos permitimos informarle que su solicitud fue aprobada.',
  'Le recordamos que el plazo para presentar los documentos vence a fin de mes.',
  'Agradecemos su confianza y quedamos atentos a cualquier inquietud adicional.',
  'La información contenida en este documento es confidencial y de uso exclusivo del destinatario.',
  'En caso de no reconocer alguna transacción, comuníquese de inmediato con nuestra línea de atención.',
  'El valor de la cuota incluye intereses corrientes, seguros y cargos administrativos.',
  'Según lo acordado en la reunión del pasado martes, enviamos el resumen de los compromisos.',
  'Cualquier modificación deberá informarse por escrito con al menos quince días de anticipación.',
  'Adjuntamos la certificación solicitada, válida por treinta días a partir de su expedición.',
  'Este extracto refleja los movimientos realizados durante el período indicado.',
  'Para mayor seguridad, nunca comparta sus claves ni códigos de verificación.',
  'El pago oportuno evita la generación de intereses de mora y reportes negativos.',
];

const fontFile = (family, weight = 400) => readFileSync(require.resolve(`@fontsource/${family}/files/${family}-latin-${weight}-normal.woff`));
const FAMILIES = ['arimo', 'tinos', 'cousine'];

/** One document: lines of text with their positions, and the sensitive values in it. */
function makeDoc(kind, i) {
  const name = pick(NAMES);
  const id = `${digits(1) === '0' ? '1' : '1'}.0${digits(2)}.${digits(3)}.${digits(3)}`;
  const account = `${digits(3)}-${digits(6)}-${digits(2)}`;
  const email = `${name.split(' ')[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()}.${digits(2)}@correo-ejemplo.co`;
  const phone = `3${digits(2)} ${digits(3)} ${digits(4)}`;
  const city = pick(CITIES);
  const lines = [];
  const sensitive = { name, id, account, email, phone };
  if (kind === 'extracto') {
    lines.push(['Banco Ficticio de Prueba S.A.', 16], [`Extracto de cuenta de ahorros No. ${account}`, 12], [`Titular: ${name}`, 11], [`Cédula de ciudadanía: ${id}`, 11], [`Dirección: ${pick(STREETS)}, ${city}`, 11], [`Correo: ${email}   Celular: ${phone}`, 11], ['Fecha        Descripción                                Valor', 10]);
    let saldo = 2_000_000 + rand() * 8_000_000;
    for (let k = 0; k < 14; k++) {
      const v = (rand() < 0.3 ? 1 : -1) * (20_000 + rand() * 900_000);
      saldo += v;
      lines.push([`${String(1 + k * 2).padStart(2, '0')}/11/2026   ${pick(SHOPS).padEnd(38)} ${v < 0 ? '-' : ''}${money(Math.abs(v))}`, 10]);
    }
    lines.push([`Saldo final: ${money(saldo)}`, 11]);
  } else if (kind === 'factura') {
    lines.push(['Comercializadora Ejemplo S.A.S.', 16], [`NIT 900.${digits(3)}.${digits(3)}-${digits(1)}   Factura electrónica No. FE-${digits(5)}`, 11], [`Cliente: ${name}   C.C. ${id}`, 11], [`Dirección de entrega: ${pick(STREETS)}, ${city}`, 11], [`Correo: ${email}`, 11], ['Cant.  Descripción                          Valor unitario     Total', 10]);
    let total = 0;
    for (let k = 0; k < 8; k++) {
      const q = 1 + Math.floor(rand() * 5), u = 5_000 + rand() * 300_000;
      total += q * u;
      lines.push([`${q}      ${pick(['Resma de papel carta', 'Tóner para impresora', 'Silla ergonómica', 'Cable HDMI de 2 metros', 'Disco duro externo', 'Teclado inalámbrico', 'Monitor de 24 pulgadas', 'Café de origen 500 g']).padEnd(36)} ${money(u).padEnd(18)} ${money(q * u)}`, 10]);
    }
    lines.push([`Subtotal: ${money(total)}   IVA 19 %: ${money(total * 0.19)}   Total: ${money(total * 1.19)}`, 11]);
  } else {
    lines.push([`${city}, ${1 + Math.floor(rand() * 28)} de noviembre de 2026`, 11], [`Señor(a) ${name}`, 11], [`Cédula ${id}`, 11], [`${pick(STREETS)}, ${city}`, 11], ['Asunto: Respuesta a su solicitud', 12], ['Respetado(a) cliente:', 11]);
    for (let k = 0; k < 9; k++) lines.push([pick(PHRASES), 11]);
    lines.push([`Para más información escriba a ${email} o llame al ${phone}.`, 11], ['Cordialmente,', 11], ['Área de Servicio al Cliente', 11]);
  }
  return { id: `${kind}-${String(i).padStart(2, '0')}`, kind, family: FAMILIES[i % FAMILIES.length], lines, sensitive };
}

async function toPdf(doc) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontFile(doc.family), { subset: true });
  const page = pdf.addPage([612, 792]);
  let y = 740;
  for (const [text, size] of doc.lines) {
    page.drawText(text, { x: 54, y, size, font, color: rgb(0, 0, 0) });
    y -= size * 1.9;
  }
  pdf.setTitle(doc.id);
  return pdf.save();
}

// Scan conditions: resolution, then how the page is degraded.
const CONDITIONS = {
  'limpio-300': { dpi: 300, magick: ['-quality', '92'], ext: 'jpg' },
  'movil-200': { dpi: 200, magick: ['-quality', '60'], ext: 'jpg' },
  'torcido-200': { dpi: 200, magick: ['-background', 'white', '-rotate', '1.5', '-attenuate', '0.4', '+noise', 'Gaussian', '-quality', '70'], ext: 'jpg' },
  'byn-200': { dpi: 200, magick: ['-threshold', '60%', '-type', 'bilevel'], ext: 'png' },
  'baja-150': { dpi: 150, magick: ['-blur', '0x0.6', '-quality', '50'], ext: 'jpg' },
};

rmSync(path.join(out, 'digital'), { recursive: true, force: true });
rmSync(path.join(out, 'scans'), { recursive: true, force: true });
mkdirSync(path.join(out, 'digital'), { recursive: true });
const tmp = path.join(out, 'tmp');
mkdirSync(tmp, { recursive: true });

const docs = [];
const kinds = ['extracto', 'factura', 'carta'];
for (let i = 0; i < 12; i++) docs.push(makeDoc(kinds[i % 3], i + 1));
for (const doc of docs) {
  const file = path.join(out, 'digital', `${doc.id}.pdf`);
  writeFileSync(file, await toPdf(doc));
  for (const [cond, c] of Object.entries(CONDITIONS)) {
    const dir = path.join(out, 'scans', cond);
    mkdirSync(dir, { recursive: true });
    const base = path.join(tmp, `${doc.id}-${cond}`);
    execFileSync('pdftoppm', ['-r', String(c.dpi), '-gray', '-png', '-singlefile', file, base]);
    const img = `${base}.${c.ext}`;
    execFileSync('convert', [`${base}.png`, ...c.magick, img]);
    const pdf = await PDFDocument.create();
    const bytes = readFileSync(img);
    const embedded = c.ext === 'jpg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    pdf.addPage([612, 792]).drawImage(embedded, { x: 0, y: 0, width: 612, height: 792 });
    writeFileSync(path.join(dir, `${doc.id}.pdf`), await pdf.save());
  }
}
rmSync(tmp, { recursive: true, force: true });
writeFileSync(path.join(out, 'truth.json'), JSON.stringify(docs.map((d) => ({ id: d.id, kind: d.kind, family: d.family, text: d.lines.map((l) => l[0]), sensitive: d.sensitive })), null, 2));
console.log(`${docs.length} documents × ${Object.keys(CONDITIONS).length} scan conditions in ${path.relative(process.cwd(), out)}`);
