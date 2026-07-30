import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    target: 'node18',
  },
  {
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    minify: false,
    target: 'node18',
  },
  {
    entry: ['src/sync.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    minify: false,
    target: 'node18',
  },
]);
