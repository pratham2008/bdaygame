import * as THREE from 'three';
import type { InputManager } from './InputManager.js';

const MAX_INTERACT_DIST = 2.8; // metres

/**
 * InteractionSystem — raycasts each frame from camera centre.
 * Any mesh with `userData.interactable = true` becomes targetable.
 * When targeted, a prompt appears; pressing E calls `userData.onInteract()`.
 *
 * To add a new interactable, just set these on the mesh before passing it in:
 *   mesh.userData.interactable = true
 *   mesh.userData.promptText   = 'Open door'
 *   mesh.userData.onInteract   = () => { ... }
 */
export class InteractionSystem {
  private camera: THREE.PerspectiveCamera;
  private interactables: THREE.Mesh[];
  private input: InputManager;

  private raycaster = new THREE.Raycaster();
  private center    = new THREE.Vector2(0, 0); // NDC centre

  private prompt:     HTMLElement;
  private promptText: HTMLElement;

  private currentTarget: THREE.Mesh | null = null;
  private eKeyWasDown = false;

  /**
   * Set to false during cutscenes so no interaction prompts appear and
   * the E key does not fire callbacks while the player is frozen.
   */
  enabled = true;

  constructor(
    camera: THREE.PerspectiveCamera,
    interactables: THREE.Mesh[],
    input: InputManager
  ) {
    this.camera       = camera;
    this.interactables = interactables;
    this.input        = input;

    this.prompt     = document.getElementById('interaction-prompt')!;
    this.promptText = document.getElementById('prompt-text')!;
  }

  /** Replace the interactable list when loading a new scene. */
  setInteractables(list: THREE.Mesh[]) {
    this.interactables = list;
    this.setTarget(null);
  }

  update(isLocked: boolean) {
    if (!isLocked || !this.enabled) {
      this.setTarget(null);
      return;
    }

    this.raycaster.setFromCamera(this.center, this.camera);

    // Only test interactable meshes, filter out invisible ones
    const visible = this.interactables.filter(m => m.visible);
    const hits    = this.raycaster.intersectObjects(visible, false);

    const hit = hits.find(h => h.distance <= MAX_INTERACT_DIST);
    const target = hit ? (hit.object as THREE.Mesh) : null;

    this.setTarget(target);

    // E-key — fire once per press
    const eDown = this.input.isDown('KeyE');
    if (eDown && !this.eKeyWasDown && this.currentTarget) {
      const cb = this.currentTarget.userData.onInteract as (() => void) | undefined;
      cb?.();
    }
    this.eKeyWasDown = eDown;
  }

  private setTarget(mesh: THREE.Mesh | null) {
    this.currentTarget = mesh;
    if (mesh) {
      const text = (mesh.userData.promptText as string | undefined) ?? 'Interact';
      this.promptText.textContent = text;
      this.prompt.classList.remove('hidden');
    } else {
      this.prompt.classList.add('hidden');
    }
  }
}
