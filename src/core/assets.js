import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export class AssetManager {
  constructor() {
    this.cache = new Map();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  /**
   * Loads a GLTF/GLB model from URL with caching and progress reporting.
   * If loading fails, returns a procedural fallback model and logs a warning.
   */
  async loadGLTF(url, onProgress = null) {
    if (this.cache.has(url)) {
      const cached = this.cache.get(url);
      // Return a cloned scene graph with animations
      return {
        scene: cached.scene.clone(true),
        animations: cached.animations,
        isFallback: cached.isFallback
      };
    }

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          url,
          (loaded) => resolve(loaded),
          (xhr) => {
            if (onProgress && xhr.total > 0) {
              onProgress(url, Math.min(100, Math.round((xhr.loaded / xhr.total) * 100)));
            }
          },
          (err) => reject(err)
        );
      });

      this.cache.set(url, {
        scene: gltf.scene,
        animations: gltf.animations || [],
        isFallback: false
      });

      return {
        scene: gltf.scene.clone(true),
        animations: gltf.animations || [],
        isFallback: false
      };
    } catch (err) {
      console.warn(`[AssetManager] Failed to load "${url}". Using procedural fallback. Error:`, err.message);

      // Create procedural fallback based on requested asset
      const isRobot = url.toLowerCase().includes('robot');
      const fallback = isRobot ? this._createProceduralRobot() : this._createProceduralIsland();

      this.cache.set(url, {
        scene: fallback.scene,
        animations: fallback.animations || [],
        isFallback: true,
        missingUrl: url
      });

      return {
        scene: fallback.scene.clone(true),
        animations: fallback.animations || [],
        isFallback: true,
        missingUrl: url
      };
    }
  }

  /**
   * Procedural low-poly diorama placeholder if LittlestTokyo.glb is missing.
   */
  _createProceduralIsland() {
    const group = new THREE.Group();
    group.name = 'ProceduralTokyoFallback';

    // Island base: inverted cone
    const rockGeo = new THREE.ConeGeometry(12, 10, 8);
    rockGeo.rotateX(Math.PI);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3d354a, roughness: 0.8 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.y = -5;
    group.add(rock);

    // Green grass top
    const grassGeo = new THREE.CylinderGeometry(12, 12, 1.5, 8);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x448833, roughness: 0.6 });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.y = 0.5;
    group.add(grass);

    // Stylized low-poly buildings with glowing windows
    const colors = [0xff5533, 0x3388ff, 0xffcc00, 0xaa44ff];
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const dist = 3.5 + (i % 2) * 3.0;
      const h = 4 + (i * 2.2);
      const bGeo = new THREE.BoxGeometry(3, h, 3);
      const bMat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        roughness: 0.4
      });
      const b = new THREE.Mesh(bGeo, bMat);
      b.position.set(Math.cos(angle) * dist, h * 0.5 + 1.25, Math.sin(angle) * dist);
      group.add(b);

      // Window glowing light
      const winGeo = new THREE.PlaneGeometry(1.2, 1.2);
      const winMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(b.position.x, b.position.y, b.position.z + 1.55);
      group.add(win);
    }

    return { scene: group, animations: [] };
  }

  /**
   * Procedural animated capsule robot placeholder if RobotExpressive.glb is missing.
   */
  _createProceduralRobot() {
    const group = new THREE.Group();
    group.name = 'ProceduralRobotFallback';

    // Body capsule
    const bodyGeo = new THREE.CapsuleGeometry(1.4, 2.8, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      metalness: 0.8,
      roughness: 0.2
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 3.5;
    group.add(body);

    // Head with "eye" visor
    const headGroup = new THREE.Group();
    headGroup.name = 'Head'; // Matched by /head/i
    headGroup.position.y = 6.0;

    const headGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const head = new THREE.Mesh(headGeo, bodyMat);
    headGroup.add(head);

    // Cyan glowing visor
    const visorGeo = new THREE.BoxGeometry(1.8, 0.6, 0.8);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.5
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.2, 1.2);
    headGroup.add(visor);

    group.add(headGroup);

    return { scene: group, animations: [] };
  }
}
