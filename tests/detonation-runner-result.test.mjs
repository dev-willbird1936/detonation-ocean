// Mappers for the M4 runner lines: browser, static, emulator and unpack results to EVIDENCE.md items, and the coverage steps.
// Fixtures: tests/fixtures/detonation/{browser,static,emulator,unpack}. The ones named in RECORDED were printed by the runner in a
// real detonate container (harmless inputs written for this project); the rest are authored in the same shape, marked `_note`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapBrowser } from '../backend/detonation/browser.mjs';
import { emulationCoverage, mapEmulation } from '../backend/detonation/emulator.mjs';
import { evaluate } from '../backend/detonation/findings.mjs';
import { mapRunnerLine, mapUnpack, parseRunnerLine } from '../backend/detonation/runner-result.mjs';
import { mapOffice, mapPdf, mapPs1 } from '../backend/detonation/static.mjs';

const AT = '2026-01-01T00:00:00.000Z';
const CANARY = 'ABCDE12345';
const fixture = path => JSON.parse(readFileSync(new URL(`./fixtures/detonation/${path}.json`, import.meta.url), 'utf8'));
const RECORDED = ['browser/plain-html', 'browser/password-form', 'browser/pdf-text', 'static/ps1-hello', 'static/office-docx', 'emulator/exe-inert', 'unpack/zip-two-entries', 'unpack/eml-link-and-attachment'];
const sampleUrl = 'file:///home/dana/Downloads/sample.html';
const kinds = items => items.map(item => item.kind);
const numbered = items => items.map((item, index) => ({ ...item, id: `ev-${index + 1}` }));
const verdictOf = (items, path = 'run') => evaluate({ evidence: numbered(items), path, canaryTokens: [CANARY] });

test('recorded fixtures are runner lines from real containers and carry no authoring note', () => {
  for (const name of RECORDED) {
    const line = fixture(name);
    assert.equal(line.detonationRunner, 1, name);
    assert.equal(line._note, undefined, name);
    assert.equal(line.started, true, name);
  }
});

test('parseRunnerLine takes the last stdout line only when it is the runner status; anything else is null', () => {
  const status = JSON.stringify(fixture('static/ps1-hello'));
  assert.equal(parseRunnerLine(`script output\n{"detonationRunner":2}\n${status}\n`).kind, 'ps1');
  assert.equal(parseRunnerLine(`${status}\nlater line\n`), null);
  assert.equal(parseRunnerLine('{"detonationRunner":2,"kind":"x"}\n'), null);
  assert.equal(parseRunnerLine('[1,2]'), null);
  assert.equal(parseRunnerLine('{"cut'), null);
  assert.equal(parseRunnerLine(''), null);
  assert.equal(parseRunnerLine(undefined), null);
});

test('browser: a plain page gives no evidence; the sample\'s own PDF download is not a download', () => {
  assert.deepEqual(mapBrowser(fixture('browser/plain-html').browser, { at: AT, sampleUrl }), []);
  const pdf = fixture('browser/pdf-text');
  assert.equal(pdf.browser.downloads.length, 1);
  assert.deepEqual(mapBrowser(pdf.browser, { at: AT, sampleUrl: 'file:///home/dana/Downloads/sample.pdf' }), []);
});

test('browser: a password form that posts the typed credential gives request-blocked and form-submit, which the rule engine reads as fake-login and exfil-attempt', () => {
  const items = mapBrowser(fixture('browser/password-form').browser, { at: AT, sampleUrl });
  assert.deepEqual(kinds(items), ['request-blocked', 'form-submit']);
  assert.deepEqual(items[0], { source: 'browser', kind: 'request-blocked', detail: 'A POST request to http://collect.example.invalid/post was blocked.', at: AT, url: 'http://collect.example.invalid/post', body: `user=dana%40example.invalid&pass=CorrectHorse-${CANARY}` });
  assert.deepEqual(items[1].fields, { user: 'dana@example.invalid', pass: `CorrectHorse-${CANARY}` });
  assert.equal(items[1].typedCredential, true);
  const verdict = verdictOf(items);
  assert.equal(verdict.depth, 'midnight');
  assert.deepEqual(verdict.findings.map(finding => finding.id).sort(), ['exfil-attempt', 'fake-login']);
  assert.ok(verdict.signals.includes('unknown-hosts'));
});

test('browser: a password field whose credential went nowhere is a phishing indicator, not a fake login', () => {
  const items = mapBrowser(fixture('browser/password-field-no-post').browser, { at: AT, sampleUrl });
  assert.deepEqual(items.map(item => [item.kind, item.indicator]), [['phishing-indicator', 'password field']]);
  const verdict = verdictOf(items);
  assert.deepEqual([verdict.depth, verdict.signals, verdict.findings], ['twilight', ['phishing-unproven'], []]);
});

test('browser: blocked requests, downloads, dialogs and popups each become their item; strings are cut', () => {
  const items = mapBrowser(fixture('browser/popup-dialog-download').browser, { at: AT, sampleUrl });
  assert.deepEqual(kinds(items), ['request-blocked', 'download', 'dialog', 'suspicious']);
  assert.deepEqual([items[1].url, items[1].filename], ['http://files.example.invalid/setup.exe', 'setup.exe']);
  assert.deepEqual([items[2].dialogType, items[2].message], ['alert', 'Your computer is infected']);
  const long = mapBrowser({ requests: [{ url: `http://a.invalid/${'x'.repeat(900)}`, method: 'POST', body: 'y'.repeat(5000) }] }, { at: AT, sampleUrl });
  assert.equal(long[0].url.length, 500);
  assert.equal(long[0].body.length, 1024);
});

test('browser: a harness that timed out or could not load the page is an emulation-stopped item (incomplete), and a shapeless report is empty', () => {
  assert.deepEqual(mapBrowser(fixture('browser/harness-timeout').browser, { at: AT, sampleUrl }).map(item => [item.kind, item.reason]), [['emulation-stopped', 'browser-timeout']]);
  assert.deepEqual(mapBrowser(fixture('browser/load-failed').browser, { at: AT, sampleUrl }).map(item => [item.kind, item.reason]), [['emulation-stopped', 'browser-failed']]);
  const stopped = verdictOf(mapBrowser(fixture('browser/harness-timeout').browser, { at: AT, sampleUrl }));
  assert.deepEqual([stopped.depth, stopped.complete, stopped.signals], ['twilight', false, ['incomplete']]);
  for (const junk of [null, undefined, 'text', [], { requests: 'x', forms: [1, null], dialogs: {} }]) assert.deepEqual(mapBrowser(junk, { at: AT, sampleUrl }), []);
});

test('static pdf: pdfid names above zero become exploit-indicator items (Twilight, exploit-unproven); a clean PDF gives none; a pdfid failure is incomplete', () => {
  const exploit = mapPdf(fixture('static/pdf-open-action-js').static, { at: AT });
  assert.deepEqual(exploit.map(item => item.indicator), ['pdf /JS', 'pdf /JavaScript', 'pdf /OpenAction']);
  assert.ok(exploit.every(item => item.kind === 'exploit-indicator' && item.source === 'static'));
  const verdict = verdictOf(exploit);
  assert.deepEqual([verdict.depth, verdict.signals, verdict.findings], ['twilight', ['exploit-unproven'], []]);
  assert.deepEqual(mapPdf(fixture('browser/pdf-text').static, { at: AT }), []);
  assert.deepEqual(mapPdf(fixture('static/pdf-pdfid-failed').static, { at: AT }).map(item => [item.kind, item.reason]), [['emulation-stopped', 'pdfid-failed']]);
});

test('static pdf: a tool error fails coverage and completeness without discarding valid indicators', () => {
  const good = fixture('static/pdf-open-action-js');
  const partial = mapRunnerLine('pdf', { ...good, static: { ...good.static, errors: ['pdfid failed', 'pdf-parser failed'] } }, { at: AT, sampleUrl });
  assert.ok(partial.evidence.some(item => item.kind === 'exploit-indicator' && item.indicator === 'pdf /JS'));
  assert.deepEqual(partial.evidence.filter(item => item.kind === 'emulation-stopped').map(item => item.reason), ['pdf-static-failed']);
  assert.equal(partial.steps.find(item => item.step === 'static').status, 'failed');
  assert.match(partial.steps.find(item => item.step === 'static').detail, /PDF static tool returned an error/);
  assert.ok(!JSON.stringify(partial.evidence).includes('pdf-parser failed'));
  assert.equal(verdictOf(partial.evidence).complete, false);

  const empty = mapRunnerLine('pdf', { ...fixture('browser/pdf-text'), static: fixture('static/pdf-pdfid-failed').static }, { at: AT, sampleUrl });
  assert.deepEqual(empty.evidence.filter(item => item.kind === 'emulation-stopped').map(item => item.reason), ['pdfid-failed']);
  assert.equal(empty.steps.find(item => item.step === 'static').status, 'failed');
});

test('static ps1: encoding gives obfuscation, hidden flags give hidden-command, a download cradle gives suspicious; a plain script gives nothing', () => {
  assert.deepEqual(mapPs1(fixture('static/ps1-hello').static, { at: AT }), []);
  const items = mapPs1(fixture('static/ps1-obfuscated').static, { at: AT });
  assert.deepEqual(kinds(items), ['obfuscation', 'obfuscation', 'hidden-command', 'suspicious']);
  assert.deepEqual(items[2], { source: 'static', kind: 'hidden-command', detail: 'PowerShell uses a hidden window flag.', at: AT, tool: 'powershell', commandPreview: 'powershell -w hidden -nop' });
  assert.deepEqual(verdictOf(items).signals, ['hidden-commands', 'obfuscated', 'other-suspicious']);
  assert.deepEqual(mapPs1({ hits: [{ id: 'invoke-expression', count: 1 }, { id: 'unknown-id' }, 5, null] }, { at: AT }), []);
  assert.deepEqual(mapPs1(undefined, { at: AT }).map(item => [item.kind, item.reason]), [['emulation-stopped', 'ps1-static-failed']]);
});

test('static ps1 truncation keeps prefix indicators and stops only static coverage', () => {
  const staticReport = { hits: [{ id: 'char-join', count: 1, preview: '$([char] 65)' }], truncated: true };
  const items = mapPs1(staticReport, { at: AT });
  assert.deepEqual(kinds(items), ['obfuscation', 'emulation-stopped']);
  assert.equal(items[1].reason, 'ps1-static-truncated');
  const mapped = mapRunnerLine('ps1', { exitCode: 0, static: staticReport }, { at: AT, sampleUrl });
  assert.deepEqual(mapped.steps.map(({ step, status }) => [step, status]), [['static', 'stopped'], ['run', 'done']]);
  assert.equal(mapped.steps[0].detail, 'The PowerShell static scan reached its byte cap; prefix indicators are retained.');
  const verdict = verdictOf(mapped.evidence);
  assert.equal(verdict.complete, false);
  assert.ok(verdict.signals.includes('incomplete'));
  assert.ok(verdict.signals.includes('obfuscated'));
});

test('static ps1: inherited object names are not pattern IDs', () => {
  const inheritedIds = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];
  for (const id of inheritedIds) assert.deepEqual(mapPs1({ hits: [{ id, count: 1, preview: 'candidate' }] }, { at: AT }), [], id);
  const known = fixture('static/ps1-obfuscated').static;
  const withUnknown = { ...known, hits: [...known.hits, ...inheritedIds.map(id => ({ id, count: 1, preview: 'candidate' }))] };
  assert.deepEqual(mapPs1(withUnknown, { at: AT }), mapPs1(known, { at: AT }));
});

test('static ps1: char-join and execution-policy-bypass remain valid pattern IDs', () => {
  const items = mapPs1({ hits: [
    { id: 'char-join', count: 1, preview: '$([char] 65)' },
    { id: 'execution-policy-bypass', count: 1, preview: 'pwsh -ep bypass' },
  ] }, { at: AT });
  assert.deepEqual(items.map(({ kind, technique, commandPreview }) => [kind, technique ?? commandPreview]), [
    ['obfuscation', 'character-code string building'], ['hidden-command', 'pwsh -ep bypass'],
  ]);
});

test('Office static failure remains incomplete even if LibreOffice opened the document', () => {
  const mapped = mapRunnerLine('office', { office: {
    olevba: { ok: false, macroCount: 1, analysis: [{ type: 'AutoExec', keyword: 'AutoOpen' }] },
    libreoffice: { opened: true, timedOut: false },
  } }, { at: AT, sampleUrl });
  assert.deepEqual(mapped.steps.map(item => [item.step, item.status]), [['static', 'failed'], ['run', 'done']]);
  assert.ok(mapped.evidence.some(item => item.kind === 'exploit-indicator' && item.indicator === 'vba auto-exec AutoOpen'));
  assert.ok(mapped.evidence.some(item => item.reason === 'olevba-failed'));
  const verdict = verdictOf(mapped.evidence, 'run');
  assert.equal(verdict.complete, false);
  assert.ok(verdict.signals.includes('incomplete'));
});

test('static office: an auto-exec macro is an exploit-indicator, suspicious keywords and IOCs are suspicious, hex strings are obfuscation', () => {
  const items = mapOffice(fixture('static/office-autoexec').office, { at: AT });
  assert.deepEqual(items.map(item => [item.kind, item.indicator ?? item.technique]), [
    ['exploit-indicator', 'vba auto-exec AutoOpen'], ['suspicious', 'vba Open'], ['suspicious', 'vba Shell'], ['suspicious', 'vba http://x.example.invalid/a'], ['obfuscation', 'Hex Strings'],
  ]);
  const verdict = verdictOf(items);
  assert.deepEqual([verdict.depth, verdict.signals, verdict.complete], ['twilight', ['exploit-unproven', 'obfuscated', 'other-suspicious'], true]);
  assert.deepEqual(mapOffice(fixture('static/office-docx').office, { at: AT }), [], 'a document with no macros that LibreOffice opened');
});

test('static office: olevba that failed and a LibreOffice that did not open the document are two emulation-stopped items', () => {
  const items = mapOffice(fixture('static/office-not-opened').office, { at: AT });
  assert.deepEqual(items.map(item => [item.kind, item.reason]), [['emulation-stopped', 'olevba-failed'], ['emulation-stopped', 'libreoffice-timeout']]);
  assert.equal(verdictOf(items).complete, false);
  assert.deepEqual(mapOffice({ olevba: { ok: true }, libreoffice: { opened: false, timedOut: false } }, { at: AT }).map(item => item.reason), ['libreoffice-failed']);
  assert.deepEqual(mapOffice(null, { at: AT }).map(item => item.reason), ['olevba-failed', 'libreoffice-failed']);
});

test('emulator: one api-call item per API name with count; a program that returns normally gives no stop and no finding', () => {
  const emulation = fixture('emulator/exe-inert').emulation;
  const items = mapEmulation(emulation, { at: AT });
  assert.deepEqual(items.map(item => [item.api, item.count]), [
    ['InitializeCriticalSection', 1], ['_initterm', 2], ['SetUnhandledExceptionFilter', 1], ['malloc', 1], ['_onexit', 2], ['GetTickCount', 1], ['ExitProcess', 1],
  ]);
  assert.deepEqual(items[1].args, { arg0: '0x1400048c0', arg1: '0x1400048d0' });
  assert.ok(items.every(item => item.source === 'emulator' && item.kind === 'api-call'));
  assert.deepEqual(emulationCoverage(emulation), { status: 'done', detail: 'Emulated 3 entry point(s) in 0.6 s.' });
  const verdict = verdictOf(items, 'emulate');
  assert.deepEqual([verdict.depth, verdict.findings, verdict.complete], ['sunlight', [], true]);
});

test('emulator: API calls, files, registry and network of a Run-key program reach the rules (persistence, keylog, defence-tamper, steal-credentials) and the stop is incomplete', () => {
  const emulation = fixture('emulator/exe-run-key').emulation;
  const items = mapEmulation(emulation, { at: AT });
  const hook = items.find(item => item.api === 'SetWindowsHookExA');
  assert.deepEqual([hook.args.idHook, hook.args.arg0], [13, '0xd']);
  assert.equal(items.find(item => item.api === 'SetFileAttributesA').args.hidden, true);
  assert.equal(items.find(item => item.api === 'GetAsyncKeyState').count, 2);
  assert.deepEqual(items.filter(item => item.kind === 'file-write' || item.kind === 'file-read').map(item => [item.kind, item.path]), [
    ['file-write', 'C:\\Users\\Dana\\Documents\\demo-note.txt'], ['file-write', 'C:\\Users\\Dana\\Documents\\demo-note.txt'], ['file-read', 'C:\\Users\\Dana\\.aws\\credentials'],
  ]);
  const key = items.filter(item => item.kind === 'key-added');
  assert.deepEqual(key.map(item => [item.hive, item.key]), [['HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Run']], 'open_key is not a change');
  const net = items.filter(item => item.kind === 'connect');
  assert.deepEqual(net.map(item => [item.host, item.port, item.download === true]), [['update.example.invalid', 53, false], ['203.0.113.9', 80, true]]);
  const stop = items.at(-1);
  assert.deepEqual([stop.kind, stop.reason], ['emulation-stopped', 'emulator-error ntdll.NtQuerySystemInformation']);
  assert.deepEqual(emulationCoverage(emulation), { status: 'stopped', detail: 'Stopped at ntdll.NtQuerySystemInformation after 1204551 instructions.' });
  const verdict = verdictOf(items, 'emulate');
  assert.equal(verdict.depth, 'twilight');
  assert.deepEqual(verdict.findings.map(finding => finding.id).sort(), ['defence-tamper', 'keylog', 'persistence', 'steal-credentials']);
  assert.ok(verdict.signals.includes('incomplete') && verdict.signals.includes('unknown-hosts'));
});

test('emulator: a run that used its whole time limit or could not load the file is emulation-stopped; junk is empty', () => {
  const timeout = fixture('emulator/exe-timeout').emulation;
  assert.deepEqual(mapEmulation(timeout, { at: AT }).filter(item => item.kind === 'emulation-stopped').map(item => item.reason), ['emulator-timeout']);
  assert.deepEqual(emulationCoverage(timeout), { status: 'stopped', detail: 'Stopped at the 30 s limit.' });
  const failed = fixture('emulator/exe-load-failed').emulation;
  assert.deepEqual(mapEmulation(failed, { at: AT }).map(item => item.reason), ['emulator-failed']);
  assert.equal(emulationCoverage(failed).status, 'failed');
  assert.deepEqual(mapEmulation(undefined, { at: AT }), []);
  assert.deepEqual(mapEmulation({ entryPoints: [{ apis: [{ api: 5 }, null, { args: 'x' }] }], seconds: 'x' }, { at: AT }).map(item => item.kind), ['api-call']);
});

test('unpack: entries are kept with a decoded head; a path outside ~/Downloads/.unpacked, a bad head or a bad size is dropped', () => {
  const two = mapUnpack(fixture('unpack/zip-two-entries').unpack, { at: AT });
  assert.deepEqual(two.children.map(child => [child.name, child.size, child.path, child.head.toString('utf8').slice(0, 14)]), [
    ['notes.txt', 12, '/home/dana/Downloads/.unpacked/0/0.dat', 'plain notes\n'], ['page.html', 54, '/home/dana/Downloads/.unpacked/0/1.dat', '<!doctype html'],
  ]);
  assert.deepEqual([two.evidence, two.stopped], [[], null]);
  const hostile = mapUnpack(fixture('unpack/zip-hostile-entries').unpack, { at: AT });
  assert.deepEqual(hostile.children.map(child => child.name), ['ok.txt']);
  const invalid = { children: [], stopped: 'error', evidence: [{ source: 'static', kind: 'emulation-stopped', detail: 'Unpacking stopped: an unreadable archive or invalid runner result.', at: AT, reason: 'unpack-error' }] };
  assert.deepEqual(mapUnpack({ entries: 'x' }, { at: AT }), invalid);
  assert.deepEqual(mapUnpack(null, { at: AT }), invalid);
});

test('unpack: a cap that stopped unpacking is an emulation-stopped item with an unpack-<cap> reason; an email link that hides its target is a phishing indicator', () => {
  const ratio = mapUnpack(fixture('unpack/zip-capped-ratio').unpack, { at: AT });
  assert.deepEqual(ratio.evidence.map(item => [item.kind, item.reason]), [['emulation-stopped', 'unpack-ratio']]);
  assert.equal(ratio.children.length, 1);
  assert.deepEqual(mapUnpack(fixture('unpack/zip-unreadable').unpack, { at: AT }).evidence.map(item => item.reason), ['unpack-error']);
  assert.deepEqual(mapUnpack({ entries: [], stopped: 'surprise' }, { at: AT }).evidence.map(item => item.reason), ['unpack-limit']);
  const eml = mapUnpack(fixture('unpack/eml-link-and-attachment').unpack, { at: AT });
  assert.deepEqual(eml.evidence.map(item => [item.kind, item.indicator]), [['phishing-indicator', 'link text differs from target host']]);
  assert.equal(eml.children.length, 1);
  const links = [
    { href: 'http://203.0.113.5/login', text: 'Sign in' }, { href: 'http://xn--pple-43d.example/', text: 'Sign in' },
    { href: 'http://shop.example/cart', text: 'shop.example' }, { href: 'https://same.example/a', text: 'https://same.example/' }, { href: 'http://x.example/', text: 'Click here' },
  ];
  assert.deepEqual(mapUnpack({ entries: [], links }, { at: AT }).evidence.map(item => item.indicator), ['link to an address or punycode host', 'link to an address or punycode host']);
});

test('coverage steps: each runner kind reports what it did and where it stopped', () => {
  const step = (name, kind) => mapRunnerLine(kind, fixture(name), { at: AT, sampleUrl }).steps;
  assert.deepEqual(step('browser/plain-html', 'html'), [{ step: 'run', status: 'done', detail: 'Rendered in headless Chromium with no network; screenshots taken.' }]);
  assert.deepEqual(step('browser/harness-timeout', 'html'), [{ step: 'run', status: 'stopped', detail: 'The browser stopped before the page finished.' }]);
  assert.deepEqual(step('static/pdf-open-action-js', 'pdf').map(item => item.step), ['static', 'run']);
  assert.equal(step('static/pdf-open-action-js', 'pdf')[0].status, 'done');
  assert.match(step('static/pdf-open-action-js', 'pdf')[0].detail, /found 3 exploit indicator/);
  assert.match(step('static/pdf-open-action-js', 'pdf')[1].detail, /not rendered/);
  assert.deepEqual(step('static/ps1-obfuscated', 'ps1').map(item => [item.step, item.status]), [['static', 'done'], ['run', 'done']]);
  assert.deepEqual(step('static/office-docx', 'office').map(item => [item.step, item.status]), [['static', 'done'], ['run', 'done']]);
  assert.deepEqual(step('static/office-not-opened', 'office').map(item => [item.step, item.status]), [['static', 'failed'], ['run', 'stopped']]);
  assert.deepEqual(step('emulator/exe-run-key', 'exe').map(item => [item.step, item.status]), [['emulate', 'stopped']]);
  assert.deepEqual(step('unpack/zip-two-entries', 'zip'), [{ step: 'unwrap', status: 'done', detail: 'Unpacked 2 entries.' }]);
  assert.deepEqual(step('unpack/zip-capped-ratio', 'zip'), [{ step: 'unwrap', status: 'stopped', detail: 'Unpacked 1 entries, then stopped: a compression ratio above 100:1.' }]);
  assert.deepEqual(mapRunnerLine('py', { exitCode: 3 }, { at: AT, sampleUrl }).steps, [{ step: 'run', status: 'done', detail: 'The script ran; exit code 3.' }]);
  assert.deepEqual(mapRunnerLine('exe', null, { at: AT, sampleUrl }).steps, [{ step: 'emulate', status: 'failed', detail: 'The runner printed no result.' }]);
  assert.deepEqual(mapRunnerLine('zip', null, { at: AT, sampleUrl }).steps.map(item => item.step), ['unwrap']);
  assert.deepEqual(mapRunnerLine('inspect', {}, { at: AT, sampleUrl }), { evidence: [], steps: [], children: [] });
});

test('script runner exit metadata must be a safe integer or coverage is incomplete', () => {
  const invalid = [
    ['missing', undefined, false], ['null', null, true], ['string', '0', true], ['boolean', true, true], ['fractional', 1.5, true], ['infinite', Infinity, true],
  ];
  for (const kind of ['py', 'sh', 'node', 'ps1']) {
    for (const [label, exitCode, includeExitCode] of invalid) {
      const line = kind === 'ps1' ? { static: fixture('static/ps1-hello').static } : {};
      if (includeExitCode) line.exitCode = exitCode;
      const mapped = mapRunnerLine(kind, line, { at: AT, sampleUrl });
      const run = mapped.steps.find(item => item.step === 'run');
      assert.equal(run.status, 'failed', `${kind} ${label}`);
      assert.match(run.detail, /missing or malformed exit code/, `${kind} ${label}`);
      assert.ok(mapped.evidence.some(item => item.kind === 'emulation-stopped' && item.reason === 'runner-invalid-result'), `${kind} ${label}`);
      const verdict = verdictOf(mapped.evidence);
      assert.equal(verdict.complete, false, `${kind} ${label}`);
      assert.ok(verdict.signals.includes('incomplete'), `${kind} ${label}`);
    }
  }
});

test('script runner integer exits zero and nonzero preserve completed run coverage', () => {
  for (const kind of ['py', 'sh', 'node', 'ps1']) {
    for (const exitCode of [0, 3]) {
      const line = kind === 'ps1' ? { exitCode, static: fixture('static/ps1-hello').static } : { exitCode };
      const run = mapRunnerLine(kind, line, { at: AT, sampleUrl }).steps.find(item => item.step === 'run');
      const what = kind === 'ps1' ? 'PowerShell 7 ran the script' : 'The script ran';
      assert.deepEqual(run, { step: 'run', status: 'done', detail: `${what}; exit code ${exitCode}.` });
    }
  }
});

test('invalid PowerShell exit metadata preserves valid static indicators', () => {
  const staticReport = fixture('static/ps1-obfuscated').static;
  const indicators = mapPs1(staticReport, { at: AT });
  const mapped = mapRunnerLine('ps1', { exitCode: null, static: staticReport }, { at: AT, sampleUrl });
  assert.deepEqual(mapped.evidence.slice(0, indicators.length), indicators);
  assert.equal(mapped.evidence.at(-1).reason, 'runner-invalid-result');
  assert.deepEqual(mapped.steps.map(item => [item.step, item.status]), [['static', 'done'], ['run', 'failed']]);
  const verdict = verdictOf(mapped.evidence);
  assert.ok(verdict.complete === false && verdict.signals.includes('incomplete'));
  assert.ok(verdict.signals.includes('obfuscated'));
});

test('the recorded exe fixture has nothing the rule engine reads: Sunlight when emulated, and the recorded PDF and office lines add no static evidence', () => {
  for (const [name, kind] of [['browser/pdf-text', 'pdf'], ['static/office-docx', 'office'], ['static/ps1-hello', 'ps1'], ['emulator/exe-inert', 'exe']]) {
    const { evidence } = mapRunnerLine(kind, fixture(name), { at: AT, sampleUrl: 'file:///home/dana/Downloads/sample.pdf' });
    assert.equal(evidence.some(item => item.kind !== 'api-call'), false, name);
  }
});
