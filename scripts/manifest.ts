import pkg from '../package.json' with { type: 'json' };

export interface ManifestOptions {
  /**
   * E2E builds declare `<all_urls>` as a required host permission. Automated
   * browsers cannot click Chrome's permission prompt, so the test build skips
   * the optional-permission step. Release builds never set this.
   */
  e2e?: boolean;
}

export function buildManifest({ e2e = false }: ManifestOptions = {}): chrome.runtime.ManifestV3 {
  const icons = { '16': 'icons/icon-16.png', '32': 'icons/icon-32.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' };
  return {
    manifest_version: 3,
    name: 'Kokoro Reader',
    short_name: 'Kokoro Reader',
    version: pkg.version,
    description: 'Listen to any webpage with natural AI speech generated privately on your device by Kokoro-82M.',
    minimum_chrome_version: '116',
    icons,
    action: {
      default_title: 'Kokoro Reader',
      default_popup: 'popup/index.html',
      default_icon: icons,
    },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'contextMenus', 'offscreen', 'scripting', 'sidePanel'],
    ...(e2e ? { host_permissions: ['<all_urls>'] } : { optional_host_permissions: ['<all_urls>'] }),
    options_ui: { page: 'options/index.html', open_in_tab: true },
    side_panel: { default_path: 'sidepanel/index.html' },
    commands: {
      'read-selection': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Read selected text',
      },
      'toggle-playback': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Play / pause',
      },
      'read-page': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Read this page',
      },
      'stop-reading': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Stop reading',
      },
      'next-sentence': { description: 'Next sentence' },
      'previous-sentence': { description: 'Previous sentence' },
      'open-reader': { description: 'Open this page in the Smart Reader' },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // Cross-origin isolation enables SharedArrayBuffer, which lets ONNX
    // Runtime use multiple WebAssembly threads in the offscreen document.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
  } as chrome.runtime.ManifestV3;
}
