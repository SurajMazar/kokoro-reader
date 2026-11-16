import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildManifest } from './scripts/manifest';

const root = resolve(__dirname, 'src');
const defaultOutDir = resolve(__dirname, process.env.KOKORO_E2E === '1' ? 'dist-e2e' : 'dist');

/**
 * Copies the ONNX Runtime Web WebAssembly runtime into the extension so it is
 * loaded from the extension origin. Manifest V3 forbids remote code, and
 * transformers.js would otherwise fetch these files from a CDN.
 */
function onnxRuntimeAssets(): Plugin {
  return {
    name: 'kokoro-onnx-runtime-assets',
    apply: 'build',
    writeBundle() {
      const from = resolve(__dirname, 'node_modules/@huggingface/transformers/dist');
      const outDir = this.environment?.config.build.outDir ?? defaultOutDir;
      const to = resolve(outDir, 'ort');
      mkdirSync(to, { recursive: true });
      for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
        copyFileSync(resolve(from, file), resolve(to, file));
      }
      // Rollup also emits a hashed copy of the .wasm it finds via import.meta.url.
      // The worker sets wasmPaths to /ort/, so that copy is never loaded.
      const assets = resolve(outDir, 'assets');
      for (const file of readdirSync(assets)) {
        if (file.startsWith('ort-wasm-simd-threaded') && file.endsWith('.wasm')) rmSync(resolve(assets, file));
      }
    },
  };
}

/** Writes dist/manifest.json from scripts/manifest.ts. */
function extensionManifest(): Plugin {
  return {
    name: 'kokoro-manifest',
    apply: 'build',
    writeBundle() {
      const outDir = this.environment?.config.build.outDir ?? defaultOutDir;
      const manifest = buildManifest({ e2e: process.env.KOKORO_E2E === '1' });
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig({
  root,
  base: '',
  publicDir: resolve(__dirname, 'public'),
  plugins: [react(), tailwindcss(), onnxRuntimeAssets(), extensionManifest()],
  resolve: {
    alias: { '@': root },
  },
  define: {
    __KOKORO_E2E__: JSON.stringify(process.env.KOKORO_E2E === '1'),
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: defaultOutDir,
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: false,
    modulePreload: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup/index.html'),
        options: resolve(root, 'options/index.html'),
        reader: resolve(root, 'reader/index.html'),
        sidepanel: resolve(root, 'sidepanel/index.html'),
        welcome: resolve(root, 'welcome/index.html'),
        offscreen: resolve(root, 'offscreen/index.html'),
        background: resolve(root, 'background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
