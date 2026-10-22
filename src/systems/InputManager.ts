/**
 * InputManager — single source of truth for keyboard and mouse state.
 * Does NOT handle pointer lock — that lives in PlayerController so the
 * lock lifecycle is co-located with the code that uses it.
 */
export class InputManager {
  private keys: Set<string> = new Set();

  // Accumulated raw mouse delta since last frame
  mouseDX = 0;
  mouseDY = 0;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Prevent browser shortcuts while in-game (F5, F11 still allowed)
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Call once per frame AFTER consuming mouse deltas. */
  flushMouse() {
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
