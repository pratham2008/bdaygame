import * as THREE from 'three';
import { GrayboxScene } from '../scenes/GrayboxScene.js';
import { PrologueScene } from '../scenes/PrologueScene.js';
import { World1Scene } from '../scenes/World1Scene.js';
import { AudioManager } from './AudioManager.js';
import { CutsceneDirector } from './CutsceneDirector.js';
import { Flashlight } from './Flashlight.js';
import { InputManager } from './InputManager.js';
import { InteractionSystem } from './InteractionSystem.js';
import { PauseMenu } from './PauseMenu.js';
import { PlayerController } from './PlayerController.js';
import { Renderer } from './Renderer.js';
import { SceneManager } from './SceneManager.js';
import type { GrayboxCharacterPreview } from './GrayboxCharacterPreview.js';
import type { GrayboxHorrorEffectsDemo } from './GrayboxHorrorEffectsDemo.js';

const IS_DEV = import.meta.env.DEV;

interface DevBindings {
  update(): void;
  pause(): void;
  dispose(): void;
}

function createDevKeyBindings(
  hasStarted: () => boolean,
  isPaused: () => boolean,
  isCutscenePlaying: () => boolean,
  cutscene: CutsceneDirector,
  camera: Renderer['camera'],
  scene: THREE.Scene,
  audio: AudioManager,
): DevBindings {
  const abort = new AbortController();
  let preview: GrayboxCharacterPreview | null = null;
  let horrorDemo: GrayboxHorrorEffectsDemo | null = null;
  let horrorDemoLoading = false;
  const stopTestFootsteps = (reason: string): void => horrorDemo?.stopFootsteps(reason);
  window.addEventListener('blur', () => stopTestFootsteps('window lost focus'), { signal: abort.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTestFootsteps('document hidden');
  }, { signal: abort.signal });
  window.addEventListener('keydown', event => {
    if (event.repeat || !hasStarted() || isPaused() || isCutscenePlaying()) return;

    if (event.code === 'KeyC') {
      event.preventDefault();
      void import('./GrayboxCutsceneDemo.js').then(({ playGrayboxCutsceneDemo }) => {
        if (!isCutscenePlaying()) playGrayboxCutsceneDemo(cutscene, camera);
      });
    } else if (event.code === 'KeyV') {
      event.preventDefault();
      void import('./GrayboxCharacterPreview.js').then(({ GrayboxCharacterPreview: Preview }) => {
        if (!preview) preview = new Preview(scene);
        else preview.toggle();
      });
    } else if (event.code === 'KeyN' && preview) {
      event.preventDefault();
      preview.next();
    } else if (event.code === 'KeyB' && preview) {
      event.preventDefault();
      preview.previous();
    } else if (event.code === 'KeyH') {
      event.preventDefault();
      if (horrorDemo) {
        horrorDemo.dispose();
        horrorDemo = null;
      } else if (!horrorDemoLoading) {
        horrorDemoLoading = true;
        void import('./GrayboxHorrorEffectsDemo.js').then(({ GrayboxHorrorEffectsDemo: Demo }) => {
          horrorDemo = new Demo(scene, camera, audio);
        }).finally(() => {
          horrorDemoLoading = false;
        });
      }
    } else if (horrorDemo) {
      if (event.code === 'Digit1') horrorDemo.triggerApparition();
      else if (event.code === 'Digit2') horrorDemo.triggerFlicker();
      else if (event.code === 'Digit3') horrorDemo.triggerMoveWhenNotLooking();
      else if (event.code === 'Digit4') horrorDemo.triggerMirrorDesync();
      else if (event.code === 'Digit5') horrorDemo.toggleFootsteps();
      else if (event.code === 'KeyX') horrorDemo.cancelAll();
      else return;
      event.preventDefault();
    }
  }, { signal: abort.signal });
  return {
    update(): void {
      horrorDemo?.update();
    },
    pause(): void {
      stopTestFootsteps('game paused');
    },
    dispose(): void {
      abort.abort();
      preview?.dispose();
      preview = null;
      horrorDemo?.dispose();
      horrorDemo = null;
    },
  };
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
  private devBindings: DevBindings | null = null;
  private startPrologue: (() => void) | null = null;

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
    this.sceneManager.register('prologue', () => new PrologueScene({
      cutscene: this.cutscene,
      onOpeningReady: start => { this.startPrologue = start; },
      onOpeningComplete: () => this.player.requestLock(),
      onWorld1Requested: () => { void this.sceneManager.loadScene('world1'); },
    }));
    this.sceneManager.register('world1', () => new World1Scene({
      audio: this.audio,
      camera: this.renderer.camera,
      cutscene: this.cutscene,
      reloadOutpost: () => { void this.sceneManager.loadScene('world1'); },
    }));

    this.configureStartOverlay();
    this.configurePauseMenu();
    if (IS_DEV) {
      this.devBindings = createDevKeyBindings(
        () => this.gameStarted,
        () => this.pauseMenu.isPaused(),
        () => this.cutscene.isPlaying,
        this.cutscene,
        this.renderer.camera,
        this.renderer.scene,
        this.audio,
      );
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.sceneManager.loadScene('prologue');
    this.lastTime = performance.now();
    this.animationFrame = requestAnimationFrame(this.gameLoop);
  }

  dispose(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.cutscene.stop();
    this.devBindings?.dispose();
    this.devBindings = null;
    this.sceneManager.dispose();
    this.pauseMenu.dispose();
    this.player.dispose();
    this.input.dispose();
    this.renderer.dispose();
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
      if (this.startPrologue) {
        // Suppress intentional pointer-lock loss before requesting it. Browser
        // pointer-lock changes are asynchronous; doing this in the opposite
        // order can briefly auto-pause the opening cutscene.
        this.startPrologue();
      }
      this.player.requestLock();
    });
  }

  private configurePauseMenu(): void {
    this.pauseMenu.onPause = () => {
      this.player.exitLock();
      this.devBindings?.pause();
    };
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
      this.devBindings?.update();
      this.audio.update();
    }

    this.renderer.render();
  };

}
