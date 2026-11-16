import { normalizeSettings, type Settings } from '../settings';
import type { Bookmark, DiagnosticEvent, HistoryEntry, ModelState, PlaybackState, QueueItem } from '../types';

/** Keys in chrome.storage.local (persistent) and chrome.storage.session (cleared on browser restart). */
export const LOCAL_KEYS = {
  settings: 'settings',
  queue: 'queue',
  history: 'history',
  bookmarks: 'bookmarks',
  diagnostics: 'diagnostics',
  modelState: 'modelState',
  lastSession: 'lastSession',
} as const;

export const SESSION_KEYS = {
  playback: 'playback',
} as const;

const MAX_HISTORY = 200;
const MAX_DIAGNOSTICS = 100;

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function setLocal(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await getLocal<unknown>(LOCAL_KEYS.settings, {}));
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await setLocal(LOCAL_KEYS.settings, next);
  return next;
}

export async function resetSettings(): Promise<Settings> {
  const next = normalizeSettings({});
  await setLocal(LOCAL_KEYS.settings, next);
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[LOCAL_KEYS.settings]) listener(normalizeSettings(changes[LOCAL_KEYS.settings]!.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

// Queue ------------------------------------------------------------------

export const getQueue = () => getLocal<QueueItem[]>(LOCAL_KEYS.queue, []);
export const setQueue = (queue: QueueItem[]) => setLocal(LOCAL_KEYS.queue, queue);

export async function addToQueue(item: QueueItem, position: 'end' | 'next' = 'end'): Promise<QueueItem[]> {
  const queue = (await getQueue()).filter((existing) => existing.id !== item.id);
  if (position === 'next') queue.unshift(item);
  else queue.push(item);
  await setQueue(queue);
  return queue;
}

export async function removeFromQueue(id: string): Promise<QueueItem[]> {
  const queue = (await getQueue()).filter((item) => item.id !== id);
  await setQueue(queue);
  return queue;
}

export async function moveInQueue(id: string, delta: number): Promise<QueueItem[]> {
  const queue = await getQueue();
  const from = queue.findIndex((item) => item.id === id);
  const to = Math.min(queue.length - 1, Math.max(0, from + delta));
  if (from < 0 || from === to) return queue;
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item!);
  await setQueue(queue);
  return queue;
}

/** Removes and returns the first queue item. */
export async function shiftQueue(): Promise<QueueItem | undefined> {
  const queue = await getQueue();
  const next = queue.shift();
  await setQueue(queue);
  return next;
}

// History ----------------------------------------------------------------

export const getHistory = () => getLocal<HistoryEntry[]>(LOCAL_KEYS.history, []);

export async function upsertHistory(entry: HistoryEntry): Promise<void> {
  const history = (await getHistory()).filter((existing) => existing.id !== entry.id);
  history.unshift(entry);
  await setLocal(LOCAL_KEYS.history, history.slice(0, MAX_HISTORY));
}

export async function deleteHistory(id?: string): Promise<void> {
  await setLocal(LOCAL_KEYS.history, id ? (await getHistory()).filter((entry) => entry.id !== id) : []);
}

// Bookmarks --------------------------------------------------------------

export const getBookmarks = () => getLocal<Bookmark[]>(LOCAL_KEYS.bookmarks, []);

export async function saveBookmark(bookmark: Bookmark): Promise<Bookmark[]> {
  const bookmarks = [bookmark, ...(await getBookmarks()).filter((existing) => existing.id !== bookmark.id)];
  await setLocal(LOCAL_KEYS.bookmarks, bookmarks);
  return bookmarks;
}

export async function renameBookmark(id: string, name: string): Promise<Bookmark[]> {
  const bookmarks = (await getBookmarks()).map((bookmark) => (bookmark.id === id ? { ...bookmark, name } : bookmark));
  await setLocal(LOCAL_KEYS.bookmarks, bookmarks);
  return bookmarks;
}

export async function deleteBookmark(id: string): Promise<Bookmark[]> {
  const bookmarks = (await getBookmarks()).filter((bookmark) => bookmark.id !== id);
  await setLocal(LOCAL_KEYS.bookmarks, bookmarks);
  return bookmarks;
}

// Diagnostics ------------------------------------------------------------

export const getDiagnostics = () => getLocal<DiagnosticEvent[]>(LOCAL_KEYS.diagnostics, []);

export async function recordDiagnostic(event: DiagnosticEvent): Promise<void> {
  const settings = await getSettings();
  if (!settings.diagnosticsEnabled) return;
  const events = [event, ...(await getDiagnostics())].slice(0, MAX_DIAGNOSTICS);
  await setLocal(LOCAL_KEYS.diagnostics, events);
}

export const clearDiagnostics = () => setLocal(LOCAL_KEYS.diagnostics, []);

// Model and playback state ---------------------------------------------

export const getStoredModelState = () => getLocal<ModelState | null>(LOCAL_KEYS.modelState, null);
export const setStoredModelState = (state: ModelState) => setLocal(LOCAL_KEYS.modelState, state);

export async function getPlaybackState(): Promise<PlaybackState | null> {
  const result = await chrome.storage.session.get(SESSION_KEYS.playback);
  return (result[SESSION_KEYS.playback] as PlaybackState | undefined) ?? null;
}

export const setPlaybackState = (state: PlaybackState) => chrome.storage.session.set({ [SESSION_KEYS.playback]: state });
