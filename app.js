/* ============================================================
   JUJUTSU KAISEN — CURSED TECHNIQUE SIMULATOR
   Hand tracking (MediaPipe) + Voice commands (Web Speech API)
   Canvas 2D particle effects for Blue, Red, Hollow Purple
   ============================================================ */

// ─── DOM REFS ────────────────────────────────────────────────
const video        = document.getElementById('camera');
const canvas       = document.getElementById('fx-canvas');
const ctx          = canvas.getContext('2d');
const flashOverlay = document.getElementById('flash-overlay');
const stageGuide   = document.getElementById('stage-guide');
const loadingScreen= document.getElementById('loading-screen');
const appEl        = document.getElementById('app');
const startOverlay = document.getElementById('start-overlay');
const startBtn     = document.getElementById('start-btn');
const voiceStatus  = document.getElementById('voice-status');
const voiceText    = document.getElementById('voice-text');
const blueInd      = document.getElementById('blue-indicator');
const redInd       = document.getElementById('red-indicator');
const purpleInd    = document.getElementById('purple-indicator');

// ─── STATE ───────────────────────────────────────────────────
let blueActive   = false;
let redActive    = false;
let purpleActive = false;  // hollow purple animation in progress

// Hand positions (in canvas pixel coords, already mirrored)
let leftHand  = null;  // { x, y, dirX, dirY } — index fingertip + pointing direction
let rightHand = null;  // { x, y, dirX, dirY } — index fingertip + pointing direction

// Raw hand landmarks (all 21 per hand) for skeleton drawing
let rawHandLandmarks = [];  // [{landmarks, label}]

// Face landmarks from Face Mesh
let faceLandmarks = [];  // array of face landmark arrays

// Tracking lock state for crowded scenes
let trackingFace = null;     // { landmarks, bounds, centerX, centerY }
let faceMissedFrames = 0;
let leftHandMissedFrames = 0;
let rightHandMissedFrames = 0;
let videoFrameRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  drawWidth: 0,
  drawHeight: 0,
  offsetX: 0,
  offsetY: 0
};

// MediaPipe pipelines
let handsDetector = null;
let faceMeshDetector = null;
let trackingCamera = null;

// Speech recognition state
let speechRecognition = null;
let recognitionRunning = false;
let recognitionStarting = false;
let allowRecognitionRestart = false;
let recognitionRestartTimer = null;
let voiceFeedbackTimer = null;

// Particle pools
let blueParticles   = [];
let redParticles    = [];
let purpleParticles = [];
let shockwaveRings  = [];

// Hollow purple merge state
let hollowPurpleTimer = 0;
let mergePoint = null;
let purpleSphereRadius = 0;
let purpleFading = false;
let purpleFadeTimer = 0;

// Infinity Void gesture state
let infinityVoidTimer = 0;
let infinityVoidHoldFrames = 0;
let infinityVoidCooldown = 0;
let currentGestureLabel = 'STOP';
let fpsValue = 0;
let lastFrameTimestamp = performance.now();
let handNumberValue = 0;
let pendingHandNumber = 0;
let pendingHandNumberFrames = 0;

// ─── PROJECTILE & IMPACT SYSTEM ──────────────────────────────
let projectiles = [];     // Active flying projectiles
let impacts     = [];     // Active electrifying impact explosions
const PROJECTILE_SPEED = 18;
const PROJECTILE_TRAIL_LEN = 12;
const IMPACT_DURATION = 70;  // frames
const IMPACT_RADIUS = 80;

// ─── CONSTANTS ───────────────────────────────────────────────
const MERGE_DISTANCE    = 150;  // px, how close hands must be
const PARTICLE_COUNT    = 30;
const SPHERE_BASE_SIZE  = 28;
const PURPLE_MAX_RADIUS = 120;
const PURPLE_DURATION   = 90;   // frames (~1.5s at 60fps)
const PURPLE_FADE_DURATION = 60;
const HAND_SMOOTHING = 0.42;
const FACE_SMOOTHING = 0.35;
const MAX_TRACK_MISSES = 10;
const FACE_HAND_ASSOCIATION_SCALE = 2.7;
const HAND_SCORE_MIN = 0.2;
const INFINITY_VOID_HOLD_FRAMES = 8;
const INFINITY_VOID_DURATION = 120;
const INFINITY_VOID_COOLDOWN = 70;

// ─── LOADING SCREEN ──────────────────────────────────────────
setTimeout(() => {
  loadingScreen.classList.add('fade-out');
  appEl.classList.remove('hidden');
  setTimeout(() => loadingScreen.style.display = 'none', 800);
}, 3000);

// ─── START BUTTON — request camera + mic ─────────────────────
startBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    const videoStream = new MediaStream(stream.getVideoTracks());
    stream.getAudioTracks().forEach((track) => track.stop());
    video.srcObject = videoStream;
    await video.play();

    startOverlay.classList.add('hidden');
    allowRecognitionRestart = true;
    resizeCanvas();
    initTrackingPipeline();
    initVoiceRecognition();
    requestAnimationFrame(renderLoop);
  } catch (err) {
    alert('Camera and microphone access are required.\n\n' + err.message);
  }
});

// ─── RESIZE CANVAS TO MATCH VIDEO ────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  updateVideoFrameRect();
}
window.addEventListener('resize', resizeCanvas);

function updateVideoFrameRect() {
  const vRect = video.getBoundingClientRect();
  const cRect = canvas.getBoundingClientRect();

  const width = Math.max(1, vRect.width);
  const height = Math.max(1, vRect.height);
  const sourceW = Math.max(1, video.videoWidth || 1280);
  const sourceH = Math.max(1, video.videoHeight || 720);
  const sourceAspect = sourceW / sourceH;
  const targetAspect = width / height;

  let drawWidth = width;
  let drawHeight = height;
  let offsetX = 0;
  let offsetY = 0;

  // Match CSS object-fit: cover so overlays align with the preview panel.
  if (sourceAspect > targetAspect) {
    drawHeight = height;
    drawWidth = height * sourceAspect;
    offsetX = (drawWidth - width) * 0.5;
  } else {
    drawWidth = width;
    drawHeight = width / sourceAspect;
    offsetY = (drawHeight - height) * 0.5;
  }

  videoFrameRect = {
    x: vRect.left - cRect.left,
    y: vRect.top - cRect.top,
    width,
    height,
    drawWidth,
    drawHeight,
    offsetX,
    offsetY
  };
}

// ─── MEDIAPIPE HANDS ─────────────────────────────────────────
// Debug status shown on screen
let debugStatus = 'INIT';
let handsReady = false;
let faceReady = false;
let framesSent = 0;
let handsResultCount = 0;
let faceResultCount = 0;

async function initTrackingPipeline() {
  debugStatus = 'Loading Hands model...';
  console.log('[TRACKER] ' + debugStatus);

  try {
    handsDetector = new Hands({
      locateFile: (file) => {
        console.log('[HANDS] Loading:', file);
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
      }
    });
    handsDetector.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.2,
      minTrackingConfidence: 0.15
    });
    handsDetector.onResults((results) => {
      handsResultCount++;
      onHandResults(results);
    });

    // Initialize hands model by sending a dummy frame
    await handsDetector.initialize();
    handsReady = true;
    debugStatus = 'Hands model loaded ✓';
    console.log('[TRACKER] ' + debugStatus);
  } catch (err) {
    console.error('[TRACKER] Hands init failed:', err);
    debugStatus = 'Hands FAILED: ' + err.message;

    // Try without initialize
    handsReady = true;
  }

  debugStatus = 'Loading Face Mesh model...';
  console.log('[TRACKER] ' + debugStatus);

  try {
    faceMeshDetector = new FaceMesh({
      locateFile: (file) => {
        console.log('[FACE] Loading:', file);
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
      }
    });
    faceMeshDetector.setOptions({
      maxNumFaces: 3,
      refineLandmarks: true,
      minDetectionConfidence: 0.3,
      minTrackingConfidence: 0.2
    });
    faceMeshDetector.onResults((results) => {
      faceResultCount++;
      onFaceResults(results);
    });

    await faceMeshDetector.initialize();
    faceReady = true;
    debugStatus = 'Face Mesh loaded ✓';
    console.log('[TRACKER] ' + debugStatus);
  } catch (err) {
    console.error('[TRACKER] Face Mesh init failed:', err);
    debugStatus = 'Face Mesh FAILED: ' + err.message;

    // Try without initialize
    faceReady = true;
  }

  debugStatus = 'Starting camera feed...';
  console.log('[TRACKER] ' + debugStatus);

  // Try using MediaPipe Camera utility first
  try {
    trackingCamera = new Camera(video, {
      onFrame: async () => {
        framesSent++;
        try {
          // Send to both detectors in parallel
          const promises = [];
          if (handsDetector) promises.push(handsDetector.send({ image: video }));
          if (faceMeshDetector) promises.push(faceMeshDetector.send({ image: video }));
          await Promise.all(promises);
        } catch (err) {
          // Don't spam console, just log first few
          if (framesSent < 5) console.warn('[TRACKER] Frame error:', err);
        }
      },
      width: 1280,
      height: 720
    });
    await trackingCamera.start();
    debugStatus = 'TRACKING ACTIVE';
    console.log('[TRACKER] Camera started via MediaPipe Camera utility');
  } catch (err) {
    console.warn('[TRACKER] MediaPipe Camera failed, using manual loop:', err);
    debugStatus = 'Using manual frame loop...';
    // Fallback: use our own requestAnimationFrame loop to send frames
    startManualFrameLoop();
  }
}

function startManualFrameLoop() {
  async function sendFrame() {
    if (video.readyState >= 2) { // HAVE_CURRENT_DATA
      framesSent++;
      try {
        const promises = [];
        if (handsDetector) promises.push(handsDetector.send({ image: video }));
        if (faceMeshDetector) promises.push(faceMeshDetector.send({ image: video }));
        await Promise.all(promises);
        debugStatus = 'TRACKING ACTIVE (manual)';
      } catch (err) {
        if (framesSent < 5) console.warn('[TRACKER] Manual frame error:', err);
      }
    }
    requestAnimationFrame(sendFrame);
  }
  requestAnimationFrame(sendFrame);
}

function toCanvasPoint(lm) {
  const px = (1 - lm.x) * videoFrameRect.drawWidth - videoFrameRect.offsetX;
  const py = lm.y * videoFrameRect.drawHeight - videoFrameRect.offsetY;
  return {
    x: videoFrameRect.x + px,
    y: videoFrameRect.y + py
  };
}

function getBoundsFromPoints(points) {
  if (!points || points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, area: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return { minX, minY, maxX, maxY, width, height, area: width * height };
}

function smoothValue(prev, next, alpha) {
  return prev + (next - prev) * alpha;
}

function smoothBounds(prev, next, alpha) {
  if (!prev) return next;

  const minX = smoothValue(prev.minX, next.minX, alpha);
  const minY = smoothValue(prev.minY, next.minY, alpha);
  const maxX = smoothValue(prev.maxX, next.maxX, alpha);
  const maxY = smoothValue(prev.maxY, next.maxY, alpha);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return { minX, minY, maxX, maxY, width, height, area: width * height };
}

function onHandResults(results) {
  updateVideoFrameRect();

  const multiLandmarks = results.multiHandLandmarks || [];
  const multiHandedness = results.multiHandedness || [];
  const candidates = [];

  for (let i = 0; i < multiLandmarks.length; i++) {
    const candidate = makeHandCandidate(multiLandmarks[i], multiHandedness[i]);
    if (candidate) candidates.push(candidate);
  }

  const assigned = assignHands(candidates);
  updateTrackedHand('left', assigned.left);
  updateTrackedHand('right', assigned.right);
  updateHandNumberGesture(candidates);
  updateInfinityVoidGesture(multiLandmarks);

  rawHandLandmarks = [];
  const seen = new Set();

  if (assigned.left?.landmarks) {
    rawHandLandmarks.push({
      landmarks: assigned.left.landmarks,
      label: assigned.left.label,
      side: 'left',
      bounds: assigned.left.bounds
    });
    seen.add(assigned.left);
  }
  if (assigned.right?.landmarks && assigned.right !== assigned.left) {
    rawHandLandmarks.push({
      landmarks: assigned.right.landmarks,
      label: assigned.right.label,
      side: 'right',
      bounds: assigned.right.bounds
    });
    seen.add(assigned.right);
  }

  // Fallback: still draw any detected hands so hand-lock visuals never disappear.
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    rawHandLandmarks.push({
      landmarks: candidate.landmarks,
      label: candidate.label,
      side: candidate.label === 'Right' ? 'left' : candidate.label === 'Left' ? 'right' : 'left',
      bounds: candidate.bounds
    });
  }
}

function distance3D(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

function fingerExtensionRatio(landmarks, tip, pip, mcp) {
  const wrist = landmarks[0];
  const tipDist = distance3D(landmarks[tip], wrist);
  const pipDist = distance3D(landmarks[pip], wrist);
  const mcpDist = distance3D(landmarks[mcp], wrist);
  const base = Math.max(pipDist, mcpDist, 0.0001);
  return tipDist / base;
}

function isFingerExtended(landmarks, tip, pip, mcp) {
  return fingerExtensionRatio(landmarks, tip, pip, mcp) > 1.16;
}

function isFingerCurled(landmarks, tip, pip, mcp) {
  return fingerExtensionRatio(landmarks, tip, pip, mcp) < 1.05;
}

function isThumbExtended(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  // Thumb extends laterally — check if tip (4) is further from palm center than knuckle (2)
  const palmCenterX = (landmarks[0].x + landmarks[5].x + landmarks[17].x) / 3;
  const palmCenterY = (landmarks[0].y + landmarks[5].y + landmarks[17].y) / 3;
  const tipDist = Math.hypot(landmarks[4].x - palmCenterX, landmarks[4].y - palmCenterY);
  const knuckleDist = Math.hypot(landmarks[2].x - palmCenterX, landmarks[2].y - palmCenterY);
  // Also check lateral tip-to-wrist distance vs pip-to-wrist
  const tipToWrist = Math.hypot(landmarks[4].x - landmarks[0].x, landmarks[4].y - landmarks[0].y);
  const pipToWrist = Math.hypot(landmarks[3].x - landmarks[0].x, landmarks[3].y - landmarks[0].y);
  return tipDist > knuckleDist * 1.15 && tipToWrist > pipToWrist * 0.9;
}

function countRaisedFingers(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;

  const thumbUp = isThumbExtended(landmarks);
  const indexExtended = isFingerExtended(landmarks, 8, 6, 5);
  const middleExtended = isFingerExtended(landmarks, 12, 10, 9);
  const ringExtended = isFingerExtended(landmarks, 16, 14, 13);
  const pinkyExtended = isFingerExtended(landmarks, 20, 18, 17);

  let count = 0;
  if (thumbUp) count++;
  if (indexExtended) count++;
  if (middleExtended) count++;
  if (ringExtended) count++;
  if (pinkyExtended) count++;
  return count;
}

function getHandState(landmarks) {
  if (!landmarks || landmarks.length < 21) return 'Unknown';
  const count = countRaisedFingers(landmarks);
  if (count === 0) return 'Fist';
  if (count === 5) return 'Open';
  if (count === 1 && isFingerExtended(landmarks, 8, 6, 5)) return 'Pointing';
  if (count === 2 && isFingerExtended(landmarks, 8, 6, 5) && isFingerExtended(landmarks, 12, 10, 9)) return 'Peace';
  if (count === 3) return 'Three';
  if (count === 4) return 'Four';
  return `${count} Up`;
}

function updateHandNumberGesture(candidates) {
  if (!candidates || candidates.length === 0) {
    handNumberValue = 0;
    pendingHandNumber = 0;
    pendingHandNumberFrames = 0;
    return;
  }

  const totalFingers = candidates
    .slice(0, 2)
    .reduce((sum, candidate) => sum + countRaisedFingers(candidate.landmarks), 0);

  const nextValue = Math.min(9, Math.max(0, totalFingers));
  if (nextValue === pendingHandNumber) {
    pendingHandNumberFrames++;
  } else {
    pendingHandNumber = nextValue;
    pendingHandNumberFrames = 1;
  }

  if (pendingHandNumberFrames >= 3) {
    handNumberValue = nextValue;
  }
}

function isInfinityVoidSign(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;

  const palmSize = Math.max(
    0.08,
    (distance3D(landmarks[0], landmarks[9]) + distance3D(landmarks[5], landmarks[17])) * 0.5
  );

  const indexExtended = isFingerExtended(landmarks, 8, 6, 5);
  const middleExtended = isFingerExtended(landmarks, 12, 10, 9);
  const ringCurled = isFingerCurled(landmarks, 16, 14, 13);
  const pinkyCurled = isFingerCurled(landmarks, 20, 18, 17);
  const indexMiddleClose = distance3D(landmarks[8], landmarks[12]) < palmSize * 0.5;

  const thumbToPalm = Math.min(
    distance3D(landmarks[4], landmarks[5]),
    distance3D(landmarks[4], landmarks[9]),
    distance3D(landmarks[4], landmarks[13])
  );
  const thumbFolded = thumbToPalm < palmSize * 0.72;

  const indexVecX = landmarks[8].x - landmarks[5].x;
  const indexVecY = landmarks[8].y - landmarks[5].y;
  const middleVecX = landmarks[12].x - landmarks[9].x;
  const middleVecY = landmarks[12].y - landmarks[9].y;
  const indexMag = Math.hypot(indexVecX, indexVecY) || 1;
  const middleMag = Math.hypot(middleVecX, middleVecY) || 1;
  const parallelScore =
    (indexVecX * middleVecX + indexVecY * middleVecY) / (indexMag * middleMag);
  const fingersParallel = parallelScore > 0.88;

  return indexExtended &&
    middleExtended &&
    ringCurled &&
    pinkyCurled &&
    indexMiddleClose &&
    thumbFolded &&
    fingersParallel;
}

function updateInfinityVoidGesture(multiLandmarks) {
  const hasInfinityVoidSign = (multiLandmarks || []).some((landmarks) => isInfinityVoidSign(landmarks));

  if (infinityVoidCooldown > 0) {
    infinityVoidCooldown--;
  }

  if (hasInfinityVoidSign) {
    currentGestureLabel = 'INFINITY VOID';
    infinityVoidHoldFrames++;
  } else {
    currentGestureLabel = handNumberValue > 0 ? String(handNumberValue) : 'STOP';
    infinityVoidHoldFrames = Math.max(0, infinityVoidHoldFrames - 2);
  }

  if (infinityVoidHoldFrames >= INFINITY_VOID_HOLD_FRAMES && infinityVoidCooldown === 0) {
    infinityVoidTimer = INFINITY_VOID_DURATION;
    infinityVoidHoldFrames = 0;
    infinityVoidCooldown = INFINITY_VOID_COOLDOWN;
    flashVoiceFeedback('INFINITY VOID');
  }
}

function makeHandCandidate(landmarks, handedness) {
  if (!landmarks || landmarks.length < 9) return null;

  const tip = toCanvasPoint(landmarks[8]);
  const mcp = toCanvasPoint(landmarks[5]);
  const wrist = toCanvasPoint(landmarks[0]);
  const allPoints = landmarks.map((lm) => toCanvasPoint(lm));
  const bounds = getBoundsFromPoints(allPoints);

  let dirX = tip.x - mcp.x;
  let dirY = tip.y - mcp.y;
  const mag = Math.hypot(dirX, dirY) || 1;
  dirX /= mag;
  dirY /= mag;

  const confidence = Array.isArray(handedness?.score)
    ? handedness.score[0]
    : (typeof handedness?.score === 'number' ? handedness.score : 0.5);

  return {
    landmarks,
    label: handedness?.label || 'Unknown',
    confidence,
    tip,
    wrist,
    dirX,
    dirY,
    bounds
  };
}

function assignHands(candidates) {
  if (candidates.length === 0) return { left: null, right: null };
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);

  // Mirrored camera: MediaPipe Right is left side of screen.
  let left = sorted.find((c) => c.label === 'Right') || null;
  let right = sorted.find((c) => c.label === 'Left') || null;

  const remaining = sorted.filter((c) => c !== left && c !== right);
  if (!left && remaining.length > 0) left = remaining.shift();
  if (!right && remaining.length > 0) right = remaining.pop() || null;

  if (!left && !right && sorted.length === 1) {
    const only = sorted[0];
    if (only.tip.x < canvas.width * 0.5) left = only;
    else right = only;
  }

  if (!left && leftHand) {
    left = sorted
      .filter((c) => c !== right)
      .sort((a, b) => {
        const da = Math.hypot(a.tip.x - leftHand.x, a.tip.y - leftHand.y);
        const db = Math.hypot(b.tip.x - leftHand.x, b.tip.y - leftHand.y);
        return da - db;
      })[0] || null;
  }

  if (!right && rightHand) {
    right = sorted
      .filter((c) => c !== left)
      .sort((a, b) => {
        const da = Math.hypot(a.tip.x - rightHand.x, a.tip.y - rightHand.y);
        const db = Math.hypot(b.tip.x - rightHand.x, b.tip.y - rightHand.y);
        return da - db;
      })[0] || null;
  }

  return { left, right };
}

function smoothHandState(prev, candidate) {
  if (!candidate) return prev;
  if (!prev) {
    return {
      x: candidate.tip.x,
      y: candidate.tip.y,
      dirX: candidate.dirX,
      dirY: candidate.dirY,
      landmarks: candidate.landmarks,
      label: candidate.label,
      bounds: candidate.bounds
    };
  }

  let dirX = smoothValue(prev.dirX, candidate.dirX, HAND_SMOOTHING);
  let dirY = smoothValue(prev.dirY, candidate.dirY, HAND_SMOOTHING);
  const dirMag = Math.hypot(dirX, dirY) || 1;
  dirX /= dirMag;
  dirY /= dirMag;

  return {
    x: smoothValue(prev.x, candidate.tip.x, HAND_SMOOTHING),
    y: smoothValue(prev.y, candidate.tip.y, HAND_SMOOTHING),
    dirX,
    dirY,
    landmarks: candidate.landmarks,
    label: candidate.label,
    bounds: smoothBounds(prev.bounds, candidate.bounds, HAND_SMOOTHING)
  };
}

function updateTrackedHand(side, candidate) {
  if (side === 'left') {
    if (candidate) {
      leftHand = smoothHandState(leftHand, candidate);
      leftHandMissedFrames = 0;
    } else {
      leftHandMissedFrames++;
      if (leftHandMissedFrames > MAX_TRACK_MISSES) leftHand = null;
    }
    return;
  }

  if (candidate) {
    rightHand = smoothHandState(rightHand, candidate);
    rightHandMissedFrames = 0;
  } else {
    rightHandMissedFrames++;
    if (rightHandMissedFrames > MAX_TRACK_MISSES) rightHand = null;
  }
}

// ─── FACE MESH TRACKING ──────────────────────────────────────

function makeFaceCandidate(landmarks) {
  const facePts = FACE_OVAL
    .filter((idx) => idx < landmarks.length)
    .map((idx) => toCanvasPoint(landmarks[idx]));
  if (facePts.length === 0) return null;

  const bounds = getBoundsFromPoints(facePts);
  return {
    landmarks,
    bounds,
    centerX: (bounds.minX + bounds.maxX) * 0.5,
    centerY: (bounds.minY + bounds.maxY) * 0.5
  };
}

function scoreFaceCandidate(candidate) {
  const frameArea = Math.max(1, canvas.width * canvas.height);
  const areaScore = (candidate.bounds.area / frameArea) * 8;

  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const centerDist = Math.hypot(candidate.centerX - cx, candidate.centerY - cy);
  const centerNorm = centerDist / Math.max(1, Math.hypot(cx, cy));
  const centerScore = 1 - Math.min(1, centerNorm);

  let temporalScore = 0;
  if (trackingFace) {
    const moveDist = Math.hypot(candidate.centerX - trackingFace.centerX, candidate.centerY - trackingFace.centerY);
    const moveNorm = Math.min(1, moveDist / Math.max(canvas.width, canvas.height));
    temporalScore = 1 - moveNorm;
  }

  return areaScore + centerScore * 1.5 + temporalScore * 2;
}

function onFaceResults(results) {
  updateVideoFrameRect();
  const faces = results.multiFaceLandmarks || [];
  const candidates = faces.map(makeFaceCandidate).filter(Boolean);

  if (candidates.length === 0) {
    faceMissedFrames++;
    if (faceMissedFrames > MAX_TRACK_MISSES) {
      trackingFace = null;
      faceLandmarks = [];
    } else if (trackingFace) {
      faceLandmarks = [trackingFace.landmarks];
    }
    return;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreFaceCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  faceMissedFrames = 0;
  trackingFace = {
    landmarks: best.landmarks,
    bounds: smoothBounds(trackingFace?.bounds || null, best.bounds, FACE_SMOOTHING),
    centerX: smoothValue(trackingFace?.centerX ?? best.centerX, best.centerX, FACE_SMOOTHING),
    centerY: smoothValue(trackingFace?.centerY ?? best.centerY, best.centerY, FACE_SMOOTHING)
  };
  faceLandmarks = [trackingFace.landmarks];
}

// ─── HAND SKELETON DRAWING (21 landmarks + connections) ──────
// MediaPipe Hand landmark connections
const HAND_CONNECTIONS = [
  // Thumb
  [0,1],[1,2],[2,3],[3,4],
  // Index finger
  [0,5],[5,6],[6,7],[7,8],
  // Middle finger
  [0,9],[9,10],[10,11],[11,12],
  // Ring finger
  [0,13],[13,14],[14,15],[15,16],
  // Pinky
  [0,17],[17,18],[18,19],[19,20],
  // Palm base connections
  [5,9],[9,13],[13,17]
];

function drawHandSkeleton(landmarks, label, side = null) {
  // Determine color based on handedness
  // MediaPipe 'Right' = user's left hand (mirrored)
  const isLeft = side ? side === 'left' : label === 'Right';
  const lineColor = isLeft ? 'rgba(0, 191, 255, 0.8)' : 'rgba(255, 68, 68, 0.8)';
  const dotColor  = isLeft ? 'rgba(0, 230, 255, 1)'   : 'rgba(255, 120, 80, 1)';
  const glowColor = isLeft ? 'rgba(0, 191, 255, 0.4)' : 'rgba(255, 68, 68, 0.4)';
  const jointColor = isLeft ? '#00e6ff' : '#ff7850';

  // Convert all landmarks to canvas pixel coords
  const pts = landmarks.map((lm) => toCanvasPoint(lm));

  // Draw connections (bone lines)
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = pts[a];
    const pb = pts[b];

    // Glow line
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Core line
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Draw landmark dots
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const isTip = [4, 8, 12, 16, 20].includes(i);
    const isBase = i === 0;
    const r = isTip ? 6 : isBase ? 7 : 4;

    // Outer glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Bright center for tips
    if (isTip || isBase) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  // Draw hand label above wrist
  const wrist = pts[0];
  const handSide = isLeft ? 'Left' : 'Right';
  const handState = getHandState(landmarks);
  const labelText = `${handSide}:${handState}`;
  ctx.font = '600 11px Rajdhani, sans-serif';
  ctx.fillStyle = jointColor;
  ctx.textAlign = 'center';
  ctx.fillText(labelText, wrist.x, wrist.y - 18);
}

function drawHandLockMarker(hand) {
  if (!hand?.bounds) return;

  const isLeft = hand.side === 'left';
  const primary = isLeft ? 'rgba(0, 191, 255, 0.9)' : 'rgba(255, 88, 88, 0.9)';
  const subtle = isLeft ? 'rgba(0, 191, 255, 0.35)' : 'rgba(255, 88, 88, 0.35)';

  const pad = 12;
  const x = hand.bounds.minX - pad;
  const y = hand.bounds.minY - pad;
  const w = hand.bounds.width + pad * 2;
  const h = hand.bounds.height + pad * 2;
  const c = 14;

  ctx.strokeStyle = subtle;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  ctx.strokeStyle = primary;
  ctx.lineWidth = 2.4;

  // Top-left corner
  ctx.beginPath();
  ctx.moveTo(x, y + c);
  ctx.lineTo(x, y);
  ctx.lineTo(x + c, y);
  ctx.stroke();

  // Top-right corner
  ctx.beginPath();
  ctx.moveTo(x + w - c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + c);
  ctx.stroke();

  // Bottom-left corner
  ctx.beginPath();
  ctx.moveTo(x, y + h - c);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.stroke();

  // Bottom-right corner
  ctx.beginPath();
  ctx.moveTo(x + w - c, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - c);
  ctx.stroke();

  const handState = hand.landmarks ? getHandState(hand.landmarks) : '';
  const labelPrefix = isLeft ? 'Left' : 'Right';
  const lockText = `${labelPrefix}:${handState}`;
  
  // Label background for readability
  ctx.font = '700 12px Orbitron, sans-serif';
  const textWidth = ctx.measureText(lockText).width;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(x, y - 22, textWidth + 10, 18);
  ctx.fillStyle = primary;
  ctx.textAlign = 'left';
  ctx.fillText(lockText, x + 5, y - 8);
}

// ─── FACE MESH DRAWING ───────────────────────────────────────
// Key face contour indices (face oval)
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

// Eye contours
const LEFT_EYE  = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];

// Lip contours
const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIPS_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

// Nose ridge
const NOSE = [168, 6, 197, 195, 5, 4, 1, 19];

// Left eyebrow
const LEFT_EYEBROW  = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70];
const RIGHT_EYEBROW = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300];

function drawFaceMesh(landmarks) {
  // Convert to canvas pixel coords (mirrored)
  const pts = landmarks.map((lm) => toCanvasPoint(lm));

  // Helper: draw a contour path
  function drawContour(indices, color, width, closed = true) {
    if (indices.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[indices[0]].x, pts[indices[0]].y);
    for (let i = 1; i < indices.length; i++) {
      ctx.lineTo(pts[indices[i]].x, pts[indices[i]].y);
    }
    if (closed) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // Face oval (green/cyan like reference images)
  drawContour(FACE_OVAL, 'rgba(0, 255, 128, 0.7)', 2);

  // Eyes
  drawContour(LEFT_EYE,  'rgba(0, 255, 200, 0.8)', 1.5);
  drawContour(RIGHT_EYE, 'rgba(0, 255, 200, 0.8)', 1.5);

  // Eyebrows
  drawContour(LEFT_EYEBROW,  'rgba(0, 255, 128, 0.5)', 1.2, false);
  drawContour(RIGHT_EYEBROW, 'rgba(0, 255, 128, 0.5)', 1.2, false);

  // Lips
  drawContour(LIPS_OUTER, 'rgba(255, 100, 100, 0.7)', 1.5);
  drawContour(LIPS_INNER, 'rgba(255, 150, 150, 0.5)', 1);

  // Nose
  drawContour(NOSE, 'rgba(0, 255, 180, 0.5)', 1.2, false);

  // Draw triangulated mesh lines (subtle) — connect key feature landmarks
  const meshColor = 'rgba(0, 255, 150, 0.12)';
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = meshColor;

  // Sparse mesh: connect every 5th landmark for a subtle tessellated look
  for (let i = 0; i < landmarks.length; i += 5) {
    for (let j = i + 5; j < landmarks.length; j += 5) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Only draw short connections (local mesh)
      if (dist < 40) {
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    }
  }

  // Draw key landmark dots — large blue dots matching reference image style
  // Eyes, nose tip, mouth corners, forehead, chin
  const keyLandmarks = [
    1, 4, 5, 6,       // nose
    33, 133,           // left eye corners
    362, 263,          // right eye corners
    61, 291,           // mouth corners
    152, 10, 168,      // chin, forehead, bridge
    234, 454,          // cheeks/temples
    468, 473           // iris centers (when refineLandmarks is on)
  ];
  for (const idx of keyLandmarks) {
    if (idx < pts.length) {
      // Outer glow
      ctx.beginPath();
      ctx.arc(pts[idx].x, pts[idx].y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 160, 255, 0.3)';
      ctx.fill();
      // Core dot — bright blue like reference
      ctx.beginPath();
      ctx.arc(pts[idx].x, pts[idx].y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30, 180, 255, 0.95)';
      ctx.fill();
      // White center
      ctx.beginPath();
      ctx.arc(pts[idx].x, pts[idx].y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fill();
    }
  }

  // Bounding box around face — white like reference images
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const idx of FACE_OVAL) {
    minX = Math.min(minX, pts[idx].x);
    maxX = Math.max(maxX, pts[idx].x);
    minY = Math.min(minY, pts[idx].y);
    maxY = Math.max(maxY, pts[idx].y);
  }
  const pad = 18;
  const bw = (maxX - minX) + pad * 2;
  const bh = (maxY - minY) + pad * 2;
  const bx = minX - pad;
  const by = minY - pad;

  // White solid bounding box like reference
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.strokeRect(bx, by, bw, bh);

  // Corner brackets for emphasis
  const cornerLen = 16;
  ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
  ctx.lineWidth = 3.5;
  // Top-left
  ctx.beginPath(); ctx.moveTo(bx, by + cornerLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerLen, by); ctx.stroke();
  // Top-right
  ctx.beginPath(); ctx.moveTo(bx + bw - cornerLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerLen); ctx.stroke();
  // Bottom-left
  ctx.beginPath(); ctx.moveTo(bx, by + bh - cornerLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerLen, by + bh); ctx.stroke();
  // Bottom-right
  ctx.beginPath(); ctx.moveTo(bx + bw - cornerLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cornerLen); ctx.stroke();

  // Label
  ctx.font = '700 13px Orbitron, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.textAlign = 'left';
  ctx.fillText('FACE DETECTED', bx + 4, by - 8);
}

// ─── WEB SPEECH API — VOICE RECOGNITION ──────────────────────
function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceText.textContent = 'NO SPEECH API';
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = 'en-US';
  speechRecognition.maxAlternatives = 5;

  speechRecognition.onstart = () => {
    recognitionStarting = false;
    recognitionRunning = true;
    voiceStatus.classList.add('on');
    voiceStatus.classList.remove('off');
    voiceText.textContent = 'LISTENING';
  };

  speechRecognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      for (let a = 0; a < result.length; a++) {
        const alt = result[a];
        const confidence = typeof alt.confidence === 'number' ? alt.confidence : 0.7;
        if (!result.isFinal && confidence < 0.45) continue;
        processVoiceCommand(alt.transcript);
      }
    }
  };

  speechRecognition.onerror = (event) => {
    recognitionStarting = false;
    recognitionRunning = false;
    console.warn('Speech error:', event.error);

    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      allowRecognitionRestart = false;
      voiceStatus.classList.remove('on');
      voiceStatus.classList.add('off');
      voiceText.textContent = 'MIC BLOCKED';
      return;
    }

    if (event.error === 'no-speech') {
      voiceText.textContent = 'LISTENING';
    }

    if (event.error !== 'aborted') {
      queueVoiceRestart(550);
    }
  };

  speechRecognition.onend = () => {
    recognitionStarting = false;
    recognitionRunning = false;
    if (!allowRecognitionRestart) return;
    voiceText.textContent = 'LISTENING';
    queueVoiceRestart(250);
  };

  startVoiceRecognition();
}

function queueVoiceRestart(delayMs) {
  if (!allowRecognitionRestart) return;
  if (recognitionRestartTimer) clearTimeout(recognitionRestartTimer);
  recognitionRestartTimer = setTimeout(() => {
    startVoiceRecognition();
  }, delayMs);
}

function startVoiceRecognition() {
  if (!speechRecognition || !allowRecognitionRestart || recognitionRunning || recognitionStarting) return;

  recognitionStarting = true;
  try {
    speechRecognition.start();
  } catch (e) {
    recognitionStarting = false;
    if (e?.name !== 'InvalidStateError') {
      console.error('Could not start speech recognition', e);
    }
    queueVoiceRestart(600);
  }
}

function normalizeVoiceCommand(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function processVoiceCommand(text) {
  const normalized = normalizeVoiceCommand(text);
  if (!normalized) return;

  if (/\b(hollow\s+purple|hollow|purple)\b/.test(normalized)) {
    if (blueActive && redActive) {
      triggerHollowPurple();
    }
    return;
  }

  // "GO" — fire projectile in pointing direction
  if (/\b(go|fire|shoot)\b/.test(normalized)) {
    fireProjectile();
    return;
  }

  const saidBlue = /\b(blue|blew|bleu)\b/.test(normalized);
  const saidRed = /\b(red|read)\b/.test(normalized);

  if (saidBlue) {
    blueActive = true;
    blueInd.classList.add('active');
    // Initialize blue particles
    if (blueParticles.length === 0) spawnParticles(blueParticles, 'blue');
    flashVoiceFeedback('BLUE ACTIVATED');
  }

  if (saidRed) {
    redActive = true;
    redInd.classList.add('active');
    if (redParticles.length === 0) spawnParticles(redParticles, 'red');
    flashVoiceFeedback('RED ACTIVATED');
  }
}

function flashVoiceFeedback(msg) {
  voiceText.textContent = msg;
  if (voiceFeedbackTimer) clearTimeout(voiceFeedbackTimer);
  voiceFeedbackTimer = setTimeout(() => {
    if (!recognitionRunning && allowRecognitionRestart) {
      voiceText.textContent = 'RESTARTING...';
      return;
    }
    voiceText.textContent = 'LISTENING';
  }, 1500);
}

// ─── HOLLOW PURPLE ───────────────────────────────────────────
function triggerHollowPurple() {
  if (purpleActive) return;
  purpleActive = true;
  purpleFading = false;
  hollowPurpleTimer = 0;
  purpleSphereRadius = 0;

  purpleInd.classList.add('active');
  flashVoiceFeedback('HOLLOW PURPLE');

  // Spawn purple particles
  spawnParticles(purpleParticles, 'purple');
}

// ─── PARTICLE SYSTEM ─────────────────────────────────────────
function spawnParticles(pool, color) {
  pool.length = 0;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    pool.push(createParticle(color));
  }
}

function createParticle(color) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.5 + Math.random() * 2;
  return {
    x: 0, y: 0,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0.5 + Math.random() * 0.5,
    maxLife: 0.5 + Math.random() * 0.5,
    size: 1 + Math.random() * 3,
    color: color,
    offset: Math.random() * Math.PI * 2
  };
}

function updateParticles(pool, centerX, centerY, color) {
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.012;

    if (p.life <= 0) {
      // Respawn
      const np = createParticle(color);
      np.x = 0; np.y = 0;
      pool[i] = np;
    }
  }
}

function drawParticles(pool, centerX, centerY) {
  for (const p of pool) {
    const alpha = Math.max(0, p.life / p.maxLife);
    let fillColor;
    if (p.color === 'blue') {
      fillColor = `rgba(0, 191, 255, ${alpha * 0.8})`;
    } else if (p.color === 'red') {
      fillColor = `rgba(255, 68, 68, ${alpha * 0.8})`;
    } else {
      fillColor = `rgba(168, 85, 247, ${alpha * 0.9})`;
    }
    ctx.beginPath();
    ctx.arc(centerX + p.x, centerY + p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
}

// ─── ENERGY SPHERE DRAWING ───────────────────────────────────
function drawEnergySphere(x, y, color, time) {
  const pulse = 1 + 0.15 * Math.sin(time * 0.08);
  const radius = SPHERE_BASE_SIZE * pulse;

  // Outer glow
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
  if (color === 'blue') {
    grad.addColorStop(0, 'rgba(0, 191, 255, 0.5)');
    grad.addColorStop(0.3, 'rgba(0, 100, 255, 0.25)');
    grad.addColorStop(1, 'rgba(0, 50, 200, 0)');
  } else {
    grad.addColorStop(0, 'rgba(255, 68, 68, 0.5)');
    grad.addColorStop(0.3, 'rgba(255, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(200, 0, 0, 0)');
  }
  ctx.beginPath();
  ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Mid glow
  const grad2 = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.5);
  if (color === 'blue') {
    grad2.addColorStop(0, 'rgba(100, 220, 255, 0.7)');
    grad2.addColorStop(0.5, 'rgba(0, 150, 255, 0.3)');
    grad2.addColorStop(1, 'rgba(0, 80, 200, 0)');
  } else {
    grad2.addColorStop(0, 'rgba(255, 150, 100, 0.7)');
    grad2.addColorStop(0.5, 'rgba(255, 50, 50, 0.3)');
    grad2.addColorStop(1, 'rgba(200, 0, 0, 0)');
  }
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
  ctx.fillStyle = grad2;
  ctx.fill();

  // Core
  const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  if (color === 'blue') {
    coreGrad.addColorStop(0, 'rgba(200, 240, 255, 1)');
    coreGrad.addColorStop(0.4, 'rgba(0, 191, 255, 0.9)');
    coreGrad.addColorStop(1, 'rgba(0, 100, 255, 0.4)');
  } else {
    coreGrad.addColorStop(0, 'rgba(255, 230, 200, 1)');
    coreGrad.addColorStop(0.4, 'rgba(255, 68, 68, 0.9)');
    coreGrad.addColorStop(1, 'rgba(255, 0, 0, 0.4)');
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();

  // Rotating light streaks
  ctx.save();
  ctx.translate(x, y);
  const rotationDir = color === 'blue' ? 1 : -1;
  ctx.rotate((time * 0.03 * rotationDir) % (Math.PI * 2));
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const sx = Math.cos(angle) * radius * 0.3;
    const sy = Math.sin(angle) * radius * 0.3;
    const ex = Math.cos(angle) * radius * 2.2;
    const ey = Math.sin(angle) * radius * 2.2;

    const streakGrad = ctx.createLinearGradient(sx, sy, ex, ey);
    if (color === 'blue') {
      streakGrad.addColorStop(0, 'rgba(0, 191, 255, 0.4)');
      streakGrad.addColorStop(1, 'rgba(0, 100, 255, 0)');
    } else {
      streakGrad.addColorStop(0, 'rgba(255, 68, 68, 0.4)');
      streakGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
    }

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = 2;
    ctx.strokeStyle = streakGrad;
    ctx.stroke();
  }
  ctx.restore();
}

// ─── HOLLOW PURPLE SPHERE ────────────────────────────────────
function drawHollowPurpleSphere(x, y, radius, progress) {
  const intensity = Math.min(1, progress * 2);

  // Massive outer glow
  const outerGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 4);
  outerGrad.addColorStop(0, `rgba(168, 85, 247, ${0.6 * intensity})`);
  outerGrad.addColorStop(0.3, `rgba(128, 0, 255, ${0.3 * intensity})`);
  outerGrad.addColorStop(0.6, `rgba(80, 0, 200, ${0.1 * intensity})`);
  outerGrad.addColorStop(1, 'rgba(50, 0, 150, 0)');
  ctx.beginPath();
  ctx.arc(x, y, radius * 4, 0, Math.PI * 2);
  ctx.fillStyle = outerGrad;
  ctx.fill();

  // Mid glow
  const midGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 2);
  midGrad.addColorStop(0, `rgba(200, 150, 255, ${0.8 * intensity})`);
  midGrad.addColorStop(0.5, `rgba(168, 85, 247, ${0.5 * intensity})`);
  midGrad.addColorStop(1, `rgba(128, 0, 255, ${0.1 * intensity})`);
  ctx.beginPath();
  ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
  ctx.fillStyle = midGrad;
  ctx.fill();

  // Bright core
  const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  coreGrad.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
  coreGrad.addColorStop(0.3, `rgba(220, 180, 255, ${0.9 * intensity})`);
  coreGrad.addColorStop(0.6, `rgba(168, 85, 247, ${0.7 * intensity})`);
  coreGrad.addColorStop(1, `rgba(128, 0, 255, ${0.3 * intensity})`);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();

  // Distortion ring
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.3, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(168, 85, 247, ${0.5 * intensity})`;
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ─── SHOCKWAVE RING ──────────────────────────────────────────
function spawnShockwave(x, y) {
  shockwaveRings.push({
    x, y,
    radius: 10,
    maxRadius: Math.max(canvas.width, canvas.height) * 0.8,
    alpha: 1,
    speed: 12
  });
}

function updateAndDrawShockwaves() {
  for (let i = shockwaveRings.length - 1; i >= 0; i--) {
    const ring = shockwaveRings[i];
    ring.radius += ring.speed;
    ring.alpha = Math.max(0, 1 - ring.radius / ring.maxRadius);

    if (ring.alpha <= 0) {
      shockwaveRings.splice(i, 1);
      continue;
    }

    // Color-aware shockwaves (blue/red for attacks, purple for hollow purple)
    let r1, g1, b1;
    if (ring.color === 'blue')        { r1=0; g1=191; b1=255; }
    else if (ring.color === 'red')    { r1=255; g1=68; b1=68; }
    else                              { r1=168; g1=85; b1=247; }

    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r1}, ${g1}, ${b1}, ${ring.alpha * 0.6})`;
    ctx.lineWidth = 4 * ring.alpha;
    ctx.stroke();

    // Inner ring
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${ring.alpha * 0.3})`;
    ctx.lineWidth = 2 * ring.alpha;
    ctx.stroke();
  }
}

// ─── CONVERGING ENERGY LINES (during hollow purple charge) ───
function drawConvergingLines(fromX, fromY, toX, toY, color, time) {
  const numLines = 5;
  for (let i = 0; i < numLines; i++) {
    const progress = ((time * 0.03 + i / numLines) % 1);
    const x = fromX + (toX - fromX) * progress;
    const y = fromY + (toY - fromY) * progress;

    const size = 4 * (1 - progress);
    const alpha = 0.6 * (1 - progress);

    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    if (color === 'blue') {
      ctx.fillStyle = `rgba(0, 191, 255, ${alpha})`;
    } else {
      ctx.fillStyle = `rgba(255, 68, 68, ${alpha})`;
    }
    ctx.fill();
  }
}

function getTechniqueCenter() {
  return {
    x: canvas.width * 0.42,
    y: canvas.height * 0.38
  };
}

function getPowerAnchor(color) {
  const center = getTechniqueCenter();
  const spread = Math.min(170, canvas.width * 0.13);
  return {
    x: color === 'blue' ? center.x - spread : center.x + spread,
    y: center.y
  };
}

function getPowerDirection(hand, color) {
  if (hand) {
    const mag = Math.hypot(hand.dirX, hand.dirY) || 1;
    return { x: hand.dirX / mag, y: hand.dirY / mag };
  }

  // Default launch directions if hand direction is unavailable.
  const dx = color === 'blue' ? -0.25 : 0.25;
  const dy = -1;
  const mag = Math.hypot(dx, dy) || 1;
  return { x: dx / mag, y: dy / mag };
}

function drawRuntimeHud() {
  const baseX = 34;
  const baseY = 58;
  ctx.textAlign = 'left';

  // Background panel for HUD readability
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(baseX - 12, baseY - 28, 380, 160);

  ctx.font = '700 26px Orbitron, sans-serif';
  ctx.fillStyle = 'rgba(240, 245, 255, 0.95)';
  ctx.fillText(`FPS:${fpsValue.toFixed(2)}`, baseX, baseY);

  ctx.font = '700 26px Orbitron, sans-serif';
  ctx.fillStyle = 'rgba(196, 236, 255, 0.95)';
  ctx.fillText(`Finger Gesture:${currentGestureLabel}`, baseX, baseY + 34);

  // Mode + NUM info
  ctx.font = '600 18px Orbitron, sans-serif';
  ctx.fillStyle = 'rgba(0, 220, 130, 0.9)';
  ctx.fillText(`MODE:${debugStatus}`, baseX, baseY + 60);

  ctx.font = '600 18px Orbitron, sans-serif';
  ctx.fillStyle = 'rgba(180, 225, 255, 0.9)';
  ctx.fillText(`NUM:${handNumberValue}`, baseX, baseY + 82);

  // Debug: tracking stats
  ctx.font = '500 13px Rajdhani, sans-serif';
  ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
  ctx.fillText(`Frames→MP:${framesSent} | Hands:${handsResultCount} | Faces:${faceResultCount}`, baseX, baseY + 104);
  ctx.fillText(`Hands Det:${rawHandLandmarks.length} | Face Det:${faceLandmarks.length}`, baseX, baseY + 120);
}

function drawHandNumberOverlay() {
  if (handNumberValue < 1 || handNumberValue > 9 || currentGestureLabel === 'INFINITY VOID') return;

  const center = getTechniqueCenter();

  // Large glowing number display
  const numText = String(handNumberValue);

  // Outer glow
  ctx.save();
  ctx.font = '900 140px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(30, 144, 255, 0.8)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(30, 144, 255, 0.35)';
  ctx.fillText(numText, center.x, center.y - 60);
  ctx.restore();

  // Main number
  ctx.font = '900 120px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(52, 160, 255, 0.95)';
  ctx.fillText(numText, center.x, center.y - 60);

  // Bright inner highlight
  ctx.font = '900 120px Orbitron, sans-serif';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeText(numText, center.x, center.y - 60);

  // Label below number
  ctx.font = '600 18px Rajdhani, sans-serif';
  ctx.fillStyle = 'rgba(180, 220, 255, 0.8)';
  ctx.fillText(`FINGERS DETECTED: ${handNumberValue}`, center.x, center.y - 10);
}

function drawInfinityVoidOverlay() {
  if (infinityVoidTimer <= 0) return;

  const center = getTechniqueCenter();
  const progress = 1 - infinityVoidTimer / INFINITY_VOID_DURATION;
  const pulse = 1 + Math.sin(frameCount * 0.18) * 0.08;
  const radius = (130 + progress * 40) * pulse;

  const aura = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 2.4);
  aura.addColorStop(0, 'rgba(80, 0, 130, 0.42)');
  aura.addColorStop(0.5, 'rgba(56, 12, 122, 0.24)');
  aura.addColorStop(1, 'rgba(28, 12, 70, 0)');
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 2.4, 0, Math.PI * 2);
  ctx.fillStyle = aura;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(195, 160, 255, 0.85)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = '900 40px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(236, 224, 255, 0.97)';
  ctx.fillText('INFINITY VOID', center.x, center.y + 12);
}

// ─── PROJECTILE ATTACK SYSTEM ────────────────────────────────
function fireProjectile() {
  // Fire from whichever hand has an active power
  if (blueActive) {
    const blueAnchor = getPowerAnchor('blue');
    const blueDir = getPowerDirection(leftHand, 'blue');
    projectiles.push({
      x: blueAnchor.x, y: blueAnchor.y,
      vx: blueDir.x * PROJECTILE_SPEED,
      vy: blueDir.y * PROJECTILE_SPEED,
      color: 'blue',
      trail: [],
      life: 200  // max frames before auto-remove
    });
    flashVoiceFeedback('BLUE - GO');
  }
  if (redActive) {
    const redAnchor = getPowerAnchor('red');
    const redDir = getPowerDirection(rightHand, 'red');
    projectiles.push({
      x: redAnchor.x, y: redAnchor.y,
      vx: redDir.x * PROJECTILE_SPEED,
      vy: redDir.y * PROJECTILE_SPEED,
      color: 'red',
      trail: [],
      life: 200
    });
    flashVoiceFeedback('RED - GO');
  }
}

function updateAndDrawProjectiles() {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > PROJECTILE_TRAIL_LEN) p.trail.shift();

    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    // Check if out of bounds or life expired → spawn impact
    const margin = 40;
    const oob = p.x < -margin || p.x > canvas.width + margin ||
                p.y < -margin || p.y > canvas.height + margin;

    if (oob || p.life <= 0) {
      // Clamp impact position to screen edge
      const impX = Math.max(0, Math.min(canvas.width, p.x));
      const impY = Math.max(0, Math.min(canvas.height, p.y));
      spawnImpact(impX, impY, p.color);
      projectiles.splice(i, 1);
      continue;
    }

    // ── Draw trail ──
    for (let t = 0; t < p.trail.length; t++) {
      const alpha = (t / p.trail.length) * 0.6;
      const size = 3 + (t / p.trail.length) * 6;
      ctx.beginPath();
      ctx.arc(p.trail[t].x, p.trail[t].y, size, 0, Math.PI * 2);
      if (p.color === 'blue') {
        ctx.fillStyle = `rgba(0, 191, 255, ${alpha})`;
      } else {
        ctx.fillStyle = `rgba(255, 68, 68, ${alpha})`;
      }
      ctx.fill();
    }

    // ── Draw projectile head (energy sphere) ──
    drawEnergySphere(p.x, p.y, p.color, frameCount);
  }
}

// ─── ELECTRIFYING IMPACT EXPLOSION ───────────────────────────
function spawnImpact(x, y, color) {
  const bolts = [];
  // Generate 8-12 random lightning bolts radiating from impact center
  const numBolts = 8 + Math.floor(Math.random() * 5);
  for (let i = 0; i < numBolts; i++) {
    const angle = (i / numBolts) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const length = IMPACT_RADIUS * (0.5 + Math.random() * 0.8);
    bolts.push(generateLightningBolt(x, y, angle, length));
  }
  impacts.push({
    x, y, color, bolts,
    timer: 0,
    particles: createImpactParticles(x, y, color)
  });
  // Also spawn a shockwave at impact
  shockwaveRings.push({
    x, y,
    radius: 5,
    maxRadius: IMPACT_RADIUS * 3,
    alpha: 1,
    speed: 8,
    color: color  // we'll use this for colored shockwave
  });
}

function generateLightningBolt(startX, startY, angle, length) {
  const segments = [];
  const steps = 6 + Math.floor(Math.random() * 4);
  let cx = startX, cy = startY;
  const stepLen = length / steps;

  for (let i = 0; i < steps; i++) {
    // Add randomness to each segment (jagged lightning)
    const jitter = (Math.random() - 0.5) * stepLen * 1.2;
    const perpAngle = angle + Math.PI / 2;
    const nx = cx + Math.cos(angle) * stepLen + Math.cos(perpAngle) * jitter;
    const ny = cy + Math.sin(angle) * stepLen + Math.sin(perpAngle) * jitter;
    segments.push({ x1: cx, y1: cy, x2: nx, y2: ny });
    cx = nx;
    cy = ny;

    // Chance for a branch
    if (Math.random() < 0.3 && i > 1) {
      const branchAngle = angle + (Math.random() - 0.5) * 1.5;
      const branchLen = stepLen * (1 + Math.random());
      const bx = cx + Math.cos(branchAngle) * branchLen;
      const by = cy + Math.sin(branchAngle) * branchLen;
      segments.push({ x1: cx, y1: cy, x2: bx, y2: by, branch: true });
    }
  }
  return segments;
}

function createImpactParticles(x, y, color) {
  const particles = [];
  for (let i = 0; i < 25; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    particles.push({
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 2 + Math.random() * 4,
      color: color
    });
  }
  return particles;
}

function updateAndDrawImpacts() {
  for (let i = impacts.length - 1; i >= 0; i--) {
    const imp = impacts[i];
    imp.timer++;
    const progress = imp.timer / IMPACT_DURATION;

    if (progress >= 1) {
      impacts.splice(i, 1);
      continue;
    }

    const alpha = 1 - progress;
    const flickerAlpha = alpha * (0.5 + 0.5 * Math.random()); // electric flicker

    // ── Draw lightning bolts ──
    for (const bolt of imp.bolts) {
      for (const seg of bolt) {
        // Re-jitter segments slightly each frame for electric feel
        const jx = (Math.random() - 0.5) * 3;
        const jy = (Math.random() - 0.5) * 3;

        // Glow line (thick, transparent)
        ctx.beginPath();
        ctx.moveTo(seg.x1 + jx, seg.y1 + jy);
        ctx.lineTo(seg.x2 + jx, seg.y2 + jy);
        ctx.lineWidth = seg.branch ? 3 : 5;
        if (imp.color === 'blue') {
          ctx.strokeStyle = `rgba(0, 191, 255, ${flickerAlpha * 0.4})`;
        } else {
          ctx.strokeStyle = `rgba(255, 68, 68, ${flickerAlpha * 0.4})`;
        }
        ctx.stroke();

        // Core line (thin, bright)
        ctx.beginPath();
        ctx.moveTo(seg.x1 + jx, seg.y1 + jy);
        ctx.lineTo(seg.x2 + jx, seg.y2 + jy);
        ctx.lineWidth = seg.branch ? 1 : 2;
        if (imp.color === 'blue') {
          ctx.strokeStyle = `rgba(180, 240, 255, ${flickerAlpha * 0.9})`;
        } else {
          ctx.strokeStyle = `rgba(255, 200, 180, ${flickerAlpha * 0.9})`;
        }
        ctx.stroke();
      }
    }

    // ── Impact center glow ──
    const glowRadius = IMPACT_RADIUS * (0.3 + 0.7 * (1 - progress));
    const centerGrad = ctx.createRadialGradient(imp.x, imp.y, 0, imp.x, imp.y, glowRadius);
    if (imp.color === 'blue') {
      centerGrad.addColorStop(0, `rgba(200, 240, 255, ${alpha * 0.8})`);
      centerGrad.addColorStop(0.3, `rgba(0, 191, 255, ${alpha * 0.5})`);
      centerGrad.addColorStop(1, `rgba(0, 100, 255, 0)`);
    } else {
      centerGrad.addColorStop(0, `rgba(255, 230, 200, ${alpha * 0.8})`);
      centerGrad.addColorStop(0.3, `rgba(255, 68, 68, ${alpha * 0.5})`);
      centerGrad.addColorStop(1, `rgba(255, 0, 0, 0)`);
    }
    ctx.beginPath();
    ctx.arc(imp.x, imp.y, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = centerGrad;
    ctx.fill();

    // ── Impact particles ──
    for (const p of imp.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96; // friction
      p.vy *= 0.96;
      p.life -= 0.018;
      if (p.life <= 0) continue;

      const pa = p.life * alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      if (p.color === 'blue') {
        ctx.fillStyle = `rgba(0, 191, 255, ${pa * 0.8})`;
      } else {
        ctx.fillStyle = `rgba(255, 68, 68, ${pa * 0.8})`;
      }
      ctx.fill();
    }
  }
}

// ─── MAIN RENDER LOOP ────────────────────────────────────────
let frameCount = 0;

function renderLoop() {
  frameCount++;
  const now = performance.now();
  const dt = Math.max(1, now - lastFrameTimestamp);
  fpsValue = fpsValue * 0.9 + (1000 / dt) * 0.1;
  lastFrameTimestamp = now;

  updateVideoFrameRect();
  if (stageGuide) {
    const active = blueActive || redActive || purpleActive || infinityVoidTimer > 0 || handNumberValue > 0;
    stageGuide.style.opacity = active ? '0.18' : '0.85';
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const blueAnchor = getPowerAnchor('blue');
  const redAnchor = getPowerAnchor('red');

  // ── HOLLOW PURPLE LOGIC ──
  if (purpleActive && !purpleFading) {
    hollowPurpleTimer++;

    mergePoint = {
      x: (blueAnchor.x + redAnchor.x) / 2,
      y: (blueAnchor.y + redAnchor.y) / 2
    };

    // Grow the purple sphere
    const progress = Math.min(1, hollowPurpleTimer / PURPLE_DURATION);
    purpleSphereRadius = PURPLE_MAX_RADIUS * easeOutExpo(progress);

    drawConvergingLines(blueAnchor.x, blueAnchor.y, mergePoint.x, mergePoint.y, 'blue', frameCount);
    drawConvergingLines(redAnchor.x, redAnchor.y, mergePoint.x, mergePoint.y, 'red', frameCount);

    // Draw the purple sphere
    drawHollowPurpleSphere(mergePoint.x, mergePoint.y, purpleSphereRadius, progress);

    // Purple particles around merge
    updateParticles(purpleParticles, mergePoint.x, mergePoint.y, 'purple');
    drawParticles(purpleParticles, mergePoint.x, mergePoint.y);

    // At peak, trigger flash + shockwave
    if (hollowPurpleTimer === Math.floor(PURPLE_DURATION * 0.7)) {
      flashOverlay.classList.add('active');
      spawnShockwave(mergePoint.x, mergePoint.y);
      setTimeout(() => flashOverlay.classList.remove('active'), 1800);
    }

    // After duration, start fade
    if (hollowPurpleTimer >= PURPLE_DURATION) {
      purpleFading = true;
      purpleFadeTimer = 0;
    }

  } else if (purpleFading) {
    purpleFadeTimer++;
    const fadeProgress = purpleFadeTimer / PURPLE_FADE_DURATION;

    if (mergePoint) {
      const fadeAlpha = Math.max(0, 1 - fadeProgress);
      ctx.globalAlpha = fadeAlpha;
      drawHollowPurpleSphere(mergePoint.x, mergePoint.y, purpleSphereRadius, 1);
      ctx.globalAlpha = 1;
    }

    if (purpleFadeTimer >= PURPLE_FADE_DURATION) {
      // Reset everything
      purpleActive = false;
      purpleFading = false;
      blueActive = false;
      redActive = false;
      hollowPurpleTimer = 0;
      purpleSphereRadius = 0;
      mergePoint = null;
      purpleParticles = [];
      blueParticles = [];
      redParticles = [];

      blueInd.classList.remove('active');
      redInd.classList.remove('active');
      purpleInd.classList.remove('active');
    }
  }

  // ── BLUE EFFECT ──
  if (blueActive && !purpleActive) {
    drawEnergySphere(blueAnchor.x, blueAnchor.y, 'blue', frameCount);
    updateParticles(blueParticles, blueAnchor.x, blueAnchor.y, 'blue');
    drawParticles(blueParticles, blueAnchor.x, blueAnchor.y);
  }

  // ── RED EFFECT ──
  if (redActive && !purpleActive) {
    drawEnergySphere(redAnchor.x, redAnchor.y, 'red', frameCount);
    updateParticles(redParticles, redAnchor.x, redAnchor.y, 'red');
    drawParticles(redParticles, redAnchor.x, redAnchor.y);
  }

  // ── HAND PROXIMITY VISUAL HINT (when both active, approaching) ──
  if (blueActive && redActive && !purpleActive) {
    const dist = Math.hypot(blueAnchor.x - redAnchor.x, blueAnchor.y - redAnchor.y);
    if (dist < MERGE_DISTANCE * 2) {
      const closeness = 1 - Math.max(0, dist - MERGE_DISTANCE) / MERGE_DISTANCE;
      // Draw connecting energy line
      ctx.beginPath();
      ctx.moveTo(blueAnchor.x, blueAnchor.y);
      ctx.lineTo(redAnchor.x, redAnchor.y);
      const lineGrad = ctx.createLinearGradient(blueAnchor.x, blueAnchor.y, redAnchor.x, redAnchor.y);
      lineGrad.addColorStop(0, `rgba(0, 191, 255, ${closeness * 0.5})`);
      lineGrad.addColorStop(0.5, `rgba(168, 85, 247, ${closeness * 0.6})`);
      lineGrad.addColorStop(1, `rgba(255, 68, 68, ${closeness * 0.5})`);
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 2 + closeness * 4;
      ctx.stroke();
    }
  }

  // ── PROJECTILES ──
  updateAndDrawProjectiles();

  // ── IMPACTS ──
  updateAndDrawImpacts();

  // ── SHOCKWAVES ──
  updateAndDrawShockwaves();

  // ── FACE MESH OVERLAYS ──
  for (const fl of faceLandmarks) {
    drawFaceMesh(fl);
  }

  // ── HAND SKELETON OVERLAYS ──
  for (const hand of rawHandLandmarks) {
    drawHandSkeleton(hand.landmarks, hand.label, hand.side);
    drawHandLockMarker(hand);
  }

  if (infinityVoidTimer > 0) {
    drawInfinityVoidOverlay();
    infinityVoidTimer--;
  }
  drawHandNumberOverlay();
  drawRuntimeHud();

  requestAnimationFrame(renderLoop);
}

// ─── EASING ──────────────────────────────────────────────────
function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}


