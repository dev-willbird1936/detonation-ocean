import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOAuthPlan, executeOAuthScenario, LocalSyntheticAdapter, OAUTH_ATTACK_ID, ScenarioInputError } from '../backend/oauth-scenario.mjs';
import { loadPersonas } from '../backend/personas.mjs';
import { createAppServer } from '../server.mjs';

const personas = loadPersonas();
const personaId = personas.personas[0].id;
const planRequest = { attackId: OAUTH_ATTACK_ID, personaId };
const fixedClock = () => '2026-09-29T00:00:00.000Z';

function executeInput(decision, planId = createOAuthPlan(planRequest, personas).planId) {
  return { ...planRequest, decision, planId };
}

test('deterministic plan includes synthetic persona, scopes and ordered steps', () => {
  const first = createOAuthPlan(planRequest, personas);
  const second = createOAuthPlan(planRequest, personas);
  assert.equal(first.planId, second.planId);
  assert.equal(first.plan.personaId, personaId);
  assert.deepEqual(first.plan.app.requestedScopes, ['mail.read', 'files.read']);
  assert.deepEqual(first.plan.steps.map(step => step.id), [
    'inspect-persona', 'show-consent', 'record-choice', 'issue-token', 'read-mailbox', 'receipt', 'destroy',
  ]);
});

test('allow uses only a synthetic token, reads mailbox metadata, derives receipt and tears down', async () => {
  const token = 'syn_test_token_only';
  const adapter = new LocalSyntheticAdapter({ tokenFactory: () => token });
  const result = await executeOAuthScenario({
    input: executeInput('allow'), personas, adapter,
    runIdFactory: () => 'test-allow', clock: fixedClock,
  });
  const expectedMessages = personas.personas[0].mailbox.messages;

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'complete');
  assert.equal(result.receipt.tokenIssued, true);
  assert.equal(result.receipt.exposedMessageCount, expectedMessages.length);
  assert.deepEqual(result.receipt.exposedMessages.map(message => message.id), expectedMessages.map(message => message.id));
  assert.deepEqual(result.receipt.grantedScopes, ['mail.read', 'files.read']);
  assert.deepEqual(result.receipt.unusedGrantedScopes, ['files.read']);
  assert.equal(result.receipt.sandboxDestroyed, true);
  assert.equal(result.receipt.evidenceSha256, createHash('sha256').update(JSON.stringify(result.events)).digest('hex'));
  assert.equal(adapter.destroyedCount, 1);
  assert.equal(adapter.activeSandboxes.size, 0);
  assert.equal(adapter.lastSandbox.active, false);
  assert.equal(adapter.lastSandbox.tokens.size, 0);
  assert.equal(JSON.stringify(result).includes(token), false, 'synthetic token value must not appear in output');
  assert.equal(result.events.some(event => event.type === 'mailbox.synthetic_records_read'), true);
});

test('deny issues no token, reads no mailbox data and tears down', async () => {
  const adapter = new LocalSyntheticAdapter({ tokenFactory: () => 'syn_should_not_be_created' });
  const result = await executeOAuthScenario({
    input: executeInput('deny'), personas, adapter,
    runIdFactory: () => 'test-deny', clock: fixedClock,
  });

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'denied');
  assert.equal(result.receipt.tokenIssued, false);
  assert.equal(result.receipt.exposedMessageCount, 0);
  assert.equal(result.receipt.sandboxDestroyed, true);
  assert.equal(result.events.some(event => event.type === 'mailbox.synthetic_records_read'), false);
  assert.equal(adapter.destroyedCount, 1);
  assert.equal(adapter.lastSandbox.tokens.size, 0);
});

test('forced mailbox failure returns a failure receipt and still destroys token state', async () => {
  const adapter = new LocalSyntheticAdapter({
    failAt: 'mailbox.read',
    tokenFactory: () => 'syn_failure_test_token',
  });
  const result = await executeOAuthScenario({
    input: executeInput('allow'), personas, adapter,
    runIdFactory: () => 'test-failure', clock: fixedClock,
  });

  assert.equal(result.ok, false);
  assert.equal(result.receipt.status, 'failed');
  assert.equal(result.receipt.tokenIssued, true);
  assert.equal(result.receipt.exposedMessageCount, 0);
  assert.equal(result.receipt.sandboxDestroyed, true);
  assert.equal(result.events.some(event => event.type === 'scenario.failed'), true);
  assert.equal(adapter.destroyedCount, 1);
  assert.equal(adapter.activeSandboxes.size, 0);
  assert.equal(adapter.lastSandbox.tokens.size, 0);
  assert.equal(JSON.stringify(result).includes('syn_failure_test_token'), false);
});

test('unprepared or modified plans and credential-shaped input are rejected before sandbox creation', async () => {
  const adapter = new LocalSyntheticAdapter();
  await assert.rejects(
    executeOAuthScenario({ input: executeInput('allow', '0'.repeat(64)), personas, adapter }),
    ScenarioInputError,
  );
  assert.equal(adapter.createdCount, 0);
  assert.throws(() => createOAuthPlan({ ...planRequest, password: 'not-accepted' }, personas), ScenarioInputError);
  assert.throws(() => createOAuthPlan({ ...planRequest, email: 'person@example.invalid' }, personas), ScenarioInputError);
});

test('loopback HTTP flow plans first and executes only after a local choice', async () => {
  const adapter = new LocalSyntheticAdapter({ tokenFactory: () => 'syn_http_test_token' });
  const server = createAppServer({ personas, adapterFactory: () => adapter });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, origin = base) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });

  try {
    const health = await fetch(`${base}/api/healthz`);
    assert.deepEqual(await health.json(), { ok: true, mode: 'local-synthetic', externalNetwork: false });

    const planResponse = await post('/api/scenarios/oauth/plan', {
      ...planRequest, optIn: true, browserContainerOptIn: false,
    });
    assert.equal(planResponse.status, 200);
    const prepared = await planResponse.json();
    assert.equal(prepared.plan.personaId, personaId);
    assert.equal(adapter.createdCount, 0, 'planning must not create a sandbox');

    const deniedOrigin = await post('/api/scenarios/oauth/execute', {
      ...executeInput('allow', prepared.planId), optIn: true, browserContainerOptIn: false,
    }, 'http://example.invalid');
    assert.equal(deniedOrigin.status, 403);
    assert.equal(adapter.createdCount, 0);

    const runResponse = await post('/api/scenarios/oauth/execute', {
      ...executeInput('allow', prepared.planId), optIn: true, browserContainerOptIn: false,
    });
    assert.equal(runResponse.status, 200);
    const result = await runResponse.json();
    assert.equal(result.receipt.exposedMessageCount, personas.personas[0].mailbox.messages.length);
    assert.equal(result.receipt.sandboxDestroyed, true);
    assert.equal(JSON.stringify(result).includes('syn_http_test_token'), false);
    assert.equal(adapter.destroyedCount, 1);

    const badInput = await post('/api/scenarios/oauth/plan', {
      ...planRequest, optIn: true, password: 'never-stored',
    });
    assert.equal(badInput.status, 400);
    assert.equal(adapter.createdCount, 1);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});
