import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** The project site, published to GitHub Pages at /kokoro-reader/. */
export default defineConfig({
  root: resolve(__dirname),
  base: '/kokoro-reader/',
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, '../site-dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
