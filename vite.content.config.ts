import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Content scripts are classic scripts: they cannot use ES module imports.
 * This second build bundles the content script into a single IIFE file
 * with its stylesheet inlined as a string for the Shadow DOM.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  define: {
    __KOKORO_E2E__: JSON.stringify(process.env.KOKORO_E2E === '1'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  publicDir: false,
  build: {
    outDir: resolve(__dirname, process.env.KOKORO_E2E === '1' ? 'dist-e2e' : 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'KokoroReaderContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { extend: false },
    },
  },
});
