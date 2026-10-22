import * as THREE from 'three';

/** A cancellable effect owns only its own timers; it never disposes scene objects. */
export interface EffectHandle {
  readonly active: boolean;
  cancel(): void;
  dispose(): void;
}

export interface ApparitionOptions {
  /** Add a detached object to the supplied scene. Existing parents are never changed. */
  attachIfDetached?: boolean;
  /** Whether cancellation should hide the apparition. Defaults to true. */
  hideOnCancel?: boolean;
}

export interface FlickerOptions {
  /** Milliseconds between light changes. Defaults to the planned 80ms. */
  intervalMs?: number;
  /** Random source, useful for deterministic tests. Defaults to Math.random. */
  random?: () => number;
  /** Restore the original light intensity after stop or completion. Defaults to true. */
  restoreIntensity?: boolean;
}

export interface LookAwayMoveOptions {
  /** Fraction of the remaining distance travelled per update. Defaults to 0.1. */
  lerpFactor?: number;
  /** Snap to the target when closer than this distance. Defaults to 0.01 world units. */
  snapDistance?: number;
}

export interface MirrorDesyncOptions {
  /** Number of captured source transforms to retain before applying one. Defaults to 30. */
  lagFrames?: number;
  /** Map a delayed source position into the reflection's world-space display area. */
  mapPosition?: (sourcePosition: THREE.Vector3, output: THREE.Vector3) => THREE.Vector3;
  /** Map a delayed source rotation into the reflection's world-space display area. */
  mapQuaternion?: (sourceQuaternion: THREE.Quaternion, output: THREE.Quaternion) => THREE.Quaternion;
}

export interface MirrorDesyncHandle extends EffectHandle {
  /** Capture the source transform and apply the N-frame-old transform when available. */
  update(): boolean;
  /** Clear history without hiding or detaching the caller-owned reflection. */
  reset(): void;
}

export interface StoppableFootstepSound {
  readonly active?: boolean;
  stop(): void;
}

export interface FootstepAudio {
  playSFX(url: string, position?: THREE.Vector3):
    Promise<void | StoppableFootstepSound> | StoppableFootstepSound | void;
}

export interface FootstepLoopHandle extends EffectHandle {
  stop(): void;
}

const activeApparitions = new WeakMap<THREE.Object3D, EffectHandle>();
const activeFlickers = new WeakMap<THREE.Light, EffectHandle>();

/**
 * Place an object, reveal it briefly, then hide it. The supplied object stays
 * caller-owned: this utility never disposes it or other scene resources.
 */
export function apparitionAt(
  scene: THREE.Scene,
  object: THREE.Object3D,
  position: THREE.Vector3,
  durationSec: number,
  options: ApparitionOptions = {},
): EffectHandle {
  activeApparitions.get(object)?.cancel();

  const attachedHere = object.parent === null && (options.attachIfDetached ?? true);
  if (attachedHere) scene.add(object);

  object.position.copy(position);
  object.visible = true;

  let active = true;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const finish = (): void => {
    if (!active) return;
    active = false;
    timeout = null;
    object.visible = false;
    if (activeApparitions.get(object) === handle) activeApparitions.delete(object);
  };
  const handle: EffectHandle = {
    get active(): boolean { return active; },
    cancel(): void {
      if (!active) return;
      if (timeout !== null) clearTimeout(timeout);
      if (options.hideOnCancel ?? true) object.visible = false;
      active = false;
      timeout = null;
      if (activeApparitions.get(object) === handle) activeApparitions.delete(object);
    },
    dispose(): void {
      this.cancel();
      if (attachedHere && object.parent === scene) scene.remove(object);
    },
  };

  activeApparitions.set(object, handle);
  const durationMs = secondsToMilliseconds(durationSec);
  timeout = setTimeout(finish, durationMs);
  return handle;
}

/**
 * Randomly varies a light at the planned 80ms cadence and restores its prior
 * intensity when it completes or is cancelled.
 */
export function flickerLight(
  light: THREE.Light,
  durationSec: number,
  minIntensity: number,
  maxIntensity: number,
  options: FlickerOptions = {},
): EffectHandle {
  activeFlickers.get(light)?.cancel();

  const originalIntensity = light.intensity;
  const low = Math.min(minIntensity, maxIntensity);
  const high = Math.max(minIntensity, maxIntensity);
  const intervalMs = Math.max(1, finiteOr(options.intervalMs, 80));
  const random = options.random ?? Math.random;
  const restoreIntensity = options.restoreIntensity ?? true;
  let active = true;
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const restore = (): void => {
    if (restoreIntensity) light.intensity = originalIntensity;
  };
  const stopTimers = (): void => {
    if (interval !== null) clearInterval(interval);
    if (timeout !== null) clearTimeout(timeout);
    interval = null;
    timeout = null;
  };
  const finish = (): void => {
    if (!active) return;
    active = false;
    stopTimers();
    restore();
    if (activeFlickers.get(light) === handle) activeFlickers.delete(light);
  };
  const handle: EffectHandle = {
    get active(): boolean { return active; },
    cancel: finish,
    dispose: finish,
  };
  const setRandomIntensity = (): void => {
    const normalized = Math.max(0, Math.min(1, random()));
    light.intensity = low + (high - low) * normalized;
  };

  activeFlickers.set(light, handle);
  setRandomIntensity();
  interval = setInterval(setRandomIntensity, intervalMs);
  timeout = setTimeout(finish, secondsToMilliseconds(durationSec));
  return handle;
}

/**
 * Advance an object toward a world-space target only while it is outside the
 * camera's view cone. Call once per frame from the owning scene's update().
 */
export function moveWhenNotLooking(
  camera: THREE.Camera,
  object: THREE.Object3D,
  targetPosition: THREE.Vector3,
  threshold: number,
  options: LookAwayMoveOptions = {},
): boolean {
  if (isLookingAt(camera, object, threshold)) return false;

  const localTarget = worldToLocalPosition(object, targetPosition);
  const lerpFactor = clamp01(finiteOr(options.lerpFactor, 0.1));
  const snapDistance = Math.max(0, finiteOr(options.snapDistance, 0.01));
  if (object.position.distanceTo(localTarget) <= snapDistance) {
    object.position.copy(localTarget);
  } else {
    object.position.lerp(localTarget, lerpFactor);
  }
  return true;
}

/**
 * Copy a source transform into a caller-owned reflection after a fixed number
 * of updates. It deliberately never tests camera visibility or changes
 * `visible`, so a mirror proxy remains present when the player looks away.
 */
export function mirrorDesync(
  source: THREE.Object3D,
  reflection: THREE.Object3D,
  options: MirrorDesyncOptions = {},
): MirrorDesyncHandle {
  const lagFrames = Math.max(1, Math.floor(finiteOr(options.lagFrames, 30)));
  const positionMapper = options.mapPosition ?? copyVector;
  const quaternionMapper = options.mapQuaternion ?? copyQuaternion;
  const history: Array<{ position: THREE.Vector3; quaternion: THREE.Quaternion }> = [];
  let active = true;

  const handle: MirrorDesyncHandle = {
    get active(): boolean { return active; },
    update(): boolean {
      if (!active) return false;

      history.push({
        position: source.getWorldPosition(new THREE.Vector3()),
        quaternion: source.getWorldQuaternion(new THREE.Quaternion()),
      });
      if (history.length <= lagFrames) return false;

      const delayed = history.shift()!;
      const mappedPosition = positionMapper(delayed.position, new THREE.Vector3());
      const mappedQuaternion = quaternionMapper(delayed.quaternion, new THREE.Quaternion());
      reflection.position.copy(worldToLocalPosition(reflection, mappedPosition));
      reflection.quaternion.copy(worldToLocalQuaternion(reflection, mappedQuaternion));
      return true;
    },
    reset(): void {
      history.length = 0;
      active = true;
    },
    cancel(): void {
      active = false;
      history.length = 0;
    },
    dispose(): void {
      this.cancel();
    },
  };
  return handle;
}

/** Start a repeating positional SFX loop. Call stop() immediately when motion stops. */
export function startFootstepLoop(
  audio: FootstepAudio,
  camera: THREE.Camera,
  intervalSec: number,
  url: string,
): FootstepLoopHandle {
  const intervalMs = Math.max(1, secondsToMilliseconds(intervalSec));
  let active = true;
  const activeSounds = new Set<StoppableFootstepSound>();
  const stopActiveSounds = (): void => {
    for (const sound of activeSounds) {
      try { sound.stop(); } catch { /* a source may already have ended */ }
    }
    activeSounds.clear();
  };
  const trackSound = (value: void | StoppableFootstepSound): void => {
    if (!value || typeof value.stop !== 'function') return;
    if (active) activeSounds.add(value);
    else value.stop();
  };
  const tick = (): void => {
    if (!active) return;
    for (const sound of activeSounds) {
      if (sound.active === false) activeSounds.delete(sound);
    }
    try {
      const result = audio.playSFX(url, camera.getWorldPosition(new THREE.Vector3()));
      if (result instanceof Promise) {
        void result.then(trackSound).catch(error => console.warn('[HorrorEffects] Footstep SFX failed.', error));
      } else {
        trackSound(result);
      }
    } catch (error) {
      console.warn('[HorrorEffects] Footstep SFX failed.', error);
    }
  };
  tick();
  const interval = setInterval(tick, intervalMs);
  const stop = (): void => {
    if (!active) return;
    active = false;
    clearInterval(interval);
    stopActiveSounds();
  };
  return {
    get active(): boolean { return active; },
    stop,
    cancel: stop,
    dispose: stop,
  };
}

/** Convenience form for callers holding an opaque FootstepLoopHandle. */
export function stopFootstepLoop(loop: FootstepLoopHandle | null | undefined): void {
  loop?.stop();
}

function isLookingAt(camera: THREE.Camera, object: THREE.Object3D, threshold: number): boolean {
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const direction = object.getWorldPosition(new THREE.Vector3()).sub(cameraPosition);
  if (direction.lengthSq() === 0) return true;
  direction.normalize();
  return camera.getWorldDirection(new THREE.Vector3()).dot(direction) >= threshold;
}

function worldToLocalPosition(object: THREE.Object3D, position: THREE.Vector3): THREE.Vector3 {
  const local = position.clone();
  if (object.parent) object.parent.worldToLocal(local);
  return local;
}

function worldToLocalQuaternion(object: THREE.Object3D, quaternion: THREE.Quaternion): THREE.Quaternion {
  if (!object.parent) return quaternion.clone();
  const parentWorldQuaternion = object.parent.getWorldQuaternion(new THREE.Quaternion());
  return parentWorldQuaternion.invert().multiply(quaternion.clone());
}

function copyVector(source: THREE.Vector3, output: THREE.Vector3): THREE.Vector3 {
  return output.copy(source);
}

function copyQuaternion(source: THREE.Quaternion, output: THREE.Quaternion): THREE.Quaternion {
  return output.copy(source);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function secondsToMilliseconds(seconds: number): number {
  return Math.max(0, finiteOr(seconds, 0)) * 1000;
}
