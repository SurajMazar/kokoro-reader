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
- **A voice per sentence.** A sentence that is mostly Devanagari words is read by the Nepali voice; every other sentence by the main voice. Each engine is loaded on first use, so a Nepali page never downloads Kokoro and an English page never downloads a Nepali pack.
- **Text maps for highlighting.** While extracting a live page, every output character records the Text node and offset it came from. Sentence offsets become DOM Ranges, which are painted with the CSS Custom Highlight API. The page's DOM is never modified.

## Model management

- `model-manifest.json` pins the Hugging Face repository `onnx-community/Kokoro-82M-v1.0-ONNX` to commit `1939ad2a…` and lists the size and SHA-256 of every file. `npm run pin-model` regenerates it.
- Files are fetched from commit-pinned URLs, streamed into IndexedDB in 8 MB chunks (resumable with HTTP Range after a pause or a dropped connection), hashed, and only then written to Cache Storage with a verification header.
- transformers.js is configured with a custom cache that serves only verified entries and a remote host of `kokoro-reader.invalid`, so a cache miss fails instead of downloading unverified bytes.
- ONNX Runtime's WebAssembly files ship inside the extension (`/ort/`); nothing executable is loaded remotely.
- Initialization runs a real test inference. With **Auto**, the fp16/fp32 variants try WebGPU first and fall back to multithreaded WASM if that test fails; the 8-bit default goes straight to WASM, where it is fastest. The UI shows the backend that actually passed.
- The model is unloaded (offscreen document closed) after a configurable idle time; a paused session is restored from `chrome.storage.session` on resume.

## Nepali voices (Piper)

```
Devanagari sentence
  → Nepali normalization (ASCII digits → Devanagari digits, number separators)
  → espeak-ng (WebAssembly, `vendor/espeak-ng-ne`) clause by clause: IPA + terminator + sentence end
  → Piper symbol handling: drop language-switch flags, keep punctuation, NFD split, merge trained vowel clusters
  → phoneme ids (BOS, PAD-interleaved, EOS) → VITS ONNX model (ONNX Runtime Web, WASM) → 22.05 kHz PCM
```

- Voices come from `rhasspy/piper-voices`, pinned in `src/models/voice-packs-manifest.json` (`npm run pin-voice-packs`, i.e. `node scripts/pin-voice-packs.ts`) and stored by the same verified, resumable model store as Kokoro. Two packs: `ne-chitwan` (one male speaker, CC0, 63 MB) and `ne-google` (18 female speakers from OpenSLR 43, CC-BY-SA-4.0, 77 MB).
- The Piper worker (`src/workers/piper.worker.ts`) runs beside the Kokoro worker, so a mixed page keeps both engines loaded. It reads model files only from the verified cache.
- `vendor/espeak-ng-ne` is espeak-ng built from source by `scripts/espeak/build.sh` at commit `724808c`, the commit piper1-gpl pins, with only the phoneme tables and the Nepali and English dictionaries (1.2 MB). The phonemes therefore match what the voices were trained on; `tests/unit/nepali.test.ts` checks the WebAssembly output against native espeak-ng and the phoneme ids against piper-tts 1.8.0.
- Exports that mix both engines are resampled to Kokoro's 24 kHz.

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
| 10 | **English (Kokoro) and Nepali (Piper)** | Offer all 54 Kokoro voices | Kokoro v1.0 also has Spanish, French, Hindi, Italian, Portuguese, Japanese and Mandarin voices, but they need language-specific G2P (misaki) that was not validated here. Kokoro has no Nepali voice, so Nepali uses Piper VITS voices (decision 12). |
| 12 | **Piper voices for Nepali**, phonemized by our own espeak-ng WebAssembly build | Indic Parler-TTS; Swar (a Kokoro-derived Nepali model); MMS-TTS | Piper models are small (63–77 MB), run faster than real time on the CPU, and have open licenses (CC0, CC-BY-SA). Indic Parler-TTS (0.9 B parameters) is too large for a browser; Swar and MMS are CC-BY-NC. The npm `phonemizer` build contains English only and the full espeak-ng builds are 18–25 MB, so a Nepali-only build (1.2 MB) is compiled from the commit Piper trains with. |
| 13 | **Automatic voice per sentence** by script | A language setting, or one language per document | Pages often mix Nepali and English. Choosing by sentence (mostly Devanagari words → Nepali voice) reads both correctly with no setting to change, and picking a Nepali voice fills a separate Nepali slot so it cannot make English pages sound Nepali. |
| 11 | **GPL-3.0-or-later** license | MIT | The `phonemizer` package and `vendor/espeak-ng-ne` are eSpeak NG (GPL-3.0-or-later) compiled to WebAssembly. Distributing the extension therefore distributes GPL code. |
