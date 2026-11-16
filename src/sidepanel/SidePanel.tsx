import { Bookmark, BookOpen, Headphones } from 'lucide-react';
import { useState } from 'react';
import { request } from '@/shared/messages/bus';
import { BookmarkList, QueueList } from '@/ui/components/Library';
import { ModelBadge } from '@/ui/components/ModelStatus';
import { isActive, PlayerControls, setPlayback } from '@/ui/components/PlayerControls';
import { Card, Empty, IconButton, Select } from '@/ui/components/primitives';
import { useModelState, usePlayback, useSettings, useTheme, useVoices } from '@/ui/hooks';

/** Side panel player: stays open across tabs, so it is the natural audiobook remote. */
export function SidePanel() {
  const [settings] = useSettings();
  useTheme(settings);
  const playback = usePlayback();
  const [model] = useModelState();
  const voices = useVoices(settings.engine);
  const [notice, setNotice] = useState<string | null>(null);
  const active = isActive(playback) ? playback : null;

  return (
    <div className="min-h-screen space-y-5 p-4">
      <header className="flex items-center gap-2.5">
        <img src="/icons/icon-48.png" alt="" className="size-7 rounded-lg" />
        <div className="flex-1">
          <h1 className="text-[14px] font-semibold">Kokoro Reader</h1>
          <ModelBadge state={model} />
        </div>
      </header>

      {active ? (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide text-accent uppercase">{active.status === 'paused' ? 'Paused' : active.status === 'ended' ? 'Finished' : 'Now reading'}</div>
              <div className="line-clamp-2 text-[14px] font-semibold">{active.title}</div>
            </div>
            <div className="flex flex-none">
              <IconButton label="Bookmark this position" onClick={() => void request('bookmark/add', {}).then(() => setNotice('Bookmark saved.'))}>
                <Bookmark size={15} />
              </IconButton>
              <IconButton label="Open in reader" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('reader/index.html?session=current') })}>
                <BookOpen size={15} />
              </IconButton>
            </div>
          </div>
          {active.error ? (
            <p role="alert" className="mt-3 text-[12px] text-danger">
              {active.error.message}
            </p>
          ) : (
            <p className="mt-3 min-h-[4.5em] font-serif text-[15px] leading-relaxed" aria-live="polite">
              {active.sentenceText}
            </p>
          )}
          <div className="mt-3">
            <PlayerControls state={active} showVolume />
          </div>
          <div className="mt-3 border-t-[0.5px] border-line pt-3">
            <Select label="Voice" value={settings.engine === 'browser' ? 'system' : settings.voice} onChange={(voice) => void setPlayback({ voice })} className="w-full">
              {settings.engine === 'browser' ? <option value="system">Browser voice</option> : voices.map((voice) => <option key={voice.id} value={voice.id}>{`${voice.name} · ${voice.languageLabel}`}</option>)}
            </Select>
          </div>
          {notice && <p role="status" className="mt-2 text-[12px] text-accent">{notice}</p>}
        </Card>
      ) : (
        <Card>
          <Empty icon={<Headphones size={18} />} title="Nothing playing">
            Select text on a page and click the speaker, or use the toolbar button to read a page. Playback continues while you switch tabs.
          </Empty>
        </Card>
      )}

      <QueueList />
      <BookmarkList />
    </div>
  );
}
