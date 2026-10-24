import * as THREE from 'three';
import type { Flashlight } from './Flashlight.js';
import type { InteractionSystem } from './InteractionSystem.js';
import type { PlayerController } from './PlayerController.js';
import {
  makeDefaultGameState,
  type GameState,
  type IScene,
  type SceneName,
  type SceneResult,
} from '../scenes/types.js';

export type SceneFactory = () => IScene;

export interface SceneRegistrationOptions {
  /**
   * Resets only this scene's persistent debug-entry state immediately before
   * its normal lifecycle begins. Omit it when build() already has a safe
   * default entry state.
   */
  prepareDebugEntry?: (state: GameState) => void;
}

/**
 * Owns playable-scene lifecycle and the persistent game state.
 *
 * It intentionally never clears the Three.js scene: camera, flashlight, and
 * renderer-owned objects live for the whole game. Each IScene removes only
 * resources it created from its own dispose() implementation.
 */
export class SceneManager {
  private readonly scene: THREE.Scene;
  private readonly player: PlayerController;
  private readonly interaction: InteractionSystem;
  private readonly flashlight: Flashlight;
  private readonly sceneFactories = new Map<SceneName, SceneFactory>();
  private readonly sceneRegistrations = new Map<SceneName, SceneRegistrationOptions>();
  private readonly state: GameState;
  private activeScene: IScene | null = null;
  private transition = Promise.resolve();

  constructor(
    scene: THREE.Scene,
    player: PlayerController,
    interaction: InteractionSystem,
    flashlight: Flashlight,
    initialState: GameState = makeDefaultGameState(),
  ) {
    this.scene = scene;
    this.player = player;
    this.interaction = interaction;
    this.flashlight = flashlight;
    this.state = initialState;
  }

  /** The scene requested most recently, including before the first build. */
  get currentScene(): SceneName {
    return this.state.currentScene;
  }

  register(name: SceneName, factory: SceneFactory, options: SceneRegistrationOptions = {}): void {
    this.sceneFactories.set(name, factory);
    this.sceneRegistrations.set(name, options);
  }

  /** Implemented scenes, in registration order, for development tooling. */
  getRegisteredSceneNames(): readonly SceneName[] {
    return [...this.sceneFactories.keys()];
  }

  /**
   * Queue a scene replacement. Queuing keeps two independent callers from
   * disposing/building scenes over one another during future cutscenes.
   */
  loadScene(name: SceneName): Promise<void> {
    return this.queueSceneLoad(name, false);
  }

  /**
   * Development entry point. It still performs the regular replacement
   * lifecycle; a registered scene may only reset its own documented entry
   * state before build() runs.
   */
  loadDebugScene(name: SceneName): Promise<void> {
    return this.queueSceneLoad(name, true);
  }

  private queueSceneLoad(name: SceneName, debugEntry: boolean): Promise<void> {
    const factory = this.sceneFactories.get(name);
    if (!factory) {
      return Promise.reject(new Error(`[SceneManager] No scene registered for "${name}".`));
    }

    const nextTransition = this.transition.then(() => {
      if (debugEntry) this.sceneRegistrations.get(name)?.prepareDebugEntry?.(this.state);
      this.replaceScene(name, factory);
    });
    // Keep the queue usable if a caller handles a failed transition.
    this.transition = nextTransition.catch(() => undefined);
    return nextTransition;
  }

  update(dt: number): void {
    this.activeScene?.update(dt, this.state);
  }

  /** Returns the one persistent state object shared by every scene. */
  getState(): GameState {
    return this.state;
  }

  dispose(): void {
    // Clear system references before a scene clears its own backing arrays.
    this.player.wallBoxes = [];
    this.interaction.setInteractables([]);
    this.activeScene?.dispose(this.scene);
    this.activeScene = null;
  }

  private replaceScene(name: SceneName, factory: SceneFactory): void {
    const nextScene = factory();
    if (nextScene.name !== name) {
      throw new Error(`[SceneManager] Factory for "${name}" returned "${nextScene.name}".`);
    }

    // Prevent one last game-loop frame from referencing disposed room data.
    this.player.wallBoxes = [];
    this.interaction.setInteractables([]);

    this.state.flashlightWasOn = this.flashlight.isOn();
    this.activeScene?.dispose(this.scene);
    this.activeScene = null;

    const previousSceneName = this.state.currentScene;
    this.state.currentScene = name;

    let result: SceneResult;
    try {
      result = nextScene.build(this.scene, this.state);
    } catch (error) {
      // A failed build may already have allocated geometry. Let its matching
      // disposer clean that partial result and leave systems with no stale data.
      this.player.wallBoxes = [];
      this.interaction.setInteractables([]);
      nextScene.dispose(this.scene);
      this.state.currentScene = previousSceneName;
      throw error;
    }
    this.activeScene = nextScene;

    this.player.teleportTo(result.spawnPoint);
    this.player.wallBoxes = result.wallBoxes;
    this.interaction.setInteractables(result.interactables);
  }
}
