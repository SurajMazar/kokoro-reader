import { describe, expect, it } from 'vitest';
import { buildDoc, firstSentenceOfBlock, textToBlocks } from '@/shared/text/doc';
import { detectLanguage } from '@/shared/text/language';
import { countWords, estimateSeconds, normalizeDisplayText } from '@/shared/text/normalize';
import { MAX_SENTENCE_CHARS, segmentBlocks, sentenceSpans } from '@/shared/text/segment';

describe('normalizeDisplayText', () => {
  it('normalizes unicode, strips zero-width characters and collapses whitespace', () => {
    expect(normalizeDisplayText('  Café​  au lait \t\n\n\n next ')).toBe('Café au lait\nnext');
  });
});

describe('countWords / estimateSeconds', () => {
  it('counts words including contractions and numbers', () => {
    expect(countWords("It's 3 o'clock, isn't it?")).toBe(5);
    expect(countWords('')).toBe(0);
  });
  it('scales with playback rate', () => {
    const text = 'word '.repeat(260);
    expect(estimateSeconds(text, 2)).toBeCloseTo(estimateSeconds(text, 1) / 2);
  });
});

describe('sentenceSpans', () => {
  const split = (text: string) => sentenceSpans(text).map(({ start, end }) => text.slice(start, end));

  it('splits ordinary sentences and keeps offsets exact', () => {
    const text = 'The garden wakes. Bees arrive! Do they sleep?';
    expect(split(text)).toEqual(['The garden wakes.', 'Bees arrive!', 'Do they sleep?']);
  });

  it('does not split after common abbreviations or initials', () => {
    expect(split('Dr. Smith met Mr. Jones at 5 p.m. on Main St. today. Then they left.')).toEqual([
      'Dr. Smith met Mr. Jones at 5 p.m. on Main St. today.',
      'Then they left.',
    ]);
    expect(split('J. R. R. Tolkien wrote books. He liked trees.')).toEqual(['J. R. R. Tolkien wrote books.', 'He liked trees.']);
  });

  it('keeps decimals and URLs intact', () => {
    expect(split('It weighs 3.5 kg. See example.com/docs for more.')).toEqual(['It weighs 3.5 kg.', 'See example.com/docs for more.']);
  });

  it('splits very long sentences at clause boundaries', () => {
    const long = Array.from({ length: 40 }, (_, i) => `clause number ${i} goes here`).join(', ') + '.';
    const parts = split(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  it('drops punctuation-only fragments', () => {
    expect(split('… — !')).toEqual([]);
  });
});

describe('segmentBlocks', () => {
  it('assigns sequential ids across blocks and never loses order', () => {
    const sentences = segmentBlocks([
      { id: 0, kind: 'heading', level: 1, text: 'Title' },
      { id: 1, kind: 'paragraph', text: 'One. Two.' },
      { id: 2, kind: 'paragraph', text: 'Three.' },
    ]);
    expect(sentences.map((s) => [s.id, s.blockId, s.text])).toEqual([
      [0, 0, 'Title'],
      [1, 1, 'One.'],
      [2, 1, 'Two.'],
      [3, 2, 'Three.'],
    ]);
  });
});

describe('buildDoc / textToBlocks', () => {
  it('turns pasted text into headings, list items and paragraphs', () => {
    const blocks = textToBlocks('# Heading\n\nFirst paragraph\ncontinues here.\n\n- item one\n- item two\n\nLast.');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Heading' },
      { kind: 'paragraph', text: 'First paragraph continues here.' },
      { kind: 'list-item', text: 'item one' },
      { kind: 'list-item', text: 'item two' },
      { kind: 'paragraph', text: 'Last.' },
    ]);
  });

  it('drops empty blocks, renumbers ids and marks English', () => {
    const doc = buildDoc({ title: ' My  doc ', source: 'custom', blocks: [{ kind: 'paragraph', text: '   ' }, { kind: 'paragraph', text: 'This is the text of the document, and it is in English.' }] });
    expect(doc.title).toBe('My doc');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.id).toBe(0);
    expect(doc.language).toBe('en');
    expect(firstSentenceOfBlock(doc, 0)).toBe(0);
  });

  it('keeps pre-normalized text byte-for-byte (needed for DOM text maps)', () => {
    const text = 'Café is here.';
    const doc = buildDoc({ title: 't', source: 'page', blocks: [{ kind: 'paragraph', text }], preNormalized: true });
    expect(doc.blocks[0]!.text).toBe(text);
  });
});

describe('detectLanguage', () => {
  it('recognizes English, other Latin-script text and unsupported scripts', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog and runs to the river with the others.')).toBe('english');
    expect(detectLanguage('El rápido zorro marrón salta sobre el perro perezoso y corre hacia el río con los demás amigos del bosque.')).toBe('latin-other');
    expect(detectLanguage('これは日本語の文章です。音声合成のテストに使います。')).toBe('unsupported-script');
    expect(detectLanguage('Hi', 'en-US')).toBe('english');
  });
});
