import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createAppServer } from '../server.mjs';
import { createDesktopWorldSource, parseAllowHosts, parseUpstreamUrl } from '../backend/desktop-world-source.mjs';
import { DesktopEventHub, parseDesktopEvent, tokenMatches } from '../backend/desktop-world-events.mjs';
import { computeDesktopBuildId } from '../backend/desktop-world-build.mjs';

const M = createRequire(import.meta.url)('../ui/desktop/world-model.js');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const seed = JSON.parse(read('../data/desktop-world-seed.json'));
const PROCESS = { id: 'ev-proc', name: 'Ledger Sync (simulated)', cpu: 41, mem: 96, publisher: 'Unknown publisher', suspicious: true };
const SHELL_ORIGIN = 'http://127.0.0.1:4371';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function stop(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

const until = async (check, label, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const post = (base, run, body, headers = {}) => fetch(`${base}/api/desktop/events?run=${run}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

// A minimal EventSource over fetch: reconnects a dropped stream with Last-Event-ID (as browsers do) and closes on a
// refused one. `sources` collects every instance.
function eventSourceFor(base, sources = []) {
  return class TestEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    constructor(url) {
      Object.assign(this, { url: base + url, readyState: 0, lastEventId: '', onopen: null, onmessage: null, onerror: null });
      sources.push(this);
      this.connect();
    }
    async connect() {
      this.controller = new AbortController();
      let response;
      try {
        response = await fetch(this.url, { headers: { Accept: 'text/event-stream', ...(this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {}) }, signal: this.controller.signal });
      } catch {
        return this.drop();
      }
      if (!response.ok || !String(response.headers.get('content-type')).startsWith('text/event-stream')) {
        this.readyState = 2;
        this.onerror?.({});
        return;
      }
      this.readyState = 1;
      this.onopen?.({});
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          for (let end; (end = buffer.indexOf('\n\n')) >= 0; buffer = buffer.slice(end + 2)) this.frame(buffer.slice(0, end));
        }
      } catch { /* dropped */ }
      this.drop();
    }
    frame(text) {
      const data = [];
      for (const line of text.split('\n')) {
        const [field, ...rest] = line.split(':');
        const value = rest.join(':').replace(/^ /, '');
        if (field === 'data') data.push(value);
        else if (field === 'id') this.lastEventId = value;
      }
      if (data.length) this.onmessage?.({ data: data.join('\n'), lastEventId: this.lastEventId });
    }
    drop() {
      if (this.readyState === 2) return;
      this.readyState = 0;
      this.onerror?.({});
      setTimeout(() => { if (this.readyState !== 2) this.connect(); }, 30);
    }
    close() {
      this.readyState = 2;
      this.controller?.abort();
    }
  };
}

test('the upstream URL is loopback unless explicitly allowed, and never carries credentials, query or fragment', () => {
  assert.equal(parseUpstreamUrl('http://127.0.0.1:9000').href, 'http://127.0.0.1:9000/');
  assert.equal(parseUpstreamUrl('http://localhost:9000/controller').href, 'http://localhost:9000/controller/');
  assert.equal(parseUpstreamUrl('http://[::1]:9000/').hostname, '[::1]');
  assert.throws(() => parseUpstreamUrl('https://controller.vultr.example'), /not loopback/);
  assert.equal(parseUpstreamUrl('https://controller.vultr.example', parseAllowHosts(' Controller.Vultr.Example ,')).host, 'controller.vultr.example');
  for (const bad of ['http://user:pw@127.0.0.1/', 'http://127.0.0.1/?a=1', 'http://127.0.0.1/#x', 'file:///etc/passwd', 'ftp://127.0.0.1/', 'not a url']) {
    assert.throws(() => parseUpstreamUrl(bad), TypeError, bad);
  }
  assert.throws(() => parseAllowHosts('ok.example,bad/host'), /invalid host/);
  assert.throws(() => createDesktopWorldSource({ dir: 'data', url: 'http://127.0.0.1:1' }), /not both/);
  assert.throws(() => createAppServer({ desktopWorldUrl: 'https://controller.vultr.example' }), /not loopback/);
  assert.throws(() => createAppServer({ desktopEventsToken: 'short' }), /at least 16/);
});

test('DESKTOP_WORLD_DIR serves its own seed and profiles; a missing seed fails at start-up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-world-'));
  try {
    assert.throws(() => createDesktopWorldSource({ dir }), /must contain desktop-world-seed\.json/);
    writeFileSync(join(dir, 'desktop-world-seed.json'), JSON.stringify({ ...seed, user: { ...seed.user, name: 'Rae Lind', short: 'rae' } }));
    mkdirSync(join(dir, 'desktop-profiles'));
    writeFileSync(join(dir, 'desktop-profiles', 'demo-run.json'), JSON.stringify({ sys: { theme: 'light' } }));
    writeFileSync(join(dir, 'desktop-profiles', 'broken.json'), JSON.stringify({ sys: { theme: 'neon' } }));
    const server = createAppServer({ desktopWorldDir: dir });
    const base = await listen(server);
    try {
      let response = await fetch(`${base}/api/desktop/world`);
      assert.equal((await response.json()).user.short, 'rae');
      response = await fetch(`${base}/api/desktop/world?profile=demo-run`);
      assert.equal(response.headers.get('x-desktop-profile'), 'applied');
      assert.equal((await response.json()).sys.theme, 'light');
      assert.equal((await fetch(`${base}/api/desktop/world?profile=broken`)).status, 500);
      assert.equal((await fetch(`${base}/api/desktop/world?profile=deception-midnight`)).headers.get('x-desktop-profile'), 'none', 'the repo profiles are not read');
    } finally {
      await stop(server);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DESKTOP_WORLD_URL proxies a validated world from a loopback controller and forwards no client headers', async () => {
  const seen = [];
  let answer = () => ({ status: 200, body: JSON.stringify(M.createWorld(seed, { sys: { accent: 'green' } })), headers: { 'X-Desktop-Profile': 'applied' } });
  const upstream = createServer((request, response) => {
    seen.push({ url: request.url, headers: request.headers });
    const { status, body, headers = {} } = answer(request);
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    response.end(body);
  });
  const upstreamBase = await listen(upstream);
  const server = createAppServer({ desktopWorldUrl: `${upstreamBase}/controller` });
  const base = await listen(server);
  try {
    let response = await fetch(`${base}/api/desktop/world?profile=deception-midnight`, { headers: { Cookie: 'session=fictional', Authorization: 'Bearer fictional-client-token' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-desktop-profile'), 'applied');
    assert.equal((await response.json()).sys.accent, 'green');
    assert.equal(seen[0].url, '/controller/api/desktop/world?profile=deception-midnight');
    assert.equal(seen[0].headers.cookie, undefined);
    assert.equal(seen[0].headers.authorization, undefined);
    assert.equal(seen[0].headers.accept, 'application/json');
    response = await fetch(`${base}/api/desktop/world`);
    assert.equal(seen[1].url, '/controller/api/desktop/world');
    answer = () => ({ status: 200, body: JSON.stringify({ ...seed, sys: { ...seed.sys, wallpaperUrl: 'https://cdn.example/x.png' } }) });
    assert.equal((await fetch(`${base}/api/desktop/world`)).status, 502, 'an invalid upstream world is refused');
    answer = () => ({ status: 200, body: '{not json' });
    assert.equal((await fetch(`${base}/api/desktop/world`)).status, 502);
    answer = () => ({ status: 302, body: '{}', headers: { Location: 'http://127.0.0.1:1/' } });
    assert.equal((await fetch(`${base}/api/desktop/world`)).status, 502, 'redirects are not followed');
    answer = () => ({ status: 200, body: ' '.repeat(M.WORLD_MAX_BYTES * 2 + 1) });
    assert.equal((await fetch(`${base}/api/desktop/world`)).status, 502, 'oversized answers are cut off');
  } finally {
    await stop(server);
    await stop(upstream);
  }
});

test('events are exactly a patch that merges into a valid world or a valid replacement world', () => {
  const world = M.createWorld(seed);
  assert.deepEqual(parseDesktopEvent({ type: 'patch', patch: { data: { processes: [PROCESS] } } }, world), { type: 'patch', patch: { data: { processes: [PROCESS] } } });
  assert.equal(parseDesktopEvent({ type: 'replace', world }, world).type, 'replace');
  for (const [event, reason] of [
    [{ type: 'patch', patch: {} }, /non-empty/],
    [{ type: 'patch', patch: { revision: 9 } }, /may not set revision/],
    [{ type: 'patch', patch: { scene: null } }, /may not set scene/],
    [{ type: 'patch', patch: { sys: { wallpaperUrl: 'https://cdn.example/x.png' } } }, /patch is invalid/],
    [{ type: 'patch', patch: { data: { processes: [{ ...PROCESS, cpu: 900 }] } } }, /patch is invalid/],
    [{ type: 'patch', patch: { __proto__: null, constructor: {} } }, /patch is invalid/],
    [{ type: 'replace', world: { ...world, phase: 'party' } }, /world is invalid/],
    [{ type: 'patch', patch: {}, extra: 1 }, /exactly/],
    [{ type: 'remove' }, /exactly/],
    [null, /exactly/],
  ]) assert.throws(() => parseDesktopEvent(event, world), reason, JSON.stringify(event));
  assert.equal(tokenMatches('Bearer fictional-token-0123456789', 'fictional-token-0123456789'), true);
  assert.equal(tokenMatches('Bearer fictional-token-012345678', 'fictional-token-0123456789'), false);
  assert.equal(tokenMatches(undefined, 'fictional-token-0123456789'), false);
});

test('the hub caps runs and subscribers and keeps a bounded history', () => {
  const hub = new DesktopEventHub({ maxRuns: 2, maxClientsPerRun: 1, historySize: 2 });
  const fakeResponse = () => ({ written: [], writeHead() {}, write(chunk) { this.written.push(chunk); }, on() {}, end() { this.ended = true; } });
  const first = fakeResponse();
  assert.equal(hub.subscribe('a', first), true);
  assert.equal(hub.subscribe('a', fakeResponse()), false, 'one subscriber per run here');
  assert.equal(hub.subscribe('b', fakeResponse()), true);
  assert.equal(hub.subscribe('c', fakeResponse()), false, 'no idle run to evict');
  const ids = [1, 2, 3].map(n => hub.publish('a', { type: 'patch', patch: { sys: { volume: n } } }).id);
  assert.equal(first.written.filter(chunk => chunk.startsWith('id: ')).length, 3);
  const late = fakeResponse();
  hub.close();
  assert.equal(first.ended, true);
  const replay = new DesktopEventHub({ historySize: 2 });
  const eventIds = [1, 2, 3].map(n => replay.publish('a', { type: 'patch', patch: { sys: { volume: n } } }).id);
  replay.subscribe('a', late, eventIds[0]);
  assert.deepEqual(late.written.slice(1).map(chunk => chunk.split('\n')[0]), [`id: ${eventIds[1]}`, `id: ${eventIds[2]}`]);
  const otherBoot = fakeResponse();
  replay.subscribe('a', otherBoot, `${ids[0].split('-')[0]}x-0`);
  assert.equal(otherBoot.written.length, 1, 'ids from another server start replay nothing');
  replay.close();
});

test('GET /api/health reports the build id of the shells and parent files on disk', async () => {
  const server = createAppServer();
  const base = await listen(server);
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(Object.keys(health).sort(), ['buildId', 'ok']);
    assert.equal(health.ok, true);
    assert.match(health.buildId, /^[0-9a-f]{16}$/);
    assert.equal(health.buildId, computeDesktopBuildId(projectRoot));
  } finally {
    await stop(server);
  }
});

test('POST /api/desktop/events is loopback-only, validated and size-capped; GET streams it to subscribers with replay', async () => {
  const server = createAppServer();
  const base = await listen(server);
  const sources = [];
  const EventSource = eventSourceFor(base, sources);
  try {
    const got = [];
    const source = new EventSource('/api/desktop/events?run=http-run');
    source.onmessage = event => got.push({ id: event.lastEventId, ...JSON.parse(event.data) });
    await until(() => source.readyState === 1, 'stream open');
    let response = await post(base, 'http-run', { type: 'patch', patch: { data: { processes: [PROCESS] } } });
    assert.equal(response.status, 202);
    const published = await response.json();
    assert.equal(published.ok, true);
    assert.equal(published.delivered, 1);
    await until(() => got.length === 1, 'patch delivered');
    assert.deepEqual(got[0], { id: published.id, type: 'patch', patch: { data: { processes: [PROCESS] } } });

    assert.equal((await post(base, 'other-run', { type: 'patch', patch: { sys: { volume: 5 } } })).status, 202);
    assert.equal((await post(base, 'http-run', { type: 'patch', patch: { sys: { wallpaperUrl: 'https://cdn.example/x.png' } } })).status, 422);
    assert.equal((await post(base, 'http-run', '{oops')).status, 400);
    assert.equal((await post(base, 'http-run', '{}', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post(base, 'http-run', JSON.stringify({ type: 'patch', patch: { sys: { volume: 1 } }, pad: 'x'.repeat(400 * 1024) }))).status, 413);
    assert.equal((await post(base, 'http-run', { type: 'patch', patch: { sys: { volume: 1 } } }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(base, 'BAD_RUN', { type: 'patch', patch: { sys: { volume: 1 } } })).status, 400);
    assert.equal((await fetch(`${base}/api/desktop/events?run=http-run`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/desktop/events?run=http-run`, { method: 'PUT' })).status, 405);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(got.length, 1, 'refused and other-run events never reach this run');

    // A dropped stream reconnects with Last-Event-ID and receives what it missed, once.
    server.closeAllConnections();
    await until(() => source.readyState !== 1, 'stream dropped');
    response = await post(base, 'http-run', { type: 'patch', patch: { sys: { volume: 7 } } });
    assert.equal((await response.json()).delivered, 0);
    await until(() => got.length === 2, 'missed event replayed');
    assert.deepEqual(got[1].patch, { sys: { volume: 7 } });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(got.length, 2);
  } finally {
    for (const source of sources) source.close();
    await stop(server);
  }
});

test('with DESKTOP_EVENTS_TOKEN set, publishing needs the bearer token', async () => {
  const server = createAppServer({ desktopEventsToken: 'fictional-token-0123456789' });
  const base = await listen(server);
  try {
    const event = { type: 'patch', patch: { sys: { volume: 3 } } };
    assert.equal((await post(base, 'token-run', event)).status, 401);
    assert.equal((await post(base, 'token-run', event, { Authorization: 'Bearer wrong-token-0123456789' })).status, 401);
    assert.equal((await post(base, 'token-run', event, { Authorization: 'Bearer fictional-token-0123456789' })).status, 202);
    assert.equal((await post(base, 'token-run', event, { Authorization: 'Bearer fictional-token-0123456789', Origin: 'https://evil.example' })).status, 401);
  } finally {
    await stop(server);
  }
});

// ---- the real parent (desktop.js) subscribed to a real server ------------------------------------------------

class StubElement {
  constructor(id) {
    Object.assign(this, { id, hidden: false, textContent: '', checked: false, disabled: false, inert: false, href: '', title: '', className: '', type: '', dataset: {}, style: {}, attributes: {}, listeners: {}, children: [] });
    this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  fire(type) { for (const listener of this.listeners[type] ?? []) listener({ target: this }); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getBoundingClientRect() { return { x: 0, y: 0, width: 1000, height: 600 }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  focus() {}
}

class FakePort {
  postMessage(data) {
    const copy = structuredClone(data);
    setImmediate(() => this.peer?.onmessage?.({ data: copy }));
  }
  start() {}
  close() {}
}

function runParent(base, search) {
  const elements = new Map();
  const element = id => (elements.has(id) ? elements.get(id) : elements.set(id, new StubElement(id)).get(id));
  const shells = {};
  for (const os of ['windows', 'macos']) {
    const frame = element(`${os}-shell-frame`);
    const shell = shells[os] = { world: null };
    frame.contentWindow = {
      postMessage(message, origin, [port]) {
        port.onmessage = event => { if (event.data.type === 'world') shell.world = event.data.world; };
        port.postMessage({ type: 'ready', version: 3, shell: os, apps: [] });
      },
    };
    Object.defineProperty(frame, 'src', { set() { setTimeout(() => frame.fire('load'), 0); }, get: () => '' });
  }
  const sources = [];
  const warnings = [];
  const windowObject = {
    location: { search, assign() {}, replace() {} },
    matchMedia: () => ({ matches: true }),
    sessionStorage: { getItem: () => null, setItem() {} },
    EventSource: eventSourceFor(base, sources),
  };
  const context = vm.createContext({
    console: { ...console, warn: (...args) => warnings.push(args.join(' ')) },
    setTimeout, clearTimeout, structuredClone, queueMicrotask, TextEncoder, URLSearchParams, Date,
    MessageChannel: class { constructor() { this.port1 = new FakePort(); this.port2 = new FakePort(); this.port1.peer = this.port2; this.port2.peer = this.port1; } },
    document: { getElementById: element, body: { dataset: {} }, createElement: () => new StubElement(''), addEventListener() {} },
    window: windowObject,
    FileReader: class { readAsDataURL() { this.result = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; setTimeout(() => this.onload(), 0); } },
    fetch: (url, options = {}) => fetch(base + url, { method: options.method, headers: options.headers, body: options.body }),
  });
  context.window.queueMicrotask = queueMicrotask;
  for (const [path, filename] of [['../ui/desktop/desktop-model.js', 'desktop-model.js'], ['../ui/desktop/world-model.js', 'world-model.js'],
    ['../desktop-comparison/previews/ocean-scenes.js', 'ocean-scenes.js'], ['../ui/desktop/scene-world.js', 'scene-world.js']]) {
    new vm.Script(read(path), { filename }).runInContext(context);
  }
  windowObject.OceanFx = { play: () => ({ stop() {} }) };
  new vm.Script(read('../ui/desktop/desktop.js'), { filename: 'desktop.js' }).runInContext(context);
  const world = () => JSON.parse(JSON.stringify(windowObject.OceanDesktop.getWorld()));
  return { body: context.document.body.dataset, shells, sources, warnings, world };
}

test('a POSTed patch and replacement reach the real parent world and its visible shell; refused events are logged, not applied', async () => {
  const server = createAppServer({ templateShellsEnabled: true, shellOrigin: SHELL_ORIGIN });
  const base = await listen(server);
  const parent = runParent(base, '?profile=deception-abyss&run=parent-run');
  try {
    await until(() => parent.body.sessionState === 'profile-scene' && parent.body.worldStream === 'open', 'parent subscribed', 8000);
    assert.equal(parent.sources[0].url, `${base}/api/desktop/events?run=parent-run`);
    const before = parent.world();
    const mail = { id: 'ev-mail', folder: 'inbox', from: 'Ledger Bot <ledger@northwind.example>', to: before.user.email, subject: 'Files encrypted (simulated)',
      body: 'Fictional notice from the sandbox controller.', time: '2026-11-02T09:31:00Z', read: false, flagged: false, attachments: [] };
    const patch = { data: { processes: [PROCESS], mail: { messages: [...before.data.mail.messages, mail] } } };
    assert.equal((await post(base, 'parent-run', { type: 'patch', patch })).status, 202);
    await until(() => parent.world().data.processes?.[0]?.id === 'ev-proc', 'patch applied');
    let live = parent.world();
    assert.ok(live.revision > before.revision);
    assert.ok(live.data.mail.messages.some(item => item.id === 'ev-mail'));
    await until(() => parent.shells.windows.world?.revision === live.revision, 'visible shell updated');
    assert.equal(parent.shells.windows.world.data.processes[0].name, PROCESS.name);

    // A replacement keeps the session phase and becomes the restart world.
    const replacement = M.createWorld(seed, { user: { ...seed.user, name: 'Dana Okafor', short: 'dana', email: 'dana.okafor@northwind.example' } });
    assert.equal((await post(base, 'parent-run', { type: 'replace', world: replacement })).status, 202);
    await until(() => parent.world().user.short === 'dana', 'replacement applied');
    live = parent.world();
    assert.equal(live.phase, before.phase);
    assert.equal(live.data.processes, undefined);

    // An event the server did not check (injected into the stream; like a browser, it carries the last id) is refused and logged.
    const source = parent.sources[0];
    source.onmessage({ data: JSON.stringify({ type: 'patch', patch: { sys: { wallpaperUrl: 'https://cdn.example/x.png' } } }), lastEventId: source.lastEventId });
    source.onmessage({ data: 'not json', lastEventId: source.lastEventId });
    assert.deepEqual(parent.world(), live, 'refused events change nothing');
    assert.equal(parent.warnings.length, 2);
    assert.match(parent.warnings[0], /-2 refused: sys/);
    assert.match(parent.warnings[1], /-2 refused: unknown-event/);

    // A refused stream (server gone) is reopened by the parent and resumes after the last event id.
    source.close();
    source.onerror({});
    await until(() => parent.sources.length === 2, 'parent reopened the stream', 8000);
    assert.match(parent.sources[1].url, /&last=[0-9a-f]+-2$/);
  } finally {
    for (const source of parent.sources) source.close();
    await stop(server);
  }
});

test('events accept a sandbox patch and refuse an invalid one or a scene patch', () => {
  const world = JSON.parse(readFileSync(new URL('../data/desktop-world-seed.json', import.meta.url), 'utf8'));
  const sandbox = {
    runId: 'run-1', scenario: 'mydoom-2004', attackKind: 'mass-mail-worm', mode: 'simulated', status: 'running',
    events: [{ seq: 1, kind: 'provisioned', label: 'Sandbox ready', count: 0, total: 40 }], receipt: null,
  };
  assert.deepEqual(parseDesktopEvent({ type: 'patch', patch: { sandbox } }, world), { type: 'patch', patch: { sandbox } });
  assert.throws(() => parseDesktopEvent({ type: 'patch', patch: { sandbox: { ...sandbox, status: 'exploded' } } }, world), /sandbox/);
  assert.throws(() => parseDesktopEvent({ type: 'patch', patch: { scene: { creature: null } } }, world), /may not set scene/);
});
