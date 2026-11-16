/** Chapters of the product walkthrough video. Narration is spoken by Kokoro (voice af_heart) through the extension itself. */
export interface Chapter {
  id: string;
  title: string;
  narration?: string;
  /** Scenes that play the extension's real reading audio instead of (or after) narration. */
  reading?: boolean;
  card?: boolean;
}

export const CHAPTERS: Chapter[] = [
  { id: '01-intro', title: 'Kokoro Reader', card: true, narration: 'This is Kokoro Reader, a Chrome extension that reads any webpage aloud with natural AI speech, generated privately on your own computer.' },
  { id: '02-install', title: 'Installing the extension', narration: "Install it from the release zip. Open Chrome's extensions page, turn on developer mode, and load the unpacked folder." },
  { id: '03-download', title: 'First-time model download', narration: 'The first time, Kokoro Reader downloads the eighty-nine megabyte voice model once, from a pinned version, and checks every file before using it.' },
  { id: '04-init', title: 'Model initialization', narration: 'The model then starts on your device. A real test sentence decides the engine: WebAssembly, or WebGPU on supported graphics.' },
  { id: '05-select', title: 'Selecting text on a website', narration: 'Now open any article and select a paragraph.' },
  { id: '06-speaker', title: 'Floating speaker button', narration: 'A small speaker appears right next to your selection.' },
  { id: '07-listen', title: 'Listening to a paragraph', reading: true },
  { id: '08-controls', title: 'Floating player controls', narration: 'The floating player lets you pause, skip by sentence or paragraph, and jump anywhere in the article.' },
  { id: '09-voice', title: 'Changing voice', narration: 'Pick from twenty-eight English voices. Preview them, mark favorites, and switch while you listen.' },
  { id: '10-speed', title: 'Adjusting playback speed', narration: 'Change the speed from half to three times, instantly, with natural pitch.' },
  { id: '11-highlight', title: 'Sentence highlighting', narration: 'Every sentence is highlighted as it is spoken, and the page scrolls to follow along.' },
  { id: '12-article', title: 'Reading an entire article', narration: 'To hear a whole article, click Read page.', reading: true },
  { id: '13-smart-reader', title: 'Distraction-free Smart Reader', narration: 'Smart Reader turns cluttered pages into a clean reading view, with a table of contents and progress.' },
  { id: '14-queue', title: 'Reading queue', narration: 'Save articles to Listen Later, and they play back to back, like an audiobook playlist.' },
  { id: '15-cross-tab', title: 'Cross-tab playback', narration: 'Playback keeps going while you browse other tabs, and the side panel keeps the controls close.' },
  { id: '16-custom', title: 'Custom text reader', narration: 'You can also paste your own text, or import a text, markdown, or HTML file,' },
  { id: '17-export', title: 'Exporting audio', narration: 'and save the speech as a WAV file.' },
  { id: '18-privacy', title: 'Settings and privacy', narration: 'Everything runs on your device. No account, no tracking, and your text never leaves your computer.' },
  { id: '19-outro', title: 'Kokoro Reader', card: true, narration: 'Kokoro Reader. Natural speech for the whole web, private by design.' },
];
