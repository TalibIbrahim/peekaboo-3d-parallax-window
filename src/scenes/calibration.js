import * as THREE from 'three';

function createGridTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#060a1d';
  ctx.fillRect(0, 0, size, size);

  const pxPerCm = size / 50.0;

  // Minor grid lines every 5 cm
  ctx.strokeStyle = 'rgba(0, 220, 255, 0.16)';
  ctx.lineWidth = 1.5;
  for (let cm = 0; cm <= 50; cm += 5) {
    if (cm % 25 === 0) continue;
    const pos = Math.round(cm * pxPerCm);
    ctx.beginPath();
    ctx.moveTo(pos, 0); ctx.lineTo(pos, size);
    ctx.moveTo(0, pos); ctx.lineTo(size, pos);
    ctx.stroke();
  }

  // Major grid lines every 25 cm with bright cyan neon glow
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 6;
  for (let cm = 0; cm <= 50; cm += 25) {
    const pos = Math.round(cm * pxPerCm);
    ctx.beginPath();
    ctx.moveTo(pos, 0); ctx.lineTo(pos, size);
    ctx.moveTo(0, pos); ctx.lineTo(size, pos);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export default {
  id: 'calibration',
  name: 'Calibration',
  tagline: 'Physical metric room with neon grid and depth anchors',
  quality: { minTier: 'Low' },

  async create(ctx) {
    const { stage } = ctx;
    const root = new THREE.Group();
    root.name = 'CalibrationSceneRoot';

    const roomDepth = 70.0;
    const wallTexture = createGridTexture();
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture,
      roughness: 0.6,
      metalness: 0.2
    });

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

      // Keep pop-outs inside safe rect
      p1.position.x = -stg.safeMaxX * 0.6;
      p2.position.x = stg.safeMaxX * 0.6;
      p3.position.y = stg.safeMaxY * 0.65;
    }

    updateWalls(stage);

    return {
      root,
      background: new THREE.Color(0x050716),
      fog: new THREE.Fog(0x050716, 50, 160),
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
        wallTexture.dispose();
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
