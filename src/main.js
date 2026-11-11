import '../style.css';
import {
  createSimulation,
  updateSimulation,
  castTechnique,
  selectTechnique,
  resetSimulation,
  TECHNIQUES,
  clamp,
} from './simulation.js';
import { Renderer } from './renderer.js';
import { HandTracking, drawHands, coverPoint } from './tracking.js';
import { VoiceCommands } from './voice.js';
import { Sound } from './sound.js';
const $ = (id) => document.getElementById(id);
const simulation = createSimulation();
const renderer = new Renderer($('effects'));
const sound = new Sound();
const stage = $('stage');
let preferences = {
  quality: 'balanced',
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  gestures: true,
  ar: false,
};
try {
  preferences = {
    ...preferences,
    ...JSON.parse(localStorage.getItem('limitless-settings') || '{}'),
  };
} catch {
  /* An invalid preference never prevents the playground from opening. */
}
if (!['low', 'balanced', 'high'].includes(preferences.quality)) preferences.quality = 'balanced';
let hands = [],
  lastHandTime = -Infinity,
  announcementTimer,
  latestInference = 0,
  lastFrame = performance.now(),
  fps = 60,
  lastUi = 0;
const labels = {
  blue: ['01 / LAPSE', 'Blue', 'An impossible force of attraction.'],
  red: ['02 / REVERSAL', 'Red', 'Positive energy. Absolute repulsion.'],
  purple: [
    '03 / IMAGINARY TECHNIQUE',
    'Hollow Purple',
    'Two infinities. One impossible collision.',
  ],
  domain: [
    '04 / DOMAIN EXPANSION',
    'Unlimited Void',
    'Inside infinity, everything becomes nothing.',
  ],
};
function announce(message) {
  $('cast-announcement').textContent = message;
  $('cast-announcement').classList.add('show');
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => $('cast-announcement').classList.remove('show'), 2200);
}
function choose(key) {
  if (!selectTechnique(simulation, key)) return;
  for (const card of document.querySelectorAll('[data-technique]')) {
    const active = card.dataset.technique === key;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', String(active));
  }
  const [index, title, description] = labels[key];
  $('stage-index').textContent = index;
  $('technique-title').replaceChildren(document.createTextNode(title));
  const kanji = document.createElement('span');
  kanji.textContent = TECHNIQUES[key].kanji;
  $('technique-title').append(kanji);
  $('technique-description').textContent = description;
  stage.style.setProperty('--accent', TECHNIQUES[key].color);
}
function cast() {
  if (document.querySelector('dialog[open]')) return;
  if (castTechnique(simulation)) {
    sound.play(simulation.selected);
    announce(
      simulation.selected === 'domain'
        ? '領域展開 · DOMAIN EXPANSION'
        : simulation.selected === 'purple'
          ? '虚式 · HOLLOW PURPLE'
          : TECHNIQUES[simulation.selected].title.toUpperCase(),
    );
  }
}
function reset() {
  resetSimulation(simulation);
  hands = [];
  $('paused-overlay').hidden = true;
  $('pause').setAttribute('aria-pressed', 'false');
  $('pause').querySelector('span').textContent = 'Pause';
  announce('TECHNIQUE RESET');
}
function pause() {
  simulation.paused = !simulation.paused;
  $('paused-overlay').hidden = !simulation.paused;
  $('pause').setAttribute('aria-pressed', String(simulation.paused));
  $('pause').querySelector('span').textContent = simulation.paused ? 'Resume' : 'Pause';
}
function openDialog(id) {
  $(id).showModal();
}
const camera = new HandTracking(
  $('camera'),
  (state, message) => {
    const enabled = state === 'ready',
      loading = state === 'loading';
    $('camera-toggle').querySelector('b').textContent = enabled
      ? 'Disable hand tracking'
      : loading
        ? 'Cancel camera setup'
        : 'Enable hand tracking';
    $('camera-toggle').setAttribute('aria-pressed', String(enabled));
    $('camera-placeholder').hidden = enabled;
    $('camera').hidden = !enabled;
    $('camera-message').textContent = message;
    $('tracking-status').replaceChildren(
      document.createTextNode(
        enabled
          ? '● Active'
          : loading
            ? '◌ Loading…'
            : state === 'error'
              ? '○ Unavailable'
              : '○ Standby',
      ),
    );
    $('camera-badge').classList.toggle('live', enabled);
    $('camera-badge').replaceChildren(
      document.createTextNode(
        enabled ? '● LIVE CAMERA' : loading ? '◌ INITIALIZING' : '○ CAMERA OFF',
      ),
    );
    $('input-label').textContent = enabled ? 'HAND TRACKING' : 'MOUSE + KEYBOARD';
    $('ar-video').srcObject = enabled ? $('camera').srcObject : null;
    $('ar-video').hidden = !(enabled && preferences.ar);
    if (enabled)
      $('ar-video')
        .play()
        .catch(() => {});
    if (!enabled) {
      hands = [];
      simulation.hands = [];
      simulation.origin = { x: 0.39, y: 0.51 };
      simulation.aim = { x: 0.83, y: 0.49 };
      $('hand-count').textContent = '0 / 2';
      $('gesture-status').textContent = '—';
    }
  },
  (result) => {
    hands = [...result.hands].sort((a, b) => a.id - b.id);
    lastHandTime = result.timestamp;
    latestInference = result.inferenceMs || 0;
    if (!hands.length) {
      simulation.hands = [];
      $('hand-count').textContent = '0 / 2';
      $('gesture-status').textContent = camera.running ? 'Searching…' : '—';
      return;
    }
    if (simulation.paused) return;
    simulation.hands = hands.map((hand) => {
      const p = preferences.ar
        ? coverPoint(
            { x: 1 - hand.point.x, y: hand.point.y },
            renderer.width,
            renderer.height,
            $('camera').videoWidth || 640,
            $('camera').videoHeight || 480,
          )
        : { x: hand.point.x * renderer.width, y: hand.point.y * renderer.height };
      return {
        x: clamp(p.x / renderer.width, 0.1, 0.9),
        y: clamp(p.y / renderer.height, 0.24, 0.82),
      };
    });
    const primary = hands[0],
      point = preferences.ar
        ? coverPoint(
            { x: 1 - primary.point.x, y: primary.point.y },
            renderer.width,
            renderer.height,
            $('camera').videoWidth || 640,
            $('camera').videoHeight || 480,
          )
        : { x: primary.point.x * renderer.width, y: primary.point.y * renderer.height };
    simulation.origin = {
      x: clamp(point.x / renderer.width, 0.1, 0.9),
      y: clamp(point.y / renderer.height, 0.24, 0.82),
    };
    if (hands.length === 2 && (result.select === 'purple' || simulation.selected === 'purple'))
      simulation.origin = {
        x: (simulation.hands[0].x + simulation.hands[1].x) / 2,
        y: (simulation.hands[0].y + simulation.hands[1].y) / 2,
      };
    // Normalized pointing direction avoids a stretched trajectory when the viewport changes aspect ratio.
    const d = primary.data.direction,
      length = Math.hypot(d.x, d.y) || 1;
    simulation.aim = {
      x: clamp(simulation.origin.x + (d.x / length) * 0.45, 0.02, 0.98),
      y: clamp(simulation.origin.y + (d.y / length) * 0.45, 0.08, 0.94),
    };
    if (preferences.gestures && result.select) choose(result.select);
    if (result.cast) {
      if (result.select === 'domain' && !preferences.gestures) return;
      cast();
    }
    $('hand-count').textContent = `${hands.length} / 2`;
    $('gesture-status').textContent =
      result.pose === 'domain'
        ? `Void ${Math.round(result.progress * 100)}%`
        : primary.pinched
          ? 'Pinch'
          : result.pose
            ? TECHNIQUES[result.pose].title
            : 'Hand acquired';
  },
);
const voice = new VoiceCommands(
  (enabled, message) => {
    $('voice-toggle').setAttribute('aria-pressed', String(enabled));
    $('voice-toggle').setAttribute(
      'aria-label',
      enabled ? 'Disable voice commands' : 'Enable voice commands',
    );
    $('voice-status').textContent = enabled
      ? 'Listening for your technique…'
      : 'Optional. Say the technique.';
    $('voice-message').textContent = message;
  },
  (command) => {
    if (command === 'reset') reset();
    else {
      choose(command);
      cast();
    }
  },
);
if (!voice.supported) {
  $('voice-toggle').disabled = true;
  $('voice-status').textContent = 'Not supported in this browser.';
}
function resize() {
  const bounds = stage.getBoundingClientRect();
  renderer.resize(stage.clientWidth, stage.clientHeight);
}
const observer = new ResizeObserver(resize);
observer.observe(stage);
function settings() {
  renderer.quality = preferences.quality;
  renderer.reduced = preferences.reduced;
  $('quality').value = preferences.quality;
  $('reduced-motion').checked = preferences.reduced;
  $('gesture-selection').checked = preferences.gestures;
  $('ar-mode').checked = preferences.ar;
  $('ar-video').hidden = !(camera.running && preferences.ar);
  resize();
  try {
    localStorage.setItem('limitless-settings', JSON.stringify(preferences));
  } catch {}
}
settings();
choose('blue');
for (const card of document.querySelectorAll('[data-technique]'))
  card.addEventListener('click', () => choose(card.dataset.technique));
for (const id of ['guide-top', 'guide-open', 'all-gestures'])
  $(id).addEventListener('click', () => openDialog('guide-dialog'));
$('settings-open').addEventListener('click', () => openDialog('settings-dialog'));
for (const button of document.querySelectorAll('[data-close]'))
  button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog'))
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
$('cast').addEventListener('click', cast);
$('reset').addEventListener('click', reset);
$('pause').addEventListener('click', pause);
$('resume').addEventListener('click', pause);
$('camera-toggle').addEventListener('click', () =>
  camera.running || camera.loading ? camera.stop() : camera.start(),
);
$('voice-toggle').addEventListener('click', () => (voice.enabled ? voice.stop() : voice.start()));
$('sound-toggle').addEventListener('click', async () => {
  if (sound.enabled) sound.disable();
  else await sound.enable();
  $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
  $('sound-toggle').setAttribute('aria-label', sound.enabled ? 'Mute sound' : 'Enable sound');
});
$('quality').addEventListener('change', (event) => {
  preferences.quality = event.target.value;
  settings();
});
$('reduced-motion').addEventListener('change', (event) => {
  preferences.reduced = event.target.checked;
  settings();
});
$('gesture-selection').addEventListener('change', (event) => {
  preferences.gestures = event.target.checked;
  settings();
});
$('ar-mode').addEventListener('change', (event) => {
  preferences.ar = event.target.checked;
  settings();
});
function aim(event) {
  const box = stage.getBoundingClientRect();
  simulation.aim = {
    x: clamp((event.clientX - box.left) / box.width),
    y: clamp((event.clientY - box.top) / box.height),
  };
}
stage.addEventListener('pointermove', (event) => {
  if (!hands.length) aim(event);
});
stage.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button') || event.button !== 0) return;
  event.preventDefault();
  aim(event);
  cast();
});
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {
    announce('FULLSCREEN UNAVAILABLE');
  }
}
$('fullscreen').addEventListener('click', fullscreen);
window.addEventListener('keydown', (event) => {
  if (
    event.target.closest('input,select,textarea') ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.repeat
  )
    return;
  if (document.querySelector('dialog[open]')) return;
  if (event.code === 'Space' && event.target.closest('button')) return;
  const key = event.key.toLowerCase();
  if (['1', '2', '3', '4'].includes(key))
    choose(['blue', 'red', 'purple', 'domain'][Number(key) - 1]);
  else if (event.code === 'Space') {
    event.preventDefault();
    cast();
  } else if (key === 'r') reset();
  else if (key === 'p') pause();
  else if (key === 'f') fullscreen();
  else if (key === '?' || key === 'h') openDialog('guide-dialog');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    voice.stop();
    sound.context?.suspend();
  } else {
    lastFrame = performance.now();
    if (sound.enabled) sound.context?.resume();
  }
});
window.addEventListener('pagehide', () => {
  camera.stop();
  voice.stop();
  sound.close();
});
function frame(timestamp) {
  const dt = Math.min(0.1, Math.max(0, (timestamp - lastFrame) / 1000));
  lastFrame = timestamp;
  if (dt > 0) fps = fps * 0.95 + (1 / dt) * 0.05;
  updateSimulation(simulation, dt);
  if (timestamp - lastHandTime > 250 && hands.length) {
    hands = [];
    simulation.hands = [];
    camera.gestures.reset();
    $('hand-count').textContent = '0 / 2';
    $('gesture-status').textContent = 'Searching…';
  }
  renderer.draw(simulation);
  drawHands($('hand-overlay'), $('camera'), hands);
  if (timestamp - lastUi > 100) {
    lastUi = timestamp;
    $('fps').textContent = `${Math.round(Math.min(fps, 240))} FPS`;
    $('fps').title = camera.running
      ? `Hand inference: ${latestInference.toFixed(0)}ms, up to 12.5 updates/sec`
      : '';
    $('cast-count').textContent = simulation.casts;
    $('hit-count').textContent = simulation.hits;
    $('target-state').textContent = simulation.target.health ? 'TRAINING TARGET' : 'REGENERATING';
    [...$('target-health').children].forEach((el, i) =>
      el.classList.toggle('spent', i >= simulation.target.health),
    );
    const ready =
      !simulation.paused && simulation.cooldown <= 0 && !simulation.cast && !simulation.domain;
    $('cast').disabled = !ready;
    $('cast-hint').textContent = simulation.paused
      ? 'Simulation paused.'
      : ready
        ? 'Ready when you are.'
        : `Gathering energy${simulation.cooldown > 0 ? ` · ${simulation.cooldown.toFixed(1)}s` : '…'}`;
    $('output-value').textContent = simulation.cast
      ? '120%'
      : simulation.domain
        ? '∞'
        : simulation.cooldown > 0
          ? 'RECOVERY'
          : '100%';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
