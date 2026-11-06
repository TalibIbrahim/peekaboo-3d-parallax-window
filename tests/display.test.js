import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals for DisplayGeometry.
function setWindow({ inner = [1920, 1080], outer = inner, pos = [0, 0], screen = [1920, 1080], fullscreen = false } = {}) {
  globalThis.window = {
    innerWidth: inner[0],
    innerHeight: inner[1],
    outerWidth: outer[0],
    outerHeight: outer[1],
    screenX: pos[0],
    screenY: pos[1],
    screen: { width: screen[0], height: screen[1], availLeft: 0, availTop: 0 }
  };
  globalThis.document = { fullscreenElement: fullscreen ? {} : null };
}

const { DisplayGeometry } = await (setWindow(), import('../src/core/display.js'));

beforeEach(() => setWindow());

test('fullscreen 15.6" 16:9 panel is about 34.5 x 19.4 cm', () => {
  setWindow({ fullscreen: true });
  const d = new DisplayGeometry(15.6);
  assert.ok(Math.abs(d.W - 34.53) < 0.05, `W=${d.W}`);
  assert.ok(Math.abs(d.H - 19.42) < 0.05, `H=${d.H}`);
  assert.equal(d.offsetX, 0);
  assert.equal(d.offsetY, 0);
});

test('a smaller browser window keeps the physical scale of the screen', () => {
  setWindow({ inner: [960, 600], outer: [976, 700], pos: [0, 0] });
  const d = new DisplayGeometry(15.6);
  const cmPerPx = (15.6 * 2.54) / Math.hypot(1920, 1080);
  assert.ok(Math.abs(d.W - 960 * cmPerPx) < 1e-9);
  assert.ok(Math.abs(d.H - 600 * cmPerPx) < 1e-9);
});

test('window in the top-left corner is offset up and to the left of screen centre', () => {
  setWindow({ inner: [960, 540], outer: [960, 620], pos: [0, 0] });
  const d = new DisplayGeometry(15.6);
  assert.ok(d.offsetX < 0, `offsetX=${d.offsetX}`);
  assert.ok(d.offsetY > 0, `offsetY=${d.offsetY}`);
});

test('offsets can be switched off', () => {
  setWindow({ inner: [960, 540], outer: [960, 620], pos: [0, 0] });
  const d = new DisplayGeometry(15.6);
  d.trackWindowPosition = false;
  d.refresh(true);
  assert.equal(d.offsetX, 0);
  assert.equal(d.offsetY, 0);
});

test('diagonal <-> cm per px round trip (card calibration)', () => {
  const c = DisplayGeometry.cmPerPxForDiagonal(27);
  assert.ok(Math.abs(DisplayGeometry.diagonalForCmPerPx(c) - 27) < 1e-9);
});

test('listeners fire only when geometry actually changes', () => {
  const d = new DisplayGeometry(15.6);
  let calls = 0;
  d.onChange(() => calls++);
  d.refresh();
  assert.equal(calls, 0);
  d.setDiagonal(24);
  assert.equal(calls, 1);
});
