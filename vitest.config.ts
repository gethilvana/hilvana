import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@hilvana/core': r('./packages/core/src/index.ts'),
      '@hilvana/recipes': r('./packages/recipes/src/index.ts'),
      '@hilvana/office': r('./packages/office/src/index.ts'),
    },
  },
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
