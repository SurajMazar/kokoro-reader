import { AppError } from '@/shared/errors';
import { collectBlocks, concatCollected, findContentRoot, findTitleElement, proseBounds, sliceCollected, type Collected, type TextMap } from '@/shared/extraction/collect';
import type { PageSnapshot } from '@/shared/messages/contract';
import { buildDoc } from '@/shared/text/doc';
import type { ReadingDoc } from '@/shared/types';

export interface LiveDoc {
  doc: ReadingDoc;
  /** TextMap per block id, for turning sentence offsets into Ranges. */
  maps: TextMap[];
  url: string;
  mode: 'selection' | 'page';
}

function pageLanguage(): string {
  return document.documentElement.lang || navigator.language || '';
}

export function pageTitle(): string {
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  return (og || document.title || location.hostname).trim();
}

export function siteName(): string {
  return document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content?.trim() || location.hostname.replace(/^www\./, '');
}

function toLiveDoc(collected: Collected, source: 'selection' | 'page', title: string): LiveDoc {
  const doc = buildDoc({
    title,
    url: location.href,
    siteName: siteName(),
    source,
    language: pageLanguage(),
    blocks: collected.blocks,
    preNormalized: true,
  });
  return { doc, maps: collected.maps, url: location.href, mode: source };
}

/** The user's current selection as a document, or null when nothing readable is selected. */
export function readSelection(): LiveDoc | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  return readRange(selection.getRangeAt(0), selection.toString());
}

/** A specific Range (e.g. the one captured when the speaker button appeared) as a document. */
export function readRange(range: Range, fallbackText = range.toString()): LiveDoc | null {
  const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
  if (!root) return null;
  const collected = collectBlocks(root, { live: true, dropFurniture: false, includeCode: true, range });
  if (!collected.blocks.length) {
    // Text inside form fields and some editors is not in Text nodes; fall back to the plain string.
    const text = fallbackText.trim();
    if (!text) return null;
    return {
      doc: buildDoc({ title: pageTitle(), url: location.href, siteName: siteName(), source: 'selection', language: pageLanguage(), blocks: [{ kind: 'paragraph', text }] }),
      maps: [],
      url: location.href,
      mode: 'selection',
    };
  }
  const live = toLiveDoc(collected, 'selection', pageTitle());
  return live.doc.sentences.length ? live : null;
}

/**
 * Reads the page's main content in DOM order, starting with its headline.
 * When no single container holds the article (the root is <body>), reading
 * runs from the headline (or first paragraph) to the last paragraph.
 */
export function readPage(): LiveDoc {
  const options = { live: true, dropFurniture: true, includeCode: false };
  const body = document.body;
  const root = findContentRoot(document);
  const title = findTitleElement(document);
  let collected = collectBlocks(root, options);
  if (!collected.blocks.length && root !== body) collected = collectBlocks(body, options);
  else if (root === body) {
    const bounds = proseBounds(body);
    if (bounds) {
      const titleFirst = title && Boolean(title.compareDocumentPosition(bounds[0]) & Node.DOCUMENT_POSITION_FOLLOWING);
      collected = sliceCollected(collected, titleFirst ? title : bounds[0], bounds[1]);
    }
  } else if (title && !root.contains(title) && title.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) {
    // The headline sits above the article body (outside the content root): read it first.
    collected = concatCollected([collectBlocks(title, { ...options, dropFurniture: false }), collected]);
  }
  const live = toLiveDoc(collected, 'page', pageTitle());
  if (!live.doc.sentences.length) throw new AppError('E_EXTRACTION');
  return live;
}

/** Index of the sentence at the start of the current selection in a page document, or 0. */
export function sentenceAtSelection(live: LiveDoc, given?: Range): number {
  const selection = window.getSelection();
  const range = given ?? (selection && selection.rangeCount ? selection.getRangeAt(0) : null);
  if (!range) return 0;
  for (let blockId = 0; blockId < live.maps.length; blockId++) {
    const map = live.maps[blockId]!;
    for (let i = 0; i < map.length; i++) {
      const node = map.nodes[map.nodeIndex[i]!]!;
      if (range.intersectsNode(node)) {
        const offset = node === range.startContainer ? Math.max(i, findOffset(map, node, range.startOffset)) : i;
        const sentence = live.doc.sentences.find((candidate) => candidate.blockId === blockId && candidate.end > offset);
        return sentence?.id ?? 0;
      }
    }
  }
  return 0;
}

function findOffset(map: TextMap, node: Text, nodeOffset: number): number {
  for (let i = 0; i < map.length; i++) {
    if (map.nodes[map.nodeIndex[i]!] === node && map.offsets[i]! >= nodeOffset) return i;
  }
  return 0;
}

export function snapshotPage(): PageSnapshot {
  return {
    html: document.documentElement.outerHTML,
    url: location.href,
    title: pageTitle(),
    language: pageLanguage(),
  };
}
