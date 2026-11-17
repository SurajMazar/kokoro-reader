/**
 * End-to-end reading flows in real Chromium with the built extension and the
 * real Kokoro model (cached in the test profile after the first run).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { bgRequest, expect, openExtensionPage, playback, SITE, test, waitForPlayback } from './fixtures';

test.describe.configure({ mode: 'serial' });

async function tabIdOf(ext: Page, url: string): Promise<number> {
  const id = await ext.evaluate(async (target) => (await chrome.tabs.query({ url: target })).at(0)?.id, url);
  if (id === undefined) throw new Error(`No tab for ${url}`);
  return id;
}

async function stop(ext: Page) {
  await bgRequest(ext, 'session/control', { action: 'stop' });
}

test('reads the main article of a page with sentence highlighting, skipping page furniture', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/long-article.html`);
  const ext = await openExtensionPage(context, extensionId);
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/long-article.html`), mode: 'page' });
  const state = await waitForPlayback(serviceWorker, (s) => s.status === 'playing');
  expect(state.source).toBe('page');
  expect(state.sentenceCount).toBeGreaterThan(40);

  const doc = await bgRequest<{ blocks: { text: string }[] }>(ext, 'session/doc');
  const all = doc.blocks.map((b) => b.text).join('\n');
  for (const junk of ['We use cookies', 'ADVERTISEMENT', 'HIDDEN TEXT SHOULD NOT BE READ', 'Related: Ten other stories']) expect(all).not.toContain(junk);

  // The CSS Custom Highlight registry is per document, so the page can see the highlight
  // without the extension having modified a single DOM node.
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('kokoro-reader-sentence'))).toBe(true);
  const highlighted = await page.evaluate(() => {
    const range = [...(CSS.highlights.get('kokoro-reader-sentence') as Highlight)][0] as Range;
    return range.toString();
  });
  expect(highlighted).toBe(state.sentenceText);
  await stop(ext);
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('kokoro-reader-sentence'))).toBe(false);
  await ext.close();
});

test('player controls: next, previous, paragraph jumps, seek, pause/resume, speed and voice', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/multi-paragraph.html`);
  const ext = await openExtensionPage(context, extensionId);
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/multi-paragraph.html`), mode: 'page' });
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing');

  await bgRequest(ext, 'session/control', { action: 'next' });
  await waitForPlayback(serviceWorker, (s) => s.sentenceIndex === 1 && s.status === 'playing');
  await bgRequest(ext, 'session/control', { action: 'previous' });
  await waitForPlayback(serviceWorker, (s) => s.sentenceIndex === 0 && s.status === 'playing');

  const before = (await playback(serviceWorker))!.blockId!;
  await bgRequest(ext, 'session/control', { action: 'next-block' });
  const jumped = await waitForPlayback(serviceWorker, (s) => s.blockId !== before && s.status === 'playing');
  expect(jumped.blockId).toBe(before + 1);

  await bgRequest(ext, 'session/control', { action: 'seek', index: 5 });
  await waitForPlayback(serviceWorker, (s) => s.sentenceIndex === 5 && s.status === 'playing');

  await bgRequest(ext, 'session/control', { action: 'pause' });
  const paused = await waitForPlayback(serviceWorker, (s) => s.status === 'paused');
  await page.waitForTimeout(1500);
  expect((await playback(serviceWorker))!.sentenceIndex).toBe(paused.sentenceIndex);
  await bgRequest(ext, 'session/control', { action: 'play' });
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing');

  await bgRequest(ext, 'session/set', { rate: 1.75 });
  await waitForPlayback(serviceWorker, (s) => s.rate === 1.75);
  await bgRequest(ext, 'session/set', { voice: 'bf_emma' });
  await waitForPlayback(serviceWorker, (s) => s.voice === 'bf_emma' && s.status === 'playing');
  // Restore defaults for later tests.
  await bgRequest(ext, 'session/set', { rate: 1, voice: 'af_heart' });
  await stop(ext);
  await ext.close();
});

test('playback continues in the background across tabs, with the popup closed', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/long-article.html`);
  const popup = await openExtensionPage(context, extensionId, 'popup/index.html');
  await bgRequest(popup, 'tab/read', { tabId: await tabIdOf(popup, `${SITE}/long-article.html`), mode: 'page' });
  const start = await waitForPlayback(serviceWorker, (s) => s.status === 'playing');
  await popup.close();

  const other = await context.newPage();
  await other.goto(`${SITE}/wiki.html`);
  await other.bringToFront();
  const later = await waitForPlayback(serviceWorker, (s) => s.sentenceIndex > start.sentenceIndex && s.status === 'playing', 90_000);
  expect(later.sessionId).toBe(start.sessionId);

  const ext = await openExtensionPage(context, extensionId);
  await stop(ext);
  await other.close();
  await ext.close();
});

test('a new reading replaces the old one and clears its highlights (no stale audio)', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/basic.html`);
  const second = await context.newPage();
  await second.goto(`${SITE}/blog.html`);
  const ext = await openExtensionPage(context, extensionId);
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/basic.html`), mode: 'page' });
  const first = await waitForPlayback(serviceWorker, (s) => s.status === 'playing');
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('kokoro-reader-sentence'))).toBe(true);

  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/blog.html`), mode: 'page' });
  const next = await waitForPlayback(serviceWorker, (s) => s.status === 'playing' && s.sessionId !== first.sessionId);
  expect(next.url).toContain('blog.html');
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('kokoro-reader-sentence'))).toBe(false);
  // The old session never reports again.
  await page.waitForTimeout(2000);
  expect((await playback(serviceWorker))!.sessionId).toBe(next.sessionId);
  await stop(ext);
  await second.close();
  await ext.close();
});

test('restores the session after Chrome closes the offscreen document', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/multi-paragraph.html`);
  const ext = await openExtensionPage(context, extensionId);
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/multi-paragraph.html`), mode: 'page', startSentence: 3 });
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing' && s.sentenceIndex === 3);
  await bgRequest(ext, 'session/control', { action: 'pause' });
  await waitForPlayback(serviceWorker, (s) => s.status === 'paused');

  // Simulate idle unload / unexpected termination.
  await serviceWorker.evaluate(() => chrome.offscreen.closeDocument());
  await bgRequest(ext, 'session/control', { action: 'play' });
  const resumed = await waitForPlayback(serviceWorker, (s) => s.status === 'playing', 120_000);
  expect(resumed.sentenceIndex).toBe(3);
  await stop(ext);
  await ext.close();
});

test('handles dynamic, single-page-app and right-to-left pages', async ({ page, context, extensionId, serviceWorker }) => {
  const ext = await openExtensionPage(context, extensionId);

  await page.goto(`${SITE}/dynamic.html`);
  await page.waitForSelector('article p');
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/dynamic.html`), mode: 'page' });
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing' && s.sentenceCount > 3);
  await stop(ext);

  await page.goto(`${SITE}/spa.html`);
  await page.click('#route-b');
  const spaTitle = await page.locator('article h1').innerText();
  const spaUrl = page.url();
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, spaUrl), mode: 'page' });
  const spa = await waitForPlayback(serviceWorker, (s) => s.status === 'playing');
  const spaDoc = await bgRequest<{ blocks: { text: string }[] }>(ext, 'session/doc');
  expect(spaDoc.blocks.map((b) => b.text)).toContain(spaTitle);
  expect(spa.sentenceCount).toBeGreaterThan(2);
  await stop(ext);

  await page.goto(`${SITE}/rtl.html`);
  await page.evaluate(() => {
    const target = [...document.querySelectorAll('p')].find((p) => p.textContent?.startsWith('This English paragraph'))!;
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/rtl.html`), mode: 'selection' });
  const rtl = await waitForPlayback(serviceWorker, (s) => s.status === 'playing');
  expect(rtl.sentenceText).toBe('This English paragraph sits inside a right-to-left page.');
  await stop(ext);
  await ext.close();
});

test('floating speaker button appears next to selections, including inside nested scroll containers', async ({ page }) => {
  await page.goto(`${SITE}/nested-scroll.html`);
  const paragraph = page.locator('p').nth(2);
  await paragraph.scrollIntoViewIfNeeded();
  const box = (await paragraph.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 3, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const hit = await page.evaluate(() => {
    const rects = [...getSelection()!.getRangeAt(0).getClientRects()].filter((r) => r.width > 0);
    const last = rects.at(-1)!;
    const x = Math.min(last.right, innerWidth - 27);
    const y = Math.min(last.bottom + 8 + 19, innerHeight - 27);
    return document.elementFromPoint(x, y)?.tagName;
  });
  expect(hit).toBe('KOKORO-READER-ROOT');
  // Collapsing the selection hides it again.
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.elementFromPoint(innerWidth - 40, innerHeight - 40)?.tagName);
  expect(after).not.toBe('KOKORO-READER-ROOT');
});

test('Smart Reader extracts the article and highlights while reading', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/long-article.html`);
  const ext = await openExtensionPage(context, extensionId);
  const readerPromise = context.waitForEvent('page', (p) => p.url().includes('/reader/index.html'));
  await bgRequest(ext, 'reader/open', { tabId: await tabIdOf(ext, `${SITE}/long-article.html`) });
  const reader = await readerPromise;
  await reader.waitForLoadState();
  await expect(reader.locator('article h1')).toBeVisible();
  await expect(reader.getByText('We use cookies')).toHaveCount(0);
  await expect(reader.getByRole('navigation', { name: 'Contents' })).toBeVisible();
  await reader.getByRole('button', { name: 'Listen', exact: true }).click();
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing' && s.source === 'article');
  await expect(reader.locator('[data-sentence].bg-mark')).toHaveCount(1);
  await reader.screenshot({ path: 'test-results/smart-reader.png' });
  await stop(ext);
  await reader.close();
  await ext.close();
});

test('custom text: paste, generate, and export a valid WAV file', async ({ context, extensionId }) => {
  const reader = await openExtensionPage(context, extensionId, 'reader/index.html?mode=custom');
  await reader.getByLabel('Title').fill('Export test');
  await reader.getByLabel('Text to read').fill('Kokoro Reader can export audio. This file should play anywhere.');
  await reader.getByRole('button', { name: 'Continue' }).click();
  const downloadPromise = reader.waitForEvent('download', { timeout: 120_000 });
  await reader.getByRole('button', { name: 'Export WAV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^export-test-\d{4}-\d{2}-\d{2}\.wav$/);
  const bytes = readFileSync((await download.path())!);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => bytes.subarray(offset, offset + 4).toString('ascii');
  expect(tag(0)).toBe('RIFF');
  expect(tag(8)).toBe('WAVE');
  expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(24_000);
  // Find the data chunk after the optional LIST chunk.
  let offset = 12;
  let dataBytes = 0;
  while (offset < bytes.byteLength - 8) {
    const size = view.getUint32(offset + 4, true);
    if (tag(offset) === 'data') {
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const seconds = dataBytes / 2 / 24_000;
  console.log(`Exported WAV: ${seconds.toFixed(2)} s, ${bytes.byteLength} bytes`);
  expect(seconds).toBeGreaterThan(2);
  // Not silence: real speech has substantial amplitude.
  let peak = 0;
  for (let i = offset + 8; i < offset + 8 + dataBytes; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
  expect(peak).toBeGreaterThan(3000);
  await reader.close();
});

test('in-page player: Play replays a finished reading, Play after a voice change uses the new voice, Close dismisses it', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/basic.html`);
  const ext = await openExtensionPage(context, extensionId);
  // Select just the first sentence, like a short selection on any site.
  await page.evaluate(() => {
    const text = document.querySelector('#p1')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 'The quiet garden wakes slowly every morning.'.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/basic.html`), mode: 'selection' });
  // Long timeout: when this test runs alone, it includes the first-time model download.
  const first = await waitForPlayback(serviceWorker, (s) => s.status === 'playing', 600_000);
  expect(first.sentenceCount).toBe(1);
  await waitForPlayback(serviceWorker, (s) => s.status === 'ended', 60_000);
  await page.bringToFront();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/player-ended.png' });

  // The compact player is anchored bottom-right; these are its Play and Close buttons in a 1280×860 viewport.
  const play = { x: 1003, y: 810 };
  const close = { x: 1235, y: 693 };

  // 1. Play on a finished reading replays it (it used to do nothing).
  await page.mouse.click(play.x, play.y);
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing' && s.sessionId === first.sessionId);

  // 2. Pause, change the voice, Play: the sentence is spoken again in the new voice.
  await page.mouse.click(play.x, play.y);
  await waitForPlayback(serviceWorker, (s) => s.status === 'paused');
  await bgRequest(ext, 'session/set', { voice: 'bm_lewis' });
  await waitForPlayback(serviceWorker, (s) => s.voice === 'bm_lewis');
  await page.mouse.click(play.x, play.y);
  await waitForPlayback(serviceWorker, (s) => s.status === 'playing' && s.voice === 'bm_lewis');
  await waitForPlayback(serviceWorker, (s) => s.status === 'ended', 60_000);

  // 3. Close on a finished reading stops the session and removes the player and highlight.
  await page.mouse.click(close.x, close.y);
  await waitForPlayback(serviceWorker, (s) => s.status === 'idle');
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('kokoro-reader-sentence'))).toBe(false);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/player-closed.png' });
  await bgRequest(ext, 'session/set', { voice: 'af_heart' });
  await ext.close();
});
