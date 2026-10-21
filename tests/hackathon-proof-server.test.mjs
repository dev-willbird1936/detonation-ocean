import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createAppServer } from '../server.mjs';

const stages = ['desktop-before-optin', 'consent-ready', 'receipt'];
const jpeg = Buffer.from([0xff, 0xd8, 0x00, 0x11, 0xff, 0xd9]);
const screenshots = stages.map(stage => ({
  stage,
  mimeType: 'image/jpeg',
  sha256: createHash('sha256').update(jpeg).digest('hex'),
  base64: jpeg.toString('base64'),
}));
const passedProof = overrides => ({
  contractMet: true,
  submissionValid: false,
  decision: 'allow',
  evidenceClass: 'host-docker',
  containerTeardown: 'confirmed',
  exposedMessageCount: 2,
  tokenIssued: true,
  screenshotStages: stages,
  screenshots,
  vision: {
    status: 'passed',
    provider: 'vultr-serverless-inference',
    providerCall: 'completed',
    live: true,
    reason: null,
  },
  error: null,
  ...overrides,
});

async function withServer(options, run) {
  const server = createAppServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, server });
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

function post(base, path, body, origin = base) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

async function preparePlan(base) {
  const response = await post(base, '/api/scenarios/oauth/plan', {
    attackId: 'oauth-2023',
    personaId: 'persona-game-001',
    optIn: true,
    browserContainerOptIn: true,
  });
  return { response, plan: await response.json() };
}

function proofRequest(planId, decision = 'allow', overrides = {}) {
  return {
    attackId: 'oauth-2023',
    personaId: 'persona-game-001',
    decision,
    planId,
    optIn: true,
    browserContainerOptIn: true,
    inferenceAcknowledged: true,
    ...overrides,
  };
}

function postWithHost(base, host, origin, body) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: url.port,
      path: '/api/hackathon/proof',
      method: 'POST',
      headers: { host, origin, 'content-type': 'application/json' },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

test('hackathon controller routes opted-in proof through the isolated runner, never its session store', async () => {
  let runnerCalls = 0;
  let storeCalls = 0;
  let runnerInput;
  const store = Object.fromEntries(['listScenarios', 'create', 'view', 'act', 'reset', 'destroy'].map(name => [name, () => {
    storeCalls++;
    throw new Error(`controller store must not handle ${name}`);
  }]));
  store.dispose = () => {};

  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: true,
    trainingSessionStore: store,
    hackathonProofRunner: async input => {
      runnerCalls++;
      runnerInput = input;
      return passedProof();
    },
  }, async ({ base }) => {
    const training = await fetch(`${base}/api/training/scenarios`, { headers: { origin: base } });
    assert.equal(training.status, 503);
    assert.equal((await training.json()).code, 'WORKER_BACKEND_REQUIRED');

    const { response: planResponse, plan } = await preparePlan(base);
    assert.equal(planResponse.status, 200);
    assert.equal(plan.executionMode, 'vultr-hackathon');

    const missingContainerOptIn = await post(base, '/api/hackathon/proof', proofRequest(plan.planId, 'allow', { browserContainerOptIn: false }));
    assert.equal(missingContainerOptIn.status, 403);
    const missingInferenceAcknowledgement = await post(base, '/api/hackathon/proof', proofRequest(plan.planId, 'allow', { inferenceAcknowledged: false }));
    assert.equal(missingInferenceAcknowledgement.status, 403);
    assert.equal(runnerCalls, 0);

    const extraField = await post(base, '/api/hackathon/proof', { ...proofRequest(plan.planId), command: 'ignored' });
    assert.equal(extraField.status, 400);
    assert.equal(runnerCalls, 0);

    const response = await post(base, '/api/hackathon/proof', proofRequest(plan.planId));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.contractMet, true);
    assert.equal(result.submissionValid, false);
    assert.equal(result.containerTeardown, 'confirmed');
    assert.equal(result.decision, 'allow');
    assert.equal(result.executionMode, 'vultr-hackathon');
    assert.equal(result.vision.live, true);
    assert.equal(result.screenshots.length, 3);
    assert.equal(result.screenshots[0].mimeType, 'image/jpeg');
    assert.equal(Object.hasOwn(result, 'apiKey'), false);
    assert.deepEqual(runnerInput, {
      optIn: true,
      containerOptIn: true,
      inferenceAcknowledged: true,
      decision: 'allow',
      includeScreenshots: true,
      evidenceClass: 'host-docker',
      env: process.env,
    });
    assert.equal(runnerCalls, 1);
    assert.equal(storeCalls, 0);
  });
});

test('proof route executes only the selected synthetic deny outcome', async () => {
  let runnerDecision = null;
  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: true,
    hackathonProofRunner: async input => {
      runnerDecision = input.decision;
      return passedProof({ decision: 'deny', tokenIssued: false, exposedMessageCount: 0 });
    },
  }, async ({ base }) => {
    const { response: planResponse, plan } = await preparePlan(base);
    assert.equal(planResponse.status, 200);
    const response = await post(base, '/api/hackathon/proof', proofRequest(plan.planId, 'deny'));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.decision, 'deny');
    assert.equal(result.tokenIssued, false);
    assert.equal(result.exposedMessageCount, 0);
    assert.equal(runnerDecision, 'deny');
  });
});

test('unconfirmed worker cleanup fails closed and blocks later proof runs', async () => {
  let runnerCalls = 0;
  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: true,
    hackathonProofRunner: async () => {
      runnerCalls++;
      return passedProof({ containerTeardown: 'unconfirmed' });
    },
  }, async ({ base }) => {
    const { response: planResponse, plan } = await preparePlan(base);
    assert.equal(planResponse.status, 200);
    const request = proofRequest(plan.planId);
    const first = await post(base, '/api/hackathon/proof', request);
    assert.equal(first.status, 503);
    assert.equal((await first.json()).contractMet, false);

    const second = await post(base, '/api/hackathon/proof', request);
    assert.equal(second.status, 503);
    assert.equal((await second.json()).code, 'CONTAINER_CLEANUP_UNCONFIRMED');
    assert.equal(runnerCalls, 1);
  });
});

test('missing cleanup evidence is treated as unconfirmed and blocks later proof runs', async () => {
  let runnerCalls = 0;
  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: true,
    hackathonProofRunner: async () => {
      runnerCalls++;
      return passedProof({ containerTeardown: undefined });
    },
  }, async ({ base }) => {
    const { response: planResponse, plan } = await preparePlan(base);
    assert.equal(planResponse.status, 200);
    const request = proofRequest(plan.planId);
    const first = await post(base, '/api/hackathon/proof', request);
    assert.equal(first.status, 503);
    assert.equal((await first.json()).containerTeardown, 'unconfirmed');

    const second = await post(base, '/api/hackathon/proof', request);
    assert.equal(second.status, 503);
    assert.equal((await second.json()).code, 'CONTAINER_CLEANUP_UNCONFIRMED');
    assert.equal(runnerCalls, 1);
  });
});

test('locked controller mode refuses proof before invoking the worker', async () => {
  let runnerCalls = 0;
  let storeCalls = 0;
  const trainingSessionStore = {
    listScenarios() { storeCalls++; return []; },
    dispose() {},
  };
  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: false,
    trainingSessionStore,
    hackathonProofRunner: async () => { runnerCalls++; return passedProof(); },
  }, async ({ base }) => {
    const response = await post(base, '/api/hackathon/proof', { optIn: true, containerOptIn: true, inferenceAcknowledged: true });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'INFERENCE_GATE_CLOSED');

    const training = await fetch(`${base}/api/training/scenarios`, { headers: { origin: base } });
    assert.equal(training.status, 503);
    assert.equal(runnerCalls, 0);
    assert.equal(storeCalls, 0);
  });
});

test('controller run cap bounds public container and inference requests', async () => {
  let runnerCalls = 0;
  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: true,
    hackathonProofRunner: async () => {
      runnerCalls++;
      return passedProof();
    },
  }, async ({ base }) => {
    const { response: planResponse, plan } = await preparePlan(base);
    assert.equal(planResponse.status, 200);
    const request = proofRequest(plan.planId);
    for (let index = 0; index < 10; index++) {
      const response = await post(base, '/api/hackathon/proof', request);
      assert.equal(response.status, 200);
    }
    const capped = await post(base, '/api/hackathon/proof', request);
    assert.equal(capped.status, 429);
    assert.equal((await capped.json()).code, 'PROOF_RUN_LIMIT');
    assert.equal(runnerCalls, 10);
  });
});

test('controller proof serializes runs and returns no success until live inference evidence passes', async () => {
  let runnerCalls = 0;
  let enterRunner;
  let releaseRunner;
  const runnerEntered = new Promise(resolve => { enterRunner = resolve; });
  const runnerRelease = new Promise(resolve => { releaseRunner = resolve; });

  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: true,
    hackathonProofRunner: async () => {
      runnerCalls++;
      enterRunner();
      await runnerRelease;
      return passedProof({ vision: { status: 'not_run', provider: 'vultr-serverless-inference', providerCall: 'not_made', live: false, reason: 'approval_or_model_missing' } });
    },
  }, async ({ base }) => {
    const { response: planResponse, plan } = await preparePlan(base);
    assert.equal(planResponse.status, 200);
    const request = proofRequest(plan.planId);
    const firstPromise = post(base, '/api/hackathon/proof', request);
    await runnerEntered;

    const concurrent = await post(base, '/api/hackathon/proof', request);
    assert.equal(concurrent.status, 409);
    assert.equal((await concurrent.json()).containerTeardown, 'not_started');

    releaseRunner();
    const first = await firstPromise;
    assert.equal(first.status, 503);
    const result = await first.json();
    assert.equal(result.contractMet, false);
    assert.equal(result.vision.status, 'not_run');
    assert.equal(runnerCalls, 1);
  });
});

test('public proof route requires the configured HTTPS origin and matching Host', async () => {
  let runnerCalls = 0;
  await withServer({
    hackathonControllerMode: true,
    hackathonProofEnabled: true,
    publicOrigin: 'https://demo.example',
    hackathonProofRunner: async () => {
      runnerCalls++;
      return passedProof();
    },
  }, async ({ base }) => {
    const { response: planResponse, plan } = await preparePlan(base);
    assert.equal(planResponse.status, 200);
    const request = proofRequest(plan.planId);
    const denied = await postWithHost(base, 'demo.example', 'https://attacker.example', request);
    assert.equal(denied.status, 403);
    assert.equal(runnerCalls, 0);

    const acceptedOriginButWrongHost = await postWithHost(base, 'attacker.example', 'https://demo.example', request);
    assert.equal(acceptedOriginButWrongHost.status, 403);
    assert.equal(runnerCalls, 0);

    const trustedOrigin = await postWithHost(base, 'demo.example', 'https://demo.example', request);
    assert.equal(trustedOrigin.status, 200);
    assert.equal(runnerCalls, 1);
  });
});
