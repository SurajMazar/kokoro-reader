import './style.css';
import { createWorld, type World } from './world';

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = window.matchMedia('(max-width: 760px)').matches || navigator.maxTouchPoints > 1;

/** Voice samples, recorded with Kokoro Reader's own WAV export. */
const SAMPLES: Record<string, { name: string; text: string }> = {
  af_heart: { name: 'Heart', text: "Hi, I'm Kokoro Reader. Select any text on the web, click the speaker, and I'll read it to you, privately, right here on your computer." },
  bf_emma: { name: 'Emma', text: 'Long articles become audiobooks. Every sentence lights up as it is spoken, so you never lose your place.' },
  ne_chitwan: { name: 'Chitwan', text: 'नमस्ते! म कोकोरो रिडर हुँ। म नेपाली समाचार पनि पढेर सुनाउँछु, तपाईंकै कम्प्युटरमा।' },
  ne_google_05: { name: 'Speaker 5', text: 'हिमालदेखि तराईसम्मका कथाहरू, अब सजिलै सुन्न सकिन्छ।' },
};
/** What the orb says at each stop when clicked. */
const ORB_VOICE = ['af_heart', 'bf_emma', 'ne_chitwan', 'af_heart', 'bf_emma', 'ne_google_05'];

const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const audio = document.querySelector<HTMLAudioElement>('#voice')!;
const caption = document.querySelector<HTMLElement>('.caption')!;
const sections = [...document.querySelectorAll<HTMLElement>('.stop')];
const dots = [...document.querySelectorAll<HTMLElement>('.progress li')];
const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.bar nav a')];

let world: World | null = null;
try {
  world = createWorld(canvas, { reducedMotion, mobile, asset });
} catch {
  world = null;
}
if (!world) document.documentElement.classList.add('no-webgl');

// ---------------------------------------------------------------- scroll → flight

/** Scroll position at which each stop is centred in the viewport. */
let anchors: number[] = [];
const measure = () => {
  anchors = sections.map((section) => Math.max(0, section.offsetTop + section.offsetHeight / 2 - window.innerHeight / 2));
  anchors[0] = 0;
  anchors[anchors.length - 1] = Math.max(anchors[anchors.length - 2]! + 1, document.documentElement.scrollHeight - window.innerHeight);
};

const onScroll = () => {
  const y = window.scrollY;
  let stop = 0;
  while (stop < anchors.length - 2 && y > anchors[stop + 1]!) stop++;
  const span = anchors[stop + 1]! - anchors[stop]!;
  const local = Math.min(1, Math.max(0, (y - anchors[stop]!) / (span || 1)));
  // Linger at each stop a little: ease the in-between.
  const eased = local < 0.5 ? 2 * local * local : 1 - (-2 * local + 2) ** 2 / 2;
  const progress = (stop + eased) / (anchors.length - 1);
  world?.setProgress(progress);
  const current = Math.round(progress * (anchors.length - 1));
  dots.forEach((dot, i) => dot.classList.toggle('on', i === current));
  navLinks.forEach((link) => link.classList.toggle('active', link.hash === `#${sections[current]?.id}`));
};

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', () => {
  measure();
  onScroll();
});
measure();
onScroll();
document.fonts?.ready.then(() => {
  measure();
  onScroll();
});

// Cards rise into view.
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add('in');
  },
  { threshold: 0.25 },
);
document.querySelectorAll('.card').forEach((card) => observer.observe(card));

// ---------------------------------------------------------------- voices

let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let playing: string | null = null;
const chips = [...document.querySelectorAll<HTMLButtonElement>('.chip[data-voice]')];

function setPressed(voice: string | null) {
  chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.voice === voice)));
}

function connectAnalyser() {
  if (analyser) return;
  try {
    context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(context.destination);
  } catch {
    analyser = null;
  }
}

async function play(voice: string) {
  if (playing === voice && !audio.paused) {
    audio.pause();
    return;
  }
  connectAnalyser();
  await context?.resume().catch(() => undefined);
  playing = voice;
  audio.src = asset(`audio/${voice}.mp3`);
  setPressed(voice);
  caption.textContent = `“${SAMPLES[voice]!.text}”`;
  caption.lang = voice.startsWith('ne_') ? 'ne' : 'en';
  try {
    await audio.play();
  } catch {
    setPressed(null);
    playing = null;
  }
}

audio.addEventListener('pause', () => {
  setPressed(null);
  playing = null;
});
audio.addEventListener('ended', () => {
  setPressed(null);
  playing = null;
});
chips.forEach((chip) => chip.addEventListener('click', () => void play(chip.dataset.voice!)));
world?.onOrbClick((stop) => void play(ORB_VOICE[stop] ?? 'af_heart'));

// Loudness → the world reacts to the voice.
const bins = new Uint8Array(128);
const tick = () => {
  if (analyser && !audio.paused) {
    analyser.getByteFrequencyData(bins);
    let sum = 0;
    for (let i = 2; i < 48; i++) sum += bins[i]!;
    world?.setLevel(Math.min(1, (sum / 46 / 255) * 1.8));
  } else {
    world?.setLevel(0);
  }
  requestAnimationFrame(tick);
};
tick();
