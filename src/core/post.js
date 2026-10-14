import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class PostPipeline {
  constructor(renderer, scene, camera, initialTier = 'Medium') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.qualitySetting = initialTier;
    this.activeTier = initialTier === 'Auto' ? 'Medium' : initialTier;

    // Performance tracking for Auto tier
    this.fpsHistory = [];
    this.autoCheckFrames = 120;

    // ACES Filmic tone mapping for smooth, cinematic highlight rolloff (no blown-out white)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Composer setup
    const size = new THREE.Vector2();
    renderer.getSize(size);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.renderPass.clearColor = null;

    // Cinematic bloom: higher threshold (0.85) so only intense lights bloom,
    // avoiding the blinding white blowout
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.round(size.x * 0.5), Math.round(size.y * 0.5)),
      0.38, // strength
      0.45, // radius
      0.85  // threshold
    );

    this.outputPass = new OutputPass();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this.applyQuality(this.qualitySetting);
  }

  applyQuality(tier) {
    this.qualitySetting = tier;
    if (tier !== 'Auto') {
      this.activeTier = tier;
    }

    const devicePR = window.devicePixelRatio || 1;

    switch (this.activeTier) {
      case 'Low':
        this.renderer.setPixelRatio(1.0);
        this.renderer.shadowMap.enabled = false;
        this.bloomEnabled = false;
        break;

      case 'Medium':
        this.renderer.setPixelRatio(Math.min(devicePR, 1.5));
        this.renderer.shadowMap.enabled = false;
        this.bloomEnabled = true;
        this.bloomPass.resolution.set(
          Math.round(window.innerWidth * 0.5),
          Math.round(window.innerHeight * 0.5)
        );
        break;

      case 'High':
      default:
        this.renderer.setPixelRatio(Math.min(devicePR, 2.0));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.bloomEnabled = true;
        this.bloomPass.resolution.set(
          window.innerWidth,
          window.innerHeight
        );
        break;
    }

    this.resize(window.innerWidth, window.innerHeight);
  }

  trackFPS(currentFps) {
    if (this.qualitySetting !== 'Auto') return;

    this.fpsHistory.push(currentFps);
    if (this.fpsHistory.length >= this.autoCheckFrames) {
      const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
      this.fpsHistory = [];

      if (avgFps < 48.0) {
        if (this.activeTier === 'High') {
          console.log(`[Auto Quality] Average FPS was ${avgFps.toFixed(1)} < 48. Dropping tier: High -> Medium.`);
          this.activeTier = 'Medium';
          this.applyQuality('Auto');
        } else if (this.activeTier === 'Medium') {
          console.log(`[Auto Quality] Average FPS was ${avgFps.toFixed(1)} < 48. Dropping tier: Medium -> Low.`);
          this.activeTier = 'Low';
          this.applyQuality('Auto');
        }
      }
    }
  }

  setPostConfig(config) {
    if (!config) return;
    // Enforce reasonable bloom clamps to prevent blinding whiteout
    if (typeof config.bloomStrength === 'number') {
      this.bloomPass.strength = Math.min(config.bloomStrength, 0.6);
    }
    if (typeof config.bloomRadius === 'number') {
      this.bloomPass.radius = config.bloomRadius;
    }
    if (typeof config.bloomThreshold === 'number') {
      this.bloomPass.threshold = Math.max(config.bloomThreshold, 0.75);
    }
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    if (this.bloomEnabled) {
      const scale = this.activeTier === 'High' ? 1.0 : 0.5;
      this.bloomPass.resolution.set(Math.round(width * scale), Math.round(height * scale));
    }
  }

  render(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;

    if (this.bloomEnabled && this.bloomPass.strength > 0.01) {
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }

  dispose() {
    this.renderPass.dispose();
    this.bloomPass.dispose();
    this.outputPass.dispose();
  }
}
