# Permission justifications

These texts are also used for the Chrome Web Store privacy practices form.

| Permission | Required? | Why |
| --- | --- | --- |
| `activeTab` | Yes | Lets the toolbar button, right-click menu and keyboard shortcuts read the current page only after you invoke them, without access to all sites. |
| `scripting` | Yes | Injects the reader into the current tab on demand (with `activeTab`), and registers the selection script when you enable the floating speaker. |
| `contextMenus` | Yes | Adds "Read with Kokoro", "Read page from here", "Read entire page", "Open in Smart Reader", "Add page to Listen Later" and "Stop reading" to the right-click menu. |
| `offscreen` | Yes | Manifest V3 service workers cannot play audio or keep the model loaded; the offscreen document hosts the speech engine and the audio player so playback continues across tabs. |
| `storage` | Yes | Saves settings, the Listen Later queue, bookmarks and optional history on your device. |
| `unlimitedStorage` | Yes | The Kokoro model (92–326 MB) is cached locally so it is downloaded only once and works offline; without this Chrome may evict it. |
| `sidePanel` | Yes | Provides the side panel player and queue. |
| `<all_urls>` (host) | **Optional** | Only requested when you turn on "Speaker button on text selection", so the speaker icon can appear wherever you select text. It is never used to send data anywhere. Turning the feature off releases the permission. |

Not requested: `tabs`, `history`, `downloads`, `webRequest`, `cookies`, or any remote host permission. The model download from huggingface.co uses ordinary CORS requests and needs no host permission.

**Single purpose (Web Store):** Kokoro Reader reads web page text aloud using an AI voice that runs locally on the user's device.

**Remote code (Web Store):** No. All JavaScript and WebAssembly is packaged with the extension. Model weights downloaded from Hugging Face are data files verified by SHA-256.

**Data usage (Web Store):** The extension does not collect or transmit user data. Website content is processed locally only.
