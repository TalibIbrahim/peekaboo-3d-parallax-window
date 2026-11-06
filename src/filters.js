/**
 * One Euro Filter implementation for 1D signal smoothing.
 * Based on Casiez, Roussel, and Vogel (CHI 2012):
 * "1 € Filter: A Simple Speed-based Low-pass Filter for Angular and Positional Data"
 */

class LowPassFilter {
  constructor() {
    this.s = 0.0;
    this.hasInitial = false;
  }

  filter(value, alpha) {
    if (!this.hasInitial) {
      this.s = value;
      this.hasInitial = true;
      return value;
    }
    this.s = alpha * value + (1.0 - alpha) * this.s;
    return this.s;
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
    this.vFilter = new LowPassFilter();
    this.lastTime = null;
    /** Smoothed rate of change of the output, in units per second. */
    this.velocity = 0;
    /** Current lag of the output behind the input, in seconds (1 / 2πf_c). */
    this.lag = 0;
  }

  static alpha(cutoff, dt) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  /**
   * Filter a single sample.
   * @param {number} value - The raw input value.
   * @param {number} [timestamp] - Sample time in milliseconds.
   * @returns {number} The smoothed value.
   */
  filter(value, timestamp = performance.now()) {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      this.xFilter.reset();
      this.dxFilter.reset();
      this.vFilter.reset();
      this.xFilter.filter(value, 1);
      this.velocity = 0;
      this.lag = 0;
      return value;
    }

    const dt = Math.max((timestamp - this.lastTime) / 1000.0, 1e-4);
    this.lastTime = timestamp;

    // Speed estimate that drives the adaptive cutoff, exactly as in the paper.
    // It is measured against the lagging output, so it overestimates true
    // speed; that's fine for choosing a cutoff but not for prediction.
    const prev = this.xFilter.last();
    const edx = this.dxFilter.filter((value - prev) / dt, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const out = this.xFilter.filter(value, OneEuroFilter.alpha(cutoff, dt));

    // Unbiased velocity: derivative of the smoothed output.
    this.velocity = this.vFilter.filter((out - prev) / dt, OneEuroFilter.alpha(this.dCutoff, dt));
    this.lag = 1 / (2 * Math.PI * cutoff);
    return out;
  }

  setParameters(minCutoff, beta) {
    if (Number.isFinite(minCutoff) && minCutoff > 0) this.minCutoff = minCutoff;
    if (Number.isFinite(beta) && beta >= 0) this.beta = beta;
  }

  reset() {
    this.lastTime = null;
    this.xFilter.reset();
    this.dxFilter.reset();
    this.vFilter.reset();
    this.velocity = 0;
    this.lag = 0;
  }
}

/**
 * Smooths a stream of 3D head samples and extrapolates them to render time.
 *
 * Samples arrive at camera rate (typically 30 fps) and are already tens of
 * milliseconds old by the time a frame is drawn. Each axis gets a One Euro
 * filter, and its velocity estimate is used to extrapolate over both the
 * sample's age and the filter's own lag, so the view tracks the head *now*.
 * That removes most of the perceived "swim" of head-coupled perspective while
 * keeping the jitter suppression of the smoothing.
 */
export class HeadPoseFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0, depthScale = 0.5 } = {}) {
    this.depthScale = depthScale;
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fz = new OneEuroFilter(minCutoff * depthScale, beta * depthScale, dCutoff);
    this.value = { x: 0, y: 0, z: 55 };
    this.lastSampleTime = null;
    /** Scales the extrapolation horizon. 0 disables prediction. */
    this.predictionGain = 1.0;
    /** How much of the filter's lag to compensate (1 = all of it). */
    this.lagCompensation = 0.8;
    /** Never extrapolate further than this, in ms. */
    this.maxPredictionMs = 120;
  }

  setParameters(minCutoff, beta) {
    this.fx.setParameters(minCutoff, beta);
    this.fy.setParameters(minCutoff, beta);
    this.fz.setParameters(minCutoff * this.depthScale, beta * this.depthScale);
  }

  /** Feed one raw sample (cm) taken at `t` (ms). */
  push(x, y, z, t) {
    this.value.x = this.fx.filter(x, t);
    this.value.y = this.fy.filter(y, t);
    this.value.z = this.fz.filter(z, t);
    this.lastSampleTime = t;
  }

  /** Smoothed position extrapolated to `now` (ms). Writes into and returns `out`. */
  predict(now, out) {
    const v = this.value;
    if (this.lastSampleTime === null) {
      out.x = v.x;
      out.y = v.y;
      out.z = v.z;
      return out;
    }
    const age = Math.max(now - this.lastSampleTime, 0) / 1000;
    const max = this.maxPredictionMs / 1000;
    const g = this.predictionGain;
    const k = this.lagCompensation;
    out.x = v.x + this.fx.velocity * Math.min((age + this.fx.lag * k) * g, max);
    out.y = v.y + this.fy.velocity * Math.min((age + this.fy.lag * k) * g, max);
    out.z = v.z + this.fz.velocity * Math.min((age + this.fz.lag * k) * g, max);
    return out;
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
    this.lastSampleTime = null;
  }
}
