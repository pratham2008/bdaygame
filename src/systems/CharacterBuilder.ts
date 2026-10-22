import * as THREE from 'three';

export const CHARACTER_IDS = [
  'anaaya',
  'v1',
  'v2-clean',
  'v2-bloody',
  'v3',
  'v4',
  'path1605',
  'beggar',
  'beggar-threat',
  'youngWoman',
  'soldier-patrol',
  'soldier-injured',
  'woman-long-hair',
  'woman-short-hair',
  'threat-thug',
] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

export interface CharacterBuildOptions {
  position?: THREE.Vector3;
  rotationY?: number;
  scale?: number;
  visible?: boolean;
}

interface MaterialSpec {
  color: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  basic?: boolean;
}

interface HumanoidSpec {
  skin: MaterialSpec;
  clothes: MaterialSpec;
  hair?: MaterialSpec;
  torsoWidth?: number;
  torsoHeight?: number;
  headScale?: number;
  shoulders?: number;
}

const SKIN_ANAAYA: MaterialSpec = { color: 0x8b5a43, roughness: 0.88 };
const SKIN_DARK: MaterialSpec = { color: 0x3b2518, roughness: 0.9 };
const SKIN_NEUTRAL: MaterialSpec = { color: 0x8a6e60, roughness: 0.9 };
const HAIR_BLACK: MaterialSpec = { color: 0x111016, roughness: 0.95 };
const IVORY_BASIC: MaterialSpec = { color: 0xeee4ca, basic: true };

const HUMANOID_SPECS: Record<Exclude<CharacterId, 'path1605'>, HumanoidSpec> = {
  anaaya: { skin: SKIN_ANAAYA, clothes: { color: 0x25223e, roughness: 0.9 }, hair: HAIR_BLACK },
  v1: { skin: SKIN_NEUTRAL, clothes: { color: 0x465538, roughness: 0.92 }, hair: { color: 0x2c3028 } },
  'v2-clean': { skin: SKIN_NEUTRAL, clothes: { color: 0x62656d, roughness: 0.9 }, hair: { color: 0x25252a } },
  'v2-bloody': { skin: SKIN_NEUTRAL, clothes: { color: 0x4f4345, roughness: 0.9 }, hair: { color: 0x25252a } },
  v3: { skin: SKIN_DARK, clothes: { color: 0x241729, roughness: 0.95 }, hair: HAIR_BLACK },
  v4: { skin: SKIN_ANAAYA, clothes: { color: 0x47465a, roughness: 0.9 }, hair: { color: 0x77747b } },
  beggar: { skin: SKIN_NEUTRAL, clothes: { color: 0x584a38, roughness: 1 }, hair: { color: 0x29251f } },
  'beggar-threat': { skin: SKIN_NEUTRAL, clothes: { color: 0x4b382f, roughness: 1 }, hair: { color: 0x29251f } },
  youngWoman: { skin: SKIN_ANAAYA, clothes: { color: 0x40506d, roughness: 0.9 }, hair: { color: 0x21181b } },
  'soldier-patrol': { skin: { color: 0x1d241b, roughness: 1 }, clothes: { color: 0x273123, roughness: 1 }, hair: { color: 0x1b2119 } },
  'soldier-injured': { skin: SKIN_NEUTRAL, clothes: { color: 0x526047, roughness: 1 }, hair: { color: 0x272b22 } },
  'woman-long-hair': { skin: SKIN_ANAAYA, clothes: { color: 0x6c4959, roughness: 0.9 }, hair: { color: 0x281b20 } },
  'woman-short-hair': { skin: SKIN_ANAAYA, clothes: { color: 0x5a6178, roughness: 0.9 }, hair: { color: 0x261e20 } },
  'threat-thug': { skin: SKIN_NEUTRAL, clothes: { color: 0x34333b, roughness: 0.95 }, hair: { color: 0x1d1d20 } },
};

/**
 * Procedural, low-poly character factory. Every returned group owns its own
 * materials and geometry and exposes consistent animation pivots: head,
 * torso, leftArm, rightArm, leftLeg, and rightLeg.
 */
export class CharacterBuilder {
  static create(id: CharacterId, options: CharacterBuildOptions = {}): THREE.Group {
    const character = id === 'path1605'
      ? this.createSkeleton()
      : this.createHumanoid(id, HUMANOID_SPECS[id]);

    character.name = `character:${id}`;
    character.userData.characterId = id;
    if (options.position) character.position.copy(options.position);
    character.rotation.y = options.rotationY ?? 0;
    character.scale.setScalar(options.scale ?? 1);
    character.visible = options.visible ?? true;
    return character;
  }

  /** Dispose only resources owned by this character group, then detach it. */
  static dispose(character: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    character.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    character.parent?.remove(character);
  }

  private static createHumanoid(id: Exclude<CharacterId, 'path1605'>, spec: HumanoidSpec): THREE.Group {
    const root = new THREE.Group();
    const skin = this.material(spec.skin);
    const clothes = this.material(spec.clothes);
    const hair = spec.hair ? this.material(spec.hair) : null;
    const width = spec.torsoWidth ?? 0.46;
    const torsoHeight = spec.torsoHeight ?? 0.64;
    const headScale = spec.headScale ?? 1;
    const shoulder = spec.shoulders ?? 0.34;

    const torso = this.part(root, 'torso', 0, 1.38, 0);
    this.box(torso, width, torsoHeight, 0.26, 0, 0, 0, clothes);

    const head = this.part(root, 'head', 0, 1.9, 0);
    this.sphere(head, 0.22 * headScale, 0, 0, 0, skin);
    if (hair) this.addHair(head, hair, 0.18);

    const leftArm = this.part(root, 'leftArm', -shoulder, 1.61, 0);
    const rightArm = this.part(root, 'rightArm', shoulder, 1.61, 0);
    this.cylinder(leftArm, 0.09, 0.09, 0.58, 0, -0.29, 0, clothes);
    this.cylinder(rightArm, 0.09, 0.09, 0.58, 0, -0.29, 0, clothes);
    this.sphere(leftArm, 0.105, 0, -0.61, 0, skin);
    this.sphere(rightArm, 0.105, 0, -0.61, 0, skin);

    const leftLeg = this.part(root, 'leftLeg', -0.14, 0.88, 0);
    const rightLeg = this.part(root, 'rightLeg', 0.14, 0.88, 0);
    this.cylinder(leftLeg, 0.1, 0.1, 0.72, 0, -0.36, 0, clothes);
    this.cylinder(rightLeg, 0.1, 0.1, 0.72, 0, -0.36, 0, clothes);

    this.addIdentityDetails(root, id, { skin, clothes, hair });
    return root;
  }

  private static createSkeleton(): THREE.Group {
    const root = new THREE.Group();
    const bone = this.material(IVORY_BASIC);
    const torso = this.part(root, 'torso', 0, 0.95, 0.16);
    torso.rotation.x = 0.2;
    this.box(torso, 0.34, 0.5, 0.18, 0, 0, 0, bone);

    const head = this.part(root, 'head', 0, 1.4, 0.04);
    this.sphere(head, 0.2, 0, 0, 0, bone);
    const leftArm = this.part(root, 'leftArm', -0.28, 1.12, 0.06);
    const rightArm = this.part(root, 'rightArm', 0.28, 1.12, 0.06);
    leftArm.rotation.x = -1.1;
    rightArm.rotation.x = -1.1;
    this.cylinder(leftArm, 0.045, 0.045, 0.6, 0, -0.3, 0, bone);
    this.cylinder(rightArm, 0.045, 0.045, 0.6, 0, -0.3, 0, bone);
    const leftLeg = this.part(root, 'leftLeg', -0.13, 0.64, 0.12);
    const rightLeg = this.part(root, 'rightLeg', 0.13, 0.64, 0.12);
    leftLeg.rotation.x = -1.05;
    rightLeg.rotation.x = -1.05;
    this.cylinder(leftLeg, 0.05, 0.05, 0.65, 0, -0.32, 0, bone);
    this.cylinder(rightLeg, 0.05, 0.05, 0.65, 0, -0.32, 0, bone);
    return root;
  }

  private static addIdentityDetails(
    root: THREE.Group,
    id: Exclude<CharacterId, 'path1605'>,
    materials: { skin: THREE.Material; clothes: THREE.Material; hair: THREE.Material | null },
  ): void {
    const head = this.requiredPart(root, 'head');
    const torso = this.requiredPart(root, 'torso');
    const leftArm = this.requiredPart(root, 'leftArm');
    const rightArm = this.requiredPart(root, 'rightArm');

    switch (id) {
      case 'anaaya':
        this.box(torso, 0.5, 0.58, 0.08, 0, 0, -0.17, this.material({ color: 0x1c1a32, roughness: 0.95 }));
        return;
      case 'v1':
        this.addMilitaryDetails(torso, rightArm);
        return;
      case 'v2-clean':
        return;
      case 'v2-bloody':
        this.addBloodyDetails(torso, leftArm, rightArm);
        torso.rotation.x = 0.17;
        return;
      case 'v3':
        this.addHorrorDetails(head, torso, leftArm, rightArm);
        return;
      case 'v4':
        this.addLabCoat(torso);
        return;
      case 'beggar':
        this.addBeggarDetails(head, torso, false);
        return;
      case 'beggar-threat':
        this.addBeggarDetails(head, torso, true);
        leftArm.rotation.z = -0.8;
        rightArm.rotation.z = 0.8;
        head.rotation.z = 0.18;
        return;
      case 'youngWoman':
        this.addLongHair(head, materials.hair ?? materials.clothes, 0.28);
        return;
      case 'soldier-patrol':
        this.addHelmet(head, materials.clothes);
        return;
      case 'soldier-injured':
        root.rotation.z = Math.PI / 2;
        root.position.y = 0.18;
        return;
      case 'woman-long-hair':
        this.addLongHair(head, materials.hair ?? materials.clothes, 0.35);
        return;
      case 'woman-short-hair':
        this.addLongHair(head, materials.hair ?? materials.clothes, 0.15);
        return;
      case 'threat-thug':
        leftArm.rotation.z = -0.35;
        rightArm.rotation.z = 0.35;
        return;
    }
  }

  private static addHair(head: THREE.Group, material: THREE.Material, length: number): void {
    this.box(head, 0.38, 0.16 + length, 0.14, 0, 0.12, 0.07, material);
  }

  private static addLongHair(head: THREE.Group, material: THREE.Material, height: number): void {
    this.cylinder(head, 0.18, 0.2, height, 0, -height * 0.25, 0.08, material);
  }

  private static addMilitaryDetails(torso: THREE.Group, rightArm: THREE.Group): void {
    const military = this.material({ color: 0x34452c, roughness: 0.95 });
    this.box(torso, 0.16, 0.1, 0.32, -0.32, 0.29, 0, military);
    this.box(torso, 0.16, 0.1, 0.32, 0.32, 0.29, 0, military);

    const trishul = new THREE.Group();
    trishul.name = 'trishul';
    trishul.position.set(0.1, -0.5, -0.08);
    rightArm.add(trishul);
    const gold = this.material({ color: 0x9e8241, metalness: 0.5, roughness: 0.5 });
    this.cylinder(trishul, 0.025, 0.025, 0.85, 0, -0.18, 0, gold);
    for (const x of [-0.07, 0, 0.07]) {
      const prong = this.cylinder(trishul, 0.018, 0.03, 0.22, x, 0.3, 0, gold);
      prong.rotation.z = x === 0 ? 0 : (x < 0 ? 0.2 : -0.2);
    }
  }

  private static addBloodyDetails(torso: THREE.Group, leftArm: THREE.Group, rightArm: THREE.Group): void {
    const blood = this.material({ color: 0x5e080c, emissive: 0x7a0000, emissiveIntensity: 0.8, roughness: 0.7 });
    this.box(torso, 0.36, 0.46, 0.05, 0, -0.03, -0.16, blood);
    this.sphere(leftArm, 0.07, 0, -0.61, -0.08, blood);
    this.sphere(rightArm, 0.07, 0, -0.61, -0.08, blood);
    this.addTrophy(leftArm, 'leftTrophy', 0.35);
    this.addTrophy(rightArm, 'rightTrophy', 0.15);
  }

  private static addTrophy(hand: THREE.Group, name: string, hairHeight: number): void {
    const trophy = new THREE.Group();
    trophy.name = name;
    trophy.position.set(0, -0.78, -0.03);
    hand.add(trophy);
    const skin = this.material({ color: 0x9d7261, roughness: 1 });
    const hair = this.material({ color: 0x241719, roughness: 1 });
    this.sphere(trophy, 0.12, 0, 0, 0, skin);
    this.cylinder(trophy, 0.11, 0.14, hairHeight, 0, hairHeight * 0.18, 0.05, hair);
  }

  private static addHorrorDetails(head: THREE.Group, torso: THREE.Group, leftArm: THREE.Group, rightArm: THREE.Group): void {
    const red = this.material({ color: 0xaa1010, emissive: 0xff0000, emissiveIntensity: 2.3, roughness: 0.3 });
    const smile = this.material({ color: 0xf2e8df, emissive: 0x7f7a74, emissiveIntensity: 0.8, roughness: 0.3 });
    const gold = this.material({ color: 0xa87b22, emissive: 0x5a3900, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.35 });
    const ivory = this.material({ color: 0xd9d0bb, emissive: 0x493d2d, emissiveIntensity: 0.5 });
    const black = this.material({ color: 0x08070b, roughness: 1 });

    // The preview camera approaches from +Z, so these facial details live on
    // the model's +Z-facing side as well.
    this.sphere(head, 0.035, -0.075, 0.06, 0.205, red);
    this.sphere(head, 0.035, 0.075, 0.06, 0.205, red);
    const mouth = this.mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 18, Math.PI), smile);
    mouth.position.set(0, -0.055, 0.215);
    mouth.rotation.z = Math.PI;
    head.add(mouth);
    this.box(head, 0.1, 0.5, 0.1, 0, 0.42, 0.06, black);

    for (const arm of [leftArm, rightArm]) {
      for (const y of [-0.43, -0.49, -0.55]) {
        const bangle = this.mesh(new THREE.TorusGeometry(0.115, 0.013, 6, 14), gold);
        bangle.position.set(0, y, 0);
        bangle.rotation.x = Math.PI / 2;
        arm.add(bangle);
      }
    }

    for (const [x, y] of [[-0.1, 0.08], [0.1, 0.08], [-0.12, -0.08], [0.12, -0.08], [0, -0.18]] as [number, number][]) {
      this.box(torso, 0.07, 0.07, 0.025, x, y, 0.15, ivory);
    }
  }

  private static addLabCoat(torso: THREE.Group): void {
    const coat = this.material({ color: 0xd2d6d4, roughness: 0.95 });
    this.box(torso, 0.5, 0.68, 0.07, 0, 0, -0.17, coat);
    this.box(torso, 0.05, 0.62, 0.09, 0, 0, -0.215, this.material({ color: 0xa7aaa9, roughness: 0.9 }));
  }

  private static addBeggarDetails(head: THREE.Group, torso: THREE.Group, tilted: boolean): void {
    const hat = this.material({ color: 0x393126, roughness: 1 });
    this.cylinder(head, 0.22, 0.25, 0.09, 0, 0.2, 0, hat);
    this.box(torso, 0.53, 0.12, 0.07, 0, -0.12, -0.17, this.material({ color: 0x30241b, roughness: 1 }));
    if (tilted) head.rotation.x = 0.12;
  }

  private static addHelmet(head: THREE.Group, material: THREE.Material): void {
    this.sphere(head, 0.225, 0, 0.08, 0, material);
  }

  private static requiredPart(root: THREE.Group, name: string): THREE.Group {
    const part = root.getObjectByName(name);
    if (!(part instanceof THREE.Group)) throw new Error(`[CharacterBuilder] Missing required part: ${name}`);
    return part;
  }

  private static part(parent: THREE.Group, name: string, x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  }

  private static material(spec: MaterialSpec): THREE.Material {
    if (spec.basic) return new THREE.MeshBasicMaterial({ color: spec.color });
    return new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: spec.emissive ?? 0x000000,
      emissiveIntensity: spec.emissiveIntensity ?? 0,
      roughness: spec.roughness ?? 0.85,
      metalness: spec.metalness ?? 0,
    });
  }

  private static mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private static box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const mesh = this.mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  private static sphere(parent: THREE.Object3D, radius: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const mesh = this.mesh(new THREE.SphereGeometry(radius, 12, 10), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  private static cylinder(parent: THREE.Object3D, top: number, bottom: number, height: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const mesh = this.mesh(new THREE.CylinderGeometry(top, bottom, height, 10), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
}
