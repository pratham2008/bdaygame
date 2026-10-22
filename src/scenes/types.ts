import type * as THREE from 'three';

// ─── Scene name registry ─────────────────────────────────────────────────────

/**
 * Every playable scene in the game.
 * 'graybox' and 'test' are P1 dev scenes; story scenes are added in later phases.
 */
export type SceneName =
  | 'graybox'
  | 'test'
  | 'prologue'
  | 'world1'
  | 'world2'
  | 'world3'
  | 'world4'
  | 'jail'
  | 'roadside'
  | 'countdown'
  | 'birthdayReveal'
  | 'birthdayRoom';

// ─── Scene contract ───────────────────────────────────────────────────────────

/**
 * What a scene returns from build().
 * SceneManager uses this to update player collision and interactable lists.
 */
export interface SceneResult {
  /** AABB tuples [minX, maxX, minZ, maxZ] in world space. */
  wallBoxes: Array<[number, number, number, number]>;
  /** Meshes with userData.interactable = true for InteractionSystem. */
  interactables: THREE.Mesh[];
  /** Where the player camera is placed after the scene loads. */
  spawnPoint: THREE.Vector3;
}

/**
 * IScene — the contract every playable scene must implement.
 *
 * Lifecycle:
 *   1. build()   — called once. Adds geometry/lights to scene. Returns SceneResult.
 *   2. update()  — called every frame while this scene is active.
 *   3. dispose() — called before the next scene loads. Must remove and .dispose()
 *                  every geometry, material, and object this scene added.
 *
 * Rule: a scene must NEVER call scene.clear().
 * Rule: a scene must ONLY remove objects it personally added in build().
 * Rule: the camera, flashlight, and shared gameplay systems are NOT owned by any scene.
 */
export interface IScene {
  readonly name: SceneName;
  build(scene: THREE.Scene, state: Readonly<GameState>): SceneResult;
  update(dt: number, state: GameState): void;
  dispose(scene: THREE.Scene): void;
}

// ─── Persistent game state ────────────────────────────────────────────────────

/**
 * GameState persists across ALL scene transitions.
 * SceneManager is the single owner; scenes may read and write it.
 */
export interface GameState {
  currentScene: SceneName;

  // World 1 — repeating loop
  world1LoopCount: number;

  // Roadside — two-phase escalation
  roadsidePhase:  0 | 1 | 2;   // 0=not started, 1=died once, 2=fought back
  roadsideDeaths: number;

  // Countdown — Oct 25–30
  countdownDay:              number; // 0=Oct25 … 5=Oct30
  countdownAnomaliesFound:   number;

  // Preserved across transitions
  flashlightWasOn: boolean;
}

/** Returns a fresh default state for a new game. */
export function makeDefaultGameState(): GameState {
  return {
    currentScene:            'graybox',
    world1LoopCount:         0,
    roadsidePhase:           0,
    roadsideDeaths:          0,
    countdownDay:            0,
    countdownAnomaliesFound: 0,
    flashlightWasOn:         false,
  };
}
