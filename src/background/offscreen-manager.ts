const OFFSCREEN_PATH = 'offscreen/index.html';

let creating: Promise<void> | null = null;

export async function hasOffscreenDocument(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  return contexts.length > 0;
}

/**
 * Creates the offscreen document if it does not exist. Concurrent callers
 * share one creation, since Chrome allows only one offscreen document.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the local Kokoro speech model in a worker and plays the generated audio.',
    })
    .catch((error: unknown) => {
      // Another caller may have won the race.
      if (!String(error).includes('Only a single offscreen document')) throw error;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
  // Give the document's message listener a moment to register.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const reply = (await chrome.runtime.sendMessage({ kr: 1, type: 'offscreen/ping', target: 'offscreen', requestId: 'boot', payload: {} })) as
        | { ok: boolean }
        | undefined;
      if (reply?.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument().catch(() => undefined);
}
