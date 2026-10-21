import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  TrainingSessionError,
  TrainingSessionStore,
  TRAINING_EXECUTION_MODE,
  TRAINING_MAX_RESETS_PER_SESSION,
  TRAINING_SCENARIO_IDS,
} from '../backend/training-session.mjs';

const idFactory = () => {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
};
const store = options => new TrainingSessionStore({ idFactory: idFactory(), ...options });
const errorCode = code => error => error instanceof TrainingSessionError && error.code === code;

function action(view, kind) {
  const candidate = view.permittedActions.find(item => item.kind === kind);
  assert.ok(candidate, `expected a ${kind} action at ${view.currentStep}`);
  return candidate;
}

function assertEventChain(events) {
  let previousHash = '0'.repeat(64);
  for (const event of events) {
    const { hash, ...body } = event;
    assert.equal(event.previousHash, previousHash);
    assert.equal(hash, createHash('sha256').update(JSON.stringify(body)).digest('hex'));
    previousHash = hash;
  }
}

test('catalogue exposes exactly the ten fixed synthetic scenarios and all SEV levels', () => {
  const sessions = store();
  const scenarios = sessions.listScenarios();
  assert.deepEqual(scenarios.map(scenario => scenario.id), TRAINING_SCENARIO_IDS);
  assert.deepEqual(scenarios.map(scenario => scenario.sev).sort(), [1, 1, 1, 1, 1, 2, 2, 3, 4, 5]);
  assert.ok(scenarios.every(scenario => scenario.mechanism && scenario.summary));
  assert.throws(() => sessions.create({ attackId: 'oauth-2023' }), errorCode('OPT_IN_REQUIRED'));
  assert.throws(() => sessions.create({ attackId: 'oauth-2023', optIn: true, password: 'never accepted' }), errorCode('INVALID_INPUT'));
  assert.equal(sessions.dispose().destroyedSessions, 0);
});

test('all ten scenarios have distinct safe/adverse backend changes, ordered recovery and event-derived receipts', () => {
  const affectedProperties = new Map([
    ['oauth-2023', 'mailbox.exposedMessageIds'],
    ['zeus-2007', 'sessions.accountSummaryVisible'],
    ['drainer-2022', 'wallet.balanceCredits'],
    ['iloveyou-2000', 'files.budget.available'],
    ['wannacry-2017', 'service.status'],
    ['solarwinds-2020', 'updater.packageAccepted'],
    ['heartbleed-2014', 'diagnostic.canaryExposed'],
    ['log4shell-2021', 'canary.visible'],
    ['moveit-2023', 'records.payroll.private'],
    ['bec-2024', 'invoice.status'],
  ]);
  const catalogue = store();

  for (const scenario of catalogue.listScenarios()) {
    const safeStore = store();
    const safeStart = safeStore.create({ attackId: scenario.id, optIn: true });
    const safeAction = action(safeStart, 'safe');
    const safeResult = safeStore.act(safeStart.sessionId, { actionId: safeAction.id });
    assert.equal(safeResult.currentStep, null, `${scenario.id} safe path should complete`);
    assert.equal(safeResult.outcome.status, 'complete');
    assert.ok(safeResult.outcome.receipt.changedProperties.length > 0, `${scenario.id} safe choice changes seeded state`);

    const adverseStore = store();
    const adverseStart = adverseStore.create({ attackId: scenario.id, optIn: true });
    const adverseAction = action(adverseStart, 'adverse');
    const adverseResult = adverseStore.act(adverseStart.sessionId, { actionId: adverseAction.id });
    assert.equal(adverseResult.currentStep, 'recover', `${scenario.id} adverse choice must lead to recovery`);
    assert.equal(adverseResult.outcome.status, 'in_progress');
    assert.ok(adverseResult.outcome.receipt.changedProperties.includes(affectedProperties.get(scenario.id)), scenario.id);
    assert.deepEqual(adverseResult.outcome.receipt.adverseActionIds, [adverseAction.id]);
    assert.throws(
      () => adverseStore.act(adverseStart.sessionId, { actionId: safeAction.id }),
      errorCode('ACTION_NOT_PERMITTED'),
      `${scenario.id} rejects stale/out-of-order action`,
    );
    const recoveryAction = action(adverseResult, 'recovery');
    const recovered = adverseStore.act(adverseStart.sessionId, { actionId: recoveryAction.id });
    assert.equal(recovered.currentStep, null);
    assert.equal(recovered.outcome.status, 'complete');
    assert.deepEqual(recovered.outcome.receipt.actionIds, [adverseAction.id, recoveryAction.id]);
    assert.equal(recovered.outcome.receipt.evidenceSha256, createHash('sha256').update(JSON.stringify(recovered.events)).digest('hex'));
    assertEventChain(recovered.events);
    safeStore.dispose();
    adverseStore.dispose();
  }
  catalogue.dispose();
});

test('returned desktop data is cloned and concurrent sessions have isolated state', () => {
  const sessions = store();
  const first = sessions.create({ attackId: 'oauth-2023', optIn: true });
  const second = sessions.create({ attackId: 'oauth-2023', optIn: true });
  first.state.consent.status = 'tampered';
  first.assets.mailbox.messages[0].body = 'tampered';
  first.persona.accounts[0].demoSecret = 'tampered';
  first.events[0].details.attackId = 'tampered';
  const unchanged = sessions.view(first.sessionId);
  assert.equal(unchanged.state.consent.status, 'pending');
  assert.equal(unchanged.assets.mailbox.messages[0].body, 'A fictional scheduling app requests mail and file access.');
  assert.match(unchanged.persona.accounts[0].demoSecret, /^TRAINING-ONLY-/);
  assert.equal(sessions.view(second.sessionId).state.consent.status, 'pending');
  sessions.act(first.sessionId, { actionId: action(unchanged, 'adverse').id });
  assert.equal(sessions.view(second.sessionId).state.consent.status, 'pending');
  assert.throws(() => sessions.act(second.sessionId, { actionId: 'oauth-revoke' }), errorCode('ACTION_NOT_PERMITTED'));
  sessions.dispose();
});

test('reset restores cloned seed state, starts a new receipt epoch and retains the event hash chain', () => {
  const sessions = store();
  const first = sessions.create({ attackId: 'drainer-2022', optIn: true });
  const other = sessions.create({ attackId: 'drainer-2022', optIn: true });
  const initialState = structuredClone(first.state);
  const adverse = action(first, 'adverse');
  const changed = sessions.act(first.sessionId, { actionId: adverse.id });
  assert.equal(changed.state.wallet.balanceCredits, 0);
  const reset = sessions.reset(first.sessionId);
  assert.deepEqual(reset.state, initialState);
  assert.equal(reset.currentStep, 'review');
  assert.equal(reset.outcome.status, 'in_progress');
  assert.deepEqual(reset.outcome.receipt.actionIds, []);
  assert.equal(reset.outcome.receipt.epoch, 2);
  assert.equal(reset.events.length, changed.events.length + 2);
  assert.deepEqual(reset.events.map(event => event.sequence), reset.events.map((_, index) => index + 1));
  assertEventChain(reset.events);
  assert.equal(sessions.view(other.sessionId).state.wallet.balanceCredits, 5000);
  sessions.dispose();
});

test('input allowlists reject credential text, arbitrary action data and invalid session IDs', () => {
  const sessions = store();
  const session = sessions.create({ attackId: 'zeus-2007', optIn: true });
  assert.throws(() => sessions.create({ attackId: 'zeus-2007', optIn: true, username: 'real@example.com' }), errorCode('INVALID_INPUT'));
  assert.throws(() => sessions.act(session.sessionId, { actionId: 'zeus-lookalike', password: 'not accepted' }), errorCode('INVALID_INPUT'));
  assert.throws(() => sessions.act(session.sessionId, { actionId: 'run-command' }), errorCode('ACTION_NOT_PERMITTED'));
  assert.throws(() => sessions.view('../../host'), errorCode('INVALID_INPUT'));
  sessions.dispose();
});

test('destroy, capacity limits and disposal clean up sessions deterministically', () => {
  const sessions = store({ maxSessions: 1 });
  const session = sessions.create({ attackId: 'bec-2024', optIn: true });
  assert.throws(() => sessions.create({ attackId: 'oauth-2023', optIn: true }), errorCode('SESSION_LIMIT'));
  const destroyed = sessions.destroy(session.sessionId);
  assert.equal(destroyed.destroyed, true);
  assert.equal(destroyed.receipt.status, 'destroyed');
  assert.deepEqual(sessions.destroy(session.sessionId), { sessionId: session.sessionId, destroyed: true, reason: 'destroyed', alreadyClosed: true });
  assert.throws(() => sessions.view(session.sessionId), errorCode('SESSION_DESTROYED'));
  const next = sessions.create({ attackId: 'oauth-2023', optIn: true });
  assert.equal(sessions.dispose().destroyedSessions, 1);
  assert.throws(() => sessions.view(next.sessionId), errorCode('STORE_DISPOSED'));
  assert.throws(() => sessions.create({ attackId: 'oauth-2023', optIn: true }), errorCode('STORE_DISPOSED'));
});

test('fixed lifetime expires sessions, frees capacity and never extends on reset', () => {
  let now = 10_000;
  const sessions = store({ clock: () => now, lifetimeMs: 100, maxSessions: 1 });
  const session = sessions.create({ attackId: 'oauth-2023', optIn: true });
  assert.equal(session.expiresAt, new Date(now + 100).toISOString());
  now += 99;
  sessions.reset(session.sessionId);
  assert.equal(sessions.view(session.sessionId).expiresAt, new Date(10_100).toISOString());
  now += 1;
  assert.throws(() => sessions.view(session.sessionId), errorCode('SESSION_EXPIRED'));
  assert.deepEqual(sessions.destroy(session.sessionId), { sessionId: session.sessionId, destroyed: true, reason: 'expired', alreadyClosed: true });
  const replacement = sessions.create({ attackId: 'oauth-2023', optIn: true });
  assert.equal(replacement.scenario.id, 'oauth-2023');
  sessions.dispose();
});

test('reset budget rejects before mutation and does not prevent destruction', () => {
  const sessions = store();
  let view = sessions.create({ attackId: 'oauth-2023', optIn: true });
  assert.equal(TRAINING_MAX_RESETS_PER_SESSION, 8);
  for (let reset = 0; reset < TRAINING_MAX_RESETS_PER_SESSION; reset++) {
    view = sessions.reset(view.sessionId);
  }
  view = sessions.act(view.sessionId, { actionId: action(view, 'adverse').id });
  const beforeRejectedReset = sessions.view(view.sessionId);
  assert.throws(() => sessions.reset(view.sessionId), error => {
    assert.equal(error.status, 429);
    return errorCode('RESET_LIMIT')(error);
  });
  const afterRejectedReset = sessions.view(view.sessionId);
  assert.deepEqual(afterRejectedReset.state, beforeRejectedReset.state);
  assert.deepEqual(afterRejectedReset.events, beforeRejectedReset.events);
  assert.deepEqual(afterRejectedReset.outcome, beforeRejectedReset.outcome);
  const destroyed = sessions.destroy(view.sessionId);
  assert.equal(destroyed.destroyed, true);
  assert.equal(destroyed.receipt.status, 'destroyed');
  sessions.dispose();
});

test('session metadata reports the local in-process boundary and stable exported error contract', () => {
  assert.equal(TRAINING_EXECUTION_MODE, 'local-synthetic-in-process');
  const sessions = store();
  const session = sessions.create({ attackId: 'heartbleed-2014', optIn: true });
  assert.equal(session.executionMode, 'local-synthetic-in-process');
  assert.equal(session.scenario.sev, 1);
  assert.equal(session.currentStep, 'review');
  assert.ok(session.permittedActions.some(item => item.kind === 'safe'));
  assert.ok(session.permittedActions.some(item => item.kind === 'adverse'));
  sessions.dispose();
});
