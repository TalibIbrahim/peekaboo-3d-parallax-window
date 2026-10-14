import * as THREE from 'three';
import { OneEuroFilter } from './filters.js';
import { updateOffAxisCamera } from './projection.js';
import { Stage } from './core/stage.js';
import { PostPipeline } from './core/post.js';
import { AssetManager } from './core/assets.js';
import { SceneManager } from './scenes/index.js';
import { HeadTracker } from './tracker.js';
import { UIController } from './ui.js';

class WindowApp {
  constructor() {
    this.container = document.getElementById('canvas-container');

    // Physical screen dimensions in cm
    this.screenW = 34.5;
    this.screenH = 19.4;
    this.screenDiagonalInches = 15.6;

    // Filters for head coordinates (x, y, z)
    this.filterX = new OneEuroFilter(1.0, 0.02, 1.0);
    this.filterY = new OneEuroFilter(1.0, 0.02, 1.0);
    this.filterZ = new OneEuroFilter(0.5, 0.01, 1.0);

    // Filtered and smoothed eye coordinates (in cm)
    this.targetEye = { x: 0, y: 0, z: 55 };
    this.currentEye = { x: 0, y: 0, z: 55 };

    // Timing & performance
    this.renderFps = 60;
    this.renderFrameCount = 0;
    this.lastFpsCalcTime = performance.now();
    this.clock = new THREE.Clock();

    // Bootstrap core
    this._initThree();
    this._initCore();
    this._initUI();
    this._initResize();
    this._startRenderLoop();
    window.__app = this;
    window.THREE = THREE;
  }

  _computeScreenDimensions() {
    const aspect = Math.max(window.innerWidth / Math.max(window.innerHeight, 1), 0.1);
    const diagonalCm = this.screenDiagonalInches * 2.54;
    this.screenH = diagonalCm / Math.sqrt(1.0 + aspect * aspect);
    this.screenW = this.screenH * aspect;
  }

  _initThree() {
    this._computeScreenDimensions();

    this.mainScene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.container.appendChild(this.renderer.domElement);

    // Camera: Near = 1 cm, Far = 2000 cm
    // CRITICAL: Prevent Three.js or add-ons from resetting the asymmetric frustum
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
    this.camera.updateProjectionMatrix = () => {};
  }

  _initCore() {
    // Stage helper
    this.stage = new Stage(this.screenW, this.screenH, window.innerHeight);

    // Asset Manager with caching and DRACO/Meshopt support
    this.assets = new AssetManager();

    // Post Pipeline with EffectComposer, UnrealBloomPass, and Quality Tiers
    this.postPipeline = new PostPipeline(this.renderer, this.mainScene, this.camera, 'Medium');
  }

  _initUI() {
    this.tracker = new HeadTracker();

    this.ui = new UIController({
      onStartCamera: async () => {
        try {
          await this.tracker.start();
          this.ui.hideStartScreen();
          this.ui.clearError();
          await this.sceneManager.loadInitialScene('abyss');
        } catch (err) {
          console.error('Camera initialization failed:', err);
          this.ui.showError(err.message || 'Failed to start camera.');
        }
      },
      onStartMouse: async () => {
        await this.sceneManager.loadInitialScene('abyss');
      },
      onRecenter: () => {
        return this.tracker.recenter();
      },
      onSceneSelect: (sceneId) => {
        this.sceneManager.switchScene(sceneId);
      },
      onQualitySelect: (tier) => {
        this.postPipeline.applyQuality(tier);
      },
      onGalleryToggle: (enabled) => {
        this.sceneManager.setGalleryMode(enabled);
      },
      onEdgeCheckToggle: (enabled) => {
        this.stage.edgeCheckEnabled = enabled;
      },
      onSettingsChange: (settings) => {
        if (settings.screenDiagonalInches !== this.screenDiagonalInches) {
          this.screenDiagonalInches = settings.screenDiagonalInches;
          this._computeScreenDimensions();
          this.stage.updateDimensions(this.screenW, this.screenH, window.innerHeight);
          this.sceneManager.onResize(this.stage);
        }

        this.filterX.setParameters(settings.minCutoff, settings.beta);
        this.filterY.setParameters(settings.minCutoff, settings.beta);
        this.filterZ.setParameters(settings.minCutoff * 0.5, settings.beta * 0.5);

        this.tracker.hfovDeg = settings.hfovDeg;
        this.tracker.ipdCm = settings.ipdCm;
        this.tracker.webcamOffsetY = settings.webcamOffsetY;
      }
    });

    // Scene Manager
    this.sceneManager = new SceneManager({
      ctx: {
        THREE,
        renderer: this.renderer,
        camera: this.camera,
        mainScene: this.mainScene,
        stage: this.stage,
        assets: this.assets,
        quality: this.postPipeline.activeTier,
        postPipeline: this.postPipeline
      },
      onSceneChanged: (sceneDef, idx) => {
        this.ui.updateSceneUI(sceneDef);
      },
      onLoadingProgress: (sceneName, pct) => {
        this.ui.showLoadingProgress(sceneName, pct);
      },
      onError: (msg) => {
        this.ui.showError(msg);
      }
    });

    // Apply initial settings
    const initialSettings = this.ui.settings;
    this.screenDiagonalInches = initialSettings.screenDiagonalInches;
    this._computeScreenDimensions();
    this.stage.updateDimensions(this.screenW, this.screenH, window.innerHeight);

    this.postPipeline.applyQuality(initialSettings.qualityTier);
    this.stage.edgeCheckEnabled = initialSettings.edgeCheck;

    this.filterX.setParameters(initialSettings.minCutoff, initialSettings.beta);
    this.filterY.setParameters(initialSettings.minCutoff, initialSettings.beta);
    this.filterZ.setParameters(initialSettings.minCutoff * 0.5, initialSettings.beta * 0.5);

    this.tracker.hfovDeg = initialSettings.hfovDeg;
    this.tracker.ipdCm = initialSettings.ipdCm;
    this.tracker.webcamOffsetY = initialSettings.webcamOffsetY;
  }

  _initResize() {
    window.addEventListener('resize', () => {
      this._computeScreenDimensions();
      this.stage.updateDimensions(this.screenW, this.screenH, window.innerHeight);
      this.postPipeline.resize(window.innerWidth, window.innerHeight);
      this.sceneManager.onResize(this.stage);
    });
  }

  _startRenderLoop() {
    const loop = () => {
      requestAnimationFrame(loop);
      this._renderFrame();
    };
    requestAnimationFrame(loop);
  }

  _renderFrame() {
    const now = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();
    this.renderFrameCount++;

    if (now - this.lastFpsCalcTime >= 500) {
      this.renderFps = Math.round((this.renderFrameCount * 1000) / (now - this.lastFpsCalcTime));
      this.renderFrameCount = 0;
      this.lastFpsCalcTime = now;
      this.postPipeline.trackFPS(this.renderFps);
    }

    const settings = this.ui.settings;
    let rawEye = { x: 0, y: 0, z: 55 };
    let trackerOutput = null;

    if (this.ui.isMouseFallbackActive) {
      rawEye = this.ui.getMouseEye(this.stage.W, this.stage.H);
    } else {
      trackerOutput = this.tracker.update(this.stage.W, this.stage.H);
      rawEye = trackerOutput.position;
    }

    // 1. One Euro Filter pass per axis
    const filteredX = this.filterX.filter(rawEye.x, now);
    const filteredY = this.filterY.filter(rawEye.y, now);
    const filteredZ = this.filterZ.filter(rawEye.z, now);

    // 2. Parallax strength multiplier
    const multX = filteredX * (settings.parallaxMultiplier ?? 1.0);
    const multY = filteredY * (settings.parallaxMultiplier ?? 1.0);
    const multZ = filteredZ;

    // 3. Sub-frame lerp factor 0.35 to bridge 30 fps webcam and 60+ fps display
    const lerpFactor = 0.35;
    this.currentEye.x += (multX - this.currentEye.x) * lerpFactor;
    this.currentEye.y += (multY - this.currentEye.y) * lerpFactor;
    this.currentEye.z += (multZ - this.currentEye.z) * lerpFactor;

    // 4. Update asymmetric frustum off-axis projection
    updateOffAxisCamera(this.camera, this.currentEye, this.stage.W, this.stage.H, 1, 2000);

    // 5. Update active living scene
    this.sceneManager.update(dt, elapsed, this.currentEye);

    // 6. Optional edge-check validation (tints violating pop-out objects red)
    if (this.stage.edgeCheckEnabled) {
      this.stage.runEdgeCheck(this.camera);
    }

    // 7. Render with post-processing pipeline
    this.postPipeline.render(this.mainScene, this.camera);

    // 8. Update debug HUD
    this.ui.updateDebug({
      video: trackerOutput ? trackerOutput.video : null,
      irisPoints: trackerOutput ? trackerOutput.irisPoints : null,
      trackerFps: trackerOutput ? trackerOutput.trackerFps : 0,
      renderFps: this.renderFps,
      eye: this.currentEye,
      faceFound: trackerOutput ? trackerOutput.faceFound : false,
      activeTier: this.postPipeline.activeTier
    });
  }
}

// Bootstrap
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.__app = new WindowApp();
  });
} else {
  window.__app = new WindowApp();
}
