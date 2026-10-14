import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'assets', 'models');

const MODELS = [
  {
    targetRelPath: 'LittlestTokyo.glb',
    subPath: 'LittlestTokyo.glb'
  },
  {
    targetRelPath: path.join('RobotExpressive', 'RobotExpressive.glb'),
    subPath: 'RobotExpressive/RobotExpressive.glb'
  }
];

const URL_TEMPLATES = [
  (sub) => `https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/gltf/${sub}`,
  (sub) => `https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/${sub}`,
  (sub) => `https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/${sub}`,
  (sub) => `https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf/${sub}`
];

async function verifyAndSave(buffer, destPath) {
  // 1. Size check > 50 KB
  if (buffer.length < 50 * 1024) {
    throw new Error(`Downloaded file too small (${buffer.length} bytes, expected > 50 KB)`);
  }

  // 2. Magic bytes check: "glTF" in ASCII is 0x67 0x6C 0x54 0x46 (or decimal 103, 108, 84, 70)
  const magic = buffer.toString('utf8', 0, 4);
  if (magic !== 'glTF') {
    throw new Error(`Invalid GLB header: expected 'glTF', got '${magic}'`);
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  console.log(`[OK] Saved ${path.relative(projectRoot, destPath)} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
}

async function fetchModel(model) {
  const destPath = path.join(assetsDir, model.targetRelPath);

  // If already exists and valid, skip
  if (fs.existsSync(destPath)) {
    try {
      const existing = fs.readFileSync(destPath);
      const magic = existing.toString('utf8', 0, 4);
      if (magic === 'glTF' && existing.length > 50 * 1024) {
        console.log(`[EXISTS] ${model.targetRelPath} already downloaded and verified.`);
        return true;
      }
    } catch {
      // Re-download if invalid
    }
  }

  console.log(`Fetching ${model.targetRelPath}...`);

  for (let i = 0; i < URL_TEMPLATES.length; i++) {
    const url = URL_TEMPLATES[i](model.subPath);
    try {
      console.log(`  Trying [${i + 1}/${URL_TEMPLATES.length}]: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Peekaboo-Asset-Fetcher/1.0' } });
      if (!res.ok) {
        console.warn(`    Status ${res.status}: ${res.statusText}`);
        continue;
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await verifyAndSave(buffer, destPath);
      return true;
    } catch (err) {
      console.warn(`    Error fetching from ${url}:`, err.message);
    }
  }

  console.error(`[FAIL] Could not download ${model.targetRelPath} from any mirror.`);
  return false;
}

async function main() {
  console.log('=== Peekaboo 3D Model Asset Fetcher ===\n');
  fs.mkdirSync(assetsDir, { recursive: true });

  let allSuccess = true;
  for (const model of MODELS) {
    const success = await fetchModel(model);
    if (!success) allSuccess = false;
  }

  if (allSuccess) {
    console.log('\nAll 3D assets fetched and verified successfully!');
  } else {
    console.warn('\nSome assets could not be downloaded. The app will use procedural fallbacks where needed.');
  }
}

main().catch(console.error);
