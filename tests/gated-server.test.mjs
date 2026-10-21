import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';
import { LocalSyntheticAdapter, OAUTH_ATTACK_ID } from '../backend/oauth-scenario.mjs';
import { loadPersonas } from '../backend/personas.mjs';

const personas = loadPersonas();
const personaId = personas.personas[0].id;

test('gated mode requires server-side cost acknowledgement before adapter creation', async () => {
  const previousMode = process.env.VULTR_SANDBOX_MODE;
  process.env.VULTR_SANDBOX_MODE = 'vultr';
  let adapterCreations = 0;
  const server = createAppServer({
    personas,
    adapterFactory: () => {
      adapterCreations++;
      return new LocalSyntheticAdapter({ tokenFactory: () => 'syn_gated_mock_token' });
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body),
  });

  try {
    const planResponse = await post('/api/scenarios/oauth/plan', {
      attackId: OAUTH_ATTACK_ID, personaId, optIn: true, browserContainerOptIn: false,
    });
    const plan = await planResponse.json();
    assert.equal(plan.executionMode, 'vultr-gated');
    assert.equal(adapterCreations, 0);

    const request = {
      attackId: OAUTH_ATTACK_ID, personaId, decision: 'allow', planId: plan.planId,
      optIn: true, browserContainerOptIn: false,
    };
    const missingAcknowledgement = await post('/api/scenarios/oauth/execute', request);
    assert.equal(missingAcknowledgement.status, 400);
    assert.equal(adapterCreations, 0, 'no adapter or resource is created before cost acknowledgement');

    const acknowledged = await post('/api/scenarios/oauth/execute', { ...request, costAcknowledged: true });
    assert.equal(acknowledged.status, 200);
    const result = await acknowledged.json();
    assert.equal(result.executionMode, 'vultr-gated');
    assert.equal(result.receipt.sandboxDestroyed, true);
    assert.equal(adapterCreations, 1);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    if (previousMode === undefined) delete process.env.VULTR_SANDBOX_MODE;
    else process.env.VULTR_SANDBOX_MODE = previousMode;
  }
});
