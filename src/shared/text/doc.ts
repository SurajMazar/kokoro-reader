import type { DocBlock, DocSource, ReadingDoc } from '../types';
import { createId } from '../utils/id';
import { detectLanguage } from './language';
import { normalizeDisplayText } from './normalize';
import { segmentBlocks } from './segment';

export interface BlockInput {
  kind: DocBlock['kind'];
  level?: number;
  text: string;
}

export interface DocInput {
  title: string;
  url?: string;
  siteName?: string;
  byline?: string;
  source: DocSource;
  language?: string;
  blocks: BlockInput[];
  /**
   * Block text is already whitespace-normalized and must keep its exact
   * characters, because a DOM text map indexes into it (live page reading).
   */
  preNormalized?: boolean;
}

/** Builds a ReadingDoc: normalizes block text, drops empty blocks and segments sentences. */
export function buildDoc(input: DocInput): ReadingDoc {
  const blocks: DocBlock[] = [];
  for (const block of input.blocks) {
    const text = input.preNormalized ? block.text : normalizeDisplayText(block.text);
    if (!text.trim()) continue;
    blocks.push({ id: blocks.length, kind: block.kind, ...(block.level ? { level: block.level } : {}), text });
  }
  const sentences = segmentBlocks(blocks);
  const verdict = detectLanguage(blocks.map((block) => block.text).join(' '), input.language);
  return {
    id: createId(),
    title: normalizeDisplayText(input.title) || 'Untitled',
    url: input.url,
    siteName: input.siteName,
    byline: input.byline,
    source: input.source,
    language: verdict === 'english' ? 'en' : (input.language ?? (verdict === 'unknown' ? undefined : verdict)),
    blocks,
    sentences,
  };
}

/** Splits pasted or imported plain text into paragraph blocks. */
export function textToBlocks(text: string): BlockInput[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)/)
    .map((part) => part.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((part) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(part);
      if (heading) return { kind: 'heading' as const, level: heading[1]!.length, text: heading[2]! };
      const listItem = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(part);
      if (listItem) return { kind: 'list-item' as const, text: listItem[1]! };
      return { kind: 'paragraph' as const, text: part };
    });
}

export function docText(doc: ReadingDoc): string {
  return doc.blocks.map((block) => block.text).join('\n\n');
}

/** Index of the first sentence in the block, or -1. */
export function firstSentenceOfBlock(doc: ReadingDoc, blockId: number): number {
  return doc.sentences.findIndex((sentence) => sentence.blockId === blockId);
}
