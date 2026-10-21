// Sandbox controller: one container (or Vultr instance) per run. It streams the runner's events to the desktop
// backend as world.sandbox patches, destroys the container, verifies it is gone and posts the receipt.
// See docs/desktop-parity/SANDBOX.md.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTACK_KINDS, MAX_RUNNER_EVENTS, runAttackKind } from './kinds.mjs';
import { VULTR_APPROVAL_PHRASE, createApprovedVultrAdapterFactory } from '../vultr-adapter.mjs';
import { loadPersonas, findPersona } from '../personas.mjs';

export const DEFAULT_SANDBOX_IMAGE = 'blast-radius-sandbox:local';
export const SANDBOX_MODES = Object.freeze(['docker', 'vultr', 'simulated']);
export const RUN_TIMEOUT_MS = 60_000;
const ID_RE = /^[a-z0-9-]{1,40}$/;
const WORLD_MAX_EVENTS = 64;
const VULTR_ENV = [
  'VULTR_API_KEY', 'VULTR_SANDBOX_MODE', 'VULTR_SANDBOX_APPROVAL', 'VULTR_REGION', 'VULTR_PLAN_ID', 'VULTR_SNAPSHOT_ID',
  'VULTR_SNAPSHOT_SHA256', 'VULTR_VPC_ID', 'VULTR_VPC_CIDR', 'VULTR_FIREWALL_GROUP_ID', 'VULTR_CONTROLLER_IPV4',
  'VULTR_MAX_HOURLY_COST_USD', 'VULTR_MAX_RUN_SECONDS', 'VULTR_PERSONA_ID',
];

/** Docker arguments for one runner container. Every isolation flag lives here so a test can pin them. */
export function buildDockerRunArgs({ name, image, runId, attackKind, seed }) {
  return [
    'run', '--pull', 'never', '--name', name,
    '--label', 'blast-radius.role=synthetic-attack-runner',
    '--label', `blast-radius.run=${runId}`,
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/work:rw,nosuid,nodev,noexec,size=32m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--memory', '128m',
    '--memory-swap', '128m',
    '--pids-limit', '32',
    '--cpus', '0.5',
    '--user', '10001:10001',
    '--env', `SANDBOX_KIND=${attackKind}`,
    '--env', `SANDBOX_SEED=${seed}`,
    '--env', 'SANDBOX_REQUIRE_NO_NETWORK=1',
    image,
  ];
}

/** Names of the environment variables the live Vultr path needs and does not have. Values are never read out. */
export function vultrGateReport(env = process.env) {
  const missing = VULTR_ENV.filter(name => typeof env[name] !== 'string' || env[name] === '');
  const wrong = [];
  if (env.VULTR_SANDBOX_MODE && env.VULTR_SANDBOX_MODE !== 'vultr') wrong.push('VULTR_SANDBOX_MODE (must be "vultr")');
  if (env.VULTR_SANDBOX_APPROVAL && env.VULTR_SANDBOX_APPROVAL !== VULTR_APPROVAL_PHRASE) wrong.push('VULTR_SANDBOX_APPROVAL (not the approval phrase)');
  return { ready: !missing.length && !wrong.length, missing, wrong };
}

const iso = date => date.toISOString();

function dockerCommand(args, { timeoutMs = 15_000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'DOCKER_HOST', 'DOCKER_CONTEXT']
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    let child;
    try {
      child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env });
    } catch (cause) {
      reject(new Error('docker CLI unavailable', { cause }));
      return;
    }
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(line => line.trim() && onLine(line));
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.on('error', cause => { clearTimeout(timer); reject(new Error('docker CLI unavailable', { cause })); });
    child.on('close', code => {
      clearTimeout(timer);
      if (onLine && pending.trim()) onLine(pending);
      resolve({ code: timedOut ? 124 : code ?? 1, stdout, stderr, timedOut });
    });
  });
}

/** A runner line is an event ({seq, kind, label, count?, total?}) or the evidence line. Anything else is refused. */
export function parseRunnerLine(line) {
  let value;
  try { value = JSON.parse(line); } catch { throw new Error('Runner printed a line that is not JSON.'); }
  if (value && typeof value === 'object' && value.evidence && Object.keys(value).length === 1) return { evidence: value.evidence };
  const keys = value && typeof value === 'object' ? Object.keys(value) : [];
  if (!keys.length || keys.some(key => !['seq', 'kind', 'label', 'count', 'total'].includes(key)) ||
      !Number.isInteger(value.seq) || value.seq < 0 || typeof value.kind !== 'string' || !ID_RE.test(value.kind) ||
      typeof value.label !== 'string' || value.label.length > 120 || /[\r\n]/.test(value.label) ||
      ['count', 'total'].some(key => key in value && !(Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 1_000_000))) {
    throw new Error('Runner printed an invalid event.');
  }
  return { event: value };
}

/** Throws unless the finished container shows the isolation the controller asked for. */
export function verifyContainerIsolation(inspectJson, name) {
  const container = JSON.parse(inspectJson)?.[0];
  const host = container?.HostConfig ?? {};
  const networks = Object.keys(container?.NetworkSettings?.Networks ?? {});
  const problems = [];
  if (container?.Name !== `/${name}`) problems.push('name');
  if (host.NetworkMode !== 'none') problems.push('network-mode');
  if (networks.length !== 1 || networks[0] !== 'none') problems.push('networks');
  if (host.ReadonlyRootfs !== true) problems.push('read-only-root');
  if (!Array.isArray(host.CapDrop) || !host.CapDrop.some(cap => String(cap).toUpperCase() === 'ALL')) problems.push('cap-drop');
  if (container?.Config?.User !== '10001:10001') problems.push('user');
  if (!(host.Memory > 0) || !(host.PidsLimit > 0) || !(host.NanoCpus > 0)) problems.push('limits');
  if (container?.State?.ExitCode !== 0) problems.push('exit-code');
  if (problems.length) throw new Error(`Container isolation check failed: ${problems.join(', ')}.`);
  return {
    containerId: container.Id,
    networkMode: host.NetworkMode,
    networks,
    readOnlyRoot: host.ReadonlyRootfs,
    capDrop: host.CapDrop,
    user: container.Config.User,
    memoryBytes: host.Memory,
    pidsLimit: host.PidsLimit,
    nanoCpus: host.NanoCpus,
    exitCode: container.State.ExitCode,
    imageId: container.Image,
  };
}

function dockerBackend({ runId, attackKind, seed, image, docker, timeoutMs }) {
  const name = `brz-sandbox-${runId}`;
  let containerId = '';
  return {
    instance: () => `${name}/${containerId.slice(0, 12) || 'unstarted'}`,
    async run(onLine) {
      const have = await docker(['image', 'inspect', '--format', '{{.Id}}', image]);
      if (have.code !== 0) throw new Error(`Sandbox image ${image} is missing; build it first (docs/desktop-parity/SANDBOX.md).`);
      const result = await docker(buildDockerRunArgs({ name, image, runId, attackKind, seed }), { timeoutMs, onLine });
      if (result.timedOut) throw new Error('Runner container timed out.');
      if (result.code !== 0) throw new Error(`Runner container exited with code ${result.code}: ${result.stderr.trim().slice(0, 200)}`);
      const inspected = await docker(['container', 'inspect', name]);
      if (inspected.code !== 0) throw new Error('Finished container could not be inspected.');
      const isolation = verifyContainerIsolation(inspected.stdout, name);
      containerId = isolation.containerId;
      return { isolation };
    },
    async destroy() {
      const removed = await docker(['rm', '-f', name]).catch(() => ({ code: 1 }));
      const inspect = await docker(['container', 'inspect', name]).catch(() => null);
      const listed = await docker(['ps', '-a', '-q', '--filter', `name=^/${name}$`]).catch(() => null);
      const confirmed = Boolean(inspect && inspect.code !== 0 && listed && listed.code === 0 && listed.stdout.trim() === '');
      return { confirmed, removed: removed.code === 0, label: 'Container removed; docker inspect confirms it is gone' };
    },
  };
}

function simulatedBackend({ runId, attackKind, seed }) {
  let dir = '';
  return {
    instance: () => `simulated/${runId}`,
    async run(onLine) {
      dir = mkdtempSync(join(tmpdir(), 'brz-sim-'));
      const { evidence } = runAttackKind(attackKind, { dir, seed, onEvent: event => onLine(JSON.stringify(event)) });
      onLine(JSON.stringify({ evidence: { ...evidence, kind: attackKind, interfaces: [], nonLoopbackInterfaces: 0 } }));
      return { isolation: null };
    },
    async destroy() {
      if (dir) rmSync(dir, { recursive: true, force: true });
      return { confirmed: !dir || !existsSync(dir), label: 'Work directory removed; nothing remains on disk' };
    },
  };
}

function vultrBackend({ runId, attackKind, seed, vultr = {}, env = process.env }) {
  let adapter = vultr.adapter;
  let sandbox = null;
  let createError = null;
  return {
    instance: () => sandbox?.id ?? 'vultr/not-created',
    async run(onLine) {
      if (!adapter) {
        const gates = vultrGateReport(env);
        if (!gates.ready) throw new Error(`Vultr gates are not satisfied. Missing: ${gates.missing.join(', ') || 'none'}. Wrong: ${gates.wrong.join(', ') || 'none'}.`);
        const personas = loadPersonas();
        adapter = createApprovedVultrAdapterFactory({ env, oauthApp: personas.oauth_app })();
        vultr.persona ??= findPersona(personas, env.VULTR_PERSONA_ID);
      }
      try {
        sandbox = await adapter.createSandbox({ runId, persona: vultr.persona });
      } catch (error) {
        createError = error;
        throw error;
      }
      const { events, evidence } = await adapter.runSyntheticAttack(sandbox, { attackKind, seed });
      events.forEach(event => onLine(JSON.stringify(event)));
      onLine(JSON.stringify({ evidence }));
      return { isolation: { privateIPv4: sandbox.privateIPv4, vpcOnly: true, attestation: sandbox.attestation ?? null } };
    },
    async destroy() {
      const label = 'Instance deleted; provider no longer returns it';
      if (!sandbox) return { confirmed: !adapter || createError?.resourceNotCreated === true || createError?.cleanupConfirmed === true, label };
      try {
        await adapter.destroySandbox(sandbox);
        return { confirmed: sandbox.destroyed === true, label };
      } catch {
        return { confirmed: false, label };
      }
    },
  };
}

function createPublisher({ baseUrl, runId, token, fetchImpl }) {
  const failures = [];
  let posted = 0;
  let chain = Promise.resolve();
  const url = baseUrl ? `${String(baseUrl).replace(/\/+$/, '')}/api/desktop/events?run=${encodeURIComponent(runId)}` : null;
  return {
    send(sandbox) {
      if (!url) return;
      chain = chain.then(async () => {
        try {
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ type: 'patch', patch: { sandbox } }),
          });
          if (response.status === 202) posted++;
          else failures.push(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
        } catch (error) {
          failures.push(`post failed: ${error.message}`);
        }
      });
    },
    async flush() { await chain; return { posted, failures }; },
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run one scenario in one disposable sandbox and report it to the desktop backend.
 * Never throws for a failed run: the result has `ok: false`, `error` and a receipt that states whether teardown
 * was confirmed. Throws only for invalid arguments.
 */
export async function runScenario({
  scenarioId, attackKind, runId, mode = 'docker', baseUrl, token, seed = `${scenarioId}:${attackKind}`,
  image = DEFAULT_SANDBOX_IMAGE, docker = dockerCommand, fetchImpl = globalThis.fetch, clock = () => new Date(),
  timeoutMs = RUN_TIMEOUT_MS, paceMs = 0, vultr, env = process.env,
}) {
  if (!ID_RE.test(scenarioId ?? '')) throw new Error('scenarioId must match [a-z0-9-]{1,40}.');
  if (!ATTACK_KINDS.includes(attackKind)) throw new Error(`attackKind must be one of: ${ATTACK_KINDS.join(', ')}.`);
  if (!ID_RE.test(runId ?? '')) throw new Error('runId must match [a-z0-9-]{1,40}.');
  if (!SANDBOX_MODES.includes(mode)) throw new Error(`mode must be one of: ${SANDBOX_MODES.join(', ')}.`);
  if (baseUrl && typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required to post events.');

  const backend = { docker: dockerBackend, vultr: vultrBackend, simulated: simulatedBackend }[mode]({
    runId, attackKind, seed, image, docker, timeoutMs, vultr, env,
  });
  const publisher = createPublisher({ baseUrl, runId, token, fetchImpl });
  const state = { runId, scenario: scenarioId, attackKind, mode, status: 'provisioning', events: [] };
  const publish = () => publisher.send({ ...state, events: [...state.events], ...(state.receipt ? { receipt: state.receipt } : {}) });
  const startedAt = iso(clock());
  publish();

  let evidence = null;
  let isolation = null;
  let error = null;
  let pending = Promise.resolve();
  const onLine = line => {
    pending = pending.then(async () => {
      const parsed = parseRunnerLine(line);
      if (parsed.evidence) { evidence = parsed.evidence; return; }
      if (state.events.length >= MAX_RUNNER_EVENTS) throw new Error('Runner exceeded the event budget.');
      state.events.push(parsed.event);
      if (state.status === 'provisioning') state.status = 'running';
      publish();
      if (paceMs) await sleep(paceMs);
    });
    pending.catch(() => {});
  };
  try {
    ({ isolation } = await backend.run(onLine));
    await pending;
    if (!state.events.some(event => event.kind === 'summary')) throw new Error('Runner finished without a summary event.');
    state.status = 'done';
    publish();
  } catch (caught) {
    error = caught;
    state.status = 'failed';
    await pending.catch(() => {});
    publish();
  }

  let teardown;
  try {
    teardown = await backend.destroy();
  } catch {
    teardown = { confirmed: false, label: 'Teardown could not be confirmed' };
  }
  const destroyedAt = teardown.confirmed ? iso(clock()) : null;
  if (teardown.confirmed) {
    if (state.events.length < WORLD_MAX_EVENTS) {
      state.events.push({ seq: state.events.length, kind: 'destroyed', label: teardown.label, count: 1, total: 1 });
    }
    state.status = error ? 'failed' : 'destroyed';
  } else {
    state.status = 'failed';
    error ??= new Error('Teardown was not confirmed.');
  }
  state.receipt = {
    provider: mode,
    instance: backend.instance(),
    startedAt,
    destroyedAt,
    teardownConfirmed: teardown.confirmed,
    egress: 'none',
    dataset: 'synthetic',
  };
  publish();
  const publishResult = await publisher.flush();
  return {
    ok: !error && teardown.confirmed && publishResult.failures.length === 0,
    error: error ? error.message : null,
    ...state,
    evidence,
    isolation,
    publish: publishResult,
  };
}
