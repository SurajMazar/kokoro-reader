import type { Settings } from '@/shared/settings';
import { icon } from './icons';
import { h, setIcon, type OverlayRoot } from './shadow-root';
import { placeNearRange } from './position';

export interface SelectionActions {
  listen: (range: Range) => void;
  listenFromHere: (range: Range) => void;
  addToQueue: (range: Range) => void;
}

/**
 * The speaker button that appears next to a text selection. It keeps a
 * clone of the selected Range, so clicking it reads exactly what was
 * selected even if the page changes the selection on mousedown.
 */
export class FloatingButton {
  private element: HTMLDivElement | null = null;
  private range: Range | null = null;
  private expanded = false;
  private frame = 0;

  constructor(
    private readonly overlay: OverlayRoot,
    private readonly actions: SelectionActions,
    private settings: Settings,
  ) {
    window.addEventListener('scroll', this.reposition, { passive: true, capture: true });
    window.addEventListener('resize', this.reposition, { passive: true });
  }

  setSettings(settings: Settings) {
    this.settings = settings;
  }

  get visible() {
    return this.element !== null;
  }

  show(range: Range) {
    this.range = range.cloneRange();
    this.expanded = this.settings.selectionStyle === 'toolbar';
    this.render();
    this.reposition();
  }

  hide() {
    this.element?.remove();
    this.element = null;
    this.range = null;
  }

  private render() {
    this.element?.remove();
    const wrapper = h('div', { class: 'selection-button glass', role: 'toolbar', 'aria-label': 'Kokoro Reader' });
    // Keep the page selection intact when the button is pressed.
    wrapper.addEventListener('mousedown', (event) => event.preventDefault());
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.hide();
    });

    if (!this.expanded) {
      const button = h('button', { class: 'round', type: 'button', 'aria-label': 'Listen to selection', title: 'Listen with Kokoro' });
      setIcon(button, icon('speaker', 18));
      button.addEventListener('click', () => {
        if (!this.range) return;
        if (this.settings.autoPlayOnClick) {
          this.actions.listen(this.range);
          this.hide();
        } else {
          this.expanded = true;
          this.render();
          this.reposition();
          this.element?.querySelector<HTMLButtonElement>('button')?.focus();
        }
      });
      wrapper.append(button);
    } else {
      const listen = h('button', { class: 'label primary', type: 'button', 'aria-label': 'Listen to selection' });
      setIcon(listen, icon('speaker', 16));
      listen.append('Listen');
      listen.addEventListener('click', () => {
        if (this.range) this.actions.listen(this.range);
        this.hide();
      });
      const fromHere = h('button', { class: 'round', type: 'button', 'aria-label': 'Read the page from here', title: 'Read page from here' });
      setIcon(fromHere, icon('bookOpen', 16));
      fromHere.addEventListener('click', () => {
        if (this.range) this.actions.listenFromHere(this.range);
        this.hide();
      });
      const queue = h('button', { class: 'round', type: 'button', 'aria-label': 'Add selection to Listen Later', title: 'Add to Listen Later' });
      setIcon(queue, icon('listPlus', 16));
      queue.addEventListener('click', () => {
        if (this.range) this.actions.addToQueue(this.range);
        this.hide();
      });
      wrapper.append(listen, h('span', { class: 'divider', 'aria-hidden': 'true' }), fromHere, queue);
    }
    this.overlay.container.append(wrapper);
    this.element = wrapper;
  }

  private readonly reposition = () => {
    if (!this.element || !this.range) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.element || !this.range) return;
      const size = { width: this.element.offsetWidth || 38, height: this.element.offsetHeight || 38 };
      const position = placeNearRange(this.range, size);
      if (!position) {
        this.element.style.visibility = 'hidden';
        return;
      }
      this.element.style.visibility = 'visible';
      this.element.style.left = `${position.left}px`;
      this.element.style.top = `${position.top}px`;
    });
  };

  destroy() {
    this.hide();
    window.removeEventListener('scroll', this.reposition, { capture: true });
    window.removeEventListener('resize', this.reposition);
  }
}
