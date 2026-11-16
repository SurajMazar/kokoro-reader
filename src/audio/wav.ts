/** 16-bit PCM WAV encoding for mono Float32 audio. */

export function encodeWav(samples: Float32Array, sampleRate: number, metadata: Record<string, string> = {}): ArrayBuffer {
  const info = buildInfoChunk(metadata);
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + info.byteLength + dataBytes);
  const view = new DataView(buffer);
  let offset = 0;
  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i));
  };
  writeString('RIFF');
  view.setUint32(offset, 36 + info.byteLength + dataBytes, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true); // PCM chunk size
  view.setUint16(offset + 4, 1, true); // PCM format
  view.setUint16(offset + 6, 1, true); // mono
  view.setUint32(offset + 8, sampleRate, true);
  view.setUint32(offset + 12, sampleRate * 2, true); // byte rate
  view.setUint16(offset + 16, 2, true); // block align
  view.setUint16(offset + 18, 16, true); // bits per sample
  offset += 20;
  new Uint8Array(buffer, offset, info.byteLength).set(new Uint8Array(info));
  offset += info.byteLength;
  writeString('data');
  view.setUint32(offset, dataBytes, true);
  offset += 4;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/** RIFF LIST/INFO chunk with title (INAM), artist (IART), comment (ICMT) and software (ISFT). */
function buildInfoChunk(metadata: Record<string, string>): ArrayBuffer {
  const ids: Record<string, string> = { title: 'INAM', artist: 'IART', comment: 'ICMT', software: 'ISFT', date: 'ICRD' };
  const entries = Object.entries(metadata)
    .filter(([key, value]) => ids[key] && value)
    .map(([key, value]) => {
      const bytes = new TextEncoder().encode(`${value.slice(0, 200)}\0`);
      return { id: ids[key]!, bytes, padded: bytes.length + (bytes.length % 2) };
    });
  if (!entries.length) return new ArrayBuffer(0);
  const size = 4 + entries.reduce((sum, entry) => sum + 8 + entry.padded, 0);
  const buffer = new ArrayBuffer(8 + size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const write = (value: string, at: number) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  write('LIST', 0);
  view.setUint32(4, size, true);
  write('INFO', 8);
  let offset = 12;
  for (const entry of entries) {
    write(entry.id, offset);
    view.setUint32(offset + 4, entry.bytes.length, true);
    bytes.set(entry.bytes, offset + 8);
    offset += 8 + entry.padded;
  }
  return buffer;
}

/** Concatenates clips with an optional silence gap between them. */
export function concatenate(clips: Float32Array[], sampleRate: number, gapSeconds = 0.25): Float32Array {
  const gap = Math.round(gapSeconds * sampleRate);
  const total = clips.reduce((sum, clip) => sum + clip.length, 0) + gap * Math.max(0, clips.length - 1);
  const out = new Float32Array(total);
  let offset = 0;
  clips.forEach((clip, index) => {
    out.set(clip, offset);
    offset += clip.length + (index < clips.length - 1 ? gap : 0);
  });
  return out;
}

export function safeFilename(title: string, extension = 'wav'): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base || 'kokoro-reader'}-${stamp}.${extension}`;
}
