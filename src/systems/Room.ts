import * as THREE from 'three';

/**
 * Room — graybox geometry.
 *
 * Changes from original:
 *  - All objects are added to `this.group` (a THREE.Group), NOT directly to scene.
 *    The group is added to the scene once. Disposal removes the group cleanly.
 *  - Materials are instance-level so they can be disposed with the scene.
 *    Module-level shared materials have been removed.
 *  - All created BufferGeometry instances are tracked for disposal.
 *  - dispose(scene) is the single cleanup entry point — no scene.clear().
 */

const ROOM_W = 12;
const ROOM_D = 14;
const ROOM_H = 3.5;
const HALF_W = ROOM_W / 2;
const HALF_D = ROOM_D / 2;
const WALL_T = 0.25;

export class Room {
  // ── group owns everything this room adds to the Three.js scene ─────────────
  private readonly group: THREE.Group;

  // ── instance materials (all tracked; disposed on cleanup) ──────────────────
  private readonly matFloor: THREE.MeshStandardMaterial;
  private readonly matWall:  THREE.MeshStandardMaterial;
  private readonly matCeil:  THREE.MeshStandardMaterial;
  private readonly matProp:  THREE.MeshStandardMaterial;
  private readonly matBox:   THREE.MeshStandardMaterial;

  /** All materials owned by this Room instance (base + per-prop clones). */
  private readonly allMaterials: THREE.Material[] = [];

  /** All BufferGeometry instances created by this Room instance. */
  private readonly geometries: THREE.BufferGeometry[] = [];

  // ── public data exposed to gameplay systems ─────────────────────────────────
  /** [minX, maxX, minZ, maxZ] collision AABBs in world space. */
  readonly wallBoxes: Array<[number, number, number, number]> = [];

  /** Meshes tagged with userData.interactable = true. */
  readonly interactables: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    // Create group first so scene graph is correct before build methods run.
    this.group = new THREE.Group();
    scene.add(this.group);

    // Instance materials — safe to dispose later.
    this.matFloor = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.95, metalness: 0.0 });
    this.matWall  = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.9,  metalness: 0.0 });
    this.matCeil  = new THREE.MeshStandardMaterial({ color: 0x2e2e34, roughness: 1.0,  metalness: 0.0 });
    this.matProp  = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.7,  metalness: 0.1 });
    this.matBox   = new THREE.MeshStandardMaterial({ color: 0x6a5a45, roughness: 0.85, metalness: 0.0 });
    this.allMaterials.push(
      this.matFloor, this.matWall, this.matCeil, this.matProp, this.matBox
    );

    this.buildRoom();
    this.buildAmbientLighting();
    this.buildProps();
  }

  // ─── Explicit scene cleanup ─────────────────────────────────────────────────

  /**
   * Remove all scene objects this Room added, and dispose their GPU resources.
   * After calling this, the Room instance must not be used again.
   * Never calls scene.clear() — only removes what this Room owns.
   */
  dispose(scene: THREE.Scene): void {
    // Dispose every geometry created by this room.
    for (const geo of this.geometries) geo.dispose();

    // Dispose every material (base + per-prop clones).
    for (const mat of this.allMaterials) mat.dispose();

    // Remove the group from the scene. This removes all child meshes and lights.
    scene.remove(this.group);

    // Clear the arrays so this instance is obviously dead.
    this.geometries.length    = 0;
    this.allMaterials.length  = 0;
    this.wallBoxes.length     = 0;
    this.interactables.length = 0;
  }

  // ─── Room shell ────────────────────────────────────────────────────────────

  private buildRoom() {
    this.addBox(ROOM_W, 0.1, ROOM_D,  0,          -0.05,          0, this.matFloor, false); // floor
    this.addBox(ROOM_W, 0.1, ROOM_D,  0,  ROOM_H + 0.05,          0, this.matCeil,  false); // ceiling

    this.addWall( 0,       ROOM_H / 2, -HALF_D, ROOM_W, ROOM_H, WALL_T); // back
    this.addWall( 0,       ROOM_H / 2,  HALF_D, ROOM_W, ROOM_H, WALL_T); // front
    this.addWall( HALF_W,  ROOM_H / 2,  0,      WALL_T, ROOM_H, ROOM_D); // right
    this.addWall(-HALF_W,  ROOM_H / 2,  0,      WALL_T, ROOM_H, ROOM_D); // left
  }

  private addWall(x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = this.addBox(w, h, d, x, y, z, this.matWall, true);
    mesh.userData.isWall = true;

    // Box3.setFromObject calls updateWorldMatrix internally.
    // Since this.group is at origin, world pos == local pos — AABBs are correct.
    const box = new THREE.Box3().setFromObject(mesh);
    this.wallBoxes.push([box.min.x, box.max.x, box.min.z, box.max.z]);
  }

  // ─── Ambient / decorative lighting ────────────────────────────────────────

  private buildAmbientLighting() {
    const ambient = new THREE.AmbientLight(0x1a1a2e, 0.5);
    this.group.add(ambient);

    const hemi = new THREE.HemisphereLight(0x1a1a2e, 0x0a0a0f, 0.3);
    this.group.add(hemi);

    this.addSconce(-HALF_W + 0.3, 2.5, -3);
    this.addSconce( HALF_W - 0.3, 2.5,  3);
  }

  private addSconce(x: number, y: number, z: number) {
    const light = new THREE.PointLight(0x4060a0, 0.6, 5, 2);
    light.position.set(x, y, z);
    light.castShadow = false;
    this.group.add(light);

    const geo = new THREE.SphereGeometry(0.06, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4060a0 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(x, y, z);
    this.group.add(sphere);

    // Track for disposal.
    this.geometries.push(geo);
    this.allMaterials.push(mat);
  }

  // ─── Graybox props ─────────────────────────────────────────────────────────

  private buildProps() {
    // Concrete pillar
    this.addBox(0.6, 3.5, 0.6, -3, 1.75, -4, this.matProp, true);

    // Table surface + legs
    this.addBox(1.6, 0.08, 0.8, 2, 0.9, -3, this.matProp, true);
    for (const [lx, lz] of [[ 0.7, 0.35], [-0.7, 0.35], [ 0.7,-0.35], [-0.7,-0.35]] as [number, number][]) {
      this.addBox(0.06, 0.9, 0.06, 2 + lx, 0.45, -3 + lz, this.matProp, false);
    }

    // Crate (interactable) — uses shared matBox, which is already in allMaterials.
    const crate = this.addBox(0.5, 0.5, 0.5, 2, 1.15, -3, this.matBox, true);
    crate.userData.interactable = true;
    crate.userData.promptText   = 'Inspect crate';
    crate.userData.onInteract   = () => {
      let rot = 0;
      const spin = () => {
        rot += 0.05;
        crate.rotation.y = rot;
        if (rot < Math.PI * 2) requestAnimationFrame(spin);
        else crate.rotation.y = 0;
      };
      spin();
    };
    this.interactables.push(crate);

    // Shelf
    this.addBox(1.2, 2.4, 0.35, -2, 1.2, -HALF_D + 0.45, this.matProp, true);

    // Barrel — CLONED material so the colour-toggle doesn't affect shared matBox.
    const barrelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.7, 16);
    const barrelMat = this.matBox.clone(); // per-instance; tracked separately.
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(-1.5, 0.35, 1.5);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    barrel.userData.interactable = true;
    barrel.userData.promptText   = 'Check barrel';
    barrel.userData.onInteract   = () => {
      barrelMat.color.setHex(barrelMat.color.getHex() === 0x6a5a45 ? 0x80c070 : 0x6a5a45);
    };
    this.group.add(barrel);
    this.geometries.push(barrelGeo);
    this.allMaterials.push(barrelMat);      // separate from shared matBox
    this.interactables.push(barrel);

    // Orb on table — fresh geometry and material.
    const sphereGeo = new THREE.SphereGeometry(0.12, 16, 12);
    const sphereMat = new THREE.MeshStandardMaterial({ color: 0x88aadd, roughness: 0.3, metalness: 0.4 });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(2.3, 1.07, -3.2);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    sphere.userData.interactable = true;
    sphere.userData.promptText   = 'Pick up orb';
    sphere.userData.onInteract   = () => { sphere.visible = !sphere.visible; };
    this.group.add(sphere);
    this.geometries.push(sphereGeo);
    this.allMaterials.push(sphereMat);
    this.interactables.push(sphere);
  }

  // ─── Helper ────────────────────────────────────────────────────────────────

  private addBox(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mat: THREE.MeshStandardMaterial,
    castShadow: boolean
  ): THREE.Mesh {
    const geo  = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow    = castShadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);       // ← group, never scene directly
    this.geometries.push(geo);  // ← tracked for disposal
    return mesh;
  }
}
