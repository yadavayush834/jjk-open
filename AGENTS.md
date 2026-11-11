# Limitless / jjk-open

Native ES modules, Vite, Canvas 2D, and MediaPipe Hand Landmarker. Preserve this lightweight stack; the old React/AI package metadata was unrelated to the app.

- `src/simulation.js` owns pure, time-based technique/target state. Do not tie durations or travel to render-frame counts.
- `src/renderer.js` draws logical CSS coordinates into a DPR-aware canvas. Cache reusable glow textures and keep expensive work bounded for laptop hardware.
- `src/gestures.js` owns hand identity, smoothing, hold timers, and hysteresis. A newly acquired pinched hand must not launch an accidental projectile.
- `src/tracking-worker.js` performs CPU inference in a module worker. Keep detection off the animation thread; allow one transferred ImageBitmap at a time and close it after processing.
- `src/tracking.js` owns camera/model startup and cleanup. Mark tracking ready only after model initialization, support cancellation, stop media tracks on disable, and preserve manual controls after errors.
- Never request microphone access for hand tracking. Voice is explicitly enabled separately and may use the browser's remote recognition service. Never claim voice is necessarily offline.
- `scripts/prepare-assets.mjs` prepares ignored local model/WASM files before dev/build. Keep immutable model versions and pinned npm dependencies. Runtime should not depend on third-party CDNs or Google Fonts.
- Keep hand coordinates mirrored consistently with object-fit cover. Reject stale/invalid landmarks. Test finger poses using landmarks, and real worker initialization using a synthetic camera; never record the user's real camera for QA.
- Required checks: `npm test`, `npm run build`, `npm run test:e2e`, and `npm run format:check`. Browser checks require the production build. Keep screenshots in docs/screenshots up to date.
- Preserve responsive layout, keyboard/touch fallback, accessible dialogs, real status/error messages, and reduced-motion controls.
