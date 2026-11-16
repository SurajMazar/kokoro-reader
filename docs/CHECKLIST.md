# Development checklist

Status of every requirement in the product brief. ✅ done and verified · 🟡 done with a documented limitation · ⬜ not done.

## Core (definition of done)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Install unpacked; no model download until needed | ✅ | `downloadModelOnInstall` off by default; persistence E2E starts at `not-downloaded` |
| Select paragraph → floating speaker → click → download if needed → real ONNX inference → speech | ✅ | `tests/e2e/inference.spec.ts` (fresh profile, real model) |
| Read Page: main content extracted, progressive speech, sentence highlighting, navigation, speed, pause/resume | ✅ | `reading.spec.ts` (first two tests) |
| Cross-tab playback with popup closed | ✅ | `reading.spec.ts` › background playback |
| Paste custom text → voice → generate → download valid WAV | ✅ | `reading.spec.ts` › custom text (RIFF header, duration, non-silent) |
| Model cache survives Chrome restart; corrupted cache detected and recovered | ✅ | `persistence.spec.ts` |
| Failed downloads can be retried; resumable | ✅ | `tests/integration/model-store.test.ts` (Range resume) |
| Sessions cancel safely; no stale audio | ✅ | `playback.test.ts`, `reading.spec.ts` › replaces old session |
| Production build, packaging, manifest validation | ✅ | `npm run build`, `npm run package`, `scripts/validate-manifest.ts` |

## Features

| Feature | Status | Notes |
| --- | --- | --- |
| Selection detection (mouse, trackpad, keyboard, multi-paragraph, updates, clearing) | ✅ | Event-driven; no polling |
| Floating button: positioning, viewport edges, RTL, scroll containers, Shadow DOM, keyboard focusable | ✅ | E2E checks placement via `elementFromPoint` |
| Selection settings (delay, min words, icon/toolbar, auto-play, confirm) | ✅ | Options → Reading |
| Context menu (read selection, read page, from here, Smart Reader, Listen Later, stop) | 🟡 | Implemented; Playwright cannot open native context menus, so the shared code paths are tested instead |
| Keyboard shortcuts (7 commands, 4 with defaults) | 🟡 | Implemented; Chrome commands cannot be triggered from Playwright |
| Smart Reader (Readability) + fallback extraction | ✅ | jsdom + E2E |
| Read entire page in DOM order; from heading / paragraph / last position | ✅ | TOC click, "Read page from here", history resume |
| Kokoro engine via ONNX Runtime Web, WebGPU → WASM fallback by real test | ✅ | Integration test for fallback logic; E2E on WASM |
| WebGPU inference verified on hardware | 🟡 | Fallback logic tested; headless CI Chromium has no GPU. Choose fp32 + WebGPU on a GPU machine to use it |
| Model manager: download, pause, resume, retry, validate, clear, re-download, size, backend, last used | ✅ | Options → AI Engine / Model Storage |
| Version migration | 🟡 | Cache name and manifest are versioned (`kokoro-reader-models-v1`, pinned revision); no second version exists yet to migrate from |
| Voices: real catalogue, preview, favorites, recents, default, search, language filter | ✅ | 28 English voices with author-published grades |
| Text preprocessing: Unicode, whitespace, sentences, numbers, abbreviations, URLs, e-mails, punctuation, language check | ✅ | `tests/unit/text.test.ts`, `speech.test.ts` |
| Token-aware chunking within the 510-token limit | ✅ | Worker splits recursively at clause boundaries |
| Producer–consumer pipeline with priorities and cancellation | ✅ | `SynthesisQueue` tests |
| Player: compact, expanded, minimized, side panel | ✅ | |
| Controls: play, pause, resume, stop, sentence ±, paragraph ±, seek, volume, speed 0.5–3×, voice, minimize, close | ✅ | |
| Speed via pitch-preserving playbackRate | ✅ | No regeneration (unit test) |
| Highlight sentence + paragraph, toggleable, auto-scroll that yields to manual scrolling | ✅ | CSS Custom Highlight API |
| Background playback across popup close, tab switch, service worker suspension, offscreen termination | ✅ | E2E restore test |
| Popup (Listen, Voices, Library, Settings) | ✅ | |
| Options (General, Reading, Audio, Voices, AI Engine, Model Storage, Shortcuts, Privacy, Accessibility, Advanced, About) + reset | ✅ | |
| Reading queue (add, remove, reorder, play next, clear, persistence) | ✅ | |
| History (optional), bookmarks (save, resume, rename, delete) | ✅ | |
| Import TXT / Markdown / HTML; unsupported formats explained | ✅ | PDF/DOCX not parsed (explained in UI) |
| WAV export with metadata (LIST/INFO) | ✅ | |
| Voice profiles | ✅ | Defaults for docs, news, novels, casual |
| Browser speech as an explicit, labelled fallback | 🟡 | Implemented in the offscreen document; not covered by E2E (headless Chromium has no system voices) |
| Accessibility: labels, keyboard, focus, reduced motion, high-contrast highlight, RTL extraction | ✅ | RTL test, RTL unit test |
| Languages beyond English | ⬜ | Deliberately out of scope (decision record #10) |

## Engineering

| Item | Status |
| --- | --- |
| TypeScript strict, ESLint (no eval / new Function), Prettier | ✅ |
| Unit + integration tests (Vitest, RTL, jsdom, fake-indexeddb) | ✅ 69 |
| E2E in real Chromium with the built extension and real inference | ✅ 11 |
| GitHub Actions: CI (typecheck, lint, tests, build, audit, package, E2E) and tag release | ✅ |
| Pinned dependencies and model artifacts; no weights in git | ✅ |
| Measured performance | ✅ `docs/performance/` |
| Store listing, permission justifications, privacy policy, screenshots | ✅ |
| Walkthrough video (real recording, Kokoro narration, captions, chapters) | ✅ `docs/walkthrough/` |
| CI/CD: build on every main push, rolling "latest" pre-release, tagged releases | ✅ |
