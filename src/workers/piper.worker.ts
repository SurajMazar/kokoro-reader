/// <reference lib="webworker" />
/**
 * Piper inference worker, for the Nepali voices. Started by the offscreen
 * document next to the Kokoro worker, so a page that mixes Nepali and
 * English keeps both models loaded.
 *
 * Model files come only from the verified Cache Storage written by the model
 * store (each response carries the SHA-256 recorded at verification). One
 * ONNX session is kept per voice model.
 */
// Same ONNX Runtime build (and /ort/ WebAssembly files) as transformers.js uses for Kokoro.
import * as ort from 'onnxruntime-web';
import type { PiperWorkerRequest, WorkerResponse } from '@/engine/contracts/worker-protocol';
import { espeakClauses } from '@/engine/piper/espeak';
import { normalizeNepali } from '@/engine/piper/normalize';
import { clausesToSentences, phonemesToIds, type PiperVoiceConfig } from '@/engine/piper/phonemes';
import { AppError, toErrorInfo } from '@/shared/errors';

declare const self: DedicatedWorkerGlobalScope;

/** Silence between sentences inside one request, as Piper's own CLI. */
const SENTENCE_GAP_SECONDS = 0.2;
/** Piper normalizes every sentence to full scale; this leaves headroom and sits near Kokoro's loudness. */
const PEAK = 0.8;

interface LoadedVoice {
  session: ort.InferenceSession;
  config: PiperVoiceConfig;
}

let cacheName = '';
const voices = new Map<string, Promise<LoadedVoice>>();

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

async function verified(url: string): Promise<Response> {
  const response = await (await caches.open(cacheName)).match(url);
  if (!response || !response.headers.has('x-kokoro-sha256')) throw new AppError('E_MODEL_INIT', `Voice file is not downloaded: ${url}`);
  return response;
}

function loadVoice(modelUrl: string, configUrl: string): Promise<LoadedVoice> {
  let loading = voices.get(modelUrl);
  if (!loading) {
    loading = (async () => {
      const config = (await (await verified(configUrl)).json()) as PiperVoiceConfig;
      const model = new Uint8Array(await (await verified(modelUrl)).arrayBuffer());
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { session, config };
    })();
    loading.catch(() => voices.delete(modelUrl));
    voices.set(modelUrl, loading);
  }
  return loading;
}

async function runSentence(voice: LoadedVoice, phonemes: string[], speaker: number | null, speed: number): Promise<Float32Array> {
  const { config, session } = voice;
  const ids = phonemesToIds(phonemes, config.phoneme_id_map);
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor(
      'float32',
      Float32Array.from([config.inference.noise_scale, config.inference.length_scale / speed, config.inference.noise_w]),
      [3],
    ),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker ?? 0)]), [1]);
  const output = await session.run(feeds);
  const audio = output[session.outputNames[0]!]!.data as Float32Array;
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 1e-8 ? PEAK / peak : 0;
  return audio.map((sample) => sample * gain);
}

async function synthesize(message: Extract<PiperWorkerRequest, { type: 'synthesize' }>) {
  const voice = await loadVoice(message.modelUrl, message.configUrl);
  const text = normalizeNepali(message.text);
  const sentences = clausesToSentences(await espeakClauses(text, voice.config.espeak.voice), voice.config.vowel_clusters ?? []);
  const sampleRate = voice.config.audio.sample_rate;
  const parts: Float32Array[] = [];
  for (const phonemes of sentences) parts.push(await runSentence(voice, phonemes, message.speaker, message.speed));
  const gap = Math.round(SENTENCE_GAP_SECONDS * sampleRate);
  const length = parts.reduce((sum, part) => sum + part.length, 0) + gap * Math.max(0, parts.length - 1);
  const samples = new Float32Array(length);
  let offset = 0;
  parts.forEach((part, index) => {
    samples.set(part, offset);
    offset += part.length + (index < parts.length - 1 ? gap : 0);
  });
  return { samples, sampleRate, chunks: parts.length };
}

async function dispose() {
  for (const loading of voices.values()) {
    const voice = await loading.catch(() => null);
    await voice?.session.release().catch(() => undefined);
  }
  voices.clear();
}

let chain: Promise<void> = Promise.resolve();
const cancelled = new Set<number>();

self.onmessage = (event: MessageEvent<PiperWorkerRequest>) => {
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
          const started = performance.now();
          cacheName = message.cacheName;
          if (ort.env.wasm) {
            ort.env.wasm.wasmPaths = message.wasmPaths;
            ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)) : 1;
            ort.env.wasm.proxy = false;
          }
          // Load the phonemizer now so the first sentence does not wait for it.
          await espeakClauses('नमस्ते', 'ne');
          post({
            type: 'ready',
            id: message.id,
            backend: 'wasm',
            initMs: Math.round(performance.now() - started),
            threads: Number(ort.env.wasm?.numThreads ?? 1),
            crossOriginIsolated: self.crossOriginIsolated,
          });
          break;
        }
        case 'synthesize': {
          const started = performance.now();
          const { samples, sampleRate, chunks } = await synthesize(message);
          post({ type: 'audio', id: message.id, samples, sampleRate, inferenceMs: Math.round(performance.now() - started), chunks }, [samples.buffer]);
          break;
        }
        case 'dispose': {
          await dispose();
          post({ type: 'disposed', id: message.id });
          break;
        }
      }
    } catch (error) {
      post({ type: 'error', id: message.id, error: toErrorInfo(error, message.type === 'init' ? 'E_MODEL_INIT' : 'E_SYNTHESIS') });
    }
  });
};
