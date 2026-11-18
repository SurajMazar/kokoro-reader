/**
 * Regenerates src/models/voice-packs-manifest.json: the pinned files of the
 * optional Piper voice packs (Nepali), with size and SHA-256 for each file.
 *
 *   node scripts/pin-voice-packs.ts [revision]
 *
 * Like scripts/pin-model.ts: LFS files carry their SHA-256 in the Hugging
 * Face tree API; small files are downloaded and hashed. Review the diff
 * before committing, since a changed hash means the upstream file changed.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = 'rhasspy/piper-voices';
const API = `https://huggingface.co/api/models/${REPO}`;
/** Folders of the voices offered in the extension; each holds one model, its config and a MODEL_CARD. */
const VOICE_DIRS = ['ne/ne_NP/chitwan/medium', 'ne/ne_NP/google/medium'];

interface TreeEntry {
  type: 'file' | 'directory';
  path: string;
  size: number;
  lfs?: { oid: string; size: number };
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function sha256Of(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
}

async function main() {
  const info = await json<{ sha: string }>(API);
  const revision = process.argv[2] ?? info.sha;
  const files: Record<string, { size: number; sha256: string }> = {};
  for (const dir of VOICE_DIRS) {
    const entries = (await json<TreeEntry[]>(`${API}/tree/${revision}/${dir}`)).filter(
      (entry) => entry.type === 'file' && /\.onnx(\.json)?$|MODEL_CARD$/.test(entry.path),
    );
    for (const entry of entries) {
      const sha256 = entry.lfs?.oid ?? (await sha256Of(`https://huggingface.co/${REPO}/resolve/${revision}/${entry.path}`));
      files[entry.path] = { size: entry.size, sha256 };
    }
  }
  const manifest = { repository: REPO, revision, generatedAt: new Date().toISOString(), files };
  const out = resolve(import.meta.dirname, '../src/models/voice-packs-manifest.json');
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Pinned ${Object.keys(files).length} files at ${revision} → ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
