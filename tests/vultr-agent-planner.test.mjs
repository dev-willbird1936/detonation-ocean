import test from 'node:test';
import assert from 'node:assert/strict';
import { VULTR_INFERENCE_APPROVAL, VULTR_INFERENCE_URL } from '../backend/vultr-inference.mjs';
import { allowedPlannerActions, planProfileAction } from '../backend/vultr-agent-planner.mjs';

const env = { VULTR_INFERENCE_APPROVAL, VULTR_INFERENCE_API_KEY: 'test-key-1234', VULTR_INFERENCE_MODEL: 'plan-test' };
const profile = { familyId: 'deception', depthId: 'sunlight' };

function reply(content, status = 200) {
  return async () => ({ status, arrayBuffer: async () => Buffer.from(JSON.stringify({ choices: [{ message: { content } }] })) });
}

test('every depth exposes exactly one fixed planner action', () => {
  assert.deepEqual(['sunlight', 'twilight', 'midnight', 'abyss', 'trench'].map(allowedPlannerActions),
    [['open-sample'], ['approve-factor'], ['disclose-password'], ['authorize-app'], ['none']]);
  assert.deepEqual(allowedPlannerActions('bogus'), []);
});

test('planner makes no provider call without the approval gate', async () => {
  let called = false;
  const out = await planProfileAction({ profile, env: {}, fetchImpl: async () => { called = true; } });
  assert.equal(out.status, 'not_run');
  assert.equal(called, false);
});

test('planner sends a fixed prompt to the Vultr endpoint and accepts only the allowed action', async () => {
  let seen;
  const out = await planProfileAction({
    profile, env,
    fetchImpl: async (url, init) => { seen = { url, init }; return reply('{"actionId":"open-sample"}')(); },
  });
  assert.equal(seen.url, VULTR_INFERENCE_URL);
  assert.ok(!seen.init.body.includes(env.VULTR_INFERENCE_API_KEY));
  assert.match(seen.init.body, /open-sample/);
  assert.deepEqual([out.status, out.actionId, out.live], ['planned', 'open-sample', true]);
});

test('trench plans no victim action', async () => {
  const out = await planProfileAction({ profile: { familyId: 'intrusion', depthId: 'trench' }, env, fetchImpl: reply('{"actionId":"none"}') });
  assert.deepEqual([out.status, out.actionId], ['planned', null]);
});

test('planner rejects extra keys, foreign actions and free text', async () => {
  for (const content of ['{"actionId":"rm -rf /"}', '{"actionId":"open-sample","cmd":"x"}', 'open-sample', '{"actionId":"approve-factor"}']) {
    const out = await planProfileAction({ profile, env, fetchImpl: reply(content) });
    assert.deepEqual([out.status, out.actionId, out.reason], ['failed', null, 'plan_rejected'], content);
  }
});

test('planner fails closed on provider errors and invalid profiles', async () => {
  assert.equal((await planProfileAction({ profile, env, fetchImpl: reply('', 500) })).reason, 'provider_http_error');
  assert.equal((await planProfileAction({ profile, env, fetchImpl: async () => { throw new Error('x'); } })).reason, 'provider_request_failed');
  assert.equal((await planProfileAction({ profile: { familyId: 'deception', depthId: 'nope' }, env })).reason, 'invalid_profile');
});
