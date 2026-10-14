/**
 * Off-axis (asymmetric frustum) projection calculation.
 * 
 * In this projection, the physical screen acts as a fixed planar window
 * at z = 0 with dimensions screenW x screenH cm.
 * The viewer's eye is located at (eye.x, eye.y, eye.z) where eye.z > 0.
 * 
 * The camera position is set to the eye position, facing strictly along -Z
 * (camera quaternion is identity), and the projection frustum is skewed
 * so its borders intersect the four physical screen corners at z = 0.
 */

/**
 * Updates the given camera to render an off-axis view through the screen rectangle.
 * 
 * @param {THREE.Camera} camera - Three.js camera to configure
 * @param {{x: number, y: number, z: number}} eye - Eye position in centimeters relative to screen center
 * @param {number} screenW - Physical screen width in centimeters
 * @param {number} screenH - Physical screen height in centimeters
 * @param {number} [near=1] - Near clipping plane in centimeters
 * @param {number} [far=2000] - Far clipping plane in centimeters
 */
export function updateOffAxisCamera(camera, eye, screenW, screenH, near = 1, far = 2000) {
  // Clamp eye.z to a minimum of 15 cm to prevent near-plane math from blowing up or dividing by zero
  const eyeZ = Math.max(eye.z, 15.0);

  // Set camera position at eye, strictly facing -Z with zero rotation
  camera.position.set(eye.x, eye.y, eyeZ);
  camera.quaternion.identity();
  camera.updateMatrixWorld(true);

  // Compute frustum bounds at the near plane by projecting screen boundaries through the eye
  // Screen bounds: left = -screenW / 2, right = +screenW / 2, bottom = -screenH / 2, top = +screenH / 2
  const left   = (-screenW * 0.5 - eye.x) * near / eyeZ;
  const right  = ( screenW * 0.5 - eye.x) * near / eyeZ;
  const bottom = (-screenH * 0.5 - eye.y) * near / eyeZ;
  const top    = ( screenH * 0.5 - eye.y) * near / eyeZ;

  // Build the asymmetric projection matrix: makePerspective(left, right, top, bottom, near, far)
  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
