import manifest from './model-manifest.json';
import packManifest from './voice-packs-manifest.json';

export interface ModelVariant {
  id: string;
  label: string;
  /** transformers.js dtype; selects the onnx/model*.onnx file. */
  dtype: 'q8' | 'fp16' | 'fp32' | 'q4' | 'q4f16';
  file: string;
  description: string;
  /**
   * Backends this variant produces intelligible speech on, best first.
   * Verified by transcribing exported audio with Whisper (scripts/verify-speech.py):
   * q8 and fp16 on WebGPU produced unintelligible audio (WER 100% and 92%) even
   * though they ran without errors, so they are restricted to WebAssembly.
   */
  backends: ('webgpu' | 'wasm')[];
}

export const MODEL_REPOSITORY = manifest.repository;
export const MODEL_REVISION = manifest.revision;
export const MODEL_NAME = 'Kokoro-82M v1.0';
export const MODEL_LICENSE = manifest.license;

/** Files every variant needs besides its ONNX graph. */
export const SHARED_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'voices/af_heart.bin'] as const;

export const MODEL_VARIANTS: readonly ModelVariant[] = [
  {
    id: 'q8',
    label: '8-bit quantized',
    dtype: 'q8',
    file: 'onnx/model_quantized.onnx',
    description: 'Smallest download and fastest on the CPU. Recommended for most computers.',
    backends: ['wasm'],
  },
  {
    id: 'fp16',
    label: 'Half precision (fp16)',
    dtype: 'fp16',
    file: 'onnx/model_fp16.onnx',
    description: 'Higher precision on the CPU at twice the download size. (Not used on WebGPU, where it produced garbled audio in testing.)',
    backends: ['wasm'],
  },
  {
    id: 'fp32',
    label: 'Full precision (fp32)',
    dtype: 'fp32',
    file: 'onnx/model.onnx',
    description: 'Reference quality and the only variant that runs correctly on WebGPU, where it is about 4× faster than real time. Slower than 8-bit on the CPU.',
    backends: ['webgpu', 'wasm'],
  },
];

export const DEFAULT_VARIANT_ID = 'q8';

export function getVariant(id: string): ModelVariant {
  return MODEL_VARIANTS.find((variant) => variant.id === id) ?? MODEL_VARIANTS[0]!;
}

export interface PinnedFile {
  path: string;
  size: number;
  sha256: string;
}

/**
 * Optional voice-pack files (Piper voices from rhasspy/piper-voices) share the
 * verified store with Kokoro. Their paths carry this prefix so one path names
 * one pinned file in one repository.
 */
export const PACK_PREFIX = 'piper-voices/';
export const PACK_REPOSITORY = packManifest.repository;
export const PACK_REVISION = packManifest.revision;

const FILES = manifest.files as Record<string, { size: number; sha256: string }>;
const PACK_FILES = packManifest.files as Record<string, { size: number; sha256: string }>;

function entryFor(path: string): { size: number; sha256: string } | undefined {
  return path.startsWith(PACK_PREFIX) ? PACK_FILES[path.slice(PACK_PREFIX.length)] : FILES[path];
}

export function pinnedFile(path: string): PinnedFile {
  const entry = entryFor(path);
  if (!entry) throw new Error(`File is not in the pinned model manifest: ${path}`);
  return { path, ...entry };
}

export function isPinned(path: string): boolean {
  return Boolean(entryFor(path));
}

/** All files a variant needs before it can initialize. */
export function variantFiles(variant: ModelVariant): PinnedFile[] {
  return [...SHARED_FILES, variant.file].map(pinnedFile);
}

export function variantDownloadBytes(variant: ModelVariant): number {
  return variantFiles(variant).reduce((sum, file) => sum + file.size, 0);
}

/** The canonical download URL, pinned to an exact commit, which is also the Cache Storage key. */
export function fileUrl(path: string): string {
  if (path.startsWith(PACK_PREFIX)) {
    return `https://huggingface.co/${PACK_REPOSITORY}/resolve/${PACK_REVISION}/${path.slice(PACK_PREFIX.length)}`;
  }
  return `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${path}`;
}
