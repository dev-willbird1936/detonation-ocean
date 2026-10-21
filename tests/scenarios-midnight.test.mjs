import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const M = require('../ui/desktop/world-model.js');
const D = require('../ui/desktop/desktop-model.js');
const SceneWorld = require('../ui/desktop/scene-world.js');
const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const sandbox = { window: {} };
runInNewContext(read('desktop-comparison/previews/ocean-scenes.js'), sandbox);
runInNewContext(read('desktop-comparison/previews/ocean-scenarios/midnight.js'), sandbox);
const { OceanScenes } = sandbox.window;
// Values built inside the vm context have another Array prototype; copy them before deepStrictEqual.
const host = value => JSON.parse(JSON.stringify(value));
const data = host(sandbox.OceanScenarioData);

const selection = JSON.parse(read('data/ocean-selection.json')).depths.midnight;
const seed = JSON.parse(read('data/desktop-world-seed.json'));
const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const TARGET_KINDS = ['file', 'account', 'setting', 'window', 'network', 'secret'];
// Real names that may appear only in attackTitle and the debrief's inspired-by note.
const REAL_NAMES = {
  'podesta-2016': ['Podesta'], 'the-onion-2013': ['Onion'], 'twitter-stalkers-2011': ['Twitter'], 'pypi-juiceledger-2022': ['PyPI', 'JuiceLedger'],
  'ryan-collins-2014': ['Collins', 'Apple', 'Google'], 'instagram-ransom-2021': ['Instagram'], 'ap-2013': ['Associated Press'],
  'guardian-2013': ['Guardian'], 'ft-2013': ['Financial Times'], 'colin-powell-2016': ['Powell'],
};
const profileOf = id => JSON.parse(read(`data/desktop-profiles/${id}.json`));
const worldOf = id => M.createWorld(seed, profileOf(id));
const FICTIONAL_HOST = /(^|\.)[a-z0-9-]+\.(example|invalid)$/i;

test('midnight scenario data covers exactly the 12 selected midnight ids', () => {
  assert.equal(selection.length, 12);
  const ids = selection.map(entry => entry.id).sort();
  assert.deepEqual(Object.keys(data).filter(id => data[id].depth === 'midnight').sort(), ids);
  assert.deepEqual(host(OceanScenes.scenarioIds()).filter(id => ids.includes(id)).sort(), ids);
});

test('each entry has the contract fields and passes the loader checks', () => {
  for (const entry of selection) {
    const scenario = data[entry.id];
    assert.equal(OceanScenes.scenarioProblem(entry.id), null, entry.id);
    assert.equal(scenario.depth, 'midnight');
    if (entry.family) assert.equal(scenario.family, entry.family, `${entry.id} anchors keep their family`);
    else assert.ok(FAMILIES.includes(scenario.family), `${entry.id} free family`);
    assert.equal(scenario.year, entry.year ?? 2024, `${entry.id} year`);
    assert.ok(['windows', 'macos'].includes(scenario.os));
    assert.ok(OceanScenes.ATTACK_KINDS.includes(scenario.attackKind), `${entry.id} attackKind`);
    assert.ok(scenario.focusApps.length > 0 && scenario.focusApps.every(app => M.CANONICAL_APPS.includes(app)), `${entry.id} focusApps`);
    assert.deepEqual(Object.keys(scenario.card).sort(), ['firstAction', 'next', 'software', 'victim']);
    assert.ok(scenario.targets.length >= 4 && scenario.targets.every(([label, kind]) => label && TARGET_KINDS.includes(kind)), `${entry.id} targets`);
  }
});

test('the loader builds the midnight flow: toast, mail with link, sign-in page, no second factor', () => {
  for (const entry of selection) {
    const scene = OceanScenes.get(entry.id, null);
    assert.ok(scene, entry.id);
    assert.equal(scene.depthId, 'midnight');
    assert.equal(scene.familyId, data[entry.id].family);
    assert.equal(scene.attackKind, data[entry.id].attackKind);
    assert.equal(scene.os, data[entry.id].os);
    assert.deepEqual(host(scene.steps.map(step => step.id)), ['toast', 'mail', 'signin'], entry.id);
    assert.equal(scene.steps[1].mail.link.length > 0, true);
    const page = scene.steps[2].page;
    assert.equal(page.type, 'signin');
    assert.match(page.url, /^[a-z0-9.-]+\.(example|invalid)\//);
    assert.match(scene.introCard.line, new RegExp(`^The year is ${data[entry.id].year}\\. You are an? `));
    assert.ok(scene.safePath);
    for (const outcome of [scene.debrief.fell, scene.debrief.safe]) assert.ok(outcome.points.length >= 3 && outcome.points.every(point => point.length > 20));
    assert.match(scene.debrief.fell.points.join(' '), /Safe step at the message/, `${entry.id} names the safe step`);
    assert.match(scene.debrief.fell.points.join(' '), /Safe step at the (sign-in|login|logon) page/, `${entry.id} names the page safe step`);
  }
});

test('real attack names stay in attackTitle and the debrief only', () => {
  for (const [id, names] of Object.entries(REAL_NAMES)) {
    const { attackTitle, ...rest } = data[id];
    const copy = { ...rest, fell: undefined, safe: undefined };
    for (const name of names) {
      assert.equal(JSON.stringify(copy).includes(name), false, `${id} leaks ${name}`);
      assert.equal(JSON.stringify(profileOf(id)).includes(name), false, `${id} profile leaks ${name}`);
    }
    assert.ok(names.some(name => attackTitle.includes(name)), `${id} attackTitle names the real attack`);
  }
});

test('each profile merges onto the seed into a valid world for a fictional victim', () => {
  for (const entry of selection) {
    const profile = profileOf(entry.id);
    const world = worldOf(entry.id);
    assert.deepEqual(M.validate(world), { ok: true, error: null }, entry.id);
    assert.equal(world.user.avatar, entry.id);
    assert.match(world.user.email, /@[a-z0-9.-]+\.example$/);
    assert.equal(world.fs.nodes.home.name, world.user.short);
    assert.ok(existsSync(new URL(`data/desktop-profiles/avatars/${entry.id}.svg`, root)), `${entry.id} avatar`);
    assert.doesNotMatch(read(`data/desktop-profiles/avatars/${entry.id}.svg`).replace('xmlns="http://www.w3.org/2000/svg"', ''), /<image|href=|<script|http/);
    assert.equal(profile.user.name === 'Alex Rivera', false);
  }
});

test('the lure path is reachable: mail, browser, files and settings installed, focus apps installed, no authenticator', () => {
  for (const entry of selection) {
    const world = worldOf(entry.id);
    for (const app of ['mail', 'browser', 'files', 'settings']) assert.ok(world.installed.includes(app), `${entry.id} ${app}`);
    assert.ok(data[entry.id].focusApps.every(app => world.installed.includes(app)), `${entry.id} focusApps installed`);
    assert.equal(world.installed.includes('mfa'), false, `${entry.id} password-only scenes have no second factor`);
    assert.equal(world.data.mfa, undefined);
    assert.ok(world.dock.pins.includes('mail') && world.dock.pins.includes('browser'), `${entry.id} dock`);
    assert.ok(world.data.mail.messages.some(message => message.folder === 'inbox'), `${entry.id} inbox`);
  }
});

test('seeded data uses era dates, no scene ids, no leftovers from the default seed', () => {
  for (const entry of selection) {
    const world = worldOf(entry.id);
    const json = JSON.stringify(world.data) + JSON.stringify(world.fs);
    assert.equal(/"id":"sc-|scene:sc-/.test(json), false, `${entry.id} uses a scene id`);
    assert.equal(/northwind|Alex Rivera|Priya Shah|Marcus Lee/i.test(json), false, `${entry.id} keeps seed people`);
    assert.equal(Object.keys(world.fs.nodes).some(id => /^f-(welcome|q3|budget|handbook|offsite|installer|song)/.test(id)), false, `${entry.id} keeps seed files`);
    const years = world.data.mail.messages.map(message => Number(message.time.slice(0, 4)));
    const eraYear = data[entry.id].year;
    assert.ok(years.every(year => year === eraYear), `${entry.id} mail years ${years} vs ${eraYear}`);
    assert.ok(world.data.web.pages && Object.keys(world.data.web.pages).length >= 1, `${entry.id} has a seeded page`);
    assert.ok(world.data.browser.tabs.length >= 1 && world.data.browser.tabs.every(tab => world.data.web.pages[tab.url.replace('scene:', '')]), `${entry.id} tabs resolve`);
  }
});

test('wallpapers are same-origin images that exist in the shell builds', () => {
  for (const entry of selection) {
    const { wallpaperUrl } = profileOf(entry.id).sys;
    assert.match(wallpaperUrl, /^\/previews\/(win11-final|macos-final)\/[A-Za-z0-9._\/-]+\.jpg$/);
    assert.ok(existsSync(new URL(`desktop-comparison${wallpaperUrl}`, root)), `${entry.id} ${wallpaperUrl}`);
  }
});

test('only .example and .invalid domains, no real URLs, no password inputs', () => {
  for (const entry of selection) {
    const text = JSON.stringify(data[entry.id]) + JSON.stringify(profileOf(entry.id));
    assert.doesNotMatch(text, /https?:\/\//i, entry.id);
    assert.doesNotMatch(text, /<input|type="password"|"type":"password"/, entry.id);
    for (const match of text.matchAll(/@([A-Za-z0-9.-]+)/g)) assert.match(match[1].replace(/\.$/, ''), FICTIONAL_HOST, `${entry.id} address ${match[0]}`);
    const scene = OceanScenes.get(entry.id, null);
    assert.match(scene.steps[2].page.url.split('/')[0], FICTIONAL_HOST, `${entry.id} sign-in host`);
    assert.match(scene.steps[1].mail.from[1], /@[a-z0-9.-]+\.example$/);
    for (const page of Object.values(worldOf(entry.id).data.web.pages)) assert.match(page.url.split('/')[0], FICTIONAL_HOST, `${entry.id} page ${page.url}`);
  }
});

// Plays one scenario through the real V2 model on its own profile world and validates the projected world at every revision.
function play(id, safe) {
  const scene = OceanScenes.get(id, null);
  const START = Date.parse('2026-11-02T09:30:00Z');
  let now = START;
  let desk = D.createState({ id, familyId: scene.familyId, depthId: scene.depthId }, scene, { runId: `run-${id}`.slice(0, 32) });
  let world = { ...worldOf(id), phase: 'desktop' };
  const adopt = (result, label) => {
    assert.ok(result.ok, `${id}: ${label} refused (${result.reason})`);
    if (!result.changed) return;
    const prevDesk = desk;
    desk = result.state;
    const projected = SceneWorld.project(world, { scene, desk, prevDesk, now });
    let next = projected.world;
    for (const intent of projected.intents) {
      const applied = M.applyIntent(next, intent, now);
      assert.ok(applied.ok, `${id}: ${JSON.stringify(intent)} refused (${applied.reason})`);
      next = applied.world;
    }
    assert.deepEqual(host(M.validate(next)), { ok: true, error: null }, `${id} at ${desk.scene.stepId}`);
    world = next;
  };
  const settle = () => {
    for (let guard = 0; guard < 20 && desk.scene.deadlineMs !== null && desk.scene.phase !== 'attack'; guard += 1) {
      now = Math.max(now, desk.scene.deadlineMs);
      adopt(D.tick(desk, now), 'tick');
    }
  };
  adopt(D.reduce(desk, { kind: 'show-sign-in' }, now), 'show-sign-in');
  adopt(D.reduce(desk, { kind: 'sign-in' }, now), 'sign-in');
  settle();
  const stepOf = () => scene.steps.find(item => item.id === desk.scene.stepId);
  if (safe) {
    adopt(D.reduce(desk, { kind: 'choose', choiceId: 'open' }, now), 'open');
    settle();
    adopt(D.reduce(desk, { kind: 'choose', choiceId: D.choicesFor(stepOf()).safe[0] }, now), 'safe');
    settle();
    return { desk, world };
  }
  for (let guard = 0; guard < 12 && ['lure', 'action'].includes(desk.scene.phase); guard += 1) {
    const { forward } = D.choicesFor(stepOf());
    if (forward.length) adopt(D.reduce(desk, { kind: 'choose', choiceId: forward[0] }, now), forward[0]);
    settle();
  }
  return { desk, world };
}

test('every midnight scenario projects a valid world on its own profile, on the attack path and the safe path', () => {
  for (const entry of selection) {
    const fell = play(entry.id, false);
    assert.equal(fell.desk.scene.phase, 'attack', `${entry.id} reaches the attack`);
    assert.ok(fell.world.data.mail.messages.some(message => message.id === 'sc-mail' && message.folder === 'inbox'), `${entry.id} lure mail`);
    assert.ok(fell.world.data.web.pages['sc-signin'], `${entry.id} sign-in page`);
    const safe = play(entry.id, true);
    assert.equal(safe.desk.scene.path, 'safe', `${entry.id} safe path`);
  }
});
