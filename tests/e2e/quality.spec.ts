/**
 * Speech quality check across model variants and backends: the real
 * extension exports the same text with each configuration, and
 * scripts/verify-speech.py transcribes the WAVs with Whisper to confirm the
 * speech is intelligible. Run with: npm run verify:speech
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bgRequest, openExtensionPage, test } from './fixtures';

test.skip(!process.env.QUALITY, 'Set QUALITY=1 to run the speech quality check');

export const QUALITY_TEXT =
  'The quiet garden wakes slowly every morning. Bees move between the lavender flowers, and the old apple tree still produces a heavy crop every second year.';

const CONFIGS = (process.env.QUALITY_CONFIGS ?? 'q8:wasm,fp16:wasm,fp32:webgpu,fp32:wasm')
  .split(',')
  .map((pair) => {
    const [variant, backend] = pair.split(':');
    return { variant: variant!, backend: backend! };
  });

test('export the reference text with every variant', async ({ context, extensionId }) => {
  test.setTimeout(900_000);
  const out = resolve(import.meta.dirname, '../../test-results/quality');
  mkdirSync(out, { recursive: true });
  const ext = await openExtensionPage(context, extensionId);
  const doc = await ext.evaluate(async (text) => {
    const { buildDoc, textToBlocks } = await import(chrome.runtime.getURL('assets/doc.js')).catch(() => ({ buildDoc: null, textToBlocks: null }));
    return buildDoc ? buildDoc({ title: 'Quality', source: 'custom', blocks: textToBlocks(text) }) : null;
  }, QUALITY_TEXT);
  // The page bundle is hashed, so build the document by hand when the import is unavailable.
  const sentences = QUALITY_TEXT.match(/[^.]+\./g)!.map((s) => s.trim());
  let offset = 0;
  const fallback = {
    id: 'quality',
    title: 'Quality',
    source: 'custom',
    blocks: [{ id: 0, kind: 'paragraph', text: QUALITY_TEXT }],
    sentences: sentences.map((text, id) => {
      const start = QUALITY_TEXT.indexOf(text, offset);
      offset = start + text.length;
      return { id, blockId: 0, start, end: start + text.length, text };
    }),
  };
  for (const { variant, backend } of CONFIGS) {
    await ext.evaluate(
      async ([variantId, backendPref]) => {
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, variantId, backend: backendPref } });
      },
      [variant, backend] as const,
    );
    await bgRequest(ext, 'model/action', { action: 'unload' });
    const result = await bgRequest<{ url: string; durationSeconds: number }>(ext, 'export/wav', { doc: doc ?? fallback, voice: 'af_heart' });
    const bytes = await ext.evaluate(async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), result.url);
    const state = await bgRequest<{ activeBackend: string }>(ext, 'model/get');
    writeFileSync(resolve(out, `${variant}-${backend}-ran-on-${state.activeBackend}.wav`), Buffer.from(bytes));
    console.log(`${variant} on ${state.activeBackend}: ${result.durationSeconds} s`);
  }
});
