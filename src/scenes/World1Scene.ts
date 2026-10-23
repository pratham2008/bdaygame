import * as THREE from 'three';
import { CharacterBuilder } from '../systems/CharacterBuilder.js';
import type { AudioManager } from '../systems/AudioManager.js';
import type { CutsceneDirector, CutsceneFocus, CutsceneStep } from '../systems/CutsceneDirector.js';
import { apparitionAt, moveWhenNotLooking, type EffectHandle } from '../systems/HorrorEffects.js';
import type { GameState, IScene, SceneName, SceneResult } from './types.js';

interface World1Dependencies {
  readonly audio: AudioManager;
  readonly camera: THREE.PerspectiveCamera;
  readonly cutscene: CutsceneDirector;
  /** Rebuilds this scene through SceneManager after a completed iteration. */
  readonly reloadOutpost: () => void;
}

const RADIO_CRACKLE_URL = '/audio/jail-radio.mp3';
const OUTPOST_BOUNDS = { minX: -6, maxX: 6, minZ: -8, maxZ: 8 };

/**
 * World 1: a compact outpost caught in a three-pass recorded alarm. Each pass
 * owns all of its geometry and effects, then asks SceneManager for a fresh
 * build so collision, interactables, and apparition timers never leak into
 * the next pass.
 */
export class World1Scene implements IScene {
  readonly name: SceneName = 'world1';

  private readonly audio: AudioManager;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cutscene: CutsceneDirector;
  private readonly reloadOutpost: () => void;
  private readonly group = new THREE.Group();
  private readonly interactables: THREE.Mesh[] = [];
  private readonly wallBoxes: Array<[number, number, number, number]> = [];

  private previousFog: THREE.Fog | THREE.FogExp2 | null = null;
  private previousBackground: THREE.Color | THREE.Texture | null = null;
  private sweepPivot: THREE.Group | null = null;
  private searchlight: THREE.SpotLight | null = null;
  private terminalStatusLight: THREE.PointLight | null = null;
  private patrol: THREE.Group | null = null;
  private injuredSoldier: THREE.Group | null = null;
  private militaryVariant: THREE.Group | null = null;
  private apparition: EffectHandle | null = null;

  private built = false;
  private disposed = false;
  private sceneCutsceneActive = false;
  private terminalBusy = false;
  private injuredClueFound = false;
  private variantClueFound = false;
  private sweepElapsed = 0;
  private loopCount = 0;
  private state: GameState | null = null;

  constructor(dependencies: World1Dependencies) {
    this.audio = dependencies.audio;
    this.camera = dependencies.camera;
    this.cutscene = dependencies.cutscene;
    this.reloadOutpost = dependencies.reloadOutpost;
  }

  build(scene: THREE.Scene, state: Readonly<GameState>): SceneResult {
    this.built = true;
    this.disposed = false;
    this.state = state as GameState;
    this.loopCount = Math.min(this.state.world1LoopCount, 3);
    this.group.name = `scene:world1-outpost-pass-${this.loopCount}`;
    this.previousFog = scene.fog;
    this.previousBackground = scene.background;
    scene.fog = new THREE.Fog(this.loopCount >= 2 ? 0x6a5d50 : 0x50594d, 6, 18);
    scene.background = new THREE.Color(this.loopCount >= 1 ? 0x665d4a : 0x3f4b42);
    scene.add(this.group);

    this.buildOutpost();
    return {
      wallBoxes: this.wallBoxes,
      interactables: this.interactables,
      spawnPoint: new THREE.Vector3(0, 0, 6.25),
    };
  }

  update(dt: number, _state: GameState): void {
    if (!this.built || this.disposed) return;

    if (this.sweepPivot) this.sweepPivot.rotation.y += dt * (this.loopCount >= 2 ? 0.72 : 0.52);
    this.sweepElapsed += dt;
    if (this.loopCount < 3 && this.sweepElapsed >= 6.5) {
      this.sweepElapsed = 0;
      this.triggerPatrolApparition();
    }

    if (this.apparition?.active && this.patrol) {
      const closer = PATROL_POSITIONS[Math.min(this.loopCount + 1, PATROL_POSITIONS.length - 1)];
      moveWhenNotLooking(this.camera, this.patrol, closer, 0.72, { lerpFactor: 0.025 });
    }
  }

  dispose(scene: THREE.Scene): void {
    this.disposed = true;
    this.apparition?.cancel();
    this.apparition = null;
    if (this.sceneCutsceneActive) this.cutscene.stop();
    this.sceneCutsceneActive = false;

    for (const character of [this.patrol, this.injuredSoldier, this.militaryVariant]) {
      if (character) CharacterBuilder.dispose(character);
    }
    this.patrol = null;
    this.injuredSoldier = null;
    this.militaryVariant = null;

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
    scene.remove(this.group);
    scene.fog = this.previousFog;
    scene.background = this.previousBackground;

    this.interactables.length = 0;
    this.wallBoxes.length = 0;
    this.sweepPivot = null;
    this.searchlight = null;
    this.terminalStatusLight = null;
    this.state = null;
    this.built = false;
  }

  private buildOutpost(): void {
    const ground = this.standard(0x3b4031, 1);
    const dust = this.standard(0x645947, 1);
    const sandbag = this.standard(0x817658, 0.98);
    const olive = this.standard(0x3d4c31, 0.9);
    const darkOlive = this.standard(0x202b23, 0.96);
    const steel = this.standard(0x46504b, 0.55, 0.55);
    const canvas = this.standard(0x556047, 0.98);
    const red = this.standard(0x702f28, 0.8);

    this.addBox(12, 0.12, 16, 0, -0.08, 0, ground, false);
    this.addBox(2.2, 0.018, 3.2, -2.6, 0.002, -0.4, dust, false);
    this.addBox(3.4, 0.018, 2.5, 2.6, 0.002, -4.4, dust, false);
    this.addBoundaryWalls();
    this.addSandbagCluster(-4.45, 4.55, sandbag, false);
    this.addSandbagCluster(4.25, 2.8, sandbag, this.loopCount >= 1);
    this.addSandbagCluster(-4.5, -5.35, sandbag, false);
    this.addDefensiveBarriers(olive, steel);
    this.addBarbedWire(new THREE.LineBasicMaterial({ color: 0x55605a }), steel);
    this.addCommsTower(steel, darkOlive);
    this.addMedicalTent(canvas, olive, red);
    this.addTerminal(steel, darkOlive);
    this.addSearchlight();
    this.addAtmosphere();
    this.addCharacters();
  }

  private addBoundaryWalls(): void {
    const thickness = 0.18;
    this.wallBoxes.push(
      [OUTPOST_BOUNDS.minX - thickness, OUTPOST_BOUNDS.minX + thickness, OUTPOST_BOUNDS.minZ, OUTPOST_BOUNDS.maxZ],
      [OUTPOST_BOUNDS.maxX - thickness, OUTPOST_BOUNDS.maxX + thickness, OUTPOST_BOUNDS.minZ, OUTPOST_BOUNDS.maxZ],
      [OUTPOST_BOUNDS.minX, OUTPOST_BOUNDS.maxX, OUTPOST_BOUNDS.minZ - thickness, OUTPOST_BOUNDS.minZ + thickness],
      [OUTPOST_BOUNDS.minX, OUTPOST_BOUNDS.maxX, OUTPOST_BOUNDS.maxZ - thickness, OUTPOST_BOUNDS.maxZ + thickness],
    );
  }

  private addSandbagCluster(x: number, z: number, material: THREE.Material, displaced: boolean): void {
    const offsetX = displaced ? 0.72 : 0;
    const offsetZ = displaced ? -0.4 : 0;
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const stagger = row === 1 ? 0.23 : 0;
        this.addBox(0.66, 0.3, 0.38, x + column * 0.66 + stagger + offsetX, 0.18 + row * 0.3, z + offsetZ, material, true);
      }
    }
    this.wallBoxes.push([x - 0.35 + offsetX, x + 2.05 + offsetX, z - 0.32 + offsetZ, z + 0.32 + offsetZ]);
  }

  private addDefensiveBarriers(olive: THREE.Material, steel: THREE.Material): void {
    for (const [x, z, angle] of [[-4.8, -0.8, 0.2], [4.45, -1.4, -0.32], [0.25, -6.8, 0]] as [number, number, number][]) {
      const barrier = this.addBox(1.65, 0.86, 0.12, x, 0.43, z, olive, true);
      barrier.rotation.y = angle;
      const strut = this.addBox(1.85, 0.07, 0.07, x, 0.78, z + 0.08, steel, true);
      strut.rotation.z = 0.33;
      strut.rotation.y = angle;
    }
  }

  private addBarbedWire(wireMaterial: THREE.LineBasicMaterial, postMaterial: THREE.Material): void {
    for (const x of [-5.72, 5.72]) {
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 24; step += 1) {
        const z = -7.3 + step * 0.61;
        points.push(new THREE.Vector3(x, 1.28 + (step % 2 === 0 ? 0.11 : -0.11), z));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, wireMaterial);
      this.group.add(line);
      for (let z = -6.7; z < 7; z += 2.5) {
        this.addBox(0.07, 1.5, 0.07, x, 0.75, z, postMaterial, true);
      }
    }
  }

  private addCommsTower(steel: THREE.Material, darkOlive: THREE.Material): void {
    const baseX = 0.25;
    const baseZ = -6.15;
    this.addBox(1.25, 0.18, 1.25, baseX, 0.09, baseZ, darkOlive, true);
    for (const [height, radius] of [[1.35, 0.2], [2.25, 0.14], [3.1, 0.09]] as [number, number][]) {
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.04, height, 8), steel);
      segment.position.set(baseX, height / 2 + (height === 1.35 ? 0.18 : height === 2.25 ? 1.35 : 3.6), baseZ);
      segment.castShadow = true;
      this.group.add(segment);
    }
    for (const y of [1.45, 2.7, 4.45]) {
      const arm = this.addBox(1.25, 0.055, 0.055, baseX, y, baseZ, steel, false);
      arm.rotation.y = Math.PI / 4;
    }
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.16, 16), darkOlive);
    dish.position.set(baseX, 4.95, baseZ);
    dish.rotation.x = Math.PI;
    this.group.add(dish);
  }

  private addMedicalTent(canvas: THREE.Material, olive: THREE.Material, red: THREE.Material): void {
    const tent = new THREE.Group();
    tent.name = 'world1:medical-tent';
    tent.position.set(-2.7, 0, -0.3);
    this.group.add(tent);
    const tentMaterial = canvas.clone() as THREE.MeshStandardMaterial;
    if (this.loopCount >= 2) {
      tentMaterial.transparent = true;
      tentMaterial.opacity = 0.64;
      tentMaterial.side = THREE.DoubleSide;
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.35, 4, 1, true), tentMaterial);
    roof.position.y = 1.65;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    tent.add(roof);
    for (const [x, z] of [[-1.7, -1.3], [1.7, -1.3], [-1.7, 1.3], [1.7, 1.3]] as [number, number][]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), olive);
      pole.position.set(x, 0.8, z);
      tent.add(pole);
    }
    const cot = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.15, 0.7), olive);
    cot.position.set(-0.2, 0.52, -0.25);
    tent.add(cot);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.52), red);
    blanket.position.set(-0.45, 0.64, -0.25);
    tent.add(blanket);
    this.wallBoxes.push([-4.45, -0.95, -1.95, 1.35]);
  }

  private addTerminal(steel: THREE.Material, darkOlive: THREE.Material): void {
    const x = 3.35;
    const z = -4.85;
    this.addBox(1.12, 1.08, 0.28, x, 0.84, z, darkOlive, true);
    this.addBox(0.92, 0.72, 0.07, x, 1.02, z + 0.17, this.standard(0x0a1512, 0.5, 0.25), false);
    const screenMaterial = new THREE.MeshBasicMaterial({ color: this.loopCount >= 3 ? 0x79e0b5 : 0x5aa786 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.73, 0.42), screenMaterial);
    screen.position.set(x, 1.08, z + 0.215);
    screen.userData.interactable = true;
    screen.userData.promptText = this.loopCount >= 3 ? 'Inspect cleared route' : 'Use comms terminal';
    screen.userData.onInteract = () => this.useTerminal();
    this.group.add(screen);
    this.interactables.push(screen);
    this.addBox(0.9, 0.12, 0.48, x, 0.24, z, steel, true);
    this.terminalStatusLight = new THREE.PointLight(this.loopCount >= 3 ? 0x79e0b5 : 0x8ecf8d, 3.5, 2.8, 2);
    this.terminalStatusLight.position.set(x, 1.1, z + 0.35);
    this.group.add(this.terminalStatusLight);
    this.wallBoxes.push([x - 0.62, x + 0.62, z - 0.24, z + 0.24]);
  }

  private addSearchlight(): void {
    const pivot = new THREE.Group();
    pivot.name = 'world1:searchlight-pivot';
    pivot.position.set(0.25, 4.85, -6.15);
    this.group.add(pivot);
    this.sweepPivot = pivot;
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.72, 10), this.standard(0x303933, 0.58, 0.55));
    housing.rotation.z = Math.PI / 2;
    housing.position.set(0.34, 0, 0);
    pivot.add(housing);
    const colour = this.loopCount === 0 ? 0xcde9c7 : this.loopCount === 1 ? 0xffd79b : 0xe89c7d;
    const light = new THREE.SpotLight(colour, this.loopCount >= 3 ? 0 : 380, 22, Math.PI * 0.13, 0.55, 2);
    light.position.set(0.37, 0, 0);
    light.target.position.set(0, -3.7, -8);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    pivot.add(light, light.target);
    this.searchlight = light;
  }

  private addAtmosphere(): void {
    const ambient = new THREE.HemisphereLight(this.loopCount >= 1 ? 0xcbad78 : 0x859984, 0x252b25, this.loopCount >= 1 ? 0.9 : 0.72);
    this.group.add(ambient);
    const moon = new THREE.DirectionalLight(0x9aafc2, 1.15);
    moon.position.set(-5, 8, 3);
    moon.castShadow = true;
    moon.shadow.mapSize.set(512, 512);
    this.group.add(moon);
    const tentLamp = new THREE.PointLight(0xffc78c, 14, 5.4, 2);
    tentLamp.position.set(-2.7, 2.05, -0.3);
    this.group.add(tentLamp);
  }

  private addCharacters(): void {
    this.injuredSoldier = CharacterBuilder.create('soldier-injured', {
      position: new THREE.Vector3(-2.85, 0.25, 0.1),
      rotationY: Math.PI / 2,
    });
    this.group.add(this.injuredSoldier);
    this.makeCharacterInteractable(this.injuredSoldier, 'Check on injured soldier', () => this.speakToInjured());

    this.militaryVariant = CharacterBuilder.create('v1', {
      position: new THREE.Vector3(1.55, 0, 1.0),
      rotationY: Math.PI * 0.82,
    });
    this.group.add(this.militaryVariant);
    this.makeCharacterInteractable(this.militaryVariant, 'Talk to the sentry', () => this.speakToVariant());

    this.patrol = CharacterBuilder.create('soldier-patrol', {
      position: PATROL_POSITIONS[Math.min(this.loopCount, PATROL_POSITIONS.length - 1)].clone(),
      rotationY: Math.PI,
      visible: false,
    });
    this.group.add(this.patrol);
  }

  private makeCharacterInteractable(character: THREE.Group, promptText: string, onInteract: () => void): void {
    // InteractionSystem raycasts a flat mesh list without descendants, so an
    // explicit transparent volume is less fragile than selecting one nested
    // CharacterBuilder body part.
    const target = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 1.8, 0.62),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    target.position.y = 1.05;
    character.add(target);
    target.userData.interactable = true;
    target.userData.promptText = promptText;
    target.userData.onInteract = onInteract;
    this.interactables.push(target);
  }

  private speakToInjured(): void {
    if (this.cutscene.isPlaying || this.terminalBusy || this.loopCount >= 3) return;
    this.injuredClueFound = true;
    void this.audio.playSFX(RADIO_CRACKLE_URL, new THREE.Vector3(-2.85, 0.8, 0.1));
    this.playDialogue([
      { type: 'subtitle', text: 'Injured soldier: “The alarm is wrong. It restarts before the tower finishes its sweep.”', durationSec: 3.35 },
      { type: 'subtitle', text: '“Find the woman with the trident. She noticed what moved.”', durationSec: 2.8 },
    ], this.injuredSoldierFocus());
  }

  private speakToVariant(): void {
    if (this.cutscene.isPlaying || this.terminalBusy || this.loopCount >= 3) return;
    this.variantClueFound = true;
    const discrepancy = this.loopCount === 0
      ? '“That sandbag line was straight a moment ago. The outpost remembers a different version.”'
      : this.loopCount === 1
        ? '“The beam is warmer this pass. It is replaying us, imperfectly.”'
        : '“The tent is fading before the rest of us. Make the terminal hear the contradiction.”';
    this.playDialogue([
      { type: 'subtitle', text: 'Sentry: “I have seen this sweep before.”', durationSec: 2.1 },
      { type: 'subtitle', text: discrepancy, durationSec: 3.5 },
      { type: 'subtitle', text: '“Wake the comms only after you have listened to the wounded.”', durationSec: 2.8 },
    ], this.sentryFocus());
  }

  private useTerminal(): void {
    if (this.cutscene.isPlaying || this.terminalBusy || this.disposed) return;
    if (this.loopCount >= 3) {
      this.playDialogue([
        { type: 'subtitle', text: 'The alarm has stopped. A route beyond the outpost is open. [World 2 transition point — P7]', durationSec: 4.2 },
      ]);
      return;
    }
    if (!this.injuredClueFound || !this.variantClueFound) {
      const missing = !this.injuredClueFound
        ? 'The terminal is repeating static. The injured soldier may know why.'
        : 'The terminal needs one more contradiction. Speak to the sentry.';
      this.playDialogue([{ type: 'subtitle', text: missing, durationSec: 2.7 }]);
      return;
    }

    this.terminalBusy = true;
    this.sceneCutsceneActive = true;
    const finalPass = this.loopCount >= 2;
    const steps: CutsceneStep[] = [
      { type: 'sfx', url: RADIO_CRACKLE_URL, position: new THREE.Vector3(3.35, 1.08, -4.85) },
      { type: 'subtitle', text: 'COMMS: “ALARM RECORDED. REPLAY INDEX MISMATCH.”', durationSec: 2.65 },
      { type: 'callback', fn: () => this.breakSearchlight(finalPass) },
      { type: 'subtitle', text: finalPass ? 'The beam stops. For the first time, the outpost is quiet.' : 'The searchlight skips backward. The alarm begins again.', durationSec: 3.1 },
      { type: 'wait', durationSec: 0.5 },
    ];
    this.cutscene.play(steps, () => {
      this.sceneCutsceneActive = false;
      if (this.disposed || !this.state) return;
      this.state.world1LoopCount = finalPass ? 3 : this.loopCount + 1;
      this.reloadOutpost();
    }, { retainPointerLock: true });
  }

  private breakSearchlight(finalPass: boolean): void {
    if (this.searchlight) this.searchlight.intensity = finalPass ? 0 : 45;
    if (this.sweepPivot && !finalPass) this.sweepPivot.rotation.y += Math.PI * 0.8;
    if (this.terminalStatusLight) this.terminalStatusLight.color.setHex(finalPass ? 0x79e0b5 : 0xff7755);
  }

  private injuredSoldierFocus(): CutsceneFocus | undefined {
    if (!this.injuredSoldier) return undefined;
    const head = this.characterPartWorldPosition(this.injuredSoldier, 'head');
    const torso = this.characterPartWorldPosition(this.injuredSoldier, 'torso');
    if (!head || !torso) return undefined;

    // This character is rotated onto the cot. Its real head and torso both
    // sit near the ground, so a blend of those transformed points naturally
    // directs the player downward instead of at a standing-person height.
    return {
      target: head.lerp(torso, 0.35),
      durationSec: 0.48,
      easing: 'smooth',
    };
  }

  private sentryFocus(): CutsceneFocus | undefined {
    if (!this.militaryVariant) return undefined;
    const head = this.militaryVariant.getObjectByName('head');
    const torso = this.militaryVariant.getObjectByName('torso');
    const trishul = this.militaryVariant.getObjectByName('trishul');
    if (!head || !torso || !trishul) return undefined;

    this.militaryVariant.updateWorldMatrix(true, true);
    // Frame only the speaking silhouette and her Trishul—rather than the
    // transparent interaction collider or her legs—then bias upward enough
    // to keep the head comfortable while retaining the lower prop.
    const framingBounds = new THREE.Box3().setFromObject(head);
    framingBounds.expandByObject(torso);
    framingBounds.expandByObject(trishul);
    const target = framingBounds.getCenter(new THREE.Vector3());
    const size = framingBounds.getSize(new THREE.Vector3());
    target.y = framingBounds.min.y + size.y * 0.6;
    return {
      target,
      durationSec: 0.55,
      easing: 'smooth',
      minimumDistance: 3.1,
      returnDurationSec: 0.36,
    };
  }

  private characterPartWorldPosition(character: THREE.Group, partName: string): THREE.Vector3 | undefined {
    const part = character.getObjectByName(partName);
    if (!part) return undefined;
    character.updateWorldMatrix(true, true);
    return part.getWorldPosition(new THREE.Vector3());
  }

  private playDialogue(steps: CutsceneStep[], focus?: CutsceneFocus): void {
    this.sceneCutsceneActive = true;
    this.cutscene.play(steps, () => { this.sceneCutsceneActive = false; }, {
      retainPointerLock: true,
      ...(focus ? { focus } : {}),
    });
  }

  private triggerPatrolApparition(): void {
    if (!this.patrol || !this.group.parent || this.disposed) return;
    this.apparition?.cancel();
    const position = PATROL_POSITIONS[Math.min(this.loopCount, PATROL_POSITIONS.length - 1)];
    this.patrol.position.copy(position);
    this.apparition = apparitionAt(this.group.parent as THREE.Scene, this.patrol, position, 3.6);
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

const PATROL_POSITIONS = [
  new THREE.Vector3(-3.9, 0, -6.65),
  new THREE.Vector3(-2.5, 0, -3.55),
  new THREE.Vector3(-1.25, 0, -0.9),
];
