// gVisor `runsc-trace` debug log to EVIDENCE.md `trace` items (docs/SPEC.md 6.4, 7.3; line format: docs/evidence/gvisor-wsl/REPORT.md).
// The log is read as a stream and at most TRACE_CAP_BYTES of it. Only strace lines and the two runner-exit markers are used.
//
// Scope rule: runsc traces the whole container, including the runner (run.sh: bash, cp, chmod). Nothing is kept until the
// first `execve` of `python3`, `bash` or `node` with the single argument `.../Downloads/sample.<py|sh|js>` (the interpreter
// starting the sandboxed sample; cp and chmod name the same path but take more arguments). That `execve` and its PATH-search
// retries are dropped, and every later syscall of every process is the sample's. `pwsh` (ps1) and `soffice` (Office) take flags
// first, so for them the file is the last argument. Runner kinds that run a tool over the file instead of the file itself (Playwright
// for html, svg and pdf, Speakeasy for exe, 7zz and python email for zip and eml) are not traced: the file's code does not make
// syscalls there, the tool's own are noise, and `kind` turns the syscall items off (a sandbox crash is still seen).
// Scratch the runner gives its tools lives under /tmp/dt (NOISE_PATH); a macro that writes there is not seen by the trace
// (the file diff covers only the home volume), a known gap recorded in deploy/detonation/runner/README.md.
//
// What the trace shows (measured, release-20260928.0): `sendto` prints only the buffer pointer, never its bytes, so a
// payload preview is looked up from the last `read`/`write` in the same pid that printed the same address and length; a successful execve clears that pid's cache
// (what the sample read is what it sent). `sendmsg` and `write` print their data. `execve` exit lines always say `= 0`; a
// PATH-search miss is dropped when the same pid executes again at once (or when a `loader.go ... Error opening` line follows,
// which runsc rate-limits). Under runsc a pids-limit hit shows as ENOMEM/EAGAIN on a clone-family call or as a sandbox panic
// (`createSysmsgThread: failed to get clone`), not as EAGAIN alone. With `--ulimit nproc=128:128` gVisor refuses the 129th task with
// EAGAIN on the clone-family call and does not crash (docs/evidence/gvisor-wsl/PIDS-AND-WINE.md A).
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createInterface } from 'node:readline';

export const TRACE_CAP_BYTES = 20 * 1024 * 1024;
const PREVIEW_CHARS = 256;
const BUFFER_MEMORY = 512;
const MAX_ARGV = 32;
const MAX_ARG_CHARS = 256;
// Per-kind caps keep a noisy sample from pushing the job over the 500-item evidence limit (jobs.mjs MAX_EVIDENCE).
const MAX_ITEMS = { 'file-read': 100, 'file-write': 100, unlink: 100, rmdir: 40, rename: 40, execve: 40, connect: 40, sendto: 40 };
const SAMPLE_ARG = /\/(?:Downloads|tmp\/dt)\/sample\.(?:py|sh|js|ps1|docx|docm|xlsx|xlsm|doc|xls|pptx)$/;
const INTERPRETERS = new Set(['python3', 'bash', 'node']);
// LibreOffice's launcher script (soffice) runs helpers first; the scope starts at the program it execs, which takes the file last.
const FLAG_TAKING = new Set(['pwsh', 'soffice.bin', 'oosplash']);
// LibreOffice's own start-up helpers (gpg key discovery, paper size) are not the document's doing.
const LIBREOFFICE_EXEC = /^\/usr\/bin\/(?:gpgconf|gpg|gpgsm)(?: |$)|paperconf/;
const QUIET_SOCKETS = new Set(['ps1', 'office']); // their runtimes send on sockets the trace never saw opened; those are internal pipes
const TRACED_KINDS = new Set(['py', 'sh', 'node', 'ps1', 'office']);
const READ_PATH = /^\/(?:home|root|tmp|var\/tmp|dev\/shm)\//;
const NOISE_PATH = /^\/(?:dev|proc|sys)\/|\/__pycache__\/|^\/tmp\/(?:dt\/|\.dotnet\/|clr-debug-pipe|CoreFxPipe_|OSL_PIPE_)/;
const WRITE_FLAGS = /O_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)/;
const O_PATH_FLAG = /(?:^|\|)O_PATH(?:\||$)/;
const AT_REMOVEDIR = 0x200;
const ENOENT = 2;
const PROCESS_CREATION_FAILURES = new Set([11, 12]); // EAGAIN, ENOMEM
const SANDBOX_CRASH = /createSysmsgThread: failed to get clone|Failed to create new memory manager/;

const HEAD = /^[IWEF](\d\d)(\d\d) (\d\d):(\d\d):(\d\d)\.(\d+) +\d+ strace\.go:\d+\] \[ *(\d+): *\d+\] .+? ([EX]) (\w+)\((.*)$/;
const RESULT = /^(.*)\) = (?:(-?\d+) \(0x[0-9a-f]+\)|-1 errno=(\d+) \([^)]*\)) \([^)]*\)$/;
const LOADER_MISS = /loader\.go:\d+\] \[ *(\d+): *\d+\] Error opening /;
const SOCKADDR = /Family: (AF_INET6?), Addr: ([^,}\s]+), Port: (\d+)/;
const QUOTED = /"((?:[^"\\]|\\.)*)"/g;
const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };

const unescape = text => text.replace(/\\(x[0-9a-fA-F]{2}|.)/g, (_, code) => (code.length === 3 ? String.fromCharCode(parseInt(code.slice(1), 16)) : ESCAPES[code] ?? code));
const quotedStrings = text => [...text.matchAll(QUOTED)].map(match => unescape(match[1]));
const preview = text => text.slice(0, PREVIEW_CHARS);
// `0x7ec0… /tmp/x` or `AT_FDCWD /` or `0x3 socket:[1]` to the text after the pointer or fd token.
const textOf = arg => arg.replace(/^(?:0x[0-9a-f]+|AT_FDCWD) ?/, '');
const pointerOf = arg => /^0x[0-9a-f]+/.exec(arg)?.[0];
const bufferKey = (pid, pointer) => pointer ? `${pid}:${pointer}` : null;

/** Top-level comma split that keeps quoted data, braces and brackets whole. */
function splitArgs(text) {
  const args = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '\\') i += 1;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

function resolvePath(dirfd, path) {
  const target = textOf(path);
  if (!target) return '';
  if (target.startsWith('/')) return posix.normalize(target);
  const base = textOf(dirfd);
  return base.startsWith('/') ? posix.join(base, target) : '';
}

// glog time has no year and uses the host's local zone (REPORT 4).
function timestamp([month, day, hour, minute, second, fraction], now) {
  const at = year => new Date(year, month - 1, day, hour, minute, second, Number(fraction.slice(0, 3).padEnd(3, '0')));
  const date = at(now.getFullYear());
  return (date.getTime() > now.getTime() + 86_400_000 ? at(now.getFullYear() - 1) : date).toISOString();
}

/**
 * Consumes log lines (any iterable or async iterable of strings).
 * Returns `{items, sampleStarted, traced, pidsLimit, sandboxCrash}`: items sorted by time, `pidsLimit` true when process creation failed or the sandbox
 * crashed on it, `sandboxCrash` true only for the crash. The `clone-eagain` item carries `count` (failed creations) and `created`
 * (successful clone-family calls, threads included, before the first failure). `kind` is the runner kind; one that is not in
 * TRACED_KINDS yields no items (`traced` false, `sampleStarted` true so a missing marker is not an error).
 */
export async function parseTraceLines(lines, { now = new Date(), kind = 'py' } = {}) {
  const traced = TRACED_KINDS.has(kind);
  const items = [];
  const counts = {};
  const seen = new Set();
  let itemCapNoted = false;
  const sockets = new Map();
  const buffers = new Map();
  const pendingExec = new Map();
  let started = false;
  let sandboxCrash = false;
  let cloneCreated = 0;
  let cloneFailures = 0;
  let firstCloneFailure = null;

  const add = (kind, at, fields, detail, dedupe) => {
    const key = dedupe === undefined ? null : `${kind}\0${dedupe}`;
    if (key !== null && seen.has(key)) return;
    if ((counts[kind] ?? 0) >= MAX_ITEMS[kind]) {
      if (!itemCapNoted) {
        itemCapNoted = true;
        items.push({ source: 'trace', kind: 'emulation-stopped', detail: 'The trace evidence item cap was reached; further events were omitted.', at, reason: 'trace-item-cap' });
      }
      return;
    }
    if (key !== null) seen.add(key);
    counts[kind] = (counts[kind] ?? 0) + 1;
    items.push({ source: 'trace', kind, detail, at, ...fields });
  };
  const remember = (pid, pointer, length, text) => {
    const key = bufferKey(pid, pointer);
    if (!key || !text || !(length > 0)) return;
    buffers.delete(key);
    buffers.set(key, { length, text });
    if (buffers.size > BUFFER_MEMORY) buffers.delete(buffers.keys().next().value);
  };
  const invalidateBuffers = pid => {
    const prefix = `${pid}:`;
    for (const key of buffers.keys()) if (key.startsWith(prefix)) buffers.delete(key);
  };
  const socketOf = arg => /socket:\[\d+\]/.exec(arg)?.[0];
  const destination = (socket, addr) => {
    const parsed = addr && SOCKADDR.exec(addr);
    return parsed ? { host: parsed[2], port: Number(parsed[3]) } : sockets.get(socket) ?? { host: 'unknown', port: 0 };
  };
  const send = (at, args, socket, previewText) => {
    const { host, port } = destination(socket, args.find(arg => SOCKADDR.test(arg)));
    if (host === 'unknown' && QUIET_SOCKETS.has(kind)) return;
    add('sendto', at, { host, port, payloadPreview: previewText }, `send to ${host}:${port}`);
  };
  const flushExec = pid => {
    const item = pendingExec.get(pid);
    if (!item) return;
    pendingExec.delete(pid);
    if (kind === 'office' && LIBREOFFICE_EXEC.test([item.path, ...item.argv].join(' '))) return;
    add('execve', item.at, { path: item.path, argv: item.argv }, `execve ${item.path}`);
  };

  const handle = ({ pid, phase, name, args, ret, errno, at }) => {
    const exit = phase === 'X';
    if (name === 'execve') {
      if (!exit || errno !== undefined) return;
      invalidateBuffers(pid);
      const [path, argvText] = [textOf(args[0]), args[1] ?? ''];
      const argv = quotedStrings(argvText).slice(0, MAX_ARGV).map(arg => arg.slice(0, MAX_ARG_CHARS));
      // The runner's own cp and chmod also name the sample path; only the interpreter takes it as its sole argument.
      const base = posix.basename(argv[0] ?? '');
      if (SAMPLE_ARG.test(argv.at(-1) ?? '') && ((argv.length === 2 && INTERPRETERS.has(base)) || (argv.length >= 2 && FLAG_TAKING.has(base)))) { started = true; return; }
      if (started && path) pendingExec.set(pid, { at, path, argv });
      return;
    }
    if (!started || !traced) return;
    const failed = errno !== undefined;
    switch (name) {
      case 'openat': case 'creat': {
        if (!exit || failed) return;
        const [dirfd, file, flags = ''] = name === 'creat' ? ['AT_FDCWD /', args[0], 'O_WRONLY'] : args;
        const path = resolvePath(dirfd, file);
        if (!path || NOISE_PATH.test(path) || SAMPLE_ARG.test(path) || O_PATH_FLAG.test(flags)) return;
        if (WRITE_FLAGS.test(flags)) add('file-write', at, { path }, `write ${path}`, path);
        else if (!flags.includes('O_DIRECTORY') && READ_PATH.test(path)) add('file-read', at, { path }, `read ${path}`, path);
        return;
      }
      case 'unlink': case 'unlinkat': case 'rmdir': {
        if (!exit || errno === ENOENT) return;
        const removeDir = name === 'rmdir' || (name === 'unlinkat' && (/AT_REMOVEDIR/.test(args[2] ?? '') || (parseInt(args[2] ?? '', 16) & AT_REMOVEDIR) !== 0));
        const path = name === 'unlinkat' ? resolvePath(args[0], args[1]) : textOf(args[0]);
        if (!path || NOISE_PATH.test(path)) return;
        const fields = { path, ...(failed ? { errno } : {}), ...(!removeDir && SAMPLE_ARG.test(path) ? { self: true } : {}) };
        add(removeDir ? 'rmdir' : 'unlink', at, fields, `${removeDir ? 'rmdir' : 'unlink'} ${path}${failed ? ` (errno ${errno})` : ''}`, path);
        return;
      }
      case 'rename': case 'renameat': case 'renameat2': {
        if (!exit || errno === ENOENT) return;
        const [from, to] = name === 'rename' ? [textOf(args[0]), textOf(args[1])] : [resolvePath(args[0], args[1]), resolvePath(args[2], args[3])];
        if (from && to && !NOISE_PATH.test(from)) add('rename', at, { from, to }, `rename ${from} to ${to}`);
        return;
      }
      case 'clone': case 'clone3': case 'fork': case 'vfork':
        if (!exit) return;
        if (PROCESS_CREATION_FAILURES.has(errno)) { cloneFailures += 1; firstCloneFailure ??= at; }
        else if (!failed && ret > 0 && !cloneFailures) cloneCreated += 1;
        return;
      case 'read': case 'pread64':
        if (exit && ret > 0) remember(pid, pointerOf(args[1] ?? ''), ret, quotedStrings(args[1] ?? '')[0] ?? '');
        return;
      case 'connect': {
        if (exit) return;
        const parsed = SOCKADDR.exec(args[1] ?? '');
        const socket = socketOf(args[0]);
        if (!parsed || !socket) return;
        const target = { host: parsed[2], port: Number(parsed[3]) };
        sockets.set(socket, target);
        add('connect', at, { ...target, payloadPreview: '' }, `connect ${target.host}:${target.port}`);
        return;
      }
      case 'sendto': {
        const socket = socketOf(args[0]);
        if (exit || !socket) return;
        const known = buffers.get(bufferKey(pid, pointerOf(args[1] ?? '')));
        send(at, args, socket, quotedStrings(args[1] ?? '')[0] ?? (known?.length === parseInt(args[2] ?? '', 16) ? known.text : ''));
        return;
      }
      case 'sendmsg': case 'sendmmsg': {
        const socket = socketOf(args[0]);
        if (exit || !socket) return;
        const iovec = /base=(0x[0-9a-f]+), len=(\d+)/.exec(args[1] ?? '');
        const known = iovec && buffers.get(bufferKey(pid, iovec[1]));
        send(at, args, socket, preview(quotedStrings(args.slice(1).join(',')).join('')) || (known && known.length === Number(iovec[2]) ? known.text : ''));
        return;
      }
      case 'write': {
        if (exit) return;
        const text = quotedStrings(args[1] ?? '')[0] ?? '';
        remember(pid, pointerOf(args[1] ?? ''), parseInt(args[2] ?? '', 16), text);
        const socket = socketOf(args[0]);
        if (socket) send(at, args, socket, text);
        return;
      }
      default:
    }
  };

  for await (const line of lines) {
    if (!line.includes(' strace.go:')) {
      const miss = LOADER_MISS.exec(line);
      if (miss) pendingExec.delete(Number(miss[1]));
      else if (SANDBOX_CRASH.test(line)) sandboxCrash = true;
      continue;
    }
    const head = HEAD.exec(line);
    if (!head) continue;
    const [, month, day, hour, minute, second, fraction, pidText, phase, name, rest] = head;
    const pid = Number(pidText);
    // A PATH-search miss is followed at once by the next attempt of the same pid; a real exec is followed by the new image's own calls.
    if (name === 'execve' && pendingExec.has(pid)) pendingExec.delete(pid);
    else flushExec(pid);
    const result = RESULT.exec(rest);
    const argText = result ? result[1] : rest.endsWith(')') ? rest.slice(0, -1) : rest;
    handle({
      pid, phase, name, args: splitArgs(argText), ret: result?.[2] === undefined ? undefined : Number(result[2]),
      errno: result?.[3] === undefined ? undefined : Number(result[3]), at: timestamp([month, day, hour, minute, second, fraction], now),
    });
  }
  for (const pid of [...pendingExec.keys()]) flushExec(pid);
  if (cloneFailures) {
    items.push({ source: 'trace', kind: 'clone-eagain', detail: `${cloneFailures} process creations failed after ${cloneCreated} succeeded`, at: firstCloneFailure, count: cloneFailures, created: cloneCreated });
  }
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { items, sampleStarted: started || !traced, traced, pidsLimit: sandboxCrash || cloneFailures > 0, sandboxCrash };
}

/** Streams one file, at most `cap` bytes; a cut final line is dropped. */
async function* readLines(path, size, cap) {
  const truncated = size > cap;
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8', end: cap - 1 }), crlfDelay: Infinity });
  let held;
  for await (const line of reader) {
    if (held !== undefined) yield held;
    held = line;
  }
  if (held !== undefined && !truncated) yield held;
}

/**
 * Parses `<dir>/*.boot.txt` (REPORT 2: the file name carries a start time). Returns `parseTraceLines` plus `truncated`
 * (the log was longer than `cap` bytes; a sandbox panic in the unread tail is still seen).
 */
export async function parseTraceDir(dir, { cap = TRACE_CAP_BYTES, now = new Date(), kind = 'py' } = {}) {
  const files = (await readdir(dir)).filter(name => name.endsWith('.boot.txt')).sort();
  if (!files.length) throw new Error('The syscall trace log is missing.');
  const sizes = await Promise.all(files.map(async name => (await stat(join(dir, name))).size));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const lines = (async function* all() {
    let room = cap;
    for (const [index, name] of files.entries()) {
      if (room <= 0) return;
      yield* readLines(join(dir, name), sizes[index], room);
      room -= sizes[index];
    }
  }());
  const parsed = await parseTraceLines(lines, { now, kind });
  const truncated = total > cap;
  if (truncated && !parsed.sandboxCrash) {
    const tail = createReadStream(join(dir, files.at(-1)), { encoding: 'utf8', start: Math.max(0, sizes.at(-1) - 64 * 1024) });
    let text = '';
    for await (const chunk of tail) text += chunk;
    parsed.sandboxCrash = SANDBOX_CRASH.test(text);
    parsed.pidsLimit ||= parsed.sandboxCrash;
  }
  return { ...parsed, truncated };
}
