/**
 * Regenerates src/models/model-manifest.json: the pinned list of Kokoro
 * model artifacts (revision, size and SHA-256 for every file) the extension
 * is allowed to download.
 *
 *   node scripts/pin-model.ts [revision]
 *
 * LFS files carry their SHA-256 in the Hugging Face tree API. Small non-LFS
 * files are downloaded and hashed locally. Review the diff before committing:
 * a changed hash means the upstream artifact changed.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const API = `https://huggingface.co/api/models/${REPO}`;

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
  const entries = [
    ...(await json<TreeEntry[]>(`${API}/tree/${revision}`)),
    ...(await json<TreeEntry[]>(`${API}/tree/${revision}/onnx`)),
    ...(await json<TreeEntry[]>(`${API}/tree/${revision}/voices`)),
  ].filter((entry) => entry.type === 'file' && !entry.path.startsWith('.') && entry.path !== 'README.md');

  const files: Record<string, { size: number; sha256: string }> = {};
  for (const entry of entries) {
    const sha256 = entry.lfs?.oid ?? (await sha256Of(`https://huggingface.co/${REPO}/resolve/${revision}/${entry.path}`));
    files[entry.path] = { size: entry.size, sha256 };
  }

  const manifest = {
    repository: REPO,
    revision,
    license: 'Apache-2.0',
    generatedAt: new Date().toISOString(),
    files,
  };
  const out = resolve(import.meta.dirname, '../src/models/model-manifest.json');
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Pinned ${Object.keys(files).length} files at ${revision} → ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
