import * as THREE from 'three';
import { CHARACTER_IDS, CharacterBuilder, type CharacterId } from './CharacterBuilder.js';

/** Development-only viewer that owns every object it adds to the scene. */
export class GrayboxCharacterPreview {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();
  private readonly label: HTMLDivElement;
  private current: THREE.Group | null = null;
  private index = CHARACTER_IDS.indexOf('v3');

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = 'dev:character-preview';
    this.group.position.set(0, 0, -1.5);
    this.scene.add(this.group);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.85, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: 0x202633, roughness: 0.75, metalness: 0.2 }),
    );
    pedestal.position.y = 0.06;
    pedestal.receiveShadow = true;
    this.group.add(pedestal);

    const key = new THREE.PointLight(0xb9cbff, 1.2, 6, 2);
    key.position.set(1.5, 2.5, 1.5);
    this.group.add(key);

    this.label = document.createElement('div');
    this.label.style.cssText = [
      'position:fixed', 'top:20px', 'left:20px', 'z-index:175',
      'padding:8px 12px', 'border:1px solid rgba(126,207,255,.35)',
      'border-radius:7px', 'background:rgba(8,10,16,.78)', 'color:#dcecff',
      'font:12px/1.4 system-ui,sans-serif', 'pointer-events:none',
    ].join(';');
    document.body.append(this.label);
    this.showCurrent();
  }

  toggle(): void {
    this.group.visible = !this.group.visible;
    this.label.style.display = this.group.visible ? 'block' : 'none';
  }

  next(): void {
    this.index = (this.index + 1) % CHARACTER_IDS.length;
    this.showCurrent();
  }

  previous(): void {
    this.index = (this.index - 1 + CHARACTER_IDS.length) % CHARACTER_IDS.length;
    this.showCurrent();
  }

  dispose(): void {
    if (this.current) CharacterBuilder.dispose(this.current);
    this.current = null;
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    this.scene.remove(this.group);
    this.label.remove();
  }

  private showCurrent(): void {
    if (this.current) CharacterBuilder.dispose(this.current);
    const id = CHARACTER_IDS[this.index] as CharacterId;
    this.current = CharacterBuilder.create(id);
    this.current.position.y = 0.12;
    this.group.add(this.current);
    this.label.textContent = `Character preview: ${id}  |  N next  B previous  V hide`;
  }
}
