import { useCallback, useEffect, useState } from 'react';
import { request } from '@/shared/messages/bus';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@/shared/settings';
import { getSettings, LOCAL_KEYS, onSettingsChanged, SESSION_KEYS, updateSettings } from '@/shared/storage';
import type { ModelState, PlaybackState, VoiceInfo } from '@/shared/types';

/** Subscribes to a chrome.storage key. */
function useStorageValue<T>(area: 'local' | 'session', key: string, fallback: T): T {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    let alive = true;
    void chrome.storage[area].get(key).then((result) => {
      if (alive && result[key] !== undefined) setValue(result[key] as T);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
      if (changedArea === area && key in changes) setValue((changes[key]!.newValue as T | undefined) ?? fallback);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, key]);
  return value;
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void getSettings().then((value) => {
      setSettings(value);
      setLoaded(true);
    });
    return onSettingsChanged(setSettings);
  }, []);
  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((current) => normalizeSettings({ ...current, ...patch }));
    await updateSettings(patch);
  }, []);
  return [settings, update, loaded];
}

export function usePlayback(): PlaybackState | null {
  const stored = useStorageValue<PlaybackState | null>('session', SESSION_KEYS.playback, null);
  return stored;
}

/** Live model state: asked once on mount, then followed through storage updates from the background. */
export function useModelState(): [ModelState | null, () => void] {
  const [state, setState] = useState<ModelState | null>(null);
  const refresh = useCallback(() => {
    void request('model/state', {}).then(setState).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes[LOCAL_KEYS.modelState];
      if (area === 'local' && change?.newValue) setState(change.newValue as ModelState);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);
  return [state, refresh];
}

export function useVoices(engine: string): VoiceInfo[] {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  useEffect(() => {
    void request('voices/list', {}).then(setVoices).catch(() => setVoices([]));
  }, [engine]);
  return voices;
}

export function useStored<T>(key: string, fallback: T): T {
  return useStorageValue<T>('local', key, fallback);
}

/** Applies the theme, reduced-motion and contrast classes to <html>. */
export function useTheme(settings: Settings) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion === 'always');
      document.documentElement.classList.toggle('high-contrast', settings.highContrastHighlight);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme, settings.reduceMotion, settings.highContrastHighlight]);
}

export function useActiveTab(): chrome.tabs.Tab | null {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => setTab(active ?? null));
  }, []);
  return tab;
}
