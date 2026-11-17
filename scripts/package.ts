/**
 * Zips dist/ into release/kokoro-reader-<version>.zip for the Chrome Web
 * Store or for "Load unpacked" after extraction. Uses the system zip tool
 * with fixed timestamps-independent ordering.
 *   npm run build && npm run package
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found. Run npm run build first.');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const outDir = resolve(root, 'release');
mkdirSync(outDir, { recursive: true });
const zip = resolve(outDir, `kokoro-reader-${version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-X', '-r', '-q', zip, '.', '-x', '.*'], { cwd: dist, stdio: 'inherit' });
// The Chrome Web Store rejects packages whose manifest.json is not at the ZIP root.
const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
if (!listing.includes('manifest.json')) {
  console.error(`${zip} has no manifest.json at its root; refusing to publish it.`);
  process.exit(1);
}
const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
console.log(`Packaged ${zip}\nSHA-256 ${sha}`);
