import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { FIXTURE_SCENARIOS } from './fixtures/scenario-fixtures.mjs';

const require = createRequire(import.meta.url);
const OceanWorldModel = require('../ui/desktop/world-model.js');
const OceanDesktopModel = require('../ui/desktop/desktop-model.js');
const OceanSceneWorld = require('../ui/desktop/scene-world.js');
const sandbox = { window: {}, OceanScenarioData: structuredClone(FIXTURE_SCENARIOS) };
runInNewContext(readFileSync(new URL('../desktop-comparison/previews/ocean-scenes.js', import.meta.url), 'utf8'), sandbox);
const { OceanScenes } = sandbox.window;
const seed = JSON.parse(readFileSync(new URL('../data/desktop-world-seed.json', import.meta.url), 'utf8'));

const START = Date.parse('2026-11-02T09:30:00Z');
const profileOf = id => ({ id, familyId: id.replace(/-(sunlight|twilight|midnight|abyss|trench)$/, ''), depthId: id.split('-').at(-1) });

// Plays one scene through the real V2 model and projects every revision into a world signed in to the desktop.
function session(profileId, { world: start, creature } = {}) {
  const scene = OceanScenes.get(profileId, null);
  if (creature) scene.creature = creature;
  let now = START;
  let desk = OceanDesktopModel.createState(profileOf(profileId), scene, { runId: `run-${profileId}`.slice(0, 32) });
  let world = start ?? { ...OceanWorldModel.createWorld(seed), phase: 'desktop' };
  const opened = [];
  const adopt = (result, label) => {
    assert.ok(result.ok, `${profileId}: ${label} refused (${result.reason})`);
    if (!result.changed) return;
    const prevDesk = desk;
    desk = result.state;
    const projected = OceanSceneWorld.project(world, { scene, desk, prevDesk, now });
    let next = projected.world;
    for (const intent of projected.intents) {
      opened.push(intent);
      const applied = OceanWorldModel.applyIntent(next, intent, now);
      assert.ok(applied.ok, `${profileId}: open ${JSON.stringify(intent)} refused (${applied.reason})`);
      next = applied.world;
    }
    const check = OceanWorldModel.validate(next);
    assert.ok(check.ok, `${profileId} at ${desk.scene.phase}/${desk.scene.stepId}: invalid world (${check.error})`);
    world = next;
  };
  const env = {
    scene, opened,
    get desk() { return desk; },
    get world() { return world; },
    set world(value) { world = value; },
    reduce: intent => adopt(OceanDesktopModel.reduce(desk, intent, now), JSON.stringify(intent)),
    tryReduce: intent => {
      const result = OceanDesktopModel.reduce(desk, intent, now);
      if (result.ok) adopt(result, JSON.stringify(intent));
      return result;
    },
    // Fires deadlines until the scene rests (a live step without a pending action, the attack animation, or the debrief).
    settle: () => {
      for (let guard = 0; guard < 20 && desk.scene.deadlineMs !== null && desk.scene.phase !== 'attack'; guard += 1) {
        now = Math.max(now, desk.scene.deadlineMs);
        adopt(OceanDesktopModel.tick(desk, now), 'tick');
      }
    },
    fxDone: () => adopt(OceanDesktopModel.fxDone(desk, desk.scene.effectId, now), 'fxDone'),
    step: () => scene.steps.find(item => item.id === desk.scene.stepId),
  };
  env.reduce({ kind: 'show-sign-in' });
  env.reduce({ kind: 'sign-in' });
  env.settle();
  return env;
}

// Fell path: the forward choice at every live step (toast: open). Trench scenes need no choice.
function playFell(env) {
  for (let guard = 0; guard < 12 && ['lure', 'action'].includes(env.desk.scene.phase); guard += 1) {
    const step = env.step();
    const { forward } = OceanDesktopModel.choicesFor(step);
    if (forward.length) env.reduce({ kind: 'choose', choiceId: forward[0] });
    env.settle();
  }
}

test('every scene projects a valid world at every step, on the attack path and on the safe path', () => {
  for (const profileId of OceanScenes.profileIds) {
    const fell = session(profileId);
    playFell(fell);
    assert.equal(fell.desk.scene.phase, 'attack', `${profileId} reaches the attack`);
    assert.equal(fell.world.scene.phase, 'attack');
    assert.equal(fell.world.scene.highlight, null, 'no highlight while the attack plays');
    assert.ok(fell.world.data.processes.some(item => item.id === 'sc-proc' && item.suspicious), `${profileId} shows a malicious process`);
    fell.fxDone();
    assert.equal(fell.world.scene.phase, 'debrief');

    if (!fell.scene.safePath) continue;
    const safe = session(profileId);
    safe.reduce({ kind: 'choose', choiceId: 'open' });
    safe.settle();
    const { safe: walkAway } = OceanDesktopModel.choicesFor(safe.step());
    safe.reduce({ kind: 'choose', choiceId: walkAway[0] });
    safe.settle();
    assert.equal(safe.desk.scene.path, 'safe', `${profileId} safe path`);
    assert.equal(safe.world.data.processes, undefined, 'the safe path starts no malicious process');
  }
});

test('lure content: the mail links to an existing page, attachments are fs nodes, and gestures are highlighted', () => {
  const env = session('network-abuse-abyss');
  assert.equal(env.desk.scene.stepId, 'toast');
  const banner = env.world.notifications.banners.find(item => item.id === 'sc-toast');
  assert.deepEqual([banner.app, banner.title], ['mail', 'Priya Nair']);
  const mail = env.world.data.mail.messages.find(item => item.id === 'sc-mail');
  assert.equal(mail.folder, 'inbox');
  assert.equal(mail.from, 'Priya Nair <priya.nair@harbourline.example>');
  assert.equal(mail.to, env.world.user.email);
  assert.equal(mail.link, 'scene:sc-consent');
  assert.ok(env.world.data.web.pages['sc-consent'], 'the linked page exists before the link is followed');
  assert.deepEqual(env.world.scene, { phase: 'lure', stepId: 'toast', highlight: { app: 'mail', ref: 'sc-mail' } });

  env.reduce({ kind: 'choose', choiceId: 'open' });
  assert.equal(env.world.notifications.banners.some(item => item.id === 'sc-toast'), false, 'the banner leaves with the toast step');
  assert.equal(env.world.notifications.history.some(item => item.id === 'sc-toast'), true, 'the history entry stays');
  assert.deepEqual(env.opened.at(-1), { kind: 'open-app', app: 'mail', payload: { messageId: 'sc-mail' } });
  assert.equal(env.world.windows.at(-1).app, 'mail');

  env.reduce({ kind: 'choose', choiceId: 'follow-link' });
  env.settle();
  assert.equal(env.desk.scene.stepId, 'consent');
  assert.deepEqual(env.world.scene.highlight, { app: 'browser', ref: null });
  assert.deepEqual(env.opened.at(-1), { kind: 'open-app', app: 'browser', payload: { url: 'scene:sc-consent' } });
  const page = env.world.data.web.pages['sc-consent'];
  assert.equal(page.url, 'accounts.gleam-docs-share.example/connect');
  assert.match(page.body, /Read, send and delete your email/);
  assert.match(page.body, new RegExp(`Signed in as ${env.world.user.email.replace('.', '\\.')}`), 'the account is the world user, never a .test address');
  assert.deepEqual(page.choices.map(choice => choice.choiceId), ['allow', 'deny', 'report', 'close-tab']);
  assert.equal(page.choices[0].label, 'Allow');

  env.reduce({ kind: 'choose', choiceId: 'allow' });
  env.settle();
  assert.equal(env.desk.scene.stepId, 'mailbox');
  const box = env.world.data.mail.messages.find(item => item.id === 'sc-mailbox');
  assert.equal(box.link, 'scene:sc-mailbox');
  assert.deepEqual(env.world.scene.highlight, { app: 'mail', ref: 'sc-mailbox' });
  assert.deepEqual(env.world.data.web.pages['sc-mailbox'].choices.map(choice => choice.choiceId), ['continue', 'report']);
  const sent = env.world.data.mail.messages.filter(item => item.folder === 'sent' && item.id.startsWith('sc-sent-'));
  assert.equal(sent.length, 4, 'the worm mails every contact it read');

  const sunlight = session('intrusion-sunlight');
  const lure = sunlight.world.data.mail.messages.find(item => item.id === 'sc-mail');
  assert.deepEqual(lure.attachments, ['sc-file']);
  assert.equal(sunlight.world.fs.nodes['sc-file'].parentId, 'downloads');
  assert.equal(sunlight.world.fs.nodes['sc-file'].name, 'Settlement-Draft-v7.doc');
  assert.ok(sunlight.world.data.contents['c-sc-file'].text.includes('Fictional training file'));
  sunlight.reduce({ kind: 'choose', choiceId: 'open' });
  sunlight.reduce({ kind: 'choose', choiceId: 'download' });
  sunlight.settle();
  assert.equal(sunlight.desk.scene.stepId, 'files');
  assert.deepEqual(sunlight.world.scene.highlight, { app: 'files', ref: 'sc-file' });
  assert.deepEqual(sunlight.opened.at(-1), { kind: 'open-app', app: 'files', payload: { folderId: 'downloads' } });
  assert.deepEqual(['sc-item-1', 'sc-item-2', 'sc-item-3'].map(id => sunlight.world.fs.nodes[id].parentId), ['downloads', 'downloads', 'downloads']);
});

test('MFA pushes, code texts, trench monitors and alerts land in their stores', () => {
  const push = session('network-abuse-twilight');
  push.reduce({ kind: 'choose', choiceId: 'open' });
  push.reduce({ kind: 'choose', choiceId: 'follow-link' });
  push.settle();
  push.reduce({ kind: 'choose', choiceId: 'sign-in' });
  push.settle();
  assert.equal(push.desk.scene.stepId, 'mfa');
  const [prompt] = push.world.data.mfa.prompts;
  assert.deepEqual([prompt.id, prompt.app, prompt.number, prompt.account], ['sc-mfa', 'Skyfold Authenticator', 63, push.world.user.email]);
  assert.deepEqual(push.world.data.mfa.accounts, [{ id: 'sc-acct', issuer: 'Skyfold', label: push.world.user.email }]);
  assert.deepEqual(push.world.scene.highlight, { app: 'mfa', ref: 'sc-mfa' });
  assert.deepEqual(push.opened.at(-1), { kind: 'open-app', app: 'mfa' });
  // The shell answers and deletes the prompt; the projection does not bring it back.
  const answered = OceanWorldModel.applyIntent(push.world, { kind: 'data', store: 'mfa', op: 'delete', item: { id: 'sc-mfa' } }, START);
  assert.ok(answered.changed);
  push.world = answered.world;
  push.reduce({ kind: 'choose', choiceId: 'approve' });
  assert.deepEqual(push.world.data.mfa.prompts, []);

  const code = session('deception-twilight');
  code.reduce({ kind: 'choose', choiceId: 'open' });
  code.reduce({ kind: 'choose', choiceId: 'follow-link' });
  code.settle();
  code.reduce({ kind: 'choose', choiceId: 'sign-in' });
  code.settle();
  assert.equal(code.desk.scene.stepId, 'mfa');
  assert.match(code.world.data.web.pages['sc-mfa'].body, /Verification code: 483917/);
  assert.match(code.world.data.messages.threads[0].items[0].text, /483917/);

  const trench = session('deception-trench');
  assert.deepEqual(trench.world.scene.highlight, { app: 'updates', ref: null });
  trench.reduce({ kind: 'choose', choiceId: 'open' });
  assert.deepEqual(trench.world.data.updates.map(item => item.status), ['installed', 'installed', 'installed']);
  trench.settle();
  assert.equal(trench.desk.scene.phase, 'attack');
  assert.deepEqual(trench.world.data.updates.map(item => item.status), ['installed', 'available', 'available']);
  assert.match(trench.world.data.updates[1].title, /Moved to another device/);
  assert.ok(trench.world.notifications.history.some(item => item.id === 'sc-alert'));

  const drive = session('extortion-destruction-trench');
  drive.reduce({ kind: 'choose', choiceId: 'open' });
  assert.equal(drive.world.fs.nodes['sc-folder'].name, 'Shared drive');
  assert.equal(drive.world.fs.nodes['sc-item-3'].kind, 'folder', 'File folder entries become folders');
});

test('a new run strips every scene item and closes scene windows, keeping trainee data', () => {
  const env = session('network-abuse-abyss');
  env.reduce({ kind: 'choose', choiceId: 'open' });
  env.reduce({ kind: 'choose', choiceId: 'follow-link' });
  env.settle();
  const read = OceanWorldModel.applyIntent(env.world, { kind: 'data', store: 'mail', op: 'mark-read', item: { id: 'm-standup', read: true } }, START);
  env.world = read.world;
  const stripped = OceanSceneWorld.strip(env.world);
  assert.ok(OceanWorldModel.validate(stripped).ok);
  const json = JSON.stringify(stripped);
  assert.doesNotMatch(json, /"sc-/);
  assert.equal(stripped.windows.some(win => win.payload?.url === 'scene:sc-consent' || win.payload?.messageId === 'sc-mail'), false);
  assert.equal(stripped.data.mail.messages.find(item => item.id === 'm-standup').read, true, 'trainee edits survive');
  assert.equal(stripped.data.web, undefined);
  assert.deepEqual(plain(stripped.scene), { phase: 'boot', stepId: null, highlight: null });

  // The model's replay starts a new run: the projection strips, then waits for the boot to finish.
  env.reduce({ kind: 'choose', choiceId: 'allow' });
  env.settle();
  playFell(env);
  env.fxDone();
  env.reduce({ kind: 'replay', path: 'safe' });
  assert.equal(env.desk.scene.phase, 'boot');
  assert.doesNotMatch(JSON.stringify(env.world.data), /"sc-/);
  env.settle();
  assert.equal(env.desk.scene.stepId, 'toast');
  assert.ok(env.world.data.mail.messages.some(item => item.id === 'sc-mail'), 'the replay delivers the lure again');
});

test('the projection is idempotent and keeps the revision when nothing changed', () => {
  const env = session('deception-sunlight');
  const again = OceanSceneWorld.project(env.world, { scene: env.scene, desk: env.desk, prevDesk: env.desk, now: START });
  assert.equal(again.world, env.world);
  assert.deepEqual(again.intents, []);
  assert.deepEqual(env.world.scene.highlight, { app: 'browser', ref: null }, 'a browser toast highlights the page it announces');
  assert.ok(env.world.data.web.pages['sc-page']);
  assert.equal(env.world.data.web.pages['sc-page'].url, 'scan.reefguard.example/clean');
});

test('sceneIntents maps sign-in, toast opening, scene choices and passive dismissals to V2 intents', () => {
  const env = session('network-abuse-abyss');
  const { scene } = env;
  const locked = OceanDesktopModel.createState(profileOf('network-abuse-abyss'), scene, { runId: 'run-locked-1' });
  const lock = { ...env.world, phase: 'lock' };
  assert.deepEqual(OceanSceneWorld.sceneIntents({ before: lock, after: env.world, intent: { kind: 'set-phase', phase: 'desktop' }, forward: null, desk: locked, scene }),
    [{ kind: 'show-sign-in' }, { kind: 'sign-in' }]);
  const at = (intent, forward = null) => OceanSceneWorld.sceneIntents({ before: env.world, after: env.world, intent, forward, desk: env.desk, scene });
  assert.deepEqual(at({ kind: 'open-app', app: 'mail' }), [{ kind: 'choose', choiceId: 'open' }]);
  assert.deepEqual(at({ kind: 'open-app', app: 'notes' }), []);
  assert.deepEqual(at({ kind: 'scene-choice', choiceId: 'report' }, { kind: 'choose', choiceId: 'report' }),
    [{ kind: 'choose', choiceId: 'open' }, { kind: 'choose', choiceId: 'report' }], 'reporting the announced mail opens the toast first');
  assert.deepEqual(at({ kind: 'notify-dismiss', id: 'sc-toast' }), [], 'an auto-dismissed banner never counts as the safe path');
  for (const intent of at({ kind: 'scene-choice', choiceId: 'report' }, { kind: 'choose', choiceId: 'report' })) env.reduce(intent);
  assert.equal(env.desk.scene.path, 'safe');

  const trench = session('network-abuse-trench');
  assert.deepEqual(OceanSceneWorld.sceneIntents({ before: trench.world, after: trench.world, intent: { kind: 'notify-dismiss', id: 'sc-toast' }, forward: null, desk: trench.desk, scene: trench.scene }),
    [{ kind: 'dismiss-notification', id: 'n-toast' }], 'a passive toast moves on when dismissed');
  assert.deepEqual(OceanSceneWorld.sceneIntents({ before: trench.world, after: trench.world, intent: { kind: 'open-app', app: 'updates' }, forward: null, desk: trench.desk, scene: trench.scene }),
    [{ kind: 'choose', choiceId: 'open' }]);
});

test('every page choice is a choice the V2 step accepts, and hints never mention the retired toast buttons', () => {
  for (const profileId of OceanScenes.profileIds) {
    const env = session(profileId);
    const pages = () => Object.entries(env.world.data.web?.pages ?? {});
    for (let guard = 0; guard < 12 && ['lure', 'action'].includes(env.desk.scene.phase); guard += 1) {
      const hint = OceanSceneWorld.hintFor(env.scene, env.desk);
      assert.equal(typeof hint, 'string', `${profileId} ${env.desk.scene.stepId} has a hint`);
      assert.doesNotMatch(hint, /Press Tab/);
      const step = env.step();
      const page = env.world.data.web?.pages[`sc-${step.id}`];
      if (page) {
        const { forward, safe } = OceanDesktopModel.choicesFor(step);
        assert.ok(page.choices.every(choice => [...forward, ...safe].includes(choice.choiceId) && OceanDesktopModel.CHOICE_IDS.includes(choice.choiceId)), `${profileId} ${step.id}`);
      }
      const { forward } = OceanDesktopModel.choicesFor(step);
      if (forward.length) env.reduce({ kind: 'choose', choiceId: forward[0] });
      env.settle();
    }
    for (const message of env.world.data.mail.messages.filter(item => item.link)) {
      assert.ok(pages().some(([id]) => `scene:${id}` === message.link), `${profileId}: ${message.id} links to a page`);
    }
    assert.equal(OceanSceneWorld.hintFor(env.scene, env.desk), null, 'no hint during the attack');
  }
});

// ---- scenario presentation: focusApps, intro and the creature state (SCENARIOS-60-CONTRACT §3) ----------------------------

const CREATURE = { family: 'deception', depth: 'sunlight', sprite: '/ocean-creatures/anglerfish/sunlight.gif' };
// Values built inside the vm context have another Object prototype; compare plain JSON copies.
const plain = value => JSON.parse(JSON.stringify(value));
const creatureOf = env => plain(env.world.scene.creature);

test('a scenario scene mirrors focusApps and the intro card, and the creature is idle while the desktop is locked', () => {
  const scene = OceanScenes.get('fixture-scareware-sunlight', null);
  scene.creature = CREATURE;
  assert.deepEqual(plain(scene.introCard), {
    title: 'Fixture Scareware (2011)',
    line: 'The year is 2011. You are a home user using a web browser. You click a pop-up that says your computer is infected...',
    next: 'A cleaner download is about to appear.',
  });
  const desk = OceanDesktopModel.createState(profileOf('fixture-scareware-sunlight'), scene, { runId: 'run-fixture-locked' });
  const { world } = OceanSceneWorld.project({ ...OceanWorldModel.createWorld(seed), phase: 'lock' }, { scene, desk, now: START });
  assert.deepEqual(plain(world.scene.focusApps), ['browser', 'files']);
  assert.deepEqual(plain(world.scene.intro), { title: scene.introCard.title, line: scene.introCard.line, next: scene.introCard.next });
  assert.deepEqual(plain(world.scene.creature), { ...CREATURE, state: 'idle', targetApp: null });
  assert.deepEqual(OceanWorldModel.validate(world), { ok: true, error: null });
});

test('the creature notices, circles, presses and breaks through as a three-step scenario advances', () => {
  const env = session('fixture-scareware-sunlight', { creature: CREATURE });
  assert.equal(env.desk.scene.stepId, 'toast');
  assert.deepEqual(creatureOf(env), { ...CREATURE, state: 'notice', targetApp: 'browser' });
  env.reduce({ kind: 'choose', choiceId: 'open' });
  env.settle();
  assert.equal(env.desk.scene.stepId, 'page');
  assert.deepEqual([creatureOf(env).state, creatureOf(env).targetApp], ['circle', 'browser']);
  env.reduce({ kind: 'choose', choiceId: 'download' });
  env.settle();
  assert.equal(env.desk.scene.stepId, 'files');
  assert.deepEqual([creatureOf(env).state, creatureOf(env).targetApp], ['press', 'files']);
  env.reduce({ kind: 'choose', choiceId: 'run-file' });
  env.settle();
  assert.equal(env.desk.scene.phase, 'attack');
  assert.equal(creatureOf(env).state, 'breakthrough');
  env.fxDone();
  assert.equal(env.desk.scene.phase, 'debrief');
  assert.equal(creatureOf(env).state, 'breakthrough');
  assert.deepEqual(plain(env.world.scene.focusApps), ['browser', 'files'], 'dimming list is stable through the run');
});

test('a four-step journey approaches before it circles, and a safe exit leaves the creature idle', () => {
  const states = [];
  const env = session('deception-twilight', { creature: CREATURE });
  for (let guard = 0; guard < 8 && ['lure', 'action'].includes(env.desk.scene.phase); guard += 1) {
    states.push(creatureOf(env).state);
    const { forward } = OceanDesktopModel.choicesFor(env.step());
    env.reduce({ kind: 'choose', choiceId: forward[0] });
    env.settle();
  }
  assert.deepEqual(states, ['notice', 'approach', 'circle', 'press']);
  assert.equal(creatureOf(env).state, 'breakthrough');

  const safe = session('deception-twilight', { creature: CREATURE });
  safe.reduce({ kind: 'choose', choiceId: 'open' });
  safe.settle();
  safe.reduce({ kind: 'choose', choiceId: OceanDesktopModel.choicesFor(safe.step()).safe[0] });
  safe.settle();
  assert.equal(safe.desk.scene.path, 'safe');
  assert.deepEqual([creatureOf(safe).state, creatureOf(safe).targetApp], ['idle', null]);
});

test('passive trench scenarios press on the task and break through when the event fires', () => {
  const env = session('fixture-update-trench', { creature: { ...CREATURE, depth: 'trench', sprite: '/ocean-creatures/anglerfish/trench.gif' } });
  assert.equal(env.desk.scene.phase === 'lure' || env.desk.scene.phase === 'action', true);
  const seen = new Set();
  for (let guard = 0; guard < 6 && env.desk.scene.phase !== 'attack'; guard += 1) {
    seen.add(creatureOf(env).state);
    env.reduce({ kind: 'dismiss-notification', id: 'n-toast' });
    env.settle();
    if (env.desk.scene.phase !== 'attack' && env.desk.scene.deadlineMs !== null) env.settle();
  }
  assert.ok(seen.has('notice'));
  assert.equal(env.desk.scene.phase, 'attack');
  assert.equal(creatureOf(env).state, 'breakthrough');
  assert.deepEqual(OceanWorldModel.validate(env.world), { ok: true, error: null });
});

test('fixture scenarios project a valid world on the attack path and on the safe path, with the creature attached', () => {
  for (const profileId of Object.keys(FIXTURE_SCENARIOS)) {
    const fell = session(profileId, { creature: CREATURE });
    playFell(fell);
    assert.equal(fell.desk.scene.phase, 'attack', profileId);
    assert.equal(creatureOf(fell).state, 'breakthrough');
    fell.fxDone();
    assert.equal(fell.world.scene.phase, 'debrief');
    if (!fell.scene.safePath) continue;
    const safe = session(profileId, { creature: CREATURE });
    safe.reduce({ kind: 'choose', choiceId: 'open' });
    safe.settle();
    safe.reduce({ kind: 'choose', choiceId: OceanDesktopModel.choicesFor(safe.step()).safe[0] });
    safe.settle();
    assert.equal(safe.desk.scene.path, 'safe', profileId);
  }
});

test('a restart strips the creature state and re-projects it idle for the new run', () => {
  const env = session('fixture-worm-midnight', { creature: CREATURE });
  env.reduce({ kind: 'choose', choiceId: 'open' });
  env.settle();
  assert.notEqual(creatureOf(env).state, 'idle');
  const stripped = OceanSceneWorld.strip(env.world);
  assert.deepEqual(stripped.scene, { phase: 'boot', stepId: null, highlight: null });
});
