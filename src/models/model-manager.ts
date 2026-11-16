import { KokoroProvider } from '@/engine/kokoro/kokoro-provider';
import { voiceFilePath } from '@/engine/kokoro/voices';
import { AppError, toErrorInfo } from '@/shared/errors';
import type { BackendId, BackendPreference, ModelState } from '@/shared/types';
import { deletePartials } from '@/shared/storage/idb';
import { cachedBytes, clearModelCache, ensureFile, isCached, validateCached, type FileProgress } from './model-store';
import { getVariant, variantDownloadBytes, variantFiles, type ModelVariant } from './registry';

export interface ModelManagerOptions {
  onState: (state: ModelState) => void;
  onDiagnostic?: (kind: 'model-init' | 'download' | 'error', data: Record<string, number | string | boolean | null>) => void;
  /** Overridable for tests. */
  createProvider?: (variant: ModelVariant, backend: BackendId) => KokoroProvider;
  hasWebGpu?: () => boolean;
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
    const busy = ['downloading', 'verifying', 'initializing'].includes(this.state.status);
    const ready = this.provider?.ready && this.providerVariant === variantId;
    const same = this.state.variantId === variantId;
    // Busy states and errors are only left by an explicit action (download,
    // initialize, validate, clear), so a status poll never hides an error.
    const status: ModelState['status'] =
      same && (busy || this.state.status === 'error')
        ? this.state.status
        : ready
          ? 'ready'
          : (await this.isDownloaded(variantId))
            ? 'downloaded'
            : same && this.state.status === 'paused'
              ? 'paused'
              : 'not-downloaded';
    this.set({ variantId, status, cachedBytes: await cachedBytes().catch(() => 0) });
    return this.state;
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
    this.set({ status: 'not-downloaded', progress: null, activeBackend: null, error: null, cachedBytes: 0, initMs: null });
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
    await this.unload();
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

  async unload() {
    const provider = this.provider;
    this.provider = null;
    this.providerVariant = null;
    if (provider) await provider.dispose().catch(() => undefined);
    if (this.state.status === 'ready') this.set({ status: 'downloaded', activeBackend: null });
  }
}
