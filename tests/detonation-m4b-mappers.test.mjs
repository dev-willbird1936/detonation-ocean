// M4b mappers (SPEC 6.6): identify, unwrap, Wine, capa, YARA and generic results to EVIDENCE.md items and coverage steps.
// Fixtures: tests/fixtures/detonation/runner/*.json are runner lines printed by real containers (the detonate and wine images) for the inert
// programs in tests/fixtures/detonation/exe. Inputs written here for cases no inert program produces are marked "authored".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from '../backend/detonation/findings.mjs';
import { identifyDetail, mapIdentify } from '../backend/detonation/identify.mjs';
import { mapCapa, mapGeneric, mapParserSignals, mapStatic, mapYara } from '../backend/detonation/static.mjs';
import { mapUnwrap } from '../backend/detonation/unwrap.mjs';
import { mapWine, wineCouldNotRun } from '../backend/detonation/wine.mjs';
import { TWILIGHT_SIGNALS } from '../backend/detonation/analysis-loop.mjs';

const AT = '2026-01-01T00:00:00.000Z';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/detonation/runner/${name}.json`, import.meta.url), 'utf8'));
const kinds = items => items.map(item => item.kind);
const numbered = items => items.map((item, index) => ({ ...item, id: `ev-${index + 1}` }));
const verdictOf = (items, path = 'run') => evaluate({ evidence: numbered(items), path, canaryTokens: [] });
const PNG_8 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('recorded runner fixtures are lines printed by real containers', () => {
  for (const name of ['identify-upx', 'identify-inno', 'identify-inno-unsupported', 'static-pe', 'generic-text', 'wine-effects', 'wine-check', 'wine-missing-dll', 'wine-builtin']) {
    const line = fixture(name);
    assert.equal(line.detonationRunner, 1, name);
    assert.equal(line.started, true, name);
    assert.equal(line._note, undefined, name);
  }
});

// --- identify -----------------------------------------------------------------------------------------------------------------------

test('identify: a UPX-packed program is unsigned and obfuscated; the coverage text names format, packer and signature', () => {
  const { identify, dotnet } = fixture('identify-upx');
  const items = mapIdentify(identify, dotnet, { at: AT });
  assert.deepEqual(items.map(item => [item.source, item.kind]), [['identify', 'unsigned'], ['static', 'obfuscation']]);
  assert.equal(items[1].technique, 'packed with UPX');
  assert.equal(identifyDetail(identify), 'PE x64 console; packed with UPX; unsigned');
  const verdict = verdictOf(items, 'emulate');
  assert.deepEqual([verdict.depth, verdict.findings.length], ['twilight', 0], 'identify evidence adds Twilight signals only');
  assert.ok(verdict.signals.includes('unsigned') && verdict.signals.includes('obfuscated'));
});

test('identify: a plain installer is unsigned only; headers that could not be read say so', () => {
  const { identify } = fixture('identify-inno');
  assert.deepEqual(kinds(mapIdentify(identify, null, { at: AT })), ['unsigned']);
  assert.equal(identifyDetail({ format: 'unknown' }), 'The headers could not be read.');
  assert.deepEqual(mapIdentify(undefined, null, { at: AT }), []);
  assert.deepEqual(mapIdentify({ signature: { status: 'valid' }, packers: [] }, null, { at: AT }), [], 'a valid signature is not evidence of anything');
});

test('identify (authored): a .NET assembly is static only, its P/Invoke list and odd names add Twilight items', () => {
  const items = mapIdentify({ format: 'pe', dotnet: true, signature: { status: 'valid' } }, {
    suspiciousPinvoke: ['VirtualAlloc', 'WriteProcessMemory'], oddNameRatio: 0.9, namesChecked: 40,
  }, { at: AT });
  assert.deepEqual(items.map(item => [item.kind, item.reason ?? item.indicator ?? item.technique]), [
    ['emulation-stopped', 'dotnet-static-only'], ['suspicious', 'dotnet p/invoke VirtualAlloc'], ['suspicious', 'dotnet p/invoke WriteProcessMemory'], ['obfuscation', 'obfuscated .NET names'],
  ]);
  const verdict = verdictOf(items, 'inspect');
  assert.equal(verdict.depth, 'twilight');
  assert.ok(verdict.signals.includes('incomplete'));
  assert.deepEqual(kinds(mapIdentify({ format: 'pe', dotnet: true }, { error: 'ValueError' }, { at: AT })), ['emulation-stopped'], 'unreadable metadata still says the assembly was not run');
});

// --- unwrap -------------------------------------------------------------------------------------------------------------------------

test('unwrap: UPX gives one child with its head and a done step', () => {
  const { unwrap } = fixture('identify-upx');
  const mapped = mapUnwrap(unwrap, { at: AT });
  assert.equal(mapped.children.length, 1);
  assert.deepEqual([mapped.children[0].name, mapped.children[0].size, mapped.children[0].inspectOnly], ['unpacked.bin', 14336, false]);
  assert.equal(mapped.children[0].head.subarray(0, 2).toString(), 'MZ');
  assert.deepEqual(mapped.step, { step: 'unwrap', status: 'done', detail: 'Unwrapped a UPX-packed program: 1 part(s).' });
  assert.deepEqual(mapped.evidence, []);
});

test('unwrap: an Inno Setup installer gives its files as children; the step says innoextract does not show [Run] entries', () => {
  const { unwrap } = fixture('identify-inno');
  const mapped = mapUnwrap(unwrap, { at: AT });
  assert.equal(mapped.children.length, 1);
  assert.equal(mapped.step.status, 'done');
  assert.match(mapped.step.detail, /^Unwrapped an Inno Setup installer: 1 part\(s\); innoextract lists the installer files only; its \[Run\] entries are not exposed; setup data 6\.3\.0\.$/);
});

test('unwrap: an installer innoextract cannot read is a failed step, not a clean file; the job is incomplete', () => {
  const { unwrap } = fixture('identify-inno-unsupported');
  const mapped = mapUnwrap(unwrap, { at: AT });
  assert.deepEqual(mapped.children, []);
  assert.equal(mapped.step.status, 'failed');
  assert.equal(mapped.step.detail, 'Could not unwrap an Inno Setup installer: innoextract reads Inno Setup only up to 6.3.3, and this installer was not recognised.');
  assert.deepEqual(mapped.evidence.map(item => [item.kind, item.reason]), [['emulation-stopped', 'unpack-error']]);
  assert.ok(verdictOf(mapped.evidence).signals.includes('incomplete'));
});

test('unwrap (authored): inspect-only parts keep the flag; a cap that stops the tool is a stopped step; entries with a bad path are dropped', () => {
  const entry = (path, name = 'a.pyc') => ({ index: 0, name, size: 4, path, head: Buffer.from('abcd').toString('base64') });
  const bundle = mapUnwrap({ method: 'pyinstaller', format: 'pyinstaller', inspectOnly: true, stopped: null, entries: [entry('/home/dana/Downloads/.unpacked/1/0.dat'), entry('/etc/passwd')] }, { at: AT });
  assert.deepEqual(bundle.children.map(child => [child.name, child.inspectOnly]), [['a.pyc', true]]);
  assert.equal(bundle.step.status, 'stopped');
  assert.match(bundle.step.detail, /a PyInstaller bundle: 1 part\(s\), then stopped at a limit; its parts are inspected, not run\.$/);
  assert.deepEqual(bundle.evidence.map(item => item.reason), ['unpack-error']);
  const capped = mapUnwrap({ method: '7z', format: 'nsis', stopped: 'entries', entries: [entry('/home/dana/Downloads/.unpacked/1/0.dat')] }, { at: AT });
  assert.equal(capped.step.status, 'stopped');
  assert.deepEqual(capped.evidence.map(item => item.reason), ['unpack-entries']);
  assert.equal(mapUnwrap(null, { at: AT }).step.status, 'failed');
  assert.match(mapUnwrap({ format: 'asar', stopped: 'error', detail: 'bad\nheader   here', entries: [] }, { at: AT }).step.detail, /^Could not unwrap an Electron archive: bad header here\.$/);
});

// --- Wine ---------------------------------------------------------------------------------------------------------------------------

test('wine: a program that writes a Run key and opens a window gives key-added, screenshots and a done step (AT-22 evidence)', () => {
  const { wine } = fixture('wine-effects');
  const mapped = mapWine(wine, { at: AT, item: 3 });
  assert.equal(mapped.status, 'done');
  assert.equal(mapped.completed, true);
  assert.equal(mapped.couldNotRun, false);
  const run = mapped.evidence.find(item => item.kind === 'key-added');
  assert.deepEqual([run.source, run.hive, run.key], ['registry', 'HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Run']);
  assert.ok(run.value && run.data, 'the value name and data are kept');
  const pictures = mapped.evidence.filter(item => item.kind === 'screenshot');
  assert.ok(pictures.length >= 1);
  for (const picture of pictures) {
    assert.match(picture.artifact, /^wine-i3-(?:2s|10s|exit)\.png$/);
    assert.ok(Buffer.isBuffer(mapped.artifacts[picture.artifact]) && mapped.artifacts[picture.artifact].subarray(0, 8).equals(PNG_8));
    if (picture.image) assert.match(picture.image, /^data:image\/png;base64,/);
  }
  assert.match(mapped.detail, /^Ran under Wine for [\d.]+ s; exit code 0; 0 process\(es\), 1 registry change\(s\), 0 file change\(s\) in the prefix, \d screenshot\(s\)\.$/);
  const verdict = verdictOf(mapped.evidence, 'wine');
  assert.deepEqual(verdict.findings.map(finding => finding.id), ['persistence']);
});

test('wine: reads of HKCU\\Software\\Wine and wine_get_version give the anti-analysis signal (AT-24)', () => {
  const { wine } = fixture('wine-check');
  const mapped = mapWine(wine, { at: AT });
  assert.deepEqual(mapped.evidence.filter(item => item.kind !== 'screenshot').map(item => [item.source, item.kind, item.key ?? item.api]), [['wine', 'registry-read', 'Software\\Wine'], ['wine', 'api-call', 'wine_get_version']]);
  const verdict = verdictOf(mapped.evidence, 'wine');
  assert.ok(verdict.signals.includes('anti-analysis'));
  assert.deepEqual(verdict.findings, []);
});

test('wine: a program that exits within 2 s with a Wine error "could not run"; a slow or silent failure is not that (AT-23)', () => {
  const { wine } = fixture('wine-missing-dll');
  const mapped = mapWine(wine, { at: AT });
  assert.deepEqual([mapped.status, mapped.couldNotRun, mapped.completed], ['failed', true, false]);
  assert.match(mapped.detail, /^Wine could not run it \(exit code 53 after [\d.]+ s: err:module:import_dll Library missing-probe\.dll/);
  assert.equal(wineCouldNotRun(wine), true);
  assert.equal(wineCouldNotRun({ ...wine, seconds: 2.5 }), false, 'a program that ran for more than 2 s ran');
  assert.equal(wineCouldNotRun({ ...wine, errors: [] }), false, 'a non-zero exit without a Wine error is the program\'s own');
  assert.equal(wineCouldNotRun({ ...wine, exitCode: 0 }), false);
  assert.equal(wineCouldNotRun({ ...wine, timedOut: true }), false);
  assert.equal(wineCouldNotRun({ ...wine, booted: false }), true, 'a prefix that does not boot could not run anything');
  assert.equal(wineCouldNotRun({ ...wine, commands: 0 }), true);
});

test('wine: a Wine built-in is run and its process is listed; Wine\'s own helper processes are not', () => {
  const { wine } = fixture('wine-builtin');
  const mapped = mapWine(wine, { at: AT });
  assert.deepEqual(mapped.evidence.filter(item => item.kind === 'execve').map(item => [item.source, item.path]), [['wine', 'C:\\windows\\system32\\cmd.exe']]);
  const helpers = mapWine({ ...wine, processes: [{ path: 'C:\\windows\\system32\\winedevice.exe', argv: [] }, { path: 'C:\\windows\\system32\\services.exe', argv: [] }, { path: 'C:\\x\\a.exe', argv: ['a.exe', '/s'] }] }, { at: AT });
  assert.deepEqual(helpers.evidence.filter(item => item.kind === 'execve').map(item => item.path), ['C:\\x\\a.exe']);
});

test('wine (authored): a program still running at the limit is stopped and incomplete; added files keep their facts; bad pictures are dropped', () => {
  const base = fixture('wine-builtin').wine;
  const png = Buffer.concat([PNG_8, Buffer.alloc(20, 1)]).toString('base64');
  const mapped = mapWine({
    ...base, timedOut: true, limitSeconds: 12, screenshots: [{ name: '2s', data: png }, { name: '../x', data: png }, { name: '10s', data: 'not base64!' }, { name: 'exit', data: Buffer.from('plainly not a png').toString('base64') }],
    files: [{ kind: 'added', path: 'C:\\ProgramData\\x\\a.exe', sizeAfter: 2048, entropyAfter: 6.1, executable: true }, { kind: 'bogus', path: 'C:\\y' }],
    registry: [{ kind: 'key-added', hive: 'HKLM', key: 'Software\\Evil', value: '', data: '' }, { kind: 'key-added', hive: 'HKXX', key: 'Z', value: '', data: '' }],
  }, { at: AT, item: 1 });
  assert.equal(mapped.status, 'stopped');
  assert.equal(mapped.completed, false);
  assert.deepEqual(Object.keys(mapped.artifacts), ['wine-i1-2s.png']);
  assert.deepEqual(mapped.evidence.filter(item => ['added', 'key-added', 'emulation-stopped'].includes(item.kind)).map(item => [item.kind, item.path ?? item.key ?? item.reason]), [
    ['key-added', 'Software\\Evil'], ['added', 'C:\\ProgramData\\x\\a.exe'], ['emulation-stopped', 'wine-timeout'],
  ]);
  const added = mapped.evidence.find(item => item.kind === 'added');
  assert.deepEqual([added.sizeAfter, added.executable, added.seeded, added.sizeBefore], [2048, true, false, null]);
  assert.ok(verdictOf(mapped.evidence, 'wine').signals.includes('incomplete'));
  assert.deepEqual(mapWine(undefined, { at: AT }).evidence.filter(item => item.kind !== 'emulation-stopped'), []);
});

// --- capa, YARA, generic ------------------------------------------------------------------------------------------------------------

test('capa: the rules a program that only returns matches add no evidence; rules that say something do, as Twilight signals only', () => {
  const { static: report } = fixture('static-pe');
  assert.deepEqual(mapCapa(report.capa, { at: AT }), [], 'RWX memory, PE parsing and loops are not suspicious on their own');
  const rule = (name, namespace, attack = []) => ({ name, namespace, attack, count: 1 });
  const items = mapCapa({
    ok: true, rules: [
      rule('check for debugger via API', 'anti-analysis/anti-debugging/debugger-detection'), rule('packed with UPX', 'anti-analysis/packer/upx'), rule('persist via Run registry key', 'persistence/registry/run', ['T1547.001']),
      rule('get OS version', 'host-interaction/os/info'), rule('check UAC elevation', 'host-interaction/uac'), rule('inject thread', 'host-interaction/process/inject', ['T1055']),
      rule('parse PE header', 'load-code/pe', ['T1129']), rule('contain loop', ''),
    ],
  }, { at: AT });
  assert.deepEqual(items.map(item => item.kind), ['anti-analysis', 'obfuscation', 'suspicious', 'system-survey', 'admin-request', 'suspicious']);
  assert.ok(items.every(item => item.source === 'static' && item.tool === 'capa'));
  const verdict = verdictOf(items, 'run');
  assert.deepEqual(verdict.findings, []);
  assert.equal(verdict.depth, 'twilight');
  assert.deepEqual(kinds(mapCapa({ ok: false, error: 'capa did not finish in time', rules: [] }, { at: AT })), ['emulation-stopped']);
  assert.deepEqual(mapCapa(null, { at: AT }), []);
});

test('YARA: exploit rules, packer rules and every other match become exploit-indicator, obfuscation and suspicious', () => {
  const items = mapYara({
    ok: true, matches: [
      { rule: 'EXPL_CVE_2017_0199_RTF', tags: [], author: 'A' }, { rule: 'SUSP_UPX_Packed', tags: ['PACKER'] }, { rule: 'MAL_Something', tags: [], author: 'B' },
    ],
  }, { at: AT });
  assert.deepEqual(items.map(item => [item.kind, item.tool]), [['exploit-indicator', 'yara'], ['obfuscation', 'yara'], ['suspicious', 'yara']]);
  assert.deepEqual(verdictOf(items).findings, []);
  assert.deepEqual(kinds(mapYara({ ok: false }, { at: AT })), ['emulation-stopped']);
  assert.equal(mapYara({ ok: true, matches: Array.from({ length: 30 }, (_, i) => ({ rule: `R${i}` })) }, { at: AT }).length, 10, 'at most 10 matches become items');
});

test('static: the recorded capa and YARA report of a program that only returns maps to no evidence and a done step', () => {
  const mapped = mapStatic(fixture('static-pe').static, { at: AT });
  assert.deepEqual(mapped.evidence, []);
  assert.equal(mapped.status, 'done');
  assert.match(mapped.detail, /^capa matched 11 rule\(s\); YARA matched 0 rule\(s\)\.$/);
  assert.deepEqual(mapStatic({ capa: { ok: false }, yara: { ok: false } }, { at: AT }).status, 'failed');
  assert.deepEqual(mapStatic({ capa: { ok: false }, yara: { ok: true, matches: [], matchCount: 0 } }, { at: AT }).status, 'stopped');
});

test('generic: the recorded report of a C source file maps to no evidence; strings, binwalk hits and entropy add Twilight items (authored)', () => {
  const recorded = mapGeneric(fixture('generic-text').generic, { at: AT });
  assert.deepEqual(recorded.evidence, []);
  assert.match(recorded.detail, /^Strings \(6 ASCII, 0 UTF-16\), entropy 4\.665, 0 binwalk hit\(s\), YARA 0 match\(es\)\.$/);
  const noisy = mapGeneric({
    entropy: { overall: 7.95, mean: 7.9, max: 7.99 }, binwalk: { ok: true, executables: 1, archives: 1, found: [{}, {}] },
    strings: { ascii: 3, utf16: 0, interesting: ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'powershell -enc AAAA'] },
    yara: { ok: true, matches: [{ rule: 'SUSP_X' }], matchCount: 1 },
  }, { at: AT });
  assert.deepEqual(noisy.evidence.map(item => item.kind), ['obfuscation', 'suspicious', 'suspicious', 'suspicious', 'suspicious', 'suspicious']);
  assert.deepEqual(verdictOf(noisy.evidence, 'inspect').findings, [], 'generic evidence never raises a finding');
});

test('generic: incomplete binwalk results stop coverage but retain entropy, strings and YARA signals', () => {
  const base = {
    entropy: { overall: 7.95, mean: 7.9, max: 7.99 },
    binwalk: { ok: true, found: [], executables: 0, archives: 0 },
    strings: { ascii: 1, utf16: 0, interesting: ['powershell -enc AAAA'] },
    yara: { ok: true, matches: [{ rule: 'SUSP_X' }], matchCount: 1 },
  };
  const cases = [
    ['false', { ...base, binwalk: { ...base.binwalk, ok: false, error: 'binwalk-internal-error-sentinel' } }],
    ['missing success flag', { ...base, binwalk: { found: [] } }],
    ['malformed success flag', { ...base, binwalk: { ...base.binwalk, ok: 'true' } }],
    ['missing report', { ...base, binwalk: undefined }],
    ['malformed report', { ...base, binwalk: 'not-an-object' }],
  ];
  for (const [label, report] of cases) {
    const mapped = mapGeneric(report, { at: AT });
    assert.equal(mapped.status, 'stopped', label);
    assert.match(mapped.detail, /binwalk could not finish/, label);
    assert.deepEqual(mapped.evidence.filter(item => item.reason === 'binwalk-failed'), [
      { source: 'static', kind: 'emulation-stopped', detail: 'binwalk could not finish.', at: AT, reason: 'binwalk-failed' },
    ], label);
    assert.ok(!JSON.stringify(mapped).includes('binwalk-internal-error-sentinel'), label);
    assert.ok(mapped.evidence.some(item => item.kind === 'obfuscation'), label);
    assert.ok(mapped.evidence.some(item => item.kind === 'suspicious' && item.tool === 'strings'), label);
    assert.ok(mapped.evidence.some(item => item.kind === 'suspicious' && item.tool === 'yara'), label);
    const verdict = verdictOf(mapped.evidence, 'run');
    assert.equal(verdict.complete, false, label);
    assert.ok(verdict.signals.includes('incomplete') && verdict.signals.includes('obfuscated'), label);
  }
});

test('parser signals: every Twilight signal maps to a static item that gives it back, and none raises a finding (AT-21)', () => {
  const items = mapParserSignals(TWILIGHT_SIGNALS, { at: AT });
  assert.equal(items.length, TWILIGHT_SIGNALS.length);
  const verdict = verdictOf(items, 'inspect');
  assert.deepEqual(verdict.findings, []);
  assert.equal(verdict.depth, 'twilight');
  for (const id of TWILIGHT_SIGNALS.filter(signal => signal !== 'unknown-hosts')) assert.ok(verdict.signals.includes(id), `${id} comes back as a signal`);
  assert.deepEqual(mapParserSignals(['unknown-hosts'], { at: AT }).map(item => item.kind), ['suspicious'], 'a signal that needs a run becomes a suspicious item');
  assert.deepEqual(mapParserSignals(undefined, { at: AT }), []);
});
