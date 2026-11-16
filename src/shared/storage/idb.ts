/** Minimal promise wrapper around IndexedDB for the partial-download store. */

const DB_NAME = 'kokoro-reader';
const DB_VERSION = 1;
export const PARTIALS = 'partials';

export interface PartialChunk {
  path: string;
  index: number;
  offset: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PARTIALS)) {
        const store = db.createObjectStore(PARTIALS, { keyPath: ['path', 'index'] });
        store.createIndex('path', 'path');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

export async function putPartial(chunk: PartialChunk): Promise<void> {
  const db = await openDb();
  await promisify(db.transaction(PARTIALS, 'readwrite').objectStore(PARTIALS).put(chunk));
}

export async function getPartials(path: string): Promise<PartialChunk[]> {
  const db = await openDb();
  const chunks = await promisify(db.transaction(PARTIALS).objectStore(PARTIALS).index('path').getAll(path) as IDBRequest<PartialChunk[]>);
  return chunks.sort((a, b) => a.index - b.index);
}

export async function deletePartials(path?: string): Promise<void> {
  const db = await openDb();
  const store = db.transaction(PARTIALS, 'readwrite').objectStore(PARTIALS);
  if (!path) {
    await promisify(store.clear());
    return;
  }
  const keys = await promisify(store.index('path').getAllKeys(path));
  await Promise.all(keys.map((key) => promisify(store.delete(key))));
}

export async function partialBytes(): Promise<number> {
  const db = await openDb();
  const all = await promisify(db.transaction(PARTIALS).objectStore(PARTIALS).getAll() as IDBRequest<PartialChunk[]>);
  return all.reduce((sum, chunk) => sum + chunk.blob.size, 0);
}
