# @hilvana/office

Word (`.docx`) → PDF **locally**, with real, selectable text. Own layout engine (styles, lists, tables, images, headers/footers with page numbers) with embedded open fonts metric-compatible with Office, plus an optional local LibreOffice engine for complex layouts.

```js
import { wordToPdf } from '@hilvana/office';
const { pdf, pageCount, warnings } = await wordToPdf(docxBytes);
```

Coverage and limits: [docs/word.md](https://github.com/gethilvana/hilvana/blob/main/docs/word.md) · MIT (fonts: SIL OFL 1.1)
