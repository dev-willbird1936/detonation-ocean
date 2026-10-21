import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate } from '../backend/detonation/findings.mjs';
import { TRACE_CAP_BYTES, parseTraceDir, parseTraceLines } from '../backend/detonation/trace.mjs';

// Real lines: docs/evidence/gvisor-wsl/trace-samples.txt, and tests/fixtures/detonation/trace/probe-real.txt (a harmless probe
// run in the detonate image under runsc-trace; its first three lines are the runner, copied in shape from the real execve lines).
const SAMPLES = readFileSync(new URL('../docs/evidence/gvisor-wsl/trace-samples.txt', import.meta.url), 'utf8').split('\n');
const PROBE = readFileSync(new URL('./fixtures/detonation/trace/probe-real.txt', import.meta.url), 'utf8').split('\n');
const START = 'I1008 00:01:07.600000       1 strace.go:607] [   1:   1] bash X execve(0x7ec0618bc3c0 /usr/bin/python3, 0x7ec0618bc3d0 ["python3", "/home/dana/Downloads/sample.py"], 0xac47e0 ["HOME=/home/dana"]) = 0 (0x0) (7.049µs)';
const NOW = new Date(2026, 9, 8, 12);
const local = (month, day, h, m, s, ms) => new Date(2026, month - 1, day, h, m, s, ms).toISOString();
const parse = lines => parseTraceLines(lines, { now: NOW });
const kinds = items => items.map(item => item.kind);
const ofKind = (items, kind) => items.filter(item => item.kind === kind);
const line = (clock, pid, comm, phase, call, tail = '') => `I1008 ${clock}       1 strace.go:607] [${String(pid).padStart(4)}:${String(pid).padStart(4)}] ${comm} ${phase} ${call}${tail}`;
const lineThread = (clock, pid, tid, comm, phase, call, tail = '') => `I1008 ${clock}       1 strace.go:607] [${String(pid).padStart(4)}:${String(tid).padStart(4)}] ${comm} ${phase} ${call}${tail}`;
const ok = ' = 3 (0x3) (45.549µs)';

test('real sample lines become EVIDENCE.md trace items, with the runner start line itself left out', async () => {
  const { items, sampleStarted, pidsLimit } = await parse([START, ...SAMPLES]);
  assert.equal(sampleStarted, true);
  assert.equal(pidsLimit, false);
  assert.deepEqual(items.filter(item => item.kind !== 'execve').map(({ kind, path, from, to, host, port }) => ({ kind, path, from, to, host, port })), [
    { kind: 'file-write', path: '/tmp/probe.txt', from: undefined, to: undefined, host: undefined, port: undefined },
    { kind: 'rename', path: undefined, from: '/tmp/probe.txt', to: '/tmp/probe2.txt', host: undefined, port: undefined },
    { kind: 'unlink', path: '/tmp/probe2.txt', from: undefined, to: undefined, host: undefined, port: undefined },
    { kind: 'connect', path: undefined, from: undefined, to: undefined, host: '10.1.2.3', port: 80 },
    { kind: 'sendto', path: undefined, from: undefined, to: undefined, host: '10.1.2.3', port: 53 },
    { kind: 'connect', path: undefined, from: undefined, to: undefined, host: '127.0.0.1', port: 9 },
  ]);
  const exec = ofKind(items, 'execve');
  assert.equal(exec.length, 1, 'the sample START line is not evidence');
  assert.deepEqual([exec[0].path, exec[0].argv], ['/bin/true', ['/bin/true']]);
  for (const item of items) {
    assert.equal(item.source, 'trace');
    assert.match(item.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(typeof item.detail, 'string');
  }
  assert.deepEqual(items.map(item => item.at), [...items.map(item => item.at)].sort(), 'sorted by time');
});

test('log times are local, have no year, and a December line read in January belongs to the previous year', async () => {
  const [first] = (await parse([START, line('00:01:07.824824', 1, 'python3', 'X', 'unlink(0x7ec061737c50 /tmp/probe2.txt)', ' = 0 (0x0) (121.687µs)')])).items;
  assert.equal(first.at, local(10, 8, 0, 1, 7, 824));
  const december = START.replace('I1008', 'I1231').replace('00:01:07.600000', '23:59:59.000000');
  const lines = [december, line('23:59:59.500000', 1, 'python3', 'X', 'unlink(0x7ec061737c50 /tmp/a)', ' = 0 (0x0) (1µs)').replace('I1008', 'I1231')];
  const [late] = (await parseTraceLines(lines, { now: new Date(2027, 0, 1, 0, 0, 5) })).items;
  assert.equal(late.at, new Date(2026, 11, 31, 23, 59, 59, 500).toISOString());
});

test('nothing is kept before the interpreter starts the sample; cp and chmod naming the sample path do not start it', async () => {
  const cp = line('00:01:07.100000', 1, 'bash', 'X', 'execve(0x1 /usr/bin/cp, 0x2 ["cp", "/in/sample", "/home/dana/Downloads/sample.py"], 0x3 ["A=1"])', ' = 0 (0x0) (1µs)');
  const chmod = line('00:01:07.200000', 1, 'bash', 'X', 'execve(0x1 /usr/bin/chmod, 0x2 ["chmod", "0644", "/home/dana/Downloads/sample.py"], 0x3 ["A=1"])', ' = 0 (0x0) (1µs)');
  const early = line('00:01:07.300000', 2, 'cp', 'X', 'openat(AT_FDCWD /home/dana, 0x7 /home/dana/Documents/notes.txt, O_RDONLY|O_CLOEXEC, 0o0)', ok);
  const before = await parse([cp, chmod, early]);
  assert.deepEqual([before.sampleStarted, before.items], [false, []]);
  const late = line('00:01:08.000000', 3, 'python3', 'X', 'openat(AT_FDCWD /home/dana, 0x7 /home/dana/Documents/notes.txt, O_RDONLY|O_CLOEXEC, 0o0)', ok);
  const after = await parse([cp, chmod, early, START, late]);
  assert.deepEqual(after.items.map(item => [item.kind, item.path, item.at]), [['file-read', '/home/dana/Documents/notes.txt', local(10, 8, 0, 1, 8, 0)]]);
  for (const interpreter of ['bash', 'node']) {
    const other = START.replace('/usr/bin/python3', `/usr/bin/${interpreter}`).replace('"python3"', `"${interpreter}"`).replace('sample.py', interpreter === 'node' ? 'sample.js' : 'sample.sh');
    assert.equal((await parse([other])).sampleStarted, true, interpreter);
  }
});

test('openat: successful reads under the sandbox user paths and every successful write count; noise, directories and failures do not', async () => {
  const open = (path, flags, tail = ok) => line('00:01:08.000000', 1, 'python3', 'X', `openat(AT_FDCWD /home/dana, 0x7 ${path}, ${flags}, 0o666)`, tail);
  const { items } = await parse([
    START,
    open('/home/dana/.aws/credentials', 'O_RDONLY|O_CLOEXEC'),
    open('/home/dana/.aws/credentials', 'O_RDONLY|O_CLOEXEC'),
    open('/home/dana/Documents', 'O_RDONLY|O_CLOEXEC|O_DIRECTORY'),
    open('/home/dana/missing', 'O_RDONLY|O_CLOEXEC', ' = -1 errno=2 (no such file or directory) (121.724µs)'),
    open('/usr/lib/python3.11/os.py', 'O_RDONLY|O_CLOEXEC'),
    open('/proc/self/status', 'O_RDONLY|O_CLOEXEC'),
    open('/home/dana/Downloads/sample.py', 'O_RDONLY|O_CLOEXEC'),
    open('/home/dana/Documents/a.locked', 'O_WRONLY|O_CLOEXEC|O_CREAT|O_TRUNC'),
    open('/etc/cron.d/job', 'O_RDWR|O_CLOEXEC|O_APPEND'),
    open('/dev/null', 'O_WRONLY'),
    line('00:01:08.000000', 1, 'python3', 'X', 'openat(0x4 /home/dana/Desktop, 0x7 note.txt, O_WRONLY|O_CREAT, 0o666)', ok),
  ]);
  assert.deepEqual(items.map(item => [item.kind, item.path]), [
    ['file-read', '/home/dana/.aws/credentials'],
    ['file-write', '/home/dana/Documents/a.locked'],
    ['file-write', '/etc/cron.d/job'],
    ['file-write', '/home/dana/Desktop/note.txt'],
  ]);
});

test('O_PATH opens are metadata-only, while a later ordinary credential read still counts', async () => {
  const path = '/home/dana/.aws/credentials';
  const metadataOpen = line('00:01:08.000000', 1, 'python3', 'X', `openat(AT_FDCWD /home/dana, 0x7 ${path}, O_PATH|O_CLOEXEC, 0o0)`, ok);
  const metadataWrite = line('00:01:08.050000', 1, 'python3', 'X', 'openat(AT_FDCWD /home/dana, 0x7 /home/dana/Documents/metadata-only, O_WRONLY|O_PATH|O_CREAT, 0o0)', ok);
  const metadata = await parse([START, metadataOpen, metadataWrite]);
  assert.deepEqual(metadata.items, []);
  const metadataVerdict = evaluate({ evidence: metadata.items.map((item, index) => ({ ...item, id: `ev-${index + 1}` })), path: 'run', canaryTokens: [] });
  assert.ok(!metadataVerdict.findings.some(finding => finding.id === 'steal-credentials'));

  const contentRead = line('00:01:08.100000', 1, 'python3', 'X', `openat(AT_FDCWD /home/dana, 0x7 ${path}, O_RDONLY|O_CLOEXEC, 0o0)`, ok);
  const readable = await parse([START, metadataOpen, metadataWrite, contentRead]);
  assert.deepEqual(readable.items.map(item => [item.kind, item.path]), [['file-read', path]]);
  const readVerdict = evaluate({ evidence: readable.items.map((item, index) => ({ ...item, id: `ev-${index + 1}` })), path: 'run', canaryTokens: [] });
  assert.ok(readVerdict.findings.some(finding => finding.id === 'steal-credentials'));
});

test('unlink, unlinkat and rmdir are kept as attempts (a read-only root refuses them) except when the path does not exist', async () => {
  const eacces = ' = -1 errno=13 (permission denied) (44.496µs)';
  const { items } = await parse([
    START,
    line('00:01:08.000000', 2, 'rm', 'X', 'unlinkat(AT_FDCWD /home/dana, 0x7 /bin/ls, 0x0)', eacces),
    line('00:01:08.000000', 2, 'rm', 'X', 'unlinkat(0x4 /usr, 0x7 lib, 0x200)', eacces),
    line('00:01:08.000000', 2, 'rm', 'X', 'unlinkat(0x4 /etc, 0x7 cron.d, AT_REMOVEDIR)', ' = 0 (0x0) (1µs)'),
    line('00:01:08.000000', 2, 'rm', 'X', 'unlinkat(AT_FDCWD /home/dana, 0x7 /tmp/nothing, 0x0)', ' = -1 errno=2 (no such file or directory) (8µs)'),
    line('00:01:08.000000', 1, 'python3', 'X', 'rmdir(0x7 /var)', eacces),
    line('00:01:08.000000', 1, 'python3', 'X', 'unlink(0x7 /home/dana/Downloads/sample.py)', ' = 0 (0x0) (1µs)'),
    line('00:01:08.000000', 1, 'python3', 'X', 'unlink(0x7 /home/dana/Documents/notes.txt)', ' = 0 (0x0) (1µs)'),
  ]);
  assert.deepEqual(items.map(({ kind, path, errno, self }) => ({ kind, path, errno, self })), [
    { kind: 'unlink', path: '/bin/ls', errno: 13, self: undefined },
    { kind: 'rmdir', path: '/usr/lib', errno: 13, self: undefined },
    { kind: 'rmdir', path: '/etc/cron.d', errno: undefined, self: undefined },
    { kind: 'rmdir', path: '/var', errno: 13, self: undefined },
    { kind: 'unlink', path: '/home/dana/Downloads/sample.py', errno: undefined, self: true },
    { kind: 'unlink', path: '/home/dana/Documents/notes.txt', errno: undefined, self: undefined },
  ]);
});

test('sendto has no bytes in the trace: the preview comes from the read or write that used the same address and length', async () => {
  const connect = 'connect(0x3 socket:[1], 0x7ee8ca65b760 {Family: AF_INET, Addr: 203.0.113.7, Port: 443}, 0x10)';
  const read = (pointer, text, length) => line('00:01:08.000000', 1, 'python3', 'X', `read(0x5 /home/dana/.aws/credentials, ${pointer} "${text}", 0x1000)`, ` = ${length} (0x${length.toString(16)}) (5µs)`);
  const sendto = (pointer, length) => line('00:01:08.100000', 1, 'python3', 'E', `sendto(0x3 socket:[1], ${pointer}, 0x${length.toString(16)}, 0x0, null, 0x0)`);
  const { items } = await parse([
    START, line('00:01:08.050000', 1, 'python3', 'E', connect),
    read('0x7eebbbd6fd90', '[default]\\naws_access_key_id = AKIA1234567890FAKE00', 87),
    sendto('0x7eebbbd6fd90', 87), // same address and length: the data that was read
    sendto('0x7eebbbd6fd90', 5), // same address, other length: unrelated bytes
    sendto('0x1111', 87), // other address
  ]);
  const sent = ofKind(items, 'sendto');
  assert.deepEqual(sent.map(item => [item.host, item.port, item.payloadPreview]), [
    ['203.0.113.7', 443, '[default]\naws_access_key_id = AKIA1234567890FAKE00'], ['203.0.113.7', 443, ''], ['203.0.113.7', 443, ''],
  ]);
  assert.deepEqual(ofKind(items, 'connect').map(item => [item.host, item.port, item.payloadPreview]), [['203.0.113.7', 443, '']]);
});

test('read/write buffer previews never cross PID boundaries, across both send lookup paths', async () => {
  const canary = 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA';
  const length = Buffer.byteLength(canary);
  const read = (pid, pointer, clock) => line(clock, pid, 'python3', 'X', `read(0x5 /tmp/source, ${pointer} "${canary}", 0x1000)`, ` = ${length} (0x${length.toString(16)}) (5µs)`);
  const write = (pid, pointer, clock) => line(clock, pid, 'python3', 'E', `write(0x5 /tmp/source, ${pointer} "${canary}", 0x${length.toString(16)})`);
  const sendto = (pid, pointer, clock) => line(clock, pid, 'python3', 'E', `sendto(0x3 socket:[1], ${pointer}, 0x${length.toString(16)}, 0x0, null, 0x0)`);
  const sendmsg = (pid, pointer, clock) => line(clock, pid, 'python3', 'E', `sendmsg(0x3 socket:[1], 0x7 {msg_iov=[{base=${pointer}, len=${length}}], msg_iovlen=1}, 0x0)`);
  const connect = line('00:01:08.000000', 20, 'python3', 'E', 'connect(0x3 socket:[1], 0x7ee8 {Family: AF_INET, Addr: 203.0.113.7, Port: 443}, 0x10)');
  const { items } = await parse([
    START, connect,
    read(10, '0xaaa', '00:01:08.010000'), sendto(20, '0xaaa', '00:01:08.020000'),
    read(10, '0xbbb', '00:01:08.030000'), sendmsg(20, '0xbbb', '00:01:08.040000'),
    write(10, '0xccc', '00:01:08.050000'), sendto(20, '0xccc', '00:01:08.060000'),
    write(10, '0xddd', '00:01:08.070000'), sendmsg(20, '0xddd', '00:01:08.080000'),
  ]);
  const sent = ofKind(items, 'sendto');
  assert.deepEqual(sent.map(item => item.payloadPreview), ['', '', '', '']);
  const verdict = evaluate({ evidence: items.map((item, index) => ({ ...item, id: `ev-${index + 1}` })), path: 'run', canaryTokens: [canary] });
  assert.ok(!verdict.findings.some(finding => finding.id === 'exfil-attempt'));
});

test('read/write buffer previews still correlate across threads of the same PID', async () => {
  const canary = 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA';
  const length = Buffer.byteLength(canary);
  const read = lineThread('00:01:08.010000', 10, 101, 'python3', 'X', `read(0x5 /tmp/source, 0xaaa "${canary}", 0x1000)`, ` = ${length} (0x${length.toString(16)}) (5µs)`);
  const sendto = lineThread('00:01:08.020000', 10, 202, 'python3', 'E', `sendto(0x3 socket:[1], 0xaaa, 0x${length.toString(16)}, 0x0, null, 0x0)`);
  const write = lineThread('00:01:08.030000', 10, 303, 'python3', 'E', `write(0x5 /tmp/source, 0xbbb "${canary}", 0x${length.toString(16)})`);
  const sendmsg = lineThread('00:01:08.040000', 10, 404, 'python3', 'E', `sendmsg(0x3 socket:[1], 0x7 {msg_iov=[{base=0xbbb, len=${length}}], msg_iovlen=1}, 0x0)`);
  const connect = lineThread('00:01:08.000000', 10, 100, 'python3', 'E', 'connect(0x3 socket:[1], 0x7ee8 {Family: AF_INET, Addr: 203.0.113.7, Port: 443}, 0x10)');
  const { items } = await parse([START, connect, read, sendto, write, sendmsg]);
  assert.deepEqual(ofKind(items, 'sendto').map(item => item.payloadPreview), [canary, canary]);
});

test('another PID update at a reused address does not overwrite the first PID cache', async () => {
  const first = 'PID-A-CANARY';
  const second = 'PID-B-CANARY';
  assert.equal(first.length, second.length);
  const length = first.length;
  const read = (pid, text, clock) => line(clock, pid, 'python3', 'X', `read(0x5 /tmp/source, 0xaaa "${text}", 0x1000)`, ` = ${length} (0x${length.toString(16)}) (5µs)`);
  const sendto = (pid, clock) => line(clock, pid, 'python3', 'E', `sendto(0x3 socket:[1], 0xaaa, 0x${length.toString(16)}, 0x0, null, 0x0)`);
  const { items } = await parse([START, read(10, first, '00:01:08.010000'), read(20, second, '00:01:08.020000'), sendto(10, '00:01:08.030000'), sendto(20, '00:01:08.040000')]);
  assert.deepEqual(ofKind(items, 'sendto').map(item => item.payloadPreview), [first, second]);
});

test('PID-scoped buffer cache keeps the global 512-entry eviction bound', async () => {
  const length = 4;
  const payload = pid => `P${String(pid).padStart(3, '0')}`;
  const reads = Array.from({ length: 513 }, (_, index) => {
    const pid = index + 1;
    const text = payload(pid);
    return line('00:01:08.100000', pid, 'python3', 'X', `read(0x5 /tmp/source, 0xaaa "${text}", 0x1000)`, ` = ${length} (0x${length.toString(16)}) (5µs)`);
  });
  const connect = line('00:01:08.000000', 2, 'python3', 'E', 'connect(0x3 socket:[1], 0x7ee8 {Family: AF_INET, Addr: 203.0.113.7, Port: 443}, 0x10)');
  const sendto = pid => line('00:01:08.900000', pid, 'python3', 'E', `sendto(0x3 socket:[1], 0xaaa, 0x${length.toString(16)}, 0x0, null, 0x0)`);
  const { items } = await parse([START, connect, ...reads, sendto(1), sendto(2)]);
  assert.deepEqual(ofKind(items, 'sendto').map(item => item.payloadPreview), ['', payload(2)]);
});

test('successful execve invalidates that PID cached previews and prevents stale exfil evidence', async () => {
  const canary = 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA';
  const length = Buffer.byteLength(canary);
  const read = line('00:01:08.010000', 10, 'python3', 'X', `read(0x5 /tmp/source, 0xaaa "${canary}", 0x1000)`, ` = ${length} (0x${length.toString(16)}) (5µs)`);
  const write = line('00:01:08.020000', 10, 'python3', 'E', `write(0x5 /tmp/source, 0xbbb "${canary}", 0x${length.toString(16)})`);
  const exec = line('00:01:08.030000', 10, 'python3', 'X', 'execve(0x1 /usr/bin/child, 0x2 ["child"], 0x3 [])', ' = 0 (0x0) (1µs)');
  const connect = line('00:01:08.000000', 10, 'python3', 'E', 'connect(0x3 socket:[1], 0x7ee8 {Family: AF_INET, Addr: 203.0.113.7, Port: 443}, 0x10)');
  const sendto = line('00:01:08.040000', 10, 'python3', 'E', `sendto(0x3 socket:[1], 0xaaa, 0x${length.toString(16)}, 0x0, null, 0x0)`);
  const sendmsg = line('00:01:08.050000', 10, 'python3', 'E', `sendmsg(0x3 socket:[1], 0x7 {msg_iov=[{base=0xbbb, len=${length}}], msg_iovlen=1}, 0x0)`);
  const { items } = await parse([START, connect, read, write, exec, sendto, sendmsg]);
  const sent = ofKind(items, 'sendto');
  assert.deepEqual(sent.map(item => item.payloadPreview), ['', '']);
  const verdict = evaluate({ evidence: items.map((item, index) => ({ ...item, id: `ev-${index + 1}` })), path: 'run', canaryTokens: [canary] });
  assert.ok(!verdict.findings.some(finding => finding.id === 'exfil-attempt'));
});

test('fresh read/write observations after execve rebuild same-PID previews', async () => {
  const stale = 'OLD';
  const fresh = 'NEW';
  const read = (text, clock) => line(clock, 10, 'python3', 'X', `read(0x5 /tmp/source, 0xaaa "${text}", 0x1000)`, ' = 3 (0x3) (5µs)');
  const write = (text, clock) => line(clock, 10, 'python3', 'E', `write(0x5 /tmp/source, 0xbbb "${text}", 0x3)`);
  const exec = line('00:01:08.030000', 10, 'python3', 'X', 'execve(0x1 /usr/bin/child, 0x2 ["child"], 0x3 [])', ' = 0 (0x0) (1µs)');
  const sendto = line('00:01:08.060000', 10, 'python3', 'E', 'sendto(0x3 socket:[1], 0xaaa, 0x3, 0x0, null, 0x0)');
  const sendmsg = line('00:01:08.070000', 10, 'python3', 'E', 'sendmsg(0x3 socket:[1], 0x7 {msg_iov=[{base=0xbbb, len=3}], msg_iovlen=1}, 0x0)');
  const { items } = await parse([START, read(stale, '00:01:08.010000'), write(stale, '00:01:08.020000'), exec, read(fresh, '00:01:08.040000'), write(fresh, '00:01:08.050000'), sendto, sendmsg]);
  assert.deepEqual(ofKind(items, 'sendto').map(item => item.payloadPreview), [fresh, fresh]);
});

test('another PID exec and a failed exec preserve the current PID cache', async () => {
  const readPayload = 'READ';
  const writePayload = 'WRIT';
  const read = line('00:01:08.010000', 10, 'python3', 'X', `read(0x5 /tmp/source, 0xaaa "${readPayload}", 0x1000)`, ' = 4 (0x4) (5µs)');
  const write = line('00:01:08.020000', 10, 'python3', 'E', `write(0x5 /tmp/source, 0xbbb "${writePayload}", 0x4)`);
  const otherExec = line('00:01:08.030000', 20, 'python3', 'X', 'execve(0x1 /usr/bin/child, 0x2 ["child"], 0x3 [])', ' = 0 (0x0) (1µs)');
  const failedExec = line('00:01:08.040000', 10, 'python3', 'X', 'execve(0x1 /usr/bin/missing, 0x2 ["missing"], 0x3 [])', ' = -1 errno=2 (no such file or directory) (1µs)');
  const sendto = line('00:01:08.050000', 10, 'python3', 'E', 'sendto(0x3 socket:[1], 0xaaa, 0x4, 0x0, null, 0x0)');
  const sendmsg = line('00:01:08.060000', 10, 'python3', 'E', 'sendmsg(0x3 socket:[1], 0x7 {msg_iov=[{base=0xbbb, len=4}], msg_iovlen=1}, 0x0)');
  const { items } = await parse([START, read, write, otherExec, failedExec, sendto, sendmsg]);
  assert.deepEqual(ofKind(items, 'sendto').map(item => item.payloadPreview), [readPayload, writePayload]);
});

test('sample-start-shaped execve also invalidates cached buffers before its early return', async () => {
  const canary = 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA';
  const length = Buffer.byteLength(canary);
  const connect = line('00:01:08.000000', 1, 'python3', 'E', 'connect(0x3 socket:[1], 0x7ee8 {Family: AF_INET, Addr: 203.0.113.7, Port: 443}, 0x10)');
  const read = line('00:01:08.010000', 1, 'python3', 'X', `read(0x5 /tmp/source, 0xaaa "${canary}", 0x1000)`, ` = ${length} (0x${length.toString(16)}) (5µs)`);
  const write = line('00:01:08.020000', 1, 'python3', 'E', `write(0x5 /tmp/source, 0xbbb "${canary}", 0x${length.toString(16)})`);
  const sampleExec = line('00:01:08.030000', 1, 'bash', 'X', 'execve(0x1 /usr/bin/python3, 0x2 ["python3", "/home/dana/Downloads/sample.py"], 0x3 [])', ' = 0 (0x0) (1µs)');
  const sendto = line('00:01:08.040000', 1, 'python3', 'E', `sendto(0x3 socket:[1], 0xaaa, 0x${length.toString(16)}, 0x0, null, 0x0)`);
  const sendmsg = line('00:01:08.050000', 1, 'python3', 'E', `sendmsg(0x3 socket:[1], 0x7 {msg_iov=[{base=0xbbb, len=${length}}], msg_iovlen=1}, 0x0)`);
  const { items } = await parse([START, connect, read, write, sampleExec, sendto, sendmsg]);
  assert.deepEqual(ofKind(items, 'sendto').map(item => item.payloadPreview), ['', '']);
});

test('the real probe: canary bytes reach the sendto, sendmsg and socket-write evidence; execve retries and runner lines are dropped', async () => {
  const { items, sampleStarted, pidsLimit } = await parse(PROBE);
  assert.equal(sampleStarted, true);
  assert.equal(pidsLimit, false);
  assert.deepEqual(ofKind(items, 'sendto').map(item => [item.host, item.port, item.payloadPreview]), [
    ['203.0.113.7', 443, 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA'], // sendall: sendto with a null address
    ['203.0.113.7', 443, 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA'], // os.write to the socket
    ['203.0.113.7', 53, 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA'], // UDP sendto with an address
    ['unknown', 0, 'TOKENXYZ12-AAAAAAAAAAAAAAAAAAAA'], // sendmsg: the address is a pointer in the trace
  ]);
  assert.deepEqual(items.filter(item => item.kind === 'unlink' || item.kind === 'rmdir').map(item => [item.kind, item.path, item.errno]), [
    ['rmdir', '/tmp/pd/sub', undefined], ['unlink', '/tmp/pd/b.txt', undefined], ['unlink', '/bin/ls', 13], ['rmdir', '/usr/lib', 13], ['rmdir', '/tmp/pd', undefined],
  ]);
  assert.deepEqual(ofKind(items, 'execve').map(item => [item.path, item.argv]), [
    ['/usr/bin/rm', ['rm', '-f', '/tmp/nothing']], ['/usr/bin/rm', ['rm', '-f', '/bin/ls']],
  ]);
  assert.ok(!items.some(item => item.path === '/home/dana/Documents/notes.txt'), 'the runner cp is not the sample');
  assert.deepEqual(ofKind(items, 'rename').map(item => [item.from, item.to]), [['/tmp/pd/a.txt', '/tmp/pd/b.txt']]);
});

test('failed clone-family calls (EAGAIN or ENOMEM) become one clone-eagain count and flag the pids limit; successful ones do not', async () => {
  const clone = tail => line('00:01:08.000000', 1, 'python3', 'X', 'clone(CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|0x11, 0x0, 0x0, 0x7ea4bede2310, 0x0)', tail);
  const quiet = await parse([START, clone(' = 2 (0x2) (4.324497ms)')]);
  assert.deepEqual([quiet.items, quiet.pidsLimit], [[], false]);
  const flood = await parse([
    START, clone(' = 2 (0x2) (4.3ms)'), clone(' = -1 errno=11 (resource temporarily unavailable) (4.3µs)'), clone(' = -1 errno=12 (cannot allocate memory) (4.3µs)'),
    line('00:01:08.000000', 1, 'python3', 'X', 'vfork()', ' = -1 errno=12 (cannot allocate memory) (9µs)'),
  ]);
  assert.equal(flood.pidsLimit, true);
  assert.deepEqual(flood.items.map(({ kind, count }) => ({ kind, count })), [{ kind: 'clone-eagain', count: 3 }]);
  assert.equal(flood.sandboxCrash, false, 'a clone failure is not a sandbox crash');
});

test('clone-eagain also carries `created`: the successful clone-family calls before the first failure (PIDS-AND-WINE.md A.5, gVisor nproc)', async () => {
  const call = (name, tail) => line('00:01:08.000000', 1, 'forkloop', 'X', `${name}(CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|0x11, 0x0, 0x0, 0x4b3650, 0x0)`, tail);
  const success = pid => ` = ${pid} (0x${pid.toString(16)}) (165.402µs)`;
  const capped = ' = -1 errno=11 (try again) (47.55217ms)'; // the wording of the real failing line
  const lines = [START, call('clone', success(2)), line('00:01:08.000000', 1, 'forkloop', 'X', 'vfork()', success(3)), call('clone3', success(4)), call('clone', ' = 0 (0x0) (1µs)'), call('clone', capped), call('clone', success(5)), call('clone', capped)];
  const { items, pidsLimit } = await parse(lines);
  assert.equal(pidsLimit, true);
  assert.deepEqual(items.map(({ kind, count, created }) => ({ kind, count, created })), [{ kind: 'clone-eagain', count: 2, created: 3 }]);
  const none = await parse([START, call('clone', capped)]);
  assert.deepEqual(none.items.map(({ count, created }) => [count, created]), [[1, 0]]);
  const hundred = await parse([START, ...Array.from({ length: 100 }, (_, i) => call('clone', success(i + 2))), call('clone', capped)]);
  assert.deepEqual(hundred.items.map(({ count, created }) => [count, created]), [[1, 100]]);
  const noFailure = await parse([START, ...Array.from({ length: 100 }, (_, i) => call('clone', success(i + 2)))]);
  assert.deepEqual([noFailure.items, noFailure.pidsLimit], [[], false]);
});

test('a runsc sandbox panic on process creation sets the pids-limit flag even with no clone failure in the trace', async () => {
  const crash = 'I1008 00:01:09.000000       1 main.go:1] panic: Unknown syscall 56 error: createSysmsgThread: failed to get clone';
  const { items, pidsLimit, sandboxCrash } = await parse([START, crash]);
  assert.deepEqual([items, pidsLimit, sandboxCrash], [[], true, true]);
});

test('per-kind trace overflow adds incomplete evidence while preserving the cap', async () => {
  const writes = Array.from({ length: 101 }, (_, i) => line('00:01:08.000000', 1, 'python3', 'X', `openat(AT_FDCWD /home/dana, 0x7 /tmp/f${i}, O_WRONLY|O_CREAT, 0o666)`, ok));
  const { items } = await parse([START, ...writes]);
  assert.equal(ofKind(items, 'file-write').length, 100);
  assert.deepEqual(items.filter(item => item.reason === 'trace-item-cap').map(item => item.kind), ['emulation-stopped']);
  const verdict = evaluate({ evidence: items.map((item, index) => ({ ...item, id: `ev-${index + 1}` })), path: 'run' });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.signals.includes('incomplete'));
});

test('duplicate events after a per-kind cap do not trigger overflow evidence', async () => {
  const writes = Array.from({ length: 100 }, (_, i) => line('00:01:08.000000', 1, 'python3', 'X', `openat(AT_FDCWD /home/dana, 0x7 /tmp/f${i}, O_WRONLY|O_CREAT, 0o666)`, ok));
  writes.push(line('00:01:08.100000', 1, 'python3', 'X', 'openat(AT_FDCWD /home/dana, 0x7 /tmp/f0, O_WRONLY|O_CREAT, 0o666)', ok));
  const { items } = await parse([START, ...writes]);
  assert.equal(ofKind(items, 'file-write').length, 100);
  assert.equal(items.some(item => item.reason === 'trace-item-cap'), false);
});

test('overflow across kinds records one marker and continues collecting other evidence', async () => {
  const writes = Array.from({ length: 101 }, (_, i) => line('00:01:08.000000', 1, 'python3', 'X', `openat(AT_FDCWD /home/dana, 0x7 /tmp/f${i}, O_WRONLY|O_CREAT, 0o666)`, ok));
  const unlinks = Array.from({ length: 101 }, (_, i) => line('00:01:08.100000', 1, 'python3', 'X', `unlink(0x7 /tmp/u${i})`, ' = 0 (0x0) (1µs)'));
  const connect = line('00:01:08.200000', 1, 'python3', 'E', 'connect(0x3 socket:[1], 0x7ee8 {Family: AF_INET, Addr: 203.0.113.7, Port: 443}, 0x10)');
  const { items } = await parse([START, ...writes, ...unlinks, connect]);
  assert.equal(ofKind(items, 'file-write').length, 100);
  assert.equal(ofKind(items, 'unlink').length, 100);
  assert.equal(items.filter(item => item.reason === 'trace-item-cap').length, 1);
  assert.equal(ofKind(items, 'connect').length, 1);
});

function logDir(content, name = 'runsc.log.20261008-005953.634183.boot.txt') {
  const dir = mkdtempSync(join(tmpdir(), 'do-trace-'));
  writeFileSync(join(dir, name), content);
  writeFileSync(join(dir, 'runsc.log.20261008-005953.634183.create.txt'), `${line('00:01:08.000000', 1, 'x', 'X', 'unlink(0x7 /create-log-is-ignored)', ' = 0 (0x0) (1µs)')}\n`);
  return dir;
}

test('parseTraceDir reads only *.boot.txt and reports a missing log as an error', async () => {
  const dir = logDir(`${[START, ...SAMPLES].join('\n')}\n`);
  const parsed = await parseTraceDir(dir, { now: NOW });
  assert.equal(parsed.truncated, false);
  assert.ok(parsed.items.length > 3);
  assert.ok(!parsed.items.some(item => item.path === '/create-log-is-ignored'));
  const empty = mkdtempSync(join(tmpdir(), 'do-trace-'));
  mkdirSync(join(empty, 'sub'));
  await assert.rejects(parseTraceDir(empty, { now: NOW }), /trace log is missing/);
});

test('parseTraceDir stops at the byte cap, drops the cut last line, flags truncation and still sees a panic in the unread tail', async () => {
  const lines = [START, ...Array.from({ length: 200 }, (_, i) => line('00:01:08.000000', 1, 'python3', 'X', `unlink(0x7 /tmp/file-${i})`, ' = 0 (0x0) (1µs)'))];
  const text = `${lines.join('\n')}\n`;
  const cap = Math.floor(text.length / 2);
  const cut = await parseTraceDir(logDir(text), { cap, now: NOW });
  assert.equal(cut.truncated, true);
  assert.ok(cut.items.length > 20 && cut.items.length < 150);
  const last = Number(cut.items.at(-1).path.split('-')[1]);
  assert.equal(cut.items.length, last + 1, 'no gap and no half line');
  assert.equal(cut.pidsLimit, false);
  const crashed = await parseTraceDir(logDir(`${text}I1008 00:02:00.000000       1 main.go:1] panic: createSysmsgThread: failed to get clone\n`), { cap, now: NOW });
  assert.deepEqual([crashed.pidsLimit, crashed.sandboxCrash], [true, true]);
  assert.equal(TRACE_CAP_BYTES, 20 * 1024 * 1024);
});
