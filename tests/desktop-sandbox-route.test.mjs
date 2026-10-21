import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { loadScenarioKinds } from '../backend/sandbox/scenarios.mjs';

const M = createRequire(import.meta.url)('../ui/desktop/world-model.js');
const root = fileURLToPath(new URL('..', import.meta.url));
const seed = JSON.parse(readFileSync(new URL('../data/desktop-world-seed.json', import.meta.url), 'utf8'));
const { kinds } = loadScenarioKinds(root);
const [SCENARIO_ID, ATTACK_KIND] = Object.entries(kinds)[0] ?? [];

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
const stop = async server => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); };
const post = (base, run, body, headers = {}) => fetch(`${base}/api/desktop/sandbox/run?run=${run}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

// A runner that records its call and finishes when released.
function gatedRunner() {
  const calls = [];
  const releases = [];
  const runner = args => new Promise(resolve => { calls.push(args); releases.push(() => resolve({ ok: true })); });
  return { runner, calls, release: () => releases.splice(0).forEach(release => release()) };
}

// Reads the run's event stream until `done(sandbox)` holds for a patch; returns every sandbox patch seen.
async function collectSandbox(base, run, done, timeoutMs = 20000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const patches = [];
  try {
    const response = await fetch(`${base}/api/desktop/events?run=${run}`, { signal: abort.signal });
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop();
      for (const frame of frames) {
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        const event = data ? JSON.parse(data.slice(6)) : null;
        if (event?.type === 'patch' && event.patch.sandbox) {
          patches.push(event.patch.sandbox);
          if (done(event.patch.sandbox)) return patches;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  return patches;
}

test('the scenario data gives the tests a real scenario and attack kind', () => {
  assert.ok(SCENARIO_ID && ATTACK_KIND, 'at least one authored scenario with an attack kind');
});

test('the sandbox run route is POST-only, takes exactly {scenarioId}, and refuses bad runs and unknown scenarios', async () => {
  const { runner, calls } = gatedRunner();
  const server = createAppServer({ sandboxRunner: runner });
  const base = await listen(server);
  try {
    const get = await fetch(`${base}/api/desktop/sandbox/run?run=demo-1`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    await get.arrayBuffer();
    for (const run of ['', 'Bad_Run', 'a'.repeat(41)]) {
      assert.equal((await post(base, run, { scenarioId: SCENARIO_ID })).status, 400, `run ${run}`);
    }
    assert.equal((await post(base, 'demo-1', '{nope')).status, 400);
    assert.equal((await post(base, 'demo-1', { scenarioId: SCENARIO_ID, mode: 'vultr' })).status, 400, 'the mode is never a request field');
    assert.equal((await post(base, 'demo-1', {})).status, 400);
    assert.equal((await post(base, 'demo-1', { scenarioId: 'Not An Id' })).status, 400);
    const unknown = await post(base, 'demo-1', { scenarioId: 'deception-sunlight' });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).code, 'UNKNOWN_SCENARIO');
    const wrongType = await fetch(`${base}/api/desktop/sandbox/run?run=demo-1`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(wrongType.status, 415);
    await wrongType.arrayBuffer();
    assert.equal(calls.length, 0, 'no refused request started a run');
  } finally {
    await stop(server);
  }
});

test('the sandbox run route is loopback and local-origin only', async () => {
  const { runner, calls } = gatedRunner();
  const server = createAppServer({ sandboxRunner: runner });
  const base = await listen(server);
  try {
    const foreignOrigin = await post(base, 'demo-1', { scenarioId: SCENARIO_ID }, { Origin: 'https://evil.example' });
    assert.equal(foreignOrigin.status, 403);
    assert.equal((await foreignOrigin.json()).code, 'LOCAL_ORIGIN_REQUIRED');
    const foreignHost = await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/desktop/sandbox/run?run=demo-1',
        headers: { Host: 'sandbox.example', 'Content-Type': 'application/json' },
      }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      req.on('error', reject);
      req.end(JSON.stringify({ scenarioId: SCENARIO_ID }));
    });
    assert.equal(foreignHost, 403);
    assert.equal(calls.length, 0);
    const local = await post(base, 'demo-1', { scenarioId: SCENARIO_ID }, { Origin: base });
    assert.equal(local.status, 202);
    await local.arrayBuffer();
  } finally {
    await stop(server);
  }
});

test('a run answers 202 at once with the server-side attack kind and mode, then the runner gets the server base URL', async () => {
  const { runner, calls, release } = gatedRunner();
  const server = createAppServer({ sandboxRunner: runner, desktopEventsToken: 'fictional-token-0123456789' });
  const base = await listen(server);
  try {
    const response = await post(base, 'demo-1', { scenarioId: SCENARIO_ID });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, runId: 'demo-1', scenarioId: SCENARIO_ID, attackKind: ATTACK_KIND, mode: 'simulated' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.deepEqual(
      { scenarioId: calls[0].scenarioId, attackKind: calls[0].attackKind, runId: calls[0].runId, mode: calls[0].mode, baseUrl: calls[0].baseUrl, token: calls[0].token },
      { scenarioId: SCENARIO_ID, attackKind: ATTACK_KIND, runId: 'demo-1', mode: 'simulated', baseUrl: base, token: 'fictional-token-0123456789' },
    );
    release();
    await server.sandboxRunsIdle();
  } finally {
    await stop(server);
  }
});

test('one active run per run id: a second start is 409 until the first ends; other runs go on, up to the cap', async () => {
  const { runner, calls, release } = gatedRunner();
  const server = createAppServer({ sandboxRunner: runner });
  const base = await listen(server);
  try {
    assert.equal((await post(base, 'run-a', { scenarioId: SCENARIO_ID })).status, 202);
    const busy = await post(base, 'run-a', { scenarioId: SCENARIO_ID });
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).code, 'SANDBOX_BUSY');
    for (const run of ['run-b', 'run-c', 'run-d']) assert.equal((await post(base, run, { scenarioId: SCENARIO_ID })).status, 202, run);
    const full = await post(base, 'run-e', { scenarioId: SCENARIO_ID });
    assert.equal(full.status, 429);
    assert.equal((await full.json()).code, 'SANDBOX_LIMIT');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 4);
    release();
    await server.sandboxRunsIdle();
    assert.equal((await post(base, 'run-a', { scenarioId: SCENARIO_ID })).status, 202, 'the run id is free again once the run ended');
    release();
    await new Promise(resolve => setImmediate(resolve));
    release();
    await server.sandboxRunsIdle();
  } finally {
    await stop(server);
  }
});

test('a runner that throws frees the run id and never crashes the server', async () => {
  let calls = 0;
  const server = createAppServer({ sandboxRunner: async () => { calls++; throw new Error('boom'); } });
  const base = await listen(server);
  try {
    assert.equal((await post(base, 'demo-1', { scenarioId: SCENARIO_ID })).status, 202);
    await server.sandboxRunsIdle();
    assert.equal((await post(base, 'demo-1', { scenarioId: SCENARIO_ID })).status, 202);
    await server.sandboxRunsIdle();
    assert.equal(calls, 2);
  } finally {
    await stop(server);
  }
});

test('DESKTOP_SANDBOX_MODE: simulated is the default, an unknown mode fails at start-up, vultr needs every gate', async () => {
  assert.throws(() => createAppServer({ desktopSandboxMode: 'cloud' }), /DESKTOP_SANDBOX_MODE must be one of/);
  const { runner, calls } = gatedRunner();
  const closed = createAppServer({ desktopSandboxMode: 'vultr', sandboxRunner: runner, sandboxEnv: {} });
  const closedBase = await listen(closed);
  try {
    const refused = await post(closedBase, 'demo-1', { scenarioId: SCENARIO_ID });
    assert.equal(refused.status, 503);
    assert.equal((await refused.json()).code, 'SANDBOX_GATE_CLOSED');
    assert.equal(calls.length, 0, 'the Vultr gates are checked before any run starts');
  } finally {
    await stop(closed);
  }
  const docker = createAppServer({ desktopSandboxMode: 'docker', sandboxRunner: runner });
  const dockerBase = await listen(docker);
  try {
    const response = await post(dockerBase, 'demo-1', { scenarioId: SCENARIO_ID });
    assert.equal((await response.json()).mode, 'docker');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[0].mode, 'docker');
  } finally {
    await stop(docker);
  }
});

test('a simulated run reaches world.sandbox through the events stream: done, then destroyed with a confirmed receipt', async () => {
  const server = createAppServer();
  const base = await listen(server);
  try {
    const streaming = collectSandbox(base, 'live-1', sandbox => sandbox.status === 'destroyed' || sandbox.status === 'failed');
    await new Promise(resolve => setTimeout(resolve, 100));
    const response = await post(base, 'live-1', { scenarioId: SCENARIO_ID });
    assert.equal(response.status, 202);
    const patches = await streaming;
    await server.sandboxRunsIdle();
    const statuses = patches.map(sandbox => sandbox.status);
    assert.equal(statuses[0], 'provisioning');
    assert.ok(statuses.includes('running') && statuses.includes('done'), statuses.join(' > '));
    assert.ok(statuses.indexOf('done') < statuses.indexOf('destroyed'));
    const last = patches.at(-1);
    assert.equal(last.status, 'destroyed');
    assert.equal(last.mode, 'simulated');
    assert.equal(last.attackKind, ATTACK_KIND);
    assert.deepEqual(last.events.map(event => event.kind).filter(kind => kind === 'provisioned' || kind === 'summary' || kind === 'destroyed'), ['provisioned', 'summary', 'destroyed']);
    assert.equal(last.receipt.teardownConfirmed, true);
    assert.deepEqual([last.receipt.egress, last.receipt.dataset, last.receipt.provider], ['none', 'synthetic', 'simulated']);
    // The patches merge into a valid world, exactly as the parent applies them.
    assert.equal(M.createWorld(seed, { sandbox: last }).sandbox.receipt.teardownConfirmed, true);
  } finally {
    await stop(server);
  }
});
