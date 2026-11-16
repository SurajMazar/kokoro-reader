import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Pause, Play, Square, Volume2 } from 'lucide-react';
import { request } from '@/shared/messages/bus';
import type { ControlAction } from '@/shared/messages/contract';
import { SPEED_PRESETS } from '@/shared/settings';
import type { PlaybackState } from '@/shared/types';
import { formatDuration } from '@/shared/utils/format';
import { cx, IconButton, Select } from './primitives';

export function control(action: ControlAction, index?: number) {
  return request('session/control', { action, index }).catch((error: unknown) => console.warn(error));
}

export function setPlayback(patch: { rate?: number; volume?: number; voice?: string }) {
  return request('session/set', patch).catch((error: unknown) => console.warn(error));
}

export function isActive(state: PlaybackState | null): state is PlaybackState {
  return !!state && !!state.sessionId && state.status !== 'idle';
}

/** Transport, position and speed controls for the active session. Used by the popup, side panel and reader. */
export function PlayerControls({ state, size = 'md', showVolume = false }: { state: PlaybackState; size?: 'md' | 'lg'; showVolume?: boolean }) {
  const playing = state.status === 'playing' || state.status === 'buffering' || state.status === 'preparing';
  const loading = state.status === 'buffering' || state.status === 'preparing';
  const count = Math.max(1, state.sentenceCount);
  const big = size === 'lg';
  return (
    <div className="w-full">
      <div className="flex items-center gap-2 text-[11px] text-muted tabular-nums">
        <span className="w-12">{`${state.sentenceIndex + 1} / ${count}`}</span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={count - 1}
          value={state.sentenceIndex}
          aria-label="Reading position"
          aria-valuetext={`Sentence ${state.sentenceIndex + 1} of ${count}`}
          onChange={(event) => void control('seek', Number(event.target.value))}
        />
        <span className="w-14 text-right">{state.estimatedRemainingSeconds > 0 ? `−${formatDuration(state.estimatedRemainingSeconds)}` : ''}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Select label="Playback speed" value={String(state.rate)} onChange={(value) => void setPlayback({ rate: Number(value) })} className="h-7 w-[72px] px-1.5 text-[12px]">
          {[...new Set([...SPEED_PRESETS, state.rate])].sort((a, b) => a - b).map((rate) => (
            <option key={rate} value={rate}>{`${rate}×`}</option>
          ))}
        </Select>
        <div className="flex items-center gap-0.5">
          <IconButton label="Previous paragraph" onClick={() => void control('previous-block')}>
            <ChevronsLeft size={17} />
          </IconButton>
          <IconButton label="Previous sentence" onClick={() => void control('previous')} disabled={state.sentenceIndex === 0}>
            <ChevronLeft size={17} />
          </IconButton>
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => void control(playing ? 'pause' : 'play')}
            className={cx(
              'mx-1 grid place-items-center rounded-full bg-accent text-accent-fg shadow-[0_2px_8px_rgba(110,86,207,0.35)] transition-transform hover:bg-accent-hover active:scale-95',
              big ? 'size-12' : 'size-10',
            )}
          >
            {loading ? <Loader2 size={big ? 20 : 17} className="animate-spin" /> : playing ? <Pause size={big ? 20 : 17} fill="currentColor" /> : <Play size={big ? 20 : 17} fill="currentColor" className="translate-x-[1px]" />}
          </button>
          <IconButton label="Next sentence" onClick={() => void control('next')} disabled={state.sentenceIndex >= count - 1}>
            <ChevronRight size={17} />
          </IconButton>
          <IconButton label="Next paragraph" onClick={() => void control('next-block')}>
            <ChevronsRight size={17} />
          </IconButton>
        </div>
        <IconButton label="Stop" onClick={() => void control('stop')}>
          <Square size={14} fill="currentColor" />
        </IconButton>
      </div>
      {showVolume && (
        <label className="mt-2 flex items-center gap-2 text-muted">
          <Volume2 size={14} aria-hidden="true" />
          <span className="sr-only">Volume</span>
          <input type="range" className="flex-1" min={0} max={1} step={0.05} value={state.volume} onChange={(event) => void setPlayback({ volume: Number(event.target.value) })} aria-label="Volume" />
        </label>
      )}
    </div>
  );
}
