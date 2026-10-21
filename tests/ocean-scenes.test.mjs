import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { loadOceanSelection } from '../backend/ocean-profiles.mjs';
import { FIXTURE_SCENARIOS } from './fixtures/scenario-fixtures.mjs';

const OceanWorldModel = createRequire(import.meta.url)('../ui/desktop/world-model.js');

const root = new URL('..', import.meta.url);
const source = readFileSync(new URL('desktop-comparison/previews/ocean-scenes.js', root), 'utf8');
const sandbox = { window: {} };
runInNewContext(source, sandbox);
const { OceanScenes } = sandbox.window;

const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];
const anchors = loadOceanSelection(fileURLToPath(root)).filter(entry => entry.role === 'anchor');
const anchorFor = (familyId, depthId) => anchors.find(entry => entry.family === familyId && entry.depthId === depthId);
const profiles = FAMILIES.flatMap(familyId => DEPTHS.map(depthId => ({ id: `${familyId}-${depthId}`, familyId, depthId })));
const sceneOf = ({ id, familyId, depthId }) => OceanScenes.get(id, anchorFor(familyId, depthId));

const STEP_FLOW = {
  sunlight: [['toast'], ['mail', 'page'], ['files']],
  twilight: [['toast'], ['mail'], ['signin'], ['mfa']],
  midnight: [['toast'], ['mail'], ['signin']],
  abyss: [['toast'], ['mail'], ['consent']],
  trench: [['toast'], ['task'], ['event']],
};
// Two abyss scenes play a longer multi-stage journey: business email compromise and the OAuth worm.
const JOURNEY_FLOWS = {
  'deception-abyss': [['toast'], ['mail'], ['consent'], ['mailbox'], ['redirect'], ['payment']],
  'network-abuse-abyss': [['toast'], ['mail'], ['consent'], ['mailbox']],
};
const flowFor = profile => JOURNEY_FLOWS[profile.id] ?? STEP_FLOW[profile.depthId];

test('OceanScenes covers all 30 profiles and rejects unknown ids', () => {
  assert.equal(profiles.length, 30);
  assert.equal(OceanScenes.profileIds.length, 30);
  for (const profile of profiles) {
    const scene = sceneOf(profile);
    assert.ok(scene, profile.id);
    assert.equal(scene.profileId, profile.id);
    assert.equal(scene.familyId, profile.familyId);
    assert.equal(scene.depthId, profile.depthId);
    assert.ok(scene.title && scene.intro);
  }
  assert.equal(OceanScenes.get('deception-nowhere', null), null);
  assert.equal(OceanScenes.get('nonsense', null), null);
});

test('each depth follows the contract flow and phases', () => {
  for (const profile of profiles) {
    const scene = sceneOf(profile);
    const flow = flowFor(profile);
    assert.equal(scene.steps.length, flow.length, profile.id);
    scene.steps.forEach((step, index) => {
      assert.ok(flow[index].includes(step.id), `${profile.id} step ${index}: ${step.id}`);
      assert.ok(['lure', 'action'].includes(step.phase), `${profile.id} ${step.id} phase`);
      assert.ok(['notice', 'benign', 'victim', 'auto'].includes(step.kind));
      assert.ok(['toast', 'mail', 'browser', 'files', 'mfa', 'updates'].includes(step.app));
    });
    assert.equal(scene.steps[0].phase, 'lure');
    assert.equal(scene.steps.at(-1).phase, 'action');
    assert.ok(scene.attack.targets.every(target => ['file', 'account', 'setting', 'window', 'network', 'secret'].includes(target.kind)));
    assert.ok(scene.attack.targets.length >= 4);
    assert.equal(scene.attack.kind, profile.familyId);
    assert.equal(scene.attack.depthId, profile.depthId);
  }
});

test('depth-specific interactions: sunlight file, twilight MFA, midnight sign-in, abyss consent', () => {
  for (const familyId of FAMILIES) {
    const sunlight = sceneOf({ id: `${familyId}-sunlight`, familyId, depthId: 'sunlight' });
    const files = sunlight.steps.at(-1);
    assert.equal(files.app, 'files');
    assert.equal(files.kind, 'victim');
    assert.ok(files.files.target[0]);
    const twilight = sceneOf({ id: `${familyId}-twilight`, familyId, depthId: 'twilight' });
    const mfa = twilight.steps.at(-1);
    assert.equal(twilight.steps.at(-2).id, 'signin');
    assert.ok(mfa.app === 'mfa' ? mfa.mfa.mode === 'push' && /^\d{2}$/.test(mfa.mfa.number) : mfa.page.type === 'code' && /^\d{6}$/.test(mfa.page.code));
    const midnight = sceneOf({ id: `${familyId}-midnight`, familyId, depthId: 'midnight' });
    assert.equal(midnight.steps.some(step => step.id === 'mfa'), false);
    assert.equal(midnight.steps.at(-1).page.type, 'signin');
    const abyss = sceneOf({ id: `${familyId}-abyss`, familyId, depthId: 'abyss' });
    const consent = abyss.steps.find(step => step.id === 'consent').page;
    assert.equal(consent.type, 'consent');
    assert.ok(consent.perms.length >= 3);
    assert.equal(abyss.steps.some(step => step.app === 'files'), false);
  }
});

test('trench has no victim action before the attack and offers a patched replay instead of a safe path', () => {
  for (const familyId of FAMILIES) {
    const scene = sceneOf({ id: `${familyId}-trench`, familyId, depthId: 'trench' });
    assert.equal(scene.steps.some(step => step.kind === 'victim'), false);
    assert.equal(scene.steps.map(step => step.kind).join(), 'notice,benign,auto');
    assert.equal(scene.safePath, null);
    assert.ok(scene.patched.label && scene.patched.note);
    assert.ok(scene.steps[1].autoMs > 0);
    assert.ok(scene.debrief.fell.headline && scene.debrief.safe.headline);
  }
});

test('non-trench scenes have a safe path and a debrief for both outcomes', () => {
  for (const profile of profiles.filter(item => item.depthId !== 'trench')) {
    const scene = sceneOf(profile);
    assert.ok(scene.safePath, profile.id);
    assert.equal(scene.patched, null);
    assert.ok(scene.steps.some(step => step.kind === 'victim'));
    for (const outcome of [scene.debrief.fell, scene.debrief.safe]) {
      assert.ok(outcome.headline.length > 4);
      assert.ok(outcome.points.length >= 2 && outcome.points.every(point => typeof point === 'string' && point.length > 10));
    }
  }
});

test('anchor appears only as inspired-by flavour in the debrief', () => {
  for (const profile of profiles) {
    const anchor = anchorFor(profile.familyId, profile.depthId);
    const scene = sceneOf(profile);
    assert.ok(anchor, profile.id);
    assert.ok(scene.debrief.anchorNote.startsWith(`Inspired by ${anchor.name}`), profile.id);
    assert.match(scene.debrief.anchorNote, /fictional reconstruction/);
    assert.equal(JSON.stringify({ ...scene, debrief: undefined }).includes(anchor.name), false, `${profile.id} leaks anchor name outside the debrief`);
  }
  assert.match(OceanScenes.get('deception-abyss', null).debrief.anchorNote, /Original synthetic scene/);
});

test('scenes carry no external URLs and no password input', () => {
  assert.doesNotMatch(source, /https?:\/\//i);
  assert.doesNotMatch(source, /<input|type: 'password'|type="password"|\bpassword: /);
  for (const profile of profiles) {
    const json = JSON.stringify(sceneOf(profile));
    assert.doesNotMatch(json, /https?:\/\//i, profile.id);
    assert.doesNotMatch(json, /"type":"password"|<input/, profile.id);
  }
  const signin = sceneOf(profiles.find(item => item.id === 'intrusion-midnight')).steps.at(-1).page;
  assert.equal(signin.account, 'training.user@example.test');
  assert.match(signin.url, /^[a-z0-9.-]+\.example\//);
});

test('copy is unique across the 30 profiles', () => {
  const fields = {
    title: scene => scene.title,
    intro: scene => scene.intro,
    toast: scene => scene.steps[0].toast.body,
    lure: scene => scene.steps[1].mail?.subject ?? scene.steps[1].page?.headline ?? scene.steps[1].monitor?.alert ?? scene.steps[1].alert,
    caption: scene => scene.attack.caption,
    effect: scene => scene.attack.effect,
    fell: scene => scene.debrief.fell.headline,
    safe: scene => scene.debrief.safe.headline,
    fellPoints: scene => scene.debrief.fell.points.join('|'),
    safePoints: scene => scene.debrief.safe.points.join('|'),
  };
  for (const [name, read] of Object.entries(fields)) {
    const values = profiles.map(profile => read(sceneOf(profile)));
    assert.ok(values.every(value => typeof value === 'string' && value.length > 3), name);
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
    assert.deepEqual(duplicates, [], `${name} duplicates`);
  }
});

test('get returns independent copies', () => {
  const first = OceanScenes.get('deception-abyss', null);
  first.title = 'changed';
  first.steps.length = 0;
  const second = OceanScenes.get('deception-abyss', null);
  assert.notEqual(second.title, 'changed');
  assert.equal(second.steps.length, 6);
  assert.equal(OceanScenes.get('intrusion-abyss', null).steps.length, 3);
});

// Cloned out of the vm realm so deepEqual compares plain objects.
const businessEmailCompromise = () => JSON.parse(JSON.stringify(OceanScenes.get('deception-abyss', anchorFor('deception', 'abyss'))));

test('deception-abyss plays the 7-stage business email compromise journey in order', () => {
  const scene = businessEmailCompromise();
  const { journey } = scene.debrief;
  assert.deepEqual(journey.stages.map(stage => stage.id), ['lure', 'consent', 'mailbox', 'redirect', 'payment', 'attack', 'containment']);
  assert.deepEqual(journey.stages.flatMap(stage => stage.stepIds), scene.steps.map(step => step.id), 'stage step ids cover the steps in order');
  for (const field of ['title', 'detail']) {
    const values = journey.stages.map(stage => stage[field]);
    assert.equal(new Set(values).size, values.length, `${field} copy is unique`);
  }
  assert.deepEqual(journey.stages.filter(stage => stage.safeStep).map(stage => stage.id), ['lure', 'consent', 'mailbox', 'redirect', 'payment']);
  assert.equal(journey.attack, 'Business email compromise (BEC)');
  assert.match(scene.debrief.anchorNote, /^Inspired by Business email compromise/);
  assert.match(journey.consentNote, /2017 Google Docs OAuth worm/);
  const containment = journey.stages.at(-1).detail;
  assert.match(containment, /In the Vultr-backed version the sandbox revokes the token and is torn down here/);
  assert.match(containment, /no Vultr sandbox ran/);

  const byId = Object.fromEntries(scene.steps.map(step => [step.id, step]));
  assert.deepEqual(scene.steps.map(step => step.app), ['toast', 'mail', 'browser', 'mail', 'mail', 'browser']);
  assert.deepEqual(byId.consent.page.perms.map(perm => /mail|payments/.test(perm)), [true, true, false]);
  assert.equal(byId.consent.page.allow, 'Allow');
  assert.match(byId.mailbox.mailbox.newRule[0], /Auto-forward invoices/);
  assert.ok(byId.mailbox.mailbox.threads.length >= 3);
  assert.match(byId.redirect.redirect.reply.lines.join(' '), /new bank details/);
  assert.equal(byId.payment.page.type, 'payment');
  assert.equal(byId.payment.page.release, 'Release payment');
  assert.equal(byId.payment.page.verify, 'Verify with a known number');
  assert.deepEqual(byId.mailbox.choices, { forward: ['continue'], safe: ['delete', 'report'], noop: [] });
  assert.deepEqual(byId.redirect.choices.forward, ['open-ledger']);
  assert.deepEqual(byId.payment.choices, { forward: ['release'], safe: ['call-known', 'second-approver', 'report'], noop: [] });
  assert.equal(scene.steps.at(-1).phase, 'action');
});

test('deception-abyss journey copy is fictional, fixed and unique against the other 29 scenes', () => {
  const json = JSON.stringify(businessEmailCompromise());
  assert.doesNotMatch(json, /https?:\/\//i);
  assert.doesNotMatch(json, /<input|"type":"password"/);
  const addresses = json.match(/[a-z0-9.-]+@[a-z0-9.-]+/g) ?? [];
  assert.ok(addresses.length >= 4);
  assert.ok(addresses.every(address => /@([a-z0-9-]+\.)*example(\.test)?$/.test(address)), addresses.join());
  assert.ok([...json.matchAll(/"url":"([^"]+)"/g)].every(match => /^[a-z0-9.-]+\.example\//.test(match[1])));
  assert.ok(!/"journey"/.test(JSON.stringify(OceanScenes.get('deception-midnight', null).debrief)), 'only the two journey scenes have a journey');
  const others = profiles.filter(profile => profile.id !== 'deception-abyss').map(profile => JSON.stringify(sceneOf(profile)));
  for (const text of [...businessEmailCompromise().steps.slice(3).map(step => JSON.stringify(step.mailbox ?? step.redirect ?? step.page)), ...businessEmailCompromise().debrief.journey.stages.map(stage => stage.detail)]) {
    assert.equal(others.some(other => other.includes(text)), false, text.slice(0, 40));
  }
  for (const profile of profiles.filter(item => !JOURNEY_FLOWS[item.id])) {
    assert.equal(sceneOf(profile).steps.some(step => step.choices !== undefined), false, `${profile.id} declares no custom choices`);
  }
});

const oauthWorm = () => JSON.parse(JSON.stringify(OceanScenes.get('network-abuse-abyss', anchorFor('network-abuse', 'abyss'))));

test('network-abuse-abyss plays the OAuth worm journey: lure, consent, contacts mailed, spread', () => {
  const scene = oauthWorm();
  const { journey } = scene.debrief;
  assert.match(scene.debrief.anchorNote, /^Inspired by Google Docs OAuth worm \(2017\)/);
  assert.deepEqual(journey.stages.map(stage => stage.id), ['lure', 'consent', 'mailbox', 'attack', 'containment']);
  assert.deepEqual(journey.stages.flatMap(stage => stage.stepIds), scene.steps.map(step => step.id));
  assert.match(journey.stages.at(-1).detail, /no Vultr sandbox ran/);
  const byId = Object.fromEntries(scene.steps.map(step => [step.id, step]));
  assert.match(byId.consent.page.perms.join(' '), /email/);
  assert.match(byId.consent.page.perms.join(' '), /contacts/);
  assert.deepEqual(byId.mailbox.choices, { forward: ['continue'], safe: ['delete', 'report'], noop: [] });
  assert.equal(byId.mailbox.mailbox.labels.threads, 'Contacts read');
  assert.equal(scene.attack.kind, 'network-abuse');
  assert.ok(scene.attack.targets.filter(target => target.kind === 'network').length >= 6, 'contacts are the spread targets');
  assert.doesNotMatch(JSON.stringify(scene), /https?:\/\//i);
  assert.ok((JSON.stringify(scene).match(/[a-z0-9.-]+@[a-z0-9.-]+/g) ?? []).every(address => /@([a-z0-9-]+\.)*example(\.test)?$/.test(address)));
});

// ---- the 60 scenarios: loader (SCENARIOS-60-CONTRACT §2) --------------------------------------------------------------

// A fresh context with ocean-scenes.js, then the given scenario data.
function scenesWith(data) {
  const context = { window: {}, OceanScenarioData: structuredClone(data) };
  runInNewContext(source, context);
  return context.window.OceanScenes;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('scenario entries build scenes with the depth builder, the intro card, focusApps, attackKind and os', () => {
  const scenes = scenesWith(FIXTURE_SCENARIOS);
  assert.equal(scenes.profileIds.length, 30, 'the 30 family scenes are unchanged');
  assert.deepEqual([...scenes.scenarioIds()].sort(), Object.keys(FIXTURE_SCENARIOS).sort());
  const sunlight = scenes.get('fixture-scareware-sunlight', { name: 'Fixture Scareware', year: 2011 });
  assert.deepEqual([sunlight.profileId, sunlight.depthId, sunlight.familyId, sunlight.os, sunlight.attackKind], ['fixture-scareware-sunlight', 'sunlight', 'deception', 'macos', 'scareware']);
  assert.deepEqual(plain(sunlight.focusApps), ['browser', 'files']);
  assert.deepEqual(plain(sunlight.steps.map(step => step.id)), ['toast', 'page', 'files']);
  assert.equal(sunlight.attack.attackKind, 'scareware');
  assert.equal(sunlight.attack.kind, 'deception');
  assert.equal(sunlight.introCard.title, 'Fixture Scareware (2011)');
  assert.equal(sunlight.introCard.line, 'The year is 2011. You are a home user using a web browser. You click a pop-up that says your computer is infected...');
  assert.equal(sunlight.introCard.next, 'A cleaner download is about to appear.');
  assert.ok(sunlight.safePath && sunlight.debrief.fell.headline && sunlight.debrief.anchorNote.includes('Fixture Scareware (2011)'));
  const midnight = scenes.get('fixture-worm-midnight', null);
  assert.deepEqual(plain(midnight.steps.map(step => step.id)), ['toast', 'mail', 'signin']);
  assert.equal(midnight.introCard.title, 'Fixture Worm (2004)', 'a year already in the title is not repeated');
  assert.match(midnight.introCard.line, /You open a message from a colleague...$/, 'a trailing ellipsis is not repeated');
  const trench = scenes.get('fixture-update-trench', null);
  assert.deepEqual(plain(trench.steps.map(step => step.id)), ['toast', 'task', 'event']);
  assert.equal(trench.safePath, null);
  assert.ok(trench.patched);
});

test('the 30 family scenes carry no scenario presentation, and ids outside both lists stay unknown', () => {
  const scenes = scenesWith(FIXTURE_SCENARIOS);
  for (const id of scenes.profileIds) {
    const scene = scenes.get(id, null);
    assert.deepEqual([scene.introCard, plain(scene.focusApps), scene.attackKind, scene.os, scene.attack.attackKind], [null, [], null, null, null], id);
  }
  assert.equal(scenes.get('mydoom-2004', null), null);
  assert.equal(OceanScenes.get('fixture-scareware-sunlight', null), null, 'without the data script the scenario is unknown');
});

test('a scenario entry missing a required field is refused with a reason, never half-built', () => {
  const entry = FIXTURE_SCENARIOS['fixture-worm-midnight'];
  const cases = {
    depth: { depth: 'shallow' }, family: { family: 'nobody' }, title: { year: '2004' }, os: { os: 'linux' }, card: { card: { ...entry.card, next: '' } },
    focusApps: { focusApps: 'mail' }, attackKind: { attackKind: 'launch-missiles' }, copy: { targets: 'none' },
  };
  for (const [reason, change] of Object.entries(cases)) {
    const scenes = scenesWith({ broken: { ...entry, ...change } });
    assert.equal(scenes.scenarioProblem('broken'), reason);
    assert.equal(scenes.get('broken', null), null, reason);
  }
  assert.equal(scenesWith({}).scenarioProblem('absent'), 'missing');
  assert.equal(scenesWith({ ok: entry }).scenarioProblem('ok'), null);
  assert.deepEqual([...OceanScenes.ATTACK_KINDS], [...OceanWorldModel.ATTACK_KINDS], 'the loader and the world model share the 17 attack kinds');
});

test('a scenario cannot shadow one of the 30 family scenes', () => {
  const scenes = scenesWith({ 'deception-sunlight': FIXTURE_SCENARIOS['fixture-worm-midnight'] });
  assert.equal(scenes.get('deception-sunlight', null).title, 'The friendly scan');
});

// ---- the real scenario data files, as far as they exist -----------------------------------------------------------------

const selection = loadOceanSelection(fileURLToPath(root));
const scenarioFiles = DEPTHS.filter(depth => existsSync(new URL(`desktop-comparison/previews/ocean-scenarios/${depth}.js`, root)));
const realContext = { window: {} };
runInNewContext(source, realContext);
for (const depth of scenarioFiles) runInNewContext(readFileSync(new URL(`desktop-comparison/previews/ocean-scenarios/${depth}.js`, root), 'utf8'), realContext);
const realScenes = realContext.window.OceanScenes;
const seed = JSON.parse(readFileSync(new URL('data/desktop-world-seed.json', root), 'utf8'));

test('every authored scenario is in the selection at its depth, builds a scene, and fits the world fields', () => {
  for (const id of realScenes.scenarioIds()) {
    const entry = selection.find(item => item.id === id);
    assert.ok(entry, `${id} is one of the 60 selected scenarios`);
    assert.equal(realScenes.scenarioProblem(id), null, id);
    const scene = realScenes.get(id, entry);
    assert.ok(scene, id);
    assert.equal(scene.depthId, entry.depthId, `${id} depth`);
    if (entry.family) assert.equal(scene.familyId, entry.family, `${id} anchor family`);
    assert.ok(OceanWorldModel.ATTACK_KINDS.includes(scene.attackKind), id);
    assert.ok(scene.focusApps.every(app => OceanWorldModel.CANONICAL_APPS.includes(app)), `${id} focusApps are canonical apps`);
    const { title, line, next } = scene.introCard;
    assert.ok(title.length <= 160 && line.length <= 600 && next.length <= 400, `${id} intro card fits world.scene.intro`);
    assert.doesNotMatch(line, /[.]{4}/, id);
    const profile = new URL(`data/desktop-profiles/${id}.json`, root);
    if (existsSync(profile)) {
      const world = OceanWorldModel.createWorld(seed, JSON.parse(readFileSync(profile, 'utf8')));
      assert.ok(world.user.email.endsWith('.example'), `${id} victim profile`);
    }
  }
});

test('when all five scenario files exist they cover exactly the 60 selected ids', () => {
  if (scenarioFiles.length < DEPTHS.length) return;
  assert.deepEqual([...realScenes.scenarioIds()].sort(), selection.map(entry => entry.id).sort());
});

test('a scenario without a single year renders a bare title and no "The year is" line; a scenario date is validated and passed on', () => {
  const entry = FIXTURE_SCENARIOS['fixture-worm-midnight'];
  const scenes = scenesWith({ 'no-year': { ...entry, year: null, date: '2023-08-01T09:00:00Z' }, 'bad-date': { ...entry, date: 'soon' }, plain: entry });
  assert.equal(scenes.scenarioProblem('no-year'), null);
  const scene = scenes.get('no-year', null);
  assert.equal(scene.introCard.title, 'Fixture Worm');
  assert.equal(scene.introCard.line, 'You are a office clerk using a desktop mail client. You open a message from a colleague...');
  assert.equal(scene.date, '2023-08-01T09:00:00Z');
  assert.equal(scenes.scenarioProblem('bad-date'), 'date');
  assert.equal(scenes.get('plain', null).date, null);
  assert.equal(scenes.get('deception-sunlight', null).date, null);
});
