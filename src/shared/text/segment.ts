import type { DocBlock, Sentence } from '../types';

/** Abbreviations that end with a period but rarely end a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'sgt', 'col', 'gen', 'lt', 'capt', 'gov', 'sen', 'rep',
  'vs', 'etc', 'e.g', 'i.e', 'cf', 'approx', 'no', 'vol', 'fig', 'figs', 'p', 'pp', 'ch', 'sec', 'inc', 'ltd', 'co',
  'corp', 'dept', 'est', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'u.s',
  'u.k', 'a.m', 'p.m', 'ph.d',
]);

/** Sentences longer than this are split at clause boundaries so highlights and synthesis chunks stay short. */
export const MAX_SENTENCE_CHARS = 320;

interface Span {
  start: number;
  end: number;
}

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter;
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return null;
  segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  return segmenter;
}

function rawSentenceSpans(text: string): Span[] {
  const seg = getSegmenter();
  if (seg) {
    return Array.from(seg.segment(text), (part) => ({ start: part.index, end: part.index + part.segment.length }));
  }
  const spans: Span[] = [];
  const pattern = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g;
  for (const match of text.matchAll(pattern)) {
    if (match[0].length > 0) spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function endsWithAbbreviation(text: string): boolean {
  const match = /(?:^|\s|\()([A-Za-z][A-Za-z.]*)\.\s*$/.exec(text);
  if (!match) return false;
  const word = match[1]!.toLowerCase();
  // Single capital letters ("J. R. R. Tolkien") are initials, not sentence ends.
  return ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word);
}

/** Splits an over-long span at the last clause boundary (or space) before the limit. */
function splitLong(text: string, span: Span): Span[] {
  const result: Span[] = [];
  let start = span.start;
  while (span.end - start > MAX_SENTENCE_CHARS) {
    const window = text.slice(start, start + MAX_SENTENCE_CHARS);
    let cut = -1;
    for (const pattern of [/[;:—–]\s/g, /,\s/g, /\s/g]) {
      let last = -1;
      for (const match of window.matchAll(pattern)) {
        if (match.index > MAX_SENTENCE_CHARS * 0.35) last = match.index + match[0].length;
      }
      if (last > 0) {
        cut = last;
        break;
      }
    }
    if (cut <= 0) cut = MAX_SENTENCE_CHARS;
    result.push({ start, end: start + cut });
    start += cut;
  }
  if (span.end > start) result.push({ start, end: span.end });
  return result;
}

/** Returns trimmed sentence spans for one block of text. */
export function sentenceSpans(text: string): Span[] {
  const merged: Span[] = [];
  for (const span of rawSentenceSpans(text)) {
    const previous = merged.at(-1);
    if (previous && endsWithAbbreviation(text.slice(previous.start, previous.end))) {
      previous.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  const trimmed: Span[] = [];
  for (const span of merged.flatMap((span) => splitLong(text, span))) {
    let { start, end } = span;
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (end > start && /[\p{L}\p{N}]/u.test(text.slice(start, end))) trimmed.push({ start, end });
  }
  return trimmed;
}

/** Segments every block into sentences with ids in reading order. */
export function segmentBlocks(blocks: DocBlock[]): Sentence[] {
  const sentences: Sentence[] = [];
  for (const block of blocks) {
    for (const { start, end } of sentenceSpans(block.text)) {
      sentences.push({ id: sentences.length, blockId: block.id, start, end, text: block.text.slice(start, end) });
    }
  }
  return sentences;
}
