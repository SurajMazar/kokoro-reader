/**
 * Measures real performance on this machine and writes
 * docs/performance/results-<date>.json. Nothing is estimated: every number
 * comes from the running extension. Run with: npm run benchmark
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { bgRequest, openExtensionPage, SITE, test, waitForPlayback } from './fixtures';

test.skip(!process.env.BENCHMARK, 'Set BENCHMARK=1 to run the benchmark');

type Diagnostic = { at: number; kind: string; data: Record<string, number | string | boolean | null> };

test('benchmark', async ({ page, context, extensionId, serviceWorker }) => {
  test.setTimeout(900_000);
  const ext = await openExtensionPage(context, extensionId);
  const diagnostics = async () => ext.evaluate(async () => ((await chrome.storage.local.get('diagnostics')).diagnostics ?? []) as Diagnostic[]);
  const metrics = () => bgRequest<{ memoryBytes: number | null; jsHeapBytes: number | null } | null>(ext, 'diagnostics/metrics');

  await ext.evaluate(() => chrome.storage.local.set({ diagnostics: [] }));
  // Optional: BENCH_VARIANT=fp32 BENCH_BACKEND=webgpu to measure another configuration.
  const variant = process.env.BENCH_VARIANT ?? 'q8';
  const backend = process.env.BENCH_BACKEND ?? 'auto';
  await ext.evaluate(
    async ([variantId, backendPref]) => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, variantId, backend: backendPref } });
    },
    [variant, backend] as const,
  );
  // Model download (fresh profile): pinned files, verified by SHA-256.
  const downloadStart = Date.now();
  await bgRequest(ext, 'model/action', { action: 'download' });
  for (;;) {
    const state = await bgRequest<{ status: string }>(ext, 'model/get');
    if (state.status === 'downloaded' || state.status === 'ready') break;
    if (state.status === 'error') throw new Error('download failed');
    await page.waitForTimeout(250);
  }
  const modelDownloadMs = Date.now() - downloadStart;
  const idleMemory = await metrics();
  // Cold engine: close the offscreen document so the model must load again.
  await serviceWorker.evaluate(() => chrome.offscreen.closeDocument().catch(() => undefined));
  await page.goto(`${SITE}/long-article.html`);
  const tabId = await ext.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)!.id!, `${SITE}/long-article.html`);

  const coldStart = Date.now();
  await bgRequest(ext, 'tab/read', { tabId, mode: 'page' });
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing', 300_000);
  const coldFirstAudioMs = Date.now() - coldStart;

  // Listen for a while to collect steady-state synthesis numbers and underruns.
  let buffering = 0;
  let last = '';
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const state = (await serviceWorker.evaluate(async () => (await chrome.storage.session.get('playback')).playback)) as { status: string; sentenceIndex: number };
    const key = `${state.sentenceIndex}:${state.status}`;
    if (key !== last && state.status === 'buffering') buffering++;
    last = key;
    await page.waitForTimeout(100);
  }
  const playingMemory = await metrics();

  // Warm start: engine loaded, new selection.
  await bgRequest(ext, 'session/control', { action: 'stop' });
  await page.goto(`${SITE}/basic.html`);
  const basicTab = await ext.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)!.id!, `${SITE}/basic.html`);
  const warmStart = Date.now();
  await bgRequest(ext, 'tab/read', { tabId: basicTab, mode: 'page' });
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing', 120_000);
  const warmFirstAudioMs = Date.now() - warmStart;
  await bgRequest(ext, 'session/control', { action: 'stop' });

  const events = await diagnostics();
  const synth = events.filter((event) => event.kind === 'synthesis').map((event) => event.data as { seconds: number; inferenceMs: number; rtf: number; chars: number });
  const init = events.filter((event) => event.kind === 'model-init').map((event) => event.data);
  const audioSeconds = synth.reduce((sum, item) => sum + item.seconds, 0);
  const inferenceSeconds = synth.reduce((sum, item) => sum + item.inferenceMs, 0) / 1000;
  const sorted = synth.map((item) => item.rtf).sort((a, b) => a - b);
  const results = {
    date: new Date().toISOString(),
    machine: { platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cores: cpus().length, memoryGB: Math.round(totalmem() / 2 ** 30) },
    browser: await ext.evaluate(() => navigator.userAgent),
    model: `Kokoro-82M v1.0 ONNX, variant ${variant}, backend preference ${backend}`,
    backend: init.at(-1),
    modelDownloadMs,
    modelInitMs: init.map((item) => item.ms),
    timeToFirstAudioMs: { coldEngine: coldFirstAudioMs, warmEngine: warmFirstAudioMs },
    synthesis: {
      sentences: synth.length,
      audioSeconds: Math.round(audioSeconds * 10) / 10,
      inferenceSeconds: Math.round(inferenceSeconds * 10) / 10,
      overallRealTimeFactor: Math.round((inferenceSeconds / audioSeconds) * 100) / 100,
      rtfMedian: sorted[Math.floor(sorted.length / 2)],
      rtfP90: sorted[Math.floor(sorted.length * 0.9)],
    },
    playbackUnderrunsIn60s: buffering,
    memory: { offscreenIdleBytes: idleMemory?.memoryBytes ?? null, offscreenPlayingBytes: playingMemory?.memoryBytes ?? null, jsHeapPlayingBytes: playingMemory?.jsHeapBytes ?? null },
  };
  const out = resolve(import.meta.dirname, '../../docs/performance');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, `results-${results.date.slice(0, 10)}-${variant}-${backend}.json`), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
});
