# Anaaya's Birthday Horror Game — Technical Implementation Plan (Revised v2)

> **Status: PLANNING ONLY — no code has been modified.**  
> Deadline: **October 31, 2026** · Current date: October 21, 2026 → **~9 days remaining**  
> All 9 user corrections from the review message have been applied. Changes from v1 are marked ▲.

---

## 1. Existing prototype — confirmed reusable systems

Every source file has been read in full. This table reflects actual code, not assumptions.

| System | File | What it does | Action |
|---|---|---|---|
| WebGLRenderer + scene + camera | `Renderer.ts` | Single `THREE.Scene`, single camera, resize handler, PCF shadow maps, fog | **Preserve and extend carefully** — keep persistent renderer/camera/system objects; dispose scene-owned objects explicitly. Do not call `scene.clear()` blindly. |
| Keyboard + mouse delta | `InputManager.ts` | Key-set, accumulated `mouseDX/DY`, `flushMouse()` | **Untouched** |
| First-person WASD + AABB collision | `PlayerController.ts` | Mouselook, yaw/pitch, per-wall AABB push-out, pointer lock | **Extend** — add `enabled` flag + `teleportTo(pos)` |
| Graybox room | `Room.ts` | BoxGeometry props, exposes `wallBoxes` + `interactables` | **Delete after P5** — replaced by `IScene` implementations |
| SpotLight flashlight | `Flashlight.ts` | Camera-parented spotlight, F-key toggle (edge detect) | **Untouched** |
| Raycast interaction | `InteractionSystem.ts` | Raycasts each frame, E-key callback, prompt HUD | **Extend** — add `setInteractables(list)` and `enabled` flag |
| Pause + settings | `PauseMenu.ts` | ESC toggle, sensitivity/volume sliders, auto-pause on lock loss | **Extend** — add `suppressAutoLockPause()` / `restoreAutoLockPause()` |
| Bootstrap + game loop | `main.ts` | Creates all systems, `requestAnimationFrame` loop | **Replace** — becomes thin launcher that creates `GameManager` |
| HTML / HUD | `index.html` | Canvas, crosshair, interaction prompt, start overlay, pause overlay | **Extend** — add: `#fade-overlay`, `#subtitle-bar`, `#date-stamp`, `#letter-overlay`, `#endcard-overlay` |
| Styling | `style.css` | Dark glassmorphism tokens | **Extend** — add cutscene, subtitle, fade, letter, end-card rules |

**Critical constraints confirmed in code:**

1. `PauseMenu` auto-pauses on every pointer-lock-change event. Cutscenes intentionally release pointer lock; we need `suppressAutoLockPause()` called at cutscene start and `restoreAutoLockPause()` at end.
2. `InteractionSystem` holds a single array reference passed at construction. `setInteractables(arr)` replaces it without rebuilding the class.
3. `PlayerController` has no `enabled` flag. Adding one is a 3-line change.
4. `Flashlight` parents itself to `camera`, which in turn is added to `scene`. Scene transitions must not remove the camera from the scene; `SceneManager` only clears non-system geometry.
5. The `Renderer` owns the scene; scene transitions are handled by disposing scene objects explicitly (see Section 2a) rather than calling `scene.clear()` blindly.

---

## 2. New systems — specifications

### 2a. `SceneManager.ts` ← most important new file ▲

Owns the scene transition lifecycle. Does **not** call `scene.clear()` — it calls `currentScene.dispose()` which removes and disposes only that scene's objects, preserving the renderer, camera, lights shared between scenes, and gameplay systems.

```
SceneManager
  .loadScene(name: SceneName): Promise<void>
  .currentScene: SceneName
  .update(dt: number): void          ← calls activeScene.update(dt)
  .getState(): GameState             ← shared persistent state
```

**Scene lifecycle contract** — all `IScene` implementations must honour this:

```ts
interface IScene {
  readonly name: SceneName;

  /** Called once. Adds geometry/lights to scene. Returns collision + interaction data. */
  build(
    scene: THREE.Scene,
    state: GameState
  ): SceneResult;

  /** Called every frame while this scene is active. */
  update(dt: number, state: GameState): void;

  /** Called before the next scene builds. Must dispose() every geometry and
      material created in build(). Must remove all objects added to the scene. */
  dispose(scene: THREE.Scene): void;
}

interface SceneResult {
  wallBoxes:    Array<[number, number, number, number]>;
  interactables: THREE.Mesh[];
  spawnPoint:   THREE.Vector3;
}
```

**Shared `GameState` object** ▲ — persists across scene transitions:

```ts
interface GameState {
  // World 1
  world1LoopCount: number;          // 0 = first visit

  // Roadside
  roadsidePhase: 0 | 1 | 2;        // 0=not started, 1=first pass died, 2=fought back
  roadsideDeaths: number;

  // Countdown
  countdownDay: number;             // 0–5 (Oct 25–30)
  countdownAnomaliesFound: number;

  // General
  currentScene: SceneName;
  flashlightWasOn: boolean;         // restored after scene transitions
}
```

**Transition sequence:**
1. `CutsceneDirector.fade(out)` → screen goes black
2. `activeScene.dispose(scene)` — geometry removed, all `.dispose()` called
3. `GameState` updated
4. `nextScene.build(scene, state)` — new geometry added
5. Player teleported to `spawnPoint`
6. `PlayerController.wallBoxes` and `InteractionSystem.setInteractables()` updated
7. `CutsceneDirector.fade(in)` → screen clears

---

### 2b. `AudioManager.ts` ▲ — built early, tested in P1

Wraps the Web Audio API. Built in Phase 1 and tested with a **generated oscillator tone** so browser audio activation, master volume, and looping are verified before any horror scenes are built.

```
AudioManager
  .init(): Promise<void>            ← creates AudioContext on first user gesture
  .setMasterVolume(0–1): void       ← driven by PauseMenu slider
  .playAmbient(url: string, fadeInSec?): void
  .stopAmbient(fadeOutSec?): void
  .playSFX(url: string, position?: THREE.Vector3): void
  .playTestTone(freq, dur): void    ← dev only, removed before release
```

**Node graph:**

```
SFX sources ──┐
               ├─► masterGain ─► AudioContext.destination
Ambient src ──┘
```

Positional audio: for SFX with a `position`, a `PannerNode` is inserted between the source and `masterGain`. Pan is updated from the `THREE.AudioListener`-compatible calculation (dot product of camera forward vs source direction) rather than requiring a full `THREE.Audio` setup.

**Browser activation note:** `AudioContext` cannot be created before a user gesture. `AudioManager.init()` is called inside the "Click to Start" handler, before pointer lock is requested.

**Audio files needed from user** (all deferred — AudioManager works silently without them):

| Slot | File path | Scene |
|---|---|---|
| Jail radio / shayaris | `public/audio/jail-radio.mp3` | Jail |
| Horror sting | `public/audio/horror-sting.mp3` | Birthday reveal |
| Hype music | `public/audio/hype.mp3` | Variant return |
| World 1 ambient | `public/audio/ambient-w1.mp3` | World 1 |
| World 2 ambient (rain) | `public/audio/ambient-w2.mp3` | World 2 |
| World 3 ambient (silence / bangle SFX) | `public/audio/bangle.mp3` | World 3 |
| World 4 ambient | `public/audio/ambient-w4.mp3` | World 4 |

---

### 2c. `CutsceneDirector.ts` ▲ — camera tweening included from P2

A synchronous step sequencer. Runs a `CutsceneStep[]` array one step at a time.

**Step types (all implemented in P2):**

```ts
type CutsceneStep =
  | { type: 'fade';       direction: 'in' | 'out'; durationSec: number }
  | { type: 'subtitle';   text: string;            durationSec: number; clearAfter?: boolean }
  | { type: 'wait';       durationSec: number }
  | { type: 'cameraAnim'; targetPos: THREE.Vector3; targetQuat: THREE.Quaternion;
                           durationSec: number; easing?: 'linear' | 'smooth' }
  | { type: 'callback';   fn: () => void }
  | { type: 'sfx';        url: string; position?: THREE.Vector3 }
```

**Cutscene safety contract** ▲:
- On `play()`: `player.enabled = false`, `interactionSystem.enabled = false`, `pauseMenu.suppressAutoLockPause()`, HUD hidden
- On `stop()` / sequence complete: all of the above restored, pointer lock re-requested if needed
- `cameraAnim` tweens `camera.position` and `camera.quaternion` using `THREE.Vector3.lerp` / `THREE.Quaternion.slerp` with a simple progress accumulator. Does not use external tween libraries.
- Camera position is restored to the player position after a cutscene if the cutscene moved the camera independently.

---

### 2d. `CharacterBuilder.ts` ▲ — complete roster including supporting figures

Returns a `THREE.Group` with sub-groups named consistently (`head`, `torso`, `leftArm`, `rightArm`, `leftLeg`, `rightLeg`) so animation code targets the same names across characters.

**Main characters (7):**

| ID | Character | Key visual features |
|---|---|---|
| `anaaya` | Anaaya (player avatar) | Standard proportions, medium hair box, dark tunic |
| `v1` | Military variant | Military-green material, shoulder pads (BoxGeometry), Trishul prop (3 cylinders) |
| `v2-clean` | Male variant — pre-transformation | Neutral-grey clothing, upright posture |
| `v2-bloody` | Male variant — post-transformation | Red emissive overlay meshes (torso, hands), 2 head-trophy props parented to hands (different hair-cylinder heights), slouched torso rotation |
| `v3` | Horror variant | Dark skin MeshStandardMaterial, red emissive eye spheres, exaggerated smile arc, bangles (TorusGeometry × 6), skull chest motifs (miniature box arrangement), tall black hair column |
| `v4` | Future Anaaya | Anaaya base, slightly greyed hair, lab-coat overlay mesh |
| `path1605` | Skeleton | White/ivory MeshBasicMaterial on all segments, seated pose baked in |

**Supporting figures (additional) ▲:**

| ID | Character | Used in |
|---|---|---|
| `beggar` | Beggar — initially passive | Roadside Phase 1 & 2 |
| `beggar-threat` | Beggar — threat pose | Roadside chase |
| `youngWoman` | Young woman from news report | Roadside escalation |
| `soldier-patrol` | Patrol soldier silhouette | World 1 apparition |
| `soldier-injured` | Injured soldier lying down | World 1 interactable |
| `woman-long-hair` | V2 victim 1 — longer hair | World 2 transformation cutscene |
| `woman-short-hair` | V2 victim 2 — shorter hair | World 2 transformation cutscene |
| `threat-thug` | Generic threat figure (×3 instances) | Roadside escalation |

**V3 preview milestone** ▲ — the Horror variant's `CharacterBuilder` will be built and a `npm run dev` screenshot will be reported **before** World 3 implementation begins. This allows visual confirmation that the silhouette and key features (red eyes, bangles, smile) are recognisable before committing to the chapter.

---

### 2e. `HorrorEffects.ts`

Utility functions; no class instance needed.

| Function | Behaviour |
|---|---|
| `apparitionAt(scene, mesh, pos, durationSec)` | Positions mesh, makes it visible, hides it after duration. Never approaches player. |
| `flickerLight(light, durationSec, minInt, maxInt)` | Sets random intensity at 80ms intervals for duration. |
| `moveWhenNotLooking(camera, mesh, targetPos, threshold)` | On each frame call: if dot(camera.forward, dir-to-mesh) < threshold, lerp mesh toward targetPos. |
| `roomChangeWhileLookedAway(camera, watchedDir, swapFn)` | Calls `swapFn()` once when camera turns sufficiently away from `watchedDir`. |
| `footstepLoop(audio, camera, intervalSec)` | Returns an interval ID; calls `audio.playSFX(footstepUrl, camera.position)` on interval. Caller cancels when player stops. |

**▲ World 3 mirror design — revised (fake mirror, no render-to-texture):**

Real render-to-texture mirrors require a second camera, a second render pass, and a `WebGLRenderTarget`. This doubles GPU work and is not feasible under the deadline. **All mirrors are fake** — flat `PlaneGeometry` with a `MeshStandardMaterial` of very low roughness (0.02) and slight blue tint to read as glass — a well-established game approximation.

The "shadow-double" (`playerDouble`) is a separate hidden `CharacterBuilder` Anaaya group added to the scene. Its transform is updated by `HorrorEffects.syncDouble`. The double is only visible through a `PlaneGeometry` mirror mesh by controlling which `THREE.Layers` it renders on: the double is on layer 1; only the mirror camera (a cheap orthographic camera rendering a small sub-section) renders layer 1.

> However, even this two-layer approach adds complexity. The plan therefore uses a **simpler fallback first**: the playerDouble is visible to the main camera but positioned just behind the mirror plane in a small offset chamber that the player cannot physically enter. When the player stands in front of the mirror, they see the double's back; the double's "anticipatory" moves are scripted callbacks, not real-time physics.

**▲ Anticipatory reflection — scripted triggers, not a ring buffer:**

The original plan attempted a 30-frame read-ahead ring buffer. A delayed copy cannot genuinely act *before* the player — it can only act after. The revised approach:

1. The puzzle has **3 trigger zones** (invisible `Box3` volumes) in front of the mirror wall.
2. When the player enters a trigger zone, a `CutsceneDirector` `CallbackStep` fires a **pre-authored animation** on `playerDouble` (e.g., the double raises its arm) while the player has not moved their arm.
3. The player must recognise the inconsistency and press E on the trigger-zone interactable to "identify" it.
4. After all 3 are identified, the final trigger fires: the double turns to face the player (its head Group rotates 180°) while the player is standing still. This is the visual payoff.

This approach is deterministic, debuggable, and producible within the deadline. It communicates the same narrative idea (the reflection acts independently) without requiring a speculative real-time system.

---

## 3. Complete revised file tree

```
bhp/
├── index.html                         ← EXTEND (add fade, subtitle, date, letter, endcard divs)
├── vite.config.ts                     ← untouched
├── package.json                       ← untouched
├── tsconfig.json                      ← untouched
├── public/
│   ├── audio/                         ← NEW (drop MP3s here when available)
│   └── images/                        ← NEW (drop approved images here when available)
└── src/
    ├── main.ts                        ← REPLACE (thin launcher → creates GameManager)
    ├── style.css                      ← EXTEND
    ├── systems/
    │   ├── Renderer.ts                ← untouched
    │   ├── InputManager.ts            ← untouched
    │   ├── PlayerController.ts        ← EXTEND (enabled flag, teleportTo)
    │   ├── Flashlight.ts              ← untouched
    │   ├── InteractionSystem.ts       ← EXTEND (setInteractables, enabled flag)
    │   ├── PauseMenu.ts               ← EXTEND (suppressAutoLockPause / restore)
    │   ├── GameManager.ts             ← NEW (owns all systems, game loop)
    │   ├── SceneManager.ts            ← NEW (scene lifecycle, GameState)
    │   ├── AudioManager.ts            ← NEW (Web Audio API, tested in P1)
    │   ├── CutsceneDirector.ts        ← NEW (step sequencer incl. cameraAnim)
    │   ├── CharacterBuilder.ts        ← NEW (all 15 character/figure variants)
    │   └── HorrorEffects.ts           ← NEW (apparition, flicker, moveWhenNotLooking, etc.)
    └── scenes/
        ├── types.ts                   ← NEW (IScene, SceneResult, GameState, SceneName)
        ├── PrologueScene.ts           ← NEW
        ├── World1Scene.ts             ← NEW
        ├── World2Scene.ts             ← NEW
        ├── World3Scene.ts             ← NEW (scariest — mirror puzzles, V3)
        ├── World4Scene.ts             ← NEW
        ├── JailScene.ts               ← NEW
        ├── RoadsideScene.ts           ← NEW
        ├── VariantReturnScene.ts      ← NEW
        ├── CountdownScene.ts          ← NEW
        ├── BirthdayRevealScene.ts     ← NEW
        └── BirthdayRoomScene.ts       ← NEW
```

---

## 4. Chapter-by-chapter mechanics (revised)

### Prologue — Anaaya's Room

**Environment:** Small bedroom. Desk + monitor (BoxGeometry stack), bookshelf (shelf units), CRT TV on wall (box + PlaneGeometry screen), bed. All procedural.

**Sequence:**
1. `CutsceneDirector` opens: fade in from black → TV is on, subtitles playing a fictional news report ("suspect remains at large — investigation ongoing" ▲). Player cannot move.
2. Subtitles persist one beat too long after the report changes. A flash of a silhouette appears in the dark TV-screen PlaneGeometry for 0.8 s using `apparitionAt`, then vanishes. Player tries to look — dot-product check confirms camera has turned; silhouette is already gone.
3. Player gains control to approach the computer.
4. Interacting with the monitor: `CutsceneDirector` pauses movement, DOM overlay displays terminal text: `CONNECTION RESTORED / SESSION FOUND / PARTICIPANTS: 2`. A visitor's silhouette (CharacterBuilder Anaaya base in full black emissive material) appears on the monitor PlaneGeometry.
5. Subtitle conversation: visitor knows personal details, warns "don't trust the first version of anything." Identity not revealed.
6. Transition → World 1.

**Horror technique:** TV subtitles that outlive their report (CSS animation delay). Figure in reflection disappears on player look-around (dot-product check → `apparitionAt` with 0 duration on camera turn).

---

### World 1 — Repeating Military Outpost ▲

**Environment:** Compact outdoor compound (12m × 16m). Sandbag clusters (stacked BoxGeometry), barbed wire fence (LineSegments), comms tower (stacked CylinderGeometry), medical tent (PlaneGeometry roof + walls), fog (`THREE.Fog` distance: 6–14).

**Loop mechanic (GameState.world1LoopCount):**
- First visit: world looks intact. Second visit: one sandbag cluster displaced, ambient light warmer. Third visit: tent canvas partially transparent, audio crackle louder. On loop-break, `world1LoopCount` is incremented in GameState.
- `World1Scene.build()` reads `state.world1LoopCount` and adjusts materials/positions accordingly. Dispose + rebuild is the cleanest approach for a 3-scene loop.

**Key mechanics:**
- Rotating `SpotLight` on a pivot Group (parent rotated via `update(dt)`). Apparition soldier (`CharacterBuilder.soldier-patrol`) placed at preset positions: 12m, 8m, 4m, 2m from player (each loop iteration picks the next-closest position).
- Injured soldier (`CharacterBuilder.soldier-injured`) lying near the tent. Interactable E: plays audio crackle + subtitle with a clue about the loop cause.
- Comms terminal: interactable that requires loop clue first. On activation: `CutsceneDirector` subtitle sequence reveals the alarm is a recording. `world1LoopCount` increments, transition fires.
- Distant movement: `moveWhenNotLooking` applied to a `soldier-patrol` figure on the far perimeter.

**Horror techniques:** Soldier apparitions at decreasing distances, movement when not watched, sound continuing after source disappears (AudioManager one-shot with 4s fade-out at a position).

---

### World 2 — Ruined Industrial City ▲

**Environment:** Linear path (4 city blocks). Building facades (PlaneGeometry + emissive window boxes), rain (`Points` system, 600 particles, downward velocity in `update(dt)`), broken pipe props.

**V2 companion — waypoint-based ▲ (not removed):**
- V2 (`CharacterBuilder.v2-clean`) starts at the scene spawn point beside the player.
- He has 4 scripted waypoints through the city (`THREE.Vector3[]`). In `update(dt)`: if player is within 6m of the next waypoint, V2 lerps toward that waypoint at 0.8× player speed.
- He speaks via `CutsceneDirector` subtitle steps triggered at each waypoint (player must be within 3m of him).
- At waypoint 3, V2 walks ahead into a building and stops. Player must follow.

**V2's transformation — cutscene (player disabled):**
1. `CutsceneDirector` fade to red tint.
2. Flashback subtitle: V2 narrates what happened. Two `CharacterBuilder` figures appear (`woman-long-hair`, `woman-short-hair`) in a scripted position — they do not move.
3. A stylised cut (full fade-to-black, then back) rather than a prolonged animation. After the cut, V2's Group is swapped from `v2-clean` to `v2-bloody` (the clean Group is disposed, the bloody Group with head-trophy props added to hand children is placed at the same position). Hair length difference is visually apparent: `woman-long-hair` trophy has a hair cylinder of height 0.35; `woman-short-hair` has height 0.15.
4. CutsceneDirector camera tween: camera pulls back to show V2 in his new state.
5. Player regains control. V2 is now at corridor ends, teleporting via `moveWhenNotLooking`.

**Horror techniques:** Rain AudioManager ambient, corridors change while looked away, V2 appearing outside rooms (teleport on camera turn), monitor shows inconsistent corridor layout.

---

### World 3 — The House That Sees You ← SCARIEST ▲

**Environment:** 5-room compact house. Hallway → sitting room (mirror wall) → narrow corridor → dark bathroom → dead-end room. All BoxGeometry walls, low ambient light, no fog (tight spaces use darkness instead).

**Mirror design — fake mirrors only ▲:**  
All mirror planes are `PlaneGeometry` with `MeshStandardMaterial` { roughness: 0.02, metalness: 0.9, color: 0x889999 }. They look like glass in low light. No render-to-texture. No second camera.

**`playerDouble` — controlled shadow-double ▲:**
A `CharacterBuilder.anaaya` group placed in a hidden offset chamber behind each mirror plane. The chamber is accessed through a gap in geometry that the player cannot enter (a 0.2m-wide passage). The double's transform is manually set to mirror the player's X position (X-flipped) at the same Z depth, giving the impression of a reflection. Its Y rotation is flipped. Updated every frame in `World3Scene.update()`.

**Anticipatory reflection — 3 scripted triggers ▲ (not a ring buffer):**
- Trigger zone A (hallway): player enters → double's `leftArm` Group rotates upward (arm-raise gesture). Player has not pressed anything. The gesture is a `CutsceneDirector.CallbackStep` timed to fire 0.4 s after the trigger is entered.
- Trigger zone B (narrow corridor): player pauses movement for 1 s → double takes two steps backward (position lerped -0.4m Z over 0.5 s). Player has not moved.
- Trigger zone C (dead-end room): player turns toward the mirror → double's head Group rotates 180° (faces the player directly). Player's camera forward only changed, not position.

Each trigger zone is an interactable (invisible Box3 collision, E to "identify inconsistency"). All 3 must be found.

**Final sequence:** After identifying all 3 inconsistencies, entering the sitting room triggers a `CutsceneDirector` sequence: mirror shatters (mirror PlaneGeometry hides, a `Points` burst plays), and V3 steps through the gap — finally visible and facing the player. She looks at the player for 3 s (she does not approach), then steps back. Subtitle: she was containing the imitation.

**V3 appearance mechanics:**
- `CharacterBuilder.v3` full design: dark brown `MeshStandardMaterial` (color: 0x3b2518) on face/arms, red emissive spheres for sclera, smile arc (a thin torus segment at z-offset from face, white emissive), 6 `TorusGeometry` bangles (3 per wrist, gold emissive), skull chest (5 miniature box groups arranged in skull shape, ivory emissive), tall black hair column (BoxGeometry 0.1 × 0.5 × 0.1, black).
- Appears using `apparitionAt` at corridor ends only. Duration 0.8 s. Never approaches.
- Bangle sound: `AudioManager.playSFX('public/audio/bangle.mp3', v3.position)` called 1.5 s before `apparitionAt` fires.

**Horror techniques:** Bangle sound before every appearance, scripted anticipatory reflection (triggers above), footsteps that stop when player stops (footstepLoop cancelled immediately on movement stop), room changes while looked away (one prop swapped in the dark bathroom), silhouette behind a translucent thin plane in the bathroom, extended silence broken by a single loud sound (AudioManager one-shot at max gain).

**Functional check for World 3:** Before starting World 3 implementation, the V3 `CharacterBuilder` output is rendered in isolation and reported with a dev-server screenshot description.

---

### World 4 — Abandoned Medical Facility

**Environment:** Clinical hallway + 2 rooms. Fluorescent flicker effect (two `PointLight`s cycling intensity via `flickerLight`), IV stand (thin cylinder + crossbar), bed frame (BoxGeometry cluster).

**Key mechanics:**
- Clue trail: erased record (dark `PlaneGeometry` interactable → canvas texture reveals handwritten text progressively in `update`), two clocks showing different times (cylinder + Box hands).
- Note interactable: "I thought knowing what would happen would make it easier to live."
- Future Anaaya (V4) appears at the far end of the hallway. Each time player approaches, she moves further away (lerp away from player in `update`). Her movement becomes more erratic.
- Identity reveal: medical room mirror (fake, same material as World 3). Player approaches → V4's double does not mirror correctly — it turns to face the player. A subtitle fires: V4 says a phrase Anaaya heard from the visitor in the Prologue. This is the confirmation clue, not an exposition dump.
- Dialogue: 5 subtitle exchanges. V4's core line: "Don't become me just because you've seen me. I'm one possible answer to your life, not the only one."
- Escape sequence: `CutsceneDirector` activates environmental overlap (two `THREE.Group`s from different worlds slowly fade in at opacity 0.3 via `material.transparent = true, material.opacity`). Four variant groups enter from four doors. Player presses 3 interactable buttons. Each press triggers one variant's "hold" animation (scripted group transform). Final button: `CutsceneDirector` full sequence — each variant visible, then fade out. GameState updated.

**Horror techniques:** Echo overlap (two semi-transparent environment groups), erratic V4 movement, inconsistent clock times, fluorescent flicker.

---

### Jail Scene — Comedy Interlude

**Environment:** Small cell room (vertical cylinder bars across front wall), concrete box walls. Sign on back wall uses a canvas texture reading `rison of prison :)` in rough handwritten-style font.

**Key mechanics:**
- `path1605` skeleton (`CharacterBuilder.path1605`) seated against back wall, arms on knees.
- Interacting (E): AudioManager plays jail-radio track (user-supplied); subtitle shows shayari placeholder text.
- Door interactable: `SceneManager.loadScene('roadside')`. Before transition, `GameState.roadsidePhase` is checked (0 = first visit, 1 = after first death).

---

### Roadside Scene — Two-Stage Chase ▲

**Environment:** Straight footpath (30m long, 3m wide). Building facades on left, road divider on right. Road is 5m wide beyond the divider.

**News-beggar continuity ▲:**  
An interactable poster/notice board near the footpath start shows a news item (canvas texture, placeholder text): "Suspect at large — public advised to stay alert." The beggar's `CharacterBuilder.beggar` shares a distinctive visual detail with the news-report silhouette from the Prologue (same clothing colour, same hat shape). This is a deliberate visual rhyme, not exposition.

**Road boundary (Salman Khan gag):**
Invisible trigger box at road edge. On enter: `CutsceneDirector` subtitle "Radhe Radhe", AudioManager plays placeholder honk, a BoxGeometry jeep model sweeps past at high speed, player is pushed back to footpath. Can only trigger once per visit.

**Phase 1 — First pass (roadsidePhase === 0):**
1. Beggar (`CharacterBuilder.beggar`) stands near the start. Player approaches → E triggers subtitle "kya re bhikh-mangya" → player walks away.
2. 5 seconds later: AudioManager plays a strange sound from behind. Beggar Group switches to `threat` pose (arms raised, head tilted). Begins lerp-chase at 1.3× player speed.
3. If caught (beggar within 1m): red screen fade → subtitle "You wake up..." → `GameState.roadsidePhase = 1`, `roadsideDeaths++` → `SceneManager.loadScene('jail')`.

**Phase 2 — Second pass (roadsidePhase === 1):**
1. Beggar visible. Player may walk past without interacting. After 5 seconds: same strange sound, same chase.
2. During the chase: when beggar is within 3m, E key becomes available ("Fight back"). Press E → `CutsceneDirector` plays stylised nail-scratch sequence (emissive red streak mesh appears on beggar torso, AudioManager scream SFX, beggar's Group lerps backward 2m, roadsidePhase = 2).
3. Player gets ~4 seconds of distance.

**Escalation:**
- 3 `CharacterBuilder.threat-thug` figures emerge from side alleys (scripted positions, lerp toward player).
- `CharacterBuilder.youngWoman` appears from the far end of the footpath, runs toward the player, and stands beside her. Both characters fight back (scripted animations: arm-swing callbacks in a `CutsceneDirector` sequence).
- Eventually all 5 opponents surround both characters. A brief `CutsceneDirector` sequence shows them being overwhelmed (camera tilts, sound distorts).

**Variant arrival:**
- Screen shakes (camera position += small random noise in `update` for 1 s).
- A directional light intensity increases from the right.
- Four variant Groups (`v1`, `v2-bloody`, `v3`, `v4`) enter from the right edge at staggered intervals (1 s apart), each via a `CameraAnimStep` that pans briefly to show each arrival.
- Each variant engages a thug: lerp to thug position, thug Group hides, variant plays a characteristic pose (scripted callback).
- AudioManager plays hype track (user-supplied placeholder).
- Short subtitle per variant confirming their identity.
- CutsceneDirector final fade: all opponents cleared. `SceneManager.loadScene('countdown')`.

---

### Countdown — October 25–30 ▲

**Environment:** Anaaya's room (reuse Prologue geometry group, different ambient lighting per day).

**Structure — all 6 days preserved, 3 fully interactive ▲:**

| Day | Oct | Type | Content |
|---|---|---|---|
| 0 | 25 | ★ Interactive | Anomaly: the comms terminal prop from World 1 appears on Anaaya's desk. E to inspect: radio static, then silence. |
| 1 | 26 | Brief transition | Date stamp appears, ambient sound flickers once, auto-advance after 8 s. |
| 2 | 27 | Brief transition | Countdown room photo (approved Roblox screenshot placeholder) slightly shifted. Auto-advance after 8 s. |
| 3 | 28 | ★ Interactive | Anomaly: a clock on the wall shows a different time from World 4. E to inspect: subtitle "You've seen this time before." |
| 4 | 29 | Brief transition | A shadow-double briefly visible in the window (apparitionAt, 0.6 s). Auto-advance after 8 s. |
| 5 | 30 | ★ Interactive | Anomaly: a note on the bed reads "Tonight." E to pick up. Transition to Birthday Reveal triggered by player interacting with the bed. |

Brief-transition days: `CutsceneDirector` runs a 3-step sequence (fade in → date stamp → anomaly → fade out → advance day). No player control required.

`GameState.countdownDay` increments on each advance. `CountdownScene.update()` drives the day state machine.

---

### Birthday Reveal — Toilet Scene

**Sequence:**
1. Night 30 → 31. `CutsceneDirector` scripted camera tween toward bathroom door (player disabled). Relaxing ambient tone.
2. Fade to black. 3 s of silence.
3. Two red emissive `SphereGeometry` eyes appear in darkness (scale 0 → 0.12 over 0.3 s).
4. AudioManager plays horror sting (user-supplied placeholder: generated oscillator pulse if no file).
5. Two candle `CylinderGeometry` meshes with `PointLight` (warm orange) blink on.
6. Room ambient jumps (AmbientLight intensity 0 → 0.6 over 0.1 s).
7. Fade in: player is back in bedroom. `CharacterBuilder.path1605` stands beside the bed, arms raised holding a cylinder-cake with tiny candle-box geometries on top.
8. `CutsceneDirector` subtitle: birthday song (text placeholder, user fills in).
9. Callback: a pale blue disc mesh appears beneath the bed (wet-stain indicator). `path1605` Group jumps upward (Y position + 0.5 over 0.2 s, then back), subtitle: a comic reaction line (placeholder).
10. Transition → Birthday Room.

---

### Birthday Room — Letter + Ending

**Environment:** Warmly lit room. Warm pink/gold ambient. Balloon groups (sphere clusters), streamer arcs (`TubeGeometry`), table with tiered cake (stacked cylinders), banner (PlaneGeometry canvas texture: "Happy Birthday").

**Key mechanics:**
- Interacting with the letter on the table: HUD hides, DOM `#letter-overlay` slides into view. Styled scrollable text with warm typography. Placeholder text until user provides final wording.
- "Close" button on the overlay → HUD restores.
- Interacting with the door: `CutsceneDirector` final fade-to-black. DOM `#endcard-overlay` appears full-screen: "For Lakshmi…" in large serif type. Smaller ending credits below.
- No more input after this point. Page stays on end card.

---

## 5. Implementation phases — revised order ▲

> Each phase ends with a `tsc --noEmit` + `npm run dev` functional check before the next phase begins.

| Phase | Days est. | Work | Functional check |
|---|---|---|---|
| **P0** | 0.5 | Extend existing systems: `PlayerController.enabled + teleportTo`, `InteractionSystem.setInteractables + enabled`, `PauseMenu.suppressAutoLockPause/restore`. Extend `index.html` + `style.css` with `#fade-overlay`, `#subtitle-bar`, `#date-stamp`, `#letter-overlay`, `#endcard-overlay`. | TypeScript clean. Overlays visible in browser. |
| **P1** | 0.5 | `scenes/types.ts` (IScene, SceneResult, GameState, SceneName). `SceneManager.ts`. `AudioManager.ts` with oscillator test tone. `GameManager.ts` (replaces `main.ts`). | Dev server loads. AudioManager plays test tone on start click. SceneManager can be called without error. |
| **P2** | 0.5 | `CutsceneDirector.ts` — all 6 step types including `cameraAnim`. Test with a 5-step demo sequence in the existing graybox scene. | Demo cutscene plays: fade out, subtitle appears, camera moves, subtitle clears, fade in. Player controls frozen during sequence and restored after. |
| **P3** | 1.0 | `CharacterBuilder.ts` — all 15 figures. Render each in isolation in a test scene using `npm run dev`. **V3 preview reported before World 3 begins.** | All 15 figures render without errors. V3 silhouette confirmed: red eyes, bangles, smile, tall hair visible. |
| **P4** | 0.5 | `HorrorEffects.ts` — all 5 utility functions. Test each with a throw-away scene. | Each effect works in isolation: apparition hides after duration, light flickers, prop moves when camera turns away, mirror desync visible, footstep loop starts/stops. |
| **P5** | 0.5 | Prologue scene. Remove `Room.ts` from `main.ts` (it stays in the repo but is no longer loaded). | Full Prologue plays: TV news subtitles, silhouette apparition, player gains control, computer interaction triggers terminal overlay, visitor appears. Transition placeholder accepted. |
| **P6** | 1.0 | World 1 — outpost geometry, searchlight, 3-loop mechanic, apparition soldier, comms terminal, loop-break transition. | Player can walk the outpost. Searchlight rotates. Soldier appears progressively closer each loop. Comms terminal triggers loop-break and scene transition. |
| **P7** | 1.0 | World 2 — city geometry, rain particles, V2 waypoint companion, monitor inconsistency, transformation cutscene, V2 post-transform apparitions. | V2 walks with player to waypoints. Transformation cutscene plays, V2 model swaps, head trophies visible with different hair heights. |
| **P8** | 1.5 | World 3 — 5-room house, fake mirrors, playerDouble scripted sync, 3 trigger zones + anticipatory animations, V3 appearances (bangle sound → apparition), final reveal sequence. | All 3 trigger inconsistencies can be found and identified. V3 appears and disappears at corridor ends. Final mirror shatter + V3 reveal sequence plays. |
| **P9** | 1.0 | World 4 — medical facility, clue trail, V4 evasive movement, identity reveal mirror, variant arrival escape sequence. | Clue trail completable. V4 identity reveal fires. All 4 variants enter. 3-button escape completable. |
| **P10** | 1.0 | Jail scene + Roadside (both phases + escalation + variant return). GameState persistence across Jail→Roadside→Jail→Roadside. | Phase 1 death respawns to Jail. Phase 2 scratch interaction fires. All 4 variants enter dramatically. Transition to Countdown works. |
| **P11** | 1.0 | Countdown (6 days, 3 interactive). Birthday Reveal (toilet scare sequence). Birthday Room (letter overlay, end card). | Full countdown completable. Horror reveal fires. Birthday room letter overlay opens and closes. End card displays. |
| **P12** | 0.5 | Audio file integration (drop in `public/audio/` when supplied). Image integration (`public/images/`). Letter text. Polish: timing, lighting, subtitle phrasing. Final `npm run build` + preview check. | Production build succeeds. All integrated audio plays at correct volumes. |

**Total estimated days: 10.5** against a ~9-day window. There is no slack. Phase 8 (World 3) is the highest risk item; it will be started first thing on its assigned day with no dependency on unfinished items from P7.

---

## 6. Deadline risk assessment (revised)

| Risk | Severity | Status |
|---|---|---|
| 10+ scenes in 9 days | 🔴 HIGH | Mitigated: brief-transition days for quiet Countdown days; all geometry is reused BoxGeometry; no external assets needed |
| World 3 mirror complexity | 🟠 MEDIUM → 🟢 LOW | **Resolved**: fake mirrors + scripted triggers. No ring buffer, no render-to-texture. |
| V2 companion now retained | 🟠 MEDIUM | Mitigated: waypoint lerp is ~40 lines of code; simpler than AI following |
| CharacterBuilder covers 15 figures | 🟠 MEDIUM | All built in one session (P3). Reuse sub-components (torso, head, limbs) across figures |
| AudioManager deferred | 🟠 MEDIUM → 🟢 LOW | **Resolved**: AudioManager built and tested in P1 with oscillator; silent-stub fallback if no files provided |
| CutsceneDirector missing camera anim | 🟠 MEDIUM → 🟢 LOW | **Resolved**: `cameraAnim` step included in P2 spec |
| V3 visual quality | 🟠 MEDIUM | Preview confirmed at end of P3 before any World 3 code is written |
| Audio files not supplied | 🟡 LOW | Game is silent but completable. Integration is a file-drop + one-line URL update |
| Letter text not finalised | 🟡 LOW | DOM overlay; text is a single string constant, swappable at any time |
| Approved images not supplied | 🟡 LOW | Placeholder colour panels in birthday room; replaced with actual images as `<img>` texture when provided |

---

## 7. What must be supplied by the user

| Asset | Required for | When needed |
|---|---|---|
| Radio shayaris / songs (`public/audio/jail-radio.mp3`) | Jail scene | Before P12 |
| Horror sting (`public/audio/horror-sting.mp3`) | Birthday reveal | Before P12 |
| Hype music (`public/audio/hype.mp3`) | Roadside climax | Before P12 |
| World ambient loops (optional) | All worlds | Before P12 |
| Bangle SFX (`public/audio/bangle.mp3`) | World 3 | Before P8 |
| Birthday letter text | Birthday room | Before P11 |
| Approved Roblox screenshot | Birthday room / Countdown day 26 | Before P11 |
| Approved Shin-chan / Shizuka images | Countdown room decor | Before P11 |
| Confirmed "For Lakshmi…" wording | End card | Before P11 |
| Comic reaction line for birthday gag | Birthday reveal | Before P11 |
| Birthday song text / lyrics | Birthday reveal subtitle | Before P11 |

**Do NOT supply:** Anaaya's recorded voice. Unconfirmed real name spelling beyond "Lakshmi". Private voucher codes or redemption details.

---

## 8. No new npm dependencies

All implementation uses:
- `three` (installed)
- Web Audio API (browser built-in)
- Canvas 2D API (browser built-in, for text/image textures)
- `requestAnimationFrame` (browser built-in)

No physics engine, no model loader, no tween library, no additional packages.

---

## 9. Open items requiring user confirmation before implementation

The following items remain open. Implementation will begin on any approved phase once these are answered, but answers to items 1 and 2 are needed before P2 and P3 respectively.

1. **V3 appearance specifics:** The plan approximates the lower-body design of the Horror variant as a dark skirt (flattened cylinder) with skull-motif texture (canvas texture on a PlaneGeometry). Is that acceptable, or do you have a specific lower-body design in mind?

2. **Comic reaction line (birthday gag):** Do you want to write the path1605 reaction subtitle yourself, or should I draft a few options for your approval?

3. **Birthday letter:** The plan uses a warm placeholder. Would you like a full draft letter written for your review now, or will you supply the text before P11?

4. **Shayari text for jail radio:** Should I write placeholder shayari text (flagged clearly as placeholder), or will you supply it?

5. **V2's two victims:** Are there any details about the two women (names, appearance beyond hair length, connection to the story) that should be reflected in the cutscene geometry or subtitles?
