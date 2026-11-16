# Architecture

Kokoro Reader is a Manifest V3 Chrome extension that turns web text into speech with the Kokoro-82M model, running entirely on the user's device. This document describes how the pieces fit together and records the technical decisions behind them.

## Contexts and responsibilities

```
 ┌──────────────── web page (isolated world) ────────────────┐
 │ content.js  (IIFE, 48 KB)                                  │
 │  selection detector → floating speaker (closed Shadow DOM) │
 │  live-DOM extraction + text maps → CSS Custom Highlights   │
 │  in-page floating player                                   │
 └───────────────▲───────────────────────────┬────────────────┘
                 │ content/session, highlight│ session/start (allow-listed)
 ┌───────────────┴───────────────────────────▼────────────────┐
 │ background.js  (MV3 service worker, stateless)             │
 │  message router · session coordinator · context menus      │
 │  commands · permissions · offscreen lifecycle · history    │
 │  state mirrored to chrome.storage.session / .local         │
 └───────────────▲───────────────────────────┬────────────────┘
   playback/state│ model/state               │ offscreen/*
 ┌───────────────┴───────────────────────────▼────────────────┐
 │ offscreen document  (AUDIO_PLAYBACK + WORKERS)             │
 │  PlaybackController: sentence queue → WAV clips → <audio>  │
 │  ModelManager: download, verify, cache, init, fallback     │
 │  BrowserSpeechProvider (optional, explicit fallback)       │
 │      │ postMessage (transferable Float32Array)             │
 │  kokoro.worker.ts (Web Worker)                             │
 │   phonemizer (espeak-ng WASM) → tokenizer → ONNX Runtime   │
 │   Web (WebGPU or multithreaded WASM) → 24 kHz PCM          │
 └────────────────────────────────────────────────────────────┘
 Extension pages: popup · options · Smart Reader · side panel · welcome
 (React + Tailwind; they read state from chrome.storage and send requests)
```

| Context | Why it exists |
| --- | --- |
| Content script | The only context that can see the page: selection, extraction, highlighting, in-page player. Kept small and dormant until used. |
| Service worker | Owns cross-tab coordination and Chrome APIs (menus, commands, scripting, permissions). MV3 suspends it when idle, so it holds no in-memory state. |
| Offscreen document | MV3 service workers cannot play audio or keep a model in memory. The offscreen document holds the model, the worker and the `<audio>` element, and survives tab switches and popup closes. |
| Inference worker | ONNX inference takes hundreds of milliseconds per sentence; running it in a worker keeps audio playback smooth. |

## Message contract

All cross-context communication goes through one typed contract (`src/shared/messages/contract.ts`):

- Every message is an envelope `{ kr: 1, type, target, requestId, payload }`. `target` matters because `chrome.runtime.sendMessage` reaches every extension page at once.
- Requests map `type → [payload, response]`; events map `type → payload`. A unit test enforces that no name is both (a collision once made the background drop a request).
- `listen()` validates the envelope and payload shape (`validate.ts`), rejects messages from other extensions, and rejects privileged requests from content scripts (only an allow-list such as `session/start` and `session/control` is accepted from pages).
- Replies are `{ ok: true, data } | { ok: false, error: AppErrorInfo }`. Every error carries a diagnostic code, a user-facing message and a recovery action (`src/shared/errors.ts`).

## Reading pipeline

```
DOM / Readability / pasted text
  → normalize (display) → blocks → sentence segmentation (Intl.Segmenter + abbreviation and initials fixes, long-sentence splitting)
  → ReadingDoc { blocks, sentences with block id + character offsets }
  → session (background) → offscreen PlaybackController
      → SynthesisQueue (single lane, priority = distance from the playhead)
          → speech normalization (URLs, e-mails, numbers, symbols, abbreviations)
          → Kokoro normalization + espeak-ng phonemes
          → tokenizer; split until ≤ 500 phoneme tokens (model limit is 510)
          → ONNX inference with the voice's style vector for that length
      → WAV clip per sentence → <audio> with preservesPitch playbackRate
  → playback/state events → highlight the exact sentence being heard
```

Design points:

- **One clip per sentence.** The highlighted sentence is the one whose audio is playing, so synchronization is exact rather than estimated from timing. Chunk boundaries never split a highlight.
- **Producer–consumer with priorities.** The current sentence is synthesized first; the next N (default 3) are prefetched. Jumping elsewhere re-scores the queue and cancels work outside the window. Only successful results are memoized, so Retry after a failure really retries.
- **Instant speed changes.** Speed uses the media element's pitch-preserving `playbackRate`, so no audio is regenerated. (Export uses Kokoro's native `speed` input instead.)
- **Cancellation.** A new session, a voice change, or Stop bumps a token and cancels the queue; late results from the old session are discarded and never played (covered by unit and E2E tests).
- **Text maps for highlighting.** While extracting a live page, every output character records the Text node and offset it came from. Sentence offsets become DOM Ranges, which are painted with the CSS Custom Highlight API. The page's DOM is never modified.

## Model management

- `model-manifest.json` pins the Hugging Face repository `onnx-community/Kokoro-82M-v1.0-ONNX` to commit `1939ad2a…` and lists the size and SHA-256 of every file. `npm run pin-model` regenerates it.
- Files are fetched from commit-pinned URLs, streamed into IndexedDB in 8 MB chunks (resumable with HTTP Range after a pause or a dropped connection), hashed, and only then written to Cache Storage with a verification header.
- transformers.js is configured with a custom cache that serves only verified entries and a remote host of `kokoro-reader.invalid`, so a cache miss fails instead of downloading unverified bytes.
- ONNX Runtime's WebAssembly files ship inside the extension (`/ort/`); nothing executable is loaded remotely.
- Initialization runs a real test inference. With **Auto**, the fp16/fp32 variants try WebGPU first and fall back to multithreaded WASM if that test fails; the 8-bit default goes straight to WASM, where it is fastest. The UI shows the backend that actually passed.
- The model is unloaded (offscreen document closed) after a configurable idle time; a paused session is restored from `chrome.storage.session` on resume.

## Session policy

Exactly one session is active. Starting a new one replaces it (highlights in the old tab are cleared and synthesis is cancelled) unless the user chooses "Add to queue" in settings. The Listen Later queue plays back to back like an audiobook playlist. Closing the tab that owns a page or selection session stops it; Smart Reader, custom-text and queue sessions keep playing because their text lives in the extension.

## Decision record

| # | Decision | Alternatives | Reason |
| --- | --- | --- | --- |
| 1 | Run inference with **transformers.js 3.8.1 + ONNX Runtime Web** directly, reusing kokoro-js 1.2.1's model metadata and porting its phonemizer/normalizer (Apache-2.0) | Use `KokoroTTS` from kokoro-js as-is | kokoro-js fetches voices from the unpinned `main` branch without verification, silently truncates text beyond 510 tokens, and does not export its phonemizer. Owning these steps enables pinning, SHA-256 verification and token-aware splitting. |
| 2 | **Offscreen document + dedicated worker** | Inference in the service worker; inference in a tab | Service workers are suspended and cannot play audio; a hidden tab is intrusive. The offscreen document is the MV3-sanctioned host for audio and workers. |
| 3 | **Cross-origin isolation** for extension pages (COOP/COEP in the manifest) | Single-threaded WASM | Enables SharedArrayBuffer, so ONNX Runtime uses 4 WASM threads. Measured RTF ≈ 0.6–0.8 on an Apple Silicon laptop, i.e. faster than real time. |
| 4 | **q8 model as the default** (92 MB) | fp32 (326 MB) | Smallest download and fastest on CPU; fp16/fp32 are offered for WebGPU users. |
| 5 | **Optional all-sites permission** for the floating button | Required `<all_urls>` host permission | Without it the extension still works everywhere through `activeTab` (context menu, toolbar, shortcuts). The broad permission is requested only when the user enables the floating speaker. |
| 6 | **Vanilla TypeScript in the content script**, React elsewhere | React in the content script | The content script runs on every page once enabled; 48 KB of vanilla code with a closed Shadow DOM keeps idle cost low and avoids Tailwind/`@property` limitations inside shadow roots. |
| 7 | **CSS Custom Highlight API** | Wrapping sentences in `<span>`s | No DOM mutation, so frameworks (React, Vue) on the page are unaffected and nothing needs to be cleaned up. |
| 8 | **chrome.storage as the shared store** (no Zustand) | Zustand per page | State must be shared across the popup, side panel, reader, options and service worker. `chrome.storage` already provides persistence and change events across contexts, so a client-side store would duplicate it. |
| 9 | **Readability runs in extension pages**, not the content script | Bundle Readability in the content script | The content script sends an HTML snapshot; Readability parses it in the offscreen document or Smart Reader page into an inert document. The content script stays small, and page HTML is never rendered. |
| 10 | **English only** in this version | Offer all 54 Kokoro voices | Kokoro v1.0 also has Spanish, French, Hindi, Italian, Portuguese, Japanese and Mandarin voices, but they need language-specific G2P (misaki) that was not validated here. The catalogue is keyed by language so more can be added without restructuring. |
| 11 | **GPL-3.0-or-later** license | MIT | The `phonemizer` package bundles eSpeak NG (GPL-3.0-or-later) compiled to WebAssembly. Distributing the extension therefore distributes GPL code. |
