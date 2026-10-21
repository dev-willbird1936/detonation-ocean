// GET /api/desktop/events for detonation replay runs (SPEC 9.1, 15.4): a replay id is 40 characters of a-z2-7 that only the job
// controller creates, by publishing. Subscribing to an unknown one is a 404 that leaves no hub entry, so callers cannot fill the
// hub's run slots; known ones are capped per run and per address. Other run ids keep the existing behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { DesktopEventHub } from '../backend/desktop-world-events.mjs';
import { newReplayId } from '../backend/detonation/jobs.mjs';
import { createAppServer } from '../server.mjs';

const PATCH = JSON.stringify({ type: 'patch', patch: { notifications: { banners: [], history: [] } } });

async function start(t, hubOptions) {
  const hub = new DesktopEventHub(hubOptions);
  const app = createAppServer({ desktopEvents: hub, detonation: { handle: async () => false, stop() {} } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const port = app.address().port;
  const open = [];
  t.after(async () => {
    for (const req of open) req.destroy();
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
  });
  // Resolves with the response status once the headers are in; a 200 stream stays open until `req.destroy()`.
  const subscribe = (run, ip = '203.0.113.1') => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: `/api/desktop/events?run=${run}`, headers: { 'X-Forwarded-For': ip } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      resolve({ status: res.statusCode, req, text: () => text });
    });
    open.push(req);
    req.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    req.end();
  });
  const publish = async run => {
    const response = await fetch(`http://127.0.0.1:${port}/api/desktop/events?run=${run}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: PATCH });
    assert.equal(response.status, 202);
  };
  return { hub, subscribe, publish };
}

async function until(check, what) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('subscribing to an unknown replay id is 404 and creates no hub entry, however many are tried', async t => {
  const { hub, subscribe, publish } = await start(t, { maxRuns: 4 });
  const ids = Array.from({ length: 12 }, () => newReplayId());
  for (const id of ids) {
    const refused = await subscribe(id);
    assert.equal(refused.status, 404);
    assert.equal(hub.has(id), false);
  }
  // The four run slots are all still free for real runs.
  for (const run of ['run-a', 'run-b', 'run-c', 'run-d']) await publish(run);
  assert.ok(['run-a', 'run-b', 'run-c', 'run-d'].every(run => hub.has(run)));
});

test('a replay id opens once the controller has published to it, and replays the history', async t => {
  const { hub, subscribe } = await start(t);
  const id = newReplayId();
  assert.equal((await subscribe(id)).status, 404);
  hub.publish(id, { type: 'patch', patch: { notifications: { banners: [], history: [] } } });
  const stream = await subscribe(id);
  assert.equal(stream.status, 200);
  await until(() => stream.text().includes(': connected'), 'the stream to open');
  assert.equal(hub.subscribers(id), 1);
});

test('at most 4 subscribers per replay run; a closed stream frees its place', async t => {
  const { hub, subscribe } = await start(t);
  const id = newReplayId();
  hub.publish(id, { type: 'patch', patch: { notifications: { banners: [], history: [] } } });
  const streams = [];
  for (let i = 0; i < 4; i += 1) {
    const stream = await subscribe(id, `198.51.100.${10 + i}`);
    assert.equal(stream.status, 200);
    streams.push(stream);
  }
  const fifth = await subscribe(id, '198.51.100.20');
  assert.equal(fifth.status, 503);
  assert.equal(hub.subscribers(id), 4);
  streams[0].req.destroy();
  await until(() => hub.subscribers(id) === 3, 'a place to be freed');
  assert.equal((await subscribe(id, '198.51.100.21')).status, 200);
});

test('at most 4 replay subscribers per address across runs; other addresses are unaffected', async t => {
  const { hub, subscribe } = await start(t);
  const ids = [newReplayId(), newReplayId()];
  for (const id of ids) hub.publish(id, { type: 'patch', patch: { notifications: { banners: [], history: [] } } });
  const mine = [];
  for (let i = 0; i < 4; i += 1) {
    const stream = await subscribe(ids[i % 2], '198.51.100.30');
    assert.equal(stream.status, 200);
    mine.push(stream);
  }
  assert.equal((await subscribe(ids[0], '198.51.100.30')).status, 503, 'fifth from the same address');
  assert.equal((await subscribe(ids[1], '198.51.100.31')).status, 200, 'another address');
  mine[0].req.destroy();
  await until(() => hub.subscribers(ids[0]) === 1, 'the address to get a place back');
  assert.equal((await subscribe(ids[0], '198.51.100.30')).status, 200);
});

test('training and scene run ids are unchanged: any valid id opens, the hub cap per run stays 8', async t => {
  const { hub, subscribe } = await start(t);
  const first = await subscribe('scene-run');
  assert.equal(first.status, 200);
  assert.equal(hub.has('scene-run'), true);
  for (let i = 1; i < 8; i += 1) assert.equal((await subscribe('scene-run')).status, 200, `subscriber ${i + 1}`);
  assert.equal((await subscribe('scene-run')).status, 503);
  // A 40-character id that is not a-z2-7 is not a replay id.
  assert.equal((await subscribe('0'.repeat(40))).status, 200);
});
