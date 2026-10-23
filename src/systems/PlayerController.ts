import * as THREE from 'three';
import type { InputManager } from './InputManager.js';

const MOVE_SPEED = 5;         // m/s
const PLAYER_RADIUS = 0.3;    // collision radius (m)
const EYE_HEIGHT = 1.7;       // camera height above floor

/**
 * PlayerController — WASD movement, mouse-look, pointer lock, wall collision.
 *
 * Collision uses a simple swept-circle approach: after computing the desired
 * new XZ position we check each wall box and push the player out if needed.
 * Swap `wallBoxes` for a different room without changing this class.
 */
export class PlayerController {
  private camera: THREE.PerspectiveCamera;
  private input: InputManager;
  private canvas: HTMLCanvasElement;

  private yaw = 0;    // radians — left/right
  private pitch = 0;  // radians — up/down

  isLocked = false;

  /**
   * Set to false during cutscenes to freeze movement while still flushing
   * mouse deltas so they do not accumulate and snap the camera on resume.
   */
  enabled = true;

  // Populated by Room; each entry is [minX, maxX, minZ, maxZ]
  wallBoxes: Array<[number, number, number, number]> = [];

  private sensitivity = 0.002; // radians per pixel

  constructor(
    camera: THREE.PerspectiveCamera,
    input: InputManager,
    canvas: HTMLCanvasElement
  ) {
    this.camera = camera;
    this.input  = input;
    this.canvas = canvas;
    this.setupPointerLock();
  }

  // ─── Pointer lock ──────────────────────────────────────────────────────────

  private setupPointerLock() {
    this.canvas.addEventListener('click', this.requestLock);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', () => {
      console.warn('[PlayerController] Pointer lock request failed.');
    });
  }

  requestLock = () => {
    if (!this.isLocked) {
      this.canvas.requestPointerLock();
    }
  };

  exitLock() {
    if (this.isLocked) document.exitPointerLock();
  }

  private onLockChange = () => {
    this.isLocked = document.pointerLockElement === this.canvas;
  };

  // ─── Per-frame update ─────────────────────────────────────────────────────

  setSensitivity(value: number) {
    // value 1-100 → 0.0005 – 0.005
    this.sensitivity = 0.0005 + (value / 100) * 0.0045;
  }

  /** Teleport player to world-space position (Y is corrected to EYE_HEIGHT). */
  teleportTo(pos: THREE.Vector3) {
    this.camera.position.set(pos.x, EYE_HEIGHT, pos.z);
  }

  /**
   * Adopt a camera orientation that was set by a presentation system while
   * movement was frozen. Keeping the controller's yaw/pitch in step prevents
   * its next mouse-look update from snapping the view back to an old angle.
   */
  syncLookToCamera(): void {
    const orientation = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = orientation.y;
    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, orientation.x));
    this.input.flushMouse();
  }

  update(dt: number) {
    // Always flush mouse even when disabled — prevents delta accumulation.
    if (!this.isLocked || !this.enabled) {
      this.input.flushMouse();
      return;
    }

    // ── Mouse look ────────────────────────────────────────────────────────────
    this.yaw   -= this.input.mouseDX * this.sensitivity;
    this.pitch -= this.input.mouseDY * this.sensitivity;
    this.pitch  = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));
    this.input.flushMouse();

    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);

    // ── WASD movement ─────────────────────────────────────────────────────────
    const dir = new THREE.Vector3();
    if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp'))    dir.z -= 1;
    if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown'))  dir.z += 1;
    if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft'))  dir.x -= 1;
    if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) dir.x += 1;

    if (dir.lengthSq() > 0) {
      dir.normalize();
      // Transform direction by yaw only (no pitch for walking)
      const yawQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
      dir.applyQuaternion(yawQuat);

      const move = dir.multiplyScalar(MOVE_SPEED * dt);
      const newPos = this.camera.position.clone().add(move);
      newPos.y = EYE_HEIGHT; // lock to floor height

      // Collision resolution
      const resolved = this.resolveCollision(newPos);
      this.camera.position.copy(resolved);
    }
  }

  // ─── AABB sweep collision ─────────────────────────────────────────────────

  private resolveCollision(pos: THREE.Vector3): THREE.Vector3 {
    const p = pos.clone();
    for (const [minX, maxX, minZ, maxZ] of this.wallBoxes) {
      // Expand box by player radius for circle-vs-AABB
      const ex = PLAYER_RADIUS;
      const ez = PLAYER_RADIUS;
      const bMinX = minX - ex, bMaxX = maxX + ex;
      const bMinZ = minZ - ez, bMaxZ = maxZ + ez;

      if (p.x > bMinX && p.x < bMaxX && p.z > bMinZ && p.z < bMaxZ) {
        // Find shortest push-out axis
        const dLeft   = p.x - bMinX;
        const dRight  = bMaxX - p.x;
        const dFront  = p.z - bMinZ;
        const dBack   = bMaxZ - p.z;
        const minDist = Math.min(dLeft, dRight, dFront, dBack);

        if (minDist === dLeft)  p.x = bMinX;
        else if (minDist === dRight) p.x = bMaxX;
        else if (minDist === dFront) p.z = bMinZ;
        else                         p.z = bMaxZ;
      }
    }
    return p;
  }

  dispose() {
    this.canvas.removeEventListener('click', this.requestLock);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
}
