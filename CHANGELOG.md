# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/): the extension's `manifest.json` version always equals `package.json`'s.

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
