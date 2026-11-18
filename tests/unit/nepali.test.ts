import { describe, expect, it } from 'vitest';
import { resample } from '@/audio/wav';
import { espeakClauses } from '@/engine/piper/espeak';
import { normalizeNepali } from '@/engine/piper/normalize';
import { clausesToSentences, mergeVowelClusters, phonemesToIds, type PiperVoiceConfig } from '@/engine/piper/phonemes';
import { DEFAULT_NEPALI_VOICE, getNepaliVoice, isNepaliVoice, NEPALI_VOICES, packFiles, VOICE_PACKS } from '@/engine/piper/voices';
import { fileUrl, PACK_REVISION } from '@/models/registry';
import { devanagariShare, isNepaliText } from '@/shared/text/language';
import { sentenceSpans } from '@/shared/text/segment';
import chitwan from '../fixtures/ne_NP-chitwan-medium.onnx.json';

const config = chitwan as unknown as PiperVoiceConfig;

describe('Nepali text detection', () => {
  it('routes Devanagari sentences to the Nepali voice and leaves English alone', () => {
    expect(isNepaliText('नेपाल हिमालयको काखमा रहेको एउटा सुन्दर देश हो।')).toBe(true);
    expect(isNepaliText('Kathmandu is the capital of Nepal.')).toBe(false);
    // Mostly Nepali with an English word is still Nepali.
    expect(isNepaliText('मेरो email address यही हो।')).toBe(true);
    expect(isNepaliText('The word नमस्ते means hello.')).toBe(false);
    expect(devanagariShare('२०८१')).toBe(1);
    expect(devanagariShare('...')).toBe(0);
  });

  it('splits sentences at the danda', () => {
    const text = 'नमस्ते! म कोकोरो रिडर हुँ। आज मौसम सफा छ।';
    expect(sentenceSpans(text).map(({ start, end }) => text.slice(start, end))).toEqual(['नमस्ते!', 'म कोकोरो रिडर हुँ।', 'आज मौसम सफा छ।']);
  });
});

describe('normalizeNepali', () => {
  it('converts ASCII digits so numbers are read in Nepali', () => {
    expect(normalizeNepali('तापक्रम 22 डिग्री')).toBe('तापक्रम २२ डिग्री');
    expect(normalizeNepali('रु 2,500 मात्र')).toBe('रु २५०० मात्र');
    expect(normalizeNepali('  “नमस्ते”  ')).toBe('"नमस्ते"');
  });
});

describe('espeak-ng (WebAssembly, Nepali)', () => {
  it('matches native espeak-ng at the commit Piper pins', async () => {
    // Reference: espeak-ng 724808c built natively, `espeak-ng -v ne -q --ipa`.
    const clauses = await espeakClauses('तापक्रम करिब २२ डिग्री छ, र 22 डिग्री पनि।', 'ne');
    expect(clauses).toEqual([
      { phonemes: 'taːpˈʌkɾəmˌə kˈʌɾɪb bˈaːɪs ɖˈɪɡɾi cʰˈə', terminator: ',', endOfSentence: false },
      { phonemes: 'ɾə (en) twˈɛnti tˈuː(ne) ɖˈɪɡɾi pˈʌnɪ', terminator: '', endOfSentence: true },
    ]);
    const greeting = await espeakClauses('नमस्ते! म कोकोरो रिडर हुँ।', 'ne');
    expect(greeting.map((clause) => [clause.phonemes, clause.terminator])).toEqual([
      ['nəmˈʌsteː', '!'],
      ['mə koːkˈoːɾoː ɾˈɪɖəɾˌə hˈu\u0303', ''],
    ]);
  });
});

describe('Piper phoneme ids', () => {
  it('produces exactly the ids piper-tts 1.8.0 produces', async () => {
    const clauses = await espeakClauses('तापक्रम करिब २२ डिग्री छ, र 22 डिग्री पनि।', 'ne');
    const [sentence] = clausesToSentences(clauses, config.vowel_clusters);
    // From piper.phonemize_espeak + piper.phoneme_ids for the same clauses.
    expect(phonemesToIds(sentence!, config.phoneme_id_map)).toEqual([1, 0, 32, 0, 14, 0, 122, 0, 28, 0, 120, 0, 102, 0, 23, 0, 92, 0, 59, 0, 25, 0, 121, 0, 59, 0, 3, 0, 23, 0, 120, 0, 102, 0, 92, 0, 74, 0, 15, 0, 3, 0, 15, 0, 120, 0, 14, 0, 122, 0, 74, 0, 31, 0, 3, 0, 56, 0, 120, 0, 74, 0, 66, 0, 92, 0, 21, 0, 3, 0, 16, 0, 145, 0, 120, 0, 59, 0, 8, 0, 3, 0, 92, 0, 59, 0, 3, 0, 3, 0, 32, 0, 35, 0, 120, 0, 61, 0, 26, 0, 32, 0, 21, 0, 3, 0, 32, 0, 120, 0, 33, 0, 122, 0, 3, 0, 56, 0, 120, 0, 74, 0, 66, 0, 92, 0, 21, 0, 3, 0, 28, 0, 120, 0, 102, 0, 26, 0, 74, 0, 2]);
  });

  it('merges trained vowel clusters and splits combining marks', () => {
    expect(mergeVowelClusters(['b', 'a', 'ɪ', 's'], [['a', 'ɪ']])).toEqual(['b', 'aɪ', 's']);
    const [sentence] = clausesToSentences([{ phonemes: 'hˈ\u0169', terminator: '', endOfSentence: true }]);
    expect(sentence).toEqual(['h', 'ˈ', 'u', '̃']);
  });

  it('starts a new sentence at each sentence terminator', () => {
    const sentences = clausesToSentences([
      { phonemes: 'a', terminator: '!', endOfSentence: true },
      { phonemes: 'b', terminator: ',', endOfSentence: false },
      { phonemes: 'c', terminator: '', endOfSentence: true },
    ]);
    expect(sentences).toEqual([['a', '!'], ['b', ',', ' ', 'c']]);
  });
});

describe('Nepali voices and packs', () => {
  it('offers one male and 18 female voices from two pinned packs', () => {
    expect(NEPALI_VOICES).toHaveLength(19);
    expect(getNepaliVoice(DEFAULT_NEPALI_VOICE)).toMatchObject({ gender: 'Male', packId: 'ne-chitwan', speaker: null });
    expect(NEPALI_VOICES.filter((voice) => voice.packId === 'ne-google').map((voice) => voice.speaker)).toEqual([...Array(18).keys()]);
    expect(isNepaliVoice('af_heart')).toBe(false);
    for (const pack of VOICE_PACKS) {
      const files = packFiles(pack);
      expect(files.map((file) => file.path.split('/').at(-1))).toEqual([`${pack.model}.json`, pack.model]);
      for (const file of files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(fileUrl(file.path)).toBe(`https://huggingface.co/rhasspy/piper-voices/resolve/${PACK_REVISION}/${file.path.slice('piper-voices/'.length)}`);
      }
    }
  });
});

describe('resample', () => {
  it('converts Piper audio to Kokoro\'s rate for mixed exports', () => {
    const tone = Float32Array.from({ length: 22_050 }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / 22_050));
    const out = resample(tone, 22_050, 24_000);
    expect(out.length).toBe(24_000);
    // Same tone at the new rate.
    for (const i of [100, 5000, 23_000]) expect(out[i]!).toBeCloseTo(Math.sin((2 * Math.PI * 200 * i) / 24_000), 2);
    expect(resample(tone, 24_000, 24_000)).toBe(tone);
  });
});
