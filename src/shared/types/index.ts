/** Core domain types shared by every extension context. */

export type EngineId = 'kokoro' | 'browser';
export type BackendId = 'webgpu' | 'wasm';
export type BackendPreference = 'auto' | BackendId;
export type ThemePreference = 'system' | 'light' | 'dark';

/** A block of text in a reading document: a paragraph, heading, list item, quote or caption. */
export interface DocBlock {
  id: number;
  kind: 'heading' | 'paragraph' | 'list-item' | 'quote' | 'caption' | 'code';
  /** Heading level 1–6 when kind is `heading`. */
  level?: number;
  text: string;
}

/** A sentence, addressed by character offsets into its block's text. */
export interface Sentence {
  id: number;
  blockId: number;
  start: number;
  end: number;
  text: string;
}

export type DocSource = 'selection' | 'page' | 'article' | 'custom' | 'queue';

/** Everything a reading session needs, independent of the page it came from. */
export interface ReadingDoc {
  id: string;
  title: string;
  url?: string;
  siteName?: string;
  byline?: string;
  source: DocSource;
  /** BCP 47 tag from the page or the user, if known. */
  language?: string;
  blocks: DocBlock[];
  sentences: Sentence[];
}

export type PlaybackStatus = 'idle' | 'preparing' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackState {
  sessionId: string | null;
  docId: string | null;
  title: string;
  url?: string;
  source?: DocSource;
  tabId: number | null;
  status: PlaybackStatus;
  sentenceIndex: number;
  sentenceCount: number;
  /** Text of the sentence being spoken, for players outside the page. */
  sentenceText: string;
  blockId: number | null;
  engine: EngineId;
  voice: string;
  rate: number;
  volume: number;
  /** Seconds of audio generated for the session so far. */
  generatedSeconds: number;
  /** Rough seconds remaining, from sentence lengths and measured speaking rate. */
  estimatedRemainingSeconds: number;
  error: AppErrorInfo | null;
  updatedAt: number;
}

export type ModelStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'downloaded'
  | 'initializing'
  | 'ready'
  | 'error';

export interface DownloadProgress {
  loaded: number;
  total: number;
  file?: string;
}

export interface ModelState {
  variantId: string;
  status: ModelStatus;
  progress: DownloadProgress | null;
  /** Backend that actually ran the readiness test, not merely one that exists. */
  activeBackend: BackendId | null;
  crossOriginIsolated: boolean | null;
  threads: number | null;
  cachedBytes: number;
  lastUsed: number | null;
  initMs: number | null;
  error: AppErrorInfo | null;
}

export interface VoiceInfo {
  id: string;
  name: string;
  /** BCP 47 tag, e.g. en-US. */
  language: string;
  languageLabel: string;
  gender: 'Female' | 'Male';
  /** Grades published by the Kokoro authors in VOICES.md. */
  targetQuality: string;
  overallGrade: string;
  traits?: string;
  engine: EngineId;
}

export type ErrorCode =
  | 'E_MODEL_DOWNLOAD'
  | 'E_MODEL_INTEGRITY'
  | 'E_MODEL_INIT'
  | 'E_WEBGPU_UNAVAILABLE'
  | 'E_WASM_FAILED'
  | 'E_OUT_OF_MEMORY'
  | 'E_STORAGE_QUOTA'
  | 'E_OFFLINE'
  | 'E_SYNTHESIS'
  | 'E_PLAYBACK'
  | 'E_WORKER_CRASHED'
  | 'E_EMPTY_TEXT'
  | 'E_UNSUPPORTED_PAGE'
  | 'E_UNSUPPORTED_LANGUAGE'
  | 'E_EXTRACTION'
  | 'E_PERMISSION'
  | 'E_TAB_CLOSED'
  | 'E_CANCELLED'
  | 'E_BAD_MESSAGE'
  | 'E_BROWSER_SPEECH'
  | 'E_EXPORT'
  | 'E_UNKNOWN';

export type RecoveryAction =
  | 'retry'
  | 'retry-download'
  | 'clear-cache'
  | 'use-wasm'
  | 'select-text'
  | 'open-reader'
  | 'grant-permission'
  | 'open-settings'
  | 'none';

export interface AppErrorInfo {
  code: ErrorCode;
  message: string;
  recovery: RecoveryAction;
  detail?: string;
}

export interface QueueItem {
  id: string;
  title: string;
  url?: string;
  siteName?: string;
  addedAt: number;
  doc: ReadingDoc;
  /** Sentence to start from when the item plays. */
  position: number;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url?: string;
  siteName?: string;
  source: DocSource;
  startedAt: number;
  lastPlayedAt: number;
  listenedSeconds: number;
  sentenceIndex: number;
  sentenceCount: number;
  completed: boolean;
}

export interface Bookmark {
  id: string;
  name: string;
  title: string;
  url?: string;
  source: DocSource;
  sentenceIndex: number;
  sentenceCount: number;
  snippet: string;
  createdAt: number;
  /** Stored only for pasted text and queue items, which cannot be re-extracted. */
  doc?: ReadingDoc;
}

export interface VoiceProfile {
  id: string;
  name: string;
  voice: string;
  rate: number;
}

export interface DiagnosticEvent {
  at: number;
  kind: 'model-init' | 'first-audio' | 'synthesis' | 'error' | 'download';
  /** Numbers only. Diagnostics never record page text or URLs. */
  data: Record<string, number | string | boolean | null>;
}
