// Child items (SPEC 5.3, 6.6): an archive or email entry becomes its own item with its own detonate call; caps stop unpacking and add
// `incomplete`; coverage events are sent per item; the job verdict is the deepest of all items. Stages are mocks (no Docker).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobController } from '../backend/detonation/jobs.mjs';
import { runnerKind } from '../backend/detonation/stages.mjs';
import { answerContainerCall } from './fixtures/detonation/fake-container-calls.mjs';

const ENV = { DETONATION_ENABLED: 'true', UPLOAD_ENCRYPTION_KEY: 'a1'.repeat(32), VULTR_INFERENCE_API_KEY: 'fake-inference-key-0000' };
const NO_MODEL = { available: () => false, complete: async () => { throw new Error('no model'); } };
const AT = '2026-01-01T00:00:00.000Z';
const ZIP = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(30)]); // typed zip: a local header with an empty name
const PY = Buffer.from('import os\nprint(os.name)\n');
const PS1 = Buffer.from('Write-Output "hello"\n');
const HTML = Buffer.from('<!doctype html><html><body>x</body></html>');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = (() => { const pe = Buffer.alloc(256); pe.write('MZ'); pe.writeUInt32LE(0x80, 0x3c); pe.write('PE\0\0', 0x80, 'latin1'); return pe; })();

const record = role => ({
  role, runtime: role === 'detonate' ? 'runsc-trace' : 'runsc', network: 'none', readOnlyRoot: true, capDrop: ['ALL'], user: '10001:10001',
  memoryBytes: 512 * 1024 * 1024, pidsLimit: 512, nanoCpus: 1_000_000_000, secretEnvVars: 0, createdAt: '2026-01-01T00:00:00.000Z', exit: { code: 0, reason: null },
});
const child = (name, data, { size = data.length, parentIndex = 0, entryIndex = 0 } = {}) => ({ name, size, path: `/home/dana/Downloads/.unpacked/${parentIndex}/${entryIndex}.dat`, head: data });
const names = job => job.events.map(item => (item.event === 'stage' ? `stage:${item.data.stage}` : item.event));
const events = (job, name) => job.events.filter(item => item.event === name).map(item => item.data);

// docker answers just enough for the holder and seed containers, ps and rm calls of a job with no containers left over
function fakeDocker() {
  const state = { containers: [] };
  return async args => answerContainerCall(args, state) ?? { code: 0, stdout: '', stderr: '' };
}

/**
 * `plan(ctx, calls)` returns what the mock runner gives back for an item. Every detonate call is recorded in `calls`.
 * `trace[itemIndex]` is what parseTrace returns for that item.
 */
function setup({ plan = () => ({}), trace = {}, time, caps } = {}) {
  const calls = [];
  const clock = { now: Date.parse('2026-01-01T00:00:00Z') };
  const controller = createJobController({
    env: ENV, dataDir: mkdtempSync(join(tmpdir(), 'do-children-')), docker: fakeDocker(), clock: () => new Date(clock.now), logger() {}, inference: NO_MODEL, caps,
    stages: {
      async detonate(ctx) {
        calls.push({ index: ctx.itemIndex, type: ctx.typed.detectedType, path: ctx.typed.path, from: ctx.item?.from, budget: ctx.budget && { ...ctx.budget }, kind: runnerKind(ctx.typed) });
        ctx.detonation = { id: 'a'.repeat(64), record: record('detonate'), runnable: runnerKind(ctx.typed) !== undefined, kind: runnerKind(ctx.typed) };
        time?.(clock, ctx.itemIndex);
        return { containers: [record('detonate')], evidence: [], coverage: runnerKind(ctx.typed) ? [{ step: 'run', status: 'done', detail: `ran item ${ctx.itemIndex}` }] : undefined, ...plan(ctx, calls) };
      },
      parseTrace: async ctx => trace[ctx.itemIndex] ?? [],
      collect: async () => ({ containers: [record('collect')], evidence: [] }),
      analyse: async ctx => ({ verdict: ctx.verdict, attempts: [], artifacts: {}, scriptOk: false, modelAvailable: false, explanation: 'x', containers: [record('analyse')] }),
    },
  });
  return { controller, calls, clock };
}

async function run({ controller }, file, claimedName) {
  await controller.start();
  const { jobId } = controller.submit({ file, claimedName, ip: '203.0.113.7' });
  await controller.idle();
  controller.stop();
  return controller.getJob(jobId);
}

test('an archive\'s entries are typed from their first bytes and each gets its own detonate call, coverage event and evidence tag', async () => {
  const harness = setup({
    plan: ctx => (ctx.itemIndex === 0 ? { children: [child('clean-chart.py', PY, { parentIndex: ctx.itemIndex, entryIndex: 0 }), child('obfuscated-hello.ps1', PS1, { parentIndex: ctx.itemIndex, entryIndex: 1 })], coverage: [{ step: 'unwrap', status: 'done', detail: 'Unpacked 2 entries.' }] } : {}),
  });
  const job = await run(harness, ZIP, 'bundle.zip');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual(harness.calls.map(({ index, type, path, kind }) => [index, type, path, kind]), [[0, 'zip', 'inspect', 'zip'], [1, 'py', 'run', 'py'], [2, 'ps1', 'run', 'ps1']]);
  assert.equal(harness.calls[0].from, undefined);
  assert.match(harness.calls[1].from, /^\/home\/dana\/Downloads\/\.unpacked\/0\/\d+\.dat$/);
  assert.deepEqual(harness.calls[0].budget, { entries: 50, bytes: 50 * 1024 * 1024 });
  assert.deepEqual(harness.calls[1].budget, { entries: 48, bytes: 50 * 1024 * 1024 - PY.length - PS1.length });
  assert.equal(events(job, 'typed').length, 1, 'the typed event describes the upload only');
  assert.deepEqual(events(job, 'coverage').map(({ item, parent, steps }) => [item, parent, steps.map(step => step.step)]), [[0, null, ['identify', 'unwrap']], [1, 0, ['identify', 'run']], [2, 0, ['identify', 'run']]]);
  assert.equal(events(job, 'coverage')[0].steps[0].detail, 'Identified as zip: Unpacked.');
  assert.equal(events(job, 'coverage')[1].steps[0].detail, 'Identified as py: Executed on Linux.');
  assert.ok(!JSON.stringify(job.events).includes('clean-chart') && !JSON.stringify(job.events).includes('obfuscated-hello'), 'no entry name reaches an event');
  assert.equal(job.report.receipt.containers.filter(item => item.role === 'detonate').length, 3);
});

test('the job verdict is the deepest child verdict: findings and signals of every item, evidence tagged with the item that produced it', async () => {
  const harness = setup({
    plan: ctx => {
      if (ctx.itemIndex === 0) return { children: [child('a.py', PY, { parentIndex: ctx.itemIndex, entryIndex: 0 }), child('b.ps1', PS1, { parentIndex: ctx.itemIndex, entryIndex: 1 })] };
      if (ctx.itemIndex === 2) return { evidence: [{ source: 'static', kind: 'obfuscation', detail: 'base64', at: AT, technique: 'base64 decoding' }] };
      return {};
    },
    trace: { 1: [{ source: 'trace', kind: 'file-read', path: '/home/dana/.aws/credentials', detail: 'read', at: AT }] },
  });
  const job = await run(harness, ZIP, 'bundle.zip');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.equal(job.report.verdict.depth, 'midnight');
  assert.deepEqual(job.report.verdict.findings.map(finding => finding.id), ['steal-credentials']);
  assert.ok(job.report.verdict.signals.includes('obfuscated'));
  assert.equal(job.report.verdict.complete, true);
  const byKind = Object.fromEntries(job.report.evidence.map(item => [item.kind, item.item]));
  assert.deepEqual([byKind['file-read'], byKind.obfuscation], [1, 2]);
  assert.deepEqual(job.report.file, { detectedType: 'zip', claimedExtension: 'zip', path: 'inspect', sizeBytes: ZIP.length });
});

test('the deepest complete child keeps its finding when a sibling is incomplete', async () => {
  const harness = setup({
    plan: ctx => {
      if (ctx.itemIndex === 0) return { children: [child('access.py', PY, { parentIndex: ctx.itemIndex, entryIndex: 0 }), child('partial.py', PY, { parentIndex: ctx.itemIndex, entryIndex: 1 })] };
      if (ctx.itemIndex === 2) return { evidence: [
        { source: 'diff', kind: 'added', path: '/home/dana/Documents/READ_ME_TO_DECRYPT.txt', detail: 'ransom note', at: AT, seeded: false },
        { source: 'static', kind: 'emulation-stopped', detail: 'The child stopped before completion.', at: AT, reason: 'emulator-timeout' },
      ] };
      return {};
    },
    trace: { 1: [{ source: 'trace', kind: 'file-read', path: '/home/dana/.aws/credentials', detail: 'read', at: AT }] },
  });
  const job = await run(harness, ZIP, 'bundle.zip');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual([job.report.verdict.depth, job.report.verdict.complete], ['midnight', false]);
  assert.deepEqual(job.report.verdict.findings.map(finding => finding.id).sort(), ['encrypt', 'steal-credentials']);
  assert.ok(job.report.verdict.signals.includes('incomplete'));
  assert.ok(job.report.evidence.some(item => item.item === 2 && item.reason === 'emulator-timeout'));
});

test('a clean child run completes the archive: Sunlight is possible though the upload is typed inspect', async () => {
  const harness = setup({ plan: ctx => (ctx.itemIndex === 0 ? { children: [child('a.py', PY, { parentIndex: ctx.itemIndex })] } : {}) });
  const job = await run(harness, ZIP, 'bundle.zip');
  assert.deepEqual([job.report.verdict.depth, job.report.verdict.complete, job.report.verdict.signals], ['sunlight', true, []]);
});

test('an entry the build does not run (a PNG) is inspected only and makes the verdict incomplete', async () => {
  const harness = setup({ plan: ctx => (ctx.itemIndex === 0 ? { children: [child('a.py', PY, { parentIndex: ctx.itemIndex, entryIndex: 0 }), child('pic.png', PNG, { parentIndex: ctx.itemIndex, entryIndex: 1 })] } : {}) });
  const job = await run(harness, ZIP, 'bundle.zip');
  const item = job.report.evidence.find(evidence => evidence.kind === 'unsupported-type');
  assert.deepEqual([item.item, item.detectedType], [2, 'png']);
  assert.deepEqual([job.report.verdict.depth, job.report.verdict.complete, job.report.verdict.signals], ['twilight', false, ['incomplete']]);
  assert.deepEqual(harness.calls.map(call => call.kind), ['zip', 'py', undefined], 'the PNG still goes to the runner as `inspect`');
  assert.deepEqual(events(job, 'coverage').at(-1), { item: 2, parent: 0, steps: [{ step: 'identify', status: 'done', detail: 'Identified as png: Inspected.' }, { step: 'run', status: 'skipped', detail: 'Inspected only: this type is not run.' }] });
});

test('a child whose content differs from its extension gets the type-mismatch signal (AT-14 for an entry)', async () => {
  const harness = setup({ plan: ctx => (ctx.itemIndex === 0 ? { children: [child('invoice.pdf.html', HTML, { parentIndex: ctx.itemIndex })] } : {}) });
  const job = await run(harness, ZIP, 'bundle.zip');
  const mismatch = job.report.evidence.find(evidence => evidence.kind === 'type-mismatch');
  assert.deepEqual([mismatch.item, mismatch.detectedType, mismatch.claimedExtension], [1, 'html', 'pdf']);
  assert.ok(job.report.verdict.signals.includes('type-mismatch'));
});

test('depth cap: an archive nested more than 3 levels deep is not unpacked; coverage says why and the verdict is incomplete (AT-13)', async () => {
  const harness = setup({ plan: ctx => (ctx.itemIndex < 4 ? { children: [child(`level-${ctx.itemIndex}.zip`, ZIP, { parentIndex: ctx.itemIndex })] } : {}) });
  const job = await run(harness, ZIP, 'bomb.zip');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual(harness.calls.map(call => call.index), [0, 1, 2], 'levels 1 to 3 are unpacked');
  const stopped = job.report.evidence.find(evidence => evidence.kind === 'emulation-stopped');
  assert.deepEqual([stopped.item, stopped.reason], [3, 'unpack-depth']);
  assert.deepEqual(events(job, 'coverage').at(-1), { item: 3, parent: 2, steps: [{ step: 'identify', status: 'done', detail: 'Identified as zip: Unpacked.' }, { step: 'run', status: 'skipped', detail: 'Not unpacked: archives nested more than 3 levels deep.' }] });
  assert.deepEqual([job.report.verdict.depth, job.report.verdict.complete, job.report.verdict.signals], ['twilight', false, ['incomplete']]);
});

test('entry cap: once 50 entries are unpacked no further archive is opened, other entries still run, and the budget shrinks', async () => {
  const harness = setup({
    plan: ctx => (ctx.itemIndex === 0 ? { children: [child('inner.zip', ZIP, { parentIndex: ctx.itemIndex, entryIndex: 0 }), ...Array.from({ length: 49 }, (_, index) => child(`f${index}.py`, PY, { parentIndex: ctx.itemIndex, entryIndex: index + 1 }))] } : {}),
  });
  const job = await run(harness, ZIP, 'many.zip');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.equal(harness.calls.length, 50, 'the upload and 49 scripts run; the inner archive is refused');
  assert.ok(harness.calls.every(call => call.index !== 1));
  assert.equal(harness.calls[1].budget.entries, 0);
  assert.deepEqual(job.report.evidence.filter(evidence => evidence.kind === 'emulation-stopped').map(evidence => [evidence.item, evidence.reason]), [[1, 'unpack-limit']]);
  assert.equal(job.report.verdict.complete, false);
});

test('byte cap: the 50 MB limit rejects a later entry before it reaches the job queue', async () => {
  const harness = setup({ plan: ctx => (ctx.itemIndex === 0 ? { children: [child('big.py', PY, { size: 50 * 1024 * 1024, parentIndex: ctx.itemIndex, entryIndex: 0 }), child('inner.zip', ZIP, { parentIndex: ctx.itemIndex, entryIndex: 1 })] } : {}) });
  const job = await run(harness, ZIP, 'big.zip');
  assert.deepEqual(harness.calls.map(call => call.index), [0, 1]);
  assert.deepEqual(job.report.evidence.filter(evidence => evidence.kind === 'emulation-stopped').map(evidence => evidence.reason), ['unpack-bytes']);
});

test('job time budget: an item that would not finish before the reserve for collecting and analysing is skipped, not run', async () => {
  const harness = setup({
    plan: ctx => (ctx.itemIndex === 0 ? { children: [child('a.py', PY, { parentIndex: ctx.itemIndex, entryIndex: 0 }), child('b.py', PY, { parentIndex: ctx.itemIndex, entryIndex: 1 })] } : {}),
    time: (clock, index) => { clock.now += index === 0 ? 80_000 : 0; },
  });
  const job = await run(harness, ZIP, 'slow.zip');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual(harness.calls.map(call => call.index), [0], 'neither child started');
  assert.deepEqual(job.report.evidence.filter(evidence => evidence.kind === 'emulation-stopped').map(evidence => [evidence.item, evidence.reason]), [[1, 'job-budget'], [2, 'job-budget']]);
  assert.deepEqual(events(job, 'coverage').slice(1).map(event => event.steps[1].status), ['skipped', 'skipped']);
  assert.equal(job.report.verdict.complete, false);
});

test('an exe is typed `emulate` and labelled Emulated; a coverage event is sent only when the stage reports coverage', async () => {
  const harness = setup();
  const job = await run(harness, EXE, 'setup.exe');
  assert.equal(job.state, 'done', job.error ?? '');
  assert.deepEqual([events(job, 'typed')[0].path, events(job, 'typed')[0].label], ['emulate', 'Emulated']);
  assert.deepEqual([harness.calls[0].path, harness.calls[0].kind], ['emulate', 'exe']);
  assert.equal(job.report.file.path, 'emulate');
  assert.equal(job.report.verdict.complete, true);

  const silent = createJobController({
    env: ENV, dataDir: mkdtempSync(join(tmpdir(), 'do-children-')), docker: fakeDocker(), logger() {}, inference: NO_MODEL,
    stages: {
      detonate: async () => ({ containers: [record('detonate')] }), parseTrace: async () => [], collect: async () => ({ containers: [record('collect')], evidence: [] }),
      analyse: async ctx => ({ verdict: ctx.verdict, attempts: [], artifacts: {}, scriptOk: false, modelAvailable: false, explanation: 'x', containers: [record('analyse')] }),
    },
  });
  await silent.start();
  const { jobId } = silent.submit({ file: PY, claimedName: 'a.py', ip: '203.0.113.8' });
  await silent.idle();
  silent.stop();
  assert.ok(!names(silent.getJob(jobId)).includes('coverage'));
});

test('runnerKind: scripts, documents, pages, executables and archives have a kind; inspect-only types and large files do not, except archives', () => {
  const kind = (detectedType, path = 'run') => runnerKind({ detectedType, path });
  assert.deepEqual(['py', 'sh', 'js-node', 'ps1', 'html', 'svg', 'pdf', 'docx', 'xlsm', 'doc', 'pptx'].map(type => kind(type)), ['py', 'sh', 'node', 'ps1', 'html', 'svg', 'pdf', 'office', 'office', 'office', 'office']);
  assert.equal(kind('exe', 'emulate'), 'exe');
  assert.deepEqual([kind('zip', 'inspect'), kind('eml', 'inspect')], ['zip', 'eml']);
  assert.deepEqual([kind('py', 'inspect'), kind('html', 'inspect'), kind('exe', 'inspect'), kind('bat', 'wine'), kind('png', 'inspect'), kind('vbs', 'wine')], [undefined, undefined, undefined, undefined, undefined, undefined]);
});
