// M4b in the job pipeline and the container rules (SPEC 6.3, 6.6, 7.5): the wine role (runc, seccomp-wine.json, pids 128), the parser variant of the
// analyse container, the receipt note, route labels, Wine artifacts, inspect-only children and the model-written parser loop (AT-21). No Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LIMITS, ROLE_RUNTIME, SECCOMP_WINE_FILE, WINE_PIDS_LIMIT, buildContainerArgs, loadImageLock, mountsFor, pidsLimitFor, tmpfsFor, verifyIsolation,
} from '../backend/detonation/containers.mjs';
import { createJobController } from '../backend/detonation/jobs.mjs';
import { WINE_NOTE, buildReceipt, validateReceipt } from '../backend/detonation/receipts.mjs';
import { answerContainerCall } from './fixtures/detonation/fake-container-calls.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/detonation/inspect/${name}.json`, import.meta.url), 'utf8');
const mutated = (name, change) => { const data = JSON.parse(fixture(name)); change(data[0]); return JSON.stringify(data); };
const jobId = 'j-abc123';
const jobDir = '/var/lib/detonation-ocean/jobs/j-abc123';
const expected = (role, extra = {}) => ({ jobId, role, jobDir, ...(role === 'wine' ? { appArmor: 'unavailable' } : {}), ...extra });
const valuesOf = (args, flag) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));

// --- containers: the wine role ------------------------------------------------------------------------------------------------------

test('wine role: runc, 128 pids, a prefix tmpfs that may execute, the sample and the home volume, and the Wine seccomp profile', () => {
  assert.equal(ROLE_RUNTIME.wine, 'runc');
  assert.equal(pidsLimitFor('wine'), 128);
  assert.equal(pidsLimitFor('detonate'), LIMITS.pidsLimit);
  assert.equal(WINE_PIDS_LIMIT, 128);
  assert.deepEqual(tmpfsFor('wine'), { '/tmp': 'rw,nosuid,nodev,size=64m', '/prefix': 'rw,exec,nosuid,nodev,size=192m,uid=10001,gid=10001,mode=0700' });
  assert.deepEqual(tmpfsFor('detonate'), { '/tmp': 'rw,nosuid,nodev,size=64m' });
  assert.deepEqual(mountsFor(jobId, 'wine', jobDir), [
    { type: 'bind', source: `${jobDir}/sample.bin`, target: '/in/sample', readOnly: true },
    { type: 'volume', source: 'do-j-abc123-home', target: '/home/dana', readOnly: false },
  ]);
  const wineSpec = { jobId, role: 'wine', image: 'detonation-ocean/wine', jobDir, command: ['--kind', 'exe'] };
  assert.throws(() => buildContainerArgs(wineSpec), /explicit approval/);
  assert.throws(() => buildContainerArgs({ ...wineSpec, wineApproved: true }), /verified AppArmor capability decision/);
  const args = buildContainerArgs({ ...wineSpec, wineApproved: true, appArmor: 'unavailable' });
  assert.equal(valuesOf(args, '--runtime')[0], 'runc');
  assert.deepEqual(valuesOf(args, '--security-opt'), ['no-new-privileges:true', `seccomp=${SECCOMP_WINE_FILE}`]);
  assert.match(SECCOMP_WINE_FILE.replace(/\\/g, '/'), /deploy\/detonation\/seccomp-wine\.json$/);
  assert.deepEqual([valuesOf(args, '--pids-limit')[0], valuesOf(args, '--ulimit')[0], valuesOf(args, '--memory')[0], valuesOf(args, '--network')[0]], ['128', 'nproc=128:128', '512m', 'none']);
  assert.ok(args.includes('--read-only') && args.includes('--cap-drop'));
  assert.deepEqual(args.slice(-3), ['detonation-ocean/wine', '--kind', 'exe']);
  const other = buildContainerArgs({ jobId, role: 'detonate', image: 'x', jobDir });
  assert.deepEqual(valuesOf(other, '--security-opt'), ['no-new-privileges:true'], 'no other role gets a seccomp option');
});

test('wine role: the recorded docker inspect passes the isolation check, and each altered flag fails it', () => {
  const record = verifyIsolation(fixture('wine'), expected('wine'));
  assert.deepEqual([record.role, record.runtime, record.pidsLimit, record.memoryBytes, record.appArmor], ['wine', 'runc', 128, LIMITS.memoryBytes, 'unavailable']);
  assert.throws(() => verifyIsolation(fixture('wine'), expected('wine', { appArmor: undefined })), /apparmor/);
  assert.equal(JSON.parse(fixture('wine'))[0].Image, loadImageLock()['detonation-ocean/wine'], 'the fixture carries the digest images.lock.json pins (run sync-image-ids.mjs after a rebuild)');
  const fails = (change, problem, spec = expected('wine')) => assert.throws(() => verifyIsolation(mutated('wine', change), spec), new RegExp(`isolation check failed:.*\\b${problem}\\b`));
  fails(c => { c.HostConfig.Runtime = 'runsc'; }, 'runtime');
  fails(c => { c.HostConfig.PidsLimit = 512; }, 'pids-limit');
  fails(c => { c.HostConfig.SecurityOpt = ['no-new-privileges:true']; }, 'security-opt');
  fails(c => { c.HostConfig.SecurityOpt = c.HostConfig.SecurityOpt.filter(option => !option.startsWith('seccomp=')).concat('seccomp=unconfined'); }, 'security-opt');
  fails(c => { c.HostConfig.SecurityOpt = [...c.HostConfig.SecurityOpt, 'apparmor=unconfined']; }, 'security-opt');
  fails(c => { const profile = JSON.parse(c.HostConfig.SecurityOpt[1].slice(8)); profile.defaultAction = 'SCMP_ACT_ALLOW'; c.HostConfig.SecurityOpt[1] = `seccomp=${JSON.stringify(profile)}`; }, 'security-opt');
  fails(c => { delete c.HostConfig.Tmpfs['/prefix']; }, 'tmpfs');
  fails(c => { c.HostConfig.Tmpfs['/prefix'] = 'rw,nosuid,nodev,size=192m,uid=10001,gid=10001,mode=0700'; }, 'tmpfs');
  fails(c => { c.HostConfig.NetworkMode = 'bridge'; }, 'network-mode');
  fails(c => { c.HostConfig.CapAdd = ['SYS_ADMIN']; }, 'privileged');
  fails(c => { c.Mounts = c.Mounts.filter(mount => mount.Destination !== '/in/sample'); }, 'mounts');
  fails(c => { c.Image = 'sha256:ffff'; }, 'image');
  assert.throws(() => verifyIsolation(fixture('wine'), expected('detonate')), /isolation check failed/);
  assert.throws(() => verifyIsolation(fixture('detonate'), expected('wine')), /isolation check failed/);
  assert.throws(() => verifyIsolation(mutated('detonate', c => { c.HostConfig.SecurityOpt = [...c.HostConfig.SecurityOpt, 'seccomp={}']; }), expected('detonate')), /security-opt/);
});

test('analyse role as a parser run: it mounts its script and the one file at /in/sample, not the evidence', () => {
  const plain = mountsFor(jobId, 'analyse', jobDir).map(mount => mount.target);
  assert.deepEqual(plain, ['/in/evidence.json', '/in/diff.json', '/in/static.json', '/in/script.py']);
  assert.deepEqual(mountsFor(jobId, 'analyse', jobDir, { parserSample: 'sample' }).map(mount => [mount.source.split('/').at(-1), mount.target]), [['script.py', '/in/script.py'], ['sample.bin', '/in/sample']]);
  assert.deepEqual(mountsFor(jobId, 'analyse', jobDir, { parserSample: 'parser' }).map(mount => [mount.source.split('/').at(-1), mount.target]), [['script.py', '/in/script.py'], ['parser-sample.bin', '/in/sample']]);
  assert.deepEqual(mountsFor(jobId, 'detonate', jobDir, { parserSample: 'sample' }), mountsFor(jobId, 'detonate', jobDir), 'only the analyse role takes the option');
  const args = buildContainerArgs({ jobId, role: 'analyse', image: 'x', jobDir, parserSample: 'parser' });
  assert.deepEqual(valuesOf(args, '--mount'), [`type=bind,src=${jobDir}/script.py,dst=/in/script.py,readonly`, `type=bind,src=${jobDir}/parser-sample.bin,dst=/in/sample,readonly`]);
  // The recorded analyse container has the four evidence mounts: it is not a parser container, and the check says so.
  assert.throws(() => verifyIsolation(fixture('analyse'), expected('analyse', { parserSample: 'sample' })), /mounts/);
  assert.doesNotThrow(() => verifyIsolation(fixture('analyse'), expected('analyse')));
});

// --- receipts ---------------------------------------------------------------------------------------------------------------------------

const record = (role, extra = {}) => ({
  role, runtime: ROLE_RUNTIME[role], network: 'none', readOnlyRoot: true, capDrop: ['ALL'], user: LIMITS.user, memoryBytes: LIMITS.memoryBytes, pidsLimit: pidsLimitFor(role),
  nanoCpus: LIMITS.nanoCpus, secretEnvVars: 0, createdAt: '2026-01-01T00:00:00.000Z', exit: { code: 0, reason: null },
  ...(role === 'wine' ? { appArmor: 'unavailable' } : {}), ...extra,
});
const receiptOf = containers => buildReceipt({
  jobId, containers, teardown: { confirmed: true, removedAt: '2026-01-01T00:01:00.000Z', errors: [] }, uploadDeleted: true, hostCanary: 'unchanged', inference: { provider: 'p', calls: 0, model: null },
});

test('receipt: a wine container is valid at 128 pids on runc and the receipt says it ran without gVisor; other roles keep 512 and no note', () => {
  const withWine = receiptOf([record('detonate'), record('wine'), record('collect')]);
  assert.deepEqual(validateReceipt(withWine), { ok: true, problems: [] });
  assert.deepEqual(withWine.notes, [WINE_NOTE]);
  assert.deepEqual(validateReceipt(receiptOf([record('detonate'), record('wine', { appArmor: undefined }), record('collect')])).problems, ['containers[1].appArmor']);
  assert.match(WINE_NOTE, /^Ran under Wine without gVisor/);
  assert.equal(withWine.containers[1].runtime, 'runc');
  const without = receiptOf([record('detonate'), record('collect')]);
  assert.equal(without.notes, undefined);
  assert.deepEqual(validateReceipt(receiptOf([record('detonate'), record('wine', { pidsLimit: 512 }), record('collect')])).problems, ['containers[1].pidsLimit']);
  assert.deepEqual(validateReceipt(receiptOf([record('detonate', { pidsLimit: 128 }), record('collect')])).problems, ['containers[0].pidsLimit']);
  assert.deepEqual(validateReceipt(receiptOf([record('detonate'), record('wine', { runtime: 'runsc' }), record('collect')])).problems, ['containers[1].runtime']);
});

// --- job pipeline ---------------------------------------------------------------------------------------------------------------------

const ENV = { DETONATION_ENABLED: 'true', UPLOAD_ENCRYPTION_KEY: 'a1'.repeat(32), VULTR_INFERENCE_API_KEY: 'fake-inference-key-0000' };
const NO_MODEL = { available: () => false, complete: async () => { throw new Error('no model'); } };
const AT = '2026-01-01T00:00:00.000Z';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(25, 1)]);
const exe = () => { const pe = Buffer.alloc(256); pe.write('MZ'); pe.writeUInt32LE(0x80, 0x3c); pe.write('PE\0\0', 0x80, 'latin1'); return pe; };
const UNKNOWN = Buffer.concat([Buffer.from('BLOB'), Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256))]); // typed 'unknown'
const BAT = Buffer.from('@echo off\r\necho hi\r\n');
const events = (job, name) => job.events.filter(item => item.event === name).map(item => item.data);

function recordOf(role) { return record(role); }
function setup({ env = ENV, inference = NO_MODEL, stages = {}, caps } = {}) {
  const calls = [];
  const state = { containers: [] };
  const controller = createJobController({
    env, dataDir: mkdtempSync(join(tmpdir(), 'do-m4b-')), docker: async args => answerContainerCall(args, state) ?? { code: 0, stdout: '', stderr: '' }, logger() {}, inference, caps,
    stages: {
      async detonate(ctx) {
        calls.push({ index: ctx.itemIndex, type: ctx.typed.detectedType, path: ctx.typed.path, inspectOnly: ctx.typed.inspectOnly, depthExceeded: ctx.unwrapDepthExceeded, timeLeft: ctx.timeLeftMs?.(), head: ctx.item?.head ?? ctx.head });
        ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: true, kind: 'identify' };
        return { containers: [recordOf('detonate')], evidence: [], coverage: [{ step: 'emulate', status: 'done', detail: 'Emulated.' }] };
      },
      parseTrace: async () => [],
      collect: async () => ({ containers: [recordOf('collect')], evidence: [] }),
      analyse: async ctx => ({ verdict: ctx.verdict, attempts: [], artifacts: {}, scriptOk: false, modelAvailable: false, explanation: 'x', containers: [recordOf('analyse')] }),
      ...stages,
    },
  });
  return { controller, calls };
}
async function run({ controller }, file, claimedName) {
  await controller.start();
  const { jobId: id } = controller.submit({ file, claimedName, ip: '203.0.113.7' });
  await controller.idle();
  controller.stop();
  return controller.getJob(id);
}

test('routes: without DETONATION_WINE_RUNC an exe is typed "emulate" and a batch file "inspect"; with it both are "wine" (label "Ran under Wine")', async () => {
  const typedOf = async (env, file, name) => events(await run(setup({ env }), file, name), 'typed')[0];
  const off = { exe: await typedOf(ENV, exe(), 'a.exe'), bat: await typedOf(ENV, BAT, 'a.bat') };
  assert.deepEqual([off.exe.path, off.exe.label, off.bat.path, off.bat.label], ['emulate', 'Emulated', 'inspect', 'Inspected']);
  const on = { exe: await typedOf({ ...ENV, DETONATION_WINE_RUNC: 'true' }, exe(), 'a.exe'), bat: await typedOf({ ...ENV, DETONATION_WINE_RUNC: 'true' }, BAT, 'a.bat') };
  assert.deepEqual([on.exe.path, on.exe.label, on.bat.path, on.bat.label], ['wine', 'Ran under Wine', 'wine', 'Ran under Wine']);
  const wrong = await typedOf({ ...ENV, DETONATION_WINE_RUNC: 'yes' }, exe(), 'a.exe');
  assert.equal(wrong.path, 'emulate', 'only the exact value "true" approves Wine');
});

test('the item takes the route that really ran: Wine failed and the emulator ran, so the report says emulate; artifacts and the identify text reach the report', async () => {
  const harness = setup({
    env: { ...ENV, DETONATION_WINE_RUNC: 'true' },
    stages: {
      async detonate(ctx) {
        ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: true, kind: 'identify' };
        return {
          containers: [recordOf('detonate'), recordOf('wine')], evidence: [], path: 'emulate', label: 'Emulated', identify: 'PE x64 console; unsigned',
          coverage: [{ step: 'wine', status: 'failed', detail: 'Wine could not run it.' }, { step: 'emulate', status: 'done', detail: 'Emulated.' }],
          artifacts: { 'wine-i0-2s.png': PNG, 'bad name.png': PNG, 'notes.exe': Buffer.from('x') },
        };
      },
    },
  });
  const job = await run(harness, exe(), 'a.exe');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.equal(events(job, 'typed')[0].path, 'wine', 'the typed event comes before the run');
  assert.equal(job.report.file.path, 'emulate');
  assert.deepEqual(events(job, 'coverage')[0].steps.map(step => [step.step, step.status]), [['identify', 'done'], ['wine', 'failed'], ['emulate', 'done']]);
  assert.equal(events(job, 'coverage')[0].steps[0].detail, 'Identified as exe: Emulated. PE x64 console; unsigned.');
  assert.deepEqual([...job.artifacts.keys()], ['wine-i0-2s.png'], 'only allowlisted names are kept');
  assert.equal(job.report.receipt.containers.filter(item => item.role === 'wine').length, 1);
  assert.deepEqual(job.report.receipt.notes, [WINE_NOTE]);
});

test('an item nothing ran for (every step skipped) is inspect-only, so the verdict is incomplete', async () => {
  const harness = setup({
    stages: {
      async detonate(ctx) {
        ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: false, kind: 'identify' };
        return { containers: [recordOf('detonate')], evidence: [], path: 'inspect', label: 'Inspected', coverage: [{ step: 'static', status: 'done', detail: 'x' }] };
      },
    },
  });
  const job = await run(harness, exe(), 'a.exe');
  assert.equal(job.report.file.path, 'inspect');
  assert.ok(job.report.verdict.signals.includes('incomplete'));
});

test('the chain gets what it needs from the job: the first bytes of the upload, the time left and the depth flag', async () => {
  const harness = setup();
  await run(harness, exe(), 'a.exe');
  assert.deepEqual([harness.calls[0].depthExceeded, harness.calls[0].head.subarray(0, 2).toString()], [false, 'MZ']);
  assert.ok(harness.calls[0].timeLeft > 0 && harness.calls[0].timeLeft <= 180_000 - 70_000, 'the reserve for collecting, analysing and explaining is kept back');
});

test('a part of an Electron app or PyInstaller bundle is a child that is read, never run: its path is inspect and it is flagged inspectOnly', async () => {
  const js = Buffer.from('WScript.Echo("x");\n');
  const seen = [];
  const harness = setup({
    stages: {
      async detonate(ctx) {
        seen.push([ctx.itemIndex, ctx.typed.detectedType, ctx.typed.path, ctx.typed.inspectOnly]);
        ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: true, kind: 'identify' };
        const children = ctx.itemIndex === 0 ? [{ name: 'main.js', size: js.length, path: '/home/dana/Downloads/.unpacked/0/0.dat', head: js, inspectOnly: true }] : undefined;
        return { containers: [recordOf('detonate')], evidence: [], coverage: [{ step: 'unwrap', status: 'done', detail: 'Unwrapped.' }], children };
      },
    },
  });
  const job = await run(harness, exe(), 'a.exe');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual(seen, [[0, 'exe', 'emulate', undefined], [1, 'js-wsh', 'inspect', true]]);
});

test('archives deeper than 3 levels stop at the boundary and expose the depth flag', async () => {
  const exePart = exe();
  let depth = 0;
  const seen = [];
  const harness = setup({
    stages: {
      async detonate(ctx) {
        seen.push([ctx.itemIndex, ctx.unwrapDepthExceeded]);
        ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: true, kind: 'identify' };
        depth += 1;
        return { containers: [recordOf('detonate')], evidence: [], coverage: [], children: depth <= 4 ? [{ name: 'x.exe', size: exePart.length, path: `/home/dana/Downloads/.unpacked/${ctx.itemIndex}/0.dat`, head: exePart }] : undefined };
      },
    },
  });
  const job = await run(harness, exe(), 'a.exe');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual(seen, [[0, false], [1, false], [2, false], [3, true]]);
  assert.ok(events(job, 'evidence').some(item => item.reason === 'unpack-depth'));
  assert.ok(events(job, 'coverage').find(item => item.item === 3)?.steps.some(step => step.step === 'unwrap' && step.status === 'stopped'));
});

// --- AT-21: the model-written parser ---------------------------------------------------------------------------------------------------

const fence = code => `\`\`\`python\n${code}\n\`\`\``;
const signalsFile = ids => Buffer.from(JSON.stringify(ids));

function parserHarness({ available = true, attempts, replies } = {}) {
  const scripts = [];
  const prompts = [];
  const inference = {
    available: () => available,
    complete: async messages => { prompts.push(messages); return replies?.shift() ?? fence('print("parser")'); },
  };
  const stageCalls = [];
  const harness = setup({
    inference,
    stages: {
      async detonate(ctx) {
        ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: false, kind: 'generic' };
        return { containers: [recordOf('detonate')], evidence: [], coverage: [{ step: 'generic', status: 'done', detail: 'Strings.' }], parse: { bytes: Buffer.from('FORMAT-MAGIC\x00\x01\x02') } };
      },
      async runScript(code, ctx) {
        scripts.push({ code, parser: ctx.parser && { file: ctx.parser.file, bytes: ctx.parser.bytes.toString('latin1') } });
        stageCalls.push(ctx.itemIndex);
        const next = attempts.shift();
        return { exitCode: next.exitCode, stderr: next.stderr ?? '', artifacts: next.signals ? { 'signals.json': signalsFile(next.signals) } : {} };
      },
    },
  });
  return { ...harness, scripts, prompts, stageCalls };
}

test('AT-21: an unknown format gets a model-written parser; a crash is retried with its stderr; the result adds no finding deeper than Twilight', async () => {
  const harness = parserHarness({
    attempts: [{ exitCode: 1, stderr: 'Traceback: KeyError magic' }, { exitCode: 0, signals: ['obfuscated', 'not-a-signal', 'anti-analysis'] }],
    replies: [fence('raise KeyError("magic")'), fence('open("signals.json","w").write("[]")')],
  });
  const job = await run(harness, UNKNOWN, 'blob.bin');
  assert.equal(job.state, 'done', job.error ?? '');
  const attempts = events(job, 'parser-attempt');
  assert.deepEqual(attempts.map(attempt => [attempt.n, attempt.exitCode]), [[1, 1], [2, 0]]);
  assert.match(attempts[0].stderr, /KeyError magic/);
  assert.match(JSON.stringify(harness.prompts[1]), /Traceback: KeyError magic/, 'the second prompt carries the first run\'s stderr');
  assert.match(JSON.stringify(harness.prompts[0]), /46 4f 52 4d 41 54/, 'the first prompt carries the hex dump of the head');
  assert.deepEqual(harness.scripts.map(script => script.parser.file), ['sample', 'sample'], 'the upload itself is /in/sample');
  const { verdict, evidence } = job.report;
  assert.deepEqual(verdict.findings, []);
  assert.equal(verdict.depth, 'twilight');
  assert.ok(verdict.signals.includes('obfuscated') && verdict.signals.includes('anti-analysis'));
  assert.ok(!verdict.signals.includes('not-a-signal'));
  assert.deepEqual(evidence.filter(item => /model-written parser/.test(item.technique ?? '')).map(item => item.kind).sort(), ['anti-analysis', 'obfuscation']);
  const steps = events(job, 'coverage')[0].steps;
  assert.deepEqual(steps.map(step => [step.step, step.status]), [['identify', 'done'], ['generic', 'done'], ['parser', 'done']]);
  assert.equal(steps[2].detail, 'A model-written parser ran (2 attempt(s)) and reported 2 signal(s).');
});

test('AT-21: three crashing parsers end the loop: the parser step failed and the item is incomplete; no signals come from the model', async () => {
  const harness = parserHarness({ attempts: [{ exitCode: 1, stderr: 'a' }, { exitCode: 1, stderr: 'b' }, { exitCode: 1, stderr: 'c' }] });
  const job = await run(harness, UNKNOWN, 'blob.bin');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.equal(events(job, 'parser-attempt').length, 3);
  assert.deepEqual(events(job, 'coverage')[0].steps.at(-1), { step: 'parser', status: 'failed', detail: 'The model-written parser did not produce a result after 3 attempt(s).' });
  assert.ok(job.report.evidence.some(item => item.kind === 'emulation-stopped' && item.reason === 'parser-failed'));
  assert.deepEqual([job.report.verdict.findings.length, job.report.verdict.depth], [0, 'twilight']);
});

test('AT-21: without a model the parser step is skipped and says so; with too little job time left it is skipped for the budget', async () => {
  const none = parserHarness({ available: false, attempts: [] });
  const job = await run(none, UNKNOWN, 'blob.bin');
  assert.deepEqual(events(job, 'coverage')[0].steps.at(-1), { step: 'parser', status: 'skipped', detail: 'Parser: skipped (no model is available).' });
  assert.deepEqual(none.scripts, []);
  assert.equal(events(job, 'parser-attempt').length, 0);

  const tight = parserHarness({ attempts: [] });
  const late = setup({ inference: { available: () => true, complete: async () => fence('x') }, caps: { job: 60_000 }, stages: { detonate: async ctx => { ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: false, kind: 'generic' }; return { containers: [recordOf('detonate')], evidence: [], coverage: [], parse: { bytes: Buffer.from('x') } }; } } });
  const lateJob = await run(late, UNKNOWN, 'blob.bin');
  assert.deepEqual(events(lateJob, 'coverage')[0].steps.at(-1), { step: 'parser', status: 'skipped', detail: 'Parser: skipped (job time budget).' });
  assert.ok(lateJob.report.evidence.some(item => item.reason === 'job-budget'));
  assert.deepEqual(tight.scripts, []);
});

test('AT-21: a child of an unknown format gets the parser too; its head is written for it and its attempts name the item', async () => {
  const child = Buffer.from('CHILD-FORMAT');
  const dockerState = { containers: [] };
  const harness = { scripts: [] };
  const job = await run({
    controller: createJobController({
      env: ENV, dataDir: mkdtempSync(join(tmpdir(), 'do-m4b-')), docker: async args => answerContainerCall(args, dockerState) ?? { code: 0, stdout: '', stderr: '' }, logger() {},
      inference: { available: () => true, complete: async () => fence('print(1)') },
      stages: {
        async detonate(ctx) {
          ctx.detonation = { id: 'a'.repeat(64), record: recordOf('detonate'), runnable: false, kind: 'generic' };
          const root = ctx.itemIndex === 0;
          return {
            containers: [recordOf('detonate')], evidence: [], coverage: [{ step: 'generic', status: 'done', detail: 'x' }], parse: { bytes: root ? Buffer.from('ROOT') : child },
            children: root ? [{ name: 'c.bin', size: child.length, path: '/home/dana/Downloads/.unpacked/0/0.dat', head: Buffer.alloc(8, 9), inspectOnly: false }] : undefined,
          };
        },
        parseTrace: async () => [], collect: async () => ({ containers: [recordOf('collect')], evidence: [] }),
        analyse: async ctx => ({ verdict: ctx.verdict, attempts: [], artifacts: {}, scriptOk: false, modelAvailable: false, explanation: 'x', containers: [recordOf('analyse')] }),
        async runScript(code, ctx) { harness.scripts.push({ item: ctx.itemIndex, file: ctx.parser.file, bytes: ctx.parser.bytes.toString('latin1') }); return { exitCode: 0, stderr: '', artifacts: { 'signals.json': signalsFile(['other-suspicious']) } }; },
      },
    }),
  }, UNKNOWN, 'blob.bin');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual(harness.scripts.map(script => [script.item, script.file, script.bytes]), [[0, 'sample', 'ROOT'], [1, 'parser', 'CHILD-FORMAT']]);
  assert.deepEqual(events(job, 'parser-attempt').map(attempt => attempt.item), [undefined, 1]);
  assert.equal(job.report.verdict.findings.length, 0);
});
