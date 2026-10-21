import { randomBytes } from 'node:crypto';
import { validatePersonaManifest } from './personas.mjs';

export const VULTR_API_ROOT = 'https://api.vultr.com/v2';
export const VULTR_APPROVAL_PHRASE = 'I_APPROVE_ONE_BILLABLE_VULTR_INSTANCE';
export const MAX_HOURLY_COST_USD = 0.05;
// Snapshot-restored guests take several minutes to unlock, so the lifetime cap covers boot as well as the run.
export const MAX_RUN_SECONDS = 900;
export const EGRESS_POLICY_VERSION = 'brz-drop-except-private-controller-v1';
export const GUEST_AGENT_VERSION = 'synthetic-oauth-v1';
const GUEST_PORT = 4174;
const TEARDOWN_RETRIES = 5;
const TEARDOWN_RETRY_MS = 10_000;

export class VultrApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'VultrApiError';
    this.status = status;
  }
}

function ipv4ToNumber(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
}

export function isPrivateIPv4(address) {
  const value = ipv4ToNumber(address);
  if (value === null) return false;
  const first = value >>> 24;
  const second = (value >>> 16) & 255;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function isIPv4InCidr(address, cidr) {
  const [network, prefixText, ...extra] = String(cidr).split('/');
  const ipValue = ipv4ToNumber(address);
  const networkValue = ipv4ToNumber(network);
  const prefix = Number(prefixText);
  if (ipValue === null || networkValue === null || extra.length || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipValue & mask) === (networkValue & mask);
}

function validIdentifier(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid Vultr ${label}.`);
}

export function validateVultrConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Vultr adapter configuration is required.');
  validIdentifier(config.region, /^[a-z0-9-]{2,20}$/, 'region');
  validIdentifier(config.planId, /^vc2-[a-z0-9.-]{2,40}$/, 'Cloud Compute plan');
  validIdentifier(config.snapshotId, /^[a-zA-Z0-9-]{6,80}$/, 'reviewed snapshot id');
  validIdentifier(config.vpcId, /^[a-zA-Z0-9-]{6,80}$/, 'VPC id');
  validIdentifier(config.firewallGroupId, /^[a-zA-Z0-9-]{6,80}$/, 'firewall group id');
  if (!/^[a-f0-9]{64}$/i.test(config.snapshotSha256 || '')) throw new Error('A pinned snapshot SHA-256 is required.');
  if (!isPrivateIPv4(config.controllerIPv4) || !isIPv4InCidr(config.controllerIPv4, config.vpcCidr)) {
    throw new Error('Controller must be an RFC1918 address inside the configured VPC CIDR.');
  }
  const [cidrNetwork, prefixText] = String(config.vpcCidr).split('/');
  const prefix = Number(prefixText);
  const networkValue = ipv4ToNumber(cidrNetwork);
  const controllerValue = ipv4ToNumber(config.controllerIPv4);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const hostMask = (~mask) >>> 0;
  const hostValue = controllerValue & hostMask;
  if (!isPrivateIPv4(cidrNetwork) || !Number.isInteger(prefix) || prefix < 16 || prefix > 30 ||
      ((networkValue & mask) >>> 0) !== networkValue || hostValue === 0 || hostValue === hostMask) {
    throw new Error('VPC CIDR and controller address must be canonical RFC1918 IPv4 values (/16 through /30).');
  }
  if (!Number.isFinite(config.maxHourlyCostUsd) || config.maxHourlyCostUsd <= 0 || config.maxHourlyCostUsd > MAX_HOURLY_COST_USD) {
    throw new Error(`Hourly price cap must be greater than zero and no more than $${MAX_HOURLY_COST_USD.toFixed(2)}.`);
  }
  if (!Number.isInteger(config.maxRunSeconds) || config.maxRunSeconds < 10 || config.maxRunSeconds > MAX_RUN_SECONDS) {
    throw new Error(`Run lifetime must be 10–${MAX_RUN_SECONDS} seconds.`);
  }
  if (config.egressPolicy !== EGRESS_POLICY_VERSION) throw new Error('A reviewed default-deny egress profile is required.');
  if (!config.oauthApp || !Array.isArray(config.oauthApp.requested_scopes) || !config.oauthApp.requested_scopes.length) {
    throw new Error('Synthetic OAuth app configuration is required.');
  }
  validIdentifier(config.personaId, /^[a-zA-Z0-9-]{1,80}$/, 'synthetic persona id');
  return config;
}

function makeUserData({ runId, persona, oauthApp, controllerIPv4, controllerPort, snapshotSha256, controlToken }) {
  const config = {
    version: 1,
    runId,
    scenarioId: 'oauth-2023',
    persona,
    oauthApp,
    controllerIPv4,
    controllerPort,
    snapshotSha256,
    egressPolicy: EGRESS_POLICY_VERSION,
    guestAgentVersion: GUEST_AGENT_VERSION,
    controlToken,
  };
  const encodedConfig = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  const cloudConfig = [
    '#cloud-config',
    'write_files:',
    '  - path: /etc/blast-radius/run.json',
    '    owner: root:root',
    "    permissions: '0600'",
    '    encoding: b64',
    `    content: ${encodedConfig}`,
    'runcmd:',
    '  - [nft, flush, chain, inet, brz, input]',
    '  - [nft, add, rule, inet, brz, input, iifname, lo, accept]',
    '  - [nft, add, rule, inet, brz, input, ct, state, established, related, accept]',
    `  - [nft, add, rule, inet, brz, input, ip, saddr, ${controllerIPv4}, tcp, dport, '${controllerPort}', accept]`,
    '  - [nft, flush, chain, inet, brz, output]',
    '  - [nft, add, rule, inet, brz, output, oifname, lo, accept]',
    '  - [nft, add, rule, inet, brz, output, ct, state, established, related, accept]',
    `  - [nft, add, rule, inet, brz, output, ip, daddr, ${controllerIPv4}, tcp, dport, '${controllerPort}', accept]`,
    '  - [systemctl, restart, brz-guest-agent.service]',
    '',
  ].join('\n');
  return Buffer.from(cloudConfig, 'utf8').toString('base64');
}

export function buildVultrCreatePayload(config, { runId, persona, controlToken }) {
  validateVultrConfig(config);
  validIdentifier(runId, /^[a-zA-Z0-9-]{1,50}$/, 'run id');
  validatePersonaManifest({ schema_version: 1, oauth_app: config.oauthApp, personas: [persona] });
  if (persona.id !== config.personaId || !persona.mailbox.messages.length) throw new Error('Only the configured synthetic persona with a mailbox can be provisioned.')
  if (typeof controlToken !== 'string' || controlToken.length < 32) throw new Error('Synthetic guest control token is missing.');

  const tag = `brz-run-${runId}`;
  const userData = makeUserData({
    runId,
    persona,
    oauthApp: config.oauthApp,
    controllerIPv4: config.controllerIPv4,
    controllerPort: GUEST_PORT,
    snapshotSha256: config.snapshotSha256.toLowerCase(),
    controlToken,
  });
  if (Buffer.byteLength(userData, 'utf8') > 24000) throw new Error('Cloud-init data exceeds the local safety limit.');
  return {
    region: config.region,
    plan: config.planId,
    snapshot_id: config.snapshotId,
    label: `brz-${runId}`,
    hostname: `brz-${runId}`,
    tags: [tag, 'blast-radius-zero', 'ephemeral-synthetic'],
    attach_vpc: [config.vpcId],
    vpc_only: true,
    enable_ipv6: false,
    firewall_group_id: config.firewallGroupId,
    backups: 'disabled',
    activation_email: false,
    block_devices: [],
    user_data: userData,
  };
}

export class VultrRestClient {
  constructor({ apiKey, fetchImpl, timeoutMs = 10000 } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('VULTR_API_KEY is required for the gated Vultr adapter.');
    if (typeof fetchImpl !== 'function') throw new Error('An explicit fetch implementation is required.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('Invalid Vultr API timeout.');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #request(path, { method = 'GET', body } = {}) {
    const url = new URL(`${VULTR_API_ROOT}${path.startsWith('/') ? path : `/${path}`}`);
    if (url.origin !== new URL(VULTR_API_ROOT).origin || !url.pathname.startsWith('/v2/')) throw new Error('Vultr API path rejected.');
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new VultrApiError('Vultr API request failed or timed out.');
    }
    if (response.status === 204) return null;
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = typeof payload?.error === 'string' ? ` ${payload.error.replace(/[^\x20-\x7e]/g, '').slice(0, 160)}` : '';
      throw new VultrApiError(`Vultr API returned HTTP ${response.status}.${detail}`, response.status);
    }
    return payload;
  }

  async getPlan(planId) {
    const payload = await this.#request('/plans?type=vc2&per_page=500');
    if (payload?.meta?.links?.next) throw new Error('Plan list is paginated; refusing unverified pricing.');
    return payload?.plans?.find(plan => plan.id === planId) ?? null;
  }

  async createInstance(payload) {
    const response = await this.#request('/instances', { method: 'POST', body: payload });
    return response?.instance ?? null;
  }

  async getInstance(instanceId) {
    const response = await this.#request(`/instances/${encodeURIComponent(instanceId)}`);
    return response?.instance ?? null;
  }

  async getInstanceVpcs(instanceId) {
    const response = await this.#request(`/instances/${encodeURIComponent(instanceId)}/vpcs`);
    return response?.vpcs ?? [];
  }

  async deleteInstance(instanceId) {
    return this.#request(`/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });
  }

  async findInstancesByTag(tag) {
    const response = await this.#request('/instances?per_page=500');
    if (response?.meta?.links?.next) throw new Error('Instance list is paginated; ambiguous-create cleanup cannot be verified.');
    return (response?.instances ?? []).filter(instance => Array.isArray(instance.tags) && instance.tags.includes(tag));
  }
}

export class PrivateGuestTransport {
  constructor({ fetchImpl, timeoutMs = 5000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('An explicit private guest fetch implementation is required.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 20000) throw new Error('Invalid private guest timeout.');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #request(ip, controlToken, path, body) {
    if (!isPrivateIPv4(ip)) throw new Error('Guest target must be an RFC1918 IPv4 address.');
    if (typeof controlToken !== 'string' || controlToken.length < 32) throw new Error('Guest control token is missing.');
    if (!['/internal/attestation', '/internal/idp/issue', '/internal/mailbox/read', '/internal/teardown', '/internal/sandbox/run'].includes(path)) {
      throw new Error('Private guest route rejected.');
    }
    let response;
    try {
      response = await this.fetchImpl(`http://${ip}:4174${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${controlToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error('Private guest request failed or timed out.');
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !payload) throw new Error(`Private guest returned HTTP ${response.status}.`);
    return payload;
  }

  attest({ privateIPv4, controlToken, runId }) {
    return this.#request(privateIPv4, controlToken, '/internal/attestation', { runId });
  }

  issueToken({ privateIPv4, controlToken, runId, personaId, scopes }) {
    return this.#request(privateIPv4, controlToken, '/internal/idp/issue', { runId, personaId, scopes });
  }

  readMailbox({ privateIPv4, controlToken, runId, personaId, token }) {
    return this.#request(privateIPv4, controlToken, '/internal/mailbox/read', { runId, personaId, token });
  }

  teardown({ privateIPv4, controlToken, runId }) {
    return this.#request(privateIPv4, controlToken, '/internal/teardown', { runId });
  }

  // Synthetic attack runner (backend/sandbox/kinds.mjs) hosted by the guest agent.
  runSynthetic({ privateIPv4, controlToken, runId, attackKind, seed }) {
    return this.#request(privateIPv4, controlToken, '/internal/sandbox/run', { runId, attackKind, seed });
  }
}

// A VPC-only instance reports its RFC1918 VPC address as main_ip; that is not a public address.
function isPublicAddress(value) {
  return typeof value === 'string' && value !== '' && value !== '0.0.0.0' && value !== '::' && !isPrivateIPv4(value);
}

function assertPlanWithinCaps(plan, config) {
  if (!plan || plan.id !== config.planId || plan.type !== 'vc2') throw new Error('Cloud Compute plan could not be verified.');
  if (!Array.isArray(plan.locations) || !plan.locations.includes(config.region)) throw new Error('Plan is not confirmed available in the selected region.');
  const hourlyCost = Number(plan.hourly_cost);
  if (!Number.isFinite(hourlyCost) || hourlyCost <= 0 || hourlyCost > config.maxHourlyCostUsd || hourlyCost > MAX_HOURLY_COST_USD) {
    throw new Error('Plan hourly price is missing or exceeds the approved cap.');
  }
}

function isNotFound(error) {
  return error instanceof VultrApiError && error.status === 404;
}

export class VultrComputeAdapter {
  constructor({
    api,
    guestTransport,
    config,
    gate,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    schedule = setTimeout,
    cancel = clearTimeout,
    pollAttempts = 30,
    deletePollAttempts = 6,
    pollDelayMs = 1000,
    tokenFactory = () => `ctl_${randomBytes(32).toString('base64url')}`,
  } = {}) {
    for (const method of ['getPlan', 'createInstance', 'getInstance', 'getInstanceVpcs', 'deleteInstance', 'findInstancesByTag']) {
      if (typeof api?.[method] !== 'function') throw new Error(`Vultr API client is missing ${method}().`);
    }
    for (const method of ['attest', 'issueToken', 'readMailbox', 'teardown']) {
      if (typeof guestTransport?.[method] !== 'function') throw new Error(`Private guest transport is missing ${method}().`);
    }
    if (!Number.isInteger(pollAttempts) || pollAttempts < 1 || pollAttempts > 200 ||
        !Number.isInteger(deletePollAttempts) || deletePollAttempts < 1 || deletePollAttempts > 60 ||
        !Number.isInteger(pollDelayMs) || pollDelayMs < 0 || pollDelayMs > 5000) {
      throw new Error('Vultr polling limits are invalid.');
    }
    this.api = api;
    this.guestTransport = guestTransport;
    this.config = validateVultrConfig(config);
    this.gate = gate;
    this.sleep = sleep;
    this.schedule = schedule;
    this.cancel = cancel;
    this.pollAttempts = pollAttempts;
    this.deletePollAttempts = deletePollAttempts;
    this.pollDelayMs = pollDelayMs;
    this.tokenFactory = tokenFactory;
    this.activeSandbox = null;
  }

  // Vultr answers 409 while an instance is still locked (provisioning); keep retrying within the delete poll budget.
  async #deleteInstance(instanceId) {
    let failures = 0;
    for (let locked = 0; ; ) {
      try {
        await this.api.deleteInstance(instanceId);
        return;
      } catch (error) {
        if (isNotFound(error)) return;
        if (error?.status === 409 && locked++ < this.deletePollAttempts) {
          await this.sleep(Math.max(this.pollDelayMs, 1) * 5);
          continue;
        }
        if (++failures >= 2) throw error;
      }
    }
  }

  #assertGate() {
    if (this.gate?.enabled !== true || this.gate?.phrase !== VULTR_APPROVAL_PHRASE) {
      throw new Error('Vultr provisioning is disabled; explicit approval and the live gate are required.');
    }
  }

  async #cleanupByTag(tag, originalError) {
    const matches = await this.api.findInstancesByTag(tag);
    for (const instance of matches) {
      if (typeof instance.id !== 'string' || !instance.id) throw new Error('Unidentified tagged instance; manual Vultr cleanup required.');
      await this.#deleteInstance(instance.id);
      let gone = false;
      for (let attempt = 0; attempt < this.deletePollAttempts; attempt++) {
        try {
          const current = await this.api.getInstance(instance.id);
          if (!current || ['terminated', 'deleted'].includes(current.status)) { gone = true; break; }
        } catch (error) {
          if (isNotFound(error)) { gone = true; break; }
          throw error;
        }
        await this.sleep(this.pollDelayMs);
      }
      if (!gone) throw new Error(`Vultr instance ${instance.id} deletion was not confirmed.`);
    }
    if (originalError && matches.length) originalError.cleanupConfirmed = true;
    return matches.map(instance => instance.id);
  }

  async createSandbox({ runId, persona }) {
    try {
      this.#assertGate();
      if (this.activeSandbox) throw new Error('Only one Vultr sandbox may be active per adapter.');
      validIdentifier(runId, /^[a-zA-Z0-9-]{1,50}$/, 'run id');
      validatePersonaManifest({ schema_version: 1, oauth_app: this.config.oauthApp, personas: [persona] });
    if (persona.id !== this.config.personaId || !persona.mailbox.messages.length) throw new Error('Only the configured synthetic persona with a mailbox may be provisioned.');
      const plan = await this.api.getPlan(this.config.planId);
      assertPlanWithinCaps(plan, this.config);
      const existing = await this.api.findInstancesByTag('blast-radius-zero');
      if (existing.length) throw new Error('A Blast Radius Zero Vultr instance already exists; refusing a second billable resource.');
    } catch (error) {
      error.resourceNotCreated = true;
      throw error;
    }

    const tag = `brz-run-${runId}`;
    const controlToken = await this.tokenFactory();
    const payload = buildVultrCreatePayload(this.config, { runId, persona, controlToken });
    let instance;
    try {
      instance = await this.api.createInstance(payload);
    } catch (error) {
      try {
        const removed = await this.#cleanupByTag(tag, error);
        if (removed.length) error.sandboxId = removed[0];
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Vultr create outcome is uncertain; cleanup could not be confirmed.');
      }
      throw error;
    }
    if (!instance?.id) {
      const error = new Error('Vultr create response did not include an instance id.');
      try {
        const removed = await this.#cleanupByTag(tag, error);
        if (removed.length) error.sandboxId = removed[0];
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Vultr create response was ambiguous; cleanup could not be confirmed.');
      }
      if (error.cleanupConfirmed !== true) error.message = 'Vultr create response was ambiguous; no matching tagged instance was confirmed for teardown.';
      throw error;
    }

    const sandbox = {
      id: instance.id,
      runId,
      tag,
      privateIPv4: null,
      controlToken,
      active: true,
      destroyed: false,
      destroyPromise: null,
      watchdog: null,
      teardownError: null,
      deadline: Date.now() + this.config.maxRunSeconds * 1000,
    };
    this.activeSandbox = sandbox;
    sandbox.teardownRetries = 0;
    const expire = async () => {
      try {
        await this.destroySandbox(sandbox);
      } catch (error) {
        sandbox.teardownError = error;
        if (sandbox.teardownRetries++ < TEARDOWN_RETRIES) sandbox.watchdog = this.schedule(expire, TEARDOWN_RETRY_MS);
        else console.error(`Vultr teardown remains unconfirmed for tag ${sandbox.tag}; manual account review required.`);
      }
    };
    sandbox.watchdog = this.schedule(expire, this.config.maxRunSeconds * 1000);

    try {
      await this.#waitForReady(sandbox);
      return sandbox;
    } catch (error) {
      try {
        await this.destroySandbox(sandbox);
        error.cleanupConfirmed = true;
        error.sandboxId = sandbox.id;
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Vultr instance ${sandbox.id} failed preflight and teardown was not confirmed.`);
      }
      throw error;
    }
  }

  async #waitForReady(sandbox) {
    for (let attempt = 0; attempt < this.pollAttempts; attempt++) {
      const instance = await this.api.getInstance(sandbox.id);
      if (!instance) throw new Error('Vultr instance disappeared during startup.');
      if (['failed', 'stopped', 'terminated', 'deleted'].includes(instance.status)) throw new Error('Vultr instance entered a failed state.');
      if (instance.status === 'active' && instance.server_status === 'ok') {
        if (instance.region !== this.config.region || instance.plan !== this.config.planId || instance.snapshot_id !== this.config.snapshotId) {
          throw new Error('Vultr instance region, plan or snapshot does not match the approved configuration.');
        }
        // Vultr may omit vpc_only on GET; then the main address must be the instance's own VPC address.
        const vpcOnly = instance.vpc_only === true || (instance.vpc_only === undefined && isPrivateIPv4(instance.main_ip) && instance.main_ip === instance.internal_ip);
        if (!vpcOnly || isPublicAddress(instance.main_ip) || isPublicAddress(instance.v6_main_ip)) {
          throw new Error('Vultr instance is not confirmed private-only.');
        }
        if (!isPrivateIPv4(instance.internal_ip) || !isIPv4InCidr(instance.internal_ip, this.config.vpcCidr)) {
          throw new Error('Vultr instance has no verified private VPC address.');
        }
        const vpcs = await this.api.getInstanceVpcs(sandbox.id);
        const attachment = vpcs.find(vpc => vpc.id === this.config.vpcId);
        if (!attachment || attachment.ip_address !== instance.internal_ip || !isIPv4InCidr(attachment.ip_address, this.config.vpcCidr)) {
          throw new Error('Vultr instance is not attached to the approved VPC.');
        }
        sandbox.privateIPv4 = instance.internal_ip;
        let attestation;
        try {
          attestation = await this.guestTransport.attest({
            privateIPv4: sandbox.privateIPv4,
            controlToken: sandbox.controlToken,
            runId: sandbox.runId,
          });
        } catch (error) {
          // The guest agent starts after the instance reports ok; an unreachable agent is retried within the poll window.
          if (!/^Private guest (request failed|returned HTTP 5)/.test(error.message)) throw error;
          await this.sleep(this.pollDelayMs);
          continue;
        }
        if (attestation?.snapshotSha256?.toLowerCase() !== this.config.snapshotSha256.toLowerCase() ||
            attestation?.egressPolicy !== EGRESS_POLICY_VERSION ||
            attestation?.guestAgentVersion !== GUEST_AGENT_VERSION ||
            attestation?.publicEgress !== false ||
            JSON.stringify(attestation?.allowedEgress) !== JSON.stringify([`${this.config.controllerIPv4}/32`])) {
          throw new Error('Guest image or default-deny egress attestation failed.');
        }
        sandbox.attestation = attestation;
        return;
      }
      await this.sleep(this.pollDelayMs);
    }
    throw new Error('Vultr instance did not become ready within the bounded poll window.');
  }

  async #assertActive(sandbox) {
    if (sandbox !== this.activeSandbox || !sandbox?.active || sandbox.destroyed) throw new Error('Vultr sandbox is not active.');
    if (Date.now() >= sandbox.deadline) {
      await this.destroySandbox(sandbox);
      throw new Error('Vultr sandbox lifetime limit reached; teardown attempted.');
    }
  }

  async issueToken(sandbox, { personaId, scopes }) {
    await this.#assertActive(sandbox);
    if (personaId !== this.config.personaId || !Array.isArray(scopes) ||
        scopes.length !== this.config.oauthApp.requested_scopes.length ||
        scopes.some(scope => !this.config.oauthApp.requested_scopes.includes(scope))) {
      throw new Error('Vultr guest token request rejected.');
    }
    const result = await this.guestTransport.issueToken({
      privateIPv4: sandbox.privateIPv4,
      controlToken: sandbox.controlToken,
      runId: sandbox.runId,
      personaId,
      scopes,
    });
    if (typeof result?.value !== 'string' || !result.value.startsWith('syn_') ||
        typeof result.handle !== 'string' || !Array.isArray(result.scopes) ||
        JSON.stringify(result.scopes) !== JSON.stringify(scopes)) {
      throw new Error('Vultr guest returned an invalid synthetic token grant.');
    }
    return result;
  }

  // Run one synthetic attack kind on the guest. Returns {events, evidence}; the guest must report no egress.
  async runSyntheticAttack(sandbox, { attackKind, seed }) {
    await this.#assertActive(sandbox);
    if (typeof this.guestTransport.runSynthetic !== 'function') throw new Error('Private guest transport cannot run synthetic attacks.');
    const result = await this.guestTransport.runSynthetic({
      privateIPv4: sandbox.privateIPv4,
      controlToken: sandbox.controlToken,
      runId: sandbox.runId,
      attackKind,
      seed,
    });
    if (!Array.isArray(result?.events) || !result.events.length || result.events.length > 62 || !result.evidence || typeof result.evidence !== 'object') {
      throw new Error('Vultr guest returned an invalid synthetic run.');
    }
    return { events: result.events, evidence: result.evidence };
  }

  async readMailbox(sandbox, { token, personaId }) {
    await this.#assertActive(sandbox);
    if (personaId !== this.config.personaId || typeof token !== 'string' || !token.startsWith('syn_')) {
      throw new Error('Vultr guest mailbox request rejected.');
    }
    const result = await this.guestTransport.readMailbox({
      privateIPv4: sandbox.privateIPv4,
      controlToken: sandbox.controlToken,
      runId: sandbox.runId,
      personaId,
      token,
    });
    if (!Array.isArray(result?.messages) || result.messages.length > 50 || result.messages.some(message =>
      !message || typeof message.id !== 'string' || typeof message.subject !== 'string' ||
      typeof message.sender !== 'string' || !message.sender.toLowerCase().endsWith('.invalid'))) {
      throw new Error('Vultr guest returned non-synthetic mailbox data.');
    }
    return result.messages;
  }

  async destroySandbox(sandbox) {
    if (!sandbox) return;
    if (sandbox.destroyed) return;
    if (sandbox.destroyPromise) return sandbox.destroyPromise;
    sandbox.destroyPromise = this.#destroySandbox(sandbox).catch(error => {
      sandbox.destroyPromise = null;
      throw error;
    });
    return sandbox.destroyPromise;
  }

  async #destroySandbox(sandbox) {
    try {
      if (sandbox.privateIPv4 && sandbox.controlToken) {
        await this.guestTransport.teardown({
          privateIPv4: sandbox.privateIPv4,
          controlToken: sandbox.controlToken,
          runId: sandbox.runId,
        }).catch(() => {});
      }
      await this.#deleteInstance(sandbox.id);
      let gone = false;
      for (let attempt = 0; attempt < this.deletePollAttempts; attempt++) {
        try {
          const current = await this.api.getInstance(sandbox.id);
          if (!current || ['terminated', 'deleted'].includes(current.status)) { gone = true; break; }
        } catch (error) {
          if (isNotFound(error)) { gone = true; break; }
          throw error;
        }
        await this.sleep(this.pollDelayMs);
      }
      if (!gone) throw new Error(`Vultr instance ${sandbox.id} deletion was not confirmed.`);
      sandbox.destroyed = true;
      sandbox.active = false;
      sandbox.controlToken = '';
      this.cancel(sandbox.watchdog);
      if (this.activeSandbox === sandbox) this.activeSandbox = null;
    } catch {
      throw new Error('Vultr teardown failed; instance may still be billable and requires manual account review.');
    }
  }
}

// `guestFetch` replaces the transport's fetch (for example a relay through the in-VPC controller host);
// `adapterOptions` passes polling limits to VultrComputeAdapter. Every gate below still applies.
export function createApprovedVultrAdapterFactory({ env = process.env, oauthApp, guestFetch = globalThis.fetch, adapterOptions = {} } = {}) {
  if (env.VULTR_SANDBOX_MODE !== 'vultr' || env.VULTR_SANDBOX_APPROVAL !== VULTR_APPROVAL_PHRASE) {
    throw new Error('Vultr live mode requires VULTR_SANDBOX_MODE=vultr and explicit approval phrase.');
  }
  if (typeof env.VULTR_API_KEY !== 'string' || !env.VULTR_API_KEY) throw new Error('VULTR_API_KEY is required for Vultr live mode.');
  const config = validateVultrConfig({
    region: env.VULTR_REGION,
    planId: env.VULTR_PLAN_ID,
    snapshotId: env.VULTR_SNAPSHOT_ID,
    snapshotSha256: env.VULTR_SNAPSHOT_SHA256,
    vpcId: env.VULTR_VPC_ID,
    vpcCidr: env.VULTR_VPC_CIDR,
    firewallGroupId: env.VULTR_FIREWALL_GROUP_ID,
    controllerIPv4: env.VULTR_CONTROLLER_IPV4,
    maxHourlyCostUsd: Number(env.VULTR_MAX_HOURLY_COST_USD),
    maxRunSeconds: Number(env.VULTR_MAX_RUN_SECONDS),
    egressPolicy: EGRESS_POLICY_VERSION,
    oauthApp,
    personaId: env.VULTR_PERSONA_ID,
  });
  const api = new VultrRestClient({ apiKey: env.VULTR_API_KEY, fetchImpl: globalThis.fetch });
  const guestTransport = new PrivateGuestTransport({ fetchImpl: guestFetch, ...(guestFetch === globalThis.fetch ? {} : { timeoutMs: 20000 }) });
  const gate = { enabled: true, phrase: env.VULTR_SANDBOX_APPROVAL };
  return () => new VultrComputeAdapter({ api, guestTransport, config, gate, ...adapterOptions });
}
