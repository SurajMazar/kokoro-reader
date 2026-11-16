import { useEffect, useState } from 'react';
import { request } from '@/shared/messages/bus';
import type { Settings } from '@/shared/settings';
import { Switch } from './primitives';

const ALL_SITES = { origins: ['<all_urls>'] };

/**
 * "Show speaker on selection" needs the content script on every site. The
 * all-sites host permission is optional and requested only here, from a
 * user gesture; turning it off releases the permission again.
 */
export function FloatingButtonToggle({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => Promise<void> }) {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    void chrome.permissions.contains(ALL_SITES).then(setGranted);
  }, []);

  async function change(next: boolean) {
    if (next) {
      const ok = await chrome.permissions.request(ALL_SITES);
      setGranted(ok);
      if (!ok) return;
      await update({ floatingButton: true });
    } else {
      await update({ floatingButton: false });
      if (!__KOKORO_E2E__) {
        await chrome.permissions.remove(ALL_SITES).catch(() => false);
        setGranted(false);
      }
    }
    await request('permissions/sync', {}).catch(() => undefined);
  }

  const on = settings.floatingButton && granted === true;
  return (
    <Switch
      label="Speaker button on text selection"
      checked={on}
      onChange={(next) => void change(next)}
      description={
        on
          ? 'A speaker icon appears when you select text on any website. Text is only read when you click it.'
          : 'Requires access to all websites, so the icon can appear wherever you select text. Without it, use right-click, the toolbar button or Alt+Shift+R.'
      }
    />
  );
}
