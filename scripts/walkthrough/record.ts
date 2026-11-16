/**
 * Records the product walkthrough from the real extension.
 *
 *   npm run build:e2e && node scripts/walkthrough/record.ts && node scripts/walkthrough/compose.ts
 *
 * Phase 1 generates the narration with the extension's own Kokoro export
 * (voice af_heart). Phase 2 records every chapter in a fresh profile, so the
 * first-time model download shown is real. Phase 3 exports the exact
 * sentences that were read aloud in the reading scenes, which compose.ts
 * places at the moments they started playing. (Headless Chromium cannot
 * capture its audio output, so reading audio is the extension's own export
 * of the same sentences with the same voice, aligned to the recorded
 * timestamps.)
 */
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHAPTERS, type Chapter } from './chapters.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const EXTENSION = resolve(ROOT, 'dist-e2e');
const OUT = resolve(ROOT, '.cache/walkthrough');
const SITE = 'http://localhost:4173';
const VIEW = { width: 1280, height: 720 };

interface ReadingEvent {
  t: number;
  index: number;
  text: string;
}

interface SceneRecord {
  id: string;
  page: string;
  start: number;
  end: number;
  narrationOffset: number;
  reading: ReadingEvent[];
}

interface Frame {
  page: string;
  t: number;
  file: string;
}

const pages = new Map<string, Page>();
const frames: Frame[] = [];
/** Which recorded page is in front, from when. Only the front tab paints. */
const front: { t: number; page: string }[] = [];
let frameCount = 0;

/**
 * Captures a page with the DevTools screencast. Unlike Playwright's page
 * video, every frame carries its wall-clock timestamp, so scenes can be cut
 * exactly by time.
 */
async function capture(context: BrowserContext, page: Page, name: string) {
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = resolve(OUT, 'frames', `${String(frameCount++).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ page: name, t: Math.round((metadata.timestamp ?? Date.now() / 1000) * 1000), file });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
}

async function bringFront(name: string) {
  await pages.get(name)!.bringToFront();
  front.push({ t: Date.now(), page: name });
}

async function launch(profile: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    // The DevTools screencast captures the real window, not Playwright's emulated
    // viewport, so size the headless window itself: its page area is the window
    // height minus 139 px of (invisible) browser chrome.
    viewport: null,
    args: [`--window-size=${VIEW.width},${VIEW.height + 139}`, `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu'],
  });
  // A visible cursor, since recorded videos do not include the system pointer.
  await context.addInitScript(() => {
    const install = () => {
      if (document.getElementById('__demo_cursor') || !document.body) return;
      const dot = document.createElement('div');
      dot.id = '__demo_cursor';
      dot.style.cssText =
        'position:fixed;z-index:2147483647;left:-40px;top:-40px;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transition:left .12s linear, top .12s linear;background:no-repeat url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27><path d=%27M4 2l16 10-7 1.5L9.5 21z%27 fill=%27black%27 stroke=%27white%27 stroke-width=%271.5%27/></svg>")';
      document.body.append(dot);
      addEventListener('mousemove', (event: MouseEvent) => {
        dot.style.left = `${event.clientX}px`;
        dot.style.top = `${event.clientY}px`;
      }, true);
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install);
    else install();
  });
  return context;
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const ours = (w: Worker) => w.url().endsWith('/background.js');
  const worker = context.serviceWorkers().find(ours) ?? (await context.waitForEvent('serviceworker', { predicate: ours }));
  for (let i = 0; i < 100; i++) {
    const ready = await worker.evaluate(async () => (chrome.scripting ? (await chrome.scripting.getRegisteredContentScripts()).length : 0)).catch(() => 0);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return worker;
}

async function bg<T = unknown>(page: Page, type: string, payload: unknown = {}): Promise<T> {
  const reply = (await page.evaluate(
    async ([type, payload]) => chrome.runtime.sendMessage({ kr: 1, type, target: 'background', requestId: crypto.randomUUID(), payload }),
    [type, payload] as const,
  )) as { ok: boolean; data: T; error?: unknown };
  if (!reply?.ok) throw new Error(`${type}: ${JSON.stringify(reply?.error)}`);
  return reply.data;
}

function singleSentenceDoc(id: string, text: string) {
  return { id, title: id, source: 'custom', blocks: [{ id: 0, kind: 'paragraph', text }], sentences: [{ id: 0, blockId: 0, start: 0, end: text.length, text }] };
}

async function exportWav(page: Page, text: string, file: string, voice = 'af_heart'): Promise<number> {
  const result = await bg<{ url: string; durationSeconds: number }>(page, 'export/wav', { doc: singleSentenceDoc(file, text), voice });
  const bytes = await page.evaluate(async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), result.url);
  writeFileSync(file, Buffer.from(bytes));
  return result.durationSeconds;
}

async function waitForModel(page: Page, statuses: string[], timeout = 300_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await bg<{ status: string }>(page, 'model/get');
    if (statuses.includes(state.status)) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`model did not reach ${statuses}`);
}

async function playback(worker: Worker) {
  return (await worker.evaluate(async () => (await chrome.storage.session.get('playback')).playback)) as {
    status: string;
    sentenceIndex: number;
    sentenceText: string;
    sessionId: string | null;
  } | null;
}

/** Records sentence starts while something is reading, until the predicate or the time limit. */
async function logReading(worker: Worker, ms: number, stop?: (state: { status: string; sentenceIndex: number }) => boolean): Promise<ReadingEvent[]> {
  const events: ReadingEvent[] = [];
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    const state = await playback(worker);
    if (state) {
      const key = `${state.sessionId}:${state.sentenceIndex}`;
      if (state.status === 'playing' && key !== last) {
        events.push({ t: Date.now(), index: state.sentenceIndex, text: state.sentenceText });
        last = key;
      }
      if (stop?.(state)) break;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return events;
}

async function waitPlaying(worker: Worker, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await playback(worker))?.status === 'playing') return;
    await new Promise((r) => setTimeout(r, 80));
  }
}

async function newStage(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage();
  const size = await page.evaluate(() => [innerWidth, innerHeight]);
  if (size[0] !== VIEW.width || size[1] !== VIEW.height) throw new Error(`Page area is ${size.join('×')}, expected ${VIEW.width}×${VIEW.height}`);
  pages.set(name, page);
  await capture(context, page, name);
  return page;
}

async function showPopup(stage: Page, extensionId: string, tabId: number) {
  await stage.goto(`chrome-extension://${extensionId}/popup/index.html?tab=${tabId}`);
  await stage.addStyleTag({
    content: `html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 20%,#ece9ff,#d9d4f5 60%,#c9c2ef)!important}
      #root>div{border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(40,20,120,.35),0 0 0 .5px rgba(0,0,0,.1)}
      body::before{content:"Toolbar popup";position:fixed;top:24px;left:50%;transform:translateX(-50%);font:600 13px -apple-system,system-ui;color:#4b3fa0;letter-spacing:.04em;text-transform:uppercase}`,
  });
  await stage.waitForTimeout(500);
}

async function moveTo(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 14 });
}

async function main() {
  // REUSE_NARRATION=1 keeps the narration from a previous run.
  const reuse = process.env.REUSE_NARRATION === '1' && existsSync(resolve(OUT, 'narration.json'));
  for (const dir of reuse ? ['frames', 'reading'] : ['frames', 'reading', 'narration']) rmSync(resolve(OUT, dir), { recursive: true, force: true });
  mkdirSync(resolve(OUT, 'frames'), { recursive: true });
  mkdirSync(resolve(OUT, 'narration'), { recursive: true });
  mkdirSync(resolve(OUT, 'reading'), { recursive: true });
  const server = spawn('node', [resolve(ROOT, 'tests/fixtures/server.ts')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));

  // Phase 1: narration.
  let narration: Record<string, number> = {};
  if (reuse) narration = JSON.parse(readFileSync(resolve(OUT, 'narration.json'), 'utf8'));
  else {
  const prepProfile = mkdtempSync(join(tmpdir(), 'kokoro-walkthrough-prep-'));
  const prep = await launch(prepProfile);
  const prepWorker = await extensionWorker(prep);
  const prepId = prepWorker.url().split('/')[2]!;
  const prepPage = await prep.newPage();
  await prepPage.goto(`chrome-extension://${prepId}/options/index.html`);
  await bg(prepPage, 'model/action', { action: 'download' });
  await waitForModel(prepPage, ['downloaded', 'ready']);
  for (const chapter of CHAPTERS) {
    if (!chapter.narration) continue;
    narration[chapter.id] = await exportWav(prepPage, chapter.narration, resolve(OUT, 'narration', `${chapter.id}.wav`));
    console.log(`narration ${chapter.id}: ${narration[chapter.id]} s`);
  }
  await prep.close();
  rmSync(prepProfile, { recursive: true, force: true });
  writeFileSync(resolve(OUT, 'narration.json'), JSON.stringify(narration));
  }

  // Phase 2: record.
  const profile = mkdtempSync(join(tmpdir(), 'kokoro-walkthrough-'));
  const context = await launch(profile);
  const worker = await extensionWorker(context);
  const id = worker.url().split('/')[2]!;
  // An unrecorded-in-the-final-cut control page for privileged requests.
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options/index.html`);
  const article = await newStage(context, 'article');
  await article.goto(`${SITE}/long-article.html`);
  const stage = await newStage(context, 'stage');
  const tabId = await control.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)!.id!, `${SITE}/long-article.html`);

  const scenes: SceneRecord[] = [];
  const scene = async (chapter: Chapter, pageName: string, action: (mark: { narrationAt: () => void }) => Promise<ReadingEvent[] | void>, minSeconds = 0) => {
    const page = pages.get(pageName)!;
    await bringFront(pageName);
    const start = Date.now();
    let narrationOffset = 0.3;
    const reading = (await action({ narrationAt: () => (narrationOffset = (Date.now() - start) / 1000) })) ?? [];
    const needed = Math.max(minSeconds, (narration[chapter.id] ?? 0) + narrationOffset + 0.7);
    const elapsed = (Date.now() - start) / 1000;
    if (elapsed < needed) await page.waitForTimeout((needed - elapsed) * 1000);
    scenes.push({ id: chapter.id, page: pageName, start, end: Date.now(), narrationOffset, reading });
    console.log(`recorded ${chapter.id} (${((Date.now() - start) / 1000).toFixed(1)} s)`);
  };
  const ch = (id: string) => CHAPTERS.find((chapter) => chapter.id === id)!;

  // 1 intro and 19 outro are title cards rendered by compose.ts.
  await scene(ch('02-install'), 'stage', async () => {
    await stage.goto('chrome://extensions/');
    await stage.waitForTimeout(800);
    await moveTo(stage, 640, 300);
  });

  await scene(ch('03-download'), 'stage', async () => {
    await stage.goto(`chrome-extension://${id}/welcome/index.html`);
    await stage.waitForTimeout(600);
    await stage.mouse.wheel(0, 380);
    await stage.waitForTimeout(500);
    const download = stage.getByRole('button', { name: /^Download \d/ });
    const box = await download.boundingBox();
    if (box) await moveTo(stage, box.x + box.width / 2, box.y + box.height / 2);
    await download.click();
    await waitForModel(control, ['downloaded']);
    await stage.waitForTimeout(800);
  });

  await scene(ch('04-init'), 'stage', async () => {
    const start = stage.getByRole('button', { name: 'Start engine' });
    const box = await start.boundingBox();
    if (box) await moveTo(stage, box.x + box.width / 2, box.y + box.height / 2);
    await start.click();
    await waitForModel(control, ['ready']);
    await stage.waitForTimeout(1200);
  });

  // Selecting a paragraph with a real drag.
  const paragraph = article.locator('article p').nth(1);
  await scene(ch('05-select'), 'article', async () => {
    await article.evaluate(() => scrollTo({ top: 120 }));
    await article.waitForTimeout(400);
    const box = (await paragraph.boundingBox())!;
    await moveTo(article, box.x + 2, box.y + 4);
    await article.mouse.down();
    await article.mouse.move(box.x + box.width - 6, box.y + box.height - 6, { steps: 25 });
    await article.mouse.up();
  });

  let speaker = { x: 0, y: 0 };
  await scene(ch('06-speaker'), 'article', async () => {
    speaker = await article.evaluate(() => {
      const rects = [...getSelection()!.getRangeAt(0).getClientRects()].filter((r) => r.width > 0);
      const last = rects.at(-1)!;
      return { x: Math.min(last.right, innerWidth - 27), y: Math.min(last.bottom + 8 + 19, innerHeight - 27) };
    });
    await article.waitForTimeout(500);
    await moveTo(article, speaker.x, speaker.y);
  });

  await scene(ch('07-listen'), 'article', async () => {
    await article.mouse.click(speaker.x, speaker.y);
    return logReading(worker, 30_000, (state) => state.status === 'ended');
  });

  // Player geometry (compact player, bottom-right, 1280×720 viewport).
  const player = { next: { x: 1042, y: 670 }, play: { x: 1003, y: 670 }, nextBlock: { x: 1073, y: 670 } };
  await scene(ch('08-controls'), 'article', async () => {
    await bg(control, 'tab/read', { tabId, mode: 'page', startSentence: 6 });
    await waitPlaying(worker);
    await article.waitForTimeout(800);
    await moveTo(article, player.next.x, player.next.y);
    await article.mouse.click(player.next.x, player.next.y);
    await article.waitForTimeout(1500);
    await moveTo(article, player.nextBlock.x, player.nextBlock.y);
    await article.mouse.click(player.nextBlock.x, player.nextBlock.y);
    await article.waitForTimeout(1500);
    await moveTo(article, player.play.x, player.play.y);
    await article.mouse.click(player.play.x, player.play.y);
    await article.waitForTimeout(1200);
    await article.mouse.click(player.play.x, player.play.y);
  });

  await scene(ch('09-voice'), 'stage', async () => {
    await showPopup(stage, id, tabId);
    await stage.getByRole('button', { name: 'Voices' }).click();
    await stage.waitForTimeout(700);
    const emma = stage.getByRole('button', { name: /Emma/ }).first();
    await emma.scrollIntoViewIfNeeded();
    const box = (await emma.boundingBox())!;
    await moveTo(stage, box.x + 60, box.y + box.height / 2);
    await emma.click();
    await stage.waitForTimeout(800);
  });

  await scene(ch('10-speed'), 'stage', async () => {
    await stage.getByRole('button', { name: 'Listen' }).click();
    await stage.waitForTimeout(600);
    const speed = stage.getByLabel('Playback speed').first();
    const box = (await speed.boundingBox())!;
    await moveTo(stage, box.x + box.width / 2, box.y + box.height / 2);
    await speed.selectOption('1.5');
    await stage.waitForTimeout(1200);
  });

  await scene(ch('11-highlight'), 'article', async () => {
    await moveTo(article, 300, 200);
  });

  await scene(ch('12-article'), 'stage', async (mark) => {
    await bg(control, 'session/control', { action: 'stop' });
    await bg(control, 'session/set', { voice: 'af_heart', rate: 1 });
    await showPopup(stage, id, tabId);
    mark.narrationAt();
    const read = stage.getByRole('button', { name: 'Read page' });
    const box = (await read.boundingBox())!;
    await moveTo(stage, box.x + box.width / 2, box.y + box.height / 2);
    await stage.waitForTimeout((narration['12-article'] ?? 2) * 1000 + 400);
    await read.click();
    await bringFront('article');
    await article.evaluate(() => scrollTo({ top: 0 }));
    return logReading(worker, 16_000);
  });

  // The Smart Reader tab is opened by the extension; it is recorded as its own stage.
  {
    await bg(control, 'session/control', { action: 'stop' });
    const opened = context.waitForEvent('page', (p) => p.url().includes('/reader/'));
    await bg(control, 'reader/open', { tabId });
    const reader = await opened;
    pages.set('reader', reader);
    await capture(context, reader, 'reader');
    await reader.waitForLoadState();
    await scene(ch('13-smart-reader'), 'reader', async () => {
      await reader.waitForTimeout(900);
      const toc = reader.getByRole('navigation', { name: 'Contents' }).getByRole('button').nth(3);
      const box = (await toc.boundingBox())!;
      await moveTo(reader, box.x + 40, box.y + box.height / 2);
      await toc.click();
      await reader.waitForTimeout(2500);
    });
    await bg(control, 'session/control', { action: 'stop' });
  }

  await scene(ch('14-queue'), 'stage', async () => {
    await showPopup(stage, id, tabId);
    const later = stage.getByRole('button', { name: 'Listen later' });
    const box = (await later.boundingBox())!;
    await moveTo(stage, box.x + box.width / 2, box.y + box.height / 2);
    await later.click();
    await stage.waitForTimeout(1500);
    await stage.getByRole('button', { name: 'Library' }).click();
    await stage.waitForTimeout(800);
  });

  await scene(ch('15-cross-tab'), 'stage', async () => {
    await stage.getByRole('button', { name: 'Play all' }).click();
    await stage.waitForTimeout(1500);
    await stage.goto(`${SITE}/wiki.html`);
    await stage.waitForTimeout(1800);
    await stage.goto(`chrome-extension://${id}/sidepanel/index.html`);
    await stage.addStyleTag({
      content: `html{background:#d9d4f5}body{max-width:400px;margin:0 0 0 auto!important;min-height:100vh;box-shadow:-10px 0 40px rgba(40,20,120,.18)}`,
    });
    await stage.waitForTimeout(800);
  });

  await scene(ch('16-custom'), 'stage', async () => {
    await bg(control, 'session/control', { action: 'stop' });
    await stage.goto(`chrome-extension://${id}/reader/index.html?mode=custom`);
    await stage.getByLabel('Title').pressSequentially('A note to myself', { delay: 35 });
    await stage.getByLabel('Text to read').pressSequentially('Remember to water the tomatoes before the weekend. The forecast says it will be hot and dry.', { delay: 25 });
    await stage.getByRole('button', { name: 'Continue' }).click();
    await stage.waitForTimeout(800);
  });

  await scene(ch('17-export'), 'stage', async () => {
    const exportButton = stage.getByRole('button', { name: /Export WAV/ });
    const box = (await exportButton.boundingBox())!;
    await moveTo(stage, box.x + box.width / 2, box.y + box.height / 2);
    await exportButton.click();
    await stage.getByText(/^Saved /).waitFor({ timeout: 60_000 });
    await stage.waitForTimeout(1200);
  });

  await scene(ch('18-privacy'), 'stage', async () => {
    await stage.goto(`chrome-extension://${id}/options/index.html#privacy`);
    await stage.waitForTimeout(1000);
    await moveTo(stage, 600, 300);
  });

  // Phase 3: export exactly what was read aloud, sentence by sentence, with the voice used.
  let n = 0;
  for (const recorded of scenes) {
    for (const event of recorded.reading) {
      const file = resolve(OUT, 'reading', `${String(n++).padStart(3, '0')}.wav`);
      (event as ReadingEvent & { file?: string; seconds?: number }).file = file;
      (event as ReadingEvent & { file?: string; seconds?: number }).seconds = await exportWav(control, event.text, file);
    }
  }

  const diagnostics = await control.evaluate(async () => (await chrome.storage.local.get('diagnostics')).diagnostics);
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  server.kill();

  writeFileSync(
    resolve(OUT, 'timeline.json'),
    JSON.stringify({ view: VIEW, narration, scenes, front, frames, diagnostics }, null, 2),
  );
  console.log(`Timeline written to ${resolve(OUT, 'timeline.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
