import * as THREE from 'three';
import { HeadPoseFilter } from './filters.js';
import { updateOffAxisCamera } from './projection.js';
import { DisplayGeometry } from './core/display.js';
import { Stage } from './core/stage.js';
import { PostPipeline } from './core/post.js';
import { AssetManager } from './core/assets.js';
import { SceneManager, SCENE_DEFINITIONS } from './scenes/index.js';
import { HeadTracker } from './tracker.js';
import { UIController } from './ui.js';

const REST_EYE = { x: 0, y: 0, z: 60 };
const FACE_LOST_GRACE_MS = 600;   // hold still this long before drifting to rest
const REST_TAU = 1.2;             // s, drift-to-rest time constant
const REACQUIRE_TAU = 0.18;       // s, blend back in when the face reappears
const REACQUIRE_MS = 600;
const MOUSE_TAU = 0.07;           // s, mouse mode is otherwise twitchy

class PeekabooApp {
  constructor() {
    this.params = new URLSearchParams(location.search);

    this.ui = new UIController(this._uiCallbacks());
    const s = this.ui.settings;

    this.display = new DisplayGeometry(s.screenDiagonalInches);
    this.display.trackWindowPosition = s.trackWindowPosition;

    this._initRenderer();

    this.stage = new Stage(this.display.W, this.display.H, this._bufferHeight());
    this.stage.edgeCheckEnabled = s.edgeCheck;

    this.post = new PostPipeline(this.renderer, this.scene, this.camera, s.qualityTier);
    this.post.onTierChange = (tier) => {
      this.ui.toast(`Quality: ${tier}`);
      this._onGeometryChange();
      this.scenes.reload();
    };

    this.assets = new AssetManager();
    this.tracker = new HeadTracker({ hfovDeg: s.hfovDeg, ipdCm: s.ipdCm });
    this.headFilter = new HeadPoseFilter({ minCutoff: s.minCutoff, beta: s.beta });
    this.headFilter.predictionGain = s.latencyCompensation ? 1 : 0;

    this.scenes = new SceneManager({
      ctx: {
        THREE,
        renderer: this.renderer,
        camera: this.camera,
        mainScene: this.scene,
        stage: this.stage,
        assets: this.assets,
        postPipeline: this.post,
        settings: s
      },
      getQuality: () => this.post.activeTier,
      onSceneChanged: (def) => {
        this.ui.updateSceneUI(def);
        const url = new URL(location.href);
        url.searchParams.set('scene', def.id);
        history.replaceState(null, '', url);
      },
      onLoadingProgress: (name, pct) => this.ui.showLoadingProgress(name, pct),
      onError: (msg) => this.ui.showError(msg)
    });
    this.scenes.setGalleryMode(s.galleryMode);

    // Eye state, in cm relative to the viewport centre.
    this.eye = { ...REST_EYE };
    this._target = { ...REST_EYE };
    this._lastSeq = -1;
    this._lastFaceSeen = -Infinity;
    this._reacquiredAt = -Infinity;
    this.presence = { mode: 'none', tracked: false, since: 0 };

    this.mode = null;
    this._started = false;
    this.clock = new THREE.Clock();
    this._fps = { frames: 0, start: performance.now(), value: 0 };

    this.display.onChange(() => this._onGeometryChange());
    this._onGeometryChange();
    window.addEventListener('resize', () => this.display.refresh());
    document.addEventListener('fullscreenchange', () => this.display.refresh());
    // No event fires when the browser window is dragged, so poll.
    setInterval(() => this.display.refresh(), 400);

    this.renderer.setAnimationLoop(() => this._frame());
    window.__app = this;

    this._handleDeepLink();
  }

  _initRenderer() {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.domElement.id = 'gl';
    document.getElementById('canvas-container').appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ui.toast('Graphics context lost — reload the page if the view does not recover.', 8000, true);
    });

    // The projection matrix is rebuilt every frame from the eye position. Stop
    // three.js (and add-ons that call it) from replacing it with a symmetric one.
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 2000);
    this.camera.updateProjectionMatrix = () => {};
  }

  _bufferHeight() {
    return this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  }

  _onGeometryChange() {
    const s = this.ui.settings;
    if (s.webcamOffsetAuto) {
      // Typical laptop / monitor webcam: centred, about 1 cm above the top edge of the panel.
      const y = Math.round((this.display.screenHeightCm / 2 + 1.0) * 10) / 10;
      if (y !== s.webcamOffsetY) this.ui.patchSettings({ webcamOffsetY: y, webcamOffsetX: 0 }, { notify: false });
    }
    this.post.resize(window.innerWidth, window.innerHeight);
    this.stage.updateDimensions(this.display.W, this.display.H, this._bufferHeight());
    this.scenes?.onResize(this.stage);
  }

  _handleDeepLink() {
    const scene = this.params.get('scene');
    if (scene && SCENE_DEFINITIONS.some((d) => d.id === scene)) this.initialScene = scene;
    if (this.params.get('mode') === 'mouse') this._start('mouse');
    if (this.params.get('ui') === '0') document.body.classList.add('kiosk');
  }

  // -------------------------------------------------------------- lifecycle

  async _start(mode) {
    if (this._started) return;
    if (mode === 'camera') {
      const ok = await this._startCamera();
      if (!ok) return;
    } else {
      this._setMode('mouse');
    }
    this._started = true;
    this.ui.hideStartScreen();
    await this.scenes.loadInitialScene(this.initialScene || 'abyss');
  }

  async _startCamera() {
    this.ui.clearError();
    this.ui.setStartBusy(true, 'Requesting camera…');
    try {
      await this.tracker.start((stage) => this.ui.setStartBusy(true, stage));
      this.ui.setStartBusy(false);
      this._setMode('camera');
      this.headFilter.reset();
      this._lastSeq = -1;
      return true;
    } catch (err) {
      console.error('Camera initialisation failed:', err);
      this.ui.showError(err.message || 'Could not start the camera.');
      return false;
    }
  }

  _setMode(mode) {
    this.mode = mode;
    this.presence.mode = mode;
    this.ui.setInputMode(mode);
    this.ui.setTrackingState(mode === 'camera' ? 'searching' : 'off');
  }

  async _switchInput(mode) {
    if (mode === this.mode) return;
    if (mode === 'camera') {
      if (await this._startCamera()) this.ui.toast('Head tracking on');
      else this.ui.setInputMode(this.mode); // revert the toggle
    } else {
      this.tracker.stop();
      this._setMode('mouse');
      this.ui.toast('Mouse mode — move the pointer, scroll to lean in');
    }
  }

  _recenter() {
    if (this.mode !== 'camera' || !this.tracker.faceFound) {
      this.ui.toast(this.mode === 'camera' ? 'Face the camera, then recenter' : 'Recenter needs head tracking');
      return;
    }
    // Treat wherever the head is now as straight in front of the screen centre.
    const raw = this.tracker.sample;
    this.ui.patchSettings({
      webcamOffsetX: Math.round((-raw.x + this.display.offsetX) * 10) / 10,
      webcamOffsetY: Math.round((-raw.y + this.display.offsetY) * 10) / 10,
      webcamOffsetAuto: false
    });
    this.headFilter.reset();
    this.ui.toast('Recentered');
  }

  _uiCallbacks() {
    return {
      onStartCamera: () => this._start('camera'),
      onStartMouse: () => this._start('mouse'),
      onInputModeChange: (mode) => this._switchInput(mode),
      onRecenter: () => this._recenter(),
      onSceneSelect: (idOrIndex) => this.scenes.switchScene(idOrIndex),
      onSceneStep: (dir) => (dir > 0 ? this.scenes.nextScene() : this.scenes.prevScene()),
      onQualitySelect: (tier) => this.post.applyQuality(tier),
      onGalleryToggle: () => {
        const on = !this.ui.settings.galleryMode;
        this.ui.patchSettings({ galleryMode: on });
        this.ui.toast(on ? 'Gallery mode: new scene every 45 s' : 'Gallery mode off');
      },
      onSettingsChange: (s, keys = []) => this._applySettings(s, keys),
      cmPerPxForDiagonal: (d) => DisplayGeometry.cmPerPxForDiagonal(d),
      diagonalForCmPerPx: (c) => DisplayGeometry.diagonalForCmPerPx(c)
    };
  }

  _applySettings(s, keys) {
    const has = (k) => keys.length === 0 || keys.includes(k);
    // Moving the webcam-height slider by hand turns off the automatic estimate.
    if (keys.length === 1 && keys[0] === 'webcamOffsetY' && s.webcamOffsetAuto) {
      this.ui.patchSettings({ webcamOffsetAuto: false }, { notify: false });
    }
    if (has('screenDiagonalInches')) this.display.setDiagonal(s.screenDiagonalInches);
    if (has('trackWindowPosition')) {
      this.display.trackWindowPosition = s.trackWindowPosition;
      this.display.refresh(true);
    }
    if (has('minCutoff') || has('beta')) this.headFilter.setParameters(s.minCutoff, s.beta);
    if (has('latencyCompensation')) this.headFilter.predictionGain = s.latencyCompensation ? 1 : 0;
    if (has('hfovDeg')) this.tracker.hfovDeg = s.hfovDeg;
    if (has('ipdCm')) this.tracker.ipdCm = s.ipdCm;
    if (has('galleryMode')) this.scenes.setGalleryMode(s.galleryMode);
    if (has('edgeCheck')) this.stage.edgeCheckEnabled = s.edgeCheck;
  }

  // ------------------------------------------------------------ per frame

  _updateEye(dt, now) {
    const s = this.ui.settings;
    const target = this._target;
    let tau = 0;

    if (this.mode === 'camera') {
      const sample = this.tracker.sample;
      if (sample.seq !== this._lastSeq) {
        this._lastSeq = sample.seq;
        // A long gap means the old velocity estimate is meaningless.
        if (sample.t - this._lastFaceSeen > 300) {
          this.headFilter.reset();
          this._reacquiredAt = now;
        }
        this._lastFaceSeen = sample.t;
        // Webcam space -> physical screen space -> viewport space.
        this.headFilter.push(
          sample.x + s.webcamOffsetX - this.display.offsetX,
          sample.y + s.webcamOffsetY - this.display.offsetY,
          sample.z,
          sample.t
        );
      }

      const tracked = now - this._lastFaceSeen < FACE_LOST_GRACE_MS;
      if (tracked) {
        this.headFilter.predict(now, target);
        tau = now - this._reacquiredAt < REACQUIRE_MS ? REACQUIRE_TAU : 0;
      } else {
        Object.assign(target, REST_EYE);
        tau = REST_TAU;
      }
      if (tracked !== this.presence.tracked) {
        this.presence.tracked = tracked;
        this.presence.since = now;
        this.ui.setTrackingState(tracked ? 'ok' : 'searching');
      }
    } else if (this.mode === 'mouse') {
      this.ui.getMouseEye(this.stage.W, this.stage.H, target);
      tau = MOUSE_TAU;
      this.presence.tracked = this.ui.pointer.inside;
    } else {
      // Start screen: a gentle idle sway so the scene behind is alive.
      const t = now / 1000;
      target.x = Math.sin(t * 0.35) * 6;
      target.y = Math.cos(t * 0.27) * 2.5;
      target.z = REST_EYE.z;
      tau = 0.5;
    }

    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    const e = this.eye;
    e.x += (target.x - e.x) * k;
    e.y += (target.y - e.y) * k;
    e.z += (target.z - e.z) * k;

    // Keep the eye somewhere physically sensible.
    e.z = Math.min(Math.max(e.z, 18), 160);
    e.x = Math.min(Math.max(e.x, -this.stage.W * 1.5), this.stage.W * 1.5);
    e.y = Math.min(Math.max(e.y, -this.stage.H * 1.5), this.stage.H * 1.5);
  }

  _frame() {
    const now = performance.now();
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    const elapsed = this.clock.elapsedTime;

    this.post.recordFrame(rawDt * 1000);
    const f = this._fps;
    f.frames++;
    if (now - f.start >= 500) {
      f.value = Math.round((f.frames * 1000) / (now - f.start));
      f.frames = 0;
      f.start = now;
    }

    this._updateEye(dt, now);

    // Parallax strength exaggerates lateral motion only; depth stays physical.
    const m = this.ui.settings.parallaxMultiplier;
    const view = this._viewEye || (this._viewEye = { x: 0, y: 0, z: 0 });
    view.x = this.eye.x * m;
    view.y = this.eye.y * m;
    view.z = this.eye.z;

    updateOffAxisCamera(this.camera, view, this.stage.W, this.stage.H, 1, 2000);
    this.scenes.update(dt, elapsed, view, this.presence);
    if (this.stage.edgeCheckEnabled) this.stage.runEdgeCheck(this.camera);
    this.post.render();

    this.ui.updateDebug({
      mode: this.mode,
      video: this.mode === 'camera' ? this.tracker.video : null,
      irisPoints: this.tracker.irisPoints,
      trackerFps: this.tracker.trackerFps,
      inferenceMs: this.tracker.inferenceMs,
      delegate: this.tracker.delegate,
      renderFps: f.value,
      eye: view,
      faceFound: this.tracker.faceFound,
      activeTier: this.post.activeTier,
      qualitySetting: this.post.qualitySetting,
      screenW: this.stage.W,
      screenH: this.stage.H,
      offset: this.display.offsetX || this.display.offsetY ? { x: this.display.offsetX, y: this.display.offsetY } : null
    });
  }
}

function boot() {
  try {
    new PeekabooApp();
  } catch (err) {
    console.error(err);
    const msg = /WebGL/i.test(String(err?.message))
      ? 'Your browser or GPU does not support WebGL 2, which Peekaboo needs.'
      : `Peekaboo failed to start: ${err?.message || err}`;
    const el = document.getElementById('error-message');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
