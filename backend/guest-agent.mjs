import { createServer } from 'node:http';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { LocalSyntheticAdapter } from './oauth-scenario.mjs';
import { validatePersonaManifest } from './personas.mjs';
import { EGRESS_POLICY_VERSION, GUEST_AGENT_VERSION, isPrivateIPv4 } from './vultr-adapter.mjs';
import { ATTACK_KINDS, runAttackKind } from './sandbox/kinds.mjs';

const execFile = promisify(execFileCallback);
const MAX_BODY_BYTES = 4096;
const ALLOWED_KEYS = {
  '/internal/attestation': new Set(['runId']),
  '/internal/idp/issue': new Set(['runId', 'personaId', 'scopes']),
  '/internal/mailbox/read': new Set(['runId', 'personaId', 'token']),
  '/internal/teardown': new Set(['runId']),
  '/internal/sandbox/run': new Set(['runId', 'attackKind', 'seed']),
};

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.has(key));
}

function parseChain(ruleset, name) {
  const lines = ruleset.split(/\r?\n/);
  let offset = 0, open = -1;
  for (const line of lines) {
    if (new RegExp(`^\\s*chain\\s+${name}\\s*\\{`).test(line)) {
      open = offset + line.indexOf('{');
      break;
    }
    offset += line.length + 1;
  }
  if (open < 0) return null;
  let depth = 1, quoted = false, escaped = false, close = -1;
  for (let i = open + 1; i < ruleset.length; i++) {
    const char = ruleset[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { close = i; break; }
  }
  if (close < 0) return null;
  return ruleset.slice(open + 1, close).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export async function verifyNftablesPolicy(config, exec = execFile) {
  if (!isPrivateIPv4(config.controllerIPv4) || !Number.isInteger(config.controllerPort)) return { verified: false };
  try {
    const { stdout } = await exec('nft', ['list', 'ruleset'], { encoding: 'utf8', timeout: 2000 });
    const declarations = stdout.split(/\r?\n/);
    const tables = declarations.map(line => line.match(/^\s*table\s+(\w+)\s+(\w+)\s*\{/)).filter(Boolean).map(match => `${match[1]} ${match[2]}`);
    const chainNames = declarations.map(line => line.match(/^\s*chain\s+(\w+)\s*\{/)).filter(Boolean).map(match => match[1]).sort();
    if (tables.length !== 1 || tables[0] !== 'inet brz' || JSON.stringify(chainNames) !== JSON.stringify(['forward', 'input', 'output'])) return { verified: false };
    const input = parseChain(stdout, 'input');
    const output = parseChain(stdout, 'output');
    const forward = parseChain(stdout, 'forward');
    const expectedInput = [
      'iifname "lo" accept',
      'ct state established,related accept',
      `ip saddr ${config.controllerIPv4} tcp dport ${config.controllerPort} accept`,
    ];
    const expectedOutput = [
      'oifname "lo" accept',
      'ct state established,related accept',
      `ip daddr ${config.controllerIPv4} tcp dport ${config.controllerPort} accept`,
    ];
    const rules = chain => chain?.filter(line => !line.startsWith('type filter hook ')) ?? null;
    const policyIsDrop = (chain, hook) => {
      const headers = chain?.filter(line => line.startsWith('type ')) ?? [];
      return headers.length === 1 && headers[0] === `type filter hook ${hook} priority filter; policy drop;`;
    };
    const inputRules = rules(input), outputRules = rules(output), forwardRules = rules(forward);
    const verified = policyIsDrop(input, 'input') && policyIsDrop(output, 'output') && policyIsDrop(forward, 'forward') &&
      JSON.stringify(inputRules) === JSON.stringify(expectedInput) &&
      JSON.stringify(outputRules) === JSON.stringify(expectedOutput) &&
      JSON.stringify(forwardRules) === JSON.stringify([]);
    return {
      verified,
      egressPolicy: EGRESS_POLICY_VERSION,
      allowedEgress: [`${config.controllerIPv4}/32`],
      publicEgress: false,
    };
  } catch {
    return { verified: false };
  }
}

export function validateGuestConfig(config) {
  if (config?.version !== 1 || !/^[a-zA-Z0-9-]{1,50}$/.test(config.runId || '') ||
      typeof config.controlToken !== 'string' || config.controlToken.length < 32 ||
      !isPrivateIPv4(config.controllerIPv4) || config.controllerPort !== 4174 ||
      config.egressPolicy !== EGRESS_POLICY_VERSION || config.guestAgentVersion !== GUEST_AGENT_VERSION ||
      !/^[a-f0-9]{64}$/i.test(config.snapshotSha256 || '')) {
    throw new Error('Invalid private guest run configuration.');
  }
  validatePersonaManifest({ schema_version: 1, oauth_app: config.oauthApp, personas: [config.persona] });
  return config;
}

export function loadGuestConfig(path = process.env.BRZ_GUEST_CONFIG || '/etc/blast-radius/run.json') {
  return validateGuestConfig(JSON.parse(readFileSync(path, 'utf8')));
}

function sameSecret(request, expected) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(header.slice(7));
  const actual = Buffer.from(expected);
  return candidate.length === actual.length && timingSafeEqual(candidate, actual);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new Error('content_type');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('too_large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!exactKeys(value, ALLOWED_KEYS[new URL(request.url || '/', 'http://guest.local').pathname])) throw new Error('fields');
  return value;
}

export async function createGuestAgentServer({
  config,
  host = '0.0.0.0',
  port = config?.controllerPort,
  firewallCheck = verifyNftablesPolicy,
  adapter = new LocalSyntheticAdapter({ allowedScopes: config?.oauthApp?.requested_scopes }),
  imageDigestPath = '/etc/blast-radius/image-sha256',
} = {}) {
  validateGuestConfig(config);
  const firewall = await firewallCheck(config);
  if (!firewall?.verified || firewall.egressPolicy !== EGRESS_POLICY_VERSION ||
      JSON.stringify(firewall.allowedEgress) !== JSON.stringify([`${config.controllerIPv4}/32`]) || firewall.publicEgress !== false) {
    throw new Error('Guest egress policy is not verified; refusing to listen.');
  }
  const imageDigest = readFileSync(imageDigestPath, 'utf8').trim().toLowerCase();
  if (imageDigest !== config.snapshotSha256.toLowerCase()) throw new Error('Guest image digest does not match the pinned snapshot.');
  const sandbox = await adapter.createSandbox({ runId: config.runId, persona: config.persona });
  let destroyed = false;

  const server = createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://guest.local').pathname;
    if (!Object.hasOwn(ALLOWED_KEYS, path) || request.method !== 'POST') {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    if (!sameSecret(request, config.controlToken)) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    try {
      const input = await readJson(request);
      if (input.runId !== config.runId || destroyed) throw new Error('run_unavailable');
      if (path === '/internal/attestation') {
        const currentFirewall = await firewallCheck(config);
        if (!currentFirewall?.verified) throw new Error('firewall_unverified');
        sendJson(response, 200, {
          runId: config.runId,
          snapshotSha256: imageDigest,
          egressPolicy: currentFirewall.egressPolicy,
          allowedEgress: currentFirewall.allowedEgress,
          publicEgress: currentFirewall.publicEgress,
          guestAgentVersion: GUEST_AGENT_VERSION,
        });
        return;
      }
      if (path === '/internal/idp/issue') {
        const scopes = config.oauthApp.requested_scopes;
        if (input.personaId !== config.persona.id || !Array.isArray(input.scopes) ||
            input.scopes.length !== scopes.length || input.scopes.some((scope, i) => scope !== scopes[i])) {
          throw new Error('grant_rejected');
        }
        const token = await adapter.issueToken(sandbox, { personaId: input.personaId, scopes });
        sendJson(response, 200, token);
        return;
      }
      if (path === '/internal/mailbox/read') {
        if (input.personaId !== config.persona.id || typeof input.token !== 'string' || !input.token.startsWith('syn_')) {
          throw new Error('mailbox_request_rejected');
        }
        const messages = await adapter.readMailbox(sandbox, { token: input.token, personaId: input.personaId });
        sendJson(response, 200, { messages });
        return;
      }
      if (path === '/internal/sandbox/run') {
        // Synthetic attack runner (backend/sandbox/kinds.mjs): writes only fictional files under a private temp dir.
        if (!ATTACK_KINDS.includes(input.attackKind) || typeof input.seed !== 'string' || input.seed.length > 80) throw new Error('sandbox_run_rejected');
        const dir = mkdtempSync(join(tmpdir(), 'brz-run-'));
        try {
          sendJson(response, 200, runAttackKind(input.attackKind, { dir, seed: input.seed }));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        return;
      }
      await adapter.destroySandbox(sandbox);
      destroyed = true;
      sendJson(response, 200, { destroyed: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message === 'too_large' ? 'request_too_large' : 'request_rejected' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const config = loadGuestConfig();
  const server = await createGuestAgentServer({ config });
  console.log(`Synthetic guest agent listening on the private VPC interface, port ${config.controllerPort}.`);
  const stop = async () => {
    await new Promise(resolve => server.close(resolve));
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
