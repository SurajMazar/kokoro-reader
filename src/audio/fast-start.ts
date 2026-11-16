/**
 * Fast start: when the sentence the listener is waiting for has not been
 * synthesized yet, speak its first clause as soon as that is ready and
 * generate the rest behind it. Time to first audio then depends on a short
 * clause instead of a whole sentence. Highlighting still covers the whole
 * sentence.
 */
// Measured on WebAssembly (RTF ≈ 0.9): a ~32-character clause is ready in
// about 1.5 s, while a whole 70–120 character sentence takes 3–5 s.
const MIN_HEAD = 14;
const TARGET_HEAD = 32;
const MAX_HEAD = 64;
const MIN_TOTAL = 56;

export function fastStartSplit(text: string): [string, string] | null {
  if (text.length < MIN_TOTAL) return null;
  const window = text.slice(0, MAX_HEAD + 1);
  let best = -1;
  for (const pattern of [/[,;:—–)]\s/g, /\s(?:and|but|or|so|because|which|while|when|that)\s/g, /\s/g]) {
    for (const match of window.matchAll(pattern)) {
      const cut = match.index + (pattern.source.startsWith('\\s(?:') ? 0 : match[0].length - 1) + 1;
      if (cut < MIN_HEAD || cut > MAX_HEAD) continue;
      if (best < 0 || Math.abs(cut - TARGET_HEAD) < Math.abs(best - TARGET_HEAD)) best = cut;
    }
    if (best > 0) break;
  }
  if (best < 0) return null;
  const head = text.slice(0, best).trim();
  const tail = text.slice(best).trim();
  return head && tail.length >= 8 ? [head, tail] : null;
}
