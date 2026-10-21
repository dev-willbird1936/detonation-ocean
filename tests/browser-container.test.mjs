import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  BrowserContainerError,
  DEFAULT_BROWSER_IMAGE,
  runBrowserOAuthInContainer,
} from '../backend/browser-container.mjs';

const personaId = 'persona-game-001';
const runId = '00000000-0000-4000-8000-000000000001';
const screenshotBytes = Buffer.from([
  'ffd8ffe000104a46494600010100000100010000ffdb004300281c1e231e19282321232d2b28303c',
  '64413c37373c7b585d4964918099968f808c8aa0b4e6c3a0aadaad8a8cc8ffcbdaeef5ffffff9bc1',
  'fffffffaffe6fdfff8ffdb0043012b2d2d3c353c76414176f8a58ca5f8f8f8f8f8f8f8f8f8f8f8f8',
  'f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8ffc0',
  '0011080002000203012200021101031101ffc4001500010100000000000000000000000000000005',
  'ffc40014100100000000000000000000000000000000ffc400140101000000000000000000000000',
  '00000000ffc40014110100000000000000000000000000000000ffda000c03010002110311003f00',
  '8a003fffd9',
].join(''), 'hex');
const screenshot = stage => ({
  stage,
  mimeType: 'image/jpeg',
  sha256: createHash('sha256').update(screenshotBytes).digest('hex'),
  base64: screenshotBytes.toString('base64'),
});

function runtimeResult(decision, viewport = { width: 1280, height: 900 }) {
  const allow = decision === 'allow';
  return {
    schemaVersion: 1,
    ok: true,
    decision,
    personaId,
    status: allow ? 'complete' : 'denied',
    browser: { name: 'chromium', version: 'test-version', viewport },
    network: { policy: 'docker-none-and-same-origin', blockedRequests: 0 },
    receipt: {
      decision,
      status: allow ? 'complete' : 'denied',
      tokenIssued: allow,
      exposedMessages: allow ? [{ id: 'msg-training-01', subject: 'Synthetic message' }] : [],
      exposedMessageCount: allow ? 1 : 0,
    },
    events: [{ type: 'receipt.created', details: { status: allow ? 'complete' : 'denied' } }],
    screenshots: ['desktop-before-optin', 'consent-ready', 'receipt'].map(screenshot),
  };
}

function successfulDocker(result) {
  const calls = [];
  const docker = async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === 'run') return { code: 0, stdout: JSON.stringify(result), stderr: '' };
    if (args[0] === 'rm') return { code: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected docker command: ${args[0]}`);
  };
  return { docker, calls };
}

test('Allow runs the bounded browser contract and validates screenshots, evidence and teardown', async () => {
  const { docker, calls } = successfulDocker(runtimeResult('allow'));
  const result = await runBrowserOAuthInContainer({ optIn: true, decision: 'allow', personaId }, { docker, runIdFactory: () => runId });
  const run = calls[0];

  assert.equal(result.executionMode, 'docker-browser-requested');
  assert.equal(result.containerTeardown, 'confirmed');
  assert.equal(result.receipt.tokenIssued, true);
  assert.equal(result.receipt.exposedMessageCount, 1);
  assert.equal(result.screenshots.length, 3);
  assert.equal(result.screenshots[2].stage, 'receipt');
  assert.deepEqual(JSON.parse(run.options.input), {
    schemaVersion: 1,
    optIn: true,
    decision: 'allow',
    personaId,
    viewport: { width: 1280, height: 900 },
  });
  assert.equal(run.options.timeoutMs, 90_000);
  assert.ok(run.args.includes('--rm'));
  assert.ok(run.args.includes('--pull') && run.args[run.args.indexOf('--pull') + 1] === 'never');
  assert.ok(run.args.includes('--network') && run.args[run.args.indexOf('--network') + 1] === 'none');
  assert.ok(run.args.includes('--read-only'));
  assert.ok(run.args.includes('--cap-drop') && run.args[run.args.indexOf('--cap-drop') + 1] === 'ALL');
  assert.ok(run.args.includes('--pids-limit') && run.args[run.args.indexOf('--pids-limit') + 1] === '64');
  assert.ok(!run.args.some(argument => argument === '--privileged' || argument === '--publish' || argument === '-p' || argument === '--mount' || argument === '-v'));
  assert.equal(run.args.at(-1), DEFAULT_BROWSER_IMAGE);
  assert.equal(calls[1].args[0], 'rm');
});

test('Deny confirms no token and no synthetic message access', async () => {
  const { docker } = successfulDocker(runtimeResult('deny', { width: 390, height: 844 }));
  const result = await runBrowserOAuthInContainer({
    optIn: true, decision: 'deny', personaId, viewport: { width: 390, height: 844 },
  }, { docker, runIdFactory: () => runId });

  assert.equal(result.receipt.status, 'denied');
  assert.equal(result.receipt.tokenIssued, false);
  assert.equal(result.receipt.exposedMessageCount, 0);
});

test('rejects credential-shaped or target-bearing inputs before Docker is called', async () => {
  let dockerCalls = 0;
  const docker = async () => { dockerCalls++; throw new Error('must not run'); };

  await assert.rejects(
    runBrowserOAuthInContainer({ decision: 'allow', personaId }, { docker }),
    error => error instanceof BrowserContainerError && error.code === 'explicit_opt_in_required',
  );
  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'allow', personaId, password: 'not-accepted' }, { docker }),
    error => error instanceof BrowserContainerError && error.code === 'unexpected_request_field',
  );
  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'allow', personaId, url: 'https://example.invalid' }, { docker }),
    error => error instanceof BrowserContainerError && error.code === 'unexpected_request_field',
  );
  assert.equal(dockerCalls, 0);
});

test('receipt mismatch fails closed and still attempts container removal', async () => {
  const incorrect = runtimeResult('allow');
  incorrect.receipt.tokenIssued = false;
  const { docker, calls } = successfulDocker(incorrect);

  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'allow', personaId }, { docker, runIdFactory: () => runId }),
    error => error instanceof BrowserContainerError && error.code === 'browser_receipt_mismatch' && error.containerTeardown === 'confirmed',
  );
  assert.equal(calls.at(-1).args[0], 'rm');
});

test('invalid screenshot evidence and unexpected browser requests fail closed', async () => {
  const invalidScreenshot = runtimeResult('deny');
  invalidScreenshot.screenshots[0].sha256 = '0'.repeat(64);
  const { docker, calls } = successfulDocker(invalidScreenshot);

  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'deny', personaId }, { docker, runIdFactory: () => runId }),
    error => error instanceof BrowserContainerError && error.code === 'invalid_browser_screenshots' && error.containerTeardown === 'confirmed',
  );
  assert.equal(calls.at(-1).args[0], 'rm');

  const truncatedScreenshot = runtimeResult('deny');
  const truncatedBytes = screenshotBytes.subarray(0, -2);
  truncatedScreenshot.screenshots[0].base64 = truncatedBytes.toString('base64');
  truncatedScreenshot.screenshots[0].sha256 = createHash('sha256').update(truncatedBytes).digest('hex');
  const truncatedMock = successfulDocker(truncatedScreenshot);
  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'deny', personaId }, { docker: truncatedMock.docker, runIdFactory: () => runId }),
    error => error instanceof BrowserContainerError && error.code === 'invalid_browser_screenshots' && error.containerTeardown === 'confirmed',
  );

  const networkResult = runtimeResult('deny');
  networkResult.network.blockedRequests = 1;
  const networkMock = successfulDocker(networkResult);
  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'deny', personaId }, { docker: networkMock.docker, runIdFactory: () => runId }),
    error => error instanceof BrowserContainerError && error.code === 'browser_network_policy_failed' && error.containerTeardown === 'confirmed',
  );
});

test('failed startup verifies absence and reports confirmed cleanup', async () => {
  const calls = [];
  const docker = async args => {
    calls.push(args);
    if (args[0] === 'run') return { code: 125, stdout: '', stderr: 'daemon unavailable' };
    if (args[0] === 'rm') return { code: 1, stdout: '', stderr: 'container not found' };
    if (args[0] === 'ps') return { code: 0, stdout: '', stderr: '' };
    throw new Error('unexpected command');
  };

  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'deny', personaId }, { docker, runIdFactory: () => runId }),
    error => error instanceof BrowserContainerError && error.code === 'docker_run_failed' && error.containerTeardown === 'confirmed',
  );
  assert.deepEqual(calls.map(args => args[0]), ['run', 'rm', 'ps']);
});

test('unconfirmed removal is surfaced as a failed run', async () => {
  const docker = async args => {
    if (args[0] === 'run') return { code: 0, stdout: JSON.stringify(runtimeResult('deny')), stderr: '' };
    if (args[0] === 'rm') return { code: 1, stdout: '', stderr: 'daemon unavailable' };
    if (args[0] === 'ps') return { code: 0, stdout: 'container-id\n', stderr: '' };
    throw new Error('unexpected command');
  };

  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'deny', personaId }, { docker, runIdFactory: () => runId }),
    error => error instanceof BrowserContainerError && error.code === 'container_teardown_unconfirmed' && error.containerTeardown === 'unconfirmed',
  );
});

test('runner timeout still invokes cleanup and preserves its failure status', async () => {
  const calls = [];
  const docker = async args => {
    calls.push(args);
    if (args[0] === 'run') throw new BrowserContainerError('docker_command_timeout');
    if (args[0] === 'rm') return { code: 0, stdout: '', stderr: '' };
    throw new Error('unexpected command');
  };

  await assert.rejects(
    runBrowserOAuthInContainer({ optIn: true, decision: 'deny', personaId }, { docker, runIdFactory: () => runId }),
    error => error instanceof BrowserContainerError && error.code === 'docker_command_timeout' && error.containerTeardown === 'confirmed',
  );
  assert.deepEqual(calls.map(args => args[0]), ['run', 'rm']);
});
