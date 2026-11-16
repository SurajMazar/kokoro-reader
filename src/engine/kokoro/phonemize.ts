/**
 * Text → phoneme conversion for Kokoro.
 *
 * Ported from kokoro-js 1.2.1 (src/phonemize.js, Apache-2.0, © hexgrad and
 * contributors), which itself follows the misaki/Kokoro reference pipeline.
 * kokoro-js does not export these functions, and this extension needs them to
 * enforce the model's 510-token limit before inference instead of letting
 * the tokenizer silently truncate long sentences.
 */
import { phonemize as espeak } from 'phonemizer';

function splitNum(match: string): string {
  if (match.includes('.')) return match;
  if (match.includes(':')) {
    const [h, m] = match.split(':').map(Number) as [number, number];
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  const year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  const left = match.slice(0, 2);
  const right = parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}

function flipMoney(match: string): string {
  const bill = match[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(match.slice(1)))) return `${match.slice(1)} ${bill}s`;
  if (!match.includes('.')) {
    const suffix = match.slice(1) === '1' ? '' : 's';
    return `${match.slice(1)} ${bill}${suffix}`;
  }
  const [whole, fraction = ''] = match.slice(1).split('.');
  const cents = parseInt(fraction.padEnd(2, '0'), 10);
  const coin = match[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence';
  return `${whole} ${bill}${whole === '1' ? '' : 's'} and ${cents} ${coin}`;
}

function pointNum(match: string): string {
  const [whole, fraction = ''] = match.split('.');
  return `${whole} point ${fraction.split('').join(' ')}`;
}

/** Kokoro's reference text normalization (quotes, CJK punctuation, titles, numbers, money). */
export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/！/g, '! ')
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_PATTERN = new RegExp(`(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');

function splitWithPunctuation(text: string): { match: boolean; text: string }[] {
  const parts: { match: boolean; text: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(PUNCTUATION_PATTERN)) {
    if (last < match.index) parts.push({ match: false, text: text.slice(last, match.index) });
    if (match[0].length > 0) parts.push({ match: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ match: false, text: text.slice(last) });
  return parts;
}

/**
 * Converts text to the phoneme string Kokoro's tokenizer expects.
 * @param language `a` for American English, `b` for British English.
 */
export async function phonemize(text: string, language: 'a' | 'b' = 'a', normalize = true): Promise<string> {
  const input = normalize ? normalizeText(text) : text;
  const espeakLanguage = language === 'a' ? 'en-us' : 'en';
  const parts = await Promise.all(
    splitWithPunctuation(input).map(async ({ match, text: part }) => (match ? part : (await espeak(part, espeakLanguage)).join(' '))),
  );
  let phonemes = parts
    .join('')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (language === 'a') phonemes = phonemes.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return phonemes.trim();
}
