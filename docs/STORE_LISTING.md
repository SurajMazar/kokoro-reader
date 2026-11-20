# Chrome Web Store listing

**Live listing:** https://chromewebstore.google.com/detail/kokoro-reader/jjkkkegnnbehafabbhbolcdnfcjniamj (item ID `jjkkkegnnbehafabbhbolcdnfcjniamj`)

**Name:** Kokoro Reader

**Short description (≤132 chars):**
Listen to any webpage with natural AI speech generated privately on your device by Kokoro-82M.

**Category:** Accessibility (alternatively: Productivity)

**Language:** English (listing). The extension reads English and Nepali.

## Description

Kokoro Reader turns any webpage into audio with a natural, expressive AI voice, and it runs entirely on your computer.

Select a paragraph and click the speaker. Right-click to read a whole page. Open long articles in a clean Smart Reader and listen like an audiobook, with every sentence highlighted as it is spoken.

PRIVATE BY DESIGN
• Speech is generated locally by the open Kokoro-82M model. Your text never leaves your device.
• No accounts, no subscriptions, no analytics, no tracking.
• The model downloads once (from 89 MB), is verified by checksum, and then works offline.

LISTEN YOUR WAY
• Speaker button next to any selection, or right-click → Read with Kokoro
• Read entire pages, or start from any paragraph
• Smart Reader with table of contents and progress
• 28 English voices (US and UK), favorites and voice profiles
• 19 Nepali voices: Nepali text is detected and read automatically, even on pages that mix Nepali and English
• Speed from 0.5× to 3× with natural pitch
• Sentence and paragraph highlighting that follows along
• Keeps playing when you switch tabs; control it from the popup or side panel
• Listen Later queue, bookmarks and resume
• Paste your own text and export it as a WAV file
• Keyboard shortcuts, dark mode, screen reader labels, reduced motion

FAST
Kokoro Reader uses WebGPU when your device supports it, and multithreaded WebAssembly otherwise. On a modern laptop it speaks faster than real time.

Kokoro Reader reads English and Nepali text.

## Screenshots (1280×800)

Generated from the real extension by `npm run screenshots` into `docs/screenshots/`:
1. `in-page-player-light.png` — sentence highlighting and the in-page player
2. `smart-reader-light.png` — Smart Reader
3. `popup-light.png` — popup
4. `options-engine-light.png` — on-device AI engine settings
5. `smart-reader-dark.png` — dark mode

## Privacy practices

See [PERMISSIONS.md](PERMISSIONS.md) for the single purpose, permission justifications, remote-code and data-usage answers, and [../PRIVACY.md](../PRIVACY.md) for the privacy policy URL content.

## Versioning

`package.json` and `manifest.json` share one semantic version. Tag `vX.Y.Z` to build a release ZIP through GitHub Actions; upload that ZIP in the Developer Dashboard. The extension has not been published to the Chrome Web Store.
