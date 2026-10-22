/**
 * PauseMenu — manages the DOM pause overlay and exposes settings values.
 * Escape key toggles; callbacks fire when the game should pause/resume.
 */
export class PauseMenu {
  private overlay:  HTMLElement;
  private resumeBtn: HTMLElement;

  sensitivity = 50;  // 1-100
  volume      = 80;  // 0-100

  onPause:  () => void = () => {};
  onResume: () => void = () => {};

  private paused = false;

  constructor() {
    this.overlay   = document.getElementById('pause-overlay')!;
    this.resumeBtn = document.getElementById('resume-btn')!;

    this.resumeBtn.addEventListener('click', () => this.resume());

    // Sensitivity slider
    const sensSlider = document.getElementById('sensitivity-slider') as HTMLInputElement;
    const sensValue  = document.getElementById('sensitivity-value')!;
    sensSlider.addEventListener('input', () => {
      this.sensitivity = Number(sensSlider.value);
      sensValue.textContent = sensSlider.value;
    });

    // Volume slider
    const volSlider = document.getElementById('volume-slider') as HTMLInputElement;
    const volValue  = document.getElementById('volume-value')!;
    volSlider.addEventListener('input', () => {
      this.volume = Number(volSlider.value);
      volValue.textContent = volSlider.value;
    });

    // ESC key
    window.addEventListener('keydown', this.onKeyDown);

    // If pointer lock is released unexpectedly (e.g. alt-tab), pause
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      if (this.paused) this.resume();
      else             this.pause();
    }
  };

  // Only auto-pause when pointer lock is lost IF the start overlay is hidden
  private startVisible = true;

  /**
   * Set by CutsceneDirector while a cutscene is playing.
   * Prevents the auto-pause that would otherwise fire when pointer lock is
   * released intentionally (e.g. during a scripted camera sequence).
   */
  private autoLockPauseSuppressed = false;

  suppressAutoLockPause()  { this.autoLockPauseSuppressed = true;  }
  restoreAutoLockPause()   { this.autoLockPauseSuppressed = false; }

  private onLockChange = () => {
    if (
      !this.startVisible &&
      !document.pointerLockElement &&
      !this.paused &&
      !this.autoLockPauseSuppressed
    ) {
      this.pause();
    }
  };

  /** Call once start overlay is dismissed so we know the game has begun. */
  markGameStarted() {
    this.startVisible = false;
  }

  pause() {
    this.paused = true;
    this.overlay.classList.remove('hidden');
    this.onPause();
  }

  resume() {
    this.paused = false;
    this.overlay.classList.add('hidden');
    this.onResume();
  }

  isPaused() { return this.paused; }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
}
