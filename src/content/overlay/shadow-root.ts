import { OVERLAY_CSS } from './styles';

/**
 * One closed Shadow DOM host for all injected UI. A closed root keeps page
 * scripts from reaching into the extension's controls, and the page's CSS
 * cannot leak in (nor ours out).
 */
export class OverlayRoot {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly container: HTMLDivElement;

  constructor() {
    this.host = document.createElement('kokoro-reader-root');
    this.host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.container = document.createElement('div');
    this.container.className = 'kr';
    this.root.append(style, this.container);
    (document.body ?? document.documentElement).append(this.host);
  }

  setTheme(dark: boolean, reduceMotion: boolean) {
    this.container.classList.toggle('dark', dark);
    this.container.classList.toggle('reduce-motion', reduceMotion);
  }

  contains(node: Node | null): boolean {
    return !!node && (node === this.host || this.host.contains(node));
  }

  destroy() {
    this.host.remove();
  }
}

/** Tiny element factory. Text is always set via textContent, never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'class') element.className = value;
    else element.setAttribute(key, value);
  }
  for (const child of children) element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return element;
}

/** Sets a trusted, constant SVG icon string. */
export function setIcon(element: Element, svg: string) {
  element.innerHTML = svg;
}
