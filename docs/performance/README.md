# Performance and speech quality

All numbers below were measured by running the real extension in Chromium. Nothing is estimated. Raw results are in the JSON files in this folder; reproduce them with `npm run benchmark` (optionally `BENCH_VARIANT=fp32 BENCH_BACKEND=webgpu`) and `npm run verify:speech`.

**Machine:** Apple M4 (10 cores), 16 GB RAM, macOS 26 (Darwin 25.5) · **Browser:** Chromium 141 (Playwright build, headless) · **Date:** 16 Nov 2026

## Speed

| Configuration | Download | Engine init | First audio, cold engine¹ | First audio, warm engine² | Real-time factor³ (median / p90) | Underruns in 60 s | Memory while playing⁴ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **q8 on WebAssembly** (default, 4 threads) | 92 MB in 8.8 s | 2.4 s | 5.8 s | **1.5 s** | 0.95 / 0.99 | 1 (initial buffer) | 340 MB |
| q8 on WebAssembly, machine under load⁵ | 92 MB in 11.9 s | 2.4 s | 7.0 s | 2.3 s | 1.15 / 1.28 | 10 | 338 MB |
| **fp32 on WebGPU** | 326 MB in 39.9 s | 2.9 s | 4.5 s | **0.5 s** | **0.22 / 0.27** | 0 | 725 MB |
| fp16 on WebGPU — *rejected, see quality* | 163 MB in 12.7 s | 2.6 s | 4.2 s | 0.5 s | 0.21 / 0.24 | 0 | 395 MB |

¹ Offscreen document closed first, so the model loads from the local cache and initializes, including a real test inference.
² Engine already loaded; time from "Read page" to audible speech, including extraction and the first synthesized clause.
³ Inference time ÷ audio duration over 30 sentences (125 s of speech). Below 1 means speech is generated faster than it plays.
⁴ `performance.measureUserAgentSpecificMemory()` for the offscreen document and its worker. After the idle unload the offscreen document is closed (~1 MB measured just before closing).
⁵ Same machine with an unrelated webpack dev server using ~130 % CPU (load average ≈ 5): `results-2026-11-16-q8-wasm-under-load.json`. The idle q8 row was measured earlier the same day (with a 45-character fast-start clause; it is now 32); its JSON was overwritten by the later run, so the row is transcribed from that run's output. The WebGPU rows have their JSON files here.

### What changed because of these measurements

- **Fast start.** The first warm measurement was 4.3 s, because the whole first sentence had to be synthesized before playback. The player now speaks the sentence's first clause while generating the rest: 4.3 s → **1.5 s** on WebAssembly.
- **Threads.** Raising ONNX Runtime from 4 to 8 WebAssembly threads made things *slower* (RTF 0.85 → 0.90, p90 1.06), so the extension uses up to 4.
- **WebGPU policy.** fp16 on WebGPU looked best on speed alone, but transcription showed it produces garbled audio (below). Only fp32 runs on WebGPU; on WebGPU-capable devices the settings page *recommends* it rather than switching automatically, because of the larger download and memory.

## Speech quality (intelligibility)

The same two sentences were exported to WAV by the extension with voice `af_heart`, then transcribed with Whisper `base.en` (faster-whisper). WER is the word error rate against the original text.

| Variant | Backend | WER | Status |
| --- | --- | --- | --- |
| q8 | WebAssembly | **0 %** | ✅ supported (default) |
| fp16 | WebAssembly | **0 %** | ✅ supported |
| fp32 | WebAssembly | **0 %** | ✅ supported |
| fp32 | WebGPU | **0 %** | ✅ supported |
| fp16 | WebGPU | 92 % | ❌ blocked — output was unintelligible though no error was raised |
| q8 | WebGPU | 100 % | ❌ blocked — output was unintelligible though no error was raised |

The unsupported combinations ran without any error and passed the engine's readiness check (finite, non-empty audio), which is why audio-level verification matters. The registry (`src/models/registry.ts`) only allows backends a variant passed on, and a unit test pins that rule.

### What this means for users

On the CPU, Kokoro runs at roughly real-time speed: comfortably ahead on an idle machine, but under heavy background load it can fall slightly behind, which shows up as brief "Generating speech…" pauses between sentences. On a device with WebGPU, the full-precision model has about 4× headroom and does not stall.

## Limits of these measurements

- One machine. WebGPU behaviour depends on the GPU and driver; on other hardware a variant could behave differently, which is why WebGPU always runs a real test inference and falls back to WebAssembly on failure.
- Headless Chromium. A desktop Chrome window can differ slightly in timing.
- Memory is the browser's attribution for the offscreen document and its worker; total process memory is higher.
