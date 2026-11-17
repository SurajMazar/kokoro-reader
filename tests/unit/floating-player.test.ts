// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import type { PlaybackState } from '@/shared/types';
import { createChromeMock } from '../chrome-mock';

const ended = {
  sessionId: 's1',
  docId: 'd1',
  title: 'FORGE — The AI Engineer',
  tabId: 1,
  status: 'ended',
  sentenceIndex: 0,
  sentenceCount: 1,
  sentenceText: 'Watch the generation loop',
  blockId: 0,
  engine: 'kokoro',
  voice: 'bm_lewis',
  rate: 1,
  volume: 1,
  generatedSeconds: 2,
  estimatedRemainingSeconds: 2,
  error: null,
  updatedAt: 0,
} as PlaybackState;

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('chrome', createChromeMock().contextChrome({ tab: { id: 1 } as chrome.tabs.Tab, url: 'https://example.com/' }));
});

describe('FloatingPlayer', () => {
  it('Close hides the player at once and asks the background to stop, even if nothing answers', async () => {
    const { OverlayRoot } = await import('@/content/overlay/shadow-root');
    const { FloatingPlayer } = await import('@/content/overlay/floating-player');
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    const overlay = new OverlayRoot();
    const onClose = vi.fn();
    const player = new FloatingPlayer(overlay, DEFAULT_SETTINGS, onClose);
    player.update(ended);
    const close = overlay.root.querySelector<HTMLButtonElement>('[aria-label="Stop reading and close"]')!;
    expect(close).not.toBeNull();
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(overlay.root.querySelector('.player')).toBeNull();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'session/control', payload: { action: 'stop' } }));
  });

  it('Play on a finished reading sends play (the background replays it)', async () => {
    const { OverlayRoot } = await import('@/content/overlay/shadow-root');
    const { FloatingPlayer } = await import('@/content/overlay/floating-player');
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    const overlay = new OverlayRoot();
    const player = new FloatingPlayer(overlay, DEFAULT_SETTINGS);
    player.update(ended);
    overlay.root.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'session/control', payload: { action: 'play' } }));
  });
});
