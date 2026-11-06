import * as THREE from 'three';
import calibrationScene from './calibration.js';
import abyssScene from './abyss.js';
import tinyworldScene from './tinyworld.js';
import starfallScene from './starfall.js';

export const SCENE_DEFINITIONS = [
  calibrationScene, // key 0
  abyssScene,       // key 1
  tinyworldScene,   // key 2
  starfallScene     // key 3
];

const FADE_MS = 350;

/**
 * Owns the active scene: creation, disposal, fade transitions, gallery mode.
 *
 * A scene definition is `{ id, name, tagline, create(ctx) }` where create()
 * resolves to `{ root, background?, fog?, environment?, post?, update(dt, t, eye, stage, presence), onResize?(stage), dispose() }`.
 */
export class SceneManager {
  constructor(options) {
    this.ctx = options.ctx;
    this.getQuality = options.getQuality || (() => 'Medium');
    this.onSceneChanged = options.onSceneChanged || null;
    this.onLoadingProgress = options.onLoadingProgress || null;
    this.onError = options.onError || null;

    this.currentIndex = -1;
    this.activeInstance = null;
    this.isTransitioning = false;
    this._pending = null;

    this.galleryMode = false;
    this.galleryInterval = 45000;
    this._galleryTimer = null;

    this.fadeOverlay = document.getElementById('scene-transition-overlay');
  }

  get currentSceneDef() {
    return SCENE_DEFINITIONS[this.currentIndex];
  }

  indexOf(id) {
    return SCENE_DEFINITIONS.findIndex((s) => s.id === id);
  }

  async loadInitialScene(initialId = 'abyss') {
    const idx = this.indexOf(initialId);
    await this._switchToScene(idx >= 0 ? idx : 1, false);
  }

  /** Switch by index (wraps) or id. Requests made mid-transition are queued, not dropped. */
  switchScene(indexOrId) {
    let target;
    if (typeof indexOrId === 'number') {
      target = ((indexOrId % SCENE_DEFINITIONS.length) + SCENE_DEFINITIONS.length) % SCENE_DEFINITIONS.length;
    } else {
      target = this.indexOf(indexOrId);
    }
    if (target < 0) return Promise.resolve();
    if (this.isTransitioning) {
      this._pending = target;
      return Promise.resolve();
    }
    if (target === this.currentIndex) return Promise.resolve();
    return this._switchToScene(target, true);
  }

  nextScene() {
    return this.switchScene((this._pending ?? this.currentIndex) + 1);
  }

  prevScene() {
    return this.switchScene((this._pending ?? this.currentIndex) - 1);
  }

  /** Rebuild the current scene, e.g. after a quality-tier change alters particle counts. */
  reload() {
    if (this.currentIndex < 0) return Promise.resolve();
    if (this.isTransitioning) {
      this._pending = this._pending ?? this.currentIndex;
      this._forceReload = true;
      return Promise.resolve();
    }
    return this._switchToScene(this.currentIndex, true);
  }

  setGalleryMode(enabled) {
    this.galleryMode = enabled;
    this._resetGalleryTimer();
  }

  _resetGalleryTimer() {
    clearTimeout(this._galleryTimer);
    this._galleryTimer = null;
    if (this.galleryMode) {
      this._galleryTimer = setTimeout(() => this.nextScene(), this.galleryInterval);
    }
  }

  async _fade(opacity) {
    if (!this.fadeOverlay) return;
    this.fadeOverlay.style.opacity = String(opacity);
    await new Promise((r) => setTimeout(r, FADE_MS));
  }

  _disposeActive() {
    if (!this.activeInstance) return;
    this.ctx.stage?.clearPopOuts();
    this.activeInstance.root?.removeFromParent();
    try {
      this.activeInstance.dispose?.();
    } catch (err) {
      console.warn('Error during scene disposal:', err);
    }
    this.activeInstance = null;
  }

  async _switchToScene(targetIndex, withTransition = true) {
    this.isTransitioning = true;
    const def = SCENE_DEFINITIONS[targetIndex];

    try {
      if (withTransition) await this._fade(1);
      this._disposeActive();

      this.onLoadingProgress?.(def.name, 5);
      const instance = await def.create({
        ...this.ctx,
        quality: this.getQuality(),
        onProgress: (_url, pct) => this.onLoadingProgress?.(def.name, pct)
      });

      this.activeInstance = instance;
      this.currentIndex = targetIndex;

      if (instance.root) this.ctx.mainScene.add(instance.root);
      this.ctx.mainScene.background = instance.background || new THREE.Color(0x050716);
      this.ctx.mainScene.fog = instance.fog || null;
      this.ctx.mainScene.environment = instance.environment || null;
      this.ctx.postPipeline?.setPostConfig(instance.post || {});

      // Compile shaders now, behind the black overlay, so the first visible frame doesn't hitch.
      try {
        this.ctx.renderer.compile(this.ctx.mainScene, this.ctx.camera);
      } catch { /* compile is an optimisation only */ }

      this.onSceneChanged?.(def, targetIndex);
      this._resetGalleryTimer();
    } catch (err) {
      console.error(`Failed to load scene "${def.name}":`, err);
      this.onError?.(`Couldn't load ${def.name}: ${err.message}`);
      if (targetIndex !== 0) {
        this._disposeActive();
        this.isTransitioning = false;
        await this._switchToScene(0, false);
        return;
      }
    } finally {
      if (this.isTransitioning) {
        this.onLoadingProgress?.(null, 100);
        if (withTransition || this.fadeOverlay?.style.opacity === '1') await this._fade(0);
        this.isTransitioning = false;
      }
    }

    // Run whatever was requested while we were busy.
    if (this._pending !== null) {
      const next = this._pending;
      const force = this._forceReload;
      this._pending = null;
      this._forceReload = false;
      if (next !== this.currentIndex || force) await this._switchToScene(next, true);
    }
  }

  update(dt, t, eye, presence) {
    this.activeInstance?.update?.(dt, t, eye, this.ctx.stage, presence);
  }

  onResize(stage) {
    this.activeInstance?.onResize?.(stage);
  }

  dispose() {
    clearTimeout(this._galleryTimer);
    this._disposeActive();
  }
}
