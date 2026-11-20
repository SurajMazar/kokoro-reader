# Changelog

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/kokoro-reader/jjkkkegnnbehafabbhbolcdnfcjniamj). All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/): the extension's `manifest.json` version always equals `package.json`'s.

## 0.3.0 — 2026-11-20

### Fixed: reading Nepali news sites
- **Read page** now finds the article on real news layouts: the deepest element holding most of the page's prose, with the headline read first. Before, onlinekhabar started with a live cricket score and a news ticker, ekantipur stopped after the first 3 of 36 paragraphs (its story is split into 12 sections), and setopati skipped the story entirely (its body is inside an `<aside>`).
- On a mostly-Nepali page, scores, "vs" and short English fragments stay with the Nepali voice instead of switching engines (and downloading the 92 MB English model) for a scrap of text.
- The player shows what it is waiting for: "Downloading the Nepali voice 35% · 21 MB of 60 MB (first use only)" instead of a bare "Preparing voice…", also when the download starts mid-reading.
- The player names the voice actually reading (Chitwan on a Nepali sentence), not the main English voice.

### Updates for unpacked installs
- Copies loaded unpacked (which Chrome cannot update) check GitHub once a day for a newer version and show how to update in place, keeping settings and downloaded voices. Web Store copies never check; Chrome updates them.

## 0.2.0 — 2026-11-18

### Nepali
- 19 Nepali voices from Piper (`rhasspy/piper-voices`): Chitwan (male, CC0) and 18 OpenSLR speakers (female, CC-BY-SA-4.0), in two voice packs that download on first use and can be deleted.
- Automatic voice per sentence: Devanagari sentences are read by the Nepali voice, everything else by the main voice. Pages mixing Nepali and English switch voices as they read.
- espeak-ng built from source to WebAssembly with only the Nepali and English data (1.2 MB), at the commit Piper's voices were trained with.
- Danda (।) ends a sentence; ASCII digits in Nepali text are read in Nepali.
- WAV export of mixed text resamples to one 24 kHz file.
- Tests: 93 unit and integration tests (phonemes checked against native espeak-ng, phoneme ids against piper-tts); 14 end-to-end tests including real Nepali inference.

### Fixed
- A model status refresh that overlapped a finishing download could report the model as still downloading.

## 0.1.0 — 2026-11-16

First release.

### Listening
- Floating speaker button on text selection (icon or compact toolbar), with configurable delay, minimum length and confirm-before-reading.
- Right-click: read selection, read page from here, read entire page, open in Smart Reader, add to Listen Later, stop.
- Read entire page (main content, in DOM order, skipping navigation, ads, cookie banners, hidden and related content).
- Smart Reader: Mozilla Readability extraction, distraction-free layout, table of contents, progress and remaining time.
- Custom text: paste, type, or import .txt/.md/.html; export WAV.
- Sentence and paragraph highlighting with the CSS Custom Highlight API; auto-scroll that yields to manual scrolling.
- In-page player (mini, compact, expanded), popup player, side panel player.
- Next/previous sentence and paragraph, seek, pause/resume, speed 0.5–3× with pitch preserved, volume, voice switching.
- Listen Later queue (audiobook-style playlist), bookmarks, optional local history with resume.
- Voice profiles for docs, news, novels and casual reading.
- Keyboard shortcuts via Chrome's commands.

### Engine
- Kokoro-82M v1.0 ONNX (q8 default; fp16 and fp32 optional), pinned revision with SHA-256 verification.
- Resumable downloads (pause/resume/retry), validation, cache clearing.
- WebGPU with automatic fallback to multithreaded WebAssembly, chosen by a real test inference.
- Token-aware sentence splitting within the model's 510-token limit.
- Optional, clearly labelled browser speech engine.

### Quality
- 73 unit and integration tests; 11 end-to-end tests in real Chromium with real inference.
- Measured performance and Whisper-verified speech quality in `docs/performance/`.
- Walkthrough video in `docs/walkthrough/`.
- CI/CD: checks and E2E on every push and pull request; every push to main publishes a rolling "latest" pre-release; `v*` tags publish versioned releases.
