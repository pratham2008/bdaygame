import * as THREE from 'three';
import { CharacterBuilder } from '../systems/CharacterBuilder.js';
import type { CutsceneDirector, CutsceneStep } from '../systems/CutsceneDirector.js';
import { apparitionAt, type EffectHandle } from '../systems/HorrorEffects.js';
import type { IScene, GameState, SceneName, SceneResult } from './types.js';

interface PrologueDependencies {
  readonly cutscene: CutsceneDirector;
  /** Lets GameManager start the opening only after the Start-button gesture. */
  readonly onOpeningReady: (start: () => void) => void;
  /** Called after the non-interactive opening so GameManager can request lock. */
  readonly onOpeningComplete: () => void;
}

type TelevisionState = 'news' | 'static' | 'after';
type MonitorState = 'sleep' | 'terminal' | 'connected';

/**
 * Anaaya's bedroom and the first story beat.  Everything added by this class
 * lives under `group`, apart from no persistent game systems, so the normal
 * scene lifecycle can remove it without disturbing camera or flashlight.
 */
export class PrologueScene implements IScene {
  readonly name: SceneName = 'prologue';

  private readonly cutscene: CutsceneDirector;
  private readonly onOpeningReady: (start: () => void) => void;
  private readonly onOpeningComplete: () => void;
  private readonly group = new THREE.Group();
  private readonly interactables: THREE.Mesh[] = [];
  private readonly wallBoxes: Array<[number, number, number, number]> = [];
  private readonly textures = new Set<THREE.Texture>();

  private tvCanvas: HTMLCanvasElement | null = null;
  private tvTexture: THREE.CanvasTexture | null = null;
  private monitorCanvas: HTMLCanvasElement | null = null;
  private monitorTexture: THREE.CanvasTexture | null = null;
  private tvSilhouette: THREE.Group | null = null;
  private visitor: THREE.Group | null = null;
  private visitorLight: THREE.PointLight | null = null;
  private apparition: EffectHandle | null = null;

  private built = false;
  private disposed = false;
  private openingStarted = false;
  private openingComplete = false;
  private terminalStarted = false;
  private visitorRevealed = false;
  private sceneCutsceneActive = false;
  private elapsed = 0;
  private staticElapsed = 0;
  private televisionState: TelevisionState = 'news';
  private monitorState: MonitorState = 'sleep';
  private wrongDirectionCueAt: number | null = null;

  constructor(dependencies: PrologueDependencies) {
    this.cutscene = dependencies.cutscene;
    this.onOpeningReady = dependencies.onOpeningReady;
    this.onOpeningComplete = dependencies.onOpeningComplete;
  }

  build(scene: THREE.Scene, _state: Readonly<GameState>): SceneResult {
    this.built = true;
    this.disposed = false;
    this.group.name = 'scene:prologue-bedroom';
    scene.add(this.group);

    this.buildBedroom();
    this.onOpeningReady(this.beginOpening);

    return {
      wallBoxes: this.wallBoxes,
      interactables: this.interactables,
      spawnPoint: new THREE.Vector3(0, 0, 2.7),
    };
  }

  update(dt: number, _state: GameState): void {
    if (!this.built || this.disposed) return;
    this.elapsed += dt;
    this.staticElapsed += dt;

    // A lightweight, procedural television texture: it stays legible during
    // the report and becomes subtly wrong after the player gets control.
    if (this.staticElapsed >= 0.14) {
      this.staticElapsed = 0;
      this.drawTelevision();
    }

    if (this.openingComplete && !this.visitorRevealed && this.elapsed > 10 && this.wrongDirectionCueAt === null) {
      this.wrongDirectionCueAt = this.elapsed;
      this.televisionState = 'after';
    }
    if (this.wrongDirectionCueAt !== null && this.visitorLight) {
      const age = this.elapsed - this.wrongDirectionCueAt;
      // The cold glint comes from beside the bed while the TV is elsewhere.
      this.visitorLight.intensity = age < 0.45 ? 0.7 * (1 - age / 0.45) : 0;
      if (age > 0.45) this.wrongDirectionCueAt = null;
    }
  }

  dispose(scene: THREE.Scene): void {
    this.disposed = true;
    this.apparition?.cancel();
    this.apparition = null;
    if (this.sceneCutsceneActive) this.cutscene.stop();
    this.sceneCutsceneActive = false;

    if (this.tvSilhouette) CharacterBuilder.dispose(this.tvSilhouette);
    if (this.visitor) CharacterBuilder.dispose(this.visitor);
    this.tvSilhouette = null;
    this.visitor = null;

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    scene.remove(this.group);

    this.interactables.length = 0;
    this.wallBoxes.length = 0;
    this.tvCanvas = null;
    this.tvTexture = null;
    this.monitorCanvas = null;
    this.monitorTexture = null;
    this.visitorLight = null;
    this.built = false;
  }

  private beginOpening = (): void => {
    if (!this.built || this.disposed || this.openingStarted) return;
    this.openingStarted = true;
    this.sceneCutsceneActive = true;
    this.drawTelevision();

    const tvPosition = new THREE.Vector3(-1.55, 2.05, -3.55);
    const cameraPosition = new THREE.Vector3(-0.4, 1.75, 1.05);
    const steps: CutsceneStep[] = [
      { type: 'fade', direction: 'out', durationSec: 0.15 },
      { type: 'wait', durationSec: 0.12 },
      { type: 'fade', direction: 'in', durationSec: 0.55 },
      {
        type: 'cameraAnim',
        targetPos: cameraPosition,
        targetQuat: lookAtQuaternion(cameraPosition, tvPosition),
        durationSec: 0.9,
        easing: 'smooth',
      },
      { type: 'subtitle', text: 'LOCAL NEWS • 9:43 PM', durationSec: 1.25 },
      {
        type: 'subtitle',
        text: 'Police continue their search after a young woman was found frightened and alone near the old service road.',
        durationSec: 3.6,
      },
      {
        type: 'subtitle',
        text: 'Authorities have released few details. The suspect remains at large.',
        durationSec: 3.1,
        clearAfter: false,
      },
      { type: 'callback', fn: () => this.showTelevisionSilhouette() },
      { type: 'wait', durationSec: 0.9 },
      { type: 'callback', fn: () => { this.televisionState = 'after'; this.drawTelevision(); } },
      { type: 'wait', durationSec: 0.55 },
    ];

    this.cutscene.play(steps, () => {
      this.sceneCutsceneActive = false;
      if (this.disposed) return;
      this.openingComplete = true;
      this.onOpeningComplete();
    }, { retainPointerLock: true });
  };

  private startTerminalSequence(): void {
    if (!this.openingComplete || this.terminalStarted || this.disposed) return;
    this.terminalStarted = true;
    this.sceneCutsceneActive = true;

    const monitorPosition = new THREE.Vector3(2.05, 1.35, -2.55);
    const cameraPosition = new THREE.Vector3(2.05, 1.56, -1.45);
    const steps: CutsceneStep[] = [
      {
        type: 'cameraAnim',
        targetPos: cameraPosition,
        targetQuat: lookAtQuaternion(cameraPosition, monitorPosition),
        durationSec: 0.65,
        easing: 'smooth',
      },
      { type: 'callback', fn: () => { this.monitorState = 'terminal'; this.drawMonitor(); } },
      { type: 'subtitle', text: 'CONNECTION RESTORED', durationSec: 1.4 },
      { type: 'subtitle', text: 'SESSION FOUND', durationSec: 1.15 },
      { type: 'subtitle', text: 'PARTICIPANTS: 2', durationSec: 1.65 },
      { type: 'callback', fn: () => this.revealVisitor() },
      { type: 'subtitle', text: '“Anaaya.”', durationSec: 1.1 },
      { type: 'subtitle', text: '“You still leave your notes open beside the screen.”', durationSec: 2.45 },
      { type: 'subtitle', text: '“Please. I need your help.”', durationSec: 1.8 },
      { type: 'subtitle', text: '“Do not trust the first version of anything.”', durationSec: 2.35 },
      { type: 'callback', fn: () => { this.monitorState = 'connected'; this.drawMonitor(); } },
    ];
    this.cutscene.play(steps, () => {
      this.sceneCutsceneActive = false;
      if (this.disposed) return;
      this.visitorRevealed = true;
    }, { retainPointerLock: true });
  }

  private showTelevisionSilhouette(): void {
    if (!this.tvSilhouette || this.disposed) return;
    this.apparition?.cancel();
    this.apparition = apparitionAt(
      // It is already parented to this scene-owned group. apparitionAt will
      // therefore only reveal/hide it and never claim or detach it.
      this.group.parent as THREE.Scene,
      this.tvSilhouette,
      new THREE.Vector3(-1.55, 0.72, -3.69),
      0.8,
    );
  }

  private revealVisitor(): void {
    if (!this.visitor || this.disposed) return;
    this.visitor.visible = true;
    this.visitorLight!.intensity = 0.8;
  }

  private buildBedroom(): void {
    const wall = this.standard(0x312d37, 0.95);
    const floor = this.standard(0x1d1a22, 0.98);
    const wood = this.standard(0x4a3028, 0.82);
    const darkWood = this.standard(0x221919, 0.9);
    const fabric = this.standard(0x29233c, 0.95);
    const paper = this.standard(0xd7cfaf, 0.98);

    this.addBox(8, 0.12, 8, 0, -0.06, 0, floor);
    this.addBox(8, 0.1, 8, 0, 3.35, 0, this.standard(0x211e28, 1));
    this.addWall(0, 1.65, -4, 8, 3.3, 0.16, wall);
    this.addWall(0, 1.65, 4, 8, 3.3, 0.16, wall);
    this.addWall(-4, 1.65, 0, 0.16, 3.3, 8, wall);
    this.addWall(4, 1.65, 0, 0.16, 3.3, 8, wall);

    // The dark painted materials need a broad bounced-light baseline, not a
    // brighter hotspot. This keeps the whole bedroom readable during normal
    // exploration while the shadow-casting ceiling fixture still models it.
    const ambient = new THREE.AmbientLight(0xb8adb0, 1.15);
    this.group.add(ambient);
    const skyFill = new THREE.HemisphereLight(0xffe6cc, 0x625568, 1.05);
    this.group.add(skyFill);
    // PointLight uses candela in the current Three.js renderer. A practical
    // ceiling fixture therefore needs a real room-scale output rather than a
    // single-digit legacy-light value.
    const ceiling = new THREE.PointLight(0xffd2a5, 100, 12.5, 2);
    // Keep the source below the ceiling plane: a point source immediately
    // beneath it creates a distracting inverse-square hotspot overhead.
    ceiling.position.set(-0.25, 2.35, 0);
    ceiling.castShadow = true;
    this.group.add(ceiling);
    // A soft reflected fill toward the bed prevents the left half of the
    // room from falling to black, but remains too gentle to cast a second
    // obvious set of shadows.
    const bedFill = new THREE.PointLight(0xffd8b5, 18, 6.5, 2);
    bedFill.position.set(-3.05, 1.9, 1.45);
    this.group.add(bedFill);
    const roomFill = new THREE.PointLight(0xffdfc0, 24, 10, 2);
    roomFill.position.set(0.65, 2.05, 2.9);
    this.group.add(roomFill);
    // Screens should read as on, but their pools stay local so the room still
    // belongs to the overhead lamp during ordinary exploration.
    const televisionGlow = new THREE.PointLight(0x6b9dff, 4, 4.5, 2);
    televisionGlow.position.set(-1.55, 2.05, -3.45);
    this.group.add(televisionGlow);
    const deskLamp = new THREE.PointLight(0xffc982, 8, 3.1, 2);
    deskLamp.position.set(2.58, 1.48, -2.42);
    this.group.add(deskLamp);
    const monitorGlow = new THREE.PointLight(0x69c6aa, 3, 2.25, 2);
    monitorGlow.position.set(2.05, 1.35, -2.72);
    this.group.add(monitorGlow);
    this.visitorLight = new THREE.PointLight(0x7b90b8, 0, 3.2, 2);
    this.visitorLight.position.set(2.7, 1.6, 1.45);
    this.group.add(this.visitorLight);

    // Bed: tucked to the left wall with a blanket and pillow rather than a
    // generic crate, giving the compact room a recognisable silhouette.
    this.addBox(2.35, 0.32, 1.55, -2.65, 0.32, 1.7, wood, true);
    this.addBox(2.2, 0.18, 1.42, -2.65, 0.58, 1.7, fabric, true);
    this.addBox(0.78, 0.15, 0.5, -3.35, 0.76, 1.7, paper, true);
    this.addBox(2.35, 0.85, 0.13, -3.75, 0.72, 1.7, darkWood, true);
    this.wallBoxes.push([-3.9, -1.4, 0.85, 2.55]);

    // Desk and computer face into the room, so its screen is naturally
    // reachable from the player's spawn and remains a real raycast target.
    this.addBox(1.85, 0.1, 0.78, 2.05, 0.92, -2.75, wood, true);
    for (const [x, z] of [[1.25, -3.05], [2.85, -3.05], [1.25, -2.45], [2.85, -2.45]] as [number, number][]) {
      this.addBox(0.08, 0.9, 0.08, x, 0.45, z, darkWood, true);
    }
    this.addBox(0.96, 0.63, 0.1, 2.05, 1.32, -3.03, this.standard(0x12151b, 0.45, 0.35), true);
    const monitor = this.addCanvasPlane(0.82, 0.47, 2.05, 1.34, -2.97, this.createMonitorTexture());
    monitor.userData.interactable = true;
    monitor.userData.promptText = 'Use computer';
    monitor.userData.onInteract = () => this.startTerminalSequence();
    this.interactables.push(monitor);
    this.addBox(0.72, 0.04, 0.3, 2.05, 0.99, -2.45, this.standard(0x111319, 0.75), false);
    this.addBox(0.18, 0.22, 0.15, 2.05, 0.96, -2.96, darkWood, true);
    this.wallBoxes.push([1.05, 3.05, -3.25, -2.25]);

    // Bookshelf and individual coloured spines give the room a personal,
    // studied-in quality without relying on external textures.
    this.addBox(1.25, 2.3, 0.36, 3.18, 1.15, 1.9, darkWood, true);
    for (const y of [0.45, 1.1, 1.75]) this.addBox(1.12, 0.055, 0.42, 3.18, y, 1.9, wood, false);
    const bookColours = [0x943e42, 0x2b587b, 0x587348, 0xc18b43, 0x594366, 0x4b5b69];
    for (let i = 0; i < 12; i += 1) {
      const row = Math.floor(i / 4);
      this.addBox(0.16, 0.34 + (i % 2) * 0.08, 0.18, 2.78 + (i % 4) * 0.25, 0.67 + row * 0.65, 1.66, this.standard(bookColours[i % bookColours.length], 0.8), true);
    }
    this.wallBoxes.push([2.5, 3.85, 1.55, 2.3]);

    // Wall-mounted television and reflection plane.
    this.addBox(2.75, 1.72, 0.12, -1.55, 2.02, -3.89, this.standard(0x111117, 0.4, 0.45), true);
    this.addCanvasPlane(2.42, 1.42, -1.55, 2.02, -3.80, this.createTelevisionTexture());
    this.addBox(0.34, 0.08, 0.28, -1.55, 1.1, -3.64, darkWood, true);
    this.addBox(0.9, 0.08, 0.2, -1.55, 0.99, -3.64, darkWood, true);

    // Pinned notes communicate Anaaya's school and medical ambitions through
    // the environment: no exposition is needed in dialogue.
    this.addCanvasPlane(1.12, 0.76, -3.55, 2.05, -1.25, this.createNoteTexture('CLASS XII BIOLOGY\nREVISION: HUMAN ANATOMY'));
    this.addCanvasPlane(0.9, 0.55, -3.54, 1.14, -1.2, this.createNoteTexture('MBBS\nARMY MEDICAL CORPS', 0xeee3c4));
    this.addBox(0.7, 1.85, 0.12, 3.93, 1.0, -0.35, this.standard(0x3a292a, 0.92), true);
    this.addBox(0.95, 1.7, 0.05, 3.86, 1.5, -0.35, this.standard(0x101725, 0.3, 0.6), false);

    // A closed bedroom door is the deliberate P5 transition placeholder.
    const door = this.addBox(1.2, 2.35, 0.08, 1.25, 1.18, 3.88, this.standard(0x382629, 0.9), true);
    door.userData.interactable = true;
    door.userData.promptText = 'Listen at the door';
    door.userData.onInteract = () => this.playTransitionPlaceholder();
    this.interactables.push(door);

    this.tvSilhouette = this.makeSilhouette(new THREE.Vector3(-1.55, 0.72, -3.69), 0.57);
    this.tvSilhouette.visible = false;
    this.group.add(this.tvSilhouette);
    this.visitor = this.makeSilhouette(new THREE.Vector3(2.7, 0, 1.25), 0.92);
    this.visitor.rotation.y = Math.PI;
    this.visitor.visible = false;
    this.group.add(this.visitor);

    this.drawTelevision();
    this.drawMonitor();
  }

  private playTransitionPlaceholder(): void {
    if (!this.visitorRevealed || this.cutscene.isPlaying) return;
    this.sceneCutsceneActive = true;
    this.cutscene.play([
      { type: 'subtitle', text: 'The signal is pulling at the door.', durationSec: 1.8 },
      { type: 'subtitle', text: 'World 1 awaits beyond this point. [P5 transition placeholder]', durationSec: 2.3 },
    ], () => { this.sceneCutsceneActive = false; }, { retainPointerLock: true });
  }

  private makeSilhouette(position: THREE.Vector3, scale: number): THREE.Group {
    const character = CharacterBuilder.create('anaaya', { position, scale });
    character.name = 'prologue:visitor-silhouette';
    character.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.setHex(0x030408);
          material.emissive.setHex(0x07101d);
          material.emissiveIntensity = 0.32;
          material.roughness = 0.85;
        } else if (material instanceof THREE.MeshBasicMaterial) {
          material.color.setHex(0x030408);
        }
      }
    });
    return character;
  }

  private createTelevisionTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 300;
    this.tvCanvas = canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.tvTexture = texture;
    this.textures.add(texture);
    return texture;
  }

  private createMonitorTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 300;
    this.monitorCanvas = canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.monitorTexture = texture;
    this.textures.add(texture);
    return texture;
  }

  private createNoteTexture(text: string, colour = 0xd7cfaf): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 220;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${new THREE.Color(colour).getHexString()}`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#302b2a';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    text.split('\n').forEach((line, index) => ctx.fillText(line, canvas.width / 2, 76 + index * 42));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.add(texture);
    return texture;
  }

  private drawTelevision(): void {
    const canvas = this.tvCanvas;
    const texture = this.tvTexture;
    if (!canvas || !texture) return;
    const ctx = canvas.getContext('2d')!;
    const { width, height } = canvas;
    ctx.fillStyle = this.televisionState === 'news' ? '#071326' : '#080b10';
    ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < height; y += 4) {
      const shade = 8 + ((Math.floor((this.elapsed * 46 + y) * 13) % 22 + 22) % 22);
      ctx.fillStyle = `rgba(${shade},${shade + 8},${shade + 20},0.24)`;
      ctx.fillRect(0, y, width, 2);
    }
    if (this.televisionState === 'news') {
      ctx.fillStyle = '#dceaff';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('CHANNEL 8  |  LOCAL NEWS', 24, 38);
      ctx.fillStyle = '#b8c9e4';
      ctx.font = '22px sans-serif';
      ctx.fillText('INVESTIGATION ONGOING', 24, 92);
      ctx.fillStyle = '#a2b4cf';
      ctx.font = '16px sans-serif';
      ctx.fillText('Police advise residents to remain alert.', 24, 128);
      ctx.fillStyle = '#9e1f30';
      ctx.fillRect(0, 245, width, 55);
      ctx.fillStyle = '#fff1ef';
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText('SUSPECT REMAINS AT LARGE', 24, 279);
    } else if (this.televisionState === 'after') {
      ctx.fillStyle = '#c3d7e8';
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText('...THE SUSPECT REMAINS...', 30, 250);
      ctx.fillStyle = '#7f9eb8';
      ctx.font = '15px sans-serif';
      ctx.fillText('caption delay: 00:00:02', 30, 278);
    } else {
      ctx.fillStyle = '#8294a8';
      ctx.font = '18px monospace';
      ctx.fillText('NO SIGNAL', 190, 155);
    }
    texture.needsUpdate = true;
  }

  private drawMonitor(): void {
    const canvas = this.monitorCanvas;
    const texture = this.monitorTexture;
    if (!canvas || !texture) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#070b0b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4ea98b';
    ctx.font = '18px monospace';
    if (this.monitorState === 'sleep') {
      ctx.fillText('anaaya@home:~$', 30, 56);
      ctx.fillStyle = '#7c8d87';
      ctx.fillText('biology_notes.txt', 30, 95);
      ctx.fillText('army_medical_colleges.md', 30, 124);
    } else {
      ctx.fillText('CONNECTION RESTORED', 30, 58);
      ctx.fillText('SESSION FOUND', 30, 98);
      ctx.fillStyle = '#e6c871';
      ctx.fillText('PARTICIPANTS: 2', 30, 144);
      if (this.monitorState === 'connected') {
        ctx.fillStyle = '#93bba7';
        ctx.fillText('remote session waiting...', 30, 202);
      }
    }
    texture.needsUpdate = true;
  }

  private addWall(x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material): void {
    this.addBox(width, height, depth, x, y, z, material, true);
    this.wallBoxes.push([x - width / 2, x + width / 2, z - depth / 2, z + depth / 2]);
  }

  private addCanvasPlane(width: number, height: number, x: number, y: number, z: number, texture: THREE.Texture): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }

  private addBox(width: number, height: number, depth: number, x: number, y: number, z: number, material: THREE.Material, castsShadow = false): THREE.Mesh {
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

function lookAtQuaternion(position: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)),
  );
}
