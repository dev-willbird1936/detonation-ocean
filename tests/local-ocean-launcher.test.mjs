import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalOceanServer, oceanRevision } from '../tools/start-local-ocean.mjs';

let server, base;
test.before(async () => {
  process.env.VULTR_SANDBOX_MODE = 'vultr';
  process.env.VULTR_API_KEY = 'test-sentinel-not-a-secret';
  server = await createLocalOceanServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await server?.teardownActiveResources();
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

const post = (route, input) => fetch(base + '/api/training/' + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});

test('launcher removes inherited provider settings and reports the actual source revision', async () => {
  assert.equal(process.env.VULTR_API_KEY, undefined);
  assert.equal(process.env.VULTR_SANDBOX_MODE, 'local');
  const response = await fetch(base + '/api/local-ocean-version');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { mode: 'local-synthetic', theme: 'ocean', revision: oceanRevision() });
});

test('root opens ocean desktop; served HTML/CSS/JS equal current durable source', async () => {
  const root = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/desktop.html');
  for (const [route, file] of [['/desktop.html', 'index.html'], ['/desktop.css', 'desktop.css'], ['/desktop.js', 'desktop.js']]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), readFileSync(new URL('../local-ocean/ui/desktop/' + file, import.meta.url), 'utf8'));
  }
});

test('all ten synthetic scenarios start explicitly and close with no reusable session', async () => {
  const catalogue = await (await fetch(base + '/api/training/scenarios')).json();
  assert.equal(catalogue.length, 10);
  for (const scenario of catalogue) {
    const refused = await post('start', { attackId: scenario.id, optIn: false });
    assert.notEqual(refused.status, 200);
    await refused.text();
    const started = await post('start', { attackId: scenario.id, optIn: true });
    assert.equal(started.status, 200);
    const view = await started.json();
    assert.equal(view.executionMode, 'local-synthetic-in-process');
    const ended = await post('close', { sessionId: view.sessionId });
    assert.deepEqual(await ended.json(), { closed: true });
    const closed = await post('view', { sessionId: view.sessionId });
    assert.equal(closed.status, 410);
    await closed.text();
  }
});

test('batch launcher never builds gallery files or reuses a stale health check', () => {
  const bat = readFileSync(new URL('../start.bat', import.meta.url), 'utf8');
  assert.match(bat, /node tools\\start-local-ocean\.mjs/);
  assert.doesNotMatch(bat, /build\.mjs|Invoke-RestMethod|4173|AppData|Temp/);
});
