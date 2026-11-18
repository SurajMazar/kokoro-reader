import type { TTSProvider } from '@/engine/contracts/tts-provider';
import { KokoroProvider } from '@/engine/kokoro/kokoro-provider';
import { voiceFilePath } from '@/engine/kokoro/voices';
import { PiperProvider } from '@/engine/piper/piper-provider';
import { getNepaliVoice, getPack, packBytes, packFiles, VOICE_PACKS } from '@/engine/piper/voices';
import { AppError, toErrorInfo } from '@/shared/errors';
import type { BackendId, BackendPreference, ModelState, VoicePackState } from '@/shared/types';
import { deletePartials } from '@/shared/storage/idb';
import { cachedBytes, clearModelCache, deleteCached, ensureFile, isCached, validateCached, type FileProgress } from './model-store';
import { getVariant, variantDownloadBytes, variantFiles, type ModelVariant } from './registry';

export interface ModelManagerOptions {
  onState: (state: ModelState) => void;
  onDiagnostic?: (kind: 'model-init' | 'download' | 'error', data: Record<string, number | string | boolean | null>) => void;
  /** Overridable for tests. */
  createProvider?: (variant: ModelVariant, backend: BackendId) => KokoroProvider;
  /** Overridable for tests. */
  createPiper?: () => PiperProvider;
  hasWebGpu?: () => boolean;
}

function initialPacks(): Record<string, VoicePackState> {
  return Object.fromEntries(
    VOICE_PACKS.map((pack) => [pack.id, { status: 'not-downloaded', progress: null, bytes: packBytes(pack), error: null } satisfies VoicePackState]),
  );
}

/**
 * Owns the model lifecycle in the offscreen document: download, pause,
 * resume, validation, initialization with backend fallback, and unloading.
 */
export class ModelManager {
  private state: ModelState;
  private provider: KokoroProvider | null = null;
  private providerVariant: string | null = null;
  private downloadAbort: AbortController | null = null;
  private downloadPromise: Promise<void> | null = null;
  private readyPromise: Promise<KokoroProvider> | null = null;
  private piper: PiperProvider | null = null;
  private piperPromise: Promise<PiperProvider> | null = null;
  private packDownloads = new Map<string, Promise<void>>();

  constructor(private readonly options: ModelManagerOptions) {
    this.state = {
      variantId: 'q8',
      status: 'not-downloaded',
      progress: null,
      activeBackend: null,
      crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
      threads: null,
      cachedBytes: 0,
      lastUsed: null,
      initMs: null,
      error: null,
      packs: initialPacks(),
    };
  }

  getState(): ModelState {
    return this.state;
  }

  private set(patch: Partial<ModelState>) {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }

  private hasWebGpu(): boolean {
    return this.options.hasWebGpu ? this.options.hasWebGpu() : typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  async isDownloaded(variantId: string): Promise<boolean> {
    for (const file of variantFiles(getVariant(variantId))) {
      if (!(await isCached(file.path))) return false;
    }
    return true;
  }

  /** Recomputes status from the cache, e.g. after the offscreen document restarts. */
  async refresh(variantId: string): Promise<ModelState> {
    // A download, initialization or validation can finish while the cache is
    // read below. Its status is newer than anything this poll can conclude.
    const before = this.state.status;
    const downloaded = await this.isDownloaded(variantId);
    const bytes = await cachedBytes().catch(() => 0);
    const packsCached = await this.packsCached();
    const changed = this.state.status !== before;
    const busy = ['downloading', 'verifying', 'initializing'].includes(this.state.status);
    const ready = this.provider?.ready && this.providerVariant === variantId;
    const same = this.state.variantId === variantId;
    // Busy states and errors are only left by an explicit action (download,
    // initialize, validate, clear), so a status poll never hides an error.
    const status: ModelState['status'] =
      same && (changed || busy || this.state.status === 'error')
        ? this.state.status
        : ready
          ? 'ready'
          : downloaded
            ? 'downloaded'
            : same && this.state.status === 'paused'
              ? 'paused'
              : 'not-downloaded';
    this.set({ variantId, status, cachedBytes: bytes, packs: this.packStates(packsCached) });
    return this.state;
  }

  // ------------------------------------------------------------ voice packs

  private async packDownloaded(packId: string): Promise<boolean> {
    for (const file of packFiles(getPack(packId))) {
      if (!(await isCached(file.path))) return false;
    }
    return true;
  }

  private async packsCached(): Promise<Record<string, boolean>> {
    const cached: Record<string, boolean> = {};
    for (const pack of VOICE_PACKS) cached[pack.id] = await this.packDownloaded(pack.id);
    return cached;
  }

  /** Pack states from the cache. A download in progress keeps its state; a failed one keeps its error until the files are there. */
  private packStates(cached: Record<string, boolean>): Record<string, VoicePackState> {
    const packs = { ...this.state.packs };
    for (const pack of VOICE_PACKS) {
      const current = packs[pack.id]!;
      if (current.status === 'downloading') continue;
      const downloaded = cached[pack.id] ?? false;
      if (!downloaded && current.status === 'error') continue;
      packs[pack.id] = { ...current, status: downloaded ? 'downloaded' : 'not-downloaded', progress: null, error: null };
    }
    return packs;
  }

  private setPack(packId: string, patch: Partial<VoicePackState>) {
    this.set({ packs: { ...this.state.packs, [packId]: { ...this.state.packs[packId]!, ...patch } } });
  }

  /** Downloads and verifies a voice pack. Concurrent calls share one download. */
  downloadPack(packId: string): Promise<void> {
    const running = this.packDownloads.get(packId);
    if (running) return running;
    const pack = getPack(packId);
    const total = packBytes(pack);
    const loadedByFile = new Map<string, number>();
    const abort = new AbortController();
    this.setPack(packId, { status: 'downloading', progress: { loaded: 0, total }, error: null });
    const run = (async () => {
      try {
        let lastEmit = 0;
        for (const file of packFiles(pack)) {
          await ensureFile(file.path, abort.signal, ({ file: name, loaded }: FileProgress) => {
            loadedByFile.set(name, loaded);
            const now = performance.now();
            if (now - lastEmit > 200) {
              lastEmit = now;
              const sum = [...loadedByFile.values()].reduce((a, b) => a + b, 0);
              this.setPack(packId, { progress: { loaded: sum, total, file: name } });
            }
          });
        }
        this.setPack(packId, { status: 'downloaded', progress: null });
        this.set({ cachedBytes: await cachedBytes().catch(() => this.state.cachedBytes) });
      } catch (error) {
        const info = toErrorInfo(error, 'E_MODEL_DOWNLOAD');
        this.setPack(packId, { status: 'error', progress: null, error: info });
        this.options.onDiagnostic?.('error', { code: info.code, phase: 'pack-download' });
        throw new AppError(info.code, info.detail);
      } finally {
        this.packDownloads.delete(packId);
      }
    })();
    this.packDownloads.set(packId, run);
    return run;
  }

  async deletePack(packId: string): Promise<void> {
    await this.packDownloads.get(packId)?.catch(() => undefined);
    for (const file of packFiles(getPack(packId))) await deleteCached(file.path);
    // The worker keeps loaded sessions; restart it so a deleted pack is not used from memory.
    await this.unloadPiper();
    this.setPack(packId, { status: 'not-downloaded', progress: null, error: null });
    this.set({ cachedBytes: await cachedBytes().catch(() => this.state.cachedBytes) });
  }

  private async ensurePack(packId: string): Promise<void> {
    if (!(await this.packDownloaded(packId))) await this.downloadPack(packId);
  }

  private ensurePiper(): Promise<PiperProvider> {
    if (this.piper?.ready) return Promise.resolve(this.piper);
    this.piperPromise ??= (async () => {
      const provider = this.options.createPiper?.() ?? new PiperProvider({ onCrash: () => (this.piper = null) });
      try {
        await provider.initialize();
      } catch (error) {
        await provider.dispose().catch(() => undefined);
        throw error;
      }
      this.piper = provider;
      return provider;
    })().finally(() => {
      this.piperPromise = null;
    });
    return this.piperPromise;
  }

  private async unloadPiper() {
    const piper = this.piper;
    this.piper = null;
    if (piper) await piper.dispose().catch(() => undefined);
  }

  /**
   * The engine for a voice, ready to synthesize: the Piper engine for a
   * Nepali voice (downloading its pack on first use), Kokoro otherwise.
   */
  async providerFor(voice: string, variantId: string, preference: BackendPreference): Promise<TTSProvider> {
    const nepali = getNepaliVoice(voice);
    if (!nepali) return this.ensureReady(variantId, preference);
    await this.ensurePack(nepali.packId);
    const provider = await this.ensurePiper();
    this.set({ lastUsed: Date.now() });
    return provider;
  }

  download(variantId: string): Promise<void> {
    if (this.downloadPromise && this.state.variantId === variantId) return this.downloadPromise;
    const variant = getVariant(variantId);
    const files = variantFiles(variant);
    const total = variantDownloadBytes(variant);
    const loadedByFile = new Map<string, number>();
    const abort = new AbortController();
    this.downloadAbort = abort;
    const started = performance.now();
    this.set({ variantId, status: 'downloading', progress: { loaded: 0, total }, error: null });

    const run = async () => {
      try {
        let lastEmit = 0;
        for (const file of files) {
          await ensureFile(file.path, abort.signal, ({ file: name, loaded }: FileProgress) => {
            loadedByFile.set(name, loaded);
            const now = performance.now();
            if (now - lastEmit > 200) {
              lastEmit = now;
              const sum = [...loadedByFile.values()].reduce((a, b) => a + b, 0);
              this.set({ status: 'downloading', progress: { loaded: sum, total, file: name } });
            }
          });
        }
        this.set({ status: 'downloaded', progress: { loaded: total, total }, cachedBytes: await cachedBytes().catch(() => total) });
        this.options.onDiagnostic?.('download', { variant: variantId, bytes: total, ms: Math.round(performance.now() - started) });
      } catch (error) {
        if (abort.signal.aborted) {
          this.set({ status: 'paused' });
          return;
        }
        const info = toErrorInfo(error, 'E_MODEL_DOWNLOAD');
        this.set({ status: 'error', error: info });
        this.options.onDiagnostic?.('error', { code: info.code, phase: 'download' });
        throw new AppError(info.code, info.detail);
      } finally {
        if (this.downloadAbort === abort) this.downloadAbort = null;
        this.downloadPromise = null;
      }
    };
    this.downloadPromise = run();
    return this.downloadPromise;
  }

  pause() {
    this.downloadAbort?.abort();
  }

  async cancel(variantId: string) {
    this.downloadAbort?.abort();
    await this.downloadPromise?.catch(() => undefined);
    for (const file of variantFiles(getVariant(variantId))) await deletePartials(file.path);
    this.set({ status: 'not-downloaded', progress: null });
    await this.refresh(variantId);
  }

  async clear(variantId: string) {
    this.downloadAbort?.abort();
    await this.unload();
    await clearModelCache();
    this.set({ status: 'not-downloaded', progress: null, activeBackend: null, error: null, cachedBytes: 0, initMs: null, packs: initialPacks() });
    await this.refresh(variantId);
  }

  /** Re-hashes every cached file of the variant; corrupted files are removed. */
  async validate(variantId: string): Promise<boolean> {
    this.set({ variantId, status: 'verifying', error: null });
    let ok = true;
    for (const file of variantFiles(getVariant(variantId))) {
      if (!(await validateCached(file.path))) ok = false;
    }
    if (!ok) {
      await this.unload();
      this.set({ status: 'error', error: new AppError('E_MODEL_INTEGRITY', 'Validation found missing or corrupted files').toInfo() });
      return false;
    }
    // Leave the 'verifying' state before refreshing, or refresh() would treat it as busy and keep it.
    this.set({ status: this.provider?.ready && this.providerVariant === variantId ? 'ready' : 'downloaded' });
    await this.refresh(variantId);
    return true;
  }

  async ensureVoice(voice: string, signal?: AbortSignal) {
    const nepali = getNepaliVoice(voice);
    if (nepali) {
      await this.ensurePack(nepali.packId);
      return;
    }
    await ensureFile(voiceFilePath(voice), signal ?? new AbortController().signal, () => undefined);
  }

  /** Backends to try, best first. A variant never runs on a backend it is not verified for. */
  backendOrder(variant: ModelVariant, preference: BackendPreference): BackendId[] {
    if (preference === 'wasm' || !this.hasWebGpu() || !variant.backends.includes('webgpu')) return ['wasm'];
    return ['webgpu', 'wasm'];
  }

  /** Downloads if needed, then initializes the model, falling back from WebGPU to WASM. */
  ensureReady(variantId: string, preference: BackendPreference): Promise<KokoroProvider> {
    if (this.provider?.ready && this.providerVariant === variantId) {
      this.set({ lastUsed: Date.now() });
      return Promise.resolve(this.provider);
    }
    this.readyPromise ??= this.initialize(variantId, preference).finally(() => {
      this.readyPromise = null;
    });
    return this.readyPromise;
  }

  private async initialize(variantId: string, preference: BackendPreference): Promise<KokoroProvider> {
    const variant = getVariant(variantId);
    if (!(await this.isDownloaded(variantId))) await this.download(variantId);
    if (this.state.status === 'paused') throw new AppError('E_CANCELLED', 'Download paused');
    await this.unloadKokoro();
    this.set({ variantId, status: 'initializing', error: null });
    let lastError: unknown = null;
    for (const backend of this.backendOrder(variant, preference)) {
      const provider = this.options.createProvider
        ? this.options.createProvider(variant, backend)
        : new KokoroProvider({ variant, backend, onCrash: (error) => this.handleCrash(error) });
      try {
        const readiness = await provider.initialize();
        this.provider = provider;
        this.providerVariant = variantId;
        this.set({
          status: 'ready',
          activeBackend: readiness.backend,
          threads: readiness.threads,
          crossOriginIsolated: readiness.crossOriginIsolated,
          initMs: readiness.initMs,
          lastUsed: Date.now(),
          progress: null,
          cachedBytes: await cachedBytes().catch(() => this.state.cachedBytes),
          error: lastError ? new AppError('E_WEBGPU_UNAVAILABLE', String((lastError as Error).message ?? lastError)).toInfo() : null,
        });
        this.options.onDiagnostic?.('model-init', {
          variant: variantId,
          backend: readiness.backend,
          ms: readiness.initMs,
          threads: readiness.threads,
          isolated: readiness.crossOriginIsolated,
          fellBack: Boolean(lastError),
        });
        return provider;
      } catch (error) {
        lastError = error;
        await provider.dispose().catch(() => undefined);
      }
    }
    const info = toErrorInfo(lastError, 'E_MODEL_INIT');
    this.set({ status: 'error', error: info, activeBackend: null });
    this.options.onDiagnostic?.('error', { code: info.code, phase: 'init' });
    throw new AppError(info.code, info.detail, info.message);
  }

  private handleCrash(error: AppError) {
    this.provider = null;
    this.providerVariant = null;
    this.set({ status: 'error', activeBackend: null, error: error.toInfo() });
  }

  /** Frees both engines (idle timeout, settings, cache clear). */
  async unload() {
    await this.unloadPiper();
    await this.unloadKokoro();
  }

  private async unloadKokoro() {
    const provider = this.provider;
    this.provider = null;
    this.providerVariant = null;
    if (provider) await provider.dispose().catch(() => undefined);
    if (this.state.status === 'ready') this.set({ status: 'downloaded', activeBackend: null });
  }
}
