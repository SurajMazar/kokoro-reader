import { Check, Loader2, Play, Search, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { request } from '@/shared/messages/bus';
import type { Settings } from '@/shared/settings';
import type { VoiceInfo } from '@/shared/types';
import { cx, IconButton, Segmented } from './primitives';

/**
 * Voice catalogue with search, language filter, favorites, recents, preview
 * and default selection. Metadata comes straight from the Kokoro voice list.
 */
export function VoiceLibrary({
  voices,
  settings,
  update,
  compact = false,
}: {
  voices: VoiceInfo[];
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<string>('all');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isBrowser = settings.engine === 'browser';
  const current = isBrowser ? settings.browserVoice : settings.voice;

  const languages = useMemo(() => [...new Set(voices.map((voice) => voice.languageLabel))].sort(), [voices]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return voices
      .filter((voice) => language === 'all' || voice.languageLabel === language)
      .filter((voice) => !q || `${voice.name} ${voice.id} ${voice.languageLabel} ${voice.gender}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const fa = settings.favoriteVoices.includes(a.id) ? 0 : 1;
        const fb = settings.favoriteVoices.includes(b.id) ? 0 : 1;
        return fa - fb;
      });
  }, [voices, query, language, settings.favoriteVoices]);
  const recent = settings.recentVoices.map((id) => voices.find((voice) => voice.id === id)).filter(Boolean) as VoiceInfo[];

  async function preview(voice: VoiceInfo) {
    setPreviewing(voice.id);
    setError(null);
    try {
      await request('voices/preview', { voice: voice.id, engine: voice.engine });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPreviewing(null);
    }
  }

  async function choose(voice: VoiceInfo) {
    if (isBrowser) await update({ browserVoice: voice.id });
    else await update({ voice: voice.id, recentVoices: [voice.id, ...settings.recentVoices.filter((id) => id !== voice.id)].slice(0, 6) });
    await request('session/set', { voice: voice.id }).catch(() => undefined);
  }

  function toggleFavorite(id: string) {
    const favorites = settings.favoriteVoices.includes(id) ? settings.favoriteVoices.filter((item) => item !== id) : [...settings.favoriteVoices, id];
    void update({ favoriteVoices: favorites });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[160px] flex-1">
          <span className="sr-only">Search voices</span>
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search voices"
            className="h-8 w-full rounded-lg border-[0.5px] border-line bg-surface pr-2 pl-8 text-[13px] shadow-card placeholder:text-subtle"
          />
        </label>
        {languages.length > 1 && (
          <Segmented
            label="Language"
            value={language}
            onChange={setLanguage}
            options={[{ value: 'all', label: 'All' }, ...languages.map((label) => ({ value: label, label: label.replace('English ', '').replace(/[()]/g, '') }))]}
          />
        )}
      </div>
      {isBrowser && <p className="mt-2 text-[12px] text-warning">Browser speech is selected. These are your system's voices, not Kokoro.</p>}
      {!compact && recent.length > 0 && !query && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          Recent:
          {recent.map((voice) => (
            <button key={voice.id} type="button" onClick={() => void choose(voice)} className="rounded-full bg-hover px-2 py-0.5 font-medium text-text hover:bg-accent-soft">
              {voice.name}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {error}
        </p>
      )}
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border-[0.5px] border-line bg-surface shadow-card" aria-label="Voices">
        {filtered.map((voice) => {
          const selected = voice.id === current;
          const favorite = settings.favoriteVoices.includes(voice.id);
          return (
            <li key={voice.id} className={cx('flex items-center gap-2 px-3 py-2', selected && 'bg-accent-soft')}>
              <button type="button" onClick={() => void choose(voice)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={selected}>
                <span className={cx('grid size-8 flex-none place-items-center rounded-full text-[12px] font-semibold', voice.gender === 'Female' ? 'bg-[#f3e8ff] text-[#7c3aed] dark:bg-[#3b2a5c] dark:text-[#c4b5fd]' : 'bg-[#e0f2fe] text-[#0369a1] dark:bg-[#123047] dark:text-[#7dd3fc]')}>
                  {voice.name.slice(0, 2)}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    {voice.name}
                    {voice.traits && voice.engine === 'kokoro' && <span aria-hidden="true">{voice.traits}</span>}
                    {selected && <Check size={14} className="text-accent" aria-label="Selected" />}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {voice.languageLabel} · {voice.engine === 'kokoro' ? `${voice.gender} · grade ${voice.overallGrade}` : voice.traits}
                  </span>
                </span>
              </button>
              <IconButton label={`Preview ${voice.name}`} onClick={() => void preview(voice)} disabled={previewing !== null}>
                {previewing === voice.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} />}
              </IconButton>
              <IconButton label={favorite ? `Remove ${voice.name} from favorites` : `Add ${voice.name} to favorites`} active={favorite} onClick={() => toggleFavorite(voice.id)}>
                <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
              </IconButton>
            </li>
          );
        })}
        {!filtered.length && <li className="px-3 py-6 text-center text-[12px] text-muted">No voices match “{query}”.</li>}
      </ul>
      {!isBrowser && !compact && (
        <p className="mt-2 px-1 text-[11.5px] text-subtle">Grades are published by the Kokoro authors and reflect training data quality. Kokoro Reader currently supports English text.</p>
      )}
    </div>
  );
}
