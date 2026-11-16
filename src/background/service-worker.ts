/**
 * Background service worker: message router, context menus, keyboard
 * commands and lifecycle. It holds no long-lived state in memory, because
 * Chrome suspends it when idle; state lives in chrome.storage and in the
 * offscreen document.
 */
import { KOKORO_VOICES } from '@/engine/kokoro/voices';
import { emitToTab, listen, request, requestTab } from '@/shared/messages/bus';
import { AppError, toErrorInfo } from '@/shared/errors';
import {
  addToQueue,
  getHistory,
  getPlaybackState,
  getSettings,
  getStoredModelState,
  onSettingsChanged,
  saveBookmark,
  setStoredModelState,
} from '@/shared/storage';
import type { Bookmark, ModelState, PlaybackState } from '@/shared/types';
import { createId } from '@/shared/utils/id';
import { closeOffscreenDocument, ensureOffscreenDocument, hasOffscreenDocument } from './offscreen-manager';
import { syncContentScriptRegistration } from './permissions';
import { extractFromTab, openAndWait, openReader, readPlainSelection, readTab } from './reading';
import {
  controlSession,
  engineConfig,
  getActiveSession,
  onPlaybackState,
  onSessionEnded,
  onTabRemoved,
  playQueue,
  recordFromOffscreen,
  setSessionOptions,
  startSession,
} from './session-coordinator';
import { activeTabId, ensureContentScript } from './tab-manager';

const PREVIEW_TEXT = 'Hello! This is how I sound when I read the web to you.';

const IDLE_STATE: PlaybackState = {
  sessionId: null,
  docId: null,
  title: '',
  tabId: null,
  status: 'idle',
  sentenceIndex: 0,
  sentenceCount: 0,
  sentenceText: '',
  blockId: null,
  engine: 'kokoro',
  voice: '',
  rate: 1,
  volume: 1,
  generatedSeconds: 0,
  estimatedRemainingSeconds: 0,
  error: null,
  updatedAt: 0,
};

async function modelState(): Promise<ModelState> {
  const settings = await getSettings();
  if (await hasOffscreenDocument()) {
    const state = await request('offscreen/model-state', { variantId: settings.variantId });
    await setStoredModelState(state);
    return state;
  }
  // Without the offscreen document the model is not loaded; report what was last known.
  const stored = await getStoredModelState();
  const same = stored?.variantId === settings.variantId;
  const last = same ? stored!.status : 'not-downloaded';
  const status: ModelState['status'] =
    last === 'ready' || last === 'downloaded' || last === 'initializing'
      ? 'downloaded'
      : last === 'downloading' || last === 'paused'
        ? 'paused'
        : last === 'error'
          ? 'error'
          : 'not-downloaded';
  return {
    variantId: settings.variantId,
    status,
    progress: stored?.progress ?? null,
    activeBackend: null,
    crossOriginIsolated: stored?.crossOriginIsolated ?? null,
    threads: null,
    cachedBytes: stored?.cachedBytes ?? 0,
    lastUsed: stored?.lastUsed ?? null,
    initMs: stored?.initMs ?? null,
    error: status === 'error' ? (stored?.error ?? null) : null,
  };
}

listen({
  targets: ['background'],
  restrictContentScripts: true,
  requests: {
    'session/start': async ({ doc, tabId, startSentence, enqueue }, sender) =>
      startSession(doc, sender.tab?.id ?? tabId ?? null, startSentence ?? 0, { enqueue }),
    'session/control': async ({ action, index }) => {
      await controlSession(action, index);
      return null;
    },
    'session/set': async (patch) => {
      await setSessionOptions(patch);
      return null;
    },
    'session/state': async () => (await getPlaybackState()) ?? IDLE_STATE,
    'session/play-queue': ({ itemId }) => playQueue(itemId),
    'tab/read': ({ tabId, mode, startSentence }) => readTab(tabId, mode, startSentence),
    'tab/info': async ({ tabId }) => {
      try {
        await ensureContentScript(tabId);
        return await requestTab(tabId, 'content/info', {});
      } catch {
        return null;
      }
    },
    'tab/extract': ({ tabId, mode }) => extractFromTab(tabId, mode),
    'reader/open': async ({ tabId, mode }) => {
      await openReader(tabId, mode ?? 'article');
      return null;
    },
    'model/get': () => modelState(),
    'model/action': async ({ action, variantId }) => {
      const settings = await getSettings();
      await ensureOffscreenDocument();
      const state = await request('offscreen/model', { action, variantId: variantId ?? settings.variantId, backend: settings.backend });
      await setStoredModelState(state);
      return state;
    },
    'voices/list': async () => {
      const settings = await getSettings();
      if (settings.engine === 'kokoro') return [...KOKORO_VOICES];
      await ensureOffscreenDocument();
      return request('offscreen/browser-voices', {});
    },
    'voices/preview': async ({ voice, engine, text }) => {
      const settings = await getSettings();
      await ensureOffscreenDocument();
      await request('offscreen/preview', {
        voice,
        engine: engine ?? settings.engine,
        text: text ?? PREVIEW_TEXT,
        config: engineConfig({ ...settings, engine: engine ?? settings.engine }),
      });
      return null;
    },
    'export/wav': async ({ doc, voice, speed }) => {
      const settings = await getSettings();
      await ensureOffscreenDocument();
      return request('offscreen/export', { doc, voice: voice ?? settings.voice, speed: speed ?? 1, config: engineConfig(settings) });
    },
    'permissions/sync': async () => syncContentScriptRegistration((await getSettings()).floatingButton),
    'session/doc': async () => (await getActiveSession())?.doc ?? null,
    'diagnostics/metrics': async () => ((await hasOffscreenDocument()) ? request('offscreen/metrics', {}) : null),
    'bookmark/add': async ({ name }) => {
      const active = await getActiveSession();
      const state = await getPlaybackState();
      if (!active || !state) throw new AppError('E_EMPTY_TEXT', 'Nothing is playing');
      const sentence = active.doc.sentences[state.sentenceIndex];
      const bookmark: Bookmark = {
        id: createId(),
        name: name?.trim() || `${active.doc.title} — ${state.sentenceIndex + 1}/${state.sentenceCount}`,
        title: active.doc.title,
        url: active.doc.url,
        source: active.doc.source,
        sentenceIndex: state.sentenceIndex,
        sentenceCount: state.sentenceCount,
        snippet: (sentence?.text ?? '').slice(0, 140),
        createdAt: Date.now(),
        // Saving a bookmark is an explicit request to keep this text locally.
        doc: active.doc,
      };
      await saveBookmark(bookmark);
      return bookmark;
    },
    'history/resume': async ({ id }) => {
      const entry = (await getHistory()).find((item) => item.id === id);
      if (!entry?.url) throw new AppError('E_EXTRACTION', 'This history entry has no page to return to');
      const tabId = await openAndWait(entry.url);
      if (entry.source === 'article') await openReader(tabId, 'article');
      else await readTab(tabId, 'page', entry.source === 'page' ? entry.sentenceIndex : 0);
      return null;
    },
    'ui/open-options': async ({ section }) => {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options/index.html${section ? `#${section}` : ''}`) });
      return null;
    },
  },
  events: {
    'playback/state': (state) => void onPlaybackState(state),
    'model/state': (state) => {
      void setStoredModelState(state);
      void getActiveSession().then((active) => {
        if (active?.tabId != null) emitToTab(active.tabId, 'content/model', state);
      });
    },
    'session/ended': ({ sessionId, completed }) => void onSessionEnded(sessionId, completed),
    'offscreen/diagnostic': ({ kind, data }) => void recordFromOffscreen(kind, data),
    'offscreen/idle': ({ idleMs }) => {
      void (async () => {
        const settings = await getSettings();
        const state = await getPlaybackState();
        if (idleMs < settings.idleUnloadMinutes * 60_000) return;
        if (state && ['playing', 'buffering', 'preparing'].includes(state.status)) return;
        // Frees the model's memory. A paused session is restored from storage on resume.
        await closeOffscreenDocument();
      })();
    },
  },
});

// ------------------------------------------------------------ context menu

const MENU = {
  readSelection: 'kokoro-read-selection',
  readFromHere: 'kokoro-read-from-here',
  readPage: 'kokoro-read-page',
  openReader: 'kokoro-open-reader',
  addToQueue: 'kokoro-add-queue',
  stop: 'kokoro-stop',
} as const;

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.readSelection, title: 'Read with Kokoro', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU.readFromHere, title: 'Read page from here', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU.readPage, title: 'Read entire page with Kokoro', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU.openReader, title: 'Open in Smart Reader', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU.addToQueue, title: 'Add page to Listen Later', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU.stop, title: 'Stop reading', contexts: ['all'], visible: false });
  });
}

async function updateStopMenu(state: PlaybackState | null) {
  const visible = !!state && ['playing', 'paused', 'buffering', 'preparing'].includes(state.status);
  chrome.contextMenus.update(MENU.stop, { visible }, () => void chrome.runtime.lastError);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.playback) {
    const state = changes.playback.newValue as PlaybackState | undefined;
    void updateStopMenu(state ?? null);
    updateBadge(state ?? null);
  }
});

function updateBadge(state: PlaybackState | null) {
  const text = state?.status === 'playing' ? '▶' : state?.status === 'paused' ? 'Ⅱ' : state?.status === 'buffering' || state?.status === 'preparing' ? '…' : '';
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color: '#6E56CF' });
}

async function reportToTab(tabId: number | undefined, error: unknown) {
  console.warn('[kokoro]', error);
  const info = toErrorInfo(error);
  const state = (await getPlaybackState()) ?? IDLE_STATE;
  if (tabId !== undefined) {
    // Surface the error in the in-page player when the content script is available.
    chrome.tabs
      .sendMessage(tabId, { kr: 1, type: 'content/session', target: 'content', requestId: createId(), payload: { state: { ...state, status: 'error', error: info }, ownsSession: true } }, { frameId: 0 })
      .catch(() => undefined);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  void (async () => {
    try {
      switch (info.menuItemId) {
        case MENU.readSelection:
          if (tabId === undefined) throw new Error('No tab');
          try {
            await readTab(tabId, 'selection');
          } catch (error) {
            // Pages that cannot be scripted (PDF viewer, other extensions) still provide the selected text.
            if (!info.selectionText) throw error;
            await readPlainSelection(info.selectionText, tab?.title ?? 'Selection', tab?.url);
          }
          break;
        case MENU.readFromHere:
          if (tabId !== undefined) await readTab(tabId, 'from-selection');
          break;
        case MENU.readPage:
          if (tabId !== undefined) await readTab(tabId, 'page');
          break;
        case MENU.openReader:
          if (tabId !== undefined) await openReader(tabId, 'article');
          break;
        case MENU.addToQueue:
          if (tabId !== undefined) {
            const doc = await extractFromTab(tabId, 'article');
            await addToQueue({ id: createId(), title: doc.title, url: doc.url, siteName: doc.siteName, addedAt: Date.now(), doc, position: 0 });
          }
          break;
        case MENU.stop:
          await controlSession('stop');
          break;
      }
    } catch (error) {
      await reportToTab(tabId, error);
    }
  })();
});

// -------------------------------------------------------------- commands

chrome.commands.onCommand.addListener((command, tab) => {
  void (async () => {
    const tabId = tab?.id ?? (await activeTabId());
    try {
      switch (command) {
        case 'read-selection':
          if (tabId !== undefined) await readTab(tabId, 'selection');
          break;
        case 'read-page':
          if (tabId !== undefined) await readTab(tabId, 'page');
          break;
        case 'toggle-playback': {
          const active = await getActiveSession();
          if (active) await controlSession('toggle');
          else if (tabId !== undefined) await readTab(tabId, 'selection').catch(() => readTab(tabId, 'page'));
          break;
        }
        case 'stop-reading':
          await controlSession('stop');
          break;
        case 'next-sentence':
          await controlSession('next');
          break;
        case 'previous-sentence':
          await controlSession('previous');
          break;
        case 'open-reader':
          if (tabId !== undefined) await openReader(tabId, 'article');
          break;
      }
    } catch (error) {
      await reportToTab(tabId, error);
    }
  })();
});

// ------------------------------------------------------------- lifecycle

chrome.tabs.onRemoved.addListener((tabId) => void onTabRemoved(tabId));

chrome.permissions.onAdded.addListener(() => void getSettings().then((settings) => syncContentScriptRegistration(settings.floatingButton)));
chrome.permissions.onRemoved.addListener(() => void getSettings().then((settings) => syncContentScriptRegistration(settings.floatingButton)));
onSettingsChanged((settings) => void syncContentScriptRegistration(settings.floatingButton));

chrome.runtime.onInstalled.addListener((details) => {
  createMenus();
  void (async () => {
    const settings = await getSettings();
    await syncContentScriptRegistration(settings.floatingButton);
    if (details.reason === 'install') {
      if (!__KOKORO_E2E__) await chrome.tabs.create({ url: chrome.runtime.getURL('welcome/index.html') });
      if (settings.downloadModelOnInstall) {
        await ensureOffscreenDocument();
        await request('offscreen/model', { action: 'download', variantId: settings.variantId, backend: settings.backend });
      }
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  createMenus();
  void getSettings().then((settings) => syncContentScriptRegistration(settings.floatingButton));
});

void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);
