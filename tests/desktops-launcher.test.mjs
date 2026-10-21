import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeBuildId, demoUrls, findListener, isProjectProcess, planLaunch, probeHealth, probeSignature, readPorts,
  smokeCheck, startServers, ROOT,
} from '../tools/start-desktops.mjs';

const ports = { appPort: 4173, shellsPort: 4189 };
const relativeServer = { pid: 101, name: 'node.exe', commandLine: '"C:\\Program Files\\nodejs\\node.exe" server.mjs', signature: true };

test('planLaunch starts when both ports are free', () => {
  assert.equal(planLaunch({ ...ports, app: null, shells: null, health: null, currentBuildId: 'a' }).action, 'start');
});

test('planLaunch refuses foreign listeners and names PID and command', () => {
  for (const owner of [
    { pid: 7, name: 'python.exe', commandLine: 'python -m http.server 4173', signature: true },
    { pid: 7, name: 'node.exe', commandLine: 'node other-app.js', signature: true },
    { ...relativeServer, pid: 7, signature: false },
    { pid: 7, name: 'node.exe', commandLine: '', signature: true },
  ]) {
    const plan = planLaunch({ ...ports, app: owner, shells: null, health: null, currentBuildId: 'a' });
    assert.equal(plan.action, 'refuse');
    assert.deepEqual(plan.stop, []);
    assert.match(plan.reason, /port 4173 is held by PID 7/);
    assert.ok(plan.reason.includes(owner.commandLine || 'command line unavailable'));
  }
  const mixed = planLaunch({ ...ports, app: relativeServer, shells: { pid: 8, name: 'nginx.exe', commandLine: 'nginx' }, health: null, currentBuildId: 'a' });
  assert.equal(mixed.action, 'refuse');
  assert.deepEqual(mixed.stop, [], 'a foreign listener on one port blocks stopping the project server on the other');
});

test('planLaunch restarts a project server with no /api/health or a different buildId', () => {
  const noHealth = planLaunch({ ...ports, app: relativeServer, shells: relativeServer, health: null, currentBuildId: 'a' });
  assert.equal(noHealth.action, 'restart');
  assert.deepEqual(noHealth.stop, [101]);
  assert.match(noHealth.reason, /no \/api\/health buildId/);
  const stale = planLaunch({ ...ports, app: relativeServer, shells: relativeServer, health: { ok: true, buildId: 'old' }, currentBuildId: 'new' });
  assert.equal(stale.action, 'restart');
  assert.match(stale.reason, /build old.*build new/);
  const split = planLaunch({ ...ports, app: relativeServer, shells: { ...relativeServer, pid: 102, commandLine: 'node desktop-comparison/server.mjs' }, health: { buildId: 'a' }, currentBuildId: 'a' });
  assert.deepEqual([split.action, split.stop], ['restart', [101, 102]]);
  const half = planLaunch({ ...ports, app: null, shells: relativeServer, health: null, currentBuildId: 'a' });
  assert.deepEqual([half.action, half.stop], ['restart', [101]]);
});

test('planLaunch reuses a current project server', () => {
  const plan = planLaunch({ ...ports, app: relativeServer, shells: relativeServer, health: { ok: true, buildId: 'a' }, currentBuildId: 'a' });
  assert.deepEqual([plan.action, plan.stop], ['reuse', []]);
});

test('isProjectProcess accepts the project path without a signature and rejects lookalikes', () => {
  const absolute = { pid: 1, name: 'node', commandLine: `node ${join(ROOT, 'tools', 'start-desktops.mjs')}` };
  assert.equal(isProjectProcess(absolute), true);
  assert.equal(isProjectProcess({ ...absolute, name: 'cmd.exe' }), false);
  assert.equal(isProjectProcess({ ...absolute, commandLine: 'node C:/elsewhere/server.mjs.bak' }), false);
  assert.equal(isProjectProcess({ ...relativeServer, signature: undefined }), false);
  assert.equal(isProjectProcess(relativeServer), true);
});

test('readPorts defaults to 4173/4189 and validates overrides', () => {
  assert.deepEqual(readPorts({}), { appPort: 4173, shellsPort: 4189 });
  assert.deepEqual(readPorts({ PORT: '4401', SHELLS_PORT: '4402' }), { appPort: 4401, shellsPort: 4402 });
  assert.throws(() => readPorts({ PORT: '80' }), /PORT must be/);
  assert.throws(() => readPorts({ SHELLS_PORT: 'x' }), /SHELLS_PORT must be/);
  assert.throws(() => readPorts({ PORT: '4500', SHELLS_PORT: '4500' }), /must differ/);
});

test('computeBuildId is stable and changes when a shell build adds a file', () => {
  const root = mkdtempSync(join(tmpdir(), 'build-id-'));
  try {
    mkdirSync(join(root, 'desktop-comparison/previews/win11-final/assets'), { recursive: true });
    writeFileSync(join(root, 'server.mjs'), 'server');
    writeFileSync(join(root, 'desktop-comparison/previews/win11-final/index.html'), '<html>');
    const before = computeBuildId(root);
    assert.match(before, /^[0-9a-f]{16}$/);
    assert.equal(computeBuildId(root), before);
    writeFileSync(join(root, 'desktop-comparison/previews/win11-final/assets/c.js'), 'new chunk');
    assert.notEqual(computeBuildId(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const listen = handler => new Promise(done => {
  const server = createServer(handler).listen(0, '127.0.0.1', () => done(server));
});
const origin = server => `http://127.0.0.1:${server.address().port}`;
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };

test('probes recognise a stale project server and a foreign one (mock listeners)', async () => {
  const stale = await listen((request, response) => request.url === '/api/healthz'
    ? json(response, 200, { ok: true, mode: 'local-synthetic', externalNetwork: false })
    : request.url === '/previews/ocean-scenes.js' ? (response.writeHead(200), response.end('//')) : json(response, 404, { error: 'Not found.' }));
  const current = await listen((request, response) => json(response, 200, { ok: true, mode: 'local-synthetic', externalNetwork: false, buildId: 'abc' }));
  const foreign = await listen((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<html>other</html>'); });
  try {
    assert.equal(await probeSignature(origin(stale), 'app'), true);
    assert.equal(await probeSignature(origin(stale), 'shells'), true);
    assert.equal(await probeHealth(origin(stale)), null);
    assert.equal((await probeHealth(origin(current))).buildId, 'abc');
    assert.equal(await probeSignature(origin(foreign), 'app'), false);
    assert.equal(await probeSignature('http://127.0.0.1:1', 'app'), false);
  } finally {
    for (const server of [stale, current, foreign]) server.close();
  }
});

test('findListener reports this node process for a real listener and null for a closed port', async () => {
  const server = await listen((request, response) => response.end());
  const { port } = server.address();
  try {
    const owner = await findListener(port);
    assert.equal(owner.pid, process.pid);
    assert.match(owner.name, /^node(\.exe)?$/i);
  } finally {
    await new Promise(done => server.close(done));
  }
  assert.equal(await findListener(port), null);
});

test('smokeCheck lists every failure from a server that 404s the new shells', async () => {
  const stale = await listen((request, response) => json(response, 404, { error: 'Not found.' }));
  try {
    await assert.rejects(smokeCheck(origin(stale), origin(stale)), error => {
      for (const label of ['Windows shell', 'macOS shell', 'World', 'Flagship world', 'Shell origin']) assert.match(error.message, new RegExp(`${label}: HTTP 404`));
      return true;
    });
  } finally {
    stale.close();
  }
});

test('startServers on non-default ports passes the smoke check, frames the shells and is reused as current', async () => {
  const free = async () => { const server = await listen(() => {}); const { port } = server.address(); await new Promise(done => server.close(done)); return port; };
  const appPort = await free();
  const shellsPort = await free();
  const servers = await startServers({ appPort, shellsPort });
  try {
    await smokeCheck(servers.appOrigin, servers.shellsOrigin);
    const shell = await fetch(demoUrls(servers.appOrigin, servers.shellsOrigin).windows);
    await shell.arrayBuffer();
    assert.match(shell.headers.get('content-security-policy'), new RegExp(`frame-ancestors 'self' ${servers.appOrigin}`));
    const health = await probeHealth(servers.appOrigin);
    assert.equal(health.buildId, computeBuildId(), 'server /api/health and launcher hash the same files the same way');
    // Real PID and image of this process; the command line is the launcher's, since this one is `node --test`.
    const [app, shells] = (await Promise.all([findListener(appPort), findListener(shellsPort)]))
      .map(owner => ({ ...owner, commandLine: 'node tools\\start-desktops.mjs' }));
    assert.equal(app.pid, shells.pid);
    app.signature = await probeSignature(servers.appOrigin, 'app');
    shells.signature = await probeSignature(servers.shellsOrigin, 'shells');
    assert.equal(planLaunch({ appPort, shellsPort, app, shells, health, currentBuildId: computeBuildId() }).action, 'reuse');
  } finally {
    await servers.stop();
  }
});
