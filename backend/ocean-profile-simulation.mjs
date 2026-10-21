import { createHash, randomUUID } from 'node:crypto';
import { TrainingSessionError } from './training-session.mjs';

const SESSION_ID = /^[a-f0-9-]{36}$/i;
const MAX_SESSIONS = 5;
const MAX_LIFETIME_MS = 5 * 60 * 1000;
const ZERO_HASH = '0'.repeat(64);

export const OCEAN_PROFILE_ACTIONS = Object.freeze({
  sunlight: { id: 'open-sample', label: 'Simulate opening the inert sample. No file runs.' },
  twilight: { id: 'approve-factor', label: 'Simulate approving a synthetic factor. No code is entered.' },
  midnight: { id: 'disclose-password', label: 'Simulate a password disclosure. No password field or secret is used.' },
  abyss: { id: 'authorize-app', label: 'Simulate app authorization. No authentication secret is surrendered.' },
  trench: { id: null, label: 'No fresh victim response. The fixed synthetic effect starts with explicit training opt-in.' },
});

const EFFECTS = Object.freeze({
  deception: { app: 'Consent desk', field: 'syntheticAccess', before: 'review-only', after: 'granted to a fictional app', detail: '4 fabricated mailbox records become visible in the toy state' },
  intrusion: { app: 'System monitor', field: 'toyProcess', before: 'not present', after: 'running in the simulation only', detail: '1 inert synthetic file is added to the fake workspace' },
  'network-abuse': { app: 'Message queue', field: 'syntheticJobs', before: 0, after: 6, detail: '6 fabricated jobs are grouped in the local toy queue' },
  'trusted-source': { app: 'Software updater', field: 'toyPackage', before: 'verified sample', after: 'quarantined simulation copy', detail: 'the package is a display-only record; nothing is installed' },
  'theft-surveillance': { app: 'Records vault', field: 'syntheticRecordsRead', before: 0, after: 5, detail: '5 fabricated records are marked viewed; no personal data exists' },
  'extortion-destruction': { app: 'Files', field: 'toyDocumentState', before: 'available', after: 'locked simulation copy', detail: '1 fake document changes display state; no filesystem is touched' },
});

function fail(code, message, status = 400) {
  throw new TrainingSessionError(code, message, status);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }

export class OceanProfileSessionStore {
  #profiles;
  #sessions = new Map();
  #now;
  #id;

  constructor({ profiles, now = Date.now, id = randomUUID } = {}) {
    if (!Array.isArray(profiles) || profiles.length !== 30 || profiles.some(profile => !profile || typeof profile.id !== 'string')) {
      throw new TypeError('OceanProfileSessionStore requires the verified thirty-profile catalog.');
    }
    this.#profiles = new Map(profiles.map(profile => [profile.id, profile]));
    this.#now = now;
    this.#id = id;
  }

  #purgeExpired() {
    const now = this.#now();
    for (const [id, session] of this.#sessions) if (session.expiresAt <= now) this.#sessions.delete(id);
  }

  #get(sessionId) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) fail('INVALID_SESSION_ID', 'Invalid profile session ID.');
    this.#purgeExpired();
    const session = this.#sessions.get(sessionId);
    if (!session) fail('SESSION_NOT_FOUND', 'The profile session does not exist or has expired.', 404);
    return session;
  }

  #event(session, type, details) {
    const event = { sequence: session.events.length + 1, type, details, previousHash: session.head };
    event.hash = hash(session.head + JSON.stringify(event));
    session.events.push(event);
    session.head = event.hash;
  }

  #applyEffect(session) {
    const effect = EFFECTS[session.profile.familyId];
    session.state.effect = { app: effect.app, field: effect.field, before: effect.before, after: effect.after, detail: effect.detail };
    session.status = 'complete';
    this.#event(session, 'synthetic_effect_applied', {
      profileId: session.profile.id,
      familyId: session.profile.familyId,
      depthId: session.profile.depthId,
      effect: effect.field,
      syntheticOnly: true,
    });
  }

  start({ profileId, optIn } = {}) {
    this.#purgeExpired();
    if (optIn !== true) fail('OPT_IN_REQUIRED', 'Explicit training opt-in is required.', 403);
    const profile = this.#profiles.get(profileId);
    if (!profile) fail('PROFILE_NOT_SUPPORTED', 'Choose one of the thirty fixed creature profiles.');
    if (this.#sessions.size >= MAX_SESSIONS) fail('SESSION_CAPACITY', 'The local profile-session limit has been reached.', 429);

    const sessionId = this.#id();
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || this.#sessions.has(sessionId)) {
      throw new Error('Invalid profile session ID generator.');
    }
    const action = OCEAN_PROFILE_ACTIONS[profile.depthId];
    const session = {
      id: sessionId,
      profile: clone(profile),
      status: action.id ? 'awaiting_victim_action' : 'complete',
      action,
      state: {
        desktop: 'fictional',
        syntheticOnly: true,
        activeApp: EFFECTS[profile.familyId].app,
        effect: null,
      },
      events: [],
      head: ZERO_HASH,
      expiresAt: this.#now() + MAX_LIFETIME_MS,
      victimAction: null,
    };
    this.#sessions.set(sessionId, session);
    this.#event(session, 'profile_session_started', { profileId: profile.id, optIn: true, syntheticOnly: true });
    if (action.id === null) {
      session.victimAction = 'none';
      this.#event(session, 'victim_no_response', { profileId: profile.id, depthId: profile.depthId });
      this.#applyEffect(session);
    }
    return this.#view(session);
  }

  act(sessionId, { actionId } = {}) {
    const session = this.#get(sessionId);
    if (session.status !== 'awaiting_victim_action') fail('ACTION_NOT_AVAILABLE', 'This profile is already complete.', 409);
    if (typeof actionId !== 'string' || actionId !== session.action.id) fail('ACTION_NOT_ALLOWED', 'Choose the single synthetic action prepared for this profile.');
    session.victimAction = actionId;
    this.#event(session, 'synthetic_victim_action', {
      profileId: session.profile.id,
      depthId: session.profile.depthId,
      actionId,
      secretEntered: false,
      fileExecuted: false,
    });
    this.#applyEffect(session);
    return this.#view(session);
  }

  view(sessionId) { return this.#view(this.#get(sessionId)); }

  close(sessionId) {
    const session = this.#get(sessionId);
    const receipt = {
      profileId: session.profile.id,
      status: session.status,
      victimAction: session.victimAction,
      syntheticOnly: true,
      eventHash: session.head,
    };
    this.#sessions.delete(session.id);
    return { closed: true, receipt };
  }

  dispose() { this.#sessions.clear(); }

  #view(session) {
    return clone({
      sessionId: session.id,
      profile: session.profile,
      status: session.status,
      action: session.action,
      state: session.state,
      victimAction: session.victimAction,
      events: session.events,
      receipt: {
        profileId: session.profile.id,
        status: session.status,
        victimAction: session.victimAction,
        syntheticOnly: true,
        eventHash: session.head,
      },
      expiresAt: new Date(session.expiresAt).toISOString(),
      executionMode: 'local-synthetic-profile',
    });
  }
}
