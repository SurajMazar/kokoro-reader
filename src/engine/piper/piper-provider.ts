import type { AudioResult, EngineReadiness, SynthesisOptions, TTSProvider } from '@/engine/contracts/tts-provider';
import { WorkerClient } from '@/engine/contracts/worker-client';
import type { PiperWorkerRequest } from '@/engine/contracts/worker-protocol';
import { MODEL_CACHE } from '@/models/model-store';
import { fileUrl } from '@/models/registry';
import { AppError } from '@/shared/errors';
import type { VoiceInfo } from '@/shared/types';
import { getNepaliVoice, getPack, NEPALI_VOICES, packConfigPath, packModelPath } from './voices';

export interface PiperProviderOptions {
  createWorker?: () => Worker;
  onCrash?: (error: AppError) => void;
}

function defaultWorker(): Worker {
  return new Worker(new URL('../../workers/piper.worker.ts', import.meta.url), { type: 'module', name: 'piper-inference' });
}

/** Main-thread handle to the Piper worker, which speaks the Nepali voices. */
export class PiperProvider implements TTSProvider {
  readonly id = 'kokoro' as const;
  private readonly client: WorkerClient<PiperWorkerRequest>;
  private readiness: EngineReadiness | null = null;
  private generation = 0;

  constructor(private readonly options: PiperProviderOptions = {}) {
    this.client = new WorkerClient<PiperWorkerRequest>(options.createWorker ?? defaultWorker, (error) => {
      this.readiness = null;
      this.options.onCrash?.(error);
    });
  }

  get ready(): EngineReadiness | null {
    return this.readiness;
  }

  async initialize(): Promise<EngineReadiness> {
    if (this.readiness) return this.readiness;
    const response = await this.client.call({ type: 'init', wasmPaths: new URL('/ort/', location.href).href, cacheName: MODEL_CACHE });
    if (response.type !== 'ready') throw new AppError('E_MODEL_INIT', `Unexpected ${response.type}`);
    this.readiness = { backend: 'wasm', crossOriginIsolated: response.crossOriginIsolated, threads: response.threads, initMs: response.initMs };
    return this.readiness;
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return [...NEPALI_VOICES];
  }

  async synthesize(text: string, { voice, speed = 1, signal }: SynthesisOptions): Promise<AudioResult> {
    if (!this.readiness) throw new AppError('E_MODEL_INIT', 'The Nepali engine is not initialized');
    const info = getNepaliVoice(voice);
    if (!info) throw new AppError('E_SYNTHESIS', `Unknown Nepali voice: ${voice}`);
    if (!text.trim()) return { kind: 'pcm', samples: new Float32Array(0), sampleRate: 22_050, inferenceMs: 0 };
    const pack = getPack(info.packId);
    const generation = this.generation;
    const response = await this.client.call(
      {
        type: 'synthesize',
        text,
        modelUrl: fileUrl(packModelPath(pack)),
        configUrl: fileUrl(packConfigPath(pack)),
        speaker: info.speaker,
        speed,
      },
      signal,
    );
    if (generation !== this.generation) throw new AppError('E_CANCELLED');
    if (response.type !== 'audio') throw new AppError('E_SYNTHESIS', `Unexpected ${response.type}`);
    return { kind: 'pcm', samples: response.samples, sampleRate: response.sampleRate, inferenceMs: response.inferenceMs };
  }

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
