/**
 * Captures real screenshots of the running extension for the README and the
 * Chrome Web Store listing (1280×800). Run with: npm run screenshots
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bgRequest, openExtensionPage, SITE, test, waitForPlayback } from './fixtures';

const OUT = resolve(import.meta.dirname, '../../docs/screenshots');
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to capture store screenshots');
test.describe.configure({ mode: 'serial' });

test('store screenshots', async ({ context, extensionId, serviceWorker }) => {
  mkdirSync(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${SITE}/long-article.html`);
    const ext = await openExtensionPage(context, extensionId);
    const tabId = await ext.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)!.id!, `${SITE}/long-article.html`);
    await page.bringToFront();
    await bgRequest(ext, 'tab/read', { tabId, mode: 'page', startSentence: 4 });
    await waitForPlayback(serviceWorker, (s) => s.status === 'playing');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(OUT, `in-page-player-${scheme}.png`) });
    await bgRequest(ext, 'session/control', { action: 'pause' });

    // Popup rendered as a page at its real size.
    const popup = await openExtensionPage(context, extensionId, `popup/index.html?tab=${tabId}`);
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 380, height: 580 });
    await popup.waitForTimeout(700);
    await popup.screenshot({ path: resolve(OUT, `popup-${scheme}.png`) });
    await popup.getByRole('button', { name: 'Voices' }).click();
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: resolve(OUT, `popup-voices-${scheme}.png`) });
    await popup.close();

    const options = await openExtensionPage(context, extensionId, 'options/index.html#engine');
    await options.emulateMedia({ colorScheme: scheme });
    await options.setViewportSize({ width: 1280, height: 800 });
    await options.waitForTimeout(700);
    await options.screenshot({ path: resolve(OUT, `options-engine-${scheme}.png`) });
    await options.close();

    const readerPromise = context.waitForEvent('page', (p) => p.url().includes('/reader/'));
    await bgRequest(ext, 'reader/open', { tabId });
    const reader = await readerPromise;
    await reader.emulateMedia({ colorScheme: scheme });
    await reader.setViewportSize({ width: 1280, height: 800 });
    await reader.getByRole('button', { name: 'Listen', exact: true }).click();
    await waitForPlayback(serviceWorker, (s) => s.status === 'playing' && s.source === 'article');
    await reader.waitForTimeout(1000);
    await reader.screenshot({ path: resolve(OUT, `smart-reader-${scheme}.png`) });
    await bgRequest(ext, 'session/control', { action: 'stop' });
    await reader.close();

    const welcome = await openExtensionPage(context, extensionId, 'welcome/index.html');
    await welcome.emulateMedia({ colorScheme: scheme });
    await welcome.setViewportSize({ width: 1280, height: 800 });
    await welcome.waitForTimeout(600);
    await welcome.screenshot({ path: resolve(OUT, `welcome-${scheme}.png`) });
    await welcome.close();
    await ext.close();
    await page.close();
  }
});
