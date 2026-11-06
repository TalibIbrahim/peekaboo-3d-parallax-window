import { FilesetResolver, FaceLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MEDIAPIPE_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_ASSET_PATH = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// FaceLandmarker mesh indices
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_OUTER = 263;
const RIGHT_EYE_INNER = 362;

/**
 * Webcam head tracker.
 *
 * Runs MediaPipe FaceLandmarker once per *camera* frame (via
 * requestVideoFrameCallback where available) instead of once per *render*
 * frame, so inference never stalls rendering on frames where there is no new
 * image, and every sample carries the timestamp of the frame it came from.
 *
 * Output samples are in centimetres, in webcam space: origin at the camera
 * lens, +X to the viewer's right as seen by the screen, +Y up, +Z out of the
 * screen toward the viewer.
 */
export class HeadTracker {
  constructor(options = {}) {
    this.hfovDeg = options.hfovDeg ?? 65.0;
    this.ipdCm = options.ipdCm ?? 6.3;

    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.isRunning = false;
    this.delegate = null;

    this.faceFound = false;
    this.lastFaceTime = 0;
    this.irisPoints = null;

    /** Latest sample in webcam space. `seq` increments on every new face sample. */
    this.sample = { x: 0, y: 0, z: 55, t: 0, seq: 0 };

    this.trackerFps = 0;
    this.inferenceMs = 0;
    this._frames = 0;
    this._fpsWindowStart = performance.now();
    this._lastVideoTime = -1;
    this._lastTimestamp = 0;
    this._rafId = 0;
    this._vfcId = 0;
  }

  /**
   * Starts the webcam and the landmarker. Must be called from a user gesture.
   * @param {(stage: string) => void} [onStage] progress callback for the UI
   */
  async start(onStage = () => {}) {
    if (this.isRunning) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not expose a camera API. Use a recent Chrome, Edge, Firefox or Safari over HTTPS or localhost.');
    }

    onStage('Requesting camera…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: 'user' },
        audio: false
      });
    } catch (err) {
      throw new Error(describeMediaError(err));
    }

    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.srcObject = this.stream;
    this.video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(this.video);

    // Load the model while the camera warms up.
    onStage('Loading face model…');
    const landmarkerPromise = this._createLandmarker();
    await this.video.play().catch(() => {});
    if (this.video.readyState < 2) {
      await new Promise((resolve) => this.video.addEventListener('loadeddata', resolve, { once: true }));
    }

    try {
      this.landmarker = await landmarkerPromise;
    } catch (err) {
      this.stop();
      throw err;
    }

    this.isRunning = true;
    this._scheduleNextFrame();
  }

  async _createLandmarker() {
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
    } catch (err) {
      throw new Error(`Could not download the MediaPipe runtime (${err.message}). Check your connection.`);
    }

    const make = (delegate) => FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    try {
      const lm = await make('GPU');
      this.delegate = 'GPU';
      return lm;
    } catch (gpuErr) {
      console.warn('[Tracker] GPU delegate unavailable, falling back to CPU:', gpuErr);
      try {
        const lm = await make('CPU');
        this.delegate = 'CPU';
        return lm;
      } catch (cpuErr) {
        throw new Error(`Could not initialise face tracking: ${cpuErr.message}`);
      }
    }
  }

  _scheduleNextFrame() {
    if (!this.isRunning) return;
    if (this.video.requestVideoFrameCallback) {
      this._vfcId = this.video.requestVideoFrameCallback(() => this._onFrame());
    } else {
      this._rafId = requestAnimationFrame(() => this._onFrame());
    }
  }

  _onFrame() {
    if (!this.isRunning) return;
    const video = this.video;

    if (video.readyState >= 2 && video.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = video.currentTime;
      // detectForVideo requires strictly increasing timestamps.
      const now = Math.max(performance.now(), this._lastTimestamp + 0.001);
      this._lastTimestamp = now;

      try {
        const result = this.landmarker.detectForVideo(video, now);
        this.inferenceMs = this.inferenceMs * 0.9 + (performance.now() - now) * 0.1;
        const face = result?.faceLandmarks?.[0];
        if (face && this._processLandmarks(face, now)) {
          this.faceFound = true;
          this.lastFaceTime = now;
        } else {
          this.faceFound = false;
          this.irisPoints = null;
        }
      } catch (err) {
        console.warn('[Tracker] Detection error:', err);
      }

      this._frames++;
      const elapsed = now - this._fpsWindowStart;
      if (elapsed >= 1000) {
        this.trackerFps = Math.round((this._frames * 1000) / elapsed);
        this._frames = 0;
        this._fpsWindowStart = now;
      }
    }

    this._scheduleNextFrame();
  }

  _processLandmarks(lm, timestamp) {
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;

    let left;
    let right;
    if (lm.length > RIGHT_IRIS) {
      left = lm[LEFT_IRIS];
      right = lm[RIGHT_IRIS];
    } else if (lm.length > RIGHT_EYE_OUTER) {
      // No iris refinement: use the centre of each eye's corners.
      left = midpoint(lm[LEFT_EYE_OUTER], lm[LEFT_EYE_INNER]);
      right = midpoint(lm[RIGHT_EYE_OUTER], lm[RIGHT_EYE_INNER]);
    } else {
      return false;
    }

    const lx = left.x * vw;
    const ly = left.y * vh;
    const rx = right.x * vw;
    const ry = right.y * vh;
    this.irisPoints = [{ x: lx, y: ly }, { x: rx, y: ry }];

    // Inter-pupillary distance in pixels. Landmark z shares x's scale (image
    // width), so including it makes the measurement robust to head yaw: turning
    // your head no longer shrinks the 2D distance and throws you "backwards".
    const dz = (left.z - right.z) * vw;
    const ipdPx = Math.max(Math.hypot(lx - rx, ly - ry, dz), 1);

    // Pinhole model.
    const fPx = (vw * 0.5) / Math.tan((this.hfovDeg * Math.PI) / 360);
    const z = (fPx * this.ipdCm) / ipdPx;
    if (!Number.isFinite(z) || z < 10 || z > 300) return false;

    const mx = (lx + rx) * 0.5;
    const my = (ly + ry) * 0.5;
    // The camera image is un-mirrored: the viewer moving to their right moves
    // left in the image, hence the negated X. Image Y grows downward.
    const s = this.sample;
    s.x = -((mx - vw * 0.5) * z) / fPx;
    s.y = -((my - vh * 0.5) * z) / fPx;
    s.z = z;
    s.t = timestamp;
    s.seq++;
    return true;
  }

  stop() {
    this.isRunning = false;
    if (this._vfcId && this.video?.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this._vfcId);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.faceFound = false;
    this.irisPoints = null;
    this.trackerFps = 0;
  }
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function describeMediaError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access for this site (the icon in the address bar), then try again — or use mouse mode.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Plug one in and try again, or use mouse mode.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is in use by another application. Close it and try again.';
    case 'SecurityError':
      return 'Camera access requires HTTPS (or localhost).';
    default:
      return `Camera error: ${err?.message || err?.name || 'unknown'}`;
  }
}
