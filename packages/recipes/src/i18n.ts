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
    ENCRYPTED: 'Este PDF usa una protección que Hilvana no puede abrir (por ejemplo, con certificado). Ábrelo en tu lector de PDF y guárdalo o imprímelo como PDF sin protección.',
    PASSWORD_REQUIRED: 'Este PDF necesita una contraseña para abrirse.',
    WRONG_PASSWORD: 'La contraseña no abre este PDF.',
    UNLOCKED_PERMISSIONS: '"{name}" tenía restricciones de uso (por ejemplo, no permitir cambios). El resultado se guarda sin ellas: hazlo solo con documentos que tengas derecho a modificar.',
    UNLOCKED_PASSWORD: '"{name}" se abrió con su contraseña. El resultado se guarda sin contraseña.',
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
    SIGNED_INPUT: '"{name}" está firmado digitalmente. El resultado es un archivo nuevo y no conserva esa firma: guarda también el original firmado.',
    SPLIT_NOT_LAST: 'El paso {index} divide el documento en varios archivos; solo puede ir de último.',
    CONFIRMATION_REQUIRED: 'La receta tiene pasos que eliminan contenido o información ({steps}). Confírmala para ejecutarla.',
    INVALID_CERTIFICATE: 'El certificado no se puede leer. Debe ser un archivo .p12 o .pfx con la clave privada.',
    WRONG_CERTIFICATE_PASSWORD: 'La contraseña no abre el certificado.',
    CERTIFICATE_EXPIRED: 'El certificado venció el {to}. Firma con un certificado vigente.',
    CERTIFICATE_NOT_YET_VALID: 'El certificado solo es válido desde el {from}.',
    NOT_A_CERTIFICATE: '"{name}" debe ser un certificado .p12 o .pfx.',
    CERTIFICATE_PASSWORD_REQUIRED: 'Escribe la contraseña del certificado "{name}".',
    NOTHING_TO_PROTECT: 'El paso {index} no protege nada: pon una contraseña o quita algún permiso.',
    FINAL_NOT_LAST: 'El paso {index} produce el archivo final; solo puede ir de último.',
    SELF_SIGNED_CERTIFICATE: 'El certificado de "{name}" es autofirmado: la firma es íntegra, pero los lectores de PDF no la reconocerán como de una entidad de confianza.',
    SIGNATURES_KEPT: '"{name}" ya tiene firmas; se agrega una nueva sin modificar el documento, así las anteriores siguen válidas y no se escribe la línea visible.',
    MISSING_PAGES: '"{name}" está dañado: declara {count} página(s) más de las que se pudieron leer. El resultado tendrá solo las páginas legibles.',
    BATCH_NAMED_FILES: 'Para aplicar la receta a cada archivo, el paso {index} no puede nombrar archivos: quita "files".',
    BATCH_FROM_IMAGES: 'El paso {index} crea un PDF con imágenes; esa receta no se puede aplicar archivo por archivo.',
    'batch.done': '{ok} de {total} archivos procesados.',
    PROTECTION_KEPT: '"{name}" está protegido y firmado: se firma tal cual, así que conserva su protección y sus firmas siguen válidas.',
    'step.protectPassword': 'Proteger con contraseña (AES-256)',
    'step.protectRestrict': 'Restringir el uso: {list}',
    'step.protectBoth': 'Proteger con contraseña (AES-256) y restringir el uso: {list}',
    'step.signDigital': 'Firmar digitalmente con el certificado "{certificate}"',
    'restrict.print': 'sin imprimir',
    'restrict.copy': 'sin copiar',
    'restrict.modify': 'sin modificar',
    'visible.signed': 'Firmado digitalmente por {name} · {date}',
    'note.signed': 'Firmado por {name} (emitido por {issuer}; válido hasta {to}).',
    'note.signedInvisible': 'La firma no tiene marca visible: se ve en el panel de firmas del lector de PDF.',
    'note.protected': 'Para abrir el resultado se necesita la contraseña. Si la olvidas, no hay forma de recuperarla.',
    NOTHING_TO_REDACT: 'El paso {index} no dice qué tachar: agrega textos, tipos de datos o áreas.',
    REDACTION_UNSUPPORTED: 'Este PDF tiene contenido que Hilvana todavía no puede tachar con seguridad, así que no se cambió.',
    REDACTION_INCOMPLETE: 'No se pudo comprobar que el texto tachado desapareciera (páginas {pages}), así que no se entregó el resultado.',
    'step.redact': 'Tachar de verdad: {what}',
    'redact.terms': '{count} textos',
    'redact.term': '1 texto',
    'redact.areas': '{count} áreas',
    'redact.area': '1 área',
    'redact.email': 'correos',
    'redact.card': 'números de tarjeta',
    'redact.number': 'números de cuenta o identificación',
    'redact.phone': 'teléfonos',
    'note.redact': 'Tachado: {matches} coincidencias y {areas} áreas dibujadas, en las páginas {pages}. Lo que había debajo se eliminó del archivo.',
    'note.redactChecked': 'Verificado: al leer el resultado, ya no hay texto dentro de las zonas tachadas.',
    'note.redactNothing': 'No se encontró nada que tachar; el documento quedó igual.',
    'note.redactImagesRemoved': '{count} imágenes en un formato que no se puede editar se quitaron completas.',
    'note.redactStructure': 'Se quitaron las etiquetas de accesibilidad, porque podían repetir el texto tachado.',
    'step.ocr': 'Reconocer el texto de las páginas escaneadas (OCR en {language})',
    'step.ocrForce': 'Reconocer el texto de todas las páginas (OCR en {language})',
    'lang.spa': 'español',
    'lang.eng': 'inglés',
    'note.ocr': 'OCR: páginas {pages}, {words} palabras, confianza media {confidence} %. Ahora el texto se puede buscar, copiar y tachar.',
    'note.ocrCheck': 'El OCR puede equivocarse: revisa las cifras y los nombres importantes.',
    'note.ocrNone': 'Todas las páginas ya tenían texto; no hizo falta OCR.',
    'note.ocrUnreadable': 'Las páginas {pages} son escaneos en un formato que aquí no se puede leer; en la web sí se pueden.',
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
    ENCRYPTED: 'This PDF uses a protection Hilvana cannot open (for example, a certificate). Open it in your PDF reader and save or print it as an unprotected PDF.',
    PASSWORD_REQUIRED: 'This PDF needs a password to open.',
    WRONG_PASSWORD: 'The password does not open this PDF.',
    UNLOCKED_PERMISSIONS: '"{name}" had usage restrictions (for example, no changes allowed). The result is saved without them: only do this with documents you have the right to modify.',
    UNLOCKED_PASSWORD: '"{name}" was opened with its password. The result is saved without a password.',
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
    SIGNED_INPUT: '"{name}" is digitally signed. The result is a new file and does not keep that signature: keep the signed original too.',
    SPLIT_NOT_LAST: 'Step {index} splits the document into several files; it can only come last.',
    CONFIRMATION_REQUIRED: 'The recipe has steps that remove content or information ({steps}). Confirm it to run it.',
    INVALID_CERTIFICATE: 'The certificate cannot be read. It must be a .p12 or .pfx file with the private key.',
    WRONG_CERTIFICATE_PASSWORD: 'The password does not open the certificate.',
    CERTIFICATE_EXPIRED: 'The certificate expired on {to}. Sign with a valid certificate.',
    CERTIFICATE_NOT_YET_VALID: 'The certificate is only valid from {from}.',
    NOT_A_CERTIFICATE: '"{name}" must be a .p12 or .pfx certificate.',
    CERTIFICATE_PASSWORD_REQUIRED: 'Type the password for the certificate "{name}".',
    NOTHING_TO_PROTECT: 'Step {index} protects nothing: set a password or remove a permission.',
    FINAL_NOT_LAST: 'Step {index} produces the final file; it can only come last.',
    SELF_SIGNED_CERTIFICATE: 'The certificate in "{name}" is self-signed: the signature is intact, but PDF readers will not recognize it as from a trusted authority.',
    SIGNATURES_KEPT: '"{name}" already has signatures; a new one is added without changing the document, so the earlier ones stay valid and no visible line is written.',
    MISSING_PAGES: '"{name}" is damaged: it declares {count} more page(s) than could be read. The result will have only the readable pages.',
    BATCH_NAMED_FILES: 'To apply the recipe to each file, step {index} cannot name files: remove "files".',
    BATCH_FROM_IMAGES: 'Step {index} builds a PDF from images; that recipe cannot be applied file by file.',
    'batch.done': '{ok} of {total} files processed.',
    PROTECTION_KEPT: '"{name}" is protected and signed: it is signed as it is, so it keeps its protection and its signatures stay valid.',
    'step.protectPassword': 'Protect with a password (AES-256)',
    'step.protectRestrict': 'Restrict use: {list}',
    'step.protectBoth': 'Protect with a password (AES-256) and restrict use: {list}',
    'step.signDigital': 'Sign digitally with the certificate "{certificate}"',
    'restrict.print': 'no printing',
    'restrict.copy': 'no copying',
    'restrict.modify': 'no changes',
    'visible.signed': 'Digitally signed by {name} · {date}',
    'note.signed': 'Signed by {name} (issued by {issuer}; valid until {to}).',
    'note.signedInvisible': 'The signature has no visible mark: it shows in the PDF reader\'s signature panel.',
    'note.protected': 'Opening the result needs the password. If you forget it, there is no way to recover it.',
    NOTHING_TO_REDACT: 'Step {index} does not say what to redact: add text, kinds of data or areas.',
    REDACTION_UNSUPPORTED: 'This PDF has content Hilvana cannot redact safely yet, so it was not changed.',
    REDACTION_INCOMPLETE: 'Could not confirm that the redacted text is gone (pages {pages}), so no result was produced.',
    'step.redact': 'Redact for real: {what}',
    'redact.terms': '{count} texts',
    'redact.term': '1 text',
    'redact.areas': '{count} areas',
    'redact.area': '1 area',
    'redact.email': 'email addresses',
    'redact.card': 'card numbers',
    'redact.number': 'account or ID numbers',
    'redact.phone': 'phone numbers',
    'note.redact': 'Redacted: {matches} matches and {areas} drawn areas, on pages {pages}. What was underneath was removed from the file.',
    'note.redactChecked': 'Checked: reading the result back, there is no text left inside the redacted areas.',
    'note.redactNothing': 'Nothing to redact was found; the document is unchanged.',
    'note.redactImagesRemoved': '{count} images in a format that cannot be edited were removed whole.',
    'note.redactStructure': 'The accessibility tags were removed, since they could repeat the redacted text.',
    'step.ocr': 'Recognize the text of scanned pages (OCR in {language})',
    'step.ocrForce': 'Recognize the text of every page (OCR in {language})',
    'lang.spa': 'Spanish',
    'lang.eng': 'English',
    'note.ocr': 'OCR: pages {pages}, {words} words, mean confidence {confidence} %. The text can now be searched, copied and redacted.',
    'note.ocrCheck': 'OCR can make mistakes: check important figures and names.',
    'note.ocrNone': 'Every page already had text; no OCR was needed.',
    'note.ocrUnreadable': 'Pages {pages} are scans in a format that cannot be read here; the web app can read them.',
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
    case 'protect': {
      const list = (['print', 'copy', 'modify'] as const)
        .filter((k) => step[`allow${k[0]!.toUpperCase()}${k.slice(1)}` as 'allowPrint' | 'allowCopy' | 'allowModify'] === false)
        .map((k) => t(lang, `restrict.${k}`)).join(', ');
      if (step.password && list) return t(lang, 'step.protectBoth', { list });
      return step.password ? t(lang, 'step.protectPassword') : t(lang, 'step.protectRestrict', { list });
    }
    case 'signDigital': return t(lang, 'step.signDigital', { certificate: step.certificate });
    case 'ocr': return t(lang, step.force ? 'step.ocrForce' : 'step.ocr', { language: t(lang, `lang.${step.language ?? 'spa'}`) });
    case 'redact': {
      const what: string[] = [];
      const nt = step.terms?.length ?? 0;
      if (nt) what.push(nt === 1 ? t(lang, 'redact.term') : t(lang, 'redact.terms', { count: nt }));
      for (const p of step.patterns ?? []) what.push(t(lang, `redact.${p}`));
      const na = step.areas?.length ?? 0;
      if (na) what.push(na === 1 ? t(lang, 'redact.area') : t(lang, 'redact.areas', { count: na }));
      return t(lang, 'step.redact', { what: what.join(', ') || '—' });
    }
  }
}

/** Today's date as YYYY-MM-DD in the user's local time zone. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
