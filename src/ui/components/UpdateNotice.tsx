import { ArrowUpCircle, Download, RefreshCw, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { request } from '@/shared/messages/bus';
import { LATEST_ZIP_URL, STORE_URL, type UpdateInfo } from '@/shared/updates';
import { Button } from './primitives';

function useUpdate(): [UpdateInfo | null, (force?: boolean) => Promise<void>] {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const check = async (force = false) => setInfo(await request('update/check', { force }).catch(() => null));
  useEffect(() => {
    void check();
  }, []);
  return [info, check];
}

/** Popup banner, shown only to unpacked installs when a newer build exists. */
export function UpdateBanner() {
  const [info] = useUpdate();
  if (!info?.available) return null;
  return (
    <button
      type="button"
      onClick={() => void request('ui/open-options', { section: 'about' }).catch(() => undefined)}
      className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-left text-[12px] text-text hover:brightness-95"
    >
      <ArrowUpCircle size={15} className="flex-none text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Version {info.latest} is available.</span> See how to update without losing your settings or voices.
      </span>
    </button>
  );
}

/** Settings → About: how this copy is updated, and the in-place update steps for unpacked installs. */
export function UpdatePanel() {
  const [info, check] = useUpdate();
  const [checking, setChecking] = useState(false);
  if (!info) return null;
  if (!info.unpacked) {
    return <p>Installed from the Chrome Web Store: Chrome keeps it up to date automatically.</p>;
  }
  return (
    <div className="space-y-2 rounded-xl border-[0.5px] border-line bg-surface p-3 shadow-card">
      <p className="font-semibold">
        {info.available ? `Version ${info.latest} is available (you have ${info.current}).` : `You have the latest version${info.latest ? ` (${info.current})` : ''}.`}
      </p>
      <p className="text-muted">
        This copy was loaded unpacked, so Chrome cannot update it. Install it from the{' '}
        <a href={STORE_URL} target="_blank" rel="noreferrer" className="text-accent underline">
          Chrome Web Store
        </a>{' '}
        to get updates automatically.
      </p>
      {info.available && (
        <ol className="list-decimal space-y-1 pl-5">
          <li>Download the new version.</li>
          <li>Unzip it into the folder you loaded in chrome://extensions, replacing the files there.</li>
          <li>Click Reload. Your settings, library and downloaded voices are kept.</li>
        </ol>
      )}
      {info.available && <p className="text-muted">Do not remove the extension to update it: removing it also deletes the downloaded voices and your settings.</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {info.available && (
          <a href={LATEST_ZIP_URL} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover">
            <Download size={14} /> Download {info.latest}
          </a>
        )}
        {info.available && (
          <Button onClick={() => void request('update/reload', {})}>
            <RotateCw size={14} /> Reload
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await check(true);
            setChecking(false);
          }}
        >
          <RefreshCw size={14} className={checking ? 'animate-spin' : undefined} /> Check now
        </Button>
      </div>
    </div>
  );
}
