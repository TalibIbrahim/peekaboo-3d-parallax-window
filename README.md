# Peekaboo — 3D Head-Tracked Living Window ("Virtual Fish-Tank VR")

"Peekaboo" is a browser application that turns your screen into a real physical window into interactive 3D living worlds using webcam head tracking and off-axis (asymmetric frustum) perspective projection.

Unlike simple "orbit camera" effects, the camera stays at your estimated eye position, always faces strictly forward along $-Z$, and dynamically recalculates the projection matrix each frame so the frustum edges lock to the four borders of your physical display. When you lean left, you see deeper behind the right side of objects; when you lean in, your field of view widens; and objects in the front zone float out in front of your screen.

---

## The Living Scenes

Peekaboo features four dynamic scenes switchable in real time:

### 1. Abyss (`[1]` key)
- A bioluminescent underwater reef cave with displaced rock walls and an open top.
- Sandy seafloor with procedural domain-warped animated caustics.
- **Hero GPGPU Boids Fish School** (576 to 2,304 fish) with custom wagging tail vertex shaders.
- **Face as Predator**: Leaning in to $\le 35\text{ cm}$ causes nearby fish to scatter away from your gaze; leaning back allows them to regroup.
- Periodic shark shadow crossing at $Z \approx -45\text{ cm}$ triggering an emergency school dart.
- Translucent pulsing jellyfish (including a hero pop-out jelly at $Z \approx +5\text{ cm}$), swaying kelp ribbons, light shafts, and a distant gliding manta ray silhouette at $Z = -65\text{ cm}$.

### 2. Tiny World (`[2]` key)
- A floating diorama island at twilight featuring Glen Fox's **Littlest Tokyo** with continuous animation.
- Image-Based Lighting (IBL) via PMREM `RoomEnvironment` with warm directional sunlight and PCFSoft shadow maps.
- Floating low-poly clouds, multi-layer mountain silhouettes at $Z = -70, -60, -50\text{ cm}$, fireflies, and an orbiting flock of procedural birds.
- **Hero Robot (RobotExpressive)**:
  - Stands on a floating disc in the front pop-out safe zone ($Z \approx +4.5\text{ cm}$).
  - **Head-tracking gaze**: The robot's head bone actively turns to look directly at your face (clamped $\pm 50^\circ$ yaw, $\pm 25^\circ$ pitch).
  - **Reactive State Machine**: Waves when your face reappears after absence, jumps with surprise when you lean in ($Z < 32\text{ cm}$), and breaks into a dance if you stay still for 15 seconds.

### 3. Starfall (`[3]` key)
- A massive GPGPU curl-noise **River of Light** (147,000 to 590,000 particles) swirling along a sinusoidal centerline.
- Color ramp by speed and age (indigo $\to$ cyan $\to$ magenta $\to$ white-gold) with additive blending and physically correct point sizing.
- Rotating gas giant with procedural noise bands, atmospheric fresnel terminator, tilted rings, and 3 orbiting moons.
- **Fly-By Comet Event**: Every 12–20 seconds, a high-speed comet swings out to $Z \approx +8\text{ cm}$ in front of the screen with a 600-particle ring buffer tail.
- Twinkling starfield and floating ambient dust motes.

### 0. Calibration Room (`[0]` key)
- The baseline metric room with neon cyan/magenta grid lines spaced at 5 cm and 25 cm intervals.
- Floating cubes, spheres, and prisms at varied depths ($Z = -10, -25, -40, -55\text{ cm}$) with contact shadows.
- Rings tunnel along $Z$ and pop-out gemstones in front of the screen.

---

## Controls & Keyboard Shortcuts

| Key | Action |
|---|---|
| **`1` / `2` / `3` / `0`** | Switch directly between Abyss, Tiny World, Starfall, and Calibration |
| **`←` / `→` (Arrows)** | Cycle to previous / next scene (smooth 350 ms fade transition) |
| **`P`** | Pause / Resume Gallery Mode (auto-cycles every 45 seconds) |
| **`F`** | Toggle Fullscreen *(recommended for 1:1 physical perspective scale)* |
| **`H`** | Toggle Settings Drawer |
| **`R`** | Recenter view (calibrates your eye height to screen center) |

---

## Graphics Quality Tiers

In the Settings Drawer, choose your desired quality tier:
- **Low**: Pixel ratio 1.0, bloom post-processing disabled, reduced particle counts (great for low-power laptops).
- **Medium** (Default): Pixel ratio $\le 1.5$, half-resolution UnrealBloomPass, balanced simulations.
- **High**: Pixel ratio $\le 2.0$, full-resolution bloom, PCFSoft shadow maps, high-density particle rivers.
- **Auto**: Begins at Medium; monitors average frame rate over 120 frames and automatically drops one tier if FPS dips below 48.

---

## 3D Asset Setup

To fetch and verify the 3D models (`LittlestTokyo.glb` and `RobotExpressive.glb`), run:
```bash
node scripts/fetch-assets.mjs
```
The models are stored locally in `assets/models/`. If assets are ever absent, Peekaboo automatically deploys graceful procedural placeholders without interrupting the experience.

---

## Running the Application

### 1. Launch the local web server
```bash
# Using Node:
node server.js

# Or on Windows:
serve.bat

# Or using Python:
python -m http.server 8000
```

### 2. Open in your browser
Navigate to:
```
http://localhost:8000
```

Click **"Start Camera"** (or **"Try with Mouse Fallback"**), look at the center of your screen, press **`R`** to calibrate, and press **`F`** for fullscreen immersion!

---

## Credits & Attributions
See [`CREDITS.md`](file:///c:/Programming/Peekaboo/CREDITS.md) for full licensing and attribution details for Littlest Tokyo (Glen Fox), RobotExpressive (Tomás Laulhé / Don McCurdy), Three.js techniques, and Simplex Noise (Ashima Arts).
