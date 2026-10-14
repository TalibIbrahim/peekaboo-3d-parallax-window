import * as THREE from 'three';
import calibrationScene from './calibration.js';
import abyssScene from './abyss.js';
import tinyworldScene from './tinyworld.js';
import starfallScene from './starfall.js';

export const SCENE_DEFINITIONS = [
  calibrationScene, // index 0 (key 0)
  abyssScene,       // index 1 (key 1)
  tinyworldScene,   // index 2 (key 2)
  starfallScene     // index 3 (key 3)
];

export class SceneManager {
  constructor(options) {
    this.ctx = options.ctx; // { THREE, renderer, camera, stage, assets, quality, input, postPipeline }
    this.onSceneChanged = options.onSceneChanged || null;
    this.onLoadingProgress = options.onLoadingProgress || null;
    this.onError = options.onError || null;

    this.currentIndex = 0; // Default to Calibration
    this.activeInstance = null;
    this.isTransitioning = false;

    // Gallery mode auto-cycling
    this.galleryMode = false;
    this.galleryPaused = false;
    this.galleryInterval = 45000; // 45 seconds
    this.galleryTimer = null;

    // Transition overlay for fade-to-black
    this.fadeOverlay = document.getElementById('scene-transition-overlay');

    this._bindKeyboard();
  }

  get currentSceneDef() {
    return SCENE_DEFINITIONS[this.currentIndex];
  }

  async loadInitialScene(initialId = 'calibration') {
    const idx = SCENE_DEFINITIONS.findIndex(s => s.id === initialId);
    this.currentIndex = idx >= 0 ? idx : 0;
    await this._switchToScene(this.currentIndex, false);
  }

  async switchScene(indexOrId) {
    let targetIdx = -1;
    if (typeof indexOrId === 'number') {
      targetIdx = (indexOrId + SCENE_DEFINITIONS.length) % SCENE_DEFINITIONS.length;
    } else {
      targetIdx = SCENE_DEFINITIONS.findIndex(s => s.id === indexOrId);
    }
    if (targetIdx === -1 || targetIdx === this.currentIndex || this.isTransitioning) return;
    await this._switchToScene(targetIdx, true);
  }

  nextScene() {
    this.switchScene(this.currentIndex + 1);
  }

  prevScene() {
    this.switchScene(this.currentIndex - 1);
  }

  setGalleryMode(enabled) {
    this.galleryMode = enabled;
    this._resetGalleryTimer();
  }

  toggleGalleryPause() {
    this.galleryPaused = !this.galleryPaused;
    console.log(`[Gallery Mode] ${this.galleryPaused ? 'Paused' : 'Resumed'}`);
    this._resetGalleryTimer();
    return this.galleryPaused;
  }

  _resetGalleryTimer() {
    if (this.galleryTimer) {
      clearInterval(this.galleryTimer);
      this.galleryTimer = null;
    }
    if (this.galleryMode && !this.galleryPaused) {
      this.galleryTimer = setInterval(() => {
        this.nextScene();
      }, this.galleryInterval);
    }
  }

  async _switchToScene(targetIndex, withTransition = true) {
    this.isTransitioning = true;
    const def = SCENE_DEFINITIONS[targetIndex];

    try {
      // 1. Fade out to black over 350 ms
      if (withTransition && this.fadeOverlay) {
        this.fadeOverlay.style.opacity = '1';
        await new Promise(r => setTimeout(r, 350));
      }

      // 2. Dispose existing scene
      if (this.activeInstance) {
        if (this.ctx.stage) {
          this.ctx.stage.clearPopOuts();
        }
        if (this.activeInstance.root && this.activeInstance.root.parent) {
          this.activeInstance.root.parent.remove(this.activeInstance.root);
        }
        try {
          this.activeInstance.dispose();
        } catch (dispErr) {
          console.warn('Error during scene disposal:', dispErr);
        }
        this.activeInstance = null;
      }

      // 3. Instantiate target scene lazily
      if (this.onLoadingProgress) this.onLoadingProgress(def.name, 10);

      this.activeInstance = await def.create({
        ...this.ctx,
        onProgress: (url, pct) => {
          if (this.onLoadingProgress) this.onLoadingProgress(def.name, pct);
        }
      });

      this.currentIndex = targetIndex;

      // 4. Attach root, background, fog, and post-processing
      if (this.activeInstance.root) {
        this.ctx.mainScene.add(this.activeInstance.root);
      }
      this.ctx.mainScene.background = this.activeInstance.background || new THREE.Color(0x050716);
      this.ctx.mainScene.fog = this.activeInstance.fog || null;

      if (this.ctx.postPipeline && this.activeInstance.post) {
        this.ctx.postPipeline.setPostConfig(this.activeInstance.post);
      }

      if (this.onSceneChanged) {
        this.onSceneChanged(def, targetIndex);
      }

      this._resetGalleryTimer();
    } catch (err) {
      console.error(`Failed to load scene "${def.name}":`, err);
      if (this.onError) {
        this.onError(`Failed to load ${def.name}: ${err.message}. Falling back to Calibration.`);
      }
      // Safe fallback to Calibration scene if not already on it
      if (targetIndex !== 0) {
        await this._switchToScene(0, false);
      }
    } finally {
      // 5. Fade in from black over 350 ms
      if (withTransition && this.fadeOverlay) {
        this.fadeOverlay.style.opacity = '0';
        await new Promise(r => setTimeout(r, 350));
      }
      if (this.onLoadingProgress) this.onLoadingProgress(null, 100);
      this.isTransitioning = false;
    }
  }

  update(dt, t, eye) {
    if (this.activeInstance && this.activeInstance.update) {
      this.activeInstance.update(dt, t, eye, this.ctx.stage);
    }
  }

  onResize(stage) {
    if (this.activeInstance && this.activeInstance.onResize) {
      this.activeInstance.onResize(stage);
    }
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === '0') this.switchScene(0);
      else if (e.key === '1') this.switchScene(1);
      else if (e.key === '2') this.switchScene(2);
      else if (e.key === '3') this.switchScene(3);
      else if (e.key === 'ArrowRight') this.nextScene();
      else if (e.key === 'ArrowLeft') this.prevScene();
      else if (e.key === 'p' || e.key === 'P') {
        const isPaused = this.toggleGalleryPause();
        // Notify UI toast if available
        const statusEl = document.getElementById('gallery-status-toast');
        if (statusEl) {
          statusEl.textContent = isPaused ? 'Gallery Paused' : 'Gallery Playing';
          statusEl.style.opacity = '1';
          setTimeout(() => { statusEl.style.opacity = '0'; }, 1500);
        }
      }
    });
  }

  dispose() {
    if (this.galleryTimer) clearInterval(this.galleryTimer);
    if (this.activeInstance) {
      this.activeInstance.dispose();
      this.activeInstance = null;
    }
  }
}
