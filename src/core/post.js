import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const TIERS = ['Low', 'Medium', 'High'];

const TIER_CONFIG = {
  Low:    { maxPixelRatio: 1.0, bloom: false, bloomScale: 0.5, shadows: false },
  Medium: { maxPixelRatio: 1.5, bloom: true,  bloomScale: 0.5, shadows: false },
  High:   { maxPixelRatio: 2.0, bloom: true,  bloomScale: 1.0, shadows: true }
};

/**
 * Renderer + bloom post-processing with Low / Medium / High tiers and an
 * Auto mode that measures real frame times and moves between tiers with
 * hysteresis (it will not bounce back up into a tier that just failed).
 */
export class PostPipeline {
  constructor(renderer, scene, camera, initialTier = 'Medium') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    /** 'Auto' | 'Low' | 'Medium' | 'High' — what the user picked. */
    this.qualitySetting = initialTier;
    /** The tier currently in effect. */
    this.activeTier = initialTier === 'Auto' ? 'Medium' : initialTier;
    /** Called with the new tier whenever activeTier changes. */
    this.onTierChange = null;

    this._frameTimes = [];
    this._windowStart = performance.now();
    this._slowWindows = 0;
    this._fastWindows = 0;
    this._failedTiers = new Set();

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const size = renderer.getSize(new THREE.Vector2());
    this.renderPass = new RenderPass(scene, camera);
    // Strength / radius / threshold are tuned per scene via setPostConfig().
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 0.85);
    this.outputPass = new OutputPass();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this._applyTier(this.activeTier);
  }

  get config() {
    return TIER_CONFIG[this.activeTier];
  }

  /** Set the user's quality choice ('Auto' or a concrete tier). */
  applyQuality(setting) {
    this.qualitySetting = setting;
    this._failedTiers.clear();
    this._resetAutoWindow();
    const tier = setting === 'Auto' ? this.activeTier : setting;
    this._setTier(tier);
  }

  _setTier(tier) {
    if (!TIER_CONFIG[tier]) tier = 'Medium';
    const changed = tier !== this.activeTier;
    this.activeTier = tier;
    this._applyTier(tier);
    if (changed && this.onTierChange) this.onTierChange(tier);
  }

  _applyTier(tier) {
    const cfg = TIER_CONFIG[tier];
    const pr = Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    // The composer caches its own pixel ratio; keep it in sync or bloom renders
    // at the wrong resolution after a tier change.
    this.composer.setPixelRatio(pr);
    if (this.renderer.shadowMap.enabled !== cfg.shadows) {
      this.renderer.shadowMap.enabled = cfg.shadows;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // Materials must recompile to pick up the shadow map change.
      this.scene.traverse((o) => {
        if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; });
      });
    }
    this.resize(window.innerWidth, window.innerHeight);
  }

  /** Feed the duration of the last frame in ms. Drives Auto quality. */
  recordFrame(frameMs) {
    if (this.qualitySetting !== 'Auto') return;
    // Ignore hitches from tab switches, shader compiles, scene loads.
    if (frameMs > 250) return;
    this._frameTimes.push(frameMs);

    const now = performance.now();
    if (now - this._windowStart < 2000) return;

    const sorted = this._frameTimes.slice().sort((a, b) => a - b);
    // 75th percentile is robust to the odd GC pause but still catches stutter.
    const p75 = sorted[Math.floor(sorted.length * 0.75)] || 16.7;
    const fps = 1000 / p75;
    this._resetAutoWindow();

    const idx = TIERS.indexOf(this.activeTier);
    if (fps < 48) {
      this._fastWindows = 0;
      if (++this._slowWindows >= 2 && idx > 0) {
        console.info(`[Quality] ~${fps.toFixed(0)} fps on ${this.activeTier}; stepping down.`);
        this._failedTiers.add(this.activeTier);
        this._slowWindows = 0;
        this._setTier(TIERS[idx - 1]);
      }
    } else if (fps > 57) {
      this._slowWindows = 0;
      const up = TIERS[idx + 1];
      if (up && !this._failedTiers.has(up) && ++this._fastWindows >= 4) {
        console.info(`[Quality] ~${fps.toFixed(0)} fps on ${this.activeTier}; trying ${up}.`);
        this._fastWindows = 0;
        this._setTier(up);
      }
    } else {
      this._slowWindows = 0;
      this._fastWindows = 0;
    }
  }

  _resetAutoWindow() {
    this._frameTimes.length = 0;
    this._windowStart = performance.now();
  }

  setPostConfig(config = {}) {
    // Clamp so no scene can blow the image out to white.
    if (typeof config.bloomStrength === 'number') this.bloomPass.strength = Math.min(config.bloomStrength, 0.8);
    if (typeof config.bloomRadius === 'number') this.bloomPass.radius = config.bloomRadius;
    if (typeof config.bloomThreshold === 'number') this.bloomPass.threshold = Math.max(config.bloomThreshold, 0.6);
    if (typeof config.exposure === 'number') this.renderer.toneMappingExposure = config.exposure;
    else this.renderer.toneMappingExposure = 1.0;
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    const cfg = this.config;
    if (cfg.bloom && cfg.bloomScale !== 1) {
      const pr = this.renderer.getPixelRatio();
      this.bloomPass.setSize(Math.round(width * pr * cfg.bloomScale), Math.round(height * pr * cfg.bloomScale));
    }
  }

  render() {
    if (this.config.bloom && this.bloomPass.strength > 0.01) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.composer.dispose();
    this.bloomPass.dispose();
    this.outputPass.dispose();
  }
}
