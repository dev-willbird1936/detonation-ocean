import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkBrowserImagePackaging, runHackathonPatternB } from '../backend/hackathon-proof.mjs';
import { VULTR_INFERENCE_APPROVAL, VULTR_INFERENCE_URL, VISION_DENY_VERDICT, verifyOAuthScreenshots } from '../backend/vultr-inference.mjs';

const jpeg = Buffer.from([0xff, 0xd8, 0x00, 0x11, 0xff, 0xd9]);
const sha256 = createHash('sha256').update(jpeg).digest('hex');
const screenshots = ['desktop-before-optin', 'consent-ready', 'receipt'].map(stage => ({
  stage,
  mimeType: 'image/jpeg',
  sha256,
  base64: jpeg.toString('base64'),
}));

function execution(overrides = {}) {
  return {
    ok: true,
    decision: 'allow',
    status: 'complete',
    containerTeardown: 'confirmed',
    screenshots,
    receipt: {
      scenarioId: 'oauth-2023',
      status: 'complete',
      decision: 'allow',
      personaId: 'persona-game-001',
      tokenIssued: true,
      exposedMessageCount: 2,
    },
    ...overrides,
  };
}

const approvedEnv = {
  VULTR_INFERENCE_APPROVAL: VULTR_INFERENCE_APPROVAL,
  VULTR_INFERENCE_API_KEY: 'test-key-1234',
  VULTR_INFERENCE_MODEL: 'vision-test',
};

function fetchOk(content, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return { status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({ choices: [{ message: { content } }] })) };
  };
}

test('browser image packaging includes the training manifest', () => {
  const packaging = checkBrowserImagePackaging();
  assert.equal(packaging.ok, true, JSON.stringify(packaging));
});

test('missing opt-in does not call the container or vision', async () => {
  let called = false;
  const result = await runHackathonPatternB({
    optIn: false,
    containerOptIn: true,
    inferenceAcknowledged: true,
    evidenceClass: 'injected',
    runContainer: async () => { called = true; },
    verifyVision: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(result.contractMet, false);
  assert.equal(result.submissionValid, false);
  assert.equal(result.error, 'explicit_opt_in_required');
});

test('missing inference acknowledgement does not call the container or vision', async () => {
  let called = false;
  const result = await runHackathonPatternB({
    optIn: true,
    containerOptIn: true,
    runContainer: async () => { called = true; },
    verifyVision: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(result.contractMet, false);
  assert.equal(result.error, 'explicit_opt_in_required');
});

test('container request is fixed to the synthetic allow persona', async () => {
  const seen = [];
  await runHackathonPatternB({
    optIn: true,
    containerOptIn: true,
    inferenceAcknowledged: true,
    evidenceClass: 'injected',
    runContainer: async input => { seen.push(input); return execution(); },
    verifyVision: async () => ({ status: 'not_run', providerCall: 'not_made', live: false }),
    env: {},
  });
  assert.deepEqual(seen, [{ optIn: true, decision: 'allow', personaId: 'persona-game-001' }]);
});

test('deny execution requires a no-token receipt and verifies the user-selected decision', async () => {
  let containerInput;
  let verifiedDecision;
  const result = await runHackathonPatternB({
    optIn: true,
    containerOptIn: true,
    inferenceAcknowledged: true,
    decision: 'deny',
    evidenceClass: 'injected',
    runContainer: async input => {
      containerInput = input;
      return execution({
        decision: 'deny',
        status: 'denied',
        receipt: {
          ...execution().receipt,
          decision: 'deny',
          status: 'denied',
          tokenIssued: false,
          exposedMessageCount: 0,
          exposedMessages: [],
        },
      });
    },
    verifyVision: async ({ decision }) => {
      verifiedDecision = decision;
      return { status: 'passed', provider: 'vultr-serverless-inference', providerCall: 'completed', live: true };
    },
  });
  assert.deepEqual(containerInput, { optIn: true, decision: 'deny', personaId: 'persona-game-001' });
  assert.equal(verifiedDecision, 'deny');
  assert.equal(result.decision, 'deny');
  assert.equal(result.tokenIssued, false);
  assert.equal(result.exposedMessageCount, 0);
  assert.equal(result.contractMet, false, 'injected evidence never qualifies as live proof');
});

test('deny screenshot verifier accepts only the deny/no-access verdict', async () => {
  const calls = [];
  const result = await verifyOAuthScreenshots({
    screenshots,
    decision: 'deny',
    env: approvedEnv,
    fetchImpl: fetchOk(JSON.stringify({ verdict: VISION_DENY_VERDICT }), calls),
  });
  assert.equal(result.status, 'passed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body.includes('Simulate Deny with no token'), true);
});

test('unapproved vision is not_run and cannot qualify', async () => {
  let fetched = false;
  const result = await runHackathonPatternB({
    optIn: true,
    containerOptIn: true,
    inferenceAcknowledged: true,
    evidenceClass: 'injected',
    runContainer: async () => execution(),
    verifyVision: options => verifyOAuthScreenshots({ ...options, fetchImpl: async () => { fetched = true; } }),
    env: {},
  });
  assert.equal(fetched, false);
  assert.equal(result.vision.status, 'not_run');
  assert.equal(result.contractMet, false);
  assert.equal(result.submissionValid, false);
  assert.equal(result.labels.visionLiveProof, false);
});

test('unconfirmed cleanup cannot qualify and does not call vision', async () => {
  let visionCalled = false;
  const result = await runHackathonPatternB({
    optIn: true,
    containerOptIn: true,
    inferenceAcknowledged: true,
    evidenceClass: 'injected',
    runContainer: async () => execution({ containerTeardown: 'unconfirmed' }),
    verifyVision: async () => { visionCalled = true; },
  });
  assert.equal(visionCalled, false);
  assert.equal(result.contractMet, false);
  assert.equal(result.containerTeardown, 'unconfirmed');
});

test('malformed vision response cannot qualify', async () => {
  const calls = [];
  const result = await runHackathonPatternB({
    optIn: true,
    containerOptIn: true,
    inferenceAcknowledged: true,
    evidenceClass: 'injected',
    runContainer: async () => execution(),
    verifyVision: options => verifyOAuthScreenshots({ ...options, env: approvedEnv, fetchImpl: fetchOk('not json', calls) }),
    env: approvedEnv,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, VULTR_INFERENCE_URL);
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-key-1234');
  assert.equal(calls[0].options.body.includes('test-key-1234'), false);
  assert.equal(result.vision.status, 'failed');
  assert.equal(result.contractMet, false);
  assert.equal(result.labels.injectedResultsAreTestEvidence, true);
  assert.equal(result.labels.visionLiveProof, false);
});

test('injected worker and vision results never qualify as live hackathon proof', async () => {
  const result = await runHackathonPatternB({
    optIn: true,
    containerOptIn: true,
    inferenceAcknowledged: true,
    evidenceClass: 'injected',
    runContainer: async () => execution(),
    verifyVision: options => verifyOAuthScreenshots({
      ...options,
      env: approvedEnv,
      fetchImpl: fetchOk('{"verdict":"synthetic-allow-visible"}', []),
    }),
    env: approvedEnv,
  });
  assert.equal(result.vision.status, 'passed');
  assert.equal(result.vision.live, true);
  assert.equal(result.contractMet, false);
  assert.equal(result.labels.visionLiveProof, false);
  assert.equal(result.submissionValid, false);
  assert.equal(result.vultrCompute, 'not_run');
  assert.equal(result.oceanDesktop, 'out_of_scope');
  assert.equal(result.exposedMessageCount, 2);
  assert.equal(Object.hasOwn(result, 'screenshots'), false);
});
