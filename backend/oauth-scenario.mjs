import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { findPersona } from './personas.mjs';

export const OAUTH_ATTACK_ID = 'oauth-2023';
const DEFAULT_SCOPES = ['mail.read', 'files.read'];

const PLAN_REQUEST_KEYS = new Set(['attackId', 'personaId', 'optIn', 'browserContainerOptIn']);
const EXECUTE_REQUEST_KEYS = new Set([
  'attackId', 'personaId', 'decision', 'planId', 'costAcknowledged', 'optIn', 'browserContainerOptIn',
]);
const VALID_DECISIONS = new Set(['allow', 'deny']);

export class ScenarioInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ScenarioInputError';
    this.status = status;
  }
}

export function validatePlanRequest(input, personas) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ScenarioInputError('Expected a JSON object.');
  }
  for (const key of Object.keys(input)) {
    if (!PLAN_REQUEST_KEYS.has(key)) throw new ScenarioInputError(`Unexpected field: ${key}`);
  }
  if (input.optIn !== undefined && input.optIn !== true) {
    throw new ScenarioInputError('Explicit training opt-in is required.');
  }
  if (input.browserContainerOptIn !== undefined && typeof input.browserContainerOptIn !== 'boolean') {
    throw new ScenarioInputError('Browser-container opt-in must be a boolean.');
  }
  if (input.browserContainerOptIn === true && input.optIn !== true) {
    throw new ScenarioInputError('Explicit training opt-in is required before selecting the browser container.');
  }
  if (input.attackId !== OAUTH_ATTACK_ID) throw new ScenarioInputError('Unsupported synthetic scenario.');
  if (typeof input.personaId !== 'string') throw new ScenarioInputError('A synthetic persona is required.');
  const persona = findPersona(personas, input.personaId);
  if (!persona || persona.synthetic !== true) throw new ScenarioInputError('Synthetic persona not found.', 404);
  return {
    attackId: input.attackId,
    personaId: persona.id,
    persona,
    browserContainerOptIn: input.browserContainerOptIn === true,
  };
}

export function validateScenarioRequest(input, personas) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ScenarioInputError('Expected a JSON object.');
  }
  for (const key of Object.keys(input)) {
    if (!EXECUTE_REQUEST_KEYS.has(key)) throw new ScenarioInputError(`Unexpected field: ${key}`);
  }
  const base = validatePlanRequest({
    attackId: input.attackId,
    personaId: input.personaId,
    ...(input.optIn === undefined ? {} : { optIn: input.optIn }),
    ...(input.browserContainerOptIn === undefined ? {} : { browserContainerOptIn: input.browserContainerOptIn }),
  }, personas);
  if (!VALID_DECISIONS.has(input.decision)) throw new ScenarioInputError('Choose simulate allow or deny.');
  if (typeof input.planId !== 'string' || !/^[a-f0-9]{64}$/.test(input.planId)) {
    throw new ScenarioInputError('A prepared scenario plan is required.');
  }
  if (input.costAcknowledged !== undefined && typeof input.costAcknowledged !== 'boolean') {
    throw new ScenarioInputError('Cost acknowledgement must be a boolean.');
  }
  const plan = planOAuthConsent(base.persona, personas.oauth_app);
  if (planDigest(plan, base.browserContainerOptIn) !== input.planId) {
    throw new ScenarioInputError('The prepared plan does not match this scenario.');
  }
  return { ...base, decision: input.decision, planId: input.planId };
}

export function planOAuthConsent(persona, app) {
  if (!persona?.synthetic || !persona.mailbox?.messages?.length) {
    throw new ScenarioInputError('The selected synthetic persona has no training mailbox.');
  }
  if (!app || typeof app.id !== 'string' || !Array.isArray(app.requested_scopes)) {
    throw new ScenarioInputError('Synthetic OAuth app configuration is missing.');
  }
  return {
    id: 'plan-oauth-consent-v1',
    attackId: OAUTH_ATTACK_ID,
    personaId: persona.id,
    personaLabel: persona.display_name,
    app: {
      id: app.id,
      name: app.name,
      publisher: app.publisher,
      purpose: app.purpose,
      requestedScopes: [...app.requested_scopes],
    },
    steps: [
      { id: 'inspect-persona', label: 'Confirm the synthetic persona has a mailbox.' },
      { id: 'show-consent', label: 'Show the training app and requested scopes.' },
      { id: 'record-choice', label: 'Record the explicit simulated allow/deny choice.' },
      { id: 'issue-token', label: 'If allowed, issue a short-lived token inside the fake identity provider.' },
      { id: 'read-mailbox', label: 'Use that token against the synthetic mailbox; record IDs, not credentials.' },
      { id: 'receipt', label: 'Build the blast-radius receipt from structured events.' },
      { id: 'destroy', label: 'Revoke in-memory token state and destroy the per-run sandbox.' },
    ],
  };
}

function planDigest(plan, browserContainerOptIn = false) {
  return createHash('sha256').update(JSON.stringify({ plan, browserContainerOptIn })).digest('hex');
}

export function createOAuthPlan(input, personas) {
  const { attackId, personaId, persona, browserContainerOptIn } = validatePlanRequest(input, personas);
  const plan = planOAuthConsent(persona, personas.oauth_app);
  return { planId: planDigest(plan, browserContainerOptIn), attackId, personaId, plan, browserContainerOptIn };
}

/**
 * Local deterministic sandbox adapter. It has no network capability; its only
 * state is an in-memory token map and the bundled synthetic persona data.
 */
export class LocalSyntheticAdapter {
  constructor({ failAt = null, allowedScopes = DEFAULT_SCOPES, tokenFactory = () => `syn_${randomBytes(24).toString('base64url')}` } = {}) {
    this.failAt = failAt;
    this.allowedScopes = new Set(allowedScopes);
    this.tokenFactory = tokenFactory;
    this.createdCount = 0;
    this.destroyedCount = 0;
    this.activeSandboxes = new Set();
    this.lastSandbox = null;
  }

  #failAt(step) {
    if (this.failAt === step) throw new Error('injected_synthetic_failure');
  }

  #assertActive(sandbox) {
    if (!sandbox || !sandbox.active || !this.activeSandboxes.has(sandbox)) {
      throw new Error('synthetic_sandbox_not_active');
    }
  }

  async createSandbox({ runId, persona }) {
    try {
      this.#failAt('sandbox.create');
    } catch (error) {
      error.resourceNotCreated = true;
      throw error;
    }
    const sandbox = {
      id: `sandbox-${runId}`,
      runId,
      persona,
      tokens: new Map(),
      active: true,
    };
    this.createdCount++;
    this.activeSandboxes.add(sandbox);
    this.lastSandbox = sandbox;
    return sandbox;
  }

  async issueToken(sandbox, { personaId, scopes }) {
    this.#assertActive(sandbox);
    this.#failAt('idp.issue');
    if (personaId !== sandbox.persona.id || !Array.isArray(scopes) || scopes.some(scope => !this.allowedScopes.has(scope))) {
      throw new Error('invalid_synthetic_grant');
    }
    const value = await this.tokenFactory();
    if (typeof value !== 'string' || !value.startsWith('syn_')) throw new Error('invalid_synthetic_token');
    const handle = `synthetic-token-${sandbox.tokens.size + 1}`;
    sandbox.tokens.set(value, { handle, personaId, scopes: [...scopes] });
    return { value, handle, scopes: [...scopes] };
  }

  async readMailbox(sandbox, { token, personaId }) {
    this.#assertActive(sandbox);
    this.#failAt('mailbox.read');
    const grant = sandbox.tokens.get(token);
    if (!grant || grant.personaId !== personaId || !grant.scopes.includes('mail.read')) {
      throw new Error('synthetic_scope_denied');
    }
    return sandbox.persona.mailbox.messages.map(({ id, sender, subject }) => ({ id, sender, subject }));
  }

  async destroySandbox(sandbox) {
    if (!sandbox || !this.activeSandboxes.has(sandbox)) return;
    sandbox.tokens.clear();
    sandbox.active = false;
    this.activeSandboxes.delete(sandbox);
    this.destroyedCount++;
  }
}

function makeReceipt({ runId, persona, decision, status, plan, events }) {
  const tokenEvent = events.find(event => event.type === 'idp.synthetic_token_issued');
  const accessEvent = events.find(event => event.type === 'mailbox.synthetic_records_read');
  const grantedScopes = tokenEvent?.details.scopes ?? [];
  const exposedMessages = accessEvent?.details.messages ?? [];
  const eventJson = JSON.stringify(events);

  return {
    runId,
    scenarioId: OAUTH_ATTACK_ID,
    personaId: persona.id,
    status,
    decision,
    tokenIssued: Boolean(tokenEvent),
    requestedScopes: [...plan.app.requestedScopes],
    grantedScopes,
    unusedGrantedScopes: grantedScopes.filter(scope => scope !== 'mail.read'),
    exposedMessages,
    exposedMessageCount: exposedMessages.length,
    sandboxDestroyed: events.some(event => event.type === 'sandbox.destroyed' || event.type === 'sandbox.not_created'),
    sandboxTeardown: events.some(event => event.type === 'sandbox.destroyed') ? 'confirmed' : events.some(event => event.type === 'sandbox.not_created') ? 'not_required' : 'unconfirmed',
    evidenceSha256: createHash('sha256').update(eventJson).digest('hex'),
  };
}

/** Run one opted-in OAuth-consent scenario using only synthetic state. */
export async function executeOAuthScenario({
  input,
  personas,
  adapter = new LocalSyntheticAdapter(),
  runIdFactory = randomUUID,
  clock = () => new Date().toISOString(),
} = {}) {
  const { attackId, personaId, decision, persona, planId } = validateScenarioRequest(input, personas);
  const plan = planOAuthConsent(persona, personas.oauth_app);
  const runId = runIdFactory();
  const events = [];
  let sandbox = null;
  let status = decision === 'deny' ? 'denied' : 'complete';
  let currentStep = 'start';

  const record = (type, details = {}) => {
    events.push({ sequence: events.length + 1, at: clock(), type, details });
  };

  record('scenario.started', { runId, attackId, personaId });
  record('agent.plan_created', {
    planId,
    stepIds: plan.steps.map(step => step.id),
    requestedScopes: [...plan.app.requestedScopes],
  });

  try {
    currentStep = 'sandbox.create';
    sandbox = await adapter.createSandbox({ runId, persona });
    record('sandbox.created', { sandboxId: sandbox.id });
    record('consent.choice_received', { appId: plan.app.id, decision });

    if (decision === 'allow') {
      currentStep = 'idp.issue';
      const token = await adapter.issueToken(sandbox, {
        personaId,
        scopes: [...plan.app.requestedScopes],
      });
      // Never place token.value in evidence, receipts, logs, or HTTP output.
      record('idp.synthetic_token_issued', { tokenHandle: token.handle, scopes: token.scopes });

      currentStep = 'mailbox.read';
      const messages = await adapter.readMailbox(sandbox, { token: token.value, personaId });
      record('mailbox.synthetic_records_read', { messages });
    } else {
      record('idp.synthetic_token_not_issued', { reason: 'user_denied_simulated_consent' });
    }
  } catch (error) {
    status = 'failed';
    record('scenario.failed', { step: currentStep, code: 'synthetic_run_failed' });
    if (error?.cleanupConfirmed === true) record('sandbox.destroyed', { sandboxId: error.sandboxId || 'tag-cleanup' });
    else if (error?.resourceNotCreated === true) record('sandbox.not_created', { step: currentStep });
  } finally {
    if (sandbox) {
      try {
        await adapter.destroySandbox(sandbox);
        record('sandbox.destroyed', { sandboxId: sandbox.id });
      } catch {
        status = 'failed';
        record('sandbox.destroy_failed', { code: 'synthetic_cleanup_failed' });
      }
    }
  }

  record('receipt.created', { status });
  const receipt = makeReceipt({ runId, persona, decision, status, plan, events });
  return {
    ok: status === 'complete' || status === 'denied',
    runId,
    plan,
    events,
    receipt,
    error: status === 'failed' ? 'The synthetic run failed; cleanup was attempted.' : null,
  };
}
