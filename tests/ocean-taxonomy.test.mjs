import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deriveTaxonomy, renderReport, FAMILIES, DEPTHS } from '../tools/build-ocean-taxonomy.mjs';

const raw = readFileSync(new URL('../data/attacks.json', import.meta.url));
const data = JSON.parse(raw.toString('utf8'));
const sha256 = createHash('sha256').update(raw).digest('hex');
const taxonomy = deriveTaxonomy(data, sha256);
const byId = new Map(taxonomy.entries.map(e => [e.id, e]));

test('all 50 original IDs are classified once, with historical details preserved', () => {
  assert.equal(taxonomy.entries.length, 50);
  assert.equal(byId.size, 50);
  assert.equal(FAMILIES.length, 6);
  assert.equal(DEPTHS.length, 5);
  for (const original of data.attacks) {
    const entry = byId.get(original.id);
    assert.equal(entry.name, original.name);
    assert.equal(entry.year, original.year);
    assert.equal(entry.entryType, original.type);
    assert.equal(entry.historicalConfidence, original.confidence);
    assert.equal(entry.legacyVector, original.vector);
    assert.equal(entry.legacySev, original.sev);
    assert.deepEqual(entry.sourceUrls, original.source_urls);
    assert.ok(entry.secondaryTags.includes(original.vector));
    assert.ok(entry.victimPerspective && entry.rationale && entry.classificationScope);
  }
});

test('placed, unknown and reference rows sum to 50 without invented Trench placements', () => {
  assert.deepEqual(taxonomy.counts, { total: 50, placed: 31, unknown: 16, notApplicable: 3,
    occupiedFamilyDepthSlots: 12, possibleFamilyDepthSlots: 30 });
  for (const entry of taxonomy.entries) {
    if (entry.placement === 'placed') assert.ok(DEPTHS.some(d => d.id === entry.depth));
    else assert.equal(entry.depth, null);
  }
  assert.equal(taxonomy.matrix.reduce((n, row) => n + row.total, 0), 50);
  assert.equal(taxonomy.matrix.reduce((n, row) => n + Object.values(row.counts).reduce((a, b) => a + b, 0), 0), 31);
});

test('victim perspective prevents SIM interception and wallet approval being called victim OTP submission', () => {
  assert.equal(byId.get('simswap-2020').depth, 'trench');
  assert.match(byId.get('simswap-2020').victimPerspective, /Subscriber/);
  assert.match(byId.get('simswap-2020').rationale, /subscriber does not provide the code/);
  assert.equal(byId.get('drainer-2022').depth, 'abyss');
  assert.equal(taxonomy.entries.filter(e => e.depth === 'twilight').length, 0);
});

test('credential-entry techniques are distinct from preliminary navigation', () => {
  assert.equal(byId.get('smishing-2016').depth, 'midnight');
  assert.equal(byId.get('quishing-2024').depth, 'midnight');
  assert.equal(byId.get('oauth-2023').depth, 'abyss');
  assert.equal(byId.get('salesforce-2025').depth, 'abyss');
});

test('unknown provenance and multi-route entries remain unplaced', () => {
  for (const id of ['zeus-2007','target-2013','anthem-2015','ukraine-2015','opm-2015',
    'colonial-2021','vpnfilter-2018','lapsus-2022','lastpass-2022','att-2024','changehealth-2024','npd-2024']) {
    assert.equal(byId.get(id).placement, 'unknown', id);
    assert.equal(byId.get(id).depth, null, id);
  }
});

test('disclosures and standalone display risk are not fabricated victim attacks', () => {
  for (const id of ['vault7-2017','collection1-2019','lookalike-2005']) {
    assert.equal(byId.get(id).placement, 'not-applicable');
    assert.equal(byId.get(id).depth, null);
  }
});

test('primary family follows the curated dominant lesson while original subtypes remain badges', () => {
  for (const id of ['melissa-1999','iloveyou-2000','mydoom-2004','emotet-2014']) {
    assert.equal(byId.get(id).family, 'network-abuse');
    assert.ok(byId.get(id).secondaryTags.includes('phishing'));
  }
  assert.equal(byId.get('moveit-2023').family, 'theft-surveillance');
  assert.equal(byId.get('changehealth-2024').family, 'extortion-destruction');
  assert.equal(byId.get('rsa-2011').family, 'trusted-source');
});

test('the grouped report names every entry and makes the integration boundary explicit', () => {
  const report = renderReport(taxonomy);
  for (const entry of taxonomy.entries) assert.ok(report.includes(`\`${entry.id}\``));
  assert.match(report, /source catalogue|original.*unchanged/i);
  assert.match(report, /do not yet consume this projection/);
  assert.match(report, /earlier assertion that no-action deception cannot exist was too broad/);
});

test('classification does not mutate source objects or the runtime snapshot', () => {
  const before = JSON.stringify(data);
  deriveTaxonomy(data, sha256);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../local-ocean/data/attacks.json', import.meta.url), 'utf8')), data);
});

test('generated projection matches current source and curated decisions', () => {
  const generated = JSON.parse(readFileSync(new URL('../data/ocean-taxonomy.json', import.meta.url), 'utf8'));
  assert.deepEqual(generated, taxonomy);
  assert.equal(generated.sourceSha256, sha256);
  assert.equal(readFileSync(new URL('../docs/ocean-taxonomy.md', import.meta.url), 'utf8'), renderReport(taxonomy));
});
