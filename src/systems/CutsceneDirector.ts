import * as THREE from 'three';
import type { AudioManager } from './AudioManager.js';
import type { InteractionSystem } from './InteractionSystem.js';
import type { PauseMenu } from './PauseMenu.js';
import type { PlayerController } from './PlayerController.js';

export type CutsceneStep =
  | { type: 'fade'; direction: 'in' | 'out'; durationSec: number }
  | { type: 'subtitle'; text: string; durationSec: number; clearAfter?: boolean }
  | { type: 'wait'; durationSec: number }
  | {
      type: 'cameraAnim';
      targetPos: THREE.Vector3;
      targetQuat: THREE.Quaternion;
      durationSec: number;
      easing?: 'linear' | 'smooth';
    }
  | { type: 'callback'; fn: () => void }
  | { type: 'sfx'; url: string; position?: THREE.Vector3 };

export interface CutsceneFocus {
  /** World-space composition point supplied by the scene. */
  target: THREE.Vector3;
  durationSec?: number;
  easing?: 'linear' | 'smooth';
  /** Keep the focused view when dialogue ends instead of restoring its start. */
  keepFacingOnComplete?: boolean;
  /**
   * Pull a too-close camera back along its current line to the target. This
   * moves only the presentation camera, never the player, and is useful for
   * character shots that need enough room for a prop or silhouette.
   */
  minimumDistance?: number;
  /** Duration of the smooth return from a temporary presentation position. */
  returnDurationSec?: number;
}

export interface CutsceneOptions {
  /**
   * Keep an already-held pointer lock while controls are frozen. This is useful
   * for an opening cutscene that starts directly from a click gesture; normal
   * cutscenes retain the original release-and-restore behaviour.
   */
  retainPointerLock?: boolean;
  /**
   * Optional, scene-supplied focal point for dialogue. The director eases the
   * existing camera toward it without moving the player. Focus is deliberately
   * opt-in so terminals and environmental text keep the player's current view.
   */
  focus?: CutsceneFocus;
}

/**
 * Runs a small sequence of presentation and camera steps. It owns only the
 * cutscene DOM overlays and temporary camera transform; it never owns or
 * clears scene geometry.
 */
export class CutsceneDirector {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly player: PlayerController;
  private readonly interaction: InteractionSystem;
  private readonly pauseMenu: PauseMenu;
  private readonly audio: AudioManager;
  private readonly hud: HTMLElement;
  private readonly fadeOverlay: HTMLElement;
  private readonly subtitleBar: HTMLElement;
  private readonly subtitleText: HTMLElement;

  private steps: CutsceneStep[] = [];
  private stepIndex = 0;
  private stepElapsed = 0;
  private active = false;
  private onComplete: (() => void) | undefined;

  private cameraStartPosition = new THREE.Vector3();
  private cameraStartQuaternion = new THREE.Quaternion();
  private stepCameraStartPosition = new THREE.Vector3();
  private stepCameraStartQuaternion = new THREE.Quaternion();
  private stepCameraTargetPosition = new THREE.Vector3();
  private stepCameraTargetQuaternion = new THREE.Quaternion();

  private playerWasEnabled = true;
  private interactionWasEnabled = true;
  private hudWasHidden = false;
  private restorePointerLock = false;
  private retainPointerLock = false;
  private keepFocusOnComplete = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    player: PlayerController,
    interaction: InteractionSystem,
    pauseMenu: PauseMenu,
    audio: AudioManager,
  ) {
    this.camera = camera;
    this.player = player;
    this.interaction = interaction;
    this.pauseMenu = pauseMenu;
    this.audio = audio;
    this.hud = document.getElementById('hud')!;
    this.fadeOverlay = document.getElementById('fade-overlay')!;
    this.subtitleBar = document.getElementById('subtitle-bar')!;
    this.subtitleText = document.getElementById('subtitle-text')!;
  }

  get isPlaying(): boolean {
    return this.active;
  }

  /** Start a sequence, cancelling any currently running sequence first. */
  play(steps: CutsceneStep[], onComplete?: () => void, options: CutsceneOptions = {}): void {
    if (this.active) this.stop();

    this.stepIndex = 0;
    this.stepElapsed = 0;
    this.onComplete = onComplete;
    this.active = true;

    this.playerWasEnabled = this.player.enabled;
    this.interactionWasEnabled = this.interaction.enabled;
    this.hudWasHidden = this.hud.classList.contains('hidden');
    this.restorePointerLock = this.player.isLocked;
    this.retainPointerLock = options.retainPointerLock ?? false;
    this.keepFocusOnComplete = options.focus?.keepFacingOnComplete ?? Boolean(options.focus);
    this.cameraStartPosition.copy(this.camera.position);
    this.cameraStartQuaternion.copy(this.camera.quaternion);
    const focusSteps = options.focus ? this.makeFocusSteps(options.focus) : undefined;
    this.steps = focusSteps
      ? [focusSteps.enter, ...steps, ...(focusSteps.exit ? [focusSteps.exit] : [])]
      : steps;

    this.player.enabled = false;
    this.interaction.enabled = false;
    this.hud.classList.add('hidden');
    this.pauseMenu.suppressAutoLockPause();
    if (!this.retainPointerLock) this.player.exitLock();
    window.addEventListener('keydown', this.blockEscape, true);

    this.beginCurrentStep();
  }

  /** Advance the active sequence. Call once per rendered frame. */
  update(dt: number): void {
    if (!this.active) return;

    let remaining = Math.max(0, dt);
    let safety = 0;

    // Instant steps can chain; the guard catches malformed callback loops.
    while (this.active && safety < 64) {
      safety += 1;
      const step = this.steps[this.stepIndex];
      if (!step) {
        this.complete();
        return;
      }

      const duration = this.getDuration(step);
      if (duration === 0) {
        this.applyTimedStep(step, 1);
        this.completeCurrentStep();
        continue;
      }

      const needed = duration - this.stepElapsed;
      const used = Math.min(remaining, needed);
      this.stepElapsed += used;
      remaining -= used;
      this.applyTimedStep(step, this.stepElapsed / duration);

      if (this.stepElapsed >= duration) {
        this.completeCurrentStep();
        continue;
      }
      return;
    }
  }

  /** Stop early and restore the systems this director temporarily changed. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.restoreGameplayState();
    this.onComplete = undefined;
  }

  private beginCurrentStep(): void {
    const step = this.steps[this.stepIndex];
    if (!step) {
      this.complete();
      return;
    }

    this.stepElapsed = 0;
    if (step.type === 'fade') {
      this.setFade(step.direction, step.durationSec);
    } else if (step.type === 'subtitle') {
      this.subtitleText.textContent = step.text;
      this.subtitleBar.classList.remove('hidden');
    } else if (step.type === 'cameraAnim') {
      this.stepCameraStartPosition.copy(this.camera.position);
      this.stepCameraStartQuaternion.copy(this.camera.quaternion);
      this.stepCameraTargetPosition.copy(step.targetPos);
      this.stepCameraTargetQuaternion.copy(step.targetQuat);
    } else if (step.type === 'callback') {
      try {
        step.fn();
      } catch (error) {
        console.error('[CutsceneDirector] Callback failed; sequence stopped.', error);
        this.stop();
      }
    } else if (step.type === 'sfx') {
      void this.audio.playSFX(step.url, step.position);
    }
  }

  private applyTimedStep(step: CutsceneStep, progress: number): void {
    if (step.type !== 'cameraAnim') return;

    const eased = step.easing === 'smooth'
      ? progress * progress * (3 - 2 * progress)
      : progress;
    this.camera.position.lerpVectors(this.stepCameraStartPosition, this.stepCameraTargetPosition, eased);
    this.camera.quaternion.slerpQuaternions(
      this.stepCameraStartQuaternion,
      this.stepCameraTargetQuaternion,
      eased,
    );
  }

  private completeCurrentStep(): void {
    const step = this.steps[this.stepIndex];
    if (step?.type === 'subtitle' && step.clearAfter !== false) {
      this.clearSubtitle();
    }

    this.stepIndex += 1;
    this.beginCurrentStep();
  }

  private complete(): void {
    if (!this.active) return;
    const callback = this.onComplete;
    this.active = false;
    this.restoreGameplayState(!this.keepFocusOnComplete);
    this.onComplete = undefined;
    callback?.();
  }

  private restoreGameplayState(restoreCamera = true): void {
    if (restoreCamera) {
      this.camera.position.copy(this.cameraStartPosition);
      this.camera.quaternion.copy(this.cameraStartQuaternion);
    } else {
      // The director has retained a focused angle; the controller must adopt
      // it before mouse-look resumes or its stale yaw/pitch will snap it away.
      this.player.syncLookToCamera();
    }
    this.player.enabled = this.playerWasEnabled;
    this.interaction.enabled = this.interactionWasEnabled;
    if (!this.hudWasHidden) this.hud.classList.remove('hidden');
    this.clearSubtitle();
    this.fadeOverlay.classList.remove('active');
    this.fadeOverlay.style.removeProperty('transition-duration');
    this.pauseMenu.restoreAutoLockPause();
    this.retainPointerLock = false;
    this.keepFocusOnComplete = false;
    window.removeEventListener('keydown', this.blockEscape, true);

    // Browsers may require a further click to grant this request. Keeping the
    // request here preserves normal desktop behaviour where it is permitted.
    if (this.restorePointerLock) this.player.requestLock();
  }

  private makeFocusSteps(focus: CutsceneFocus): { enter: CutsceneStep; exit?: CutsceneStep } {
    const presentationPosition = this.focusPresentationPosition(focus);
    const enter: CutsceneStep = {
      type: 'cameraAnim',
      targetPos: presentationPosition,
      targetQuat: this.lookAtQuaternion(presentationPosition, focus.target),
      durationSec: Math.max(0, focus.durationSec ?? 0.45),
      easing: focus.easing ?? 'smooth',
    };
    if (presentationPosition.distanceToSquared(this.cameraStartPosition) < 0.000001) return { enter };

    return {
      enter,
      // Rejoin the player's actual eye position before input is restored. The
      // final quaternion is recalculated from that eye, so mouse-look resumes
      // toward the subject rather than jumping to a presentation-camera angle.
      exit: {
        type: 'cameraAnim',
        targetPos: this.cameraStartPosition.clone(),
        targetQuat: this.lookAtQuaternion(this.cameraStartPosition, focus.target),
        durationSec: Math.max(0, focus.returnDurationSec ?? 0.32),
        easing: focus.easing ?? 'smooth',
      },
    };
  }

  private focusPresentationPosition(focus: CutsceneFocus): THREE.Vector3 {
    const presentationPosition = this.cameraStartPosition.clone();
    const minimumDistance = focus.minimumDistance;
    if (!minimumDistance || minimumDistance <= 0) return presentationPosition;

    const relative = this.cameraStartPosition.clone().sub(focus.target);
    const currentDistance = relative.length();
    if (currentDistance >= minimumDistance) return presentationPosition;

    // Preserve the player's eye height while moving straight away from the
    // subject. The movement can never pass through the focused character.
    const horizontal = new THREE.Vector3(relative.x, 0, relative.z);
    if (horizontal.lengthSq() < 0.000001) {
      const viewDirection = this.camera.getWorldDirection(new THREE.Vector3());
      horizontal.set(-viewDirection.x, 0, -viewDirection.z);
    }
    if (horizontal.lengthSq() < 0.000001) return presentationPosition;

    horizontal.normalize();
    const verticalDistance = this.cameraStartPosition.y - focus.target.y;
    const requiredHorizontalDistance = Math.sqrt(Math.max(0, minimumDistance ** 2 - verticalDistance ** 2));
    presentationPosition.x = focus.target.x + horizontal.x * requiredHorizontalDistance;
    presentationPosition.z = focus.target.z + horizontal.z * requiredHorizontalDistance;
    return presentationPosition;
  }

  private lookAtQuaternion(position: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
    const targetQuaternion = new THREE.Quaternion();
    const targetMatrix = new THREE.Matrix4().lookAt(position, target, this.camera.up);
    targetQuaternion.setFromRotationMatrix(targetMatrix);
    return targetQuaternion;
  }

  private setFade(direction: 'in' | 'out', durationSec: number): void {
    this.fadeOverlay.style.transitionDuration = `${Math.max(0, durationSec)}s`;
    this.fadeOverlay.classList.toggle('active', direction === 'out');
  }

  private clearSubtitle(): void {
    this.subtitleBar.classList.add('hidden');
    this.subtitleText.textContent = '';
  }

  private getDuration(step: CutsceneStep): number {
    switch (step.type) {
      case 'fade':
      case 'subtitle':
      case 'wait':
      case 'cameraAnim':
        return Math.max(0, step.durationSec);
      case 'callback':
      case 'sfx':
        return 0;
    }
  }

  private blockEscape = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}
