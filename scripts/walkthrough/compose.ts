/**
 * Composes the walkthrough MP4 from the recording made by record.ts:
 * chapter title cards, burned-in captions and chapter badges (rendered as
 * transparent PNGs, since this ffmpeg build has no drawtext/libass), Kokoro
 * narration, the extension's reading audio aligned to the recorded sentence
 * timestamps, short fades, chapter metadata and a soft subtitle track.
 *
 *   node scripts/walkthrough/compose.ts   →   docs/walkthrough/kokoro-reader-walkthrough.mp4
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAPTERS } from './chapters.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = resolve(ROOT, '.cache/walkthrough');
const PARTS = resolve(WORK, 'parts');
const OVERLAYS = resolve(WORK, 'overlays');
const OUT_DIR = resolve(ROOT, 'docs/walkthrough');
const W = 1280;
const H = 720;
const FPS = 30;

interface ReadingEvent {
  t: number;
  index: number;
  text: string;
  file: string;
  seconds: number;
}
interface Scene {
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
interface Timeline {
  narration: Record<string, number>;
  scenes: Scene[];
  front: { t: number; page: string }[];
  frames: Frame[];
}

/**
 * Builds a constant-frame-rate clip for [start, end) from screencast frames
 * of whichever page was in front at each moment.
 */
function sceneClip(start: number, end: number, out: string) {
  const activeAt = (t: number) => [...timeline.front].reverse().find((entry) => entry.t <= t)?.page ?? timeline.front[0]!.page;
  const byPage = new Map<string, Frame[]>();
  for (const frame of timeline.frames) byPage.set(frame.page, [...(byPage.get(frame.page) ?? []), frame]);
  for (const list of byPage.values()) list.sort((a, b) => a.t - b.t);
  const lines: string[] = [];
  const step = 1000 / FPS;
  let previous: string | null = null;
  let run = 0;
  const flush = () => {
    if (previous) lines.push(`file '${previous}'`, `duration ${(run / 1000).toFixed(4)}`);
  };
  for (let t = start; t < end; t += step) {
    const list = byPage.get(activeAt(t)) ?? [];
    let chosen: Frame | undefined;
    for (const frame of list) {
      if (frame.t <= t) chosen = frame;
      else break;
    }
    const file = (chosen ?? list[0])?.file ?? null;
    if (file === previous) run += step;
    else {
      flush();
      previous = file;
      run = step;
    }
  }
  flush();
  if (previous) lines.push(`file '${previous}'`);
  const list = `${out}.txt`;
  writeFileSync(list, lines.join('\n'));
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-t', ((end - start) / 1000).toFixed(3), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', out]);
}

const timeline = JSON.parse(readFileSync(resolve(WORK, 'timeline.json'), 'utf8')) as Timeline;

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Helvetica, sans-serif`;

function overlayHtml(chapterNo: number, title: string, caption: string, speaker?: string) {
  return `<html><body style="margin:0;width:${W}px;height:${H}px;background:transparent;font-family:${FONT}">
  <div style="position:absolute;top:18px;left:18px;display:flex;align-items:center;gap:10px;padding:7px 14px 7px 8px;border-radius:999px;background:rgba(20,16,40,.72);backdrop-filter:blur(10px);color:#fff;font-size:15px;font-weight:600;box-shadow:0 4px 18px rgba(0,0,0,.25)">
    <span style="display:inline-grid;place-items:center;min-width:28px;height:28px;border-radius:999px;background:linear-gradient(135deg,#9b8cff,#5b3fd1);font-size:13px">${chapterNo}</span>${escapeHtml(title)}
  </div>
  ${
    caption
      ? `<div style="position:absolute;left:50%;bottom:30px;transform:translateX(-50%);max-width:980px;padding:12px 22px;border-radius:14px;background:rgba(12,10,24,.78);color:#fff;font-size:24px;line-height:1.35;text-align:center;font-weight:500;box-shadow:0 6px 24px rgba(0,0,0,.3)">
      ${speaker ? `<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b9adff;margin-bottom:4px">${escapeHtml(speaker)}</div>` : ''}${escapeHtml(caption)}</div>`
      : ''
  }
  </body></html>`;
}

function cardHtml(title: string, subtitle: string, footer: string) {
  return `<html><body style="margin:0;width:${W}px;height:${H}px;font-family:${FONT};display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;
    background:radial-gradient(circle at 30% 25%,#7c66ff 0%,#4b33c4 45%,#1d1442 100%)">
    <svg width="132" height="132" viewBox="0 0 128 128" style="filter:drop-shadow(0 18px 40px rgba(0,0,0,.35))">${readFileSync(resolve(ROOT, 'public/icons/icon.svg'), 'utf8').replace(/<\/?svg[^>]*>/g, '')}</svg>
    <div style="margin-top:34px;font-size:68px;font-weight:700;letter-spacing:-.02em">${escapeHtml(title)}</div>
    <div style="margin-top:14px;font-size:27px;opacity:.88;max-width:900px;text-align:center;line-height:1.35">${escapeHtml(subtitle)}</div>
    <div style="position:absolute;bottom:34px;font-size:16px;opacity:.7;letter-spacing:.02em">${escapeHtml(footer)}</div>
  </body></html>`;
}

interface Segment {
  file: string;
  from: number;
  to: number;
  caption: string;
}

async function main() {
  rmSync(PARTS, { recursive: true, force: true });
  rmSync(OVERLAYS, { recursive: true, force: true });
  mkdirSync(PARTS, { recursive: true });
  mkdirSync(OVERLAYS, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const png = async (html: string, file: string, transparent = true) => {
    await page.setContent(html);
    await page.screenshot({ path: file, omitBackground: transparent });
  };

  const parts: string[] = [];
  const subtitles: { from: number; to: number; text: string }[] = [];
  const chapters: { title: string; from: number; to: number }[] = [];
  let clock = 0;

  for (const [index, chapter] of CHAPTERS.entries()) {
    const no = index + 1;
    const out = resolve(PARTS, `${chapter.id}.mp4`);
    const narrationFile = resolve(WORK, 'narration', `${chapter.id}.wav`);
    const narrationSeconds = timeline.narration[chapter.id] ?? 0;
    let duration: number;
    const segments: Segment[] = [];
    const audio: { file: string; at: number }[] = [];
    const videoArgs: string[] = [];

    if (chapter.card) {
      duration = narrationSeconds + 1.6;
      const file = resolve(OVERLAYS, `${chapter.id}-card.png`);
      await png(
        cardHtml(
          'Kokoro Reader',
          chapter.id === '01-intro' ? 'Natural AI speech for any webpage, generated privately on your computer.' : 'Natural speech for the whole web, private by design.',
          chapter.id === '01-intro' ? 'Chrome extension · Kokoro-82M running locally with ONNX Runtime Web' : 'github.com/SurajMazar/kokoro-reader',
        ),
        file,
        false,
      );
      videoArgs.push('-loop', '1', '-framerate', String(FPS), '-t', duration.toFixed(3), '-i', file);
      audio.push({ file: narrationFile, at: 0.6 });
      subtitles.push({ from: clock + 0.6, to: clock + 0.6 + narrationSeconds, text: chapter.narration! });
      const caption = resolve(OVERLAYS, `${chapter.id}-0.png`);
      await png(overlayHtml(no, chapter.title, ''), caption);
    } else {
      const scene = timeline.scenes.find((item) => item.id === chapter.id);
      if (!scene) throw new Error(`No recording for ${chapter.id}`);
      duration = (scene.end - scene.start) / 1000;
      const clip = resolve(PARTS, `${chapter.id}-raw.mp4`);
      sceneClip(scene.start, scene.end, clip);
      // A long real wait (the model download on a slow connection) is shown at
      // 4× after the narration, with a label saying so and the real duration.
      const keep = (narrationSeconds || 0) + scene.narrationOffset + 1;
      if (chapter.id === '03-download' && duration > keep + 8) {
        const real = duration - keep;
        const fast = resolve(PARTS, `${chapter.id}-fast.mp4`);
        ffmpeg(['-i', clip, '-filter_complex', `[0:v]trim=0:${keep.toFixed(3)},setpts=PTS-STARTPTS[a];[0:v]trim=${keep.toFixed(3)},setpts=(PTS-STARTPTS)/4[b];[a][b]concat=n=2:v=1:a=0,fps=${FPS}[v]`, '-map', '[v]', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', fast]);
        duration = keep + real / 4;
        segments.push({ file: '', from: keep, to: duration, caption: `Download shown at 4× speed (it took ${Math.round(real + keep)} s on this connection)` });
        videoArgs.push('-i', fast);
      } else {
        videoArgs.push('-i', clip);
      }

      const firstReading = scene.reading[0] ? (scene.reading[0].t - scene.start) / 1000 : duration;
      if (chapter.narration) {
        const from = scene.narrationOffset;
        const to = Math.min(scene.reading.length ? firstReading : duration, from + narrationSeconds + 0.3);
        segments.push({ file: '', from, to, caption: chapter.narration });
        audio.push({ file: narrationFile, at: from });
        subtitles.push({ from: clock + from, to: clock + from + narrationSeconds, text: chapter.narration });
      } else if (scene.reading.length) {
        segments.push({ file: '', from: 0, to: firstReading, caption: 'Generating speech on this computer…' });
      }
      scene.reading.forEach((event, i) => {
        const from = (event.t - scene.start) / 1000;
        const next = scene.reading[i + 1];
        const to = Math.min(duration, next ? (next.t - scene.start) / 1000 : from + event.seconds + 0.2);
        segments.push({ file: '', from, to, caption: event.text });
        audio.push({ file: event.file, at: from });
        subtitles.push({ from: clock + from, to: clock + to, text: event.text });
      });
    }

    // Render overlay images: one per caption segment, plus a badge-only default.
    const base = resolve(OVERLAYS, `${chapter.id}-base.png`);
    await png(overlayHtml(no, chapter.title, ''), base);
    for (const [i, segment] of segments.entries()) {
      segment.file = resolve(OVERLAYS, `${chapter.id}-${i + 1}.png`);
      const isReading = Boolean(chapter.reading) && segment.caption !== chapter.narration && segment.caption !== 'Generating speech on this computer…';
      await png(overlayHtml(no, chapter.title, segment.caption, isReading ? 'Kokoro Reader is reading · voice Heart' : undefined), segment.file);
    }

    const inputs = [...videoArgs];
    const overlayInputs = chapter.card ? [] : [base, ...segments.map((s) => s.file)];
    for (const file of overlayInputs) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', duration.toFixed(3), '-i', file);
    for (const item of audio) inputs.push('-i', item.file);

    const filters: string[] = [];
    filters.push(`[0:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p,setpts=PTS-STARTPTS[v0]`);
    let last = 'v0';
    if (!chapter.card) {
      filters.push(`[${last}][1:v]overlay=0:0:shortest=1[vb]`);
      last = 'vb';
      segments.forEach((segment, i) => {
        const label = `vs${i}`;
        filters.push(`[${last}][${i + 2}:v]overlay=0:0:enable='between(t,${segment.from.toFixed(2)},${segment.to.toFixed(2)})'[${label}]`);
        last = label;
      });
    }
    filters.push(`[${last}]fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0, duration - 0.25).toFixed(2)}:d=0.25[vout]`);

    const firstAudio = 1 + overlayInputs.length;
    const audioLabels = audio.map((item, i) => {
      const label = `a${i}`;
      const delay = Math.max(0, Math.round(item.at * 1000));
      filters.push(`[${firstAudio + i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}|${delay}[${label}]`);
      return `[${label}]`;
    });
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration.toFixed(3)}[silence]`);
    filters.push(`[silence]${audioLabels.join('')}amix=inputs=${audioLabels.length + 1}:normalize=0:duration=first,afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, duration - 0.3).toFixed(2)}:d=0.3[aout]`);

    ffmpeg([
      ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      '-t', duration.toFixed(3),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
      out,
    ]);
    parts.push(out);
    rmSync(resolve(PARTS, `${chapter.id}-raw.mp4`), { force: true });
    chapters.push({ title: `${no}. ${chapter.title}`, from: clock, to: clock + duration });
    clock += duration;
    console.log(`composed ${chapter.id} (${duration.toFixed(1)} s)`);
  }
  await browser.close();

  // Concatenate, then add chapters and a soft subtitle track.
  const list = resolve(WORK, 'parts.txt');
  writeFileSync(list, parts.map((file) => `file '${file}'`).join('\n'));
  const joined = resolve(WORK, 'joined.mp4');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

  const stamp = (t: number) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  const srt = subtitles.map((item, i) => `${i + 1}\n${stamp(item.from)} --> ${stamp(item.to)}\n${item.text}\n`).join('\n');
  const srtFile = resolve(OUT_DIR, 'kokoro-reader-walkthrough.srt');
  writeFileSync(srtFile, srt);
  const meta = [';FFMETADATA1', 'title=Kokoro Reader walkthrough', 'artist=Kokoro Reader (narration: Kokoro-82M, voice af_heart)']
    .concat(chapters.flatMap((c) => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.from * 1000)}`, `END=${Math.round(c.to * 1000)}`, `title=${c.title}`]))
    .join('\n');
  const metaFile = resolve(WORK, 'chapters.txt');
  writeFileSync(metaFile, meta);
  const final = resolve(OUT_DIR, 'kokoro-reader-walkthrough.mp4');
  ffmpeg([
    '-i', joined, '-i', srtFile, '-i', metaFile,
    '-map', '0:v', '-map', '0:a', '-map', '1:s', '-map_metadata', '2', '-map_chapters', '2',
    '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
    '-movflags', '+faststart', final,
  ]);
  const chaptersMd = chapters.map((c) => `- ${stamp(c.from).slice(3, 8)} ${c.title}`).join('\n');
  writeFileSync(resolve(OUT_DIR, 'CHAPTERS.md'), `# Walkthrough chapters\n\n${chaptersMd}\n`);
  console.log(`\n${final} (${clock.toFixed(1)} s)\n${chaptersMd}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
