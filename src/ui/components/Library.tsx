import { ArrowDown, ArrowUp, BookMarked, BookOpen, Check, History, ListMusic, Pencil, Play, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { request } from '@/shared/messages/bus';
import { deleteBookmark, deleteHistory, LOCAL_KEYS, moveInQueue, removeFromQueue, renameBookmark, setQueue } from '@/shared/storage';
import type { Bookmark, HistoryEntry, QueueItem } from '@/shared/types';
import { formatDuration, formatRelative, hostOf } from '@/shared/utils/format';
import { useStored } from '../hooks';
import { Button, Empty, IconButton, SectionTitle } from './primitives';

async function ensureOriginAccess(url: string | undefined): Promise<boolean> {
  if (!url) return true;
  try {
    const origin = `${new URL(url).origin}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

export function QueueList({ compact = false }: { compact?: boolean }) {
  const queue = useStored<QueueItem[]>(LOCAL_KEYS.queue, []);
  return (
    <section aria-label="Listen Later queue">
      <SectionTitle
        action={
          queue.length > 0 && (
            <div className="flex gap-1">
              <Button size="sm" variant="primary" onClick={() => void request('session/play-queue', {})}>
                <Play size={12} fill="currentColor" /> Play all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void setQueue([])}>
                Clear
              </Button>
            </div>
          )
        }
      >
        Listen Later · {queue.length}
      </SectionTitle>
      {!queue.length ? (
        <Empty icon={<ListMusic size={18} />} title="Your queue is empty">
          Right-click a page and choose “Add page to Listen Later”, or use the + button next to a selection. Items play back to back like a playlist.
        </Empty>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-xl border-[0.5px] border-line bg-surface shadow-card">
          {queue.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-4 text-center text-[11px] text-subtle tabular-nums">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{item.title}</div>
                <div className="truncate text-[11.5px] text-muted">
                  {item.siteName || hostOf(item.url) || 'Pasted text'} · {item.doc.sentences.length} sentences
                </div>
              </div>
              <IconButton label={`Play ${item.title} now`} onClick={() => void request('session/play-queue', { itemId: item.id })}>
                <Play size={14} />
              </IconButton>
              {!compact && (
                <>
                  <IconButton label="Move up" disabled={index === 0} onClick={() => void moveInQueue(item.id, -1)}>
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton label="Move down" disabled={index === queue.length - 1} onClick={() => void moveInQueue(item.id, 1)}>
                    <ArrowDown size={14} />
                  </IconButton>
                </>
              )}
              <IconButton label={`Remove ${item.title}`} onClick={() => void removeFromQueue(item.id)}>
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function HistoryList({ limit }: { limit?: number }) {
  const history = useStored<HistoryEntry[]>(LOCAL_KEYS.history, []);
  const [error, setError] = useState<string | null>(null);
  const items = limit ? history.slice(0, limit) : history;

  async function resume(entry: HistoryEntry) {
    setError(null);
    if (!(await ensureOriginAccess(entry.url))) {
      setError('Kokoro Reader needs permission to read that site to resume it.');
      return;
    }
    await request('history/resume', { id: entry.id }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }

  return (
    <section aria-label="Reading history">
      <SectionTitle action={history.length > 0 && <Button size="sm" variant="ghost" onClick={() => void deleteHistory()}>Clear</Button>}>History</SectionTitle>
      {error && <p role="alert" className="mb-2 px-1 text-[12px] text-danger">{error}</p>}
      {!items.length ? (
        <Empty icon={<History size={18} />} title="No history yet">
          Pages you listen to appear here so you can resume them. History stays on this device and can be turned off in Settings.
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border-[0.5px] border-line bg-surface shadow-card">
          {items.map((entry) => {
            const pct = Math.round(((entry.sentenceIndex + 1) / Math.max(1, entry.sentenceCount)) * 100);
            return (
              <li key={entry.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{entry.title}</div>
                  <div className="truncate text-[11.5px] text-muted">
                    {entry.siteName || hostOf(entry.url)} · {formatRelative(entry.lastPlayedAt)} · {formatDuration(entry.listenedSeconds)} ·{' '}
                    {entry.completed ? (
                      <span className="inline-flex items-center gap-0.5 text-success">
                        <Check size={11} /> Finished
                      </span>
                    ) : (
                      `${pct}%`
                    )}
                  </div>
                </div>
                {entry.url && !entry.completed && (
                  <IconButton label={`Resume ${entry.title}`} onClick={() => void resume(entry)}>
                    <Play size={14} />
                  </IconButton>
                )}
                <IconButton label={`Delete ${entry.title} from history`} onClick={() => void deleteHistory(entry.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function BookmarkList() {
  const bookmarks = useStored<Bookmark[]>(LOCAL_KEYS.bookmarks, []);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');

  function open(bookmark: Bookmark) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`reader/index.html?bookmark=${encodeURIComponent(bookmark.id)}`) });
  }

  return (
    <section aria-label="Bookmarks">
      <SectionTitle>Bookmarks</SectionTitle>
      {!bookmarks.length ? (
        <Empty icon={<BookMarked size={18} />} title="No bookmarks">
          Use the bookmark button while listening to save your place. Bookmarks keep the text locally so you can resume anytime.
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border-[0.5px] border-line bg-surface shadow-card">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                {editing === bookmark.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameBookmark(bookmark.id, name).then(() => setEditing(null));
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Bookmark name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      onBlur={() => void renameBookmark(bookmark.id, name).then(() => setEditing(null))}
                      className="h-7 w-full rounded-md border-[0.5px] border-line bg-surface-2 px-2 text-[13px]"
                    />
                  </form>
                ) : (
                  <div className="truncate text-[13px] font-medium">{bookmark.name}</div>
                )}
                <div className="truncate text-[11.5px] text-muted">“{bookmark.snippet}”</div>
              </div>
              <IconButton label={`Resume ${bookmark.name}`} onClick={() => open(bookmark)}>
                <BookOpen size={14} />
              </IconButton>
              <IconButton
                label={`Rename ${bookmark.name}`}
                onClick={() => {
                  setEditing(bookmark.id);
                  setName(bookmark.name);
                }}
              >
                <Pencil size={13} />
              </IconButton>
              <IconButton label={`Delete ${bookmark.name}`} onClick={() => void deleteBookmark(bookmark.id)}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
