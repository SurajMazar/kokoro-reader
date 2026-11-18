import { PACK_PREFIX, pinnedFile, type PinnedFile } from '@/models/registry';
import type { VoiceInfo } from '@/shared/types';

/**
 * Nepali voices, from Piper voice models (VITS, ONNX) published in
 * rhasspy/piper-voices. One model is one voice pack; a multi-speaker model
 * offers one voice per speaker id.
 *
 * - chitwan/medium: one male speaker, trained on the Chitwan dataset (CC0).
 * - google/medium: 18 female speakers, trained on OpenSLR 43 (CC-BY-SA-4.0),
 *   Google's crowd-sourced Nepali TTS corpus.
 *
 * Genders were measured from synthesized speech (median pitch 140 Hz for
 * Chitwan, 210-270 Hz for every Google speaker).
 */
export interface VoicePack {
  id: string;
  label: string;
  /** Folder in rhasspy/piper-voices. */
  dir: string;
  model: string;
  license: string;
  licenseUrl: string;
  dataset: string;
}

export const VOICE_PACKS: readonly VoicePack[] = [
  {
    id: 'ne-chitwan',
    label: 'Nepali · Chitwan',
    dir: 'ne/ne_NP/chitwan/medium',
    model: 'ne_NP-chitwan-medium.onnx',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    dataset: 'Chitwan 1.0 (Open Home Foundation voice datasets)',
  },
  {
    id: 'ne-google',
    label: 'Nepali · OpenSLR',
    dir: 'ne/ne_NP/google/medium',
    model: 'ne_NP-google-medium.onnx',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    dataset: 'OpenSLR 43, Google crowd-sourced Nepali TTS data',
  },
];

/** Speaker ids of ne-google, in the order of the model's speaker_id_map. */
const GOOGLE_SPEAKERS = 18;

export interface PiperVoice extends VoiceInfo {
  packId: string;
  /** Speaker id for multi-speaker models. */
  speaker: number | null;
}

function voice(id: string, name: string, gender: 'Female' | 'Male', packId: string, speaker: number | null): PiperVoice {
  return {
    id,
    name,
    gender,
    language: 'ne-NP',
    languageLabel: 'Nepali',
    targetQuality: '',
    overallGrade: '',
    engine: 'kokoro',
    packId,
    speaker,
  };
}

export const NEPALI_VOICES: readonly PiperVoice[] = Object.freeze([
  voice('ne_chitwan', 'Chitwan', 'Male', 'ne-chitwan', null),
  ...Array.from({ length: GOOGLE_SPEAKERS }, (_, speaker) =>
    voice(`ne_google_${String(speaker + 1).padStart(2, '0')}`, `Speaker ${speaker + 1}`, 'Female', 'ne-google', speaker),
  ),
]);

export const DEFAULT_NEPALI_VOICE = 'ne_chitwan';

export function isNepaliVoice(id: string | null | undefined): boolean {
  return Boolean(id && NEPALI_VOICES.some((voice) => voice.id === id));
}

export function getNepaliVoice(id: string): PiperVoice | undefined {
  return NEPALI_VOICES.find((voice) => voice.id === id);
}

export function getPack(id: string): VoicePack {
  const pack = VOICE_PACKS.find((item) => item.id === id);
  if (!pack) throw new Error(`Unknown voice pack: ${id}`);
  return pack;
}

export function packModelPath(pack: VoicePack): string {
  return `${PACK_PREFIX}${pack.dir}/${pack.model}`;
}

export function packConfigPath(pack: VoicePack): string {
  return `${packModelPath(pack)}.json`;
}

/** The files a pack needs: model and config. */
export function packFiles(pack: VoicePack): PinnedFile[] {
  return [packConfigPath(pack), packModelPath(pack)].map(pinnedFile);
}

export function packBytes(pack: VoicePack): number {
  return packFiles(pack).reduce((sum, file) => sum + file.size, 0);
}
