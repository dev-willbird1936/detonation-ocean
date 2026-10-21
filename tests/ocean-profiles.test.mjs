import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOceanProfiles, loadOceanSelection } from '../backend/ocean-profiles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('selected list has 12 per depth: one forced anchor per family and six free picks, each linked to a creature profile', () => {
  const entries = loadOceanSelection(root);
  const { profiles, scenarios } = loadOceanProfiles(root);
  assert.equal(entries.length, 60);
  assert.equal(scenarios.length, 60);
  assert.equal(entries.filter(entry => entry.role === 'anchor').length, 30);
  assert.equal(entries.filter(entry => entry.role === 'free').length, 30);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 60);
  for (const profile of profiles) {
    const anchor = entries.find(entry => entry.role === 'anchor' && entry.family === profile.familyId && entry.depthId === profile.depthId);
    assert.equal(profile.anchor.id, anchor.id, profile.id);
  }
  const known = new Set(['sourced', 'partial', 'unsupported', 'needs-sources', 'provisional']);
  for (const entry of entries) {
    assert.ok(known.has(entry.status), entry.id);
    for (const url of entry.sources) assert.match(url, /^https:\/\//, entry.id);
    if (entry.status === 'sourced') assert.ok(entry.sources.length > 0, entry.id);
    if (entry.status === 'partial' || entry.status === 'unsupported') assert.ok(entry.note, `${entry.id} needs an explanatory note`);
  }
  assert.deepEqual(scenarios.map(entry => entry.status), entries.map(entry => entry.status));
  for (const scenario of scenarios) {
    assert.equal(scenario.depth, profiles.find(profile => profile.depthId === scenario.depthId)?.depth);
    if (scenario.role === 'anchor') {
      const profile = profiles.find(item => item.familyId === scenario.familyId && item.depthId === scenario.depthId);
      assert.ok(profile, scenario.id);
      assert.equal(scenario.family, profile.family);
      assert.equal(scenario.creature, profile.displayCreature);
    } else {
      assert.equal(scenario.familyId, null);
      assert.equal(scenario.family, null);
      assert.equal(scenario.creature, null);
    }
  }
});

test('docs/ocean-selection.md lists all 60 selected scenarios and is current', () => {
  const doc = readFileSync(join(root, 'docs/ocean-selection.md'), 'utf8');
  for (const entry of loadOceanSelection(root)) {
    assert.ok(doc.includes(entry.name), `${entry.id} missing from docs/ocean-selection.md`);
    for (const url of entry.sources) assert.ok(doc.includes(url), `${entry.id} source missing`);
  }
  assert.match(doc, /Generated from `data\/ocean-selection\.json`/);
});

test('catalog builds thirty profiles and maps them to thirty depth-coloured morphology images', () => {
  const { profiles, assets, morphologyAssets } = loadOceanProfiles(root);
  assert.equal(profiles.length, 30);
  assert.equal(assets.size, 30);
  assert.equal(morphologyAssets.size, 30);
  assert.deepEqual([...new Set(profiles.map(profile => profile.familyId))], [
    'deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction',
  ]);
  assert.deepEqual([...new Set(profiles.map(profile => profile.depthId))], ['sunlight', 'twilight', 'midnight', 'abyss', 'trench']);
  const stageByDepth = { sunlight: 'base-rich', twilight: 'base-rich', midnight: 'midnight-abyss', abyss: 'midnight-abyss', trench: 'trench' };
  for (const profile of profiles) {
    assert.equal(profile.id, `${profile.familyId}-${profile.depthId}`);
    assert.equal(profile.morphologyStage, stageByDepth[profile.depthId]);
    assert.match(profile.morphologyUrl, new RegExp(`^/ocean-morphology/[a-z-]+/${profile.depthId}\\.png$`));
    assert.equal(profile.morphologyStatus, 'candidate');
    const asset = assets.get(profile.assetUrl);
    assert.ok(asset, profile.id);
    assert.equal(createHash('sha256').update(asset.bytes).digest('hex'), profile.assetSha256);
    const morphology = morphologyAssets.get(profile.morphologyUrl);
    assert.ok(morphology, profile.id);
    assert.equal(createHash('sha256').update(morphology.bytes).digest('hex'), profile.morphologySha256);
    assert.equal(morphology.bytes.readUInt32BE(16), 256);
    assert.equal(morphology.bytes.readUInt32BE(20), 256);
    assert.equal(morphology.bytes[25], 6, 'profile morphology is true RGBA PNG');
  }
  for (const familyId of ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction']) {
    const familyProfiles = profiles.filter(profile => profile.familyId === familyId);
    const byDepth = depthId => familyProfiles.find(profile => profile.depthId === depthId);
    assert.equal(byDepth('sunlight').morphologyStage, byDepth('twilight').morphologyStage);
    assert.equal(byDepth('midnight').morphologyStage, byDepth('abyss').morphologyStage);
    assert.notEqual(byDepth('trench').morphologyStage, byDepth('abyss').morphologyStage);
    assert.equal(new Set(familyProfiles.map(profile => profile.morphologyUrl)).size, 5, 'each depth has its own colour variant');
  }
  assert.ok(profiles.filter(profile => profile.familyId === 'extortion-destruction').every(profile => profile.morphologyUrl.startsWith('/ocean-morphology/squid/')), 'squid line never falls back to octopus');
  assert.equal([...morphologyAssets.keys()].some(url => url.includes('octopus')), false);
  const squid = profiles.find(profile => profile.id === 'extortion-destruction-sunlight');
  assert.equal(squid.displayCreature, 'Squid / Kraken');
  assert.equal(squid.creature, 'Octopus / kraken', 'source taxonomy label remains unchanged');
});

test('profile depths use the harm tiers, not legacy SEV', () => {
  const { profiles } = loadOceanProfiles(root);
  assert.equal(profiles.find(profile => profile.id === 'deception-sunlight').action, 'Clean');
  assert.equal(profiles.find(profile => profile.id === 'deception-twilight').action, 'Risky or inconclusive');
  assert.equal(profiles.find(profile => profile.id === 'deception-midnight').action, 'Steals');
  assert.equal(profiles.find(profile => profile.id === 'deception-abyss').action, 'Takes control');
  assert.equal(profiles.find(profile => profile.id === 'deception-trench').action, 'Destroys');
});
