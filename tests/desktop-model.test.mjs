import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const model = createRequire(import.meta.url)('../ui/desktop/desktop-model.js');
const sandbox = { window: {} };
runInNewContext(readFileSync(new URL('../desktop-comparison/previews/ocean-scenes.js', import.meta.url), 'utf8'), sandbox);
const { OceanScenes } = sandbox.window;

const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];
const PROFILES = FAMILIES.flatMap(familyId => DEPTHS.map(depthId => ({ id: `${familyId}-${depthId}`, familyId, depthId })));
const FORWARD_STEPS = {
  sunlight: ['toast', 'mail|page', 'files'],
  twilight: ['toast', 'mail', 'signin', 'mfa'],
  midnight: ['toast', 'mail', 'signin'],
  abyss: ['toast', 'mail', 'consent'],
  trench: ['toast', 'task', 'event'],
};
// Two abyss scenes play multi-stage journeys: business email compromise and the OAuth worm.
const JOURNEY_STEPS = {
  'deception-abyss': ['toast', 'mail', 'consent', 'mailbox', 'redirect', 'payment'],
  'network-abuse-abyss': ['toast', 'mail', 'consent', 'mailbox'],
};
const flowFor = profile => JOURNEY_STEPS[profile.id] ?? FORWARD_STEPS[profile.depthId];
const T0 = 1_000_000;

let runSerial = 0;
const nextRunId = () => `test-run-${String(++runSerial).padStart(4, '0')}`;
const sceneFor = profile => OceanScenes.get(profile.id, null);
const forProfile = id => PROFILES.find(profile => profile.id === id);

// A model run with its own clock. `signedIn()` leaves the desktop at the end of boot, before the first notification.
function createRun(profileId, { reducedMotion = false, replayMode } = {}) {
  const profile = forProfile(profileId);
  const run = {
    profile,
    scene: sceneFor(profile),
    now: T0,
    state: model.createState(profile, sceneFor(profile), { runIdFactory: nextRunId, reducedMotion, replayMode }),
    log: [],
    send(intent) {
      const result = model.reduce(run.state, intent, run.now);
      if (result.ok) run.state = result.state;
      run.log.push({ intent, ok: result.ok, reason: result.reason });
      return result;
    },
    tickAt(deadline = run.state.scene.deadlineMs) {
      run.now = Math.max(run.now, deadline);
      const result = model.tick(run.state, run.now);
      run.state = result.state;
      return result;
    },
    signIn() {
      assert.ok(run.send({ kind: 'show-sign-in' }).ok);
      assert.ok(run.send({ kind: 'sign-in' }).ok);
      return run;
    },
    toFirstStep() {
      run.signIn();
      run.tickAt();
      return run;
    },
    step() { return run.scene.steps.find(step => step.id === run.state.scene.stepId); },
    validState() {
      assert.deepEqual(model.validate(run.state), { ok: true, error: null });
      return run.state;
    },
  };
  return run;
}

// Plays the lure path to the attack. Returns the visited step ids.
function playForward(run, { onStep } = {}) {
  const visited = [];
  for (let guard = 0; guard < 12 && ['lure', 'action'].includes(run.state.scene.phase); guard++) {
    const step = run.step();
    visited.push(step.id);
    onStep?.(step, run);
    if (!['lure', 'action'].includes(run.state.scene.phase)) break;
    if (step.kind === 'benign' || step.kind === 'auto') {
      run.tickAt();
      continue;
    }
    const [choiceId] = model.choicesFor(step).forward;
    assert.ok(run.send({ kind: 'choose', choiceId }).ok, `${run.profile.id} ${step.id} ${choiceId}`);
    if (run.state.scene.pendingActionId !== null) run.tickAt();
  }
  return visited;
}

test('createState starts locked with nothing scheduled and a valid, small shape', () => {
  const run = createRun('deception-abyss');
  const state = run.validState();
  assert.equal(state.v, 2);
  assert.equal(state.auth, 'locked');
  assert.match(state.runId, /^[a-z0-9-]{8,32}$/);
  assert.deepEqual(state.scene, { phase: 'boot', stepId: null, path: null, replayMode: 'normal', pendingActionId: null, deadlineMs: null, effectId: null, completedAt: null });
  assert.deepEqual([state.windows, state.order, state.notifications, state.focusedWindowId, state.centreOpen], [[], [], [], null, false]);
  assert.throws(() => model.createState(run.profile, { steps: [] }), /scene with steps/);
  assert.throws(() => model.createState(run.profile, run.scene, { runId: 'Bad Id' }), /run id/);
  assert.throws(() => model.createState(run.profile, run.scene, { replayMode: 'turbo' }));
});

test('auth gating: nothing starts before sign-in, sign-in is a button intent, and nothing ticks while locked', () => {
  const run = createRun('deception-abyss');
  for (const intent of [
    { kind: 'sign-in' }, { kind: 'open-app', app: 'mail' }, { kind: 'toggle-centre' }, { kind: 'choose', choiceId: 'open' },
    { kind: 'replay', path: 'normal' }, { kind: 'focus-window', id: 'w-mail' }, { kind: 'request-proof' },
  ]) {
    const result = run.send(intent);
    assert.equal(result.ok, false, JSON.stringify(intent));
    assert.equal(result.reason, 'locked');
  }
  run.now += 3_600_000;
  assert.equal(run.tickAt().changed, false, 'a locked desktop never ticks, however late');
  assert.equal(run.state.scene.stepId, null);
  assert.deepEqual(run.state.notifications, []);

  assert.equal(run.send({ kind: 'show-sign-in' }).ok, true);
  assert.equal(run.state.auth, 'sign-in');
  for (const intent of [{ kind: 'show-sign-in' }, { kind: 'choose', choiceId: 'open' }, { kind: 'toggle-centre' }]) {
    assert.equal(run.send(intent).reason, 'sign-in-required', JSON.stringify(intent));
  }
  run.now += 3_600_000;
  assert.equal(run.tickAt().changed, false, 'the sign-in screen starts no timer');
  assert.deepEqual(run.state.scene, { phase: 'boot', stepId: null, path: null, replayMode: 'normal', pendingActionId: null, deadlineMs: null, effectId: null, completedAt: null });

  assert.equal(run.send({ kind: 'sign-in' }).ok, true);
  assert.equal(run.state.auth, 'desktop');
  assert.equal(run.state.scene.deadlineMs, run.now + 900, 'boot delay starts at sign-in, in the parent clock');
  assert.equal(run.send({ kind: 'choose', choiceId: 'open' }).reason, 'inert', 'boot accepts no scene action');
  assert.equal(run.send({ kind: 'sign-in' }).reason, 'already-signed-in');
  const early = model.tick(run.state, run.now + 899);
  assert.equal(early.changed, false);
  assert.equal(run.tickAt().changed, true);
  assert.equal(run.state.scene.phase, 'lure');
  assert.equal(run.state.scene.stepId, 'toast');
  assert.deepEqual(run.state.notifications, [{ id: 'n-toast', appId: 'mail', stepId: 'toast' }]);
});

test('reduced motion shortens the boot, event and safe delays but never skips sign-in', () => {
  const run = createRun('deception-trench', { reducedMotion: true }).signIn();
  assert.equal(run.state.scene.deadlineMs, run.now + 300);
  run.tickAt();
  assert.equal(run.send({ kind: 'dismiss-notification', id: 'n-toast' }).ok, true);
  run.tickAt();
  assert.equal(run.state.scene.stepId, 'event');
  assert.equal(run.state.scene.deadlineMs, run.now + 1200);
  const quiet = createRun('deception-abyss', { reducedMotion: true }).toFirstStep();
  quiet.send({ kind: 'dismiss-notification', id: 'n-toast' });
  assert.equal(quiet.state.scene.phase, 'safe');
  assert.equal(quiet.state.scene.deadlineMs, quiet.now + 500);
});

test('the lure journey of all 30 profiles follows its depth flow, ends in one attack and a debrief', () => {
  assert.equal(PROFILES.length, 30);
  let largest = 0;
  for (const profile of PROFILES) {
    const run = createRun(profile.id).toFirstStep();
    const visited = playForward(run, { onStep: (_, current) => { largest = Math.max(largest, new TextEncoder().encode(JSON.stringify(current.validState())).length); } });
    const flow = flowFor(profile);
    assert.equal(visited.length, flow.length, `${profile.id} visits ${visited.join(',')}`);
    visited.forEach((stepId, index) => assert.ok(flow[index].split('|').includes(stepId), `${profile.id} step ${index}: ${stepId}`));
    const { scene } = run.validState();
    assert.equal(scene.phase, 'attack', profile.id);
    assert.equal(scene.path, 'fell');
    assert.equal(scene.effectId, `fx-${run.state.runId}`);
    assert.equal(scene.deadlineMs, run.now + model.ATTACK_WATCHDOG_MS, 'the attack carries a watchdog deadline');
    assert.deepEqual(run.state.notifications, []);

    const done = model.fxDone(run.state, scene.effectId, run.now + 6500);
    assert.equal(done.changed, true);
    run.state = done.state;
    run.validState();
    assert.equal(run.state.scene.phase, 'debrief');
    assert.equal(run.state.scene.completedAt, run.now + 6500);
    assert.equal(run.state.focusedWindowId, 'w-debrief');
    assert.equal(run.state.order.at(-1), 'w-debrief');
    assert.equal(model.fxDone(run.state, scene.effectId, run.now + 7000).changed, false, 'the effect advances once');
  }
  assert.ok(largest <= model.STATE_MAX_BYTES, `largest state ${largest} bytes`);
});

test('depth journeys: sunlight download page and Files, twilight sign-in then MFA, midnight sign-in, abyss consent, trench auto event', () => {
  const sunBrowser = createRun('deception-sunlight').toFirstStep();
  assert.equal(sunBrowser.send({ kind: 'choose', choiceId: 'open' }).ok, true);
  assert.equal(sunBrowser.state.scene.stepId, 'page');
  assert.deepEqual(sunBrowser.state.windows.map(win => [win.app, win.contentStepId]), [['browser', 'page']]);
  assert.equal(sunBrowser.send({ kind: 'choose', choiceId: 'sign-in' }).reason, 'wrong-step');
  assert.equal(sunBrowser.send({ kind: 'choose', choiceId: 'download' }).ok, true);
  assert.equal(sunBrowser.state.scene.pendingActionId, 'download');
  sunBrowser.tickAt();
  assert.equal(sunBrowser.state.scene.stepId, 'files');
  const files = sunBrowser.state.windows.find(win => win.app === 'files');
  assert.deepEqual([files.folderId, files.selectedEntryId], ['downloads', 'target']);

  const sunMail = createRun('intrusion-sunlight').toFirstStep();
  sunMail.send({ kind: 'choose', choiceId: 'open' });
  assert.equal(sunMail.step().id, 'mail');
  assert.equal(sunMail.send({ kind: 'choose', choiceId: 'follow-link' }).reason, 'wrong-step', 'the mail has an attachment, not a link');
  assert.equal(sunMail.send({ kind: 'choose', choiceId: 'download' }).ok, true);

  const twilightPush = createRun('intrusion-twilight').toFirstStep();
  const pushSteps = playForward(twilightPush);
  assert.deepEqual(pushSteps, ['toast', 'mail', 'signin', 'mfa']);
  assert.deepEqual(twilightPush.log.filter(entry => entry.intent.kind === 'choose').map(entry => entry.intent.choiceId), ['open', 'follow-link', 'sign-in', 'approve']);
  const twilightCode = createRun('deception-twilight').toFirstStep();
  playForward(twilightCode);
  assert.deepEqual(twilightCode.log.filter(entry => entry.intent.kind === 'choose').map(entry => entry.intent.choiceId), ['open', 'follow-link', 'sign-in', 'verify']);
  assert.equal(twilightCode.state.windows.filter(win => win.app === 'browser').length, 1, 'sign-in and code share one browser window');

  const midnight = createRun('deception-midnight').toFirstStep();
  assert.deepEqual(playForward(midnight), ['toast', 'mail', 'signin']);
  assert.equal(midnight.state.scene.phase, 'attack');

  const abyss = createRun('deception-abyss').toFirstStep();
  assert.deepEqual(playForward(abyss), JOURNEY_STEPS['deception-abyss']);
  assert.deepEqual(abyss.log.filter(entry => entry.intent.kind === 'choose').map(entry => entry.intent.choiceId), ['open', 'follow-link', 'allow', 'continue', 'open-ledger', 'release']);
  const sibling = createRun('intrusion-abyss').toFirstStep();
  assert.deepEqual(playForward(sibling), ['toast', 'mail', 'consent'], 'the other abyss profiles keep the short flow');
  assert.deepEqual(sibling.log.filter(entry => entry.intent.kind === 'choose').map(entry => entry.intent.choiceId), ['open', 'follow-link', 'allow']);

  const trench = createRun('deception-trench').toFirstStep();
  assert.equal(trench.send({ kind: 'dismiss-notification', id: 'n-toast' }).ok, true);
  assert.equal(trench.state.scene.stepId, 'task');
  assert.equal(trench.state.scene.deadlineMs, trench.now + 7000);
  assert.equal(trench.send({ kind: 'choose', choiceId: 'check-updates' }).changed, false, 'the harmless button changes nothing');
  trench.tickAt();
  assert.equal(trench.state.scene.stepId, 'event');
  assert.equal(trench.state.windows.length, 1);
  assert.equal(trench.state.windows[0].contentStepId, 'event', 'the event reveals inside the task window');
  assert.equal(trench.send({ kind: 'choose', choiceId: 'deny' }).ok, false);
  trench.tickAt();
  assert.deepEqual([trench.state.scene.phase, trench.state.scene.path], ['attack', 'fell']);
});

test('the safe path of every non-trench profile ends in a debrief without an attack', () => {
  for (const profile of PROFILES.filter(item => item.depthId !== 'trench')) {
    const toastDismiss = createRun(profile.id).toFirstStep();
    assert.equal(toastDismiss.send({ kind: 'dismiss-notification', id: 'n-toast' }).ok, true);
    assert.equal(toastDismiss.state.scene.phase, 'safe', profile.id);
    assert.equal(toastDismiss.state.scene.effectId, null);

    const run = createRun(profile.id).toFirstStep();
    const flow = playForward(run, {
      onStep: (step, current) => {
        if (step.id !== run.scene.steps.at(-1).id || current.state.scene.phase === 'safe') return;
        const [safeChoice] = model.choicesFor(step).safe;
        assert.ok(safeChoice, `${profile.id} ${step.id} offers a safe choice`);
        assert.equal(current.send({ kind: 'choose', choiceId: safeChoice }).ok, true);
      },
    });
    assert.ok(flow.length >= 3);
    assert.equal(run.state.scene.phase, 'safe', profile.id);
    assert.equal(run.state.scene.path, 'safe');
    assert.equal(run.state.scene.effectId, null, 'no attack animation on the safe path');
    run.tickAt();
    assert.equal(run.state.scene.phase, 'debrief');
    assert.equal(run.state.scene.path, 'safe');
    assert.equal(run.state.scene.effectId, null);
    run.validState();
  }
});

// Takes the forward choice at each step until the named one is current (the toast opens, links follow, Allow is clicked).
function advanceTo(run, stepId) {
  for (let guard = 0; guard < 12 && run.state.scene.stepId !== stepId; guard++) {
    const [choiceId] = model.choicesFor(run.step()).forward;
    assert.ok(run.send({ kind: 'choose', choiceId }).ok, `${run.state.scene.stepId} ${choiceId}`);
    if (run.state.scene.pendingActionId !== null) run.tickAt();
  }
  assert.equal(run.state.scene.stepId, stepId);
  return run;
}

test('deception-abyss fall path walks lure, consent, mailbox, redirect and payment before one attack and a debrief', () => {
  const run = createRun('deception-abyss').toFirstStep();
  const windows = () => run.state.windows.map(win => `${win.id}:${win.contentStepId}`);
  advanceTo(run, 'consent');
  assert.deepEqual(windows(), ['w-mail:mail', 'w-browser:consent']);
  assert.equal(run.send({ kind: 'choose', choiceId: 'continue' }).reason, 'wrong-step', 'consent cannot skip to the mailbox');
  assert.equal(run.send({ kind: 'choose', choiceId: 'release' }).reason, 'wrong-step', 'the payment cannot be released from consent');
  assert.ok(run.send({ kind: 'choose', choiceId: 'allow' }).ok);
  assert.equal(run.state.scene.pendingActionId, 'allow');
  run.tickAt();

  assert.deepEqual([run.state.scene.stepId, run.state.scene.phase], ['mailbox', 'action']);
  assert.deepEqual(windows(), ['w-mail:mailbox', 'w-browser:consent']);
  assert.equal(run.state.focusedWindowId, 'w-mail');
  assert.equal(run.state.scene.deadlineMs, null, 'the user watches or clicks Continue: no timer');
  assert.equal(run.send({ kind: 'choose', choiceId: 'open-ledger' }).reason, 'wrong-step');
  assert.ok(run.send({ kind: 'choose', choiceId: 'continue' }).ok);
  assert.equal(run.send({ kind: 'choose', choiceId: 'report' }).reason, 'busy', 'a pending Continue blocks other choices');
  run.tickAt();

  assert.deepEqual([run.state.scene.stepId, run.state.windows.find(win => win.id === 'w-mail').contentStepId], ['redirect', 'redirect'], 'the same Mail window shows the fake reply');
  assert.equal(run.send({ kind: 'choose', choiceId: 'release' }).reason, 'wrong-step', 'no jumping past the ledger');
  assert.ok(run.send({ kind: 'choose', choiceId: 'open-ledger' }).ok);
  run.tickAt();

  assert.equal(run.state.scene.stepId, 'payment');
  assert.equal(run.state.windows.find(win => win.id === 'w-browser').contentStepId, 'payment');
  assert.equal(run.state.focusedWindowId, 'w-browser');
  assert.equal(run.state.scene.phase, 'action');
  assert.equal(run.state.scene.effectId, null, 'no attack animation before the release');
  assert.equal(run.send({ kind: 'choose', choiceId: 'continue' }).reason, 'wrong-step');
  assert.ok(run.send({ kind: 'choose', choiceId: 'release' }).ok);
  assert.equal(run.state.scene.pendingActionId, 'release');
  assert.equal(run.state.scene.path, null);
  run.tickAt();

  const { scene } = run.validState();
  assert.deepEqual([scene.phase, scene.path, scene.stepId], ['attack', 'fell', 'payment']);
  assert.equal(scene.effectId, `fx-${run.state.runId}`);
  assert.equal(model.fxDone(run.state, 'fx-other', run.now).changed, false);
  run.state = model.fxDone(run.state, scene.effectId, run.now).state;
  assert.deepEqual([run.state.scene.phase, run.state.scene.path, run.state.scene.stepId], ['debrief', 'fell', 'payment']);
  assert.equal(model.fxDone(run.state, scene.effectId, run.now).changed, false, 'the attack plays once');
  assert.equal(run.state.focusedWindowId, 'w-debrief');
  run.validState();
});

test('deception-abyss safe exits at every stage end in the safe debrief without an attack', () => {
  const exits = [
    ['toast', { kind: 'dismiss-notification', id: 'n-toast' }],
    ['mail', { kind: 'choose', choiceId: 'report' }],
    ['mail', { kind: 'choose', choiceId: 'delete' }],
    ['consent', { kind: 'choose', choiceId: 'deny' }],
    ['consent', { kind: 'close', id: 'w-browser' }],
    ['mailbox', { kind: 'choose', choiceId: 'report' }],
    ['mailbox', { kind: 'choose', choiceId: 'delete' }],
    ['mailbox', { kind: 'close', id: 'w-mail' }],
    ['redirect', { kind: 'choose', choiceId: 'report' }],
    ['redirect', { kind: 'choose', choiceId: 'delete' }],
    ['redirect', { kind: 'close', id: 'w-mail' }],
    ['payment', { kind: 'choose', choiceId: 'call-known' }],
    ['payment', { kind: 'choose', choiceId: 'second-approver' }],
    ['payment', { kind: 'choose', choiceId: 'report' }],
    ['payment', { kind: 'close', id: 'w-browser' }],
  ];
  for (const [stepId, intent] of exits) {
    const label = `${stepId} ${intent.choiceId ?? intent.kind}`;
    const run = advanceTo(createRun('deception-abyss').toFirstStep(), stepId);
    assert.ok(run.send(intent).ok, label);
    assert.deepEqual([run.state.scene.phase, run.state.scene.path, run.state.scene.effectId], ['safe', 'safe', null], label);
    assert.equal(run.state.scene.stepId, stepId, `${label}: the debrief can tell where it stopped`);
    assert.equal(run.send({ kind: 'choose', choiceId: 'release' }).reason, 'inert', label);
    run.tickAt();
    assert.deepEqual([run.state.scene.phase, run.state.scene.path, run.state.scene.effectId], ['debrief', 'safe', null], label);
    run.validState();
  }
});

test('deception-abyss stages stay inside the 4 KB state limit with every window open', () => {
  const run = advanceTo(createRun('deception-abyss').toFirstStep(), 'payment');
  run.send({ kind: 'toggle-centre' });
  const bytes = new TextEncoder().encode(JSON.stringify(run.validState())).length;
  assert.ok(bytes <= model.STATE_MAX_BYTES, `${bytes} bytes`);
});

test('trench has no walk-away choice, and the patched replay turns the event into a safe debrief', () => {
  const trench = createRun('intrusion-trench').toFirstStep();
  for (const choiceId of ['deny', 'report', 'close-tab', 'delete', 'not-now', 'cancel']) {
    assert.equal(trench.send({ kind: 'choose', choiceId }).ok, false, choiceId);
  }
  playForward(trench);
  trench.state = model.fxDone(trench.state, trench.state.scene.effectId, trench.now).state;
  assert.equal(trench.state.scene.phase, 'debrief');
  const oldRunId = trench.state.runId;
  const replay = trench.send({ kind: 'replay', path: 'safe' });
  assert.deepEqual([replay.ok, replay.effect], [true, 'new-run']);
  assert.notEqual(trench.state.runId, oldRunId);
  assert.deepEqual([trench.state.auth, trench.state.scene.phase, trench.state.scene.replayMode, trench.state.revision], ['desktop', 'boot', 'patched', 0]);
  assert.equal(trench.state.scene.deadlineMs, trench.now + 900, 'the replay boots straight into the desktop, no sign-in');
  assert.deepEqual([trench.state.windows, trench.state.notifications], [[], []]);
  trench.tickAt();
  assert.equal(trench.send({ kind: 'dismiss-notification', id: 'n-toast' }).ok, true);
  trench.tickAt();
  assert.equal(trench.state.scene.stepId, 'event');
  assert.equal(trench.tickAt().changed, true);
  assert.deepEqual([trench.state.scene.phase, trench.state.scene.path, trench.state.scene.effectId], ['safe', 'safe', null], 'the patched service refuses the probe');
  trench.tickAt();
  assert.equal(trench.state.scene.phase, 'debrief');
  assert.equal(trench.state.scene.replayMode, 'patched');
});

test('guided-safe replay keeps the signed-in desktop and the normal lure choices', () => {
  const run = createRun('deception-abyss').toFirstStep();
  playForward(run);
  run.state = model.fxDone(run.state, run.state.scene.effectId, run.now).state;
  const firstRun = run.state.runId;
  assert.equal(run.send({ kind: 'choose', choiceId: 'deny' }).reason, 'not-live', 'a debrief accepts no scene choice');
  assert.ok(run.send({ kind: 'replay', path: 'safe' }).ok);
  assert.equal(run.state.scene.replayMode, 'guided-safe');
  assert.equal(run.state.auth, 'desktop');
  assert.notEqual(run.state.runId, firstRun);
  run.tickAt();
  run.send({ kind: 'choose', choiceId: 'open' });
  run.send({ kind: 'choose', choiceId: 'follow-link' });
  run.tickAt();
  assert.equal(run.state.scene.stepId, 'consent');
  assert.equal(run.send({ kind: 'choose', choiceId: 'deny' }).ok, true);
  assert.equal(run.state.scene.path, 'safe');
  run.tickAt();
  assert.equal(run.send({ kind: 'replay', path: 'normal' }).ok, true);
  assert.equal(run.state.scene.replayMode, 'normal');
  assert.equal(run.state.scene.path, null);
});

test('stale and out-of-step intents are rejected without touching the state', () => {
  const run = createRun('deception-abyss').toFirstStep();
  const before = JSON.stringify(run.state);
  for (const [intent, reason] of [
    [{ kind: 'choose', choiceId: 'allow' }, 'wrong-step'],
    [{ kind: 'choose', choiceId: 'run-file' }, 'wrong-step'],
    [{ kind: 'dismiss-notification', id: 'n-gone' }, 'no-such-notification'],
    [{ kind: 'focus-window', id: 'w-mail' }, 'no-such-window'],
    [{ kind: 'replay', path: 'normal' }, 'not-finished'],
    [{ kind: 'pick-another' }, 'not-finished'],
    [{ kind: 'request-proof' }, 'not-finished'],
    [{ kind: 'open-app', app: 'mail' }, 'no-such-app'],
    [{ kind: 'bogus' }, 'invalid-intent'],
    [{ kind: 'choose', choiceId: 'open', extra: 1 }, 'invalid-intent'],
  ]) {
    const result = run.send(intent);
    assert.equal(result.ok, false, JSON.stringify(intent));
    assert.equal(result.reason, reason, JSON.stringify(intent));
    assert.equal(result.state, run.state);
  }
  assert.equal(JSON.stringify(run.state), before);
  assert.equal(model.reduce({ ...run.state, runId: 'unregistered-run' }, { kind: 'toggle-centre' }, run.now).reason, 'unknown-run');
  assert.equal(model.reduce({ ...run.state, extra: true }, { kind: 'toggle-centre' }, run.now).reason, 'invalid-state');
  assert.equal(model.reduce(run.state, { kind: 'toggle-centre' }, Number.NaN).reason, 'invalid-time');

  run.send({ kind: 'choose', choiceId: 'open' });
  run.send({ kind: 'choose', choiceId: 'follow-link' });
  assert.equal(run.state.scene.pendingActionId, 'follow-link');
  assert.equal(run.send({ kind: 'choose', choiceId: 'deny' }).reason, 'busy', 'a pending action blocks a second choice');
  assert.equal(run.send({ kind: 'close', id: 'w-mail' }).reason, 'busy');
  assert.equal(model.tick(run.state, run.now + 349).changed, false, 'the delay is not shortened');
});

test('attack and safe phases are inert, and the attack watchdog still reaches the debrief', () => {
  const run = createRun('deception-midnight').toFirstStep();
  playForward(run);
  for (const intent of [{ kind: 'toggle-centre' }, { kind: 'close', id: 'w-browser' }, { kind: 'minimize', id: 'w-mail' }, { kind: 'replay', path: 'safe' }]) {
    assert.equal(run.send(intent).reason, 'inert', JSON.stringify(intent));
  }
  assert.equal(run.tickAt(run.state.scene.deadlineMs - 1).changed, false);
  assert.equal(run.tickAt(run.state.scene.deadlineMs).changed, true);
  assert.equal(run.state.scene.phase, 'debrief');
  assert.equal(model.fxDone(run.state, 'fx-late-reply', run.now).changed, false, 'a late animation reply cannot move a debrief');
});

test('window intents move, resize and clamp bounds in the 1000x600 work area and never overwrite them on expand', () => {
  const run = createRun('deception-abyss').toFirstStep();
  run.send({ kind: 'choose', choiceId: 'open' });
  const initial = run.state.windows[0].bounds;
  assert.deepEqual(initial, { x: 90, y: 50, w: 780, h: 480 });

  run.send({ kind: 'move-window', id: 'w-mail', bounds: { x: 5000, y: -40, w: 1, h: 1 } });
  assert.deepEqual(run.state.windows[0].bounds, { x: 220, y: 0, w: 780, h: 480 }, 'move keeps the size and clamps the position');
  run.send({ kind: 'resize-window', id: 'w-mail', bounds: { x: 900, y: 590, w: 5000, h: 5000 } });
  assert.deepEqual(run.state.windows[0].bounds, { x: 0, y: 0, w: 1000, h: 600 });
  run.send({ kind: 'resize-window', id: 'w-mail', bounds: { x: 400.6, y: 300.4, w: 10, h: 10 } });
  assert.deepEqual(run.state.windows[0].bounds, { x: 401, y: 300, w: 240, h: 160 });
  run.validState();

  const before = run.state.windows[0].bounds;
  assert.equal(run.send({ kind: 'move-window', id: 'w-mail', bounds: before }).changed, false, 'an identical move is a no-op');
  for (const bad of [
    { x: Number.NaN, y: 0, w: 300, h: 300 }, { x: '5', y: 0, w: 300, h: 300 }, { x: 0, y: 0, w: 300 },
    { x: 0, y: 0, w: 300, h: 300, z: 1 }, { x: Infinity, y: 0, w: 300, h: 300 }, null,
  ]) {
    assert.equal(run.send({ kind: 'resize-window', id: 'w-mail', bounds: bad }).reason, 'invalid-intent');
  }
  run.send({ kind: 'expand', id: 'w-mail' });
  assert.equal(run.state.windows[0].mode, 'expanded');
  assert.deepEqual(run.state.windows[0].bounds, before, 'expanded is a mode; the stored bounds survive');
  assert.equal(run.send({ kind: 'move-window', id: 'w-mail', bounds: before }).reason, 'not-normal');
  run.send({ kind: 'restore', id: 'w-mail' });
  assert.deepEqual([run.state.windows[0].mode, run.state.windows[0].bounds], ['normal', before]);
});

test('minimize, restore, focus, close and open-app keep order and focus consistent', () => {
  const run = createRun('deception-twilight').toFirstStep();
  run.send({ kind: 'choose', choiceId: 'open' });
  run.send({ kind: 'choose', choiceId: 'follow-link' });
  run.tickAt();
  assert.deepEqual(run.state.order, ['w-mail', 'w-browser']);
  assert.equal(run.state.focusedWindowId, 'w-browser');

  run.send({ kind: 'focus-window', id: 'w-mail' });
  assert.deepEqual([run.state.order, run.state.focusedWindowId], [['w-browser', 'w-mail'], 'w-mail']);
  run.send({ kind: 'minimize', id: 'w-mail' });
  assert.equal(run.state.windows.find(win => win.id === 'w-mail').mode, 'minimized');
  assert.equal(run.state.focusedWindowId, 'w-browser', 'focus falls to the next visible window');
  assert.equal(run.send({ kind: 'focus-window', id: 'w-mail' }).reason, 'minimized');
  assert.equal(run.send({ kind: 'minimize', id: 'w-mail' }).changed, false);
  run.send({ kind: 'open-app', app: 'mail' });
  assert.deepEqual([run.state.windows.find(win => win.id === 'w-mail').mode, run.state.focusedWindowId], ['normal', 'w-mail']);
  run.send({ kind: 'minimize', id: 'w-browser' });
  run.send({ kind: 'minimize', id: 'w-mail' });
  assert.equal(run.state.focusedWindowId, null);
  run.send({ kind: 'restore', id: 'w-browser' });
  assert.equal(run.state.focusedWindowId, 'w-browser');

  run.send({ kind: 'close', id: 'w-mail' });
  assert.deepEqual([run.state.order, run.state.windows.map(win => win.id)], [['w-browser'], ['w-browser']]);
  assert.equal(run.state.scene.phase, 'action', 'closing a window the scene is not waiting on does not stop it');
  run.send({ kind: 'open-app', app: 'mail' });
  assert.equal(run.state.windows.at(-1).contentStepId, 'mail', 'a closed app reopens with the latest step it showed');
  assert.equal(run.send({ kind: 'open-app', app: 'files' }).reason, 'no-such-app');
  assert.equal(run.send({ kind: 'open-app', app: 'notification-centre' }).reason, 'invalid-intent');
  run.validState();

  run.send({ kind: 'close', id: 'w-browser' });
  assert.equal(run.state.scene.phase, 'safe', 'closing the window the scene is waiting on is the walk-away');
  assert.equal(run.state.scene.path, 'safe');
});

test('Files selection must name a real entry and Run only works on the target file', () => {
  const run = createRun('deception-sunlight').toFirstStep();
  run.send({ kind: 'choose', choiceId: 'open' });
  run.send({ kind: 'choose', choiceId: 'download' });
  run.tickAt();
  assert.equal(run.step().id, 'files');
  assert.equal(run.send({ kind: 'select-entry', id: 'w-files', entryId: 'item-9' }).reason, 'no-such-entry');
  assert.equal(run.send({ kind: 'select-entry', id: 'w-browser', entryId: 'target' }).reason, 'no-such-entry');
  assert.equal(run.send({ kind: 'select-entry', id: 'w-files', entryId: 'target' }).changed, false, 'the target starts selected');
  assert.equal(run.send({ kind: 'select-entry', id: 'w-files', entryId: 'item-1' }).ok, true);
  assert.equal(run.send({ kind: 'choose', choiceId: 'run-file' }).reason, 'wrong-entry');
  run.send({ kind: 'select-entry', id: 'w-files', entryId: 'target' });
  assert.equal(run.send({ kind: 'choose', choiceId: 'run-file' }).ok, true);
  assert.equal(run.state.scene.deadlineMs, run.now + 1100);
  run.tickAt();
  assert.equal(run.state.scene.phase, 'attack');
});

test('the notification centre toggles, holds the toast and closes when the step moves on', () => {
  const run = createRun('deception-abyss').toFirstStep();
  run.send({ kind: 'toggle-centre' });
  assert.equal(run.state.centreOpen, true);
  assert.deepEqual(run.state.notifications.map(item => item.id), ['n-toast']);
  run.send({ kind: 'choose', choiceId: 'open' });
  assert.equal(run.state.centreOpen, false);
  assert.deepEqual(run.state.notifications, []);
  assert.equal(run.state.windows[0].app, 'mail');
});

test('debrief actions: pick-another and request-proof are effects, proof only for deception-abyss, closing the debrief reaches done', () => {
  const abyss = createRun('deception-abyss').toFirstStep();
  playForward(abyss);
  assert.equal(abyss.send({ kind: 'request-proof' }).reason, 'inert');
  abyss.state = model.fxDone(abyss.state, abyss.state.scene.effectId, abyss.now).state;
  const proof = abyss.send({ kind: 'request-proof' });
  assert.deepEqual([proof.ok, proof.changed, proof.effect], [true, false, 'request-proof']);
  assert.equal(abyss.send({ kind: 'pick-another' }).effect, 'pick-another');
  abyss.send({ kind: 'close', id: 'w-debrief' });
  assert.equal(abyss.state.scene.phase, 'done');
  assert.equal(abyss.send({ kind: 'pick-another' }).effect, 'pick-another');
  abyss.send({ kind: 'open-app', app: 'debrief' });
  assert.deepEqual([abyss.state.scene.phase, abyss.state.windows.at(-1).id], ['debrief', 'w-debrief']);
  abyss.send({ kind: 'close', id: 'w-debrief' });
  assert.equal(abyss.send({ kind: 'replay', path: 'normal' }).ok, true, 'done still allows Replay');

  const other = createRun('deception-midnight').toFirstStep();
  playForward(other);
  other.state = model.fxDone(other.state, other.state.scene.effectId, other.now).state;
  assert.equal(other.send({ kind: 'request-proof' }).reason, 'no-proof');
});

test('restart returns a locked desktop under a new run id', () => {
  const run = createRun('deception-abyss').toFirstStep();
  run.send({ kind: 'choose', choiceId: 'open' });
  const fresh = model.restart(run.state);
  assert.notEqual(fresh.runId, run.state.runId);
  assert.deepEqual([fresh.auth, fresh.revision, fresh.scene.phase, fresh.windows.length, fresh.scene.replayMode], ['locked', 0, 'boot', 0, 'normal']);
  assert.deepEqual(model.validate(fresh), { ok: true, error: null });
  assert.throws(() => model.restart({ ...run.state, runId: 'unregistered-run' }), /Unknown run/);
});

test('the shared state is plain JSON: identical intents give equal states regardless of which skin sent them', () => {
  const script = [
    { kind: 'show-sign-in' }, { kind: 'sign-in' }, 'tick', { kind: 'choose', choiceId: 'open' },
    { kind: 'resize-window', id: 'w-mail', bounds: { x: 200, y: 100, w: 700, h: 400 } }, { kind: 'minimize', id: 'w-mail' }, { kind: 'restore', id: 'w-mail' },
    { kind: 'choose', choiceId: 'follow-link' }, 'tick', { kind: 'choose', choiceId: 'sign-in' }, 'tick',
  ];
  const play = origin => {
    const run = createRun('deception-midnight');
    const sent = [];
    for (const entry of script) {
      if (entry === 'tick') run.tickAt();
      else {
        run.now += 25;
        sent.push({ origin, intent: run.send(structuredClone(entry)).ok });
      }
    }
    return run.state;
  };
  const fromWindows = play('windows');
  const fromMac = play('macos');
  const withoutRun = ({ runId, scene, ...rest }) => ({ runId, rest: { ...rest, scene: { ...scene, effectId: scene.effectId?.replace(runId, '') } } });
  const { runId: windowsRun, rest: windowsRest } = withoutRun(fromWindows);
  const { runId: macRun, rest: macRest } = withoutRun(fromMac);
  assert.notEqual(windowsRun, macRun);
  assert.deepEqual(windowsRest, macRest, 'the same inputs produce the same shared state');
  assert.deepEqual(model.snapshot(fromWindows), JSON.parse(JSON.stringify(fromWindows)), 'a snapshot is a JSON clone');
  assert.notEqual(model.snapshot(fromWindows).windows, fromWindows.windows);
  assert.equal(fromWindows.scene.phase, 'attack');
  assert.deepEqual(fromWindows.windows.find(win => win.id === 'w-mail').bounds, { x: 200, y: 100, w: 700, h: 400 }, 'bounds survive every later step');
});

test('validate rejects malformed or oversized states and snapshot refuses them', () => {
  const run = createRun('deception-abyss').toFirstStep();
  run.send({ kind: 'choose', choiceId: 'open' });
  const good = run.validState();
  const mutate = change => { const copy = structuredClone(good); change(copy); return copy; };
  for (const [label, bad] of [
    ['extra key', mutate(state => { state.extra = 1; })],
    ['version', mutate(state => { state.v = 1; })],
    ['run id', mutate(state => { state.runId = 'Bad'; })],
    ['revision', mutate(state => { state.revision = -1; })],
    ['auth', mutate(state => { state.auth = 'admin'; })],
    ['phase', mutate(state => { state.scene.phase = 'hacked'; })],
    ['scene key', mutate(state => { state.scene.note = 'x'; })],
    ['replay mode', mutate(state => { state.scene.replayMode = 'fast'; })],
    ['pending choice', mutate(state => { state.scene.pendingActionId = 'rm-rf'; })],
    ['deadline', mutate(state => { state.scene.deadlineMs = Number.NaN; })],
    ['window app', mutate(state => { state.windows[0].app = 'terminal'; })],
    ['window mode', mutate(state => { state.windows[0].mode = 'hidden'; })],
    ['window bounds', mutate(state => { state.windows[0].bounds.x = 990; })],
    ['bounds integers', mutate(state => { state.windows[0].bounds.w = 400.5; })],
    ['window extra', mutate(state => { state.windows[0].title = 'typed text'; })],
    ['order', mutate(state => { state.order = ['w-ghost']; })],
    ['focus', mutate(state => { state.focusedWindowId = 'w-ghost'; })],
    ['notification', mutate(state => { state.notifications = [{ id: 'n-x', appId: 'terminal', stepId: 'toast' }]; })],
    ['centre', mutate(state => { state.centreOpen = 'yes'; })],
    ['too many windows', mutate(state => { state.windows = Array.from({ length: 9 }, (_, index) => ({ ...state.windows[0], id: `w-${index}` })); state.order = state.windows.map(win => win.id); })],
    ['size', mutate(state => { state.notifications = Array.from({ length: 4 }, (_, index) => ({ id: `n-${index}`, appId: 'mail', stepId: 'x'.repeat(40) })); state.windows = Array.from({ length: 8 }, (_, index) => ({ ...state.windows[0], id: `w-${'a'.repeat(20)}${index}`, contentStepId: 'y'.repeat(40) })); state.order = state.windows.map(win => win.id); })],
  ]) {
    assert.equal(model.validate(bad).ok, false, label);
    if (label !== 'size') assert.throws(() => model.snapshot(bad), /Invalid desktop state/, label);
  }
  assert.equal(model.validate(null).ok, false);
  assert.equal(model.validate('state').ok, false);
});

test('parseIntent and parseIntentMessage accept only the exact contract shapes', () => {
  const good = [
    { kind: 'show-sign-in' }, { kind: 'sign-in' }, { kind: 'open-app', app: 'mail' }, { kind: 'focus-window', id: 'w-mail' },
    { kind: 'move-window', id: 'w-mail', bounds: { x: 1, y: 2, w: 300, h: 300 } }, { kind: 'resize-window', id: 'w-mail', bounds: { x: 1, y: 2, w: 300, h: 300 } },
    { kind: 'minimize', id: 'w-mail' }, { kind: 'restore', id: 'w-mail' }, { kind: 'expand', id: 'w-mail' }, { kind: 'close', id: 'w-mail' },
    { kind: 'select-entry', id: 'w-files', entryId: 'item-0' }, { kind: 'choose', choiceId: 'allow' }, { kind: 'toggle-centre' },
    { kind: 'dismiss-notification', id: 'n-toast' }, { kind: 'replay', path: 'safe' }, { kind: 'pick-another' }, { kind: 'request-proof' },
  ];
  for (const intent of good) assert.deepEqual(model.parseIntent(intent), intent, intent.kind);
  const bad = [
    null, 'sign-in', [], {}, { kind: 5 }, { kind: 'sign-in', extra: true }, { kind: 'open-app' }, { kind: 'open-app', app: 'terminal' },
    { kind: 'focus-window', id: 'W MAIL' }, { kind: 'focus-window', id: 'x'.repeat(25) }, { kind: 'focus-window', id: 'w-mail', extra: 1 },
    { kind: 'choose', choiceId: 'format-disk' }, { kind: 'choose', choiceId: 'allow', text: 'typed' }, { kind: 'replay', path: 'fell' },
    { kind: 'select-entry', id: 'w-files' }, { kind: 'dismiss-notification' }, { kind: 'set', key: 'auth', value: 'desktop' },
    { kind: 'move-window', id: 'w-mail' }, { kind: 'toggle-centre', open: true },
  ];
  for (const intent of bad) assert.equal(model.parseIntent(intent), null, JSON.stringify(intent));

  const message = { type: 'desktop-intent', version: 2, runId: 'test-run-0001', seq: 3, revision: 7, intent: { kind: 'choose', choiceId: 'open' } };
  assert.deepEqual(model.parseIntentMessage(message), { runId: 'test-run-0001', seq: 3, revision: 7, intent: { kind: 'choose', choiceId: 'open' } });
  for (const patch of [
    { version: 1 }, { type: 'scene-state' }, { runId: 'BAD' }, { runId: 'short' }, { seq: -1 }, { seq: 1.5 }, { seq: '3' }, { seq: 2 ** 31 + 1 },
    { revision: -1 }, { revision: null }, { intent: { kind: 'nope' } }, { intent: null }, { extra: true },
  ]) assert.equal(model.parseIntentMessage({ ...message, ...patch }), null, JSON.stringify(patch));
  const { seq, ...missing } = message;
  assert.equal(model.parseIntentMessage(missing), null);
});

test('choicesFor exposes forward and safe choices per step, never a safe choice for trench', () => {
  for (const profile of PROFILES) {
    const scene = sceneFor(profile);
    for (const step of scene.steps) {
      const choices = model.choicesFor(step);
      for (const id of [...choices.forward, ...choices.safe, ...choices.noop]) assert.ok(model.CHOICE_IDS.includes(id), `${profile.id} ${step.id} ${id}`);
      if (step.kind === 'victim' || step.id === 'toast' || step.kind === 'notice') {
        assert.ok(choices.forward.length > 0, `${profile.id} ${step.id} can move on`);
        if (step.id !== 'toast' && profile.depthId !== 'trench') assert.ok(choices.safe.length > 0, `${profile.id} ${step.id} can walk away`);
      }
      if (profile.depthId === 'trench') assert.deepEqual(choices.safe, [], `${profile.id} ${step.id}`);
    }
  }
});
