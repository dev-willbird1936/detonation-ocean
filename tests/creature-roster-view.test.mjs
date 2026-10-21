import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const prototypeDir = path.join(root, 'ocean-style-prototypes');
const rosterBytes = readFileSync(path.join(prototypeDir, 'creature-roster.json'));
const roster = JSON.parse(rosterBytes.toString('utf8'));
const viewScript = readFileSync(path.join(prototypeDir, 'creature-roster-view.js'), 'utf8');
const viewer = readFileSync(path.join(prototypeDir, 'index.html'), 'utf8');
const renderer = readFileSync(path.join(root, 'ui/abyss/assets/index-D8CplD1t.js'), 'utf8');
const rendererHtml = readFileSync(path.join(root, 'ui/abyss/index.html'), 'utf8');
const attacks = JSON.parse(readFileSync(path.join(root, 'data/attacks.json'), 'utf8')).attacks;
const delivery = JSON.parse(readFileSync(path.join(prototypeDir, 'style-depth-delivery-evidence.json'), 'utf8'));

function readProjection() {
  const context = { window: {} };
  vm.runInNewContext(viewScript, context);
  return JSON.parse(JSON.stringify(context.window.OCEAN_CREATURE_ROSTER));
}

test('viewer roster projection exactly matches the canonical renderer roster', () => {
  const projection = readProjection();
  assert.equal(projection.source, 'creature-roster.json');
  assert.equal(projection.sourceSha256, createHash('sha256').update(rosterBytes).digest('hex'));
  assert.deepEqual(projection.depthMapping, roster.depthMapping);
  assert.deepEqual(projection.tiers, roster.tiers);
});

test('canonical roster has the five mapped depths and renderer species counts', () => {
  assert.deepEqual(roster.tiers.map(tier => tier.id), [
    '01-sunlight', '02-twilight', '03-midnight', '04-abyss', '05-trench',
  ]);
  assert.deepEqual(roster.depthMapping, {
    Sunlight: 5, Twilight: 4, Midnight: 3, Abyss: 2, Trench: 1,
  });
  assert.deepEqual(roster.tiers.map(tier => tier.creatures.reduce((sum, animal) => sum + animal.count, 0)), [
    7, 2, 1, 10, 9,
  ]);
  assert.ok(roster.tiers.every(tier => tier.creatures.every(animal => animal.name && animal.features && animal.count > 0)));
});

test('renderer source and attack data support the roster depth and species mapping', () => {
  const depthSource = renderer.match(/HD=\{([^}]+)\}/)?.[1];
  assert.ok(depthSource);
  const depthValues = Object.fromEntries([...depthSource.matchAll(/(\d+):([\d.]+)/g)].map(([, severity, depth]) => [severity, Number(depth)]));
  assert.deepEqual(depthValues, { 5: 0, 4: 0.35, 3: 0.5, 2: 0.75, 1: 1 });
  assert.deepEqual([...rendererHtml.matchAll(/<section class="stage zone[^"]*"[^>]*data-sev="(\d+)"/g)].map(([, severity]) => Number(severity)), [5, 4, 3, 2, 1, 1, 1]);

  const vectorSpecies = {
    phishing: ['Frogfish', 'Twilight anglerfish', 'Anglerfish'],
    exploit: ['Viperfish'], botnet: ['Siphonophore'], theft: ['Cookiecutter shark'],
    'supply-chain': ['Isopod host fish'], espionage: ['Barreleye'],
    ransomware: ['Blue-ringed octopus', 'Kraken'], social: ['Cuttlefish'],
    vulnerability: ['Moray eel'], 'card-fraud': ['Sea lamprey'],
    wiper: ['Gulper eel'], bec: ['Mimic octopus'],
  };
  for (const [vector, names] of Object.entries(vectorSpecies)) {
    const start = renderer.indexOf(`${vector}:{ext:`) >= 0
      ? renderer.indexOf(`${vector}:{ext:`)
      : renderer.indexOf(`"${vector}":{ext:`);
    assert.notEqual(start, -1, `renderer defines ${vector}`);
    const definition = renderer.slice(start, start + 1300);
    for (const name of names) assert.ok(definition.includes(name), `${vector} maps to ${name}`);
  }
  assert.ok(renderer.includes('name:e=>e<.2?`Frogfish`:e<.6?`Twilight anglerfish`:`Anglerfish`'));
  assert.ok(renderer.includes('name:e=>e<.5?`Blue-ringed octopus`:`Kraken`'));

  const speciesFor = (attack, depth) => {
    if (attack.vector === 'phishing') return depth < 0.2 ? 'Frogfish' : depth < 0.6 ? 'Twilight anglerfish' : 'Anglerfish';
    if (attack.vector === 'ransomware') return depth < 0.5 ? 'Blue-ringed octopus' : 'Kraken';
    return Object.entries(vectorSpecies).find(([vector]) => vector === attack.vector)?.[1][0];
  };
  for (const tier of roster.tiers) {
    const severity = roster.depthMapping[tier.name];
    const depth = depthValues[severity];
    const derived = new Map();
    for (const attack of attacks.filter(item => item.sev === severity)) {
      const species = speciesFor(attack, depth);
      assert.ok(species, `mapped ${attack.vector}`);
      derived.set(species, (derived.get(species) ?? 0) + 1);
    }
    const listed = new Map(tier.creatures.map(creature => [creature.name, creature.count]));
    if (tier.name === 'Trench') {
      assert.deepEqual([...listed.keys()].sort(), [...derived.keys()].sort());
      assert.ok([...listed.values()].every(count => count === 1));
    } else assert.deepEqual(listed, derived);
  }
  assert.equal(delivery.generated_layers.assets.length, 30);
  assert.equal(new Set(delivery.generated_layers.assets.map(asset => `${asset.style}/${asset.depth}`)).size, 30);
});

test('standalone viewer loads canonical roster data before building depth alt text', () => {
  const rosterScriptAt = viewer.indexOf('<script src="creature-roster-view.js"></script>');
  const inlineScriptAt = viewer.indexOf('<script>', rosterScriptAt);
  assert.ok(rosterScriptAt >= 0 && inlineScriptAt > rosterScriptAt);
  assert.match(viewer, /window\.OCEAN_CREATURE_ROSTER\.tiers\.map/);
  assert.match(viewer, /creatures:tier\.creatures\.map\(c=>c\.name\)/);
  assert.doesNotMatch(viewer, /c\.count/);
  assert.doesNotMatch(viewer, /creatures:'(?:Six frogfish|Twilight anglerfish|Siphonophore)/);
});
