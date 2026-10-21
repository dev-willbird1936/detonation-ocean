import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EXECUTION_MODE = 'local-synthetic-in-process';
const SESSION_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const ACTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CONCURRENT_SESSIONS = 8;
const MAX_RESETS_PER_SESSION = 8;
const MAX_LIFETIME_MS = 30 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 15 * 60 * 1000;
const ZERO_HASH = '0'.repeat(64);
const EXPECTED_SCENARIOS = [
  ['oauth-2023', 2], ['zeus-2007', 3], ['drainer-2022', 4], ['iloveyou-2000', 5],
  ['wannacry-2017', 1], ['solarwinds-2020', 1], ['heartbleed-2014', 1],
  ['log4shell-2021', 1], ['moveit-2023', 1], ['bec-2024', 2],
];
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const bundled = JSON.parse(readFileSync(new URL('../data/training-scenarios.json', import.meta.url), 'utf8'));
const SCENARIOS = validateScenarioManifest(bundled);
const SCENARIOS_BY_ID = new Map(SCENARIOS.map(scenario => [scenario.id, scenario]));

export const TRAINING_EXECUTION_MODE = EXECUTION_MODE;
export const TRAINING_MAX_RESETS_PER_SESSION = MAX_RESETS_PER_SESSION;
export const TRAINING_SCENARIO_IDS = Object.freeze(EXPECTED_SCENARIOS.map(([id]) => id));

export class TrainingSessionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TrainingSessionError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 400) {
  throw new TrainingSessionError(code, message, status);
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, name) {
  if (!isRecord(value)) throw new Error(`Invalid training scenario: ${name} must be an object.`);
}

function assertText(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new Error(`Invalid training scenario: ${name} must be non-empty text.`);
  }
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value === 'object' ? 'object' : typeof value;
}

function resolvePath(root, path, scenarioId) {
  const segments = path.split('.');
  let cursor = root;
  for (const segment of segments) {
    if (!segment || FORBIDDEN_PATH_SEGMENTS.has(segment) || !isRecord(cursor) || !Object.hasOwn(cursor, segment)) {
      throw new Error(`Invalid training scenario ${scenarioId}: effect path ${path} is not seeded.`);
    }
    if (segment !== segments.at(-1)) cursor = cursor[segment];
  }
  return { parent: cursor, key: segments.at(-1) };
}

function validateScenarioManifest(manifest) {
  assertRecord(manifest, 'manifest');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.scenarios) || manifest.scenarios.length !== EXPECTED_SCENARIOS.length) {
    throw new Error('Invalid training scenario manifest: expected schema version 1 and exactly ten scenarios.');
  }
  const seenScenarioIds = new Set();
  const seenSeverities = new Set();
  for (const [index, scenario] of manifest.scenarios.entries()) {
    assertRecord(scenario, `scenarios[${index}]`);
    const [expectedId, expectedSev] = EXPECTED_SCENARIOS[index];
    if (scenario.id !== expectedId || scenario.sev !== expectedSev || seenScenarioIds.has(scenario.id)) {
      throw new Error(`Invalid training scenario order, ID, or SEV at index ${index}.`);
    }
    seenScenarioIds.add(scenario.id);
    seenSeverities.add(scenario.sev);
    for (const field of ['name', 'mechanism', 'summary']) assertText(scenario[field], `${scenario.id}.${field}`);
    if (!Number.isInteger(scenario.year) || scenario.year < 1980 || scenario.year > 2100) {
      throw new Error(`Invalid training scenario year: ${scenario.id}.`);
    }
    validateSeed(scenario);
  }
  if ([1, 2, 3, 4, 5].some(sev => !seenSeverities.has(sev))) {
    throw new Error('Invalid training scenario manifest: every SEV level must be represented.');
  }
  return manifest.scenarios;
}

function validateSeed(scenario) {
  const id = scenario.id;
  assertRecord(scenario.persona, `${id}.persona`);
  for (const field of ['displayName', 'role', 'device']) assertText(scenario.persona[field], `${id}.persona.${field}`);
  if (!Array.isArray(scenario.persona.accounts) || scenario.persona.accounts.length < 1) {
    throw new Error(`Invalid training scenario: ${id} has no seeded training account.`);
  }
  for (const account of scenario.persona.accounts) {
    assertRecord(account, `${id}.account`);
    for (const field of ['id', 'label', 'username', 'demoSecret']) assertText(account[field], `${id}.account.${field}`);
    if (account.trainingOnly !== true || !account.username.toLowerCase().endsWith('.invalid') ||
        !/^TRAINING-ONLY-[A-Z0-9-]+$/.test(account.demoSecret)) {
      throw new Error(`Invalid training-only account seed in ${id}.`);
    }
  }
  if (!Array.isArray(scenario.apps) || scenario.apps.length < 3) throw new Error(`Invalid training apps in ${id}.`);
  for (const app of scenario.apps) {
    assertRecord(app, `${id}.app`);
    assertText(app.id, `${id}.app.id`);
    assertText(app.name, `${id}.app.name`);
  }
  assertRecord(scenario.assets, `${id}.assets`);
  assertRecord(scenario.assets.mailbox, `${id}.mailbox`);
  if (!scenario.assets.mailbox.address?.toLowerCase().endsWith('.invalid') || !Array.isArray(scenario.assets.mailbox.messages)) {
    throw new Error(`Invalid synthetic mailbox in ${id}.`);
  }
  for (const message of scenario.assets.mailbox.messages) {
    assertRecord(message, `${id}.mailbox.message`);
    for (const field of ['id', 'sender', 'subject', 'body']) assertText(message[field], `${id}.mailbox.message.${field}`);
    if (!message.sender.toLowerCase().endsWith('.invalid')) throw new Error(`Non-synthetic sender in ${id}.`);
  }
  if (!Array.isArray(scenario.assets.files) || scenario.assets.files.length < 1 || !Array.isArray(scenario.assets.browserViews)) {
    throw new Error(`Invalid seeded desktop assets in ${id}.`);
  }
  for (const file of scenario.assets.files) {
    assertRecord(file, `${id}.file`);
    for (const field of ['id', 'name', 'path', 'content']) assertText(file[field], `${id}.file.${field}`);
    if (!file.path.startsWith('/')) throw new Error(`Invalid synthetic file path in ${id}.`);
  }
  for (const page of scenario.assets.browserViews) {
    assertRecord(page, `${id}.browserView`);
    for (const field of ['id', 'title', 'address', 'summary']) assertText(page[field], `${id}.browserView.${field}`);
    if (!page.address.startsWith('local://training/') &&
        !/^https:\/\/[a-z0-9.-]+\.invalid(?:\/|$)/i.test(page.address)) {
      throw new Error(`Non-synthetic browser page in ${id}.`);
    }
  }
  assertRecord(scenario.state, `${id}.state`);
  if (!scenario.walkthrough || !Array.isArray(scenario.walkthrough.steps) || scenario.walkthrough.steps.length < 2) {
    throw new Error(`Invalid ordered walkthrough in ${id}.`);
  }
  const stepIds = new Map();
  const actionIds = new Set();
  for (const [stepIndex, step] of scenario.walkthrough.steps.entries()) {
    assertRecord(step, `${id}.step`);
    if (!/^[a-z][a-z0-9-]*$/.test(step.id) || stepIds.has(step.id)) throw new Error(`Invalid walkthrough step ID in ${id}.`);
    for (const field of ['title', 'instruction']) assertText(step[field], `${id}.step.${field}`);
    if (!Array.isArray(step.actions) || step.actions.length === 0) throw new Error(`Empty walkthrough step in ${id}.`);
    stepIds.set(step.id, stepIndex);
    for (const action of step.actions) {
      assertRecord(action, `${id}.action`);
      if (!ACTION_ID_PATTERN.test(action.id) || actionIds.has(action.id)) throw new Error(`Invalid or duplicate action ID in ${id}.`);
      actionIds.add(action.id);
      for (const field of ['label', 'help']) assertText(action[field], `${id}.action.${field}`);
      if (!['safe', 'adverse', 'recovery'].includes(action.kind) || !Array.isArray(action.effects) && !isRecord(action.effects)) {
        throw new Error(`Invalid action configuration in ${id}.`);
      }
      if (action.nextStep !== null && typeof action.nextStep !== 'string') throw new Error(`Invalid action transition in ${id}.`);
      const effects = Array.isArray(action.effects) ? action.effects : Object.entries(action.effects).map(([path, value]) => ({ path, value }));
      if (effects.length === 0) throw new Error(`Action without state effects in ${id}.`);
      for (const effect of effects) {
        assertRecord(effect, `${id}.effect`);
        if (typeof effect.path !== 'string' || !effect.path.length) throw new Error(`Invalid effect path in ${id}.`);
        const target = resolvePath(scenario.state, effect.path, id);
        if (valueType(target.parent[target.key]) !== valueType(effect.value)) throw new Error(`Effect changes the seeded value type in ${id}.${effect.path}.`);
      }
    }
  }
  const firstActions = scenario.walkthrough.steps[0].actions;
  if (!firstActions.some(action => action.kind === 'safe') || !firstActions.some(action => action.kind === 'adverse')) {
    throw new Error(`Scenario ${id} requires distinct safe and adverse actions.`);
  }
  let recoveryCount = 0;
  for (const [stepIndex, step] of scenario.walkthrough.steps.entries()) {
    for (const action of step.actions) {
      if (action.nextStep !== null) {
        const nextIndex = stepIds.get(action.nextStep);
        if (nextIndex === undefined || nextIndex <= stepIndex) throw new Error(`Invalid action order in ${id}.`);
      }
      if (action.kind === 'recovery' && action.nextStep === null && stepIndex > 0) recoveryCount++;
    }
  }
  if (!firstActions.some(action => action.kind === 'adverse' && action.nextStep !== null) || recoveryCount < 1) {
    throw new Error(`Scenario ${id} requires an adverse path and recovery action.`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(input, allowed, label) {
  if (!isRecord(input)) fail('INVALID_INPUT', `${label} must be a JSON object.`);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.has(key)) fail('INVALID_INPUT', `Unexpected ${label} field.`);
  }
}

function eventHash(event) {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

/** In-process, deterministic training state only; this is not a VM or OS sandbox. */
export class TrainingSessionStore {
  #sessions = new Map();
  #closed = new Map();
  #disposed = false;
  #clock;
  #idFactory;
  #maxSessions;
  #lifetimeMs;

  constructor({ clock = () => Date.now(), idFactory = randomUUID, maxSessions = MAX_CONCURRENT_SESSIONS, lifetimeMs = DEFAULT_LIFETIME_MS } = {}) {
    if (typeof clock !== 'function' || typeof idFactory !== 'function' ||
        !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > MAX_CONCURRENT_SESSIONS ||
        !Number.isInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_LIFETIME_MS) {
      throw new TypeError('Invalid training session store configuration.');
    }
    this.#clock = clock;
    this.#idFactory = idFactory;
    this.#maxSessions = maxSessions;
    this.#lifetimeMs = lifetimeMs;
  }

  listScenarios() {
    this.#assertOpen();
    return SCENARIOS.map(({ id, name, year, sev, mechanism, summary }) => ({ id, name, year, sev, mechanism, summary }));
  }

  create(input) {
    this.#assertOpen();
    exactKeys(input, new Set(['attackId', 'optIn']), 'create request');
    if (input.optIn !== true) fail('OPT_IN_REQUIRED', 'Explicit training opt-in is required.', 403);
    if (typeof input.attackId !== 'string' || !SCENARIOS_BY_ID.has(input.attackId)) {
      fail('SCENARIO_NOT_FOUND', 'Unsupported synthetic training scenario.', 404);
    }
    const now = this.#now();
    this.#expireElapsed(now);
    if (this.#sessions.size >= this.#maxSessions) fail('SESSION_LIMIT', 'Training session capacity is full.', 429);
    const sessionId = this.#idFactory();
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId) || this.#sessions.has(sessionId) || this.#closed.has(sessionId)) {
      fail('SESSION_ID_UNAVAILABLE', 'A safe training session ID could not be allocated.', 500);
    }
    const session = {
      id: sessionId,
      scenario: SCENARIOS_BY_ID.get(input.attackId),
      state: clone(SCENARIOS_BY_ID.get(input.attackId).state),
      stepIndex: 0,
      events: [],
      epoch: 1,
      epochStart: 0,
      resetCount: 0,
      expiresAt: now + this.#lifetimeMs,
      expiryTimer: null,
    };
    this.#sessions.set(sessionId, session);
    this.#record(session, 'scenario.started', { attackId: input.attackId, epoch: session.epoch });
    this.#scheduleExpiry(session);
    return this.#view(session);
  }

  view(sessionId) {
    return this.#view(this.#requireActive(sessionId));
  }

  act(sessionId, input) {
    const session = this.#requireActive(sessionId);
    exactKeys(input, new Set(['actionId']), 'action request');
    if (typeof input.actionId !== 'string' || !ACTION_ID_PATTERN.test(input.actionId)) {
      fail('INVALID_INPUT', 'actionId must identify a permitted training action.');
    }
    const step = session.scenario.walkthrough.steps[session.stepIndex];
    const action = step?.actions.find(candidate => candidate.id === input.actionId);
    if (!action) fail('ACTION_NOT_PERMITTED', 'Action is not permitted at the current walkthrough step.', 409);

    const changes = [];
    const effects = Array.isArray(action.effects) ? action.effects : Object.entries(action.effects).map(([path, value]) => ({ path, value }));
    for (const effect of effects) {
      const target = resolvePath(session.state, effect.path, session.scenario.id);
      const before = clone(target.parent[target.key]);
      const after = clone(effect.value);
      if (!sameValue(before, after)) {
        target.parent[target.key] = after;
        changes.push({ path: effect.path, before, after: clone(after) });
      }
    }
    const nextIndex = action.nextStep === null
      ? session.scenario.walkthrough.steps.length
      : session.scenario.walkthrough.steps.findIndex(candidate => candidate.id === action.nextStep);
    session.stepIndex = nextIndex;
    this.#record(session, 'action.applied', {
      stepId: step.id,
      actionId: action.id,
      kind: action.kind,
      changes,
      nextStep: action.nextStep,
    });
    if (action.nextStep === null) this.#record(session, 'scenario.completed', { actionId: action.id, kind: action.kind });
    return this.#view(session);
  }

  reset(sessionId) {
    const session = this.#requireActive(sessionId);
    if (session.resetCount >= MAX_RESETS_PER_SESSION) {
      fail('RESET_LIMIT', 'Training session reset limit has been reached.', 429);
    }
    this.#record(session, 'session.reset', { previousEpoch: session.epoch });
    session.resetCount++;
    session.state = clone(session.scenario.state);
    session.stepIndex = 0;
    session.epoch++;
    session.epochStart = session.events.length;
    this.#record(session, 'scenario.started', { attackId: session.scenario.id, epoch: session.epoch });
    return this.#view(session);
  }

  destroy(sessionId) {
    this.#assertOpen();
    const session = this.#sessions.get(this.#validateSessionId(sessionId));
    if (!session) {
      const closed = this.#closed.get(sessionId);
      if (closed) return { sessionId, destroyed: true, reason: closed.reason, alreadyClosed: true };
      fail('SESSION_NOT_FOUND', 'Training session was not found.', 404);
    }
    if (this.#now() >= session.expiresAt) {
      this.#expire(session);
      return { sessionId, destroyed: true, reason: 'expired', alreadyClosed: false };
    }
    this.#record(session, 'session.destroyed', { reason: 'requested' });
    const receipt = this.#receipt(session);
    this.#sessions.delete(session.id);
    this.#rememberClosed(session.id, 'destroyed');
    this.#wipe(session);
    return { sessionId, destroyed: true, reason: 'destroyed', receipt };
  }

  dispose() {
    if (this.#disposed) return { disposed: true, destroyedSessions: 0 };
    let destroyedSessions = 0;
    for (const session of this.#sessions.values()) {
      this.#record(session, 'session.destroyed', { reason: 'store-disposed' });
      this.#rememberClosed(session.id, 'disposed');
      this.#wipe(session);
      destroyedSessions++;
    }
    this.#sessions.clear();
    this.#disposed = true;
    return { disposed: true, destroyedSessions };
  }

  #assertOpen() {
    if (this.#disposed) fail('STORE_DISPOSED', 'Training session store has been disposed.', 503);
  }

  #now() {
    const value = this.#clock();
    const timestamp = value instanceof Date ? value.getTime() : value;
    if (!Number.isFinite(timestamp) || timestamp < 0) fail('CLOCK_INVALID', 'Training session clock returned an invalid time.', 500);
    return timestamp;
  }

  #validateSessionId(sessionId) {
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      fail('INVALID_INPUT', 'Invalid training session ID.');
    }
    return sessionId;
  }

  #requireActive(sessionId) {
    this.#assertOpen();
    const id = this.#validateSessionId(sessionId);
    const session = this.#sessions.get(id);
    if (session && this.#now() >= session.expiresAt) this.#expire(session);
    const active = this.#sessions.get(id);
    if (active) return active;
    const closed = this.#closed.get(id);
    if (closed?.reason === 'expired') fail('SESSION_EXPIRED', 'Training session has expired.', 410);
    if (closed) fail('SESSION_DESTROYED', 'Training session has been destroyed.', 410);
    fail('SESSION_NOT_FOUND', 'Training session was not found.', 404);
  }

  #expireElapsed(now) {
    for (const session of this.#sessions.values()) {
      if (now >= session.expiresAt) this.#expire(session);
    }
  }

  #scheduleExpiry(session) {
    session.expiryTimer = setTimeout(() => {
      if (this.#sessions.get(session.id) !== session) return;
      try {
        if (this.#now() >= session.expiresAt) this.#expire(session);
      } catch {
        // Subsequent store operations still enforce expiry synchronously.
      }
    }, this.#lifetimeMs);
    session.expiryTimer.unref?.();
  }

  #expire(session) {
    if (this.#sessions.get(session.id) !== session) return;
    this.#record(session, 'session.expired', { reason: 'lifetime-limit' });
    this.#sessions.delete(session.id);
    this.#rememberClosed(session.id, 'expired');
    this.#wipe(session);
  }

  #rememberClosed(sessionId, reason) {
    this.#closed.set(sessionId, { reason });
    const maxRemembered = MAX_CONCURRENT_SESSIONS * 4;
    while (this.#closed.size > maxRemembered) this.#closed.delete(this.#closed.keys().next().value);
  }

  #wipe(session) {
    clearTimeout(session.expiryTimer);
    session.state = null;
    session.events.length = 0;
    session.scenario = null;
    session.expiryTimer = null;
  }

  #record(session, type, details) {
    const preceding = session.events.at(-1)?.hash ?? ZERO_HASH;
    const body = {
      sequence: session.events.length + 1,
      at: new Date(this.#now()).toISOString(),
      type,
      details: clone(details),
      previousHash: preceding,
    };
    session.events.push({ ...body, hash: eventHash(body) });
  }

  #receipt(session) {
    const events = session.events.slice(session.epochStart);
    const actionEvents = events.filter(event => event.type === 'action.applied');
    const changes = actionEvents.flatMap(event => event.details.changes.map(change => ({ actionId: event.details.actionId, ...clone(change) })));
    const complete = events.some(event => event.type === 'scenario.completed');
    const destroyed = events.some(event => event.type === 'session.destroyed' || event.type === 'session.expired');
    return {
      sessionId: session.id,
      scenarioId: session.scenario.id,
      epoch: session.epoch,
      status: destroyed ? 'destroyed' : complete ? 'complete' : 'in_progress',
      actionIds: actionEvents.map(event => event.details.actionId),
      adverseActionIds: actionEvents.filter(event => event.details.kind === 'adverse').map(event => event.details.actionId),
      changedProperties: [...new Set(changes.map(change => change.path))],
      changes,
      eventCount: events.length,
      headHash: events.at(-1)?.hash ?? ZERO_HASH,
      evidenceSha256: createHash('sha256').update(JSON.stringify(events)).digest('hex'),
    };
  }

  #view(session) {
    const scenario = session.scenario;
    const current = scenario.walkthrough.steps[session.stepIndex] ?? null;
    const receipt = this.#receipt(session);
    return {
      sessionId: session.id,
      scenario: { id: scenario.id, name: scenario.name, year: scenario.year, sev: scenario.sev, mechanism: scenario.mechanism, summary: scenario.summary },
      persona: clone(scenario.persona),
      apps: clone(scenario.apps),
      assets: clone(scenario.assets),
      state: clone(session.state),
      walkthrough: { steps: scenario.walkthrough.steps.map(({ id, title, instruction }) => ({ id, title, instruction })) },
      currentStep: current?.id ?? null,
      permittedActions: current ? current.actions.map(({ id, label, kind, help }) => ({ id, label, kind, help })) : [],
      events: clone(session.events),
      outcome: { status: receipt.status, receipt },
      expiresAt: new Date(session.expiresAt).toISOString(),
      executionMode: EXECUTION_MODE,
    };
  }
}
