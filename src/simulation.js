export const TECHNIQUES = {
  blue: {
    title: 'Lapse: Blue',
    subtitle: 'The power to bring infinity into reality.',
    kanji: '蒼',
    color: '#54c9ff',
    rgb: '84,201,255',
    cooldown: 0.8,
    speed: 0.8,
    damage: 1,
  },
  red: {
    title: 'Reversal: Red',
    subtitle: 'Positive energy. Absolute repulsion.',
    kanji: '赫',
    color: '#ff676d',
    rgb: '255,103,109',
    cooldown: 1.1,
    speed: 1.05,
    damage: 2,
  },
  purple: {
    title: 'Hollow Purple',
    subtitle: 'When attraction and repulsion become one.',
    kanji: '茈',
    color: '#b196ff',
    rgb: '177,150,255',
    cooldown: 3.2,
    speed: 1.35,
    damage: 4,
  },
  domain: {
    title: 'Unlimited Void',
    subtitle: 'Everything. Everywhere. All at once.',
    kanji: '無量空処',
    color: '#e5e3ff',
    rgb: '229,227,255',
    cooldown: 5.5,
    speed: 0,
    damage: 5,
  },
};
export const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export function createSimulation() {
  return {
    time: 0,
    selected: 'blue',
    cooldown: 0,
    cast: null,
    shots: [],
    impacts: [],
    hits: 0,
    casts: 0,
    paused: false,
    origin: { x: 0.39, y: 0.51 },
    aim: { x: 0.83, y: 0.49 },
    hands: [],
    target: { x: 0.83, y: 0.49, health: 5, recovery: 0, flash: 0 },
    domain: 0,
  };
}
export function selectTechnique(s, key) {
  if (!TECHNIQUES[key]) return false;
  s.selected = key;
  return true;
}
export function castTechnique(s) {
  if (s.paused || s.cooldown > 0 || s.cast || s.domain > 0) return false;
  const technique = s.selected;
  s.cast = {
    technique,
    age: 0,
    origin: { ...s.origin },
    aim: { ...s.aim },
    handOrigins: s.hands.map((p) => ({ ...p })),
    released: false,
  };
  s.cooldown = TECHNIQUES[technique].cooldown;
  s.casts++;
  return true;
}
function hit(s, technique, point) {
  s.impacts.push({ ...point, technique, age: 0, duration: technique === 'purple' ? 1.6 : 0.9 });
  s.hits++;
  s.target.health = Math.max(0, s.target.health - TECHNIQUES[technique].damage);
  s.target.flash = 0.4;
  if (!s.target.health) s.target.recovery = 1.4;
}
export function updateSimulation(s, elapsed) {
  if (s.paused) return;
  // Split slow render frames into bounded steps; durations and travel stay independent of refresh rate.
  let remaining = Math.max(0, Math.min(elapsed, 0.1));
  while (remaining > 0.000001) {
    const dt = Math.min(remaining, 1 / 120);
    remaining -= dt;
    s.time += dt;
    s.cooldown = Math.max(0, s.cooldown - dt);
    s.target.flash = Math.max(0, s.target.flash - dt);
    if (s.target.recovery > 0) {
      s.target.recovery = Math.max(0, s.target.recovery - dt);
      if (!s.target.recovery) s.target.health = 5;
    }
    if (s.domain > 0) s.domain = Math.max(0, s.domain - dt);
    if (s.cast) {
      const c = s.cast;
      c.age += dt;
      const windup = c.technique === 'purple' ? 1.35 : c.technique === 'domain' ? 0.8 : 0.24;
      if (c.age >= windup && !c.released) {
        c.released = true;
        if (c.technique === 'domain') {
          s.domain = 3.6;
          hit(s, 'domain', s.target);
        } else {
          const dx = c.aim.x - c.origin.x,
            dy = c.aim.y - c.origin.y;
          const length = Math.hypot(dx, dy) || 1;
          s.shots.push({
            x: c.origin.x,
            y: c.origin.y,
            start: { ...c.origin },
            dx: dx / length,
            dy: dy / length,
            technique: c.technique,
            age: 0,
            trail: [],
          });
        }
      }
      if (c.age > windup + 0.22) s.cast = null;
    }
    for (let i = s.shots.length - 1; i >= 0; i--) {
      const p = s.shots[i];
      p.age += dt;
      const distance = TECHNIQUES[p.technique].speed * dt;
      const old = { x: p.x, y: p.y };
      p.x += p.dx * distance;
      p.y += p.dy * distance;
      p.trail.push(old);
      if (p.trail.length > 45) p.trail.shift();
      const vx = p.x - old.x,
        vy = p.y - old.y;
      const dot = clamp(
        ((s.target.x - old.x) * vx + (s.target.y - old.y) * vy) / (vx * vx + vy * vy || 1),
      );
      const separation = Math.hypot(old.x + vx * dot - s.target.x, old.y + vy * dot - s.target.y);
      if (s.target.health > 0 && separation < (p.technique === 'purple' ? 0.085 : 0.055)) {
        hit(s, p.technique, s.target);
        s.shots.splice(i, 1);
      } else if (p.x < -0.15 || p.x > 1.15 || p.y < -0.15 || p.y > 1.15 || p.age > 3) {
        s.impacts.push({
          x: clamp(p.x, 0.03, 0.97),
          y: clamp(p.y, 0.03, 0.97),
          technique: p.technique,
          age: 0,
          duration: 0.7,
        });
        s.shots.splice(i, 1);
      }
    }
    for (const effect of s.impacts) effect.age += dt;
    s.impacts = s.impacts.filter((effect) => effect.age < effect.duration);
  }
}
export function resetSimulation(s) {
  Object.assign(s, createSimulation(), { selected: s.selected });
}
