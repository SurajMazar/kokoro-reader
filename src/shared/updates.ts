/**
 * Update checks for unpacked ("Load unpacked") installs.
 *
 * Chrome updates Web Store installs by itself, so those never check here.
 * An unpacked install cannot update itself; once a day it reads the version
 * number of the latest build (package.json on the main branch, which the
 * rolling "latest" release is built from) and the UI explains how to update
 * in place, keeping settings and downloaded models.
 */
export const REPOSITORY_URL = 'https://github.com/SurajMazar/kokoro-reader';
export const LATEST_ZIP_URL = `${REPOSITORY_URL}/releases/download/latest/kokoro-reader-latest.zip`;
export const STORE_URL = 'https://chromewebstore.google.com/detail/kokoro-reader/jjkkkegnnbehafabbhbolcdnfcjniamj';
const VERSION_URL = 'https://raw.githubusercontent.com/SurajMazar/kokoro-reader/main/package.json';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
export const UPDATE_KEY = 'update';

export interface UpdateInfo {
  /** True for a "Load unpacked" install, the only kind that checks. */
  unpacked: boolean;
  current: string;
  latest: string | null;
  available: boolean;
  checkedAt: number | null;
}

/** True when `candidate` is a higher dotted version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = current.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

async function installedUnpacked(): Promise<boolean> {
  try {
    return (await chrome.management.getSelf()).installType === 'development';
  } catch {
    return false;
  }
}

/** Checks at most once a day (or now, when forced). Never makes a request for a Web Store install. */
export async function checkForUpdate(force = false, fetcher: typeof fetch = fetch): Promise<UpdateInfo> {
  const current = chrome.runtime.getManifest().version;
  const stored = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] as UpdateInfo | undefined;
  const unpacked = await installedUnpacked();
  if (!unpacked) {
    const info: UpdateInfo = { unpacked: false, current, latest: null, available: false, checkedAt: null };
    await chrome.storage.local.set({ [UPDATE_KEY]: info });
    return info;
  }
  if (!force && stored?.unpacked && stored.checkedAt && Date.now() - stored.checkedAt < CHECK_EVERY_MS && stored.current === current) return stored;
  let latest = stored?.latest ?? null;
  try {
    const response = await fetcher(VERSION_URL, { cache: 'no-store', credentials: 'omit' });
    if (response.ok) latest = String(((await response.json()) as { version?: unknown }).version ?? '') || latest;
  } catch {
    // Offline: keep what we knew.
  }
  const info: UpdateInfo = { unpacked: true, current, latest, available: Boolean(latest && isNewer(latest, current)), checkedAt: Date.now() };
  await chrome.storage.local.set({ [UPDATE_KEY]: info });
  return info;
}
