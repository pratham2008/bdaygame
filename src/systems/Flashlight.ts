import * as THREE from 'three';
import type { InputManager } from './InputManager.js';

/**
 * Flashlight — a SpotLight attached to the camera.
 * Toggle with F key.  Swap parameters here without touching PlayerController.
 */
export class Flashlight {
  private camera: THREE.PerspectiveCamera;
  private input: InputManager;
  private light: THREE.SpotLight;
  private on = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    input: InputManager
  ) {
    this.camera = camera;
    this.input  = input;

    this.light = new THREE.SpotLight(0xfff5e0, 0, 14, Math.PI * 0.17, 0.35, 1.8);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.1;
    this.light.shadow.camera.far  = 15;

    // Target follows camera; attach both to camera so they move together
    this.camera.add(this.light);
    this.camera.add(this.light.target);
    this.light.position.set(0.15, -0.15, -0.1); // slight offset (hand position)
    this.light.target.position.set(0, 0, -1);    // aim forward

    scene.add(this.camera); // ensure camera is in scene for child transforms
  }

  private fKeyWasDown = false;

  update() {
    const fDown = this.input.isDown('KeyF');
    if (fDown && !this.fKeyWasDown) {
      this.toggle();
    }
    this.fKeyWasDown = fDown;
  }

  toggle() {
    this.on = !this.on;
    this.light.intensity = this.on ? 2.2 : 0;
  }

  isOn() { return this.on; }
}
