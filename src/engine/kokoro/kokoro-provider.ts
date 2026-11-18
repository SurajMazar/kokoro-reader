import type { AudioResult, EngineReadiness, SynthesisOptions, TTSProvider } from '@/engine/contracts/tts-provider';
import { WorkerClient } from '@/engine/contracts/worker-client';
import type { WorkerRequest } from '@/engine/contracts/worker-protocol';
import { normalizeForSpeech } from '@/engine/text/speech-normalizer';
import { MODEL_CACHE } from '@/models/model-store';
import { MODEL_REPOSITORY, MODEL_REVISION, type ModelVariant } from '@/models/registry';
import { AppError } from '@/shared/errors';
import type { BackendId, VoiceInfo } from '@/shared/types';
import { KOKORO_VOICES } from './voices';

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
  private readonly client: WorkerClient<WorkerRequest>;
  private readiness: EngineReadiness | null = null;
  private generation = 0;

  constructor(private readonly options: KokoroProviderOptions) {
    this.client = new WorkerClient<WorkerRequest>(options.createWorker ?? defaultWorker, (error) => {
      this.readiness = null;
      this.options.onCrash?.(error);
    });
  }

  get ready(): EngineReadiness | null {
    return this.readiness;
  }

  async initialize(): Promise<EngineReadiness> {
    if (this.readiness) return this.readiness;
    const response = await this.client.call({
      type: 'init',
      repository: MODEL_REPOSITORY,
      revision: MODEL_REVISION,
      dtype: this.options.variant.dtype,
      backend: this.options.backend,
      wasmPaths: new URL('/ort/', location.href).href,
      cacheName: MODEL_CACHE,
    });
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
    const response = await this.client.call({ type: 'synthesize', text: spoken, voice, speed }, signal);
    if (generation !== this.generation) throw new AppError('E_CANCELLED');
    if (response.type !== 'audio') throw new AppError('E_SYNTHESIS', `Unexpected ${response.type}`);
    return { kind: 'pcm', samples: response.samples, sampleRate: response.sampleRate, inferenceMs: response.inferenceMs };
  }

  /** Invalidates every outstanding request. Results that arrive later are dropped. */
  async cancel(): Promise<void> {
    this.generation += 1;
    this.client.rejectAll(new AppError('E_CANCELLED'));
  }

  async dispose(): Promise<void> {
    await this.cancel();
    this.readiness = null;
    await this.client.terminate();
  }
}
