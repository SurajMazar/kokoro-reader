/** Display-text cleanup. Offsets are computed after this runs, so it may change length. */
export function normalizeDisplayText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v  -   　]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/** Average adult listening pace for Kokoro at 1×, used only for remaining-time estimates. */
export const WORDS_PER_SECOND_AT_1X = 2.6;

export function estimateSeconds(text: string, rate = 1): number {
  return countWords(text) / (WORDS_PER_SECOND_AT_1X * Math.max(0.1, rate));
}
