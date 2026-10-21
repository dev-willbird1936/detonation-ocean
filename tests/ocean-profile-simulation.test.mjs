import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOceanProfiles } from '../backend/ocean-profiles.mjs';
import { OceanProfileSessionStore, OCEAN_PROFILE_ACTIONS } from '../backend/ocean-profile-simulation.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profiles = loadOceanProfiles(root).profiles;

function verifyChain(events) {
  let previous = '0'.repeat(64);
  for (const event of events) {
    assert.equal(event.previousHash, previous);
    const { hash, ...body } = event;
    assert.equal(hash, createHash('sha256').update(previous + JSON.stringify(body)).digest('hex'));
    previous = hash;
  }
}

test('all thirty profile sessions apply only bounded synthetic effects and exact depth actions', () => {
  const store = new OceanProfileSessionStore({ profiles });
  const effects = new Set();
  for (const profile of profiles) {
    const created = store.start({ profileId: profile.id, optIn: true });
    assert.equal(created.profile.id, profile.id);
    assert.equal(created.executionMode, 'local-synthetic-profile');
    assert.equal(created.state.syntheticOnly, true);
    verifyChain(created.events);
    if (profile.depthId === 'trench') {
      assert.equal(created.status, 'complete');
      assert.equal(created.victimAction, 'none');
      assert.ok(created.state.effect);
    } else {
      assert.equal(created.status, 'awaiting_victim_action');
      assert.equal(created.state.effect, null);
      const completed = store.act(created.sessionId, { actionId: OCEAN_PROFILE_ACTIONS[profile.depthId].id });
      assert.equal(completed.status, 'complete');
      assert.equal(completed.victimAction, OCEAN_PROFILE_ACTIONS[profile.depthId].id);
      assert.equal(completed.state.effect.before !== completed.state.effect.after, true);
      assert.ok(completed.events.every(event => event.details.syntheticOnly !== false));
      verifyChain(completed.events);
      effects.add(completed.state.effect.field);
    }
    const closed = store.close(created.sessionId);
    assert.equal(closed.closed, true);
    assert.equal(closed.receipt.syntheticOnly, true);
    assert.equal(closed.receipt.status, 'complete');
  }
  assert.equal(effects.size, 6);
});

test('profile sessions require opt-in, reject arbitrary actions, clone views, cap capacity, and expire', () => {
  let now = 1000;
  const store = new OceanProfileSessionStore({ profiles, now: () => now, id: randomUUID });
  assert.throws(() => store.start({ profileId: profiles[0].id, optIn: false }), error => error.code === 'OPT_IN_REQUIRED');
  assert.throws(() => store.start({ profileId: 'unlisted-profile', optIn: true }), error => error.code === 'PROFILE_NOT_SUPPORTED');

  const sessions = Array.from({ length: 5 }, (_, index) => store.start({ profileId: profiles[index].id, optIn: true }));
  assert.throws(() => store.start({ profileId: profiles[5].id, optIn: true }), error => error.code === 'SESSION_CAPACITY');
  const session = sessions[0];
  const altered = store.view(session.sessionId);
  altered.state.syntheticOnly = false;
  assert.equal(store.view(session.sessionId).state.syntheticOnly, true);
  assert.throws(() => store.act(session.sessionId, { actionId: 'run-shell-command' }), error => error.code === 'ACTION_NOT_ALLOWED');
  now += 5 * 60 * 1000;
  assert.throws(() => store.view(session.sessionId), error => error.code === 'SESSION_NOT_FOUND');
  const replacement = store.start({ profileId: profiles[5].id, optIn: true });
  assert.ok(replacement.sessionId);
  store.dispose();
});
