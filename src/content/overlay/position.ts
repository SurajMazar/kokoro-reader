const GAP = 8;
const EDGE = 8;

export interface Size {
  width: number;
  height: number;
}

/**
 * Viewport position for a small button next to the end of a selection:
 * below the last line, aligned to its trailing edge (left edge for RTL text),
 * flipped above the first line near the bottom of the screen and clamped to
 * the viewport. Returns null when the selection has scrolled out of view.
 */
export function placeNearRange(range: Range, size: Size, viewport = { width: window.innerWidth, height: window.innerHeight }): { left: number; top: number } | null {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  if (!rects.length) {
    const box = range.getBoundingClientRect();
    if (!box.width && !box.height) return null;
    rects.push(box);
  }
  const first = rects[0]!;
  const last = rects[rects.length - 1]!;
  if (last.bottom < 0 || first.top > viewport.height) return null;

  const container = range.endContainer.nodeType === Node.ELEMENT_NODE ? (range.endContainer as Element) : range.endContainer.parentElement;
  const rtl = container ? getComputedStyle(container).direction === 'rtl' : false;

  let left = rtl ? last.left - size.width : last.right - size.width / 2;
  let top = last.bottom + GAP;
  if (top + size.height > viewport.height - EDGE) top = first.top - size.height - GAP;
  left = Math.min(Math.max(EDGE, left), viewport.width - size.width - EDGE);
  top = Math.min(Math.max(EDGE, top), viewport.height - size.height - EDGE);
  return { left: Math.round(left), top: Math.round(top) };
}
