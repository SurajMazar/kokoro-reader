/**
 * Piper's phoneme handling, ported from piper1-gpl (GPL-3.0):
 * src/piper/phonemize_espeak.py and src/piper/phoneme_ids.py.
 *
 * espeak-ng returns one record per clause: the clause's IPA, the punctuation
 * that ended it, and whether it ends a sentence. Piper keeps that punctuation
 * as a symbol, splits phonemes into Unicode code points after NFD
 * decomposition (so combining marks such as nasalization are their own
 * symbols), merges vowel clusters the voice was trained with, and surrounds
 * every symbol with padding.
 */

export interface Clause {
  phonemes: string;
  /** '.', '?', '!', ',', ':', ';' or ''. */
  terminator: string;
  endOfSentence: boolean;
}

export interface PiperVoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
  phoneme_id_map: Record<string, number[]>;
  vowel_clusters?: string[][];
}

const PAD = '_';
const BOS = '^';
const EOS = '$';

/** Groups clauses into sentences of phoneme symbols, as Piper's EspeakPhonemizer does. */
export function clausesToSentences(clauses: Clause[], vowelClusters: string[][] = []): string[][] {
  const sentences: string[][] = [];
  let current: string[] = [];
  const finish = () => {
    sentences.push(vowelClusters.length ? mergeVowelClusters(current, vowelClusters) : current);
    current = [];
  };
  for (const clause of clauses) {
    // Remove language-switch flags such as "(en)" around foreign words.
    let text = clause.phonemes.replace(/\([^)]+\)/g, '') + clause.terminator;
    if (clause.terminator === ',' || clause.terminator === ':' || clause.terminator === ';') text += ' ';
    current.push(...Array.from(text.normalize('NFD')));
    if (clause.endOfSentence) finish();
  }
  if (current.length) finish();
  return sentences.filter((sentence) => sentence.length > 0);
}

export function mergeVowelClusters(phones: string[], clusters: string[][]): string[] {
  const maxLength = Math.max(...clusters.map((cluster) => cluster.length));
  const keys = new Set(clusters.map((cluster) => cluster.join('\u0000')));
  const out: string[] = [];
  let i = 0;
  while (i < phones.length) {
    let matched = 0;
    for (let n = Math.min(maxLength, phones.length - i); n > 1; n--) {
      if (keys.has(phones.slice(i, i + n).join('\u0000'))) {
        matched = n;
        break;
      }
    }
    if (matched) {
      out.push(phones.slice(i, i + matched).join(''));
      i += matched;
    } else {
      out.push(phones[i]!);
      i += 1;
    }
  }
  return out;
}

/** BOS, PAD, then each known symbol followed by PAD, then EOS. Unknown symbols are skipped. */
export function phonemesToIds(phonemes: string[], idMap: Record<string, number[]>): number[] {
  const ids = [...idMap[BOS]!, ...idMap[PAD]!];
  for (const phoneme of phonemes) {
    const id = idMap[phoneme];
    if (!id) continue;
    ids.push(...id, ...idMap[PAD]!);
  }
  ids.push(...idMap[EOS]!);
  return ids;
}
