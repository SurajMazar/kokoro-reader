/**
 * The reading pipeline end to end with a fake inference provider and a fake
 * <audio> element: sentence order, prefetching, navigation, voice changes,
 * cancellation of stale synthesis, errors, and backend fallback.
 * (Real inference is covered by tests/e2e/inference.spec.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackController } from '@/audio/playback-controller';
import type { KokoroProvider } from '@/engine/kokoro/kokoro-provider';
import { ModelManager } from '@/models/model-manager';
import { getVariant, pinnedFile, variantFiles } from '@/models/registry';
import { AppError } from '@/shared/errors';
import type { EngineConfig } from '@/shared/messages/contract';
import { buildDoc } from '@/shared/text/doc';
import type { PlaybackState } from '@/shared/types';

class FakeAudio extends EventTarget {
  src = '';
  playbackRate = 1;
  volume = 1;
  paused = true;
  ended = false;
  preservesPitch = false;
  preload = '';
  error = null;
  async play() {
    this.paused = false;
    this.ended = false;
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  removeAttribute() {
    this.src = '';
  }
  load() {}
  finish() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
}

function fakeProvider(log: string[], delay = 0, fail?: (text: string) => boolean) {
  return {
    ready: { backend: 'wasm', crossOriginIsolated: true, threads: 4, initMs: 1 },
    async initialize(this: { ready: unknown }) {
      return this.ready;
    },
    async synthesize(text: string, { voice, signal }: { voice: string; signal?: AbortSignal }) {
      log.push(`${voice}:${text}`);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (signal?.aborted) throw new AppError('E_CANCELLED');
      if (fail?.(text)) throw new AppError('E_SYNTHESIS', 'boom');
      return { kind: 'pcm' as const, samples: new Float32Array(2400), sampleRate: 24_000, inferenceMs: 5 };
    },
    async cancel() {},
    async dispose() {},
  } as unknown as KokoroProvider;
}

const config: EngineConfig = { engine: 'kokoro', voice: 'af_heart', browserVoice: null, rate: 1.5, volume: 0.8, variantId: 'q8', backend: 'wasm', prefetchSentences: 2 };
const doc = buildDoc({
  title: 'Story',
  source: 'custom',
  blocks: [
    { kind: 'paragraph', text: 'One is first. Two is second.' },
    { kind: 'paragraph', text: 'Three starts here. Four ends it.' },
  ],
});

function setup(options: { delay?: number; fail?: (text: string) => boolean } = {}) {
  const log: string[] = [];
  const states: PlaybackState[] = [];
  const ended: [string, boolean][] = [];
  const audio = new FakeAudio();
  const provider = fakeProvider(log, options.delay, options.fail);
  const models = { ensureReady: vi.fn(async () => provider), ensureVoice: vi.fn(async () => undefined), getState: () => ({ activeBackend: 'wasm' }) } as unknown as ModelManager;
  let created = 0;
  const controller = new PlaybackController({
    models,
    browser: { cancel: async () => undefined } as never,
    emitState: (state) => states.push(state),
    onEnded: (id, completed) => ended.push([id, completed]),
    createAudio: () => (created++ === 0 ? audio : new FakeAudio()) as unknown as HTMLAudioElement,
  });
  const last = () => states.at(-1)!;
  const until = async (predicate: (s: PlaybackState) => boolean) => {
    for (let i = 0; i < 200; i++) {
      if (states.length && predicate(last())) return last();
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error(`timeout; last ${JSON.stringify(last())}`);
  };
  return { controller, audio, log, states, ended, last, until, models };
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${Math.random()}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('PlaybackController', () => {
  it('plays every sentence in order, prefetches ahead and reports completion', async () => {
    const t = setup();
    await t.controller.load('s1', doc, 0, config);
    const first = await t.until((s) => s.status === 'playing');
    expect(first.sentenceText).toBe('One is first.');
    expect(t.audio.playbackRate).toBe(1.5);
    expect(t.audio.volume).toBe(0.8);
    await t.until(() => t.log.length >= 3); // current + 2 prefetched
    for (let i = 0; i < 4; i++) {
      await t.until((s) => s.sentenceIndex === i && s.status === 'playing');
      t.audio.finish();
    }
    await t.until((s) => s.status === 'ended');
    expect(t.ended).toEqual([['s1', true]]);
    expect(t.log.map((l) => l.split(':')[1])).toEqual(['One is first.', 'Two is second.', 'Three starts here.', 'Four ends it.']);
  });

  it('fast-starts a long sentence: plays its first clause, then the rest, then moves on', async () => {
    const t = setup();
    const long = buildDoc({
      title: 'Long',
      source: 'custom',
      blocks: [{ kind: 'paragraph', text: 'Tomato seedlings need steady warmth, before they can be moved outdoors into the long summer beds. Done.' }],
    });
    await t.controller.load('s1', long, 0, config);
    await t.until((s) => s.status === 'playing');
    expect(t.log[0]).toBe('af_heart:Tomato seedlings need steady warmth,');
    t.audio.finish(); // head ends → tail plays, same sentence stays highlighted
    await t.until(() => t.log.includes('af_heart:before they can be moved outdoors into the long summer beds.'));
    await new Promise((r) => setTimeout(r, 5));
    expect(t.last().sentenceIndex).toBe(0);
    t.audio.finish(); // tail ends → next sentence
    await t.until((s) => s.sentenceIndex === 1 && s.status === 'playing');
    // Going back replays the joined sentence from cache, with no new inference.
    const before = t.log.length;
    await t.controller.control('previous');
    await t.until((s) => s.sentenceIndex === 0 && s.status === 'playing');
    expect(t.log.length).toBe(before);
  });

  it('navigates by sentence and paragraph, and seeks', async () => {
    const t = setup();
    await t.controller.load('s1', doc, 0, config);
    await t.until((s) => s.status === 'playing');
    await t.controller.control('next-block');
    expect((await t.until((s) => s.status === 'playing' && s.sentenceIndex === 2)).blockId).toBe(1);
    await t.controller.control('previous');
    await t.until((s) => s.sentenceIndex === 1 && s.status === 'playing');
    await t.controller.control('seek', 3);
    await t.until((s) => s.sentenceIndex === 3 && s.status === 'playing');
    await t.controller.control('previous-block');
    await t.until((s) => s.sentenceIndex === 2);
  });

  it('pauses, resumes and changes speed without regenerating audio', async () => {
    const t = setup();
    await t.controller.load('s1', doc, 0, config);
    await t.until((s) => s.status === 'playing');
    await t.controller.control('toggle');
    expect(t.last().status).toBe('paused');
    expect(t.audio.paused).toBe(true);
    const synthesized = t.log.length;
    await t.controller.set({ rate: 2 });
    expect(t.audio.playbackRate).toBe(2);
    await t.controller.control('play');
    expect(t.last().status).toBe('playing');
    expect(t.log.length).toBe(synthesized);
  });

  it('after a voice change while paused, Play re-synthesizes the current sentence in the new voice', async () => {
    const t = setup();
    await t.controller.load('s1', doc, 1, config);
    await t.until((s) => s.status === 'playing' && s.sentenceIndex === 1);
    await t.controller.control('pause');
    const staleSrc = t.audio.src;
    await t.controller.set({ voice: 'bf_emma' });
    expect(t.last().status).toBe('paused');
    expect(t.audio.src).toBe('');
    await t.controller.control('play');
    const state = await t.until((s) => s.status === 'playing');
    expect(state.voice).toBe('bf_emma');
    expect(state.sentenceIndex).toBe(1);
    expect(t.log).toContain('bf_emma:Two is second.');
    expect(t.audio.src).not.toBe(staleSrc);
  });

  it('a finished reading can be replayed, also after changing the voice', async () => {
    const t = setup();
    const one = buildDoc({ title: 'One', source: 'selection', blocks: [{ kind: 'paragraph', text: 'Watch the generation loop.' }] });
    await t.controller.load('s1', one, 0, config);
    await t.until((s) => s.status === 'playing');
    t.audio.finish();
    await t.until((s) => s.status === 'ended');
    await t.controller.control('play');
    await t.until((s) => s.status === 'playing' && s.sentenceIndex === 0);
    t.audio.finish();
    await t.until((s) => s.status === 'ended');
    await t.controller.set({ voice: 'bm_lewis' });
    await t.controller.control('play');
    const replay = await t.until((s) => s.status === 'playing');
    expect(replay.voice).toBe('bm_lewis');
    expect(t.log).toContain('bm_lewis:Watch the generation loop.');
  });

  it('regenerates from the current sentence when the voice changes', async () => {
    const t = setup();
    await t.controller.load('s1', doc, 1, config);
    await t.until((s) => s.status === 'playing' && s.sentenceIndex === 1);
    await t.controller.set({ voice: 'bf_emma' });
    await t.until((s) => s.status === 'playing' && s.voice === 'bf_emma');
    expect(t.log).toContain('bf_emma:Two is second.');
  });

  it('a new session cancels the old one; stale audio never plays', async () => {
    const t = setup({ delay: 15 });
    void t.controller.load('old', doc, 0, config);
    await new Promise((r) => setTimeout(r, 3));
    const other = buildDoc({ title: 'New', source: 'selection', blocks: [{ kind: 'paragraph', text: 'Fresh words only.' }] });
    await t.controller.load('new', other, 0, config);
    const state = await t.until((s) => s.status === 'playing');
    expect(state.sessionId).toBe('new');
    expect(state.sentenceText).toBe('Fresh words only.');
    expect(t.states.filter((s) => s.sessionId === 'old' && s.status === 'playing')).toHaveLength(0);
  });

  it('surfaces synthesis errors and recovers on retry', async () => {
    let failing = true;
    const t = setup({ fail: () => failing });
    await t.controller.load('s1', doc, 0, config);
    const failed = await t.until((s) => s.status === 'error');
    expect(failed.error?.code).toBe('E_SYNTHESIS');
    failing = false;
    await t.controller.control('play');
    await t.until((s) => s.status === 'playing');
  });

  it('rejects text Kokoro cannot pronounce instead of reading garbage', async () => {
    const t = setup();
    const japanese = buildDoc({ title: 'JP', source: 'selection', blocks: [{ kind: 'paragraph', text: 'これは日本語の文章です。音声合成のテストです。' }] });
    await t.controller.load('s1', japanese, 0, config);
    expect((await t.until((s) => s.status === 'error')).error?.code).toBe('E_UNSUPPORTED_LANGUAGE');
  });

  it('pausing while play() is still starting is not reported as a playback failure', async () => {
    const t = setup();
    await t.controller.load('s1', doc, 0, config);
    await t.until((s) => s.status === 'playing');
    // The next play() is interrupted by pause() before it starts, as browsers do.
    t.audio.play = () => Promise.reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
    await t.controller.control('pause');
    await t.controller.control('restart');
    await new Promise((r) => setTimeout(r, 10));
    expect(t.states.some((s) => s.status === 'error')).toBe(false);
  });

  it('stop clears the session', async () => {
    const t = setup();
    await t.controller.load('s1', doc, 0, config);
    await t.until((s) => s.status === 'playing');
    t.controller.stop();
    expect(t.last().status).toBe('idle');
    expect(t.ended).toEqual([['s1', false]]);
    expect(t.controller.sessionId).toBeNull();
  });
});

describe('ModelManager backend selection', () => {
  beforeEach(() => {
    // Every pinned file is "cached" with its pinned hash.
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (url: string) => {
          const path = url.split(/\/resolve\/[0-9a-f]{40}\//)[1]!;
          return new Response('x', { headers: { 'x-kokoro-sha256': pinnedFile(path).sha256, 'content-length': '1' } });
        },
        keys: async () => [],
      }),
    });
  });

  it('falls back to WASM when WebGPU fails its readiness inference', async () => {
    const tried: string[] = [];
    const manager = new ModelManager({
      onState: () => undefined,
      hasWebGpu: () => true,
      createProvider: (_variant, backend) =>
        ({
          ready: null,
          async initialize(this: { ready: unknown }) {
            tried.push(backend);
            if (backend === 'webgpu') throw new AppError('E_WEBGPU_UNAVAILABLE', 'adapter lost');
            this.ready = { backend: 'wasm', crossOriginIsolated: true, threads: 4, initMs: 3 };
            return this.ready;
          },
          async dispose() {},
        }) as unknown as KokoroProvider,
    });
    await manager.ensureReady('fp32', 'auto');
    expect(tried).toEqual(['webgpu', 'wasm']);
    const state = manager.getState();
    expect(state.status).toBe('ready');
    expect(state.activeBackend).toBe('wasm');
    expect(state.error?.code).toBe('E_WEBGPU_UNAVAILABLE');
  });

  it('validation finishes in a settled state (never stuck on "verifying")', async () => {
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (url: string) => {
          const path = url.split(/\/resolve\/[0-9a-f]{40}\//)[1]!;
          return new Response('x', { headers: { 'x-kokoro-sha256': pinnedFile(path).sha256, 'content-length': '1' } });
        },
        keys: async () => [],
        delete: async () => true,
      }),
    });
    const modelStore = await import('@/models/model-store');
    vi.spyOn(modelStore, 'validateCached').mockResolvedValue(true);
    const manager = new ModelManager({ onState: () => undefined, hasWebGpu: () => false });
    await manager.validate('q8');
    expect(manager.getState().status).toBe('downloaded');
  });

  it('never claims WebGPU just because navigator.gpu exists', () => {
    const manager = new ModelManager({ onState: () => undefined, hasWebGpu: () => true });
    expect(manager.backendOrder(getVariant('q8'), 'auto')).toEqual(['wasm']);
    expect(manager.backendOrder(getVariant('fp32'), 'auto')).toEqual(['webgpu', 'wasm']);
    expect(manager.backendOrder(getVariant('fp32'), 'wasm')).toEqual(['wasm']);
    // q8 and fp16 produced garbled speech on WebGPU, so even an explicit WebGPU preference keeps them on WASM.
    expect(manager.backendOrder(getVariant('q8'), 'webgpu')).toEqual(['wasm']);
    expect(manager.backendOrder(getVariant('fp16'), 'webgpu')).toEqual(['wasm']);
    expect(new ModelManager({ onState: () => undefined, hasWebGpu: () => false }).backendOrder(getVariant('fp32'), 'webgpu')).toEqual(['wasm']);
  });

  it('shares one initialization between concurrent callers', async () => {
    let inits = 0;
    const manager = new ModelManager({
      onState: () => undefined,
      hasWebGpu: () => false,
      createProvider: () =>
        ({
          ready: null,
          async initialize(this: { ready: unknown }) {
            inits++;
            await new Promise((r) => setTimeout(r, 5));
            this.ready = { backend: 'wasm', crossOriginIsolated: false, threads: 1, initMs: 5 };
            return this.ready;
          },
          async dispose() {},
        }) as unknown as KokoroProvider,
    });
    const [a, b] = await Promise.all([manager.ensureReady('q8', 'auto'), manager.ensureReady('q8', 'auto')]);
    expect(a).toBe(b);
    expect(inits).toBe(1);
    expect(variantFiles(getVariant('q8')).map((f) => f.path)).toContain('onnx/model_quantized.onnx');
  });
});
