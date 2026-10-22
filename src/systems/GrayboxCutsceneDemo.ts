import * as THREE from 'three';
import type { CutsceneDirector, CutsceneStep } from './CutsceneDirector.js';

/** Development-only P2 proof sequence. It is loaded only by Vite development. */
export function playGrayboxCutsceneDemo(
  cutscene: CutsceneDirector,
  camera: THREE.PerspectiveCamera,
): void {
  const initialPosition = camera.position.clone();
  const initialQuaternion = camera.quaternion.clone();
  const targetPosition = initialPosition.clone().add(new THREE.Vector3(0.8, 0.3, -1.2));
  const targetQuaternion = initialQuaternion.clone().multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.28, 0, 'YXZ')),
  ).normalize();

  const steps: CutsceneStep[] = [
    { type: 'fade', direction: 'out', durationSec: 0.35 },
    { type: 'wait', durationSec: 0.15 },
    { type: 'fade', direction: 'in', durationSec: 0.35 },
    {
      type: 'subtitle',
      text: 'Graybox cutscene demo — controls are temporarily locked.',
      durationSec: 1.8,
      clearAfter: true,
    },
    {
      type: 'cameraAnim',
      targetPos: targetPosition,
      targetQuat: targetQuaternion,
      durationSec: 1.2,
      easing: 'smooth',
    },
    { type: 'wait', durationSec: 0.25 },
    {
      type: 'cameraAnim',
      targetPos: initialPosition,
      targetQuat: initialQuaternion,
      durationSec: 0.6,
      easing: 'smooth',
    },
    { type: 'callback', fn: () => console.info('[CutsceneDirector] Graybox demo callback fired.') },
    { type: 'fade', direction: 'out', durationSec: 0.35 },
    { type: 'fade', direction: 'in', durationSec: 0.35 },
  ];

  cutscene.play(steps, () => {
    console.info('[CutsceneDirector] Graybox demo complete.');
  });
}
