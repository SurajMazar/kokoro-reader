/**
 * Nepali voices end to end, with nothing mocked: the Piper voice pack is
 * downloaded from the pinned rhasspy/piper-voices revision, verified,
 * phonemized by the espeak-ng WebAssembly build and run in ONNX Runtime Web.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { bgRequest, expect, modelState, openExtensionPage, SITE, test, waitForPlayback } from './fixtures';

test.describe.configure({ mode: 'serial' });

async function tabIdOf(ext: Page, url: string): Promise<number> {
  const id = await ext.evaluate(async (target) => (await chrome.tabs.query({ url: target })).at(0)?.id, url);
  if (id === undefined) throw new Error(`No tab for ${url}`);
  return id;
}

type Diagnostic = { kind: string; data: Record<string, unknown> };

test('reads a mixed Nepali and English page, switching voice sentence by sentence', async ({ page, context, extensionId, serviceWorker }) => {
  await page.goto(`${SITE}/nepali.html`);
  const ext = await openExtensionPage(context, extensionId);
  await bgRequest(ext, 'tab/read', { tabId: await tabIdOf(ext, `${SITE}/nepali.html`), mode: 'page' });

  const started = Date.now();
  const first = await waitForPlayback(serviceWorker, (s) => s.status === 'playing', 600_000);
  console.log(`First Nepali audio after ${((Date.now() - started) / 1000).toFixed(1)} s (includes the voice-pack download)`);
  expect(first.sentenceText).toBe('नेपालको परिचय');
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('kokoro-reader-sentence'))).toBe(true);
  const highlighted = await page.evaluate(() => ([...(CSS.highlights.get('kokoro-reader-sentence') as Highlight)][0] as Range).toString());
  expect(highlighted).toBe('नेपालको परिचय');

  // Sentences split at the danda; the English paragraph follows the three Nepali sentences.
  const doc = await bgRequest<{ sentences: { text: string }[] }>(ext, 'session/doc');
  expect(doc.sentences.map((s) => s.text)).toEqual([
    'नेपालको परिचय',
    'नेपाल हिमालयको काखमा रहेको एउटा सुन्दर देश हो।',
    'यहाँ संसारको सबैभन्दा अग्लो हिमाल सगरमाथा पर्छ।',
    'काठमाडौं नेपालको राजधानी हो।',
    'Nepal is a landlocked country in South Asia.',
    'Its capital is Kathmandu.',
    'नेपालमा १२५ भन्दा बढी जातजातिहरू बस्छन्।',
    'यहाँका मानिसहरू मिलनसार र मेहनती छन्।',
  ]);

  // Jump to the English paragraph, then to the last Nepali paragraph.
  await bgRequest(ext, 'session/control', { action: 'seek', index: 4 });
  await waitForPlayback(serviceWorker, (s) => s.sentenceIndex === 4 && s.status === 'playing', 600_000);
  await bgRequest(ext, 'session/control', { action: 'seek', index: 6 });
  await waitForPlayback(serviceWorker, (s) => s.sentenceIndex === 6 && s.status === 'playing', 120_000);

  const diagnostics = await ext.evaluate(async () => (await chrome.storage.local.get('diagnostics')).diagnostics as Diagnostic[]);
  const synth = diagnostics.filter((event) => event.kind === 'synthesis');
  const byVoice = (voice: string) => synth.filter((event) => event.data.voice === voice);
  console.log('Nepali synthesis', JSON.stringify(byVoice('ne_chitwan').slice(0, 4)));
  expect(byVoice('ne_chitwan').length).toBeGreaterThanOrEqual(3);
  expect(byVoice('af_heart').length).toBeGreaterThanOrEqual(1);
  // Piper is fast: well under real time on the CPU.
  const rtf = byVoice('ne_chitwan').map((event) => Number(event.data.rtf));
  expect(Math.min(...rtf)).toBeLessThan(1);

  const model = await modelState(serviceWorker);
  expect(model?.packs['ne-chitwan']?.status).toBe('downloaded');
  expect(model?.packs['ne-google']?.status).toBe('not-downloaded');

  await bgRequest(ext, 'session/control', { action: 'stop' });
  await ext.close();
});

test('exports Nepali text as a WAV file with real speech', async ({ context, extensionId }) => {
  const reader = await openExtensionPage(context, extensionId, 'reader/index.html?mode=custom');
  await reader.getByLabel('Title').fill('Nepali export');
  await reader.getByLabel('Text to read').fill('नमस्ते! म कोकोरो रिडर हुँ। आज काठमाडौंमा मौसम सफा छ।');
  await reader.getByRole('button', { name: 'Continue' }).click();
  const downloadPromise = reader.waitForEvent('download', { timeout: 600_000 });
  await reader.getByRole('button', { name: 'Export WAV' }).click();
  const download = await downloadPromise;
  const bytes = readFileSync((await download.path())!);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => bytes.subarray(offset, offset + 4).toString('ascii');
  expect(tag(0)).toBe('RIFF');
  expect(view.getUint32(24, true)).toBe(24_000);
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
  console.log(`Nepali WAV: ${seconds.toFixed(2)} s`);
  expect(seconds).toBeGreaterThan(3);
  let peak = 0;
  for (let i = offset + 8; i < offset + 8 + dataBytes; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
  expect(peak).toBeGreaterThan(10_000);
  if (process.env.NEPALI_SAMPLE) await download.saveAs(process.env.NEPALI_SAMPLE);
  await reader.close();
});
