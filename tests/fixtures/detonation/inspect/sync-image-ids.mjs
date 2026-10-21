// Sets `Image` in every recorded inspect fixture to the digest images.lock.json pins for that role.
// Run it after deploy/detonation/build-images.sh rewrites the lock: `node tests/fixtures/detonation/inspect/sync-image-ids.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const lock = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../deploy/detonation/images.lock.json', import.meta.url)), 'utf8'));
// The seed and holder run the detonate image.
const imageOf = { detonate: 'detonate', collect: 'collect', analyse: 'analyse', wine: 'wine', seed: 'detonate', holder: 'detonate' };

for (const [fixture, image] of Object.entries(imageOf)) {
  const file = `${here}${fixture}.json`;
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/^(\s*"Image": ")sha256:[0-9a-f]{64}(",?\r?\n)/m, `$1${lock[`detonation-ocean/${image}`]}$2`);
  if (next === text && !text.includes(lock[`detonation-ocean/${image}`])) throw new Error(`${fixture}: no top-level "Image" digest found`);
  writeFileSync(file, next);
  console.log(`${fixture}: ${lock[`detonation-ocean/${image}`]}`);
}
