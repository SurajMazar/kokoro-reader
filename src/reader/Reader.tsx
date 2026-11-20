import { AlertCircle, Bookmark, Download, FileUp, Headphones, ListPlus, Loader2, PanelLeftClose, PanelLeftOpen, Play, Type } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { articleFromSnapshot, safeHost } from '@/shared/extraction/article';
import { collectBlocks } from '@/shared/extraction/collect';
import { request } from '@/shared/messages/bus';
import type { ExportResult, PageSnapshot } from '@/shared/messages/contract';
import { addToQueue, getBookmarks } from '@/shared/storage';
import { buildDoc, textToBlocks } from '@/shared/text/doc';
import { countWords, estimateSeconds } from '@/shared/text/normalize';
import type { ReadingDoc } from '@/shared/types';
import { formatBytes, formatDuration } from '@/shared/utils/format';
import { createId } from '@/shared/utils/id';
import { control, isActive, PlayerControls, setPlayback } from '@/ui/components/PlayerControls';
import { Button, Card, cx, IconButton, Select } from '@/ui/components/primitives';
import { waitingText } from '@/shared/engine-status';
import { useModelState, usePlayback, useSettings, useTheme, useVoices } from '@/ui/hooks';

type Loaded = { doc: ReadingDoc; start: number; attach: boolean };

async function loadFromUrl(): Promise<Loaded | 'custom' | null> {
  const params = new URLSearchParams(location.search);
  if (params.get('mode') === 'custom') return 'custom';
  const snapshotKey = params.get('snapshot');
  if (snapshotKey) {
    const stored = (await chrome.storage.session.get(snapshotKey))[snapshotKey] as { snapshot: PageSnapshot } | undefined;
    if (!stored) return null;
    return { doc: articleFromSnapshot(stored.snapshot), start: 0, attach: false };
  }
  const bookmarkId = params.get('bookmark');
  if (bookmarkId) {
    const bookmark = (await getBookmarks()).find((item) => item.id === bookmarkId);
    if (!bookmark?.doc) return null;
    return { doc: bookmark.doc, start: bookmark.sentenceIndex, attach: false };
  }
  if (params.get('session') === 'current') {
    const doc = await request('session/doc', {});
    return doc ? { doc, start: 0, attach: true } : null;
  }
  return null;
}

export function Reader() {
  const [settings] = useSettings();
  useTheme(settings);
  const [loaded, setLoaded] = useState<Loaded | 'custom' | null | undefined>(undefined);

  useEffect(() => {
    void loadFromUrl()
      .then(setLoaded)
      .catch(() => setLoaded(null));
  }, []);

  useEffect(() => {
    if (loaded && loaded !== 'custom') document.title = `${loaded.doc.title} · Kokoro Reader`;
  }, [loaded]);

  if (loaded === undefined) {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (loaded === 'custom') return <CustomText onReady={(doc) => setLoaded({ doc, start: 0, attach: false })} />;
  if (!loaded) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <AlertCircle className="mx-auto mb-3 text-danger" />
          <h1 className="text-[16px] font-semibold">Nothing to read here</h1>
          <p className="mt-1 text-[13px] text-muted">This reader link has expired or the article could not be extracted.</p>
          <Button className="mt-4" onClick={() => (location.search = '?mode=custom')}>
            Paste your own text
          </Button>
        </div>
      </div>
    );
  }
  return <ArticleView doc={loaded.doc} initialSentence={loaded.start} />;
}

function ArticleView({ doc, initialSentence }: { doc: ReadingDoc; initialSentence: number }) {
  const playback = usePlayback();
  const [settings] = useSettings();
  const voices = useVoices(settings.engine);
  const [tocOpen, setTocOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const userScrolledAt = useRef(0);
  const ours = isActive(playback) && playback.docId === doc.id ? playback : null;
  const [model] = useModelState();
  const current = ours ? ours.sentenceIndex : -1;
  const currentBlock = ours ? doc.sentences[current]?.blockId : undefined;

  const headings = useMemo(() => doc.blocks.filter((block) => block.kind === 'heading'), [doc]);
  const sentencesByBlock = useMemo(() => {
    const map = new Map<number, typeof doc.sentences>();
    for (const sentence of doc.sentences) map.set(sentence.blockId, [...(map.get(sentence.blockId) ?? []), sentence]);
    return map;
  }, [doc]);
  const words = useMemo(() => countWords(doc.blocks.map((block) => block.text).join(' ')), [doc]);
  // The article's own first heading doubles as the page title, so it is read and highlighted there.
  const titleBlock = doc.blocks[0]?.kind === 'heading' && doc.blocks[0].text === doc.title ? doc.blocks[0] : undefined;

  function renderSentences(blockId: number, fallback: string) {
    const sentences = sentencesByBlock.get(blockId) ?? [];
    if (!sentences.length) return fallback;
    return sentences.map((sentence) => (
      <span
        key={sentence.id}
        data-sentence={sentence.id}
        onClick={() => void startAt(sentence.id)}
        className={cx('cursor-pointer rounded-[3px] transition-colors duration-200 hover:bg-hover', sentence.id === current && settings.highlightSentence && 'bg-mark')}
      >
        {sentence.text}{' '}
      </span>
    ));
  }

  useEffect(() => {
    const mark = () => (userScrolledAt.current = Date.now());
    window.addEventListener('wheel', mark, { passive: true });
    window.addEventListener('touchmove', mark, { passive: true });
    return () => {
      window.removeEventListener('wheel', mark);
      window.removeEventListener('touchmove', mark);
    };
  }, []);

  useEffect(() => {
    if (current < 0 || !settings.autoScroll || Date.now() - userScrolledAt.current < 4000) return;
    const element = document.querySelector<HTMLElement>(`[data-sentence="${current}"]`);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.top < 90 || rect.bottom > window.innerHeight - 170) element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current, settings.autoScroll]);

  async function startAt(index: number) {
    setError(null);
    try {
      if (ours) await control('seek', index);
      else await request('session/start', { doc, startSentence: index });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function exportAudio() {
    setExporting(true);
    setError(null);
    try {
      const result = await request('export/wav', { doc });
      const blob = await (await fetch(result.url)).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExported(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setExporting(false);
    }
  }

  const pct = ours ? Math.round(((ours.sentenceIndex + 1) / Math.max(1, ours.sentenceCount)) * 100) : 0;
  const remaining = ours ? ours.estimatedRemainingSeconds : estimateSeconds(doc.blocks.map((b) => b.text).join(' '), settings.rate);

  return (
    <div className="min-h-screen pb-44">
      <div className="fixed inset-x-0 top-0 z-20 h-0.5 bg-transparent">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b-[0.5px] border-line bg-elevated px-4 py-2 backdrop-blur-xl">
        <IconButton label={tocOpen ? 'Hide contents' : 'Show contents'} onClick={() => setTocOpen(!tocOpen)} className="hidden lg:grid">
          {tocOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </IconButton>
        <img src="/icons/icon-32.png" alt="" className="size-5 rounded" />
        <span className="truncate text-[13px] font-medium">{doc.siteName || safeHost(doc.url ?? '') || 'Kokoro Reader'}</span>
        <span className="ml-auto hidden text-[12px] text-muted sm:inline">
          {words.toLocaleString()} words · {formatDuration(remaining)} {ours ? 'left' : 'listen'}
        </span>
      </header>

      <div className="mx-auto flex max-w-[1180px] gap-10 px-4 md:px-8">
        {tocOpen && headings.length > 1 && (
          <nav aria-label="Contents" className="sticky top-16 hidden h-[calc(100vh-14rem)] w-56 flex-none overflow-y-auto pt-10 lg:block">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Contents</div>
            <ul className="space-y-0.5">
              {headings.map((heading) => {
                const first = doc.sentences.findIndex((sentence) => sentence.blockId === heading.id);
                const isCurrent = currentBlock !== undefined && headings.filter((h) => h.id <= currentBlock).at(-1)?.id === heading.id;
                return (
                  <li key={heading.id} style={{ paddingLeft: `${Math.max(0, (heading.level ?? 2) - 2) * 10}px` }}>
                    <button
                      type="button"
                      onClick={() => {
                        document.querySelector(`[data-block="${heading.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                        if (first >= 0) void startAt(first);
                      }}
                      className={cx('w-full truncate rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-hover', isCurrent ? 'font-semibold text-accent' : 'text-muted')}
                    >
                      {heading.text}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <article className="mx-auto w-full max-w-[680px] pt-10" lang={doc.language === 'en' ? 'en' : undefined}>
          <p className="mb-2 text-[12px] font-medium tracking-wide text-accent uppercase">{doc.source === 'custom' ? 'Your text' : 'Smart Reader'}</p>
          <h1
            data-block={titleBlock?.id}
            className={cx('font-serif text-[34px] leading-tight font-semibold tracking-tight', titleBlock && titleBlock.id === currentBlock && settings.highlightParagraph && 'rounded-md bg-mark-block')}
          >
            {titleBlock ? renderSentences(titleBlock.id, titleBlock.text) : doc.title}
          </h1>
          {(doc.byline || doc.url) && (
            <p className="mt-2 text-[13px] text-muted">
              {doc.byline && <span>{doc.byline} · </span>}
              {doc.url && (
                <a href={doc.url} className="underline decoration-line underline-offset-2 hover:text-accent" target="_blank" rel="noreferrer noopener">
                  {safeHost(doc.url)}
                </a>
              )}
            </p>
          )}
          {doc.language && doc.language !== 'en' && (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--kr-warning)_12%,transparent)] p-3 text-[12.5px] text-warning">
              <AlertCircle size={14} /> This text may not be English. Kokoro's English voices will read it with English pronunciation.
            </p>
          )}
          <div className="mt-8 font-serif text-[19px] leading-[1.75]">
            {doc.blocks.map((block) => {
              if (block === titleBlock) return null;
              const content = renderSentences(block.id, block.text);
              const blockClass = cx('rounded-md transition-colors duration-300', block.id === currentBlock && settings.highlightParagraph && 'bg-mark-block');
              if (block.kind === 'heading') {
                const level = Math.min(4, Math.max(2, block.level ?? 2));
                const Tag = `h${level}` as 'h2';
                return (
                  <Tag key={block.id} data-block={block.id} className={cx(blockClass, 'mt-9 mb-3 font-sans font-semibold tracking-tight', level === 2 ? 'text-[24px]' : level === 3 ? 'text-[20px]' : 'text-[17px]')}>
                    {content}
                  </Tag>
                );
              }
              if (block.kind === 'quote')
                return (
                  <blockquote key={block.id} data-block={block.id} className={cx(blockClass, 'my-5 border-l-2 border-accent pl-5 text-muted italic')}>
                    {content}
                  </blockquote>
                );
              if (block.kind === 'list-item')
                return (
                  <p key={block.id} data-block={block.id} className={cx(blockClass, 'my-2 pl-6 -indent-4')}>
                    <span aria-hidden="true">•&nbsp;&nbsp;</span>
                    {content}
                  </p>
                );
              if (block.kind === 'caption')
                return (
                  <p key={block.id} data-block={block.id} className={cx(blockClass, 'my-3 font-sans text-[13px] text-muted')}>
                    {content}
                  </p>
                );
              return (
                <p key={block.id} data-block={block.id} className={cx(blockClass, 'my-5')}>
                  {content}
                </p>
              );
            })}
          </div>
        </article>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-3">
        <Card className="mx-auto max-w-[760px] bg-elevated p-3 shadow-pop backdrop-blur-xl">
          {error && (
            <p role="alert" className="mb-2 flex items-center gap-1.5 text-[12px] text-danger">
              <AlertCircle size={13} /> {error}
            </p>
          )}
          {notice && <p role="status" className="mb-2 text-[12px] text-accent">{notice}</p>}
          {exported && (
            <p role="status" className="mb-2 text-[12px] text-success">
              Saved {exported.filename} · {formatDuration(exported.durationSeconds)} · {formatBytes(exported.bytes)}
            </p>
          )}
          {ours ? (
            <>
              {ours.error && <p role="alert" className="mb-2 text-[12px] text-danger">{ours.error.message}</p>}
              {(ours.status === 'preparing' || ours.status === 'buffering') && <p className="mb-2 flex items-center gap-1.5 text-[12px] text-muted"><Loader2 size={13} className="animate-spin" /> {waitingText(ours.status, model)}</p>}
              <PlayerControls state={ours} size="lg" showVolume />
            </>
          ) : (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => void startAt(initialSentence)} className="grid size-12 place-items-center rounded-full bg-accent text-accent-fg shadow-[0_2px_8px_rgba(110,86,207,0.35)] hover:bg-accent-hover" aria-label="Listen">
                <Play size={20} fill="currentColor" className="translate-x-[1px]" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{initialSentence > 0 ? `Resume at sentence ${initialSentence + 1}` : 'Listen to this article'}</div>
                <div className="text-[12px] text-muted">
                  {doc.sentences.length} sentences · about {formatDuration(estimateSeconds(doc.blocks.map((b) => b.text).join(' '), settings.rate))} at {settings.rate}×
                </div>
              </div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t-[0.5px] border-line pt-2">
            <Select label="Voice" value={settings.engine === 'browser' ? 'system' : settings.voice} onChange={(voice) => void setPlayback({ voice })} className="h-7 text-[12px]">
              {settings.engine === 'browser' ? (
                <option value="system">Browser voice</option>
              ) : (
                voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} · {voice.languageLabel.replace('English ', '')}
                  </option>
                ))
              )}
            </Select>
            <div className="ml-auto flex items-center gap-1">
              {ours && (
                <Button size="sm" variant="ghost" onClick={() => void request('bookmark/add', {}).then(() => setNotice('Bookmark saved.'))}>
                  <Bookmark size={13} /> Bookmark
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void addToQueue({ id: createId(), title: doc.title, url: doc.url, siteName: doc.siteName, addedAt: Date.now(), doc, position: 0 }).then(() => setNotice('Added to Listen Later.'))
                }
              >
                <ListPlus size={13} /> Listen later
              </Button>
              <Button size="sm" variant="ghost" disabled={exporting || settings.engine !== 'kokoro'} onClick={() => void exportAudio()} title={settings.engine !== 'kokoro' ? 'Export needs the Kokoro engine' : 'Export as WAV'}>
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {exporting ? 'Generating…' : 'Export WAV'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

const ACCEPT = '.txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html';

function CustomText({ onReady }: { onReady: (doc: ReadingDoc) => void }) {
  const [settings] = useSettings();
  useTheme(settings);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const words = countWords(text);

  async function importFile(file: File) {
    setError(null);
    const name = file.name.toLowerCase();
    if (file.size > 5 * 1024 * 1024) {
      setError('That file is larger than 5 MB.');
      return;
    }
    if (!/\.(txt|md|markdown|html?)$/.test(name)) {
      setError('Only plain text (.txt), Markdown (.md) and HTML (.html) files can be imported. Export PDFs or Word documents as text first.');
      return;
    }
    const content = await file.text();
    setTitle((current) => current || file.name.replace(/\.[^.]+$/, ''));
    if (/\.html?$/.test(name)) {
      const parsed = new DOMParser().parseFromString(content, 'text/html');
      const { blocks } = collectBlocks(parsed.body, { live: false, dropFurniture: true, includeCode: false });
      setText(blocks.map((block) => (block.kind === 'heading' ? `${'#'.repeat(block.level ?? 2)} ${block.text}` : block.text)).join('\n\n'));
    } else {
      setText(content);
    }
  }

  function create() {
    const doc = buildDoc({ title: title.trim() || text.trim().split(/\s+/).slice(0, 8).join(' ') || 'Untitled', source: 'custom', blocks: textToBlocks(text) });
    if (!doc.sentences.length) {
      setError('Add some text first.');
      return;
    }
    onReady(doc);
  }

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 md:px-8">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <Type size={20} />
        </div>
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Read your own text</h1>
          <p className="text-[13px] text-muted">Paste, type or import text. It stays on this device.</p>
        </div>
      </div>
      <Card className="p-4">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" aria-label="Title" className="mb-3 h-9 w-full rounded-lg border-[0.5px] border-line bg-surface-2 px-3 text-[14px] font-medium" />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste or type text here. Separate paragraphs with a blank line; lines starting with # become headings."
          aria-label="Text to read"
          className="h-[46vh] min-h-[220px] w-full resize-y rounded-lg border-[0.5px] border-line bg-surface-2 p-3 font-serif text-[16px] leading-relaxed"
        />
        {error && (
          <p role="alert" className="mt-2 text-[12px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-[0.5px] border-line bg-surface px-3 text-[13px] font-medium shadow-card hover:bg-hover">
            <FileUp size={14} /> Import file
            <input type="file" accept={ACCEPT} className="sr-only" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} />
          </label>
          <span className="text-[12px] text-muted">
            {words.toLocaleString()} words · about {formatDuration(estimateSeconds(text, settings.rate))}
          </span>
          <Button variant="primary" className="ml-auto" disabled={!words} onClick={create}>
            <Headphones size={14} /> Continue
          </Button>
        </div>
      </Card>
      <p className="mt-3 px-1 text-[12px] text-subtle">Supported: .txt, .md and .html, parsed locally. Next you can listen with sentence highlighting and export a WAV file.</p>
    </div>
  );
}
