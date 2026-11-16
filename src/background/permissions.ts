/**
 * The floating speaker button needs the content script on every page, which
 * needs host access to all sites. That access is optional: it is requested
 * from the welcome page or settings, and the content script is registered
 * only while it is granted. Without it, the context menu, shortcuts and
 * popup still work everywhere through activeTab.
 */
const SCRIPT_ID = 'kokoro-selection';
const ALL_SITES = { origins: ['<all_urls>'] };

export async function hasAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.contains(ALL_SITES);
}

export async function syncContentScriptRegistration(floatingButtonEnabled: boolean): Promise<{ allSites: boolean }> {
  const allSites = await hasAllSitesAccess();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const shouldRegister = allSites && floatingButtonEnabled;
  if (shouldRegister && !registered.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: ['<all_urls>'],
        excludeMatches: ['https://chromewebstore.google.com/*'],
        js: ['content.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  } else if (!shouldRegister && registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  return { allSites };
}
