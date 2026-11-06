import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * World-space grid: a line every 5 cm and a bright one every 25 cm, on every
 * wall, regardless of how big the room (= your screen) is. Anti-aliased with
 * screen-space derivatives so it stays crisp at grazing angles.
 */
function createGridMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0x060a1d) },
      minorColor: { value: new THREE.Color(0x0a5f78) },
      majorColor: { value: new THREE.Color(0x00f0ff) }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 baseColor;
      uniform vec3 minorColor;
      uniform vec3 majorColor;
      varying vec3 vWorld;
      varying vec3 vNormal;

      float grid(vec2 p, float spacing, float widthPx) {
        vec2 d = abs(p - spacing * floor(p / spacing + 0.5));
        vec2 fw = max(fwidth(p), vec2(1e-4));
        vec2 line = 1.0 - smoothstep(vec2(0.0), fw * widthPx, d);
        return max(line.x, line.y);
      }

      void main() {
        vec3 n = abs(vNormal);
        vec2 p = n.y > 0.5 ? vWorld.xz : (n.x > 0.5 ? vWorld.zy : vWorld.xy);
        float minor = grid(p, 5.0, 1.2);
        float major = grid(p, 25.0, 2.0);
        // Depth cue: walls darken with distance into the room.
        float depth = clamp(-vWorld.z / 70.0, 0.0, 1.0);
        vec3 col = baseColor * (1.0 - depth * 0.5);
        col = mix(col, minorColor * (1.0 - depth * 0.6), minor * 0.8);
        col = mix(col, majorColor * (1.2 - depth * 0.7), major);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.font = '600 56px ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#7df9ff';
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 1.8),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
  );
  return mesh;
}

export default {
  id: 'calibration',
  name: 'Calibration',
  tagline: 'A box exactly the size of your screen, ruled every 5 cm',
  hint: 'Grid squares should look square from wherever you sit. If not, check screen size in Settings.',
  quality: { minTier: 'Low' },

  async create(ctx) {
    const { stage } = ctx;
    const root = new THREE.Group();
    root.name = 'CalibrationSceneRoot';

    const roomDepth = 70.0;
    const wallMaterial = createGridMaterial();

    // Metals need something to reflect.
    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(ctx.renderer), 0.04).texture;
    pmrem.dispose();

    // Depth markers on the floor, every 10 cm into the room.
    const labels = [];
    for (let d = 10; d <= 60; d += 10) {
      const label = makeLabel(`${d} cm`);
      label.rotation.x = -Math.PI / 2;
      root.add(label);
      labels.push({ mesh: label, d });
    }

    // 5 walls
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
    ceiling.rotation.x = Math.PI / 2;
    root.add(ceiling);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
    leftWall.rotation.y = Math.PI / 2;
    root.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
    rightWall.rotation.y = -Math.PI / 2;
    root.add(rightWall);

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
    root.add(backWall);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x202b48, 1.2);
    root.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(25, 40, 30);
    root.add(dirLight);

    const cyanPointLight = new THREE.PointLight(0x00f0ff, 2.5, 120);
    cyanPointLight.position.set(0, 8, -35);
    root.add(cyanPointLight);

    const pinkPointLight = new THREE.PointLight(0xff007f, 1.8, 90);
    pinkPointLight.position.set(-15, -12, -45);
    root.add(pinkPointLight);

    // Center hero Torus Knot
    const heroGeo = new THREE.TorusKnotGeometry(4.8, 1.35, 120, 24);
    const heroMat = new THREE.MeshStandardMaterial({
      color: 0x9933ff,
      roughness: 0.2,
      metalness: 0.85,
      emissive: 0x220044
    });
    const heroMesh = new THREE.Mesh(heroGeo, heroMat);
    heroMesh.position.set(0, 0, -35);
    root.add(heroMesh);

    // Rings tunnel
    const ringGroup = new THREE.Group();
    const ringGeo = new THREE.TorusGeometry(5.2, 0.25, 16, 48);
    for (let z = -8; z >= -64; z -= 8) {
      const isMajor = (z === -24 || z === -48);
      const ringMat = new THREE.MeshStandardMaterial({
        color: isMajor ? 0x00ffff : 0xff0088,
        emissive: isMajor ? 0x006677 : 0x550033,
        roughness: 0.3,
        metalness: 0.6
      });
      const rMesh = new THREE.Mesh(ringGeo, ringMat);
      rMesh.position.set(0, 0, z);
      ringGroup.add(rMesh);
    }
    root.add(ringGroup);

    // Floating objects behind screen
    const floatingObjects = [];
    const shadows = [];
    const shadowGeo = new THREE.CircleGeometry(2.5, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });

    function addFloating(mesh, rad = 2.5) {
      root.add(mesh);
      floatingObjects.push(mesh);
      const s = new THREE.Mesh(rad === 2.5 ? shadowGeo : new THREE.CircleGeometry(rad, 32), shadowMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(mesh.position.x, -stage.H * 0.5 + 0.1, mesh.position.z);
      root.add(s);
      shadows.push({ shadow: s, target: mesh });
    }

    const cube1 = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 4.2, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x00ff88, roughness: 0.25, metalness: 0.7 })
    );
    cube1.position.set(-11, -3, -10);
    addFloating(cube1, 2.6);

    const sphere1 = new THREE.Mesh(
      new THREE.SphereGeometry(3.0, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x8a2be2, roughness: 0.2, metalness: 0.8 })
    );
    sphere1.position.set(12, 6, -25);
    addFloating(sphere1, 2.4);

    const prism1 = new THREE.Mesh(
      new THREE.OctahedronGeometry(3.5),
      new THREE.MeshStandardMaterial({ color: 0xff1744, roughness: 0.3, metalness: 0.75 })
    );
    prism1.position.set(-12, 5, -40);
    addFloating(prism1, 2.8);

    const sphere2 = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.2, metalness: 0.9 })
    );
    sphere2.position.set(9, -5, -55);
    addFloating(sphere2, 2.5);

    // Pop-out objects in front of the screen inside safe rect
    const popOuts = [];
    const p1 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.2),
      new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.15, metalness: 0.95, emissive: 0x332200 })
    );
    p1.position.set(-stage.safeMaxX * 0.6, 3.5, 8.0);
    root.add(p1);
    popOuts.push(p1);
    stage.registerPopOut(p1);

    const p2 = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.9),
      new THREE.MeshStandardMaterial({ color: 0x00f5ff, roughness: 0.2, metalness: 0.9, emissive: 0x003344 })
    );
    p2.position.set(stage.safeMaxX * 0.6, -2.5, 11.0);
    root.add(p2);
    popOuts.push(p2);
    stage.registerPopOut(p2);

    const p3 = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.6),
      new THREE.MeshStandardMaterial({ color: 0xff007f, roughness: 0.25, metalness: 0.85, emissive: 0x440022 })
    );
    p3.position.set(0.0, stage.safeMaxY * 0.65, 6.0);
    root.add(p3);
    popOuts.push(p3);
    stage.registerPopOut(p3);

    function updateWalls(stg) {
      const W = stg.W;
      const H = stg.H;
      const D = roomDepth;

      floor.scale.set(W, D, 1);
      floor.position.set(0, -H * 0.5, -D * 0.5);

      ceiling.scale.set(W, D, 1);
      ceiling.position.set(0, H * 0.5, -D * 0.5);

      leftWall.scale.set(D, H, 1);
      leftWall.position.set(-W * 0.5, 0, -D * 0.5);

      rightWall.scale.set(D, H, 1);
      rightWall.position.set(W * 0.5, 0, -D * 0.5);

      backWall.scale.set(W, H, 1);
      backWall.position.set(0, 0, -D);

      shadows.forEach(s => {
        s.shadow.position.y = -H * 0.5 + 0.08;
      });
      for (const l of labels) l.mesh.position.set(-W * 0.5 + 3.2, -H * 0.5 + 0.05, -l.d);

      // Keep pop-outs inside safe rect
      p1.position.x = -stg.safeMaxX * 0.6;
      p2.position.x = stg.safeMaxX * 0.6;
      p3.position.y = stg.safeMaxY * 0.65;
    }

    updateWalls(stage);

    // Reflections for the metals, kept subtle so the neon still reads.
    root.traverse((o) => {
      if (o.material?.isMeshStandardMaterial) o.material.envMapIntensity = 0.3;
    });

    return {
      root,
      background: new THREE.Color(0x050716),
      fog: new THREE.Fog(0x050716, 50, 160),
      environment: envTexture,
      post: {
        bloomStrength: 0.65,
        bloomRadius: 0.5,
        bloomThreshold: 0.2
      },

      update(dt, t, eye, stg) {
        heroMesh.rotation.x = t * 0.45;
        heroMesh.rotation.y = t * 0.65;

        floatingObjects.forEach((obj, idx) => {
          obj.rotation.x = t * (0.3 + idx * 0.1);
          obj.rotation.y = t * (0.4 + idx * 0.08);
          const baseY = (idx === 0) ? -3 : (idx === 1) ? 6 : (idx === 2) ? 5 : -5;
          obj.position.y = baseY + Math.sin(t * 1.5 + idx * 1.3) * 0.7;
        });

        popOuts.forEach((obj, idx) => {
          obj.rotation.x = t * 0.5 + idx;
          obj.rotation.y = t * 0.7 + idx;
          const baseZ = (idx === 0) ? 8.0 : (idx === 1) ? 11.0 : 6.0;
          obj.position.z = baseZ + Math.sin(t * 2.0 + idx) * 0.4;
        });
      },

      onResize(stg) {
        updateWalls(stg);
      },

      dispose() {
        popOuts.forEach(p => stage.unregisterPopOut(p));
        envTexture.dispose();
        wallMaterial.dispose();
        heroGeo.dispose();
        heroMat.dispose();
        ringGeo.dispose();
        shadowGeo.dispose();
        shadowMat.dispose();

        root.traverse((obj) => {
          if (obj.isMesh) {
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
