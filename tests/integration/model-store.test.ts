/**
 * Model download → verification → cache, against an in-memory Cache Storage
 * and a fake network. Uses the real pinned manifest entry for config.json.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFile, isCached, readCached, validateCached, MODEL_CACHE, clearModelCache, cachedBytes } from '@/models/model-store';
import { fileUrl } from '@/models/registry';
import { deletePartials, getPartials } from '@/shared/storage/idb';

const CONFIG = new TextEncoder().encode('{\n  "model_type": "style_text_to_speech_2"\n}');

class MemoryCache {
  entries = new Map<string, Response>();
  async match(key: string) {
    const hit = this.entries.get(typeof key === 'string' ? key : (key as Request).url);
    return hit?.clone();
  }
  async put(key: string, response: Response) {
    this.entries.set(key, response.clone());
  }
  async delete(key: string) {
    return this.entries.delete(key);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

let cache: MemoryCache;
beforeEach(() => {
  cache = new MemoryCache();
  vi.stubGlobal('caches', {
    open: async (name: string) => (name === MODEL_CACHE ? cache : new MemoryCache()),
    delete: async () => {
      cache = new MemoryCache();
      return true;
    },
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await deletePartials();
});

/** A body stream; with failAfter it delivers that many bytes, then the connection drops. */
function streamOf(bytes: Uint8Array, failAfter?: number) {
  let pulls = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (failAfter === undefined) {
        if (pulls === 1) controller.enqueue(bytes);
        else controller.close();
        return;
      }
      if (pulls === 1) controller.enqueue(bytes.slice(0, failAfter));
      else controller.error(new TypeError('network dropped'));
    },
  });
}

describe('model store', () => {
  it('downloads from the commit-pinned URL, verifies SHA-256 and caches', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(streamOf(CONFIG), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const progress: number[] = [];
    await ensureFile('config.json', new AbortController().signal, (p) => progress.push(p.loaded));
    expect(fetchMock.mock.calls[0]![0]).toBe(fileUrl('config.json'));
    expect(fileUrl('config.json')).toMatch(/\/resolve\/[0-9a-f]{40}\/config\.json$/);
    expect(await isCached('config.json')).toBe(true);
    expect(await (await readCached('config.json'))!.text()).toContain('style_text_to_speech_2');
    expect(progress.at(-1)).toBe(CONFIG.length);
    expect(await cachedBytes()).toBe(CONFIG.length);
    // Second call is a cache hit with no network.
    await ensureFile('config.json', new AbortController().signal, () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects and discards a tampered file', async () => {
    const tampered = new TextEncoder().encode('{\n  "model_type": "evil_payload_xxxxxxxxxxxx"\n}'.slice(0, CONFIG.length));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(tampered))));
    await expect(ensureFile('config.json', new AbortController().signal, () => undefined)).rejects.toMatchObject({ code: 'E_MODEL_INTEGRITY' });
    expect(await isCached('config.json')).toBe(false);
    expect(await getPartials('config.json')).toHaveLength(0);
  });

  it('resumes an interrupted download with an HTTP Range request', async () => {
    const calls: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const range = (init.headers as Record<string, string>)?.Range ?? null;
        calls.push(range);
        if (!range) return new Response(streamOf(CONFIG, 20), { status: 200 });
        const from = Number(/bytes=(\d+)-/.exec(range)![1]);
        return new Response(streamOf(CONFIG.slice(from)), { status: 206 });
      }),
    );
    await expect(ensureFile('config.json', new AbortController().signal, () => undefined)).rejects.toMatchObject({ code: 'E_MODEL_DOWNLOAD' });
    expect((await getPartials('config.json')).reduce((n, c) => n + c.blob.size, 0)).toBe(20);
    await ensureFile('config.json', new AbortController().signal, () => undefined);
    expect(calls).toEqual([null, 'bytes=20-']);
    expect(await isCached('config.json')).toBe(true);
  });

  it('detects cache corruption on validation and recovers by removing the file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(CONFIG))));
    await ensureFile('config.json', new AbortController().signal, () => undefined);
    const good = await cache.match(fileUrl('config.json'));
    await cache.put(fileUrl('config.json'), new Response('corrupt', { headers: good!.headers }));
    expect(await validateCached('config.json')).toBe(false);
    expect(await isCached('config.json')).toBe(false);
    await clearModelCache();
    expect(await cachedBytes()).toBe(0);
  });

  it('refuses files outside the pinned manifest', async () => {
    await expect(ensureFile('onnx/evil.onnx', new AbortController().signal, () => undefined)).rejects.toThrow(/not in the pinned model manifest/);
  });
});
