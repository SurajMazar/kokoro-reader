import { AppError } from '@/shared/errors';
import { request, requestTab } from '@/shared/messages/bus';
import type { ReadMode } from '@/shared/messages/contract';
import { buildDoc, textToBlocks } from '@/shared/text/doc';
import type { ReadingDoc } from '@/shared/types';
import { ensureOffscreenDocument } from './offscreen-manager';
import { startSession } from './session-coordinator';
import { ensureContentScript } from './tab-manager';

/** Reads from a tab: injects the content script if needed, builds the document there and starts a session. */
export async function readTab(tabId: number, mode: ReadMode, startSentence?: number): Promise<{ sessionId: string } | null> {
  if (mode === 'article') {
    await openReader(tabId, 'article');
    return null;
  }
  await ensureContentScript(tabId);
  const result = await requestTab(tabId, 'content/read', { mode, startSentence });
  const { sessionId } = await startSession(result.doc, tabId, result.startSentence);
  return { sessionId };
}

/** Plain-text fallback for pages the content script cannot run in (e.g. Chrome's PDF viewer). */
export async function readPlainSelection(text: string, title: string, url?: string): Promise<{ sessionId: string }> {
  const doc = buildDoc({ title, url, source: 'selection', blocks: textToBlocks(text) });
  if (!doc.sentences.length) throw new AppError('E_EMPTY_TEXT');
  const { sessionId } = await startSession(doc, null, 0);
  return { sessionId };
}

/** Extracts a document from a tab without starting playback (Listen Later, Smart Reader). */
export async function extractFromTab(tabId: number, mode: 'article' | 'page'): Promise<ReadingDoc> {
  await ensureContentScript(tabId);
  if (mode === 'page') return (await requestTab(tabId, 'content/read', { mode: 'page' })).doc;
  const snapshot = await requestTab(tabId, 'content/snapshot', {});
  await ensureOffscreenDocument();
  const doc = await request('offscreen/parse-article', { snapshot });
  if (!doc.sentences.length) throw new AppError('E_EXTRACTION');
  return doc;
}

/** Opens the Smart Reader for a tab (or the custom-text reader), passing the article via session storage. */
export async function openReader(tabId: number | undefined, mode: 'article' | 'custom' = 'article'): Promise<void> {
  if (mode === 'custom' || tabId === undefined) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('reader/index.html?mode=custom') });
    return;
  }
  await ensureContentScript(tabId);
  const snapshot = await requestTab(tabId, 'content/snapshot', {});
  const key = `reader:${crypto.randomUUID()}`;
  await chrome.storage.session.set({ [key]: { snapshot, sourceTabId: tabId, createdAt: Date.now() } });
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`reader/index.html?snapshot=${encodeURIComponent(key)}`),
    index: tab ? tab.index + 1 : undefined,
    windowId: tab?.windowId,
  });
}

/** Opens a URL in a new tab and resolves once it has finished loading (or after a timeout). */
export async function openAndWait(url: string, timeoutMs = 20_000): Promise<number> {
  const tab = await chrome.tabs.create({ url });
  const tabId = tab.id!;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedId: number, info: { status?: string }) {
      if (updatedId === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
  return tabId;
}
