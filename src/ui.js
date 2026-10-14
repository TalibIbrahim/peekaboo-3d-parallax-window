/**
 * UI controller: manages Start Screen, Scene Selection, Quality Tiers,
 * Settings Drawer, Credits Overlay, Debug HUD, and Mouse Fallback.
 */

const STORAGE_KEY = 'peekaboo_window_settings_v2';

export const DEFAULT_SETTINGS = {
  screenDiagonalInches: 15.6,
  hfovDeg: 65.0,
  ipdCm: 6.3,
  parallaxMultiplier: 1.0,
  minCutoff: 1.0,
  beta: 0.02,
  webcamOffsetY: 11.0,
  showDebug: true,
  mouseFallback: false,
  qualityTier: 'Medium',
  galleryMode: false,
  edgeCheck: false,
  curiosity: 0.3
};

export class UIController {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.settings = this.loadSettings();

    this.mouseNormalized = { x: 0, y: 0 };
    this.isMouseFallbackActive = this.settings.mouseFallback;

    // Elements
    this.startScreen = document.getElementById('start-screen');
    this.startBtn = document.getElementById('start-btn');
    this.mouseModeBtn = document.getElementById('mouse-mode-btn');
    this.errorMessage = document.getElementById('error-message');
    this.spinner = document.getElementById('loading-spinner');

    this.settingsPanel = document.getElementById('settings-panel');
    this.settingsToggleBtn = document.getElementById('settings-toggle-btn');
    this.debugOverlay = document.getElementById('debug-overlay');
    this.debugCanvas = document.getElementById('debug-canvas');
    this.debugCtx = this.debugCanvas ? this.debugCanvas.getContext('2d') : null;

    this.recenterBtn = document.getElementById('recenter-btn');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');

    this.creditsModal = document.getElementById('credits-modal');
    this.creditsBtn = document.getElementById('credits-btn');
    this.creditsCloseBtn = document.getElementById('credits-close-btn');

    this.sceneSelect = document.getElementById('scene-select');
    this.qualitySelect = document.getElementById('quality-select');
    this.galleryToggle = document.getElementById('setting-gallery-mode');
    this.edgeCheckToggle = document.getElementById('setting-edge-check');
    this.loadingBar = document.getElementById('scene-loading-bar');
    this.loadingLabel = document.getElementById('scene-loading-label');

    this._bindElements();
    this._initKeyboardShortcuts();
    this._initMouseTracking();
    this._initAnimatedStartBackground();
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Could not read settings from localStorage:', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Could not save settings to localStorage:', e);
    }
  }

  _bindElements() {
    if (this.startBtn) {
      this.startBtn.addEventListener('click', () => {
        this.showLoading(true);
        this.clearError();
        if (this.callbacks.onStartCamera) {
          this.callbacks.onStartCamera();
        }
      });
    }

    if (this.mouseModeBtn) {
      this.mouseModeBtn.addEventListener('click', () => {
        this.settings.mouseFallback = true;
        this.isMouseFallbackActive = true;
        this._updateInput('mouseFallback', true);
        this.saveSettings();
        this.hideStartScreen();
        if (this.callbacks.onStartMouse) {
          this.callbacks.onStartMouse();
        }
      });
    }

    if (this.settingsToggleBtn) {
      this.settingsToggleBtn.addEventListener('click', () => {
        this.toggleSettingsPanel();
      });
    }

    if (this.recenterBtn) {
      this.recenterBtn.addEventListener('click', () => {
        if (this.callbacks.onRecenter) {
          const newOffsets = this.callbacks.onRecenter();
          if (newOffsets && typeof newOffsets.offsetY === 'number') {
            this.settings.webcamOffsetY = Math.round(newOffsets.offsetY * 10) / 10;
            this._updateInput('webcamOffsetY', this.settings.webcamOffsetY);
            this.saveSettings();
          }
        }
      });
    }

    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => {
        this.toggleFullscreen();
      });
    }

    // Credits modal
    if (this.creditsBtn && this.creditsModal) {
      this.creditsBtn.addEventListener('click', () => {
        this.creditsModal.classList.remove('hidden');
      });
    }
    if (this.creditsCloseBtn && this.creditsModal) {
      this.creditsCloseBtn.addEventListener('click', () => {
        this.creditsModal.classList.add('hidden');
      });
    }

    // Scene picker in settings & HUD
    if (this.sceneSelect) {
      this.sceneSelect.addEventListener('change', (e) => {
        if (this.callbacks.onSceneSelect) {
          this.callbacks.onSceneSelect(e.target.value);
        }
      });
    }

    // Quality selector
    if (this.qualitySelect) {
      this.qualitySelect.value = this.settings.qualityTier;
      this.qualitySelect.addEventListener('change', (e) => {
        this.settings.qualityTier = e.target.value;
        this.saveSettings();
        if (this.callbacks.onQualitySelect) {
          this.callbacks.onQualitySelect(e.target.value);
        }
      });
    }

    // Gallery mode
    if (this.galleryToggle) {
      this.galleryToggle.checked = this.settings.galleryMode;
      this.galleryToggle.addEventListener('change', (e) => {
        this.settings.galleryMode = e.target.checked;
        this.saveSettings();
        if (this.callbacks.onGalleryToggle) {
          this.callbacks.onGalleryToggle(e.target.checked);
        }
      });
    }

    // Edge check toggle
    if (this.edgeCheckToggle) {
      this.edgeCheckToggle.checked = this.settings.edgeCheck;
      this.edgeCheckToggle.addEventListener('change', (e) => {
        this.settings.edgeCheck = e.target.checked;
        this.saveSettings();
        if (this.callbacks.onEdgeCheckToggle) {
          this.callbacks.onEdgeCheckToggle(e.target.checked);
        }
      });
    }

    this._syncInputsWithSettings();
  }

  _syncInputsWithSettings() {
    const bindNumber = (id, key, isFloat = true) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(`${id}-val`);
      if (!el) return;
      el.value = this.settings[key];
      if (valEl) valEl.textContent = this.settings[key];

      el.addEventListener('input', (e) => {
        const val = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        if (!isNaN(val)) {
          this.settings[key] = val;
          if (valEl) valEl.textContent = val;
          this.saveSettings();
          if (this.callbacks.onSettingsChange) {
            this.callbacks.onSettingsChange(this.settings);
          }
        }
      });
    };

    bindNumber('setting-screen-size', 'screenDiagonalInches', true);
    bindNumber('setting-hfov', 'hfovDeg', false);
    bindNumber('setting-ipd', 'ipdCm', true);
    bindNumber('setting-parallax', 'parallaxMultiplier', true);
    bindNumber('setting-smoothing', 'minCutoff', true);
    bindNumber('setting-responsiveness', 'beta', true);
    bindNumber('setting-webcam-y', 'webcamOffsetY', true);
    bindNumber('setting-curiosity', 'curiosity', true);

    const debugToggle = document.getElementById('setting-show-debug');
    if (debugToggle) {
      debugToggle.checked = this.settings.showDebug;
      if (this.debugOverlay) {
        this.debugOverlay.style.display = this.settings.showDebug ? 'block' : 'none';
      }
      debugToggle.addEventListener('change', (e) => {
        this.settings.showDebug = e.target.checked;
        if (this.debugOverlay) {
          this.debugOverlay.style.display = this.settings.showDebug ? 'block' : 'none';
        }
        this.saveSettings();
      });
    }

    const mouseToggle = document.getElementById('setting-mouse-fallback');
    if (mouseToggle) {
      mouseToggle.checked = this.settings.mouseFallback;
      mouseToggle.addEventListener('change', (e) => {
        this.settings.mouseFallback = e.target.checked;
        this.isMouseFallbackActive = e.target.checked;
        this.saveSettings();
        if (this.callbacks.onSettingsChange) {
          this.callbacks.onSettingsChange(this.settings);
        }
      });
    }
  }

  _updateInput(key, val) {
    if (key === 'webcamOffsetY') {
      const el = document.getElementById('setting-webcam-y');
      const valEl = document.getElementById('setting-webcam-y-val');
      if (el) el.value = val;
      if (valEl) valEl.textContent = val;
    } else if (key === 'mouseFallback') {
      const el = document.getElementById('setting-mouse-fallback');
      if (el) el.checked = val;
    }
  }

  _initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'f' || e.key === 'F') {
        this.toggleFullscreen();
      } else if (e.key === 'h' || e.key === 'H') {
        this.toggleSettingsPanel();
      } else if (e.key === 'r' || e.key === 'R') {
        if (this.callbacks.onRecenter) {
          const newOffsets = this.callbacks.onRecenter();
          if (newOffsets && typeof newOffsets.offsetY === 'number') {
            this.settings.webcamOffsetY = Math.round(newOffsets.offsetY * 10) / 10;
            this._updateInput('webcamOffsetY', this.settings.webcamOffsetY);
            this.saveSettings();
          }
        }
      }
    });
  }

  _initMouseTracking() {
    window.addEventListener('mousemove', (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      this.mouseNormalized.x = Math.max(-1, Math.min(1, nx));
      this.mouseNormalized.y = Math.max(-1, Math.min(1, ny));
    });
  }

  /**
   * Animated interactive background on the start screen inspired by react-bits.dev.
   */
  _initAnimatedStartBackground() {
    const bgCanvas = document.getElementById('start-bg-canvas');
    if (!bgCanvas) return;
    const ctx = bgCanvas.getContext('2d');

    const resize = () => {
      bgCanvas.width = window.innerWidth;
      bgCanvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    let t = 0;
    const draw = () => {
      if (!this.startScreen || this.startScreen.style.display === 'none') return;
      requestAnimationFrame(draw);
      t += 0.02;

      ctx.fillStyle = '#050714';
      ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

      const cols = 28;
      const rows = 18;
      const cellW = bgCanvas.width / cols;
      const cellH = bgCanvas.height / rows;

      ctx.lineWidth = 1;
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = c * cellW;
          const y = r * cellH;
          const dist = Math.hypot(x - bgCanvas.width * 0.5, y - bgCanvas.height * 0.5);
          const wave = Math.sin(dist * 0.015 - t) * 0.5 + 0.5;

          ctx.fillStyle = `rgba(0, 240, 255, ${wave * 0.18})`;
          ctx.beginPath();
          ctx.arc(x, y, 2.0 + wave * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    requestAnimationFrame(draw);
  }

  getMouseEye(screenW, screenH) {
    return {
      x: this.mouseNormalized.x * (screenW * 0.5),
      y: -this.mouseNormalized.y * (screenH * 0.5),
      z: 55.0
    };
  }

  updateSceneUI(sceneDef) {
    if (this.sceneSelect) {
      this.sceneSelect.value = sceneDef.id;
    }
    const titleEl = document.getElementById('hud-scene-title');
    if (titleEl) {
      titleEl.textContent = sceneDef.name;
    }
  }

  showLoadingProgress(sceneName, percent) {
    if (!this.loadingBar) return;
    if (percent < 100) {
      this.loadingBar.style.display = 'block';
      this.loadingBar.style.width = `${percent}%`;
      if (this.loadingLabel) {
        this.loadingLabel.textContent = `Loading ${sceneName}... ${percent}%`;
        this.loadingLabel.style.display = 'block';
      }
    } else {
      this.loadingBar.style.width = '100%';
      setTimeout(() => {
        this.loadingBar.style.display = 'none';
        if (this.loadingLabel) this.loadingLabel.style.display = 'none';
      }, 300);
    }
  }

  toggleSettingsPanel() {
    if (!this.settingsPanel) return;
    const isHidden = this.settingsPanel.classList.toggle('hidden');
    if (this.settingsToggleBtn) {
      this.settingsToggleBtn.setAttribute('aria-expanded', (!isHidden).toString());
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('Error attempting fullscreen:', err.message);
      });
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  hideStartScreen() {
    if (this.startScreen) {
      this.startScreen.classList.add('fade-out');
      setTimeout(() => {
        this.startScreen.style.display = 'none';
      }, 400);
    }
  }

  showLoading(loading) {
    if (this.spinner) this.spinner.style.display = loading ? 'block' : 'none';
    if (this.startBtn) this.startBtn.disabled = loading;
  }

  showError(msg) {
    this.showLoading(false);
    if (this.errorMessage) {
      this.errorMessage.textContent = msg;
      this.errorMessage.style.display = 'block';
    }
    if (this.mouseModeBtn) {
      this.mouseModeBtn.classList.add('highlight-action');
    }
  }

  clearError() {
    if (this.errorMessage) {
      this.errorMessage.style.display = 'none';
      this.errorMessage.textContent = '';
    }
  }

  updateDebug(metrics) {
    if (!this.settings.showDebug || !this.debugOverlay || !this.debugCtx) return;

    const { video, irisPoints, trackerFps, renderFps, eye, faceFound, activeTier } = metrics;
    const w = this.debugCanvas.width;
    const h = this.debugCanvas.height;

    this.debugCtx.clearRect(0, 0, w, h);

    if (video && video.readyState >= 2) {
      this.debugCtx.save();
      this.debugCtx.translate(w, 0);
      this.debugCtx.scale(-1, 1);
      this.debugCtx.drawImage(video, 0, 0, w, h);
      this.debugCtx.restore();

      this.debugCtx.fillStyle = 'rgba(5, 10, 25, 0.25)';
      this.debugCtx.fillRect(0, 0, w, h);

      if (irisPoints && irisPoints.length >= 2) {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;

        irisPoints.forEach((pt, idx) => {
          const cx = w - (pt.x / vw) * w;
          const cy = (pt.y / vh) * h;

          this.debugCtx.beginPath();
          this.debugCtx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          this.debugCtx.fillStyle = idx === 0 ? '#00f5ff' : '#ff007f';
          this.debugCtx.shadowColor = idx === 0 ? '#00f5ff' : '#ff007f';
          this.debugCtx.shadowBlur = 6;
          this.debugCtx.fill();
        });
      }
    } else {
      this.debugCtx.fillStyle = '#0a0f24';
      this.debugCtx.fillRect(0, 0, w, h);
      this.debugCtx.fillStyle = '#6e7a9e';
      this.debugCtx.font = '11px sans-serif';
      this.debugCtx.textAlign = 'center';
      this.debugCtx.fillText(
        this.isMouseFallbackActive ? 'Mouse Mode' : 'Camera Standby',
        w / 2,
        h / 2
      );
    }

    const fpsEl = document.getElementById('debug-render-fps');
    if (fpsEl) fpsEl.textContent = renderFps;

    const trkFpsEl = document.getElementById('debug-tracker-fps');
    if (trkFpsEl) trkFpsEl.textContent = trackerFps;

    const tierEl = document.getElementById('debug-quality-tier');
    if (tierEl) tierEl.textContent = activeTier || this.settings.qualityTier;

    const eyeEl = document.getElementById('debug-eye-pos');
    if (eyeEl) {
      eyeEl.textContent = `X: ${eye.x >= 0 ? '+' : ''}${eye.x.toFixed(1)}  Y: ${eye.y >= 0 ? '+' : ''}${eye.y.toFixed(1)}  Z: ${eye.z.toFixed(1)} cm`;
    }

    const faceEl = document.getElementById('debug-face-status');
    if (faceEl) {
      if (this.isMouseFallbackActive) {
        faceEl.textContent = 'MOUSE FALLBACK';
        faceEl.className = 'status-tag tag-mouse';
      } else if (faceFound) {
        faceEl.textContent = 'TRACKED';
        faceEl.className = 'status-tag tag-green';
      } else {
        faceEl.textContent = 'NO FACE DETECTED';
        faceEl.className = 'status-tag tag-red';
      }
    }
  }
}
