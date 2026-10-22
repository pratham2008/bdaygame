import * as THREE from 'three';
import { Room } from '../systems/Room.js';
import type { IScene, GameState, SceneResult, SceneName } from './types.js';

/**
 * GrayboxScene — the original test room, now wrapped in the IScene lifecycle.
 *
 * Delegates all geometry to Room.ts. dispose() calls Room.dispose(),
 * which removes the group and frees every geometry and material Room created.
 * Nothing calls scene.clear().
 */
export class GrayboxScene implements IScene {
  readonly name: SceneName = 'graybox';

  private room: Room | null = null;

  build(scene: THREE.Scene, _state: Readonly<GameState>): SceneResult {
    this.room = new Room(scene);
    return {
      wallBoxes:    this.room.wallBoxes,
      interactables: this.room.interactables,
      spawnPoint:   new THREE.Vector3(0, 0, 0), // centre of the graybox
    };
  }

  // GrayboxScene has no per-frame logic — the room is static.
  update(_dt: number, _state: GameState): void {}

  dispose(scene: THREE.Scene): void {
    this.room?.dispose(scene);
    this.room = null;
  }
}
