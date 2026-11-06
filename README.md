# Peekaboo: your screen as a window

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-00f0ff?style=for-the-badge&logo=github)](https://talibibrahim.github.io/peekaboo-3d-parallax-window/)
[![Three.js](https://img.shields.io/badge/Three.js-r160-black?style=for-the-badge&logo=three.js)](https://threejs.org/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Face%20Landmarker-blue?style=for-the-badge&logo=google)](https://developers.google.com/mediapipe)

**Live:** https://talibibrahim.github.io/peekaboo-3d-parallax-window/ · [mouse-only demo](https://talibibrahim.github.io/peekaboo-3d-parallax-window/?mode=mouse)

Peekaboo uses your webcam to find your eyes, then renders 3D worlds with an **off-axis projection** locked to the physical edges of your display. The screen stops being a picture and becomes a window: lean left and you see around the right side of things, lean in and the view widens, and objects in front of the glass float in your room. It's the effect from Johnny Lee's 2007 Wii head-tracking demo, in a browser tab, with no install.

> **Tip:** close one eye. With both eyes open your brain can tell the screen is flat; with one, the illusion is startling.

## Quick start

```bash
npm start            # or: node server.js   (Windows: double-click serve.bat)
```

Open http://localhost:8000. The first run downloads the two 3D models (~5 MB) into `assets/models/`. Node 18+ is the only requirement. The page itself is plain ES modules from a CDN, so there's no build step.

The camera only works in a secure context: `localhost` or HTTPS. To try it on another device, serve it over HTTPS (GitHub Pages, a tunnel, etc.).

### Getting the effect right

1. **Go fullscreen** (`F`).
2. **Set your screen size.** Settings → *Screen diagonal*, or click **Measure…** and size the on-screen outline to a bank card held against the glass. If this is wrong, depth feels wrong.
3. **Recenter** (`R`) while sitting straight in front of the middle of the screen. This calibrates where your webcam is relative to the screen.
4. If depth still feels too deep or too shallow, adjust *Webcam field of view* first, then *Interpupillary distance*.

## Scenes

| Key | Scene | What to try |
|---|---|---|
| `1` | **Abyss**: a reef cave with a GPU boids school (256 / 576 / 1024 fish by quality tier), jellyfish, kelp and a passing shark | Lean in toward the glass and the school parts around your face. When the shark cruises past, the fish bolt. |
| `2` | **Tiny World**: Glen Fox's *Littlest Tokyo* at dusk, with an animated robot companion | The robot turns its head and body to make eye contact. It waves when you come back, sits down when you leave, jumps when you lean in close, and dances if you hold still. |
| `3` | **Starfall**: a curl-noise river of up to 65k light particles, a ringed gas giant, and a comet | Every 15 s or so a comet arcs out *through* the glass and back. Your gaze gently pulls the river toward it (tunable). |
| `0` | **Calibration Room**: a box exactly the size of your screen, ruled every 5 cm | Grid squares should look square from wherever you sit. If they don't, fix the screen size. |

## Controls

| Key | Action |
|---|---|
| `1` `2` `3` `0`, `←` `→` | Pick scene / previous / next |
| `F` | Fullscreen |
| `R` | Recenter on your head |
| `M` | Switch camera ↔ mouse |
| `P` | Gallery mode (new scene every 45 s) |
| `S` or `H` | Settings |
| `D` | Debug HUD (camera view, eye position, FPS, inference time) |
| `?` | Help |
| `Esc` | Close panels |

In mouse mode, the pointer stands in for your head and the **scroll wheel** moves you closer or further. The HUD fades out after a few seconds of inactivity, so nothing breaks the illusion.

**URL parameters:** `?scene=abyss|tinyworld|starfall|calibration`, `?mode=mouse` (skip the start screen), `?ui=0` (kiosk mode, no HUD). The current scene is kept in the URL, so links are shareable.

## How it works

```
webcam ──► MediaPipe Face Landmarker ──► iris landmarks ──► eye position (cm, camera space)
            (once per camera frame)        3D IPD → depth
                                                │
           webcam offset + window position ◄────┘  (camera space → screen space → viewport space)
                                                │
                     1€ filter per axis + velocity extrapolation (latency compensation)
                                                │
             off-axis frustum: camera at eye, looking down −Z, frustum edges = viewport edges
```

- **Tracking** (`src/tracker.js`) runs inference in `requestVideoFrameCallback`, i.e. once per new camera frame rather than once per rendered frame, and timestamps each sample. Depth comes from the distance between the irises, measured in 3D using the landmarks' z component, so turning your head doesn't make you appear to move away.
- **Physical geometry** (`src/core/display.js`) converts CSS pixels to centimetres from the screen diagonal and the *screen's* resolution, so scale stays right when the browser isn't fullscreen. It also tracks where the browser window sits on the monitor: drag the window around and the view through it changes, as it would with a real window.
- **Filtering** (`src/filters.js`) applies a [1€ filter](https://gery.casiez.net/1euro/) per axis, then extrapolates by the sample's age plus the filter's own lag using an unbiased velocity estimate. That removes most of the "swim" of head-coupled perspective without giving up jitter suppression. When your face is lost, the view holds briefly, then drifts to a resting position.
- **Projection** (`src/projection.js`) builds an asymmetric frustum through the four screen corners every frame (Kooima, *Generalized Perspective Projection*). The unit tests check the defining property: a point on the glass doesn't move as you move.
- **Rendering** (`src/core/post.js`): ACES tone mapping and bloom, with Low / Medium / High tiers. *Auto* measures real frame times and steps down when it has to. It will try stepping back up, but never into a tier that has already failed.
- **Scenes** (`src/scenes/*.js`) export `create(ctx)`, which returns `{ root, update(dt, t, eye, stage, presence), dispose() }`. `presence` tells a scene whether someone is actually being tracked, so the scene can react when you arrive or leave.

## Development

```bash
npm install   # dev-only: three.js for the unit tests
npm test      # projection math, filters, display geometry
```

```
src/
  main.js            app wiring and the per-frame loop
  tracker.js         webcam + MediaPipe → eye samples
  filters.js         1€ filter, HeadPoseFilter (smoothing + prediction)
  projection.js      off-axis camera
  ui.js              start screen, HUD, settings, help, card calibration, input
  core/display.js    px ↔ cm, window position on the physical screen
  core/stage.js      stage dimensions, pop-out safe zone, edge check
  core/post.js       renderer, bloom, quality tiers
  core/assets.js     glTF loading (Draco/Meshopt), CDN fallback, procedural fallbacks
  core/dispose.js    GPU resource cleanup
  scenes/            abyss, tinyworld, starfall, calibration + SceneManager
  shaders/           shared GLSL (noise, caustics, edge fade)
tests/               node:test unit tests
```

**Edge check** (Settings → Developer) tints pop-out objects red if any extreme head position would make them cross the window frame. Objects in front of the glass that get clipped by the screen edge break the illusion instantly.

## Known limitations

- Head tracking uses one camera and assumes average eye spacing, so absolute depth is an estimate. Recenter and the FOV/IPD sliders exist for that reason.
- Face inference runs on the main thread (a few ms per camera frame on a GPU). Moving it to a worker would free up more frame time on slow machines.
- Scenes are designed at laptop-to-monitor scale. On a phone the geometry is physically correct, but the content looks large through such a small window.
- Window-position tracking estimates the browser's toolbar height from `outerHeight − innerHeight`. Unusual browser chrome can offset it slightly; turn it off in Settings if the view seems shifted.

## Credits

See [CREDITS.md](CREDITS.md). 3D models: *Littlest Tokyo* by Glen Fox (CC BY 4.0) and *RobotExpressive* by Tomás Laulhé with modifications by Don McCurdy (CC0).
