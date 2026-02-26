import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'bin/omnious': 'bin/omnious.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: true,
  // tree-sitter native addons must stay external — they can't be bundled
  external: [
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-python',
    'tree-sitter-go',
    'tree-sitter-java',
    'tree-sitter-c-sharp',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    // Bake in the production API URL at build time.
    // Set OMNIOUS_PROD_URL before building for production:
    //   OMNIOUS_PROD_URL=https://api.omnious.dev npm run build
    // When set, `omnious init` will skip the API URL prompt entirely.
    __OMNIOUS_PROD_URL__: JSON.stringify(process.env.OMNIOUS_PROD_URL ?? ''),
  },
});
