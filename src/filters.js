/**
 * One Euro Filter implementation for 1D signal smoothing.
 * Based on Casiez, Roussel, and Vogel (CHI 2012):
 * "1 € Filter: A Simple Speed-based Low-pass Filter for Angular and Positional Data"
 */

class LowPassFilter {
  constructor(alpha = 1.0, initVal = 0.0) {
    this.alpha = alpha;
    this.s = initVal;
    this.hasInitial = false;
  }

  filter(value) {
    if (!this.hasInitial) {
      this.s = value;
      this.hasInitial = true;
      return value;
    }
    this.s = this.alpha * value + (1.0 - this.alpha) * this.s;
    return this.s;
  }

  filterWithAlpha(value, alpha) {
    this.alpha = alpha;
    return this.filter(value);
  }

  hasLast() {
    return this.hasInitial;
  }

  last() {
    return this.s;
  }

  reset() {
    this.hasInitial = false;
    this.s = 0.0;
  }
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff - Minimum cutoff frequency in Hz (smaller = more smoothing at low speeds)
   * @param {number} beta - Speed coefficient (higher = less lag during rapid movement)
   * @param {number} dCutoff - Cutoff frequency for derivative in Hz (usually 1.0)
   */
  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.lastTime = null;
  }

  computeAlpha(cutoff, dt) {
    if (dt <= 0) return 1.0;
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  /**
   * Filter a single coordinate sample.
   * @param {number} value - The raw input value.
   * @param {number} [timestamp] - Current time in milliseconds. If omitted, performance.now() is used.
   * @returns {number} The smoothed value.
   */
  filter(value, timestamp = performance.now()) {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      this.xFilter.reset();
      this.dxFilter.reset();
      this.xFilter.filter(value);
      return value;
    }

    const dt = Math.max((timestamp - this.lastTime) / 1000.0, 0.0001); // in seconds
    this.lastTime = timestamp;

    // Estimate derivative (velocity)
    const prevX = this.xFilter.last();
    const dx = (value - prevX) / dt;
    const edx = this.dxFilter.filterWithAlpha(dx, this.computeAlpha(this.dCutoff, dt));

    // Dynamic cutoff frequency
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filterWithAlpha(value, this.computeAlpha(cutoff, dt));
  }

  setParameters(minCutoff, beta) {
    if (typeof minCutoff === 'number' && !isNaN(minCutoff)) {
      this.minCutoff = minCutoff;
    }
    if (typeof beta === 'number' && !isNaN(beta)) {
      this.beta = beta;
    }
  }

  reset() {
    this.lastTime = null;
    this.xFilter.reset();
    this.dxFilter.reset();
  }
}
