#!/usr/bin/env node
// Live Vultr flagship run, in stages, with a ledger of every resource this tool creates.
// See docs/desktop-parity/SANDBOX.md ("Vultr live run"). The API key comes from VULTR_API_KEY in the environment only.
//
//   node tools/sandbox/vultr-live.mjs network      SSH key + VPC + firewall group
//   node tools/sandbox/vultr-live.mjs builder      builder instance, installs the guest image, prints the image digest
//   node tools/sandbox/vultr-live.mjs snapshot     snapshot the builder, then delete the builder
//   node tools/sandbox/vultr-live.mjs controller   in-VPC controller (jump host) instance
//   node tools/sandbox/vultr-live.mjs run          ONE gated guest through VultrComputeAdapter (needs the gate variables)
//   node tools/sandbox/vultr-live.mjs retire <id>  delete one resource this tool created (for example a superseded snapshot)
//   node tools/sandbox/vultr-live.mjs teardown [--delete-snapshot]   delete everything this tool created, write the audit
//   node tools/sandbox/vultr-live.mjs status       list the account (ids and labels only)
//
// Only ids recorded in the state file as created by this tool can be deleted. Other resources are never touched.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../../server.mjs';
import { createApprovedVultrAdapterFactory, VULTR_API_ROOT } from '../../backend/vultr-adapter.mjs';
import { loadPersonas, findPersona } from '../../backend/personas.mjs';
import { runScenario } from '../../backend/sandbox/controller.mjs';
import { createSshGuestFetch, sshOptions } from '../../backend/sandbox/ssh-guest-fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECEIPTS = join(root, 'docs', 'desktop-parity', 'sandbox-receipts');
const STATE_FILE = join(RECEIPTS, 'vultr-live-state.json');
const PROGRESS_FILE = join(root, 'docs', 'desktop-parity', 'sandbox-progress.md');
const WORK = join(tmpdir(), 'brz-live').replaceAll('\\', '/');
const KEY_PATH = `${WORK}/id_ed25519`;
const KNOWN_HOSTS = `${WORK}/known_hosts`;
const REGION = 'lhr';
const PLAN = 'vc2-1c-1gb';
const OS_ID = 2284; // Ubuntu 24.04 LTS x64
const VPC_SUBNET = '10.77.0.0';
const VPC_MASK = 24;
const FLAGSHIP = { scenarioId: 'google-docs-oauth-2017', attackKind: 'mass-mail-worm', runId: 'live-google-docs-oauth-2017' };
const PROTECTED_INSTANCE = 'ee56f6c1-60dd-4cb9-b5d9-950afa41bea2'; // the user's "Cyber" instance: never touched
const COLLECTIONS = { instance: 'instances', vpc: 'vpcs', firewall: 'firewalls', 'ssh-key': 'ssh-keys', snapshot: 'snapshots' };
const KEYS = { instance: 'instance', vpc: 'vpc', firewall: 'firewall_group', 'ssh-key': 'ssh_key', snapshot: 'snapshot', 'nat-gateway': 'nat_gateway' };
// A NAT gateway lives under its VPC: /vpcs/<vpc>/nat-gateway/<id>.
const resourcePath = entry => (entry.type === 'nat-gateway' ? `/vpcs/${entry.parentId}/nat-gateway/${entry.id}` : `/${COLLECTIONS[entry.type]}/${entry.id}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { created: [], values: {} });
const saveState = state => { mkdirSync(RECEIPTS, { recursive: true }); writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`); };
const ledger = line => appendFileSync(PROGRESS_FILE, `- ${now()} ${line}\n`);

if (!process.env.VULTR_API_KEY) { console.error('VULTR_API_KEY is not set.'); process.exit(2); }

async function api(method, path, body) {
  if (!/^\/(instances|vpcs|firewalls|ssh-keys|snapshots|plans)(\/[A-Za-z0-9-]+)?(\/rules)?(\?[a-z_=0-9&]+)?$/.test(path) && !/^\/vpcs\/[A-Za-z0-9-]+\/nat-gateway(\/[A-Za-z0-9-]+)?$/.test(path)) throw new Error(`Refused path ${path}`);
  const response = await fetch(`${VULTR_API_ROOT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.VULTR_API_KEY}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!response.ok && !(method === 'GET' && response.status === 404)) {
    throw new Error(`Vultr ${method} ${path.replace(/\/[0-9a-f-]{20,}/, '/<id>')} -> HTTP ${response.status}: ${String(payload?.error ?? text).slice(0, 200)}`);
  }
  return { status: response.status, payload };
}

function track(state, type, id, label, parentId) {
  state.created.push({ type, id, label, ...(parentId ? { parentId } : {}), createdAt: now(), deletedAt: null, deletionConfirmed: false });
  saveState(state);
  ledger(`CREATED ${type} \`${id}\` (${label})`);
}

async function listNatGateways(vpcIds) {
  const gateways = [];
  for (const vpcId of vpcIds) {
    const { payload } = await api('GET', `/vpcs/${vpcId}/nat-gateway`);
    for (const gateway of payload?.nat_gateways ?? []) gateways.push({ id: gateway.id, label: gateway.label ?? null, vpc: vpcId });
  }
  return gateways;
}

async function destroy(state, entry) {
  if (entry.id === PROTECTED_INSTANCE) throw new Error('Refusing to touch the protected instance.');
  if (!state.created.some(item => item.type === entry.type && item.id === entry.id)) throw new Error('Not a resource created by this tool.');
  const path = resourcePath(entry);
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const deleted = await api('DELETE', path);
      if (deleted.status < 300 || deleted.status === 404) break;
    } catch (error) {
      if (attempt === 11) throw error;
      await sleep(10000);
    }
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const check = await api('GET', path);
    const gone = check.status === 404 || ['terminated', 'deleted'].includes(check.payload?.[KEYS[entry.type]]?.status);
    if (gone) {
      entry.deletedAt = now();
      entry.deletionConfirmed = true;
      saveState(state);
      ledger(`DELETED ${entry.type} \`${entry.id}\` (confirmed: GET returns 404)`);
      return true;
    }
    await sleep(3000);
  }
  ledger(`DELETE NOT CONFIRMED ${entry.type} \`${entry.id}\` - manual review required`);
  return false;
}

const ssh = (host, args, { input, timeoutMs = 120000 } = {}) => new Promise(resolve => {
  const child = spawn('ssh', [...sshOptions({ keyPath: KEY_PATH, knownHostsPath: KNOWN_HOSTS }), `root@${host}`, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; if (process.env.BRZ_LIVE_VERBOSE) process.stdout.write(chunk); });
  child.stderr.setEncoding('utf8').on('data', chunk => { out += chunk; if (process.env.BRZ_LIVE_VERBOSE) process.stderr.write(chunk); });
  child.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
  child.stdin.end(input ?? '');
});

// Paths are relative to `cwd`: scp reads "C:" in an absolute Windows path as a remote host name.
const scp = (host, files, target, cwd) => spawnSync('scp', [...sshOptions({ keyPath: KEY_PATH, knownHostsPath: KNOWN_HOSTS }), ...files, `root@${host}:${target}`], { encoding: 'utf8', cwd });

async function waitForInstance(id, { needIp = true } = {}) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const { payload } = await api('GET', `/instances/${id}`);
    const instance = payload?.instance;
    if (instance?.status === 'active' && instance.server_status === 'ok' && (!needIp || (instance.main_ip && instance.main_ip !== '0.0.0.0'))) return instance;
    await sleep(5000);
  }
  throw new Error(`Instance ${id} did not become active.`);
}

async function waitForSsh(host) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await ssh(host, ['true'], { timeoutMs: 20000 })).code === 0) return;
    await sleep(5000);
  }
  throw new Error(`SSH to ${host} did not come up.`);
}

async function createInstance(state, { label, tag, vpc }) {
  const state2 = state;
  const body = {
    region: REGION, plan: PLAN, os_id: OS_ID, label, hostname: label, tags: [tag], enable_ipv6: false, backups: 'disabled',
    activation_email: false, sshkey_id: [state2.values.sshKeyId], firewall_group_id: state2.values.firewallId,
    ...(vpc ? { attach_vpc: [state2.values.vpcId] } : {}),
  };
  const { payload } = await api('POST', '/instances', body);
  const id = payload?.instance?.id;
  if (!id) throw new Error('Instance create returned no id.');
  track(state2, 'instance', id, `${label}, ${PLAN}, ${REGION}, tag ${tag}`);
  return id;
}

const stages = {
  async network() {
    const state = loadState();
    if (state.values.vpcId) throw new Error('network stage already ran.');
    mkdirSync(WORK, { recursive: true });
    if (!existsSync(KEY_PATH)) {
      const keygen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ocean-sandbox-temporary', '-f', KEY_PATH], { encoding: 'utf8' });
      if (keygen.status !== 0) throw new Error('ssh-keygen failed.');
    }
    const publicKey = readFileSync(`${KEY_PATH}.pub`, 'utf8').trim();
    state.values.sshKeyId = (await api('POST', '/ssh-keys', { name: `ocean-sandbox-${Date.now().toString(36)}`, ssh_key: publicKey })).payload.ssh_key.id;
    track(state, 'ssh-key', state.values.sshKeyId, 'temporary key for builder and controller, private half in the OS temp directory');
    state.values.vpcId = (await api('POST', '/vpcs', { region: REGION, description: 'ocean-sandbox-vpc', v4_subnet: VPC_SUBNET, v4_subnet_mask: VPC_MASK })).payload.vpc.id;
    track(state, 'vpc', state.values.vpcId, `ocean-sandbox-vpc ${VPC_SUBNET}/${VPC_MASK} ${REGION}`);
    state.values.firewallId = (await api('POST', '/firewalls', { description: 'ocean-sandbox-fw' })).payload.firewall_group.id;
    track(state, 'firewall', state.values.firewallId, 'ocean-sandbox-fw: inbound tcp/22 from the operator /32 only');
    const myIp = (await (await fetch('https://api.ipify.org')).text()).trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(myIp)) throw new Error('Could not determine the operator address.');
    await api('POST', `/firewalls/${state.values.firewallId}/rules`, { ip_type: 'v4', protocol: 'tcp', subnet: myIp, subnet_size: 32, port: '22', notes: 'operator ssh only' });
    saveState(state);
    console.log('network ready');
  },

  async builder() {
    const state = loadState();
    if (state.values.imageSha256) throw new Error('builder stage already completed.');
    if (!state.values.builderId) {
      state.values.builderId = await createInstance(state, { label: 'ocean-sandbox-builder', tag: 'ocean-sandbox-builder', vpc: false });
      saveState(state);
    }
    const instance = await waitForInstance(state.values.builderId);
    state.values.builderIp = instance.main_ip;
    saveState(state);
    await waitForSsh(instance.main_ip);
    const bundle = `${WORK}/brz-guest-src.tgz`;
    const tar = spawnSync('tar', ['--force-local', '-czf', bundle, '-C', root.replaceAll('\\', '/'), 'backend/guest-agent.mjs', 'backend/oauth-scenario.mjs', 'backend/personas.mjs', 'backend/vultr-adapter.mjs', 'backend/sandbox/kinds.mjs', 'data/personas.json'], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
    await ssh(instance.main_ip, ['mkdir -p /tmp/brz-guest']);
    const copied = [
      scp(instance.main_ip, ['brz-guest-src.tgz'], '/tmp/brz-guest-src.tgz', WORK),
      scp(instance.main_ip, ['deploy/sandbox/guest/nftables.conf', 'deploy/vultr/brz-guest-agent.service', 'deploy/vultr/nftables.service.d/10-brz-early.conf'], '/tmp/brz-guest/', root),
    ];
    if (copied.some(result => result.status !== 0)) throw new Error(`scp failed: ${copied.map(result => result.stderr).join(' ')}`);
    const build = await ssh(instance.main_ip, ['bash -s'], { input: readFileSync(join(root, 'deploy', 'sandbox', 'guest', 'build-guest-image.sh'), 'utf8'), timeoutMs: 900000 });
    writeFileSync(join(RECEIPTS, 'vultr-image-build.log'), build.out.replace(/\r/g, ''));
    const digest = /IMAGE_SHA256=([0-9a-f]{64})/.exec(build.out)?.[1];
    if (build.code !== 0 || !digest) throw new Error(`Image build failed (see sandbox-receipts/vultr-image-build.log, exit ${build.code}).`);
    state.values.imageSha256 = digest;
    saveState(state);
    ledger(`builder ready; image digest ${digest}`);
    console.log(`builder ready, IMAGE_SHA256=${digest}`);
  },

  async snapshot() {
    const state = loadState();
    if (!state.values.imageSha256) throw new Error('Run the builder stage first.');
    if (!state.values.snapshotId) {
      const { payload } = await api('POST', '/snapshots', { instance_id: state.values.builderId, description: 'ocean-sandbox-guest-image' });
      state.values.snapshotId = payload.snapshot.id;
      track(state, 'snapshot', state.values.snapshotId, `guest image, digest ${state.values.imageSha256}`);
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      const { payload } = await api('GET', `/snapshots/${state.values.snapshotId}`).catch(() => ({ payload: { snapshot: {} } })); // a slow poll is retried
      if (payload.snapshot.status === 'complete') break;
      if (attempt === 119) throw new Error('Snapshot did not complete.');
      await sleep(10000);
    }
    state.values.snapshotSize = (await api('GET', `/snapshots/${state.values.snapshotId}`)).payload.snapshot.size;
    saveState(state);
    ledger(`snapshot \`${state.values.snapshotId}\` complete`);
    const builder = state.created.find(item => item.type === 'instance' && item.id === state.values.builderId);
    if (!(await destroy(state, builder))) throw new Error('Builder deletion not confirmed.');
    console.log('snapshot complete, builder deleted');
  },

  async controller() {
    const state = loadState();
    if (!state.values.snapshotId) throw new Error('Run the snapshot stage first.');
    if (state.values.controllerId) throw new Error('controller stage already ran.');
    state.values.controllerId = await createInstance(state, { label: 'ocean-sandbox-controller', tag: 'ocean-sandbox-controller', vpc: true });
    saveState(state);
    let instance;
    for (let attempt = 0; attempt < 60; attempt++) {
      instance = await waitForInstance(state.values.controllerId);
      if (/^10\.77\.0\.\d+$/.test(instance.internal_ip ?? '')) break;
      await sleep(5000);
    }
    if (!/^10\.77\.0\.\d+$/.test(instance.internal_ip ?? '')) throw new Error('Controller has no VPC address.');
    state.values.controllerPublicIp = instance.main_ip;
    state.values.controllerIPv4 = instance.internal_ip;
    saveState(state);
    await waitForSsh(instance.main_ip);
    // The VPC interface must be up: show its address from inside.
    const addresses = await ssh(instance.main_ip, ['ip -4 -o addr show | cut -d" " -f2,7']);
    ledger(`controller ready, VPC address ${instance.internal_ip}; interfaces: ${addresses.out.trim().replace(/\n/g, '; ')}`);
    console.log(`controller ready at VPC address ${instance.internal_ip}`);
  },

  async run() {
    const state = loadState();
    for (const name of ['snapshotId', 'imageSha256', 'vpcId', 'firewallId', 'controllerIPv4', 'controllerPublicIp']) if (!state.values[name]) throw new Error(`State is missing ${name}; run the earlier stages.`);
    const gateEnv = {
      VULTR_API_KEY: process.env.VULTR_API_KEY, VULTR_SANDBOX_MODE: process.env.VULTR_SANDBOX_MODE, VULTR_SANDBOX_APPROVAL: process.env.VULTR_SANDBOX_APPROVAL,
      VULTR_REGION: REGION, VULTR_PLAN_ID: PLAN, VULTR_SNAPSHOT_ID: state.values.snapshotId, VULTR_SNAPSHOT_SHA256: state.values.imageSha256,
      VULTR_VPC_ID: state.values.vpcId, VULTR_VPC_CIDR: `${VPC_SUBNET}/${VPC_MASK}`, VULTR_FIREWALL_GROUP_ID: state.values.firewallId,
      VULTR_CONTROLLER_IPV4: state.values.controllerIPv4, VULTR_MAX_HOURLY_COST_USD: '0.05', VULTR_MAX_RUN_SECONDS: '900', VULTR_PERSONA_ID: 'persona-game-001',
    };
    const personas = loadPersonas();
    const persona = findPersona(personas, gateEnv.VULTR_PERSONA_ID);
    const guestFetch = createSshGuestFetch({ controllerHost: state.values.controllerPublicIp, keyPath: KEY_PATH, knownHostsPath: KNOWN_HOSTS });
    const adapter = createApprovedVultrAdapterFactory({
      env: gateEnv, oauthApp: personas.oauth_app, guestFetch,
      adapterOptions: { pollAttempts: 180, pollDelayMs: 4000, deletePollAttempts: 40 },
    })();

    // The local server only receives world events here; it must not build its own Vultr adapter from the process env.
    const server = createAppServer({ adapterFactory: () => { throw new Error("This event server never starts a scenario."); } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    ledger(`run starting: ${FLAGSHIP.scenarioId} (${FLAGSHIP.attackKind}), one gated guest from snapshot ${state.values.snapshotId}`);
    // The adapter creates the guest; record its id as soon as the instance exists by watching the account.
    const watcher = setInterval(async () => {
      try {
        const { payload } = await api('GET', '/instances?per_page=50');
        for (const instance of payload?.instances ?? []) {
          if (Array.isArray(instance.tags) && instance.tags.includes('blast-radius-zero') && !state.created.some(item => item.id === instance.id)) {
            track(state, 'instance', instance.id, `guest, ${PLAN}, ${REGION}, created by VultrComputeAdapter, tags ${instance.tags.join('/')}`);
          }
        }
      } catch { /* the next tick retries */ }
    }, 4000);
    let result;
    try {
      result = await runScenario({ ...FLAGSHIP, mode: 'vultr', baseUrl, vultr: { adapter, persona }, paceMs: 150, env: gateEnv });
    } finally {
      clearInterval(watcher);
    }
    await new Promise(resolve => server.close(resolve));
    const guest = state.created.find(item => item.type === 'instance' && item.id === result.receipt.instance);
    const verification = { guestInstanceId: result.receipt.instance, guestGetStatus: null, taggedInstancesRemaining: null };
    if (/^[0-9a-f-]{36}$/.test(result.receipt.instance)) verification.guestGetStatus = (await api('GET', `/instances/${result.receipt.instance}`)).status;
    verification.taggedInstancesRemaining = ((await api('GET', '/instances?per_page=50')).payload.instances ?? []).filter(instance => (instance.tags ?? []).includes('blast-radius-zero')).map(instance => instance.id);
    if (guest && verification.guestGetStatus === 404) {
      guest.deletedAt = now();
      guest.deletionConfirmed = true;
      saveState(state);
      ledger(`DELETED instance \`${guest.id}\` (guest, confirmed by adapter and GET 404)`);
    }
    const { publish, ...saved } = result;
    writeFileSync(join(RECEIPTS, `vultr-${FLAGSHIP.scenarioId}.json`), `${JSON.stringify({
      ...saved,
      publish: { posted: publish.posted, failures: publish.failures },
      flagship: { scenario: FLAGSHIP.scenarioId, attackKind: FLAGSHIP.attackKind, choice: 'network-abuse x abyss; content attackKind is mass-mail-worm' },
      region: REGION, plan: PLAN, vpc: `${VPC_SUBNET}/${VPC_MASK}`, privateOnly: true, imageSha256: state.values.imageSha256, snapshotId: state.values.snapshotId,
      independentVerification: verification, savedAt: now(),
    }, null, 2)}\n`);
    ledger(`run finished: ok=${result.ok} status=${result.status} teardownConfirmed=${result.receipt.teardownConfirmed} error=${result.error ?? 'none'}`);
    console.log(JSON.stringify({ ok: result.ok, status: result.status, error: result.error, receipt: result.receipt, verification }, null, 2));
    process.exit(result.ok ? 0 : 1);
  },

  async teardown() {
    const state = loadState();
    const keepSnapshot = !process.argv.includes('--delete-snapshot');
    const order = ['instance', 'nat-gateway', 'vpc', 'firewall', 'ssh-key'];
    if (!keepSnapshot) order.push('snapshot');
    const failures = [];
    for (const type of order) {
      for (const entry of state.created.filter(item => item.type === type && !item.deletionConfirmed)) {
        if (!(await destroy(state, entry))) failures.push(`${type} ${entry.id}`);
      }
    }
    const account = {};
    for (const type of Object.keys(COLLECTIONS)) {
      const { payload } = await api('GET', `/${COLLECTIONS[type]}?per_page=50`);
      account[type] = (payload?.[Object.keys(payload ?? {}).find(key => Array.isArray(payload[key]))] ?? []).map(item => ({ id: item.id, label: item.label ?? item.description ?? item.name ?? null }));
    }
    account['nat-gateway'] = await listNatGateways(account.vpc.map(vpc => vpc.id));
    writeFileSync(join(RECEIPTS, 'vultr-teardown-audit.json'), `${JSON.stringify({
      generatedAt: now(),
      protectedPreexistingInstance: { id: PROTECTED_INSTANCE, label: 'Cyber', touched: false },
      resources: state.created,
      snapshotKept: keepSnapshot && state.created.some(item => item.type === 'snapshot' && !item.deletionConfirmed),
      allDeletionsConfirmed: failures.length === 0,
      unconfirmed: failures,
      accountAfterTeardown: account,
    }, null, 2)}\n`);
    console.log(failures.length ? `TEARDOWN INCOMPLETE: ${failures.join(', ')}` : 'teardown confirmed');
    process.exit(failures.length ? 1 : 0);
  },

  async retire() {
    const id = process.argv[3];
    const state = loadState();
    const entry = state.created.find(item => item.id === id && !item.deletionConfirmed);
    if (!entry) throw new Error('No unconfirmed resource with that id was created by this tool.');
    if (!(await destroy(state, entry))) throw new Error('Deletion not confirmed.');
    console.log(`${entry.type} ${id} deleted and confirmed`);
  },

  async status() {
    let vpcIds = [];
    for (const type of Object.keys(COLLECTIONS)) {
      const { payload } = await api('GET', `/${COLLECTIONS[type]}?per_page=50`);
      const list = payload?.[Object.keys(payload ?? {}).find(key => Array.isArray(payload[key]))] ?? [];
      if (type === 'vpc') vpcIds = list.map(item => item.id);
      console.log(type, list.map(item => `${item.id}:${item.label ?? item.description ?? item.name ?? ''}:${item.status ?? ''}`));
    }
    console.log('nat-gateway', (await listNatGateways(vpcIds)).map(item => `${item.id}:${item.label ?? ''}`));
  },
};

const stage = process.argv[2];
if (!stages[stage]) { console.error(`Usage: vultr-live.mjs ${Object.keys(stages).join('|')}`); process.exit(2); }
try {
  await stages[stage]();
} catch (error) {
  ledger(`stage ${stage} failed: ${error.message}`);
  console.error(`stage ${stage} failed: ${error.message}`); if (process.env.BRZ_LIVE_VERBOSE) console.error(error.stack);
  process.exit(1);
}
