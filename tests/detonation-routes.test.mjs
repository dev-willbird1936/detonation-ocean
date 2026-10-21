import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobError, createJobController } from '../backend/detonation/jobs.mjs';
import { createAppServer } from '../server.mjs';
import { createDetonationRoutes, parseMultipartFile } from '../backend/detonation/routes.mjs';
import { DesktopEventHub } from '../backend/desktop-world-events.mjs';
import { answerContainerCall } from './fixtures/detonation/fake-container-calls.mjs';

const ORIGIN = 'https://ocean.example';
const SAMPLE = Buffer.from('#!/usr/bin/env python3\nprint("hello from the fake sample")\n');
const SAMPLE_NAME = 'invoice-private-name.py';
const ENV = { DETONATION_ENABLED: 'true', UPLOAD_ENCRYPTION_KEY: 'a1'.repeat(32) };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17)]);
const NO_MODEL = { available: () => false, complete: async () => { throw new Error('no model'); } };

function fakeDocker({ failRm = false } = {}) {
  const state = { containers: [], volumes: [], failRm };
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const docker = async args => {
    // The holder and seed containers are created for real by the controller; with rm forced to fail teardown cannot remove them.
    const answered = answerContainerCall(args, state);
    if (answered) return answered;
    const filter = args[args.indexOf('--filter') + 1];
    const matches = item => { const [, key, value] = /^label=([^=]+)(?:=(.*))?$/.exec(filter); return item.labels[key] !== undefined && (value === undefined || item.labels[key] === value); };
    if (args[0] === 'volume' && args[1] === 'create') { state.volumes.push({ name: args.at(-1), labels: { 'detonation-ocean.job': args[3].split('=')[1] } }); return ok(); }
    if (args[0] === 'ps') return ok(state.containers.filter(matches).map(c => `${c.id}\n`).join(''));
    if (args[0] === 'rm') {
      if (state.failRm) return { code: 1, stdout: '', stderr: 'removal in progress' };
      state.containers = state.containers.filter(c => c.id !== args.at(-1));
      return ok();
    }
    if (args[0] === 'volume' && args[1] === 'ls') return ok(state.volumes.filter(matches).map(v => `${v.name}\n`).join(''));
    if (args[0] === 'volume' && args[1] === 'rm') { state.volumes = state.volumes.filter(v => v.name !== args[2]); return ok(); }
    throw new Error(`unexpected docker call ${args.join(' ')}`);
  };
  docker.state = state;
  return docker;
}

const record = role => ({
  role, runtime: role === 'detonate' ? 'runsc-trace' : 'runsc', network: 'none', readOnlyRoot: true, capDrop: ['ALL'], user: '10001:10001',
  memoryBytes: 512 * 1024 * 1024, pidsLimit: 512, nanoCpus: 1_000_000_000, secretEnvVars: 0, createdAt: '2026-01-01T00:00:00.000Z', exit: { code: 0, reason: null },
});

const baseStages = {
  detonate: async () => ({ containers: [record('detonate')] }),
  parseTrace: async () => [{ source: 'trace', kind: 'file-read', path: '/home/dana/.aws/credentials', detail: 'read', at: '2026-01-01T00:00:02.000Z' }],
  collect: async () => ({ containers: [record('collect')], evidence: [] }),
  analyse: async ctx => ({ verdict: ctx.verdict, attempts: [{ n: 1, code: 'x', exitCode: 0, stderr: '' }], artifacts: { 'timeline.png': PNG, 'diff.csv': Buffer.from('a,b\n') }, scriptOk: true, modelAvailable: true, explanation: 'Fake.' }),
};

async function start({ dockerOptions, stages, maxUploadBytes, controllerOptions, routesOptions, env = ENV, begin = true } = {}) {
  const docker = fakeDocker(dockerOptions);
  const controller = createJobController({
    env, dataDir: mkdtempSync(join(tmpdir(), 'do-routes-')), docker, inference: NO_MODEL, logger() {}, stages: { ...baseStages, ...stages }, ...controllerOptions,
  });
  if (begin) await controller.start();
  const uploadDir = join(mkdtempSync(join(tmpdir(), 'do-routes-uploads-')), 'uploads');
  const routes = createDetonationRoutes({ env, controller, publicOrigin: ORIGIN, maxUploadBytes, uploadDir, ...routesOptions });
  const server = createServer(async (req, res) => {
    const handled = await routes.handle(req, res, new URL(req.url, 'http://127.0.0.1').pathname, { buildId: 'abcd1234abcd1234' });
    if (!handled) { res.writeHead(404); res.end('fallthrough'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const stop = async () => { routes.stop(); controller.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return { controller, docker, port, stop, uploadDir };
}

// node:http client: fetch hides some headers, and the 413 tests need an upload with no Content-Length.
function call(port, { method = 'GET', path, headers = {}, body, chunked = false }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...(body && !chunked ? { 'Content-Length': body.length } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    let answered = false;
    req.on('response', () => { answered = true; });
    req.on('error', error => { if (!answered) reject(error); });
    if (body) req.write(body);
    req.end();
  });
}

const multipart = (parts, boundary = 'XBOUNDARYX') => ({
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Origin: ORIGIN },
  body: Buffer.concat([
    ...parts.flatMap(({ name, filename, data }) => [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n\r\n`), Buffer.from(data), Buffer.from('\r\n')]),
    Buffer.from(`--${boundary}--\r\n`),
  ]),
});
const upload = (extra = {}) => multipart([{ name: 'file', filename: SAMPLE_NAME, data: SAMPLE }, { name: 'consent', data: 'true' }, ...(extra.parts ?? [])]);
const post = (port, form = upload(), headers = {}) => call(port, { method: 'POST', path: '/api/jobs', ...form, headers: { ...form.headers, ...headers } });
const json = response => JSON.parse(response.body.toString('utf8'));
const bearer = token => ({ Authorization: `Bearer ${token}` });
const sse = text => text.split('\n\n').filter(Boolean).map(block => Object.fromEntries(block.split('\n').map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(': ') + 2)])));

test('POST /api/jobs accepts a consented upload; GET /api/jobs/<id> needs the bearer token and returns the report', async () => {
  const { controller, port, stop } = await start();
  try {
    const created = await post(port);
    assert.equal(created.status, 202);
    const { jobId, token } = json(created);
    assert.match(jobId, /^j-[0-9a-f]{16}$/);
    assert.ok(token.length >= 43);
    assert.equal(created.headers['x-content-type-options'], 'nosniff');
    assert.equal(created.headers['referrer-policy'], 'no-referrer');
    assert.match(created.headers['content-security-policy'], /default-src 'none'.*frame-ancestors 'none'/);
    await controller.idle();

    const status = await call(port, { path: `/api/jobs/${jobId}`, headers: bearer(token) });
    assert.equal(status.status, 200);
    const body = json(status);
    assert.equal(body.state, 'done');
    assert.equal(body.report.verdict.depth, 'midnight');
    assert.equal(body.report.receipt.teardownConfirmed, true);
    assert.ok(!status.body.toString().includes(SAMPLE_NAME), 'the report never carries the file name');

    // 401: no token, wrong token, token of another job, unknown job.
    assert.equal((await call(port, { path: `/api/jobs/${jobId}` })).status, 401);
    assert.equal((await call(port, { path: `/api/jobs/${jobId}`, headers: bearer(`${token}x`) })).status, 401);
    assert.equal((await call(port, { path: `/api/jobs/${jobId}`, headers: { Authorization: token } })).status, 401);
    assert.equal((await call(port, { path: `/api/jobs/j-${'0'.repeat(16)}`, headers: bearer(token) })).status, 401);
  } finally { await stop(); }
});

test('400: no consent, consent not "true", no file, an empty file, a bad form', async () => {
  const { port, stop } = await start();
  try {
    const bad = async (response, pattern) => { assert.equal(response.status, 400); assert.match(json(response).error, pattern); };
    await bad(await post(port, multipart([{ name: 'file', filename: 'a.py', data: SAMPLE }])), /Consent/);
    await bad(await post(port, multipart([{ name: 'file', filename: 'a.py', data: SAMPLE }, { name: 'consent', data: 'false' }])), /Consent/);
    await bad(await post(port, multipart([{ name: 'consent', data: 'true' }])), /file/);
    await bad(await post(port, multipart([{ name: 'file', filename: 'a.py', data: '' }, { name: 'consent', data: 'true' }])), /file/);
    await bad(await post(port, { headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: Buffer.from('{}') }), /multipart/);
    await bad(await post(port, { headers: { 'Content-Type': 'multipart/form-data; boundary=XBOUNDARYX', Origin: ORIGIN }, body: Buffer.from('--XBOUNDARYX\r\ngarbage') }), /file/);
  } finally { await stop(); }
});

test('413: over the cap by Content-Length, while streaming without one, and a file over the cap inside the slack', async () => {
  const { port, controller, stop } = await start({ maxUploadBytes: 1024 });
  try {
    const big = multipart([{ name: 'file', filename: 'a.bin', data: Buffer.alloc(70 * 1024, 1) }, { name: 'consent', data: 'true' }]);
    assert.equal((await post(port, big)).status, 413);
    const streamed = await call(port, { method: 'POST', path: '/api/jobs', headers: big.headers, body: big.body, chunked: true });
    assert.equal(streamed.status, 413);
    assert.equal(streamed.headers.connection, 'close');
    const small = multipart([{ name: 'file', filename: 'a.bin', data: Buffer.alloc(2048, 1) }, { name: 'consent', data: 'true' }]);
    assert.equal((await post(port, small)).status, 413);
    assert.equal(controller.health().queueDepth, 0);
    assert.equal((await post(port, multipart([{ name: 'file', filename: 'a.bin', data: Buffer.alloc(1024, 1) }, { name: 'consent', data: 'true' }]))).status, 202);
    await controller.idle();
  } finally { await stop(); }
});

test('429 after three uploads from one IP in an hour; the address comes from the proxy header on a loopback peer', async () => {
  const { port, controller, stop } = await start();
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await post(port, upload(), { 'X-Forwarded-For': '198.51.100.9' })).status, 202);
    const limited = await post(port, upload(), { 'X-Forwarded-For': '198.51.100.9' });
    assert.equal(limited.status, 429);
    assert.match(json(limited).error, /Rate limit/);
    assert.equal((await post(port, upload(), { 'X-Forwarded-For': '198.51.100.10' })).status, 202);
    await controller.idle();
  } finally { await stop(); }
});

test('403: the Origin must match APP_PUBLIC_ORIGIN; a POST without Origin is refused, a GET without one is allowed', async () => {
  const { port, controller, stop } = await start();
  try {
    assert.equal((await post(port, upload(), { Origin: 'https://evil.example' })).status, 403);
    const { headers, body } = upload();
    const { Origin, ...noOrigin } = headers;
    assert.equal((await call(port, { method: 'POST', path: '/api/jobs', headers: noOrigin, body })).status, 403);
    assert.equal((await call(port, { path: '/api/ocean', headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call(port, { path: '/api/ocean' })).status, 200);
    assert.equal((await call(port, { path: '/api/ocean', headers: { Origin: ORIGIN } })).status, 200);
    assert.equal(controller.health().queueDepth, 0);
    const wrongMethod = await call(port, { method: 'GET', path: '/api/jobs', headers: { Origin: ORIGIN } });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');
  } finally { await stop(); }
});

test('503 when the feature is off, and AT-10: a failed teardown stops uploads', async () => {
  const off = await start({ env: { ...ENV, DETONATION_ENABLED: 'false' } });
  try {
    assert.equal((await post(off.port)).status, 503);
    assert.equal((await call(off.port, { path: '/api/health' })).body.toString(), 'fallthrough', 'health keeps its own route when the feature is off');
  } finally { await off.stop(); }

  const { port, controller, stop } = await start({ dockerOptions: { failRm: true } });
  try {
    const accepted = await post(port);
    assert.equal(accepted.status, 202);
    await controller.idle();
    const { jobId, token } = json(accepted);
    const failed = json(await call(port, { path: `/api/jobs/${jobId}`, headers: bearer(token) }));
    assert.equal(failed.state, 'failed');
    assert.equal(failed.report, undefined);
    const refused = await post(port);
    assert.equal(refused.status, 503);
    const health = json(await call(port, { path: '/api/health' }));
    assert.deepEqual(health, { ok: true, buildId: 'abcd1234abcd1234', acceptingJobs: false, queueDepth: 0 });
  } finally { await stop(); }
});

test('503 before the first reaper pass finishes', async () => {
  const { port, stop } = await start({ begin: false });
  try {
    assert.equal((await post(port)).status, 503);
  } finally { await stop(); }
});

test('GET /api/health adds acceptingJobs and queueDepth when detonation is on', async () => {
  const { port, stop } = await start();
  try {
    assert.deepEqual(json(await call(port, { path: '/api/health' })), { ok: true, buildId: 'abcd1234abcd1234', acceptingJobs: true, queueDepth: 0 });
  } finally { await stop(); }
});

test('events stream as SSE and replay from Last-Event-ID', async () => {
  const { port, controller, stop } = await start();
  try {
    const { jobId, token } = json(await post(port));
    await controller.idle();
    const path = `/api/jobs/${jobId}/events`;
    const full = await call(port, { path, headers: bearer(token) });
    assert.equal(full.status, 200);
    assert.match(full.headers['content-type'], /^text\/event-stream/);
    assert.equal(full.headers['x-content-type-options'], 'nosniff');
    const events = sse(full.body.toString());
    assert.deepEqual(events.map(item => Number(item.id)), events.map((_, i) => i + 1));
    assert.equal(events[0].event, 'stage');
    assert.equal(events.at(-1).event, 'report');
    assert.ok(events.some(item => item.event === 'finding' && JSON.parse(item.data).id === 'steal-credentials'));

    const resumed = sse((await call(port, { path, headers: { ...bearer(token), 'Last-Event-ID': '5' } })).body.toString());
    assert.deepEqual(resumed, events.slice(5));
    assert.deepEqual(sse((await call(port, { path, headers: { ...bearer(token), 'Last-Event-ID': String(events.length) } })).body.toString()), []);
    assert.equal((await call(port, { path })).status, 401);
    assert.ok(!full.body.toString().includes(SAMPLE_NAME));
  } finally { await stop(); }
});

test('a live stream receives events as they happen and ends with the job', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { port, controller, stop } = await start({ stages: { detonate: async () => { await gate; return { containers: [record('detonate')] }; } } });
  try {
    const { jobId, token } = json(await post(port));
    const pending = call(port, { path: `/api/jobs/${jobId}/events`, headers: bearer(token) });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(controller.getJob(jobId).state, 'detonating');
    release();
    const events = sse((await pending).body.toString());
    assert.deepEqual(events.slice(0, 3).map(item => item.event), ['stage', 'stage', 'typed']);
    assert.equal(events.at(-1).event, 'report');
  } finally { await stop(); }
});

test('artifacts: allowlisted analysis outputs only, safe headers, never the upload', async () => {
  const { port, controller, stop } = await start();
  try {
    const { jobId, token } = json(await post(port));
    await controller.idle();
    const get = name => call(port, { path: `/api/jobs/${jobId}/artifacts/${name}`, headers: bearer(token) });
    const png = await get('timeline.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.equal(png.headers['content-disposition'], 'inline');
    assert.equal(png.headers['x-content-type-options'], 'nosniff');
    assert.match(png.headers['content-security-policy'], /default-src 'none'.*sandbox/);
    assert.deepEqual(png.body, PNG);
    const csv = await get('diff.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-disposition'], /^attachment/);
    for (const name of ['sample.bin', 'upload.enc', 'missing.png', '..%2F..%2Fetc%2Fpasswd', '.hidden.png', 'timeline.exe']) assert.equal((await get(name)).status, 404, name);
    assert.equal((await call(port, { path: `/api/jobs/${jobId}/artifacts/timeline.png` })).status, 401);
  } finally { await stop(); }
});

test('AT-15: /api/ocean shows nothing of a single job before the batch, then counts only', async () => {
  const { port, controller, stop } = await start();
  try {
    const before = json(await call(port, { path: '/api/ocean' }));
    const { jobId } = json(await post(port));
    await controller.idle();
    assert.deepEqual(json(await call(port, { path: '/api/ocean' })), before);
    assert.deepEqual(before.schools, []);
    assert.deepEqual(before.creatures, []);
    controller.applyPending();
    const after = await call(port, { path: '/api/ocean' });
    assert.deepEqual(json(after).creatures, [{ findingId: 'steal-credentials', eaten: 1 }]);
    assert.ok(!after.body.toString().includes(jobId));
    assert.ok(!after.body.toString().includes(SAMPLE_NAME));
  } finally { await stop(); }
});

test('unrelated paths fall through to the caller', async () => {
  const { port, stop } = await start();
  try {
    for (const path of ['/api/jobs/not-an-id', '/api/ocean/profiles', '/api/jobs/j-0123456789abcdef/other']) assert.equal((await call(port, { path })).body.toString(), 'fallthrough', path);
  } finally { await stop(); }
});

test('parseMultipartFile reads fields and files from a file and rejects malformed bodies', async () => {
  const parse = async (body, boundary = 'XBOUNDARYX') => {
    const path = join(mkdtempSync(join(tmpdir(), 'do-multipart-')), 'body');
    writeFileSync(path, body);
    const handle = await open(path, 'r');
    try { return { parts: await parseMultipartFile(handle, body.length, boundary), body }; } finally { await handle.close(); }
  };
  const { body } = multipart([{ name: 'file', filename: 'a.bin', data: Buffer.from([0, 13, 10, 45, 45, 255]) }, { name: 'consent', data: 'true' }]);
  const { parts } = await parse(body);
  assert.deepEqual(parts.map(part => [part.name, part.filename]), [['file', 'a.bin'], ['consent', undefined]]);
  assert.deepEqual(body.subarray(parts[0].start, parts[0].end), Buffer.from([0, 13, 10, 45, 45, 255]));
  assert.equal(body.subarray(parts[1].start, parts[1].end).toString(), 'true');
  assert.equal((await parse(Buffer.from('nothing'))).parts?.length ?? 0, 0);
  assert.equal((await parse(Buffer.from('--XBOUNDARYX\r\nContent-Disposition: form-data; name="a"\r\n\r\nno end'))).parts, null);
  assert.equal((await parse(Buffer.from('--XBOUNDARYXjunk'))).parts, null);

  const makeParts = count => Array.from({ length: count }, (_, index) => ({ name: `field${index}`, data: `value${index}` }));
  for (const count of [7, 8]) {
    const form = multipart(makeParts(count));
    assert.equal((await parse(form.body)).parts?.length, count, `${count} parts including the closing delimiter`);
  }
  assert.equal((await parse(multipart(makeParts(9)).body)).parts, null, 'a ninth part exceeds the inclusive limit');
  const eight = multipart(makeParts(8)).body;
  const closing = Buffer.from('--XBOUNDARYX--\r\n');
  assert.equal((await parse(eight.subarray(0, eight.length - closing.length))).parts, null, 'eight parts still require a closing delimiter');
});

// An upload that sends its headers and a few body bytes, then stalls. The returned promise resolves with the reply, if any.
function stalledUpload(port, ip, { declared = 4096, sent = 16, headers = {} } = {}) {
  const req = httpRequest({
    host: '127.0.0.1', port, method: 'POST', path: '/api/jobs',
    headers: { 'Content-Type': 'multipart/form-data; boundary=XBOUNDARYX', Origin: ORIGIN, 'X-Forwarded-For': ip, 'Content-Length': declared, ...headers },
  });
  const reply = new Promise(resolve => {
    req.on('response', res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', () => resolve(null));
  });
  req.write(Buffer.alloc(sent, 0x2d));
  return { req, reply };
}

const stagedFiles = dir => { try { return readdirSync(dir); } catch { return []; } };
async function until(check, what) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('P1-1: a client that aborts mid-body leaves the server up, the slot free and no temp file behind', async () => {
  const { port, uploadDir, controller, stop } = await start();
  try {
    const { req, reply } = stalledUpload(port, '198.51.100.20');
    await until(() => stagedFiles(uploadDir).length === 1, 'the temp file');
    req.destroy();
    assert.equal(await reply, null);
    await until(() => stagedFiles(uploadDir).length === 0, 'the temp file to be removed');
    assert.equal((await post(port, upload(), { 'X-Forwarded-For': '198.51.100.20' })).status, 202);
    await controller.idle();
  } finally { await stop(); }
});

test('P1-1: a route that throws answers 500 and the server keeps serving', async t => {
  t.mock.method(console, 'error', () => {});
  const routes = createDetonationRoutes({ env: ENV, publicOrigin: ORIGIN, controller: { admit() { throw new Error('boom with a secret detail'); }, oceanView: () => ({ ok: true }) } });
  const server = createServer(async (req, res) => {
    if (!await routes.handle(req, res, new URL(req.url, 'http://127.0.0.1').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    for (let i = 0; i < 2; i += 1) {
      const failed = await post(port);
      assert.equal(failed.status, 500);
      assert.deepEqual(json(failed), { error: 'Something went wrong.' });
    }
    assert.equal((await call(port, { path: '/api/ocean' })).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('P1-1: the app server answers 500 when a detonation handler rejects', async t => {
  t.mock.method(console, 'error', () => {});
  const server = createAppServer({ detonation: { handle: async () => { throw new Error('boom'); }, stop() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const failed = await call(port, { path: '/api/ocean' });
    assert.equal(failed.status, 500);
    assert.deepEqual(json(failed), { error: 'Internal error.' });
    assert.equal((await call(port, { path: '/api/ocean' })).status, 500, 'still serving');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('P1-2: with four uploads in flight the fifth is refused before its body is read; one address gets one slot', async () => {
  const { port, uploadDir, controller, stop } = await start();
  try {
    const stalled = ['198.51.100.31', '198.51.100.32', '198.51.100.33', '198.51.100.34'].map(ip => stalledUpload(port, ip));
    await until(() => stagedFiles(uploadDir).length === 4, 'four temp files');
    // A refusal closes the connection without reading the body. The client declares 1 MiB but sends 16 bytes, so there is no unread
    // data in flight when the server closes: a full 1 MiB write could be answered with a socket reset (ECONNRESET) instead of the 503.
    const fifthUpload = stalledUpload(port, '198.51.100.35', { declared: 1024 * 1024 });
    const fifth = await fifthUpload.reply;
    fifthUpload.req.destroy();
    assert.equal(fifth?.status, 503);
    assert.equal(fifth.headers.connection, 'close');
    assert.equal(stagedFiles(uploadDir).length, 4, 'no temp file for the refused upload');
    for (const { req } of stalled) req.destroy();
    await Promise.all(stalled.map(({ reply }) => reply));
    await until(() => stagedFiles(uploadDir).length === 0, 'the temp files to be removed');

    const first = stalledUpload(port, '198.51.100.40');
    await until(() => stagedFiles(uploadDir).length === 1, 'the first temp file');
    const secondUpload = stalledUpload(port, '198.51.100.40');
    const second = await secondUpload.reply;
    secondUpload.req.destroy();
    assert.equal(second?.status, 429);
    assert.match(json(second).error, /upload in progress/);
    first.req.destroy();
    await first.reply;
    await until(() => stagedFiles(uploadDir).length === 0, 'the temp file to be removed');
    assert.equal((await post(port, upload(), { 'X-Forwarded-For': '198.51.100.40' })).status, 202);
    await controller.idle();
  } finally { await stop(); }
});

test('P1-2: a slow body hits the deadline with 408 and frees its slot and temp file', async () => {
  const { port, uploadDir, controller, stop } = await start({ routesOptions: { bodyDeadlineMs: 250 } });
  try {
    const began = Date.now();
    const { req, reply } = stalledUpload(port, '198.51.100.50');
    const answer = await reply;
    assert.equal(answer.status, 408);
    assert.equal(answer.headers.connection, 'close');
    assert.ok(Date.now() - began >= 240, 'not before the deadline');
    req.destroy();
    assert.deepEqual(stagedFiles(uploadDir), []);
    assert.equal((await post(port, upload(), { 'X-Forwarded-For': '198.51.100.50' })).status, 202);
    await controller.idle();
  } finally { await stop(); }
});

test('P1-2: the body is stored on disk under the cap and the temp file is gone after the reply', async () => {
  const { port, uploadDir, controller, stop } = await start({ maxUploadBytes: 1024 });
  try {
    const big = multipart([{ name: 'file', filename: 'a.bin', data: Buffer.alloc(70 * 1024, 1) }, { name: 'consent', data: 'true' }]);
    const streamed = await call(port, { method: 'POST', path: '/api/jobs', headers: big.headers, body: big.body, chunked: true });
    assert.equal(streamed.status, 413);
    assert.deepEqual(stagedFiles(uploadDir), []);
    assert.equal((await post(port, multipart([{ name: 'file', filename: 'a.bin', data: Buffer.alloc(1024, 1) }, { name: 'consent', data: 'true' }]))).status, 202);
    await controller.idle(); // the job deletes the temp file once it has sealed the upload
    assert.deepEqual(stagedFiles(uploadDir), []);
  } finally { await stop(); }
});

test('uploads reach the controller as a byte range of the temp file, never as a buffer; a refused submit deletes the temp file', async () => {
  const { port, uploadDir, controller, stop } = await start();
  try {
    const submit = controller.submit;
    const seen = [];
    controller.submit = args => { seen.push(args); return submit(args); };
    const accepted = await post(port);
    assert.equal(accepted.status, 202);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].file, undefined, 'no Buffer of the upload');
    assert.deepEqual([typeof seen[0].source.path, seen[0].source.end - seen[0].source.start], ['string', SAMPLE.length]);
    assert.equal(seen[0].claimedName, SAMPLE_NAME);
    await controller.idle();
    assert.deepEqual(stagedFiles(uploadDir), []);
    assert.equal(controller.getJob(json(accepted).jobId).state, 'done');

    controller.submit = () => { throw new JobError(503, 'Uploads are not being accepted right now.'); };
    const refused = await post(port, upload(), { 'X-Forwarded-For': '198.51.100.77' });
    assert.equal(refused.status, 503);
    assert.deepEqual(stagedFiles(uploadDir), [], 'the route removes the file the controller did not take');
  } finally { await stop(); }
});

// GET /api/desktop/events for `run`, read for `ms` milliseconds: the raw event-stream text.
function readEvents(port, run, { headers = {}, ms = 250 } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: `/api/desktop/events?run=${run}`, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      setTimeout(() => { req.destroy(); resolve({ status: res.statusCode, text }); }, ms);
    });
    req.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    req.end();
  });
}

test('replay privacy: the job id opens nothing on the desktop events route, the replay id comes only from the token-checked stream, and runs cannot be listed', async () => {
  const hub = new DesktopEventHub();
  const { controller, port, stop } = await start({ controllerOptions: { desktopHub: hub } });
  const app = createAppServer({ desktopEvents: hub, detonation: { handle: async () => false, stop() {} } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const appPort = app.address().port;
  try {
    const { jobId, token } = json(await post(port));
    await controller.idle();
    // Without the token there is no way to learn the replay id; with it, the typed event carries it.
    assert.equal((await call(port, { path: `/api/jobs/${jobId}/events` })).status, 401);
    const events = sse((await call(port, { path: `/api/jobs/${jobId}/events`, headers: bearer(token) })).body.toString('utf8'));
    const replayId = JSON.parse(events.find(item => item.event === 'typed').data).replayId;
    assert.match(replayId, /^[a-z2-7]{40}$/);
    assert.ok(events.filter(item => item.event !== 'typed').every(item => !item.data.includes(replayId)));
    assert.ok(!JSON.stringify(json(await call(port, { path: `/api/jobs/${jobId}`, headers: bearer(token) }))).includes(replayId), 'not in the report');

    // The hub keeps the replay under the replay id only. Event ids are `<boot>-<seq>`; a probe event shows this hub's boot id.
    const probe = await call(appPort, { method: 'POST', path: '/api/desktop/events?run=probe', headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify({ type: 'patch', patch: { notifications: { banners: [], history: [] } } })) });
    assert.equal(probe.status, 202, probe.body.toString());
    const boot = json(probe).id.split('-')[0];
    const history = id => readEvents(appPort, id, { headers: { 'Last-Event-ID': `${boot}-0` } });
    assert.match((await history(replayId)).text, /\ndata: \{"type":"patch"/, 'the replay id has the patches');
    const byJobId = await history(jobId);
    assert.equal(byJobId.status, 200);
    assert.doesNotMatch(byJobId.text, /data:/, 'the job id has none');

    // No run id means no stream, and no route lists runs or their ids.
    assert.equal((await call(appPort, { path: '/api/desktop/events' })).status, 400);
    for (const path of ['/api/desktop/runs', '/api/desktop/events/', '/api/desktop/events/list', '/api/runs', '/api/desktop/events?run=*', '/api/desktop/events?run=', '/api/desktop/events?run=..']) {
      const answer = await call(appPort, { path });
      assert.ok(answer.status >= 400 && !answer.body.toString().includes(replayId), `${path} answered ${answer.status}`);
    }
  } finally {
    await new Promise(resolve => app.close(resolve));
    hub.close();
    await stop();
  }
});
