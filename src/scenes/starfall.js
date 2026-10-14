import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { simplexNoise3DGLSL } from '../shaders/simplexNoise.js';
import { edgeFadeVertexGLSL } from '../shaders/edgeFade.js';

// Starfall GPGPU velocity shader with inline 3D curl noise and winding celestial path
const starfallVelocityShader = /* glsl */ `
uniform float time;
uniform float delta;
uniform vec2 curiosityPos;
uniform float curiosityWeight;

${simplexNoise3DGLSL}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos = posData.xyz;
  float age = posData.w;
  float life = velData.w;

  // Base forward flow along +Z
  vec3 vel = vec3(0.0, 0.0, 8.5);

  // Winding river centerline that flows past the gas giant
  float pathT = clamp((pos.z - (-70.0)) / 80.0, 0.0, 1.0);
  vec2 startPt = vec2(-12.0, -3.5);
  vec2 endPt   = vec2(3.0, 2.2);
  vec2 riverCenter = mix(startPt, endPt, smoothstep(0.0, 1.0, pathT));
  riverCenter.x += sin(pos.z * 0.07 + time * 0.32) * 3.8;
  riverCenter.y += cos(pos.z * 0.05 + time * 0.26) * 2.2;

  vec2 toCenter = riverCenter - pos.xy;
  // Swirling vortex along the river
  vel.x += toCenter.x * 2.2 - toCenter.y * 0.8;
  vel.y += toCenter.y * 2.2 + toCenter.x * 0.8;

  // Curl noise turbulent field
  vec3 curl = curlNoise(pos * 0.05 + vec3(0.0, 0.0, time * 0.03), 0.1);
  vel += curl * 5.2;

  // Curiosity attractor toward user gaze near z = -20
  if (curiosityWeight > 0.01 && abs(pos.z - (-20.0)) < 16.0) {
    vec2 attractDir = curiosityPos - pos.xy;
    vel.xy += attractDir * (curiosityWeight * 2.2);
  }

  gl_FragColor = vec4(vel, life);
}
`;

// Starfall GPGPU position integration and respawn shader
const starfallPositionShader = /* glsl */ `
uniform float delta;
uniform float time;

float hash(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);

  vec3 pos = posData.xyz;
  float age = posData.w + delta;
  float life = velData.w;

  // Respawn condition: age > life or z > +10.0
  if (age > life || pos.z > 10.0) {
    float r = hash(uv + vec2(time, 1.2)) * 6.5;
    float theta = hash(uv + vec2(time, 3.4)) * 6.28318;
    pos.x = -12.0 + cos(theta) * r;
    pos.y = -3.5  + sin(theta) * r;
    pos.z = -70.0 + hash(uv + vec2(time, 5.6)) * 8.0;
    age = 0.0;
  } else {
    pos += velData.xyz * delta;
  }

  gl_FragColor = vec4(pos, age);
}
`;

export default {
  id: 'starfall',
  name: 'Starfall',
  tagline: 'River of light flowing past a ringed gas giant and fly-by comet',
  quality: { minTier: 'Low' },

  async create(ctx) {
    const { THREE: T, renderer, stage, quality } = ctx;
    const root = new T.Group();
    root.name = 'StarfallRoot';

    const tier = quality || 'Medium';
    const riverDim = (tier === 'Low') ? 128 : (tier === 'High') ? 256 : 192;
    const particleCount = riverDim * riverDim;

    // 1. Far Twinkling Starfield in Deep Space
    const starCount = 2500;
    const starPos = new Float32Array(starCount * 3);
    const starPhases = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      starPos[i * 3 + 0] = (Math.random() - 0.5) * 800.0;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 500.0;
      starPos[i * 3 + 2] = -1400.0 + Math.random() * 1310.0;
      starPhases[i] = Math.random() * Math.PI * 2;
    }

    const starGeo = new T.BufferGeometry();
    starGeo.setAttribute('position', new T.BufferAttribute(starPos, 3));
    starGeo.setAttribute('phase', new T.BufferAttribute(starPhases, 1));

    const starMat = new T.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float time;
        attribute float phase;
        varying float vBrightness;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = max(1.2, 700.0 / -mvPos.z);
          vBrightness = 0.35 + 0.65 * sin(time * 2.2 + phase);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBrightness;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(0.85, 0.90, 1.0, vBrightness * (1.0 - d * 2.0));
        }
      `
    });

    const starPoints = new T.Points(starGeo, starMat);
    starPoints.frustumCulled = false;
    root.add(starPoints);

    // 2. Gas Giant Planet at (+11.5, +3.8, -52 cm) with Rings and Cast Shadow
    const planetGroup = new T.Group();
    const planetPos = new T.Vector3(11.5, 3.8, -52.0);
    planetGroup.position.copy(planetPos);

    const planetRadius = 13.0;
    const planetGeo = new T.SphereGeometry(planetRadius, 48, 32);

    const sunDir = new T.Vector3(0.65, 0.45, 0.62).normalize();

    const planetMat = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        sunDirection: { value: sunDir }
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = -normalize(mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 sunDirection;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vLocalPos;

        void main() {
          float lat = vLocalPos.y * 0.35 + sin(vLocalPos.x * 0.14 + time * 0.06) * 0.35;
          float band = sin(lat * 3.4) * 0.5 + 0.5;

          // Regal Jovian cloud deck: deep indigo-amethyst, warm sienna-bronze, golden ochre
          vec3 c1 = vec3(0.08, 0.05, 0.22);
          vec3 c2 = vec3(0.48, 0.22, 0.44);
          vec3 c3 = vec3(0.82, 0.58, 0.26);
          vec3 planetColor = mix(mix(c1, c2, band), c3, pow(band, 3.2));

          float NdotL = max(dot(vNormal, sunDirection), 0.0);
          float terminator = smoothstep(-0.02, 0.22, dot(vNormal, sunDirection));

          // Rayleigh limb haze only on sunlit horizon
          float limb = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.2);
          vec3 atmoHaze = vec3(0.12, 0.55, 0.95) * limb * 0.65 * terminator;

          vec3 finalColor = planetColor * (NdotL * 0.90 + 0.08) + atmoHaze;
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });

    const planetMesh = new T.Mesh(planetGeo, planetMat);
    planetGroup.add(planetMesh);

    // Tilted Ring with real planetary cast shadow
    const ringInnerR = 17.0;
    const ringOuterR = 29.5;
    const ringGeo = new T.RingGeometry(ringInnerR, ringOuterR, 64);
    ringGeo.rotateX(Math.PI * 0.5);

    const ringMat = new T.ShaderMaterial({
      side: T.DoubleSide,
      transparent: true,
      uniforms: {
        innerRadius: { value: ringInnerR },
        outerRadius: { value: ringOuterR },
        planetRadius: { value: planetRadius },
        sunDirection: { value: sunDir },
        planetWorldPos: { value: planetPos }
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        void main() {
          vLocalPos = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float innerRadius;
        uniform float outerRadius;
        uniform float planetRadius;
        uniform vec3 sunDirection;
        uniform vec3 planetWorldPos;
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;

        void main() {
          float r = length(vLocalPos.xz);
          float t = (r - innerRadius) / (outerRadius - innerRadius);
          float band = sin(t * 36.0) * 0.5 + 0.5;
          float alpha = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.90, t) * (0.35 + band * 0.45);
          vec3 ringCol = mix(vec3(0.58, 0.50, 0.72), vec3(0.85, 0.72, 0.48), band);

          // Planetary cast shadow: point on ring relative to planet center
          vec3 d = vWorldPos - planetWorldPos;
          float proj = dot(d, sunDirection);
          // Only downstream of sunlight
          float shadow = 1.0;
          if (proj > 0.0) {
            float distSq = dot(d, d) - proj * proj;
            float rSq = planetRadius * planetRadius * 1.02;
            if (distSq < rSq) {
              float penumbra = smoothstep(planetRadius * 0.92, planetRadius * 1.02, sqrt(distSq));
              shadow = penumbra * 0.92 + 0.08;
            }
          }

          gl_FragColor = vec4(ringCol * shadow, alpha);
        }
      `
    });

    const ringMesh = new T.Mesh(ringGeo, ringMat);
    ringMesh.rotation.z = 0.35;
    ringMesh.rotation.x = 0.28;
    planetGroup.add(ringMesh);

    // 3 Moons
    const moons = [];
    const moonColors = [0x8899bb, 0xcca899, 0x77bbaa];
    const moonSizes = [1.6, 2.2, 1.3];
    const moonRadii = [34.0, 44.0, 56.0];
    const moonSpeeds = [0.32, 0.20, 0.12];

    for (let m = 0; m < 3; m++) {
      const mGeo = new T.SphereGeometry(moonSizes[m], 24, 16);
      const mMat = new T.MeshStandardMaterial({
        color: moonColors[m],
        roughness: 0.72,
        metalness: 0.08
      });
      const mMesh = new T.Mesh(mGeo, mMat);
      planetGroup.add(mMesh);
      moons.push({
        mesh: mMesh,
        radius: moonRadii[m],
        speed: moonSpeeds[m],
        angle: m * 2.1
      });
    }
    root.add(planetGroup);

    // 3. GPGPU Curl-Noise River of Light (Luminous, Non-Blinding)
    const gpuCompute = new GPUComputationRenderer(riverDim, riverDim, renderer);
    if (!renderer.capabilities.isWebGL2) {
      gpuCompute.setDataType(T.HalfFloatType);
    }

    const dtPos = gpuCompute.createTexture();
    const dtVel = gpuCompute.createTexture();
    const pData = dtPos.image.data;
    const vData = dtVel.image.data;

    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
    const mix = (a, b, t) => a * (1.0 - t) + b * t;

    for (let k = 0; k < pData.length; k += 4) {
      const r = Math.sqrt(Math.random()) * 6.5;
      const th = Math.random() * Math.PI * 2;
      const zInit = -70.0 + Math.random() * 80.0;
      const pathT = clamp((zInit - (-70.0)) / 80.0, 0.0, 1.0);
      const cX = mix(-12.0, 3.0, pathT);
      const cY = mix(-3.5, 2.2, pathT);

      pData[k + 0] = cX + Math.cos(th) * r;
      pData[k + 1] = cY + Math.sin(th) * r;
      pData[k + 2] = zInit;
      const life = 6.0 + Math.random() * 6.0;
      pData[k + 3] = Math.random() * life;

      vData[k + 0] = 0.0;
      vData[k + 1] = 0.0;
      vData[k + 2] = 8.5;
      vData[k + 3] = life;
    }

    const velVar = gpuCompute.addVariable('textureVelocity', starfallVelocityShader, dtVel);
    const posVar = gpuCompute.addVariable('texturePosition', starfallPositionShader, dtPos);

    gpuCompute.setVariableDependencies(velVar, [posVar, velVar]);
    gpuCompute.setVariableDependencies(posVar, [posVar, velVar]);

    const velUniforms = velVar.material.uniforms;
    velUniforms.time = { value: 0 };
    velUniforms.delta = { value: 0.016 };
    velUniforms.curiosityPos = { value: new T.Vector2(0, 0) };
    velUniforms.curiosityWeight = { value: 0.3 };

    const posUniforms = posVar.material.uniforms;
    posUniforms.delta = { value: 0.016 };
    posUniforms.time = { value: 0 };

    gpuCompute.init();

    // River Particle Mesh
    const riverGeo = new T.BufferGeometry();
    const uvs = new Float32Array(particleCount * 2);
    let pIdx = 0;
    for (let y = 0; y < riverDim; y++) {
      for (let x = 0; x < riverDim; x++) {
        uvs[pIdx * 2 + 0] = (x + 0.5) / riverDim;
        uvs[pIdx * 2 + 1] = (y + 0.5) / riverDim;
        pIdx++;
      }
    }
    riverGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(particleCount * 3), 3));
    riverGeo.setAttribute('reference', new T.BufferAttribute(uvs, 2));

    const riverMat = new T.ShaderMaterial({
      uniforms: {
        texturePosition: { value: null },
        textureVelocity: { value: null },
        pxPerCm: { value: stage.pxPerCm },
        eyeZ: { value: 55.0 }
      },
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform sampler2D texturePosition;
        uniform sampler2D textureVelocity;
        uniform float pxPerCm;
        uniform float eyeZ;
        attribute vec2 reference;
        varying vec3 vColor;
        varying float vAlpha;
        ${edgeFadeVertexGLSL}

        void main() {
          vec4 posData = texture2D(texturePosition, reference);
          vec4 velData = texture2D(textureVelocity, reference);

          vec3 pos = posData.xyz;
          float age = posData.w;
          float life = velData.w;

          float t = clamp(age / life, 0.0, 1.0);
          // Luminous celestial palette: deep electric indigo -> cyan -> magenta -> starlight gold
          vec3 cIndigo  = vec3(0.12, 0.04, 0.42);
          vec3 cCyan    = vec3(0.0, 0.78, 0.95);
          vec3 cMagenta = vec3(0.88, 0.08, 0.52);
          vec3 cGold    = vec3(1.0, 0.88, 0.55);

          vec3 col = (t < 0.3) ? mix(cIndigo, cCyan, t / 0.3) :
                     (t < 0.7) ? mix(cCyan, cMagenta, (t - 0.3) / 0.4) :
                                 mix(cMagenta, cGold, (t - 0.7) / 0.3);

          vColor = col;

          vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
          vec4 clip = projectionMatrix * mvPos;
          gl_Position = clip;

          float sizeCm = 0.12;
          float dist = max(-mvPos.z, 1.0);
          gl_PointSize = sizeCm * pxPerCm * eyeZ / dist;

          float depthFade = smoothstep(-68.0, -56.0, pos.z) * smoothstep(9.0, 2.0, pos.z);
          float edgeFade = computeEdgeFade(clip, pos.z);
          vAlpha = depthFade * edgeFade * 0.24;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float core = pow(1.0 - d * 2.0, 2.2);
          gl_FragColor = vec4(vColor, vAlpha * core);
        }
      `
    });

    const riverMesh = new T.Points(riverGeo, riverMat);
    riverMesh.frustumCulled = false;
    root.add(riverMesh);

    // 4. Fly-by Comet Event
    let cometActive = false;
    let cometProgress = 0.0;
    let cometCooldown = 4.0;
    const cometHead = new T.Mesh(
      new T.SphereGeometry(0.85, 16, 16),
      new T.MeshBasicMaterial({ color: 0xe0f7ff })
    );
    root.add(cometHead);
    stage.registerPopOut(cometHead);

    const cometTailCount = 450;
    const tailPos = new Float32Array(cometTailCount * 3);
    const tailAges = new Float32Array(cometTailCount);
    let tailHead = 0;

    const tailGeo = new T.BufferGeometry();
    tailGeo.setAttribute('position', new T.BufferAttribute(tailPos, 3));
    tailGeo.setAttribute('age', new T.BufferAttribute(tailAges, 1));

    const tailMat = new T.ShaderMaterial({
      uniforms: {
        pxPerCm: { value: stage.pxPerCm },
        eyeZ: { value: 55.0 }
      },
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float pxPerCm;
        uniform float eyeZ;
        attribute float age;
        varying float vAlpha;
        ${edgeFadeVertexGLSL}

        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vec4 clip = projectionMatrix * mvPos;
          gl_Position = clip;

          float dist = max(-mvPos.z, 1.0);
          gl_PointSize = (0.22 * (1.0 - age * 0.75)) * pxPerCm * eyeZ / dist;

          float edgeFade = computeEdgeFade(clip, position.z);
          vAlpha = (1.0 - age) * edgeFade * 0.40;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(0.2, 0.8, 1.0, vAlpha * (1.0 - d * 2.0));
        }
      `
    });

    const cometTail = new T.Points(tailGeo, tailMat);
    cometTail.frustumCulled = false;
    root.add(cometTail);

    // 5. Ambient Dust Motes (150)
    const moteCount = 150;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3 + 0] = (Math.random() - 0.5) * stage.safeMaxX * 1.5;
      motePos[i * 3 + 1] = (Math.random() - 0.5) * stage.safeMaxY * 1.5;
      motePos[i * 3 + 2] = 2.0 + Math.random() * 8.0;
    }
    const moteGeo = new T.BufferGeometry();
    moteGeo.setAttribute('position', new T.BufferAttribute(motePos, 3));
    const moteMat = new T.ShaderMaterial({
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
          p.x += sin(time * 0.5 + p.z) * 0.35;
          p.y += cos(time * 0.4 + p.x) * 0.25;

          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          vec4 clip = projectionMatrix * mvPos;
          gl_Position = clip;

          float dist = max(-mvPos.z, 1.0);
          gl_PointSize = 0.10 * pxPerCm * eyeZ / dist;

          float fade = computeEdgeFade(clip, p.z);
          vAlpha = fade * 0.35;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(0.75, 0.65, 0.95, vAlpha);
        }
      `
    });
    const motePoints = new T.Points(moteGeo, moteMat);
    motePoints.frustumCulled = false;
    root.add(motePoints);

    return {
      root,
      background: new T.Color(0x030209),
      fog: new T.Fog(0x030209, 65, 230),
      post: {
        bloomStrength: 0.34,
        bloomRadius: 0.42,
        bloomThreshold: 0.84
      },

      update(dt, t, eye, stg) {
        starMat.uniforms.time.value = t;
        planetMat.uniforms.time.value = t;
        planetMesh.rotation.y = t * 0.035;

        for (const m of moons) {
          m.angle += dt * m.speed;
          m.mesh.position.set(
            Math.cos(m.angle) * m.radius,
            Math.sin(m.angle * 0.5) * 4.5,
            Math.sin(m.angle) * m.radius
          );
        }

        velUniforms.time.value = t;
        velUniforms.delta.value = Math.min(dt, 0.033);
        velUniforms.curiosityPos.value.set(eye.x * 0.45, eye.y * 0.45);

        posUniforms.time.value = t;
        posUniforms.delta.value = Math.min(dt, 0.033);

        gpuCompute.compute();

        riverMat.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(posVar).texture;
        riverMat.uniforms.textureVelocity.value = gpuCompute.getCurrentRenderTarget(velVar).texture;
        riverMat.uniforms.pxPerCm.value = stg.pxPerCm;
        riverMat.uniforms.eyeZ.value = Math.max(eye.z, 15.0);

        tailMat.uniforms.pxPerCm.value = stg.pxPerCm;
        tailMat.uniforms.eyeZ.value = Math.max(eye.z, 15.0);

        moteMat.uniforms.time.value = t;
        moteMat.uniforms.pxPerCm.value = stg.pxPerCm;
        moteMat.uniforms.eyeZ.value = Math.max(eye.z, 15.0);

        // Comet Flyby Animation
        cometCooldown -= dt;
        if (!cometActive && cometCooldown <= 0.0) {
          cometActive = true;
          cometProgress = 0.0;
        }

        if (cometActive) {
          cometProgress += dt * 0.22;
          if (cometProgress >= 1.0) {
            cometActive = false;
            cometCooldown = 7.0 + Math.random() * 5.0;
            cometHead.position.set(0, -999, 0);
          } else {
            const cp = cometProgress;
            // Arc path: starts at upper-left far, flies diagonally across foreground
            const cx = -18.0 + cp * 36.0;
            const cy = 8.0 - cp * 12.0;
            const cz = -60.0 + cp * 66.0;

            cometHead.position.set(cx, cy, cz);

            // Record tail points
            const tOffset = tailHead * 3;
            tailPos[tOffset + 0] = cx + (Math.random() - 0.5) * 0.3;
            tailPos[tOffset + 1] = cy + (Math.random() - 0.5) * 0.3;
            tailPos[tOffset + 2] = cz + (Math.random() - 0.5) * 0.3;
            tailAges[tailHead] = 0.0;
            tailHead = (tailHead + 1) % cometTailCount;
          }
        }

        // Age tail points
        for (let i = 0; i < cometTailCount; i++) {
          if (tailAges[i] < 1.0) {
            tailAges[i] += dt * 0.65;
          }
        }
        tailGeo.attributes.position.needsUpdate = true;
        tailGeo.attributes.age.needsUpdate = true;
      },

      onResize(stg) {
        // Starfall elements rescale smoothly with frustum bounds
      },

      dispose() {
        stage.unregisterPopOut(cometHead);

        try {
          if (gpuCompute.dispose) gpuCompute.dispose();
          else [velVar, posVar].forEach(v => {
            if (v.renderTargets) v.renderTargets.forEach(rt => rt.dispose());
          });
        } catch (e) {
          console.warn('Error disposing gpuCompute:', e);
        }

        starGeo.dispose();
        starMat.dispose();
        planetGeo.dispose();
        planetMat.dispose();
        ringGeo.dispose();
        ringMat.dispose();
        riverGeo.dispose();
        riverMat.dispose();
        tailGeo.dispose();
        tailMat.dispose();
        moteGeo.dispose();
        moteMat.dispose();

        root.traverse((obj) => {
          if (obj.isMesh || obj.isPoints) {
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
