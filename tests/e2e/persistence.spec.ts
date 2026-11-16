/**
 * Model cache durability: it survives a browser restart, corruption is
 * detected by validation, and a re-download recovers it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { bgRequest, extensionWorker, launchWithExtension } from './fixtures';

test('model cache survives a Chrome restart and recovers from corruption', async () => {
  test.setTimeout(300_000);
  const profile = mkdtempSync(join(tmpdir(), 'kokoro-persist-'));
  try {
    const open = async () => {
      const context = await launchWithExtension(profile);
      const worker = await extensionWorker(context);
      const id = worker.url().split('/')[2]!;
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/options/index.html`);
      return { context, page };
    };
    const waitFor = async (page: import('@playwright/test').Page, wanted: string[]) => {
      let state: { status: string; cachedBytes: number; error: { code: string } | null } | null = null;
      for (let i = 0; i < 600; i++) {
        state = await bgRequest<{ status: string; cachedBytes: number; error: { code: string } | null }>(page, 'model/get');
        if (wanted.includes(state.status)) return state;
        await page.waitForTimeout(250);
      }
      throw new Error(`model never reached ${wanted}; last ${JSON.stringify(state)}`);
    };

    // First launch: download.
    let { context, page } = await open();
    expect((await bgRequest<{ status: string }>(page, 'model/get')).status).toBe('not-downloaded');
    await bgRequest(page, 'model/action', { action: 'download' });
    const downloaded = await waitFor(page, ['downloaded']);
    expect(downloaded.cachedBytes).toBeGreaterThan(90_000_000);
    await context.close();

    // Second launch: still there, no download needed.
    ({ context, page } = await open());
    await bgRequest(page, 'model/action', { action: 'validate' });
    const restored = await waitFor(page, ['downloaded']);
    expect(restored.cachedBytes).toBeGreaterThan(90_000_000);

    // Corrupt the tokenizer in the cache (keeping its "verified" header) and validate.
    await page.evaluate(async () => {
      const cache = await caches.open('kokoro-reader-models-v1');
      const key = (await cache.keys()).find((request) => request.url.endsWith('/tokenizer.json'))!;
      const original = (await cache.match(key))!;
      await cache.put(key, new Response('{"corrupted":true}', { headers: original.headers }));
    });
    await bgRequest(page, 'model/action', { action: 'validate' });
    const broken = await waitFor(page, ['error']);
    expect(broken.error?.code).toBe('E_MODEL_INTEGRITY');

    // Recovery: download again fetches only the missing file and verifies it.
    await bgRequest(page, 'model/action', { action: 'download' });
    await waitFor(page, ['downloaded']);
    await bgRequest(page, 'model/action', { action: 'validate' });
    expect((await waitFor(page, ['downloaded'])).status).toBe('downloaded');
    await context.close();
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
