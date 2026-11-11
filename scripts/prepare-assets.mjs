import { mkdir, cp, access, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const vision = dirname(require.resolve('@mediapipe/tasks-vision'));
await mkdir(resolve(root, 'public/models'), { recursive: true });
await cp(resolve(vision, 'wasm'), resolve(root, 'public/vision'), { recursive: true });
const model = resolve(root, 'public/models/hand_landmarker.task');
try {
  await access(model);
} catch {
  console.log('Downloading the local hand-tracking model (one time)…');
  const response = await fetch(
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok)
    throw new Error(
      `Hand model download failed: HTTP ${response.status}. Retry npm run dev when online.`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1000000) throw new Error('Incomplete model download. Please retry.');
  await writeFile(`${model}.partial`, bytes);
  await rename(`${model}.partial`, model);
}
console.log('Hand model and WebAssembly assets ready locally.');
