import { GestureController } from './gestures.js';
export class HandTracking {
  constructor(video, onState, onResults) {
    this.video = video;
    this.onState = onState;
    this.onResults = onResults;
    this.gestures = new GestureController();
    this.generation = 0;
    this.running = false;
    this.loading = false;
    this.lastFrame = -Infinity;
    this.lastVideo = -1;
  }
  async start() {
    if (this.running || this.loading) return;
    const generation = ++this.generation;
    this.loading = true;
    this.onState('loading', 'Waiting for camera permission…');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera access needs localhost or HTTPS and a supported browser.');
      if (!window.Worker || !window.OffscreenCanvas)
        throw new Error(
          'This browser cannot run the tracking worker. Mouse and keyboard controls still work.',
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) return;
      this.onState('loading', 'Loading your local hand model…');
      this.worker = new Worker(new URL('./tracking-worker.js', import.meta.url), {
        type: 'module',
      });
      await new Promise((resolve, reject) => {
        this.rejectInit = reject;
        this.initTimer = setTimeout(
          () =>
            reject(
              new Error(
                'The hand model took too long to load. Try again; keyboard controls are ready.',
              ),
            ),
          30000,
        );
        this.worker.onerror = (event) =>
          reject(new Error(event.message || 'The tracking worker could not start.'));
        this.worker.onmessage = ({ data }) => {
          if (generation !== this.generation) return;
          if (data.type === 'ready') resolve();
          if (data.type === 'error') {
            if (this.loading) reject(new Error(data.message));
            else this.fail(data.message);
          }
          if (data.type === 'result') {
            this.pending = false;
            const result = this.gestures.update(data.landmarks, data.timestamp);
            this.onResults({
              ...result,
              timestamp: performance.now(),
              inferenceMs: data.inferenceMs,
            });
          }
        };
        this.worker.postMessage({
          type: 'init',
          wasmRoot: new URL('/vision', location.origin).href,
          model: new URL('/models/hand_landmarker.task', location.origin).href,
        });
      });
      clearTimeout(this.initTimer);
      this.rejectInit = null;
      if (generation !== this.generation) return;
      this.loading = false;
      this.running = true;
      this.pending = false;
      this.onState('ready', '');
      this.stream.getVideoTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (this.running)
            this.fail('Camera disconnected. Reconnect it and enable tracking again.');
        }),
      );
      const tick = async (timestamp) => {
        if (!this.running || generation !== this.generation) return;
        this.raf = requestAnimationFrame(tick);
        if (
          document.hidden ||
          this.pending ||
          timestamp - this.lastFrame < 80 ||
          this.video.readyState < 2 ||
          this.lastVideo === this.video.currentTime
        )
          return;
        this.lastFrame = timestamp;
        this.lastVideo = this.video.currentTime;
        this.pending = true;
        try {
          const bitmap = await createImageBitmap(this.video, {
            resizeWidth: 640,
            resizeHeight: Math.round((640 * this.video.videoHeight) / this.video.videoWidth),
          });
          if (generation !== this.generation) {
            bitmap.close();
            return;
          }
          this.worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
        } catch (error) {
          this.pending = false;
          if (generation === this.generation) this.fail(error.message);
        }
      };
      this.raf = requestAnimationFrame(tick);
    } catch (error) {
      if (generation === this.generation)
        this.fail(
          error.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow it in your browser, then retry. Mouse and keyboard still work.'
            : error.name === 'NotFoundError'
              ? 'No camera found. Connect one or enjoy mouse and keyboard controls.'
              : error.message,
        );
    }
  }
  fail(message) {
    this.stop();
    this.onState('error', message);
  }
  stop() {
    this.generation++;
    this.running = false;
    this.loading = false;
    this.pending = false;
    clearTimeout(this.initTimer);
    this.rejectInit?.(new Error('Camera start cancelled.'));
    this.rejectInit = null;
    cancelAnimationFrame(this.raf);
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.gestures.reset();
    this.onResults({ hands: [], pose: null, progress: 0, timestamp: performance.now() });
    this.onState('off', '');
  }
}
export const HAND_EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
export function coverPoint(point, boxWidth, boxHeight, videoWidth, videoHeight) {
  const scale = Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
  return {
    x: (1 - point.x) * videoWidth * scale - (videoWidth * scale - boxWidth) / 2,
    y: point.y * videoHeight * scale - (videoHeight * scale - boxHeight) / 2,
  };
}
export function drawHands(canvas, video, hands) {
  const bounds = canvas.getBoundingClientRect(),
    ratio = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(bounds.width * ratio) ||
    canvas.height !== Math.round(bounds.height * ratio)
  ) {
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
  }
  const c = canvas.getContext('2d');
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, bounds.width, bounds.height);
  for (const hand of hands) {
    const points = hand.landmarks.map((p) =>
      coverPoint(p, bounds.width, bounds.height, video.videoWidth || 640, video.videoHeight || 480),
    );
    c.strokeStyle = hand.pinched ? '#d7b9ff' : '#79dcfa99';
    c.lineWidth = 1.3;
    for (const [a, b] of HAND_EDGES) {
      c.beginPath();
      c.moveTo(points[a].x, points[a].y);
      c.lineTo(points[b].x, points[b].y);
      c.stroke();
    }
    for (const p of points) {
      c.beginPath();
      c.arc(p.x, p.y, 2, 0, Math.PI * 2);
      c.fillStyle = '#d5eeff';
      c.fill();
    }
  }
}
