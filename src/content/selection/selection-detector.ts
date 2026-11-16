import { countWords } from '@/shared/text/normalize';
import type { Settings } from '@/shared/settings';

export interface SelectionDetectorOptions {
  isOwnNode: (node: Node | null) => boolean;
  onSelection: (range: Range) => void;
  onClear: () => void;
}

/**
 * Event-driven selection detection. Mouse and touch selections are handled
 * on pointer release; keyboard selections (Shift+arrows, Cmd/Ctrl+A) through
 * a debounced selectionchange. Nothing polls and no DOM is queried until a
 * selection actually changes.
 */
export class SelectionDetector {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pointerDown = false;
  private lastText = '';

  constructor(
    private settings: Settings,
    private readonly options: SelectionDetectorOptions,
  ) {
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('pointerup', this.onPointerUp, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('selectionchange', this.onSelectionChange);
  }

  setSettings(settings: Settings) {
    this.settings = settings;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.options.isOwnNode(event.composedPath()[0] as Node)) return;
    this.pointerDown = true;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.options.isOwnNode(event.composedPath()[0] as Node)) return;
    this.pointerDown = false;
    this.schedule(this.settings.selectionDelayMs);
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.options.onClear();
      return;
    }
    if (event.shiftKey || event.key === 'a' || event.key === 'A') this.schedule(Math.max(250, this.settings.selectionDelayMs));
  };

  private readonly onSelectionChange = () => {
    if (this.pointerDown) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      this.lastText = '';
      clearTimeout(this.timer);
      this.options.onClear();
      return;
    }
    this.schedule(Math.max(400, this.settings.selectionDelayMs));
  };

  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.evaluate(), delay);
  }

  private evaluate() {
    if (!this.settings.floatingButton) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      this.options.onClear();
      return;
    }
    const range = selection.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const element = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    if (!element || this.options.isOwnNode(element) || element.closest('input, textarea, [data-kokoro-ignore]')) return;
    const text = selection.toString();
    if (countWords(text) < this.settings.minSelectionWords) {
      this.options.onClear();
      return;
    }
    if (text === this.lastText) return;
    this.lastText = text;
    this.options.onSelection(range);
  }

  reset() {
    this.lastText = '';
  }

  destroy() {
    clearTimeout(this.timer);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('pointerup', this.onPointerUp, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('selectionchange', this.onSelectionChange);
  }
}
