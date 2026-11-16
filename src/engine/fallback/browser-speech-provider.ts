import type { AudioResult, EngineReadiness, SynthesisOptions, TTSProvider } from '@/engine/contracts/tts-provider';
import { AppError } from '@/shared/errors';
import type { VoiceInfo } from '@/shared/types';

/**
 * Optional fallback engine using the browser's built-in speech synthesis.
 * It is a separate engine the user picks explicitly; Kokoro Reader never
 * switches to it on its own. It can only speak live, so audio export and
 * Kokoro voices are unavailable while it is selected.
 */
export class BrowserSpeechProvider implements TTSProvider {
  readonly id = 'browser' as const;
  private current: SpeechSynthesisUtterance | null = null;

  static isAvailable(): boolean {
    return typeof speechSynthesis !== 'undefined';
  }

  async initialize(): Promise<EngineReadiness> {
    if (!BrowserSpeechProvider.isAvailable()) throw new AppError('E_BROWSER_SPEECH');
    return { backend: null, crossOriginIsolated: false, threads: 0, initMs: 0 };
  }

  private async systemVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!BrowserSpeechProvider.isAvailable()) return [];
    const voices = speechSynthesis.getVoices();
    if (voices.length) return voices;
    return new Promise((resolve) => {
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return (await this.systemVoices()).map((voice) => ({
      id: voice.voiceURI,
      name: voice.name,
      language: voice.lang,
      languageLabel: voice.lang,
      gender: 'Female',
      targetQuality: '–',
      overallGrade: '–',
      traits: voice.localService ? 'On device' : 'Network voice',
      engine: 'browser',
    }));
  }

  async synthesize(text: string, { voice }: SynthesisOptions): Promise<AudioResult> {
    return { kind: 'live', text, voice };
  }

  /** Speaks one utterance. Resolves when it finishes; rejects on error. */
  async speak(text: string, voiceUri: string | null, rate: number, volume: number, signal?: AbortSignal): Promise<void> {
    const voices = await this.systemVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = voices.find((candidate) => candidate.voiceURI === voiceUri) ?? voices.find((candidate) => candidate.default);
    if (voice) utterance.voice = voice;
    utterance.rate = Math.min(2, Math.max(0.5, rate));
    utterance.volume = volume;
    this.current = utterance;
    await new Promise<void>((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') reject(new AppError('E_CANCELLED'));
        else reject(new AppError('E_BROWSER_SPEECH', event.error));
      };
      signal?.addEventListener('abort', () => speechSynthesis.cancel(), { once: true });
      speechSynthesis.speak(utterance);
    });
  }

  pause() {
    speechSynthesis.pause();
  }

  resume() {
    speechSynthesis.resume();
  }

  async cancel(): Promise<void> {
    this.current = null;
    if (BrowserSpeechProvider.isAvailable()) speechSynthesis.cancel();
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }
}
