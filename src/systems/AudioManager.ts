import * as THREE from 'three';

const IS_DEV = import.meta.env.DEV;

interface PositionalVoice {
  readonly panner: StereoPannerNode;
  readonly position: THREE.Vector3;
}

/**
 * Small Web Audio wrapper for scene ambience and one-shot effects.
 * AudioContext creation is deliberately deferred until init(), which must run
 * from a browser user gesture such as the Start button click.
 */
export class AudioManager {
  private readonly camera: THREE.Camera;
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientRequest = 0;

  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly positionalVoices = new Set<PositionalVoice>();

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  /** Create/resume the browser audio graph. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.8;
      this.masterGain.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') await this.context.resume();
  }

  get isInitialized(): boolean {
    return this.context !== null && this.context.state !== 'closed';
  }

  /** Set master output from 0 (silent) through 1 (full volume). */
  setMasterVolume(value: number): void {
    if (!this.context || !this.masterGain) return;
    const volume = Math.max(0, Math.min(1, value));
    this.masterGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
  }

  /** Start a looping ambience track, replacing any existing ambience. */
  async playAmbient(url: string, fadeInSec = 1): Promise<void> {
    if (!this.context || !this.masterGain) return;

    this.stopAmbient(0);
    const request = ++this.ambientRequest;
    const buffer = await this.loadBuffer(url);
    if (!buffer || request !== this.ambientRequest || !this.context || !this.masterGain) return;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.context.currentTime + Math.max(0, fadeInSec));
    gain.connect(this.masterGain);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();

    this.ambientGain = gain;
    this.ambientSource = source;
  }

  /** Fade out and stop the active ambience. */
  stopAmbient(fadeOutSec = 1): void {
    ++this.ambientRequest;
    if (!this.context || !this.ambientSource || !this.ambientGain) return;

    const source = this.ambientSource;
    const gain = this.ambientGain;
    this.ambientSource = null;
    this.ambientGain = null;

    const disconnect = (): void => {
      try { source.stop(); } catch { /* source may already have ended */ }
      source.disconnect();
      gain.disconnect();
    };

    if (fadeOutSec <= 0) {
      disconnect();
      return;
    }

    gain.gain.cancelScheduledValues(this.context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.context.currentTime + fadeOutSec);
    window.setTimeout(disconnect, fadeOutSec * 1000 + 50);
  }

  /**
   * Play a non-looping effect. Giving a position creates a stereo panner;
   * update() keeps that panner aligned with the current camera direction.
   */
  async playSFX(url: string, position?: THREE.Vector3): Promise<void> {
    if (!this.context || !this.masterGain) return;

    const buffer = await this.loadBuffer(url);
    if (!buffer || !this.context || !this.masterGain) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const localGain = this.context.createGain();
    localGain.gain.value = 1;

    let voice: PositionalVoice | null = null;
    if (position) {
      const panner = this.context.createStereoPanner();
      voice = { panner, position: position.clone() };
      this.positionalVoices.add(voice);
      this.updateVoicePan(voice);
      source.connect(panner);
      panner.connect(localGain);
    } else {
      source.connect(localGain);
    }

    localGain.connect(this.masterGain);
    source.start();
    source.onended = () => {
      if (voice) this.positionalVoices.delete(voice);
      source.disconnect();
      localGain.disconnect();
    };
  }

  /** Update active positional one-shots after the camera moves. */
  update(): void {
    for (const voice of this.positionalVoices) this.updateVoicePan(voice);
  }

  /** Dev-only audible proof that gesture activation and master gain work. */
  playTestTone(frequency = 440, durationSec = 0.5): void {
    if (!IS_DEV || !this.context || !this.masterGain) return;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.12;
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start();
    oscillator.stop(this.context.currentTime + Math.max(0, durationSec));
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  private updateVoicePan(voice: PositionalVoice): void {
    const cameraPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    if (forward.lengthSq() === 0) return;
    forward.normalize();

    const toSource = voice.position.clone().sub(cameraPosition);
    toSource.y = 0;
    if (toSource.lengthSq() === 0) {
      voice.panner.pan.value = 0;
      return;
    }
    toSource.normalize();

    // Map source direction to -1 (left), 0 (ahead/behind), and 1 (right)
    // without depending on a Three.AudioListener setup.
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    voice.panner.pan.value = Math.max(-1, Math.min(1, right.dot(toSource)));
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[AudioManager] Could not fetch "${url}" (${response.status}). Continuing silently.`);
        return null;
      }
      const data = await response.arrayBuffer();
      const buffer = await this.context!.decodeAudioData(data);
      this.bufferCache.set(url, buffer);
      return buffer;
    } catch (error) {
      console.warn(`[AudioManager] Failed to load "${url}". Continuing silently.`, error);
      return null;
    }
  }
}
