import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const OceanWorldModel = createRequire(import.meta.url)('../ui/desktop/world-model.js');

const scenarioSource = read('desktop-comparison/previews/ocean-scenarios/sunlight.js');
const context = {};
context.globalThis = context;
runInNewContext(scenarioSource, context);
const scenarios = JSON.parse(JSON.stringify(context.OceanScenarioData));

const scenesContext = { window: {} };
runInNewContext(read('desktop-comparison/previews/ocean-scenes.js'), scenesContext);

const selection = JSON.parse(read('data/ocean-selection.json')).depths.sunlight;
const seed = JSON.parse(read('data/desktop-world-seed.json'));
const profileOf = id => JSON.parse(read(`data/desktop-profiles/${id}.json`));

const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const ATTACK_KINDS = ['scareware', 'credential-phish', 'mfa-fatigue', 'oauth-consent', 'mass-mail-worm', 'macro-dropper', 'ransomware-encrypt', 'data-exfil', 'money-transfer', 'wallet-drain',
  'supply-chain-update', 'network-worm', 'botnet-ddos', 'account-takeover-post', 'sim-swap', 'spyware-surveillance', 'server-exploit-leak'];
const TARGET_KINDS = ['file', 'account', 'setting', 'window', 'network', 'secret'];
const REAL_NAMES = ['macdefender', 'follina', 'mydoom', 'keranger', 'carbanak', 'cyborg', 'melissa', 'iloveyou', 'emotet', 'securid', 'cryptolocker', 'locky'];
const REAL_BRANDS = /\b(Microsoft|Outlook|Excel|Word|Safari|Gmail|Apple|Transmission|Symantec|Norton|Kaspersky|Google|Yahoo)\b/;

test('sunlight scenarios cover exactly the 12 selected ids and do not collide with authored scenes', () => {
  assert.equal(selection.length, 12);
  assert.deepEqual(Object.keys(scenarios).sort(), selection.map(entry => entry.id).sort());
  for (const id of Object.keys(scenarios)) assert.equal(scenesContext.window.OceanScenes.profileIds.includes(id), false, id);
});

test('each scenario has the contract fields and agrees with the selection', () => {
  for (const entry of selection) {
    const scenario = scenarios[entry.id];
    assert.equal(scenario.depth, 'sunlight', entry.id);
    assert.ok(FAMILIES.includes(scenario.family), entry.id);
    if (entry.family !== null) assert.equal(scenario.family, entry.family, `${entry.id} anchor family`);
    if (entry.year !== null) assert.equal(scenario.year, entry.year, entry.id);
    assert.ok(Number.isInteger(scenario.year), `${entry.id} year`);
    assert.ok(scenario.attackTitle.includes(String(scenario.year)), entry.id);
    assert.ok(['windows', 'macos'].includes(scenario.os), entry.id);
    assert.ok(ATTACK_KINDS.includes(scenario.attackKind), entry.id);
    for (const key of ['victim', 'software', 'firstAction', 'next']) assert.ok(scenario.card[key].length > 8, `${entry.id} card.${key}`);
    assert.deepEqual(Object.keys(scenario.card).sort(), ['firstAction', 'next', 'software', 'victim']);
    for (const key of ['title', 'intro', 'caption', 'effect']) assert.ok(scenario[key].length > 10, `${entry.id} ${key}`);
  }
});

test('focusApps are canonical and sit on the sunlight attack path', () => {
  for (const [id, scenario] of Object.entries(scenarios)) {
    assert.ok(scenario.focusApps.length >= 2, id);
    assert.ok(scenario.focusApps.every(app => OceanWorldModel.CANONICAL_APPS.includes(app)), id);
    assert.deepEqual(scenario.focusApps, [scenario.via, 'files'], `${id}: lure app, then Files`);
  }
});

test('the lure fits ocean-scenes buildSteps sunlight fields and the gating table', () => {
  for (const [id, scenario] of Object.entries(scenarios)) {
    assert.ok(['mail', 'browser'].includes(scenario.via), id);
    assert.equal(scenario.toast.length, 3, id);
    assert.equal(scenario.toast[0], scenario.via === 'mail' ? 'Mail' : 'Browser', id);
    assert.equal(scenario.file.length, 3, id);
    assert.ok(scenario.file.every(part => typeof part === 'string' && part.length > 1), id);
    if (scenario.via === 'mail') {
      assert.equal(scenario.from.length, 2, id);
      assert.match(scenario.from[1], /^[^@\s]+@[a-z0-9.-]+\.example$/, id);
      assert.ok(scenario.subject.length > 5 && scenario.body.length === 2, id);
      assert.equal(scenario.page, undefined, id);
    } else {
      assert.match(scenario.page.url, /^[a-z0-9.-]+\.example\//, id);
      for (const key of ['brand', 'headline', 'text', 'button']) assert.ok(scenario.page[key].length > 3, `${id} page.${key}`);
      assert.equal(scenario.from, undefined, id);
    }
    assert.ok(scenario.targets.length >= 4, id);
    assert.ok(scenario.targets.every(([label, kind]) => label.length > 3 && TARGET_KINDS.includes(kind)), id);
  }
});

test('debrief text names the safe step at each stage', () => {
  for (const [id, scenario] of Object.entries(scenarios)) {
    for (const outcome of [scenario.fell, scenario.safe]) {
      assert.ok(outcome[0].length > 4, id);
      assert.ok(outcome[1].length >= 3 && outcome[1].every(point => point.length > 25), id);
    }
    const stages = scenario.fell[1].filter(point => /^Stage \d, the (mail|page|memo|file):/.test(point));
    assert.equal(stages.length, 2, `${id} names stage 1 and stage 2`);
    assert.ok(stages.every(point => /The safe step was/.test(point)), `${id} safe step per stage`);
  }
});

test('copy is unique across the 12 scenarios', () => {
  const fields = { title: s => s.title, intro: s => s.intro, caption: s => s.caption, effect: s => s.effect, fell: s => s.fell[0], safe: s => s.safe[0], toast: s => s.toast[2] };
  for (const [name, pick] of Object.entries(fields)) {
    const values = Object.values(scenarios).map(pick);
    assert.equal(new Set(values).size, values.length, name);
  }
});

test('only attackTitle and year carry the real attack name; no real brands', () => {
  for (const [id, scenario] of Object.entries(scenarios)) {
    const { attackTitle, ...rest } = scenario;
    const text = JSON.stringify({ rest, profile: profileOf(id) }).toLowerCase();
    for (const name of REAL_NAMES) assert.equal(text.includes(name), false, `${id} leaks ${name}`);
    assert.doesNotMatch(JSON.stringify({ rest, profile: profileOf(id) }), REAL_BRANDS, id);
    assert.ok(REAL_NAMES.some(name => attackTitle.toLowerCase().includes(name)), `${id} attackTitle names the attack`);
  }
});

test('no external URLs, password fields or non-fictional domains', () => {
  assert.doesNotMatch(scenarioSource, /https?:\/\//i);
  assert.doesNotMatch(scenarioSource, /<input|type: 'password'|\bpassword:/);
  for (const id of Object.keys(scenarios)) {
    const text = JSON.stringify(scenarios[id]) + JSON.stringify(profileOf(id));
    assert.doesNotMatch(text, /https?:\/\//i, id);
    assert.doesNotMatch(text, /<input|"type":"password"/, id);
    const domains = [...text.matchAll(/@([A-Za-z0-9.-]+)/g)].map(match => match[1].replace(/\.$/, ''));
    assert.ok(domains.length > 5, id);
    assert.ok(domains.every(domain => /\.(example|invalid)$/i.test(domain)), `${id}: ${domains.join()}`);
    const urls = [...text.matchAll(/"url":"([^"]+)"/g)].map(match => match[1]).filter(url => !url.startsWith('scene:'));
    assert.ok(urls.every(url => /^[a-z0-9.-]+\.example\//.test(url)), `${id}: ${urls.join()}`);
  }
});

test('each profile merges onto the seed and validates with world-model', () => {
  for (const [id, scenario] of Object.entries(scenarios)) {
    const overlay = profileOf(id);
    const world = OceanWorldModel.createWorld(seed, overlay);
    assert.deepEqual(OceanWorldModel.validate(world), { ok: true, error: null }, id);
    assert.equal(world.user.avatar, 'initials');
    assert.equal(world.fs.nodes.home.name, world.user.short, id);
    assert.ok(world.user.email.endsWith('.example'), id);
    assert.notEqual(world.user.name, seed.user.name, id);
    for (const app of [...scenario.focusApps, scenario.via]) assert.ok(world.installed.includes(app), `${id} installs ${app}`);
    assert.ok(world.dock.pins.includes(scenario.via), `${id} pins the lure app`);
    assert.equal(world.data.mail.messages.some(message => message.folder === 'inbox' && message.subject === scenario.subject), false, `${id} seeds no copy of the lure`);
    assert.ok(world.data.mail.messages.filter(message => message.folder === 'inbox').every(message => message.to === world.user.email), id);
    const nodeNames = Object.values(world.fs.nodes).map(node => node.name);
    assert.equal(nodeNames.includes(scenario.file[0]), false, `${id} does not pre-seed the lure file`);
    for (const node of ['f-welcome', 'f-q3', 'f-budget', 'f-handbook', 'f-offsite', 'f-installer', 'f-song']) assert.equal(world.fs.nodes[node], undefined, `${id} drops seed node ${node}`);
    assert.doesNotMatch(JSON.stringify(world.data), /northwind|Alex Rivera/i, `${id} carries no seed organisation`);
  }
});

test('profile wallpapers are same-origin images that exist', () => {
  for (const id of Object.keys(scenarios)) {
    const { wallpaperUrl } = profileOf(id).sys;
    assert.match(wallpaperUrl, /^\/previews\/(win11-final\/img\/wallpaper|macos-final)\/[A-Za-z0-9/_.-]+\.jpg$/, id);
    assert.ok(existsSync(new URL(`desktop-comparison${wallpaperUrl}`, root)), `${id} ${wallpaperUrl}`);
  }
});

test('era: apps, network and seeded dates match the attack year', () => {
  const MODERN_ONLY = ['mfa', 'clock'];
  for (const [id, scenario] of Object.entries(scenarios)) {
    const overlay = profileOf(id);
    const times = [
      ...overlay.data.mail.messages.map(message => message.time),
      ...Object.values(overlay.fs.nodes).filter(node => node?.modified).map(node => node.modified),
      ...overlay.data.notes.map(note => note.modified),
    ];
    assert.ok(times.length > 5, id);
    assert.ok(times.every(time => time.startsWith(String(scenario.year))), `${id}: ${times.find(time => !time.startsWith(String(scenario.year)))}`);
    if (scenario.year < 2013) for (const app of MODERN_ONLY) assert.equal(overlay.installed.includes(app), false, `${id} omits ${app}`);
    if (scenario.year < 2011) assert.equal(overlay.installed.includes('store'), false, `${id} omits store`);
    if (scenario.year <= 2004) assert.equal(overlay.sys.wifi, false, `${id} has no wireless`);
    if (scenario.year <= 2000) assert.equal(overlay.installed.includes('messages'), false, `${id} has no chat app`);
    assert.equal(scenario.os, id === 'macdefender-2011' || id === 'keranger-2016' ? 'macos' : 'windows', id);
  }
});
