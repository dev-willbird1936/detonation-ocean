import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const OceanWorldModel = require('../ui/desktop/world-model.js');
const OceanDesktopModel = require('../ui/desktop/desktop-model.js');
const OceanSceneWorld = require('../ui/desktop/scene-world.js');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = path => JSON.parse(read(path));

const sandbox = { window: {} };
sandbox.globalThis = sandbox;
runInNewContext(read('desktop-comparison/previews/ocean-scenes.js'), sandbox);
runInNewContext(read('desktop-comparison/previews/ocean-scenarios/trench.js'), sandbox);
const { OceanScenes } = sandbox.window;
const data = sandbox.OceanScenarioData;
const seed = readJson('data/desktop-world-seed.json');
const selection = readJson('data/ocean-selection.json').depths.trench;

const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const CANONICAL_APPS = ['files', 'browser', 'mail', 'messages', 'mfa', 'updates', 'settings', 'terminal', 'notes', 'texteditor', 'calendar',
  'reminders', 'contacts', 'photos', 'media', 'calculator', 'clock', 'store', 'taskmanager', 'stickies', 'whiteboard'];
const SEEDED_ONLY = ['m-standup', 'm-budget', 'f-welcome', 'f-budget', 'Northwind', 'Alex Rivera', 'Priya Shah', 'Marcus Lee'];
// Real incident and product names belong in attackTitle only.
const REAL_NAMES = /sim swap|heartbleed|mirai|shadowhammer|asus|moveit|wannacry|slammer|blaster|sasser|conficker|equifax|log4|struts|openssl|microsoft|windows|macos|apple|google|amazon/i;
const START = Date.parse('2026-11-02T09:30:00Z');
const ids = selection.map(entry => entry.id);
const profileOf = id => ({ id, familyId: data[id].family, depthId: 'trench' });
const profileJson = id => readJson(`data/desktop-profiles/${id}.json`);
const worldFor = id => ({ ...OceanWorldModel.createWorld(seed, profileJson(id)), phase: 'desktop' });

// Plays one scenario through the real V2 model, projecting every revision into a validated world.
function session(id) {
  const scene = OceanScenes.get(id, selection.find(entry => entry.id === id));
  let now = START;
  let desk = OceanDesktopModel.createState(profileOf(id), scene, { runId: `run-${id}`.slice(0, 32) });
  let world = worldFor(id);
  const adopt = result => {
    assert.ok(result.ok, `${id}: refused (${result.reason})`);
    if (!result.changed) return;
    const prevDesk = desk;
    desk = result.state;
    const projected = OceanSceneWorld.project(world, { scene, desk, prevDesk, now });
    let next = projected.world;
    for (const intent of projected.intents) {
      const applied = OceanWorldModel.applyIntent(next, intent, now);
      assert.ok(applied.ok, `${id}: open ${JSON.stringify(intent)} refused (${applied.reason})`);
      next = applied.world;
    }
    const check = OceanWorldModel.validate(next);
    assert.ok(check.ok, `${id} at ${desk.scene.phase}/${desk.scene.stepId}: invalid world (${check.error})`);
    world = next;
  };
  const env = {
    scene,
    get desk() { return desk; },
    get world() { return world; },
    reduce: intent => adopt(OceanDesktopModel.reduce(desk, intent, now)),
    settle() {
      for (let guard = 0; guard < 20 && desk.scene.deadlineMs !== null && desk.scene.phase !== 'attack'; guard += 1) {
        now = Math.max(now, desk.scene.deadlineMs);
        adopt(OceanDesktopModel.tick(desk, now));
      }
    },
    fxDone: () => adopt(OceanDesktopModel.fxDone(desk, desk.scene.effectId, now)),
  };
  env.reduce({ kind: 'show-sign-in' });
  env.reduce({ kind: 'sign-in' });
  env.settle();
  return env;
}

const plain = value => JSON.parse(JSON.stringify(value));
const stringsOf = value => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(stringsOf) : []);

test('trench.js defines exactly the 12 trench selection ids, anchors keep their family', () => {
  assert.equal(selection.length, 12);
  assert.deepEqual(Object.keys(data).sort(), [...ids].sort());
  for (const entry of selection) {
    const scenario = data[entry.id];
    assert.equal(scenario.depth, 'trench', entry.id);
    assert.ok(FAMILIES.includes(scenario.family), `${entry.id} family`);
    if (entry.role === 'anchor') assert.equal(scenario.family, entry.family, `${entry.id} keeps the anchor family`);
    if (entry.year !== null) assert.equal(scenario.year, entry.year, `${entry.id} year`);
    assert.equal(OceanScenes.scenarioProblem(entry.id), null, entry.id);
  }
});

test('every scenario has the contract fields, a canonical focus app and a known attack kind', () => {
  for (const id of ids) {
    const scenario = data[id];
    assert.ok(Number.isInteger(scenario.year), `${id} year`);
    assert.ok(scenario.attackTitle.trim(), `${id} attackTitle`);
    assert.ok(['windows', 'macos'].includes(scenario.os), `${id} os`);
    assert.deepEqual(Object.keys(scenario.card).sort(), ['firstAction', 'next', 'software', 'victim'], `${id} card`);
    assert.ok(Object.values(scenario.card).every(text => text.trim()), `${id} card text`);
    assert.ok(OceanScenes.ATTACK_KINDS.includes(scenario.attackKind), `${id} attackKind`);
    assert.ok(scenario.focusApps.length > 0 && scenario.focusApps.every(app => CANONICAL_APPS.includes(app)), `${id} focusApps`);
    assert.deepEqual(plain(scenario.focusApps), [scenario.app], `${id} focuses the task app`);
    assert.equal(scenario.toast.length, 3, `${id} toast`);
    assert.equal(scenario.targets.length, 4, `${id} targets`);
    assert.ok(scenario.fell[1].length >= 3 && scenario.safe[1].length >= 2, `${id} debrief points`);
    if (scenario.app === 'updates') {
      assert.equal(scenario.monitor.rows.length, 3, `${id} rows`);
      assert.ok(scenario.monitor.title.length <= 20, `${id} monitor title fits the update column`);
      assert.ok(Object.keys(scenario.monitor.flip).every(index => scenario.monitor.rows[index]), `${id} flips point at rows`);
      assert.ok(scenario.monitor.alert, `${id} alert`);
    } else {
      assert.equal(scenario.app, 'files', id);
      assert.ok(scenario.folder && scenario.files.length >= 3 && scenario.alert, `${id} files task`);
    }
  }
});

test('an anchor scenario names the real incident only in attackTitle', () => {
  for (const id of ids) {
    const { attackTitle, year, os, attackKind, ...rest } = data[id];
    assert.ok(attackTitle && year);
    assert.doesNotMatch(stringsOf(rest).join('\n'), REAL_NAMES, `${id} copy`);
    const { sys: { wallpaperUrl, ...sys }, ...profile } = profileJson(id);
    assert.doesNotMatch(JSON.stringify({ ...profile, sys }), REAL_NAMES, `${id} profile`);
  }
});

test('copy has no URLs, typed input or non-fictional addresses', () => {
  for (const id of ids) {
    const text = [...stringsOf(data[id]), ...stringsOf(profileJson(id))].join('\n');
    assert.doesNotMatch(text, /https?:\/\/|www\./i, `${id} URL`);
    assert.doesNotMatch(text, /<input|type=.?password|passcode/i, `${id} input`);
    for (const [, domain] of text.matchAll(/@([A-Za-z0-9.-]+)/g)) assert.match(domain, /\.(example|invalid)$/i, `${id} ${domain}`);
  }
});

test('each profile merged onto the seed validates, fits the era and replaces the seed content', () => {
  for (const id of ids) {
    const profile = profileJson(id);
    const world = OceanWorldModel.createWorld(seed, profile);
    assert.ok(OceanWorldModel.validate(world).ok, id);
    assert.equal(profile.user.avatar, 'initials');
    assert.match(world.user.email, /\.example$/);
    assert.notEqual(world.user.name, seed.user.name, `${id} has its own victim`);
    assert.equal(world.fs.nodes.home.name, world.user.short, `${id} home folder`);
    assert.ok(world.installed.includes(data[id].app) && world.dock.pins.includes(data[id].app), `${id} task app is installed and pinned`);
    assert.ok(world.installed.includes('mail'), `${id} mail`);
    assert.ok(world.data.mail.messages.some(message => message.folder === 'inbox' && !message.read), `${id} has an unread message for the mail badge`);
    const json = JSON.stringify(world);
    for (const marker of SEEDED_ONLY) assert.ok(!json.includes(marker), `${id} still carries seed content ${marker}`);
    const year = String(data[id].year);
    const years = [...JSON.stringify(profile).matchAll(/"(\d{4})-\d{2}-\d{2}T/g)].map(match => match[1]);
    assert.ok(years.length > 0 && years.every(value => Math.abs(Number(value) - Number(year)) <= 1), `${id} seeded dates match ${year}`);
  }
});

test('wallpapers are same-origin images that exist on disk', () => {
  for (const id of ids) {
    const { wallpaperUrl } = profileJson(id).sys;
    assert.match(wallpaperUrl, /^\/previews\/(win11-final\/img\/wallpaper|macos-final)\/[A-Za-z0-9._/-]+\.jpg$/, id);
    assert.ok(existsSync(new URL(`../desktop-comparison${wallpaperUrl}`, import.meta.url)), `${id} ${wallpaperUrl}`);
  }
});

test('the loader builds a passive trench scene with a patched replay and no safe path', () => {
  for (const id of ids) {
    const scenario = data[id];
    const scene = OceanScenes.get(id, selection.find(entry => entry.id === id));
    assert.ok(scene, id);
    assert.equal(scene.profileId, id);
    assert.equal(scene.depthId, 'trench');
    assert.equal(scene.familyId, scenario.family);
    assert.equal(scene.os, scenario.os);
    assert.equal(scene.attackKind, scenario.attackKind);
    assert.deepEqual(plain(scene.focusApps), plain(scenario.focusApps));
    assert.equal(scene.safePath, null);
    assert.ok(scene.patched, `${id} patched replay`);
    assert.deepEqual(plain(scene.steps.map(step => step.id)), ['toast', 'task', 'event']);
    assert.deepEqual(plain(scene.steps.map(step => step.app)), ['toast', scenario.app, scenario.app]);
    assert.match(scene.introCard.line, new RegExp(`^The year is ${scenario.year}\\. You are a ${scenario.card.victim}`));
    assert.ok(scene.introCard.title.endsWith(`(${scenario.year})`), `${id} intro title`);
    assert.match(scene.debrief.fell.headline, /\S/);
    assert.match(scene.debrief.anchorNote, /^Inspired by /);
  }
});

test('each scenario plays to the attack on its own desktop and the patched replay ends safe', () => {
  for (const id of ids) {
    const scenario = data[id];
    const env = session(id);
    assert.deepEqual(env.world.scene.highlight, { app: scenario.app, ref: null }, `${id} lure highlight`);
    assert.ok(env.world.notifications.banners.some(item => item.id === 'sc-toast'), `${id} toast banner`);
    env.reduce({ kind: 'choose', choiceId: 'open' });
    if (scenario.app === 'updates') {
      assert.deepEqual(env.world.data.updates.map(item => item.status), ['installed', 'installed', 'installed'], id);
    } else {
      assert.equal(env.world.fs.nodes['sc-folder'].name, scenario.folder, id);
      assert.equal(env.world.fs.nodes['sc-item-1'].parentId, 'sc-folder', id);
    }
    env.settle();
    assert.equal(env.desk.scene.phase, 'attack', `${id} reaches the attack with no choice`);
    assert.ok(env.world.data.processes.some(item => item.id === 'sc-proc' && item.suspicious), `${id} suspicious process`);
    assert.ok(env.world.notifications.history.some(item => item.id === 'sc-alert'), `${id} alert`);
    if (scenario.app === 'updates') assert.equal(env.world.data.updates.filter(item => item.status === 'available').length, Object.keys(scenario.monitor.flip).length, id);
    env.fxDone();
    assert.equal(env.world.scene.phase, 'debrief');

    env.reduce({ kind: 'replay', path: 'safe' });
    env.settle();
    env.reduce({ kind: 'choose', choiceId: 'open' });
    env.settle();
    assert.equal(env.desk.scene.path, 'safe', `${id} patched replay`);
    assert.equal(env.world.data.processes, undefined, `${id} the patched replay starts no process`);
  }
});

test('the user, mailbox and files belong to the scenario victim', () => {
  const seen = new Set();
  for (const id of ids) {
    const world = worldFor(id);
    assert.ok(!seen.has(world.user.email), `${id} unique victim`);
    seen.add(world.user.email);
    const mail = world.data.mail.messages.filter(message => message.folder === 'inbox');
    assert.ok(mail.every(message => message.to === world.user.email), `${id} inbox is addressed to the victim`);
    assert.ok(world.data.mail.messages.filter(message => message.folder === 'sent').every(message => message.from.includes(world.user.email)), `${id} sent mail`);
    const files = Object.values(world.fs.nodes).filter(node => node.kind === 'file');
    assert.ok(files.length >= 2 && files.every(node => world.data.contents[node.contentId]), `${id} files have content`);
  }
});
