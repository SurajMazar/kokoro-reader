import type { VoiceInfo } from '@/shared/types';

/**
 * The English voices shipped with Kokoro-82M v1.0, with the names, genders
 * and quality grades published by the model authors (hexgrad/Kokoro-82M
 * VOICES.md, mirrored in kokoro-js 1.2.1). Kokoro also has Spanish, French,
 * Hindi, Italian, Portuguese, Japanese and Mandarin voices, but the
 * phonemizer path this extension uses (espeak-ng via kokoro-js) is validated
 * for English only, so only English voices are offered.
 */
type Raw = [id: string, name: string, gender: 'Female' | 'Male', targetQuality: string, overallGrade: string, traits?: string];

const AMERICAN: Raw[] = [
  ['af_heart', 'Heart', 'Female', 'A', 'A', '❤️'],
  ['af_bella', 'Bella', 'Female', 'A', 'A-', '🔥'],
  ['af_nicole', 'Nicole', 'Female', 'B', 'B-', '🎧'],
  ['af_aoede', 'Aoede', 'Female', 'B', 'C+'],
  ['af_kore', 'Kore', 'Female', 'B', 'C+'],
  ['af_sarah', 'Sarah', 'Female', 'B', 'C+'],
  ['af_alloy', 'Alloy', 'Female', 'B', 'C'],
  ['af_nova', 'Nova', 'Female', 'B', 'C'],
  ['af_sky', 'Sky', 'Female', 'B', 'C-'],
  ['af_jessica', 'Jessica', 'Female', 'C', 'D'],
  ['af_river', 'River', 'Female', 'C', 'D'],
  ['am_fenrir', 'Fenrir', 'Male', 'B', 'C+'],
  ['am_michael', 'Michael', 'Male', 'B', 'C+'],
  ['am_puck', 'Puck', 'Male', 'B', 'C+'],
  ['am_echo', 'Echo', 'Male', 'C', 'D'],
  ['am_eric', 'Eric', 'Male', 'C', 'D'],
  ['am_liam', 'Liam', 'Male', 'C', 'D'],
  ['am_onyx', 'Onyx', 'Male', 'C', 'D'],
  ['am_santa', 'Santa', 'Male', 'C', 'D-'],
  ['am_adam', 'Adam', 'Male', 'D', 'F+'],
];

const BRITISH: Raw[] = [
  ['bf_emma', 'Emma', 'Female', 'B', 'B-', '🚺'],
  ['bf_isabella', 'Isabella', 'Female', 'B', 'C'],
  ['bf_alice', 'Alice', 'Female', 'C', 'D', '🚺'],
  ['bf_lily', 'Lily', 'Female', 'C', 'D', '🚺'],
  ['bm_george', 'George', 'Male', 'B', 'C'],
  ['bm_fable', 'Fable', 'Male', 'B', 'C', '🚹'],
  ['bm_lewis', 'Lewis', 'Male', 'C', 'D+'],
  ['bm_daniel', 'Daniel', 'Male', 'C', 'D', '🚹'],
];

function toVoice(language: string, languageLabel: string) {
  return ([id, name, gender, targetQuality, overallGrade, traits]: Raw): VoiceInfo => ({
    id,
    name,
    gender,
    language,
    languageLabel,
    targetQuality,
    overallGrade,
    ...(traits ? { traits } : {}),
    engine: 'kokoro',
  });
}

export const KOKORO_VOICES: readonly VoiceInfo[] = Object.freeze([
  ...AMERICAN.map(toVoice('en-US', 'English (US)')),
  ...BRITISH.map(toVoice('en-GB', 'English (UK)')),
]);

export const DEFAULT_VOICE = 'af_heart';

export function isKokoroVoice(id: string): boolean {
  return KOKORO_VOICES.some((voice) => voice.id === id);
}

export function getKokoroVoice(id: string): VoiceInfo | undefined {
  return KOKORO_VOICES.find((voice) => voice.id === id);
}

/** espeak-ng language for a voice id: `a…` voices are American, `b…` British. */
export function phonemizerLanguage(voiceId: string): 'en-us' | 'en' {
  return voiceId.startsWith('b') ? 'en' : 'en-us';
}

export function voiceFilePath(voiceId: string): string {
  return `voices/${voiceId}.bin`;
}
