import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OUTPUT_CAP_BYTES, allowedEnv, buildContainerArgs, buildSeedArgs, capBytes, classifyExit, containerName, createContainerLedger, dockerEnv, homeVolumeCreateArgs, loadImageLock,
  quotaHomeVolumeCreateArgs, reap, removeContainer, runContainer, runSeed, startHome, teardown, verifyIsolation,
} from '../backend/detonation/containers.mjs';
import { buildReceipt, compareCanary, hashFile, receiptAllowsDone, validateReceipt } from '../backend/detonation/receipts.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/detonation/inspect/${name}.json`, import.meta.url), 'utf8');
const jobId = 'j-abc123';
const NO_RUNSC_LOGS = join(tmpdir(), 'do-test-no-runsc-logs'); // never exists: the reaper and teardown then touch no log directory
const jobDir = '/var/lib/detonation-ocean/jobs/j-abc123';
const expected = role => ({ jobId, role, jobDir });
const argsFor = role => buildContainerArgs({ jobId, role, image: `detonation-ocean/${role}@sha256:abc`, jobDir });
const nameOf = role => containerName(jobId, role);
const valuesOf = (args, flag) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []));
const clone = value => JSON.parse(JSON.stringify(value));
const mutated = (name, change) => { const data = JSON.parse(fixture(name)); change(data[0]); return JSON.stringify(data); };

// A scripted docker daemon: labelled containers and volumes, ps / rm / volume / inspect answers. Like dockerExec it keeps
// at most 64 KB of output and reports `truncated`; a plain `container inspect` of a container is 6 KB of JSON.
function fakeDaemon({ containers = [], volumes = [], failRm = false, failVolumeRm = false } = {}) {
  const state = { containers: clone(containers), volumes: clone(volumes), calls: [] };
  const matches = (item, filter) => { const [, key, value] = /^label=([^=]+)(?:=(.*))?$/.exec(filter) ?? []; return item.labels[key] !== undefined && (value === undefined || item.labels[key] === value); };
  const ok = (stdout = '') => (Buffer.byteLength(stdout) > OUTPUT_CAP_BYTES ? { code: 0, stdout: stdout.slice(0, OUTPUT_CAP_BYTES), stderr: '', truncated: true } : { code: 0, stdout, stderr: '' });
  const docker = async args => {
    state.calls.push(args);
    const filter = args[args.indexOf('--filter') + 1];
    if (args[0] === 'ps') return ok(state.containers.filter(c => matches(c, filter)).map(c => (args.includes('--format') ? `${c.id} ${c.labels['detonation-ocean.role'] ?? ''}\n` : `${c.id}\n`)).join(''));
    if (args[0] === 'volume' && args[1] === 'ls') return ok(state.volumes.filter(v => matches(v, filter)).map(v => `${v.name}\n`).join(''));
    if (args[0] === 'rm') {
      if (failRm) return { code: 1, stdout: '', stderr: 'Error response from daemon: removal in progress' };
      state.containers = state.containers.filter(c => c.id !== args.at(-1));
      return ok();
    }
    if (args[0] === 'volume' && args[1] === 'rm') {
      if (failVolumeRm) return { code: 1, stdout: '', stderr: 'volume is in use' };
      state.volumes = state.volumes.filter(v => v.name !== args[2]);
      return ok();
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      if (args[2] !== '--format') return ok(JSON.stringify(args.slice(2).map(id => ({ Id: id, Created: state.containers.find(c => c.id === id).created, Pad: 'x'.repeat(6000) }))));
      return ok(args.slice(4).map(id => `${id} ${state.containers.find(c => c.id === id).created}\n`).join(''));
    }
    if (args[0] === 'volume' && args[1] === 'inspect') return ok(args.slice(4).map(name => `${name} ${state.volumes.find(v => v.name === name).created}\n`).join(''));
    throw new Error(`unexpected docker call ${args.join(' ')}`);
  };
  docker.state = state;
  return docker;
}
const PS_FORMAT = '{{.ID}} {{.Label "detonation-ocean.role"}}';
const labelled = id => ({ [`detonation-ocean.job`]: id, 'detonation-ocean.role': 'detonate' });

test('docker args carry every 6.3 flag for each role, with the role runtime and mounts', () => {
  for (const role of ['detonate', 'collect', 'analyse']) {
    const args = argsFor(role);
    const single = flag => { const v = valuesOf(args, flag); assert.equal(v.length, 1, flag); return v[0]; };
    assert.equal(args[0], 'create');
    assert.equal(single('--runtime'), role === 'detonate' ? 'runsc-trace' : 'runsc');
    assert.equal(single('--network'), 'none');
    assert.ok(args.includes('--read-only'));
    assert.equal(single('--cap-drop'), 'ALL');
    assert.equal(single('--security-opt'), 'no-new-privileges:true');
    assert.equal(single('--user'), '10001:10001');
    assert.equal(single('--ulimit'), 'nproc=128:128');
    assert.equal(single('--pids-limit'), '512');
    assert.equal(single('--memory'), '512m');
    assert.equal(single('--memory-swap'), '512m');
    assert.equal(single('--cpus'), '1');
    assert.ok(valuesOf(args, '--tmpfs').includes('/tmp:rw,nosuid,nodev,size=64m'));
    assert.equal(single('--env-file'), '/dev/null');
    assert.equal(single('--pull'), 'never');
    assert.equal(single('--stop-timeout'), '1');
    assert.equal(single('--log-driver'), 'none');
    assert.deepEqual(valuesOf(args, '--label'), [`detonation-ocean.job=${jobId}`, `detonation-ocean.role=${role}`]);
    assert.equal(single('--name'), `do-${jobId}-${role}-i0-a1`);
    assert.ok(!['--privileged', '-v', '--volume', '-p', '--publish', '--net', '--network=host'].some(flag => args.includes(flag)));
    assert.ok(!args.join(' ').includes('docker.sock'));
  }
  assert.deepEqual(valuesOf(argsFor('detonate'), '--mount'), [
    `type=bind,src=${jobDir}/sample.bin,dst=/in/sample,readonly`,
    'type=volume,src=do-j-abc123-home,dst=/home/dana',
  ]);
  assert.deepEqual(valuesOf(argsFor('collect'), '--mount'), [
    'type=volume,src=do-j-abc123-home,dst=/home/dana,readonly',
    `type=bind,src=${jobDir}/seed-manifest.json,dst=/in/seed-manifest.json,readonly`,
  ]);
  assert.deepEqual(valuesOf(argsFor('analyse'), '--mount'), ['evidence', 'diff', 'static'].map(name => `type=bind,src=${jobDir}/${name}.json,dst=/in/${name}.json,readonly`)
    .concat(`type=bind,src=${jobDir}/script.py,dst=/in/script.py,readonly`));
  assert.ok(valuesOf(argsFor('analyse'), '--tmpfs').includes('/out:rw,nosuid,nodev,noexec,size=8m'));
  assert.deepEqual(homeVolumeCreateArgs(jobId), ['volume', 'create', '--label', 'detonation-ocean.job=j-abc123', 'do-j-abc123-home']);
  assert.deepEqual(quotaHomeVolumeCreateArgs(jobId), [
    'volume', 'create', '--label', 'detonation-ocean.job=j-abc123', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
    '--opt', 'o=nosuid,nodev,size=128m,uid=10001,gid=10001,mode=0700', 'do-j-abc123-home',
  ]);
});

test('docker args refuse bad job ids, images, counters and any bind source outside <dataDir>/jobs/<jobId>', () => {
  const ok = { jobId, role: 'detonate', image: 'img', jobDir };
  assert.throws(() => buildContainerArgs({ ...ok, jobId: 'J;rm' }), /jobId/);
  assert.throws(() => buildContainerArgs({ ...ok, role: 'root' }), /role/);
  assert.throws(() => buildContainerArgs({ ...ok, image: '--privileged' }), /image/);
  for (const itemIndex of [-1, 1.5, '1', NaN, null]) assert.throws(() => buildContainerArgs({ ...ok, itemIndex }), /itemIndex/, String(itemIndex));
  for (const attempt of [0, -2, 1.5, '1', null]) assert.throws(() => buildContainerArgs({ ...ok, attempt }), /attempt/, String(attempt));
  assert.throws(() => allowedEnv(-1), /itemIndex/);
  assert.equal(containerName(jobId, 'collect', 2, 3), 'do-j-abc123-collect-i2-a3');
  assert.notEqual(containerName(jobId, 'analyse', 0, 1), containerName(jobId, 'analyse', 0, 2));
  assert.notEqual(containerName(jobId, 'analyse', 0, 1), containerName(jobId, 'analyse', 1, 1));
  const hostile = ['/', '/var/run', '/var/run/docker.sock', '/var/lib/detonation-ocean', '/var/lib/detonation-ocean/jobs', '/a/../etc', '/var/lib/detonation-ocean/jobs/j-abc123/..',
    '/var/lib/detonation-ocean/jobs/j-abc123/', '/var/lib/detonation-ocean/jobs/j-other', '/var/lib/detonation-ocean/jobs//j-abc123', '/var/lib/./detonation-ocean/jobs/j-abc123',
    '/var/lib/detonation-ocean/jobs/j-abc123/seed', '/tmp/a,dst=/etc/jobs/j-abc123', 'jobs/j-abc123', '', undefined, null];
  for (const hostileDir of hostile) {
    assert.throws(() => buildContainerArgs({ ...ok, jobDir: hostileDir }), /jobDir/, String(hostileDir));
    assert.throws(() => verifyIsolation(fixture('detonate'), { ...expected('detonate'), jobDir: hostileDir }), /jobDir/, String(hostileDir));
  }
  assert.throws(() => buildSeedArgs({ jobId, image: 'img', jobDir: '/var/lib/detonation-ocean' }), /disabled.*runSeed/);
  assert.doesNotThrow(() => buildContainerArgs({ ...ok, jobDir: 'C:\\data\\jobs\\j-abc123' }));
  assert.throws(() => buildContainerArgs({ ...ok, jobDir: 'C:\\data\\jobs\\..\\j-abc123' }), /jobDir/);
});

test('AT-1 (arg level): the container environment is the allowlist and nothing else', () => {
  const allowlist = ['DETONATION_SANDBOX', 'HOME', 'JOB_ITEM', 'LANG', 'PATH', 'USER'];
  for (const role of ['detonate', 'collect', 'analyse']) {
    const args = buildContainerArgs({ jobId, role, image: 'img', jobDir, itemIndex: 3 });
    const env = Object.fromEntries(valuesOf(args, '--env').map(entry => entry.split(/=(.*)/s).slice(0, 2)));
    assert.deepEqual(Object.keys(env).sort(), allowlist);
    assert.equal(env.HOME, '/home/dana');
    assert.equal(env.USER, 'dana');
    assert.equal(env.JOB_ITEM, '3');
    assert.equal(env.DETONATION_SANDBOX, '1');
    assert.deepEqual(valuesOf(args, '--env-file'), ['/dev/null']);
    assert.ok(!args.includes('--env-file=') && !args.some(arg => /^--env=|^-e$/.test(arg)));
  }
  assert.deepEqual(allowedEnv(), { HOME: '/home/dana', USER: 'dana', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', DETONATION_SANDBOX: '1', JOB_ITEM: '0' });
});

test('the docker child process gets only PATH, HOME and DOCKER_HOST', () => {
  const source = { PATH: '/bin', HOME: '/h', DOCKER_HOST: 'unix:///x', VULTR_API_KEY: 'k', SECRET_TOKEN: 't', USERPROFILE: 'C:\\u' };
  assert.deepEqual(dockerEnv(source), { PATH: '/bin', HOME: '/h', DOCKER_HOST: 'unix:///x' });
  assert.deepEqual(dockerEnv({ PATH: '/bin' }), { PATH: '/bin' });
});

test('AT-16: the recorded inspect fixtures (real docker create output, all three roles) pass the isolation check and yield a receipt record', () => {
  const detonate = verifyIsolation(fixture('detonate'), expected('detonate'));
  assert.deepEqual(detonate, {
    role: 'detonate', runtime: 'runsc-trace', network: 'none', readOnlyRoot: true, capDrop: ['ALL'], user: '10001:10001',
    memoryBytes: 536870912, pidsLimit: 512, nanoCpus: 1000000000, secretEnvVars: 0, createdAt: JSON.parse(fixture('detonate'))[0].Created,
  });
  assert.equal(verifyIsolation(fixture('collect'), expected('collect')).runtime, 'runsc');
  assert.equal(verifyIsolation(fixture('analyse'), expected('analyse')).runtime, 'runsc');
  for (const role of ['detonate', 'collect', 'analyse']) assert.equal(JSON.parse(fixture(role))[0].State.Status, 'created', `${role} fixture was never started`);
});

const at = (c, destination) => c.Mounts.find(mount => mount.Destination === destination);
const configAt = (c, target) => c.HostConfig.Mounts.find(mount => mount.Target === target);

test('AT-16: the isolation check fails for each 6.3 flag removed or altered', () => {
  const cases = [
    ['name', c => { c.Name = '/do-j-other-detonate-i0-a1'; }],
    ['name', c => { c.Name = '/do-j-abc123-detonate'; }],
    ['name', c => { c.Name = '/do-j-abc123-detonate-i0-a2'; }],
    ['runtime', c => { c.HostConfig.Runtime = 'runc'; }],
    ['runtime', c => { delete c.HostConfig.Runtime; }],
    ['runtime', c => { c.HostConfig.Runtime = 'runsc'; }], // detonate must use runsc-trace
    ['network-mode', c => { c.HostConfig.NetworkMode = 'bridge'; }],
    ['networks', c => { c.NetworkSettings.Networks = { none: {}, bridge: {} }; }],
    ['read-only-root', c => { c.HostConfig.ReadonlyRootfs = false; }],
    ['cap-drop', c => { c.HostConfig.CapDrop = null; }],
    ['cap-drop', c => { c.HostConfig.CapDrop = ['NET_RAW']; }],
    ['privileged', c => { c.HostConfig.Privileged = true; }],
    ['privileged', c => { c.HostConfig.CapAdd = ['SYS_ADMIN']; }],
    ['security-opt', c => { c.HostConfig.SecurityOpt = null; }],
    ['security-opt', c => { c.HostConfig.SecurityOpt = ['seccomp=unconfined']; }],
    ['security-opt', c => { c.HostConfig.SecurityOpt = ['no-new-privileges:true', 'seccomp=unconfined']; }],
    ['security-opt', c => { c.HostConfig.SecurityOpt = ['no-new-privileges:false']; }],
    ['security-opt', c => { c.HostConfig.SecurityOpt = ['apparmor=unconfined', 'no-new-privileges']; }],
    ['devices', c => { c.HostConfig.Devices = [{ PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rwm' }]; }],
    ['namespaces', c => { c.HostConfig.PidMode = 'host'; }],
    ['namespaces', c => { c.HostConfig.PidMode = 'container:abc'; }],
    ['namespaces', c => { c.HostConfig.IpcMode = 'host'; }],
    ['namespaces', c => { c.HostConfig.UsernsMode = 'host'; }],
    ['binds', c => { c.HostConfig.Binds = ['/:/host:rw']; }],
    ['binds', c => { c.HostConfig.VolumesFrom = ['other']; }],
    ['binds', c => { c.HostConfig.Links = ['other:o']; }],
    ['log-driver', c => { c.HostConfig.LogConfig = { Type: 'json-file', Config: {} }; }],
    ['user', c => { c.Config.User = ''; }],
    ['user', c => { c.Config.User = '0:0'; }],
    ['pids-limit', c => { c.HostConfig.PidsLimit = 0; }],
    ['pids-limit', c => { c.HostConfig.PidsLimit = 4096; }],
    ['pids-limit', c => { c.HostConfig.PidsLimit = 128; }],
    ['nproc', c => { c.HostConfig.Ulimits = null; }],
    ['nproc', c => { c.HostConfig.Ulimits = []; }],
    ['nproc', c => { c.HostConfig.Ulimits = [{ Name: 'nproc', Soft: 256, Hard: 256 }]; }],
    ['nproc', c => { c.HostConfig.Ulimits = [{ Name: 'nproc', Soft: 64, Hard: 128 }]; }],
    ['nproc', c => { c.HostConfig.Ulimits = [{ Name: 'nofile', Soft: 128, Hard: 128 }]; }],
    ['nproc', c => { c.HostConfig.Ulimits.push({ Name: 'nofile', Soft: 1024, Hard: 1024 }); }],
    ['memory', c => { c.HostConfig.Memory = 0; }],
    ['memory-swap', c => { c.HostConfig.MemorySwap = -1; }],
    ['nano-cpus', c => { c.HostConfig.NanoCpus = 0; }],
    ['nano-cpus', c => { c.HostConfig.NanoCpus = 4_000_000_000; }],
    ['tmpfs', c => { delete c.HostConfig.Tmpfs; }],
    ['tmpfs', c => { c.HostConfig.Tmpfs['/tmp'] = 'rw,nosuid,nodev,size=4g'; }],
    ['tmpfs', c => { c.HostConfig.Tmpfs['/dev/shm'] = 'rw,size=1g'; }],
    ['tmpfs', c => { c.Mounts.push({ Type: 'tmpfs', Destination: '/extra', RW: true }); }],
    ['tmpfs', c => { c.HostConfig.Mounts.push({ Type: 'tmpfs', Target: '/extra' }); }],
    ['labels', c => { delete c.Config.Labels['detonation-ocean.job']; }],
    ['labels', c => { c.Config.Labels['detonation-ocean.role'] = 'collect'; }],
    ['stop-timeout', c => { delete c.Config.StopTimeout; }],
    ['mounts', c => { c.Mounts.pop(); }],
    ['mounts', c => { at(c, '/in/sample').RW = true; }],
    ['mounts', c => { at(c, '/in/sample').Source = '/etc/shadow'; }],
    ['mounts', c => { at(c, '/in/sample').Source = '/var/lib/detonation-ocean/jobs/j-other/sample.bin'; }],
    ['mounts', c => { at(c, '/home/dana').Name = 'do-j-other-home'; }],
    ['mounts', c => { configAt(c, '/in/sample').Source = '/etc/shadow'; }],
    ['mounts', c => { configAt(c, '/in/sample').ReadOnly = false; }],
    ['mounts', c => { c.HostConfig.Mounts = null; }],
    ['mounts', c => { c.HostConfig.Mounts.push({ Type: 'bind', Source: '/', Target: '/host' }); }],
    ['mounts', c => { c.Mounts.push({ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock', RW: true }); }],
    ['mounts', c => { c.Mounts.push({ Type: 'bind', Source: '/var/lib/detonation-ocean', Destination: '/data', RW: false }); }],
  ];
  for (const [problem, change] of cases) {
    assert.throws(() => verifyIsolation(mutated('detonate', change), expected('detonate')), new RegExp(`isolation check failed:.*\\b${problem}\\b`), `${problem}: ${change}`);
  }
  // Docker's own renderings of the one accepted security option.
  for (const rendering of ['no-new-privileges', 'no-new-privileges=true']) {
    assert.doesNotThrow(() => verifyIsolation(mutated('detonate', c => { c.HostConfig.SecurityOpt = [rendering]; }), expected('detonate')), rendering);
  }
  // Role-specific lists: one role's fixture checked as another fails, and a weakened /out or bind fails.
  assert.throws(() => verifyIsolation(fixture('analyse'), expected('collect')), /name.*mounts/);
  assert.throws(() => verifyIsolation(mutated('analyse', c => { delete c.HostConfig.Tmpfs['/out']; }), expected('analyse')), /tmpfs/);
  assert.throws(() => verifyIsolation(mutated('analyse', c => { at(c, '/in/script.py').RW = true; }), expected('analyse')), /mounts/);
  assert.throws(() => verifyIsolation(mutated('collect', c => { at(c, '/home/dana').RW = true; }), expected('collect')), /mounts/);
  assert.throws(() => verifyIsolation(fixture('collect'), { ...expected('collect'), itemIndex: 1 }), /name/);
  assert.throws(() => verifyIsolation('[]', expected('detonate')), /isolation check failed/);
});

test('isolation check: no env var named VULTR_/KEY/TOKEN/SECRET and no value containing a provided secret', () => {
  const withEnv = entry => mutated('detonate', c => c.Config.Env.push(entry));
  for (const entry of ['VULTR_API_KEY=abc', 'AWS_ACCESS_KEY_ID=abc', 'GITHUB_TOKEN=abc', 'client_secret=abc', 'API_KEY', 'GPG_KEY=not-a-fingerprint']) {
    assert.throws(() => verifyIsolation(withEnv(entry), expected('detonate')), /isolation check failed:.*\benv\b/, entry);
  }
  // The python base image's public signing-key fingerprint (present in the recorded collect and analyse fixtures) is not a secret.
  assert.ok(JSON.parse(fixture('collect'))[0].Config.Env.some(entry => entry.startsWith('GPG_KEY=')));
  const leaked = withEnv('HARMLESS_NAME=sk-live-1234567890');
  assert.doesNotThrow(() => verifyIsolation(leaked, expected('detonate')));
  assert.throws(() => verifyIsolation(leaked, { ...expected('detonate'), secrets: ['unrelated', 'sk-live-1234567890'] }), /\benv\b/);
  assert.doesNotThrow(() => verifyIsolation(leaked, { ...expected('detonate'), secrets: ['', 'sk-live-999'] }));
  // A secret embedded inside a longer value (a URL, a joined string) is found by substring.
  assert.throws(() => verifyIsolation(leaked, { ...expected('detonate'), secrets: ['sk-live-123'] }), /\benv\b/);
  assert.throws(() => verifyIsolation(withEnv('PROXY=https://user:hunter2pass@host/'), { ...expected('detonate'), secrets: ['hunter2pass'] }), /\benv\b/);
});

test('exit classification: OOMKilled, wall-clock time and pids limit from the trace flag', () => {
  const exited = (code, oom = false) => JSON.stringify([{ State: { ExitCode: code, OOMKilled: oom } }]);
  assert.deepEqual(classifyExit(exited(0)), { code: 0, reason: null });
  assert.deepEqual(classifyExit(exited(137, true)), { code: 137, reason: 'oom' });
  assert.deepEqual(classifyExit(exited(137), { timedOut: true }), { code: 137, reason: 'time' });
  assert.deepEqual(classifyExit(exited(1), { pidsLimitHit: true }), { code: 1, reason: 'pids-limit' });
  assert.deepEqual(classifyExit(exited(137)), { code: 137, reason: null });
  assert.equal(classifyExit(exited(137, true), { timedOut: true }).reason, 'oom');
});

test('capBytes cuts at a UTF-8 character boundary and reports truncation', () => {
  assert.deepEqual(capBytes('hello', 5), { text: 'hello', truncated: false });
  assert.deepEqual(capBytes('hello!', 5), { text: 'hello', truncated: true });
  assert.deepEqual(capBytes('éé', 3), { text: 'é', truncated: true }); // 4 bytes, cut after byte 2, not inside the second é
  assert.deepEqual(capBytes('a€', 3), { text: 'a', truncated: true });
  assert.deepEqual(capBytes('a😀', 4), { text: 'a', truncated: true });
  for (const cap of [1, 2, 3, 4, 5, 6, 7]) {
    const { text } = capBytes('é€😀é€😀', cap);
    assert.ok(!text.includes('\ufffd') && Buffer.byteLength(text) <= cap, `cap ${cap}`);
  }
  assert.equal(capBytes('é'.repeat(OUTPUT_CAP_BYTES), OUTPUT_CAP_BYTES).truncated, true);
});

// A scripted docker for runContainer: create / inspect / start -a / kill / rm. `inspectRunning` models what inspect says after a kill.
function fakeRunDocker({ role = 'detonate', fixtureName = role, createFails = false, mutate, startHangs = false, killFails = false, rmFails = false, startOutput } = {}) {
  const calls = [];
  const state = { calls, running: false, removed: false, release: null };
  const name = nameOf(role);
  const inspectJson = () => JSON.stringify(JSON.parse(mutated(fixtureName, mutate ?? (() => {}))).map(c => ({ ...c, State: { ...c.State, Running: state.running } })));
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', timedOut: false });
  const docker = async args => {
    calls.push(args);
    if (args[0] === 'create') return createFails ? { code: 1, stdout: '', stderr: 'no such image', timedOut: false } : ok(`${name}\n`);
    if (args[0] === 'container' && args[1] === 'inspect') {
      if (state.removed) return { code: 1, stdout: '', stderr: `Error: No such container: ${name}`, timedOut: false };
      return args[2] === '--format' ? ok(`${state.running}\n`) : ok(inspectJson());
    }
    if (args[0] === 'start') {
      state.running = true;
      if (startHangs) await new Promise(resolve => { state.release = resolve; });
      else state.running = false;
      return { ...ok(startOutput?.stdout ?? ''), code: startHangs ? 137 : 0, stderr: startOutput?.stderr ?? '' };
    }
    if (args[0] === 'kill') {
      if (killFails) return { code: 1, stdout: '', stderr: 'cannot kill container', timedOut: false };
      state.running = false;
      state.release?.();
      return ok();
    }
    if (args[0] === 'rm') {
      if (rmFails) return { code: 1, stdout: '', stderr: 'cannot remove', timedOut: false };
      state.running = false;
      state.removed = true;
      state.release?.();
      return ok();
    }
    throw new Error(`unexpected docker call ${args.join(' ')}`);
  };
  docker.state = state;
  return docker;
}
const verbs = docker => docker.state.calls.map(call => (call[0] === 'container' ? (call[2] === '--format' ? 'running?' : 'inspect') : call[0]));
const runSpec = { jobId, role: 'detonate', image: 'img', jobDir };

test('run shape (P2-6): create, inspect, verify, then start -a; the container is not removed after a clean run', async () => {
  const docker = fakeRunDocker({ startOutput: { stdout: 'x'.repeat(OUTPUT_CAP_BYTES * 3), stderr: 'é'.repeat(OUTPUT_CAP_BYTES) } });
  const result = await runContainer({ ...runSpec, docker, wallClockMs: 1000 });
  assert.deepEqual(verbs(docker), ['create', 'inspect', 'start', 'inspect']);
  assert.equal(docker.state.calls[0][0], 'create');
  assert.deepEqual(docker.state.calls[2], ['start', '-a', 'do-j-abc123-detonate-i0-a1']);
  assert.equal(result.name, 'do-j-abc123-detonate-i0-a1');
  assert.equal(result.isolation.runtime, 'runsc-trace');
  assert.equal(result.timedOut, false);
  assert.equal(Buffer.byteLength(result.stdout), OUTPUT_CAP_BYTES);
  assert.ok(Buffer.byteLength(result.stderr) <= OUTPUT_CAP_BYTES && !result.stderr.includes('\ufffd'));
  assert.equal(result.truncated, true);
  assert.equal(JSON.parse(result.inspectJson)[0].Name, '/do-j-abc123-detonate-i0-a1');
  const quiet = await runContainer({ ...runSpec, docker: fakeRunDocker({ startOutput: { stdout: 'hi' } }), wallClockMs: 1000 });
  assert.equal(quiet.truncated, false);
  await assert.rejects(runContainer({ ...runSpec, wallClockMs: 0, docker: async () => ({}) }), /wallClockMs/);
});

test('run shape (P2-6): a container that fails verification is removed and never started', async () => {
  for (const [label, mutate, pattern] of [
    ['runtime', c => { c.HostConfig.Runtime = 'runc'; }, /runtime/],
    ['privileged', c => { c.HostConfig.Privileged = true; }, /privileged/],
    ['secret', c => { c.Config.Env.push('API_KEY=abc'); }, /env/],
  ]) {
    const docker = fakeRunDocker({ mutate });
    await assert.rejects(runContainer({ ...runSpec, docker, wallClockMs: 1000 }), pattern, label);
    assert.deepEqual(verbs(docker), ['create', 'inspect', 'rm'], label);
    assert.deepEqual(docker.state.calls[2], ['rm', '-f', '-v', 'do-j-abc123-detonate-i0-a1']);
  }
  const secret = fakeRunDocker();
  await assert.rejects(runContainer({ ...runSpec, docker: secret, wallClockMs: 1000, secrets: ['JOB_ITEM=0'] }), /env/);
  assert.ok(!verbs(secret).includes('start'));
  const noImage = fakeRunDocker({ createFails: true });
  await assert.rejects(runContainer({ ...runSpec, docker: noImage, wallClockMs: 1000 }), /docker create failed: no such image/);
  assert.deepEqual(verbs(noImage), ['create', 'rm']);
});

test('P1-2: the wall-clock timer awaits docker kill and then confirms the container stopped', async () => {
  const docker = fakeRunDocker({ startHangs: true });
  const slow = await runContainer({ ...runSpec, docker, wallClockMs: 20 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.code, 137);
  assert.deepEqual(verbs(docker), ['create', 'inspect', 'start', 'kill', 'running?', 'inspect']);
  assert.deepEqual(docker.state.calls[3], ['kill', 'do-j-abc123-detonate-i0-a1']);
  assert.equal(docker.state.running, false);
});

test('P1-2: when docker kill fails the run falls back to rm -f -v and confirms; if nothing stops it, the run fails', async () => {
  const fallback = fakeRunDocker({ startHangs: true, killFails: true });
  const result = await runContainer({ ...runSpec, docker: fallback, wallClockMs: 20 });
  assert.equal(result.timedOut, true);
  assert.deepEqual(verbs(fallback), ['create', 'inspect', 'start', 'kill', 'running?', 'rm', 'running?', 'inspect']);
  assert.deepEqual(fallback.state.calls[5], ['rm', '-f', '-v', 'do-j-abc123-detonate-i0-a1']);
  assert.equal(result.inspectJson, null, 'the removed container can no longer be inspected');

  // Neither kill nor rm works and the container is still running: fail the run (start never returns, so the client timeout ends it).
  const stuck = fakeRunDocker({ startHangs: true, killFails: true, rmFails: true });
  const stuckDocker = async (args, options) => {
    if (args[0] !== 'start') return stuck(args, options);
    stuck.state.running = true;
    await new Promise(resolve => setTimeout(resolve, 60));
    return { code: 124, stdout: '', stderr: '', timedOut: true };
  };
  await assert.rejects(runContainer({ ...runSpec, docker: stuckDocker, wallClockMs: 20 }), /not confirmed stopped/);
  assert.ok(verbs(stuck).includes('kill') && verbs(stuck).includes('rm'));
});

test('P1-2: a client-side docker timeout also forces the kill procedure', async () => {
  const docker = fakeRunDocker();
  const clientTimeout = async (args, options) => {
    if (args[0] === 'start') { docker.state.running = true; docker.state.calls.push(args); return { code: 124, stdout: '', stderr: '', timedOut: true }; }
    return docker(args, options);
  };
  const result = await runContainer({ ...runSpec, docker: clientTimeout, wallClockMs: 5000 });
  assert.equal(result.timedOut, true);
  assert.ok(verbs(docker).includes('kill'));
  assert.equal(docker.state.running, false);
});

test('P1-4: removeContainer runs rm -f -v on a container of this job only', async () => {
  const calls = [];
  const docker = async args => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  assert.deepEqual(await removeContainer(jobId, nameOf('analyse'), { docker }), { removed: true, error: null });
  assert.deepEqual(calls, [['rm', '-f', '-v', 'do-j-abc123-analyse-i0-a1']]);
  const refused = await removeContainer(jobId, nameOf('analyse'), { docker: async () => ({ code: 1, stdout: '', stderr: 'busy' }) });
  assert.deepEqual(refused, { removed: false, error: 'busy' });
  assert.deepEqual(await removeContainer(jobId, nameOf('analyse'), { docker: async () => { throw new Error('docker CLI unavailable'); } }), { removed: false, error: 'docker CLI unavailable' });
  for (const name of ['do-j-other-analyse-i0-a1', 'do-j-abc123', 'c1', '-f', 'do-j-abc123-x y', undefined]) await assert.rejects(removeContainer(jobId, name, { docker }), /name/, String(name));
  await assert.rejects(removeContainer('BAD ID', nameOf('analyse'), { docker }), /jobId/);
  assert.equal(calls.length, 1);
});

test('legacy seed args builder is disabled in favor of verified runSeed', () => {
  assert.throws(() => buildSeedArgs({ jobId, image: 'detonation-ocean/detonate', jobDir }), /disabled.*runSeed/);
});

test('AT-9 logic: teardown removes every labelled container and volume, then confirms both lists are empty', async () => {
  const docker = fakeDaemon({
    containers: [{ id: 'c1', labels: labelled(jobId) }, { id: 'c2', labels: labelled(jobId) }, { id: 'other', labels: labelled('j-zzz') }],
    volumes: [{ name: 'do-j-abc123-home', labels: { 'detonation-ocean.job': jobId } }, { name: 'do-j-zzz-home', labels: { 'detonation-ocean.job': 'j-zzz' } }],
  });
  const result = await teardown(jobId, { docker, clock: () => new Date('2026-10-07T12:01:00Z'), runscLogRoot: NO_RUNSC_LOGS });
  assert.deepEqual(result, { confirmed: true, removedAt: '2026-10-07T12:01:00.000Z', errors: [] });
  assert.deepEqual(docker.state.containers.map(c => c.id), ['other']);
  assert.deepEqual(docker.state.volumes.map(v => v.name), ['do-j-zzz-home']);
  const filter = 'label=detonation-ocean.job=j-abc123';
  assert.deepEqual(docker.state.calls, [
    ['ps', '-a', '--no-trunc', '--format', PS_FORMAT, '--filter', filter], ['rm', '-f', '-v', 'c1'], ['rm', '-f', '-v', 'c2'],
    ['volume', 'ls', '-q', '--filter', filter], ['volume', 'rm', 'do-j-abc123-home'],
    ['ps', '-a', '-q', '--filter', filter], ['volume', 'ls', '-q', '--filter', filter],
  ]);
  assert.equal((await teardown(jobId, { docker, runscLogRoot: NO_RUNSC_LOGS })).confirmed, true, 'an already clean job confirms');
});

test('teardown deletes the runsc log directory of each of the job\'s containers, parsed or not, and nobody else\'s', async () => {
  const root = mkdtempSync(join(tmpdir(), 'do-runsc-'));
  const [mine, theirs, stuck] = ['a', 'b', 'c'].map(letter => letter.repeat(64));
  for (const id of [mine, theirs, stuck]) { mkdirSync(join(root, id)); writeFileSync(join(root, id, 'x.boot.txt'), 'trace'); }
  try {
    const docker = fakeDaemon({ containers: [{ id: mine, labels: labelled(jobId) }, { id: theirs, labels: labelled('j-zzz') }] });
    assert.equal((await teardown(jobId, { docker, runscLogRoot: root })).confirmed, true);
    assert.deepEqual([mine, theirs].map(id => existsSync(join(root, id))), [false, true]);

    const refusing = fakeDaemon({ containers: [{ id: stuck, labels: labelled(jobId) }], failRm: true });
    assert.equal((await teardown(jobId, { docker: refusing, runscLogRoot: root })).confirmed, false);
    assert.equal(existsSync(join(root, stuck)), true, 'a container that could not be removed keeps its log');

    const blocked = fakeDaemon({ containers: [{ id: stuck, labels: labelled(jobId) }] });
    writeFileSync(join(root, 'file'), 'not a directory');
    const odd = await teardown(jobId, { docker: blocked, runscLogRoot: join(root, 'file') });
    assert.equal(odd.confirmed, true, 'a log directory problem does not unconfirm the teardown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-10 logic: teardown with docker rm failing is not confirmed and reports the error', async () => {
  const docker = fakeDaemon({ containers: [{ id: 'c1', labels: labelled(jobId) }], volumes: [], failRm: true });
  const result = await teardown(jobId, { docker });
  assert.equal(result.confirmed, false);
  assert.equal(result.removedAt, null);
  assert.match(result.errors[0], /docker rm -f failed: .*removal in progress/);

  const stuckVolume = fakeDaemon({ containers: [], volumes: [{ name: 'do-j-abc123-home', labels: { 'detonation-ocean.job': jobId } }], failVolumeRm: true });
  assert.equal((await teardown(jobId, { docker: stuckVolume })).confirmed, false);

  const unreachable = async () => { throw new Error('docker CLI unavailable'); };
  const down = await teardown(jobId, { docker: unreachable });
  assert.equal(down.confirmed, false);
  assert.ok(down.errors.length >= 2);
  await assert.rejects(teardown('Bad Id', { docker }), /jobId/);
});

test('reaper: removes only labelled containers and volumes older than the age limit, containers first', async () => {
  const now = new Date('2026-10-07T12:10:00Z');
  const docker = fakeDaemon({
    containers: [
      { id: 'old', created: '2026-10-07T12:00:00Z', labels: labelled('j-old') },
      { id: 'young', created: '2026-10-07T12:08:00Z', labels: labelled('j-young') },
      { id: 'unlabelled', created: '2026-10-07T11:00:00Z', labels: {} },
    ],
    volumes: [
      { name: 'do-j-old-home', created: '2026-10-07T12:00:01Z', labels: { 'detonation-ocean.job': 'j-old' } },
      { name: 'do-j-young-home', created: '2026-10-07T12:09:00Z', labels: { 'detonation-ocean.job': 'j-young' } },
      { name: 'unrelated', created: '2026-10-07T10:00:00Z', labels: { app: 'x' } },
    ],
  });
  const result = await reap(undefined, { docker, clock: () => now, runscLogRoot: NO_RUNSC_LOGS });
  assert.deepEqual(result, { removed: { containers: ['old'], volumes: ['do-j-old-home'], logs: [] }, errors: [] });
  assert.deepEqual(docker.state.containers.map(c => c.id), ['young', 'unlabelled']);
  assert.deepEqual(docker.state.volumes.map(v => v.name), ['do-j-young-home', 'unrelated']);
  const removals = docker.state.calls.filter(call => call.includes('rm'));
  assert.deepEqual(removals, [['rm', '-f', '-v', 'old'], ['volume', 'rm', 'do-j-old-home']]);
  assert.deepEqual(docker.state.calls[0], ['ps', '-a', '-q', '--no-trunc', '--filter', 'label=detonation-ocean.job']);
  assert.deepEqual(docker.state.calls[1].slice(0, 4), ['container', 'inspect', '--format', '{{.Id}} {{.Created}}']);
  assert.deepEqual(docker.state.calls.find(call => call[0] === 'volume' && call[1] === 'inspect').slice(0, 4), ['volume', 'inspect', '--format', '{{.Name}} {{.CreatedAt}}']);

  const strict = await reap(60_000, { docker, clock: () => now, runscLogRoot: NO_RUNSC_LOGS });
  assert.deepEqual(strict.removed, { containers: ['young'], volumes: ['do-j-young-home'], logs: [] });

  const failing = fakeDaemon({ containers: [{ id: 'old', created: '2026-10-07T12:00:00Z', labels: labelled('j-old') }], failRm: true });
  const failed = await reap(undefined, { docker: failing, clock: () => now, runscLogRoot: NO_RUNSC_LOGS });
  assert.deepEqual(failed.removed.containers, []);
  assert.equal(failed.errors.length, 1);
});

test('P1-3 reaper: more than ten old containers are all removed (a plain inspect of them would exceed 64 KB)', async () => {
  const now = new Date('2026-10-07T12:10:00Z');
  const ids = Array.from({ length: 15 }, (_, i) => `c${String(i).padStart(2, '0')}`);
  const docker = fakeDaemon({
    containers: ids.map(id => ({ id, created: '2026-10-07T11:00:00.123456789Z', labels: labelled(`j-${id}`) })),
    volumes: ids.map(id => ({ name: `do-j-${id}-home`, created: '2026-10-07T11:00:00Z', labels: { 'detonation-ocean.job': `j-${id}` } })),
  });
  assert.equal((await docker(['container', 'inspect', ...ids])).truncated, true, 'the old JSON listing would be truncated');
  const result = await reap(undefined, { docker, clock: () => now, runscLogRoot: NO_RUNSC_LOGS });
  assert.deepEqual(result, { removed: { containers: ids, volumes: ids.map(id => `do-j-${id}-home`), logs: [] }, errors: [] });
  assert.equal(docker.state.containers.length, 0);
  assert.equal(docker.state.volumes.length, 0);
});

test('P1-3 reaper: output that hit the 64 KB cap fails closed — nothing is removed and the error is reported', async () => {
  const now = new Date('2026-10-07T12:10:00Z');
  const containers = [{ id: 'old', created: '2026-10-07T11:00:00Z', labels: labelled('j-old') }];
  const volumes = [{ name: 'do-j-old-home', created: '2026-10-07T11:00:00Z', labels: { 'detonation-ocean.job': 'j-old' } }];
  const truncating = verb => {
    const docker = fakeDaemon({ containers, volumes });
    const wrapped = async args => ({ ...(await docker(args)), ...(verb(args) ? { truncated: true } : {}) });
    wrapped.state = docker.state;
    return wrapped;
  };
  for (const [label, verb, errorCount] of [['inspect', args => args[1] === 'inspect', 2], ['list', args => args[0] === 'ps' || (args[0] === 'volume' && args[1] === 'ls'), 3]]) {
    const docker = truncating(verb);
    const result = await reap(undefined, { docker, clock: () => now, runscLogRoot: NO_RUNSC_LOGS, ledger: createContainerLedger() });
    assert.deepEqual(result.removed, { containers: [], volumes: [], logs: [] }, label);
    assert.equal(result.errors.length, errorCount, label);
    assert.ok(result.errors.every(error => /truncated/.test(error)), label);
    assert.equal(docker.state.containers.length, 1);
    assert.equal(docker.state.volumes.length, 1);
  }
  // An unreadable age keeps the item and is reported.
  const odd = fakeDaemon({ containers: [{ id: 'odd', created: 'not-a-date', labels: labelled('j-odd') }] });
  assert.deepEqual(await reap(undefined, { docker: odd, clock: () => now, runscLogRoot: NO_RUNSC_LOGS }), { removed: { containers: [], volumes: [], logs: [] }, errors: ['odd: age unreadable'] });
});

test('P1-4 reaper: only runsc log directories named in the ledger, gone from docker and older than the age limit are deleted', async () => {
  const now = new Date('2026-10-07T12:10:00Z');
  const root = mkdtempSync(join(tmpdir(), 'do-runsc-'));
  const [ledgerOld, ledgerYoung, ledgerLive, ledgerGone, unlisted, unlistedOld] = ['a', 'b', 'c', 'd', 'e', 'f'].map(letter => letter.repeat(64));
  const age = (id, iso) => { mkdirSync(join(root, id)); writeFileSync(join(root, id, 'x.boot.txt'), 'trace'); utimesSync(join(root, id), new Date(iso), new Date(iso)); };
  age(ledgerOld, '2026-10-07T11:00:00Z'); age(ledgerYoung, '2026-10-07T12:09:00Z'); age(ledgerLive, '2026-10-07T11:00:00Z');
  age(unlisted, '2026-10-07T11:00:00Z'); age(unlistedOld, '2000-01-01T00:00:00Z');
  const others = ['postgres', 'caddy', 'not-hex', 'G'.repeat(64), 'a'.repeat(63)];
  for (const name of others) age(name, '2000-01-01T00:00:00Z');
  writeFileSync(join(root, 'stray-file'), 'x');
  const ledgerFile = join(root, 'ledger.json');
  const ledger = createContainerLedger(ledgerFile);
  for (const id of [ledgerOld, ledgerYoung, ledgerLive, ledgerGone, 'postgres', 'G'.repeat(64), '../x']) ledger.add(id);
  assert.deepEqual(ledger.ids().sort(), [ledgerOld, ledgerYoung, ledgerLive, ledgerGone].sort(), 'only 64-hex ids are accepted');
  const daemon = fakeDaemon({ containers: [{ id: ledgerLive, created: '2026-10-07T12:08:00Z', labels: labelled('j-live') }] });
  // The fake daemon answers a `ps` without a filter with nothing; answer it with every container still present, as docker does.
  const everything = async args => (args[0] === 'ps' && !args.includes('--filter')
    ? { code: 0, stdout: daemon.state.containers.map(c => `${c.id}\n`).join(''), stderr: '' }
    : daemon(args));
  try {
    const result = await reap(undefined, { docker: everything, clock: () => now, runscLogRoot: root, ledger });
    assert.deepEqual(result.removed.logs, [ledgerOld]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(readdirSync(root).sort(), [...others, 'stray-file', 'ledger.json', ledgerYoung, ledgerLive, unlisted, unlistedOld].sort(),
      'directories outside the ledger, young ones and those of live containers stay');
    assert.deepEqual(ledger.ids().sort(), [ledgerYoung, ledgerLive].sort(), 'a deleted directory and an already missing one leave the ledger');
    assert.deepEqual(createContainerLedger(ledgerFile).ids().sort(), [ledgerYoung, ledgerLive].sort(), 'the ledger is persisted');

    // docker cannot list, or the listing is cut: the sweep is skipped and the failure reported.
    const skipped = createContainerLedger();
    skipped.add(ledgerYoung);
    for (const answer of [{ code: 1, stdout: '', stderr: 'daemon down' }, { code: 0, stdout: '', stderr: '', truncated: true }]) {
      const down = async args => (args[0] === 'ps' && !args.includes('--filter') ? answer : { code: 0, stdout: '', stderr: '' });
      const outcome = await reap(undefined, { docker: down, clock: () => new Date('2026-10-07T13:00:00Z'), runscLogRoot: root, ledger: skipped });
      assert.deepEqual(outcome.removed.logs, []);
      assert.match(outcome.errors.at(-1), /runsc logs not swept/);
      assert.equal(existsSync(join(root, ledgerYoung)), true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const supportSpec = role => ({ jobId, role, jobDir });

test('P1-3 (7.3): the recorded seed and holder fixtures pass the isolation check; their flags and mounts are pinned', () => {
  const holder = verifyIsolation(fixture('holder'), supportSpec('holder'));
  assert.equal(holder.role, 'holder');
  assert.equal(holder.runtime, 'runsc');
  assert.equal(verifyIsolation(fixture('seed'), supportSpec('seed')).role, 'seed');
  assert.throws(() => verifyIsolation(fixture('holder'), supportSpec('seed')), /name.*labels.*mounts|mounts/);
  assert.throws(() => verifyIsolation(mutated('holder', c => { at(c, '/home/dana').RW = true; }), supportSpec('holder')), /mounts/);
  assert.throws(() => verifyIsolation(mutated('holder', c => { c.HostConfig.Runtime = 'runc'; }), supportSpec('holder')), /runtime/);
  assert.throws(() => verifyIsolation(mutated('seed', c => { at(c, '/seed').RW = true; }), supportSpec('seed')), /mounts/);
  assert.throws(() => verifyIsolation(mutated('seed', c => { c.HostConfig.NetworkMode = 'bridge'; }), supportSpec('seed')), /network-mode/);
  assert.equal(containerName(jobId, 'holder'), 'do-j-abc123-holder');
  assert.equal(containerName(jobId, 'seed'), 'do-j-abc123-seed');
  assert.throws(() => containerName(jobId, 'root'), /role/);

  const args = buildContainerArgs({ jobId, role: 'holder', image: 'img', jobDir, entrypoint: 'sleep', command: ['200'] });
  assert.deepEqual(args.slice(-2), ['img', '200']);
  assert.deepEqual(valuesOf(args, '--entrypoint'), ['sleep']);
  assert.deepEqual(valuesOf(args, '--mount'), ['type=volume,src=do-j-abc123-home,dst=/home/dana,readonly']);
  assert.deepEqual(valuesOf(args, '--tmpfs'), ['/tmp:rw,nosuid,nodev,size=64m']);
  assert.deepEqual(valuesOf(args, '--label'), ['detonation-ocean.job=j-abc123', 'detonation-ocean.role=holder']);
  assert.equal(valuesOf(args, '--runtime')[0], 'runsc');
});

test('P2-10: the container image must be the digest pinned for its role in images.lock.json', () => {
  const lock = loadImageLock();
  const digests = Object.fromEntries(['detonate', 'collect', 'analyse'].map(role => [role, JSON.parse(fixture(role))[0].Image]));
  for (const role of ['detonate', 'collect', 'analyse']) assert.equal(lock[`detonation-ocean/${role}`], digests[role], `${role}: fixture and images.lock.json agree (run tests/fixtures/detonation/inspect/sync-image-ids.mjs after a rebuild)`);
  const wrong = { ...lock, 'detonation-ocean/detonate': `sha256:${'0'.repeat(64)}` };
  assert.throws(() => verifyIsolation(fixture('detonate'), { ...expected('detonate'), imageLock: wrong }), /isolation check failed:.*\bimage\b/);
  assert.throws(() => verifyIsolation(fixture('collect'), { ...expected('collect'), imageLock: { ...lock, 'detonation-ocean/collect': undefined } }), /\bimage\b/);
  assert.throws(() => verifyIsolation(fixture('collect'), { ...expected('collect'), imageLock: {} }), /\bimage\b/);
  assert.throws(() => verifyIsolation(mutated('analyse', c => { c.Image = 'sha256:ffff'; }), expected('analyse')), /\bimage\b/);
  assert.throws(() => verifyIsolation(mutated('analyse', c => { delete c.Image; }), expected('analyse')), /\bimage\b/);
  assert.doesNotThrow(() => verifyIsolation(fixture('collect'), { ...expected('collect'), imageLock: { 'detonation-ocean/collect': digests.collect } }));
  // The seed and the holder run the detonate image.
  assert.throws(() => verifyIsolation(fixture('holder'), { ...supportSpec('holder'), imageLock: { ...lock, 'detonation-ocean/detonate': `sha256:${'1'.repeat(64)}` } }), /\bimage\b/);
});

test('P1-3 startHome: quota volume, then a verified holder started; failures leave nothing started', async () => {
  const run = fakeRunDocker({ role: 'holder' });
  const calls = [];
  const docker = async (args, options) => {
    calls.push(args);
    if (args[0] === 'volume') return { code: 0, stdout: 'do-j-abc123-home\n', stderr: '' };
    if (args[0] === 'start') { run.state.calls.push(args); return { code: 0, stdout: '', stderr: '' }; }
    return run(args, options);
  };
  const ledger = createContainerLedger();
  const record = await startHome({ jobId, image: 'img', jobDir, docker, ledger });
  assert.equal(record.role, 'holder');
  assert.deepEqual(calls.map(call => call.slice(0, 2).join(' ')), ['volume create', 'create --pull', 'container inspect', 'start do-j-abc123-holder']);
  assert.deepEqual(calls[0], quotaHomeVolumeCreateArgs(jobId));
  assert.deepEqual(valuesOf(calls[1], '--entrypoint'), ['sleep']);
  assert.deepEqual(calls[1].slice(-2), ['img', '200']);
  assert.deepEqual(ledger.ids(), [JSON.parse(fixture('holder'))[0].Id], 'the holder id is in the ledger');

  const volumeFails = [];
  await assert.rejects(startHome({ jobId, image: 'img', jobDir, docker: async args => { volumeFails.push(args[0]); return { code: 1, stdout: '', stderr: 'no driver' }; } }), /volume create failed: no driver/);
  assert.deepEqual(volumeFails, ['volume']);

  const bad = fakeRunDocker({ role: 'holder', mutate: c => { c.HostConfig.Privileged = true; } });
  await assert.rejects(startHome({ jobId, image: 'img', jobDir, ledger, docker: async (args, options) => (args[0] === 'volume' ? { code: 0, stdout: '', stderr: '' } : bad(args, options)) }), /privileged/);
  assert.deepEqual(verbs(bad), ['create', 'inspect', 'rm'], 'a holder that fails verification is removed and never started');

  const startFails = fakeRunDocker({ role: 'holder' });
  await assert.rejects(startHome({ jobId, image: 'img', jobDir, ledger, docker: async (args, options) => {
    if (args[0] === 'volume') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'start') return { code: 1, stdout: '', stderr: 'cannot start' };
    return startFails(args, options);
  } }), /start failed: cannot start/);
  assert.ok(verbs(startFails).includes('rm'));
});

test('P2-6 runSeed: create, inspect, verify as role seed, then start; a failed copy throws', async () => {
  const docker = fakeRunDocker({ role: 'seed' });
  const ledger = createContainerLedger();
  const result = await runSeed({ jobId, image: 'img', jobDir, docker, ledger });
  assert.deepEqual(verbs(docker), ['create', 'inspect', 'start', 'inspect']);
  assert.equal(result.isolation.role, 'seed');
  assert.equal(result.name, 'do-j-abc123-seed');
  assert.deepEqual(docker.state.calls[0].slice(-4), ['img', '-R', '/seed/.', '/home/dana/']);
  assert.deepEqual(valuesOf(docker.state.calls[0], '--entrypoint'), ['cp']);

  const unverified = fakeRunDocker({ role: 'seed', mutate: c => { c.HostConfig.NetworkMode = 'bridge'; } });
  await assert.rejects(runSeed({ jobId, image: 'img', jobDir, docker: unverified, ledger }), /network-mode/);
  assert.ok(!verbs(unverified).includes('start'), 'a seed that fails verification never starts');

  const failing = fakeRunDocker({ role: 'seed' });
  await assert.rejects(runSeed({ jobId, image: 'img', jobDir, ledger, docker: async (args, options) => (args[0] === 'start' ? { code: 1, stdout: '', stderr: 'cp: error' } : failing(args, options)) }), /seed copy failed \(exit 1\)/);
});

test('P1-3 teardown removes the holder before the job\'s other containers, and forgets removed ids', async () => {
  const [holder, detonate, seed] = ['1', '2', '3'].map(digit => digit.repeat(64));
  const docker = fakeDaemon({ containers: [
    { id: detonate, labels: labelled(jobId) },
    { id: seed, labels: { ...labelled(jobId), 'detonation-ocean.role': 'seed' } },
    { id: holder, labels: { ...labelled(jobId), 'detonation-ocean.role': 'holder' } },
  ] });
  const ledger = createContainerLedger();
  for (const id of [holder, detonate, seed]) ledger.add(id);
  const result = await teardown(jobId, { docker, runscLogRoot: NO_RUNSC_LOGS, ledger });
  assert.equal(result.confirmed, true);
  assert.deepEqual(docker.state.calls.filter(call => call[0] === 'rm').map(call => call.at(-1)), [holder, detonate, seed]);
  assert.deepEqual(ledger.ids(), []);

  const stuck = fakeDaemon({ containers: [{ id: detonate, labels: labelled(jobId) }], failRm: true });
  ledger.add(detonate);
  assert.equal((await teardown(jobId, { docker: stuck, runscLogRoot: NO_RUNSC_LOGS, ledger })).confirmed, false);
  assert.equal(ledger.has(detonate), true, 'a container that could not be removed stays in the ledger for the reaper');
});

test('P1-3 teardown retries a volume removal that fails with "in use" and gives up on other errors at once', async () => {
  const volumes = [{ name: 'do-j-abc123-home', labels: { 'detonation-ocean.job': jobId } }];
  const daemon = fakeDaemon({ volumes });
  let busy = 2;
  const flaky = async args => (args[0] === 'volume' && args[1] === 'rm' && busy-- > 0 ? { code: 1, stdout: '', stderr: 'volume is in use - [469b]' } : daemon(args));
  assert.equal((await teardown(jobId, { docker: flaky, runscLogRoot: NO_RUNSC_LOGS })).confirmed, true);
  assert.equal(daemon.state.calls.filter(call => call[0] === 'volume' && call[1] === 'rm').length, 1, 'the daemon saw the successful attempt only');
  let attempts = 0;
  const broken = async args => (args[0] === 'volume' && args[1] === 'rm' ? (attempts += 1, { code: 1, stdout: '', stderr: 'permission denied' }) : fakeDaemon({ volumes })(args));
  const result = await teardown(jobId, { docker: broken, runscLogRoot: NO_RUNSC_LOGS });
  assert.equal(attempts, 1);
  assert.equal(result.confirmed, false);
  assert.match(result.errors[0], /docker volume rm failed: permission denied/);
});

test('P1-4: runContainer records the container id from inspect in the ledger', async () => {
  const ledger = createContainerLedger();
  await runContainer({ ...runSpec, docker: fakeRunDocker(), wallClockMs: 1000, ledger });
  assert.deepEqual(ledger.ids(), [JSON.parse(fixture('detonate'))[0].Id]);
});

const goodContainer = (role, exit = { code: 0, reason: null }) => ({ ...verifyIsolation(fixture(role), expected(role)), exit });
const inference = { provider: 'vultr-serverless-inference', calls: 4, model: 'm' };
const confirmed = { confirmed: true, removedAt: '2026-10-07T12:01:00.000Z', errors: [] };
const receiptFor = (overrides = {}) => buildReceipt({
  jobId, containers: [goodContainer('detonate', { code: 137, reason: 'pids-limit' }), goodContainer('collect'), goodContainer('analyse')], teardown: confirmed,
  uploadDeleted: true, hostCanary: 'unchanged', inference, ...overrides,
});

test('receipt: built from container records, valid, and done only with confirmed teardown and an unchanged canary', () => {
  const receipt = receiptFor();
  assert.deepEqual(validateReceipt(receipt), { ok: true, problems: [] });
  assert.deepEqual(receipt.limitsHit, ['pids-limit']);
  assert.equal(receipt.volumesRemoved, true);
  assert.equal(receipt.containers[0].removedAt, confirmed.removedAt);
  assert.equal(receipt.containers[0].secretEnvVars, 0);
  assert.equal(receiptAllowsDone(receipt), true);

  const unconfirmed = receiptFor({ teardown: { confirmed: false, removedAt: null, errors: ['x'] } });
  assert.equal(validateReceipt(unconfirmed).ok, true);
  assert.equal(unconfirmed.teardownConfirmed, false);
  assert.equal(unconfirmed.volumesRemoved, false);
  assert.equal(receiptAllowsDone(unconfirmed), false);

  const changed = receiptFor({ hostCanary: 'changed' });
  assert.equal(validateReceipt(changed).ok, true);
  assert.equal(receiptAllowsDone(changed), false);
  assert.deepEqual(receiptFor({ containers: [goodContainer('detonate', { code: 137, reason: 'time' }), goodContainer('analyse', { code: 137, reason: 'oom' })] }).limitsHit, ['time', 'oom']);

  // P2-11: the upload must be deleted, and detonate and collect (which every finished job ran) must both appear.
  const kept = receiptFor({ uploadDeleted: false });
  assert.equal(validateReceipt(kept).ok, true);
  assert.equal(receiptAllowsDone(kept), false);
  const noCollect = receiptFor({ containers: [goodContainer('detonate'), goodContainer('analyse')] });
  assert.equal(validateReceipt(noCollect).ok, true);
  assert.equal(receiptAllowsDone(noCollect), false);
  assert.equal(receiptAllowsDone(receiptFor({ containers: [goodContainer('detonate'), goodContainer('collect')] })), true, 'analyse runs a container only when a script was written');
});

test('receipt validation rejects missing or weakened fields', () => {
  const cases = [
    ['containers', r => { r.containers = []; }],
    ['containers[0].network', r => { r.containers[0].network = 'bridge'; }],
    ['containers[0].readOnlyRoot', r => { r.containers[0].readOnlyRoot = false; }],
    ['containers[0].capDrop', r => { r.containers[0].capDrop = []; }],
    ['containers[0].pidsLimit', r => { r.containers[0].pidsLimit = 0; }],
    ['containers[0].secretEnvVars', r => { r.containers[0].secretEnvVars = 1; }],
    ['containers[0].runtime', r => { r.containers[0].runtime = 'runc'; }],
    ['containers[0].runtime', r => { r.containers[0].runtime = 'runsc'; }], // detonate must be runsc-trace
    ['containers[1].runtime', r => { r.containers[1].runtime = 'runsc-trace'; }], // collect must be runsc
    ['containers[2].runtime', r => { r.containers[2].runtime = 'runsc-trace'; }],
    ['containers[0].exit', r => { r.containers[0].exit = { code: 1, reason: 'meteor' }; }],
    ['containers[0].removedAt', r => { r.containers[0].removedAt = null; }],
    ['limitsHit', r => { r.limitsHit = []; }],
    ['hostCanary', r => { r.hostCanary = 'unknown'; }],
    ['uploadDeleted', r => { delete r.uploadDeleted; }],
    ['volumesRemoved', r => { r.teardownConfirmed = false; r.containers.forEach(c => { c.removedAt = null; }); }],
    ['inference', r => { r.inference = {}; }],
    ['jobId', r => { r.jobId = ''; }],
  ];
  for (const [problem, change] of cases) {
    const receipt = clone(receiptFor());
    change(receipt);
    const { ok, problems } = validateReceipt(receipt);
    assert.equal(ok, false, problem);
    assert.ok(problems.includes(problem), `${problem} in ${problems}`);
    assert.equal(receiptAllowsDone(receipt), false, problem);
  }
  assert.equal(validateReceipt(null).ok, false);
});

test('host canary: hash before and after; any change or missing hash is "changed"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'do-canary-'));
  try {
    const canary = join(dir, 'host-canary');
    writeFileSync(canary, Buffer.from('0123456789abcdef'));
    const before = await hashFile(canary);
    assert.match(before, /^[0-9a-f]{64}$/);
    assert.equal(compareCanary(before, await hashFile(canary)), 'unchanged');
    writeFileSync(canary, Buffer.from('0123456789abcdeX'));
    assert.equal(compareCanary(before, await hashFile(canary)), 'changed');
    assert.equal(compareCanary(undefined, undefined), 'changed');
    await assert.rejects(hashFile(join(dir, 'missing')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
