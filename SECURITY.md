# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security → Advisories) on https://github.com/SurajMazar/kokoro-reader, not in a public issue. You can expect an acknowledgement within a week.

## Threat model and mitigations

### Untrusted web pages

The content script runs on arbitrary websites, which must be treated as hostile.

- **Isolated world.** The content script's variables and extension APIs are invisible to page scripts.
- **Closed Shadow DOM.** All injected UI (speaker button, player) lives in a `mode: 'closed'` shadow root, so page scripts cannot reach in to click or read its controls, and page CSS cannot restyle them.
- **No HTML injection.** Page text and state are written with `textContent` only. The only `innerHTML` writes are constant SVG icon strings bundled with the extension.
- **No DOM mutation for highlighting.** Highlights use the CSS Custom Highlight API; the only element added to the page is the overlay host and one `<style>` element with `::highlight()` rules.
- **Message validation.** Every message is shape-checked (`src/shared/messages/validate.ts`); messages from other extensions are ignored; content scripts may only send an allow-list of request types (start/control a session, read settings-related state). Privileged actions such as model management, export, history and bookmarks are rejected from pages.
- **Size limits.** Documents sent through messages are capped (2 M characters, 20 000 blocks).

### Extension pages

- Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. No remote scripts, no `eval`, no `new Function` (enforced by ESLint and checked in the build validator).
- `wasm-unsafe-eval` is required to instantiate the bundled WebAssembly (ONNX Runtime and eSpeak NG); it does not permit JavaScript `eval`.
- The Smart Reader parses page snapshots with `DOMParser` into an inert document (scripts never run, nothing is rendered) and displays text only.
- Cross-origin isolation (COOP `same-origin`, COEP `require-corp`) on extension pages.

### Model supply chain

- The model repository is pinned to an exact commit. File sizes and SHA-256 hashes are committed in `src/models/model-manifest.json`.
- Downloads are verified before they are cached; a mismatch discards the bytes and reports `E_MODEL_INTEGRITY`.
- The inference worker loads files only from the verified cache. Its remote host is set to an unresolvable domain, so a cache miss cannot fall back to an unverified download.
- Model files are data (ONNX graphs, tokenizer JSON, voice tensors). No code is downloaded or executed from the model host; ONNX Runtime's WebAssembly is bundled with the extension.
- "Verify files" in Settings re-hashes the cache; corrupted files are removed and can be re-downloaded.

### Permissions

The extension requests the minimum it needs; broad host access is optional. See [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

### Dependencies

Dependency versions are pinned exactly (`package-lock.json`). CI runs `npm audit --omit=dev` on runtime dependencies.

`npm audit` currently reports high-severity advisories in `sharp` (libvips/libheif), a Node-only image library that `@huggingface/transformers` depends on. The browser build of transformers.js does not include it, and `scripts/validate-manifest.ts` fails the build if it ever appears in the bundle, so it is not shipped in the extension. CI audits at the critical level for this reason.

## Known limitations

- The phonemizer runs eSpeak NG compiled to WebAssembly from the `phonemizer` npm package; its provenance is that package's build.
- Browser speech (optional) is provided by the operating system and is outside this project's control.
