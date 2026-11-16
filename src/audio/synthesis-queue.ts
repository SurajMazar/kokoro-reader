import { AppError } from '@/shared/errors';

export interface SynthesisJob<T> {
  key: string;
  /** Lower runs first. */
  priority: number;
  run: (signal: AbortSignal) => Promise<T>;
}

interface Entry<T = unknown> extends SynthesisJob<T> {
  abort: AbortController;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  seq: number;
}

/**
 * A single-lane priority queue for inference jobs. One job runs at a time
 * (the ONNX session is not re-entrant); the next job is chosen by priority,
 * so the sentence the listener is waiting for always jumps ahead of
 * prefetching. Jobs can be cancelled individually or all at once, and
 * duplicate keys share one job.
 */
export class SynthesisQueue {
  private waiting: Entry[] = [];
  private running: Entry | null = null;
  private promises = new Map<string, Promise<unknown>>();
  private seq = 0;

  get size(): number {
    return this.waiting.length + (this.running ? 1 : 0);
  }

  has(key: string): boolean {
    return this.promises.has(key);
  }

  enqueue<T>(job: SynthesisJob<T>): Promise<T> {
    const existing = this.promises.get(job.key) as Promise<T> | undefined;
    if (existing) {
      this.reprioritize(job.key, job.priority);
      return existing;
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.waiting.push({ ...job, abort: new AbortController(), resolve: resolve as (value: unknown) => void, reject, seq: this.seq++ } as Entry);
    });
    this.promises.set(job.key, promise);
    promise.catch(() => undefined);
    queueMicrotask(() => this.pump());
    return promise;
  }

  reprioritize(key: string, priority: number) {
    const entry = this.waiting.find((candidate) => candidate.key === key);
    if (entry) entry.priority = priority;
  }

  /** Re-scores every waiting job, e.g. after the listener jumps to another sentence. */
  rescore(score: (key: string) => number | null) {
    for (const entry of [...this.waiting]) {
      const priority = score(entry.key);
      if (priority === null) this.cancel(entry.key);
      else entry.priority = priority;
    }
  }

  cancel(key: string) {
    const index = this.waiting.findIndex((entry) => entry.key === key);
    if (index >= 0) {
      const [entry] = this.waiting.splice(index, 1);
      entry!.reject(new AppError('E_CANCELLED'));
      this.promises.delete(key);
    } else if (this.running?.key === key) {
      this.running.abort.abort();
    }
  }

  cancelAll() {
    for (const entry of this.waiting) entry.reject(new AppError('E_CANCELLED'));
    this.waiting = [];
    this.running?.abort.abort();
    this.promises.clear();
  }

  private pump() {
    if (this.running || !this.waiting.length) return;
    this.waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const entry = this.waiting.shift()!;
    this.running = entry;
    entry
      .run(entry.abort.signal)
      .then(
        (value) => {
          if (entry.abort.signal.aborted) throw new AppError('E_CANCELLED');
          entry.resolve(value);
        },
      )
      .catch((error: unknown) => {
        // Only successes are memoized; a failed or cancelled job can be retried.
        if (this.promises.get(entry.key)) this.promises.delete(entry.key);
        entry.reject(error);
      })
      .finally(() => {
        this.running = null;
        this.pump();
      });
  }

  /** Drops a finished job's memoized promise. */
  forget(key: string) {
    if (!this.waiting.some((entry) => entry.key === key) && this.running?.key !== key) this.promises.delete(key);
  }
}
