import { clamp } from './simulation.js';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
export function classifyHand(lm) {
  if (!lm || lm.length !== 21 || lm.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return null;
  const palm = Math.max(0.02, dist(lm[5], lm[17]));
  const extended = [8, 12, 16, 20].map(
    (tip) =>
      dist(lm[tip], lm[0]) > dist(lm[tip - 2], lm[0]) * 1.16 &&
      dist(lm[tip], lm[tip - 3]) > dist(lm[tip - 2], lm[tip - 3]) * 1.35,
  );
  const pose = extended.every(Boolean)
    ? 'red'
    : extended[0] && extended[1] && !extended[2] && !extended[3]
      ? 'domain'
      : extended[0] && !extended[1] && !extended[2] && !extended[3]
        ? 'blue'
        : null;
  return {
    pose,
    pinch: dist(lm[4], lm[8]) / palm,
    point: { x: 1 - lm[8].x, y: lm[8].y },
    direction: { x: lm[6].x - lm[8].x, y: lm[8].y - lm[6].y },
  };
}
export class PositionFilter {
  constructor() {
    this.value = null;
    this.timestamp = 0;
  }
  update(point, timestamp) {
    if (!this.value || timestamp - this.timestamp > 350) {
      this.value = { ...point };
      this.timestamp = timestamp;
      return { ...point };
    }
    const dt = clamp((timestamp - this.timestamp) / 1000, 0.001, 0.15);
    const speed = Math.hypot(point.x - this.value.x, point.y - this.value.y) / dt;
    const alpha = 1 - Math.exp(-2 * Math.PI * (1.8 + speed * 5) * dt);
    this.value.x += (point.x - this.value.x) * alpha;
    this.value.y += (point.y - this.value.y) * alpha;
    this.timestamp = timestamp;
    return { ...this.value };
  }
}
export class GestureController {
  constructor() {
    this.tracks = [];
    this.nextId = 1;
    this.lastCast = -Infinity;
    this.pose = null;
    this.poseSince = 0;
    this.firedDomain = false;
  }
  update(landmarks, timestamp) {
    const candidates = (landmarks || [])
      .map((lm) => ({ lm, data: classifyHand(lm) }))
      .filter((x) => x.data)
      .slice(0, 2);
    const used = new Set();
    const hands = candidates.map(({ lm, data }) => {
      let track = this.tracks
        .filter((t) => !used.has(t.id))
        .sort((a, b) => dist(a.point, data.point) - dist(b.point, data.point))[0];
      if (!track || timestamp - track.timestamp > 350 || dist(track.point, data.point) > 0.45)
        track = { id: this.nextId++, filter: new PositionFilter(), pinched: data.pinch < 0.3 };
      used.add(track.id);
      const wasPinched = track.pinched;
      track.pinched = data.pinch < (wasPinched ? 0.5 : 0.3);
      Object.assign(track, {
        point: track.filter.update(data.point, timestamp),
        timestamp,
        landmarks: lm,
        data,
      });
      return { ...track, pinchEdge: track.pinched && !wasPinched };
    });
    this.tracks = hands;
    let pose =
      hands.length === 2 &&
      hands.every((h) => h.pinched) &&
      dist(hands[0].point, hands[1].point) < 0.3
        ? 'purple'
        : hands.find((h) => h.data.pose)?.data.pose || null;
    if (pose !== this.pose) {
      this.pose = pose;
      this.poseSince = timestamp;
      this.firedDomain = false;
    }
    const held = (timestamp - this.poseSince) / 1000;
    const select = pose && pose !== 'domain' && held >= 0.25 ? pose : null;
    let cast = hands.some((h) => h.pinchEdge) && timestamp - this.lastCast > 750;
    if (pose === 'purple') cast = held > 0.4 && timestamp - this.lastCast > 3200;
    if (pose === 'domain') {
      cast = held >= 0.85 && !this.firedDomain;
      if (cast) this.firedDomain = true;
    }
    if (cast) this.lastCast = timestamp;
    return {
      hands,
      select: pose === 'domain' && cast ? 'domain' : select,
      cast,
      pose,
      progress: pose === 'domain' ? clamp(held / 0.85) : clamp(held / 0.25),
    };
  }
  reset() {
    this.tracks = [];
    this.pose = null;
    this.poseSince = 0;
    this.firedDomain = false;
  }
}
