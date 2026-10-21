import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppServer } from '../server.mjs';
import { TrainingSessionStore, TRAINING_EXECUTION_MODE, TRAINING_SCENARIO_IDS } from '../backend/training-session.mjs';

async function withServer(run, trainingSessionStore = new TrainingSessionStore()) {
  const server = createAppServer({ trainingSessionStore });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', body, origin = base, headers = {} } = {}) => {
    const requestHeaders = { ...headers };
    if (origin !== null) requestHeaders.origin = origin;
    if (body !== undefined) requestHeaders['content-type'] ??= 'application/json';
    return fetch(`${base}${path}`, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  };
  try {
    await run({ base, request });
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

async function json(response) {
  return response.json();
}

function action(view, kind) {
  const item = view.permittedActions.find(candidate => candidate.kind === kind);
  assert.ok(item, `expected ${kind} action at ${view.currentStep}`);
  return item;
}

const entryHtml = readFileSync(new URL('../ui/abyss/index.html', import.meta.url), 'utf8');
const adapterJs = readFileSync(new URL('../ui/abyss/desktop-entry.js', import.meta.url), 'utf8');

test('all ten scenarios run safe, adverse, recovery, reset, view, and close over the HTTP contract', async () => {
  await withServer(async ({ request }) => {
    const catalogueResponse = await request('/api/training/scenarios');
    assert.equal(catalogueResponse.status, 200);
    const catalogue = await json(catalogueResponse);
    assert.deepEqual(catalogue.map(scenario => scenario.id), TRAINING_SCENARIO_IDS);

    for (const scenario of catalogue) {
      const safeStartResponse = await request('/api/training/start', {
        method: 'POST', body: { attackId: scenario.id, optIn: true },
      });
      assert.equal(safeStartResponse.status, 200, scenario.id);
      const safeStart = await json(safeStartResponse);
      assert.equal(safeStart.scenario.id, scenario.id);
      assert.equal(safeStart.executionMode, TRAINING_EXECUTION_MODE);
      assert.ok(safeStart.assets.files.length > 0);
      assert.ok(safeStart.assets.mailbox.messages.length > 0);
      const viewed = await json(await request('/api/training/view', {
        method: 'POST', body: { sessionId: safeStart.sessionId },
      }));
      assert.equal(viewed.state && viewed.currentStep, safeStart.currentStep);
      const safeResult = await request('/api/training/action', {
        method: 'POST', body: { sessionId: safeStart.sessionId, actionId: action(safeStart, 'safe').id },
      });
      assert.equal(safeResult.status, 200, scenario.id);
      const safeView = await json(safeResult);
      assert.equal(safeView.outcome.status, 'complete', scenario.id);
      assert.ok(safeView.outcome.receipt.changedProperties.length > 0, scenario.id);
      assert.deepEqual(await json(await request('/api/training/close', {
        method: 'POST', body: { sessionId: safeStart.sessionId },
      })), { closed: true });
      assert.equal((await request('/api/training/view', {
        method: 'POST', body: { sessionId: safeStart.sessionId },
      })).status, 410);

      const adverseStart = await json(await request('/api/training/start', {
        method: 'POST', body: { attackId: scenario.id, optIn: true },
      }));
      const adverse = action(adverseStart, 'adverse');
      const adverseResponse = await request('/api/training/action', {
        method: 'POST', body: { sessionId: adverseStart.sessionId, actionId: adverse.id },
      });
      assert.equal(adverseResponse.status, 200, scenario.id);
      const adverseView = await json(adverseResponse);
      assert.equal(adverseView.outcome.receipt.adverseActionIds[0], adverse.id, scenario.id);
      assert.equal((await request('/api/training/action', {
        method: 'POST', body: { sessionId: adverseStart.sessionId, actionId: action(adverseStart, 'safe').id },
      })).status, 409, `${scenario.id} rejects out-of-order action`);
      const recovered = await json(await request('/api/training/action', {
        method: 'POST', body: { sessionId: adverseStart.sessionId, actionId: action(adverseView, 'recovery').id },
      }));
      assert.equal(recovered.outcome.status, 'complete', scenario.id);
      assert.deepEqual(recovered.outcome.receipt.actionIds, [adverse.id, action(adverseView, 'recovery').id]);

      const reset = await json(await request('/api/training/reset', {
        method: 'POST', body: { sessionId: adverseStart.sessionId },
      }));
      assert.equal(reset.outcome.receipt.epoch, 2, scenario.id);
      assert.equal(reset.currentStep, adverseStart.currentStep, scenario.id);
      assert.deepEqual(reset.state, adverseStart.state, scenario.id);
      assert.deepEqual(await json(await request('/api/training/close', {
        method: 'POST', body: { sessionId: adverseStart.sessionId },
      })), { closed: true });
    }
  });
});

test('training routes enforce loopback origin, method, JSON size, opt-in, and exact body fields', async () => {
  await withServer(async ({ request }) => {
    assert.equal((await request('/api/training/scenarios', { origin: 'http://attacker.invalid' })).status, 403);
    assert.equal((await request('/api/training/start', {
      method: 'POST', origin: 'http://attacker.invalid', body: { attackId: 'oauth-2023', optIn: true },
    })).status, 403);
    const missingOptIn = await request('/api/training/start', {
      method: 'POST', body: { attackId: 'oauth-2023', optIn: false },
    });
    assert.equal(missingOptIn.status, 403);
    assert.equal((await json(missingOptIn)).code, 'OPT_IN_REQUIRED');
    assert.equal((await request('/api/training/start', {
      method: 'POST', body: { attackId: 'oauth-2023', optIn: true, password: 'not accepted' },
    })).status, 400);
    assert.equal((await request('/api/training/start', {
      method: 'POST', body: { attackId: 'not-selected', optIn: true },
    })).status, 404);
    assert.equal((await request('/api/training/start', {
      method: 'GET',
    })).status, 405);
    assert.equal((await request('/api/training/start', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    })).status, 415);
    assert.equal((await request('/api/training/start', {
      method: 'POST', body: `{"attackId":"oauth-2023","optIn":true,"padding":"${'x'.repeat(3000)}"}`,
    })).status, 413);

    const started = await json(await request('/api/training/start', {
      method: 'POST', body: { attackId: 'oauth-2023', optIn: true },
    }));
    for (const [path, body] of [
      ['/api/training/view', { sessionId: started.sessionId, target: 'arbitrary' }],
      ['/api/training/action', { sessionId: started.sessionId, actionId: 'oauth-deny', command: 'not accepted' }],
      ['/api/training/reset', { sessionId: started.sessionId, resetState: true }],
      ['/api/training/close', { sessionId: started.sessionId, target: 'arbitrary' }],
    ]) {
      assert.equal((await request(path, { method: 'POST', body })).status, 400, path);
    }
    const closed = await request('/api/training/close', {
      method: 'POST', body: { sessionId: started.sessionId },
    });
    assert.deepEqual(await json(closed), { closed: true });
  });
});

test('training session capacity is bounded and closing frees a slot', async () => {
  const store = new TrainingSessionStore({ maxSessions: 1 });
  await withServer(async ({ request }) => {
    const first = await json(await request('/api/training/start', {
      method: 'POST', body: { attackId: 'oauth-2023', optIn: true },
    }));
    const full = await request('/api/training/start', {
      method: 'POST', body: { attackId: 'zeus-2007', optIn: true },
    });
    assert.equal(full.status, 429);
    assert.equal((await json(full)).code, 'SESSION_LIMIT');
    assert.deepEqual(await json(await request('/api/training/close', {
      method: 'POST', body: { sessionId: first.sessionId },
    })), { closed: true });
    assert.equal((await request('/api/training/start', {
      method: 'POST', body: { attackId: 'zeus-2007', optIn: true },
    })).status, 200);
  }, store);
});

test('training session expiry is enforced by the HTTP view and close lifecycle', async () => {
  let now = 20_000;
  let nextId = 0;
  const store = new TrainingSessionStore({
    clock: () => now,
    idFactory: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
    lifetimeMs: 100,
  });
  await withServer(async ({ request }) => {
    const started = await json(await request('/api/training/start', {
      method: 'POST', body: { attackId: 'bec-2024', optIn: true },
    }));
    now += 99;
    assert.equal((await request('/api/training/reset', {
      method: 'POST', body: { sessionId: started.sessionId },
    })).status, 200);
    now += 1;
    const expired = await request('/api/training/view', {
      method: 'POST', body: { sessionId: started.sessionId },
    });
    assert.equal(expired.status, 410);
    assert.equal((await json(expired)).code, 'SESSION_EXPIRED');
    assert.deepEqual(await json(await request('/api/training/close', {
      method: 'POST', body: { sessionId: started.sessionId },
    })), { closed: true });
  }, store);
});

test('desktop routes are exact and the Abyss adapter only hands creatures to the profile matrix', async () => {
  await withServer(async ({ request }) => {
    const [page, css, script, adapter] = await Promise.all([
      request('/desktop.html'),
      request('/desktop.css'),
      request('/desktop.js'),
      request('/ui/abyss/desktop-entry.js'),
    ]);
    assert.equal(page.status, 200);
    assert.equal(css.status, 200);
    assert.equal(script.status, 200);
    assert.equal(adapter.status, 200, 'the adapter stays in the hash manifest');
    assert.equal((await request('/desktop-extra.js')).status, 404);

    const html = await (await request('/')).text();
    assert.match(html, /src="\/ui\/abyss\/desktop-entry\.js"/);
    const rendererTag = html.match(/<script[^>]+src="(\/ui\/abyss\/assets\/index-[^"/]+\.js)"/);
    assert.ok(rendererTag, 'the packaged renderer has a hashed module entry');
    assert.ok(html.indexOf('/ui/abyss/desktop-entry.js') < html.indexOf(rendererTag[1]), 'the integration adapter registers before the renderer');
    assert.match(entryHtml, /src="\/ui\/abyss\/desktop-entry\.js"/);
    assert.match(adapterJs, /window\.addEventListener\('abyss:enter-attack', enterAttack\)/);
    assert.match(adapterJs, /event\.preventDefault\(\)/);
    assert.match(adapterJs, /window\.location\.assign\('\/ocean-profiles\.html'\)/);
    assert.doesNotMatch(adapterJs, /iframe|fetch\(|XMLHttpRequest|\/api\/|attack=|desktop\.html|postMessage|innerHTML/);
  });
});
