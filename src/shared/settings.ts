import type { BackendPreference, EngineId, ThemePreference, VoiceProfile } from './types';

export type SelectionStyle = 'icon' | 'toolbar';
export type PlayerCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type PlayerMode = 'compact' | 'expanded' | 'minimized';
export type SessionPolicy = 'replace' | 'queue';

export interface Settings {
  // General
  theme: ThemePreference;
  newSessionPolicy: SessionPolicy;
  // Selection behaviour
  floatingButton: boolean;
  selectionStyle: SelectionStyle;
  selectionDelayMs: number;
  minSelectionWords: number;
  autoPlayOnClick: boolean;
  // Reading
  highlightSentence: boolean;
  highlightParagraph: boolean;
  autoScroll: boolean;
  playerCorner: PlayerCorner;
  playerMode: PlayerMode;
  // Audio
  engine: EngineId;
  voice: string;
  browserVoice: string | null;
  rate: number;
  volume: number;
  favoriteVoices: string[];
  recentVoices: string[];
  profiles: VoiceProfile[];
  /** Voice for sentences written in Devanagari (Nepali); the main voice reads everything else. */
  nepaliVoice: string;
  // AI engine
  variantId: string;
  backend: BackendPreference;
  prefetchSentences: number;
  idleUnloadMinutes: number;
  downloadModelOnInstall: boolean;
  // Privacy
  historyEnabled: boolean;
  diagnosticsEnabled: boolean;
  // Accessibility
  reduceMotion: 'system' | 'always';
  highContrastHighlight: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  newSessionPolicy: 'replace',
  floatingButton: true,
  selectionStyle: 'icon',
  selectionDelayMs: 150,
  minSelectionWords: 1,
  autoPlayOnClick: true,
  highlightSentence: true,
  highlightParagraph: true,
  autoScroll: true,
  playerCorner: 'bottom-right',
  playerMode: 'compact',
  engine: 'kokoro',
  voice: 'af_heart',
  browserVoice: null,
  rate: 1,
  volume: 1,
  favoriteVoices: ['af_heart'],
  recentVoices: [],
  profiles: [
    { id: 'docs', name: 'Technical docs', voice: 'am_michael', rate: 1 },
    { id: 'news', name: 'News', voice: 'bf_emma', rate: 1.15 },
    { id: 'novels', name: 'Novels', voice: 'af_heart', rate: 0.95 },
    { id: 'casual', name: 'Casual reading', voice: 'af_bella', rate: 1.25 },
  ],
  nepaliVoice: 'ne_chitwan',
  variantId: 'q8',
  backend: 'auto',
  prefetchSentences: 3,
  idleUnloadMinutes: 10,
  downloadModelOnInstall: false,
  historyEnabled: true,
  diagnosticsEnabled: true,
  reduceMotion: 'system',
  highContrastHighlight: false,
};

export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 100) / 100;
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/** Merges stored settings over the defaults, dropping unknown keys and wrongly typed values. */
export function normalizeSettings(stored: unknown): Settings {
  const result: Settings = { ...DEFAULT_SETTINGS };
  if (typeof stored !== 'object' || stored === null) return result;
  const record = stored as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = record[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (value === undefined) continue;
    if (Array.isArray(fallback) ? Array.isArray(value) : fallback === null ? true : typeof value === typeof fallback) {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  result.rate = clampRate(result.rate);
  result.volume = clampVolume(result.volume);
  if (!result.nepaliVoice.startsWith('ne_')) result.nepaliVoice = DEFAULT_SETTINGS.nepaliVoice;
  result.prefetchSentences = Math.min(8, Math.max(1, Math.round(result.prefetchSentences)));
  result.minSelectionWords = Math.max(1, Math.round(result.minSelectionWords));
  result.selectionDelayMs = Math.min(2000, Math.max(0, Math.round(result.selectionDelayMs)));
  return result;
}
