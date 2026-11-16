/**
 * Real Kokoro inference in a real Chromium, with the built extension.
 * Nothing here is mocked: the model is downloaded from the pinned Hugging
 * Face revision, verified, loaded into ONNX Runtime Web and run.
 */
import { bgRequest, expect, modelState, openExtensionPage, playback, SITE, test, waitForPlayback } from './fixtures';

test.describe.configure({ mode: 'serial' });

test('selecting a paragraph and clicking the speaker plays real Kokoro speech', async ({ page, context, serviceWorker, extensionId }) => {
  await page.goto(`${SITE}/basic.html`);
  const button = page.locator('kokoro-reader-root');
  await expect(button).toHaveCount(0);

  // Select the first paragraph with a real mouse drag.
  const box = (await page.locator('#p1').boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 4, { steps: 10 });
  await page.mouse.up();

  // The closed shadow root hides the button from page scripts (and from
  // Playwright locators), so click where the button is placed: centred on the
  // end of the last selected line, 8 px below it.
  await expect(page.locator('kokoro-reader-root')).toHaveCount(1);
  const target = await page.evaluate(() => {
    const rects = Array.from(window.getSelection()!.getRangeAt(0).getClientRects()).filter((r) => r.width > 0);
    const last = rects.at(-1)!;
    return { x: Math.min(last.right, window.innerWidth - 27), y: last.bottom + 8 + 19 };
  });
  await page.waitForTimeout(400);
  await page.mouse.click(target.x, target.y);
  const ext = await openExtensionPage(context, extensionId);

  const started = Date.now();
  const playing = await waitForPlayback(serviceWorker, (state) => state.status === 'playing', 600_000);
  console.log(`First audio after ${((Date.now() - started) / 1000).toFixed(1)} s (includes model download on a fresh profile)`);
  expect(playing.sentenceText).toContain('The quiet garden wakes slowly every morning.');
  expect(playing.engine).toBe('kokoro');

  const model = await modelState(serviceWorker);
  console.log('Model state', JSON.stringify(model));
  expect(model?.status).toBe('ready');
  expect(['wasm', 'webgpu']).toContain(model?.activeBackend);

  // It keeps reading: the sentence index advances on its own.
  await waitForPlayback(serviceWorker, (state) => state.sentenceIndex >= 1, 120_000);

  const diagnostics = await ext.evaluate(async () => (await chrome.storage.local.get('diagnostics')).diagnostics as { kind: string; data: Record<string, unknown> }[]);
  const synth = diagnostics.filter((event) => event.kind === 'synthesis');
  expect(synth.length).toBeGreaterThan(0);
  console.log('Synthesis diagnostics', JSON.stringify(synth.slice(0, 5)));
  console.log('Init', JSON.stringify(diagnostics.find((event) => event.kind === 'model-init')));

  await bgRequest(ext, 'session/control', { action: 'stop' });
  await expect.poll(async () => (await playback(serviceWorker))?.status).toBe('idle');
  await ext.close();
});
