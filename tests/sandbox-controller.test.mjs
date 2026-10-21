import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { VULTR_APPROVAL_PHRASE } from '../backend/vultr-adapter.mjs';
import {
  buildDockerRunArgs, parseRunnerLine, runScenario, verifyContainerIsolation, vultrGateReport,
} from '../backend/sandbox/controller.mjs';
import { ATTACK_KINDS, runAttackKind } from '../backend/sandbox/kinds.mjs';
import { loadScenarioKinds, selectionIds } from '../backend/sandbox/scenarios.mjs';

const M = createRequire(import.meta.url)('../ui/desktop/world-model.js');
const root = fileURLToPath(new URL('..', import.meta.url));
const seed = JSON.parse(readFileSync(new URL('../data/desktop-world-seed.json', import.meta.url), 'utf8'));

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
const stop = async server => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); };

// A scripted docker CLI: records calls, plays the runner's lines and answers inspect/rm/ps like a real daemon.
function fakeDocker({ inspect, failRm = false } = {}) {
  const calls = [];
  let exists = false;
  let containerName = '';
  const docker = async (args, { onLine } = {}) => {
    calls.push(args);
    if (args[0] === 'image') return { code: 0, stdout: 'sha256:abc', stderr: '' };
    if (args[0] === 'run') {
      exists = true;
      const name = args[args.indexOf('--name') + 1];
      const kind = args.find(arg => arg.startsWith('SANDBOX_KIND=')).slice(13);
      const dir = mkdtempSync(join(tmpdir(), 'brz-fake-'));
      try {
        const { evidence } = runAttackKind(kind, { dir, onEvent: event => onLine(JSON.stringify(event)) });
        onLine(JSON.stringify({ evidence: { ...evidence, kind, interfaces: ['lo'], nonLoopbackInterfaces: 0 } }));
      } finally { rmSync(dir, { recursive: true, force: true }); }
      containerName = name;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      return exists ? { code: 0, stdout: JSON.stringify([inspect(containerName)]), stderr: '' } : { code: 1, stdout: '', stderr: 'No such container' };
    }
    if (args[0] === 'rm') { if (!failRm) exists = false; return { code: failRm ? 1 : 0, stdout: '', stderr: '' }; }
    if (args[0] === 'ps') return { code: 0, stdout: exists ? 'abc123\n' : '', stderr: '' };
    throw new Error(`unexpected docker call ${args.join(' ')}`);
  };
  docker.calls = calls;
  return docker;
}
const goodInspect = name => ({
  Id: 'f'.repeat(64), Name: `/${name}`, Image: 'sha256:img', State: { ExitCode: 0 }, Config: { User: '10001:10001' },
  HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], Memory: 134217728, PidsLimit: 32, NanoCpus: 500000000 },
  NetworkSettings: { Networks: { none: {} } },
});

test('docker args isolate the runner: no network, read-only root, tmpfs workdir, no caps, non-root, limits', () => {
  const args = buildDockerRunArgs({ name: 'brz-sandbox-r1', image: 'img:1', runId: 'r1', attackKind: 'scareware', seed: 's' });
  const pair = flag => args[args.indexOf(flag) + 1];
  assert.equal(pair('--network'), 'none');
  assert.ok(args.includes('--read-only'));
  assert.match(pair('--tmpfs'), /^\/work:rw,nosuid,nodev,noexec,size=\d+m$/);
  assert.equal(pair('--cap-drop'), 'ALL');
  assert.equal(pair('--security-opt'), 'no-new-privileges:true');
  assert.equal(pair('--user'), '10001:10001');
  assert.equal(pair('--pull'), 'never');
  for (const flag of ['--memory', '--memory-swap', '--pids-limit', '--cpus']) assert.ok(pair(flag));
  assert.equal(args.at(-1), 'img:1');
  assert.ok(!args.includes('--privileged') && !args.includes('-v') && !args.includes('--volume') && !args.includes('--publish') && !args.includes('-p'));
});

test('runner lines: events and evidence parse, anything else is refused', () => {
  assert.deepEqual(parseRunnerLine('{"seq":1,"kind":"mail-sent","label":"x","count":1,"total":2}').event.count, 1);
  assert.ok(parseRunnerLine('{"evidence":{"artifacts":3}}').evidence);
  for (const bad of ['nope', '{"seq":1,"kind":"Bad Kind","label":"x"}', '{"seq":1,"kind":"ok","label":"x","extra":1}', '{"seq":-1,"kind":"ok","label":"x"}',
    `{"seq":1,"kind":"ok","label":"${'x'.repeat(121)}"}`, '{"seq":1,"kind":"ok","label":"x","count":1.5}', '[]']) {
    assert.throws(() => parseRunnerLine(bad), /Runner printed/, bad);
  }
});

test('isolation check rejects a container that has a network, writable root or leftover caps', () => {
  const ok = JSON.stringify([goodInspect('c')]);
  assert.equal(verifyContainerIsolation(ok, 'c').networkMode, 'none');
  for (const [change, label] of [
    [c => { c.HostConfig.NetworkMode = 'bridge'; c.NetworkSettings.Networks = { bridge: {} }; }, 'network-mode'],
    [c => { c.HostConfig.ReadonlyRootfs = false; }, 'read-only-root'],
    [c => { c.HostConfig.CapDrop = []; }, 'cap-drop'],
    [c => { c.Config.User = 'root'; }, 'user'],
    [c => { c.State.ExitCode = 1; }, 'exit-code'],
  ]) {
    const container = goodInspect('c');
    change(container);
    assert.throws(() => verifyContainerIsolation(JSON.stringify([container]), 'c'), new RegExp(label));
  }
});

test('docker mode: verified isolation, removal, inspect-gone and a confirmed receipt', async () => {
  const docker = fakeDocker({ inspect: goodInspect });
  const result = await runScenario({ scenarioId: 'mydoom-2004', attackKind: 'mass-mail-worm', runId: 'r-docker', mode: 'docker', docker });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.status, 'destroyed');
  assert.equal(result.receipt.teardownConfirmed, true);
  assert.equal(result.receipt.provider, 'docker');
  assert.equal(result.isolation.networkMode, 'none');
  assert.equal(result.events.at(-1).kind, 'destroyed');
  assert.deepEqual(docker.calls.map(call => call[0] === 'container' ? 'inspect' : call[0]), ['image', 'run', 'inspect', 'rm', 'inspect', 'ps']);
});

test('docker mode: a container that shows a network fails the run but is still removed', async () => {
  const docker = fakeDocker({ inspect: name => ({ ...goodInspect(name), HostConfig: { ...goodInspect(name).HostConfig, NetworkMode: 'bridge' } }) });
  const result = await runScenario({ scenarioId: 'x-1', attackKind: 'scareware', runId: 'r-bad', mode: 'docker', docker });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /isolation check failed/);
  assert.equal(result.receipt.teardownConfirmed, true);
});

test('docker mode: an unconfirmed removal is a failed run with teardownConfirmed false and no destroyed event', async () => {
  const docker = fakeDocker({ inspect: goodInspect, failRm: true });
  const result = await runScenario({ scenarioId: 'x-1', attackKind: 'scareware', runId: 'r-stuck', mode: 'docker', docker });
  assert.equal(result.ok, false);
  assert.equal(result.receipt.teardownConfirmed, false);
  assert.equal(result.receipt.destroyedAt, null);
  assert.ok(!result.events.some(event => event.kind === 'destroyed'));
});

test('invalid arguments throw before anything starts', async () => {
  const base = { scenarioId: 'a', attackKind: 'scareware', runId: 'r', mode: 'simulated' };
  await assert.rejects(runScenario({ ...base, attackKind: 'nope' }), /attackKind/);
  await assert.rejects(runScenario({ ...base, runId: 'Bad Run' }), /runId/);
  await assert.rejects(runScenario({ ...base, scenarioId: '' }), /scenarioId/);
  await assert.rejects(runScenario({ ...base, mode: 'cloud' }), /mode/);
});

test('simulated mode matches the docker event sequence and posts valid world.sandbox patches to a real server', async () => {
  const server = createAppServer();
  const base = await listen(server);
  try {
    const posted = [];
    const recordingFetch = (url, init) => { posted.push(JSON.parse(init.body)); return fetch(url, init); };
    const result = await runScenario({ scenarioId: 'mydoom-2004', attackKind: 'mass-mail-worm', runId: 'sim-e2e', mode: 'simulated', baseUrl: base, fetchImpl: recordingFetch });
    assert.equal(result.ok, true, JSON.stringify(result.publish));
    assert.equal(result.publish.failures.length, 0);
    assert.equal(result.publish.posted, posted.length);

    const states = posted.map(body => body.patch.sandbox);
    assert.equal(states[0].status, 'provisioning');
    assert.deepEqual(states[0].events, []);
    assert.ok(states.every(state => state.runId === 'sim-e2e' && state.scenario === 'mydoom-2004' && state.attackKind === 'mass-mail-worm' && state.mode === 'simulated'));
    assert.ok(states.every(state => state.events.length <= 64));
    assert.equal(states.at(-1).status, 'destroyed');
    assert.deepEqual(states.at(-1).receipt && Object.keys(states.at(-1).receipt).sort(), ['dataset', 'destroyedAt', 'egress', 'instance', 'provider', 'startedAt', 'teardownConfirmed']);
    assert.equal(states.at(-1).receipt.teardownConfirmed, true);
    assert.equal(states.at(-1).receipt.egress, 'none');
    assert.equal(states.at(-1).receipt.dataset, 'synthetic');
    assert.ok(states.some(state => state.status === 'running'));
    assert.ok(states.some(state => state.status === 'done'));
    for (const body of posted) {
      assert.deepEqual(Object.keys(body), ['type', 'patch']);
      const world = M.createWorld(seed, body.patch);
      assert.equal(M.validate(world).ok, true);
    }

    const kinds = states.at(-1).events.map(event => event.kind);
    assert.equal(kinds[0], 'provisioned');
    assert.equal(kinds.at(-2), 'summary');
    assert.equal(kinds.at(-1), 'destroyed');
    assert.equal(states.at(-1).events.filter(event => event.kind === 'mail-sent').length, 20);

    const docker = await runScenario({ scenarioId: 'mydoom-2004', attackKind: 'mass-mail-worm', runId: 'sim-e2e', mode: 'docker', docker: fakeDocker({ inspect: goodInspect }) });
    assert.deepEqual(docker.events.slice(0, -1), result.events.slice(0, -1), 'docker and simulated emit the same runner events');
  } finally {
    await stop(server);
  }
});

test('every attack kind passes the server patch validation in simulated mode', async () => {
  const server = createAppServer();
  const base = await listen(server);
  try {
    for (const kind of ATTACK_KINDS) {
      const result = await runScenario({ scenarioId: `kind-${kind}`, attackKind: kind, runId: `sim-${kind}`.slice(0, 40), mode: 'simulated', baseUrl: base });
      assert.equal(result.ok, true, `${kind}: ${result.error} ${result.publish.failures.join(' | ')}`);
    }
  } finally {
    await stop(server);
  }
});

test('a refused post (422) is reported in publish.failures and makes the run not ok', async () => {
  const fetchImpl = async () => new Response('{"error":"The patch is invalid: sandbox"}', { status: 422 });
  const result = await runScenario({ scenarioId: 'a', attackKind: 'scareware', runId: 'r-refused', mode: 'simulated', baseUrl: 'http://127.0.0.1:1', fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.publish.failures[0], /HTTP 422/);
  assert.equal(result.receipt.teardownConfirmed, true);
});

test('the events token goes out as a bearer header', async () => {
  let header;
  const fetchImpl = async (url, init) => { header = init.headers.Authorization; return new Response('{}', { status: 202 }); };
  await runScenario({ scenarioId: 'a', attackKind: 'scareware', runId: 'r-token', mode: 'simulated', baseUrl: 'http://127.0.0.1:1', token: 'fictional-token-0123456789', fetchImpl });
  assert.equal(header, 'Bearer fictional-token-0123456789');
});

test('vultr mode runs through the adapter, deletes the instance and reports the instance id', async () => {
  const calls = [];
  const sandbox = { id: 'inst-123', destroyed: false };
  const adapter = {
    async createSandbox({ runId }) { calls.push(['create', runId]); return sandbox; },
    async runSyntheticAttack(box, { attackKind }) {
      calls.push(['run', attackKind]);
      const dir = mkdtempSync(join(tmpdir(), 'brz-v-'));
      try { return runAttackKind(attackKind, { dir }); } finally { rmSync(dir, { recursive: true, force: true }); }
    },
    async destroySandbox(box) { calls.push(['destroy', box.id]); box.destroyed = true; },
  };
  const result = await runScenario({ scenarioId: 'mydoom-2004', attackKind: 'mass-mail-worm', runId: 'r-vultr', mode: 'vultr', vultr: { adapter, persona: {} } });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls.map(call => call[0]), ['create', 'run', 'destroy']);
  assert.equal(result.receipt.provider, 'vultr');
  assert.equal(result.receipt.instance, 'inst-123');
  assert.equal(result.receipt.teardownConfirmed, true);
});

test('vultr mode: unconfirmed deletion is reported, and missing gates stop before any call', async () => {
  const stuck = {
    async createSandbox() { return { id: 'inst-9' }; },
    async runSyntheticAttack() { throw new Error('guest unreachable'); },
    async destroySandbox() { throw new Error('Vultr teardown failed'); },
  };
  const failed = await runScenario({ scenarioId: 'a', attackKind: 'scareware', runId: 'r-v2', mode: 'vultr', vultr: { adapter: stuck, persona: {} } });
  assert.equal(failed.ok, false);
  assert.equal(failed.receipt.teardownConfirmed, false);
  assert.equal(failed.receipt.instance, 'inst-9');

  const gated = await runScenario({ scenarioId: 'a', attackKind: 'scareware', runId: 'r-v3', mode: 'vultr', env: {} });
  assert.equal(gated.ok, false);
  assert.match(gated.error, /Vultr gates are not satisfied\. Missing: VULTR_API_KEY/);
  assert.equal(gated.receipt.instance, 'vultr/not-created');
});

test('gate report lists missing names and never echoes values', () => {
  assert.equal(vultrGateReport({}).ready, false);
  assert.ok(vultrGateReport({}).missing.includes('VULTR_SANDBOX_APPROVAL'));
  const report = vultrGateReport({ VULTR_API_KEY: 'secret-value-123', VULTR_SANDBOX_MODE: 'vultr', VULTR_SANDBOX_APPROVAL: 'wrong phrase' });
  assert.ok(!JSON.stringify(report).includes('secret-value-123') && !JSON.stringify(report).includes('wrong phrase'));
  assert.ok(report.wrong.some(item => item.startsWith('VULTR_SANDBOX_APPROVAL')));
  const all = Object.fromEntries(vultrGateReport({}).missing.map(name => [name, 'x']));
  assert.equal(vultrGateReport({ ...all, VULTR_SANDBOX_MODE: 'vultr', VULTR_SANDBOX_APPROVAL: VULTR_APPROVAL_PHRASE }).ready, true);
});

test('scenario kinds are read from the content files; unknown kinds and missing files are reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brz-scn-'));
  try {
    const scenes = join(dir, 'desktop-comparison', 'previews', 'ocean-scenarios');
    mkdirSync(scenes, { recursive: true });
    writeFileSync(join(scenes, 'sunlight.js'), "(() => { const S = (globalThis.OceanScenarioData ||= {}); S['mydoom-2004'] = { attackKind: 'mass-mail-worm' }; S['odd-one'] = { attackKind: 'nope' }; })();");
    const { kinds, problems } = loadScenarioKinds(dir);
    assert.deepEqual(kinds, { 'mydoom-2004': 'mass-mail-worm' });
    assert.ok(problems.some(problem => problem.startsWith('odd-one:')));
    assert.ok(problems.includes('twilight.js is missing'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data/ocean-selection.json lists 60 scenario ids that fit the runId pattern', () => {
  const ids = selectionIds(root);
  assert.equal(ids.length, 60);
  assert.equal(new Set(ids).size, 60);
  assert.ok(ids.every(id => /^[a-z0-9-]{1,40}$/.test(id)));
});
