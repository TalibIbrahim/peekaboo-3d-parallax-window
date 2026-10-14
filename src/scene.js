import * as THREE from 'three';

/**
 * Creates a procedural grid canvas texture.
 * Generates minor lines every 5 cm and major lines every 25 cm.
 * Designed to tile seamlessly over 50 cm x 50 cm.
 */
function createGridTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Dark navy background
  ctx.fillStyle = '#060a1d';
  ctx.fillRect(0, 0, size, size);

  // 50 cm represented across size pixels -> 1 cm = size / 50 px
  const pxPerCm = size / 50.0;

  // Draw minor grid lines every 5 cm
  ctx.strokeStyle = 'rgba(0, 220, 255, 0.16)';
  ctx.lineWidth = 1.5;
  for (let cm = 0; cm <= 50; cm += 5) {
    if (cm % 25 === 0) continue; // Skip major lines for now
    const pos = Math.round(cm * pxPerCm);
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.stroke();
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }

  // Draw major grid lines every 25 cm with bright cyan/magenta neon glow
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 6;
  for (let cm = 0; cm <= 50; cm += 25) {
    const pos = Math.round(cm * pxPerCm);
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }

  // Subtle magenta accents on intersections
  ctx.fillStyle = '#ff007f';
  ctx.shadowColor = '#ff007f';
  ctx.shadowBlur = 8;
  for (let xCm = 0; xCm <= 50; xCm += 25) {
    for (let yCm = 0; yCm <= 50; yCm += 25) {
      const px = Math.round(xCm * pxPerCm);
      const py = Math.round(yCm * pxPerCm);
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Builds the 3D room and interactive objects.
 * Room depth D = 70 cm into negative Z.
 */
export function createScene(screenW, screenH) {
  const scene = new THREE.Scene();
  const roomDepth = 70.0; // cm

  // Background color & subtle depth fog
  const bgColor = 0x050716;
  scene.background = new THREE.Color(bgColor);
  scene.fog = new THREE.Fog(bgColor, 50, 160);

  // Grid texture for walls
  const wallTexture = createGridTexture();
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: wallTexture,
    roughness: 0.6,
    metalness: 0.2,
    fog: true
  });

  // Walls container
  const roomGroup = new THREE.Group();
  scene.add(roomGroup);

  // Five walls: floor, ceiling, left, right, back
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
  floorMesh.rotation.x = -Math.PI / 2;
  roomGroup.add(floorMesh);

  const ceilingMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
  ceilingMesh.rotation.x = Math.PI / 2;
  roomGroup.add(ceilingMesh);

  const leftWallMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
  leftWallMesh.rotation.y = Math.PI / 2;
  roomGroup.add(leftWallMesh);

  const rightWallMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
  rightWallMesh.rotation.y = -Math.PI / 2;
  roomGroup.add(rightWallMesh);

  const backWallMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
  roomGroup.add(backWallMesh);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x202b48, 1.2);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(25, 40, 30);
  scene.add(dirLight);

  const cyanPointLight = new THREE.PointLight(0x00f0ff, 2.5, 120);
  cyanPointLight.position.set(0, 8, -35);
  scene.add(cyanPointLight);

  const pinkPointLight = new THREE.PointLight(0xff007f, 1.8, 90);
  pinkPointLight.position.set(-15, -12, -45);
  scene.add(pinkPointLight);

  // Hero object: Center Torus Knot
  const heroGeometry = new THREE.TorusKnotGeometry(4.8, 1.35, 120, 24);
  const heroMaterial = new THREE.MeshStandardMaterial({
    color: 0x9933ff,
    roughness: 0.2,
    metalness: 0.85,
    emissive: 0x220044
  });
  const heroMesh = new THREE.Mesh(heroGeometry, heroMaterial);
  heroMesh.position.set(0, 0, -35);
  scene.add(heroMesh);

  // Perspective cue: A tunnel column of rings spaced 8 cm apart along Z
  const ringGroup = new THREE.Group();
  const ringGeometry = new THREE.TorusGeometry(5.2, 0.25, 16, 48);
  for (let z = -8; z >= -64; z -= 8) {
    const isMajor = (z === -24 || z === -48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: isMajor ? 0x00ffff : 0xff0088,
      emissive: isMajor ? 0x006677 : 0x550033,
      roughness: 0.3,
      metalness: 0.6
    });
    const ringMesh = new THREE.Mesh(ringGeometry, ringMat);
    ringMesh.position.set(0, 0, z);
    ringGroup.add(ringMesh);
  }
  scene.add(ringGroup);

  // Floating objects behind screen at various depths: -10, -25, -40, -55 cm
  const floatingObjects = [];
  const shadows = [];

  const shadowGeo = new THREE.CircleGeometry(2.5, 32);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthWrite: false
  });

  function addFloatingObject(mesh, shadowRadius = 2.5) {
    scene.add(mesh);
    floatingObjects.push(mesh);

    const s = new THREE.Mesh(
      shadowRadius === 2.5 ? shadowGeo : new THREE.CircleGeometry(shadowRadius, 32),
      shadowMat
    );
    s.rotation.x = -Math.PI / 2;
    s.position.set(mesh.position.x, -screenH * 0.5 + 0.1, mesh.position.z);
    scene.add(s);
    shadows.push({ shadow: s, target: mesh, baseRadius: shadowRadius });
  }

  // Floating object 1: Emerald Cube at z = -10
  const cube1 = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 4.2, 4.2),
    new THREE.MeshStandardMaterial({ color: 0x00ff88, roughness: 0.25, metalness: 0.7 })
  );
  cube1.position.set(-11, -3, -10);
  addFloatingObject(cube1, 2.6);

  // Floating object 2: Violet Sphere at z = -25
  const sphere1 = new THREE.Mesh(
    new THREE.SphereGeometry(3.0, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0x8a2be2, roughness: 0.2, metalness: 0.8 })
  );
  sphere1.position.set(12, 6, -25);
  addFloatingObject(sphere1, 2.4);

  // Floating object 3: Ruby Prism at z = -40
  const prism1 = new THREE.Mesh(
    new THREE.OctahedronGeometry(3.5),
    new THREE.MeshStandardMaterial({ color: 0xff1744, roughness: 0.3, metalness: 0.75 })
  );
  prism1.position.set(-12, 5, -40);
  addFloatingObject(prism1, 2.8);

  // Floating object 4: Golden Sphere at z = -55
  const sphere2 = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.2, metalness: 0.9 })
  );
  sphere2.position.set(9, -5, -55);
  addFloatingObject(sphere2, 2.5);

  // POP-OUT objects in FRONT of the screen plane (z = +5 to +14 cm)
  // These make the 3D window effect strikingly apparent as they appear outside the monitor!
  const popOutObjects = [];

  // Pop-out 1: Golden Icosahedron at z = +8
  const pop1 = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.4),
    new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.15,
      metalness: 0.95,
      emissive: 0x332200
    })
  );
  pop1.position.set(-8.5, 3.5, 8.0);
  scene.add(pop1);
  popOutObjects.push(pop1);

  // Pop-out 2: Neon Cyan Octahedron at z = +12
  const pop2 = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.0),
    new THREE.MeshStandardMaterial({
      color: 0x00f5ff,
      roughness: 0.2,
      metalness: 0.9,
      emissive: 0x003344
    })
  );
  pop2.position.set(9.0, -2.5, 12.0);
  scene.add(pop2);
  popOutObjects.push(pop2);

  // Pop-out 3: Hot Pink Dodecahedron at z = +6
  const pop3 = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.8),
    new THREE.MeshStandardMaterial({
      color: 0xff007f,
      roughness: 0.25,
      metalness: 0.85,
      emissive: 0x440022
    })
  );
  pop3.position.set(0.0, 7.5, 6.0);
  scene.add(pop3);
  popOutObjects.push(pop3);

  const sceneContext = {
    scene,
    roomDepth,
    wallTexture,
    walls: {
      floor: floorMesh,
      ceiling: ceilingMesh,
      left: leftWallMesh,
      right: rightWallMesh,
      back: backWallMesh
    },
    heroMesh,
    ringGroup,
    floatingObjects,
    popOutObjects,
    shadows,
    screenW,
    screenH
  };

  updateSceneDimensions(sceneContext, screenW, screenH);
  return sceneContext;
}

/**
 * Dynamically resizes the room walls and floor shadows when screen dimensions change.
 */
export function updateSceneDimensions(context, screenW, screenH) {
  context.screenW = screenW;
  context.screenH = screenH;
  const D = context.roomDepth;
  const W = screenW;
  const H = screenH;

  const { floor, ceiling, left, right, back } = context.walls;

  // Floor: size W x D, located at y = -H/2, z = -D/2
  floor.scale.set(W, D, 1);
  floor.position.set(0, -H * 0.5, -D * 0.5);

  // Ceiling: size W x D, located at y = +H/2, z = -D/2
  ceiling.scale.set(W, D, 1);
  ceiling.position.set(0, H * 0.5, -D * 0.5);

  // Left wall: size D x H, located at x = -W/2, z = -D/2
  left.scale.set(D, H, 1);
  left.position.set(-W * 0.5, 0, -D * 0.5);

  // Right wall: size D x H, located at x = +W/2, z = -D/2
  right.scale.set(D, H, 1);
  right.position.set(W * 0.5, 0, -D * 0.5);

  // Back wall: size W x H, located at z = -D
  back.scale.set(W, H, 1);
  back.position.set(0, 0, -D);

  // Update shadow heights to hug the new floor level
  for (const s of context.shadows) {
    s.shadow.position.y = -H * 0.5 + 0.08;
    s.shadow.position.x = s.target.position.x;
    s.shadow.position.z = s.target.position.z;
  }
}

/**
 * Animates the scene objects each frame.
 */
export function animateScene(context, elapsedSeconds) {
  // Hero Torus Knot slow rotation
  if (context.heroMesh) {
    context.heroMesh.rotation.x = elapsedSeconds * 0.45;
    context.heroMesh.rotation.y = elapsedSeconds * 0.65;
  }

  // Gentle floating and rotation for background objects
  if (context.floatingObjects) {
    context.floatingObjects.forEach((obj, idx) => {
      const offset = idx * 1.3;
      obj.rotation.x = elapsedSeconds * (0.3 + idx * 0.1);
      obj.rotation.y = elapsedSeconds * (0.4 + idx * 0.08);
      // subtle vertical float
      const baseY = (idx === 0) ? -3 : (idx === 1) ? 6 : (idx === 2) ? 5 : -5;
      obj.position.y = baseY + Math.sin(elapsedSeconds * 1.5 + offset) * 0.7;
    });
  }

  // Pop-out objects shimmering and floating
  if (context.popOutObjects) {
    context.popOutObjects.forEach((obj, idx) => {
      obj.rotation.x = elapsedSeconds * 0.5 + idx;
      obj.rotation.y = elapsedSeconds * 0.7 + idx;
      const baseZ = (idx === 0) ? 8.0 : (idx === 1) ? 12.0 : 6.0;
      obj.position.z = baseZ + Math.sin(elapsedSeconds * 2.0 + idx) * 0.4;
    });
  }
}
