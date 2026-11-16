/**
 * Validates a built extension directory: manifest shape, that every file
 * the manifest references exists, that no remote code is referenced, and
 * that no model weights were bundled by accident.
 *   node scripts/validate-manifest.ts [dist]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const errors: string[] = [];
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

const need = (condition: unknown, message: string) => {
  if (!condition) errors.push(message);
};
const exists = (path: string, what: string) => need(existsSync(join(dir, path.split('?')[0]!)), `${what} not found: ${path}`);

need(manifest.manifest_version === 3, 'manifest_version must be 3');
need(/^\d+\.\d+\.\d+(\.\d+)?$/.test(manifest.version), `version must be x.y.z, got ${manifest.version}`);
need(manifest.name && manifest.name.length <= 75, 'name must be 1–75 characters');
need(manifest.description && manifest.description.length <= 132, 'description must be at most 132 characters');
exists(manifest.background.service_worker, 'service worker');
exists(manifest.action.default_popup, 'popup');
exists(manifest.options_ui.page, 'options page');
exists(manifest.side_panel.default_path, 'side panel');
for (const icon of Object.values(manifest.icons) as string[]) exists(icon, 'icon');
for (const page of ['offscreen/index.html', 'reader/index.html', 'welcome/index.html', 'content.js', 'ort/ort-wasm-simd-threaded.jsep.wasm', 'ort/ort-wasm-simd-threaded.jsep.mjs']) {
  exists(page, 'file');
}
need(!String(manifest.content_security_policy?.extension_pages).includes('unsafe-eval') || String(manifest.content_security_policy?.extension_pages).includes("'wasm-unsafe-eval'"), 'CSP must not allow unsafe-eval');
need(!manifest.host_permissions || process.env.KOKORO_E2E === '1', 'release builds must not declare host_permissions (use optional_host_permissions)');
const allowed = new Set(['storage', 'unlimitedStorage', 'activeTab', 'contextMenus', 'offscreen', 'scripting', 'sidePanel']);
for (const permission of manifest.permissions) need(allowed.has(permission), `unexpected permission: ${permission}`);
need(Object.keys(manifest.commands).filter((name) => manifest.commands[name].suggested_key).length <= 4, 'Chrome allows at most 4 suggested shortcuts');

// Remote code and bundled weights.
function walk(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
let total = 0;
for (const file of walk(dir)) {
  const size = statSync(file).size;
  total += size;
  need(!/\.(onnx|bin)$/.test(file), `model weights must not be bundled: ${file}`);
  if (/\.(js|mjs|html)$/.test(file)) {
    const text = readFileSync(file, 'utf8');
    need(!/<script[^>]+src=["']https?:/i.test(text), `remote <script> in ${file}`);
    need(!/importScripts\(\s*["']https?:/.test(text), `remote importScripts in ${file}`);
    // transformers.js depends on the Node-only image library sharp (which has open
    // advisories); its web build must not pull it into the extension.
    need(!/from\s*["']sharp["']|require\(["']sharp["']\)|libvips/.test(text), `Node-only dependency "sharp" bundled into ${file}`);
  }
}

if (errors.length) {
  console.error(`Manifest validation failed for ${dir}:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ ${dir} is a valid MV3 extension (${(total / 1024 / 1024).toFixed(1)} MB, ${manifest.permissions.length} permissions)`);
