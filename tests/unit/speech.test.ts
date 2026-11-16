import { describe, expect, it } from 'vitest';
import { normalizeText } from '@/engine/kokoro/phonemize';
import { getKokoroVoice, isKokoroVoice, KOKORO_VOICES, phonemizerLanguage, voiceFilePath } from '@/engine/kokoro/voices';
import { normalizeForSpeech } from '@/engine/text/speech-normalizer';
import manifest from '@/models/model-manifest.json';

describe('normalizeForSpeech', () => {
  it('speaks URLs and e-mail addresses', () => {
    expect(normalizeForSpeech('Visit https://www.example.com today.')).toBe('Visit example dot com today.');
    expect(normalizeForSpeech('See https://example.com/docs/a.')).toContain('a link to example dot com');
    expect(normalizeForSpeech('Mail team.lead@example.org now')).toBe('Mail team lead at example dot org now');
  });
  it('expands abbreviations, symbols and ordinals', () => {
    expect(normalizeForSpeech('Use tools, e.g. hammers & saws.')).toBe('Use tools, for example, hammers and saws.');
    expect(normalizeForSpeech('It rose 20% on the 3rd day.')).toBe('It rose 20 percent on the third day.');
    expect(normalizeForSpeech('It is 21°C.')).toBe('It is 21 degrees Celsius.');
  });
  it('shortens round large numbers', () => {
    expect(normalizeForSpeech('Population 8,000,000 people')).toBe('Population 8 million people');
  });
});

describe('Kokoro reference normalization', () => {
  it('handles money, years, times and titles like kokoro-js', () => {
    expect(normalizeText('It cost $12.50.')).toBe('It cost 12 dollars and 50 cents.');
    expect(normalizeText('In 1984 we met.')).toBe('In 19 84 we met.');
    expect(normalizeText('Meet at 3:05.')).toBe("Meet at 3 oh 5.");
    expect(normalizeText('Dr. Who and Mr. Smith')).toBe('Doctor Who and Mister Smith');
  });
});

describe('voice catalogue', () => {
  it('lists only voices that exist in the pinned model', () => {
    expect(KOKORO_VOICES.length).toBe(28);
    for (const voice of KOKORO_VOICES) expect(voiceFilePath(voice.id) in manifest.files).toBe(true);
  });
  it('maps voices to the right phonemizer dialect', () => {
    expect(phonemizerLanguage('af_heart')).toBe('en-us');
    expect(phonemizerLanguage('bf_emma')).toBe('en');
    expect(isKokoroVoice('af_heart')).toBe(true);
    expect(isKokoroVoice('xx_fake')).toBe(false);
    expect(getKokoroVoice('bm_george')?.language).toBe('en-GB');
  });
});
