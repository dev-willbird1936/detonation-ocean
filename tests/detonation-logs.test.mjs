// AT-31 (SPEC 15.8): logs carry the job id, stage, timings, limits and errors only. A full job (and a failing one) goes through
// the real job controller and HTTP routes with a fake docker and fake stages, an upload named `invoice.py` with the invoice.py
// evidence fixture, and fake secrets in the environment. Every log line (console and the controller's logger) is captured: none
// may hold the file name, the SHA-256 of the upload, or a secret value. Fake values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { request as httpRequest, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobController } from '../backend/detonation/jobs.mjs';
import { createDetonationRoutes } from '../backend/detonation/routes.mjs';
import { answerContainerCall } from './fixtures/detonation/fake-container-calls.mjs';

const ORIGIN = 'https://ocean.example';
const UPLOAD_NAME = 'invoice.py';
const UPLOAD = Buffer.from('#!/usr/bin/env python3\n# Invoice 2026-0042 for Dana\nprint("hello from the fake invoice")\n');
const UPLOAD_SHA256 = createHash('sha256').update(UPLOAD).digest('hex');
const FAKE_KEY_HEX = 'c3'.repeat(32);
const FAKE_INFERENCE_KEY = 'fake-inference-key-for-the-log-test';
const ENV = { DETONATION_ENABLED: 'true', UPLOAD_ENCRYPTION_KEY: FAKE_KEY_HEX, VULTR_INFERENCE_API_KEY: FAKE_INFERENCE_KEY, VULTR_INFERENCE_CODE_MODEL: 'fake-model' };
const FORBIDDEN = {
  'file name': UPLOAD_NAME,
  'file name stem': 'invoice',
  'SHA-256 of the upload': UPLOAD_SHA256,
  'SHA-256 prefix': UPLOAD_SHA256.slice(0, 16),
  'upload encryption key (hex)': FAKE_KEY_HEX,
  'upload encryption key (base64)': Buffer.from(FAKE_KEY_HEX, 'hex').toString('base64'),
  'inference API key': FAKE_INFERENCE_KEY,
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17)]);
const NO_MODEL = { available: () => false, complete: async () => { throw new Error('no model'); } };
const fixture = JSON.parse(readFileSync(new URL('./fixtures/detonation/evidence/invoice.py.json', import.meta.url), 'utf8'));
const withoutId = ({ id, ...item }) => item;

function fakeDocker() {
  const state = { containers: [], volumes: [] };
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const docker = async args => {
    const answered = answerContainerCall(args, state);
    if (answered) return answered;
    const filter = args[args.indexOf('--filter') + 1];
    const matches = item => { const [, key, value] = /^label=([^=]+)(?:=(.*))?$/.exec(filter); return item.labels[key] !== undefined && (value === undefined || item.labels[key] === value); };
    if (args[0] === 'volume' && args[1] === 'create') { state.volumes.push({ name: args.at(-1), labels: { 'detonation-ocean.job': args[3].split('=')[1] } }); return ok(); }
    if (args[0] === 'ps') return ok(state.containers.filter(matches).map(c => `${c.id}\n`).join(''));
    if (args[0] === 'rm') { state.containers = state.containers.filter(c => c.id !== args.at(-1)); return ok(); }
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

// Stages that return the invoice.py evidence. `analyse` can be replaced by one that fails with a message full of forbidden values.
const stages = analyse => ({
  detonate: async () => ({ containers: [record('detonate')] }),
  parseTrace: async () => fixture.evidence.filter(item => item.source === 'trace').map(withoutId),
  collect: async () => ({ containers: [record('collect')], evidence: fixture.evidence.filter(item => item.source === 'diff').map(withoutId) }),
  analyse: analyse ?? (async ctx => ({
    verdict: ctx.verdict, attempts: [{ n: 1, code: 'print(1)', exitCode: 0, stderr: '' }], artifacts: { 'timeline.png': PNG }, scriptOk: true, modelAvailable: true, explanation: 'Fake.',
  })),
});

async function start(t, { analyse } = {}) {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, method, (...args) => { lines.push(args.map(String).join(' ')); });
  const controller = createJobController({
    env: ENV, dataDir: mkdtempSync(join(tmpdir(), 'do-logs-')), docker: fakeDocker(), inference: NO_MODEL, stages: stages(analyse),
    // No `logger` option: the controller logs to console.log, which is captured above, exactly as in production.
  });
  await controller.start();
  const routes = createDetonationRoutes({ env: ENV, controller, publicOrigin: ORIGIN, uploadDir: join(mkdtempSync(join(tmpdir(), 'do-logs-uploads-')), 'uploads') });
  const server = createServer(async (req, res) => {
    if (!(await routes.handle(req, res, new URL(req.url, 'http://127.0.0.1').pathname, { buildId: 'abcd1234abcd1234' }))) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stop = async () => { routes.stop(); controller.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return { controller, lines, port: server.address().port, stop };
}

function uploadInvoice(port) {
  const boundary = 'XBOUNDARYX';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${UPLOAD_NAME}"\r\n\r\n`), UPLOAD,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="consent"\r\n\r\ntrue\r\n--${boundary}--\r\n`),
  ]);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, method: 'POST', path: '/api/jobs',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Origin: ORIGIN, 'Content-Length': body.length, 'X-Forwarded-For': '203.0.113.9' },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function assertClean(lines) {
  assert.ok(lines.length > 0, 'the controller logged something');
  const text = lines.join('\n');
  for (const [what, value] of Object.entries(FORBIDDEN)) assert.ok(!text.toLowerCase().includes(value.toLowerCase()), `no ${what} in any log line`);
}

test('AT-31: a full invoice.py job logs no file name, upload SHA-256 or secret', async t => {
  const { controller, lines, port, stop } = await start(t);
  try {
    const accepted = await uploadInvoice(port);
    assert.equal(accepted.status, 202);
    await controller.idle();
    const job = controller.getJob(accepted.body.jobId);
    assert.equal(job.state, 'done');
    assert.equal(job.report.verdict.depth, fixture.expect.depth, 'the invoice.py evidence reached its verdict');
    assert.ok(lines.some(line => line.includes(accepted.body.jobId)), 'log lines name the job by id');
    assertClean(lines);
  } finally { await stop(); }
});

test('AT-31: a failing job and a failing route log error names only', async t => {
  const leaky = `${UPLOAD_NAME} ${UPLOAD_SHA256} ${FAKE_KEY_HEX} ${FAKE_INFERENCE_KEY}`;
  const { controller, lines, port, stop } = await start(t, { analyse: async () => { throw new Error(`analysis failed for ${leaky}`); } });
  try {
    const failed = await uploadInvoice(port);
    assert.equal(failed.status, 202);
    await controller.idle();
    assert.equal(controller.getJob(failed.body.jobId).state, 'failed');

    controller.submit = () => { throw new Error(`submit failed for ${leaky}`); };
    assert.equal((await uploadInvoice(port)).status, 500);
    assert.ok(lines.some(line => line.startsWith('Detonation route failed: Error')), 'the route failure was logged by name');
    assertClean(lines);
  } finally { await stop(); }
});
