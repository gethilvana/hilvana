# @hilvana/core

PDF engine of [Hilvana](https://github.com/gethilvana/hilvana): merge, select, split, rotate, stamp text, sign with an image, watermark, number pages, strip metadata, images → PDF, and **compression that never rasterizes text** (images are resampled to the size they are displayed at). Bytes in, bytes out; runs in Node and the browser; no network.

```js
import { merge, compress, stampImage } from '@hilvana/core';
const both = await merge([a, b]);
const { bytes, report } = await compress(both, { targetBytes: 2_000_000 });
```

MIT · [Docs](https://github.com/gethilvana/hilvana/tree/main/docs)
