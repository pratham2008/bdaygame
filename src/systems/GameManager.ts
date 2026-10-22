import { GrayboxScene } from '../scenes/GrayboxScene.js';
import { AudioManager } from './AudioManager.js';
import { CutsceneDirector } from './CutsceneDirector.js';
import { Flashlight } from './Flashlight.js';
import { InputManager } from './InputManager.js';
import { InteractionSystem } from './InteractionSystem.js';
import { PauseMenu } from './PauseMenu.js';
import { PlayerController } from './PlayerController.js';
import { Renderer } from './Renderer.js';
import { SceneManager } from './SceneManager.js';

const IS_DEV = import.meta.env.DEV;

function createDevDemoKeyBinding(
  hasStarted: () => boolean,
  isPaused: () => boolean,
  isCutscenePlaying: () => boolean,
  cutscene: CutsceneDirector,
  camera: Renderer['camera'],
): AbortController {
  const abort = new AbortController();
  window.addEventListener('keydown', event => {
    if (
      event.code !== 'KeyC' ||
      event.repeat ||
      !hasStarted() ||
      isPaused() ||
      isCutscenePlaying()
    ) return;

    event.preventDefault();
    void import('./GrayboxCutsceneDemo.js').then(({ playGrayboxCutsceneDemo }) => {
      if (!isCutscenePlaying()) playGrayboxCutsceneDemo(cutscene, camera);
    });
  }, { signal: abort.signal });
  return abort;
}

/**
 * Long-lived game composition root. SceneManager owns replaceable world
 * geometry; these systems persist for the whole browser session.
 */
export class GameManager {
  readonly renderer: Renderer;
  readonly input: InputManager;
  readonly player: PlayerController;
  readonly flashlight: Flashlight;
  readonly interaction: InteractionSystem;
  readonly pauseMenu: PauseMenu;
  readonly audio: AudioManager;
  readonly sceneManager: SceneManager;
  readonly cutscene: CutsceneDirector;

  private animationFrame: number | null = null;
  private lastTime = performance.now();
  private started = false;
  private gameStarted = false;
  private devDemoAbort: AbortController | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputManager();
    this.player = new PlayerController(this.renderer.camera, this.input, canvas);
    this.flashlight = new Flashlight(this.renderer.camera, this.renderer.scene, this.input);
    this.interaction = new InteractionSystem(this.renderer.camera, [], this.input);
    this.pauseMenu = new PauseMenu();
    this.audio = new AudioManager(this.renderer.camera);
    this.cutscene = new CutsceneDirector(
      this.renderer.camera,
      this.player,
      this.interaction,
      this.pauseMenu,
      this.audio,
    );
    this.sceneManager = new SceneManager(
      this.renderer.scene,
      this.player,
      this.interaction,
      this.flashlight,
    );
    this.sceneManager.register('graybox', () => new GrayboxScene());

    this.configureStartOverlay();
    this.configurePauseMenu();
    if (IS_DEV) {
      this.devDemoAbort = createDevDemoKeyBinding(
        () => this.gameStarted,
        () => this.pauseMenu.isPaused(),
        () => this.cutscene.isPlaying,
        this.cutscene,
        this.renderer.camera,
      );
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.sceneManager.loadScene('graybox');
    this.lastTime = performance.now();
    this.animationFrame = requestAnimationFrame(this.gameLoop);
  }

  dispose(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.cutscene.stop();
    this.sceneManager.dispose();
    this.pauseMenu.dispose();
    this.player.dispose();
    this.input.dispose();
    this.renderer.dispose();
    this.devDemoAbort?.abort();
  }

  private configureStartOverlay(): void {
    const startOverlay = document.getElementById('start-overlay')!;
    const startButton = document.getElementById('start-btn')!;

    startButton.addEventListener('click', () => {
      startOverlay.classList.add('hidden');
      this.pauseMenu.markGameStarted();
      this.gameStarted = true;
      this.audio.setMasterVolume(this.pauseMenu.volume / 100);

      // init() creates its node graph synchronously before it returns its
      // promise. Do not await it here: pointer lock must remain in the click's
      // user-activation turn as well.
      void this.audio.init().catch(error => {
        console.warn('[AudioManager] Initialisation failed; continuing silently.', error);
      });
      this.audio.playTestTone(440, 0.5);
      this.player.requestLock();
    });
  }

  private configurePauseMenu(): void {
    this.pauseMenu.onPause = () => this.player.exitLock();
    this.pauseMenu.onResume = () => this.player.requestLock();
  }

  private gameLoop = (now: number): void => {
    this.animationFrame = requestAnimationFrame(this.gameLoop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.player.setSensitivity(this.pauseMenu.sensitivity);
    this.audio.setMasterVolume(this.pauseMenu.volume / 100);

    if (!this.pauseMenu.isPaused()) {
      this.player.update(dt);
      if (!this.cutscene.isPlaying) {
        this.flashlight.update();
        this.interaction.update(this.player.isLocked);
      }
      this.cutscene.update(dt);
      this.sceneManager.update(dt);
      this.audio.update();
    }

    this.renderer.render();
  };

}
