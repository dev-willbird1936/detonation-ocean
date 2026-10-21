import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPS_MS, JobError, LIMITS_DEFAULT, createJobController, createRedactor, materialiseSeed, newCanaryToken, newReplayId } from '../backend/detonation/jobs.mjs';
import { HOLDER_SLEEP_SECONDS, quotaHomeVolumeCreateArgs } from '../backend/detonation/containers.mjs';
import { createStages } from '../backend/detonation/stages.mjs';
import { answerContainerCall } from './fixtures/detonation/fake-container-calls.mjs';

const SAMPLE = Buffer.from('#!/usr/bin/env python3\nprint("hello from the fake sample")\n');
const SAMPLE_NAME = 'invoice-private-name.py';
const SAMPLE_SHA = createHash('sha256').update(SAMPLE).digest('hex');
const FAKE_KEY = 'a1'.repeat(32);
const FAKE_INFERENCE_KEY = 'fake-inference-key-0000';
const ENV = { DETONATION_ENABLED: 'true', UPLOAD_ENCRYPTION_KEY: FAKE_KEY, VULTR_INFERENCE_API_KEY: FAKE_INFERENCE_KEY, VULTR_INFERENCE_CODE_MODEL: 'fake-model' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17)]);
const NO_MODEL = { available: () => false, complete: async () => { throw new Error('no model'); } };

// A scripted docker daemon: labelled containers and volumes, ps / rm / volume / inspect answers.
function fakeDocker({ failRm = false, failPs = false } = {}) {
  const state = { containers: [], volumes: [], calls: [], failRm, failPs };
  const labelsOf = args => Object.fromEntries(args.flatMap((arg, i) => (arg === '--label' ? [args[i + 1].split('=')] : [])));
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const docker = async args => {
    state.calls.push(args);
    const answered = answerContainerCall(args, state);
    if (answered) return answered;
    const filter = args[args.indexOf('--filter') + 1];
    const matches = item => { const [, key, value] = /^label=([^=]+)(?:=(.*))?$/.exec(filter); return item.labels[key] !== undefined && (value === undefined || item.labels[key] === value); };
    if (args[0] === 'volume' && args[1] === 'create') { state.volumes.push({ name: args.at(-1), labels: labelsOf(args), created: '2000-01-01T00:00:00Z' }); return ok(); }
    if (args[0] === 'ps') return state.failPs ? { code: 1, stdout: '', stderr: 'daemon down' } : ok(state.containers.filter(matches).map(c => (args.includes('--format') ? `${c.id} ${c.labels['detonation-ocean.role'] ?? ''}\n` : `${c.id}\n`)).join(''));
    if (args[0] === 'rm') {
      if (state.failRm) return { code: 1, stdout: '', stderr: 'removal in progress' };
      state.containers = state.containers.filter(c => c.id !== args.at(-1));
      return ok();
    }
    if (args[0] === 'volume' && args[1] === 'ls') return ok(state.volumes.filter(matches).map(v => `${v.name}\n`).join(''));
    if (args[0] === 'volume' && args[1] === 'rm') { state.volumes = state.volumes.filter(v => v.name !== args[2]); return ok(); }
    if (args[0] === 'container' && args[1] === 'inspect') return ok(args.slice(4).map(id => `${id} ${state.containers.find(c => c.id === id).created}
`).join(''));
    if (args[0] === 'volume' && args[1] === 'inspect') return ok(args.slice(4).map(name => `${name} ${state.volumes.find(v => v.name === name).created}
`).join(''));
    throw new Error(`unexpected docker call ${args.join(' ')}`);
  };
  docker.state = state;
  return docker;
}

const record = role => ({
  role, runtime: role === 'detonate' ? 'runsc-trace' : 'runsc', network: 'none', readOnlyRoot: true, capDrop: ['ALL'], user: '10001:10001',
  memoryBytes: 512 * 1024 * 1024, pidsLimit: 512, nanoCpus: 1_000_000_000, secretEnvVars: 0, createdAt: '2026-01-01T00:00:00.000Z', exit: { code: 0, reason: null },
});

// Stages that behave like the image agent's: a labelled container exists after detonate, evidence comes back, the model is mocked.
function fakeStages(docker, seen = {}) {
  return {
    async detonate(ctx) {
      docker.state.containers.push({ id: `c-${ctx.jobId}`, labels: { 'detonation-ocean.job': ctx.jobId }, created: '2000-01-01T00:00:00Z' });
      seen.canaryToken = ctx.canaryToken;
      seen.sample = readFileSync(ctx.paths.sample);
      seen.manifest = JSON.parse(readFileSync(ctx.paths.manifest, 'utf8'));
      seen.credentials = readFileSync(join(ctx.jobDir, 'seed', '.aws', 'credentials'), 'utf8');
      seen.seedFiles = Object.fromEntries(seen.manifest.map(entry => [entry.path, readFileSync(join(ctx.jobDir, 'seed', ...entry.path.split('/').slice(3)))]));
      seen.upload = readFileSync(join(ctx.jobDir, 'upload.enc'));
      seen.jobDir = ctx.jobDir;
      seen.sha = ctx.sampleSha256;
      return { containers: [record('detonate')] };
    },
    parseTrace: async () => [{ source: 'trace', kind: 'file-read', path: '/home/dana/.aws/credentials', detail: 'read it', at: '2026-01-01T00:00:02.000Z' }],
    collect: async () => ({ containers: [record('collect')], evidence: [{ source: 'diff', kind: 'added', path: '/home/dana/Downloads/x', seeded: false, detail: 'added', at: '2026-01-01T00:00:01.000Z' }] }),
    analyse: async ctx => {
      ctx.emitAttempt({ type: 'analysis-attempt', n: 1, code: 'print(1)', exitCode: 0, stderr: '' });
      return { verdict: ctx.verdict, attempts: [{ n: 1, code: 'print(1)', exitCode: 0, stderr: '' }], artifacts: { 'timeline.png': PNG }, scriptOk: true, modelAvailable: true, explanation: 'Fake explanation.', containers: [record('analyse')] };
    },
  };
}

function setup({ env = ENV, dockerOptions, stages, ...options } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'do-jobs-'));
  const docker = fakeDocker(dockerOptions);
  const time = { now: Date.parse('2026-01-01T00:00:00Z') };
  const logs = [];
  const seen = {};
  const controller = createJobController({
    env, dataDir, docker, clock: () => new Date(time.now), logger: line => logs.push(line), inference: NO_MODEL,
    stages: { ...fakeStages(docker, seen), ...stages }, ...options,
  });
  return { controller, dataDir, docker, time, logs, seen };
}

const names = job => job.events.map(item => (item.event === 'stage' ? `stage:${item.data.stage}` : item.event));
const submit = (controller, extra = {}) => controller.submit({ file: SAMPLE, claimedName: SAMPLE_NAME, ip: '203.0.113.7', ...extra });
const run = async (controller, extra) => { const { jobId, token } = submit(controller, extra); await controller.idle(); return { job: controller.getJob(jobId), jobId, token }; };

test('happy path emits the EVENTS.md order and builds the 5.4 report', async () => {
  const { controller, dataDir, docker, seen } = setup();
  await controller.start();
  const { job, jobId } = await run(controller);
  assert.deepEqual(names(job), [
    'stage:received', 'stage:typed', 'typed', 'stage:queued', 'stage:detonating', 'stage:collecting', 'evidence', 'evidence', 'finding',
    'stage:analysing', 'analysis-attempt', 'stage:explaining', 'explanation', 'stage:verdict', 'verdict', 'stage:tearing_down', 'receipt', 'stage:done', 'report',
  ]);
  assert.deepEqual(job.events.map(item => item.id), job.events.map((_, i) => i + 1));
  assert.equal(job.state, 'done');
  const byEvent = event => job.events.filter(item => item.event === event).map(item => item.data);
  assert.deepEqual(byEvent('typed')[0], { detectedType: 'py', claimedExtension: 'py', path: 'run', species: 'snake-eel', label: 'Executed on Linux', mismatch: false, sizeTier: 'full' });
  assert.deepEqual(job.events.find(item => item.data.stage === 'analysing').data.attempt, 1);
  assert.deepEqual(byEvent('evidence').map(item => item.id), ['ev-1', 'ev-2']);
  assert.deepEqual(byEvent('evidence').map(item => item.kind), ['added', 'file-read']);
  assert.deepEqual(byEvent('finding')[0], { id: 'steal-credentials', depth: 'midnight', family: 'theft-surveillance', creature: 'Cookiecutter shark', evidenceIds: ['ev-2'] });
  assert.equal(byEvent('explanation')[0].text, 'Fake explanation.');

  const report = byEvent('report')[0];
  assert.equal(report, job.report);
  assert.deepEqual(Object.keys(report), ['jobId', 'file', 'verdict', 'evidence', 'coverage', 'analysis', 'explanation', 'receipt']);
  assert.deepEqual(report.file, { detectedType: 'py', claimedExtension: 'py', path: 'run', sizeBytes: SAMPLE.length });
  assert.equal(report.verdict.depth, 'midnight');
  assert.equal(report.receipt.teardownConfirmed, true);
  assert.equal(report.receipt.hostCanary, 'unchanged');
  assert.equal(report.receipt.uploadDeleted, true);
  assert.deepEqual(report.analysis.attempts, [{ n: 1, code: 'print(1)', exitCode: 0, stderr: '', artifacts: ['timeline.png'] }]);
  assert.ok(!JSON.stringify(job.events).includes(SAMPLE_NAME) && !JSON.stringify(job.events).includes(SAMPLE_SHA));
  assert.deepEqual([...job.artifacts.keys()], ['timeline.png'], 'only allowlisted artifact names are kept');

  // AT-9: nothing labelled with the job, and the upload and temp directory are gone.
  assert.equal(docker.state.containers.length, 0);
  assert.equal(docker.state.volumes.length, 0);
  assert.equal(existsSync(seen.jobDir), false);
  assert.deepEqual(readdirSync(join(dataDir, 'jobs')), []);
  assert.equal(controller.acceptingJobs, true);
  // 7.3 and 6.2: the quota volume, the verified holder, then the verified seed container (create -> inspect -> start), nothing started unverified.
  const verbs = docker.state.calls.map(args => args.slice(0, args[0] === 'container' || args[0] === 'volume' ? 2 : 1).join(' ')).filter(verb => /^(volume create|create|container inspect|start)$/.test(verb));
  assert.deepEqual(verbs.slice(0, 8), ['volume create', 'create', 'container inspect', 'start', 'create', 'container inspect', 'start', 'container inspect']);
  const calls = docker.state.calls;
  assert.deepEqual(calls.find(args => args[0] === 'volume' && args[1] === 'create'), quotaHomeVolumeCreateArgs(jobId));
  const created = calls.filter(args => args[0] === 'create');
  assert.deepEqual(created.map(args => args[args.indexOf('--name') + 1]), [`do-${jobId}-holder`, `do-${jobId}-seed`]);
  assert.ok(created[0].includes('sleep') && created[0].at(-1) === String(HOLDER_SLEEP_SECONDS));
  assert.ok(created[1].includes('none') && created[1].includes('--read-only') && created[1].includes('--log-driver')
    && created[1].includes(`type=bind,src=${join(dataDir, 'jobs', jobId, 'seed')},dst=/seed,readonly`));
  assert.ok(!calls.some(args => args[0] === 'run'), 'no unverified docker run');
  const idOf = name => createHash('sha256').update(name).digest('hex');
  assert.equal(calls.find(args => args[0] === 'rm').at(-1), idOf(`do-${jobId}-holder`), 'teardown removes the holder first');
});

test('invalid analysis artifacts are rejected as a complete set', async () => {
  const analyse = async ctx => {
    const attempt = { n: 1, code: 'print(1)', exitCode: 0, stderr: '' };
    ctx.emitAttempt({ type: 'analysis-attempt', ...attempt });
    return { verdict: ctx.verdict, attempts: [attempt], artifacts: { 'timeline.png': PNG, 'notes.exe': Buffer.from('x') }, scriptOk: true, modelAvailable: true, explanation: 'Fake explanation.', containers: [record('analyse')] };
  };
  const { controller } = setup({ stages: { analyse } });
  await controller.start();
  const { job } = await run(controller);
  assert.equal(job.state, 'done');
  assert.equal(job.report.analysis.attempts[0].exitCode, 1);
  assert.match(job.report.analysis.attempts[0].stderr, /Analysis artifacts were rejected/);
  assert.deepEqual(job.report.analysis.attempts[0].artifacts, []);
  assert.deepEqual([...job.artifacts.keys()], []);
});

test('9.1 replay: once the evidence is collected its patches go to the desktop hub under the replay id, before analysing; a hub failure does not fail the job', async () => {
  const published = [];
  const desktopHub = { publish: (run, event) => { published.push({ run, event }); return { id: published.length }; } };
  let atAnalyse;
  const analyse = async ctx => {
    atAnalyse = published.length;
    return { verdict: ctx.verdict, attempts: [], artifacts: {}, scriptOk: false, modelAvailable: false, explanation: 'x', containers: [record('analyse')] };
  };
  const { controller } = setup({ desktopHub, stages: { analyse } });
  await controller.start();
  const { job, jobId } = await run(controller);
  assert.equal(job.state, 'done');
  assert.ok(published.length >= 2, 'the seeded state, then at least one change');
  assert.equal(atAnalyse, published.length, 'all patches were published before the analysing stage');
  const replayId = job.events.find(item => item.event === 'typed').data.replayId;
  assert.match(replayId, /^[a-z2-7]{40}$/);
  assert.ok(published.every(item => item.run === replayId && item.event.type === 'patch'));
  assert.notEqual(replayId, jobId);
  assert.equal(published[0].event.patch.notifications.history[0].title, 'Executed on Linux', 'the path label comes first');
  assert.ok(published.some(item => item.event.patch.notifications?.history.some(note => note.title === 'Credential file read')), 'the credential read from the trace is replayed');

  const quiet = setup({ stages: { analyse } });
  await quiet.controller.start();
  assert.equal((await run(quiet.controller)).job.state, 'done', 'without a hub there is no replay and no error');

  const broken = setup({ desktopHub: { publish() { throw new Error('hub closed'); } }, stages: { analyse } });
  await broken.controller.start();
  const failed = await run(broken.controller);
  assert.equal(failed.job.state, 'done');
  assert.ok(broken.logs.some(line => line.includes('replay: Error')));
});

test('the upload is encrypted at rest, decrypted only to sample.bin, and the seed carries the per-job canary', async () => {
  const { controller, seen } = setup();
  await controller.start();
  await run(controller);
  assert.ok(!seen.upload.includes(SAMPLE), 'upload.enc holds no plaintext');
  assert.ok(!seen.upload.includes('hello from the fake sample'));
  assert.deepEqual(seen.sample, SAMPLE);
  assert.equal(seen.sha, SAMPLE_SHA);
  assert.match(seen.canaryToken, /^[A-Z0-9]{10}$/);
  assert.match(seen.credentials, new RegExp(`^aws_access_key_id = AKIA${seen.canaryToken}FAKE00`, 'm'));
  for (const [path, data] of Object.entries(seen.seedFiles)) {
    assert.ok(!data.includes('{{CANARY}}'), path);
    const entry = seen.manifest.find(item => item.path === path);
    assert.equal(entry.size, data.length, path);
    assert.equal(entry.sha256, createHash('sha256').update(data).digest('hex'), path);
  }
  assert.ok(seen.manifest.some(entry => entry.path === '/home/dana/.env'));
  assert.throws(() => createJobController({ env: { ...ENV, UPLOAD_ENCRYPTION_KEY: 'too-short' }, dataDir: tmpdir() }), TypeError);
});

test('materialiseSeed replaces every placeholder byte for byte and canary tokens are 10 characters of A-Z0-9', async () => {
  const jobDir = mkdtempSync(join(tmpdir(), 'do-seed-'));
  const token = newCanaryToken();
  assert.match(token, /^[A-Z0-9]{10}$/);
  assert.notEqual(token, newCanaryToken());
  const { manifest } = await materialiseSeed({ jobDir, token });
  assert.ok(manifest.length >= 13);
  for (const entry of manifest) {
    const data = readFileSync(join(jobDir, 'seed', ...entry.path.split('/').slice(3)));
    assert.ok(!data.includes('{{CANARY}}'), entry.path);
  }
  assert.ok(readFileSync(join(jobDir, 'seed', '.env'), 'utf8').includes(`fake-openai-${token}`));
});

test('a stage failure still tears down, and the browser sees no internal message', async () => {
  const docker = fakeDocker();
  const { controller, dataDir } = setup({
    stages: {
      detonate: async ctx => {
        docker.state.containers.push({ id: 'leftover', labels: { 'detonation-ocean.job': ctx.jobId }, created: '2000-01-01T00:00:00Z' });
        throw new Error('crashed at /var/lib/detonation-ocean/jobs/secret-path');
      },
    },
  });
  await controller.start();
  const { job } = await run(controller);
  assert.equal(job.state, 'failed');
  assert.ok(names(job).includes('stage:failed') && names(job).includes('stage:tearing_down'));
  assert.ok(names(job).indexOf('stage:failed') < names(job).indexOf('stage:tearing_down'), 'failed first, teardown after');
  assert.equal(names(job).at(-1), 'error');
  assert.deepEqual(job.events.at(-1).data, { message: 'The job failed.' });
  assert.ok(!JSON.stringify(job.events).includes('secret-path'));
  assert.deepEqual(readdirSync(join(dataDir, 'jobs')), []);
  assert.equal(controller.acceptingJobs, true);
});

test('the default stages are not-implemented stubs: the job fails and still tears down', async () => {
  const { controller, docker, dataDir } = setup({ stages: { detonate: undefined, parseTrace: undefined, collect: undefined, analyse: undefined } });
  await controller.start();
  const { job } = await run(controller);
  assert.equal(job.state, 'failed');
  assert.ok(names(job).includes('stage:tearing_down'));
  assert.equal(docker.state.volumes.length, 0);
  assert.deepEqual(readdirSync(join(dataDir, 'jobs')), []);
});

test('the default analyse and explain give the rule-engine verdict and a "Model unavailable" explanation', async () => {
  const { controller } = setup({ stages: { analyse: undefined } });
  await controller.start();
  const { job } = await run(controller);
  assert.equal(job.state, 'done');
  assert.match(job.report.explanation, /Rule-engine verdict: midnight\. Findings: steal-credentials\. Model unavailable\./);
  assert.equal(job.events.find(item => item.event === 'explanation').data.modelAvailable, false);
});

test('type-mismatch becomes identify evidence and a Twilight signal (AT-14), with only the extension reported', async () => {
  const { controller } = setup({ stages: { parseTrace: async () => [], collect: async () => ({ containers: [record('collect')], evidence: [] }) } });
  await controller.start();
  const { job } = await run(controller, { file: Buffer.from('<html><body>x</body></html>'), claimedName: 'invoice.pdf.html' });
  assert.equal(job.state, 'done');
  assert.equal(job.report.verdict.depth, 'twilight');
  assert.ok(job.report.verdict.signals.includes('type-mismatch'));
  assert.equal(job.report.file.claimedExtension, 'pdf');
  assert.ok(job.events.some(item => item.event === 'signal' && item.data.id === 'type-mismatch'));
});

test('whole-job cap: a stage that never returns fails the job at the cap, aborts it and still tears down', async () => {
  let signal;
  const { controller, docker } = setup({ caps: { job: 1500 }, stages: { detonate: ctx => { signal = ctx.signal; return new Promise(() => {}); } } });
  await controller.start();
  const started = Date.now();
  const { job } = await run(controller);
  assert.ok(Date.now() - started < 8000);
  assert.equal(job.state, 'failed');
  assert.match(job.error, /exceeded/);
  assert.equal(signal.aborted, true);
  assert.ok(names(job).includes('stage:tearing_down'));
  assert.equal(docker.state.volumes.length, 0);
  assert.equal(CAPS_MS.job, 180_000);
  assert.deepEqual({ detonate: CAPS_MS.detonate, collect: CAPS_MS.collect, explain: CAPS_MS.explain }, { detonate: 30_000, collect: 10_000, explain: 30_000 });
});

test('per-stage cap: a slow collect fails with a stage message', async () => {
  const { controller } = setup({ caps: { collect: 60 }, stages: { collect: () => new Promise(() => {}) } });
  await controller.start();
  const { job } = await run(controller);
  assert.equal(job.state, 'failed');
  assert.equal(job.error, 'The collecting stage timed out.');
});

test('AT-10: docker rm forced to fail fails the job, stops uploads, and a restart with a clean reaper pass reopens them', async () => {
  const { controller, docker, dataDir, logs } = setup({ dockerOptions: { failRm: true } });
  await controller.start();
  assert.equal(controller.acceptingJobs, true);
  const { job, jobId } = await run(controller);
  assert.equal(job.state, 'failed');
  assert.equal(job.report, null);
  assert.equal(job.error, 'Teardown or the receipt check failed.');
  assert.equal(controller.acceptingJobs, false);
  assert.equal(controller.health().acceptingJobs, false);
  assert.throws(() => submit(controller), error => error instanceof JobError && error.status === 503);
  assert.ok(logs.some(line => line.includes(jobId) && line.includes('operator')), 'the job id is logged for the operator');
  const receipt = job.events.find(item => item.event === 'receipt').data;
  assert.equal(receipt.teardownConfirmed, false);

  docker.state.failRm = false;
  const restarted = createJobController({ env: ENV, dataDir, docker, inference: NO_MODEL, logger() {}, stages: fakeStages(docker) });
  assert.equal(restarted.acceptingJobs, false, 'closed until the first reaper pass');
  await restarted.start();
  assert.equal(restarted.acceptingJobs, true);
  restarted.stop();
});

test('uploads stay closed when the start-up reaper pass is not clean, or the feature is off', async () => {
  const broken = setup({ dockerOptions: { failPs: true } });
  await broken.controller.start();
  assert.equal(broken.controller.acceptingJobs, false);
  assert.throws(() => submit(broken.controller), { status: 503 });
  const off = setup({ env: { ...ENV, DETONATION_ENABLED: 'false' } });
  await off.controller.start();
  assert.throws(() => submit(off.controller), { status: 503 });
  broken.controller.stop();
  off.controller.stop();
});

test('the start-up reaper pass is a clean slate (age 0); later passes remove labelled leftovers older than five minutes and keep newer ones', async () => {
  const { controller, docker, time } = setup();
  const leftover = (id, created) => ({ id, labels: { 'detonation-ocean.job': `j-${id}` }, created });
  docker.state.containers.push(leftover('old', '2025-12-31T00:00:00Z'), leftover('fresh', '2026-01-01T00:00:00Z'));
  assert.equal(controller.acceptingJobs, false);
  await controller.start();
  assert.deepEqual(docker.state.containers, [], 'a container from a moment ago is removed at start too');
  assert.equal(controller.acceptingJobs, true);

  docker.state.containers.push(leftover('new', '2026-01-01T00:00:00Z'));
  await controller.reapOnce();
  assert.deepEqual(docker.state.containers.map(item => item.id), ['new'], 'a later pass keeps what is under five minutes old');
  time.now += 10 * 60_000;
  await controller.reapOnce();
  assert.deepEqual(docker.state.containers, []);
  controller.stop();
});

test('rate limits: 3 per IP per hour and a site-wide daily cap, 429 beyond', async () => {
  assert.deepEqual({ ...LIMITS_DEFAULT }, { concurrency: 2, queueMax: 10, perIpHour: 3, perDay: 50 });
  const { controller, time } = setup({ limits: { perDay: 5 } });
  await controller.start();
  for (let i = 0; i < 3; i += 1) await run(controller, { ip: '198.51.100.1' });
  assert.throws(() => submit(controller, { ip: '198.51.100.1' }), error => error instanceof JobError && error.status === 429);
  await run(controller, { ip: '198.51.100.2' });
  await run(controller, { ip: '198.51.100.3' });
  assert.throws(() => submit(controller, { ip: '198.51.100.4' }), { status: 429 }, 'daily cap');
  time.now += 61 * 60_000;
  assert.throws(() => submit(controller, { ip: '198.51.100.1' }), { status: 429 }, 'daily cap still holds after an hour');
  time.now += 24 * 60 * 60_000;
  await run(controller, { ip: '198.51.100.1' });
});

test('queue: two jobs run at once, ten wait, the next is refused with 503', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let running = 0;
  let peak = 0;
  const { controller, docker } = setup({
    limits: { perDay: 100 },
    stages: { detonate: async ctx => { running += 1; peak = Math.max(peak, running); await gate; running -= 1; return { containers: [record('detonate')] }; } },
  });
  await controller.start();
  const ids = Array.from({ length: 12 }, (_, i) => submit(controller, { ip: `192.0.2.${i + 1}` }).jobId);
  try {
    for (let waited = 0; (running < 2 || controller.health().queueDepth < 10) && waited < 10_000; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(running, 2);
    assert.equal(controller.health().queueDepth, 10);
    assert.throws(() => submit(controller, { ip: '192.0.2.99' }), error => error.status === 503 && /queue is full/.test(error.message));
  } finally {
    release();
  }
  await controller.idle();
  assert.equal(peak, 2);
  assert.ok(ids.every(id => controller.getJob(id).state === 'done'));
  assert.equal(controller.health().queueDepth, 0);
  assert.equal(docker.state.containers.length, 0);
});

test('a host canary changed during the job fails it', async () => {
  const { controller, dataDir } = setup({
    stages: { detonate: async () => { writeFileSync(join(dataDir, 'host-canary'), 'tampered'); return { containers: [record('detonate')] }; } },
  });
  await controller.start();
  const { job } = await run(controller);
  assert.equal(job.state, 'failed');
  assert.equal(job.events.find(item => item.event === 'receipt').data.hostCanary, 'changed');
});

test('bearer tokens are checked against a digest, and subscribe replays from an event id', async () => {
  const { controller } = setup();
  await controller.start();
  const { job, token } = await run(controller);
  assert.equal(controller.authorise(job, token), true);
  assert.equal(controller.authorise(job, `${token}x`), false);
  assert.equal(controller.authorise(job, ''), false);
  assert.equal(controller.authorise(job, undefined), false);
  const seenIds = [];
  controller.subscribe(job, job.events.length - 2, item => seenIds.push(item?.id ?? 'end'));
  assert.deepEqual(seenIds, [job.events.length - 1, job.events.length, 'end']);
});

test('AT-15: the ocean shows nothing of a job until the batch applies, and logs hold no name, hash, token or secret', async () => {
  const { controller, logs, seen } = setup();
  await controller.start();
  const empty = controller.oceanView();
  const { job, token } = await run(controller);
  assert.deepEqual(controller.oceanView(), empty);
  assert.deepEqual(empty.schools, []);
  assert.deepEqual(empty.creatures, []);
  controller.applyPending();
  const view = controller.oceanView();
  assert.deepEqual(view.creatures, [{ findingId: 'steal-credentials', eaten: 1 }]);
  assert.deepEqual(Object.keys(view).sort(), ['batchAt', 'creatures', 'schools']);
  assert.ok(!JSON.stringify(view).includes(job.id));

  const text = logs.join('\n');
  assert.ok(text.includes(job.id) && text.includes('tearing_down'), 'logs carry job id and stage');
  for (const forbidden of [SAMPLE_NAME, SAMPLE_SHA, token, seen.canaryToken, FAKE_KEY, FAKE_INFERENCE_KEY, 'invoice']) assert.ok(!text.includes(forbidden), `log leaks ${forbidden}`);
});

test('the redactor hides values of KEY, TOKEN and SECRET variables', () => {
  const redact = createRedactor({ VULTR_INFERENCE_API_KEY: 'k-12345678', GITHUB_TOKEN: 'ghp_abcdef', MY_SECRET: 'shh-secret', PATH: '/usr/bin', EMPTY_KEY: '' });
  assert.equal(redact('call k-12345678 with ghp_abcdef and shh-secret at /usr/bin'), 'call [redacted] with [redacted] and [redacted] at /usr/bin');
});

test('7.4: queued jobs re-check the gate after acquire(); a teardown failure ahead of them fails them with the 503 reason and nothing launches', async () => {
  let detonations = 0;
  const { controller } = setup({
    dockerOptions: { failRm: true }, limits: { concurrency: 1 },
    stages: { detonate: async ctx => { detonations += 1; return { containers: [record('detonate')] }; } },
  });
  await controller.start();
  const first = submit(controller, { ip: '198.51.100.1' });
  // Sealing the upload is asynchronous, so two jobs submitted together can reach the queue in either order. The second job is submitted
  // once the first holds the only slot, which is the order this test is about.
  while (!controller.getJob(first.jobId).events.some(item => item.event === 'stage' && item.data.stage === 'detonating')) await new Promise(resolve => setImmediate(resolve));
  const second = submit(controller, { ip: '198.51.100.2' });
  await controller.idle();
  assert.equal(controller.getJob(first.jobId).state, 'failed');
  assert.equal(controller.acceptingJobs, false);
  const queued = controller.getJob(second.jobId);
  assert.equal(queued.state, 'failed');
  assert.equal(queued.error, 'Uploads are not being accepted right now.');
  assert.equal(detonations, 1, 'the queued job never reached detonate');
  assert.ok(!queued.events.some(item => item.event === 'stage' && item.data.stage === 'detonating'));
});

test('teardown logs its error count and nothing else about the errors', async () => {
  const { controller, logs } = setup({ dockerOptions: { failRm: true } });
  await controller.start();
  const { job } = await run(controller);
  const line = logs.map(text => JSON.parse(text)).find(entry => entry.job === job.id && 'teardownErrors' in entry);
  assert.ok(line.teardownErrors >= 1);
  assert.equal(line.teardownConfirmed, false);
  assert.ok(!logs.join('\n').includes('removal in progress'), 'docker stderr stays out of the log');
});

test('stages cannot create containers once the job is closed: the signal is aborted before teardown', async () => {
  let saved;
  const { controller, docker } = setup({ stages: { detonate: async ctx => { saved = ctx; return { containers: [record('detonate')] }; } } });
  await controller.start();
  const { job } = await run(controller);
  assert.equal(job.state, 'done');
  assert.equal(saved.signal.aborted, true);
  const before = docker.state.calls.length;
  const stages = createStages({ env: ENV });
  for (const call of [() => stages.detonate(saved), () => stages.collect(saved), () => stages.runScript('print(1)', saved), () => stages.parseTrace(saved)]) {
    await assert.rejects(call(), /job is closed/);
  }
  assert.equal(docker.state.calls.length, before, 'no docker call after close');
});

test('a seed step that outlives its guard creates nothing after teardown and removes the volume it made late', async () => {
  const { controller, docker } = setup({ caps: { prep: 60 } });
  const inner = docker;
  const slow = async (args, options) => {
    if (args[0] === 'volume' && args[1] === 'create') await new Promise(resolve => setTimeout(resolve, 400));
    return inner(args, options);
  };
  slow.state = inner.state;
  const slowController = createJobController({ env: ENV, dataDir: mkdtempSync(join(tmpdir(), 'do-jobs-')), docker: slow, logger() {}, inference: NO_MODEL, caps: { prep: 60 }, stages: fakeStages(inner) });
  await slowController.start();
  const { job } = await run(slowController);
  assert.equal(job.error, 'The detonating stage timed out.');
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.ok(!inner.state.calls.some(args => args[0] === 'create'), 'no container was created after the job closed');
  assert.deepEqual(inner.state.volumes, [], 'the volume made after teardown is removed');
  controller.stop();
  slowController.stop();
});

test('replay privacy: the replay id is random, differs from the job id and appears only in the token-checked typed event', async () => {
  const published = [];
  const desktopHub = { publish: (runId, event) => { published.push(runId); return { id: published.length }; } };
  const { controller, logs } = setup({ desktopHub });
  await controller.start();
  const one = await run(controller, { ip: '198.51.100.1' });
  const two = await run(controller, { ip: '198.51.100.2' });
  const idOf = job => job.events.find(item => item.event === 'typed').data.replayId;
  assert.match(idOf(one.job), /^[a-z2-7]{40}$/);
  assert.notEqual(idOf(one.job), idOf(two.job));
  assert.ok(published.includes(idOf(one.job)) && !published.includes(one.jobId) && !published.includes(two.jobId));
  const elsewhere = JSON.stringify([one.job.events.filter(item => item.event !== 'typed'), one.job.report, controller.status(one.job), controller.oceanView(), logs]);
  assert.ok(!elsewhere.includes(idOf(one.job)), 'not in any other event, the report, the status, the ocean view or the logs');
  assert.equal(new Set(Array.from({ length: 200 }, newReplayId)).size, 200);
  assert.ok(Array.from({ length: 50 }, newReplayId).every(id => /^[a-z2-7]{40}$/.test(id)));
  const without = setup();
  await without.controller.start();
  assert.equal('replayId' in (await run(without.controller)).job.events.find(item => item.event === 'typed').data, false, 'no hub, no replay id');
});

test('submit takes a byte range of a temp file: it is streamed into the encrypted copy and the temp file is deleted', async () => {
  const { controller, seen, dataDir } = setup();
  await controller.start();
  const envelope = join(mkdtempSync(join(tmpdir(), 'do-source-')), 'upload.part');
  const before = Buffer.from('--B\r\nContent-Disposition: form-data; name="file"\r\n\r\n');
  writeFileSync(envelope, Buffer.concat([before, SAMPLE, Buffer.from('\r\n--B--\r\n')]));
  const { jobId } = controller.submit({ source: { path: envelope, start: before.length, end: before.length + SAMPLE.length }, claimedName: SAMPLE_NAME, ip: '203.0.113.7' });
  await controller.idle();
  const job = controller.getJob(jobId);
  assert.equal(job.state, 'done');
  assert.deepEqual(seen.sample, SAMPLE);
  assert.equal(seen.sha, SAMPLE_SHA);
  assert.ok(!seen.upload.includes('hello from the fake sample'), 'encrypted at rest');
  assert.equal(job.report.file.sizeBytes, SAMPLE.length);
  assert.equal(existsSync(envelope), false, 'the job removed the temp file');
  assert.deepEqual(readdirSync(join(dataDir, 'jobs')), []);

  const refused = join(mkdtempSync(join(tmpdir(), 'do-source-')), 'kept.part');
  writeFileSync(refused, 'x');
  for (const source of [{ path: refused, start: 1, end: 1 }, { path: refused, start: 2, end: 1 }, { path: refused, start: 0, end: 101 * 1024 * 1024 }, { path: 7, start: 0, end: 1 }]) {
    assert.throws(() => controller.submit({ source, ip: '203.0.113.9' }), error => error instanceof JobError && [400, 413].includes(error.status));
  }
  assert.equal(existsSync(refused), true, 'a refused submit leaves the file to its caller');
});

test('a file over 10 MB is streamed, hashed and decrypted whole without being typed from its whole body', async () => {
  const { controller, seen } = setup();
  await controller.start();
  const big = Buffer.alloc(11 * 1024 * 1024 + 123, 0x41);
  for (let at = 0; at < big.length; at += 4099) big[at] = at % 251;
  const { job } = await run(controller, { file: big, claimedName: 'big.bin' });
  assert.equal(job.state, 'done');
  assert.equal(seen.sha, createHash('sha256').update(big).digest('hex'));
  assert.ok(seen.sample.equals(big), 'the decrypted sample is byte for byte the upload');
  assert.equal(job.report.file.sizeBytes, big.length);
  assert.equal(job.events.find(item => item.event === 'typed').data.sizeTier, 'static');
});
