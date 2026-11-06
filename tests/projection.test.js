import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateOffAxisCamera } from '../src/projection.js';

const W = 34.5;
const H = 19.4;

function makeCamera(eye) {
  const cam = new THREE.PerspectiveCamera();
  updateOffAxisCamera(cam, eye, W, H, 1, 2000);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

function ndc(cam, x, y, z) {
  return new THREE.Vector3(x, y, z).project(cam);
}

const eyes = [
  { x: 0, y: 0, z: 55 },
  { x: -15, y: 6, z: 40 },
  { x: 22, y: -9, z: 80 },
  { x: 3, y: 12, z: 25 }
];

test('screen corners always map to the edges of the viewport', () => {
  for (const eye of eyes) {
    const cam = makeCamera(eye);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = ndc(cam, (sx * W) / 2, (sy * H) / 2, 0);
      assert.ok(Math.abs(p.x - sx) < 1e-9, `x for eye ${JSON.stringify(eye)}: ${p.x}`);
      assert.ok(Math.abs(p.y - sy) < 1e-9, `y for eye ${JSON.stringify(eye)}: ${p.y}`);
    }
  }
});

test('a point on the glass stays put as the viewer moves (it is a window)', () => {
  const ref = ndc(makeCamera(eyes[0]), 5.3, -2.1, 0);
  for (const eye of eyes.slice(1)) {
    const p = ndc(makeCamera(eye), 5.3, -2.1, 0);
    assert.ok(Math.abs(p.x - ref.x) < 1e-9 && Math.abs(p.y - ref.y) < 1e-9);
  }
});

test('like a real window: far things slide with you on the glass, pop-outs slide against you', () => {
  const left = makeCamera({ x: -10, y: 0, z: 55 });
  const right = makeCamera({ x: 10, y: 0, z: 55 });
  const behind = ndc(right, 0, 0, -30).x - ndc(left, 0, 0, -30).x;
  const front = ndc(right, 0, 0, 8).x - ndc(left, 0, 0, 8).x;
  assert.ok(behind > 0, 'objects behind the glass follow the viewer (less than 1:1)');
  assert.ok(front < 0, 'objects in front of the glass move opposite to the viewer');
  // At infinity the shift equals the head motion in screen space; here it is a fraction.
  const far = ndc(right, 0, 0, -2000).x - ndc(left, 0, 0, -2000).x;
  assert.ok(far > behind, 'further objects follow more closely');
});

test('camera looks straight down -Z with identity rotation', () => {
  const cam = makeCamera({ x: 12, y: -4, z: 50 });
  assert.deepEqual(cam.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(cam.position.toArray(), [12, -4, 50]);
});

test('eye too close to the glass is clamped rather than producing a degenerate frustum', () => {
  const cam = makeCamera({ x: 0, y: 0, z: 2 });
  assert.equal(cam.position.z, 15);
  assert.ok(cam.projectionMatrix.elements.every(Number.isFinite));
});
