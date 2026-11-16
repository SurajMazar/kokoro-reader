import { AlertCircle, CheckCircle2, Cpu, Download, HardDriveDownload, Loader2, Pause, RotateCcw, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { request } from '@/shared/messages/bus';
import type { ModelAction } from '@/shared/messages/contract';
import type { ModelState } from '@/shared/types';
import { formatBytes, formatRelative } from '@/shared/utils/format';
import { getVariant, MODEL_NAME, MODEL_REVISION, variantDownloadBytes } from '@/models/registry';
import { Button, Card, cx, Progress } from './primitives';

const LABELS: Record<ModelState['status'], string> = {
  'not-downloaded': 'Not downloaded',
  downloading: 'Downloading',
  paused: 'Download paused',
  verifying: 'Verifying',
  downloaded: 'Downloaded',
  initializing: 'Starting engine',
  ready: 'Ready',
  error: 'Error',
};

export function modelAction(action: ModelAction, variantId?: string) {
  return request('model/action', { action, variantId }).catch((error: unknown) => console.warn(error));
}

export function StatusDot({ status }: { status: ModelState['status'] | undefined }) {
  const color =
    status === 'ready' || status === 'downloaded'
      ? 'bg-success'
      : status === 'error'
        ? 'bg-danger'
        : status === 'downloading' || status === 'initializing' || status === 'verifying'
          ? 'bg-accent animate-pulse'
          : 'bg-subtle';
  return <span aria-hidden="true" className={cx('inline-block size-2 rounded-full', color)} />;
}

export function backendLabel(state: ModelState | null): string {
  if (!state?.activeBackend) return 'Not running';
  if (state.activeBackend === 'webgpu') return 'WebGPU (GPU)';
  return `WebAssembly (CPU, ${state.threads ?? 1} thread${state.threads === 1 ? '' : 's'})`;
}

/** Compact model status line for the popup. */
export function ModelBadge({ state }: { state: ModelState | null }) {
  const status = state?.status ?? 'not-downloaded';
  const pct = state?.progress ? Math.floor((state.progress.loaded / Math.max(1, state.progress.total)) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      <StatusDot status={status} />
      {status === 'downloading' ? `Downloading ${pct}%` : LABELS[status]}
      {state?.activeBackend && <span className="text-subtle">· {state.activeBackend === 'webgpu' ? 'WebGPU' : 'WASM'}</span>}
    </span>
  );
}

/** Full model manager card: download, pause/resume, retry, validate, clear, and live engine details. */
export function ModelManagerCard({ state, variantId }: { state: ModelState | null; variantId: string }) {
  const variant = getVariant(variantId);
  const status = state?.variantId === variantId ? state.status : 'not-downloaded';
  const size = variantDownloadBytes(variant);
  const progress = state?.progress;
  const busy = status === 'downloading' || status === 'initializing' || status === 'verifying';

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-10 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
          <Cpu size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold">{MODEL_NAME}</h3>
            <span className="rounded-md bg-hover px-1.5 py-0.5 text-[11px] font-medium text-muted">{variant.label}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-muted">
            ONNX · {formatBytes(size)} download · Apache-2.0 · revision <code className="text-[11px]">{MODEL_REVISION.slice(0, 7)}</code>
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] font-medium">
          <StatusDot status={status} />
          {LABELS[status]}
        </span>
      </div>

      {(status === 'downloading' || status === 'paused') && progress && (
        <div className="mt-4">
          <Progress value={progress.loaded} max={progress.total} label="Model download progress" />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted tabular-nums">
            <span>
              {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
            </span>
            <span>{Math.floor((progress.loaded / Math.max(1, progress.total)) * 100)}%</span>
          </div>
        </div>
      )}

      {state?.error && status === 'error' && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--kr-danger)_10%,transparent)] p-2.5 text-[12px] text-danger">
          <AlertCircle size={15} className="mt-px flex-none" />
          <div>
            <div className="font-medium">{state.error.message}</div>
            <div className="mt-0.5 opacity-80">Code {state.error.code}</div>
          </div>
        </div>
      )}
      {state?.error?.code === 'E_WEBGPU_UNAVAILABLE' && status === 'ready' && (
        <p className="mt-3 text-[12px] text-warning">WebGPU failed its readiness test on this device, so Kokoro is running on the CPU.</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        <dt className="text-muted">Execution backend</dt>
        <dd className="flex items-center gap-1 font-medium">
          {state?.activeBackend === 'webgpu' ? <Zap size={13} className="text-accent" /> : null}
          {backendLabel(state?.variantId === variantId ? state : null)}
        </dd>
        <dt className="text-muted">Cache size</dt>
        <dd className="font-medium">{formatBytes(state?.cachedBytes ?? 0)}</dd>
        <dt className="text-muted">Initialization</dt>
        <dd className="font-medium">{state?.initMs ? `${(state.initMs / 1000).toFixed(1)} s` : '—'}</dd>
        <dt className="text-muted">Last used</dt>
        <dd className="font-medium">{state?.lastUsed ? formatRelative(state.lastUsed) : '—'}</dd>
        <dt className="text-muted">Multithreading</dt>
        <dd className="font-medium">{state?.crossOriginIsolated === null || state?.crossOriginIsolated === undefined ? '—' : state.crossOriginIsolated ? 'Available' : 'Unavailable'}</dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {status === 'not-downloaded' && (
          <Button variant="primary" onClick={() => void modelAction('download', variantId)}>
            <Download size={14} /> Download {formatBytes(size)}
          </Button>
        )}
        {status === 'downloading' && (
          <Button onClick={() => void modelAction('pause', variantId)}>
            <Pause size={14} /> Pause
          </Button>
        )}
        {status === 'paused' && (
          <>
            <Button variant="primary" onClick={() => void modelAction('download', variantId)}>
              <HardDriveDownload size={14} /> Resume
            </Button>
            <Button variant="ghost" onClick={() => void modelAction('cancel', variantId)}>
              Cancel
            </Button>
          </>
        )}
        {status === 'error' && (
          <Button variant="primary" onClick={() => void modelAction('download', variantId)}>
            <RotateCcw size={14} /> Retry
          </Button>
        )}
        {status === 'downloaded' && (
          <Button variant="primary" onClick={() => void modelAction('initialize', variantId)}>
            <Zap size={14} /> Start engine
          </Button>
        )}
        {busy && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <Loader2 size={14} className="animate-spin" /> {LABELS[status]}…
          </span>
        )}
        {(status === 'downloaded' || status === 'ready' || status === 'error') && (
          <Button onClick={() => void modelAction('validate', variantId)}>
            <ShieldCheck size={14} /> Verify files
          </Button>
        )}
        {status !== 'not-downloaded' && !busy && (
          <Button variant="danger" onClick={() => void modelAction('clear', variantId)}>
            <Trash2 size={14} /> Clear cache
          </Button>
        )}
        {status === 'ready' && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
            <CheckCircle2 size={14} /> Real ONNX inference verified on this device
          </span>
        )}
      </div>
    </Card>
  );
}
