import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CATALOG, isErrorInfo, toErrorInfo } from '@/shared/errors';
import { clampRate, DEFAULT_SETTINGS, normalizeSettings } from '@/shared/settings';

describe('settings', () => {
  it('fills defaults and drops wrongly typed or unknown values', () => {
    const settings = normalizeSettings({ rate: 'fast', voice: 'bf_emma', unknown: 1, favoriteVoices: 'af_heart', prefetchSentences: 99 });
    expect(settings.rate).toBe(DEFAULT_SETTINGS.rate);
    expect(settings.voice).toBe('bf_emma');
    expect(settings.favoriteVoices).toEqual(DEFAULT_SETTINGS.favoriteVoices);
    expect(settings.prefetchSentences).toBe(8);
    expect('unknown' in settings).toBe(false);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps playback rate', () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(9)).toBe(3);
    expect(clampRate(1.333)).toBe(1.33);
    expect(clampRate(Number.NaN)).toBe(1);
  });
});

describe('errors', () => {
  it('every code has a message and a recovery action', () => {
    for (const spec of Object.values(ERROR_CATALOG)) {
      expect(spec.message.length).toBeGreaterThan(10);
      expect(spec.recovery).toBeTruthy();
    }
  });
  it('classifies thrown values', () => {
    expect(toErrorInfo(new AppError('E_EMPTY_TEXT')).code).toBe('E_EMPTY_TEXT');
    expect(toErrorInfo(new DOMException('full', 'QuotaExceededError')).code).toBe('E_STORAGE_QUOTA');
    expect(toErrorInfo(new DOMException('stop', 'AbortError')).code).toBe('E_CANCELLED');
    expect(toErrorInfo(new Error('RangeError: Array buffer allocation failed')).code).toBe('E_OUT_OF_MEMORY');
    expect(toErrorInfo('weird', 'E_SYNTHESIS').code).toBe('E_SYNTHESIS');
    expect(isErrorInfo({ code: 'E_PLAYBACK', message: 'x', recovery: 'retry' })).toBe(true);
    expect(isErrorInfo({ code: 'NOPE', message: 'x' })).toBe(false);
  });
});
