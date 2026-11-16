/** Styles for the Shadow DOM overlay. Isolated from the page in both directions. */
export const OVERLAY_CSS = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
.kr {
  --bg: rgba(255, 255, 255, 0.82);
  --bg-solid: #ffffff;
  --fg: #1d1d1f;
  --muted: #6e6e73;
  --border: rgba(0, 0, 0, 0.08);
  --hover: rgba(0, 0, 0, 0.05);
  --accent: #6e56cf;
  --accent-fg: #ffffff;
  --track: rgba(0, 0, 0, 0.1);
  --danger: #d93036;
  --shadow: 0 1px 1px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.12), 0 24px 48px rgba(0,0,0,.08);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, Roboto, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
.kr.dark {
  --bg: rgba(36, 36, 40, 0.82);
  --bg-solid: #242428;
  --fg: #f5f5f7;
  --muted: #a1a1a6;
  --border: rgba(255, 255, 255, 0.1);
  --hover: rgba(255, 255, 255, 0.08);
  --accent: #9e8cfc;
  --accent-fg: #17151f;
  --track: rgba(255, 255, 255, 0.16);
  --danger: #ff6369;
  --shadow: 0 1px 1px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.45), 0 24px 48px rgba(0,0,0,.3);
}
button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.glass {
  background: var(--bg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border: 0.5px solid var(--border);
  box-shadow: var(--shadow);
}

/* Floating speaker button / toolbar */
.selection-button {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  animation: pop-in 160ms cubic-bezier(.2,.9,.3,1.2);
}
.selection-button .round {
  width: 32px; height: 32px; border-radius: 999px;
  display: grid; place-items: center;
  color: var(--accent);
  transition: background 120ms ease, transform 120ms ease;
}
.selection-button .round:hover { background: var(--hover); }
.selection-button .round:active { transform: scale(.94); }
.selection-button .primary { background: var(--accent); color: var(--accent-fg); }
.selection-button .primary:hover { background: var(--accent); filter: brightness(1.08); }
.selection-button .label { padding: 0 10px 0 8px; height: 32px; display: flex; align-items: center; gap: 6px; border-radius: 999px; font-weight: 600; font-size: 12.5px; }
.selection-button .label:hover { background: var(--hover); }
.selection-button .divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }
@keyframes pop-in { from { opacity: 0; transform: translateY(4px) scale(.9); } to { opacity: 1; transform: none; } }

/* Player */
.player {
  position: fixed;
  z-index: 2147483646;
  width: 360px;
  max-width: calc(100vw - 24px);
  border-radius: 16px;
  padding: 12px 14px 12px;
  animation: slide-in 220ms cubic-bezier(.2,.8,.2,1);
}
.player.bottom-right { right: 16px; bottom: 16px; }
.player.bottom-left { left: 16px; bottom: 16px; }
.player.top-right { right: 16px; top: 16px; }
.player.top-left { left: 16px; top: 16px; }
.player.expanded { width: 420px; }
.player.minimized { width: auto; padding: 6px; border-radius: 999px; display: flex; align-items: center; gap: 4px; }
@keyframes slide-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

.header { display: flex; align-items: center; gap: 10px; }
.badge { width: 30px; height: 30px; flex: none; border-radius: 9px; display: grid; place-items: center; background: linear-gradient(135deg, #8b7bff, #6e56cf); color: #fff; }
.titles { min-width: 0; flex: 1; }
.title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subtitle { color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-button { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--muted); transition: background 120ms ease, color 120ms ease; }
.icon-button:hover { background: var(--hover); color: var(--fg); }
.icon-button:disabled { opacity: .35; cursor: default; }
.icon-button:disabled:hover { background: none; }

.sentence {
  margin: 10px 0 8px;
  font-size: 13.5px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.9em;
}
.expanded .sentence { -webkit-line-clamp: 4; min-height: 5.8em; }
.status-line { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11.5px; margin: 8px 0; }
.status-line.error { color: var(--danger); }
.spin { animation: spin 900ms linear infinite; display: inline-grid; }
@keyframes spin { to { transform: rotate(360deg); } }

.progress { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
input[type=range] { -webkit-appearance: none; appearance: none; flex: 1; height: 4px; border-radius: 4px; background: var(--track); cursor: pointer; margin: 0; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--bg-solid); }

.controls { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.transport { display: flex; align-items: center; gap: 2px; }
.play {
  width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center;
  background: var(--accent); color: var(--accent-fg); margin: 0 4px;
  transition: transform 120ms ease, filter 120ms ease;
}
.play:hover { filter: brightness(1.08); }
.play:active { transform: scale(.95); }
.minimized .play { width: 32px; height: 32px; margin: 0; }
.pill { height: 28px; padding: 0 10px; border-radius: 999px; background: var(--hover); font-weight: 600; font-size: 12px; font-variant-numeric: tabular-nums; }
.pill:hover { filter: brightness(.96); }
.extras { display: grid; grid-template-columns: auto 1fr; gap: 8px 10px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 0.5px solid var(--border); font-size: 12px; color: var(--muted); }
select {
  font: inherit; color: var(--fg); background: var(--hover); border: 0.5px solid var(--border); border-radius: 8px;
  padding: 4px 8px; width: 100%; cursor: pointer;
}
.recover { margin-left: auto; color: var(--accent); font-weight: 600; font-size: 12px; }
.speed-menu { position: absolute; bottom: 52px; right: 12px; border-radius: 12px; padding: 4px; display: grid; gap: 1px; }
.speed-menu button { padding: 5px 14px; border-radius: 8px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12.5px; }
.speed-menu button:hover, .speed-menu button[aria-checked="true"] { background: var(--hover); }
.speed-menu button[aria-checked="true"] { color: var(--accent); font-weight: 700; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .selection-button, .player { animation: none; }
  .spin { animation-duration: 2s; }
}
.reduce-motion .selection-button, .reduce-motion.player, .reduce-motion .player { animation: none; }
`;
