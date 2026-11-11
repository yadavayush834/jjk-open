import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
let tracker;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks(data.wasmRoot, true);
      tracker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.model, delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error.message || 'Hand model could not initialize.',
      });
    }
  }
  if (data.type === 'frame') {
    try {
      const start = performance.now();
      const result = tracker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({
        type: 'result',
        landmarks: result.landmarks,
        timestamp: data.timestamp,
        inferenceMs: performance.now() - start,
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error.message || 'Hand tracking stopped unexpectedly.',
      });
    } finally {
      data.bitmap.close();
    }
  }
};
