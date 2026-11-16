import {
  AlertCircle,
  AudioLines,
  Bookmark,
  BookOpen,
  FileText,
  Headphones,
  Library as LibraryIcon,
  ListPlus,
  Loader2,
  MousePointerClick,
  PanelRight,
  Settings2,
  SlidersHorizontal,
  Type,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { getVariant, variantDownloadBytes } from '@/models/registry';
import { request } from '@/shared/messages/bus';
import type { PageInfo, ReadMode } from '@/shared/messages/contract';
import { addToQueue } from '@/shared/storage';
import type { AppErrorInfo } from '@/shared/types';
import { formatBytes } from '@/shared/utils/format';
import { createId } from '@/shared/utils/id';
import { BookmarkList, HistoryList, QueueList } from '@/ui/components/Library';
import { ModelBadge, modelAction } from '@/ui/components/ModelStatus';
import { FloatingButtonToggle } from '@/ui/components/PermissionToggle';
import { isActive, PlayerControls, setPlayback } from '@/ui/components/PlayerControls';
import { Button, Card, cx, Field, IconButton, Segmented, Select } from '@/ui/components/primitives';
import { VoiceLibrary } from '@/ui/components/VoiceLibrary';
import { useActiveTab, useModelState, usePlayback, useSettings, useTheme, useVoices } from '@/ui/hooks';

type Tab = 'listen' | 'voices' | 'library' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof Headphones }[] = [
  { id: 'listen', label: 'Listen', icon: Headphones },
  { id: 'voices', label: 'Voices', icon: AudioLines },
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

export function Popup() {
  const [tab, setTab] = useState<Tab>('listen');
  const [settings, update] = useSettings();
  useTheme(settings);

  return (
    <div className="flex h-[580px] w-[380px] flex-col bg-bg">
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <img src="/icons/icon-48.png" alt="" className="size-7 rounded-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[14px] leading-tight font-semibold">Kokoro Reader</h1>
          <PopupModelBadge />
        </div>
        <IconButton label="Open side panel player" onClick={() => void openSidePanel()}>
          <PanelRight size={16} />
        </IconButton>
        <IconButton label="Open all settings" onClick={() => void chrome.runtime.openOptionsPage()}>
          <Settings2 size={16} />
        </IconButton>
      </header>

      <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
            {tab === 'listen' && <ListenTab />}
            {tab === 'voices' && <VoicesTab />}
            {tab === 'library' && (
              <div className="space-y-5 pt-1">
                <QueueList compact />
                <BookmarkList />
                <HistoryList limit={8} />
              </div>
            )}
            {tab === 'settings' && (
              <div className="pt-1">
                <Card className="divide-y divide-line px-3.5">
                  <Field label="Appearance">
                    <Segmented label="Theme" value={settings.theme} onChange={(theme) => void update({ theme })} options={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
                  </Field>
                  <FloatingButtonToggle settings={settings} update={update} />
                  <Field label="Speech engine" description={settings.engine === 'browser' ? 'System voices (not Kokoro)' : 'Kokoro-82M on this device'}>
                    <Select label="Speech engine" value={settings.engine} onChange={(engine) => void update({ engine: engine as 'kokoro' | 'browser' })}>
                      <option value="kokoro">Kokoro AI</option>
                      <option value="browser">Browser speech</option>
                    </Select>
                  </Field>
                  <Field label="Default speed">
                    <Select label="Default speed" value={String(settings.rate)} onChange={(rate) => void setPlayback({ rate: Number(rate) })}>
                      {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                        <option key={rate} value={rate}>{`${rate}×`}</option>
                      ))}
                    </Select>
                  </Field>
                </Card>
                <Button variant="ghost" className="mt-3 w-full" onClick={() => void chrome.runtime.openOptionsPage()}>
                  All settings, model storage and privacy…
                </Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="grid grid-cols-4 border-t-[0.5px] border-line bg-elevated px-2 py-1.5 backdrop-blur-xl" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
            className={cx('flex flex-col items-center gap-0.5 rounded-lg py-1 text-[10.5px] font-medium transition-colors', tab === id ? 'text-accent' : 'text-muted hover:text-text')}
          >
            <Icon size={18} strokeWidth={tab === id ? 2.2 : 1.8} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

async function openSidePanel() {
  const window = await chrome.windows.getCurrent();
  if (window.id !== undefined) await chrome.sidePanel.open({ windowId: window.id });
}

function PopupModelBadge() {
  const [model] = useModelState();
  return <ModelBadge state={model} />;
}

function VoicesTab() {
  const [settings, update] = useSettings();
  const voices = useVoices(settings.engine);
  return (
    <div className="pt-1">
      <VoiceLibrary voices={voices} settings={settings} update={update} compact />
    </div>
  );
}

function ListenTab() {
  const tab = useActiveTab();
  const playback = usePlayback();
  const [settings, update] = useSettings();
  const [model] = useModelState();
  const [page, setPage] = useState<PageInfo | null>(null);
  const [pageError, setPageError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppErrorInfo | string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (tab?.id === undefined) return;
    void request('tab/info', { tabId: tab.id })
      .then((info) => {
        setPage(info);
        setPageError(!info);
      })
      .catch(() => setPageError(true));
  }, [tab?.id]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  const read = (mode: ReadMode) => run(mode, () => request('tab/read', { tabId: tab!.id!, mode }));
  const active = isActive(playback) ? playback : null;
  const variant = getVariant(settings.variantId);
  const needsModel = settings.engine === 'kokoro' && model && ['not-downloaded', 'paused', 'error'].includes(model.status) && model.variantId === settings.variantId;

  return (
    <div className="space-y-3 pt-1">
      <Card className="p-3.5">
        <div className="flex items-start gap-2.5">
          <div className="grid size-9 flex-none place-items-center rounded-lg bg-hover text-muted">
            <FileText size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{page?.title ?? tab?.title ?? 'This page'}</div>
            <div className="truncate text-[12px] text-muted">{pageError ? 'Chrome does not allow reading this page' : (page?.siteName ?? '…')}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="primary" disabled={pageError || !tab?.id || busy !== null} onClick={() => void read('page')}>
            {busy === 'page' ? <Loader2 size={14} className="animate-spin" /> : <Headphones size={14} />} Read page
          </Button>
          <Button disabled={pageError || !page?.hasSelection || busy !== null} onClick={() => void read('selection')} title={page?.hasSelection ? `${page.selectionWords} words selected` : 'Select text on the page first'}>
            {busy === 'selection' ? <Loader2 size={14} className="animate-spin" /> : <MousePointerClick size={14} />} Read selection
          </Button>
          <Button disabled={pageError || !tab?.id || busy !== null} onClick={() => void run('article', () => request('reader/open', { tabId: tab!.id! }).then(() => window.close()))}>
            <BookOpen size={14} /> Smart Reader
          </Button>
          <Button
            disabled={pageError || !tab?.id || busy !== null}
            onClick={() =>
              void run('queue', async () => {
                const doc = await request('tab/extract', { tabId: tab!.id!, mode: 'article' });
                await addToQueue({ id: createId(), title: doc.title, url: doc.url, siteName: doc.siteName, addedAt: Date.now(), doc, position: 0 });
                setNotice(`Added “${doc.title}” to Listen Later.`);
              })
            }
          >
            {busy === 'queue' ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />} Listen later
          </Button>
        </div>
        <button type="button" className="mt-2.5 flex w-full items-center justify-center gap-1.5 text-[12px] text-muted hover:text-accent" onClick={() => void request('reader/open', { mode: 'custom' }).then(() => window.close())}>
          <Type size={13} /> Paste your own text…
        </button>
      </Card>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-[color-mix(in_srgb,var(--kr-danger)_10%,transparent)] p-3 text-[12px] text-danger">
          <AlertCircle size={15} className="mt-px flex-none" />
          {typeof error === 'string' ? error : error.message}
        </div>
      )}
      {notice && <div role="status" className="rounded-xl bg-accent-soft p-3 text-[12px] text-accent">{notice}</div>}

      {needsModel && (
        <Card className="p-3.5">
          <div className="text-[13px] font-semibold">One-time voice model download</div>
          <p className="mt-1 text-[12px] text-muted">
            Kokoro runs entirely on your device. The first reading downloads the {variant.label} model ({formatBytes(variantDownloadBytes(variant))}) once; it is cached for offline use.
          </p>
          <Button size="sm" variant="secondary" className="mt-2.5" onClick={() => void modelAction(model.status === 'paused' ? 'download' : 'download')}>
            {model.status === 'paused' ? 'Resume download' : model.status === 'error' ? 'Retry download' : 'Download now'}
          </Button>
        </Card>
      )}

      <AnimatePresence>
        {active && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
            <Card className="p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold tracking-wide text-accent uppercase">{active.status === 'paused' ? 'Paused' : active.status === 'ended' ? 'Finished' : 'Now reading'}</div>
                  <div className="truncate text-[13px] font-semibold">{active.title}</div>
                </div>
                <div className="flex">
                  <IconButton label="Bookmark this position" onClick={() => void request('bookmark/add', {}).then(() => setNotice('Bookmark saved.'))}>
                    <Bookmark size={15} />
                  </IconButton>
                  <IconButton label="Open in reader" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('reader/index.html?session=current') })}>
                    <BookOpen size={15} />
                  </IconButton>
                </div>
              </div>
              {active.error ? (
                <p role="alert" className="mt-2 text-[12px] text-danger">
                  {active.error.message} <span className="opacity-70">({active.error.code})</span>
                </p>
              ) : (
                <p className="mt-2 line-clamp-3 min-h-[3.6em] font-serif text-[13.5px] leading-snug">{active.status === 'preparing' ? preparingText(model) : active.sentenceText}</p>
              )}
              <div className="mt-3">
                <PlayerControls state={active} />
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="divide-y divide-line px-3.5">
        <Field label="Voice">
          <Select
            label="Voice"
            value={settings.engine === 'browser' ? 'system' : settings.voice}
            onChange={(voice) => void setPlayback({ voice })}
            className="max-w-[170px]"
          >
            {settings.engine === 'browser' ? <option value="system">Browser voice</option> : <VoiceOptions favorites={settings.favoriteVoices} />}
          </Select>
        </Field>
        <Field label="Voice profile" description="Saved voice and speed pairs">
          <Select
            label="Voice profile"
            value=""
            onChange={(id) => {
              const profile = settings.profiles.find((item) => item.id === id);
              if (profile) void update({ voice: profile.voice, rate: profile.rate }).then(() => setPlayback({ voice: profile.voice, rate: profile.rate }));
            }}
            className="max-w-[170px]"
          >
            <option value="">Choose…</option>
            {settings.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>
    </div>
  );
}

function preparingText(model: ReturnType<typeof useModelState>[0]): string {
  if (model?.status === 'downloading' && model.progress) {
    return `Downloading the Kokoro model… ${Math.floor((model.progress.loaded / Math.max(1, model.progress.total)) * 100)}%`;
  }
  if (model?.status === 'initializing') return 'Starting the speech engine…';
  return 'Preparing voice…';
}

function VoiceOptions({ favorites }: { favorites: string[] }) {
  const voices = useVoices('kokoro');
  const sorted = [...voices].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  return (
    <>
      {sorted.map((voice) => (
        <option key={voice.id} value={voice.id}>
          {favorites.includes(voice.id) ? '★ ' : ''}
          {voice.name} · {voice.languageLabel.replace('English ', '')}
        </option>
      ))}
    </>
  );
}
