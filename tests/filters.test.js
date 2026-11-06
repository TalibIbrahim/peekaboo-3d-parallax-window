import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneEuroFilter, HeadPoseFilter } from '../src/filters.js';

test('One Euro filter passes a constant signal through unchanged', () => {
  const f = new OneEuroFilter(1.0, 0.02);
  for (let i = 0; i < 100; i++) assert.equal(f.filter(42, i * 33), 42);
  assert.equal(f.velocity, 0);
});

test('One Euro filter reduces jitter', () => {
  const f = new OneEuroFilter(1.0, 0.0);
  let rawVar = 0;
  let outVar = 0;
  for (let i = 0; i < 600; i++) {
    const noise = Math.sin(i * 12.9898) * 0.5; // deterministic pseudo-noise
    const out = f.filter(10 + noise, i * 33);
    if (i > 60) {
      rawVar += noise * noise;
      outVar += (out - 10) ** 2;
    }
  }
  assert.ok(outVar < rawVar * 0.25, `filtered variance ${outVar} vs raw ${rawVar}`);
});

test('One Euro filter estimates velocity of a ramp', () => {
  const f = new OneEuroFilter(1.0, 0.02);
  for (let i = 0; i <= 120; i++) f.filter(i * 0.5, i * 33.333); // 15 units/s
  assert.ok(Math.abs(f.velocity - 15) < 1.0, `velocity ${f.velocity}`);
});

test('setParameters ignores invalid values', () => {
  const f = new OneEuroFilter(1.0, 0.02);
  f.setParameters(NaN, -1);
  assert.equal(f.minCutoff, 1.0);
  assert.equal(f.beta, 0.02);
});

test('HeadPoseFilter prediction cancels most latency on steady motion', () => {
  const withPrediction = new HeadPoseFilter({ minCutoff: 1.0, beta: 0.02 });
  const without = new HeadPoseFilter({ minCutoff: 1.0, beta: 0.02 });
  without.predictionGain = 0;
  const speed = 20; // cm/s sideways head movement
  const out = { x: 0, y: 0, z: 0 };
  let errPred = 0;
  let errRaw = 0;
  for (let i = 0; i < 90; i++) {
    const t = i * 33.333; // 30 fps camera
    withPrediction.push((speed * t) / 1000, 0, 60, t);
    without.push((speed * t) / 1000, 0, 60, t);
    const renderTime = t + 25; // frame drawn 25 ms after the sample was taken
    const truth = (speed * renderTime) / 1000;
    if (i > 30) {
      errPred += Math.abs(withPrediction.predict(renderTime, out).x - truth);
      errRaw += Math.abs(without.predict(renderTime, out).x - truth);
    }
  }
  assert.ok(errPred < errRaw * 0.5, `prediction error ${errPred.toFixed(2)} vs none ${errRaw.toFixed(2)}`);
});

test('HeadPoseFilter never extrapolates past maxPredictionMs', () => {
  const f = new HeadPoseFilter();
  for (let i = 0; i < 30; i++) f.push(i, 0, 60, i * 33.333);
  const out = { x: 0, y: 0, z: 0 };
  const soon = f.predict(1000 + 50, out).x;
  const muchLater = f.predict(1000 + 5000, out).x;
  assert.equal(soon, muchLater);
});
