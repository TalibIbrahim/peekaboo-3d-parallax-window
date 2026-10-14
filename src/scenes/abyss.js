import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { causticsGLSL } from '../shaders/caustics.js';
import { simplexNoise3DGLSL } from '../shaders/simplexNoise.js';
import { edgeFadeVertexGLSL } from '../shaders/edgeFade.js';

// GPGPU velocity simulation shader for circulating reef fish school
const fragmentShaderVelocity = /* glsl */ `
uniform float time;
uniform float delta;
uniform vec3 predator;
uniform float predatorRadius;
uniform vec3 sharkPos;
uniform float sharkActive;
uniform vec3 boundsMin;
uniform vec3 boundsMax;
uniform float speedLimit;

const float separationDist = 2.6;
const float alignmentDist = 5.2;
const float cohesionDist = 6.5;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 selfPos = texture2D(texturePosition, uv).xyz;
  vec3 selfVel = texture2D(textureVelocity, uv).xyz;

  vec3 separation = vec3(0.0);
  vec3 alignment = vec3(0.0);
  vec3 cohesion = vec3(0.0);
  float neighborCount = 0.0;

  for (float y = 0.0; y < 1.0; y += 0.1) {
    for (float x = 0.0; x < 1.0; x += 0.1) {
      vec2 otherUV = vec2(x, y);
      if (otherUV == uv) continue;

      vec3 otherPos = texture2D(texturePosition, otherUV).xyz;
      vec3 otherVel = texture2D(textureVelocity, otherUV).xyz;
      vec3 diff = selfPos - otherPos;
      float dist = length(diff);

      if (dist > 0.01 && dist < cohesionDist) {
        if (dist < separationDist) {
          separation += (diff / dist) * (1.0 - dist / separationDist);
        }
        if (dist < alignmentDist) {
          alignment += otherVel;
        }
        cohesion += otherPos;
        neighborCount += 1.0;
      }
    }
  }

  vec3 accel = vec3(0.0);

  if (neighborCount > 0.0) {
    alignment = (alignment / neighborCount) - selfVel;
    cohesion = (cohesion / neighborCount) - selfPos;
    accel += separation * 9.2 + alignment * 2.6 + cohesion * 0.28;
  }

  // Oceanic cave circulation current
  vec3 caveCenter = vec3(0.0, 0.5, -36.0);
  vec3 offset = selfPos - caveCenter;
  vec3 loopCurrent = vec3(-offset.z * 0.24, sin(offset.x * 0.12 + time * 0.5) * 1.1, offset.x * 0.34);
  accel += loopCurrent * 1.5;

  // Soft boundary steering
  float safeW = boundsMax.x * 0.88;
  float safeH = boundsMax.y * 0.85;

  if (selfPos.x < -safeW) accel.x += ( -safeW - selfPos.x ) * 4.5;
  if (selfPos.x >  safeW) accel.x += (  safeW - selfPos.x ) * 4.5;
  if (selfPos.y < -safeH) accel.y += ( -safeH - selfPos.y ) * 4.5;
  if (selfPos.y >  safeH) accel.y += (  safeH - selfPos.y ) * 4.5;
  if (selfPos.z < boundsMin.z) accel.z += ( boundsMin.z - selfPos.z ) * 4.5;
  if (selfPos.z > boundsMax.z) accel.z += ( boundsMax.z - selfPos.z ) * 7.5;

  // Face as predator (leaning toward screen gently scatters nearby fish)
  vec3 toPred = selfPos - predator;
  float predDist = length(toPred);
  if (predDist < predatorRadius && predDist > 0.01) {
    float fleeForce = (1.0 - predDist / predatorRadius) * 26.0;
    accel += (toPred / predDist) * fleeForce;
  }

  // Shark shadow fleeing
  if (sharkActive > 0.5) {
    vec3 toShark = selfPos - sharkPos;
    float sDist = length(toShark);
    if (sDist < 30.0 && sDist > 0.01) {
      accel += (toShark / sDist) * 35.0;
    }
  }

  selfVel += accel * delta;
  float speed = length(selfVel);
  if (speed > speedLimit) {
    selfVel = (selfVel / speed) * speedLimit;
  } else if (speed < 5.0) {
    selfVel = (selfVel / (speed + 0.001)) * 5.0;
  }

  gl_FragColor = vec4(selfVel, 1.0);
}
`;

const fragmentShaderPosition = /* glsl */ `
uniform float delta;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  pos += vel * delta;
  gl_FragColor = vec4(pos, 1.0);
}
`;

/**
 * Organic, streamlined 3D fish geometry scaled proportionally (~1.8 cm length)
 */
function createOrganicFishGeometry() {
  const geo = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const tailFactors = [];
  const indices = [];

  const S = 0.52; // Scale factor for realistic reef fish proportions

  const ringZs = [1.5 * S, 1.2 * S, 0.7 * S, 0.1 * S, -0.4 * S, -0.9 * S, -1.3 * S];
  const ringWidths = [0.0, 0.26 * S, 0.40 * S, 0.44 * S, 0.36 * S, 0.20 * S, 0.07 * S];
  const ringHeights = [0.0, 0.32 * S, 0.54 * S, 0.62 * S, 0.48 * S, 0.28 * S, 0.12 * S];
  const radialSegments = 10;

  for (let r = 0; r < ringZs.length; r++) {
    const z = ringZs[r];
    const rw = ringWidths[r];
    const rh = ringHeights[r];
    const tFact = Math.max(0.0, (-z + 0.1) / (1.5 * S));

    if (r === 0) {
      positions.push(0, 0, z);
      normals.push(0, 0, 1);
      uvs.push(0.5, 0);
      tailFactors.push(0);
    } else {
      for (let s = 0; s < radialSegments; s++) {
        const phi = (s / radialSegments) * Math.PI * 2;
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);
        positions.push(cosP * rw, sinP * rh, z);
        normals.push(cosP, sinP, 0.15);
        uvs.push(s / radialSegments, r / (ringZs.length - 1));
        tailFactors.push(tFact);
      }
    }
  }

  // Snout triangles
  for (let s = 0; s < radialSegments; s++) {
    const next = (s + 1) % radialSegments;
    indices.push(0, 1 + s, 1 + next);
  }

  // Body quad strips
  for (let r = 1; r < ringZs.length - 1; r++) {
    const rStart = 1 + (r - 1) * radialSegments;
    const nextRStart = 1 + r * radialSegments;
    for (let s = 0; s < radialSegments; s++) {
      const nextS = (s + 1) % radialSegments;
      const a = rStart + s;
      const b = rStart + nextS;
      const c = nextRStart + nextS;
      const d = nextRStart + s;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // Caudal Tail Fin (2-segment flexible flared lobes)
  const tailStart = positions.length / 3;
  const tailVerts = [
    [0.0,  0.10 * S, -1.30 * S, 0.8],
    [0.0, -0.10 * S, -1.30 * S, 0.8],
    [0.0,  0.42 * S, -1.75 * S, 1.3],
    [0.0,  0.0,      -1.65 * S, 1.1],
    [0.0, -0.38 * S, -1.75 * S, 1.3],
    [0.0,  0.70 * S, -2.25 * S, 1.8],
    [0.0,  0.0,      -1.95 * S, 1.4],
    [0.0, -0.62 * S, -2.25 * S, 1.8]
  ];

  tailVerts.forEach(v => {
    positions.push(v[0], v[1], v[2]);
    normals.push(1, 0, 0);
    uvs.push(0.5, 0.85);
    tailFactors.push(v[3]);
  });

  const tI = (o) => tailStart + o;
  indices.push(
    tI(0), tI(2), tI(3), tI(0), tI(3), tI(1), tI(1), tI(3), tI(4),
    tI(0), tI(3), tI(2), tI(0), tI(1), tI(3), tI(1), tI(4), tI(3),
    tI(2), tI(5), tI(6), tI(2), tI(6), tI(3),
    tI(2), tI(6), tI(5), tI(2), tI(3), tI(6),
    tI(3), tI(6), tI(7), tI(3), tI(7), tI(4),
    tI(3), tI(7), tI(6), tI(3), tI(4), tI(7)
  );

  // Dorsal Fin
  const dorsalStart = positions.length / 3;
  const dorsalVerts = [
    [0.0, 0.32 * S,  0.50 * S, 0.2],
    [0.0, 0.88 * S, -0.10 * S, 0.4],
    [0.0, 0.28 * S, -0.60 * S, 0.6]
  ];
  dorsalVerts.forEach(v => {
    positions.push(v[0], v[1], v[2]);
    normals.push(1, 0, 0);
    uvs.push(0.5, 0.5);
    tailFactors.push(v[3]);
  });
  indices.push(
    dorsalStart, dorsalStart + 1, dorsalStart + 2,
    dorsalStart, dorsalStart + 2, dorsalStart + 1
  );

  // Pectoral fins
  const pectStart = positions.length / 3;
  const pectVerts = [
    [ 0.40 * S, -0.05 * S,  0.35 * S, 0.1],
    [ 0.88 * S, -0.22 * S, -0.15 * S, 0.3],
    [ 0.35 * S, -0.20 * S, -0.05 * S, 0.2],
    [-0.40 * S, -0.05 * S,  0.35 * S, 0.1],
    [-0.88 * S, -0.22 * S, -0.15 * S, 0.3],
    [-0.35 * S, -0.20 * S, -0.05 * S, 0.2]
  ];
  pectVerts.forEach(v => {
    positions.push(v[0], v[1], v[2]);
    normals.push(0, 1, 0);
    uvs.push(0.5, 0.5);
    tailFactors.push(v[3]);
  });
  indices.push(
    pectStart, pectStart + 1, pectStart + 2,
    pectStart, pectStart + 2, pectStart + 1,
    pectStart + 3, pectStart + 5, pectStart + 4,
    pectStart + 3, pectStart + 4, pectStart + 5
  );

  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute('tailFactor', new THREE.BufferAttribute(new Float32Array(tailFactors), 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export default {
  id: 'abyss',
  name: 'Abyss',
  tagline: 'Living bioluminescent reef cave with schooling fish and jellyfish',
  quality: { minTier: 'Low' },

  async create(ctx) {
    const { THREE: T, renderer, stage, quality } = ctx;
    const root = new T.Group();
    root.name = 'AbyssRoot';

    const tier = quality || 'Medium';
    const fishTexDim = (tier === 'Low') ? 14 : (tier === 'High') ? 22 : 18;
    const fishCount = fishTexDim * fishTexDim;

    // 1. Cave Frame: Craggy rock walls with procedural displacement & bioluminescent veins
    const caveGroup = new T.Group();
    root.add(caveGroup);

    const rockMaterial = new T.ShaderMaterial({
      uniforms: {
        lightDir: { value: new T.Vector3(0.3, 0.8, 0.5).normalize() }
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 lightDir;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        ${simplexNoise3DGLSL}

        void main() {
          float n1 = snoise(vWorldPos * 0.08) * 0.5 + 0.5;
          float n2 = snoise(vWorldPos * 0.35) * 0.5 + 0.5;
          float rockPattern = mix(n1, n2, 0.35);

          vec3 baseRock = vec3(0.015, 0.06, 0.10);
          vec3 slateRock = vec3(0.03, 0.11, 0.16);
          vec3 cyanVein = vec3(0.0, 0.42, 0.55);

          vec3 col = mix(baseRock, slateRock, rockPattern);
          float vein = smoothstep(0.74, 0.90, snoise(vWorldPos * 0.22));
          col += cyanVein * vein * 0.65;

          float diff = max(dot(vNormal, lightDir), 0.0);
          float amb = 0.38;
          gl_FragColor = vec4(col * (diff * 0.6 + amb), 1.0);
        }
      `
    });

    const floorMaterial = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        floorColor: { value: new T.Color(0x01101a) },
        causticColor: { value: new T.Color(0x00c8e0) }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 floorColor;
        uniform vec3 causticColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        ${causticsGLSL}

        void main() {
          float caustics = computeCaustics(vWorldPos.xz * 0.7, time * 0.7);
          vec3 col = floorColor + causticColor * caustics * 0.08;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    const floorGeo = new T.PlaneGeometry(1, 1, 32, 32);
    const floorMesh = new T.Mesh(floorGeo, floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    caveGroup.add(floorMesh);

    const ceilingGeo = new T.PlaneGeometry(1, 1, 32, 32);
    const ceilingMesh = new T.Mesh(ceilingGeo, rockMaterial);
    ceilingMesh.rotation.x = Math.PI / 2;
    caveGroup.add(ceilingMesh);

    const leftWall = new T.Mesh(new T.PlaneGeometry(1, 1, 24, 24), rockMaterial);
    leftWall.rotation.y = Math.PI / 2;
    caveGroup.add(leftWall);

    const rightWall = new T.Mesh(new T.PlaneGeometry(1, 1, 24, 24), rockMaterial);
    rightWall.rotation.y = -Math.PI / 2;
    caveGroup.add(rightWall);

    const backRock = new T.Mesh(new T.PlaneGeometry(1, 1, 16, 16), rockMaterial);
    caveGroup.add(backRock);

    // Framing Columns at mid-depth on sides
    const columnGeo = new T.CylinderGeometry(1.2, 1.8, 45, 12);
    const colLeft = new T.Mesh(columnGeo, rockMaterial);
    colLeft.position.set(-stage.W * 0.44, 0, -18);
    colLeft.rotation.z = -0.06;
    caveGroup.add(colLeft);

    const colRight = new T.Mesh(columnGeo, rockMaterial);
    colRight.position.set(stage.W * 0.44, 0, -24);
    colRight.rotation.z = 0.05;
    caveGroup.add(colRight);

    function updateCaveGeometry(stg) {
      const W = stg.W;
      const H = stg.H;
      const D = 70.0;

      floorMesh.scale.set(W, D, 1);
      floorMesh.position.set(0, -H * 0.5, -D * 0.5);

      ceilingMesh.scale.set(W, D, 1);
      ceilingMesh.position.set(0, H * 0.5, -D * 0.5);

      leftWall.scale.set(D, H, 1);
      leftWall.position.set(-W * 0.5, 0, -D * 0.5);

      rightWall.scale.set(D, H, 1);
      rightWall.position.set(W * 0.5, 0, -D * 0.5);

      backRock.scale.set(W, H, 1);
      backRock.position.set(0, 0, -D);

      colLeft.position.x = -W * 0.46;
      colRight.position.x = W * 0.46;
    }
    updateCaveGeometry(stage);

    // 2. Underwater Atmospheric Lighting
    const ambLight = new T.AmbientLight(0x041b2b, 0.85);
    root.add(ambLight);

    const sunShaftLight = new T.DirectionalLight(0x22a0cc, 0.65);
    sunShaftLight.position.set(10, 28, 8);
    root.add(sunShaftLight);

    // 3. Volumetric Light Shafts
    const lightShaftGroup = new T.Group();
    const shaftGeo = new T.PlaneGeometry(6, 60);
    const shaftMat = new T.MeshBasicMaterial({
      color: 0x00d2ea,
      transparent: true,
      opacity: 0.025,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      depthWrite: false
    });

    for (let i = 0; i < 5; i++) {
      const shaft = new T.Mesh(shaftGeo, shaftMat);
      shaft.position.set((i - 2) * 7.5, stage.H * 0.5 - 3, -22 - i * 8.0);
      shaft.rotation.z = -0.14 + (i % 2) * 0.06;
      shaft.rotation.y = (i * 0.22);
      lightShaftGroup.add(shaft);
    }
    root.add(lightShaftGroup);

    // 4. Bioluminescent Anemone / Coral Clusters along the lower walls
    const coralGroup = new T.Group();
    const coralGeo = new T.CylinderGeometry(0.12, 0.22, 1.8, 6);
    coralGeo.translate(0, 0.9, 0);
    const coralMat1 = new T.MeshBasicMaterial({ color: 0x00f0ff });
    const coralMat2 = new T.MeshBasicMaterial({ color: 0xd946ef });

    for (let i = 0; i < 28; i++) {
      const isRight = (i % 2 === 0);
      const x = isRight ? (stage.W * 0.5 - 0.8 - Math.random() * 1.5) : (-stage.W * 0.5 + 0.8 + Math.random() * 1.5);
      const z = -10 - Math.random() * 52;
      const y = -stage.H * 0.5;

      const cMesh = new T.Mesh(coralGeo, (i % 3 === 0) ? coralMat2 : coralMat1);
      cMesh.position.set(x, y, z);
      const s = 0.6 + Math.random() * 0.8;
      cMesh.scale.set(s, s * (1.0 + Math.random() * 0.6), s);
      cMesh.rotation.z = (isRight ? -1 : 1) * (0.2 + Math.random() * 0.35);
      coralGroup.add(cMesh);
    }
    root.add(coralGroup);

    // 5. Gliding Manta Ray at z = -58 cm with undulating wings
    const mantaGroup = new T.Group();
    mantaGroup.position.set(-8, 5, -58);
    mantaGroup.rotation.x = Math.PI * 0.42;

    const mantaShape = new T.Shape();
    mantaShape.moveTo(0, 3.2);
    mantaShape.quadraticCurveTo(6, 2.0, 13, -1.2);
    mantaShape.quadraticCurveTo(6, -3.2, 1.8, -5.8);
    mantaShape.lineTo(0.3, -13.0);
    mantaShape.lineTo(-0.3, -13.0);
    mantaShape.lineTo(-1.8, -5.8);
    mantaShape.quadraticCurveTo(-6, -3.2, -13, -1.2);
    mantaShape.quadraticCurveTo(-6, 2.0, 0, 3.2);

    const mantaGeo = new T.ShapeGeometry(mantaShape, 16);
    const mantaMat = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 }
      },
      transparent: true,
      side: T.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          // Graceful wing flapping motion
          float flap = sin(time * 1.6 + abs(p.x) * 0.18);
          p.z += flap * (abs(p.x) * 0.28);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vec3 dorsalCol = vec3(0.03, 0.09, 0.16);
          float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          vec3 col = dorsalCol + vec3(0.0, 0.55, 0.75) * (1.0 - edge) * 0.45;
          gl_FragColor = vec4(col, 0.80);
        }
      `
    });
    const mantaMesh = new T.Mesh(mantaGeo, mantaMat);
    mantaMesh.scale.set(0.6, 0.6, 0.6);
    mantaGroup.add(mantaMesh);
    root.add(mantaGroup);

    // 6. Bioluminescent Jellyfish
    const jellyGroup = new T.Group();
    const jellies = [];

    const jPoints = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const theta = t * Math.PI * 0.52;
      const r = Math.sin(theta) * 2.8;
      const y = -Math.cos(theta) * 2.2 + 0.3;
      jPoints.push(new T.Vector2(r, y));
    }
    const bellGeo = new T.LatheGeometry(jPoints, 24);

    const coreGeo = new T.SphereGeometry(0.85, 12, 10);
    coreGeo.scale(1.0, 1.4, 1.0);

    const armGeo = new T.PlaneGeometry(0.45, 4.8, 2, 10);
    armGeo.translate(0, -2.4, 0);

    const outerBellMat = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        baseColor: { value: new T.Color(0x0077aa) },
        rimColor: { value: new T.Color(0x9922bb) }
      },
      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec3 p = position;
          float pulse = sin(time * 2.8);
          p.x *= (1.0 + pulse * 0.16);
          p.z *= (1.0 + pulse * 0.16);
          p.y += pulse * 0.35;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          vViewDir = -normalize(mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 baseColor;
        uniform vec3 rimColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 2.6);
          vec3 col = mix(baseColor, rimColor, fresnel);
          gl_FragColor = vec4(col, fresnel * 0.65 + 0.12);
        }
      `
    });

    const innerCoreMat = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        coreColor: { value: new T.Color(0x00f0ff) }
      },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float time;
        void main() {
          vec3 p = position;
          float pulse = sin(time * 2.8);
          p *= (1.0 + pulse * 0.12);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 coreColor;
        void main() {
          float glow = 0.55 + 0.45 * sin(time * 2.8);
          gl_FragColor = vec4(coreColor * glow, 0.7);
        }
      `
    });

    const oralArmMat = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        armColor: { value: new T.Color(0xaa33cc) }
      },
      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          float wave = sin(time * 3.2 + p.y * 1.5);
          p.x += wave * (-p.y * 0.14);
          p.z += cos(time * 2.6 + p.y * 1.8) * (-p.y * 0.12);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 armColor;
        varying vec2 vUv;
        void main() {
          float alpha = (1.0 - vUv.y) * 0.45;
          gl_FragColor = vec4(armColor, alpha);
        }
      `
    });

    const jellyPositions = [
      new T.Vector3(0, 1.6, 5.0),
      new T.Vector3(-9.5, -2.0, -20.0),
      new T.Vector3(8.5, 3.5, -30.0),
      new T.Vector3(-5.0, 5.0, -44.0),
      new T.Vector3(9.0, -3.0, -54.0)
    ];

    for (let i = 0; i < jellyPositions.length; i++) {
      const singleJellyGroup = new T.Group();
      const isHero = (i === 0);

      const bMesh = new T.Mesh(bellGeo, outerBellMat);
      singleJellyGroup.add(bMesh);

      const cMesh = new T.Mesh(coreGeo, innerCoreMat);
      cMesh.position.y = -0.5;
      singleJellyGroup.add(cMesh);

      for (let a = 0; a < 4; a++) {
        const arm = new T.Mesh(armGeo, oralArmMat);
        const ang = (a / 4) * Math.PI * 2;
        arm.position.set(Math.cos(ang) * 0.7, -1.2, Math.sin(ang) * 0.7);
        arm.rotation.y = ang;
        singleJellyGroup.add(arm);
      }

      if (isHero) {
        singleJellyGroup.scale.set(0.85, 0.85, 0.85);
        stage.registerPopOut(bMesh);
      } else {
        const s = 0.55 + (i % 3) * 0.12;
        singleJellyGroup.scale.set(s, s, s);
      }

      singleJellyGroup.position.copy(jellyPositions[i]);
      jellyGroup.add(singleJellyGroup);
      jellies.push({
        group: singleJellyGroup,
        basePos: jellyPositions[i].clone(),
        isHero,
        speed: 0.8 + i * 0.2
      });
    }
    root.add(jellyGroup);

    // 7. GPGPU Schooling Fish Simulation
    const gpuCompute = new GPUComputationRenderer(fishTexDim, fishTexDim, renderer);
    if (!renderer.capabilities.isWebGL2) {
      gpuCompute.setDataType(T.HalfFloatType);
    }

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();
    const posArr = dtPosition.image.data;
    const velArr = dtVelocity.image.data;

    // Distribute initial positions across 2 flowing streams
    for (let k = 0; k < posArr.length; k += 4) {
      const pIdx = k / 4;
      const isSubSchool = (pIdx % 3 === 0);
      let x, y, z;
      const uT = (pIdx / (posArr.length / 4)) * Math.PI * 2;
      if (isSubSchool) {
        x = Math.sin(uT) * (stage.W * 0.36);
        y = 3.5 + Math.sin(uT * 2.0) * 2.0;
        z = -46.0 + Math.cos(uT) * 11.0;
      } else {
        x = Math.sin(uT) * (stage.W * 0.30);
        y = -1.2 + Math.cos(uT * 1.5) * 2.8;
        z = -34.0 + Math.cos(uT) * 15.0;
      }
      posArr[k + 0] = x + (Math.random() - 0.5) * 3.5;
      posArr[k + 1] = y + (Math.random() - 0.5) * 2.5;
      posArr[k + 2] = z + (Math.random() - 0.5) * 4.0;
      posArr[k + 3] = 1.0;

      velArr[k + 0] = -Math.cos(uT) * 7.5;
      velArr[k + 1] = (Math.random() - 0.5) * 1.5;
      velArr[k + 2] = -Math.sin(uT) * 7.5;
      velArr[k + 3] = 1.0;
    }

    const velVariable = gpuCompute.addVariable('textureVelocity', fragmentShaderVelocity, dtVelocity);
    const posVariable = gpuCompute.addVariable('texturePosition', fragmentShaderPosition, dtPosition);

    gpuCompute.setVariableDependencies(velVariable, [posVariable, velVariable]);
    gpuCompute.setVariableDependencies(posVariable, [posVariable, velVariable]);

    const velUniforms = velVariable.material.uniforms;
    velUniforms.time = { value: 0 };
    velUniforms.delta = { value: 0.016 };
    velUniforms.predator = { value: new T.Vector3(0, 0, 55) };
    velUniforms.predatorRadius = { value: 26.0 };
    velUniforms.sharkPos = { value: new T.Vector3(0, 0, -45) };
    velUniforms.sharkActive = { value: 0.0 };
    velUniforms.boundsMin = { value: new T.Vector3(-stage.W * 0.45, -stage.H * 0.45, -58.0) };
    velUniforms.boundsMax = { value: new T.Vector3(stage.W * 0.45, stage.H * 0.45, -14.0) };
    velUniforms.speedLimit = { value: 12.0 };

    const posUniforms = posVariable.material.uniforms;
    posUniforms.delta = { value: 0.016 };

    gpuCompute.init();

    // High-fidelity Organic Fish Mesh with Undulating Spine Swimming
    const fishGeo = createOrganicFishGeometry();

    const fishMat = new T.ShaderMaterial({
      uniforms: {
        texturePosition: { value: null },
        textureVelocity: { value: null },
        time: { value: 0 }
      },
      vertexShader: /* glsl */ `
        uniform sampler2D texturePosition;
        uniform sampler2D textureVelocity;
        uniform float time;
        attribute vec2 reference;
        attribute float colorFamily;
        attribute float tailFactor;
        varying vec3 vColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vWorldZ;

        void main() {
          vec3 pos = texture2D(texturePosition, reference).xyz;
          vec3 vel = texture2D(textureVelocity, reference).xyz;

          // Rich saturated oceanic species palettes
          vec3 spineCol = (colorFamily > 0.5) ? vec3(0.92, 0.22, 0.08) : vec3(0.02, 0.14, 0.52);
          vec3 bellyCol = (colorFamily > 0.5) ? vec3(1.0, 0.65, 0.15) : vec3(0.05, 0.55, 0.78);

          float verticalT = clamp(position.y * 3.5 + 0.5, 0.0, 1.0);
          vColor = mix(bellyCol, spineCol, verticalT);

          vec3 dir = normalize(vel + vec3(0.0001));
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 right = normalize(cross(up, dir));
          vec3 newUp = cross(dir, right);
          mat3 rot = mat3(right, newUp, dir);

          vec3 localPos = position;

          float speed = length(vel);
          float swimFreq = 7.0 + speed * 0.35;
          float phase = reference.x * 28.0 + reference.y * 22.0;
          float wave = sin(time * swimFreq - localPos.z * 3.2 + phase);
          localPos.x += wave * tailFactor * 0.14;

          vec3 worldPos = pos + rot * localPos;
          vWorldZ = worldPos.z;
          vNormal = normalMatrix * (rot * normal);
          vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
          vViewDir = -normalize(mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vWorldZ;

        void main() {
          vec3 lightDir = normalize(vec3(0.2, 0.9, 0.35));
          float diff = max(dot(vNormal, lightDir), 0.0);
          float amb = 0.28;

          float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.8);
          vec3 sheen = vec3(0.2, 0.75, 1.0) * fresnel * 0.45;

          vec3 halfV = normalize(lightDir + vViewDir);
          float spec = pow(max(dot(vNormal, halfV), 0.0), 24.0) * 0.35;

          float depthFade = clamp((-vWorldZ - 18.0) / 42.0, 0.0, 0.75);
          vec3 deepSeaFog = vec3(0.01, 0.07, 0.12);

          vec3 finalColor = vColor * (diff * 0.65 + amb) + sheen + vec3(0.7, 0.9, 1.0) * spec;
          finalColor = mix(finalColor, deepSeaFog, depthFade);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      side: T.DoubleSide
    });

    const instancedFish = new T.InstancedMesh(fishGeo, fishMat, fishCount);
    instancedFish.frustumCulled = false;

    const references = new Float32Array(fishCount * 2);
    const colorFamilies = new Float32Array(fishCount);
    let idx = 0;
    for (let y = 0; y < fishTexDim; y++) {
      for (let x = 0; x < fishTexDim; x++) {
        references[idx * 2 + 0] = (x + 0.5) / fishTexDim;
        references[idx * 2 + 1] = (y + 0.5) / fishTexDim;
        colorFamilies[idx] = (idx % 2 === 0) ? 1.0 : 0.0;
        idx++;
      }
    }
    fishGeo.setAttribute('reference', new T.InstancedBufferAttribute(references, 2));
    fishGeo.setAttribute('colorFamily', new T.InstancedBufferAttribute(colorFamilies, 1));
    root.add(instancedFish);

    // 8. Marine Snow Particle Drift
    const snowCount = 1000;
    const snowPos = new Float32Array(snowCount * 3);
    const snowSpeeds = new Float32Array(snowCount);

    for (let i = 0; i < snowCount; i++) {
      snowPos[i * 3 + 0] = (Math.random() - 0.5) * stage.W * 1.1;
      snowPos[i * 3 + 1] = (Math.random() - 0.5) * stage.H * 1.1;
      snowPos[i * 3 + 2] = -65.0 + Math.random() * 70.0;
      snowSpeeds[i] = 0.3 + Math.random() * 0.9;
    }

    const snowGeo = new T.BufferGeometry();
    snowGeo.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    snowGeo.setAttribute('speed', new T.BufferAttribute(snowSpeeds, 1));

    const snowMat = new T.ShaderMaterial({
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
        attribute float speed;
        varying float vAlpha;
        ${edgeFadeVertexGLSL}

        void main() {
          vec3 p = position;
          p.y -= mod(time * speed, 60.0) - 30.0;
          p.x += sin(time * 0.5 + p.z * 0.1) * 0.4;

          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          vec4 clip = projectionMatrix * mvPos;
          gl_Position = clip;

          float sizeCm = 0.09;
          float dist = max(-mvPos.z, 1.0);
          gl_PointSize = sizeCm * pxPerCm * eyeZ / dist;

          float fade = computeEdgeFade(clip, p.z);
          vAlpha = fade * 0.35;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(0.25, 0.72, 0.92, vAlpha * soft);
        }
      `
    });

    const snowPoints = new T.Points(snowGeo, snowMat);
    snowPoints.frustumCulled = false;
    root.add(snowPoints);

    let sharkTimer = 0;
    let sharkNextTime = 25.0;
    let sharkDartRemaining = 0;

    return {
      root,
      background: new T.Color(0x01131e),
      fog: new T.FogExp2(0x01131e, 0.015),
      post: {
        bloomStrength: 0.32,
        bloomRadius: 0.40,
        bloomThreshold: 0.85
      },

      update(dt, t, eye, stg) {
        floorMaterial.uniforms.time.value = t;
        fishMat.uniforms.time.value = t;
        outerBellMat.uniforms.time.value = t;
        innerCoreMat.uniforms.time.value = t;
        oralArmMat.uniforms.time.value = t;
        mantaMat.uniforms.time.value = t;

        snowMat.uniforms.time.value = t;
        snowMat.uniforms.pxPerCm.value = stg.pxPerCm;
        snowMat.uniforms.eyeZ.value = Math.max(eye.z, 15.0);

        sharkTimer += dt;
        if (sharkTimer >= sharkNextTime) {
          sharkDartRemaining = 3.2;
          sharkTimer = 0;
          sharkNextTime = 25.0 + Math.random() * 15.0;
        }

        if (sharkDartRemaining > 0) {
          sharkDartRemaining -= dt;
          velUniforms.sharkActive.value = 1.0;
          velUniforms.sharkPos.value.set(Math.sin(t * 2.8) * 16.0, 0.0, -42.0);
        } else {
          velUniforms.sharkActive.value = 0.0;
        }

        velUniforms.delta.value = Math.min(dt, 0.033);
        velUniforms.time.value = t;
        velUniforms.predator.value.set(eye.x, eye.y, eye.z);
        velUniforms.predatorRadius.value = (eye.z < 35.0) ? 32.0 : 22.0;

        posUniforms.delta.value = Math.min(dt, 0.033);

        gpuCompute.compute();

        fishMat.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(posVariable).texture;
        fishMat.uniforms.textureVelocity.value = gpuCompute.getCurrentRenderTarget(velVariable).texture;

        mantaGroup.position.x = Math.sin(t * 0.14) * 15.0;
        mantaGroup.position.y = 4.5 + Math.cos(t * 0.18) * 2.0;

        for (let i = 0; i < jellies.length; i++) {
          const j = jellies[i];
          if (!j.isHero) {
            j.group.position.y = j.basePos.y + Math.sin(t * j.speed + i) * 1.8;
            j.group.position.x = j.basePos.x + Math.cos(t * 0.6 + i * 1.5) * 1.2;
          } else {
            j.group.position.y = 1.5 + Math.sin(t * 1.6) * 0.45;
            j.group.position.x = Math.sin(t * 1.0) * 0.9;
          }
        }
      },

      onResize(stg) {
        updateCaveGeometry(stg);
        velUniforms.boundsMin.value.set(-stg.W * 0.45, -stg.H * 0.45, -58.0);
        velUniforms.boundsMax.value.set(stg.W * 0.45, stg.H * 0.45, -14.0);
      },

      dispose() {
        for (const j of jellies) {
          if (j.isHero) {
            const bell = j.group.children[0];
            if (bell) stage.unregisterPopOut(bell);
          }
        }

        try {
          if (gpuCompute.dispose) gpuCompute.dispose();
          else [velVariable, posVariable].forEach(v => {
            if (v.renderTargets) v.renderTargets.forEach(rt => rt.dispose());
          });
        } catch (e) {
          console.warn('Error disposing gpuCompute:', e);
        }

        floorGeo.dispose();
        ceilingGeo.dispose();
        floorMaterial.dispose();
        rockMaterial.dispose();
        columnGeo.dispose();
        shaftGeo.dispose();
        shaftMat.dispose();
        coralGeo.dispose();
        coralMat1.dispose();
        coralMat2.dispose();
        mantaGeo.dispose();
        mantaMat.dispose();
        bellGeo.dispose();
        coreGeo.dispose();
        armGeo.dispose();
        outerBellMat.dispose();
        innerCoreMat.dispose();
        oralArmMat.dispose();
        fishGeo.dispose();
        fishMat.dispose();
        snowGeo.dispose();
        snowMat.dispose();

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
