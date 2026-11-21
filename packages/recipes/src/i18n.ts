import type { Step } from './schema.js';

export type Lang = 'es' | 'en';

type Dict = Record<string, string>;

const messages: Record<Lang, Dict> = {
  es: {
    // core error codes
    EMPTY_DOCUMENT: 'El documento no tiene páginas.',
    INVALID_RANGE: 'El rango de páginas "{expr}" no es válido.',
    PAGE_OUT_OF_RANGE: 'La página {page} no existe; el documento tiene {pageCount}.',
    NO_INPUTS: 'No hay archivos de entrada.',
    ENCRYPTED: 'El PDF está protegido (con contraseña o con restricciones de uso) y Hilvana todavía no puede procesarlo. Ábrelo en tu lector de PDF y guárdalo o imprímelo como PDF sin protección.',
    INVALID_PDF: 'El archivo no es un PDF válido.',
    UNSUPPORTED_IMAGE: 'La imagen debe ser PNG o JPEG.',
    WOULD_REMOVE_ALL_PAGES: 'La operación eliminaría todas las páginas.',
    INVALID_ARGUMENT: 'Hay un parámetro inválido.',
    UNSUPPORTED_CHARACTERS: 'El texto tiene caracteres que la fuente estándar no puede dibujar: {chars}',
    // recipe codes
    SCHEMA: 'La receta no cumple el formato: {issues}',
    UNKNOWN_INPUT: 'La receta usa "{name}", pero no hay un archivo con ese nombre.',
    NOT_AN_IMAGE: '"{name}" debe ser una imagen PNG o JPEG.',
    NOT_A_PDF: '"{name}" debe ser un PDF o un documento de Word (.docx).',
    NOT_DOCX: '"{name}" no es un documento de Word (.docx).',
    ENCRYPTED_DOCX: '"{name}" está protegido con contraseña; ábrelo en Word y guárdalo sin contraseña.',
    DOCX_TOO_LARGE: '"{name}" se expande a un tamaño excesivo al abrirlo; no se procesó para proteger tu equipo.',
    CORRUPT_DOCX: '"{name}" está dañado o no se puede leer.',
    'step.convertWord': 'Convertir {file} de Word a PDF',
    'step.mergeAllDocs': 'Unir todos los documentos (PDF y Word) en el orden recibido',
    'word.TEXTBOX_SKIPPED': 'se omitieron cuadros de texto',
    'word.FLOATING_IMAGE_INLINED': 'las imágenes flotantes se ubicaron en línea con el texto',
    'word.UNSUPPORTED_IMAGE_FORMAT': 'se omitieron imágenes en un formato no compatible (EMF/WMF/SVG)',
    'word.LEGACY_SHAPE_SKIPPED': 'se omitieron formas antiguas (VML)',
    'word.NOTES_SKIPPED': 'se omitieron las notas al pie',
    'word.FIRST_PAGE_HEADER_IGNORED': 'se usó el encabezado general también en la primera página',
    'word.PAGE_FIELD_IN_BODY': 'un número de página dentro del texto quedó vacío',
    'word.CONTENT_TALLER_THAN_PAGE': 'hay contenido más alto que la página',
    'word.MISSING_GLYPHS': 'algunos caracteres (por ejemplo, emojis) se reemplazaron por "?"',
    'word.COLUMNS_IGNORED': 'el texto en varias columnas se puso en una sola',
    NO_PDF_INPUTS: 'La receta necesita al menos un PDF de entrada.',
    SOURCE_NOT_FIRST: 'El paso {index} crea un documento nuevo; solo puede ir de primero.',
    SPLIT_NOT_LAST: 'El paso {index} divide el documento en varios archivos; solo puede ir de último.',
    CONFIRMATION_REQUIRED: 'La receta tiene pasos que eliminan contenido o información ({steps}). Confírmala para ejecutarla.',
    // describe
    'step.merge': 'Unir {files}',
    'step.mergeAll': 'Unir todos los PDF en el orden recibido',
    'step.fromImages': 'Crear un PDF con las imágenes {files}',
    'step.fromImagesAll': 'Crear un PDF con todas las imágenes',
    'step.select': 'Conservar solo {pages}',
    'step.remove': 'Eliminar {pages}',
    'step.rotate': 'Girar {angle}° {pages}',
    'step.stampText': 'Escribir "{text}" en {pages}',
    'step.sign': 'Firmar con "{image}" en {pages}',
    'step.watermark': 'Agregar la marca de agua "{text}"',
    'step.numberPages': 'Numerar las páginas',
    'step.stripMetadata': 'Borrar los metadatos (autor, título, herramientas)',
    'step.setMetadata': 'Cambiar los metadatos del documento',
    'step.optimize': 'Optimizar la estructura del archivo',
    'step.compress': 'Comprimir (nivel {level})',
    'step.compressTarget': 'Comprimir hasta {target} como máximo',
    'step.splitEach': 'Dividir en un archivo por página',
    'step.splitRanges': 'Dividir en {count} archivos: {ranges}',
    'level.lossless': 'sin pérdida',
    'level.balanced': 'equilibrado',
    'level.strong': 'fuerte',
    'level.max': 'máximo',
    'level.none': 'sin cambios',
    'note.compress': 'Compresión: {before} → {after} (nivel {level}; {images} imágenes optimizadas)',
    'note.compressNone': 'La compresión no logró reducir el archivo; se dejó igual.',
    'note.targetMissed': 'No se alcanzó {target}: lo más pequeño posible sin rasterizar el texto fue {after}.',
    'goal.maxBytes': 'Pesa como máximo {expected}',
    'goal.pageCount': 'Tiene exactamente {expected} páginas',
    'goal.maxPages': 'Tiene como máximo {expected} páginas',
    'goal.noMetadata': 'No contiene metadatos identificables',
    destructive: '(borra contenido o información; requiere confirmación)',
    'pages.all': 'todas las páginas',
    'pages.last': 'la última página',
    'pages.one': 'la página {p}',
    'pages.many': 'las páginas {p}',
  },
  en: {
    EMPTY_DOCUMENT: 'The document has no pages.',
    INVALID_RANGE: 'The page range "{expr}" is not valid.',
    PAGE_OUT_OF_RANGE: 'Page {page} does not exist; the document has {pageCount}.',
    NO_INPUTS: 'There are no input files.',
    ENCRYPTED: 'The PDF is protected (by a password or usage restrictions) and Hilvana cannot process it yet. Open it in your PDF reader and save or print it as an unprotected PDF.',
    INVALID_PDF: 'The file is not a valid PDF.',
    UNSUPPORTED_IMAGE: 'The image must be PNG or JPEG.',
    WOULD_REMOVE_ALL_PAGES: 'The operation would remove every page.',
    INVALID_ARGUMENT: 'A parameter is invalid.',
    UNSUPPORTED_CHARACTERS: 'The text has characters the standard font cannot draw: {chars}',
    SCHEMA: 'The recipe does not match the format: {issues}',
    UNKNOWN_INPUT: 'The recipe uses "{name}", but there is no file with that name.',
    NOT_AN_IMAGE: '"{name}" must be a PNG or JPEG image.',
    NOT_A_PDF: '"{name}" must be a PDF or a Word document (.docx).',
    NOT_DOCX: '"{name}" is not a Word document (.docx).',
    ENCRYPTED_DOCX: '"{name}" is password protected; open it in Word and save it without a password.',
    DOCX_TOO_LARGE: '"{name}" expands to an excessive size when opened; it was not processed, to protect your device.',
    CORRUPT_DOCX: '"{name}" is damaged or cannot be read.',
    'step.convertWord': 'Convert {file} from Word to PDF',
    'step.mergeAllDocs': 'Merge every document (PDF and Word) in the order received',
    'word.TEXTBOX_SKIPPED': 'text boxes were skipped',
    'word.FLOATING_IMAGE_INLINED': 'floating images were placed inline with the text',
    'word.UNSUPPORTED_IMAGE_FORMAT': 'images in an unsupported format (EMF/WMF/SVG) were skipped',
    'word.LEGACY_SHAPE_SKIPPED': 'legacy (VML) shapes were skipped',
    'word.NOTES_SKIPPED': 'footnotes were skipped',
    'word.FIRST_PAGE_HEADER_IGNORED': 'the default header was also used on the first page',
    'word.PAGE_FIELD_IN_BODY': 'a page number inside the body was left empty',
    'word.CONTENT_TALLER_THAN_PAGE': 'some content is taller than the page',
    'word.MISSING_GLYPHS': 'some characters (for example, emoji) were replaced with "?"',
    'word.COLUMNS_IGNORED': 'multi-column text was set in a single column',
    NO_PDF_INPUTS: 'The recipe needs at least one PDF input.',
    SOURCE_NOT_FIRST: 'Step {index} creates a new document; it can only come first.',
    SPLIT_NOT_LAST: 'Step {index} splits the document into several files; it can only come last.',
    CONFIRMATION_REQUIRED: 'The recipe has steps that remove content or information ({steps}). Confirm it to run it.',
    'step.merge': 'Merge {files}',
    'step.mergeAll': 'Merge every PDF in the order received',
    'step.fromImages': 'Build a PDF from the images {files}',
    'step.fromImagesAll': 'Build a PDF from every image',
    'step.select': 'Keep only {pages}',
    'step.remove': 'Remove {pages}',
    'step.rotate': 'Rotate {pages} by {angle}°',
    'step.stampText': 'Write "{text}" on {pages}',
    'step.sign': 'Sign with "{image}" on {pages}',
    'step.watermark': 'Add the watermark "{text}"',
    'step.numberPages': 'Number the pages',
    'step.stripMetadata': 'Remove metadata (author, title, tools)',
    'step.setMetadata': 'Change the document metadata',
    'step.optimize': 'Optimize the file structure',
    'step.compress': 'Compress ({level} level)',
    'step.compressTarget': 'Compress to at most {target}',
    'step.splitEach': 'Split into one file per page',
    'step.splitRanges': 'Split into {count} files: {ranges}',
    'level.lossless': 'lossless',
    'level.balanced': 'balanced',
    'level.strong': 'strong',
    'level.max': 'maximum',
    'level.none': 'unchanged',
    'note.compress': 'Compression: {before} → {after} ({level} level; {images} images optimized)',
    'note.compressNone': 'Compression could not make the file smaller; it was left as is.',
    'note.targetMissed': '{target} was not reached: the smallest possible without rasterizing text was {after}.',
    'goal.maxBytes': 'Is at most {expected}',
    'goal.pageCount': 'Has exactly {expected} pages',
    'goal.maxPages': 'Has at most {expected} pages',
    'goal.noMetadata': 'Contains no identifying metadata',
    destructive: '(removes content or information; needs confirmation)',
    'pages.all': 'all pages',
    'pages.last': 'the last page',
    'pages.one': 'page {p}',
    'pages.many': 'pages {p}',
  },
};

export function t(lang: Lang, key: string, vars: Record<string, unknown> = {}): string {
  const template = messages[lang][key] ?? messages.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function describeStep(step: Step, lang: Lang): string {
  const pages = (p: string | undefined, fallback: string) => {
    const expr = (p ?? fallback).trim();
    if (expr === 'all') return t(lang, 'pages.all');
    if (expr === 'last') return t(lang, 'pages.last');
    return t(lang, /^\d+$/.test(expr) ? 'pages.one' : 'pages.many', { p: expr });
  };
  switch (step.op) {
    case 'merge': return step.files ? t(lang, 'step.merge', { files: step.files.join(', ') }) : t(lang, 'step.mergeAll');
    case 'fromImages': return step.files ? t(lang, 'step.fromImages', { files: step.files.join(', ') }) : t(lang, 'step.fromImagesAll');
    case 'select': return t(lang, 'step.select', { pages: pages(step.pages, 'all') });
    case 'remove': return t(lang, 'step.remove', { pages: pages(step.pages, 'all') });
    case 'rotate': return t(lang, 'step.rotate', { angle: step.angle, pages: pages(step.pages, 'all') });
    case 'stampText': return t(lang, 'step.stampText', { text: step.text, pages: pages(step.pages, 'all') });
    case 'sign': return t(lang, 'step.sign', { image: step.image, pages: pages(step.pages, 'last') });
    case 'watermark': return t(lang, 'step.watermark', { text: step.text });
    case 'numberPages': return t(lang, 'step.numberPages');
    case 'stripMetadata': return t(lang, 'step.stripMetadata');
    case 'setMetadata': return t(lang, 'step.setMetadata');
    case 'optimize': return t(lang, 'step.optimize');
    case 'compress':
      return step.targetBytes !== undefined
        ? t(lang, 'step.compressTarget', { target: formatBytes(step.targetBytes) })
        : t(lang, 'step.compress', { level: t(lang, `level.${step.level ?? 'balanced'}`) });
    case 'split':
      return step.ranges ? t(lang, 'step.splitRanges', { count: step.ranges.length, ranges: step.ranges.join('; ') }) : t(lang, 'step.splitEach');
  }
}

/** Today's date as YYYY-MM-DD in the user's local time zone. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
