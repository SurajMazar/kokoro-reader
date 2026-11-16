import type { BackendId, EngineId, VoiceInfo } from '@/shared/types';

export interface SynthesisOptions {
  voice: string;
  /** Kokoro's native speed control. Playback rate is applied separately at play time. */
  speed?: number;
  signal?: AbortSignal;
}

/** Raw PCM produced by a neural engine. */
export interface PcmAudio {
  kind: 'pcm';
  samples: Float32Array;
  sampleRate: number;
  /** Measured inference time, for real-time-factor diagnostics. */
  inferenceMs: number;
}

/** A system engine that can only speak live (it cannot return audio data). */
export interface LiveAudio {
  kind: 'live';
  text: string;
  voice: string;
}

export type AudioResult = PcmAudio | LiveAudio;

export interface EngineReadiness {
  backend: BackendId | null;
  crossOriginIsolated: boolean;
  threads: number;
  initMs: number;
}

/**
 * The provider contract. The Kokoro engine and the browser fallback both
 * implement it, so the playback pipeline never depends on a specific engine,
 * and the engine can be reused outside the Chrome extension.
 */
export interface TTSProvider {
  readonly id: EngineId;
  initialize(): Promise<EngineReadiness>;
  getVoices(): Promise<VoiceInfo[]>;
  synthesize(text: string, options: SynthesisOptions): Promise<AudioResult>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
