import { request } from '@/shared/messages/bus';
import type { ControlAction } from '@/shared/messages/contract';
import { SPEED_PRESETS, type PlayerMode, type Settings } from '@/shared/settings';
import type { ModelState, PlaybackState, VoiceInfo } from '@/shared/types';
import { formatDuration, formatBytes } from '@/shared/utils/format';
import { icon } from './icons';
import { h, setIcon, type OverlayRoot } from './shadow-root';

/** The in-page player shown in the tab that owns the reading session. */
export class FloatingPlayer {
  private element: HTMLDivElement | null = null;
  private state: PlaybackState | null = null;
  private model: ModelState | null = null;
  private mode: PlayerMode;
  private voices: VoiceInfo[] = [];
  private speedMenuOpen = false;
  private seeking = false;

  constructor(
    private readonly overlay: OverlayRoot,
    private settings: Settings,
    /** Called when the user closes the player (before the stop request is sent). */
    private readonly onClose: () => void = () => undefined,
  ) {
    this.mode = settings.playerMode;
  }

  setSettings(settings: Settings) {
    this.settings = settings;
    if (this.element) this.render();
  }

  update(state: PlaybackState) {
    this.state = state;
    if (state.status === 'idle' && !state.error) {
      this.hide();
      return;
    }
    this.render();
  }

  setModel(model: ModelState) {
    this.model = model;
    if (this.element && (this.state?.status === 'preparing' || this.state?.status === 'error')) this.render();
  }

  hide() {
    this.element?.remove();
    this.element = null;
    this.speedMenuOpen = false;
  }

  /** Closes at once, whatever the background answers, then stops the reading. */
  private close() {
    this.onClose();
    this.hide();
    this.state = null;
    this.control('stop');
  }

  private control(action: ControlAction, index?: number) {
    void request('session/control', { action, index }).catch(() => undefined);
  }

  private set(patch: { rate?: number; volume?: number; voice?: string }) {
    void request('session/set', patch).catch(() => undefined);
  }

  private iconButton(name: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const button = h('button', { class: 'icon-button', type: 'button', 'aria-label': label, title: label });
    setIcon(button, icon(name, 16));
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  private statusLine(): HTMLElement | null {
    const state = this.state!;
    if (state.error) {
      const line = h('div', { class: 'status-line error', role: 'alert' });
      const glyph = h('span');
      setIcon(glyph, icon('alert', 14));
      line.append(glyph, h('span', {}, [state.error.message]));
      const recovery = state.error.recovery;
      if (recovery === 'retry' || recovery === 'retry-download' || recovery === 'use-wasm') {
        const retry = h('button', { class: 'recover', type: 'button' }, [recovery === 'retry-download' ? 'Retry download' : 'Retry']);
        retry.addEventListener('click', () => this.control('play'));
        line.append(retry);
      } else if (recovery === 'open-settings' || recovery === 'grant-permission' || recovery === 'clear-cache') {
        const open = h('button', { class: 'recover', type: 'button' }, ['Settings']);
        open.addEventListener('click', () => void request('ui/open-options', { section: 'engine' }).catch(() => undefined));
        line.append(open);
      }
      return line;
    }
    if (state.status === 'preparing' || state.status === 'buffering') {
      const line = h('div', { class: 'status-line', role: 'status' });
      const spinner = h('span', { class: 'spin' });
      setIcon(spinner, icon('loader', 13));
      let text = state.status === 'buffering' ? 'Generating speech…' : 'Preparing voice…';
      const model = this.model;
      if (state.status === 'preparing' && model?.status === 'downloading' && model.progress) {
        const pct = Math.floor((model.progress.loaded / Math.max(1, model.progress.total)) * 100);
        text = `Downloading Kokoro model ${pct}% · ${formatBytes(model.progress.loaded)} of ${formatBytes(model.progress.total)}`;
      } else if (state.status === 'preparing' && model?.status === 'initializing') {
        text = 'Starting the speech engine…';
      } else if (state.status === 'preparing' && model?.status === 'verifying') {
        text = 'Verifying model files…';
      }
      line.append(spinner, h('span', {}, [text]));
      return line;
    }
    return null;
  }

  private render() {
    const state = this.state;
    if (!state) return;
    const previous = this.element;
    const playing = state.status === 'playing' || state.status === 'buffering' || state.status === 'preparing';
    const classes = ['player', 'glass', this.settings.playerCorner, this.mode].join(' ');
    const root = h('div', { class: classes, role: 'region', 'aria-label': 'Kokoro Reader player' });
    root.addEventListener('keydown', (event) => {
      if (event.key === ' ' && (event.target as HTMLElement).tagName !== 'INPUT') {
        event.preventDefault();
        this.control('toggle');
      }
    });

    const play = h('button', { class: 'play', type: 'button', 'aria-label': playing ? 'Pause' : 'Play' });
    setIcon(play, icon(playing ? 'pause' : 'play', this.mode === 'minimized' ? 16 : 18));
    play.addEventListener('click', () => this.control(playing ? 'pause' : 'play'));

    if (this.mode === 'minimized') {
      const badge = h('div', { class: 'badge', 'aria-hidden': 'true' });
      setIcon(badge, icon('speaker', 15));
      root.append(
        badge,
        play,
        this.iconButton('expand', 'Expand player', () => {
          this.mode = 'compact';
          this.render();
        }),
        this.iconButton('close', 'Stop reading', () => this.close()),
      );
      this.swap(previous, root);
      return;
    }

    const badge = h('div', { class: 'badge', 'aria-hidden': 'true' });
    setIcon(badge, icon('speaker', 16));
    const sub = `${state.engine === 'browser' ? 'Browser voice' : this.voiceName(state.voice)} · ${state.rate}×`;
    const header = h('div', { class: 'header' }, [
      badge,
      h('div', { class: 'titles' }, [h('div', { class: 'title' }, [state.title || 'Kokoro Reader']), h('div', { class: 'subtitle' }, [sub])]),
      this.iconButton('minimize', 'Minimize player', () => {
        this.mode = 'minimized';
        this.render();
      }),
      this.iconButton(this.mode === 'expanded' ? 'collapse' : 'expand', this.mode === 'expanded' ? 'Collapse player' : 'Expand player', () => {
        this.mode = this.mode === 'expanded' ? 'compact' : 'expanded';
        if (this.mode === 'expanded') void this.loadVoices();
        this.render();
      }),
      this.iconButton('close', 'Stop reading and close', () => this.close()),
    ]);
    root.append(header);

    const status = this.statusLine();
    if (status) root.append(status);
    else root.append(h('div', { class: 'sentence', 'aria-live': 'off' }, [state.sentenceText]));

    const count = Math.max(1, state.sentenceCount);
    const slider = h('input', {
      type: 'range',
      min: '0',
      max: String(count - 1),
      step: '1',
      'aria-label': 'Reading position',
      'aria-valuetext': `Sentence ${state.sentenceIndex + 1} of ${count}`,
    }) as HTMLInputElement;
    slider.value = String(state.sentenceIndex);
    slider.addEventListener('input', () => {
      this.seeking = true;
    });
    slider.addEventListener('change', () => {
      this.seeking = false;
      this.control('seek', Number(slider.value));
    });
    root.append(
      h('div', { class: 'progress' }, [
        h('span', {}, [`${state.sentenceIndex + 1}/${count}`]),
        slider,
        h('span', {}, [state.estimatedRemainingSeconds > 0 ? `${formatDuration(state.estimatedRemainingSeconds)} left` : '']),
      ]),
    );

    const speed = h('button', { class: 'pill', type: 'button', 'aria-label': `Playback speed ${state.rate} times`, 'aria-haspopup': 'menu' }, [`${state.rate}×`]);
    speed.addEventListener('click', () => {
      this.speedMenuOpen = !this.speedMenuOpen;
      this.render();
    });
    const transport = h('div', { class: 'transport' }, [
      this.iconButton('skipBack', 'Previous paragraph', () => this.control('previous-block')),
      this.iconButton('prev', 'Previous sentence', () => this.control('previous'), state.sentenceIndex === 0),
      play,
      this.iconButton('next', 'Next sentence', () => this.control('next'), state.sentenceIndex >= count - 1),
      this.iconButton('skipForward', 'Next paragraph', () => this.control('next-block')),
    ]);
    root.append(h('div', { class: 'controls' }, [transport, speed]));

    if (this.speedMenuOpen) {
      const menu = h('div', { class: 'speed-menu glass', role: 'menu', 'aria-label': 'Playback speed' });
      for (const preset of SPEED_PRESETS) {
        const option = h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(preset === state.rate) }, [`${preset}×`]);
        option.addEventListener('click', () => {
          this.speedMenuOpen = false;
          this.set({ rate: preset });
        });
        menu.append(option);
      }
      root.append(menu);
    }

    if (this.mode === 'expanded') {
      const voice = h('select', { 'aria-label': 'Voice' }) as HTMLSelectElement;
      const list = this.voices.length ? this.voices : [{ id: state.voice, name: this.voiceName(state.voice), languageLabel: '' } as VoiceInfo];
      for (const option of list) {
        const element = h('option', { value: option.id }, [option.languageLabel ? `${option.name} · ${option.languageLabel}` : option.name]);
        if (option.id === state.voice) element.setAttribute('selected', '');
        voice.append(element);
      }
      voice.addEventListener('change', () => this.set({ voice: voice.value }));
      const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume' }) as HTMLInputElement;
      volume.value = String(state.volume);
      volume.addEventListener('change', () => this.set({ volume: Number(volume.value) }));
      root.append(h('div', { class: 'extras' }, [h('span', {}, ['Voice']), voice, h('span', {}, ['Volume']), volume]));
    }

    this.swap(previous, root);
  }

  private swap(previous: HTMLDivElement | null, next: HTMLDivElement) {
    if (this.seeking) return;
    const focusedLabel = (this.overlay.root.activeElement as HTMLElement | null)?.getAttribute('aria-label');
    if (previous) {
      next.style.animation = 'none';
      previous.replaceWith(next);
    } else {
      this.overlay.container.append(next);
    }
    this.element = next;
    if (focusedLabel) next.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusedLabel)}"]`)?.focus();
  }

  private voiceName(id: string): string {
    return this.voices.find((voice) => voice.id === id)?.name ?? id.replace(/^[a-z]{2}_/, '').replace(/^\w/, (c) => c.toUpperCase());
  }

  private async loadVoices() {
    if (this.voices.length) return;
    this.voices = await request('voices/list', {}).catch(() => []);
    if (this.element) this.render();
  }

  destroy() {
    this.hide();
  }
}
