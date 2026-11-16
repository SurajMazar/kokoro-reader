/// <reference lib="webworker" />
/**
 * Kokoro inference worker. Runs in a dedicated Web Worker started by the
 * offscreen document, so inference never blocks audio playback or the UI.
 *
 * Model files are served to transformers.js from the verified Cache Storage
 * written by the model store. Remote loading is pointed at an unresolvable
 * host, so a cache miss fails loudly instead of downloading unverified bytes.
 */
import { AutoTokenizer, StyleTextToSpeech2Model, Tensor, env, type PreTrainedTokenizer } from '@huggingface/transformers';
import type { WorkerRequest, WorkerResponse } from '@/engine/contracts/worker-protocol';
import { phonemize } from '@/engine/kokoro/phonemize';
import { voiceFilePath } from '@/engine/kokoro/voices';
import { toErrorInfo, AppError } from '@/shared/errors';
import type { BackendId } from '@/shared/types';

declare const self: DedicatedWorkerGlobalScope;

const SAMPLE_RATE = 24_000;
/** Kokoro accepts 512 tokens including start/end; leave headroom. */
const MAX_PHONEME_TOKENS = 500;
const STYLE_DIM = 256;
const BLOCKED_HOST = 'https://kokoro-reader.invalid/';
const GAP_SECONDS = 0.06;

interface Loaded {
  model: StyleTextToSpeech2Model;
  tokenizer: PreTrainedTokenizer;
  backend: BackendId;
  repository: string;
  revision: string;
  cacheName: string;
}

let loaded: Loaded | null = null;
const voiceCache = new Map<string, Float32Array>();

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

function configureRuntime(init: { wasmPaths: string; cacheName: string; repository: string; revision: string }) {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = BLOCKED_HOST;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  const realPrefix = `https://huggingface.co/${init.repository}/resolve/${init.revision}/`;
  const blockedPrefix = `${BLOCKED_HOST}${init.repository}/resolve/${init.revision}/`;
  env.customCache = {
    async match(key: string | Request) {
      const url = typeof key === 'string' ? key : key.url;
      if (!url.startsWith(blockedPrefix)) return undefined;
      const cache = await caches.open(init.cacheName);
      const response = await cache.match(realPrefix + url.slice(blockedPrefix.length));
      return response && response.headers.has('x-kokoro-sha256') ? response : undefined;
    },
    async put() {
      // Files are only written by the verifying model store.
    },
  };
  const onnx = env.backends.onnx;
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = init.wasmPaths;
    onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    onnx.wasm.proxy = false;
  }
}

async function loadVoice(voice: string): Promise<Float32Array> {
  const cached = voiceCache.get(voice);
  if (cached) return cached;
  if (!loaded) throw new AppError('E_MODEL_INIT', 'Model is not loaded');
  const url = `https://huggingface.co/${loaded.repository}/resolve/${loaded.revision}/${voiceFilePath(voice)}`;
  const response = await (await caches.open(loaded.cacheName)).match(url);
  if (!response || !response.headers.has('x-kokoro-sha256')) throw new AppError('E_MODEL_INIT', `Voice ${voice} is not downloaded`);
  const data = new Float32Array(await response.arrayBuffer());
  voiceCache.set(voice, data);
  return data;
}

function tokenize(phonemes: string) {
  if (!loaded) throw new AppError('E_MODEL_INIT', 'Model is not loaded');
  return loaded.tokenizer(phonemes, { truncation: false }).input_ids as Tensor;
}

/** Splits text near its middle at the strongest available boundary. */
function splitInTwo(text: string): [string, string] {
  const middle = Math.floor(text.length / 2);
  for (const pattern of [/[.!?;:]\s/g, /[,—–]\s/g, /\s/g]) {
    let best = -1;
    for (const match of text.matchAll(pattern)) {
      const cut = match.index + match[0].length;
      if (best < 0 || Math.abs(cut - middle) < Math.abs(best - middle)) best = cut;
    }
    if (best > 0 && best < text.length) return [text.slice(0, best).trim(), text.slice(best).trim()];
  }
  return [text.slice(0, middle), text.slice(middle)];
}

/** Phonemizes and tokenizes text, splitting it until every piece fits the model's context. */
async function toTokenChunks(text: string, language: 'a' | 'b', depth = 0): Promise<Tensor[]> {
  const phonemes = await phonemize(text, language);
  if (!phonemes) return [];
  const ids = tokenize(phonemes);
  if (ids.dims.at(-1)! - 2 <= MAX_PHONEME_TOKENS || depth > 6 || text.length < 8) {
    return [ids.dims.at(-1)! - 2 > MAX_PHONEME_TOKENS ? tokenize(phonemes.slice(0, MAX_PHONEME_TOKENS)) : ids];
  }
  const [left, right] = splitInTwo(text);
  return [...(await toTokenChunks(left, language, depth + 1)), ...(await toTokenChunks(right, language, depth + 1))];
}

async function runModel(ids: Tensor, voiceData: Float32Array, speed: number): Promise<Float32Array> {
  if (!loaded) throw new AppError('E_MODEL_INIT', 'Model is not loaded');
  const tokens = Math.min(Math.max(ids.dims.at(-1)! - 2, 0), 509);
  const style = voiceData.slice(tokens * STYLE_DIM, tokens * STYLE_DIM + STYLE_DIM);
  const { waveform } = (await loaded.model({
    input_ids: ids,
    style: new Tensor('float32', style, [1, STYLE_DIM]),
    speed: new Tensor('float32', [speed], [1]),
  })) as { waveform: Tensor };
  return waveform.data as Float32Array;
}

async function synthesize(text: string, voice: string, speed: number) {
  const voiceData = await loadVoice(voice);
  const language = voice.startsWith('b') ? 'b' : 'a';
  const chunks = await toTokenChunks(text, language);
  const parts: Float32Array[] = [];
  for (const ids of chunks) parts.push(await runModel(ids, voiceData, speed));
  const gap = Math.round(GAP_SECONDS * SAMPLE_RATE);
  const length = parts.reduce((sum, part) => sum + part.length, 0) + gap * Math.max(0, parts.length - 1);
  const samples = new Float32Array(length);
  let offset = 0;
  parts.forEach((part, index) => {
    samples.set(part, offset);
    offset += part.length + (index < parts.length - 1 ? gap : 0);
  });
  return { samples, chunks: chunks.length };
}

async function load(init: Extract<WorkerRequest, { type: 'init' }>): Promise<WorkerResponse> {
  const started = performance.now();
  configureRuntime(init);
  if (init.backend === 'webgpu') {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (!adapter) throw new AppError('E_WEBGPU_UNAVAILABLE', 'navigator.gpu.requestAdapter() returned no adapter');
  }
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(init.repository, {
      dtype: init.dtype as 'q8',
      device: init.backend,
      revision: init.revision,
    }),
    AutoTokenizer.from_pretrained(init.repository, { revision: init.revision }),
  ]);
  loaded = { model, tokenizer, backend: init.backend, repository: init.repository, revision: init.revision, cacheName: init.cacheName };

  // Readiness test: a real inference run proves the backend works,
  // rather than trusting that navigator.gpu exists.
  const test = await synthesize('Ready.', 'af_heart', 1);
  if (!test.samples.length || test.samples.some((value) => !Number.isFinite(value))) {
    throw new AppError('E_MODEL_INIT', `Readiness test produced invalid audio on ${init.backend}`);
  }
  const threads = init.backend === 'wasm' ? Number(env.backends.onnx.wasm?.numThreads ?? 1) : 0;
  return {
    type: 'ready',
    id: init.id,
    backend: init.backend,
    initMs: Math.round(performance.now() - started),
    threads,
    crossOriginIsolated: self.crossOriginIsolated,
  };
}

async function dispose() {
  if (loaded) {
    await loaded.model.dispose().catch(() => undefined);
    loaded = null;
  }
  voiceCache.clear();
}

// Requests are processed one at a time; ONNX sessions are not re-entrant.
let chain: Promise<void> = Promise.resolve();
const cancelled = new Set<number>();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  chain = chain.then(async () => {
    if (cancelled.delete(message.id)) {
      post({ type: 'error', id: message.id, error: new AppError('E_CANCELLED').toInfo() });
      return;
    }
    try {
      switch (message.type) {
        case 'init': {
          await dispose();
          post(await load(message));
          break;
        }
        case 'synthesize': {
          const started = performance.now();
          const { samples, chunks } = await synthesize(message.text, message.voice, message.speed);
          post(
            { type: 'audio', id: message.id, samples, sampleRate: SAMPLE_RATE, inferenceMs: Math.round(performance.now() - started), chunks },
            [samples.buffer],
          );
          break;
        }
        case 'dispose': {
          await dispose();
          post({ type: 'disposed', id: message.id });
          break;
        }
      }
    } catch (error) {
      const fallback = message.type === 'init' ? (message.backend === 'webgpu' ? 'E_WEBGPU_UNAVAILABLE' : 'E_MODEL_INIT') : 'E_SYNTHESIS';
      post({ type: 'error', id: message.id, error: toErrorInfo(error, fallback) });
    }
  });
};
