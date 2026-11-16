// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KOKORO_VOICES } from '@/engine/kokoro/voices';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import type { PlaybackState } from '@/shared/types';
import { createChromeMock } from '../chrome-mock';

beforeEach(() => {
  vi.stubGlobal('chrome', createChromeMock().contextChrome({ url: 'chrome-extension://test-extension-id/popup/index.html' }));
});

describe('VoiceLibrary', () => {
  it('searches, filters by language, selects and favorites voices', async () => {
    const { VoiceLibrary } = await import('@/ui/components/VoiceLibrary');
    const update = vi.fn(async () => undefined);
    render(<VoiceLibrary voices={[...KOKORO_VOICES]} settings={DEFAULT_SETTINGS} update={update} />);
    const list = screen.getByRole('list', { name: 'Voices' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(28);

    await userEvent.type(screen.getByPlaceholderText('Search voices'), 'emma');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(within(list).getAllByRole('button', { name: /Emma/ })[0]!);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ voice: 'bf_emma' }));

    await userEvent.click(screen.getByRole('button', { name: 'Add Emma to favorites' }));
    expect(update).toHaveBeenCalledWith({ favoriteVoices: ['af_heart', 'bf_emma'] });

    await userEvent.clear(screen.getByPlaceholderText('Search voices'));
    await userEvent.click(screen.getByRole('radio', { name: 'UK' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
  });
});

describe('PlayerControls', () => {
  it('exposes labelled, keyboard-reachable controls', async () => {
    const { PlayerControls } = await import('@/ui/components/PlayerControls');
    const state = { sessionId: 's', status: 'playing', sentenceIndex: 0, sentenceCount: 10, rate: 1, volume: 1, estimatedRemainingSeconds: 65 } as PlaybackState;
    render(<PlayerControls state={state} showVolume />);
    for (const name of ['Pause', 'Next sentence', 'Previous paragraph', 'Next paragraph', 'Stop', 'Volume', 'Reading position', 'Playback speed']) {
      expect(screen.getAllByLabelText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText('Previous sentence')).toBeDisabled();
    expect(screen.getByText('−1:05')).toBeInTheDocument();
  });
});
