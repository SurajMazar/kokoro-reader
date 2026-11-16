/**
 * Playwright fixtures that load the built extension (dist-e2e) into a real
 * Chromium. The model cache lives in a persistent profile under .cache/, so
 * the 92 MB Kokoro download happens once per machine, not once per test.
 */
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModelState, PlaybackState } from '../../src/shared/types';

const EXTENSION = resolve(import.meta.dirname, '../../dist-e2e');
const PROFILE = resolve(import.meta.dirname, '../../.cache/e2e-profile');
export const SITE = 'http://localhost:4173';

interface Fixtures {
  extContext: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<{ page: Page; context: BrowserContext }, Fixtures>({
  extContext: [
    async ({}, use) => {
      mkdirSync(PROFILE, { recursive: true });
      const context = await chromium.launchPersistentContext(PROFILE, {
        channel: 'chromium',
        headless: process.env.HEADED !== '1',
        viewport: { width: 1280, height: 860 },
        args: [
          `--disable-extensions-except=${EXTENSION}`,
          `--load-extension=${EXTENSION}`,
          '--autoplay-policy=no-user-gesture-required',
          '--enable-unsafe-webgpu',
        ],
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  serviceWorker: [
    async ({ extContext }, use) => {
      let [worker] = extContext.serviceWorkers();
      worker ??= await extContext.waitForEvent('serviceworker');
      await use(worker);
    },
    { scope: 'worker' },
  ],
  extensionId: [
    async ({ serviceWorker }, use) => {
      await use(serviceWorker.url().split('/')[2]!);
    },
    { scope: 'worker' },
  ],
  context: async ({ extContext }, use) => {
    await use(extContext);
  },
  page: async ({ extContext }, use) => {
    const page = await extContext.newPage();
    await use(page);
    await page.close();
  },
});

export const expect = test.expect;

export async function playback(worker: Worker): Promise<PlaybackState | null> {
  return worker.evaluate(async () => ((await chrome.storage.session.get('playback')).playback as PlaybackState | undefined) ?? null);
}

export async function modelState(worker: Worker): Promise<ModelState | null> {
  return worker.evaluate(async () => ((await chrome.storage.local.get('modelState')).modelState as ModelState | undefined) ?? null);
}

/** Waits until the playback state satisfies the predicate. */
export async function waitForPlayback(worker: Worker, predicate: (state: PlaybackState) => boolean, timeout = 60_000): Promise<PlaybackState> {
  const started = Date.now();
  let last: PlaybackState | null = null;
  while (Date.now() - started < timeout) {
    last = await playback(worker);
    if (last && predicate(last)) return last;
    if (last?.status === 'error') throw new Error(`Playback error: ${JSON.stringify(last.error)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for playback; last state ${JSON.stringify(last)}`);
}

/**
 * Sends a request to the background exactly as the popup does. Messages a
 * service worker sends to itself are not delivered, so this goes through an
 * extension page.
 */
export async function bgRequest<T = unknown>(page: Page, type: string, payload: unknown = {}): Promise<T> {
  const reply = await page.evaluate(
    async ([type, payload]) => chrome.runtime.sendMessage({ kr: 1, type, target: 'background', requestId: crypto.randomUUID(), payload }),
    [type, payload] as const,
  );
  const typed = reply as { ok: boolean; data?: T; error?: unknown };
  if (!typed?.ok) throw new Error(`${type} failed: ${JSON.stringify(typed?.error)}`);
  return typed.data as T;
}

/** Opens an extension page (for privileged requests and storage access). */
export async function openExtensionPage(context: BrowserContext, extensionId: string, path = 'options/index.html'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}

export async function selectText(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const element = document.querySelector(sel)!;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

/** Selects text the way a user does: press, drag, release. */
export async function dragSelect(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 6, { steps: 8 });
  await page.mouse.up();
}
