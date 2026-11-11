import { TECHNIQUES, clamp } from './simulation.js';
const TAU = Math.PI * 2;
const fract = (n) => n - Math.floor(n);
const rand = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const ease = (n) => 1 - (1 - clamp(n)) ** 3;
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.width = 0;
    this.height = 0;
    this.quality = 'balanced';
    this.reduced = false;
    this.glows = new Map();
  }
  resize(width, height, ratio = devicePixelRatio || 1) {
    const cap = this.quality === 'high' ? 2 : this.quality === 'low' ? 1 : 1.5;
    this.ratio = Math.min(cap, ratio);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.ratio);
    this.canvas.height = Math.round(height * this.ratio);
  }
  glow(x, y, radius, rgb, alpha = 0.5) {
    const c = this.ctx,
      r = Math.max(1, radius);
    let stamp = this.glows.get(rgb);
    if (!stamp) {
      stamp = document.createElement('canvas');
      stamp.width = stamp.height = 192;
      const gctx = stamp.getContext('2d');
      const gradient = gctx.createRadialGradient(96, 96, 0, 96, 96, 96);
      gradient.addColorStop(0, `rgba(${rgb},1)`);
      gradient.addColorStop(0.3, `rgba(${rgb},.35)`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      gctx.fillStyle = gradient;
      gctx.fillRect(0, 0, 192, 192);
      this.glows.set(rgb, stamp);
    }
    c.save();
    c.globalAlpha *= alpha;
    c.drawImage(stamp, x - r, y - r, r * 2, r * 2);
    c.restore();
  }
  line(points, color, width = 1) {
    const c = this.ctx;
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  circle(x, y, radius, color, width = 1) {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, Math.max(0.1, radius), 0, TAU);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  orb(x, y, kind, t, strength = 1, scale = 1) {
    const c = this.ctx,
      info = TECHNIQUES[kind] || TECHNIQUES.purple;
    const r = Math.min(this.width, this.height) * 0.067 * scale;
    const slow = this.reduced ? t * 0.2 : t;
    c.save();
    c.globalCompositeOperation = 'lighter';
    this.glow(x, y, r * 5.2, info.rgb, 0.18 * strength);
    this.glow(x, y, r * 2.3, info.rgb, 0.35 * strength);
    const count = this.quality === 'low' ? 18 : this.quality === 'high' ? 65 : 36;
    for (let i = 0; i < count; i++) {
      const seed = rand(i + 13),
        phase = fract(slow * (kind === 'blue' ? 0.24 : -0.3) + seed);
      const distance = r * (1 + phase * 4.5),
        angle = seed * TAU * 9 + slow * (0.4 + seed) + phase * 1.4;
      const endAngle = angle + (kind === 'blue' ? -0.15 : 0.05),
        endDist = distance + (kind === 'blue' ? r * 0.35 : -r * 0.23);
      const alpha = (1 - phase) * 0.55 * strength;
      this.line(
        [
          { x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance * 0.73 },
          { x: x + Math.cos(endAngle) * endDist, y: y + Math.sin(endAngle) * endDist * 0.73 },
        ],
        `rgba(${info.rgb},${alpha})`,
        i % 5 === 0 ? 1.5 : 0.6,
      );
    }
    // Tilted orbital ribbons create a three-dimensional, rotating volume.
    for (let i = 0; i < (this.quality === 'high' ? 9 : 5); i++) {
      c.save();
      c.translate(x, y);
      c.rotate(slow * (0.28 + i * 0.025) * (i % 2 ? 1 : -1) + i * 1.5);
      c.beginPath();
      c.ellipse(
        0,
        0,
        r * (1.25 + i * 0.095),
        r * (0.27 + i * 0.045),
        0,
        slow * 0.35 + i,
        slow * 0.35 + i + Math.PI * (i % 3 ? 1.4 : 0.7),
      );
      c.strokeStyle = `rgba(${info.rgb},${0.28 + (i % 3) * 0.14})`;
      c.lineWidth = i % 3 ? 0.7 : 1.8;
      c.shadowBlur = 0;
      c.shadowColor = info.color;
      c.stroke();
      c.restore();
    }
    if (kind === 'red') {
      for (let i = 0; i < 13; i++) {
        const a = (i * TAU) / 13 + slow * 0.13;
        const length = r * (1.8 + Math.sin(slow * 3 + i) * 0.5);
        this.line(
          [
            { x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.5 },
            { x: x + Math.cos(a + 0.05) * length, y: y + Math.sin(a + 0.05) * length },
          ],
          'rgba(255,90,96,.4)',
          i % 3 === 0 ? 2 : 0.6,
        );
      }
    }
    c.globalCompositeOperation = 'source-over';
    const core = c.createRadialGradient(x - r * 0.18, y - r * 0.23, 0, x, y, r);
    if (kind === 'blue') {
      core.addColorStop(0, '#010913');
      core.addColorStop(0.43, '#021024');
      core.addColorStop(0.67, '#093b71');
      core.addColorStop(0.8, '#8ae8ff');
      core.addColorStop(0.86, '#e8fbff');
      core.addColorStop(0.95, '#1683d6');
      core.addColorStop(1, '#116aaa00');
    } else if (kind === 'red') {
      core.addColorStop(0, '#fffdf0');
      core.addColorStop(0.25, '#ffe5d8');
      core.addColorStop(0.51, '#ff8b8c');
      core.addColorStop(0.74, '#db243f');
      core.addColorStop(1, '#fd3c6400');
    } else {
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.22, '#f4dfff');
      core.addColorStop(0.55, '#c090ff');
      core.addColorStop(0.8, '#7c3eff');
      core.addColorStop(1, '#7829f000');
    }
    c.fillStyle = core;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
    if (kind === 'blue') {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.translate(x, y);
      c.rotate(-0.35);
      c.beginPath();
      c.ellipse(0, 0, r * 2.25, r * 0.15, 0, 0, TAU);
      c.strokeStyle = '#6edfff80';
      c.lineWidth = 2;
      c.shadowBlur = 0;
      c.shadowColor = '#63cfff';
      c.stroke();
      c.restore();
    }
    // Short, branching energy arcs. Their positions evolve smoothly, never randomly flicker per frame.
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const angle = (i * TAU) / 6 + slow * 0.23;
      const points = [];
      for (let j = 0; j < 7; j++) {
        const d = r * (1.05 + j * 0.21),
          a = angle + Math.sin(slow * 4 + i * 7 + j * 2) * 0.12;
        points.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.9 });
      }
      this.line(points, `rgba(${info.rgb},.55)`, 0.8);
    }
    c.restore();
  }
  background(s) {
    const c = this.ctx,
      w = this.width,
      h = this.height,
      color = TECHNIQUES[s.selected].rgb;
    const x = s.origin.x * w,
      y = s.origin.y * h;
    c.save();
    this.glow(x, y, Math.min(w, h) * 0.6, color, 0.075);
    // Spacetime contour lines bend around the energy source.
    c.translate(x, y);
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.ellipse(0, 0, 70 + i * 34, 24 + i * 18, -0.32, 0, TAU);
      c.strokeStyle = `rgba(${color},${0.026 + i * 0.003})`;
      c.lineWidth = 0.6;
      c.stroke();
    }
    c.restore();
    for (let i = 0; i < (this.quality === 'low' ? 25 : 65); i++) {
      const px = rand(i + 150) * w,
        py = fract(rand(i + 900) + (this.reduced ? 0 : s.time * 0.007)) * h;
      c.fillStyle = `rgba(165,156,205,${0.05 + rand(i + 1200) * 0.18})`;
      c.fillRect(px, py, i % 9 === 0 ? 1.5 : 0.8, i % 9 === 0 ? 1.5 : 0.8);
    }
    c.save();
    c.font = `400 ${Math.min(w, h) * 0.38}px 'Noto JP',serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = `rgba(${color},.022)`;
    c.fillText(TECHNIQUES[s.selected].kanji, w * 0.48, h * 0.49);
    c.restore();
  }
  target(s) {
    const c = this.ctx,
      x = s.target.x * this.width,
      y = s.target.y * this.height,
      r = Math.min(this.width, this.height) * 0.045;
    if (s.target.recovery > 0) {
      this.circle(x, y, r * (2 - s.target.recovery * 0.4), '#9c83c120', 1);
      return;
    }
    const flash = s.target.flash / 0.4;
    c.save();
    c.translate(x, y);
    this.glow(0, 0, r * 3, '166,135,207', 0.06 + flash * 0.25);
    c.rotate(this.reduced ? 0 : s.time * 0.12);
    for (let i = 0; i < 2; i++) {
      c.beginPath();
      for (let j = 0; j <= 6; j++) {
        const a = (j * TAU) / 6;
        const px = Math.cos(a) * r * (1.6 + i * 0.2),
          py = Math.sin(a) * r * (1.6 + i * 0.2);
        j ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.strokeStyle = `rgba(167,139,201,${0.13 + flash * 0.5})`;
      c.lineWidth = 0.7;
      c.stroke();
    }
    c.restore();
    c.save();
    c.translate(x, y);
    c.scale(1, 1.4);
    const rotate = this.reduced ? 0.3 : s.time * 0.3;
    const corners = [];
    for (let i = 0; i < 4; i++) {
      let a = (i * TAU) / 4 + rotate;
      corners.push({ x: Math.cos(a) * r * 0.7, y: Math.sin(a) * r * 0.4 });
    }
    for (let i = 0; i < 4; i++) {
      const a = corners[i],
        b = corners[(i + 1) % 4];
      this.line(
        [
          { x: a.x, y: a.y - r * 0.8 },
          { x: b.x, y: b.y - r * 0.8 },
          { x: b.x, y: b.y + r * 0.8 },
          { x: a.x, y: a.y + r * 0.8 },
          { x: a.x, y: a.y - r * 0.8 },
        ],
        `rgba(180,159,207,${0.35 + flash * 0.6})`,
        0.9,
      );
    }
    c.restore();
    this.circle(x, y, r * 0.14, flash ? '#ece3ff' : '#a18daf50', 1);
  }
  impact(effect) {
    const c = this.ctx,
      t = effect.age / effect.duration,
      x = effect.x * this.width,
      y = effect.y * this.height;
    const info = TECHNIQUES[effect.technique],
      r = Math.min(this.width, this.height) * (effect.technique === 'purple' ? 0.38 : 0.22);
    c.save();
    c.globalCompositeOperation = 'lighter';
    const a = (1 - t) ** 2;
    this.glow(x, y, r * (0.5 + t), info.rgb, a * (this.reduced ? 0.15 : 0.6));
    for (let i = 0; i < 4; i++) {
      const p = clamp((t - i * 0.08) * 1.4);
      this.circle(
        x,
        y,
        Math.max(1, r * ease(p)),
        `rgba(${info.rgb},${a * (1 - i * 0.2) * 0.6})`,
        i === 0 ? 2 : 1,
      );
    }
    for (let i = 0; i < (this.reduced ? 8 : 45); i++) {
      const angle = rand(i + 56) * TAU,
        d = r * ease(t) * (0.3 + rand(i + 22));
      const px = x + Math.cos(angle) * d,
        py = y + Math.sin(angle) * d;
      this.line(
        [
          { x: px, y: py },
          {
            x: px + Math.cos(angle) * r * 0.12 * (1 - t),
            y: py + Math.sin(angle) * r * 0.12 * (1 - t),
          },
        ],
        `rgba(${info.rgb},${a * 0.7})`,
        i % 4 === 0 ? 2 : 1,
      );
    }
    c.restore();
  }
  shot(p, s) {
    const c = this.ctx,
      x = p.x * this.width,
      y = p.y * this.height,
      rgb = TECHNIQUES[p.technique].rgb;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const start = p.trail[Math.max(0, p.trail.length - 22)] || p.start;
    if (p.technique === 'purple') {
      const sx = start.x * this.width,
        sy = start.y * this.height;
      c.lineCap = 'round';
      for (const [width, alpha] of [
        [120, 0.035],
        [75, 0.12],
        [38, 0.4],
        [8, 0.95],
      ])
        this.line(
          [
            { x: sx, y: sy },
            { x, y },
          ],
          `rgba(${rgb},${alpha})`,
          width,
        );
      for (let i = 0; i < 5; i++) {
        const offset = Math.sin(s.time * 10 + i) * 16;
        this.line(
          [
            { x: sx, y: sy + offset },
            { x: (sx + x) / 2, y: (sy + y) / 2 - offset },
            { x, y },
          ],
          `rgba(${rgb},.4)`,
          0.8,
        );
      }
    } else
      for (let i = 1; i < p.trail.length; i += 3) {
        const a = p.trail[i - 1],
          b = p.trail[i];
        this.line(
          [
            { x: a.x * this.width, y: a.y * this.height },
            { x: b.x * this.width, y: b.y * this.height },
          ],
          `rgba(${rgb},${(i / p.trail.length) * 0.5})`,
          3 + i * 0.15,
        );
      }
    c.restore();
    this.orb(x, y, p.technique, s.time, 1, p.technique === 'purple' ? 1.8 : 0.6);
  }
  domain(s) {
    const c = this.ctx,
      w = this.width,
      h = this.height;
    const age = 3.6 - s.domain,
      open = ease(age / 0.7),
      fade = clamp(s.domain / 0.8);
    c.save();
    c.beginPath();
    c.arc(w * 0.5, h * 0.5, Math.hypot(w, h) * open, 0, TAU);
    c.clip();
    c.fillStyle = `rgba(1,2,10,${0.97 * fade})`;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = fade;
    const cx = w * 0.5,
      cy = h * 0.5;
    const count = this.quality === 'low' ? 70 : 180;
    for (let i = 0; i < count; i++) {
      const a = rand(i + 500) * TAU,
        phase = fract(rand(i + 49) + age * (this.reduced ? 0.02 : 0.15));
      const d = phase * Math.hypot(w, h) * 0.8;
      const stretch = this.reduced ? 2 : d * 0.055;
      this.line(
        [
          { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.7 },
          { x: cx + Math.cos(a) * (d + stretch), y: cy + Math.sin(a) * (d + stretch) * 0.7 },
        ],
        `rgba(${i % 3 ? '182,176,230' : '255,255,255'},${0.1 + phase * 0.5})`,
        i % 5 === 0 ? 1.4 : 0.6,
      );
    }
    const r = Math.min(w, h) * 0.3;
    this.glow(cx, cy, r * 2, '119,94,210', 0.22);
    c.fillStyle = '#02030b';
    c.beginPath();
    c.arc(cx, cy, r * 0.77, 0, TAU);
    c.fill();
    for (let i = 0; i < 11; i++) {
      c.save();
      c.translate(cx, cy);
      c.rotate(i * 0.022 + (this.reduced ? 0 : age * 0.045));
      c.beginPath();
      c.ellipse(0, 0, r * (1 + i * 0.012), r * (0.45 + i * 0.018), -0.2, 0, TAU);
      c.strokeStyle = `rgba(230,225,255,${0.38 - i * 0.028})`;
      c.lineWidth = i < 2 ? 2 : 0.6;
      c.shadowColor = '#aaa0ff';
      c.shadowBlur = 0;
      c.stroke();
      c.restore();
    }
    c.textAlign = 'center';
    c.fillStyle = '#e8e0ff';
    c.font = `400 ${Math.min(w * 0.047, 33)}px Space`;
    c.letterSpacing = '7px';
    c.fillText('UNLIMITED VOID', cx, cy + 8);
    c.font = "9px Inter,'Noto JP'";
    c.letterSpacing = '4px';
    c.fillStyle = '#a49cc5';
    c.fillText('領 域 展 開', cx, cy + 36);
    c.restore();
  }
  draw(s) {
    const c = this.ctx,
      w = this.width,
      h = this.height;
    c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    c.clearRect(0, 0, w, h);
    c.save();
    const newest = s.impacts.at(-1);
    if (newest && !this.reduced) {
      const a = (1 - newest.age / newest.duration) ** 3;
      c.translate(Math.sin(s.time * 83) * a * 3, Math.cos(s.time * 97) * a * 2);
    }
    this.background(s);
    this.target(s);
    const x = s.origin.x * w,
      y = s.origin.y * h,
      t = s.time;
    if (!s.cast && !s.domain) {
      if (s.selected === 'purple') {
        this.orb(
          s.hands[0] ? s.hands[0].x * w : x - 30,
          s.hands[0] ? s.hands[0].y * h : y + Math.sin(t) * 15,
          'blue',
          t,
          0.65,
          0.68,
        );
        this.orb(
          s.hands[1] ? s.hands[1].x * w : x + 30,
          s.hands[1] ? s.hands[1].y * h : y - Math.sin(t) * 15,
          'red',
          t,
          0.65,
          0.68,
        );
        this.glow(x, y, 40, '177,150,255', 0.12);
      } else if (s.selected === 'domain') {
        this.circle(x, y, 50, '#dad5ff80', 1.5);
        this.glow(x, y, 100, '177,150,255', 0.18);
        c.save();
        c.fillStyle = '#040511';
        c.beginPath();
        c.arc(x, y, 44, 0, TAU);
        c.fill();
        c.restore();
        for (let i = 0; i < 5; i++) {
          c.save();
          c.translate(x, y);
          c.rotate(i * 0.6 + t * 0.1);
          c.beginPath();
          c.ellipse(0, 0, 58, 18, 0, 0, TAU);
          c.strokeStyle = '#e4dcff35';
          c.stroke();
          c.restore();
        }
      } else this.orb(x, y, s.selected, t, 0.9);
    }
    if (s.cast) {
      const cast = s.cast,
        px = cast.origin.x * w,
        py = cast.origin.y * h;
      if (cast.technique === 'purple' && !cast.released) {
        const p = clamp(cast.age / 1.35),
          distance = (1 - ease(p)) * (Math.min(w, h) * 0.22) + 2,
          angle = cast.age * 5;
        const a = cast.handOrigins?.[0],
          b = cast.handOrigins?.[1],
          blend = ease(p);
        this.orb(
          a && b ? a.x * w + (px - a.x * w) * blend : px + Math.cos(angle) * distance,
          a && b ? a.y * h + (py - a.y * h) * blend : py + Math.sin(angle) * distance * 0.55,
          'blue',
          t,
          1,
          0.7,
        );
        this.orb(
          a && b ? b.x * w + (px - b.x * w) * blend : px - Math.cos(angle) * distance,
          a && b ? b.y * h + (py - b.y * h) * blend : py - Math.sin(angle) * distance * 0.55,
          'red',
          t,
          1,
          0.7,
        );
        if (p > 0.45) this.orb(px, py, 'purple', t, (p - 0.45) * 2, (p - 0.45) * 1.9);
        this.circle(px, py, Math.max(1, (1 - p) * 150 + 35), '#ac8eff35', 1);
      } else if (cast.technique !== 'domain' && !cast.released)
        this.orb(px, py, cast.technique, t, 1.4, 1 + cast.age * 1.2);
      if (cast.technique === 'domain') {
        const p = clamp(cast.age / 0.8);
        this.circle(px, py, Math.max(1, (1 - p) * 80 + 30), '#dfd3ff90', 1.5);
        this.glow(px, py, 90, '180,160,255', p * 0.7);
      }
    }
    for (const p of s.shots) this.shot(p, s);
    for (const e of s.impacts) this.impact(e);
    // Aim reticle. Kept subtle so it reads as a training ground, not a debugging overlay.
    if (!s.domain) {
      const ax = s.aim.x * w,
        ay = s.aim.y * h;
      c.save();
      c.setLineDash([3, 5]);
      this.circle(ax, ay, 13, `${TECHNIQUES[s.selected].color}50`, 0.8);
      c.setLineDash([]);
      this.line(
        [
          { x: ax - 4, y: ay },
          { x: ax + 4, y: ay },
        ],
        `${TECHNIQUES[s.selected].color}90`,
        0.8,
      );
      this.line(
        [
          { x: ax, y: ay - 4 },
          { x: ax, y: ay + 4 },
        ],
        `${TECHNIQUES[s.selected].color}90`,
        0.8,
      );
      c.restore();
    }
    if (s.domain > 0) this.domain(s);
    c.restore();
  }
}
