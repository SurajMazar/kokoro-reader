export type LanguageVerdict = 'english' | 'latin-other' | 'unsupported-script' | 'unknown';

const STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'a', 'in', 'is', 'it', 'that', 'for', 'on', 'was', 'with', 'as', 'are', 'be', 'this',
  'by', 'at', 'or', 'from', 'an', 'have', 'not', 'but', 'they', 'you', 'we', 'his', 'her', 'which', 'were', 'has',
]);

/**
 * Cheap language check on a text sample. Kokoro Reader's phonemizer path is
 * English-only, so the useful questions are: is this English, another
 * Latin-script language (readable but mispronounced), or a script the
 * English voices cannot pronounce at all?
 */
export function detectLanguage(text: string, declared?: string): LanguageVerdict {
  const sample = text.slice(0, 4000);
  const letters = sample.match(/\p{L}/gu) ?? [];
  if (letters.length < 12) {
    if (declared) return declared.toLowerCase().startsWith('en') ? 'english' : 'unknown';
    return 'unknown';
  }
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  if (latin / letters.length < 0.5) return 'unsupported-script';
  const words = sample.toLowerCase().match(/[a-z']+/g) ?? [];
  const hits = words.filter((word) => STOPWORDS.has(word)).length;
  const ratio = words.length ? hits / words.length : 0;
  if (ratio >= 0.12) return 'english';
  if (declared?.toLowerCase().startsWith('en')) return 'english';
  return words.length >= 20 ? 'latin-other' : 'unknown';
}

/**
 * Share of words written in Devanagari. Words, not characters, are counted:
 * Devanagari vowel signs make Nepali words long in code points but short in
 * letters, and a sentence is Nepali when most of its words are.
 */
export function devanagariShare(text: string): number {
  const words = text.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  if (!words.length) return 0;
  return words.filter((word) => /\p{Script=Devanagari}/u.test(word)).length / words.length;
}

/**
 * True for text the Nepali voices should read: mostly Devanagari. Hindi,
 * Marathi and Sanskrit use the same script; the extension has no voices for
 * them, so they are read with the Nepali voice too, which is close.
 */
export function isNepaliText(text: string): boolean {
  return devanagariShare(text) >= 0.5;
}
