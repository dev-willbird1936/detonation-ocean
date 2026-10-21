import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deriveMenuTaxonomy, renderMenuReport } from '../tools/build-ocean-menu-taxonomy.mjs';

const raw = readFileSync(new URL('../data/attacks.json', import.meta.url));
const data = JSON.parse(raw.toString('utf8'));
const sha256 = createHash('sha256').update(raw).digest('hex');
const menu = deriveMenuTaxonomy(data, sha256);
const entries = new Map(menu.entries.map(e => [e.id, e]));
const evidence = JSON.parse(readFileSync(new URL('../data/ocean-taxonomy.json', import.meta.url), 'utf8'));

test('all 50 original records have exactly one of the five requested depths', () => {
  assert.equal(menu.entries.length, 50);
  assert.equal(entries.size, 50);
  assert.equal(menu.counts.assigned, 50);
  assert.deepEqual(menu.counts.depthCounts, { sunlight: 9, twilight: 1, midnight: 4, abyss: 5, trench: 31 });
  assert.equal(Object.values(menu.counts.depthCounts).reduce((a, b) => a + b, 0), 50);
  for (const source of data.attacks) {
    const entry = entries.get(source.id);
    assert.ok(menu.depths.some(d => d.id === entry.depth));
    assert.equal(entry.name, source.name);
    assert.equal(entry.legacyVector, source.vector);
    assert.equal(entry.legacySev, source.sev);
    assert.equal(entry.historicalConfidence, source.confidence);
    assert.equal(entry.entryType, source.type);
    assert.ok(source.source_urls.every(url => entry.sourceUrls.includes(url)));
  }
});

test('every fallback and reference position is labelled, not a invented mechanism', () => {
  assert.equal(menu.counts.documented, 37);
  assert.equal(menu.counts.editorial, 10);
  assert.equal(menu.counts.reference, 3);
  for (const entry of menu.entries) {
    if (['editorial', 'reference'].includes(entry.depthBasis)) assert.ok(entry.uncertaintyBadge);
    if (entry.depthBasis === 'editorial') assert.equal(entry.evidenceDepth, null);
  }
  for (const id of ['sony-2014', 'marriott-2018', 'npd-2024', 'anthem-2015']) {
    assert.equal(entries.get(id).depthBasis, 'editorial');
    assert.match(entries.get(id).uncertaintyBadge, /unconfirmed/);
  }
});

test('the stricter evidence projection remains separate and unchanged', () => {
  for (const old of evidence.entries) {
    const entry = entries.get(old.id);
    assert.equal(entry.evidenceDepth, old.depth);
    assert.equal(entry.evidencePlacement, old.placement);
    assert.equal(entry.evidenceRationale, old.rationale);
  }
  assert.equal(evidence.counts.placed, 31);
  assert.equal(evidence.counts.unknown, 16);
});

test('single-factor organisation access is not conflated with victim password disclosure', () => {
  for (const id of ['colonial-2021', 'changehealth-2024']) {
    assert.equal(entries.get(id).depth, 'trench');
    assert.equal(entries.get(id).depthBasis, 'scenario');
    assert.match(entries.get(id).classificationScope, /Documented attacker access/);
  }
  assert.equal(entries.get('zeus-2007').depth, 'midnight');
  assert.match(entries.get('zeus-2007').classificationScope, /not initial malware installation/);
});

test('mixed campaigns use explicitly named variants', () => {
  assert.equal(entries.get('lapsus-2022').depth, 'twilight');
  assert.match(entries.get('lapsus-2022').classificationScope, /MFA-fatigue/);
  assert.equal(entries.get('stuxnet-2010').depth, 'trench');
  assert.match(entries.get('stuxnet-2010').classificationScope, /not first entry/);
  assert.equal(entries.get('lastpass-2022').depth, 'trench');
  assert.match(entries.get('lastpass-2022').classificationScope, /Second-incident/);
});

test('reference material is assigned a library location without becoming an attack', () => {
  assert.equal(entries.get('collection1-2019').depth, 'midnight');
  assert.equal(entries.get('vault7-2017').depth, 'trench');
  assert.equal(entries.get('lookalike-2005').depth, 'abyss');
  for (const id of ['collection1-2019','vault7-2017','lookalike-2005']) {
    assert.equal(entries.get(id).depthBasis, 'reference');
    assert.match(entries.get(id).uncertaintyBadge, /not a victim-compromise/);
  }
});

test('six-family matrix accounts for every entry and actual occupied combination', () => {
  assert.equal(menu.matrix.length, 6);
  assert.equal(menu.matrix.reduce((n, row) => n + row.total, 0), 50);
  assert.equal(menu.matrix.reduce((n, row) => n + Object.values(row.counts).reduce((a, b) => a + b, 0), 0), 50);
  assert.equal(menu.counts.occupiedFamilyDepthSlots, 14);
});

test('report lists every record and explicitly limits historical and integration claims', () => {
  const report = renderMenuReport(menu);
  for (const entry of menu.entries) assert.ok(report.includes(`\`${entry.id}\``));
  assert.match(report, /not automatically a verified initial-access fact/);
  assert.match(report, /have not been migrated or rebuilt/);
  assert.match(report, /editorial/);
});

test('source objects and the local-ocean runtime dataset are not modified', () => {
  const snapshot = JSON.stringify(data);
  deriveMenuTaxonomy(data, sha256);
  assert.equal(JSON.stringify(data), snapshot);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../local-ocean/data/attacks.json', import.meta.url), 'utf8')), data);
});

test('generated menu artefacts match current source and explicit decisions', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../data/ocean-menu-taxonomy.json', import.meta.url), 'utf8')), menu);
  assert.equal(readFileSync(new URL('../docs/ocean-menu-taxonomy.md', import.meta.url), 'utf8'), renderMenuReport(menu));
});
