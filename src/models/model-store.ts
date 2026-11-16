/**
 * Verified model storage.
 *
 * Every model and voice file is downloaded from a commit-pinned URL, checked
 * against the SHA-256 in model-manifest.json, and only then written to Cache
 * Storage. The inference worker reads exclusively from this cache, so an
 * unverified byte never reaches ONNX Runtime.
 *
 * Downloads are written to IndexedDB in chunks as they arrive. Pausing (or a
 * closed document, or a dropped connection) keeps those chunks, and the next
 * attempt resumes with an HTTP Range request.
 */
import { AppError } from '@/shared/errors';
import { deletePartials, getPartials, putPartial } from '@/shared/storage/idb';
import { fileUrl, pinnedFile, type PinnedFile } from './registry';

export const MODEL_CACHE = 'kokoro-reader-models-v1';
const CHUNK_BYTES = 8 * 1024 * 1024;
const SHA_HEADER = 'x-kokoro-sha256';

export interface FileProgress {
  file: string;
  loaded: number;
  total: number;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function openCache(): Promise<Cache> {
  return caches.open(MODEL_CACHE);
}

/** True when the file is cached with the pinned hash recorded at verification time. */
export async function isCached(path: string): Promise<boolean> {
  const pinned = pinnedFile(path);
  const response = await (await openCache()).match(fileUrl(path));
  return Boolean(response && response.headers.get(SHA_HEADER) === pinned.sha256);
}

export async function readCached(path: string): Promise<Response | undefined> {
  return (await openCache()).match(fileUrl(path));
}

/** Total bytes of verified files in the model cache. */
export async function cachedBytes(): Promise<number> {
  const cache = await openCache();
  let total = 0;
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    total += Number(response?.headers.get('content-length') ?? 0);
  }
  return total;
}

export async function clearModelCache(): Promise<void> {
  await caches.delete(MODEL_CACHE);
  await deletePartials();
}

/** Re-hashes a cached file; removes it when it no longer matches. */
export async function validateCached(path: string): Promise<boolean> {
  const response = await readCached(path);
  if (!response) return false;
  const ok = (await sha256Hex(await response.arrayBuffer())) === pinnedFile(path).sha256;
  if (!ok) await (await openCache()).delete(fileUrl(path));
  return ok;
}

async function fetchWithResume(file: PinnedFile, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<Blob> {
  let chunks = await getPartials(file.path);
  let offset = chunks.reduce((sum, chunk) => sum + chunk.blob.size, 0);
  if (offset > file.size) {
    await deletePartials(file.path);
    chunks = [];
    offset = 0;
  }
  onProgress(offset);

  if (offset < file.size) {
    const headers: HeadersInit = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    let response: Response;
    try {
      response = await fetch(fileUrl(file.path), { signal, headers, cache: 'no-store', credentials: 'omit' });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AppError(navigator.onLine ? 'E_MODEL_DOWNLOAD' : 'E_OFFLINE', String(error));
    }
    if (offset > 0 && response.status === 200) {
      // The server ignored the range: start this file over.
      await deletePartials(file.path);
      chunks = [];
      offset = 0;
    } else if (!response.ok) {
      throw new AppError('E_MODEL_DOWNLOAD', `HTTP ${response.status} for ${file.path}`);
    }
    if (!response.body) throw new AppError('E_MODEL_DOWNLOAD', 'Empty response body');

    const reader = response.body.getReader();
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let index = chunks.length ? chunks.at(-1)!.index + 1 : 0;
    const flush = async () => {
      if (!pendingBytes) return;
      const blob = new Blob(pending as BlobPart[]);
      await putPartial({ path: file.path, index, offset, blob });
      chunks.push({ path: file.path, index, offset, blob });
      index += 1;
      offset += pendingBytes;
      pending = [];
      pendingBytes = 0;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending.push(value);
        pendingBytes += value.byteLength;
        onProgress(offset + pendingBytes);
        if (pendingBytes >= CHUNK_BYTES) await flush();
      }
      await flush();
    } catch (error) {
      // Keep what has arrived so the next attempt can resume.
      await flush().catch(() => undefined);
      if (signal.aborted) throw error;
      throw new AppError('E_MODEL_DOWNLOAD', String(error));
    }
  }
  return new Blob(chunks.map((chunk) => chunk.blob));
}

/**
 * Downloads, verifies and caches one pinned file. Resolves immediately when it
 * is already cached. Throws E_MODEL_INTEGRITY (after discarding the bytes)
 * when the hash does not match.
 */
export async function ensureFile(path: string, signal: AbortSignal, onProgress: (progress: FileProgress) => void): Promise<void> {
  const file = pinnedFile(path);
  if (await isCached(path)) {
    onProgress({ file: path, loaded: file.size, total: file.size });
    return;
  }
  const blob = await fetchWithResume(file, signal, (loaded) => onProgress({ file: path, loaded, total: file.size }));
  const buffer = await blob.arrayBuffer();
  const hash = await sha256Hex(buffer);
  if (buffer.byteLength !== file.size || hash !== file.sha256) {
    await deletePartials(path);
    throw new AppError('E_MODEL_INTEGRITY', `${path}: expected ${file.sha256} (${file.size} bytes), got ${hash} (${buffer.byteLength} bytes)`);
  }
  const response = new Response(buffer, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(buffer.byteLength),
      [SHA_HEADER]: hash,
      'x-kokoro-verified-at': new Date().toISOString(),
    },
  });
  try {
    await (await openCache()).put(fileUrl(path), response);
  } catch (error) {
    throw new AppError('E_STORAGE_QUOTA', String(error));
  }
  await deletePartials(path);
}
