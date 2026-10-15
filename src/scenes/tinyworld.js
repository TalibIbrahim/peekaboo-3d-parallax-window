import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { edgeFadeVertexGLSL } from '../shaders/edgeFade.js';

export default {
  id: 'tinyworld',
  name: 'Tiny World',
  tagline: 'Floating diorama at dusk with an observant robot companion',
  quality: { minTier: 'Low' },

  async create(ctx) {
    const { THREE: T, renderer, stage, assets, quality } = ctx;
    const root = new T.Group();
    root.name = 'TinyWorldRoot';

    const tier = quality || 'Medium';

    // 1. Balanced IBL with PMREM RoomEnvironment
    const pmremGenerator = new T.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTexture = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    pmremGenerator.dispose();

    // 2. Sunset Lighting: Rich twilight sun + soft violet fill (calibrated, non-blinding)
    const hemiLight = new T.HemisphereLight(0xffeedd, 0x16122c, 0.45);
    root.add(hemiLight);

    const dirLight = new T.DirectionalLight(0xffb27a, 0.75);
    dirLight.position.set(20, 28, 16);
    if (tier === 'High') {
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.camera.near = 1.0;
      dirLight.shadow.camera.far = 120.0;
      dirLight.shadow.camera.left = -22;
      dirLight.shadow.camera.right = 22;
      dirLight.shadow.camera.top = 22;
      dirLight.shadow.camera.bottom = -22;
      dirLight.shadow.bias = -0.0004;
    }
    root.add(dirLight);

    // 3. Twilight Sky Dome & Sun Disc
    const skyGeo = new T.SphereGeometry(1200, 32, 16);
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec3 dir = normalize(vWorldPosition);
          float y = dir.y;
          vec3 zenith = vec3(0.04, 0.03, 0.12);
          vec3 horizon = vec3(0.65, 0.32, 0.22);
          vec3 nadir = vec3(0.02, 0.015, 0.06);
          vec3 col = (y > 0.0) ? mix(horizon, zenith, pow(y, 0.65)) : mix(horizon, nadir, -y);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    const skyMesh = new T.Mesh(skyGeo, skyMat);
    root.add(skyMesh);

    // Sun Disc in Sky
    const sunGeo = new T.CircleGeometry(42, 32);
    const sunMat = new T.MeshBasicMaterial({ color: 0xffd899, side: T.DoubleSide });
    const sunMesh = new T.Mesh(sunGeo, sunMat);
    sunMesh.position.set(180, 45, -1100);
    root.add(sunMesh);

    // 4. Three Mountain Ridgelines at z = -70, -60, -50
    const mountainGroup = new T.Group();
    const mountainDepths = [-70, -60, -50];
    const mountainColors = [0x110e24, 0x1c1738, 0x2a1f44];

    mountainDepths.forEach((z, idx) => {
      const shape = new T.Shape();
      const w = 180;
      shape.moveTo(-w, -40);
      for (let x = -w; x <= w; x += 15) {
        const h = Math.sin(x * 0.04 + idx * 2.3) * 11 + Math.cos(x * 0.08) * 7 + (idx * 5) - 6;
        shape.lineTo(x, h);
      }
      shape.lineTo(w, -40);
      shape.closePath();

      const mGeo = new T.ShapeGeometry(shape);
      const mMat = new T.MeshBasicMaterial({ color: mountainColors[idx] });
      const mMesh = new T.Mesh(mGeo, mMat);
      mMesh.position.set(0, -6, z);
      mountainGroup.add(mMesh);
    });
    root.add(mountainGroup);

    // 5. Instanced Drifting Fluffy White Clouds (Placed high in background)
    const cloudGroup = new T.Group();
    const cloudGeo = new T.DodecahedronGeometry(2.8, 1);
    const cloudMat = new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.55
    });
    const clouds = [];

    for (let i = 0; i < 10; i++) {
      const cMesh = new T.Mesh(cloudGeo, cloudMat);
      const z = -45 - (i % 3) * 8.0;
      const x = (Math.random() - 0.5) * (stage.W * 1.6);
      const y = 9.0 + Math.random() * 8.0; // High up in the sky
      cMesh.position.set(x, y, z);
      const s = 1.0 + Math.random() * 1.2;
      cMesh.scale.set(s * 1.6, s * 0.6, s);
      cloudGroup.add(cMesh);
      clouds.push({ mesh: cMesh, speed: 0.4 + Math.random() * 0.5 });
    }
    root.add(cloudGroup);

    // 6. Swaying Bamboo Stalks on Edges at z = -5 to -12
    const bambooGroup = new T.Group();
    const bambooGeo = new T.CylinderGeometry(0.2, 0.25, 26, 6);
    bambooGeo.translate(0, 13, 0);
    const bambooMat = new T.MeshStandardMaterial({ color: 0x2e5c26, roughness: 0.7 });

    const stalks = [];
    for (let i = 0; i < 20; i++) {
      const bMesh = new T.Mesh(bambooGeo, bambooMat);
      const side = (i % 2 === 0) ? -1 : 1;
      const x = side * (stage.W * 0.5 - 1.2 - (i % 3) * 1.1);
      const z = -6.0 - (i % 5) * 1.2;
      bMesh.position.set(x, -stage.H * 0.5, z);
      bambooGroup.add(bMesh);
      stalks.push({ mesh: bMesh, phase: i * 0.8 });
    }
    root.add(bambooGroup);

    // 7. Load Littlest Tokyo Diorama (Authentic Model with Built-in Stone Island Base)
    // Brought forward to Z = -18 cm so every street, lantern, and ramen counter is crisp and close
    const islandGroup = new T.Group();
    islandGroup.position.set(-1.0, -5.5, -18.0);

    let dioramaMixer = null;

    try {
      const gltf = await assets.loadGLTF('assets/models/LittlestTokyo.glb');
      const tokyoScene = gltf.scene;

      // Scale model to proportional centerpiece size (~33 cm wide)
      const scale = 0.026;
      tokyoScene.scale.set(scale, scale, scale);

      // Centered at islandGroup origin
      tokyoScene.position.set(0, 0, 0);

      // Purge all inverted-hull outlines, deformed creature/blimp skinned meshes, and broken canopy nodes
      const purgeList = [];
      tokyoScene.traverse(child => {
        const name = (child.name || '').toLowerCase();
        const matName = (child.material?.name || (Array.isArray(child.material) ? child.material.map(m=>m.name).join(' ') : '')).toLowerCase();
        const isDeformedCreature = child.isSkinnedMesh ||
          name.includes('224') ||
          name.includes('688') ||
          name.includes('687') ||
          name.includes('697') ||
          name.includes('698') ||
          name.includes('699') ||
          name.includes('700') ||
          name.includes('_rootjoint') ||
          name.includes('rootjoint') ||
          name.includes('btail') ||
          name.includes('bbody') ||
          name.includes('bhead');
        const isOutline = name.includes('outline') || name.includes('674') || matName.includes('outline');

        if (isDeformedCreature || isOutline) {
          purgeList.push(child);
        }
      });

      purgeList.forEach(node => {
        node.visible = false;
        if (node.geometry) {
          node.geometry.dispose();
          node.geometry = new T.BufferGeometry();
        }
        if (node.parent) {
          node.parent.remove(node);
        }
      });

      // Orient diorama to reveal the iconic storefront street, train tracks, and ramen counter
      islandGroup.rotation.y = 0.65;
      islandGroup.rotation.x = 0.08;

      islandGroup.add(tokyoScene);

      if (gltf.animations && gltf.animations.length > 0) {
        dioramaMixer = new T.AnimationMixer(tokyoScene);
        gltf.animations.forEach(clip => {
          const validTracks = clip.tracks.filter(track => {
            const tName = track.name.toLowerCase();
            return !tName.includes('tail') &&
                   !tName.includes('head') &&
                   !tName.includes('body') &&
                   !tName.includes('ear') &&
                   !tName.includes('fake') &&
                   !tName.includes('224') &&
                   !tName.includes('688') &&
                   !tName.includes('687') &&
                   !tName.includes('697') &&
                   !tName.includes('698') &&
                   !tName.includes('699') &&
                   !tName.includes('700');
          });
          if (validTracks.length > 0) {
            const cleanClip = new T.AnimationClip(clip.name, clip.duration, validTracks);
            dioramaMixer.clipAction(cleanClip).play();
          }
        });
      }
    } catch (err) {
      console.warn('LittlestTokyo failed to initialize:', err);
    }
    root.add(islandGroup);

    // 8. Hero Robot Companion Anchored on Island Dock Courtyard (Z = -15.5 cm)
    // Directly integrated with the city so they share natural, unified parallax
    const robotPlatformGroup = new T.Group();
    robotPlatformGroup.position.set(6.8, -3.2, -15.5);

    // Stone Dock Disc
    const discGeo = new T.CylinderGeometry(1.6, 1.8, 0.4, 24);
    const discMat = new T.MeshStandardMaterial({
      color: 0x242838,
      metalness: 0.6,
      roughness: 0.45
    });
    const discMesh = new T.Mesh(discGeo, discMat);
    discMesh.position.y = -0.2;
    robotPlatformGroup.add(discMesh);

    // Stone Pillar connecting pad into the island rock
    const pillarGeo = new T.CylinderGeometry(0.8, 1.2, 3.5, 16);
    const pillarMat = new T.MeshStandardMaterial({
      color: 0x181a24,
      metalness: 0.3,
      roughness: 0.8
    });
    const pillarMesh = new T.Mesh(pillarGeo, pillarMat);
    pillarMesh.position.y = -2.1;
    robotPlatformGroup.add(pillarMesh);

    // Glowing Cyan Trim Ring
    const edgeRingGeo = new T.TorusGeometry(1.55, 0.04, 12, 32);
    edgeRingGeo.rotateX(Math.PI * 0.5);
    const edgeRingMat = new T.MeshBasicMaterial({ color: 0x00f0ff });
    const edgeRing = new T.Mesh(edgeRingGeo, edgeRingMat);
    edgeRing.position.y = 0.01;
    robotPlatformGroup.add(edgeRing);

    root.add(robotPlatformGroup);

    // 9. Load and Rig Hero Robot (RobotExpressive.glb)
    let robotMixer = null;
    let robotHeadBone = null;
    let robotMesh = null;
    const actions = {};
    const morphTargets = {};
    let activeAction = null;

    let stillHeadTimer = 0;
    let lastHeadPos = { x: 0, y: 0, z: 55 };
    let jumpCooldown = 0;
    let smoothYaw = 0;
    let smoothPitch = 0;

    function playAction(name, duration = 0.35, loopOnce = false) {
      const act = actions[name.toLowerCase()];
      if (!act) return;
      if (activeAction === act) return;

      act.reset();
      if (loopOnce) {
        act.setLoop(T.LoopOnce, 1);
        act.clampWhenFinished = false;
      } else {
        act.setLoop(T.LoopRepeat);
      }

      if (activeAction) {
        act.crossFadeFrom(activeAction, duration, true);
      }
      act.play();
      activeAction = act;
    }

    try {
      const gltf = await assets.loadGLTF('assets/models/RobotExpressive/RobotExpressive.glb');
      robotMesh = gltf.scene;

      // Scale robot to ~5.2 cm tall for companion proportions with the diorama
      const rBox = new T.Box3().setFromObject(robotMesh);
      const rHeight = rBox.max.y - rBox.min.y;
      const rScale = 5.2 / Math.max(rHeight, 0.001);
      robotMesh.scale.set(rScale, rScale, rScale);
      robotMesh.position.set(0, 0, 0);
      robotMesh.rotation.y = -0.35;

      robotMesh.traverse(child => {
        if (child.isSkinnedMesh) {
          child.frustumCulled = false;
          child.castShadow = (tier === 'High');

          if (child.material) {
            if (child.material.name === 'Main') {
              child.material.color.setHex(0xf4f6fa); // Crisp ceramic white
              child.material.metalness = 0.15;
              child.material.roughness = 0.2;
              child.material.envMap = envTexture;
              child.material.envMapIntensity = 0.5;
            } else if (child.material.name === 'Black') {
              // Glowing cyan visor eyes
              child.material.color.setHex(0x00f0ff);
              child.material.emissive.setHex(0x00f0ff);
              child.material.emissiveIntensity = 1.0;
            }
          }
        }

        if (child.isBone && child.name === 'Head') {
          robotHeadBone = child;
        }

        if (child.morphTargetDictionary) {
          Object.keys(child.morphTargetDictionary).forEach(k => {
            morphTargets[k.toLowerCase()] = {
              mesh: child,
              index: child.morphTargetDictionary[k]
            };
          });
        }
      });

      robotPlatformGroup.add(robotMesh);

      if (gltf.animations && gltf.animations.length > 0) {
        robotMixer = new T.AnimationMixer(robotMesh);
        gltf.animations.forEach(clip => {
          actions[clip.name.toLowerCase()] = robotMixer.clipAction(clip);
        });

        robotMixer.addEventListener('finished', (e) => {
          playAction('idle', 0.4);
        });

        playAction('wave', 0.1, true);
      }
    } catch (err) {
      console.warn('RobotExpressive failed to initialize:', err);
    }

    // 10. Delicate Fireflies (~120)
    const fireflyCount = 120;
    const ffGeo = new T.BufferGeometry();
    const ffPositions = new Float32Array(fireflyCount * 3);
    const ffPhases = new Float32Array(fireflyCount);

    for (let i = 0; i < fireflyCount; i++) {
      if (i < 15) {
        ffPositions[i * 3 + 0] = (Math.random() - 0.5) * stage.safeMaxX * 1.4;
        ffPositions[i * 3 + 1] = (Math.random() - 0.5) * stage.safeMaxY * 1.4;
        ffPositions[i * 3 + 2] = 2.0 + Math.random() * 8.0;
      } else {
        ffPositions[i * 3 + 0] = (Math.random() - 0.5) * 32.0;
        ffPositions[i * 3 + 1] = -2.0 + Math.random() * 16.0;
        ffPositions[i * 3 + 2] = -14.0 - Math.random() * 26.0;
      }
      ffPhases[i] = Math.random() * Math.PI * 2;
    }

    ffGeo.setAttribute('position', new T.BufferAttribute(ffPositions, 3));
    ffGeo.setAttribute('phase', new T.BufferAttribute(ffPhases, 1));

    const ffMat = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        pxPerCm: { value: stage.pxPerCm },
        eyeZ: { value: 55.0 }
      },
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

          float dist = max(-mvPos.z, 1.0);
          gl_PointSize = 0.16 * pxPerCm * eyeZ / dist;

          float pulse = 0.4 + 0.6 * sin(time * 2.5 + phase);
          float fade = computeEdgeFade(clip, p.z);
          vAlpha = fade * pulse * 0.75;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(1.0, 0.88, 0.45, vAlpha * (1.0 - d * 2.0));
        }
      `
    });

    const fireflyPoints = new T.Points(ffGeo, ffMat);
    fireflyPoints.frustumCulled = false;
    root.add(fireflyPoints);

    // 11. Orbiting Procedural Birds (V-formation)
    const birdCount = 20;
    const birdGeo = new T.BufferGeometry();
    const birdVertices = new Float32Array([
      -0.85, 0.0, -0.35,
       0.0,  0.0,  0.35,
       0.85, 0.0, -0.35
    ]);
    birdGeo.setAttribute('position', new T.BufferAttribute(birdVertices, 3));
    const birdMat = new T.MeshBasicMaterial({ color: 0x1b1430, side: T.DoubleSide });

    const birds = [];
    const birdGroup = new T.Group();
    for (let i = 0; i < birdCount; i++) {
      const bMesh = new T.Mesh(birdGeo, birdMat);
      bMesh.scale.set(0.7, 0.7, 0.7);
      birdGroup.add(bMesh);
      birds.push({
        mesh: bMesh,
        angle: (i / birdCount) * Math.PI * 2,
        radius: 17.0 + (i % 3) * 2.5,
        height: 5.5 + (i % 3) * 3.0,
        speed: 0.5 + (i % 3) * 0.08,
        flapSpeed: 9.0 + i
      });
    }
    root.add(birdGroup);

    return {
      root,
      background: new T.Color(0x1a1533),
      fog: new T.Fog(0x1a1533, 40, 180),
      post: {
        bloomStrength: 0.30,
        bloomRadius: 0.4,
        bloomThreshold: 0.85
      },

      update(dt, t, eye, stg) {
        if (dioramaMixer) dioramaMixer.update(dt);

        if (robotMixer) {
          robotMixer.update(dt);

          if (jumpCooldown > 0) {
            jumpCooldown -= dt;
          }

          // 1. Surprise jump reaction when user leans in close (eye.z < 34 cm)
          if (eye.z < 34.0 && jumpCooldown <= 0 && (!activeAction || activeAction !== actions['jump'])) {
            playAction('jump', 0.25, true);
            jumpCooldown = 4.5;
          }

          // 2. Playful dance if the user remains still for > 12 seconds
          const headMovement = Math.hypot(eye.x - lastHeadPos.x, eye.y - lastHeadPos.y, eye.z - lastHeadPos.z);
          lastHeadPos = { x: eye.x, y: eye.y, z: eye.z };

          if (headMovement < 0.25) {
            stillHeadTimer += dt;
            if (stillHeadTimer > 12.0 && (!activeAction || activeAction === actions['idle'])) {
              playAction('dance', 0.35, true);
              stillHeadTimer = 0;
            }
          } else {
            stillHeadTimer = 0;
          }
        }

        // Smooth, lifelike gaze tracking - pure, rock-solid mesh orientation
        // Never modifies bone quaternions directly, preventing compounding and 360-degree spins
        if (robotMesh) {
          const robotWorldPos = new T.Vector3();
          robotPlatformGroup.getWorldPosition(robotWorldPos);

          const dx = eye.x - robotWorldPos.x;
          const dy = eye.y - robotWorldPos.y;
          const dz = eye.z - robotWorldPos.z;

          // Clamped target yaw and pitch (strictly limits gaze range to natural viewing angles)
          const targetYaw = Math.max(-0.55, Math.min(0.55, Math.atan2(dx, dz)));
          const targetPitch = Math.max(-0.15, Math.min(0.12, -Math.atan2(dy, Math.hypot(dx, dz))));

          smoothYaw += (targetYaw - smoothYaw) * Math.min(1.0, dt * 6.0);
          smoothPitch += (targetPitch - smoothPitch) * Math.min(1.0, dt * 6.0);

          // Absolute assignment on container mesh - 100% stable, zero 360 spinning, zero gimbal flips
          robotMesh.rotation.y = -0.35 + smoothYaw;
          robotMesh.rotation.x = smoothPitch;
        }

        ffMat.uniforms.time.value = t;
        ffMat.uniforms.pxPerCm.value = stg.pxPerCm;
        ffMat.uniforms.eyeZ.value = Math.max(eye.z, 15.0);

        for (const c of clouds) {
          c.mesh.position.x += dt * c.speed;
          if (c.mesh.position.x > stg.W * 0.85) {
            c.mesh.position.x = -stg.W * 0.85;
          }
        }

        for (const b of stalks) {
          b.mesh.rotation.z = Math.sin(t * 1.8 + b.phase) * 0.05;
        }

        for (const bird of birds) {
          bird.angle += dt * bird.speed;
          const bx = Math.cos(bird.angle) * bird.radius;
          const bz = -18.0 + Math.sin(bird.angle) * bird.radius;
          const by = bird.height + Math.sin(t * 2.0 + bird.angle) * 1.2;

          bird.mesh.position.set(bx, by, bz);
          bird.mesh.rotation.y = -bird.angle + Math.PI * 0.5;
          bird.mesh.rotation.z = Math.sin(t * bird.flapSpeed) * 0.3;
        }
      },

      onResize(stg) {
        stalks.forEach((b, i) => {
          const side = (i % 2 === 0) ? -1 : 1;
          b.mesh.position.x = side * (stg.W * 0.5 - 1.2 - (i % 3) * 1.1);
          b.mesh.position.y = -stg.H * 0.5;
        });

        // Robot dock remains anchored to island dock courtyard
        robotPlatformGroup.position.set(6.8, -3.2, -15.5);
      },

      dispose() {
        envTexture.dispose();
        skyGeo.dispose();
        skyMat.dispose();
        sunGeo.dispose();
        sunMat.dispose();
        discGeo.dispose();
        discMat.dispose();
        pillarGeo.dispose();
        pillarMat.dispose();
        edgeRingGeo.dispose();
        edgeRingMat.dispose();
        cloudGeo.dispose();
        cloudMat.dispose();
        bambooGeo.dispose();
        bambooMat.dispose();
        birdGeo.dispose();
        birdMat.dispose();
        ffGeo.dispose();
        ffMat.dispose();

        root.traverse((obj) => {
          if (obj.isMesh || obj.isSkinnedMesh) {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
              else obj.material.dispose();
            }
          }
        });
        root.clear();
      }
    };
  }
};
