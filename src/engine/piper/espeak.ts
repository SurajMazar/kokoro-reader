/**
 * espeak-ng (WebAssembly) phonemizer for the Piper voices.
 *
 * vendor/espeak-ng-ne is espeak-ng built by scripts/espeak/build.sh at the
 * commit piper1-gpl pins, with only the Nepali and English data embedded
 * (about 1.2 MB). It is loaded on first use, inside the Piper worker.
 */
import createEspeak, { type EspeakModule } from '../../../vendor/espeak-ng-ne/espeak-ng-ne.mjs';
import type { Clause } from './phonemes';

let modulePromise: Promise<EspeakModule> | null = null;
let currentVoice: string | null = null;

async function load(voice: string): Promise<EspeakModule> {
  modulePromise ??= createEspeak();
  const module = await modulePromise;
  if (currentVoice !== voice) {
    const status = module.ccall('kr_init', 'number', ['string', 'string'], ['/data', voice]);
    if (status !== 0) throw new Error(`espeak-ng could not load voice ${voice} (${status})`);
    currentVoice = voice;
  }
  return module;
}

/** Text → clauses of IPA, as espeak_TextToPhonemesWithTerminator reports them. */
export async function espeakClauses(text: string, voice: string): Promise<Clause[]> {
  const module = await load(voice);
  const raw = module.ccall('kr_phonemize', 'string', ['string'], [text]);
  return raw.split('\u001e').map((record) => {
    const [phonemes = '', terminator = '', end = '0'] = record.split('\u001f');
    return { phonemes, terminator, endOfSentence: end === '1' };
  });
}
