/**
 * UI controller: start screen, HUD, settings drawer, help & credits overlays,
 * card calibration, debug HUD and mouse/touch input.
 *
 * The UI owns the persisted settings object. It never touches the renderer or
 * tracker directly; everything goes through the callbacks passed in.
 */

const STORAGE_KEY = 'peekaboo_window_settings_v3';
const IDLE_HIDE_MS = 2800;
const CARD_WIDTH_CM = 8.56; // ISO/IEC 7810 ID-1 (credit card, most ID cards)
const CARD_ASPECT = 85.6 / 53.98;

/** First-run guess at the screen size. Users can measure it properly in Settings. */
function guessDiagonalInches() {
  try {
    const minSide = Math.min(window.screen.width || 0, window.screen.height || 0);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && minSide > 0 && minSide < 500) return 6.1;   // phone
    if (touch && minSide > 0 && minSide < 1100) return 11;   // tablet
  } catch { /* fall through */ }
  return 15.6; // laptop
}

export const DEFAULT_SETTINGS = {
  screenDiagonalInches: guessDiagonalInches(),
  trackWindowPosition: true,
  hfovDeg: 65,
  ipdCm: 6.3,
  webcamOffsetX: 0.0,
  webcamOffsetY: 11.0,
  /** When true, webcamOffsetY follows the screen size (camera centred on the top bezel). */
  webcamOffsetAuto: true,
  parallaxMultiplier: 1.0,
  minCutoff: 1.0,
  beta: 0.05,
  latencyCompensation: true,
  showDebug: false,
  qualityTier: 'Auto',
  galleryMode: false,
  edgeCheck: false,
  curiosity: 0.3
};

/** Range/number inputs: [element id, settings key, decimals]. */
const NUMBER_BINDINGS = [
  ['setting-screen-size', 'screenDiagonalInches', 1],
  ['setting-hfov', 'hfovDeg', 0],
  ['setting-ipd', 'ipdCm', 1],
  ['setting-parallax', 'parallaxMultiplier', 1],
  ['setting-smoothing', 'minCutoff', 1],
  ['setting-responsiveness', 'beta', 3],
  ['setting-webcam-y', 'webcamOffsetY', 1],
  ['setting-curiosity', 'curiosity', 2]
];

const TOGGLE_BINDINGS = [
  ['setting-gallery-mode', 'galleryMode'],
  ['setting-edge-check', 'edgeCheck'],
  ['setting-show-debug', 'showDebug'],
  ['setting-window-position', 'trackWindowPosition'],
  ['setting-latency', 'latencyCompensation']
];

const $ = (id) => document.getElementById(id);

export class UIController {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.settings = this.loadSettings();
    this.inputMode = null; // 'camera' | 'mouse' once started

    // Pointer-driven eye for mouse mode, normalised to [-1, 1].
    this.pointer = { x: 0, y: 0, inside: false };
    this.mouseDepth = 60; // cm, adjustable with the wheel / pinch

    this._lastActivity = performance.now();
    this._hudHidden = false;
    this._debugTick = 0;
    this._toastTimer = null;

    this.debugCanvas = $('debug-canvas');
    this.debugCtx = this.debugCanvas?.getContext('2d') || null;

    this._bindStartScreen();
    this._bindHud();
    this._bindSettings();
    this._bindOverlays();
    this._bindCalibration();
    this._bindKeyboard();
    this._bindPointer();
    this._bindIdle();
    this._startBackground();
    this._applyDebugVisibility();
  }

  // ---------------------------------------------------------------- settings

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        const merged = { ...DEFAULT_SETTINGS };
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
          if (typeof saved[k] === typeof DEFAULT_SETTINGS[k]) merged[k] = saved[k];
        }
        return merged;
      }
    } catch (e) {
      console.warn('Could not read settings:', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch { /* storage may be unavailable (private mode); settings still work for this session */ }
  }

  /** Update one or more settings from code (e.g. recenter, auto calibration) and sync the inputs. */
  patchSettings(patch, { notify = true } = {}) {
    Object.assign(this.settings, patch);
    this.saveSettings();
    this._syncInputs();
    if (notify) this.cb.onSettingsChange?.(this.settings, Object.keys(patch));
  }

  _syncInputs() {
    for (const [id, key, decimals] of NUMBER_BINDINGS) {
      const el = $(id);
      if (!el) continue;
      el.value = this.settings[key];
      const out = $(`${id}-val`);
      if (out) out.textContent = Number(this.settings[key]).toFixed(decimals);
    }
    for (const [id, key] of TOGGLE_BINDINGS) {
      const el = $(id);
      if (el) el.checked = !!this.settings[key];
    }
    const q = $('quality-select');
    if (q) q.value = this.settings.qualityTier;
    const mouse = $('setting-mouse-fallback');
    if (mouse) mouse.checked = this.inputMode === 'mouse';
  }

  _bindSettings() {
    for (const [id, key, decimals] of NUMBER_BINDINGS) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return;
        const min = parseFloat(el.min);
        const max = parseFloat(el.max);
        const clamped = Math.min(Number.isFinite(max) ? max : v, Math.max(Number.isFinite(min) ? min : v, v));
        this.settings[key] = clamped;
        const out = $(`${id}-val`);
        if (out) out.textContent = clamped.toFixed(decimals);
        this.saveSettings();
        this.cb.onSettingsChange?.(this.settings, [key]);
      });
    }

    for (const [id, key] of TOGGLE_BINDINGS) {
      $(id)?.addEventListener('change', (e) => {
        this.settings[key] = e.target.checked;
        this.saveSettings();
        if (key === 'showDebug') this._applyDebugVisibility();
        this.cb.onSettingsChange?.(this.settings, [key]);
      });
    }

    $('quality-select')?.addEventListener('change', (e) => {
      this.settings.qualityTier = e.target.value;
      this.saveSettings();
      this.cb.onQualitySelect?.(e.target.value);
    });

    $('setting-mouse-fallback')?.addEventListener('change', (e) => {
      this.cb.onInputModeChange?.(e.target.checked ? 'mouse' : 'camera');
    });

    $('recenter-btn')?.addEventListener('click', () => this.cb.onRecenter?.());
    $('measure-btn')?.addEventListener('click', () => this.openCalibration());
    $('reset-settings-btn')?.addEventListener('click', () => {
      const keepQuality = this.settings.qualityTier;
      this.patchSettings({ ...DEFAULT_SETTINGS, qualityTier: keepQuality });
      this._applyDebugVisibility();
      this.toast('Settings reset');
    });

    this._syncInputs();
  }

  // ------------------------------------------------------------ start screen

  _bindStartScreen() {
    $('start-btn')?.addEventListener('click', () => this.cb.onStartCamera?.());
    $('mouse-mode-btn')?.addEventListener('click', () => this.cb.onStartMouse?.());
  }

  setStartBusy(busy, label = '') {
    const btn = $('start-btn');
    if (btn) btn.disabled = busy;
    const spinner = $('loading-spinner');
    if (spinner) spinner.style.display = busy ? 'inline-block' : 'none';
    const status = $('start-status');
    if (status) {
      status.textContent = label;
      status.style.visibility = label ? 'visible' : 'hidden';
    }
  }

  hideStartScreen() {
    const s = $('start-screen');
    if (!s) return;
    s.classList.add('fade-out');
    setTimeout(() => { s.style.display = 'none'; }, 450);
    document.body.classList.add('running');
    this.poke();
  }

  showError(msg) {
    this.setStartBusy(false);
    const startVisible = $('start-screen')?.style.display !== 'none';
    if (startVisible) {
      const el = $('error-message');
      if (el) {
        el.textContent = msg;
        el.style.display = 'block';
      }
      $('mouse-mode-btn')?.classList.add('highlight-action');
    } else {
      this.toast(msg, 6000, true);
    }
  }

  clearError() {
    const el = $('error-message');
    if (el) {
      el.style.display = 'none';
      el.textContent = '';
    }
  }

  setInputMode(mode) {
    this.inputMode = mode;
    document.body.dataset.input = mode;
    this._syncInputs();
  }

  _startBackground() {
    const canvas = $('start-bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    window.addEventListener('resize', resize);
    resize();

    // A tiny off-axis "room" that follows the pointer: a preview of what the app does.
    const draw = (time) => {
      const start = $('start-screen');
      if (!start || start.style.display === 'none') return;
      requestAnimationFrame(draw);
      const w = window.innerWidth;
      const h = window.innerHeight;
      const t = reduceMotion ? 0 : time * 0.001;
      ctx.fillStyle = '#04060f';
      ctx.fillRect(0, 0, w, h);

      const ex = this.pointer.x * 0.5 + Math.sin(t * 0.4) * 0.08;
      const ey = this.pointer.y * 0.5 + Math.cos(t * 0.3) * 0.05;
      const project = (x, y, z) => {
        // z in [0, 1] = depth into the screen; vanishing point shifts opposite the eye
        const k = 1 / (1 + z * 2.2);
        const vx = -ex * w * 0.5;
        const vy = -ey * h * 0.5;
        return [w / 2 + (x * w * 0.5 - vx) * k + vx, h / 2 + (y * h * 0.5 - vy) * k + vy];
      };

      ctx.lineWidth = 1;
      for (let i = 0; i <= 12; i++) {
        const z = i / 12;
        const a = 0.05 + (1 - z) * 0.18;
        ctx.strokeStyle = `rgba(0, 240, 255, ${a})`;
        const [x0, y0] = project(-1, -1, z);
        const [x1, y1] = project(1, 1, z);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
      for (let i = 0; i <= 8; i++) {
        const u = -1 + (i / 8) * 2;
        for (const [ax, ay] of [[u, -1], [u, 1], [-1, u], [1, u]]) {
          const [x0, y0] = project(ax, ay, 0);
          const [x1, y1] = project(ax, ay, 1);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
      // A few floating motes at different depths
      for (let i = 0; i < 18; i++) {
        const z = ((i * 0.137 + t * 0.03) % 1);
        const x = Math.sin(i * 12.9898) * 0.7;
        const y = Math.cos(i * 78.233) * 0.6;
        const [px, py] = project(x, y, z);
        const r = 2.5 / (1 + z * 2.2);
        ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 0, 127, 0.55)' : 'rgba(0, 240, 255, 0.55)';
        ctx.beginPath();
        ctx.arc(px, py, r * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    requestAnimationFrame(draw);
  }

  // ---------------------------------------------------------------------- HUD

  _bindHud() {
    $('scene-select')?.addEventListener('change', (e) => {
      this.cb.onSceneSelect?.(e.target.value);
      e.target.blur(); // keep arrow keys for scene navigation
    });
    $('fullscreen-btn')?.addEventListener('click', () => this.toggleFullscreen());
    $('settings-toggle-btn')?.addEventListener('click', () => this.toggleSettingsPanel());
    $('settings-close-btn')?.addEventListener('click', () => this.toggleSettingsPanel(false));
    $('help-btn')?.addEventListener('click', () => this.toggleHelp());
  }

  updateSceneUI(sceneDef) {
    const sel = $('scene-select');
    if (sel) sel.value = sceneDef.id;
    const title = $('hud-scene-title');
    if (title) title.textContent = sceneDef.name;
    const tag = $('hud-scene-tagline');
    if (tag) tag.textContent = sceneDef.tagline || '';
    this.showSceneCard(sceneDef);
  }

  showSceneCard(sceneDef) {
    const card = $('scene-card');
    if (!card) return;
    card.querySelector('.scene-card-title').textContent = sceneDef.name;
    card.querySelector('.scene-card-tagline').textContent = sceneDef.hint || sceneDef.tagline || '';
    card.classList.remove('show');
    void card.offsetWidth; // restart the animation
    card.classList.add('show');
  }

  showLoadingProgress(sceneName, percent) {
    const bar = $('scene-loading-bar');
    const label = $('scene-loading-label');
    if (!bar) return;
    if (sceneName && percent < 100) {
      bar.style.display = 'block';
      bar.style.width = `${Math.max(percent, 3)}%`;
      if (label) {
        label.textContent = `Loading ${sceneName}… ${Math.round(percent)}%`;
        label.style.display = 'block';
      }
    } else {
      bar.style.width = '100%';
      setTimeout(() => {
        bar.style.display = 'none';
        bar.style.width = '0%';
        if (label) label.style.display = 'none';
      }, 250);
    }
  }

  setTrackingState(state) {
    // state: 'ok' | 'searching' | 'off'
    const pill = $('tracking-pill');
    if (!pill) return;
    pill.dataset.state = state;
  }

  toggleSettingsPanel(force) {
    const panel = $('settings-panel');
    if (!panel) return;
    const open = force ?? panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    $('settings-toggle-btn')?.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('panel-open', open);
    this.poke();
  }

  toggleHelp(force) {
    const el = $('help-modal');
    if (!el) return;
    const open = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !open);
    this.poke();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch((err) => this.toast(`Fullscreen unavailable: ${err.message}`));
    } else {
      document.exitFullscreen?.();
    }
  }

  toast(msg, ms = 1800, isError = false) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---------------------------------------------------- auto-hide for immersion

  poke() {
    this._lastActivity = performance.now();
    if (this._hudHidden) {
      this._hudHidden = false;
      document.body.classList.remove('idle');
    }
  }

  _bindIdle() {
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(ev, () => this.poke(), { passive: true });
    }
    setInterval(() => {
      const running = document.body.classList.contains('running');
      const panelOpen = document.body.classList.contains('panel-open');
      const modalOpen = document.querySelector('.modal:not(.hidden)');
      const hovering = document.querySelector('.hud:hover');
      if (!running || panelOpen || modalOpen || hovering) return;
      if (!this._hudHidden && performance.now() - this._lastActivity > IDLE_HIDE_MS) {
        this._hudHidden = true;
        document.body.classList.add('idle');
      }
    }, 250);
  }

  // ------------------------------------------------------------ overlays

  _bindOverlays() {
    $('credits-btn')?.addEventListener('click', () => $('credits-modal')?.classList.remove('hidden'));
    for (const modal of document.querySelectorAll('.modal')) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-close]')) modal.classList.add('hidden');
      });
    }
  }

  // ------------------------------------------------------ card calibration

  _bindCalibration() {
    const slider = $('card-size');
    const card = $('calib-card');
    if (!slider || !card) return;

    const apply = () => {
      const wPx = parseFloat(slider.value);
      card.style.width = `${wPx}px`;
      card.style.height = `${wPx / CARD_ASPECT}px`;
      const cmPerPx = CARD_WIDTH_CM / wPx;
      const diag = this.cb.diagonalForCmPerPx ? this.cb.diagonalForCmPerPx(cmPerPx) : 0;
      const out = $('card-diagonal');
      if (out) out.textContent = diag ? `${diag.toFixed(1)}"` : '';
      this._calibDiagonal = diag;
    };
    slider.addEventListener('input', apply);

    // Drag the card's corner handle to resize, for people who'd rather not use the slider.
    const handle = $('calib-handle');
    let dragging = false;
    let startX = 0;
    let startW = 0;
    handle?.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = parseFloat(slider.value);
      handle.setPointerCapture(e.pointerId);
    });
    handle?.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const w = Math.min(parseFloat(slider.max), Math.max(parseFloat(slider.min), startW + (e.clientX - startX) * 2));
      slider.value = String(w);
      apply();
    });
    handle?.addEventListener('pointerup', () => { dragging = false; });

    $('calib-apply')?.addEventListener('click', () => {
      if (this._calibDiagonal > 5 && this._calibDiagonal < 120) {
        const d = Math.round(this._calibDiagonal * 10) / 10;
        this.patchSettings({ screenDiagonalInches: d });
        this.toast(`Screen set to ${d}"`);
      }
      $('calib-modal')?.classList.add('hidden');
    });

    this._applyCalibration = apply;
  }

  openCalibration() {
    const slider = $('card-size');
    if (slider && this.cb.cmPerPxForDiagonal) {
      // Start the card at the size implied by the current diagonal.
      const cmPerPx = this.cb.cmPerPxForDiagonal(this.settings.screenDiagonalInches);
      slider.value = String(Math.round(CARD_WIDTH_CM / cmPerPx));
    }
    this._applyCalibration?.();
    $('calib-modal')?.classList.remove('hidden');
  }

  // ------------------------------------------------------------- keyboard

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      const running = document.body.classList.contains('running');
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      switch (k) {
        case 'f': this.toggleFullscreen(); break;
        case 'h': case 's': this.toggleSettingsPanel(); break;
        case '?': case '/': this.toggleHelp(); break;
        case 'd': this.patchSettings({ showDebug: !this.settings.showDebug }, { notify: false }); this._applyDebugVisibility(); break;
        case 'Escape':
          for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
          this.toggleSettingsPanel(false);
          break;
        default:
          if (!running) return;
          if (k >= '0' && k <= '3') this.cb.onSceneSelect?.(Number(k));
          else if (k === 'ArrowRight') this.cb.onSceneStep?.(1);
          else if (k === 'ArrowLeft') this.cb.onSceneStep?.(-1);
          else if (k === 'r' || k === 'c') this.cb.onRecenter?.();
          else if (k === 'p' || k === 'g') this.cb.onGalleryToggle?.();
          else if (k === 'm') this.cb.onInputModeChange?.(this.inputMode === 'mouse' ? 'camera' : 'mouse');
          else return;
      }
      e.preventDefault();
    });
  }

  // ---------------------------------------------------------- mouse / touch

  _bindPointer() {
    const setFrom = (e) => {
      this.pointer.x = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
      this.pointer.y = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
      this.pointer.inside = true;
    };
    window.addEventListener('pointermove', setFrom, { passive: true });
    window.addEventListener('pointerdown', setFrom, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { this.pointer.inside = false; });
    window.addEventListener('blur', () => { this.pointer.inside = false; });

    // Wheel = lean in / out in mouse mode.
    window.addEventListener('wheel', (e) => {
      if (this.inputMode !== 'mouse' || e.target.closest?.('.hud, .modal')) return;
      this.mouseDepth = Math.min(110, Math.max(25, this.mouseDepth * Math.exp(e.deltaY * 0.0012)));
    }, { passive: true });
  }

  /** Eye position (cm, viewport-relative) implied by the pointer. */
  getMouseEye(W, H, out) {
    const p = this.pointer.inside ? this.pointer : { x: 0, y: 0 };
    // Scale so that the pointer at the edge of the screen corresponds to the
    // head being somewhat past the edge, which feels like natural leaning.
    out.x = p.x * W * 0.6;
    out.y = -p.y * H * 0.6;
    out.z = this.mouseDepth;
    return out;
  }

  // --------------------------------------------------------------- debug HUD

  _applyDebugVisibility() {
    const el = $('debug-overlay');
    if (el) el.classList.toggle('hidden', !this.settings.showDebug);
  }

  updateDebug(m) {
    if (!this.settings.showDebug || !this.debugCtx) return;
    const ctx = this.debugCtx;
    const w = this.debugCanvas.width;
    const h = this.debugCanvas.height;

    if (m.video && m.video.readyState >= 2) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(m.video, 0, 0, w, h);
      ctx.restore();
      ctx.fillStyle = 'rgba(5, 10, 25, 0.3)';
      ctx.fillRect(0, 0, w, h);
      if (m.irisPoints) {
        const vw = m.video.videoWidth || 640;
        const vh = m.video.videoHeight || 480;
        m.irisPoints.forEach((pt, i) => {
          ctx.beginPath();
          ctx.arc(w - (pt.x / vw) * w, (pt.y / vh) * h, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? '#00f5ff' : '#ff007f';
          ctx.fill();
        });
      }
    } else {
      ctx.fillStyle = '#0a0f24';
      ctx.fillRect(0, 0, w, h);
      // Top-down view of where the "eye" is relative to the screen.
      const sx = w / 2;
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 40, 14);
      ctx.lineTo(sx + 40, 14);
      ctx.stroke();
      const ex = sx + (m.eye.x / Math.max(m.screenW, 1)) * 80;
      const ey = 14 + (m.eye.z / 120) * (h - 24);
      ctx.fillStyle = '#ff007f';
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6e7a9e';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(m.mode === 'mouse' ? 'mouse · wheel = depth' : 'camera starting…', sx, h - 6);
    }

    // DOM text only 5x a second; it's surprisingly expensive at 60+ Hz.
    if (++this._debugTick % 12 !== 0) return;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('debug-render-fps', m.renderFps);
    set('debug-tracker-fps', m.mode === 'camera' ? `${m.trackerFps} (${m.inferenceMs.toFixed(1)} ms ${m.delegate || ''})` : '—');
    set('debug-quality-tier', m.qualitySetting === 'Auto' ? `Auto → ${m.activeTier}` : m.activeTier);
    const f = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
    set('debug-eye-pos', `${f(m.eye.x)}, ${f(m.eye.y)}, ${m.eye.z.toFixed(1)} cm`);
    set('debug-window', `${m.screenW.toFixed(1)} × ${m.screenH.toFixed(1)} cm${m.offset ? ` @ ${f(m.offset.x)}, ${f(m.offset.y)}` : ''}`);
    const status = $('debug-face-status');
    if (status) {
      if (m.mode === 'mouse') {
        status.textContent = 'MOUSE';
        status.className = 'status-tag tag-mouse';
      } else if (m.faceFound) {
        status.textContent = 'TRACKED';
        status.className = 'status-tag tag-green';
      } else {
        status.textContent = 'NO FACE';
        status.className = 'status-tag tag-red';
      }
    }
  }
}
