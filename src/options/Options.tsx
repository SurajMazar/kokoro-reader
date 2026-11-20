import { UpdatePanel } from '@/ui/components/UpdateNotice';
import { STORE_URL } from '@/shared/updates';
import {
  Accessibility,
  AudioLines,
  BookOpenText,
  Cpu,
  HardDrive,
  Info,
  Keyboard,
  Settings as SettingsIcon,
  Shield,
  Volume2,
  Wrench,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { MODEL_LICENSE, MODEL_REPOSITORY, MODEL_REVISION, MODEL_VARIANTS, variantDownloadBytes } from '@/models/registry';
import { DEFAULT_SETTINGS, SPEED_PRESETS, type Settings } from '@/shared/settings';
import { clearDiagnostics, deleteHistory, getDiagnostics, LOCAL_KEYS, resetSettings } from '@/shared/storage';
import type { DiagnosticEvent } from '@/shared/types';
import { formatBytes } from '@/shared/utils/format';
import { ModelManagerCard } from '@/ui/components/ModelStatus';
import { FloatingButtonToggle } from '@/ui/components/PermissionToggle';
import { Button, Card, cx, Field, Segmented, Select, Switch } from '@/ui/components/primitives';
import { VoiceLibrary } from '@/ui/components/VoiceLibrary';
import { WebGpuHint } from '@/ui/components/WebGpuHint';
import { useModelState, useSettings, useStored, useTheme, useVoices } from '@/ui/hooks';

const SECTIONS = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'reading', label: 'Reading', icon: BookOpenText },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'voices', label: 'Voices', icon: AudioLines },
  { id: 'engine', label: 'AI Engine', icon: Cpu },
  { id: 'storage', label: 'Model Storage', icon: HardDrive },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
  { id: 'about', label: 'About', icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function Group({ title, children, description }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h3 className="mb-1 px-1 text-[13px] font-semibold">{title}</h3>
      {description && <p className="mb-2 px-1 text-[12px] text-muted">{description}</p>}
      <Card className="divide-y divide-line px-4">{children}</Card>
    </section>
  );
}

export function Options() {
  const [settings, update, loaded] = useSettings();
  useTheme(settings);
  const initial = (location.hash.slice(1) as SectionId) || 'general';
  const [section, setSection] = useState<SectionId>(SECTIONS.some((s) => s.id === initial) ? initial : 'general');
  useEffect(() => {
    history.replaceState(null, '', `#${section}`);
  }, [section]);

  if (!loaded) return null;
  const current = SECTIONS.find((item) => item.id === section)!;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 flex-none border-r-[0.5px] border-line bg-surface-2 px-3 py-5 md:block">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <img src="/icons/icon-48.png" alt="" className="size-8 rounded-lg" />
          <div>
            <div className="text-[14px] font-semibold">Kokoro Reader</div>
            <div className="text-[11.5px] text-muted">Settings</div>
          </div>
        </div>
        <nav aria-label="Settings sections" className="space-y-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={id === section ? 'page' : undefined}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]', id === section ? 'bg-accent text-accent-fg' : 'text-text hover:bg-hover')}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-10 md:py-10">
        <div className="mb-4 md:hidden">
          <Select label="Settings section" value={section} onChange={(value) => setSection(value as SectionId)} className="w-full">
            {SECTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <h1 className="mb-6 flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <current.icon size={20} className="text-accent" /> {current.label}
        </h1>
        <SectionBody section={section} settings={settings} update={update} />
      </main>
    </div>
  );
}

function SectionBody({ section, settings, update }: { section: SectionId; settings: Settings; update: (patch: Partial<Settings>) => Promise<void> }) {
  switch (section) {
    case 'general':
      return (
        <>
          <Group title="Appearance">
            <Field label="Theme">
              <Segmented label="Theme" value={settings.theme} onChange={(theme) => void update({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </Field>
          </Group>
          <Group title="Starting a new reading" description="What happens when you start reading while something else is already playing.">
            <Field label="When something is playing">
              <Segmented
                label="New session policy"
                value={settings.newSessionPolicy}
                onChange={(newSessionPolicy) => void update({ newSessionPolicy })}
                options={[{ value: 'replace', label: 'Replace it' }, { value: 'queue', label: 'Add to queue' }]}
              />
            </Field>
          </Group>
          <Group title="Reset">
            <Field label="Restore default settings" description="Your queue, history, bookmarks and downloaded model are kept.">
              <Button variant="danger" onClick={() => void resetSettings()}>
                Reset to defaults
              </Button>
            </Field>
          </Group>
        </>
      );
    case 'reading':
      return (
        <>
          <Group title="Text selection">
            <FloatingButtonToggle settings={settings} update={update} />
            <Field label="Button style">
              <Segmented label="Button style" value={settings.selectionStyle} onChange={(selectionStyle) => void update({ selectionStyle })} options={[{ value: 'icon', label: 'Speaker icon' }, { value: 'toolbar', label: 'Compact toolbar' }]} />
            </Field>
            <Switch label="Start reading on click" checked={settings.autoPlayOnClick} onChange={(autoPlayOnClick) => void update({ autoPlayOnClick })} description="When off, clicking the speaker opens a toolbar and you confirm with Listen." />
            <Field label="Appear after" description="Delay before the button shows, to avoid flicker while selecting.">
              <Select label="Selection delay" value={String(settings.selectionDelayMs)} onChange={(value) => void update({ selectionDelayMs: Number(value) })}>
                {[0, 150, 300, 600, 1000].map((ms) => (
                  <option key={ms} value={ms}>
                    {ms === 0 ? 'Immediately' : `${ms} ms`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Minimum selection" description="Only show the button for selections at least this long.">
              <Select label="Minimum words" value={String(settings.minSelectionWords)} onChange={(value) => void update({ minSelectionWords: Number(value) })}>
                {[1, 3, 5, 10, 25].map((words) => (
                  <option key={words} value={words}>
                    {words} word{words === 1 ? '' : 's'}
                  </option>
                ))}
              </Select>
            </Field>
          </Group>
          <Group title="Following along">
            <Switch label="Highlight the spoken sentence" checked={settings.highlightSentence} onChange={(highlightSentence) => void update({ highlightSentence })} />
            <Switch label="Tint the current paragraph" checked={settings.highlightParagraph} onChange={(highlightParagraph) => void update({ highlightParagraph })} />
            <Switch label="Scroll to follow the reading" checked={settings.autoScroll} onChange={(autoScroll) => void update({ autoScroll })} description="Pauses for a few seconds whenever you scroll yourself." />
          </Group>
          <Group title="In-page player">
            <Field label="Position">
              <Select label="Player position" value={settings.playerCorner} onChange={(value) => void update({ playerCorner: value as Settings['playerCorner'] })}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="top-right">Top right</option>
                <option value="top-left">Top left</option>
              </Select>
            </Field>
            <Field label="Default size">
              <Segmented label="Player size" value={settings.playerMode} onChange={(playerMode) => void update({ playerMode })} options={[{ value: 'minimized', label: 'Mini' }, { value: 'compact', label: 'Compact' }, { value: 'expanded', label: 'Expanded' }]} />
            </Field>
          </Group>
        </>
      );
    case 'audio':
      return (
        <>
          <Group title="Playback">
            <Field label="Speed" description="Applied instantly with pitch preserved.">
              <Select label="Speed" value={String(settings.rate)} onChange={(value) => void update({ rate: Number(value) })}>
                {[...new Set([...SPEED_PRESETS, settings.rate])].sort((a, b) => a - b).map((rate) => (
                  <option key={rate} value={rate}>{`${rate}×`}</option>
                ))}
              </Select>
            </Field>
            <Field label="Custom speed" description={`${settings.rate}× (0.5–3×)`}>
              <input type="range" min={0.5} max={3} step={0.05} value={settings.rate} onChange={(event) => void update({ rate: Number(event.target.value) })} aria-label="Custom speed" className="w-48" />
            </Field>
            <Field label="Volume" description={`${Math.round(settings.volume * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(event) => void update({ volume: Number(event.target.value) })} aria-label="Volume" className="w-48" />
            </Field>
          </Group>
          <Group title="Voice profiles" description="Saved voice and speed pairs for different kinds of reading. Apply them from the popup.">
            {settings.profiles.map((profile, index) => (
              <div key={profile.id} className="flex items-center gap-2 py-2.5">
                <input
                  aria-label="Profile name"
                  value={profile.name}
                  onChange={(event) => void update({ profiles: settings.profiles.map((p, i) => (i === index ? { ...p, name: event.target.value } : p)) })}
                  className="h-8 min-w-0 flex-1 rounded-lg border-[0.5px] border-line bg-surface-2 px-2.5 text-[13px]"
                />
                <ProfileVoiceSelect value={profile.voice} onChange={(voice) => void update({ profiles: settings.profiles.map((p, i) => (i === index ? { ...p, voice } : p)) })} />
                <Select label="Profile speed" value={String(profile.rate)} onChange={(rate) => void update({ profiles: settings.profiles.map((p, i) => (i === index ? { ...p, rate: Number(rate) } : p)) })}>
                  {[0.75, 0.9, 0.95, 1, 1.1, 1.15, 1.25, 1.5, 1.75, 2].map((rate) => (
                    <option key={rate} value={rate}>{`${rate}×`}</option>
                  ))}
                </Select>
                <Button variant="ghost" size="sm" onClick={() => void update({ profiles: settings.profiles.filter((_, i) => i !== index) })} aria-label={`Delete profile ${profile.name}`}>
                  Remove
                </Button>
              </div>
            ))}
            <div className="py-2.5">
              <Button size="sm" onClick={() => void update({ profiles: [...settings.profiles, { id: crypto.randomUUID(), name: 'New profile', voice: settings.voice, rate: settings.rate }] })}>
                Add profile
              </Button>
            </div>
          </Group>
        </>
      );
    case 'voices':
      return <VoicesSection settings={settings} update={update} />;
    case 'engine':
      return <EngineSection settings={settings} update={update} />;
    case 'storage':
      return <StorageSection settings={settings} />;
    case 'shortcuts':
      return <ShortcutsSection />;
    case 'privacy':
      return (
        <>
          <Group title="How your data is handled">
            <ul className="space-y-2 py-3 text-[13px] leading-relaxed">
              <li>• Speech is generated on this device. Selected text and page content are never sent anywhere.</li>
              <li>• The only network requests are downloads of the pinned Kokoro model files from huggingface.co, verified by SHA-256.</li>
              <li>• No analytics, advertising or tracking code is included.</li>
              <li>• History stores titles, addresses and positions, not page text. Bookmarks and Listen Later store the text you chose to save, locally.</li>
            </ul>
          </Group>
          <Group title="Local data">
            <Switch label="Keep reading history" checked={settings.historyEnabled} onChange={(historyEnabled) => void update({ historyEnabled })} description="Lets you resume pages you were listening to." />
            <Field label="Delete reading history">
              <Button variant="danger" onClick={() => void deleteHistory()}>
                Delete history
              </Button>
            </Field>
            <Switch label="Local diagnostics" checked={settings.diagnosticsEnabled} onChange={(diagnosticsEnabled) => void update({ diagnosticsEnabled })} description="Records timings and error codes (never text or addresses) on this device, shown under Advanced." />
          </Group>
        </>
      );
    case 'accessibility':
      return (
        <Group title="Accessibility">
          <Field label="Animations">
            <Segmented label="Reduce motion" value={settings.reduceMotion} onChange={(reduceMotion) => void update({ reduceMotion })} options={[{ value: 'system', label: 'Follow system' }, { value: 'always', label: 'Always reduce' }]} />
          </Field>
          <Switch label="High-contrast highlighting" checked={settings.highContrastHighlight} onChange={(highContrastHighlight) => void update({ highContrastHighlight })} description="Dark text on bright yellow for the spoken sentence." />
          <p className="py-3 text-[12px] text-muted">All controls work with the keyboard and carry screen-reader labels. In the in-page player, Space toggles playback when a control has focus.</p>
        </Group>
      );
    case 'advanced':
      return <AdvancedSection settings={settings} update={update} />;
    case 'about':
      return (
        <Group title="About Kokoro Reader">
          <div className="space-y-2 py-3 text-[13px] leading-relaxed">
            <p>Version {chrome.runtime.getManifest().version}. A local-first reading assistant powered by Kokoro-82M, with Nepali voices from Piper.</p>
            <UpdatePanel />
            <p>
              Enjoying it?{' '}
              <a href={STORE_URL} target="_blank" rel="noreferrer" className="text-accent underline">
                Rate Kokoro Reader on the Chrome Web Store
              </a>{' '}
              or share the link with others.
            </p>
            <p>
              Model: <code>{MODEL_REPOSITORY}</code> at revision <code>{MODEL_REVISION.slice(0, 12)}</code>, licensed {MODEL_LICENSE}. Kokoro-82M by hexgrad. ONNX export by onnx-community.
            </p>
            <p>Phonemization: espeak-ng compiled to WebAssembly (the phonemizer package for English, a Nepali build for the Piper voices); text normalization ported from kokoro-js (Apache-2.0).</p>
            <p>Inference: ONNX Runtime Web via transformers.js. Article extraction: Mozilla Readability.</p>
          </div>
        </Group>
      );
  }
}

function ProfileVoiceSelect({ value, onChange }: { value: string; onChange: (voice: string) => void }) {
  const voices = useVoices('kokoro');
  return (
    <Select label="Profile voice" value={value} onChange={onChange}>
      {voices.map((voice) => (
        <option key={voice.id} value={voice.id}>
          {voice.name} ({voice.languageLabel.replace('English ', '')})
        </option>
      ))}
    </Select>
  );
}

function VoicesSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => Promise<void> }) {
  const voices = useVoices(settings.engine);
  return <VoiceLibrary voices={voices} settings={settings} update={update} />;
}

function EngineSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => Promise<void> }) {
  const [model] = useModelState();
  return (
    <>
      <WebGpuHint settings={settings} update={update} />
      <Group title="Speech engine" description="Kokoro is the primary engine. Browser speech is a separate, clearly labelled fallback that you choose yourself.">
        <Field label="Engine">
          <Segmented label="Engine" value={settings.engine} onChange={(engine) => void update({ engine })} options={[{ value: 'kokoro', label: 'Kokoro AI (local)' }, { value: 'browser', label: 'Browser speech' }]} />
        </Field>
        {settings.engine === 'browser' && (
          <p className="py-3 text-[12px] text-warning">Browser speech uses your operating system's voices. It cannot export audio and may send text to a network voice service depending on the voice.</p>
        )}
      </Group>
      <Group title="Kokoro model">
        <Field label="Model variant" description="Changing variants downloads the new model the next time you listen.">
          <Select label="Model variant" value={settings.variantId} onChange={(variantId) => void update({ variantId })}>
            {MODEL_VARIANTS.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label} · {formatBytes(variantDownloadBytes(variant))}
              </option>
            ))}
          </Select>
        </Field>
        <p className="pb-3 text-[12px] text-muted">{MODEL_VARIANTS.find((v) => v.id === settings.variantId)?.description}</p>
        <Field label="Execution backend" description="Auto uses WebGPU for the full-precision model when available (falling back to WebAssembly if it fails a real test inference). The 8-bit and fp16 models always run on WebAssembly.">
          <Segmented label="Backend" value={settings.backend} onChange={(backend) => void update({ backend })} options={[{ value: 'auto', label: 'Auto' }, { value: 'webgpu', label: 'WebGPU' }, { value: 'wasm', label: 'WebAssembly' }]} />
        </Field>
        <Field label="Generate ahead" description="Sentences synthesized before they are needed.">
          <Select label="Prefetch sentences" value={String(settings.prefetchSentences)} onChange={(value) => void update({ prefetchSentences: Number(value) })}>
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unload when idle" description="Frees the model's memory after this long without playback.">
          <Select label="Idle unload" value={String(settings.idleUnloadMinutes)} onChange={(value) => void update({ idleUnloadMinutes: Number(value) })}>
            {[2, 5, 10, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} min
              </option>
            ))}
          </Select>
        </Field>
      </Group>
      <ModelManagerCard state={model} variantId={settings.variantId} />
    </>
  );
}

function StorageSection({ settings }: { settings: Settings }) {
  const [model] = useModelState();
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate().then(setEstimate);
  }, [model?.cachedBytes]);
  return (
    <>
      <ModelManagerCard state={model} variantId={settings.variantId} />
      <div className="mt-6">
        <Group title="Storage">
          <Field label="Model cache">{formatBytes(model?.cachedBytes ?? 0)}</Field>
          <Field label="Extension storage used">{estimate ? formatBytes(estimate.usage ?? 0) : '—'}</Field>
          <Field label="Location" description="Chrome Cache Storage for this extension. Partial downloads are kept in IndexedDB so they can resume.">
            <span className="text-[12px] text-muted">Local</span>
          </Field>
        </Group>
        <Group title="Other variants">
          {MODEL_VARIANTS.filter((variant) => variant.id !== settings.variantId).map((variant) => (
            <Field key={variant.id} label={variant.label} description={variant.description}>
              <span className="text-[12px] text-muted">{formatBytes(variantDownloadBytes(variant))}</span>
            </Field>
          ))}
        </Group>
      </div>
    </>
  );
}

function ShortcutsSection() {
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  useEffect(() => {
    void chrome.commands.getAll().then(setCommands);
  }, []);
  return (
    <Group title="Keyboard shortcuts" description="Chrome manages extension shortcuts. Change them on Chrome's shortcuts page.">
      {commands
        .filter((command) => command.name !== '_execute_action')
        .map((command) => (
          <Field key={command.name} label={command.description ?? command.name ?? ''}>
            {command.shortcut ? <kbd className="rounded-md border-[0.5px] border-line bg-surface-2 px-2 py-1 font-sans text-[12px] font-medium shadow-card">{command.shortcut}</kbd> : <span className="text-[12px] text-subtle">Not set</span>}
          </Field>
        ))}
      <div className="py-3">
        <Button onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Customize shortcuts…</Button>
      </div>
    </Group>
  );
}

function AdvancedSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => Promise<void> }) {
  const stored = useStored<DiagnosticEvent[]>(LOCAL_KEYS.diagnostics, []);
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  useEffect(() => {
    void getDiagnostics().then(setEvents);
  }, [stored]);
  const synth = events.filter((event) => event.kind === 'synthesis');
  const rtf = synth.length ? synth.reduce((sum, event) => sum + Number(event.data.rtf ?? 0), 0) / synth.length : null;
  const firstAudio = events.find((event) => event.kind === 'first-audio');
  const init = events.find((event) => event.kind === 'model-init');
  return (
    <>
      <Group title="Measured performance" description="Recorded on this device. Real-time factor below 1 means speech is generated faster than it plays.">
        <Field label="Model initialization">{init ? `${(Number(init.data.ms) / 1000).toFixed(1)} s on ${init.data.backend}` : '—'}</Field>
        <Field label="Time to first audio (latest)">{firstAudio ? `${(Number(firstAudio.data.ms) / 1000).toFixed(2)} s` : '—'}</Field>
        <Field label="Average real-time factor">{rtf !== null ? `${rtf.toFixed(2)} (${synth.length} sentences)` : '—'}</Field>
      </Group>
      <Group title="Diagnostics log">
        <div className="max-h-72 overflow-auto py-2 font-mono text-[11px] leading-relaxed text-muted">
          {events.length ? (
            events.map((event, index) => (
              <div key={index}>
                {new Date(event.at).toLocaleTimeString()} {event.kind} {JSON.stringify(event.data)}
              </div>
            ))
          ) : (
            <div>No events recorded.</div>
          )}
        </div>
        <div className="flex gap-2 py-3">
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(events, null, 2))}>
            Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void clearDiagnostics().then(() => setEvents([]))}>
            Clear
          </Button>
        </div>
      </Group>
      <Group title="Model downloads">
        <Switch label="Download the model right after install" checked={settings.downloadModelOnInstall} onChange={(downloadModelOnInstall) => void update({ downloadModelOnInstall })} description="Off by default: the model downloads the first time you listen." />
      </Group>
      <p className="px-1 text-[11.5px] text-subtle">Defaults: {DEFAULT_SETTINGS.variantId} model, {DEFAULT_SETTINGS.backend} backend, {DEFAULT_SETTINGS.prefetchSentences} sentences ahead.</p>
    </>
  );
}
