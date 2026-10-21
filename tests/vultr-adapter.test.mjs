import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthPlan, executeOAuthScenario } from '../backend/oauth-scenario.mjs';
import {
  EGRESS_POLICY_VERSION,
  GUEST_AGENT_VERSION,
  MAX_HOURLY_COST_USD,
  VULTR_APPROVAL_PHRASE,
  VultrApiError,
  VultrComputeAdapter,
  VultrRestClient,
  PrivateGuestTransport,
  buildVultrCreatePayload,
  createApprovedVultrAdapterFactory,
  isIPv4InCidr,
  isPrivateIPv4,
  validateVultrConfig,
} from '../backend/vultr-adapter.mjs';
import { loadPersonas } from '../backend/personas.mjs';

const personas = loadPersonas();
const persona = personas.personas[0];
const config = {
  region: 'ewr',
  planId: 'vc2-1c-1gb',
  snapshotId: 'snapshot-123456',
  snapshotSha256: 'a'.repeat(64),
  vpcId: 'vpc-123456',
  vpcCidr: '10.10.0.0/24',
  firewallGroupId: 'firewall-123456',
  controllerIPv4: '10.10.0.2',
  maxHourlyCostUsd: 0.05,
  maxRunSeconds: 60,
  egressPolicy: EGRESS_POLICY_VERSION,
  oauthApp: personas.oauth_app,
  personaId: persona.id,
};
const instance = {
  id: 'instance-123456', status: 'active', server_status: 'ok', vpc_only: true,
  region: config.region, plan: config.planId, main_ip: '0.0.0.0', v6_main_ip: '',
  internal_ip: '10.10.0.20', snapshot_id: config.snapshotId,
};
const planId = createOAuthPlan({ attackId: 'oauth-2023', personaId: persona.id }, personas).planId;

function fakeCloud({ price = 0.01, attestation = {}, failCreate = false, failDelete = false, failDeleteCount = 0, existingProject = false, publicAddress = false } = {}) {
  const calls = { plans: 0, creates: [], gets: 0, vpcs: 0, deletes: [], tags: [], attest: [], issues: [], reads: [], guestDeletes: 0 };
  const mockInstance = { ...instance, main_ip: publicAddress ? '198.51.100.9' : instance.main_ip };
  let deleted = false;
  let deleteFailuresLeft = failDelete ? Infinity : failDeleteCount;
  let createMayHaveSucceeded = false;
  const api = {
    async getPlan(id) {
      calls.plans++;
      return { id, type: 'vc2', locations: ['ewr'], hourly_cost: price };
    },
    async createInstance(payload) {
      calls.creates.push(payload);
      if (failCreate) {
        createMayHaveSucceeded = true;
        throw new Error('mock_timeout_after_create');
      }
      return { ...mockInstance, tags: payload.tags };
    },
    async getInstance(id) {
      calls.gets++;
      assert.equal(id, instance.id);
      if (deleted) throw new VultrApiError('mock_not_found', 404);
      return mockInstance;
    },
    async getInstanceVpcs(id) {
      calls.vpcs++;
      assert.equal(id, instance.id);
      return [{ id: config.vpcId, ip_address: mockInstance.internal_ip }];
    },
    async deleteInstance(id) {
      calls.deletes.push(id);
      if (deleteFailuresLeft > 0) {
        deleteFailuresLeft--;
        throw new VultrApiError('mock_delete_failure', 500);
      }
      deleted = true;
    },
    async findInstancesByTag(tag) {
      calls.tags.push(tag);
      if (tag === 'blast-radius-zero' && existingProject) return [{ ...mockInstance, tags: [tag] }];
      return createMayHaveSucceeded && tag.startsWith('brz-run-') ? [{ ...mockInstance, tags: [tag] }] : [];
    },
  };
  const guestTransport = {
    async attest(args) {
      calls.attest.push(args);
      return {
        snapshotSha256: config.snapshotSha256,
        egressPolicy: EGRESS_POLICY_VERSION,
        allowedEgress: [`${config.controllerIPv4}/32`],
        publicEgress: false,
        guestAgentVersion: GUEST_AGENT_VERSION,
        ...attestation,
      };
    },
    async issueToken(args) {
      calls.issues.push(args);
      return { value: 'syn_remote_test_token', handle: 'guest-token-1', scopes: args.scopes };
    },
    async readMailbox(args) {
      calls.reads.push(args);
      return { messages: persona.mailbox.messages.map(({ id, sender, subject }) => ({ id, sender, subject })) };
    },
    async teardown(args) {
      calls.guestDeletes++;
      return { destroyed: true, runId: args.runId };
    },
  };
  return { api, guestTransport, calls, isDeleted: () => deleted };
}

function adapterFor(cloud, overrides = {}) {
  return new VultrComputeAdapter({
    api: cloud.api,
    guestTransport: cloud.guestTransport,
    config,
    gate: { enabled: true, phrase: VULTR_APPROVAL_PHRASE },
    sleep: async () => {},
    schedule: () => ({ unref() {} }),
    cancel: () => {},
    tokenFactory: () => 'ctl_test_control_token_1234567890',
    pollDelayMs: 0,
    ...overrides,
  });
}

test('private-network helpers reject public targets and enforce hard resource caps', () => {
  assert.equal(isPrivateIPv4('10.10.0.2'), true);
  assert.equal(isPrivateIPv4('203.0.113.8'), false);
  assert.equal(isIPv4InCidr('10.10.0.20', '10.10.0.0/24'), true);
  assert.equal(isIPv4InCidr('10.11.0.20', '10.10.0.0/24'), false);
  assert.equal(isPrivateIPv4('010.10.0.2'), false);
  assert.equal(isIPv4InCidr('10.10.0.2', '010.10.0.0/24'), false);
  assert.throws(() => validateVultrConfig({ ...config, controllerIPv4: '203.0.113.8' }), /RFC1918/);
  assert.throws(() => validateVultrConfig({ ...config, vpcCidr: '10.10.0.1/24' }), /canonical/);
  assert.throws(() => validateVultrConfig({ ...config, maxHourlyCostUsd: 0.051 }), /Hourly price cap/);
  assert.throws(() => validateVultrConfig({ ...config, maxRunSeconds: 901 }), /Run lifetime/);
});

test('Vultr create payload is pinned, VPC-only, capped and has no public-network fallback', () => {
  const payload = buildVultrCreatePayload(config, {
    runId: 'mock-run-1', persona, controlToken: 'ctl_test_control_token_1234567890',
  });
  assert.equal(payload.snapshot_id, config.snapshotId);
  assert.equal(payload.vpc_only, true);
  assert.deepEqual(payload.attach_vpc, [config.vpcId]);
  assert.equal(payload.enable_ipv6, false);
  assert.equal(payload.firewall_group_id, config.firewallGroupId);
  assert.equal(payload.backups, 'disabled');
  assert.equal(payload.activation_email, false);
  assert.deepEqual(payload.block_devices, []);
  assert.equal(Object.hasOwn(payload, 'os_id'), false);
  const cloudConfig = Buffer.from(payload.user_data, 'base64').toString('utf8');
  assert.match(cloudConfig, /brz-guest-agent\.service/);
  assert.match(cloudConfig, /nft, flush, chain, inet, brz, output/);
  assert.match(cloudConfig, /ip, daddr, 10\.10\.0\.2, tcp, dport, '4174', accept/);
  const encodedRunConfig = cloudConfig.match(/content: ([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encodedRunConfig);
  const runConfig = JSON.parse(Buffer.from(encodedRunConfig, 'base64').toString('utf8'));
  assert.equal(runConfig.persona.email.endsWith('.invalid'), true);
  assert.equal(runConfig.egressPolicy, EGRESS_POLICY_VERSION);
  assert.equal(runConfig.controlToken, 'ctl_test_control_token_1234567890');
});

test('local orchestration runs through mocked Vultr provisioning, private guest calls, receipt and teardown', async () => {
  const cloud = fakeCloud();
  const adapter = adapterFor(cloud);
  const result = await executeOAuthScenario({
    input: { attackId: 'oauth-2023', personaId: persona.id, decision: 'allow', planId },
    personas,
    adapter,
    runIdFactory: () => 'mock-run-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, 'complete');
  assert.equal(result.receipt.exposedMessageCount, persona.mailbox.messages.length);
  assert.equal(result.receipt.sandboxDestroyed, true);
  assert.equal(cloud.calls.plans, 1);
  assert.equal(cloud.calls.creates.length, 1);
  assert.equal(cloud.calls.attest.length, 1);
  assert.equal(cloud.calls.issues.length, 1);
  assert.equal(cloud.calls.reads.length, 1);
  assert.equal(cloud.calls.guestDeletes, 1);
  assert.equal(cloud.calls.deletes.length, 1);
  assert.equal(cloud.isDeleted(), true);
  assert.equal(adapter.activeSandbox, null);
  assert.equal(JSON.stringify(result).includes('ctl_test_control_token_1234567890'), false);
  assert.equal(JSON.stringify(result).includes('syn_remote_test_token'), false);
  assert.equal(cloud.calls.attest[0].privateIPv4, instance.internal_ip);
});

test('missing live gate rejects before any Vultr API call', async () => {
  const cloud = fakeCloud();
  const adapter = adapterFor(cloud, { gate: { enabled: false, phrase: '' } });
  await assert.rejects(adapter.createSandbox({ runId: 'mock-run-2', persona }), /disabled/);
  assert.equal(cloud.calls.plans, 0);
  assert.equal(cloud.calls.creates.length, 0);
});

test('unknown or over-cap plan price fails before provisioning', async () => {
  const cloud = fakeCloud({ price: MAX_HOURLY_COST_USD + 0.001 });
  const adapter = adapterFor(cloud);
  await assert.rejects(adapter.createSandbox({ runId: 'mock-run-3', persona }), /hourly price/);
  assert.equal(cloud.calls.plans, 1);
  assert.equal(cloud.calls.creates.length, 0);
});

test('existing tagged resource and public-IP response both fail closed', async () => {
  const occupied = fakeCloud({ existingProject: true });
  const occupiedAdapter = adapterFor(occupied);
  await assert.rejects(occupiedAdapter.createSandbox({ runId: 'mock-run-existing', persona }), /already exists/);
  assert.equal(occupied.calls.creates.length, 0);

  const publicCloud = fakeCloud({ publicAddress: true });
  const publicAdapter = adapterFor(publicCloud);
  await assert.rejects(
    publicAdapter.createSandbox({ runId: 'mock-run-public', persona }),
    error => error.cleanupConfirmed === true,
  );
  assert.equal(publicCloud.calls.attest.length, 0);
  assert.equal(publicCloud.calls.deletes.length, 1);
  assert.equal(publicCloud.isDeleted(), true);
});

test('bad egress attestation aborts and confirms teardown before scenario effects', async () => {
  const cloud = fakeCloud({ attestation: { egressPolicy: 'allow-all' } });
  const adapter = adapterFor(cloud);
  const result = await executeOAuthScenario({
    input: { attackId: 'oauth-2023', personaId: persona.id, decision: 'allow', planId },
    personas,
    adapter,
    runIdFactory: () => 'mock-run-4',
  });
  assert.equal(result.ok, false);
  assert.equal(result.receipt.sandboxDestroyed, true);
  assert.equal(cloud.calls.issues.length, 0);
  assert.equal(cloud.calls.guestDeletes, 1);
  assert.equal(cloud.calls.deletes.length, 1);
  assert.equal(cloud.isDeleted(), true);
  assert.equal(result.events.some(event => event.type === 'sandbox.destroyed'), true);
});

test('ambiguous create timeout searches and deletes only the unique run tag', async () => {
  const cloud = fakeCloud({ failCreate: true });
  const adapter = adapterFor(cloud);
  await assert.rejects(
    adapter.createSandbox({ runId: 'mock-run-5', persona }),
    error => error.cleanupConfirmed === true && error.sandboxId === instance.id,
  );
  assert.deepEqual(cloud.calls.tags, ['blast-radius-zero', 'brz-run-mock-run-5']);
  assert.deepEqual(cloud.calls.deletes, [instance.id]);
  assert.equal(cloud.isDeleted(), true);
});

test('failed provider deletion is reported as unconfirmed rather than a successful teardown', async () => {
  const cloud = fakeCloud({ failDelete: true });
  const adapter = adapterFor(cloud);
  const result = await executeOAuthScenario({
    input: { attackId: 'oauth-2023', personaId: persona.id, decision: 'allow', planId },
    personas,
    adapter,
    runIdFactory: () => 'mock-run-6',
  });
  assert.equal(result.ok, false);
  assert.equal(result.receipt.sandboxDestroyed, false);
  assert.equal(cloud.calls.deletes.length, 2);
  assert.equal(adapter.activeSandbox?.destroyed, false);
  assert.match(result.error, /cleanup was attempted/);
});

test('watchdog retries an unconfirmed delete while the controller remains alive', async () => {
  const cloud = fakeCloud({ failDeleteCount: 2 });
  let watchdog;
  const adapter = adapterFor(cloud, { schedule: callback => { watchdog = callback; return {}; } });
  const result = await executeOAuthScenario({
    input: { attackId: 'oauth-2023', personaId: persona.id, decision: 'allow', planId },
    personas,
    adapter,
    runIdFactory: () => 'mock-run-watchdog',
  });
  assert.equal(result.receipt.sandboxDestroyed, false);
  assert.equal(cloud.calls.deletes.length, 2);
  await watchdog();
  assert.equal(cloud.isDeleted(), true);
  assert.equal(adapter.activeSandbox, null);
  assert.equal(cloud.calls.deletes.length, 3);
});

test('private guest transport rejects public hosts before making a request', async () => {
  const requests = [];
  const transport = new PrivateGuestTransport({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, status: 200, async json() { return { runId: 'mock-run' }; } };
    },
  });
  await assert.rejects(transport.attest({
    privateIPv4: '203.0.113.8', controlToken: 'ctl_test_control_token_1234567890', runId: 'mock-run',
  }), /RFC1918/);
  assert.equal(requests.length, 0);
  const response = await transport.attest({
    privateIPv4: '10.10.0.20', controlToken: 'ctl_test_control_token_1234567890', runId: 'mock-run',
  });
  assert.equal(response.runId, 'mock-run');
  assert.equal(requests[0].url, 'http://10.10.0.20:4174/internal/attestation');
  assert.equal(requests[0].options.redirect, 'error');
});

test('environment factory requires a live approval phrase and key before constructing Vultr clients', () => {
  assert.throws(() => createApprovedVultrAdapterFactory({
    env: { VULTR_SANDBOX_MODE: 'vultr' }, oauthApp: personas.oauth_app,
  }), /explicit approval phrase/);
  assert.throws(() => createApprovedVultrAdapterFactory({
    env: { VULTR_SANDBOX_MODE: 'vultr', VULTR_SANDBOX_APPROVAL: VULTR_APPROVAL_PHRASE },
    oauthApp: personas.oauth_app,
  }), /VULTR_API_KEY/);
});

test('REST client uses only the fixed Vultr API origin and disables redirects', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      status: 200,
      ok: true,
      async json() { return { plans: [{ id: 'vc2-1c-1gb' }], meta: { links: {} } }; },
    };
  };
  const client = new VultrRestClient({ apiKey: 'mock-api-key-not-a-real-secret', fetchImpl });
  const plan = await client.getPlan('vc2-1c-1gb');
  assert.equal(plan.id, 'vc2-1c-1gb');
  assert.equal(requests[0].url, 'https://api.vultr.com/v2/plans?type=vc2&per_page=500');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer mock-api-key-not-a-real-secret');
});
