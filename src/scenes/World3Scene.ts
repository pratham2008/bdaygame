import * as THREE from 'three';
import { CharacterBuilder } from '../systems/CharacterBuilder.js';
import type { AudioManager } from '../systems/AudioManager.js';
import type { CutsceneDirector, CutsceneStep } from '../systems/CutsceneDirector.js';
import { apparitionAt, flickerLight, type EffectHandle } from '../systems/HorrorEffects.js';
import type { GameState, IScene, SceneName, SceneResult } from './types.js';

interface World3Dependencies {
  readonly audio: AudioManager;
  readonly camera: THREE.PerspectiveCamera;
  readonly cutscene: CutsceneDirector;
}

const BANGLE_URL = '/audio/bangle.mp3';

/**
 * World 3 is deliberately small and legible: each room has one route forward
 * and the mirror puzzle advances through visible, authored inconsistencies.
 */
export class World3Scene implements IScene {
  readonly name: SceneName = 'world3';

  private readonly audio: AudioManager;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cutscene: CutsceneDirector;
  private readonly group = new THREE.Group();
  private readonly interactables: THREE.Mesh[] = [];
  private readonly wallBoxes: Array<[number, number, number, number]> = [];

  private previousFog: THREE.Fog | THREE.FogExp2 | null = null;
  private previousBackground: THREE.Color | THREE.Texture | null = null;
  private v3: THREE.Group | null = null;
  private playerDouble: THREE.Group | null = null;
  private finalMirror: THREE.Mesh | null = null;
  private finalMirrorBacking: THREE.Mesh | null = null;
  private finalParticles: THREE.Points | null = null;
  private bathroomLight: THREE.PointLight | null = null;
  private exitDoor: THREE.Mesh | null = null;
  private apparition: EffectHandle | null = null;
  private bathroomFlicker: EffectHandle | null = null;
  private anomalyMeshes: THREE.Mesh[] = [];

  private built = false;
  private disposed = false;
  private sceneCutsceneActive = false;
  private firstV3Shown = false;
  private secondV3Shown = false;
  private currentAnomaly = -1;
  private identified = [false, false, false];
  private puzzleStarted = false;
  private finalSequenceStarted = false;
  private finalComplete = false;
  private particleAge = 0;
  private doubleStepProgress = 0;
  private apparitionVisibleAt = 0;

  constructor(dependencies: World3Dependencies) {
    this.audio = dependencies.audio;
    this.camera = dependencies.camera;
    this.cutscene = dependencies.cutscene;
  }

  build(scene: THREE.Scene, _state: Readonly<GameState>): SceneResult {
    this.built = true;
    this.disposed = false;
    this.group.name = 'scene:world3-house-that-sees-you';
    this.previousFog = scene.fog;
    this.previousBackground = scene.background;
    scene.fog = new THREE.Fog(0x080a0d, 3.5, 25);
    scene.background = new THREE.Color(0x07090b);
    scene.add(this.group);

    this.buildHouse();
    this.addCharacters();
    return {
      wallBoxes: this.wallBoxes,
      interactables: this.interactables,
      spawnPoint: new THREE.Vector3(0, 0, 6.65),
    };
  }

  update(dt: number, _state: GameState): void {
    if (!this.built || this.disposed) return;
    this.updateMirrorPuzzle(dt);
    this.updateV3Sightlines();
    this.updateParticles(dt);
  }

  dispose(scene: THREE.Scene): void {
    this.disposed = true;
    this.apparition?.cancel();
    this.apparition = null;
    this.bathroomFlicker?.cancel();
    this.bathroomFlicker = null;
    if (this.sceneCutsceneActive || this.cutscene.isPlaying) this.cutscene.stop();
    this.sceneCutsceneActive = false;

    for (const character of [this.v3, this.playerDouble]) {
      if (character) CharacterBuilder.dispose(character);
    }
    this.v3 = null;
    this.playerDouble = null;

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      const resource = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (resource.geometry) geometries.add(resource.geometry);
      for (const material of resource.material ? (Array.isArray(resource.material) ? resource.material : [resource.material]) : []) {
        materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    scene.remove(this.group);
    scene.fog = this.previousFog;
    scene.background = this.previousBackground;

    this.interactables.length = 0;
    this.wallBoxes.length = 0;
    this.anomalyMeshes = [];
    this.finalMirror = null;
    this.finalMirrorBacking = null;
    this.finalParticles = null;
    this.bathroomLight = null;
    this.exitDoor = null;
    this.built = false;
  }

  private buildHouse(): void {
    const floor = this.standard(0x262328, 0.9);
    const wall = this.standard(0x3c3639, 0.96);
    const trim = this.standard(0x17191d, 0.65, 0.2);
    const wood = this.standard(0x4a3630, 0.82);
    const damp = this.standard(0x29353a, 0.78, 0.08);

    this.addRoomFloor(4.1, 7.9, 0, 3.95, floor);       // entrance hall
    this.addRoomFloor(6.7, 5, 0, -2.5, floor);         // sitting room
    this.addRoomFloor(2.4, 5, 0, -7.5, damp);          // narrow corridor
    this.addRoomFloor(4.1, 4, 0, -12, damp);           // bathroom
    this.addRoomFloor(5.1, 5, 0, -16.5, floor);        // dead-end mirror room

    this.addShellWalls(wall, trim);
    this.addEntranceDetails(wood, trim);
    this.addSittingRoom(wood, trim);
    this.addCorridor(trim);
    this.addBathroom(damp, trim);
    this.addDeadEndRoom(wood, trim);
    this.addLighting();
  }

  private addShellWalls(wall: THREE.Material, trim: THREE.Material): void {
    const h = 3.2;
    const t = 0.18;
    // Hallway shell and front-door threshold.
    this.addWall(t, h, 7.9, -2.05, h / 2, 3.95, wall);
    this.addWall(t, h, 7.9, 2.05, h / 2, 3.95, wall);
    this.addWall(1.2, h, t, -1.45, h / 2, 7.85, wall);
    this.addWall(1.2, h, t, 1.45, h / 2, 7.85, wall);
    this.addDoorHeader(0, 2.8, 7.85, 1.65, trim);

    // Sitting room shell.
    this.addWall(t, h, 5, -3.35, h / 2, -2.5, wall);
    this.addWall(t, h, 5, 3.35, h / 2, -2.5, wall);
    // Narrow corridor shell.
    this.addWall(t, h, 5, -1.2, h / 2, -7.5, wall);
    this.addWall(t, h, 5, 1.2, h / 2, -7.5, wall);
    // Bathroom and final room shell.
    this.addWall(t, h, 4, -2.05, h / 2, -12, wall);
    this.addWall(t, h, 4, 2.05, h / 2, -12, wall);
    this.addWall(t, h, 5, -2.55, h / 2, -16.5, wall);
    this.addWall(t, h, 5, 2.55, h / 2, -16.5, wall);
    this.addWall(5.1, h, t, 0, h / 2, -19.0, wall);

    // Connected door walls; each gap is wide enough for the player's radius.
    this.addWall(1.25, h, t, -1.43, h / 2, 0, wall);
    this.addWall(1.25, h, t, 1.43, h / 2, 0, wall);
    this.addDoorHeader(0, 2.78, 0, 1.65, trim);
    this.addWall(2.5, h, t, -2.1, h / 2, -5, wall);
    this.addWall(2.5, h, t, 2.1, h / 2, -5, wall);
    this.addDoorHeader(0, 2.78, -5, 1.78, trim);
    this.addWall(1.22, h, t, -1.43, h / 2, -10, wall);
    this.addWall(1.22, h, t, 1.43, h / 2, -10, wall);
    this.addDoorHeader(0, 2.78, -10, 1.7, trim);
    this.addWall(1.45, h, t, -1.3, h / 2, -14, wall);
    this.addWall(1.45, h, t, 1.3, h / 2, -14, wall);
    this.addDoorHeader(0, 2.78, -14, 2.1, trim);
  }

  private addEntranceDetails(wood: THREE.Material, trim: THREE.Material): void {
    this.addBox(0.9, 0.84, 0.35, -1.32, 0.42, 5.6, wood, true);
    this.addBox(0.66, 1.2, 0.12, 1.7, 0.6, 4.7, trim, true);
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.72), new THREE.MeshBasicMaterial({ color: 0x101015 }));
    portrait.position.set(1.63, 1.74, 4.7);
    portrait.rotation.y = -Math.PI / 2;
    this.group.add(portrait);
    this.exitDoor = new THREE.Mesh(
      new THREE.PlaneGeometry(1.46, 2.5),
      new THREE.MeshBasicMaterial({ color: 0x0b0b10, side: THREE.DoubleSide }),
    );
    this.exitDoor.name = 'world3:world4-handoff-door';
    this.exitDoor.position.set(0, 1.28, 7.7);
    this.exitDoor.visible = false;
    this.exitDoor.userData.interactable = true;
    this.exitDoor.userData.promptText = 'Leave the house';
    this.exitDoor.userData.onInteract = this.inspectWorld4Handoff;
    this.group.add(this.exitDoor);
    this.interactables.push(this.exitDoor);
  }

  private addSittingRoom(wood: THREE.Material, trim: THREE.Material): void {
    this.addBox(2.15, 0.62, 0.68, 1.55, 0.31, -2.85, wood, true);
    this.addBox(0.95, 0.42, 0.76, -0.45, 0.21, -2.15, wood, true);
    this.addBox(0.1, 1.9, 0.7, 2.75, 0.95, -1.2, trim, true);
    this.addMirror(-3.245, 1.72, -2.6, -Math.PI / 2, 1.55, 2.15, false);
    this.addBox(0.06, 2.38, 1.76, -3.3, 1.72, -2.6, trim, true);
  }

  private addCorridor(trim: THREE.Material): void {
    for (const z of [-6.1, -7.3, -8.55, -9.45]) {
      this.addBox(0.13, 1.15, 0.18, z % 2 === 0 ? -1.03 : 1.03, 1.65, z, trim, true);
    }
  }

  private addBathroom(damp: THREE.Material, trim: THREE.Material): void {
    this.addBox(0.8, 0.52, 0.75, -1.25, 0.26, -12.95, damp, true);
    this.addBox(0.16, 1.15, 0.62, 1.65, 0.58, -12.45, trim, true);
    const shower = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), new THREE.MeshStandardMaterial({ color: 0x7b9292, transparent: true, opacity: 0.18, metalness: 0.4, roughness: 0.15, side: THREE.DoubleSide }));
    shower.position.set(1.75, 1.25, -13.15);
    shower.rotation.y = -Math.PI / 2;
    this.group.add(shower);
  }

  private addDeadEndRoom(wood: THREE.Material, trim: THREE.Material): void {
    this.addBox(1.18, 0.52, 0.62, -1.55, 0.26, -16.4, wood, true);
    this.addBox(0.72, 0.92, 0.48, 1.63, 0.46, -17.15, wood, true);
    this.finalMirror = this.addMirror(0, 1.58, -18.79, 0, 3.85, 2.42, true);
    this.finalMirrorBacking = this.addBox(4.03, 2.6, 0.04, 0, 1.58, -18.93, trim, true);
    this.createAnomalies();
    this.createBreakParticles();
  }

  private addLighting(): void {
    this.group.add(new THREE.HemisphereLight(0x4e5a66, 0x09080b, 0.42));
    this.addRoomLight(0, 2.55, 5.2, 0x9bb3bf, 4.2, 4.5);
    this.addRoomLight(0.9, 2.35, -2.4, 0xb28f78, 5.4, 5.6);
    this.addRoomLight(0, 2.25, -7.7, 0x6d7f91, 2.3, 4.1);
    this.bathroomLight = this.addRoomLight(0, 2.3, -12.1, 0x8db2ae, 2.7, 4.4);
    this.addRoomLight(0, 2.35, -16.8, 0x8b5d75, 3.5, 4.8);
  }

  private addCharacters(): void {
    this.v3 = CharacterBuilder.create('v3', { position: new THREE.Vector3(0, 0, -9.1), rotationY: 0, visible: false, scale: 1.06 });
    this.v3.name = 'world3:v3-corridor-silhouette';
    this.group.add(this.v3);
    this.playerDouble = CharacterBuilder.create('anaaya', { position: new THREE.Vector3(0, 0, -18.87), rotationY: Math.PI, scale: 1.02 });
    this.playerDouble.name = 'world3:independent-mirror-double';
    this.group.add(this.playerDouble);
  }

  private updateMirrorPuzzle(dt: number): void {
    const player = this.camera.position;
    if (!this.puzzleStarted && player.z < -15.1) {
      this.puzzleStarted = true;
      this.activateAnomaly(0);
      this.playDialogue('The reflection lifts its hand before you do.');
    }
    if (!this.playerDouble) return;
    if (this.currentAnomaly === 1 && !this.identified[1]) {
      this.doubleStepProgress = Math.min(1, this.doubleStepProgress + dt / 0.75);
      this.playerDouble.position.z = THREE.MathUtils.lerp(-18.87, -18.55, this.doubleStepProgress);
    }
    // The double has a subtle unrelated breathing sway even before the final
    // reveal; its explicit gestures are authored, never copied from input.
    this.playerDouble.position.x = Math.sin(performance.now() * 0.0011) * 0.035;
  }

  private updateV3Sightlines(): void {
    if (this.cutscene.isPlaying || this.sceneCutsceneActive || !this.v3) return;
    const player = this.camera.position;
    if (!this.firstV3Shown && player.z < -5.8) {
      this.firstV3Shown = true;
      this.showV3(new THREE.Vector3(0, 0, -9.15), 0);
    } else if (!this.secondV3Shown && player.z < -10.8) {
      this.secondV3Shown = true;
      this.showV3(new THREE.Vector3(0.85, 0, -13.45), 0);
      if (this.bathroomLight) this.bathroomFlicker = flickerLight(this.bathroomLight, 0.75, 0.05, 4.2);
    }
    if (this.apparition?.active && this.v3.visible && performance.now() - this.apparitionVisibleAt > 180 && isCameraLookingAt(this.camera, this.v3, 0.965)) {
      this.apparition.cancel();
    }
  }

  private showV3(position: THREE.Vector3, rotationY: number): void {
    if (!this.v3 || !this.group.parent) return;
    this.v3.rotation.y = rotationY;
    void this.audio.playSFX(BANGLE_URL, position);
    this.apparition?.cancel();
    this.apparitionVisibleAt = performance.now();
    this.apparition = apparitionAt(this.group.parent as THREE.Scene, this.v3, position, 1.45);
  }

  private createAnomalies(): void {
    const entries: Array<[number, number, string]> = [
      [-1.1, 1.75, 'Identify the raised hand'],
      [0, 1.05, 'Identify the impossible step'],
      [1.1, 1.8, 'Identify the wrong-facing reflection'],
    ];
    for (let index = 0; index < entries.length; index += 1) {
      const [x, y, prompt] = entries[index];
      const cue = new THREE.Mesh(
        new THREE.CircleGeometry(0.19, 18),
        new THREE.MeshBasicMaterial({ color: index === 2 ? 0xb92d3d : 0x79d3cf, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
      );
      cue.name = `world3:mirror-anomaly-${index + 1}`;
      cue.position.set(x, y, -18.65);
      cue.visible = false;
      cue.userData.interactable = true;
      cue.userData.promptText = prompt;
      cue.userData.onInteract = () => this.identifyAnomaly(index);
      this.group.add(cue);
      this.interactables.push(cue);
      this.anomalyMeshes.push(cue);
    }
  }

  private activateAnomaly(index: number): void {
    if (this.identified[index] || this.currentAnomaly === index || this.disposed) return;
    this.currentAnomaly = index;
    const cue = this.anomalyMeshes[index];
    if (cue) cue.visible = true;
    if (!this.playerDouble) return;
    if (index === 0) {
      this.playerDouble.getObjectByName('leftArm')?.rotation.set(-1.15, 0, 0.22);
    } else if (index === 1) {
      this.doubleStepProgress = 0;
      this.playerDouble.getObjectByName('rightLeg')?.rotation.set(-0.42, 0, 0);
    } else {
      this.playerDouble.getObjectByName('head')?.rotation.set(0, Math.PI, 0);
    }
  }

  private identifyAnomaly(index: number): void {
    if (this.disposed || this.sceneCutsceneActive || this.currentAnomaly !== index || this.identified[index]) return;
    this.identified[index] = true;
    const cue = this.anomalyMeshes[index];
    if (cue) cue.visible = false;
    const found = this.identified.filter(Boolean).length;
    if (found === 1) {
      this.playDialogue('It moved without you. The glass does not correct itself.');
      this.activateAnomaly(1);
    } else if (found === 2) {
      this.playDialogue('It has stepped away from where the room allows it to stand.');
      this.activateAnomaly(2);
    } else {
      this.startFinalMirrorSequence();
    }
  }

  private startFinalMirrorSequence(): void {
    if (this.finalSequenceStarted || this.disposed || !this.playerDouble) return;
    this.finalSequenceStarted = true;
    this.sceneCutsceneActive = true;
    const mirrorTarget = new THREE.Vector3(0, 1.52, -18.72);
    const cameraPosition = new THREE.Vector3(0, 1.68, -16.35);
    const steps: CutsceneStep[] = [
      { type: 'cameraAnim', targetPos: cameraPosition, targetQuat: lookAtQuaternion(cameraPosition, mirrorTarget), durationSec: 0.48, easing: 'smooth' },
      { type: 'subtitle', text: 'The double smiles before you have decided whether to be afraid.', durationSec: 2.6 },
      { type: 'callback', fn: () => this.turnDoubleTowardPlayer() },
      { type: 'wait', durationSec: 0.45 },
      { type: 'fade', direction: 'out', durationSec: 0.18 },
      { type: 'callback', fn: () => this.breakFinalMirror() },
      { type: 'fade', direction: 'in', durationSec: 0.26 },
      { type: 'subtitle', text: 'V3: “It learns the shape of anyone who looks for themselves in it.”', durationSec: 3.15 },
      { type: 'subtitle', text: 'Anaaya: “You were keeping it here.”', durationSec: 2.2 },
      { type: 'subtitle', text: 'V3: “Keeping it from leaving. Not from watching.”', durationSec: 3.0 },
      { type: 'callback', fn: () => this.revealExit() },
      { type: 'subtitle', text: 'The front door is open. Beyond it, another place is waiting to be wrong.', durationSec: 3.15 },
    ];
    this.cutscene.play(steps, () => {
      this.sceneCutsceneActive = false;
      this.finalComplete = true;
    }, { retainPointerLock: true });
  }

  private turnDoubleTowardPlayer(): void {
    if (!this.playerDouble) return;
    this.playerDouble.rotation.y = 0;
    this.playerDouble.getObjectByName('head')?.rotation.set(0, Math.PI, 0);
  }

  private breakFinalMirror(): void {
    if (this.finalMirror) this.finalMirror.visible = false;
    if (this.finalMirrorBacking) this.finalMirrorBacking.visible = false;
    if (this.playerDouble) this.playerDouble.visible = false;
    if (this.finalParticles) this.finalParticles.visible = true;
    this.particleAge = 0;
    if (this.v3) {
      this.v3.position.set(0.95, 0, -14.65);
      this.v3.rotation.y = -0.45;
      this.v3.visible = true;
    }
  }

  private revealExit(): void {
    if (this.exitDoor) this.exitDoor.visible = true;
  }

  private createBreakParticles(): void {
    const count = 58;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      positions[offset] = ((index * 37) % 100) / 100 * 3.2 - 1.6;
      positions[offset + 1] = 0.3 + ((index * 19) % 100) / 100 * 2.3;
      positions[offset + 2] = -18.56 + ((index * 13) % 10) / 100;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb7d6dd, size: 0.07, transparent: true, opacity: 0.86, depthWrite: false }));
    particles.name = 'world3:broken-mirror-particles';
    particles.visible = false;
    this.group.add(particles);
    this.finalParticles = particles;
  }

  private updateParticles(dt: number): void {
    if (!this.finalParticles?.visible || this.particleAge > 1.7) return;
    this.particleAge += dt;
    const positions = this.finalParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, positions.getY(index) - dt * (0.85 + (index % 5) * 0.13));
      positions.setX(index, positions.getX(index) + Math.sin(index * 4.3 + this.particleAge * 8) * dt * 0.08);
    }
    positions.needsUpdate = true;
  }

  private addMirror(x: number, y: number, z: number, rotationY: number, width: number, height: number, isFinal: boolean): THREE.Mesh {
    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ color: isFinal ? 0x79939a : 0x778c91, roughness: 0.02, metalness: 0.9, transparent: true, opacity: isFinal ? 0.54 : 0.62, side: THREE.DoubleSide }),
    );
    mirror.position.set(x, y, z);
    mirror.rotation.y = rotationY;
    mirror.name = isFinal ? 'world3:final-mirror' : 'world3:sitting-room-mirror';
    this.group.add(mirror);
    return mirror;
  }

  private addRoomFloor(width: number, depth: number, x: number, z: number, material: THREE.Material): void {
    this.addBox(width, 0.12, depth, x, -0.08, z, material, false);
  }

  private addWall(width: number, height: number, depth: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const wall = this.addBox(width, height, depth, x, y, z, material, true);
    this.wallBoxes.push([x - width / 2, x + width / 2, z - depth / 2, z + depth / 2]);
    return wall;
  }

  private addDoorHeader(x: number, y: number, z: number, width: number, material: THREE.Material): void {
    this.addBox(width, 0.18, 0.2, x, y, z, material, true);
    this.addBox(0.12, 2.5, 0.2, x - width / 2, 1.25, z, material, true);
    this.addBox(0.12, 2.5, 0.2, x + width / 2, 1.25, z, material, true);
  }

  private addRoomLight(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, distance: number): THREE.PointLight {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    this.group.add(light);
    return light;
  }

  private addBox(width: number, height: number, depth: number, x: number, y: number, z: number, material: THREE.Material, castsShadow: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castsShadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private playDialogue(text: string): void {
    if (this.sceneCutsceneActive || this.cutscene.isPlaying) return;
    this.sceneCutsceneActive = true;
    this.cutscene.play([{ type: 'subtitle', text, durationSec: 2.7 }], () => { this.sceneCutsceneActive = false; }, { retainPointerLock: true });
  }

  private standard(color: THREE.ColorRepresentation, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  /** Final P8 endpoint only; World 4 remains intentionally unimplemented. */
  private inspectWorld4Handoff = (): void => {
    if (!this.finalComplete || this.cutscene.isPlaying || this.disposed) return;
    this.playDialogue('The open door leads somewhere the house refuses to show you. [World 4 handoff]');
  };
}

function isCameraLookingAt(camera: THREE.Camera, target: THREE.Object3D, threshold: number): boolean {
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const toTarget = target.getWorldPosition(new THREE.Vector3()).sub(camera.getWorldPosition(new THREE.Vector3())).normalize();
  return forward.dot(toTarget) >= threshold;
}

function lookAtQuaternion(position: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)));
}
