/**
 * Collects readable blocks from a DOM subtree, in document order.
 *
 * For live pages it also returns a TextMap per block: for every character of
 * the block's normalized text, the Text node and offset it came from. That is
 * what lets sentence offsets become DOM Ranges for highlighting without ever
 * modifying the page.
 */
import type { BlockInput } from '../text/doc';

export interface TextMap {
  nodes: Text[];
  /** Per output character: index into `nodes`. */
  nodeIndex: Int32Array;
  /** Per output character: offset inside that node. */
  offsets: Int32Array;
  length: number;
}

export interface Collected {
  blocks: BlockInput[];
  maps: TextMap[];
  /** Where each Text node's first character landed: block index and char offset. */
  nodePositions: Map<Text, { block: number; offset: number }>;
}

export interface CollectOptions {
  /** Live pages: skip invisible elements (uses layout, so only for the real document). */
  live: boolean;
  /** Drop navigation, ads, related links and similar page furniture. */
  dropFurniture: boolean;
  includeCode: boolean;
  /** Restrict to text inside this range (selection reading). */
  range?: Range;
}

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'PRE', 'DD', 'DT', 'TD', 'TH', 'CAPTION',
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY', 'TABLE', 'UL', 'OL', 'DL', 'FIGURE', 'ADDRESS', 'SUMMARY', 'DETAILS',
  'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FORM', 'FIELDSET', 'LEGEND', 'TR', 'HR',
]);

const ALWAYS_SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'BUTTON',
  'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'MATH', 'KOKORO-READER-ROOT', 'HEAD', 'TITLE', 'META', 'LINK',
]);

const FURNITURE_TAGS = new Set(['NAV', 'FOOTER', 'ASIDE', 'FORM', 'DIALOG', 'MENU']);
const FURNITURE_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search', 'menu', 'menubar', 'toolbar', 'dialog', 'alertdialog', 'tablist', 'tooltip']);
const FURNITURE_NAMES =
  /(^|[\s_-])(ads?|advert\w*|sponsor\w*|promo\w*|cookie\w*|consent|gdpr|newsletter|subscribe|share|sharing|social|related|recommend\w*|outbrain|taboola|comments?|breadcrumbs?|sidebar|popup|modal|paywall|skip-link|site-header|site-footer|masthead|toc|table-of-contents)([\s_-]|$)/i;

function isFurniture(element: Element): boolean {
  if (FURNITURE_TAGS.has(element.tagName)) return true;
  const role = element.getAttribute('role');
  if (role && FURNITURE_ROLES.has(role)) return true;
  // A page-level <header> is furniture; one inside an article is the article's title area.
  if (element.tagName === 'HEADER' && !element.closest('article, main, [role="main"]')) return true;
  const name = `${element.id} ${typeof element.className === 'string' ? element.className : ''}`;
  return name.length > 1 && FURNITURE_NAMES.test(name);
}

function isHidden(element: Element, live: boolean): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('inert')) return true;
  if (!live) {
    const style = element.getAttribute('style') ?? '';
    return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
  }
  const html = element as HTMLElement;
  if (typeof html.checkVisibility === 'function') {
    return !html.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true } as CheckVisibilityOptions);
  }
  const style = getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden';
}

function blockOf(node: Node, root: Node): Element {
  let element = node.parentElement;
  while (element && element !== root && !BLOCK_TAGS.has(element.tagName)) element = element.parentElement;
  return element ?? (root as Element);
}

function kindOf(block: Element): Pick<BlockInput, 'kind' | 'level'> {
  const tag = block.tagName;
  if (/^H[1-6]$/.test(tag)) return { kind: 'heading', level: Number(tag[1]) };
  if (block.getAttribute('role') === 'heading') return { kind: 'heading', level: Number(block.getAttribute('aria-level') ?? 2) };
  if (tag === 'LI' || tag === 'DD' || tag === 'DT') return { kind: 'list-item' };
  if (tag === 'FIGCAPTION' || tag === 'CAPTION') return { kind: 'caption' };
  if (tag === 'PRE' || block.closest('pre')) return { kind: 'code' };
  if (tag === 'BLOCKQUOTE' || block.closest('blockquote')) return { kind: 'quote' };
  return { kind: 'paragraph' };
}

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/;
const SPACE = /\s/;

class BlockBuilder {
  chars: string[] = [];
  nodes: Text[] = [];
  nodeIndex: number[] = [];
  offsets: number[] = [];
  pendingSpace = false;

  append(node: Text, from: number, to: number, positions: Map<Text, { block: number; offset: number }>, blockIndex: number) {
    const data = node.data;
    let nodeSlot = -1;
    for (let i = from; i < to; i++) {
      const ch = data[i]!;
      if (ZERO_WIDTH.test(ch)) continue;
      if (SPACE.test(ch)) {
        if (this.chars.length) this.pendingSpace = true;
        continue;
      }
      if (nodeSlot < 0) {
        nodeSlot = this.nodes.push(node) - 1;
        if (!positions.has(node)) positions.set(node, { block: blockIndex, offset: this.chars.length + (this.pendingSpace ? 1 : 0) });
      }
      if (this.pendingSpace) {
        this.chars.push(' ');
        this.nodeIndex.push(nodeSlot);
        this.offsets.push(Math.max(from, i - 1));
        this.pendingSpace = false;
      }
      this.chars.push(ch);
      this.nodeIndex.push(nodeSlot);
      this.offsets.push(i);
    }
  }

  get empty() {
    return !this.chars.some((ch) => /[\p{L}\p{N}]/u.test(ch));
  }

  toMap(): TextMap {
    return {
      nodes: this.nodes,
      nodeIndex: Int32Array.from(this.nodeIndex),
      offsets: Int32Array.from(this.offsets),
      length: this.chars.length,
    };
  }
}

export function collectBlocks(root: Node, options: CollectOptions): Collected {
  const doc = root.ownerDocument ?? (root as Document);
  const blocks: BlockInput[] = [];
  const maps: TextMap[] = [];
  const nodePositions = new Map<Text, { block: number; offset: number }>();
  const hiddenCache = new WeakMap<Element, boolean>();

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!(node as Text).data.trim()) return NodeFilter.FILTER_SKIP;
        if (options.range && !options.range.intersectsNode(node)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
      const element = node as Element;
      if (ALWAYS_SKIP.has(element.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
      if (!options.includeCode && element.tagName === 'PRE') return NodeFilter.FILTER_REJECT;
      if (options.dropFurniture && element !== root && isFurniture(element)) return NodeFilter.FILTER_REJECT;
      if (options.range && !options.range.intersectsNode(element)) return NodeFilter.FILTER_REJECT;
      let hidden = hiddenCache.get(element);
      if (hidden === undefined) {
        hidden = isHidden(element, options.live);
        hiddenCache.set(element, hidden);
      }
      return hidden ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });

  let currentBlock: Element | null = null;
  let builder = new BlockBuilder();
  const flush = () => {
    if (currentBlock && !builder.empty) {
      blocks.push({ ...kindOf(currentBlock), text: builder.chars.join('') });
      maps.push(builder.toMap());
    } else {
      for (const node of builder.nodes) nodePositions.delete(node);
    }
    builder = new BlockBuilder();
  };

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const block = blockOf(text, root);
    if (block !== currentBlock) {
      flush();
      currentBlock = block;
    }
    let from = 0;
    let to = text.data.length;
    if (options.range) {
      if (text === options.range.startContainer) from = options.range.startOffset;
      if (text === options.range.endContainer) to = options.range.endOffset;
    }
    builder.append(text, from, to, nodePositions, blocks.length);
  }
  flush();
  return { blocks, maps, nodePositions };
}

/** Converts a [start, end) span of a block's text into a DOM Range. */
export function rangeForSpan(map: TextMap, start: number, end: number): Range | null {
  if (!map.length || end <= start) return null;
  const first = Math.max(0, Math.min(start, map.length - 1));
  const last = Math.max(first, Math.min(end, map.length) - 1);
  const startNode = map.nodes[map.nodeIndex[first]!];
  const endNode = map.nodes[map.nodeIndex[last]!];
  if (!startNode?.isConnected || !endNode?.isConnected) return null;
  const range = startNode.ownerDocument.createRange();
  try {
    range.setStart(startNode, Math.min(map.offsets[first]!, startNode.length));
    range.setEnd(endNode, Math.min(map.offsets[last]! + 1, endNode.length));
  } catch {
    return null;
  }
  return range;
}

/**
 * Picks the element holding the page's main content: an explicit article or
 * main landmark when it has real text, otherwise the container with the most
 * paragraph text, otherwise <body>.
 */
export function findContentRoot(doc: Document): Element {
  const body = doc.body ?? doc.documentElement;
  const textLength = (element: Element) =>
    Array.from(element.querySelectorAll('p'), (p) => (p.textContent ?? '').trim().length).reduce((a, b) => a + b, 0);

  const landmarks = Array.from(doc.querySelectorAll('article, main, [role="main"], [itemprop="articleBody"]'));
  let best: Element | null = null;
  let bestScore = 0;
  for (const candidate of landmarks) {
    const score = textLength(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best && bestScore >= 400) return best;

  const scores = new Map<Element, number>();
  for (const p of Array.from(doc.querySelectorAll('p'))) {
    const length = (p.textContent ?? '').trim().length;
    if (length < 40) continue;
    const parent = p.parentElement;
    if (parent) scores.set(parent, (scores.get(parent) ?? 0) + length);
    const grandparent = parent?.parentElement;
    if (grandparent) scores.set(grandparent, (scores.get(grandparent) ?? 0) + length / 2);
  }
  let top: Element | null = null;
  let topScore = 0;
  for (const [element, score] of scores) {
    if (score > topScore) {
      top = element;
      topScore = score;
    }
  }
  return top && topScore >= 400 ? top : body;
}
