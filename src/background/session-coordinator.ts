/**
 * The global session coordinator. Exactly one reading session is active at a
 * time across all tabs.
 *
 * Policy: starting a new session replaces the current one (its tab's
 * highlights are cleared and synthesis is cancelled), unless the user set
 * "new reading joins the queue", in which case a request made while
 * something is playing is added to Listen Later instead.
 *
 * The active session (document, owning tab, position) is mirrored to
 * chrome.storage.session, so it survives service-worker suspension and can
 * be restored if Chrome closes the offscreen document.
 */
import { AppError } from '@/shared/errors';
import { emitToTab, request } from '@/shared/messages/bus';
import type { ControlAction, EngineConfig } from '@/shared/messages/contract';
import type { Settings } from '@/shared/settings';
import {
  addToQueue,
  getPlaybackState,
  getQueue,
  getSettings,
  recordDiagnostic,
  setPlaybackState,
  shiftQueue,
  updateSettings,
  upsertHistory,
  removeFromQueue,
} from '@/shared/storage';
import type { PlaybackState, ReadingDoc } from '@/shared/types';
import { createId } from '@/shared/utils/id';
import { ensureOffscreenDocument, hasOffscreenDocument } from './offscreen-manager';

interface ActiveSession {
  sessionId: string;
  tabId: number | null;
  doc: ReadingDoc;
  startedAt: number;
  sentenceIndex: number;
  queueItemId?: string;
}

const ACTIVE_KEY = 'activeSession';

export function engineConfig(settings: Settings): EngineConfig {
  return {
    engine: settings.engine,
    voice: settings.voice,
    browserVoice: settings.browserVoice,
    rate: settings.rate,
    volume: settings.volume,
    variantId: settings.variantId,
    backend: settings.backend,
    prefetchSentences: settings.prefetchSentences,
  };
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  const result = await chrome.storage.session.get(ACTIVE_KEY);
  return (result[ACTIVE_KEY] as ActiveSession | undefined) ?? null;
}

async function setActiveSession(session: ActiveSession | null) {
  if (session) await chrome.storage.session.set({ [ACTIVE_KEY]: session });
  else await chrome.storage.session.remove(ACTIVE_KEY);
}

async function loadInOffscreen(session: ActiveSession, startSentence: number) {
  await ensureOffscreenDocument();
  const settings = await getSettings();
  await request('offscreen/load', { sessionId: session.sessionId, doc: session.doc, startSentence, config: engineConfig(settings) });
}

export async function startSession(
  doc: ReadingDoc,
  tabId: number | null,
  startSentence = 0,
  options: { enqueue?: boolean; queueItemId?: string } = {},
): Promise<{ sessionId: string; queued: boolean }> {
  if (!doc.sentences.length) throw new AppError('E_EMPTY_TEXT');
  const settings = await getSettings();
  const current = await getPlaybackState();
  const busy = current && ['playing', 'buffering', 'preparing'].includes(current.status);
  if (options.enqueue || (settings.newSessionPolicy === 'queue' && busy && !options.queueItemId)) {
    await addToQueue({ id: createId(), title: doc.title, url: doc.url, siteName: doc.siteName, addedAt: Date.now(), doc, position: startSentence });
    return { sessionId: current?.sessionId ?? '', queued: true };
  }

  const previous = await getActiveSession();
  if (previous?.tabId != null && previous.tabId !== tabId) emitToTab(previous.tabId, 'content/clear', { sessionId: previous.sessionId });

  const session: ActiveSession = {
    sessionId: createId(),
    tabId,
    doc,
    startedAt: Date.now(),
    sentenceIndex: startSentence,
    queueItemId: options.queueItemId,
  };
  await setActiveSession(session);
  await loadInOffscreen(session, startSentence);
  return { sessionId: session.sessionId, queued: false };
}

/**
 * Forwards a control to the offscreen player. If Chrome closed the offscreen
 * document (or the service worker restarted and lost it), the session is
 * restored from storage at its last sentence first.
 */
export async function controlSession(action: ControlAction, index?: number, fromTabId?: number): Promise<void> {
  const active = await getActiveSession();
  if (!active) {
    // Nothing to control, but a player may still be showing (e.g. after a
    // service worker restart): make Close always dismiss it.
    if (action === 'stop' && fromTabId !== undefined) emitToTab(fromTabId, 'content/clear', { sessionId: null });
    return;
  }
  const alive = (await hasOffscreenDocument()) ? await request('offscreen/ping', {}).catch(() => null) : null;
  if (!alive || alive.sessionId !== active.sessionId) {
    if (action === 'stop' || action === 'pause') {
      if (action === 'stop') await endSession(active.sessionId);
      return;
    }
    const last = await getPlaybackState();
    const finished = last?.sessionId === active.sessionId && last.status === 'ended';
    const start =
      action === 'seek' && index !== undefined
        ? index
        : finished || action === 'restart'
          ? 0
          : action === 'next'
            ? active.sentenceIndex + 1
            : active.sentenceIndex;
    await loadInOffscreen(active, Math.min(start, active.doc.sentences.length - 1));
    return;
  }
  await request('offscreen/control', { sessionId: active.sessionId, action, index });
}

export async function setSessionOptions(patch: { rate?: number; volume?: number; voice?: string }): Promise<void> {
  const settings = await getSettings();
  const next: Partial<Settings> = {};
  if (patch.rate !== undefined) next.rate = patch.rate;
  if (patch.volume !== undefined) next.volume = patch.volume;
  if (patch.voice !== undefined) {
    if (settings.engine === 'browser') next.browserVoice = patch.voice;
    else {
      next.voice = patch.voice;
      next.recentVoices = [patch.voice, ...settings.recentVoices.filter((voice) => voice !== patch.voice)].slice(0, 6);
    }
  }
  await updateSettings(next);
  if (await hasOffscreenDocument()) await request('offscreen/set', patch).catch(() => undefined);
}

let lastHistoryWrite = 0;

/** Called for every playback state event from the offscreen document. */
export async function onPlaybackState(state: PlaybackState): Promise<void> {
  const active = await getActiveSession();
  const owned = active && state.sessionId === active.sessionId;
  const enriched: PlaybackState = { ...state, tabId: owned ? active.tabId : null };
  await setPlaybackState(enriched);
  if (!owned || !active) return;

  if (active.sentenceIndex !== state.sentenceIndex) {
    active.sentenceIndex = state.sentenceIndex;
    await setActiveSession(active);
  }
  if (active.tabId !== null) emitToTab(active.tabId, 'content/session', { state: enriched, ownsSession: true });

  const settings = await getSettings();
  const now = Date.now();
  const important = state.status === 'ended' || state.status === 'paused';
  if (settings.historyEnabled && active.doc.source !== 'custom' && (important || now - lastHistoryWrite > 5000)) {
    lastHistoryWrite = now;
    await upsertHistory({
      id: active.sessionId,
      title: active.doc.title,
      url: active.doc.url,
      siteName: active.doc.siteName,
      source: active.doc.source,
      startedAt: active.startedAt,
      lastPlayedAt: now,
      listenedSeconds: state.generatedSeconds,
      sentenceIndex: state.sentenceIndex,
      sentenceCount: state.sentenceCount,
      completed: state.status === 'ended',
    });
  }
}

async function endSession(sessionId: string) {
  const active = await getActiveSession();
  if (!active || active.sessionId !== sessionId) return;
  if (active.tabId !== null) emitToTab(active.tabId, 'content/clear', { sessionId });
  await setActiveSession(null);
}

/**
 * A session was stopped or reached its end. A stopped session is cleared. A
 * finished one stays the active session, so the player keeps working: Play
 * replays it and Close dismisses it. The Listen Later queue, if not empty,
 * continues instead.
 */
export async function onSessionEnded(sessionId: string, completed: boolean): Promise<void> {
  if (!completed) {
    await endSession(sessionId);
    return;
  }
  const active = await getActiveSession();
  if (active?.sessionId !== sessionId) return;
  if (active.queueItemId) await removeFromQueue(active.queueItemId);
  if ((await getQueue()).length) await playQueue();
}

export async function playQueue(itemId?: string): Promise<{ sessionId: string } | null> {
  const queue = await getQueue();
  const item = itemId ? queue.find((candidate) => candidate.id === itemId) : queue[0];
  if (!item) return null;
  if (!itemId) await shiftQueue();
  else await removeFromQueue(item.id);
  const { sessionId } = await startSession({ ...item.doc, source: 'queue' }, null, item.position, { queueItemId: undefined });
  return { sessionId };
}

export async function onTabRemoved(tabId: number): Promise<void> {
  const active = await getActiveSession();
  if (active?.tabId !== tabId) return;
  // Highlights and the in-page player died with the tab. Pages and
  // selections stop; documents that live in the extension keep playing.
  if (active.doc.source === 'page' || active.doc.source === 'selection') {
    await controlSession('stop');
    const state = await getPlaybackState();
    if (state) await setPlaybackState({ ...state, status: 'idle', error: new AppError('E_TAB_CLOSED').toInfo() });
  } else {
    await setActiveSession({ ...active, tabId: null });
  }
}

export async function recordFromOffscreen(kind: Parameters<typeof recordDiagnostic>[0]['kind'], data: Record<string, number | string | boolean | null>) {
  await recordDiagnostic({ at: Date.now(), kind, data });
}
