# 3D Prototype — Technical Sandbox

A story-independent desktop-first, browser-based 3D prototype built with **Three.js**, **TypeScript**, and **Vite**.

> **Important:** This is a technical sandbox only. There is no narrative, title, or visual identity yet.

---

## Setup

```bash
# 1. Install dependencies (requires Node ≥ 18)
npm install

# 2. Start the development server
npm run dev
# → Open http://localhost:5173 in your browser

# 3. Production build (optional)
npm run build
# → Output written to dist/

# 4. Preview production build locally
npm run preview
```

---

## Controls

| Key / Action | Effect |
|---|---|
| **Click canvas** | Acquire pointer lock / focus game |
| **WASD / Arrow keys** | Move (forward / left / back / right) |
| **Mouse** | Look around |
| **F** | Toggle flashlight |
| **E** | Interact with highlighted object |
| **ESC** | Pause / settings menu |
| **Click "Resume"** | Return to game |

---

## Project Structure

```
bhp/
├── index.html              # Entry HTML — canvas + HUD + overlays
├── vite.config.ts          # Vite build configuration
├── tsconfig.json           # TypeScript strict config
├── package.json
├── public/                 # Static assets (empty for now)
└── src/
    ├── main.ts             # Bootstrap: creates all systems, runs game loop
    ├── style.css           # HUD, overlay, and control styles
    └── systems/
        ├── Renderer.ts         # Three.js WebGLRenderer + scene + camera
        ├── InputManager.ts     # Keyboard state + raw mouse delta tracking
        ├── PlayerController.ts # WASD + mouselook + pointer lock + wall collision
        ├── Room.ts             # Graybox geometry (floor, walls, ceiling, props)
        ├── Flashlight.ts       # SpotLight attached to camera, F-key toggle
        ├── InteractionSystem.ts# Raycast targeting, E-key prompt + callbacks
        └── PauseMenu.ts        # ESC pause overlay + sensitivity/volume sliders
```

---

## How the Systems Fit Together

```
main.ts
  ├─ Renderer      — scene, camera, WebGLRenderer, resize handler
  ├─ InputManager  — keyboard Set, accumulated mouse dx/dy
  ├─ Room          — adds geometry to scene; exports wallBoxes + interactables
  ├─ PlayerController  ← camera, input, canvas
  │    └─ uses Room.wallBoxes for AABB collision
  ├─ Flashlight    ← camera, scene, input
  ├─ InteractionSystem ← camera, Room.interactables, input
  └─ PauseMenu     — DOM overlay; fires onPause / onResume callbacks
```

Systems are **loosely coupled** by interfaces. To swap a system:
- **Different room** → Replace `Room.ts`, keep `wallBoxes` and `interactables` interface.
- **Different controls** → Replace `PlayerController.ts`, keep the same `update(dt)` signature.
- **Different lighting** → Replace or extend `Flashlight.ts`.
- **Richer interactions** → Extend `InteractionSystem.ts` or add more meshes in `Room.ts`.

---

## Adding a New Interactable Object

1. Create a `THREE.Mesh` and add it to the scene.
2. Set:
   ```ts
   mesh.userData.interactable = true;
   mesh.userData.promptText   = 'Open door';
   mesh.userData.onInteract   = () => { /* your logic */ };
   ```
3. Push it into `room.interactables`.

The `InteractionSystem` will pick it up automatically.

---

## Known Limitations / Next Steps

- No audio engine yet (volume slider is wired up but silent).
- No mobile / touch support — desktop only by design.
- Collision uses per-axis AABB push-out; complex concave geometry needs a physics library.
- No asset pipeline — all geometry is procedural `BoxGeometry` / `CylinderGeometry`.
