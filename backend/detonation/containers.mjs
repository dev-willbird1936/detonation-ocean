// Detonation containers (docs/SPEC.md 6.3, 7.1-7.4): docker arguments, wall-clock run, isolation check,
// exit classification, teardown-and-confirm and the reaper. Every docker call goes through an injectable
// `docker(args, {timeoutMs, maxOutput}) -> {code, stdout, stderr, timedOut, truncated}` so tests need no Docker.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// `wine` is the one role that runs on runc (docs/evidence/gvisor-wsl/PIDS-AND-WINE.md Part B); the controller starts it only when DETONATION_WINE_RUNC=true.
export const ROLES = Object.freeze(['detonate', 'collect', 'analyse', 'wine']);
// Containers the controller starts around the analysed ones. They get the same 6.3 flags and the same isolation check but are
// not receipt roles: `seed` copies the profile into the home volume, `holder` keeps that volume mounted (see `startHome`).
export const SUPPORT_ROLES = Object.freeze(['seed', 'holder']);
const ALL_ROLES = [...ROLES, ...SUPPORT_ROLES];
export const OUTPUT_CAP_BYTES = 64 * 1024;
export const REAP_MAX_AGE_MS = 5 * 60_000;
// The home volume is a size-capped tmpfs (7.3). A tmpfs volume is unmounted when no container uses it, so `holder` runs for the job's life.
export const HOME_QUOTA = '128m';
export const HOLDER_SLEEP_SECONDS = 200;
const VOLUME_RM_ATTEMPTS = 4;
const VOLUME_RM_RETRY_MS = 500;
const LOCK_FILE = fileURLToPath(new URL('../../deploy/detonation/images.lock.json', import.meta.url));
export const SECCOMP_WINE_FILE = fileURLToPath(new URL('../../deploy/detonation/seccomp-wine.json', import.meta.url));
// Where `runsc-trace` writes one debug-log directory per container, named by the full container id (daemon.json, docs/SPEC.md 6.4).
export const RUNSC_LOG_ROOT = '/var/log/runsc';
const CONTAINER_ID = /^[0-9a-f]{64}$/;
export const EXIT_REASONS = Object.freeze(['time', 'oom', 'pids-limit']);
export const LIMITS = Object.freeze({ memoryBytes: 512 * 1024 * 1024, pidsLimit: 512, nproc: 128, nanoCpus: 1_000_000_000, user: '10001:10001' });
// gVisor ignores the pids cap for processes inside the sandbox and crashes when it is tight. The real process cap is the nproc ulimit;
// `--pids-limit` guards the sentry's host threads and stays at least 4 x nproc (docs/evidence/gvisor-wsl/PIDS-AND-WINE.md A).
// runc enforces the cap on real processes and the Wine seccomp profile guards the rest (PIDS-AND-WINE.md B). The Wine server and its helpers
// use well under 128; nproc stays at 128 like every role.
export const WINE_PIDS_LIMIT = 128;
export const pidsLimitFor = role => (role === 'wine' ? WINE_PIDS_LIMIT : LIMITS.pidsLimit);
export const JOB_LABEL = 'detonation-ocean.job';
export const ROLE_LABEL = 'detonation-ocean.role';
export const ROLE_RUNTIME = Object.freeze({ detonate: 'runsc-trace', collect: 'runsc', analyse: 'runsc', wine: 'runc', seed: 'runsc', holder: 'runsc' });
// Image name in images.lock.json that each role must run. The seed and holder run the same image as the job's detonate step.
const ROLE_IMAGE = Object.freeze({
  detonate: 'detonation-ocean/detonate', collect: 'detonation-ocean/collect', analyse: 'detonation-ocean/analyse', wine: 'detonation-ocean/wine',
  seed: 'detonation-ocean/detonate', holder: 'detonation-ocean/detonate',
});
const KILL_GRACE_MS = 10_000;
const JOB_ID_RE = /^[a-z0-9-]{1,48}$/;
const SECRET_NAME_RE = /VULTR_|KEY|TOKEN|SECRET/;
// Variables the python base image sets that match SECRET_NAME_RE but hold no secret. GPG_KEY is the public 40-hex release-signing
// fingerprint, or empty in our images (Dockerfile ENV cannot unset it, only blank it, and the name still matches).
const PUBLIC_IMAGE_VARS = [(name, value) => name === 'GPG_KEY' && /^(?:[0-9A-F]{40})?$/.test(value)];
const NO_NEW_PRIVILEGES = ['no-new-privileges:true', 'no-new-privileges=true', 'no-new-privileges'];
// The only host files a container may see, always `<jobDir>/<name>` (6.3).
// `parser` is the head of a child file for the parser loop (jobs.mjs); the uploaded file itself is `sample`.
const JOB_FILES = { seed: 'seed', sample: 'sample.bin', parser: 'parser-sample.bin', manifest: 'seed-manifest.json', evidence: 'evidence.json', diff: 'diff.json', static: 'static.json', script: 'script.py' };
const ROLE_BINDS = {
  seed: [['seed', '/seed']],
  holder: [],
  detonate: [['sample', '/in/sample']],
  wine: [['sample', '/in/sample']],
  collect: [['manifest', '/in/seed-manifest.json']],
  analyse: [['evidence', '/in/evidence.json'], ['diff', '/in/diff.json'], ['static', '/in/static.json'], ['script', '/in/script.py']],
};

const checkJobId = jobId => {
  if (!JOB_ID_RE.test(jobId ?? '')) throw new Error('jobId must match [a-z0-9-]{1,48}.');
  return jobId;
};
const checkRole = (role, allowed = ROLES) => {
  if (!allowed.includes(role)) throw new Error(`role must be one of: ${allowed.join(', ')}.`);
  return role;
};
const checkCounter = (name, value, min) => {
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${name} must be an integer of at least ${min}.`);
  return value;
};

/**
 * Path module for `jobDir` (Windows drive paths only occur in local tests) after checking it is exactly
 * `<dataDir>/jobs/<jobId>`: absolute, already normalised (no `..`, no trailing slash) and not the root, the Docker
 * socket directory or the controller data directory itself.
 */
function checkJobDir(jobDir, jobId) {
  const fs = typeof jobDir === 'string' && /^[A-Za-z]:[\\/]/.test(jobDir) ? win32 : posix;
  if (typeof jobDir !== 'string' || !fs.isAbsolute(jobDir) || fs.normalize(jobDir) !== jobDir || /[\\/]$/.test(jobDir) || /[,\n\0]|docker\.sock/.test(jobDir)
    || fs.basename(jobDir) !== checkJobId(jobId) || fs.basename(fs.dirname(jobDir)) !== 'jobs') {
    throw new Error('jobDir must be the absolute, normalised <dataDir>/jobs/<jobId> directory.');
  }
  return fs;
}

/** `do-<jobId>-<role>-i<item>-a<attempt>`: unique per child item and retry. The seed and holder (one each per job) are `do-<jobId>-<role>`. */
export const containerName = (jobId, role, itemIndex = 0, attempt = 1) => (SUPPORT_ROLES.includes(role)
  ? `do-${checkJobId(jobId)}-${role}`
  : `do-${checkJobId(jobId)}-${checkRole(role)}-i${checkCounter('itemIndex', itemIndex, 0)}-a${checkCounter('attempt', attempt, 1)}`);
export const homeVolumeName = jobId => `do-${checkJobId(jobId)}-home`;

/** Environment a container may see: nothing but this allowlist (7.2). */
export const allowedEnv = (itemIndex = 0) => ({
  HOME: '/home/dana', USER: 'dana', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', DETONATION_SANDBOX: '1', JOB_ITEM: String(checkCounter('itemIndex', itemIndex, 0)),
});

// Wine's prefix (registry, C: drive) is copied here at the start of a run. It must be executable (Wine maps its DLLs from it) and owned by the sandbox user.
const WINE_PREFIX_TMPFS = 'rw,exec,nosuid,nodev,size=192m,uid=10001,gid=10001,mode=0700';

export const tmpfsFor = role => ({
  '/tmp': 'rw,nosuid,nodev,size=64m',
  ...(checkRole(role, ALL_ROLES) === 'wine' ? { '/prefix': WINE_PREFIX_TMPFS } : {}),
  ...(['detonate', 'wine'].includes(role) || SUPPORT_ROLES.includes(role) ? {} : { '/out': 'rw,nosuid,nodev,noexec,size=8m' }),
});

/**
 * Bind and volume mounts per role (6.3). Every bind source is `<jobDir>/<fixed name>`; callers cannot name a host path.
 * `parserSample` ('sample' for the upload, 'parser' for a child's head) makes an `analyse` container a parser run: it sees only its script and
 * that file at /in/sample, not the job's evidence.
 */
export function mountsFor(jobId, role, jobDir, { parserSample } = {}) {
  const fs = checkJobDir(jobDir, jobId);
  const home = homeVolumeName(jobId);
  const parser = role === 'analyse' && ['sample', 'parser'].includes(parserSample);
  const keys = parser ? [['script', '/in/script.py'], [parserSample, '/in/sample']] : ROLE_BINDS[checkRole(role, ALL_ROLES)];
  const binds = keys.map(([key, target]) => ({ type: 'bind', source: fs.join(jobDir, JOB_FILES[key]), target, readOnly: true }));
  if (role === 'detonate' || role === 'seed' || role === 'wine') return [...binds, { type: 'volume', source: home, target: '/home/dana', readOnly: false }];
  if (role === 'collect' || role === 'holder') return [{ type: 'volume', source: home, target: '/home/dana', readOnly: true }, ...binds];
  return binds;
}

/**
 * `docker volume create` arguments for a plain home volume: the label lets teardown and the reaper find it. It has no size cap and
 * nothing keeps it alive between containers; `startHome` creates the capped volume the pipeline needs.
 */
export const homeVolumeCreateArgs = jobId => ['volume', 'create', '--label', `${JOB_LABEL}=${checkJobId(jobId)}`, homeVolumeName(jobId)];

/** Home volume of 7.3: a tmpfs capped at HOME_QUOTA, owned by the sandbox user. Writes past the cap fail with ENOSPC. */
export const quotaHomeVolumeCreateArgs = jobId => [
  ...homeVolumeCreateArgs(jobId).slice(0, -1),
  '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
  '--opt', `o=nosuid,nodev,size=${HOME_QUOTA},uid=${LIMITS.user.split(':')[0]},gid=${LIMITS.user.split(':')[1]},mode=0700`,
  homeVolumeName(jobId),
];

/** `docker create` arguments for one container. Every isolation flag of 6.3 lives here so a test can pin them. */
export function buildContainerArgs({ jobId, role, image, jobDir, itemIndex = 0, attempt = 1, entrypoint, command = [], parserSample, wineApproved = false, appArmor }) {
  if (role === 'wine' && wineApproved !== true) throw new Error('Wine execution requires explicit approval.');
  if (role === 'wine' && !['docker-default', 'unavailable'].includes(appArmor)) throw new Error('Wine requires a verified AppArmor capability decision.');
  if (typeof image !== 'string' || !image || image.startsWith('-')) throw new Error('image must be a non-empty image reference.');
  const mounts = mountsFor(jobId, role, jobDir, { parserSample }).flatMap(({ type, source, target, readOnly }) =>
    ['--mount', `type=${type},src=${source},dst=${target}${readOnly ? ',readonly' : ''}`]);
  return [
    'create', '--pull', 'never', '--name', containerName(jobId, role, itemIndex, attempt),
    '--runtime', ROLE_RUNTIME[role],
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    ...(role === 'wine' ? ['--security-opt', `seccomp=${SECCOMP_WINE_FILE}`, ...(appArmor === 'docker-default' ? ['--security-opt', 'apparmor=docker-default'] : [])] : []),
    '--user', LIMITS.user,
    '--ulimit', `nproc=${LIMITS.nproc}:${LIMITS.nproc}`,
    '--pids-limit', String(pidsLimitFor(role)),
    '--memory', '512m', '--memory-swap', '512m',
    '--cpus', '1',
    '--log-driver', 'none',
    ...Object.entries(tmpfsFor(role)).flatMap(([path, options]) => ['--tmpfs', `${path}:${options}`]),
    '--env-file', '/dev/null',
    ...Object.entries(allowedEnv(itemIndex)).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    '--label', `${JOB_LABEL}=${jobId}`, '--label', `${ROLE_LABEL}=${role}`,
    '--stop-timeout', '1',
    ...(entrypoint ? ['--entrypoint', entrypoint] : []), // the detonate image's entrypoint is the runner, which would reject `cp` or `sleep` as a job kind
    ...mounts,
    image, ...command,
  ];
}

const DEFAULT_DATA_DIR = '/var/lib/detonation-ocean';
const LEDGER_MAX_IDS = 5000;

/**
 * Ids of the containers this controller created, kept in `file` (when given) so a restart still knows them. The reaper deletes a
 * runsc log directory only if its name is in here. Unreadable or unwritable storage leaves the ledger in memory; that is safe,
 * because the reaper then deletes less.
 */
export function createContainerLedger(file) {
  const ids = new Set();
  if (file) {
    try {
      for (const id of JSON.parse(readFileSync(file, 'utf8'))) if (CONTAINER_ID.test(id)) ids.add(id);
    } catch { /* no ledger yet */ }
  }
  const save = () => {
    if (!file) return;
    try { writeFileSync(file, JSON.stringify([...ids]), { mode: 0o600 }); } catch { /* kept in memory */ }
  };
  return {
    add(id) {
      if (typeof id !== 'string' || !CONTAINER_ID.test(id) || ids.has(id)) return;
      ids.add(id);
      if (ids.size > LEDGER_MAX_IDS) ids.delete(ids.values().next().value);
      save();
    },
    has: id => ids.has(id),
    forget(id) { if (ids.delete(id)) save(); },
    ids: () => [...ids],
  };
}

let defaultLedger;
// One ledger per process, stored beside the job data (the same directory the job controller defaults to).
const sharedLedger = () => (defaultLedger ??= createContainerLedger(join(process.env.DETONATION_DATA_DIR || DEFAULT_DATA_DIR, 'container-ledger.json')));

let imageLock;
/** Image ids from images.lock.json (`{image: "sha256:..."}`), read once. An unreadable lock is empty, so no image verifies. */
export function loadImageLock(file = LOCK_FILE) {
  if (file !== LOCK_FILE) return JSON.parse(readFileSync(file, 'utf8'));
  try {
    return (imageLock ??= JSON.parse(readFileSync(LOCK_FILE, 'utf8')));
  } catch {
    return {};
  }
}

/** The only environment the Docker child process gets (7.2). */
export const dockerEnv = source => Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST'].filter(key => source[key] !== undefined).map(key => [key, source[key]]));

/** Keeps at most `cap` bytes, cutting at a UTF-8 character boundary. */
export function capBytes(text, cap = OUTPUT_CAP_BYTES) {
  const buffer = Buffer.from(text);
  if (buffer.length <= cap) return { text, truncated: false };
  let end = cap;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
}

/** Real executor: spawns the docker CLI and keeps at most `maxOutput` bytes of each stream. */
export function dockerExec(args, { timeoutMs = 15_000, maxOutput = OUTPUT_CAP_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: dockerEnv(process.env) });
    } catch (cause) {
      reject(new Error('docker CLI unavailable', { cause }));
      return;
    }
    const streams = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let truncated = false;
    let timedOut = false;
    const keep = name => chunk => {
      const room = maxOutput - sizes[name];
      if (chunk.length > room) truncated = true;
      if (room > 0) { streams[name].push(chunk.subarray(0, room)); sizes[name] += Math.min(room, chunk.length); }
    };
    child.stdout.on('data', keep('stdout'));
    child.stderr.on('data', keep('stderr'));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', cause => { clearTimeout(timer); reject(new Error('docker CLI unavailable', { cause })); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : code ?? 1, timedOut, truncated,
        stdout: Buffer.concat(streams.stdout).toString('utf8'), stderr: Buffer.concat(streams.stderr).toString('utf8'),
      });
    });
  });
}

const tryDocker = (docker, args, options) => docker(args, options).catch(error => ({ code: 1, stdout: '', stderr: error.message }));
/** Throws once the job's `signal` has aborted: its teardown has run or is about to, so nothing may be created for it any more. */
export const assertOpen = signal => {
  if (signal?.aborted) throw new Error('The job is closed.');
};
// runc nproc counts the real host UID. Serialize Wine in this process, including across controller instances.
// Unrelated host processes or another controller process are not covered by this gate.
let wineBusy = false;
let wineQuarantined = false;
const wineWaiters = [];
const wineBudgetError = () => Object.assign(new Error('Wine was not run: the job time budget was used while waiting.'), { code: 'WINE_JOB_BUDGET' });

function quarantineWine() {
  wineQuarantined = true;
  for (const waiter of wineWaiters.splice(0)) waiter.reject(new Error('Wine execution is quarantined: a previous stop was unconfirmed.'));
}

function acquireWine({ signal, timeLeftMs, requiredMs }) {
  assertOpen(signal);
  if (wineQuarantined) return Promise.reject(new Error('Wine execution is quarantined: a previous stop was unconfirmed.'));
  return new Promise((resolve, reject) => {
    let timer;
    const remove = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const index = wineWaiters.indexOf(waiter);
      if (index >= 0) wineWaiters.splice(index, 1);
    };
    const waiter = {
      reject(error) { remove(); reject(error); },
      grant() {
        remove();
        try {
          assertOpen(signal);
          if (typeof timeLeftMs === 'function' && timeLeftMs() < requiredMs) throw wineBudgetError();
        } catch (error) {
          reject(error);
          release();
          return;
        }
        wineBusy = true;
        resolve(release);
      },
    };
    const onAbort = () => waiter.reject(new Error('The job is closed.'));
    const release = () => {
      wineBusy = false;
      if (!wineQuarantined) wineWaiters.shift()?.grant();
    };
    if (!wineBusy) waiter.grant();
    else {
      wineWaiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (typeof timeLeftMs === 'function') {
        const waitMs = timeLeftMs() - requiredMs;
        if (waitMs <= 0) waiter.reject(wineBudgetError());
        else timer = setTimeout(() => waiter.reject(wineBudgetError()), waitMs);
      }
    }
  });
}

/** Daemon capability, not controller-host capability: a remote Docker host may have different LSM support. */
async function wineAppArmor(docker) {
  const result = await tryDocker(docker, ['info', '--format', '{{json .SecurityOptions}}']);
  if (result.code !== 0 || result.truncated || result.timedOut) throw new Error('Docker AppArmor capability could not be determined.');
  let options;
  try { options = JSON.parse(result.stdout); } catch { throw new Error('Docker AppArmor capability could not be determined.'); }
  if (!Array.isArray(options) || !options.every(option => typeof option === 'string')) throw new Error('Docker AppArmor capability could not be determined.');
  return options.some(option => /^(?:name=)?apparmor(?:,|$)/.test(option)) ? 'docker-default' : 'unavailable';
}

const lines = result => result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
const brief = result => result.stderr.trim().slice(0, 200);

/** `docker rm -f -v` for one of this job's containers. `removed` is false when docker refused. */
export async function removeContainer(jobId, name, { docker = dockerExec } = {}) {
  if (typeof name !== 'string' || !name.startsWith(`do-${checkJobId(jobId)}-`) || !/^do-[a-z0-9-]+$/.test(name)) throw new Error('name must be a container name of this job.');
  const result = await tryDocker(docker, ['rm', '-f', '-v', name]);
  return { removed: result.code === 0, error: result.code === 0 ? null : brief(result) };
}

const isStopped = async (docker, name) => {
  const state = await tryDocker(docker, ['container', 'inspect', '--format', '{{.State.Running}}', name]);
  return !state.truncated && !state.timedOut && (state.code === 0 ? state.stdout.trim() === 'false' : /no such container/i.test(state.stderr));
};

/** `docker kill`, then `docker rm -f -v` if the container still runs; throws unless it is confirmed stopped or gone. */
async function stopContainer(docker, name) {
  await tryDocker(docker, ['kill', name]);
  if (await isStopped(docker, name)) return;
  await tryDocker(docker, ['rm', '-f', '-v', name]);
  if (!(await isStopped(docker, name))) throw new Error(`Container ${name} was not confirmed stopped.`);
}

/**
 * `docker create` → inspect → `verifyIsolation`. A container that fails creation, inspection or verification is removed and the
 * call throws. The container id goes into `ledger` as soon as inspect shows it, before anything can start it. A `signal` that
 * is aborted before or during creation removes the container too: the job's teardown may already have listed its containers.
 */
async function createVerified({ docker, secrets = [], ledger = sharedLedger(), signal, timeLeftMs, wineWallClockMs = 0, wineApproved = false, jobId, role, image, jobDir, itemIndex, attempt, entrypoint, command, parserSample }) {
  assertOpen(signal);
  if (role === 'wine' && wineApproved !== true) throw new Error('Wine execution requires explicit approval.');
  // Execution never accepts caller-supplied image locks, seccomp profiles or AppArmor claims.
  const appArmor = role === 'wine' ? await wineAppArmor(docker) : undefined;
  assertOpen(signal);
  if (role === 'wine' && typeof timeLeftMs === 'function' && timeLeftMs() < wineWallClockMs + 5_000) throw wineBudgetError();
  const spec = { jobId, role, image, jobDir, itemIndex, attempt, entrypoint, command, parserSample, wineApproved, appArmor };
  const name = containerName(jobId, role, itemIndex, attempt);
  const discard = async reason => {
    const { removed } = await removeContainer(spec.jobId, name, { docker });
    throw new Error(`${reason}${removed ? '' : ' (container could not be removed)'}`);
  };
  const created = await tryDocker(docker, buildContainerArgs(spec));
  if (created.code !== 0) await discard(`docker create failed: ${brief(created)}`);
  const before = await tryDocker(docker, ['container', 'inspect', name]);
  if (before.code !== 0) await discard(`docker inspect failed: ${brief(before)}`);
  let isolation;
  try {
    ledger.add(JSON.parse(before.stdout)?.[0]?.Id);
    isolation = verifyIsolation(before.stdout, { jobId, role, jobDir, itemIndex, attempt, parserSample, secrets, imageLock: loadImageLock(), appArmor });
  } catch (error) {
    return discard(error.message);
  }
  if (signal?.aborted) return discard('The job closed before the container started.');
  return { name, isolation };
}

/**
 * Run one container: `docker create` → inspect → `verifyIsolation` → `docker start -a` under a wall-clock timer.
 * A container that fails creation or verification is removed and never started. When the timer fires the run waits for
 * `docker kill` (then `rm -f -v`) and a confirmed stop, or throws. Output is capped at 64 KB. The container is left in
 * place for `classifyExit`; `teardown` removes it. `secrets` are values that must not appear in its environment.
 * `outputCapBytes` raises the 64 KB stdout cap for a container whose stdout is a result channel (the analyse harness).
 * Execution always uses images.lock.json and the on-disk seccomp profile; only the ledger is injectable. A `signal` that is already
 * aborted (the job is closed) refuses to create or start anything; one that aborts during the run stops the container.
 */
export async function runContainer({ docker = dockerExec, wallClockMs, outputCapBytes = OUTPUT_CAP_BYTES, signal, timeLeftMs, ...spec }) {
  if (!(wallClockMs > 0)) throw new Error('wallClockMs must be positive.');
  if (spec.role === 'wine' && spec.wineApproved !== true) throw new Error('Wine execution requires explicit approval.');
  const releaseWine = spec.role === 'wine' ? await acquireWine({ signal, timeLeftMs, requiredMs: wallClockMs + 5_000 }) : null;
  let name;
  try {
    assertOpen(signal);
    if (releaseWine && typeof timeLeftMs === 'function' && timeLeftMs() < wallClockMs + 5_000) throw wineBudgetError();
    name = containerName(spec.jobId, spec.role, spec.itemIndex, spec.attempt);
    const { isolation } = await createVerified({ ...spec, docker, signal, timeLeftMs, wineWallClockMs: wallClockMs });
    assertOpen(signal);
    if (releaseWine && typeof timeLeftMs === 'function' && timeLeftMs() < wallClockMs) throw wineBudgetError();

    let timedOut = false;
    let stopping;
    const stop = () => (stopping ??= stopContainer(docker, name));
    const timer = setTimeout(() => { timedOut = true; stop().catch(() => {}); }, wallClockMs);
    const onAbort = () => { stop().catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    let result;
    try {
      assertOpen(signal);
      result = await docker(['start', '-a', name], { timeoutMs: wallClockMs + KILL_GRACE_MS, maxOutput: outputCapBytes });
    } catch (error) {
      await stop();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (timedOut || result.timedOut) { timedOut = true; await stop(); }
    if (signal?.aborted || stopping) await stop();
    const stdout = capBytes(result.stdout, outputCapBytes);
    const stderr = capBytes(result.stderr);
    const inspected = await tryDocker(docker, ['container', 'inspect', name]);
    return {
      name, code: result.code, timedOut, isolation,
      stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated || Boolean(result.truncated),
      inspectJson: inspected.code === 0 ? inspected.stdout : null,
    };
  } finally {
    if (releaseWine) {
      try {
        if (name && !(await isStopped(docker, name))) await stopContainer(docker, name);
      } catch (error) {
        quarantineWine();
        throw error;
      } finally {
        releaseWine();
      }
    }
  }
}

const sameOptions = (a = '', b = '') => a.split(',').sort().join() === b.split(',').sort().join();
const isEmpty = value => value == null || (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0);
// Exactly one ulimit: nproc with soft = hard = LIMITS.nproc.
const isNprocOnly = ulimits => Array.isArray(ulimits) && ulimits.length === 1 && ulimits[0].Name === 'nproc' && ulimits[0].Soft === LIMITS.nproc && ulimits[0].Hard === LIMITS.nproc;
const joinsOtherNamespace = mode => /^(host|container:)/.test(mode ?? '');

let wineProfile;
/** The Wine seccomp profile as parsed JSON, read once; null when the file is unreadable (then no wine container verifies). */
function loadWineProfile() {
  try {
    return (wineProfile ??= JSON.parse(readFileSync(SECCOMP_WINE_FILE, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Docker shows a `seccomp=<file>` option in SecurityOpt as the profile's JSON text. Wine must match the on-disk profile,
 * plus explicit docker-default when the daemon advertises AppArmor. Other roles show only no-new-privileges.
 */
function securityOptOk(options, role, appArmor) {
  if (!Array.isArray(options)) return false;
  const seccomp = options.filter(option => String(option).startsWith('seccomp='));
  const armor = options.filter(option => String(option).startsWith('apparmor='));
  const rest = options.filter(option => !String(option).startsWith('seccomp=') && !String(option).startsWith('apparmor='));
  if (rest.length !== 1 || !NO_NEW_PRIVILEGES.includes(rest[0])) return false;
  if (role !== 'wine') return seccomp.length === 0 && armor.length === 0;
  if (appArmor === 'docker-default' ? armor.length !== 1 || armor[0] !== 'apparmor=docker-default' : armor.length !== 0) return false;
  const expected = loadWineProfile();
  if (seccomp.length !== 1 || !expected) return false;
  try {
    return isDeepStrictEqual(JSON.parse(seccomp[0].slice('seccomp='.length)), expected);
  } catch {
    return false;
  }
}

/**
 * Throws unless the container shows every flag of 6.3, the role's runtime and mount list (derived from `jobDir`, never
 * from the caller), nothing extra (devices, binds, host namespaces, other security options) and no secret in its
 * environment. `secrets` are values that must not appear in any variable. The image must be the one pinned for the role in
 * `imageLock` (images.lock.json; tests inject it). The exit code is not checked: a killed sample is classified by `classifyExit`.
 */
export function verifyIsolation(inspectJson, { jobId, role, jobDir, itemIndex = 0, attempt = 1, secrets = [], imageLock: lock = loadImageLock(), parserSample, appArmor }) {
  const container = JSON.parse(inspectJson)?.[0];
  const host = container?.HostConfig ?? {};
  const networks = Object.keys(container?.NetworkSettings?.Networks ?? {});
  const labels = container?.Config?.Labels ?? {};
  const expectedMounts = mountsFor(jobId, role, jobDir, { parserSample });
  const wantTmpfs = Object.entries(tmpfsFor(role));
  const gotTmpfs = host.Tmpfs ?? {};
  const mounts = (container?.Mounts ?? []).filter(mount => mount.Type !== 'tmpfs');
  const configMounts = Array.isArray(host.Mounts) ? host.Mounts.filter(mount => mount.Type !== 'tmpfs') : null;
  const strayTmpfs = [...(container?.Mounts ?? []).filter(mount => mount.Type === 'tmpfs').map(mount => mount.Destination),
    ...(host.Mounts ?? []).filter(mount => mount.Type === 'tmpfs').map(mount => mount.Target)].some(path => !(path in gotTmpfs));
  const secretValues = secrets.filter(Boolean);
  const secretEnv = (container?.Config?.Env ?? []).filter(entry => {
    const [name, ...rest] = entry.split('=');
    return (SECRET_NAME_RE.test(name.toUpperCase()) && !PUBLIC_IMAGE_VARS.some(known => known(name, rest.join('=')))) || secretValues.some(secret => entry.includes(secret));
  });
  const pinned = lock?.[ROLE_IMAGE[role]];
  const problems = [];
  if (typeof pinned !== 'string' || container?.Image !== pinned) problems.push('image');
  if (container?.Name !== `/${containerName(jobId, role, itemIndex, attempt)}`) problems.push('name');
  if (host.Runtime !== ROLE_RUNTIME[role]) problems.push('runtime');
  if (host.NetworkMode !== 'none') problems.push('network-mode');
  if (networks.length !== 1 || networks[0] !== 'none') problems.push('networks');
  if (host.ReadonlyRootfs !== true) problems.push('read-only-root');
  if (!Array.isArray(host.CapDrop) || !host.CapDrop.some(cap => String(cap).toUpperCase() === 'ALL')) problems.push('cap-drop');
  if (host.Privileged === true || host.CapAdd?.length) problems.push('privileged');
  if (!securityOptOk(host.SecurityOpt, role, appArmor)) problems.push('security-opt');
  if (role === 'wine' && (!['docker-default', 'unavailable'].includes(appArmor)
    || (appArmor === 'docker-default' ? container?.AppArmorProfile !== 'docker-default' : Boolean(container?.AppArmorProfile)))) problems.push('apparmor');
  if (!isEmpty(host.Devices)) problems.push('devices');
  if ([host.PidMode, host.IpcMode, host.UsernsMode].some(joinsOtherNamespace)) problems.push('namespaces');
  if (![host.Binds, host.VolumesFrom, host.Links].every(isEmpty)) problems.push('binds');
  if (host.LogConfig?.Type !== 'none') problems.push('log-driver');
  if (container?.Config?.User !== LIMITS.user) problems.push('user');
  if (host.PidsLimit !== pidsLimitFor(role)) problems.push('pids-limit');
  if (!isNprocOnly(host.Ulimits)) problems.push('nproc');
  if (host.Memory !== LIMITS.memoryBytes) problems.push('memory');
  if (host.MemorySwap !== LIMITS.memoryBytes) problems.push('memory-swap');
  if (host.NanoCpus !== LIMITS.nanoCpus) problems.push('nano-cpus');
  if (Object.keys(gotTmpfs).length !== wantTmpfs.length || !wantTmpfs.every(([path, options]) => path in gotTmpfs && sameOptions(gotTmpfs[path], options)) || strayTmpfs) problems.push('tmpfs');
  if (mounts.length !== expectedMounts.length || !expectedMounts.every(want => mounts.some(got =>
    got.Destination === want.target && got.Type === want.type && (want.type === 'volume' ? got.Name : got.Source) === want.source && got.RW === !want.readOnly))
    || !configMounts || configMounts.length !== expectedMounts.length || !expectedMounts.every(want => configMounts.some(got =>
      got.Target === want.target && got.Type === want.type && got.Source === want.source && Boolean(got.ReadOnly) === want.readOnly))) problems.push('mounts');
  if (labels[JOB_LABEL] !== jobId || labels[ROLE_LABEL] !== role) problems.push('labels');
  if (container?.Config?.StopTimeout !== 1) problems.push('stop-timeout');
  if (secretEnv.length) problems.push('env');
  if (problems.length) throw new Error(`Container isolation check failed: ${problems.join(', ')}.`);
  return {
    role, runtime: host.Runtime, network: host.NetworkMode, readOnlyRoot: host.ReadonlyRootfs, capDrop: host.CapDrop, user: container.Config.User,
    memoryBytes: host.Memory, pidsLimit: host.PidsLimit, nanoCpus: host.NanoCpus, secretEnvVars: 0, createdAt: container.Created,
    ...(role === 'wine' ? { appArmor } : {}),
  };
}

/** `{code, reason}` with reason `oom` (Docker's OOMKilled), `time` (the controller's timer), `pids-limit` (trace flag) or null. */
export function classifyExit(inspectJson, { timedOut = false, pidsLimitHit = false } = {}) {
  const state = JSON.parse(inspectJson)?.[0]?.State ?? {};
  const reason = state.OOMKilled === true ? 'oom' : timedOut ? 'time' : pidsLimitHit ? 'pids-limit' : null;
  return { code: state.ExitCode ?? null, reason };
}

/** Deletes one runsc debug-log directory (`<root>/<container id>`); anything but a 64-hex id is ignored. Returns an error text or null. */
const removeRunscLog = (root, id) => (CONTAINER_ID.test(id)
  ? rm(posix.join(root, id), { recursive: true, force: true }).then(() => null, error => `runsc log ${id.slice(0, 12)}: ${error.code ?? error.name}`)
  : Promise.resolve(null));

/**
 * `tearing_down` container and volume part (7.4): `rm -f -v` each container, delete its runsc log directory (whether or not
 * the trace was parsed), remove each volume, then confirm that `docker ps -a` and `docker volume ls` filtered by the job label
 * are both empty. The holder container is removed before the job's other containers. A log directory that cannot be deleted is
 * reported in `errors` but does not unconfirm the teardown; the reaper retries it.
 */
export async function teardown(jobId, { docker = dockerExec, clock = () => new Date(), runscLogRoot = RUNSC_LOG_ROOT, ledger = sharedLedger() } = {}) {
  const filter = `label=${JOB_LABEL}=${checkJobId(jobId)}`;
  const errors = [];
  const run = async args => {
    const result = await tryDocker(docker, args);
    if (result.code !== 0) errors.push(`docker ${args.slice(0, 2).join(' ')} failed: ${brief(result)}`);
    return result;
  };
  const listed = lines(await run(['ps', '-a', '--no-trunc', '--format', `{{.ID}} {{.Label "${ROLE_LABEL}"}}`, '--filter', filter])).map(line => line.split(' '));
  // The holder goes first: nothing else of the job may outlive it, and its removal ends the home tmpfs.
  for (const [id] of [...listed.filter(([, role]) => role === 'holder'), ...listed.filter(([, role]) => role !== 'holder')]) {
    if ((await run(['rm', '-f', '-v', id])).code !== 0) continue;
    const problem = await removeRunscLog(runscLogRoot, id);
    if (problem) errors.push(problem);
    else ledger.forget(id);
  }
  for (const name of lines(await run(['volume', 'ls', '-q', '--filter', filter]))) {
    // A container removed a moment ago can still hold the volume for a few hundred milliseconds on a loaded host.
    let result;
    for (let attempt = 0; attempt < VOLUME_RM_ATTEMPTS; attempt += 1) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, VOLUME_RM_RETRY_MS));
      result = await tryDocker(docker, ['volume', 'rm', name]);
      if (result.code === 0 || !/in use/i.test(result.stderr)) break;
    }
    if (result.code !== 0) errors.push(`docker volume rm failed: ${brief(result)}`);
  }
  const left = [await run(['ps', '-a', '-q', '--filter', filter]), await run(['volume', 'ls', '-q', '--filter', filter])];
  const confirmed = left.every(result => result.code === 0 && result.stdout.trim() === '');
  return { confirmed, removedAt: confirmed ? clock().toISOString() : null, errors };
}

/**
 * Removes labelled containers, then volumes, then runsc log directories older than `maxAgeMs`. Ages come from short `--format`
 * listings (`<id> <created>`); output that hit the 64 KB cap is never trusted, so that sweep removes nothing and reports an
 * error. Items with an unreadable age are kept.
 *
 * Log directories are named by container id. Only ids in `ledger` (the containers this controller created) are candidates, and
 * only while docker no longer lists that container: another workload's directories under the log root are never touched. When
 * `docker ps -a` fails or is truncated the sweep is skipped and an error is reported. An id whose directory is already gone
 * leaves the ledger.
 */
export async function reap(maxAgeMs = REAP_MAX_AGE_MS, { docker = dockerExec, clock = () => new Date(), runscLogRoot = RUNSC_LOG_ROOT, ledger = sharedLedger() } = {}) {
  const cutoff = clock().getTime() - maxAgeMs;
  const errors = [];
  const removed = { containers: [], volumes: [], logs: [] };
  const sweep = async (listArgs, inspectArgs, remove, into) => {
    const listed = await tryDocker(docker, [...listArgs, '--filter', `label=${JOB_LABEL}`]);
    if (listed.code !== 0 || listed.truncated) { errors.push(`docker ${listArgs[0]} failed${listed.truncated ? ': output truncated' : `: ${brief(listed)}`}`); return; }
    const ids = lines(listed);
    if (!ids.length) return;
    const inspected = await tryDocker(docker, [...inspectArgs, ...ids]);
    if (inspected.truncated) { errors.push(`docker ${inspectArgs[0]} inspect output truncated`); return; }
    if (inspected.code !== 0) errors.push(`docker ${inspectArgs[0]} inspect failed: ${brief(inspected)}`);
    const ages = new Map(lines(inspected).map(line => line.split(/ (.*)/s)));
    for (const id of ids) {
      const created = Date.parse(ages.get(id));
      if (Number.isNaN(created)) { errors.push(`${id}: age unreadable`); continue; }
      if (created > cutoff) continue;
      const result = await tryDocker(docker, [...remove, id]);
      if (result.code === 0) removed[into].push(id);
      else errors.push(`${id}: ${brief(result)}`);
    }
  };
  await sweep(['ps', '-a', '-q', '--no-trunc'], ['container', 'inspect', '--format', '{{.Id}} {{.Created}}'], ['rm', '-f', '-v'], 'containers');
  await sweep(['volume', 'ls', '-q'], ['volume', 'inspect', '--format', '{{.Name}} {{.CreatedAt}}'], ['volume', 'rm'], 'volumes');

  const every = await tryDocker(docker, ['ps', '-a', '-q', '--no-trunc']);
  if (every.code !== 0 || every.truncated) {
    errors.push(`docker ps failed${every.truncated ? ': output truncated' : `: ${brief(every)}`}; runsc logs not swept`);
    return { removed, errors };
  }
  const existing = new Set(lines(every));
  for (const id of ledger.ids()) {
    if (existing.has(id)) continue;
    const dir = posix.join(runscLogRoot, id);
    try {
      const info = await stat(dir).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
      if (info && info.mtimeMs > cutoff) continue;
      if (info) { await rm(dir, { recursive: true, force: true }); removed.logs.push(id); }
      ledger.forget(id);
    } catch (error) {
      errors.push(`runsc log ${id.slice(0, 12)}: ${error.code ?? error.name}`);
    }
  }
  return { removed, errors };
}

/**
 * Creates the job's home volume with the 128 MB quota of 7.3 and starts the holder: a verified `sleep` container (role `holder`,
 * the 6.3 flags, read-only mount of the volume) that keeps the tmpfs mounted while seed, detonate and collect come and go. Docker
 * unmounts a tmpfs volume once no container uses it, which would lose the seeded files. The holder sleeps HOLDER_SLEEP_SECONDS,
 * longer than a job; `teardown` removes it first. Throws if the volume or the holder cannot be made. Returns the holder's isolation record.
 */
export async function startHome({ docker = dockerExec, timeoutMs = 15_000, signal, ...spec }) {
  assertOpen(signal);
  const created = await tryDocker(docker, quotaHomeVolumeCreateArgs(spec.jobId), { timeoutMs });
  if (created.code !== 0) throw new Error(`docker volume create failed: ${brief(created)}`);
  if (signal?.aborted) await tryDocker(docker, ['volume', 'rm', homeVolumeName(spec.jobId)]); // teardown may have listed the volumes already
  assertOpen(signal);
  const holder = { ...spec, role: 'holder', entrypoint: 'sleep', command: [String(HOLDER_SLEEP_SECONDS)] };
  const { name, isolation } = await createVerified({ docker, signal, ...holder });
  const started = await tryDocker(docker, ['start', name], { timeoutMs });
  if (started.code !== 0 || signal?.aborted) {
    await removeContainer(spec.jobId, name, { docker });
    throw new Error(started.code !== 0 ? `docker start failed: ${brief(started)}` : 'The job closed while the holder started.');
  }
  return isolation;
}

/**
 * Seed step (6.2): a short-lived container (role `seed`, same checks as every other container: create → inspect →
 * `verifyIsolation` → start) copies the controller-built seed tree (`<jobDir>/seed`, read-only at /seed) into the home
 * volume. Throws unless it exits 0. It is not a receipt role; `teardown` removes it by label.
 */
export async function runSeed({ wallClockMs = 15_000, ...spec }) {
  const result = await runContainer({ ...spec, role: 'seed', entrypoint: 'cp', command: ['-R', '/seed/.', '/home/dana/'], wallClockMs });
  if (result.timedOut || result.code !== 0) throw new Error(`seed copy failed (exit ${result.code}): ${brief(result)}`);
  return result;
}

/** Retained for named-import compatibility only: seeding must use runSeed's create → inspect → verify sequence. */
export function buildSeedArgs() {
  throw new Error('buildSeedArgs is disabled; use runSeed for verified seeding.');
}
