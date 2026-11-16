import type { AudioResult, EngineReadiness, SynthesisOptions, TTSProvider } from '@/engine/contracts/tts-provider';
import type { WorkerRequest, WorkerResponse } from '@/engine/contracts/worker-protocol';
import { normalizeForSpeech } from '@/engine/text/speech-normalizer';
import { MODEL_CACHE } from '@/models/model-store';
import { MODEL_REPOSITORY, MODEL_REVISION, type ModelVariant } from '@/models/registry';
import { AppError } from '@/shared/errors';
import type { BackendId, VoiceInfo } from '@/shared/types';
import { KOKORO_VOICES } from './voices';

type Pending = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: unknown) => void;
};

export interface KokoroProviderOptions {
  variant: ModelVariant;
  backend: BackendId;
  /** Creates the worker; injectable for tests. */
  createWorker?: () => Worker;
  /** Called when the worker dies so the owner can surface E_WORKER_CRASHED and rebuild. */
  onCrash?: (error: AppError) => void;
}

function defaultWorker(): Worker {
  return new Worker(new URL('../../workers/kokoro.worker.ts', import.meta.url), { type: 'module', name: 'kokoro-inference' });
}

/**
 * Main-thread handle to the Kokoro inference worker. One instance owns one
 * worker with one loaded model on one backend.
 */
export class KokoroProvider implements TTSProvider {
  readonly id = 'kokoro' as const;
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readiness: EngineReadiness | null = null;
  private generation = 0;

  constructor(private readonly options: KokoroProviderOptions) {}

  get ready(): EngineReadiness | null {
    return this.readiness;
  }

  private spawn(): Worker {
    const worker = (this.options.createWorker ?? defaultWorker)();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.type === 'error') pending.reject(new AppError(event.data.error.code, event.data.error.detail, event.data.error.message));
      else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.failAll(new AppError('E_WORKER_CRASHED', event.message || 'Worker error'));
    };
    worker.onmessageerror = () => this.failAll(new AppError('E_WORKER_CRASHED', 'Unreadable worker message'));
    return worker;
  }

  private failAll(error: AppError) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.readiness = null;
    this.options.onCrash?.(error);
  }

  private call(message: Omit<WorkerRequest, 'id'>, signal?: AbortSignal): Promise<WorkerResponse> {
    const worker = (this.worker ??= this.spawn());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // An in-flight ONNX run cannot be interrupted; an aborted caller simply
      // stops waiting and the result is discarded on arrival.
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.delete(id)) return;
          // Let the worker skip it if it has not started; a running inference finishes and is discarded.
          worker.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
          reject(new AppError('E_CANCELLED'));
        },
        { once: true },
      );
      worker.postMessage({ ...message, id } as WorkerRequest);
    });
  }

  async initialize(): Promise<EngineReadiness> {
    if (this.readiness) return this.readiness;
    const response = await this.call({
      type: 'init',
      repository: MODEL_REPOSITORY,
      revision: MODEL_REVISION,
      dtype: this.options.variant.dtype,
      backend: this.options.backend,
      wasmPaths: new URL('/ort/', location.href).href,
      cacheName: MODEL_CACHE,
    } as Omit<WorkerRequest, 'id'>);
    if (response.type !== 'ready') throw new AppError('E_MODEL_INIT', `Unexpected ${response.type}`);
    this.readiness = {
      backend: response.backend,
      crossOriginIsolated: response.crossOriginIsolated,
      threads: response.threads,
      initMs: response.initMs,
    };
    return this.readiness;
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return [...KOKORO_VOICES];
  }

  async synthesize(text: string, { voice, speed = 1, signal }: SynthesisOptions): Promise<AudioResult> {
    if (!this.readiness) throw new AppError('E_MODEL_INIT', 'Kokoro is not initialized');
    const spoken = normalizeForSpeech(text);
    if (!spoken) return { kind: 'pcm', samples: new Float32Array(0), sampleRate: 24_000, inferenceMs: 0 };
    const generation = this.generation;
    const response = await this.call({ type: 'synthesize', text: spoken, voice, speed } as Omit<WorkerRequest, 'id'>, signal);
    if (generation !== this.generation) throw new AppError('E_CANCELLED');
    if (response.type !== 'audio') throw new AppError('E_SYNTHESIS', `Unexpected ${response.type}`);
    return { kind: 'pcm', samples: response.samples, sampleRate: response.sampleRate, inferenceMs: response.inferenceMs };
  }

  /** Invalidates every outstanding request. Results that arrive later are dropped. */
  async cancel(): Promise<void> {
    this.generation += 1;
    for (const pending of this.pending.values()) pending.reject(new AppError('E_CANCELLED'));
    this.pending.clear();
  }

  async dispose(): Promise<void> {
    await this.cancel();
    const worker = this.worker;
    this.worker = null;
    this.readiness = null;
    if (!worker) return;
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          worker.onmessage = () => resolve();
          worker.postMessage({ type: 'dispose', id: 0 } satisfies WorkerRequest);
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    } finally {
      worker.terminate();
    }
  }
}
