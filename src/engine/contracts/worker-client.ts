import { AppError } from '@/shared/errors';
import type { WorkerResponse } from './worker-protocol';

/** Omit that distributes over a union, so each request type keeps its own fields. */
export type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

type Pending = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: unknown) => void;
};

/**
 * Request/response plumbing for one inference worker: request ids, waiting
 * callers, cancellation and crash handling. The worker answers each request
 * with a message carrying the same id.
 */
export class WorkerClient<Request extends { type: string; id: number }> {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private readonly createWorker: () => Worker,
    /** Called when the worker dies; every waiting call has already been rejected. */
    private readonly onCrash: (error: AppError) => void,
  ) {}

  get running(): boolean {
    return this.worker !== null;
  }

  private spawn(): Worker {
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.type === 'error') pending.reject(new AppError(event.data.error.code, event.data.error.detail, event.data.error.message));
      else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.crash(new AppError('E_WORKER_CRASHED', event.message || 'Worker error'));
    };
    worker.onmessageerror = () => this.crash(new AppError('E_WORKER_CRASHED', 'Unreadable worker message'));
    return worker;
  }

  private crash(error: AppError) {
    this.rejectAll(error);
    this.worker?.terminate();
    this.worker = null;
    this.onCrash(error);
  }

  call(message: WithoutId<Request>, signal?: AbortSignal): Promise<WorkerResponse> {
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
          worker.postMessage({ type: 'cancel', id });
          reject(new AppError('E_CANCELLED'));
        },
        { once: true },
      );
      worker.postMessage({ ...message, id });
    });
  }

  rejectAll(error: AppError) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /** Asks the worker to free its models, then terminates it. */
  async terminate(): Promise<void> {
    this.rejectAll(new AppError('E_CANCELLED'));
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          worker.onmessage = () => resolve();
          worker.postMessage({ type: 'dispose', id: 0 });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    } finally {
      worker.terminate();
    }
  }
}
