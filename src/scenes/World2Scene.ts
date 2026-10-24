import * as THREE from 'three';
import { CharacterBuilder } from '../systems/CharacterBuilder.js';
import type { AudioManager } from '../systems/AudioManager.js';
import type { CutsceneDirector, CutsceneFocus, CutsceneStep } from '../systems/CutsceneDirector.js';
import { apparitionAt, type EffectHandle } from '../systems/HorrorEffects.js';
import type { GameState, IScene, SceneName, SceneResult } from './types.js';

interface World2Dependencies {
  readonly audio: AudioManager;
  readonly camera: THREE.PerspectiveCamera;
  readonly cutscene: CutsceneDirector;
}

const RAIN_AMBIENT_URL = '/audio/ambient-w2.mp3';
const CITY_BOUNDS = { minX: -4.5, maxX: 4.5, minZ: -27, maxZ: 7 };
const COMPANION_WAYPOINTS = [
  new THREE.Vector3(1.05, 0, 1.0),
  new THREE.Vector3(1.1, 0, -6.6),
  new THREE.Vector3(-0.9, 0, -13.1),
  new THREE.Vector3(0.85, 0, -20.4),
];

/**
 * World 2: a rain-soaked industrial corridor. V2 begins as a composed guide,
 * then exposes the cost of his search in a short, stylised encounter.
 */
export class World2Scene implements IScene {
  readonly name: SceneName = 'world2';

  private readonly audio: AudioManager;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cutscene: CutsceneDirector;
  private readonly group = new THREE.Group();
  private readonly interactables: THREE.Mesh[] = [];
  private readonly wallBoxes: Array<[number, number, number, number]> = [];

  private previousFog: THREE.Fog | THREE.FogExp2 | null = null;
  private previousBackground: THREE.Color | THREE.Texture | null = null;
  private rainGeometry: THREE.BufferGeometry | null = null;
  private rainPositions: Float32Array | null = null;
  private monitorTexture: THREE.CanvasTexture | null = null;
  private v2: THREE.Group | null = null;
  private victims: THREE.Group[] = [];
  private threatSilhouette: THREE.Group | null = null;
  private discrepancyCrate: THREE.Mesh | null = null;
  private changedPipe: THREE.Object3D | null = null;
  private redCue: THREE.PointLight | null = null;
  private silhouetteEffect: EffectHandle | null = null;

  private built = false;
  private disposed = false;
  private sceneCutsceneActive = false;
  private monitorViewed = false;
  private discrepancyTriggered = false;
  private transformed = false;
  private world3HandoffAnnounced = false;
  private companionWaypoint = 0;
  private companionDialogueStep = 0;
  private silhouetteElapsed = 0;
  private silhouetteIndex = 0;

  constructor(dependencies: World2Dependencies) {
    this.audio = dependencies.audio;
    this.camera = dependencies.camera;
    this.cutscene = dependencies.cutscene;
  }

  build(scene: THREE.Scene, _state: Readonly<GameState>): SceneResult {
    this.built = true;
    this.disposed = false;
    this.group.name = 'scene:world2-ruined-industrial-city';
    this.previousFog = scene.fog;
    this.previousBackground = scene.background;
    scene.fog = new THREE.Fog(0x29343c, 8, 31);
    scene.background = new THREE.Color(0x1d2931);
    scene.add(this.group);

    this.buildCity();
    void this.audio.playAmbient(RAIN_AMBIENT_URL, 1.2);
    return {
      wallBoxes: this.wallBoxes,
      interactables: this.interactables,
      spawnPoint: new THREE.Vector3(0, 0, 5.35),
    };
  }

  update(dt: number, _state: GameState): void {
    if (!this.built || this.disposed) return;
    this.updateRain(dt);

    if (!this.cutscene.isPlaying && !this.sceneCutsceneActive) {
      this.updateCompanion(dt);
      this.updateCorridorDiscrepancy();
    }

    if (!this.transformed || this.cutscene.isPlaying) return;
    this.silhouetteElapsed += dt;
    if (this.silhouetteElapsed >= 8.5) {
      this.silhouetteElapsed = 0;
      this.triggerThreatSilhouette();
    }
  }

  dispose(scene: THREE.Scene): void {
    this.disposed = true;
    this.silhouetteEffect?.cancel();
    this.silhouetteEffect = null;
    if (this.sceneCutsceneActive || this.cutscene.isPlaying) this.cutscene.stop();
    this.sceneCutsceneActive = false;
    this.audio.stopAmbient(0.25);

    for (const character of [...this.victims, this.v2, this.threatSilhouette]) {
      if (character) CharacterBuilder.dispose(character);
    }
    this.victims = [];
    this.v2 = null;
    this.threatSilhouette = null;

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      const resourceObject = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (resourceObject.geometry) geometries.add(resourceObject.geometry);
      const objectMaterials = resourceObject.material;
      for (const material of objectMaterials ? (Array.isArray(objectMaterials) ? objectMaterials : [objectMaterials]) : []) {
        materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.monitorTexture?.dispose();
    this.monitorTexture = null;
    this.rainGeometry = null;
    this.rainPositions = null;
    scene.remove(this.group);
    scene.fog = this.previousFog;
    scene.background = this.previousBackground;

    this.interactables.length = 0;
    this.wallBoxes.length = 0;
    this.discrepancyCrate = null;
    this.changedPipe = null;
    this.redCue = null;
    this.built = false;
  }

  private buildCity(): void {
    const asphalt = this.standard(0x252e33, 0.35, 0.28);
    const concrete = this.standard(0x3a4145, 0.88);
    const darkConcrete = this.standard(0x1d2428, 0.94);
    const oxidized = this.standard(0x654b3d, 0.78, 0.3);
    const wetMetal = this.standard(0x32434a, 0.25, 0.62);
    const debris = this.standard(0x4d4941, 0.96);

    this.addBox(8.8, 0.12, 34, 0, -0.08, -10, asphalt, false);
    this.addBoundaryWalls();
    this.addIndustrialFacades(concrete, darkConcrete, wetMetal);
    this.addPipesAndDebris(oxidized, wetMetal, debris);
    this.addWetSurfaces();
    this.addAtmosphere();
    this.addRain();
    this.addSecurityMonitor();
    this.addCompanionAndVictims();
    this.addWorld3Gate(wetMetal);
  }

  private addBoundaryWalls(): void {
    const thickness = 0.2;
    this.wallBoxes.push(
      [CITY_BOUNDS.minX - thickness, CITY_BOUNDS.minX + thickness, CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ],
      [CITY_BOUNDS.maxX - thickness, CITY_BOUNDS.maxX + thickness, CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ],
      [CITY_BOUNDS.minX, CITY_BOUNDS.maxX, CITY_BOUNDS.minZ - thickness, CITY_BOUNDS.minZ + thickness],
      [CITY_BOUNDS.minX, CITY_BOUNDS.maxX, CITY_BOUNDS.maxZ - thickness, CITY_BOUNDS.maxZ + thickness],
    );
  }

  private addIndustrialFacades(concrete: THREE.Material, darkConcrete: THREE.Material, wetMetal: THREE.Material): void {
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0xa7bac0,
      emissive: 0x617f86,
      emissiveIntensity: 1.3,
      roughness: 0.28,
      metalness: 0.15,
    });
    const dimWindowMaterial = new THREE.MeshStandardMaterial({
      color: 0x596467,
      emissive: 0x1d2930,
      emissiveIntensity: 0.45,
      roughness: 0.45,
    });
    const blocks = [3.1, -4.8, -12.4, -20.0];
    for (const z of blocks) {
      for (const side of [-1, 1]) {
        const x = side * 4.15;
        this.addBox(0.65, 5.4, 6.7, x, 2.65, z, concrete, true);
        this.addBox(0.22, 0.38, 6.1, side * 3.76, 4.55, z, darkConcrete, false);
        for (let row = 0; row < 2; row += 1) {
          for (let column = 0; column < 3; column += 1) {
            if ((row + column + (side > 0 ? 1 : 0) + Math.round(z)) % 3 === 0) continue;
            const window = new THREE.Mesh(
              new THREE.BoxGeometry(0.035, 0.62, 0.86),
              (row + column) % 2 === 0 ? windowMaterial : dimWindowMaterial,
            );
            window.position.set(side * 3.79, 1.55 + row * 1.35, z - 2.0 + column * 1.82);
            window.castShadow = false;
            this.group.add(window);
          }
        }
        const gantry = this.addBox(0.3, 0.12, 5.85, side * 3.65, 3.75, z, wetMetal, true);
        gantry.rotation.z = side * 0.08;
      }
    }
    // A shuttered end building gives the transformation and final gate a clear silhouette.
    this.addBox(7.5, 5.1, 0.45, 0, 2.5, -24.2, darkConcrete, true);
    this.addBox(3.25, 3.2, 0.12, 0, 1.65, -23.93, wetMetal, true);
    this.wallBoxes.push([CITY_BOUNDS.minX, CITY_BOUNDS.maxX, -24.44, -23.96]);
  }

  private addPipesAndDebris(oxidized: THREE.Material, wetMetal: THREE.Material, debris: THREE.Material): void {
    for (const [x, z, height] of [[-3.58, 1.7, 2.6], [3.58, -7.8, 3.1], [-3.58, -15.1, 2.2]] as [number, number, number][]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, height, 8), oxidized);
      pipe.position.set(x, height / 2, z);
      pipe.castShadow = true;
      this.group.add(pipe);
      const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.11, 6, 10, Math.PI), oxidized);
      elbow.position.set(x - Math.sign(x) * 0.36, height, z);
      elbow.rotation.z = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(elbow);
    }

    const changedPipe = new THREE.Group();
    changedPipe.name = 'world2:changed-pipe';
    const fallenPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 8), oxidized);
    fallenPipe.rotation.z = Math.PI / 2;
    fallenPipe.position.set(2.9, 0.3, 1.15);
    fallenPipe.castShadow = true;
    changedPipe.add(fallenPipe);
    this.group.add(changedPipe);
    this.changedPipe = changedPipe;

    for (const [x, z, sx, sz] of [
      [-1.35, 2.5, 0.48, 0.35], [1.8, -2.1, 0.65, 0.42], [-1.9, -9.8, 0.42, 0.72], [2.0, -16.4, 0.72, 0.38],
    ] as [number, number, number, number][]) {
      const rubble = this.addBox(sx, 0.24, sz, x, 0.12, z, debris, true);
      rubble.rotation.y = (x + z) * 0.6;
    }
    this.discrepancyCrate = this.addBox(0.86, 0.78, 0.82, 1.25, 0.39, 1.15, wetMetal, true);
    this.discrepancyCrate.name = 'world2:discrepancy-crate';
  }

  private addWetSurfaces(): void {
    const puddleMaterial = new THREE.MeshStandardMaterial({
      color: 0x344b53,
      roughness: 0.13,
      metalness: 0.48,
      transparent: true,
      opacity: 0.72,
    });
    for (const [x, z, sx, sz] of [[-1.4, 3.3, 1.35, 2.7], [1.1, -5.1, 1.05, 3.1], [-0.8, -14.8, 1.65, 2.0], [1.2, -20.8, 1.2, 2.6]] as [number, number, number, number][]) {
      const puddle = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), puddleMaterial.clone());
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(x, 0.006, z);
      this.group.add(puddle);
    }
  }

  private addAtmosphere(): void {
    const ambient = new THREE.HemisphereLight(0x8098a3, 0x182126, 0.84);
    this.group.add(ambient);
    const moon = new THREE.DirectionalLight(0x91aabb, 1.05);
    moon.position.set(-6, 9, 5);
    moon.castShadow = true;
    moon.shadow.mapSize.set(512, 512);
    this.group.add(moon);
    for (const [x, z, color] of [[-3.4, 2.7, 0x77b8c9], [3.35, -8.2, 0xd29c5a], [-3.35, -16.5, 0x719db2]] as [number, number, number][]) {
      const lamp = new THREE.PointLight(color, 7.5, 5.2, 2);
      lamp.position.set(x, 3.25, z);
      this.group.add(lamp);
    }
    this.redCue = new THREE.PointLight(0xb52e30, 0, 9, 2);
    this.redCue.position.set(0, 2.15, -21.3);
    this.group.add(this.redCue);
  }

  private addRain(): void {
    const count = 600;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      positions[offset] = -4.2 + ((index * 37) % 100) / 100 * 8.4;
      positions[offset + 1] = 0.2 + ((index * 53) % 100) / 100 * 6.4;
      positions[offset + 2] = CITY_BOUNDS.minZ + ((index * 71) % 100) / 100 * (CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x9ebbc4, size: 0.038, transparent: true, opacity: 0.68, depthWrite: false });
    const rain = new THREE.Points(geometry, material);
    rain.name = 'world2:rain';
    this.group.add(rain);
    this.rainGeometry = geometry;
    this.rainPositions = positions;
  }

  private addSecurityMonitor(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    this.monitorTexture = new THREE.CanvasTexture(canvas);
    this.monitorTexture.colorSpace = THREE.SRGBColorSpace;
    this.drawMonitorFeed(false);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.28, 0.8),
      new THREE.MeshBasicMaterial({ map: this.monitorTexture }),
    );
    screen.name = 'world2:security-monitor';
    screen.position.set(3.76, 1.78, -4.35);
    screen.rotation.y = -Math.PI / 2;
    screen.userData.interactable = true;
    screen.userData.promptText = 'View security monitor';
    screen.userData.onInteract = () => this.inspectMonitor();
    this.group.add(screen);
    this.interactables.push(screen);
    // The former rotated frame used its long local depth across the screen's
    // viewing axis, becoming a solid slab in front of the PlaneGeometry.
    // Keep a shallow wall backing behind the display and use edge rails that
    // cannot cover its feed from the corridor approach.
    const frameMaterial = this.standard(0x11181a, 0.55, 0.65);
    this.addBox(0.05, 1.06, 1.5, 3.86, 1.78, -4.35, frameMaterial, true);
    this.addBox(0.07, 0.07, 1.52, 3.79, 2.27, -4.35, frameMaterial, true);
    this.addBox(0.07, 0.07, 1.52, 3.79, 1.29, -4.35, frameMaterial, true);
    this.addBox(0.07, 1.04, 0.07, 3.79, 1.78, -5.07, frameMaterial, true);
    this.addBox(0.07, 1.04, 0.07, 3.79, 1.78, -3.63, frameMaterial, true);
  }

  private addCompanionAndVictims(): void {
    this.v2 = CharacterBuilder.create('v2-clean', {
      position: new THREE.Vector3(1.35, 0, 4.4),
      rotationY: Math.PI,
    });
    this.group.add(this.v2);

    const longHair = CharacterBuilder.create('woman-long-hair', {
      position: new THREE.Vector3(-1.12, 0, -21.35),
      rotationY: 0.22,
      visible: false,
    });
    const shortHair = CharacterBuilder.create('woman-short-hair', {
      position: new THREE.Vector3(1.08, 0, -21.55),
      rotationY: -0.25,
      visible: false,
    });
    this.victims = [longHair, shortHair];
    this.group.add(longHair, shortHair);

    this.threatSilhouette = CharacterBuilder.create('v2-bloody', {
      position: new THREE.Vector3(0, 0, -23.1),
      rotationY: 0,
      visible: false,
    });
    this.threatSilhouette.name = 'world2:v2-threat-silhouette';
    this.tintSilhouette(this.threatSilhouette);
    this.group.add(this.threatSilhouette);
  }

  private addWorld3Gate(material: THREE.Material): void {
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3), new THREE.MeshStandardMaterial({ color: 0x27343a, metalness: 0.72, roughness: 0.36 }));
    gate.position.set(0, 1.55, -23.68);
    gate.userData.interactable = true;
    gate.userData.promptText = 'Inspect sealed service lift';
    gate.userData.onInteract = () => this.inspectWorld3Handoff();
    this.group.add(gate);
    this.interactables.push(gate);
    const light = new THREE.PointLight(0x6f9eaf, 3.8, 3.4, 2);
    light.position.set(0, 2.65, -23.1);
    this.group.add(light);
    this.addBox(2.95, 0.1, 0.16, 0, 3.15, -23.55, material, true);
  }

  private updateRain(dt: number): void {
    if (!this.rainPositions || !this.rainGeometry) return;
    for (let index = 0; index < this.rainPositions.length; index += 3) {
      this.rainPositions[index + 1] -= dt * (4.8 + (index % 5) * 0.13);
      if (this.rainPositions[index + 1] < 0.05) {
        this.rainPositions[index + 1] = 6.5;
        this.rainPositions[index] += 0.17;
        if (this.rainPositions[index] > 4.2) this.rainPositions[index] = -4.2;
      }
    }
    (this.rainGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateCompanion(dt: number): void {
    if (!this.v2 || this.transformed || this.companionWaypoint >= COMPANION_WAYPOINTS.length) return;
    const waypoint = COMPANION_WAYPOINTS[this.companionWaypoint];
    const playerDistance = horizontalDistance(this.camera.position, waypoint);
    if (playerDistance <= 6) this.moveCharacterToward(this.v2, waypoint, dt, 3.15);

    if (horizontalDistance(this.v2.position, waypoint) > 0.12 || horizontalDistance(this.camera.position, this.v2.position) > 3.1) return;
    this.triggerCompanionBeat();
  }

  private triggerCompanionBeat(): void {
    if (!this.v2 || this.cutscene.isPlaying || this.sceneCutsceneActive) return;
    const beat = this.companionDialogueStep;
    const lines = [
      [
        'V2: “The rain keeps the ash down. It never washes anything clean.”',
        'Anaaya: “You said you were looking for someone.”',
      ],
      [
        'V2: “Two women. They chose silence after someone I loved died.”',
        'V2: “I thought hearing their reason would change what it did to me.”',
      ],
      [
        'V2: “The monitor lies, but only by one object. That is how this place starts talking.”',
      ],
      [
        'V2: “They are inside. Anaaya, do not ask me to forgive what they buried.”',
      ],
    ][Math.min(beat, 3)];
    this.playDialogue(lines.map(text => ({ type: 'subtitle' as const, text, durationSec: 2.65 })), this.v2Focus());
    this.companionDialogueStep += 1;
    this.companionWaypoint += 1;
  }

  private updateCorridorDiscrepancy(): void {
    if (!this.monitorViewed || this.discrepancyTriggered) return;
    const player = this.camera.position;
    // The monitor at block two views the first block behind the player. On
    // returning, its crate is no longer on the right where the player passed it.
    if (player.z < -0.4 || player.z > 2.9 || Math.abs(player.x) > 3.25) return;
    this.discrepancyTriggered = true;
    if (this.discrepancyCrate) this.discrepancyCrate.position.x = -1.35;
    if (this.changedPipe) this.changedPipe.visible = false;
    this.playDialogue([
      { type: 'subtitle', text: 'The crate is now beneath the left pipe. The broken pipe is gone.', durationSec: 3.05 },
    ]);
  }

  private inspectMonitor(): void {
    if (this.cutscene.isPlaying || this.disposed) return;
    this.monitorViewed = true;
    this.drawMonitorFeed(true);
    this.playDialogue([
      { type: 'subtitle', text: 'CAM 04 shows the first block: a crate beneath the left pipe.', durationSec: 2.9 },
      { type: 'subtitle', text: 'The real crate was on the right when you passed it.', durationSec: 2.55 },
    ]);
  }

  private startTransformation(): void {
    if (this.transformed || this.sceneCutsceneActive || this.cutscene.isPlaying || !this.v2) return;
    if (!this.monitorViewed || !this.discrepancyTriggered) {
      this.playDialogue([{ type: 'subtitle', text: 'V2 waits by the shutter. The changed corridor has not finished saying what it means.', durationSec: 3.1 }]);
      return;
    }

    this.sceneCutsceneActive = true;
    const focusTarget = new THREE.Vector3(0, 1.35, -21.25);
    const cinematicPosition = new THREE.Vector3(0, 1.75, -17.1);
    const steps: CutsceneStep[] = [
      { type: 'fade', direction: 'out', durationSec: 0.28 },
      { type: 'callback', fn: () => this.revealVictims() },
      { type: 'fade', direction: 'in', durationSec: 0.28 },
      { type: 'cameraAnim', targetPos: cinematicPosition, targetQuat: lookAtQuaternion(cinematicPosition, focusTarget), durationSec: 0.7, easing: 'smooth' },
      { type: 'subtitle', text: 'V2: “I found the people who hid behind the report.”', durationSec: 2.7 },
      { type: 'subtitle', text: 'Anaaya: “Their silence was cruel. Do not become another cruelty.”', durationSec: 3.05 },
      { type: 'subtitle', text: 'V2: “I tried to be reasonable. It did not bring anyone back.”', durationSec: 2.85 },
      { type: 'fade', direction: 'out', durationSec: 0.24 },
      { type: 'callback', fn: () => this.completeTransformation() },
      { type: 'fade', direction: 'in', durationSec: 0.32 },
      { type: 'subtitle', text: 'Anaaya: “V2… what have you done?”', durationSec: 2.25 },
      { type: 'subtitle', text: 'The rain keeps falling. V2 does not look relieved.', durationSec: 3.0 },
      { type: 'wait', durationSec: 0.3 },
    ];
    this.cutscene.play(steps, () => {
      this.sceneCutsceneActive = false;
      if (!this.disposed) this.transformed = true;
    }, { retainPointerLock: true });
  }

  private revealVictims(): void {
    for (const victim of this.victims) victim.visible = true;
    if (this.redCue) this.redCue.intensity = 7.2;
  }

  private completeTransformation(): void {
    for (const victim of this.victims) victim.visible = false;
    if (!this.v2) return;
    const position = this.v2.position.clone();
    const rotationY = this.v2.rotation.y;
    CharacterBuilder.dispose(this.v2);
    this.v2 = CharacterBuilder.create('v2-bloody', { position, rotationY });
    this.group.add(this.v2);
    if (this.redCue) this.redCue.intensity = 2.4;
  }

  private inspectWorld3Handoff(): void {
    if (this.cutscene.isPlaying || this.world3HandoffAnnounced || this.disposed) return;
    if (!this.transformed) {
      if (this.companionWaypoint >= COMPANION_WAYPOINTS.length) {
        this.startTransformation();
      } else {
        this.playDialogue([{ type: 'subtitle', text: 'The service lift is sealed. V2 has gone quiet near the shutter.', durationSec: 2.9 }]);
      }
      return;
    }
    this.world3HandoffAnnounced = true;
    this.playDialogue([
      { type: 'subtitle', text: 'A service lift waits beyond the shutter. Its destination is a house that should not be here.', durationSec: 3.65 },
      { type: 'subtitle', text: '[World 3 handoff point — P8]', durationSec: 2.2 },
    ]);
  }

  private triggerThreatSilhouette(): void {
    if (!this.threatSilhouette || !this.group.parent || this.disposed) return;
    const positions = [new THREE.Vector3(0, 0, -23.1), new THREE.Vector3(-0.15, 0, -14.8)];
    const position = positions[this.silhouetteIndex % positions.length];
    this.silhouetteIndex += 1;
    this.silhouetteEffect?.cancel();
    this.silhouetteEffect = apparitionAt(this.group.parent as THREE.Scene, this.threatSilhouette, position, 2.5);
  }

  private v2Focus(): CutsceneFocus | undefined {
    if (!this.v2) return undefined;
    const head = this.v2.getObjectByName('head');
    const torso = this.v2.getObjectByName('torso');
    if (!head || !torso) return undefined;
    this.v2.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(head);
    bounds.expandByObject(torso);
    const target = bounds.getCenter(new THREE.Vector3());
    target.y = bounds.min.y + bounds.getSize(new THREE.Vector3()).y * 0.53;
    return { target, durationSec: 0.46, easing: 'smooth', minimumDistance: 2.65, returnDurationSec: 0.3 };
  }

  private playDialogue(steps: CutsceneStep[], focus?: CutsceneFocus): void {
    this.sceneCutsceneActive = true;
    this.cutscene.play(steps, () => { this.sceneCutsceneActive = false; }, {
      retainPointerLock: true,
      ...(focus ? { focus } : {}),
    });
  }

  private moveCharacterToward(character: THREE.Group, target: THREE.Vector3, dt: number, speed: number): void {
    const offset = target.clone().sub(character.position);
    offset.y = 0;
    const distance = offset.length();
    if (distance < 0.001) return;
    const step = Math.min(distance, speed * Math.max(0, dt));
    offset.multiplyScalar(step / distance);
    character.position.add(offset);
    character.position.y = 0;
    character.rotation.y = Math.atan2(offset.x, offset.z);
  }

  private drawMonitorFeed(analysed: boolean): void {
    if (!this.monitorTexture) return;
    const canvas = this.monitorTexture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#102228';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#31505a';
    context.fillRect(38, 48, 436, 224);
    context.fillStyle = '#1c2a2f';
    context.fillRect(74, 80, 60, 160);
    context.fillRect(378, 80, 60, 160);
    context.strokeStyle = '#92c8bd';
    context.lineWidth = 3;
    context.strokeRect(45, 54, 422, 212);
    // The feed always places the crate under the left pipe, unlike the real
    // corridor before its deterministic return-trip discrepancy.
    context.fillStyle = '#7c8790';
    context.fillRect(120, 205, 58, 34);
    context.fillStyle = '#bd795d';
    context.fillRect(104, 112, 18, 102);
    context.fillStyle = '#c5e8d4';
    context.font = '18px monospace';
    context.fillText('CAM 04  /  BLOCK ONE', 24, 28);
    context.fillText(analysed ? 'MOTION LOG: CRATE / LEFT PIPE' : 'LIVE FEED', 24, 302);
    this.monitorTexture.needsUpdate = true;
  }

  private tintSilhouette(character: THREE.Group): void {
    character.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.multiplyScalar(0.24);
          material.emissive.setHex(0x170405);
          material.emissiveIntensity = 0.42;
        }
      }
    });
  }

  private addBox(width: number, height: number, depth: number, x: number, y: number, z: number, material: THREE.Material, castsShadow: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castsShadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private standard(color: THREE.ColorRepresentation, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function lookAtQuaternion(position: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)));
}
