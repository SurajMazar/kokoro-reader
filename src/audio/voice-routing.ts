import { isNepaliVoice } from '@/engine/piper/voices';
import { isNepaliText } from '@/shared/text/language';

/** English runs this long or longer are read by the English voice even inside a Nepali document. */
const ENGLISH_SENTENCE_WORDS = 5;

/** True when most sentences that contain letters are Nepali. */
export function isNepaliDocument(sentences: readonly { text: string }[]): boolean {
  const worded = sentences.filter((sentence) => /\p{L}/u.test(sentence.text));
  if (!worded.length) return false;
  return worded.filter((sentence) => isNepaliText(sentence.text)).length / worded.length >= 0.5;
}

/**
 * The voice that reads a sentence. Devanagari sentences go to the Nepali
 * voice. In a mostly-Nepali document, so do fragments without real English
 * in them (scores like "0/0", "vs", a short English name): the Nepali voice
 * reads them through espeak-ng's English rules, and switching engines for a
 * scrap of text would mean a different voice, and possibly a large download,
 * in the middle of a Nepali page.
 */
export function voiceForSentence(text: string, voice: string, nepaliVoice: string, nepaliDocument: boolean): string {
  if (isNepaliVoice(voice)) return voice;
  if (isNepaliText(text)) return nepaliVoice;
  if (nepaliDocument && (text.match(/\p{Script=Latin}+/gu) ?? []).length < ENGLISH_SENTENCE_WORDS) return nepaliVoice;
  return voice;
}
