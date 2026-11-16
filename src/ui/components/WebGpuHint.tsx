import { Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getVariant, variantDownloadBytes } from '@/models/registry';
import type { Settings } from '@/shared/settings';
import { formatBytes } from '@/shared/utils/format';
import { Button } from './primitives';

/**
 * Suggests the WebGPU-capable model when this device has a GPU adapter. It is
 * a suggestion, not automatic, because it means a larger download and more memory.
 */
export function WebGpuHint({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => Promise<void> }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    void gpu?.requestAdapter().then((adapter) => setAvailable(Boolean(adapter))).catch(() => setAvailable(false));
  }, []);
  if (!available || settings.variantId === 'fp32' || settings.backend === 'wasm' || settings.engine !== 'kokoro') return null;
  const fp32 = getVariant('fp32');
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border-[0.5px] border-line bg-accent-soft p-3.5">
      <Zap size={18} className="mt-0.5 flex-none text-accent" />
      <div className="min-w-0 flex-1 text-[12.5px]">
        <div className="font-semibold text-text">This device supports WebGPU</div>
        <p className="mt-0.5 text-muted">
          The full-precision model runs on your GPU about 4× faster than real time, with near-instant start. It is a {formatBytes(variantDownloadBytes(fp32))} download and uses more memory.
        </p>
      </div>
      <Button size="sm" variant="primary" onClick={() => void update({ variantId: 'fp32', backend: 'auto' })}>
        Use GPU model
      </Button>
    </div>
  );
}
