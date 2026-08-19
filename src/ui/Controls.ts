export interface ControlHandlers {
  onPlay: () => void;
  onPause: () => void;
  onReplay: () => void;
  onMute: (muted: boolean) => void;
}

export class ControlsUI {
  private _container: HTMLElement;
  private _handlers: ControlHandlers;
  private _playBtn!: HTMLButtonElement;
  private _replayBtn!: HTMLButtonElement;
  private _muteBtn!: HTMLButtonElement;
  private _muted = false;
  private _playing = true;

  constructor(container: HTMLElement, handlers: ControlHandlers) {
    this._container = container;
    this._handlers = handlers;

    const el = document.createElement('div');
    el.className = 'controls';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Animation controls');
    el.innerHTML = `
      <button class="controls__btn" id="play-btn" aria-label="Pause animation" title="Play/Pause (Space)" aria-pressed="false">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
      <button class="controls__btn" id="replay-btn" aria-label="Replay animation" title="Replay (R)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
      </button>
      <button class="controls__btn" id="mute-btn" aria-label="Mute" aria-pressed="false" title="Mute (M)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
      </button>
    `;

    this._container.appendChild(el);

    this._playBtn = el.querySelector('#play-btn')!;
    this._replayBtn = el.querySelector('#replay-btn')!;
    this._muteBtn = el.querySelector('#mute-btn')!;

    this._playBtn.addEventListener('click', () => {
      if (this._playing) {
        this._handlers.onPause();
        this._playing = false;
        this._updatePlayIcon(false);
      } else {
        this._handlers.onPlay();
        this._playing = true;
        this._updatePlayIcon(true);
      }
    });

    this._replayBtn.addEventListener('click', () => {
      this._handlers.onReplay();
      this._playing = true;
      this._updatePlayIcon(true);
    });

    this._muteBtn.addEventListener('click', () => {
      this._muted = !this._muted;
      this._muteBtn.setAttribute('aria-pressed', String(this._muted));
      this._handlers.onMute(this._muted);
    });

    // Keyboard shortcuts (always active, not just when focused)
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          if (this._playing) {
            this._handlers.onPause();
            this._playing = false;
            this._updatePlayIcon(false);
          } else {
            this._handlers.onPlay();
            this._playing = true;
            this._updatePlayIcon(true);
          }
          break;
        case 'm':
          if (document.activeElement !== this._muteBtn) {
            e.preventDefault();
            this._muted = !this._muted;
            this._muteBtn.setAttribute('aria-pressed', String(this._muted));
            this._handlers.onMute(this._muted);
          }
          break;
        default:
          break;
      }
    });
  }

  private _updatePlayIcon(playing: boolean): void {
    if (playing) {
      this._playBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      this._playBtn.setAttribute('aria-label', 'Pause animation');
    } else {
      this._playBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
      this._playBtn.setAttribute('aria-label', 'Play animation');
    }
  }

  setPlaying(playing: boolean): void {
    if (this._playing === playing) return;
    this._playing = playing;
    this._updatePlayIcon(playing);
  }

  setProgress(_progress: number): void {
    // Can be extended with a progress bar if desired
  }
}
