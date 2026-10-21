import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EGRESS_POLICY_VERSION, GUEST_AGENT_VERSION } from '../backend/vultr-adapter.mjs';
import { createGuestAgentServer, verifyNftablesPolicy } from '../backend/guest-agent.mjs';
import { LocalSyntheticAdapter } from '../backend/oauth-scenario.mjs';
import { loadPersonas } from '../backend/personas.mjs';

const personas = loadPersonas();
const persona = personas.personas[0];
const snapshotSha256 = 'b'.repeat(64);
const controlToken = 'ctl_guest_control_token_12345678901234567890';
const firewall = {
  verified: true,
  egressPolicy: EGRESS_POLICY_VERSION,
  allowedEgress: ['10.10.0.2/32'],
  publicEgress: false,
};
const config = {
  version: 1,
  runId: 'guest-test-1',
  scenarioId: 'oauth-2023',
  persona,
  oauthApp: personas.oauth_app,
  controllerIPv4: '10.10.0.2',
  controllerPort: 4174,
  snapshotSha256,
  egressPolicy: EGRESS_POLICY_VERSION,
  guestAgentVersion: GUEST_AGENT_VERSION,
  controlToken,
};

const ruleset = `table inet brz {
 chain input {
  type filter hook input priority filter; policy drop;
  iifname "lo" accept
  ct state established,related accept
  ip saddr 10.10.0.2 tcp dport 4174 accept
 }
 chain output {
  type filter hook output priority filter; policy drop;
  oifname "lo" accept
  ct state established,related accept
  ip daddr 10.10.0.2 tcp dport 4174 accept
 }
 chain forward {
  type filter hook forward priority filter; policy drop;
 }
}`;

test('nftables attestation accepts only default-drop chains and the private controller', async () => {
  const exec = async (command, args) => {
    assert.equal(command, 'nft');
    assert.deepEqual(args, ['list', 'ruleset']);
    return { stdout: ruleset };
  };
  assert.deepEqual(await verifyNftablesPolicy(config, exec), firewall);
  const unsafe = ruleset.replace('ip daddr 10.10.0.2 tcp dport 4174 accept', 'ip daddr 203.0.113.8 accept');
  assert.equal((await verifyNftablesPolicy(config, async () => ({ stdout: unsafe }))).verified, false);
  const metadataStillOpen = ruleset.replace('  ip daddr 10.10.0.2 tcp dport 4174 accept\n }\n chain forward', '  ip daddr 10.10.0.2 tcp dport 4174 accept\n  ip daddr 169.254.169.254 tcp dport 80 accept\n }\n chain forward');
  assert.equal((await verifyNftablesPolicy(config, async () => ({ stdout: metadataStillOpen }))).verified, false);
  assert.equal((await verifyNftablesPolicy(config, async () => ({ stdout: `${ruleset}\ntable inet unexpected { }` }))).verified, false);
  assert.equal((await verifyNftablesPolicy(config, async () => { throw new Error('nft missing'); })).verified, false);
});

test('guest agent refuses to listen without verified host egress policy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brz-guest-agent-'));
  const digestPath = join(dir, 'image-sha256');
  writeFileSync(digestPath, snapshotSha256);
  try {
    await assert.rejects(createGuestAgentServer({
      config,
      host: '127.0.0.1',
      port: 0,
      firewallCheck: async () => ({ verified: false }),
      imageDigestPath: digestPath,
    }), /egress policy is not verified/);
    await assert.rejects(createGuestAgentServer({
      config,
      host: '127.0.0.1',
      port: 0,
      firewallCheck: async () => firewall,
      imageDigestPath: join(dir, 'missing'),
    }), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('private guest agent authenticates control requests and serves only synthetic IdP/mailbox data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brz-guest-agent-'));
  const digestPath = join(dir, 'image-sha256');
  writeFileSync(digestPath, snapshotSha256);
  const adapter = new LocalSyntheticAdapter({ tokenFactory: () => 'syn_guest_test_token' });
  const server = await createGuestAgentServer({
    config,
    host: '127.0.0.1',
    port: 0,
    firewallCheck: async () => firewall,
    adapter,
    imageDigestPath: digestPath,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token = controlToken) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  try {
    const unauthorized = await post('/internal/attestation', { runId: config.runId }, '');
    assert.equal(unauthorized.status, 401);

    const attestResponse = await post('/internal/attestation', { runId: config.runId });
    assert.equal(attestResponse.status, 200);
    assert.deepEqual(await attestResponse.json(), {
      runId: config.runId,
      snapshotSha256,
      egressPolicy: EGRESS_POLICY_VERSION,
      allowedEgress: ['10.10.0.2/32'],
      publicEgress: false,
      guestAgentVersion: GUEST_AGENT_VERSION,
    });

    const issueResponse = await post('/internal/idp/issue', {
      runId: config.runId,
      personaId: persona.id,
      scopes: personas.oauth_app.requested_scopes,
    });
    assert.equal(issueResponse.status, 200);
    const grant = await issueResponse.json();
    assert.equal(grant.value, 'syn_guest_test_token');
    assert.equal(JSON.stringify(grant).includes(controlToken), false);

    const readResponse = await post('/internal/mailbox/read', {
      runId: config.runId,
      personaId: persona.id,
      token: grant.value,
    });
    assert.equal(readResponse.status, 200);
    const mailbox = await readResponse.json();
    assert.deepEqual(mailbox.messages.map(message => message.id), persona.mailbox.messages.map(message => message.id));
    assert.ok(mailbox.messages.every(message => message.sender.endsWith('.invalid')));

    const extraField = await post('/internal/mailbox/read', {
      runId: config.runId, personaId: persona.id, token: grant.value, password: 'discarded',
    });
    assert.equal(extraField.status, 400);

    const synthetic = await post('/internal/sandbox/run', { runId: config.runId, attackKind: 'mass-mail-worm', seed: 'guest-test' });
    assert.equal(synthetic.status, 200);
    const run = await synthetic.json();
    assert.equal(run.events[0].kind, 'provisioned');
    assert.equal(run.events.at(-1).kind, 'summary');
    assert.equal(run.events.filter(event => event.kind === 'mail-sent').length, 20);
    assert.ok(run.evidence.artifacts > 0);
    assert.equal(JSON.stringify(run).includes(controlToken), false);
    assert.equal((await post('/internal/sandbox/run', { runId: config.runId, attackKind: 'rm-rf', seed: 'x' })).status, 400);
    assert.equal((await post('/internal/sandbox/run', { runId: config.runId, attackKind: 'scareware', seed: 'x'.repeat(81) })).status, 400);
    assert.equal((await post('/internal/sandbox/run', { runId: config.runId, attackKind: 'scareware', seed: 'x', command: 'id' })).status, 400);
    assert.equal((await post('/internal/sandbox/run', { runId: config.runId, attackKind: 'scareware', seed: 'x' }, 'ctl_wrong_token_0000000000000000000000')).status, 401);

    const teardown = await post('/internal/teardown', { runId: config.runId });
    assert.equal(teardown.status, 200);
    assert.deepEqual(await teardown.json(), { destroyed: true });
    assert.equal(adapter.lastSandbox.tokens.size, 0);
    const afterTeardown = await post('/internal/idp/issue', {
      runId: config.runId,
      personaId: persona.id,
      scopes: personas.oauth_app.requested_scopes,
    });
    assert.equal(afterTeardown.status, 400);
    assert.equal((await post('/internal/sandbox/run', { runId: config.runId, attackKind: 'scareware', seed: 'x' })).status, 400);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
