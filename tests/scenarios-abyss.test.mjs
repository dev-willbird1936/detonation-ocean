import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const OceanWorldModel = require('../ui/desktop/world-model.js');
const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const readJson = path => JSON.parse(read(path));

const sandbox = { window: {} };
runInNewContext(read('desktop-comparison/previews/ocean-scenes.js'), sandbox);
runInNewContext(read('desktop-comparison/previews/ocean-scenarios/abyss.js'), sandbox);
const { OceanScenes } = sandbox.window;
// The scripts run in a vm context, so copy the data into this realm before deepEqual.
const data = JSON.parse(JSON.stringify(sandbox.OceanScenarioData));

const selection = readJson('data/ocean-selection.json').depths.abyss;
const seed = readJson('data/desktop-world-seed.json');
const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const TARGET_KINDS = ['window', 'setting', 'secret', 'file', 'account', 'network'];
const JOURNEY_STEPS = ['mailbox', 'redirect', 'payment'];
const profileOf = id => readJson(`data/desktop-profiles/${id}.json`);

// Every email address and bare host in a scenario or profile must be fictional.
function foreignDomains(value, found = []) {
  if (typeof value === 'string') {
    for (const [, domain] of value.matchAll(/@([A-Za-z0-9.-]+)/g)) if (!/\.(example|invalid)$/i.test(domain.replace(/\.$/, ''))) found.push(domain);
    for (const [, host] of value.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?=\/|\s|$)/gi)) {
      if (!/\.(example|invalid|txt|png|jpg|svg|js)$/i.test(host) && !/^\d/.test(host)) found.push(host);
    }
  } else if (Array.isArray(value)) value.forEach(item => foreignDomains(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => foreignDomains(item, found));
  return found;
}

test('abyss data covers exactly the 12 selected scenarios', () => {
  assert.equal(selection.length, 12);
  assert.deepEqual(Object.keys(data).sort(), selection.map(entry => entry.id).sort());
});

for (const entry of selection) {
  const scenario = data[entry.id];

  test(`${entry.id}: scenario fields`, () => {
    assert.equal(scenario.depth, 'abyss');
    assert.ok(FAMILIES.includes(scenario.family), 'family');
    if (entry.role === 'anchor') assert.equal(scenario.family, entry.family, 'anchor keeps its selection family');
    assert.ok(['windows', 'macos'].includes(scenario.os), 'os');
    assert.ok(Number.isInteger(scenario.year));
    if (entry.year !== null) assert.equal(scenario.year === entry.year || entry.id === 'cambridge-analytica', true, 'year follows the selection');
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(scenario.date));
    assert.ok(scenario.attackTitle.length > 0);
    assert.deepEqual(Object.keys(scenario.card).sort(), ['firstAction', 'next', 'software', 'victim']);
    for (const text of Object.values(scenario.card)) assert.ok(typeof text === 'string' && text.length > 0);
    assert.ok(OceanWorldModel.ATTACK_KINDS.includes(scenario.attackKind), `attackKind ${scenario.attackKind}`);
    assert.ok(scenario.focusApps.length > 0 && new Set(scenario.focusApps).size === scenario.focusApps.length);
    for (const app of scenario.focusApps) assert.ok(OceanWorldModel.CANONICAL_APPS.includes(app), app);
  });

  test(`${entry.id}: abyss copy has what buildSteps reads`, () => {
    for (const key of ['title', 'intro', 'subject', 'link', 'caption', 'effect']) assert.ok(typeof scenario[key] === 'string' && scenario[key], key);
    assert.equal(scenario.from.length, 2);
    assert.equal(scenario.toast.length, 3);
    assert.ok(scenario.body.length >= 1);
    const { consent } = scenario;
    for (const key of ['url', 'brand', 'app', 'publisher', 'headline', 'allow']) assert.ok(typeof consent[key] === 'string' && consent[key], `consent.${key}`);
    assert.equal(consent.perms.length, 3);
    assert.ok(/\.(example|invalid)(\/|$)/.test(consent.url), 'consent url is fictional');
    assert.ok(scenario.targets.length >= 3);
    for (const [label, kind] of scenario.targets) assert.ok(label && TARGET_KINDS.includes(kind), `${label}/${kind}`);
    for (const outcome of [scenario.fell, scenario.safe]) {
      assert.ok(outcome[0] && Array.isArray(outcome[1]) && outcome[1].length >= 2);
      assert.ok(outcome[1].every(line => typeof line === 'string' && line));
    }
  });

  test(`${entry.id}: debrief stages name a safe step at each choice`, () => {
    const { stages, attack, consentNote } = scenario.journey.debrief;
    assert.ok(attack && consentNote);
    const builtSteps = new Set(['toast', 'mail', 'consent', ...Object.keys(scenario.journey.steps)]);
    for (const key of Object.keys(scenario.journey.steps)) assert.ok(JOURNEY_STEPS.includes(key), key);
    const ids = stages.map(stage => stage.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.slice(0, 2), ['lure', 'consent']);
    assert.deepEqual(ids.slice(-2), ['attack', 'containment']);
    const covered = stages.flatMap(stage => stage.stepIds);
    assert.deepEqual([...covered].sort(), [...builtSteps].sort(), 'every built step belongs to a stage');
    for (const stage of stages) {
      assert.ok(stage.title && stage.detail);
      if (stage.stepIds.length) assert.ok(stage.safeStep, `${stage.id} names its safe step`);
      else assert.equal(stage.safeStep, null);
    }
  });

  test(`${entry.id}: profile validates on top of the world seed`, () => {
    const profile = profileOf(entry.id);
    const world = OceanWorldModel.createWorld(seed, profile);
    assert.equal(OceanWorldModel.validate(world).ok, true);
    assert.equal(world.user.avatar, entry.id);
    assert.ok(existsSync(new URL(`data/desktop-profiles/avatars/${entry.id}.svg`, root)), 'avatar file');
    assert.equal(world.fs.nodes.home.name, world.user.short);
    for (const app of scenario.focusApps) assert.ok(world.installed.includes(app), `${app} is installed`);
    assert.ok(world.installed.includes('mail') && world.installed.includes('browser'), 'lure path apps installed');
    assert.ok(world.data.mail.messages.every(message => Date.parse(message.time) < Date.parse(scenario.date)), 'seeded mail predates the scene date');
    assert.ok(world.data.mail.messages.every(message => message.folder === 'inbox' && !message.id.startsWith('sc-')));
    for (const nodeId of Object.keys(world.fs.nodes)) assert.ok(!nodeId.startsWith('sc-'), nodeId);
    assert.ok(!Object.hasOwn(world.fs.nodes, 'f-welcome'), 'seed files for the other persona are removed');
    assert.ok(!JSON.stringify(world).includes('Northwind'), 'no seed persona left behind');
    assert.ok(!JSON.stringify(profile).includes('"password"'), 'no password fields');
  });

  test(`${entry.id}: wallpaper is a same-origin file that exists`, () => {
    const { sys } = profileOf(entry.id);
    assert.equal(sys.wallpaper, 'stock');
    assert.match(sys.wallpaperUrl, /^\/previews\/(win11-final\/img\/wallpaper|macos-final)\/[A-Za-z0-9._/-]+\.jpg$/);
    assert.ok(existsSync(new URL(`desktop-comparison${sys.wallpaperUrl}`, root)), sys.wallpaperUrl);
  });

  test(`${entry.id}: only .example and .invalid domains`, () => {
    const { attackTitle, ...copy } = scenario; // the real attack name may look like a host (Polyfill.io)
    assert.ok(attackTitle);
    assert.ok(!/polyfill/i.test(JSON.stringify(copy)), 'real library name only in attackTitle');
    assert.deepEqual(foreignDomains(copy), []);
    assert.deepEqual(foreignDomains(profileOf(entry.id)), []);
  });
}

test('scenarios are spread across both operating systems and several families', () => {
  const oses = new Set(Object.values(data).map(scenario => scenario.os));
  assert.deepEqual([...oses].sort(), ['macos', 'windows']);
  assert.ok(new Set(Object.values(data).map(scenario => scenario.family)).size >= 5);
});

test('every free scenario got a family and every anchor keeps its own', () => {
  const free = selection.filter(entry => entry.role === 'free');
  assert.ok(free.length > 0);
  for (const entry of free) assert.ok(FAMILIES.includes(data[entry.id].family), entry.id);
});

test('the existing scene builder still accepts an abyss-shaped entry once the loader is in', { skip: typeof OceanScenes.fromScenarioData !== 'function' }, () => {
  for (const entry of selection) {
    const scene = OceanScenes.fromScenarioData(entry.id, data[entry.id], entry);
    assert.ok(scene && scene.steps.length >= 3, entry.id);
  }
});
