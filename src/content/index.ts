/**
 * Content script. Runs in the page's isolated world: page scripts cannot see
 * its variables or the extension APIs it uses. It stays dormant until the
 * user selects text or a reading starts in this tab.
 */
import { AppError } from '@/shared/errors';
import { listen, request } from '@/shared/messages/bus';
import type { PageInfo } from '@/shared/messages/contract';
import { getSettings, onSettingsChanged } from '@/shared/storage';
import { countWords } from '@/shared/text/normalize';
import type { Settings } from '@/shared/settings';
import type { PlaybackState } from '@/shared/types';
import { pageTitle, readPage, readRange, readSelection, sentenceAtSelection, siteName, snapshotPage, type LiveDoc } from './extraction/page-reader';
import { SentenceHighlighter } from './highlighting/sentence-highlighter';
import { FloatingButton } from './overlay/floating-button';
import { FloatingPlayer } from './overlay/floating-player';
import { OverlayRoot } from './overlay/shadow-root';
import { SelectionDetector } from './selection/selection-detector';

declare global {
  interface Window {
    __kokoroReader?: boolean;
  }
}

function boot() {
  if (window.__kokoroReader || window.top !== window) return;
  window.__kokoroReader = true;

  let settings: Settings | null = null;
  let overlay: OverlayRoot | null = null;
  let button: FloatingButton | null = null;
  let player: FloatingPlayer | null = null;
  let detector: SelectionDetector | null = null;
  /** Documents built in this tab, by doc id, so highlights can follow the session. */
  const liveDocs = new Map<string, LiveDoc>();
  let highlighter: { docId: string; instance: SentenceHighlighter } | null = null;
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function applyTheme() {
    if (!overlay || !settings) return;
    const isDark = settings.theme === 'dark' || (settings.theme === 'system' && dark.matches);
    overlay.setTheme(isDark, settings.reduceMotion === 'always' || reducedMotion.matches);
  }

  function ensureOverlay(): OverlayRoot {
    if (!overlay || !overlay.host.isConnected) {
      overlay = new OverlayRoot();
      applyTheme();
    }
    return overlay;
  }

  function ensurePlayer(): FloatingPlayer {
    player ??= new FloatingPlayer(ensureOverlay(), settings!);
    return player;
  }

  function highlightOptions() {
    return {
      sentence: settings!.highlightSentence,
      paragraph: settings!.highlightParagraph,
      autoScroll: settings!.autoScroll,
      highContrast: settings!.highContrastHighlight,
    };
  }

  function remember(live: LiveDoc) {
    liveDocs.set(live.doc.id, live);
    // Keep only the most recent few documents' text maps.
    while (liveDocs.size > 4) liveDocs.delete(liveDocs.keys().next().value!);
  }

  async function start(live: LiveDoc | null, startSentence = 0) {
    try {
      if (!live) throw new AppError('E_EMPTY_TEXT');
      remember(live);
      ensurePlayer().update({ ...emptyState(), title: live.doc.title, status: 'preparing', sentenceCount: live.doc.sentences.length, sentenceText: live.doc.sentences[startSentence]?.text ?? '' });
      const result = await request('session/start', { doc: live.doc, startSentence });
      if (result.queued) ensurePlayer().hide();
    } catch (error) {
      const info = error instanceof AppError ? error.toInfo() : new AppError('E_UNKNOWN', String(error)).toInfo();
      ensurePlayer().update({ ...emptyState(), status: 'error', error: info });
    }
  }

  function emptyState(): PlaybackState {
    return {
      sessionId: null,
      docId: null,
      title: pageTitle(),
      tabId: null,
      status: 'idle',
      sentenceIndex: 0,
      sentenceCount: 0,
      sentenceText: '',
      blockId: null,
      engine: settings?.engine ?? 'kokoro',
      voice: settings?.voice ?? 'af_heart',
      rate: settings?.rate ?? 1,
      volume: settings?.volume ?? 1,
      generatedSeconds: 0,
      estimatedRemainingSeconds: 0,
      error: null,
      updatedAt: Date.now(),
    };
  }

  /** After a reload or navigation back to the same page, rebuild the text map so highlighting resumes. */
  function reattach(state: PlaybackState): LiveDoc | null {
    if (state.source !== 'page' || !state.url || state.url !== location.href) return null;
    try {
      const live = readPage();
      if (live.doc.sentences.length !== state.sentenceCount) return null;
      live.doc.id = state.docId!;
      remember(live);
      return live;
    } catch {
      return null;
    }
  }

  function onSession(state: PlaybackState) {
    ensurePlayer().update(state);
    if (!state.docId || state.status === 'idle') return;
    if (highlighter?.docId !== state.docId) {
      highlighter?.instance.dispose();
      highlighter = null;
      const live = liveDocs.get(state.docId) ?? reattach(state);
      if (live) highlighter = { docId: state.docId, instance: new SentenceHighlighter(live.doc, live.maps, highlightOptions()) };
    }
    if (highlighter && (state.status === 'playing' || state.status === 'paused' || state.status === 'buffering')) {
      highlighter.instance.show(state.sentenceIndex);
    }
  }

  function clearSession() {
    player?.hide();
    highlighter?.instance.dispose();
    highlighter = null;
  }

  listen({
    targets: ['content'],
    requests: {
      'content/ping': () => ({ alive: true }),
      'content/info': (): PageInfo => {
        const selection = window.getSelection()?.toString() ?? '';
        return {
          title: pageTitle(),
          url: location.href,
          siteName: siteName(),
          hasSelection: selection.trim().length > 0,
          selectionWords: countWords(selection),
          language: document.documentElement.lang || '',
        };
      },
      'content/read': ({ mode, startSentence }) => {
        let live: LiveDoc | null;
        let start = startSentence ?? 0;
        if (mode === 'selection') {
          live = readSelection();
          if (!live) throw new AppError('E_EMPTY_TEXT');
        } else {
          live = readPage();
          if (mode === 'from-selection' && startSentence === undefined) start = sentenceAtSelection(live);
        }
        remember(live);
        ensurePlayer().update({ ...emptyState(), title: live.doc.title, status: 'preparing', sentenceCount: live.doc.sentences.length });
        return { doc: live.doc, startSentence: Math.min(start, live.doc.sentences.length - 1) };
      },
      'content/snapshot': () => snapshotPage(),
    },
    events: {
      'content/session': ({ state }) => onSession(state),
      'content/clear': () => clearSession(),
      'content/model': (model) => player?.setModel(model),
    },
  });

  void getSettings().then((loaded) => {
    settings = loaded;
    detector = new SelectionDetector(loaded, {
      isOwnNode: (node) => !!overlay?.contains(node),
      onSelection: (range) => {
        button ??= new FloatingButton(ensureOverlay(), {
          listen: (selected) => void start(readRange(selected)),
          listenFromHere: (selected) => {
            try {
              const live = readPage();
              void start(live, sentenceAtSelection(live, selected));
            } catch (error) {
              void start(null);
              console.warn('[kokoro]', error);
            }
          },
          addToQueue: (selected) => {
            const live = readRange(selected);
            if (live) void request('session/start', { doc: live.doc, enqueue: true });
          },
        }, loaded);
        button.show(range);
      },
      onClear: () => button?.hide(),
    });
    // If this tab already owns the active session (e.g. after a reload), show its player.
    void request('session/state', {})
      .then((state) => {
        if (state.sessionId && state.status !== 'idle' && state.url === location.href) onSession(state);
      })
      .catch(() => undefined);
  });

  onSettingsChanged((next) => {
    settings = next;
    detector?.setSettings(next);
    button?.setSettings(next);
    player?.setSettings(next);
    highlighter?.instance.setOptions(highlightOptions());
    if (!next.floatingButton) button?.hide();
    if (!next.highlightSentence && !next.highlightParagraph) highlighter?.instance.clear();
    applyTheme();
  });
  dark.addEventListener('change', applyTheme);
}

boot();
