// The M4b compatibility chain (SPEC 6.6; AT-19 to AT-24 without Docker): which containers each type gets, in which order, how Wine and the
// emulator hand over, and what the coverage list says. `run` is a mock that answers with the recorded runner lines of
// tests/fixtures/detonation/runner (printed by real containers) and records every container request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChain, chainFamily, isAsar } from '../backend/detonation/chain.mjs';
import { evaluate } from '../backend/detonation/findings.mjs';

const fixture = (dir, name) => JSON.parse(readFileSync(new URL(`./fixtures/detonation/${dir}/${name}.json`, import.meta.url), 'utf8'));
const runner = name => fixture('runner', name);
const line = value => `${JSON.stringify(value)}\n`;
const ID = 'a'.repeat(64);
const UNPACKED = '/home/dana/Downloads/.unpacked/0/0.dat';

// A plain executable's identify line: the recorded UPX one without the packer, the wrapper or the unwrapped part.
const plainIdentify = () => {
  const recorded = runner('identify-upx');
  return { ...recorded, identify: { ...recorded.identify, packers: [], wrapper: { kind: null, evidence: '' }, highEntropyCode: [] }, unwrap: null };
};
const dotnetIdentify = () => ({ ...plainIdentify(), identify: { ...plainIdentify().identify, dotnet: true, wrapper: { kind: 'dotnet', evidence: 'CLR header in the PE' } }, dotnet: { suspiciousPinvoke: [], oddNameRatio: 0, namesChecked: 0 } });

/** Builds the chain over a mock `run`; `answers` maps a runner kind (identify, exe, static, generic, unwrap) or `wine` to a function or a runner line. */
function setup({ answers = {}, wineApproved = false, typed, ctx: extra = {} } = {}) {
  const requests = [];
  const defaults = {
    identify: () => plainIdentify(), exe: () => fixture('emulator', 'exe-inert'), static: () => runner('static-pe'), generic: () => runner('generic-text'), wine: () => runner('wine-builtin'),
    unwrap: () => ({ detonationRunner: 1, kind: 'unwrap', started: true, unpack: { method: 'asar', format: 'asar', stopped: null, entries: [], listed: 0 } }),
  };
  const run = async (ctx, role, spec) => {
    const kind = role === 'wine' ? 'wine' : spec.command[0];
    requests.push({ role, kind, attempt: spec.attempt, command: spec.command, wallClockMs: spec.wallClockMs, outputCapBytes: spec.outputCapBytes });
    const answer = { ...defaults, ...answers }[kind];
    return { role, stdout: answer ? line(typeof answer === 'function' ? answer(spec) : answer) : '', inspectJson: JSON.stringify([{ Id: ID }]) };
  };
  const receiptRecord = result => ({ role: result.role, exit: { code: 0, reason: null } });
  const chain = createChain({ run, receiptRecord, wineApproved });
  const context = {
    clock: () => new Date('2026-01-01T00:00:00Z'), caps: { detonate: 30_000 }, itemIndex: 0, budget: { entries: 50, bytes: 50 * 1024 * 1024 },
    typed: { detectedType: 'exe', claimedExtension: 'exe', path: 'emulate', mismatch: false, sizeTier: 'full', ...typed }, ...extra,
  };
  return { requests, context, go: () => chain(context) };
}
const stepsOf = out => out.steps.map(step => [step.step, step.status]);
const kindsOf = requests => requests.map(request => request.kind);
const numbered = items => items.map((item, index) => ({ ...item, id: `ev-${index + 1}` }));
const verdictOf = (items, path) => evaluate({ evidence: numbered(items), path, canaryTokens: [] });

test('chainFamily: executables, Wine-only types, asar archives, inspect-only parts and big files', () => {
  const family = (detectedType, extra = {}, head) => chainFamily({ detectedType, sizeTier: 'full', ...extra }, head);
  assert.deepEqual(['exe', 'dll'].map(type => family(type)), ['pe', 'pe']);
  assert.deepEqual(['exe', 'dll'].map(type => family(type, { sizeTier: 'static' })), ['pe-static', 'pe-static']);
  assert.deepEqual(['msi', 'bat', 'vbs', 'js-wsh', 'hta'].map(type => family(type)), ['msi', 'wine-script', 'wine-script', 'wine-script', 'wine-script']);
  assert.equal(family('bat', { sizeTier: 'static' }), 'generic', 'a Wine-only type over 10 MB is not run');
  assert.equal(family('js-wsh', { inspectOnly: true }), 'generic', 'a part of an Electron app is read, never run under Wine');
  assert.equal(family('exe', { inspectOnly: true }), 'generic');
  const asar = Buffer.concat([Buffer.from([4, 0, 0, 0, 0x30, 0, 0, 0, 0x2c, 0, 0, 0, 0x28, 0, 0, 0]), Buffer.from('{"files":{}}')]);
  assert.equal(isAsar(asar), true);
  assert.equal(family('unknown', {}, asar), 'asar');
  assert.equal(family('unknown', {}, Buffer.alloc(64)), 'generic');
  assert.equal(isAsar(undefined), false);
});

test('an executable with Wine not approved: identify, emulate, static; the coverage list says Wine was skipped (not approved)', async () => {
  const { requests, context, go } = setup();
  const out = await go();
  assert.deepEqual(requests.map(request => [request.role, request.kind, request.attempt]), [['detonate', 'identify', 1], ['detonate', 'exe', 2], ['detonate', 'static', 3]]);
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'skipped'], ['emulate', 'done'], ['static', 'done']]);
  assert.equal(out.steps[1].detail, 'Wine: skipped (not approved)');
  assert.equal(out.steps[0].detail, 'Not a packer or installer: nothing to unwrap.');
  assert.deepEqual([out.path, out.label], ['emulate', 'Emulated']);
  assert.equal(out.identify, 'PE x64 console; unsigned');
  assert.equal(out.containers.length, 3);
  assert.deepEqual([context.detonation.id, context.detonation.runnable, context.detonation.kind], [ID, true, 'identify'], 'parseTrace reads the first container');
  assert.ok(out.evidence.some(item => item.source === 'emulator' && item.kind === 'api-call'));
  assert.ok(out.evidence.some(item => item.source === 'identify' && item.kind === 'unsigned'));
  assert.deepEqual(requests[0].command, ['identify', '--ext', 'exe', '--max-entries', '50', '--max-bytes', String(50 * 1024 * 1024)]);
  assert.deepEqual(requests[2].command, ['static', '--ext', 'exe', '--format', 'pe']);
  assert.ok(requests.every(request => request.wallClockMs === 30_000));
});

test('a child executable passes --from and its source size to every step', async () => {
  const from = '/home/dana/Downloads/.unpacked/0/1.dat';
  const size = 12_345;
  const { requests, go } = setup({ ctx: { itemIndex: 1, item: { from, size } } });
  await go();
  for (const request of requests) assert.deepEqual(request.command.slice(-4), ['--from', from, '--source-size', String(size)], request.kind);
});

test('AT-22: with Wine approved a program that writes a Run key and opens a window runs under Wine: persistence, screenshots, label "Ran under Wine"', async () => {
  const { requests, go } = setup({ wineApproved: true, answers: { wine: () => runner('wine-effects') } });
  const out = await go();
  assert.deepEqual(requests.map(request => [request.role, request.kind]), [['detonate', 'identify'], ['wine', 'wine'], ['detonate', 'static']]);
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'done'], ['emulate', 'skipped'], ['static', 'done']]);
  assert.equal(out.steps[2].detail, 'Emulation: not needed (Wine ran the program to its end).');
  assert.deepEqual([out.path, out.label], ['wine', 'Ran under Wine']);
  const wine = requests[1];
  assert.deepEqual(wine.command, ['--kind', 'exe', '--file', '/in/sample', '--ext', 'exe']);
  assert.equal(wine.outputCapBytes, 4.5 * 1024 * 1024, 'room for three screenshots on stdout');
  assert.equal(wine.attempt, undefined, 'the wine role has its own container names');
  assert.ok(Object.keys(out.artifacts).length >= 1 && Object.keys(out.artifacts).every(name => /^wine-i0-(?:2s|10s|exit)\.png$/.test(name)));
  assert.ok(out.evidence.some(item => item.source === 'registry' && item.kind === 'key-added'));
  assert.deepEqual(verdictOf(out.evidence, out.path).findings.map(finding => finding.id), ['persistence']);
});

test('AT-23: a program Wine cannot start fails within 2 s and the chain moves on to Speakeasy; the coverage list shows both', async () => {
  const { requests, go } = setup({ wineApproved: true, answers: { wine: () => runner('wine-missing-dll') } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify', 'wine', 'exe', 'static']);
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'failed'], ['emulate', 'done'], ['static', 'done']]);
  assert.match(out.steps[1].detail, /^Wine could not run it \(exit code 53/);
  assert.deepEqual([out.path, out.label], ['emulate', 'Emulated'], 'the label is what actually ran');
});

test('AT-24: a program that reads HKCU\\Software\\Wine gets the anti-analysis signal and no finding', async () => {
  const { go } = setup({ wineApproved: true, answers: { wine: () => runner('wine-check') } });
  const out = await go();
  const verdict = verdictOf(out.evidence, out.path);
  assert.ok(verdict.signals.includes('anti-analysis'));
  assert.deepEqual(verdict.findings, []);
});

test('a Wine run that uses the whole time limit hands over to the emulator and leaves an incomplete item behind', async () => {
  const builtin = runner('wine-builtin');
  const slow = () => ({ ...builtin, kind: 'exe', wine: { ...builtin.wine, timedOut: true, seconds: 12, limitSeconds: 12 } });
  const { requests, go } = setup({ wineApproved: true, answers: { wine: slow } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify', 'wine', 'exe', 'static']);
  assert.deepEqual(stepsOf(out).slice(1, 3), [['wine', 'stopped'], ['emulate', 'done']]);
  assert.ok(out.evidence.some(item => item.kind === 'emulation-stopped' && item.reason === 'wine-timeout'));
});

test('AT-19: a UPX-packed program is unwrapped and its unpacked part becomes the child that is analysed; the wrapper itself is not run again', async () => {
  const { requests, go } = setup({ answers: { identify: () => runner('identify-upx') }, wineApproved: true });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify'], 'only the identify container for the packed file');
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'skipped'], ['emulate', 'skipped'], ['static', 'skipped']]);
  assert.match(out.steps[0].detail, /^Unwrapped a UPX-packed program: 1 part\(s\)\.$/);
  assert.match(out.steps[1].detail, /analysed through the unpacked program/);
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].path, UNPACKED);
  assert.equal(out.children[0].inspectOnly, false);
  assert.equal(out.children[0].head.subarray(0, 2).toString(), 'MZ');
  assert.deepEqual([out.path, out.label], ['inspect', 'Inspected'], 'nothing ran for the wrapper');
  assert.ok(out.evidence.some(item => item.kind === 'obfuscation' && item.technique === 'packed with UPX'));
  assert.equal(out.containers.length, 1);
});

test('AT-20: an Inno Setup installer is unwrapped and its payload is a child; the wrapper is still emulated and checked', async () => {
  const { requests, go } = setup({ answers: { identify: () => runner('identify-inno') } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify', 'exe', 'static']);
  assert.equal(out.children.length, 1);
  assert.match(out.steps[0].detail, /^Unwrapped an Inno Setup installer: 1 part\(s\); innoextract lists the installer files only; its \[Run\] entries are not exposed; setup data 6\.3\.0\.$/);
});

test('an installer innoextract cannot read: the unwrap step failed, the chain goes on with the file itself, the job cannot be complete', async () => {
  const { requests, go } = setup({ answers: { identify: () => runner('identify-inno-unsupported') } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify', 'exe', 'static']);
  assert.equal(out.steps[0].status, 'failed');
  assert.deepEqual(out.children, []);
  assert.ok(verdictOf(out.evidence, out.path).signals.includes('incomplete'));
});

test('a .NET assembly is read statically only: Wine and the emulator are skipped and the item is incomplete (dotnet-static-only)', async () => {
  const { requests, go } = setup({ wineApproved: true, answers: { identify: dotnetIdentify } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify', 'static']);
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'skipped'], ['emulate', 'skipped'], ['static', 'done']]);
  assert.match(out.steps[1].detail, /needs Wine Mono, which is not installed/);
  assert.ok(out.evidence.some(item => item.kind === 'emulation-stopped' && item.reason === 'dotnet-static-only'));
  assert.equal(out.label, 'Inspected');
});

test('nesting deeper than 3 levels: identify unwraps nothing and the step says so', async () => {
  const { requests, go } = setup({ answers: { identify: () => runner('identify-upx') }, ctx: { unwrapDepthExceeded: true } });
  const out = await go();
  assert.deepEqual(requests[0].command.slice(0, 7), ['identify', '--ext', 'exe', '--max-entries', '0', '--max-bytes', '0']);
  assert.deepEqual(out.children, []);
  assert.deepEqual(out.steps[0], { step: 'unwrap', status: 'skipped', detail: 'Not unwrapped: nested more than 3 levels deep.' });
  assert.ok(out.evidence.some(item => item.reason === 'unpack-depth'));
});

test('the job time budget: steps that no longer fit are skipped, listed, and make the item incomplete; the first container always runs', async () => {
  const { requests, go } = setup({ wineApproved: true, ctx: { timeLeftMs: () => 10_000 } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify']);
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'skipped'], ['emulate', 'skipped'], ['static', 'skipped']]);
  assert.deepEqual(out.evidence.filter(item => item.reason === 'job-budget').length, 3);
  assert.match(out.steps[1].detail, /^Wine: skipped \(job time budget\)\.$/);
  assert.equal(out.label, 'Inspected');
});

test('a PE over 10 MB gets identify and static only', async () => {
  const { requests, go } = setup({ typed: { sizeTier: 'static', path: 'inspect' } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['identify', 'static']);
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'skipped'], ['emulate', 'skipped'], ['static', 'done']]);
  assert.equal(out.path, 'inspect');
});

test('a batch file: the generic step first (its container is the traced one), then Wine when approved; no emulator exists for it', async () => {
  const off = setup({ typed: { detectedType: 'bat', claimedExtension: 'bat', path: 'inspect' } });
  const outOff = await off.go();
  assert.deepEqual(off.requests.map(request => [request.role, request.kind]), [['detonate', 'generic']]);
  assert.deepEqual(stepsOf(outOff), [['generic', 'done'], ['wine', 'skipped'], ['emulate', 'skipped']]);
  assert.equal(outOff.steps[1].detail, 'Wine: skipped (not approved)');
  assert.equal(off.context.detonation.runnable, false);

  const builtin = runner('wine-builtin');
  const on = setup({ wineApproved: true, typed: { detectedType: 'vbs', claimedExtension: 'vbs', path: 'wine' }, answers: { wine: () => ({ ...builtin, kind: 'wsh' }) } });
  const outOn = await on.go();
  assert.deepEqual(on.requests.map(request => [request.role, request.kind]), [['detonate', 'generic'], ['wine', 'wine']]);
  assert.deepEqual(on.requests[1].command, ['--kind', 'wsh', '--file', '/in/sample', '--ext', 'vbs']);
  assert.equal(outOn.label, 'Ran under Wine');
  assert.equal(on.context.detonation.runnable, true);
});

test('a JScript file runs with wscript and the extension js; a DLL runs its first exports through rundll32 (names checked)', async () => {
  const js = setup({ wineApproved: true, typed: { detectedType: 'js-wsh', claimedExtension: 'js', path: 'wine' } });
  await js.go();
  assert.deepEqual(js.requests[1].command, ['--kind', 'wsh', '--file', '/in/sample', '--ext', 'js']);
  const exportsOf = () => ({ ...plainIdentify(), identify: { ...plainIdentify().identify, exports: ['Start', 'bad name;rm', 'Two', 'Three', 'Four'] } });
  const dll = setup({ wineApproved: true, typed: { detectedType: 'dll', claimedExtension: 'dll', path: 'wine' }, answers: { identify: exportsOf } });
  await dll.go();
  assert.deepEqual(dll.requests[1].command, ['--kind', 'dll', '--file', '/in/sample', '--ext', 'dll', '--export', 'Start,Two,Three']);
});

test('an MSI is unwrapped with 7z, then run under Wine when approved; its files are children', async () => {
  const entry = { index: 0, name: 'a.bin', size: 4, path: UNPACKED, head: Buffer.from('MZ\0\0').toString('base64') };
  const unwrap = () => ({ detonationRunner: 1, kind: 'unwrap', started: true, unpack: { method: '7z', format: 'msi', stopped: null, listed: 1, entries: [entry] } });
  const { requests, go } = setup({ wineApproved: true, typed: { detectedType: 'msi', claimedExtension: 'msi', path: 'wine' }, answers: { unwrap } });
  const out = await go();
  assert.deepEqual(requests.map(request => [request.role, request.kind]), [['detonate', 'unwrap'], ['wine', 'wine'], ['detonate', 'generic']]);
  assert.deepEqual(requests[0].command.slice(0, 5), ['unwrap', '--method', 'msi', '--ext', 'msi']);
  assert.deepEqual(requests[1].command, ['--kind', 'msi', '--file', '/in/sample', '--ext', 'msi']);
  assert.equal(out.children.length, 1);
  assert.match(out.steps[0].detail, /^Unwrapped an MSI package: 1 part\(s\)\.$/);
});

test('an Electron archive is unwrapped with asar and its parts are inspect-only children', async () => {
  const head = Buffer.concat([Buffer.from([4, 0, 0, 0, 0x30, 0, 0, 0, 0x2c, 0, 0, 0, 0x28, 0, 0, 0]), Buffer.from('{"files":{}}')]);
  const entry = { index: 0, name: 'main.js', size: 4, path: UNPACKED, head: Buffer.from('x();').toString('base64') };
  const unwrap = () => ({ detonationRunner: 1, kind: 'unwrap', started: true, unpack: { method: 'asar', format: 'asar', inspectOnly: true, stopped: null, listed: 1, entries: [entry] } });
  const { requests, go } = setup({ typed: { detectedType: 'unknown', claimedExtension: 'asar', path: 'inspect' }, ctx: { head }, answers: { unwrap } });
  const out = await go();
  assert.deepEqual(requests.map(request => request.kind), ['unwrap', 'generic']);
  assert.deepEqual(requests[0].command.slice(0, 3), ['unwrap', '--method', 'asar']);
  assert.deepEqual(out.children.map(child => child.inspectOnly), [true]);
});

test('AT-21 input: an unknown format gets the generic step and hands its first bytes to the parser loop', async () => {
  const { requests, go } = setup({ typed: { detectedType: 'unknown', claimedExtension: 'bin', path: 'inspect' } });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['generic']);
  assert.deepEqual(stepsOf(out), [['generic', 'done']]);
  assert.ok(Buffer.isBuffer(out.parse.bytes) && out.parse.bytes.toString('utf8').startsWith('#include <windows.h>'));
  const known = setup({ typed: { detectedType: 'png', claimedExtension: 'png', path: 'inspect' } });
  assert.equal((await known.go()).parse, undefined, 'a known type needs no parser');
});

test('generic binwalk failure propagates stopped coverage and preserves other generic signals', async () => {
  const recorded = runner('generic-text');
  const answer = {
    ...recorded,
    generic: {
      ...recorded.generic,
      entropy: { ...recorded.generic.entropy, overall: 7.95, mean: 7.9, max: 7.99 },
      binwalk: { ...recorded.generic.binwalk, ok: false },
      strings: { ...recorded.generic.strings, interesting: ['powershell -enc AAAA'] },
      yara: { ok: true, matches: [{ rule: 'SUSP_X' }], matchCount: 1 },
    },
  };
  const { requests, go } = setup({
    typed: { detectedType: 'unknown', claimedExtension: 'bin', path: 'inspect' },
    answers: { generic: answer },
  });
  const out = await go();
  assert.deepEqual(kindsOf(requests), ['generic']);
  assert.deepEqual(stepsOf(out), [['generic', 'stopped']]);
  assert.ok(out.evidence.some(item => item.reason === 'binwalk-failed'));
  assert.ok(out.evidence.some(item => item.kind === 'obfuscation'));
  assert.ok(out.evidence.some(item => item.kind === 'suspicious' && item.tool === 'strings'));
  assert.ok(out.evidence.some(item => item.kind === 'suspicious' && item.tool === 'yara'));
});

test('a runner that prints nothing is a failed step and an incomplete item, not a clean file', async () => {
  const { go } = setup({ wineApproved: true, answers: { wine: '', exe: '', static: '' } });
  const out = await go();
  assert.deepEqual(stepsOf(out), [['unwrap', 'done'], ['wine', 'failed'], ['emulate', 'failed'], ['static', 'failed']]);
  assert.ok(out.evidence.filter(item => item.reason === 'runner-no-result').length >= 2);
  assert.ok(verdictOf(out.evidence, out.path).signals.includes('incomplete'));
});

test('limits of a later step are reported by the chain; the first container\'s are left to parseTrace', async () => {
  const exits = { identify: { code: 0, reason: 'time' }, wine: { code: 137, reason: 'oom' }, exe: { code: 0, reason: null }, static: { code: 0, reason: null } };
  const requests = [];
  const answers = { identify: plainIdentify, wine: () => runner('wine-missing-dll'), exe: () => fixture('emulator', 'exe-inert'), static: () => runner('static-pe') };
  const chain = createChain({
    wineApproved: true,
    run: async (ctx, role, spec) => {
      const kind = role === 'wine' ? 'wine' : spec.command[0];
      requests.push(kind);
      assert.ok(answers[kind], `unexpected step: ${kind}`);
      return { role, stdout: line(answers[kind]()), inspectJson: JSON.stringify([{ Id: ID }]), kind };
    },
    receiptRecord: result => ({ role: result.role, exit: exits[result.kind] }),
  });
  const context = { clock: () => new Date('2026-01-01T00:00:00Z'), caps: { detonate: 30_000 }, itemIndex: 0, typed: { detectedType: 'exe', claimedExtension: 'exe', path: 'wine', sizeTier: 'full' } };
  const out = await chain(context);
  assert.deepEqual(requests, ['identify', 'wine', 'exe', 'static']);
  assert.deepEqual(out.evidence.filter(item => item.source === 'limits').map(item => item.kind), ['oom'], 'the first container (time) is not repeated here; the Wine container was killed for memory');
});

test('a host-reported Wine OOM or time limit stops coverage and triggers fallback despite a completed runner report', async () => {
  for (const [reason, code] of [['oom', 137], ['time', 124]]) {
    const requests = [];
    const answers = { identify: plainIdentify, wine: () => runner('wine-effects'), exe: () => fixture('emulator', 'exe-inert'), static: () => runner('static-pe') };
    const exits = { identify: { code: 0, reason: 'time' }, wine: { code, reason }, exe: { code: 0, reason: null }, static: { code: 0, reason: null } };
    const chain = createChain({
      wineApproved: true,
      run: async (ctx, role, spec) => {
        const kind = role === 'wine' ? 'wine' : spec.command[0];
        requests.push(kind);
        assert.ok(answers[kind], `unexpected step: ${kind}`);
        return { role, stdout: line(answers[kind]()), inspectJson: JSON.stringify([{ Id: ID }]), kind };
      },
      receiptRecord: result => ({ role: result.role, exit: exits[result.kind] }),
    });
    const context = { clock: () => new Date('2026-01-01T00:00:00Z'), caps: { detonate: 30_000 }, itemIndex: 0, budget: { entries: 50, bytes: 50 * 1024 * 1024 }, typed: { detectedType: 'exe', claimedExtension: 'exe', path: 'wine', sizeTier: 'full' } };
    const out = await chain(context);
    assert.deepEqual(requests, ['identify', 'wine', 'exe', 'static']);
    assert.deepEqual(stepsOf(out).slice(1, 3), [['wine', 'stopped'], ['emulate', 'done']]);
    assert.ok(out.evidence.some(item => item.source === 'limits' && item.kind === reason));
    const verdict = verdictOf(out.evidence, out.path);
    assert.equal(verdict.depth, 'twilight');
    assert.deepEqual(verdict.findings.map(finding => finding.id), ['persistence']);
    const registryEvidence = out.evidence.map((item, index) => item.kind === 'key-added' ? `ev-${index + 1}` : null).filter(Boolean);
    assert.ok(verdict.findings[0].evidenceIds.some(id => registryEvidence.includes(id)));
    assert.equal(verdict.complete, false);
  }
});
