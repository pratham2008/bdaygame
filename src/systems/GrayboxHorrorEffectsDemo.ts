import * as THREE from 'three';
import {
  apparitionAt,
  flickerLight,
  mirrorDesync,
  moveWhenNotLooking,
  startFootstepLoop,
  type EffectHandle,
  type FootstepLoopHandle,
  type MirrorDesyncHandle,
} from './HorrorEffects.js';
import type { AudioManager } from './AudioManager.js';

/** Development-only, self-owned fixture for exercising P4 effects in graybox. */
export class GrayboxHorrorEffectsDemo {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly audio: AudioManager;
  private readonly group = new THREE.Group();
  private readonly label: HTMLDivElement;
  private readonly apparition: THREE.Mesh;
  private readonly flicker: THREE.PointLight;
  private readonly mover: THREE.Mesh;
  private readonly reflection: THREE.Mesh;
  private readonly moveTarget = new THREE.Vector3(-2.2, 0.8, -3.8);
  private readonly reflectionHome = new THREE.Vector3(-2.2, 0.85, -4.3);

  private apparitionHandle: EffectHandle | null = null;
  private flickerHandle: EffectHandle | null = null;
  private footstepHandle: FootstepLoopHandle | null = null;
  private mirrorHandle: MirrorDesyncHandle | null = null;
  private moveArmed = false;
  private mirrorHasAppliedDelay = false;
  private footstepTicks = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera, audio: AudioManager) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.group.name = 'dev:horror-effects-demo';
    this.scene.add(this.group);

    this.apparition = this.addBox(0.55, 1.9, 0.24, 0x421016, new THREE.Vector3(0, 0.95, -3.3));
    this.apparition.name = 'dev:apparition';
    this.apparition.visible = false;
    const eyes = this.addBox(0.24, 0.06, 0.03, 0xff2020, new THREE.Vector3(0, 1.45, -3.16), true);
    eyes.name = 'dev:apparition-eyes';
    eyes.visible = false;
    this.apparition.add(eyes);
    eyes.position.set(0, 0.5, 0.14);

    this.mover = this.addBox(0.4, 0.4, 0.4, 0xdf9b47, new THREE.Vector3(2.2, 0.8, -3.8));
    this.mover.name = 'dev:look-away-mover';
    this.reflection = this.addBox(0.38, 1.25, 0.25, 0x78b7cc, this.reflectionHome);
    this.reflection.name = 'dev:mirror-reflection';
    const reflectionMaterial = this.reflection.material as THREE.MeshStandardMaterial;
    reflectionMaterial.emissive.setHex(0x102c40);
    reflectionMaterial.roughness = 0.15;
    reflectionMaterial.metalness = 0.8;
    reflectionMaterial.side = THREE.DoubleSide;

    const lamp = this.addBox(0.22, 0.22, 0.22, 0x99bbff, new THREE.Vector3(-2.8, 2.1, -2.8), true);
    lamp.name = 'dev:flicker-lamp';
    this.flicker = new THREE.PointLight(0x99bbff, 1, 5, 2);
    this.flicker.position.copy(lamp.position);
    this.group.add(this.flicker);

    this.label = document.createElement('div');
    this.label.style.cssText = [
      'position:fixed', 'top:80px', 'left:20px', 'z-index:175',
      'max-width:430px', 'padding:8px 12px', 'border:1px solid rgba(200,105,105,.45)',
      'border-radius:7px', 'background:rgba(18,7,10,.82)', 'color:#ffe4e4',
      'font:12px/1.45 system-ui,sans-serif', 'pointer-events:none',
    ].join(';');
    document.body.append(this.label);
    this.setStatus('Ready — 1 apparition · 2 flicker · 3 move away · 4 mirror desync · 5 footsteps · X cancel · H close');
  }

  triggerApparition(): void {
    this.apparitionHandle?.dispose();
    const eyes = this.apparition.getObjectByName('dev:apparition-eyes');
    if (eyes) eyes.visible = true;
    this.apparitionHandle = apparitionAt(this.scene, this.apparition, new THREE.Vector3(0, 0.95, -3.3), 1.2);
    this.setStatus('Apparition active for 1.2 seconds. It will hide automatically.');
  }

  triggerFlicker(): void {
    this.flickerHandle?.cancel();
    this.flickerHandle = flickerLight(this.flicker, 2.5, 0.05, 2.4);
    this.setStatus('Light flickering for 2.5 seconds, then restoring its original intensity.');
  }

  triggerMoveWhenNotLooking(): void {
    this.mover.position.set(2.2, 0.8, -3.8);
    this.moveArmed = true;
    this.setStatus('Orange cube armed. Look away from it, then look back to find it moving left.');
  }

  triggerMirrorDesync(): void {
    this.mirrorHandle?.dispose();
    this.reflection.position.copy(this.reflectionHome);
    this.reflection.quaternion.identity();
    this.mirrorHasAppliedDelay = false;
    const sourceStart = this.camera.getWorldPosition(new THREE.Vector3());
    this.mirrorHandle = mirrorDesync(this.camera, this.reflection, {
      lagFrames: 30,
      mapPosition: (delayedPosition, output) => {
        const delta = delayedPosition.clone().sub(sourceStart);
        output.set(
          this.reflectionHome.x - clamp(delta.x, 0.7),
          this.reflectionHome.y,
          this.reflectionHome.z + clamp(delta.z, 0.45),
        );
        return output;
      },
    });
    this.setStatus('Blue reflection active: it remains in its display area and follows camera position/rotation 30 updates late.');
  }

  toggleFootsteps(): void {
    if (this.footstepHandle) {
      this.stopFootsteps('manual toggle');
      return;
    }

    this.footstepTicks = 0;
    this.footstepHandle = startFootstepLoop({
      playSFX: () => {
        this.footstepTicks += 1;
        // This is deliberately an oscillator proof only, not a real footstep asset.
        return this.audio.playTestTone(130, 0.05) ?? undefined;
      },
    }, this.camera, 0.45, 'dev:oscillator-footstep');
    this.setStatus('Footstep scheduler running: dev oscillator ticks only; no external footstep asset is loaded.');
  }

  cancelAll(): void {
    this.apparitionHandle?.cancel();
    this.apparitionHandle = null;
    this.flickerHandle?.cancel();
    this.flickerHandle = null;
    this.stopFootsteps('effects cancelled');
    this.moveArmed = false;
    this.mirrorHandle?.dispose();
    this.mirrorHandle = null;
    this.mirrorHasAppliedDelay = false;
    this.reflection.position.copy(this.reflectionHome);
    this.reflection.quaternion.identity();
    this.apparition.visible = false;
    this.setStatus('All P4 effects cancelled; fixtures remain for another isolated test.');
  }

  /** Called by the existing game lifecycle; it never restarts the loop. */
  stopFootsteps(reason: string): void {
    if (!this.footstepHandle) return;
    this.footstepHandle.stop();
    this.footstepHandle = null;
    this.setStatus(`Footstep loop stopped (${reason}) after ${this.footstepTicks} scheduled ticks.`);
  }

  update(): void {
    if (this.moveArmed && moveWhenNotLooking(this.camera, this.mover, this.moveTarget, 0.35, { lerpFactor: 0.08 })) {
      if (this.mover.position.distanceTo(this.moveTarget) < 0.03) {
        this.moveArmed = false;
        this.setStatus('Orange cube reached its target while unobserved.');
      }
    }

    if (this.mirrorHandle?.update() && !this.mirrorHasAppliedDelay) {
      this.mirrorHasAppliedDelay = true;
      this.setStatus('Blue reflection is now visibly applying delayed player transforms while remaining in its display area.');
    }
  }

  dispose(): void {
    this.cancelAll();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.scene.remove(this.group);
    this.label.remove();
  }

  private addBox(
    width: number,
    height: number,
    depth: number,
    color: THREE.ColorRepresentation,
    position: THREE.Vector3,
    emissive = false,
  ): THREE.Mesh {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: emissive ? color : 0x000000,
      emissiveIntensity: emissive ? 0.4 : 0,
      roughness: 0.65,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.copy(position);
    this.group.add(mesh);
    return mesh;
  }

  private setStatus(message: string): void {
    this.label.textContent = `Horror effects demo — ${message}`;
  }
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
