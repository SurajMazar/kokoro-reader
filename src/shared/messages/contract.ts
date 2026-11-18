/**
 * The typed message contract between extension contexts.
 *
 * Every message is an envelope `{ kr: 1, type, target, requestId, payload }`.
 * `target` says which context handles it, because chrome.runtime.sendMessage
 * reaches every extension page at once. Replies are `{ ok, data | error }`.
 */
import type { AppErrorInfo, BackendPreference, Bookmark, DiagnosticEvent, EngineId, ModelState, PlaybackState, ReadingDoc, VoiceInfo } from '../types';

export type Target = 'background' | 'offscreen' | 'content' | 'broadcast';

export type ControlAction =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'stop'
  | 'next'
  | 'previous'
  | 'next-block'
  | 'previous-block'
  | 'seek'
  | 'restart';

export type ReadMode = 'selection' | 'page' | 'from-selection' | 'article';

export type ModelAction = 'download' | 'pause' | 'cancel' | 'clear' | 'validate' | 'initialize' | 'unload';
export type PackAction = 'download' | 'delete';

export interface EngineConfig {
  engine: EngineId;
  voice: string;
  /** Voice for Devanagari (Nepali) sentences; the main voice reads the rest. */
  nepaliVoice: string;
  browserVoice: string | null;
  rate: number;
  volume: number;
  variantId: string;
  backend: BackendPreference;
  prefetchSentences: number;
}

export interface ExportResult {
  /** Blob URL owned by the offscreen document; valid until the next export. */
  url: string;
  filename: string;
  durationSeconds: number;
  bytes: number;
}

/** Raw page HTML handed to Readability in an extension page (content scripts stay small). */
export interface PageSnapshot {
  html: string;
  url: string;
  title: string;
  language: string;
}

export interface EngineMetrics {
  /** Total memory of the offscreen document and its workers (measureUserAgentSpecificMemory), or null. */
  memoryBytes: number | null;
  jsHeapBytes: number | null;
  modelLoaded: boolean;
}

export interface PageInfo {
  title: string;
  url: string;
  siteName: string;
  hasSelection: boolean;
  selectionWords: number;
  language: string;
}

/** Requests: type → [payload, response]. */
export interface RequestMap {
  // Handled by the background service worker.
  'session/start': [{ doc: ReadingDoc; tabId?: number; startSentence?: number; enqueue?: boolean }, { sessionId: string; queued: boolean }];
  'session/control': [{ action: ControlAction; index?: number }, null];
  'session/set': [{ rate?: number; volume?: number; voice?: string }, null];
  'session/state': [Record<string, never>, PlaybackState];
  'session/play-queue': [{ itemId?: string }, { sessionId: string } | null];
  'tab/read': [{ tabId: number; mode: ReadMode; startSentence?: number }, { sessionId: string } | null];
  'tab/info': [{ tabId: number }, PageInfo | null];
  'tab/extract': [{ tabId: number; mode: 'article' | 'page' }, ReadingDoc];
  'reader/open': [{ tabId?: number; mode?: 'article' | 'custom' }, null];
  'model/get': [Record<string, never>, ModelState];
  'model/action': [{ action: ModelAction; variantId?: string }, ModelState];
  /** Downloads or deletes an optional voice pack (Nepali voices). */
  'model/pack': [{ action: PackAction; packId: string }, ModelState];
  'voices/list': [Record<string, never>, VoiceInfo[]];
  'voices/preview': [{ voice: string; engine?: EngineId; text?: string }, null];
  'export/wav': [{ doc: ReadingDoc; voice?: string; speed?: number }, ExportResult];
  'permissions/sync': [Record<string, never>, { allSites: boolean }];
  'ui/open-options': [{ section?: string }, null];
  'session/doc': [Record<string, never>, ReadingDoc | null];
  'bookmark/add': [{ name?: string }, Bookmark];
  'history/resume': [{ id: string }, null];
  'diagnostics/metrics': [Record<string, never>, EngineMetrics | null];

  // Handled by the offscreen document.
  'offscreen/load': [{ sessionId: string; doc: ReadingDoc; startSentence: number; config: EngineConfig }, null];
  'offscreen/control': [{ sessionId?: string; action: ControlAction; index?: number }, null];
  'offscreen/set': [{ rate?: number; volume?: number; voice?: string; config?: EngineConfig }, null];
  'offscreen/model': [{ action: ModelAction; variantId: string; backend: BackendPreference }, ModelState];
  'offscreen/model-state': [{ variantId: string }, ModelState];
  'offscreen/pack': [{ action: PackAction; packId: string; variantId: string }, ModelState];
  'offscreen/preview': [{ voice: string; engine: EngineId; text: string; config: EngineConfig }, null];
  'offscreen/export': [{ doc: ReadingDoc; voice: string; speed: number; config: EngineConfig }, ExportResult];
  'offscreen/browser-voices': [Record<string, never>, VoiceInfo[]];
  'offscreen/parse-article': [{ snapshot: PageSnapshot }, ReadingDoc];
  'offscreen/metrics': [Record<string, never>, EngineMetrics];
  'offscreen/ping': [Record<string, never>, { alive: true; sessionId: string | null }];

  // Handled by the content script in a tab.
  'content/read': [{ mode: ReadMode; startSentence?: number }, { doc: ReadingDoc; startSentence: number }];
  'content/snapshot': [Record<string, never>, PageSnapshot];
  'content/info': [Record<string, never>, PageInfo];
  'content/ping': [Record<string, never>, { alive: true }];
}

/** One-way events: type → payload. */
export interface EventMap {
  'playback/state': PlaybackState;
  'model/state': ModelState;
  'session/ended': { sessionId: string; completed: boolean };
  'offscreen/idle': { idleMs: number };
  'offscreen/diagnostic': { kind: DiagnosticEvent['kind']; data: DiagnosticEvent['data'] };
  'content/session': { state: PlaybackState; ownsSession: boolean };
  'content/highlight': { sessionId: string; sentenceId: number | null; blockId: number | null };
  'content/clear': { sessionId: string | null };
  'content/model': ModelState;
}

export type RequestType = keyof RequestMap;
export type EventType = keyof EventMap;
export type RequestPayload<T extends RequestType> = RequestMap[T][0];
export type RequestResponse<T extends RequestType> = RequestMap[T][1];

export interface Envelope<T extends string = string, P = unknown> {
  kr: 1;
  type: T;
  target: Target;
  requestId: string;
  payload: P;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo };

export function targetOf(type: RequestType | EventType): Target {
  if (type === 'offscreen/idle' || type === 'offscreen/diagnostic') return 'background';
  if (type.startsWith('offscreen/')) return 'offscreen';
  if (type.startsWith('content/')) return 'content';
  if (type === 'playback/state' || type === 'model/state' || type === 'session/ended') return 'broadcast';
  return 'background';
}
