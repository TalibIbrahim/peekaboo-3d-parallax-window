import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { edgeFadeVertexGLSL } from '../shaders/edgeFade.js';
import { disposeObject } from '../core/dispose.js';

const GAZE_YAW_LIMIT = 0.95;    // rad, ~55°, combined head + body
const GAZE_PITCH_LIMIT = 0.5;   // rad, ~28°
const BODY_SHARE = 0.35;        // fraction of yaw taken by turning the whole body
const ABSENT_BEFORE_SIT_S = 6;
const STILL_BEFORE_DANCE_S = 14;

export default {
  id: 'tinyworld',
  name: 'Tiny World',
  tagline: 'A floating diorama at dusk, and a robot who notices you',
  hint: 'Say hi to the robot. Lean in close and it will jump.',

  async create(ctx) {
    const { renderer, stage, assets, quality, onProgress } = ctx;
    const T = THREE;
    const root = new T.Group();
    root.name = 'TinyWorldRoot';
    const tier = quality || 'Medium';
    const shadows = tier === 'High';
    const disposables = [];

    // 1. Image-based lighting: gives the diorama's PBR materials real reflections.
    const pmrem = new T.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
    disposables.push(envTexture);

    const hemiLight = new T.HemisphereLight(0xffe2c4, 0x1a1436, 0.5);
    root.add(hemiLight);

    const sunLight = new T.DirectionalLight(0xffb27a, 1.6);
    sunLight.position.set(26, 22, -10);
    sunLight.target.position.set(0, -4, -18);
    root.add(sunLight, sunLight.target);
    if (shadows) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      Object.assign(sunLight.shadow.camera, { near: 1, far: 90, left: -24, right: 24, top: 24, bottom: -24 });
      sunLight.shadow.bias = -0.0005;
      sunLight.shadow.normalBias = 0.02;
    }

    // Warm fill from the viewer's side so the street front isn't in silhouette.
    const fillLight = new T.DirectionalLight(0xc8b4ff, 0.55);
    fillLight.position.set(-10, 8, 40);
    root.add(fillLight);

    // 2. Twilight sky dome with a sun glow baked into the gradient.
    const sunDir = new T.Vector3(0.16, 0.05, -1).normalize();
    const skyGeo = new T.SphereGeometry(1200, 32, 16);
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: { sunDir: { value: sunDir } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float y = dir.y;
          vec3 zenith  = vec3(0.035, 0.03, 0.11);
          vec3 mid     = vec3(0.26, 0.12, 0.30);
          vec3 horizon = vec3(0.92, 0.46, 0.30);
          vec3 col = y > 0.0
            ? mix(mix(horizon, mid, smoothstep(0.0, 0.12, y)), zenith, smoothstep(0.08, 0.6, y))
            : mix(horizon, vec3(0.03, 0.02, 0.07), smoothstep(0.0, 0.25, -y));
          float s = max(dot(dir, sunDir), 0.0);
          col += vec3(1.0, 0.62, 0.32) * pow(s, 18.0) * 0.55;  // broad glow
          col += vec3(1.0, 0.85, 0.6) * smoothstep(0.9994, 0.9997, s) * 1.6; // disc
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    root.add(new T.Mesh(skyGeo, skyMat));

    // 3. Layered mountain ridges. Unlit, tinted toward the haze with distance.
    const ridges = [
      { z: -95, base: -2, amp: 7, color: 0x3a2350 },
      { z: -75, base: -5, amp: 6, color: 0x2a1a40 },
      { z: -58, base: -8, amp: 5, color: 0x1b1230 }
    ];
    for (const [idx, r] of ridges.entries()) {
      const shape = new T.Shape();
      const w = 260;
      shape.moveTo(-w, -60);
      for (let x = -w; x <= w; x += 2.5) {
        const h = r.base
          + Math.sin(x * 0.045 + idx * 2.1) * r.amp
          + Math.sin(x * 0.11 + idx * 5.3) * r.amp * 0.45
          + Math.sin(x * 0.27 + idx) * r.amp * 0.15;
        shape.lineTo(x, h);
      }
      shape.lineTo(w, -60);
      const mesh = new T.Mesh(new T.ShapeGeometry(shape), new T.MeshBasicMaterial({ color: r.color, fog: false }));
      mesh.position.z = r.z;
      root.add(mesh);
    }

    // 4. Drifting low-poly clouds
    const cloudGeo = new T.IcosahedronGeometry(2.6, 1);
    const cloudMat = new T.MeshStandardMaterial({
      color: 0xffd9e6, emissive: 0x2a1530, roughness: 1, flatShading: true, transparent: true, opacity: 0.8
    });
    const clouds = [];
    for (let i = 0; i < 12; i++) {
      const puff = new T.Group();
      const n = 3 + (i % 3);
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(cloudGeo, cloudMat);
        m.position.set((k - n / 2) * 2.4 + Math.random(), Math.random() * 1.2, Math.random() * 1.5);
        m.scale.setScalar(0.7 + Math.random() * 0.6);
        puff.add(m);
      }
      puff.position.set((Math.random() - 0.5) * 120, 12 + Math.random() * 12, -50 - (i % 4) * 12);
      puff.scale.set(1.3, 0.6, 1);
      root.add(puff);
      clouds.push({ obj: puff, speed: 0.5 + Math.random() * 0.6 });
    }

    // 5. Bamboo framing the window edges
    const bambooGeo = new T.CylinderGeometry(0.2, 0.26, 30, 7);
    bambooGeo.translate(0, 15, 0);
    const bambooMat = new T.MeshStandardMaterial({ color: 0x2c5a26, roughness: 0.65 });
    const leafGeo = new T.ConeGeometry(0.22, 1.7, 4);
    leafGeo.rotateZ(Math.PI / 2);
    leafGeo.translate(0.9, 0, 0);
    const leafMat = new T.MeshStandardMaterial({ color: 0x3f7a2c, roughness: 0.7, flatShading: true });
    const stalks = [];
    for (let i = 0; i < 10; i++) {
      const stalk = new T.Mesh(bambooGeo, bambooMat);
      for (let l = 0; l < 3; l++) {
        const leaf = new T.Mesh(leafGeo, leafMat);
        leaf.position.y = 16 + l * 4 + (i % 3) * 1.5;
        leaf.rotation.y = l * 2.1 + i;
        leaf.rotation.z = 0.35;
        stalk.add(leaf);
      }
      stalk.castShadow = shadows;
      root.add(stalk);
      stalks.push({ mesh: stalk, phase: i * 0.8, i });
    }
    const placeBamboo = (stg) => {
      for (const s of stalks) {
        const side = s.i % 2 === 0 ? -1 : 1;
        s.mesh.position.set(side * (stg.W * 0.5 + 1.2 - (s.i % 5) * 0.9), -stg.H * 0.5 - 6, -4 - (s.i % 5) * 2.6);
      }
    };
    placeBamboo(stage);

    // 6. Littlest Tokyo
    const islandGroup = new T.Group();
    islandGroup.position.set(-1.5, -5.5, -22);
    islandGroup.rotation.set(0.08, 0.65, 0);
    root.add(islandGroup);

    let dioramaMixer = null;
    try {
      const gltf = await assets.loadGLTF('assets/models/LittlestTokyo.glb', (u, p) => onProgress?.(u, p * 0.7));
      const tokyo = gltf.scene;
      tokyo.scale.setScalar(0.026);
      tokyo.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = shadows;
          o.receiveShadow = shadows;
        }
      });
      islandGroup.add(tokyo);
      if (gltf.animations?.length) {
        dioramaMixer = new T.AnimationMixer(tokyo);
        for (const clip of gltf.animations) dioramaMixer.clipAction(clip).play();
      }
    } catch (err) {
      console.warn('LittlestTokyo failed to initialise:', err);
    }

    // 7. Robot dock on the island's edge
    const dock = new T.Group();
    dock.position.set(7.2, -3.4, -16);
    root.add(dock);

    const dockMat = new T.MeshStandardMaterial({ color: 0x262a3a, metalness: 0.6, roughness: 0.45 });
    const disc = new T.Mesh(new T.CylinderGeometry(1.7, 1.9, 0.4, 32), dockMat);
    disc.position.y = -0.2;
    disc.receiveShadow = shadows;
    const pillar = new T.Mesh(new T.CylinderGeometry(0.8, 0.25, 4.2, 16), new T.MeshStandardMaterial({ color: 0x181a24, roughness: 0.85 }));
    pillar.position.y = -2.5;
    const trim = new T.Mesh(new T.TorusGeometry(1.65, 0.045, 12, 48), new T.MeshBasicMaterial({ color: 0x00f0ff }));
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.01;
    dock.add(disc, pillar, trim);

    // 8. Robot companion
    const robot = createRobotController();
    try {
      const gltf = await assets.loadGLTF('assets/models/RobotExpressive/RobotExpressive.glb', (u, p) => onProgress?.(u, 70 + p * 0.3));
      robot.init(gltf, { envTexture, shadows });
      dock.add(robot.mesh);
    } catch (err) {
      console.warn('RobotExpressive failed to initialise:', err);
    }

    // 9. Fireflies (a few drift out in front of the glass)
    const fireflyCount = 140;
    const ffPositions = new Float32Array(fireflyCount * 3);
    const ffPhases = new Float32Array(fireflyCount);
    for (let i = 0; i < fireflyCount; i++) {
      if (i < 16) {
        ffPositions.set([(Math.random() - 0.5) * stage.safeMaxX * 1.4, (Math.random() - 0.5) * stage.safeMaxY * 1.4, 1.5 + Math.random() * 8], i * 3);
      } else {
        ffPositions.set([(Math.random() - 0.5) * 36, -4 + Math.random() * 16, -12 - Math.random() * 26], i * 3);
      }
      ffPhases[i] = Math.random() * Math.PI * 2;
    }
    const ffGeo = new T.BufferGeometry();
    ffGeo.setAttribute('position', new T.BufferAttribute(ffPositions, 3));
    ffGeo.setAttribute('phase', new T.BufferAttribute(ffPhases, 1));
    const ffMat = new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, pxPerCm: { value: stage.pxPerCm }, eyeZ: { value: 55 } },
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float time;
        uniform float pxPerCm;
        uniform float eyeZ;
        attribute float phase;
        varying float vAlpha;
        ${edgeFadeVertexGLSL}
        void main() {
          vec3 p = position;
          p.x += sin(time * 0.9 + phase) * 0.6;
          p.y += cos(time * 0.7 + phase) * 0.5;
          p.z += sin(time * 0.5 + phase * 2.0) * 0.4;
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          vec4 clip = projectionMatrix * mvPos;
          gl_Position = clip;
          gl_PointSize = 0.18 * pxPerCm * eyeZ / max(-mvPos.z, 1.0);
          float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(time * 2.3 + phase), 2.0);
          vAlpha = computeEdgeFade(clip, p.z) * pulse;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float g = pow(1.0 - d * 2.0, 1.6);
          gl_FragColor = vec4(vec3(1.0, 0.85, 0.42) * (0.6 + g), vAlpha * g);
        }
      `
    });
    const fireflies = new T.Points(ffGeo, ffMat);
    fireflies.frustumCulled = false;
    root.add(fireflies);

    // 10. A flock of birds circling the island
    const birdGeo = new T.BufferGeometry();
    birdGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([
      -0.9, 0, -0.3, 0, 0, 0.35, 0, 0, -0.15,
      0, 0, 0.35, 0.9, 0, -0.3, 0, 0, -0.15
    ]), 3));
    birdGeo.computeVertexNormals();
    const birdMat = new T.MeshBasicMaterial({ color: 0x1b1430, side: T.DoubleSide });
    const birds = [];
    for (let i = 0; i < 18; i++) {
      const bird = new T.Mesh(birdGeo, birdMat);
      bird.scale.setScalar(0.6);
      root.add(bird);
      birds.push({
        mesh: bird,
        angle: (i / 18) * Math.PI * 2 + (i % 3) * 0.12,
        radius: 19 + (i % 3) * 2.5,
        height: 7 + (i % 4) * 1.6,
        speed: 0.32 + (i % 3) * 0.04,
        flap: 8 + (i % 5)
      });
    }

    return {
      root,
      background: new T.Color(0x1a1533),
      fog: new T.Fog(0x2a1a3c, 60, 220),
      environment: envTexture,
      post: { bloomStrength: 0.32, bloomRadius: 0.4, bloomThreshold: 0.82 },

      update(dt, t, eye, stg, presence) {
        dioramaMixer?.update(dt);
        robot.update(dt, eye, presence);

        ffMat.uniforms.time.value = t;
        ffMat.uniforms.pxPerCm.value = stg.pxPerCm;
        ffMat.uniforms.eyeZ.value = Math.max(eye.z, 15);

        for (const c of clouds) {
          c.obj.position.x += dt * c.speed;
          if (c.obj.position.x > 70) c.obj.position.x = -70;
        }
        for (const s of stalks) {
          s.mesh.rotation.z = Math.sin(t * 0.9 + s.phase) * 0.025;
          s.mesh.rotation.x = Math.cos(t * 0.7 + s.phase) * 0.015;
        }
        for (const b of birds) {
          b.angle += dt * b.speed;
          b.mesh.position.set(Math.cos(b.angle) * b.radius - 1.5, b.height + Math.sin(t * 1.4 + b.angle * 3) * 0.8, -22 + Math.sin(b.angle) * b.radius);
          b.mesh.rotation.y = -b.angle;
          b.mesh.rotation.z = Math.sin(t * b.flap + b.angle) * 0.45;
        }
      },

      onResize(stg) {
        placeBamboo(stg);
      },

      dispose() {
        robot.dispose();
        dioramaMixer?.stopAllAction();
        disposables.forEach((d) => d.dispose());
        disposeObject(root);
      }
    };
  }
};

/**
 * RobotExpressive behaviour: gaze tracking on the head bone, plus a small
 * state machine driven by what the viewer does.
 */
function createRobotController() {
  const tmp = {
    headPos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    rootQ: new THREE.Quaternion(),
    rootQInv: new THREE.Quaternion(),
    offset: new THREE.Quaternion(),
    headWorldQ: new THREE.Quaternion(),
    parentQ: new THREE.Quaternion(),
    euler: new THREE.Euler(0, 0, 0, 'YXZ'),
    eye: new THREE.Vector3()
  };

  const st = {
    mesh: null,
    mixer: null,
    head: null,
    animatedHeadQ: new THREE.Quaternion(),
    actions: {},
    current: null,
    baseYaw: -0.3,
    bodyYaw: 0,
    headYaw: 0,
    headPitch: 0,
    morphs: {},
    surprise: 0,
    absentFor: 0,
    stillFor: 0,
    jumpCooldown: 0,
    lastEye: new THREE.Vector3(0, 0, 60),
    sitting: false,
    wasTracked: false
  };

  function play(name, { fade = 0.3, once = false } = {}) {
    const next = st.actions[name];
    if (!next || next === st.current) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    if (st.current) next.crossFadeFrom(st.current, fade, true);
    next.play();
    st.current = next;
  }

  /** Quick gesture that returns to idle by itself. */
  function emote(name) {
    if (st.sitting) return;
    play(name, { fade: 0.2, once: true });
  }

  return {
    get mesh() { return st.mesh; },

    init(gltf, { envTexture, shadows }) {
      const mesh = gltf.scene;
      st.mesh = mesh;

      // A fresh clone has stale world matrices and bone matrices, and a skinned
      // mesh's bounds depend on both, so bring them up to date before measuring.
      mesh.updateMatrixWorld(true);
      mesh.traverse((o) => o.isSkinnedMesh && o.skeleton.update());
      const box = new THREE.Box3().setFromObject(mesh);
      mesh.scale.setScalar(5.2 / Math.max(box.max.y - box.min.y, 1e-3));
      mesh.rotation.y = st.baseYaw;

      mesh.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = shadows;
          o.frustumCulled = false;
          const mats = [].concat(o.material);
          for (const m of mats) {
            if (m.name === 'Main') {
              m.color.setHex(0xf2f4f8);
              m.metalness = 0.15;
              m.roughness = 0.3;
              m.envMap = envTexture;
              m.envMapIntensity = 0.6;
            } else if (m.name === 'Black') {
              m.color.setHex(0x0a1418);
              m.emissive?.setHex(0x00e0ff);
              m.emissiveIntensity = 0.9;
            }
          }
        }
        if (o.isBone && o.name === 'Head') st.head = o;
        if (o.morphTargetDictionary) {
          for (const [k, i] of Object.entries(o.morphTargetDictionary)) {
            st.morphs[k.toLowerCase()] = { mesh: o, index: i };
          }
        }
      });
      if (st.head) st.animatedHeadQ.copy(st.head.quaternion);

      st.mixer = new THREE.AnimationMixer(mesh);
      for (const clip of gltf.animations || []) {
        st.actions[clip.name.toLowerCase()] = st.mixer.clipAction(clip);
      }
      st.mixer.addEventListener('finished', (e) => {
        if (e.action === st.actions.sitting) return; // stay seated
        if (e.action === st.actions.standing) {
          play('idle', { fade: 0.4 });
          emote('wave');
          return;
        }
        play('idle', { fade: 0.4 });
      });

      play('idle', { fade: 0 });
      emote('wave');
    },

    update(dt, eye, presence = {}) {
      if (!st.mesh || !st.mixer) return;
      const tracked = presence.mode === 'none' ? true : !!presence.tracked;

      // --- behaviour --------------------------------------------------------
      st.jumpCooldown = Math.max(0, st.jumpCooldown - dt);
      st.absentFor = tracked ? 0 : st.absentFor + dt;

      if (!tracked && st.absentFor > ABSENT_BEFORE_SIT_S && !st.sitting) {
        st.sitting = true;
        play('sitting', { fade: 0.5, once: true });
      }
      if (tracked && !st.wasTracked && st.sitting) {
        st.sitting = false;
        play('standing', { fade: 0.3, once: true });
      } else if (tracked && !st.wasTracked && presence.since && !st.sitting) {
        emote('wave');
      }
      st.wasTracked = tracked;

      if (tracked && !st.sitting) {
        if (eye.z < 34 && st.lastEye.z >= 34 && st.jumpCooldown === 0) {
          emote('jump');
          st.surprise = 1;
          st.jumpCooldown = 3;
        }
        const speed = tmp.eye.set(eye.x, eye.y, eye.z).distanceTo(st.lastEye) / Math.max(dt, 1e-3); // cm/s
        st.stillFor = speed < 2.5 ? st.stillFor + dt : 0;
        if (st.stillFor > STILL_BEFORE_DANCE_S && st.current === st.actions.idle) {
          play('dance', { fade: 0.4 });
          st.stillFor = 0;
        } else if (st.current === st.actions.dance && speed > 8) {
          play('idle', { fade: 0.5 });
          emote('yes');
        }
      }
      st.lastEye.set(eye.x, eye.y, eye.z);

      st.surprise = Math.max(0, st.surprise - dt * 0.8);
      const surprised = st.morphs.surprised;
      if (surprised) surprised.mesh.morphTargetInfluences[surprised.index] = st.surprise;

      // --- animation, then gaze on top -------------------------------------
      // Restore the head to its animated pose before the mixer runs, so the
      // gaze offset never accumulates frame over frame (clips that don't key
      // the head would otherwise spin it).
      if (st.head) st.head.quaternion.copy(st.animatedHeadQ);
      st.mixer.update(dt);
      if (!st.head) return;
      st.animatedHeadQ.copy(st.head.quaternion);

      const lookAtViewer = !st.sitting || st.current !== st.actions.sitting;
      st.mesh.updateWorldMatrix(true, true);
      st.head.getWorldPosition(tmp.headPos);
      st.mesh.parent.getWorldQuaternion(tmp.rootQ);
      tmp.rootQInv.copy(tmp.rootQ).invert();
      // Direction to the viewer in the dock's frame, so yaw/pitch are relative to "forward".
      tmp.dir.set(eye.x, eye.y, eye.z).sub(tmp.headPos).applyQuaternion(tmp.rootQInv);

      let yaw = Math.atan2(tmp.dir.x, tmp.dir.z) - st.baseYaw;
      let pitch = Math.atan2(tmp.dir.y, Math.hypot(tmp.dir.x, tmp.dir.z));
      if (!tracked || !lookAtViewer) {
        yaw = 0;
        pitch = -0.15;
      }
      yaw = THREE.MathUtils.clamp(yaw, -GAZE_YAW_LIMIT, GAZE_YAW_LIMIT);
      pitch = THREE.MathUtils.clamp(pitch, -GAZE_PITCH_LIMIT, GAZE_PITCH_LIMIT);

      // The body follows lazily, the head quickly: reads as attention, not a turret.
      const kBody = 1 - Math.exp(-dt / 0.9);
      const kHead = 1 - Math.exp(-dt / 0.12);
      st.bodyYaw += (yaw * BODY_SHARE - st.bodyYaw) * kBody;
      st.headYaw += (yaw - st.bodyYaw - st.headYaw) * kHead;
      st.headPitch += (pitch - st.headPitch) * kHead;
      st.mesh.rotation.y = st.baseYaw + st.bodyYaw;

      // Apply the head offset in the robot's body frame, on top of the animation.
      st.mesh.updateWorldMatrix(false, false);
      st.mesh.getWorldQuaternion(tmp.rootQ);
      tmp.rootQInv.copy(tmp.rootQ).invert();
      tmp.euler.set(-st.headPitch, st.headYaw, 0, 'YXZ');
      tmp.offset.setFromEuler(tmp.euler).premultiply(tmp.rootQ).multiply(tmp.rootQInv); // R * O * R^-1
      st.head.updateWorldMatrix(true, false);
      st.head.getWorldQuaternion(tmp.headWorldQ);
      tmp.headWorldQ.premultiply(tmp.offset);
      st.head.parent.getWorldQuaternion(tmp.parentQ);
      st.head.quaternion.copy(tmp.parentQ.invert().multiply(tmp.headWorldQ));
    },

    dispose() {
      st.mixer?.stopAllAction();
      st.mixer?.uncacheRoot(st.mesh);
    }
  };
}
