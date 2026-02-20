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
  banner: {
    js: '#!/usr/bin/env node',
  },
});
