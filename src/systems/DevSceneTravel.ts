import type { SceneName } from '../scenes/types.js';

interface DevSceneTravelOptions {
  getSceneNames(): readonly SceneName[];
  getCurrentScene(): SceneName;
  onOpen(): void;
  onClose(): void;
  onLoad(scene: SceneName): Promise<void>;
}

/**
 * Development-only DOM for loading registered scenes through GameManager.
 * This module is dynamically imported behind import.meta.env.DEV, so neither
 * its UI nor its strings are emitted by the production build.
 */
export class DevSceneTravel {
  private readonly options: DevSceneTravelOptions;
  private readonly mount = document.createElement('div');
  private readonly toggleButton = document.createElement('button');
  private readonly overlay = document.createElement('div');
  private readonly select: HTMLSelectElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly style: HTMLStyleElement;
  private openState = false;
  private loading = false;

  constructor(options: DevSceneTravelOptions) {
    this.options = options;
    this.style = this.installStyles();

    this.mount.className = 'dev-scene-travel';
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'dev-scene-travel-toggle';
    this.toggleButton.textContent = 'DEV · Scene Travel';
    this.toggleButton.addEventListener('click', () => this.toggle());

    this.overlay.className = 'dev-scene-travel-overlay hidden';
    this.overlay.innerHTML = `
      <section class="dev-scene-travel-panel" role="dialog" aria-modal="true" aria-labelledby="dev-scene-travel-title">
        <div class="dev-scene-travel-heading">
          <div>
            <p>Development tools</p>
            <h2 id="dev-scene-travel-title">Scene Travel</h2>
          </div>
          <button type="button" class="dev-scene-travel-close" aria-label="Close scene travel menu">×</button>
        </div>
        <label for="dev-scene-travel-select">Registered scene</label>
        <select id="dev-scene-travel-select"></select>
        <p class="dev-scene-travel-note">Loads each scene through its normal build and dispose lifecycle. World 1 starts on pass one.</p>
        <div class="dev-scene-travel-actions">
          <button type="button" class="dev-scene-travel-cancel">Cancel</button>
          <button type="button" class="dev-scene-travel-load">Load Scene</button>
        </div>
      </section>
    `;
    this.select = this.overlay.querySelector<HTMLSelectElement>('#dev-scene-travel-select')!;
    this.loadButton = this.overlay.querySelector<HTMLButtonElement>('.dev-scene-travel-load')!;
    this.overlay.querySelector<HTMLButtonElement>('.dev-scene-travel-close')!.addEventListener('click', () => this.close());
    this.overlay.querySelector<HTMLButtonElement>('.dev-scene-travel-cancel')!.addEventListener('click', () => this.close());
    this.loadButton.addEventListener('click', () => { void this.loadSelectedScene(); });

    this.mount.append(this.toggleButton, this.overlay);
    document.body.append(this.mount);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.mount.remove();
    this.style.remove();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F9' && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggle();
    } else if (event.code === 'Escape' && this.openState) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    }
  };

  private toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  private open(): void {
    if (this.loading || this.openState) return;
    this.populateScenes();
    this.openState = true;
    this.overlay.classList.remove('hidden');
    this.options.onOpen();
    this.select.focus();
  }

  private close(restoreControls = true): void {
    if (!this.openState) return;
    this.openState = false;
    this.overlay.classList.add('hidden');
    if (restoreControls) this.options.onClose();
  }

  private populateScenes(): void {
    const selected = this.select.value || this.options.getCurrentScene();
    this.select.replaceChildren();
    for (const scene of this.options.getSceneNames()) {
      const option = document.createElement('option');
      option.value = scene;
      option.textContent = formatSceneName(scene);
      option.selected = scene === selected;
      this.select.append(option);
    }
  }

  private async loadSelectedScene(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.loadButton.disabled = true;
    const scene = this.select.value as SceneName;
    this.close(false);
    try {
      await this.options.onLoad(scene);
    } catch (error) {
      console.error('[DevSceneTravel] Scene load failed.', error);
    } finally {
      this.loading = false;
      this.loadButton.disabled = false;
    }
  }

  private installStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .dev-scene-travel-toggle { position: fixed; top: 14px; left: 14px; z-index: 410; padding: 8px 12px; border-radius: 7px; font-size: 12px; background: rgba(18, 24, 32, .9); }
      .dev-scene-travel-overlay { position: fixed; inset: 0; z-index: 420; display: grid; place-items: center; background: rgba(0, 0, 0, .55); backdrop-filter: blur(4px); }
      .dev-scene-travel-overlay.hidden { display: none; }
      .dev-scene-travel-panel { width: min(360px, calc(100vw - 32px)); padding: 22px; border: 1px solid rgba(126, 207, 255, .3); border-radius: 12px; background: rgba(12, 16, 23, .96); box-shadow: 0 18px 56px rgba(0, 0, 0, .65); }
      .dev-scene-travel-heading { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
      .dev-scene-travel-heading p { margin: 0 0 3px; color: #8a95a8; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
      .dev-scene-travel-heading h2 { margin: 0; font-size: 20px; }
      .dev-scene-travel-close { padding: 0 7px; border: 0; background: transparent; color: #8a95a8; font-size: 24px; line-height: 1; }
      .dev-scene-travel-panel label { display: block; margin-bottom: 7px; color: #aeb8c7; font-size: 12px; }
      .dev-scene-travel-panel select { width: 100%; padding: 10px; border: 1px solid rgba(126, 207, 255, .25); border-radius: 7px; background: #151d27; color: #e8edf5; font: inherit; }
      .dev-scene-travel-note { margin: 12px 0 18px; color: #8a95a8; font-size: 12px; line-height: 1.45; }
      .dev-scene-travel-actions { display: flex; justify-content: flex-end; gap: 9px; }
      .dev-scene-travel-actions button { padding: 8px 13px; border-radius: 7px; font-size: 13px; }
    `;
    document.head.append(style);
    return style;
  }
}

function formatSceneName(name: string): string {
  return name
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .replace(/^./, first => first.toUpperCase());
}
