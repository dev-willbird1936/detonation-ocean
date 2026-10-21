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
const seed = JSON.parse(read('data/desktop-world-seed.json'));
const selection = JSON.parse(read('data/ocean-selection.json')).depths.twilight;
const profileOf = id => JSON.parse(read(`data/desktop-profiles/${id}.json`));

const sandbox = { window: {} };
sandbox.globalThis = sandbox;
runInNewContext(read('desktop-comparison/previews/ocean-scenes.js'), sandbox);
runInNewContext(read('desktop-comparison/previews/ocean-scenarios/twilight.js'), sandbox);
const { OceanScenes } = sandbox.window;
const data = JSON.parse(JSON.stringify(sandbox.OceanScenarioData));

const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const TARGET_KINDS = ['file', 'account', 'setting', 'window', 'network', 'secret'];
const IDS = selection.map(entry => entry.id);
// The real attack name may appear only in attackTitle and the debrief note.
const REAL_NAMES = {
  '0ktapus-2022': ['0ktapus', 'okta'], 'uber-2022': ['uber'], tycoon2fa: ['tycoon'], 'retool-2023': ['retool'], 'dropbox-2022': ['dropbox'],
  'scattered-spider': ['scattered', 'spider'], 'twitter-2020': ['twitter'], 'cisco-2022': ['cisco'], 'lapsus-mfa-fatigue': ['lapsus'],
  'reddit-2023': ['reddit'], evilproxy: ['evilproxy'], 'midnight-blizzard-2023': ['midnight blizzard', 'blizzard'],
};
const REAL_BRANDS = ['microsoft', 'google', 'github', 'slack', 'twilio', 'cloudflare', 'circleci', 'concur', 'docusign', 'whatsapp', 'zoom', 'teams', 'office 365', 'outlook'];

test('twilight scenarios cover exactly the 12 selection ids', () => {
  assert.equal(selection.length, 12);
  assert.deepEqual(Object.keys(data).sort(), [...IDS].sort());
});

test('each scenario has the contract fields and the twilight step copy', () => {
  for (const entry of selection) {
    const scene = data[entry.id];
    assert.equal(scene.depth, 'twilight', entry.id);
    if (entry.role === 'anchor') assert.equal(scene.family, entry.family, `${entry.id} keeps its anchor family`);
    assert.ok(FAMILIES.includes(scene.family), `${entry.id} family`);
    assert.equal(scene.year, entry.year, `${entry.id} year`);
    assert.ok(typeof scene.attackTitle === 'string' && scene.attackTitle.includes(entry.name.split(' ')[0]), `${entry.id} attackTitle`);
    assert.ok(['windows', 'macos'].includes(scene.os), `${entry.id} os`);
    for (const key of ['victim', 'software', 'firstAction', 'next']) assert.ok(scene.card[key]?.length > 8, `${entry.id} card.${key}`);
    assert.ok(OceanWorldModel.ATTACK_KINDS.includes(scene.attackKind), `${entry.id} attackKind`);
    assert.ok(scene.focusApps.length >= 2 && scene.focusApps.every(app => OceanWorldModel.CANONICAL_APPS.includes(app)), `${entry.id} focusApps`);
    assert.ok(scene.title && scene.intro && scene.link && scene.subject && scene.caption && scene.effect, entry.id);
    assert.equal(scene.from.length, 2);
    assert.match(scene.from[1], /^[a-z0-9.-]+@[a-z0-9.-]+\.example$/);
    assert.equal(scene.toast.length, 3);
    assert.equal(scene.toast[0], 'Mail');
    assert.ok(scene.body.length >= 2 && scene.body.every(line => line.length > 10));
    for (const key of ['url', 'brand', 'headline', 'sub']) assert.ok(scene.signin[key], `${entry.id} signin.${key}`);
    assert.match(scene.signin.url, /^[a-z0-9.-]+\.example\/[a-z]+$/);
    if (scene.mfa.mode === 'push') {
      assert.match(scene.mfa.number, /^\d{2}$/, entry.id);
      for (const key of ['brand', 'title', 'text', 'approve', 'deny']) assert.ok(scene.mfa[key], `${entry.id} mfa.${key}`);
      assert.ok(scene.focusApps.includes('mfa'), `${entry.id} push scenes put the Authenticator on the path`);
    } else {
      assert.equal(scene.mfa.mode, 'code', entry.id);
      assert.match(scene.mfa.code, /^\d{6}$/);
      for (const key of ['headline', 'sub', 'button']) assert.ok(scene.mfa[key], `${entry.id} mfa.${key}`);
      assert.ok(scene.focusApps.includes('messages'), `${entry.id} code scenes put Messages on the path`);
    }
    assert.ok(scene.focusApps.includes('mail') && scene.focusApps.includes('browser'), `${entry.id} lure is mail then browser`);
    assert.ok(scene.targets.length >= 4 && scene.targets.every(([label, kind]) => label && TARGET_KINDS.includes(kind)), `${entry.id} targets`);
    for (const outcome of [scene.fell, scene.safe]) {
      assert.ok(outcome[0].length > 4);
      assert.ok(outcome[1].length >= 2 && outcome[1].every(point => point.length > 20));
    }
    assert.equal(scene.fell[1].length, 3, `${entry.id} fell names the safe step at the mail, sign-in and second-factor stages`);
  }
});

test('free scenarios use six different families across the depth, two creatures per family', () => {
  const counts = Object.fromEntries(FAMILIES.map(family => [family, 0]));
  for (const id of IDS) counts[data[id].family] += 1;
  assert.deepEqual(Object.values(counts), [2, 2, 2, 2, 2, 2]);
});

test('attack kinds match what each real attack did', () => {
  const expected = {
    '0ktapus-2022': 'credential-phish', 'uber-2022': 'mfa-fatigue', tycoon2fa: 'credential-phish', 'retool-2023': 'credential-phish',
    'dropbox-2022': 'data-exfil', 'scattered-spider': 'ransomware-encrypt', 'twitter-2020': 'account-takeover-post', 'cisco-2022': 'mfa-fatigue',
    'lapsus-mfa-fatigue': 'mfa-fatigue', 'reddit-2023': 'data-exfil', evilproxy: 'credential-phish', 'midnight-blizzard-2023': 'mfa-fatigue',
  };
  for (const id of IDS) assert.equal(data[id].attackKind, expected[id], id);
});

test('every profile merged onto the seed is a valid world for a fictional victim', () => {
  for (const id of IDS) {
    const overlay = profileOf(id);
    const world = OceanWorldModel.createWorld(seed, overlay);
    assert.ok(OceanWorldModel.validate(world).ok, id);
    assert.match(world.user.email, /@[a-z0-9.-]+\.example$/);
    assert.equal(world.fs.nodes.home.name, world.user.short, `${id} home folder`);
    assert.equal(world.user.avatar, 'initials');
    for (const app of data[id].focusApps) assert.ok(world.installed.includes(app), `${id} installs ${app}`);
    for (const app of ['mail', 'browser', 'mfa', 'messages']) assert.ok(world.dock.pins.includes(app), `${id} pins ${app}`);
    assert.equal(world.sys.wallpaper, 'stock');
    const wallpaper = world.sys.wallpaperUrl.replace(/^\/previews\//, 'desktop-comparison/previews/');
    assert.ok(existsSync(new URL(`../${wallpaper}`, import.meta.url)), `${id} wallpaper ${world.sys.wallpaperUrl} exists`);
    assert.ok(world.dock.badges.mail <= world.data.mail.messages.filter(item => item.folder === 'inbox' && !item.read).length || world.dock.badges.mail === 1, `${id} mail badge`);
    // No seed leftovers from the Northwind desktop.
    assert.equal(JSON.stringify(world.fs.nodes).includes('Welcome.txt'), false, `${id} drops the seed welcome file`);
    assert.equal(JSON.stringify(world).toLowerCase().includes('northwind'), false, `${id} has no Northwind residue`);
    assert.equal(world.data.browser.bookmarks.every(bookmark => world.data.web.pages[bookmark.url.slice(6)]), true, `${id} bookmarks point at pages`);
    assert.ok(world.data.mail.messages.every(message => message.subject !== data[id].subject), `${id} seeds do not contain the lure`);
  }
});

test('only .example / .invalid domains and no real names or brands appear anywhere', () => {
  for (const id of IDS) {
    const scene = data[id];
    const text = JSON.stringify({ ...scene, attackTitle: '' });
    const profile = JSON.stringify(profileOf(id));
    for (const [label, json] of [['scenario', text], ['profile', profile]]) {
      assert.doesNotMatch(json, /https?:\/\//i, `${id} ${label}`);
      for (const [, domain] of json.matchAll(/@([A-Za-z0-9.-]+)/g)) assert.match(domain, /\.(example|invalid)$/, `${id} ${label} address @${domain}`);
      assert.doesNotMatch(json, /\.(com|net|org|io|gov|edu|co\.uk)\b/i, `${id} ${label} real top-level domain`);
      assert.doesNotMatch(json, /<input|type=\\"password|"password"/i, `${id} ${label} password field`);
      for (const name of [...REAL_NAMES[id], ...REAL_BRANDS]) assert.equal(json.toLowerCase().includes(name), false, `${id} ${label} mentions ${name}`);
    }
    for (const [, host] of text.matchAll(/"url":"([^"]+)"/g)) assert.match(host, /^[a-z0-9.-]+\.example\//, `${id} url ${host}`);
    for (const page of Object.values(profileOf(id).data.web.pages)) assert.match(page.url, /^[a-z0-9.-]+\.example$/, id);
  }
});

const sceneOf = id => OceanScenes.get(id, selection.find(entry => entry.id === id));

function play(id, { safe }) {
  const scene = sceneOf(id);
  const NOW = Date.parse('2026-11-02T09:30:00Z');
  let desk = OceanDesktopModel.createState({ id, familyId: scene.familyId, depthId: 'twilight' }, scene, { runId: `run-${id}`.slice(0, 32) });
  let world = { ...OceanWorldModel.createWorld(seed, profileOf(id)), phase: 'desktop' };
  const seen = [];
  let now = NOW;
  const adopt = (result, label) => {
    assert.ok(result.ok, `${id}: ${label} refused (${result.reason})`);
    if (!result.changed) return;
    const prevDesk = desk;
    desk = result.state;
    const projected = OceanSceneWorld.project(world, { scene, desk, prevDesk, now });
    let next = projected.world;
    for (const intent of projected.intents) {
      const applied = OceanWorldModel.applyIntent(next, intent, now);
      assert.ok(applied.ok, `${id}: ${JSON.stringify(intent)} refused (${applied.reason})`);
      next = applied.world;
    }
    assert.ok(OceanWorldModel.validate(next).ok, `${id} at ${desk.scene.stepId}: ${OceanWorldModel.validate(next).error}`);
    world = next;
    seen.push({ stepId: desk.scene.stepId, highlight: world.scene.highlight });
  };
  const reduce = intent => adopt(OceanDesktopModel.reduce(desk, intent, now), JSON.stringify(intent));
  const settle = () => {
    for (let guard = 0; guard < 20 && desk.scene.deadlineMs !== null && desk.scene.phase !== 'attack'; guard += 1) {
      now = Math.max(now, desk.scene.deadlineMs);
      adopt(OceanDesktopModel.tick(desk, now), 'tick');
    }
  };
  const stepNow = () => scene.steps.find(item => item.id === desk.scene.stepId);
  reduce({ kind: 'show-sign-in' });
  reduce({ kind: 'sign-in' });
  settle();
  const lureWorld = world;
  if (safe) {
    reduce({ kind: 'choose', choiceId: 'open' });
    settle();
    reduce({ kind: 'choose', choiceId: OceanDesktopModel.choicesFor(stepNow()).safe[0] });
    settle();
    return { scene, desk, world, seen, lureWorld };
  }
  for (let guard = 0; guard < 12 && ['lure', 'action'].includes(desk.scene.phase); guard += 1) {
    const { forward } = OceanDesktopModel.choicesFor(stepNow());
    if (forward.length) reduce({ kind: 'choose', choiceId: forward[0] });
    settle();
  }
  return { scene, desk, world, seen, lureWorld };
}

test('the lure is reachable on every scenario: banner, highlighted mail, page, then the second factor, ending in the attack', () => {
  for (const id of IDS) {
    const a = data[id];
    const fell = play(id, { safe: false });
    const lure = fell.lureWorld;
    const banner = lure.notifications.banners.find(item => item.id === 'sc-toast');
    assert.equal(banner.app, 'mail', id);
    assert.deepEqual(lure.scene.highlight, { app: 'mail', ref: 'sc-mail' }, `${id} highlights the lure mail`);
    const mail = lure.data.mail.messages.find(item => item.id === 'sc-mail');
    assert.equal(mail.to, lure.user.email);
    assert.equal(mail.from, `${a.from[0]} <${a.from[1]}>`);
    assert.equal(mail.link, 'scene:sc-signin');
    assert.ok(lure.data.web.pages['sc-signin'], `${id} sign-in page exists before the link is followed`);
    assert.deepEqual(fell.seen.map(item => item.stepId).filter((stepId, index, list) => stepId && list.indexOf(stepId) === index).slice(0, 4), ['toast', 'mail', 'signin', 'mfa'], id);
    assert.equal(fell.desk.scene.phase, 'attack', `${id} reaches the attack`);
    assert.ok(fell.world.data.processes.some(item => item.id === 'sc-proc' && item.suspicious), id);
    if (a.mfa.mode === 'push') {
      assert.equal(fell.world.data.mfa.prompts[0].number, Number(a.mfa.number), `${id} push number`);
    } else {
      assert.match(fell.world.data.messages.threads[0].items[0].text, new RegExp(a.mfa.code), `${id} code text`);
      assert.match(fell.world.data.web.pages['sc-mfa'].body, new RegExp(a.mfa.code), `${id} code page`);
    }
    const safe = play(id, { safe: true });
    assert.equal(safe.desk.scene.path, 'safe', `${id} safe path`);
    assert.equal(safe.world.data.processes, undefined, `${id} safe path starts no process`);
  }
});

test('the engine loader accepts every scenario and builds the four-step flow, intro card, OS and focus apps', () => {
  assert.deepEqual([...OceanScenes.scenarioIds()].filter(id => IDS.includes(id)).sort(), [...IDS].sort());
  for (const entry of selection) {
    const id = entry.id;
    assert.equal(OceanScenes.scenarioProblem(id), null, id);
    const scene = JSON.parse(JSON.stringify(OceanScenes.get(id, entry)));
    assert.deepEqual(scene.steps.map(step => step.id), ['toast', 'mail', 'signin', 'mfa'], id);
    assert.equal(scene.title, data[id].title);
    assert.equal(scene.familyId, data[id].family);
    assert.equal(scene.depthId, 'twilight');
    assert.equal(scene.os, data[id].os);
    assert.equal(scene.attackKind, data[id].attackKind);
    assert.deepEqual(scene.focusApps, data[id].focusApps);
    const dated = data[id].year !== null;
    assert.equal(scene.introCard.title, dated ? `${data[id].attackTitle} (${data[id].year})` : data[id].attackTitle);
    assert.ok(scene.introCard.line.startsWith(`${dated ? `The year is ${data[id].year}. ` : ''}You are a ${data[id].card.victim}`), id);
    assert.ok(scene.safePath && scene.debrief.anchorNote.startsWith(`Inspired by ${entry.name}`), id);
    assert.equal(scene.steps.at(-1).app === 'mfa' ? scene.steps.at(-1).mfa.mode : scene.steps.at(-1).page.type, data[id].mfa.mode === 'push' ? 'push' : 'code', id);
  }
});
