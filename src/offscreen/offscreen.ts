/**
 * Offscreen document: the long-lived home of the speech engine and audio.
 *
 * Manifest V3 service workers are suspended when idle and cannot play audio,
 * so the background worker creates this document (reasons AUDIO_PLAYBACK and
 * WORKERS) and forwards commands to it. It owns the model manager, the
 * inference worker and the playback controller. Offscreen documents can only
 * use chrome.runtime, so everything persistent is reported back to the
 * background, which stores it.
 */
import { PlaybackController } from '@/audio/playback-controller';
import { BrowserSpeechProvider } from '@/engine/fallback/browser-speech-provider';
import { ModelManager } from '@/models/model-manager';
import { articleFromSnapshot } from '@/shared/extraction/article';
import { emit, listen } from '@/shared/messages/bus';
import type { DiagnosticEvent } from '@/shared/types';

const IDLE_REPORT_MS = 60_000;

/** Routed through the background, which applies the user's diagnostics setting and stores it. */
function diagnostic(kind: DiagnosticEvent['kind'], data: DiagnosticEvent['data']) {
  emit('offscreen/diagnostic', { kind, data });
}

const browser = new BrowserSpeechProvider();
const models = new ModelManager({
  onState: (state) => emit('model/state', state),
  onDiagnostic: diagnostic,
});
const player = new PlaybackController({
  models,
  browser,
  emitState: (state) => emit('playback/state', state),
  onEnded: (sessionId, completed) => emit('session/ended', { sessionId, completed }),
  onDiagnostic: diagnostic,
});

listen({
  targets: ['offscreen'],
  requests: {
    'offscreen/ping': () => ({ alive: true, sessionId: player.sessionId }),
    'offscreen/load': async ({ sessionId, doc, startSentence, config }) => {
      // Resolve once the session is accepted; preparation progress arrives as events.
      void player.load(sessionId, doc, startSentence, config);
      return null;
    },
    'offscreen/control': async ({ sessionId, action, index }) => {
      if (sessionId && sessionId !== player.sessionId) return null;
      await player.control(action, index);
      return null;
    },
    'offscreen/set': async (patch) => {
      await player.set(patch);
      return null;
    },
    'offscreen/model-state': ({ variantId }) => models.refresh(variantId),
    'offscreen/model': async ({ action, variantId, backend }) => {
      switch (action) {
        case 'download':
          void models.download(variantId).catch(() => undefined);
          break;
        case 'pause':
          models.pause();
          break;
        case 'cancel':
          await models.cancel(variantId);
          break;
        case 'clear':
          await models.clear(variantId);
          break;
        case 'validate':
          // Report the validation outcome itself (an integrity error stays visible with its recovery action).
          await models.validate(variantId);
          return models.getState();
        case 'initialize':
          void models.ensureReady(variantId, backend).catch(() => undefined);
          break;
        case 'unload':
          await models.unload();
          break;
      }
      return action === 'download' || action === 'initialize' ? models.getState() : models.refresh(variantId);
    },
    'offscreen/preview': async ({ voice, text, config }) => {
      await player.previewVoice(voice, text, config);
      return null;
    },
    'offscreen/export': ({ doc, voice, speed, config }) => player.exportWav(doc, voice, speed, config),
    'offscreen/browser-voices': () => browser.getVoices(),
    'offscreen/parse-article': ({ snapshot }) => articleFromSnapshot(snapshot),
    'offscreen/metrics': async () => {
      const measure = (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory;
      const memory = crossOriginIsolated && measure ? await measure.call(performance).catch(() => null) : null;
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return { memoryBytes: memory?.bytes ?? null, jsHeapBytes: heap?.usedJSHeapSize ?? null, modelLoaded: models.getState().status === 'ready' };
    },
  },
});

setInterval(() => {
  const idleMs = player.idleMs();
  const busy = ['downloading', 'verifying', 'initializing'].includes(models.getState().status);
  if (idleMs >= IDLE_REPORT_MS && !busy) emit('offscreen/idle', { idleMs });
}, 30_000);
