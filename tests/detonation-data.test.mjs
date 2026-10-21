import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readText = (relative) => readFileSync(join(root, relative), 'utf8');
const readJson = (relative) => JSON.parse(readText(relative));
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end));

const creatures = readJson('data/creatures.json');
const fish = readJson('data/fish.json');
const entries = [...creatures.creatures, ...creatures.system];

const specFindingIds = [...between(readText('docs/SPEC.md'), '### 6.5 Rule engine', '### 6.6 Compatibility')
  .matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);

const designFish = [...between(readText('docs/DETONATION-DESIGN.md'), '## 6. Per-upload fish', '## 7. Containment')
  .matchAll(/^\| [^|]+ \| ([^|]+) \|$/gm)]
  .map((match) => match[1].trim())
  .filter((name) => name !== 'Fish')
  .map((name) => name.toLowerCase().replaceAll(' ', '-'));

test('roster files parse with the expected shape', () => {
  assert.ok(Array.isArray(creatures.creatures));
  assert.ok(Array.isArray(creatures.system));
  assert.ok(Array.isArray(fish.fish));
  assert.equal(typeof fish.fallback, 'string');
});

test('every SPEC §6.5 finding ID appears exactly once in creatures', () => {
  assert.equal(specFindingIds.length, 22);
  const creatureIds = creatures.creatures.map((creature) => creature.findingId);
  for (const id of specFindingIds) {
    assert.equal(creatureIds.filter((found) => found === id).length, 1, id);
  }
  assert.deepEqual([...creatureIds].sort(), [...specFindingIds].sort());
});

test('every non-null sprite and fallback sprite exists on disk', () => {
  for (const entry of entries) {
    for (const key of ['sprite', 'fallbackSprite']) {
      if (entry[key] !== null) assert.ok(existsSync(join(root, entry[key])), `${entry.creature} ${key}: ${entry[key]}`);
    }
  }
});

test('only other-harm and the giant clam may have no fallback sprite', () => {
  for (const entry of entries) {
    if (entry.fallbackSprite === null) assert.ok(entry.findingId === 'other-harm' || entry.creature === 'Giant clam', entry.creature);
  }
});

test('every DETONATION-DESIGN §6 fish appears in fish.json', () => {
  assert.equal(designFish.length, 27);
  const species = new Set(fish.fish.map((entry) => entry.species));
  assert.equal(species.size, fish.fish.length);
  for (const name of designFish) assert.ok(species.has(name), name);
  assert.ok(species.has(fish.fallback));
});
