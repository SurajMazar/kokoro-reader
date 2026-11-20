import type { ModelState, PlaybackStatus } from './types';
import { formatBytes } from './utils/format';

const percent = (loaded: number, total: number) => Math.floor((loaded / Math.max(1, total)) * 100);

/**
 * What the player shows while it waits for audio: the download or engine
 * step actually in progress, so a first-time wait (a voice pack or the model
 * downloading) is explained instead of a bare "Preparing voice…".
 */
export function waitingText(status: PlaybackStatus, model: ModelState | null): string {
  const pack = Object.values(model?.packs ?? {}).find((item) => item.status === 'downloading' && item.progress);
  if (pack?.progress) {
    const { loaded, total } = pack.progress;
    return `Downloading the Nepali voice ${percent(loaded, total)}% · ${formatBytes(loaded)} of ${formatBytes(total)} (first use only)`;
  }
  if (model?.status === 'downloading' && model.progress) {
    const { loaded, total } = model.progress;
    return `Downloading the Kokoro model ${percent(loaded, total)}% · ${formatBytes(loaded)} of ${formatBytes(total)} (first use only)`;
  }
  if (model?.status === 'verifying') return 'Verifying model files…';
  if (model?.status === 'initializing') return 'Starting the speech engine…';
  return status === 'buffering' ? 'Generating speech…' : 'Preparing voice…';
}
