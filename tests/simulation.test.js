import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimulation,
  updateSimulation,
  selectTechnique,
  castTechnique,
  resetSimulation,
} from '../src/simulation.js';
import { classifyHand, PositionFilter, GestureController } from '../src/gestures.js';
import { parseVoice } from '../src/voice.js';
import { coverPoint } from '../src/tracking.js';
const advance = (s, seconds, hz = 60) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) updateSimulation(s, 1 / hz);
};
function hand(pose = 'blue', x = 0.5) {
  const p = Array.from({ length: 21 }, () => ({ x, y: 0.7, z: 0 }));
  p[0] = { x, y: 0.9, z: 0 };
  for (let f = 0; f < 4; f++) {
    const m = 5 + f * 4,
      px = x - 0.1 + f * 0.065;
    p[m] = { x: px, y: 0.7, z: 0 };
    p[m + 1] = { x: px, y: 0.59, z: 0 };
    p[m + 2] = { x: px, y: 0.63, z: 0 };
    p[m + 3] = { x: px, y: 0.73, z: 0 };
  }
  const raised =
    pose === 'red' ? [8, 12, 16, 20] : pose === 'domain' ? [8, 12] : pose === 'blue' ? [8] : [];
  for (const tip of raised) {
    p[tip - 1].y = 0.43;
    p[tip].y = 0.3;
  }
  p[4] = { x: x - 0.2, y: 0.55, z: 0 };
  return p;
}
test('all techniques release, hit the target and spend cooldown', () => {
  for (const key of ['blue', 'red', 'purple', 'domain']) {
    const s = createSimulation();
    selectTechnique(s, key);
    assert.ok(castTechnique(s));
    assert.equal(castTechnique(s), false);
    advance(s, 2.5);
    assert.equal(s.hits, 1, key);
    assert.equal(s.casts, 1);
  }
});
test('timing and travel match at 30, 60 and 144 Hz', () => {
  const outcomes = [30, 60, 144].map((hz) => {
    const s = createSimulation();
    selectTechnique(s, 'purple');
    castTechnique(s);
    advance(s, 1.5, hz);
    return s;
  });
  for (const s of outcomes) {
    assert.ok(Math.abs(s.time - 1.5) < 0.00001);
    assert.ok(Math.abs(s.cooldown - 1.7) < 0.00001);
  }
  assert.ok(Math.abs(outcomes[0].shots[0].x - outcomes[2].shots[0].x) < 0.012);
});
test('pause freezes cast, domain, target and cooldown timers', () => {
  const s = createSimulation();
  castTechnique(s);
  s.paused = true;
  const before = JSON.stringify(s);
  advance(s, 1);
  assert.equal(JSON.stringify(s), before);
  assert.equal(castTechnique(s), false);
});
test('reset clears projectiles, damage and counters and preserves selection', () => {
  const s = createSimulation();
  selectTechnique(s, 'red');
  castTechnique(s);
  advance(s, 1);
  resetSimulation(s);
  assert.equal(s.selected, 'red');
  assert.equal(s.hits, 0);
  assert.equal(s.target.health, 5);
  assert.equal(s.cast, null);
  assert.deepEqual(s.shots, []);
});
test('off-target projectiles do not award a hit and eventually expire', () => {
  const s = createSimulation();
  s.aim = { x: 0.1, y: 0.1 };
  castTechnique(s);
  advance(s, 4);
  assert.equal(s.hits, 0);
  assert.equal(s.shots.length, 0);
});
test('target regenerates after a high-damage technique', () => {
  const s = createSimulation();
  selectTechnique(s, 'domain');
  castTechnique(s);
  advance(s, 1);
  assert.equal(s.target.health, 0);
  advance(s, 2);
  assert.equal(s.target.health, 5);
});
test('invalid technique keys do not mutate selection', () => {
  const s = createSimulation();
  assert.equal(selectTechnique(s, 'evil'), false);
  assert.equal(s.selected, 'blue');
});
test('finger poses classify as Blue, Red and Void', () => {
  for (const pose of ['blue', 'red', 'domain']) assert.equal(classifyHand(hand(pose)).pose, pose);
  assert.equal(classifyHand([]), null);
  const bad = hand();
  bad[8].x = NaN;
  assert.equal(classifyHand(bad), null);
});
test('tracking filter smooths jitter but reacquires after a lost hand', () => {
  const f = new PositionFilter();
  f.update({ x: 0.5, y: 0.5 }, 0);
  const filtered = f.update({ x: 0.51, y: 0.49 }, 80);
  assert.ok(filtered.x > 0.5 && filtered.x < 0.51);
  assert.ok(filtered.y < 0.5 && filtered.y > 0.49);
  assert.deepEqual(f.update({ x: 0.9, y: 0.1 }, 800), { x: 0.9, y: 0.1 });
});
test('gesture selection requires a stable hold and domain only casts once per hold', () => {
  const g = new GestureController();
  assert.equal(g.update([hand()], 0).select, null);
  assert.equal(g.update([hand()], 300).select, 'blue');
  g.update([hand('domain')], 500);
  assert.equal(g.update([hand('domain')], 1000).cast, false);
  const domain = g.update([hand('domain')], 1400);
  assert.equal(domain.select, 'domain');
  assert.equal(domain.cast, true);
  assert.equal(g.update([hand('domain')], 2400).cast, false);
  g.update([], 2500);
  g.update([hand('domain')], 2600);
  assert.equal(g.update([hand('domain')], 3500).cast, true);
});
test('pinch hysteresis prevents repeated casts until released', () => {
  const g = new GestureController();
  g.update([hand()], 0);
  const p = hand();
  p[4] = { ...p[8] };
  assert.equal(g.update([p], 100).cast, true);
  for (let timestamp = 180; timestamp <= 980; timestamp += 80)
    assert.equal(g.update([p], timestamp).cast, false);
  g.update([hand()], 1100);
  assert.equal(g.update([p], 1180).cast, true);
});
test('hand identities survive reversed detector ordering', () => {
  const g = new GestureController();
  const first = g.update([hand('blue', 0.3), hand('red', 0.7)], 0);
  const next = g.update([hand('red', 0.7), hand('blue', 0.3)], 80);
  assert.equal(first.hands[0].id, next.hands[1].id);
  assert.equal(first.hands[1].id, next.hands[0].id);
});
test('invalid/no hands clear tracking without leaving stale gestures', () => {
  const g = new GestureController();
  g.update([hand()], 0);
  assert.equal(g.update([], 500).hands.length, 0);
  assert.equal(g.pose, null);
  g.reset();
  assert.equal(g.tracks.length, 0);
});
test('voice commands use word boundaries and recognize aliases', () => {
  assert.equal(parseVoice('Hollow purple!'), 'purple');
  assert.equal(parseVoice('domain expansion'), 'domain');
  assert.equal(parseVoice('Blue'), 'blue');
  assert.equal(parseVoice('aka'), 'red');
  assert.equal(parseVoice('already prepared'), null);
  assert.equal(parseVoice('stop'), 'reset');
});
test('camera projection mirrors and respects object-fit cover crop', () => {
  assert.deepEqual(coverPoint({ x: 0.5, y: 0.5 }, 320, 240, 640, 480), { x: 160, y: 120 });
  assert.equal(coverPoint({ x: 0, y: 0.5 }, 320, 240, 640, 480).x, 320);
  assert.deepEqual(coverPoint({ x: 0.5, y: 0.5 }, 400, 200, 640, 480), { x: 200, y: 100 });
});

test('reacquiring a pinched hand does not fire a phantom projectile', () => {
  const g = new GestureController();
  const p = hand();
  p[4] = { ...p[8] };
  assert.equal(g.update([p], 0).cast, false);
  assert.equal(g.update([p], 1000).cast, false);
});
