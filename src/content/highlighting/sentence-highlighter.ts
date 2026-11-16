/**
 * Highlights the spoken sentence and its paragraph with the CSS Custom
 * Highlight API. Highlights are painted by the browser over existing text,
 * so the page's DOM is never modified (no wrapper spans that could break the
 * site's layout, scripts or React reconciliation).
 */
import { rangeForSpan, type TextMap } from '@/shared/extraction/collect';
import type { ReadingDoc } from '@/shared/types';

const SENTENCE = 'kokoro-reader-sentence';
const PARAGRAPH = 'kokoro-reader-paragraph';
const STYLE_ID = 'kokoro-reader-highlight-style';

export interface HighlightOptions {
  sentence: boolean;
  paragraph: boolean;
  autoScroll: boolean;
  highContrast: boolean;
}

function supported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

function ensureStyle(highContrast: boolean) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head ?? document.documentElement).append(style);
  }
  style.textContent = highContrast
    ? `::highlight(${SENTENCE}){background-color:#1d1d1f;color:#ffe066}::highlight(${PARAGRAPH}){background-color:rgba(255,224,102,.25)}`
    : `::highlight(${SENTENCE}){background-color:rgba(124,92,255,.28);color:inherit}::highlight(${PARAGRAPH}){background-color:rgba(124,92,255,.08)}`;
}

export class SentenceHighlighter {
  private userScrolledAt = 0;
  private programmaticScroll = false;
  private readonly onScroll = () => {
    if (!this.programmaticScroll) this.userScrolledAt = Date.now();
  };

  constructor(
    private readonly doc: ReadingDoc,
    private readonly maps: TextMap[],
    private options: HighlightOptions,
  ) {
    window.addEventListener('wheel', this.onScroll, { passive: true });
    window.addEventListener('touchmove', this.onScroll, { passive: true });
    window.addEventListener('keydown', this.onKey, { passive: true });
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key)) this.onScroll();
  };

  setOptions(options: HighlightOptions) {
    this.options = options;
  }

  show(sentenceIndex: number) {
    if (!supported() || !this.maps.length) return;
    const sentence = this.doc.sentences[sentenceIndex];
    const map = sentence ? this.maps[sentence.blockId] : undefined;
    if (!sentence || !map) return;
    ensureStyle(this.options.highContrast);
    const range = rangeForSpan(map, sentence.start, sentence.end);
    if (this.options.sentence && range) CSS.highlights.set(SENTENCE, new Highlight(range));
    else CSS.highlights.delete(SENTENCE);
    const block = this.doc.blocks[sentence.blockId];
    const paragraphRange = block ? rangeForSpan(map, 0, block.text.length) : null;
    if (this.options.paragraph && paragraphRange) CSS.highlights.set(PARAGRAPH, new Highlight(paragraphRange));
    else CSS.highlights.delete(PARAGRAPH);
    if (range && this.options.autoScroll) this.scrollIntoView(range);
  }

  /** Scrolls only when the sentence is off-screen and the user has not scrolled in the last few seconds. */
  private scrollIntoView(range: Range) {
    if (Date.now() - this.userScrolledAt < 4000) return;
    const rect = range.getBoundingClientRect();
    if (!rect.height && !rect.width) return;
    const margin = window.innerHeight * 0.15;
    if (rect.top >= margin && rect.bottom <= window.innerHeight - margin) return;
    const element = range.startContainer.parentElement;
    if (!element) return;
    this.programmaticScroll = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    setTimeout(() => {
      this.programmaticScroll = false;
    }, 800);
  }

  clear() {
    if (!supported()) return;
    CSS.highlights.delete(SENTENCE);
    CSS.highlights.delete(PARAGRAPH);
  }

  dispose() {
    this.clear();
    window.removeEventListener('wheel', this.onScroll);
    window.removeEventListener('touchmove', this.onScroll);
    window.removeEventListener('keydown', this.onKey);
  }
}
