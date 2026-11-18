/**
 * Text clean-up before Nepali phonemization.
 *
 * espeak-ng's Nepali voice reads Devanagari numerals in Nepali but switches to
 * English for ASCII digits, so digits are converted (2,500 → २५००). Commas
 * inside numbers are dropped so a number is read as one number.
 */
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export function normalizeNepali(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/(?<=[\d०-९]),(?=[\d०-९]{2,3}\b)/g, '')
    .replace(/\d/g, (digit) => DEVANAGARI_DIGITS[Number(digit)]!)
    .replace(/\s+/g, ' ')
    .trim();
}
