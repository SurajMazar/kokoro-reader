import type { AppErrorInfo, BackendId } from '@/shared/types';

export interface WorkerInit {
  type: 'init';
  id: number;
  repository: string;
  revision: string;
  dtype: string;
  backend: BackendId;
  /** Absolute URL of the bundled ONNX Runtime WebAssembly files. */
  wasmPaths: string;
  cacheName: string;
}

export interface WorkerSynthesize {
  type: 'synthesize';
  id: number;
  text: string;
  voice: string;
  speed: number;
}

export interface WorkerDispose {
  type: 'dispose';
  id: number;
}

/** Sent outside the job chain: the worker skips that job if it has not started yet. */
export interface WorkerCancel {
  type: 'cancel';
  id: number;
}

export type WorkerRequest = WorkerInit | WorkerSynthesize | WorkerDispose | WorkerCancel;

export type WorkerResponse =
  | { type: 'ready'; id: number; backend: BackendId; initMs: number; threads: number; crossOriginIsolated: boolean }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number; inferenceMs: number; chunks: number }
  | { type: 'disposed'; id: number }
  | { type: 'progress'; id: number; message: string }
  | { type: 'error'; id: number; error: AppErrorInfo };
