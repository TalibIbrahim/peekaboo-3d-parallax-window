/**
 * Physical display model.
 *
 * Everything in Peekaboo is measured in centimetres relative to the centre of
 * the *viewport* (the canvas), with +Y up and +Z toward the viewer. To get that
 * right we need two things the browser does not tell us directly:
 *
 *   1. How big a CSS pixel is in the real world (cm / px). We derive it from the
 *      screen diagonal the user enters (or measures with a card), combined with
 *      the screen's resolution in CSS px. Using the *screen* aspect ratio rather
 *      than the window's keeps the scale correct when the browser isn't
 *      fullscreen.
 *
 *   2. Where the viewport sits on the physical screen. The webcam is mounted
 *      relative to the screen, not the browser window, so when the window is
 *      dragged around the virtual "window into the world" has to move with it.
 *      We estimate the viewport's centre from window.screenX/Y and the size of
 *      the browser chrome.
 */
export class DisplayGeometry {
  constructor(diagonalInches = 15.6) {
    this.diagonalInches = diagonalInches;
    this.trackWindowPosition = true;

    this.cmPerPx = 0.02;
    this.W = 34.5; // viewport width in cm
    this.H = 19.4; // viewport height in cm
    this.pxW = 1;
    this.pxH = 1;
    // Offset of the viewport centre from the physical screen centre, in cm.
    this.offsetX = 0;
    this.offsetY = 0;
    this.screenWidthCm = 34.5;
    this.screenHeightCm = 19.4;

    this._listeners = new Set();
    this._signature = '';
    this.refresh();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  setDiagonal(inches) {
    if (!(inches > 0)) return;
    this.diagonalInches = inches;
    this.refresh(true);
  }

  /** Screen size in CSS px. Falls back to the viewport if the API lies (e.g. 0). */
  static screenSizePx() {
    const s = window.screen || {};
    const w = s.width > 0 ? s.width : window.innerWidth;
    const h = s.height > 0 ? s.height : window.innerHeight;
    return { w, h };
  }

  /** cm per CSS px for a given diagonal on the current screen. */
  static cmPerPxForDiagonal(inches) {
    const { w, h } = DisplayGeometry.screenSizePx();
    return (inches * 2.54) / Math.hypot(w, h);
  }

  /** Inverse of cmPerPxForDiagonal, used by the card calibration. */
  static diagonalForCmPerPx(cmPerPx) {
    const { w, h } = DisplayGeometry.screenSizePx();
    return (cmPerPx * Math.hypot(w, h)) / 2.54;
  }

  get isFullscreen() {
    return !!document.fullscreenElement;
  }

  /**
   * Recompute geometry. Cheap; called on resize and polled a few times a second
   * to catch window moves (there is no "move" event).
   * @returns {boolean} whether anything changed
   */
  refresh(force = false) {
    const pxW = Math.max(window.innerWidth, 1);
    const pxH = Math.max(window.innerHeight, 1);
    const { w: sw, h: sh } = DisplayGeometry.screenSizePx();
    const cmPerPx = DisplayGeometry.cmPerPxForDiagonal(this.diagonalInches);

    let offX = 0;
    let offY = 0;
    const viewportFillsScreen = this.isFullscreen || (Math.abs(pxW - sw) < 2 && Math.abs(pxH - sh) < 2);
    if (this.trackWindowPosition && !viewportFillsScreen) {
      const s = window.screen || {};
      const originX = Number.isFinite(s.availLeft) ? s.availLeft : 0;
      const originY = Number.isFinite(s.availTop) ? s.availTop : 0;
      // Browser chrome: assume side borders are symmetric and everything else is on top.
      const border = Math.max(0, (window.outerWidth - pxW) / 2);
      const chromeTop = Math.max(0, window.outerHeight - pxH - border);
      const left = window.screenX - originX + border;
      const top = window.screenY - originY + chromeTop;
      const cx = left + pxW / 2;
      const cy = top + pxH / 2;
      offX = (cx - sw / 2) * cmPerPx;
      offY = -(cy - sh / 2) * cmPerPx;
      // Guard against nonsense values (e.g. some embedded browsers report 0 for outer sizes).
      const maxOff = Math.hypot(sw, sh) * cmPerPx;
      if (!Number.isFinite(offX) || Math.abs(offX) > maxOff) offX = 0;
      if (!Number.isFinite(offY) || Math.abs(offY) > maxOff) offY = 0;
    }

    const sig = [pxW, pxH, cmPerPx.toFixed(6), offX.toFixed(2), offY.toFixed(2)].join('|');
    if (!force && sig === this._signature) return false;
    this._signature = sig;

    this.pxW = pxW;
    this.pxH = pxH;
    this.cmPerPx = cmPerPx;
    this.screenWidthCm = sw * cmPerPx;
    this.screenHeightCm = sh * cmPerPx;
    this.W = pxW * cmPerPx;
    this.H = pxH * cmPerPx;
    this.offsetX = offX;
    this.offsetY = offY;

    for (const fn of this._listeners) fn(this);
    return true;
  }
}
