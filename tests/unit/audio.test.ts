import { describe, expect, it } from 'vitest';
import { SynthesisQueue } from '@/audio/synthesis-queue';
import { concatenate, encodeWav, safeFilename } from '@/audio/wav';

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM RIFF file', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
    const view = new DataView(encodeWav(samples, 24_000));
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
    expect(view.getInt16(44 + 6, true)).toBe(32767); // 1.0
    expect(view.getInt16(44 + 8, true)).toBe(-32768); // -1.0
    expect(view.getInt16(44 + 10, true)).toBe(32767); // clipped 2.0
  });
  it('embeds an even-padded LIST/INFO metadata chunk', () => {
    const view = new DataView(encodeWav(new Float32Array(4), 24_000, { title: 'Hi', software: 'Kokoro Reader' }));
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4));
    expect(text(36)).toBe('LIST');
    const listSize = view.getUint32(40, true);
    expect(listSize % 2).toBe(0);
    expect(text(44 + listSize)).toBe('data');
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
  });
});

describe('concatenate / filenames', () => {
  it('joins clips with silence gaps', () => {
    const out = concatenate([new Float32Array([1, 1]), new Float32Array([2])], 10, 0.2);
    expect(Array.from(out)).toEqual([1, 1, 0, 0, 2]);
  });
  it('builds safe filenames', () => {
    expect(safeFilename('Héllo / Wörld: <test>!')).toMatch(/^hello-world-test-\d{4}-\d{2}-\d{2}\.wav$/);
    expect(safeFilename('***')).toMatch(/^kokoro-reader-/);
  });
});

describe('SynthesisQueue', () => {
  const deferred = () => {
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('runs one job at a time in priority order', async () => {
    const queue = new SynthesisQueue();
    const order: string[] = [];
    const gate = deferred();
    // Jobs enqueued in the same tick are all ranked before the first one starts.
    const first = queue.enqueue({ key: 'a', priority: 5, run: async () => (order.push('a'), gate.promise) });
    const low = queue.enqueue({ key: 'low', priority: 10, run: async () => (order.push('low'), 'low') });
    const high = queue.enqueue({ key: 'high', priority: 1, run: async () => (order.push('high'), 'high') });
    await new Promise((r) => setTimeout(r, 0));
    // A job arriving while 'a' runs still jumps ahead of 'low'.
    const urgent = queue.enqueue({ key: 'urgent', priority: 0, run: async () => (order.push('urgent'), 'urgent') });
    gate.resolve('a');
    expect(await Promise.all([first, low, high, urgent])).toEqual(['a', 'low', 'high', 'urgent']);
    expect(order).toEqual(['high', 'a', 'urgent', 'low']);
  });

  it('deduplicates keys and supports cancellation', async () => {
    const queue = new SynthesisQueue();
    let runs = 0;
    const gate = deferred();
    const blocker = queue.enqueue({ key: 'block', priority: 0, run: () => gate.promise });
    const one = queue.enqueue({ key: 'x', priority: 1, run: async () => (runs++, 'x') });
    const two = queue.enqueue({ key: 'x', priority: 1, run: async () => (runs++, 'x2') });
    expect(one).toBe(two);
    const doomed = queue.enqueue({ key: 'y', priority: 2, run: async () => 'y' });
    queue.cancel('y');
    await expect(doomed).rejects.toMatchObject({ code: 'E_CANCELLED' });
    gate.resolve('b');
    await blocker;
    expect(await one).toBe('x');
    expect(runs).toBe(1);
  });

  it('rescoring drops jobs outside the window', async () => {
    const queue = new SynthesisQueue();
    const gate = deferred();
    void queue.enqueue({ key: 's:0', priority: 0, run: () => gate.promise });
    const far = queue.enqueue({ key: 's:9', priority: 9, run: async () => 'far' });
    queue.rescore((key) => (key === 's:9' ? null : 0));
    await expect(far).rejects.toMatchObject({ code: 'E_CANCELLED' });
    gate.resolve('done');
  });

  it('cancelAll aborts the running job', async () => {
    const queue = new SynthesisQueue();
    let aborted = false;
    const running = queue.enqueue({
      key: 'r',
      priority: 0,
      run: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => ((aborted = true), reject(new Error('aborted'))))),
    });
    await Promise.resolve();
    queue.cancelAll();
    await expect(running).rejects.toBeTruthy();
    expect(aborted).toBe(true);
  });
});

describe('fastStartSplit', () => {
  it('leaves short sentences whole', async () => {
    const { fastStartSplit } = await import('@/audio/fast-start');
    expect(fastStartSplit('A short sentence.')).toBeNull();
  });
  it('splits long sentences at an early clause boundary', async () => {
    const { fastStartSplit } = await import('@/audio/fast-start');
    const text = 'Tomato seedlings need steady warmth, before they can be moved outdoors into the long summer beds.';
    const [head, tail] = fastStartSplit(text)!;
    expect(head).toBe('Tomato seedlings need steady warmth,');
    expect(`${head} ${tail}`).toBe(text);
  });
  it('falls back to a word boundary near the target length', async () => {
    const { fastStartSplit } = await import('@/audio/fast-start');
    const text = 'The quiet garden wakes slowly every morning while dew settles on the broad leaves of the squash plants';
    const [head, tail] = fastStartSplit(text)!;
    expect(head.length).toBeGreaterThanOrEqual(20);
    expect(head.length).toBeLessThanOrEqual(80);
    expect(`${head} ${tail}`).toBe(text);
  });
});
