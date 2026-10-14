import { FilesetResolver, FaceLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MEDIAPIPE_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_ASSET_PATH = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class HeadTracker {
  constructor(options = {}) {
    this.hfovDeg = options.hfovDeg ?? 65.0;
    this.ipdCm = options.ipdCm ?? 6.3;
    this.webcamOffsetX = options.webcamOffsetX ?? 0.0; // cm
    this.webcamOffsetY = options.webcamOffsetY ?? 11.0; // cm (camera sits ~11cm above screen center)

    this.video = null;
    this.landmarker = null;
    this.isInitialized = false;
    this.isRunning = false;

    this.lastVideoTime = -1;
    this.lastDetectionTime = 0;
    this.faceFound = false;

    // Estimated camera-relative and screen-relative head positions
    this.rawCameraPos = { x: 0, y: 0, z: 55 };
    this.headPosition = { x: 0, y: 0, z: 55 };
    this.defaultRestPosition = { x: 0, y: 0, z: 55 };

    // Debug & stats tracking
    this.irisPoints = null; // [leftIrisPx, rightIrisPx]
    this.trackerFps = 0;
    this.trackerFrameCount = 0;
    this.lastFpsUpdateTime = performance.now();
  }

  /**
   * Initializes the webcam and MediaPipe FaceLandmarker.
   * MUST be called inside or after a user gesture.
   */
  async start() {
    // 1. Setup hidden video element
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('muted', '');
    this.video.muted = true;
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    // 2. Request user webcam stream
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });
    } catch (mediaError) {
      if (mediaError.name === 'NotAllowedError' || mediaError.name === 'PermissionDeniedError') {
        throw new Error('Webcam permission denied. Please allow camera access in your browser settings.');
      } else if (mediaError.name === 'NotFoundError' || mediaError.name === 'DevicesNotFoundError') {
        throw new Error('No camera found on your device.');
      } else {
        throw new Error(`Camera access error: ${mediaError.message || mediaError.name}`);
      }
    }

    this.video.srcObject = stream;
    await new Promise((resolve) => {
      this.video.onloadedmetadata = () => {
        this.video.play().then(resolve);
      };
    });

    // 3. Initialize MediaPipe Vision Tasks
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
    } catch (wasmError) {
      throw new Error(`Failed to load MediaPipe WASM runtime: ${wasmError.message}`);
    }

    // Try GPU delegate first, fallback to CPU if it fails
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_PATH,
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1
      });
    } catch (gpuError) {
      console.warn('FaceLandmarker GPU delegate failed; falling back to CPU:', gpuError);
      try {
        this.landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_ASSET_PATH,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numFaces: 1
        });
      } catch (cpuError) {
        throw new Error(`Failed to initialize FaceLandmarker model: ${cpuError.message}`);
      }
    }

    this.isInitialized = true;
    this.isRunning = true;
    this.lastDetectionTime = performance.now();
  }

  /**
   * Recenter calibration: sets offsets so current head position maps to (0, 0).
   */
  recenter() {
    if (this.rawCameraPos) {
      this.webcamOffsetX = this.rawCameraPos.x;
      this.webcamOffsetY = -this.rawCameraPos.y;
      return {
        offsetX: this.webcamOffsetX,
        offsetY: this.webcamOffsetY
      };
    }
    return null;
  }

  /**
   * Updates head tracking. Call this on every requestAnimationFrame.
   * 
   * @param {number} screenW - Current screen width in cm
   * @param {number} screenH - Current screen height in cm
   * @returns {{
   *   position: {x: number, y: number, z: number},
   *   faceFound: boolean,
   *   irisPoints: Array<{x: number, y: number}>|null,
   *   trackerFps: number,
   *   video: HTMLVideoElement|null
   * }}
   */
  update(screenW, screenH) {
    const now = performance.now();

    // Measure tracker FPS
    if (now - this.lastFpsUpdateTime >= 1000) {
      this.trackerFps = Math.round((this.trackerFrameCount * 1000) / (now - this.lastFpsUpdateTime));
      this.trackerFrameCount = 0;
      this.lastFpsUpdateTime = now;
    }

    if (!this.isRunning || !this.video || !this.landmarker || this.video.readyState < 2) {
      this._handleNoFace(now, screenW, screenH);
      return this._formatOutput();
    }

    // Only run inference when a new video frame is ready
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      this.trackerFrameCount++;

      try {
        const results = this.landmarker.detectForVideo(this.video, now);
        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
          this._processLandmarks(results.faceLandmarks[0], screenW, screenH);
          this.lastDetectionTime = now;
          this.faceFound = true;
        } else {
          this._handleNoFace(now, screenW, screenH);
        }
      } catch (detectErr) {
        console.warn('FaceLandmarker detection error:', detectErr);
        this._handleNoFace(now, screenW, screenH);
      }
    } else {
      // If frame didn't change, check timeout
      if (now - this.lastDetectionTime > 500) {
        this._handleNoFace(now, screenW, screenH);
      }
    }

    return this._formatOutput();
  }

  _processLandmarks(landmarks, screenW, screenH) {
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;

    let leftIrisNorm, rightIrisNorm;

    // Landmark 468 is left iris center, 473 is right iris center
    if (landmarks.length >= 478 && landmarks[468] && landmarks[473]) {
      leftIrisNorm = landmarks[468];
      rightIrisNorm = landmarks[473];
    } else if (landmarks[33] && landmarks[263]) {
      // Fallback: Eye corners (33 = left outer, 263 = right outer)
      leftIrisNorm = landmarks[33];
      rightIrisNorm = landmarks[263];
    } else {
      return;
    }

    // Convert normalized coordinates [0..1] to actual video pixel dimensions
    const leftPx = { x: leftIrisNorm.x * vw, y: leftIrisNorm.y * vh };
    const rightPx = { x: rightIrisNorm.x * vw, y: rightIrisNorm.y * vh };
    this.irisPoints = [leftPx, rightPx];

    // Compute inter-pupillary distance in video pixels
    const ipdPx = Math.max(Math.hypot(leftPx.x - rightPx.x, leftPx.y - rightPx.y), 1.0);

    // Pinhole camera focal length in pixels based on horizontal FOV
    const hfovRad = (this.hfovDeg * Math.PI) / 180.0;
    const fPx = (vw * 0.5) / Math.tan(hfovRad * 0.5);

    // Depth Z in cm: Z = f_px * ipd_cm / ipd_px
    const rawZ = (fPx * this.ipdCm) / ipdPx;

    // Midpoint between eyes in video pixels
    const midPx = {
      x: (leftPx.x + rightPx.x) * 0.5,
      y: (leftPx.y + rightPx.y) * 0.5
    };

    // Calculate X and Y in webcam coordinates (in cm):
    // X is negated because the webcam image is mirrored relative to real-world movement
    // Y is negated because video pixel y increases downward while Three.js +Y is up
    const rawX = -((midPx.x - vw * 0.5) * rawZ) / fPx;
    const rawY = -((midPx.y - vh * 0.5) * rawZ) / fPx;

    this.rawCameraPos = { x: rawX, y: rawY, z: rawZ };

    // Convert to screen-centered coordinates:
    // User looking at screen center has head below webcam: Y_cam ≈ -webcamOffsetY.
    // Adding webcamOffsetY brings screenY to ~0.
    const screenX = rawX - this.webcamOffsetX;
    const screenY = rawY + this.webcamOffsetY;

    // Clamp values as specified
    const clampedZ = Math.min(Math.max(rawZ, 20.0), 120.0);
    const clampedX = Math.min(Math.max(screenX, -screenW), screenW);
    const clampedY = Math.min(Math.max(screenY, -screenH), screenH);

    this.headPosition.x = clampedX;
    this.headPosition.y = clampedY;
    this.headPosition.z = clampedZ;
  }

  _handleNoFace(now, screenW, screenH) {
    const elapsedSinceDetection = now - this.lastDetectionTime;
    if (elapsedSinceDetection > 500) {
      this.faceFound = false;
      this.irisPoints = null;

      // Slowly ease toward (0, 0, 55) over ~2 seconds
      // Using smooth exponential decay factor ~0.03 per frame (~60fps)
      const ease = 0.03;
      this.headPosition.x += (this.defaultRestPosition.x - this.headPosition.x) * ease;
      this.headPosition.y += (this.defaultRestPosition.y - this.headPosition.y) * ease;
      this.headPosition.z += (this.defaultRestPosition.z - this.headPosition.z) * ease;
    }
  }

  _formatOutput() {
    return {
      position: { ...this.headPosition },
      rawCamera: { ...this.rawCameraPos },
      faceFound: this.faceFound,
      irisPoints: this.irisPoints,
      trackerFps: this.trackerFps,
      video: this.video
    };
  }

  destroy() {
    this.isRunning = false;
    if (this.video && this.video.srcObject) {
      const tracks = this.video.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      this.video.remove();
      this.video = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }
}
