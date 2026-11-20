/**
 * The reading pipeline for one session, running in the offscreen document:
 *
 *   sentences → priority synthesis queue → WAV clips → <audio> playback
 *
 * Each sentence is synthesized as its own clip, so the highlighted sentence
 * always matches the audio exactly (no timing estimation). Playback starts
 * as soon as the first clip is ready while the next few are generated in the
 * background. Speed changes use the audio element's pitch-preserving
 * playbackRate, so they apply instantly without regenerating audio.
 *
 * Each sentence picks its voice: Devanagari sentences are read by the Nepali
 * voice (Piper), everything else by the main voice (Kokoro), so a page that
 * mixes the two languages switches engines sentence by sentence.
 */
import type { BrowserSpeechProvider } from '@/engine/fallback/browser-speech-provider';
import { isNepaliVoice } from '@/engine/piper/voices';
import { isNepaliDocument, voiceForSentence } from './voice-routing';
import type { ModelManager } from '@/models/model-manager';
import type { ControlAction, EngineConfig, ExportResult } from '@/shared/messages/contract';
import { clampRate, clampVolume } from '@/shared/settings';
import { AppError, toErrorInfo } from '@/shared/errors';
import { detectLanguage, devanagariShare } from '@/shared/text/language';
import { countWords, WORDS_PER_SECOND_AT_1X } from '@/shared/text/normalize';
import type { AppErrorInfo, PlaybackState, PlaybackStatus, ReadingDoc } from '@/shared/types';
import { fastStartSplit } from './fast-start';
import { concatenate, encodeWav, resample, safeFilename } from './wav';
import { SynthesisQueue } from './synthesis-queue';

interface Clip {
  index: number;
  url: string;
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
}

interface Part {
  url: string;
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
}

interface PendingTail {
  index: number;
  token: number;
  head: Part;
  promise: Promise<Part>;
}

interface Session {
  id: string;
  doc: ReadingDoc;
  config: EngineConfig;
  index: number;
  status: PlaybackStatus;
  error: AppErrorInfo | null;
  generatedSeconds: number;
  generatedWords: number;
  requestedAt: number;
  firstAudioAt: number | null;
  /** Most sentences are Nepali: short non-Nepali fragments stay with the Nepali voice. */
  nepaliDocument: boolean;
}

export interface PlaybackDeps {
  models: ModelManager;
  browser: BrowserSpeechProvider;
  emitState: (state: PlaybackState) => void;
  onEnded: (sessionId: string, completed: boolean) => void;
  onDiagnostic?: (kind: 'first-audio' | 'synthesis' | 'error', data: Record<string, number | string | boolean | null>) => void;
  createAudio?: () => HTMLAudioElement;
}

const KEEP_BEHIND = 2;

/**
 * play() rejects with AbortError when pause() or a new source interrupts it
 * before playback starts, e.g. the user pauses right after pressing Play.
 * That is an intended interruption, not a playback failure.
 */
function interrupted(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class PlaybackController {
  private session: Session | null = null;
  private readonly audio: HTMLAudioElement;
  private readonly preview: HTMLAudioElement;
  private readonly queue = new SynthesisQueue();
  private readonly clips = new Map<number, Clip>();
  private playToken = 0;
  private lastActivity = Date.now();
  private browserAbort: AbortController | null = null;
  private exportUrl: string | null = null;
  /** Set while this controller pauses the element itself, so the pause listener ignores it. */
  private internalPause = false;
  /** Second half of a fast-started sentence, played when the first half ends. */
  private pendingTail: PendingTail | null = null;
  /** Set when the loaded audio is stale (voice changed while paused): Play must re-synthesize. */
  private restartOnPlay = false;

  constructor(private readonly deps: PlaybackDeps) {
    this.audio = deps.createAudio?.() ?? new Audio();
    this.preview = deps.createAudio?.() ?? new Audio();
    for (const element of [this.audio, this.preview]) {
      element.preservesPitch = true;
      element.preload = 'auto';
    }
    this.audio.addEventListener('ended', () => this.onClipEnded());
    this.audio.addEventListener('error', () => {
      if (this.session && this.audio.src) this.fail(new AppError('E_PLAYBACK', this.audio.error?.message ?? 'media error'));
    });
    this.audio.addEventListener('pause', () => {
      // The OS or another app may pause playback (e.g. a media key).
      if (this.internalPause) return;
      if (this.session?.status === 'playing' && !this.audio.ended && this.audio.src) this.setStatus('paused');
    });
  }

  get sessionId(): string | null {
    return this.session?.id ?? null;
  }

  idleMs(): number {
    const status = this.session?.status;
    if (status === 'playing' || status === 'buffering' || status === 'preparing') return 0;
    return Date.now() - this.lastActivity;
  }

  // ---------------------------------------------------------------- state

  snapshot(): PlaybackState {
    const s = this.session;
    if (!s) {
      return {
        sessionId: null,
        docId: null,
        title: '',
        tabId: null,
        status: 'idle',
        sentenceIndex: 0,
        sentenceCount: 0,
        sentenceText: '',
        blockId: null,
        engine: 'kokoro',
        voice: '',
        rate: 1,
        volume: 1,
        generatedSeconds: 0,
        estimatedRemainingSeconds: 0,
        error: null,
        updatedAt: Date.now(),
      };
    }
    const sentence = s.doc.sentences[s.index];
    const wordsPerSecond = s.generatedWords > 20 && s.generatedSeconds > 5 ? s.generatedWords / s.generatedSeconds : WORDS_PER_SECOND_AT_1X;
    const remainingWords = s.doc.sentences.slice(s.index).reduce((sum, item) => sum + countWords(item.text), 0);
    return {
      sessionId: s.id,
      docId: s.doc.id,
      title: s.doc.title,
      url: s.doc.url,
      source: s.doc.source,
      tabId: null,
      status: s.status,
      sentenceIndex: s.index,
      sentenceCount: s.doc.sentences.length,
      sentenceText: sentence?.text ?? '',
      blockId: sentence?.blockId ?? null,
      engine: s.config.engine,
      voice: s.config.engine === 'browser' ? (s.config.browserVoice ?? 'system') : s.config.voice,
      ...(s.config.engine === 'kokoro' && sentence ? { speakingVoice: this.voiceFor(s.index) } : {}),
      rate: s.config.rate,
      volume: s.config.volume,
      generatedSeconds: Math.round(s.generatedSeconds),
      estimatedRemainingSeconds: Math.round(remainingWords / wordsPerSecond / s.config.rate),
      error: s.error,
      updatedAt: Date.now(),
    };
  }

  private emit() {
    this.lastActivity = Date.now();
    this.deps.emitState(this.snapshot());
  }

  private setStatus(status: PlaybackStatus, error: AppErrorInfo | null = null) {
    if (!this.session) return;
    this.session.status = status;
    this.session.error = error;
    this.emit();
  }

  private fail(error: unknown) {
    const info = toErrorInfo(error, 'E_SYNTHESIS');
    if (info.code === 'E_CANCELLED') return;
    this.deps.onDiagnostic?.('error', { code: info.code, phase: 'playback' });
    this.haltAudio();
    this.setStatus('error', info);
  }

  // --------------------------------------------------------------- session

  async load(sessionId: string, doc: ReadingDoc, startSentence: number, config: EngineConfig): Promise<void> {
    this.teardown();
    if (!doc.sentences.length) throw new AppError('E_EMPTY_TEXT');
    this.session = {
      id: sessionId,
      doc,
      config: { ...config, rate: clampRate(config.rate), volume: clampVolume(config.volume) },
      index: Math.min(Math.max(0, startSentence), doc.sentences.length - 1),
      status: 'preparing',
      error: null,
      generatedSeconds: 0,
      generatedWords: 0,
      requestedAt: performance.now(),
      firstAudioAt: null,
      nepaliDocument: isNepaliDocument(doc.sentences),
    };
    this.emit();

    const sample = doc.sentences.slice(0, 40).map((s) => s.text).join(' ');
    const language = detectLanguage(sample, doc.language);
    // Devanagari is read by the Nepali voice; other non-Latin scripts have no voice.
    if (language === 'unsupported-script' && config.engine === 'kokoro' && devanagariShare(sample) < 0.25) {
      this.fail(new AppError('E_UNSUPPORTED_LANGUAGE', `Detected ${language}`));
      return;
    }
    try {
      await this.prepareEngine();
    } catch (error) {
      if (this.session?.id === sessionId) this.fail(error);
      return;
    }
    if (this.session?.id !== sessionId) return;
    void this.playFrom(this.session.index);
  }

  /** Loads the engine and voice for the sentence playback starts at; other engines load when first needed. */
  private async prepareEngine(): Promise<void> {
    const s = this.session;
    if (!s) return;
    if (s.config.engine === 'browser') {
      await this.deps.browser.initialize();
      return;
    }
    const voice = this.voiceFor(s.index);
    await this.deps.models.providerFor(voice, s.config.variantId, s.config.backend);
    await this.deps.models.ensureVoice(voice);
  }

  /** The voice that reads a sentence (see voice-routing.ts). */
  private voiceFor(index: number): string {
    const s = this.session!;
    return voiceForSentence(s.doc.sentences[index]?.text ?? '', s.config.voice, s.config.nepaliVoice, s.nepaliDocument);
  }

  private voicesKey(): string {
    const s = this.session!;
    return `${s.config.voice}|${s.config.nepaliVoice}`;
  }

  private haltAudio() {
    this.internalPause = true;
    this.audio.pause();
    this.internalPause = false;
  }

  private teardown() {
    this.playToken += 1;
    this.queue.cancelAll();
    this.browserAbort?.abort();
    this.browserAbort = null;
    void this.deps.browser.cancel();
    this.haltAudio();
    this.audio.removeAttribute('src');
    this.audio.load();
    for (const clip of this.clips.values()) URL.revokeObjectURL(clip.url);
    this.clips.clear();
  }

  stop() {
    const id = this.session?.id;
    this.teardown();
    this.session = null;
    this.emit();
    if (id) this.deps.onEnded(id, false);
  }

  // -------------------------------------------------------------- synthesis

  private clipKey(index: number): string {
    const s = this.session!;
    return `${s.id}:${this.voicesKey()}:${index}`;
  }

  private requestClip(index: number, priority: number): Promise<Clip> {
    const s = this.session!;
    const existing = this.clips.get(index);
    if (existing) return Promise.resolve(existing);
    const sentence = s.doc.sentences[index]!;
    const voice = this.voiceFor(index);
    const voices = this.voicesKey();
    const sessionId = s.id;
    return this.queue.enqueue<Clip>({
      key: this.clipKey(index),
      priority,
      run: async (signal) => {
        const provider = await this.deps.models.providerFor(voice, s.config.variantId, s.config.backend);
        await this.deps.models.ensureVoice(voice);
        const result = await provider.synthesize(sentence.text, { voice, speed: 1, signal });
        if (result.kind !== 'pcm') throw new AppError('E_SYNTHESIS', 'Expected PCM audio');
        const wav = encodeWav(result.samples, result.sampleRate);
        const clip: Clip = {
          index,
          url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })),
          samples: result.samples,
          sampleRate: result.sampleRate,
          seconds: result.samples.length / result.sampleRate,
        };
        if (this.session?.id !== sessionId || this.voicesKey() !== voices) {
          URL.revokeObjectURL(clip.url);
          throw new AppError('E_CANCELLED');
        }
        this.clips.set(index, clip);
        this.session.generatedSeconds += clip.seconds;
        this.session.generatedWords += countWords(sentence.text);
        this.deps.onDiagnostic?.('synthesis', {
          seconds: Math.round(clip.seconds * 100) / 100,
          inferenceMs: result.inferenceMs,
          rtf: Math.round((result.inferenceMs / 1000 / Math.max(0.01, clip.seconds)) * 100) / 100,
          chars: sentence.text.length,
          voice,
        });
        return clip;
      },
    });
  }

  /** Synthesizes one part of a sentence (fast start). */
  private synthPart(index: number, part: 'head' | 'tail', text: string, priority: number): Promise<Part> {
    const s = this.session!;
    const voice = this.voiceFor(index);
    const voices = this.voicesKey();
    const sessionId = s.id;
    return this.queue.enqueue<Part>({
      key: `${this.clipKey(index)}:${part}`,
      priority,
      run: async (signal) => {
        const provider = await this.deps.models.providerFor(voice, s.config.variantId, s.config.backend);
        await this.deps.models.ensureVoice(voice);
        const result = await provider.synthesize(text, { voice, speed: 1, signal });
        if (result.kind !== 'pcm') throw new AppError('E_SYNTHESIS', 'Expected PCM audio');
        if (this.session?.id !== sessionId || this.voicesKey() !== voices) throw new AppError('E_CANCELLED');
        const seconds = result.samples.length / result.sampleRate;
        this.session.generatedSeconds += seconds;
        this.session.generatedWords += countWords(text);
        this.deps.onDiagnostic?.('synthesis', {
          seconds: Math.round(seconds * 100) / 100,
          inferenceMs: result.inferenceMs,
          rtf: Math.round((result.inferenceMs / 1000 / Math.max(0.01, seconds)) * 100) / 100,
          chars: text.length,
          part,
          voice,
        });
        const wav = encodeWav(result.samples, result.sampleRate);
        return { url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })), samples: result.samples, sampleRate: result.sampleRate, seconds };
      },
    });
  }

  /** Keeps the next N sentences generating and frees clips well behind the playhead. */
  private schedule(index: number) {
    const s = this.session;
    if (!s || s.config.engine !== 'kokoro') return;
    const ahead = s.config.prefetchSentences;
    this.queue.rescore((key) => {
      const sentence = Number(key.split(':')[2]);
      if (!key.startsWith(`${s.id}:${this.voicesKey()}:`) || sentence < index || sentence > index + ahead) return null;
      return sentence - index;
    });
    for (let i = index + 1; i <= Math.min(s.doc.sentences.length - 1, index + ahead); i++) {
      this.requestClip(i, i - index).catch(() => undefined);
    }
    for (const [i, clip] of this.clips) {
      if (i < index - KEEP_BEHIND || i > index + ahead + 2) {
        URL.revokeObjectURL(clip.url);
        this.clips.delete(i);
        this.queue.forget(this.clipKey(i));
      }
    }
  }

  // --------------------------------------------------------------- playback

  private async playFrom(index: number): Promise<void> {
    const s = this.session;
    if (!s) return;
    const token = ++this.playToken;
    this.pendingTail = null;
    this.restartOnPlay = false;
    this.browserAbort?.abort();
    this.haltAudio();
    if (index >= s.doc.sentences.length) {
      s.index = s.doc.sentences.length - 1;
      this.setStatus('ended');
      this.deps.onEnded(s.id, true);
      return;
    }
    s.index = Math.max(0, index);
    // Time to first audio counts from the latest request made before any audio played.
    if (s.firstAudioAt === null) s.requestedAt = performance.now();
    this.setStatus(this.clips.has(s.index) ? 'playing' : 'buffering');

    if (s.config.engine === 'browser') {
      await this.playBrowserSentence(token);
      return;
    }

    let url: string;
    try {
      const ready = this.clips.has(s.index) || this.queue.has(this.clipKey(s.index));
      const split = ready ? null : fastStartSplit(s.doc.sentences[s.index]!.text);
      if (split) {
        const index = s.index;
        const head = await this.synthPart(index, 'head', split[0], -3);
        const promise = this.synthPart(index, 'tail', split[1], -2);
        promise.catch(() => undefined);
        this.pendingTail = { index, token, head, promise };
        url = head.url;
      } else {
        url = (await this.requestClip(s.index, -1)).url;
      }
    } catch (error) {
      if (token === this.playToken) this.fail(error);
      return;
    }
    if (token !== this.playToken || this.session !== s) return;
    this.schedule(s.index);
    this.audio.src = url;
    this.audio.playbackRate = s.config.rate;
    this.audio.volume = s.config.volume;
    try {
      await this.audio.play();
    } catch (error) {
      if (token === this.playToken && !interrupted(error)) this.fail(new AppError('E_PLAYBACK', String(error)));
      return;
    }
    if (token !== this.playToken) return;
    if (s.firstAudioAt === null) {
      s.firstAudioAt = performance.now();
      this.deps.onDiagnostic?.('first-audio', { ms: Math.round(s.firstAudioAt - s.requestedAt), backend: this.deps.models.getState().activeBackend });
    }
    this.setStatus('playing');
  }

  private async playBrowserSentence(token: number) {
    const s = this.session!;
    const sentence = s.doc.sentences[s.index]!;
    const abort = new AbortController();
    this.browserAbort = abort;
    this.setStatus('playing');
    try {
      await this.deps.browser.speak(sentence.text, s.config.browserVoice, s.config.rate, s.config.volume, abort.signal);
    } catch (error) {
      if (token === this.playToken && !(error instanceof AppError && error.code === 'E_CANCELLED')) this.fail(error);
      return;
    }
    if (token === this.playToken && this.session === s && s.status === 'playing') void this.playFrom(s.index + 1);
  }

  private onClipEnded() {
    const s = this.session;
    if (!s || s.status !== 'playing') return;
    const pending = this.pendingTail;
    if (pending && pending.index === s.index && pending.token === this.playToken) {
      this.pendingTail = null;
      void this.playTail(pending);
      return;
    }
    void this.playFrom(s.index + 1);
  }

  /** Plays the rest of a fast-started sentence, then caches the whole sentence as one clip. */
  private async playTail(pending: PendingTail) {
    const s = this.session!;
    let tail: Part;
    try {
      const settled = await Promise.race([pending.promise, Promise.resolve(null)]);
      if (!settled) this.setStatus('buffering');
      tail = await pending.promise;
    } catch (error) {
      if (pending.token === this.playToken) this.fail(error);
      return;
    }
    if (pending.token !== this.playToken || this.session !== s) return;
    this.audio.src = tail.url;
    this.audio.playbackRate = s.config.rate;
    this.audio.volume = s.config.volume;
    try {
      await this.audio.play();
    } catch (error) {
      if (pending.token === this.playToken && !interrupted(error)) this.fail(new AppError('E_PLAYBACK', String(error)));
      return;
    }
    this.setStatus('playing');
    // Keep the joined sentence so "previous" replays it without new inference.
    const samples = concatenate([pending.head.samples, tail.samples], tail.sampleRate, 0.03);
    const wav = encodeWav(samples, tail.sampleRate);
    if (!this.clips.has(pending.index)) {
      this.clips.set(pending.index, {
        index: pending.index,
        url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })),
        samples,
        sampleRate: tail.sampleRate,
        seconds: samples.length / tail.sampleRate,
      });
    }
    for (const part of ['head', 'tail']) this.queue.forget(`${this.clipKey(pending.index)}:${part}`);
  }

  private blockStep(direction: 1 | -1): number {
    const s = this.session!;
    const current = s.doc.sentences[s.index];
    if (!current) return s.index;
    if (direction === 1) {
      const next = s.doc.sentences.findIndex((sentence) => sentence.blockId > current.blockId);
      return next < 0 ? s.doc.sentences.length : next;
    }
    const blockStart = s.doc.sentences.findIndex((sentence) => sentence.blockId === current.blockId);
    // Like a music player: "previous" first returns to the start of the current paragraph.
    if (blockStart < s.index) return blockStart;
    const previousBlock = [...s.doc.sentences].reverse().find((sentence) => sentence.blockId < current.blockId);
    if (!previousBlock) return 0;
    return s.doc.sentences.findIndex((sentence) => sentence.blockId === previousBlock.blockId);
  }

  async control(action: ControlAction, index?: number): Promise<void> {
    const s = this.session;
    if (!s) return;
    switch (action) {
      case 'pause':
        if (s.config.engine === 'browser') this.deps.browser.pause();
        else this.haltAudio();
        this.setStatus('paused');
        return;
      case 'play':
      case 'toggle': {
        if (action === 'toggle' && (s.status === 'playing' || s.status === 'buffering')) return this.control('pause');
        if (this.restartOnPlay) return this.playFrom(s.status === 'ended' ? 0 : s.index);
        if (s.status === 'paused' && s.config.engine === 'kokoro' && this.audio.src && !this.audio.ended) {
          this.setStatus('playing');
          await this.audio.play().catch((error: unknown) => {
            if (!interrupted(error)) this.fail(new AppError('E_PLAYBACK', String(error)));
          });
          return;
        }
        if (s.status === 'paused' && s.config.engine === 'browser') {
          this.setStatus('playing');
          this.deps.browser.resume();
          return;
        }
        if (s.status === 'error') {
          try {
            await this.prepareEngine();
          } catch (error) {
            this.fail(error);
            return;
          }
        }
        return this.playFrom(s.status === 'ended' ? 0 : s.index);
      }
      case 'stop':
        this.stop();
        return;
      case 'next':
        return this.playFrom(s.index + 1);
      case 'previous':
        return this.playFrom(Math.max(0, s.index - 1));
      case 'next-block':
        return this.playFrom(this.blockStep(1));
      case 'previous-block':
        return this.playFrom(this.blockStep(-1));
      case 'seek':
        return this.playFrom(Math.min(s.doc.sentences.length - 1, Math.max(0, index ?? s.index)));
      case 'restart':
        return this.playFrom(0);
    }
  }

  async set({ rate, volume, voice, config }: { rate?: number; volume?: number; voice?: string; config?: EngineConfig }) {
    const s = this.session;
    if (!s) return;
    if (config) s.config = { ...config, rate: s.config.rate, volume: s.config.volume, voice: s.config.voice, nepaliVoice: s.config.nepaliVoice };
    if (rate !== undefined) {
      s.config.rate = clampRate(rate);
      this.audio.playbackRate = s.config.rate;
    }
    if (volume !== undefined) {
      s.config.volume = clampVolume(volume);
      this.audio.volume = s.config.volume;
    }
    // A Nepali voice picked during a session replaces the Nepali voice, not the main one.
    const nepali = s.config.engine === 'kokoro' && voice !== undefined && isNepaliVoice(voice) && !isNepaliVoice(s.config.voice);
    const currentVoice = s.config.engine === 'browser' ? s.config.browserVoice : nepali ? s.config.nepaliVoice : s.config.voice;
    if (voice !== undefined && voice !== currentVoice) {
      const wasActive = s.status === 'playing' || s.status === 'buffering' || s.status === 'preparing';
      // Whatever is loaded or speaking is in the old voice; drop it.
      this.playToken += 1;
      this.pendingTail = null;
      this.browserAbort?.abort();
      void this.deps.browser.cancel();
      this.haltAudio();
      this.audio.removeAttribute('src');
      this.audio.load();
      if (s.config.engine === 'browser') s.config.browserVoice = voice;
      else {
        if (nepali) s.config.nepaliVoice = voice;
        else s.config.voice = voice;
        this.queue.cancelAll();
        for (const clip of this.clips.values()) URL.revokeObjectURL(clip.url);
        this.clips.clear();
        try {
          await this.deps.models.ensureVoice(voice);
        } catch (error) {
          this.fail(error);
          return;
        }
      }
      if (wasActive) {
        await this.playFrom(s.index);
        return;
      }
      this.restartOnPlay = true;
    }
    this.emit();
  }

  // -------------------------------------------------------------- extras

  async previewVoice(voice: string, text: string, config: EngineConfig): Promise<void> {
    if (this.session?.status === 'playing') await this.control('pause');
    if (config.engine === 'browser') {
      await this.deps.browser.initialize();
      await this.deps.browser.speak(text, voice, config.rate, config.volume);
      return;
    }
    const provider = await this.deps.models.providerFor(voice, config.variantId, config.backend);
    await this.deps.models.ensureVoice(voice);
    const result = await this.queue.enqueue({
      key: `preview:${voice}:${Date.now()}`,
      priority: -2,
      run: (signal) =>
        provider.synthesize(text, { voice, signal }).then((audio) => {
          if (audio.kind !== 'pcm') throw new AppError('E_SYNTHESIS');
          const wav = encodeWav(audio.samples, audio.sampleRate);
          return { index: -1, url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })), samples: audio.samples, sampleRate: audio.sampleRate, seconds: 0 };
        }),
    });
    if (this.preview.src) URL.revokeObjectURL(this.preview.src);
    this.preview.src = result.url;
    this.preview.playbackRate = config.rate;
    this.preview.volume = config.volume;
    await this.preview.play();
  }

  /** Synthesizes a whole document into one WAV file. Runs behind live playback in the queue. */
  async exportWav(doc: ReadingDoc, voice: string, speed: number, config: EngineConfig): Promise<ExportResult> {
    if (config.engine !== 'kokoro') throw new AppError('E_EXPORT', 'Audio export needs the Kokoro engine');
    if (!doc.sentences.length) throw new AppError('E_EMPTY_TEXT');
    const exportId = `export:${Date.now()}`;
    const pieces: Float32Array[] = [];
    // Kokoro speaks at 24 kHz and the Nepali voices at 22.05 kHz; a mixed export is resampled to 24 kHz.
    const sampleRate = 24_000;
    const voices = new Set<string>();
    const nepaliDocument = isNepaliDocument(doc.sentences);
    let previousBlock: number | null = null;
    for (const sentence of doc.sentences) {
      const sentenceVoice = voiceForSentence(sentence.text, voice, config.nepaliVoice, nepaliDocument);
      voices.add(sentenceVoice);
      const provider = await this.deps.models.providerFor(sentenceVoice, config.variantId, config.backend);
      await this.deps.models.ensureVoice(sentenceVoice);
      const audio = await this.queue.enqueue({
        key: `${exportId}:${sentence.id}`,
        priority: 1000 + sentence.id,
        run: (signal) => provider.synthesize(sentence.text, { voice: sentenceVoice, speed, signal }),
      });
      this.queue.forget(`${exportId}:${sentence.id}`);
      if (audio.kind !== 'pcm') throw new AppError('E_EXPORT');
      if (previousBlock !== null && previousBlock !== sentence.blockId) pieces.push(new Float32Array(Math.round(0.35 * sampleRate)));
      pieces.push(resample(audio.samples, audio.sampleRate, sampleRate));
      previousBlock = sentence.blockId;
    }
    const samples = concatenate(pieces, sampleRate, 0.12);
    const wav = encodeWav(samples, sampleRate, {
      title: doc.title,
      artist: [...voices].map((id) => (isNepaliVoice(id) ? `Piper (${id})` : `Kokoro-82M (${id})`)).join(', '),
      software: 'Kokoro Reader',
      date: new Date().toISOString().slice(0, 10),
    });
    if (this.exportUrl) URL.revokeObjectURL(this.exportUrl);
    this.exportUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    return { url: this.exportUrl, filename: safeFilename(doc.title), durationSeconds: Math.round((samples.length / sampleRate) * 10) / 10, bytes: wav.byteLength };
  }
}
