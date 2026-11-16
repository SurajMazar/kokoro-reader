import { AppError } from '@/shared/errors';
import { requestTab } from '@/shared/messages/bus';

const RESTRICTED = [/^chrome:/, /^chrome-extension:/, /^edge:/, /^about:/, /^devtools:/, /^view-source:/, /^https:\/\/chromewebstore\.google\.com/, /^https:\/\/chrome\.google\.com\/webstore/];

export function isRestrictedUrl(url: string | undefined): boolean {
  return !!url && RESTRICTED.some((pattern) => pattern.test(url));
}

/**
 * Makes sure the content script is running in the tab's top frame,
 * injecting it on demand (allowed by activeTab after a user gesture, or by
 * the optional all-sites permission).
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await requestTab(tabId, 'content/ping', {});
    return;
  } catch {
    // Not injected yet.
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new AppError('E_TAB_CLOSED');
  if (isRestrictedUrl(tab.url)) throw new AppError('E_UNSUPPORTED_PAGE', tab.url);
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content.js'] });
  } catch (error) {
    const message = String(error);
    if (/cannot access|cannot be scripted|permission/i.test(message)) {
      throw new AppError(isRestrictedUrl(tab.url) ? 'E_UNSUPPORTED_PAGE' : 'E_PERMISSION', message);
    }
    throw new AppError('E_UNSUPPORTED_PAGE', message);
  }
  await requestTab(tabId, 'content/ping', {});
}

export async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}
