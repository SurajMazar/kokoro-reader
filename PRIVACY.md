# Privacy Policy

_Last updated: 20 November 2026_

Kokoro Reader is designed so that what you read stays on your computer.

## What happens to the text you listen to

- Speech is generated **on your device** by the Kokoro-82M model running inside the extension. Selected text, page content and pasted text are **never sent** to any server.
- Kokoro Reader does not include analytics, advertising, crash reporting or tracking code of any kind.

## Network requests

The only network requests the extension makes are downloads of the Kokoro model files (config, tokenizer, ONNX model and voice files) and, when you first use a Nepali voice, its voice pack, from `huggingface.co`, at pinned revisions. They contain no information about you or the pages you read beyond what any file download reveals (your IP address, to Hugging Face). Files are verified by SHA-256 and stored in the extension's local cache.

**Update check (unpacked installs only).** A copy installed with "Load unpacked" cannot be updated by Chrome, so once a day it downloads the version number of the latest build (`package.json` from `raw.githubusercontent.com`) to tell you when an update exists. No information about you or your reading is sent. Copies installed from the Chrome Web Store never make this request; Chrome updates them.

**Optional browser speech.** If you switch the engine to "Browser speech", text is spoken by your operating system's speech service. Some system voices are network voices provided by your OS or browser vendor; their handling of text is governed by that vendor's policy. Kokoro (the default) never uses the network for speech.

## What is stored on your device

| Data | Purpose | How to remove |
| --- | --- | --- |
| Settings | Your preferences | Settings → General → Reset |
| Model files | Offline speech | Settings → Model Storage → Clear cache |
| Reading history (title, address, position — **no page text**) | Resume where you left off | Settings → Privacy → Delete history, or turn history off |
| Listen Later queue and bookmarks (**includes the text you saved**) | Play later / resume | Remove items in the Library |
| Current session (in memory and Chrome session storage) | Keep playing across tabs | Cleared when you stop or restart Chrome |
| Local diagnostics (timings and error codes, **never text or addresses**) | Performance information shown to you under Advanced | Settings → Advanced → Clear, or turn off under Privacy |

Nothing in this table leaves your device. Uninstalling the extension deletes all of it.

## Permissions

See [docs/PERMISSIONS.md](docs/PERMISSIONS.md) for why each Chrome permission is requested. Access to all websites is **optional** and only requested if you turn on the speaker button that appears when you select text.

## Contact

Questions: open an issue at https://github.com/SurajMazar/kokoro-reader/issues.
