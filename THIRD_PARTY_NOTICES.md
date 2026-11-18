# Third-party notices

Kokoro Reader's own source code is licensed under GPL-3.0-or-later (see `LICENSE`). The built extension includes or downloads the following third-party components.

## Bundled in the extension

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| eSpeak NG (WebAssembly build, via `phonemizer`) | phonemizer 1.2.1 | GPL-3.0-or-later | Text-to-phoneme conversion. This is why the extension as a whole is distributed under the GPL. Source: https://github.com/espeak-ng/espeak-ng and https://github.com/xenova/phonemizer.js |
| phonemizer (JavaScript wrapper) | 1.2.1 | Apache-2.0 | |
| eSpeak NG, Nepali WebAssembly build (`vendor/espeak-ng-ne`) | commit 724808c5a83f9ef95fdd0db886ba7ba537ff224a | GPL-3.0-or-later | Built from source by `scripts/espeak/build.sh` with Emscripten 4.0.15; includes the compiled phoneme tables and the Nepali and English dictionaries. Source: https://github.com/espeak-ng/espeak-ng |
| piper1-gpl (ported code) | 1.8.0 | GPL-3.0 | `src/engine/piper/phonemes.ts` and `scripts/espeak/glue.c` follow piper1-gpl's `phonemize_espeak.py`, `phoneme_ids.py` and `espeakbridge.c`. https://github.com/OHF-Voice/piper1-gpl |
| @huggingface/transformers | 3.8.1 | Apache-2.0 | Model loading, tokenizer, tensors |
| onnxruntime-web | 1.22.0-dev.20250409 | MIT | WebAssembly and WebGPU inference runtime |
| kokoro-js (ported code and voice metadata) | 1.2.1 | Apache-2.0 | `src/engine/kokoro/phonemize.ts` and `voices.ts` are derived from kokoro-js. Copyright hexgrad and contributors. |
| @mozilla/readability | 0.6.0 | Apache-2.0 | |
| React, React DOM | 19.2.0 | MIT | |
| Motion | 12.23.24 | MIT | |
| Lucide icons (lucide-react and inline SVG paths) | 0.544.0 | ISC | |
| Tailwind CSS (generated CSS) | 4.1.16 | MIT | |

## Downloaded at runtime (not bundled)

| Component | Revision | License |
| --- | --- | --- |
| Kokoro-82M v1.0 ONNX (`onnx-community/Kokoro-82M-v1.0-ONNX`): model, tokenizer, voices | `1939ad2a8e416c0acfeecc08a694d14ef25f2231` | Apache-2.0 |

| Piper voice `ne_NP-chitwan-medium` (`rhasspy/piper-voices`) | `0ca208afc2a2ee102b1e961e72e0a7e4907be3d0` | CC0-1.0 (dataset: Chitwan 1.0, Open Home Foundation) |
| Piper voice `ne_NP-google-medium` (`rhasspy/piper-voices`) | `0ca208afc2a2ee102b1e961e72e0a7e4907be3d0` | CC-BY-SA-4.0 |

The `ne_NP-google-medium` voice is a Piper model trained on the "Crowd-sourced high-quality Nepali speech data set" (OpenSLR 43, https://www.openslr.org/43/) by Google, licensed under CC-BY-SA-4.0 (https://creativecommons.org/licenses/by-sa/4.0/). The voice is downloaded unmodified.

The Kokoro-82M model was created by hexgrad (https://huggingface.co/hexgrad/Kokoro-82M) and is distributed under the Apache License 2.0.

Full license texts for npm packages are in each package's `LICENSE` file under `node_modules/` and in the packages' repositories.
