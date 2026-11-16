import { CheckCircle2, Download, Headphones, Lock, MousePointerClick, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { getVariant, variantDownloadBytes } from '@/models/registry';
import { request } from '@/shared/messages/bus';
import { formatBytes } from '@/shared/utils/format';
import { ModelManagerCard } from '@/ui/components/ModelStatus';
import { FloatingButtonToggle } from '@/ui/components/PermissionToggle';
import { WebGpuHint } from '@/ui/components/WebGpuHint';
import { Button, Card } from '@/ui/components/primitives';
import { useModelState, useSettings, useTheme } from '@/ui/hooks';

const SAMPLE =
  'Kokoro Reader turns any page into audio. Select a paragraph, click the speaker, and a natural voice reads it to you, generated privately on your own computer.';

export function Welcome() {
  const [settings, update] = useSettings();
  useTheme(settings);
  const [model] = useModelState();
  const [trying, setTrying] = useState(false);
  const variant = getVariant(settings.variantId);

  return (
    <div className="mx-auto max-w-[760px] px-5 py-12">
      <div className="text-center">
        <img src="/icons/icon-128.png" alt="" className="mx-auto size-20 rounded-[22px] shadow-pop" />
        <h1 className="mt-5 text-[30px] font-semibold tracking-tight">Welcome to Kokoro Reader</h1>
        <p className="mx-auto mt-2 max-w-[520px] text-[15px] text-muted">Listen to any webpage with natural AI speech. Everything runs on your device: no account, no cloud, no tracking.</p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {[
          { icon: MousePointerClick, title: 'Select & listen', text: 'Highlight text and click the speaker that appears.' },
          { icon: Headphones, title: 'Read whole pages', text: 'Right-click → Read entire page, or open the Smart Reader.' },
          { icon: Lock, title: 'Private by design', text: 'Text never leaves your computer. Speech is generated locally.' },
        ].map(({ icon: Icon, title, text }) => (
          <Card key={title} className="p-4">
            <Icon size={20} className="text-accent" />
            <div className="mt-2 text-[14px] font-semibold">{title}</div>
            <div className="mt-1 text-[13px] text-muted">{text}</div>
          </Card>
        ))}
      </div>

      <h2 className="mt-10 mb-2 text-[15px] font-semibold">1. Choose how you start reading</h2>
      <Card className="px-4">
        <FloatingButtonToggle settings={settings} update={update} />
      </Card>

      <h2 className="mt-8 mb-2 text-[15px] font-semibold">2. Get the voice model</h2>
      <p className="mb-3 text-[13px] text-muted">
        Kokoro-82M ({formatBytes(variantDownloadBytes(variant))}) downloads once from Hugging Face and is verified by checksum. You can do it now or let it happen the first time you listen.
      </p>
      <WebGpuHint settings={settings} update={update} />
      <ModelManagerCard state={model} variantId={settings.variantId} />

      <h2 className="mt-8 mb-2 text-[15px] font-semibold">3. Try it</h2>
      <Card className="p-4">
        <p className="font-serif text-[17px] leading-relaxed">{SAMPLE}</p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="primary"
            disabled={trying}
            onClick={() => {
              setTrying(true);
              void request('voices/preview', { voice: settings.voice, text: SAMPLE }).finally(() => setTrying(false));
            }}
          >
            {trying ? <Sparkles size={14} className="animate-pulse" /> : model?.status === 'not-downloaded' ? <Download size={14} /> : <Headphones size={14} />}
            {trying ? 'Generating…' : model?.status === 'ready' || model?.status === 'downloaded' ? 'Play sample' : 'Download model and play'}
          </Button>
          {model?.status === 'ready' && (
            <span className="inline-flex items-center gap-1 text-[12px] text-success">
              <CheckCircle2 size={14} /> Engine ready on {model.activeBackend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}
            </span>
          )}
        </div>
      </Card>

      <p className="mt-10 text-center text-[12px] text-subtle">Shortcuts: Alt+Shift+R read selection · Alt+Shift+A read page · Alt+Shift+P play/pause · Alt+Shift+S stop</p>
    </div>
  );
}
