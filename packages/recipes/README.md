# @hilvana/recipes

Versioned JSON recipes for chained PDF and Word operations: validate against the real files before running (including page ranges after each step), require confirmation for destructive steps, run locally, and verify goals such as `maxBytes` or `pageCount`. Messages in Spanish and English. Exports a JSON Schema for agents.

```js
import { plan, run } from '@hilvana/recipes';
const recipe = { version: 1, steps: [{ op: 'merge' }, { op: 'sign', image: 'firma.png' }, { op: 'compress' }], goals: { maxBytes: 2_000_000 } };
const result = await run(recipe, files, { lang: 'es' });
```

[Recipe reference](https://github.com/gethilvana/hilvana/blob/main/docs/recipes.md) · MIT
