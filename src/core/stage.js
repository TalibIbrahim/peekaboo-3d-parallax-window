import * as THREE from 'three';
import { edgeFadeVertexGLSL } from '../shaders/edgeFade.js';

export class Stage {
  constructor(screenW = 34.5, screenH = 19.4, drawingBufferHeight = 1080) {
    this.backZ = -70.0;
    this.frontZ = 14.0;
    this.edgeFadeGLSL = edgeFadeVertexGLSL;
    this.registeredPopOuts = new Set();
    this.edgeCheckEnabled = false;

    this.updateDimensions(screenW, screenH, drawingBufferHeight);
  }

  updateDimensions(screenW, screenH, drawingBufferHeight = 1080) {
    this.W = screenW;
    this.H = screenH;
    this.drawingBufferHeight = drawingBufferHeight;
    this.pxPerCm = drawingBufferHeight / Math.max(screenH, 0.001);

    // Safe pop-out boundaries: |x| <= 0.6 * W/2, |y| <= 0.55 * H/2, z <= 14
    this.safeMaxX = 0.6 * (this.W * 0.5);
    this.safeMaxY = 0.55 * (this.H * 0.5);
    this.safeMaxZ = 14.0;
  }

  /**
   * Checks whether coordinates (x, y, z) sit strictly inside the pop-out safe box.
   * Objects in FRONT of the screen (z > 0) must never exceed these limits.
   */
  popOutSafe(x, y, z) {
    if (z <= 0) return true; // Behind screen: allowed to exit screen borders freely
    if (z > this.safeMaxZ) return false;
    return Math.abs(x) <= this.safeMaxX && Math.abs(y) <= this.safeMaxY;
  }

  /**
   * Returns clamped coordinates inside the safe box for pop-out objects.
   */
  clampSafe(x, y, z) {
    const safeZ = Math.min(Math.max(z, 0.0), this.safeMaxZ);
    const safeX = Math.max(-this.safeMaxX, Math.min(this.safeMaxX, x));
    const safeY = Math.max(-this.safeMaxY, Math.min(this.safeMaxY, y));
    return { x: safeX, y: safeY, z: safeZ };
  }

  /**
   * Register a pop-out 3D object for edge-checking validation.
   */
  registerPopOut(mesh) {
    if (mesh) {
      this.registeredPopOuts.add(mesh);
    }
  }

  unregisterPopOut(mesh) {
    this.registeredPopOuts.delete(mesh);
  }

  clearPopOuts() {
    this.registeredPopOuts.clear();
  }

  /**
   * Performs the edge check on all registered pop-out objects across
   * eye extremes (eye.x in [-15, +15], eye.y in [-8, +8], eye.z in [35, 70]).
   * If any corner of an object's bounding box projects outside [-1, 1] NDC,
   * tints the object red.
   */
  runEdgeCheck(camera) {
    if (!this.edgeCheckEnabled) return;

    const eyeExtremes = [
      { x: -15, y: -8, z: 35 },
      { x:  15, y: -8, z: 35 },
      { x: -15, y:  8, z: 35 },
      { x:  15, y:  8, z: 35 },
      { x: -15, y: -8, z: 70 },
      { x:  15, y: -8, z: 70 },
      { x: -15, y:  8, z: 70 },
      { x:  15, y:  8, z: 70 }
    ];

    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    const proj = new THREE.Vector3();

    for (const mesh of this.registeredPopOuts) {
      if (!mesh.visible) continue;
      mesh.updateWorldMatrix(true, false);
      box.setFromObject(mesh);

      // Only check if geometry enters z > 0
      if (box.max.z <= 0) continue;

      let violates = false;

      // Test all 8 bounding corners against all eye extremes
      for (const eye of eyeExtremes) {
        // Compute off-axis projection for this extreme
        const near = 1.0;
        const eyeZ = eye.z;
        const left   = (-this.W * 0.5 - eye.x) * near / eyeZ;
        const right  = ( this.W * 0.5 - eye.x) * near / eyeZ;
        const bottom = (-this.H * 0.5 - eye.y) * near / eyeZ;
        const top    = ( this.H * 0.5 - eye.y) * near / eyeZ;

        const projMat = new THREE.Matrix4().makePerspective(left, right, top, bottom, near, 2000);
        const viewMat = new THREE.Matrix4().makeTranslation(-eye.x, -eye.y, -eyeZ);
        const viewProj = new THREE.Matrix4().multiplyMatrices(projMat, viewMat);

        for (let cz = 0; cz <= 1; cz++) {
          for (let cy = 0; cy <= 1; cy++) {
            for (let cx = 0; cx <= 1; cx++) {
              corner.set(
                cx === 0 ? box.min.x : box.max.x,
                cy === 0 ? box.min.y : box.max.y,
                cz === 0 ? box.min.z : box.max.z
              );

              // Only test corners with positive Z (in front of screen)
              if (corner.z > 0.0) {
                proj.copy(corner).applyMatrix4(viewProj);
                if (Math.abs(proj.x) > 1.0 || Math.abs(proj.y) > 1.0) {
                  violates = true;
                  break;
                }
              }
            }
            if (violates) break;
          }
          if (violates) break;
        }
        if (violates) break;
      }

      // Tint object red if violating
      if (violates) {
        if (!mesh.userData._origEmissive && mesh.material && mesh.material.emissive) {
          mesh.userData._origEmissive = mesh.material.emissive.getHex();
        }
        if (mesh.material && mesh.material.emissive) {
          mesh.material.emissive.setHex(0xff0000);
        }
      } else {
        if (mesh.userData._origEmissive !== undefined && mesh.material && mesh.material.emissive) {
          mesh.material.emissive.setHex(mesh.userData._origEmissive);
        }
      }
    }
  }
}
