import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FIXTURE_SCENARIOS } from './fixtures/scenario-fixtures.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../ui/desktop/index.html');
const css = read('../ui/desktop/desktop.css');
const js = read('../ui/desktop/desktop.js');
const modelSource = read('../ui/desktop/desktop-model.js');
const worldSource = read('../ui/desktop/world-model.js');
const sceneWorldSource = read('../ui/desktop/scene-world.js');
const scenesSource = read('../desktop-comparison/previews/ocean-scenes.js');
const seed = JSON.parse(read('../data/desktop-world-seed.json'));
const scenarioProfileSource = read('../ui/desktop/scenario-profile.js');
const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];

test('desktop page is only the creature stage: safety gate, one slim control, the OS iframes, the hint, the debrief and one attack overlay', () => {
  assert.match(html, /<title>Creature desktop · Training only<\/title>/);
  assert.match(html, /href="\.\/desktop\.css"/);
  assert.match(html, /aria-live="polite"/);
  const stage = html.slice(html.indexOf('id="ocean-stage"'), html.indexOf('id="screen-reader-announcer"'));
  for (const id of ['ocean-gate', 'gate-opt-in', 'gate-enter', 'ocean-chrome', 'os-windows', 'os-macos', 'ocean-chip',
    'ocean-restart', 'ocean-exit', 'ocean-unavailable', 'windows-shell-frame', 'macos-shell-frame', 'ocean-fx-layer', 'ocean-fx-caption',
    'ocean-hint', 'ocean-debrief', 'ocean-intro', 'intro-dismiss', 'ocean-brief']) {
    assert.match(stage, new RegExp(`id="${id}"`), `${id} is inside the creature stage`);
  }
  assert.ok(stage.indexOf('id="macos-shell-frame"') < stage.indexOf('id="ocean-fx-layer"'), 'the attack overlay sits above both frames');
  assert.ok(stage.indexOf('id="ocean-fx-layer"') < stage.indexOf('id="ocean-chrome"'), 'the training controls sit above the attack overlay');
  assert.equal((stage.match(/id="ocean-fx-layer"/g) ?? []).length, 1, 'exactly one overlay');
  assert.match(stage, /role="dialog" aria-modal="true" aria-labelledby="gate-title"/);
  assert.match(stage, /id="ocean-debrief"[^>]*role="dialog" aria-labelledby="debrief-title" hidden/);
  assert.match(stage, /Fictional, local\. No camera, no real accounts, no real files\./);
  assert.match(stage, /<button id="gate-enter"[^>]*disabled>Enter the desktop<\/button>/);
  assert.match(stage, /<strong>Training only<\/strong>/);
  assert.match(stage, /id="os-windows"[^>]*aria-pressed="true"/);
  assert.match(stage, /id="os-macos"[^>]*aria-pressed="false"/);
  assert.match(stage, /id="windows-shell-frame"[^>]*data-active="true"/);
  assert.match(stage, /id="macos-shell-frame"[^>]*data-active="false" inert/);
  assert.equal((stage.match(/sandbox="allow-scripts" allow="camera 'none'; microphone 'none'/g) ?? []).length, 2, 'both shells: scripts only, no camera or microphone');
  assert.match(html, /<div id="ocean-stage" class="ocean-stage">/);
  const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['./desktop-model.js', './world-model.js', './ocean-scenes.js', ...DEPTHS.map(depth => `./ocean-scenarios/${depth}.js`),
    './scenario-profile.js', './ocean-fx.js', './scene-world.js', './desktop.js'],
  'both models, the scenes, the scenario data, the fx and the projection load before the parent script');
  assert.doesNotMatch(html, /creature-preview|template-shell-controls|template-shell-switch|profile-session-optin|Win11React|StarKnightt/);
  assert.doesNotMatch(html, /<input\b[^>]*type=["'](?:text|password|email|url)["']/i);
  assert.doesNotMatch(html, /(?:href|src)=["']https?:/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(css, /\.ocean-chrome \{[^}]*position: absolute;[^}]*top: 10px;[^}]*right: 12px;/);
  assert.match(css, /body\[data-os="macos"\] \.ocean-chrome \{ top: 29px; right: 380px; \}/, 'on macOS the controls leave the notification banners free');
  assert.match(css, /\.ocean-fx-layer \{[^}]*z-index: 10;[^}]*pointer-events: none;/);
  assert.match(css, /\.ocean-hint \{[^}]*pointer-events: none;/);
  assert.match(css, /iframe\[data-active="false"\] \{ visibility: hidden; pointer-events: none; \}/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.ocean-status \{ animation: none; \}/);
  assert.doesNotMatch(js, /\/api\/training|SCENARIO_IDS|attackId|training-opt-in|startSession|\/api\/ocean\/session/);
  assert.doesNotMatch(js, /type: 'scene-init'|type: 'desktop-state'|type: 'suspend'|previews\/windows11\/local\.html|previews\/mac\/local\.html/, 'the v2 shells and their protocol are retired');
  assert.doesNotMatch(js, /\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|new Function|\beval\s*\(/);
  assert.doesNotMatch(sceneWorldSource, /\bdocument\.|setTimeout|Math\.random|new Function|\beval\s*\(/, 'the projection is DOM-free and clock-free');
});

test('cloud and controller modes show a local-simulation notice and never offer an in-process session', () => {
  const loader = js.slice(js.indexOf('async function loadProfile('), js.indexOf('function setStatus'));
  assert.match(loader, /request\('\/api\/healthz'\)/);
  assert.match(loader, /state\.profileSimulationEnabled = health\.mode === 'local-synthetic'/);
  assert.match(loader, /if \(!state\.templatesEnabled\) \{[\s\S]*?runs no scripted scene and no in-process session[\s\S]*?return;/);
  assert.match(loader, /if \(!state\.scene\) \{[\s\S]*?The training scene did not load[\s\S]*?return;/, 'missing scene scripts fail closed');
  assert.ok(loader.indexOf('!state.templatesEnabled') < loader.indexOf('createState('), 'no desktop state exists in cloud modes');
  assert.match(js, /function proofIsAvailable\(\) \{\s*return state\.profile\?\.id === 'deception-abyss' && \(state\.profileSimulationEnabled \|\| state\.hackathonProofAvailable\);/);
  assert.match(js, /result\.effect === 'request-proof' && proofIsAvailable\(\)/);
  assert.match(js, /const PROOF_URL = '\/chamber\.html\?demo=oauth-2023&profile=deception-abyss'/);
  assert.match(js, /const SHELL_ORIGIN_RE = \/\^http:\\\/\\\/127\\\.0\\\.0\\\.1:\\d\{2,5\}\$\//, 'shells load only from a loopback origin');
});

const FAKE_PROFILE = Object.freeze({
  id: 'deception-abyss', familyId: 'deception', family: 'Deception', creature: 'Anglerfish',
  depthId: 'abyss', depth: 'Abyss', action: 'Takes control',
  assetUrl: '/ocean-creatures/anglerfish/abyss.gif',
  anchor: { id: 'bec-2024', name: 'Business email compromise', year: 2024, victimAction: 'Authorise a fraudulent payment', status: 'sourced' },
});
const WORM_PROFILE = Object.freeze({ ...FAKE_PROFILE, id: 'network-abuse-abyss', familyId: 'network-abuse', family: 'Network abuse', creature: 'Siphonophore', assetUrl: '/ocean-creatures/siphonophore/abyss.gif' });
const MIDNIGHT_PROFILE = Object.freeze({ ...FAKE_PROFILE, id: 'deception-midnight', depthId: 'midnight', depth: 'Midnight', assetUrl: '/ocean-creatures/anglerfish/midnight.gif' });
const PROFILE_CATALOG = Object.freeze(Array.from({ length: 30 }, (_, index) => (
  [FAKE_PROFILE, MIDNIGHT_PROFILE, WORM_PROFILE][index] ?? { ...FAKE_PROFILE, id: `filler-profile-${index}` }
)));
const HIDDEN_IN_HTML = new Set(['ocean-gate', 'ocean-chrome', 'ocean-unavailable', 'unavailable-proof', 'ocean-proof-link', 'ocean-fx-caption', 'ocean-hint', 'ocean-debrief', 'ocean-intro', 'ocean-brief']);
const realSetTimeout = setTimeout;
const PROOF_URL = '/chamber.html?demo=oauth-2023&profile=deception-abyss';

class StubElement {
  constructor(id, tag = 'div') {
    Object.assign(this, { id, tag, hidden: HIDDEN_IN_HTML.has(id), textContent: '', checked: false, disabled: false, inert: false, src: '', href: '', title: '', className: '', type: '', dataset: {}, style: {}, attributes: {}, listeners: {}, children: [] });
    this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  fire(type) { for (const listener of this.listeners[type] ?? []) listener({ target: this }); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 1000, height: 600 }; }
  append(...nodes) { this.children.push(...nodes.map(node => (typeof node === 'string' ? Object.assign(new StubElement(''), { textContent: node }) : node))); }
  replaceChildren() { this.children = []; }
  focus() {}
  // Depth-first: every descendant.
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  text() { return [this.textContent, ...this.children.map(child => child.text())].join(' '); }
}

// Runs the real desktop.js with both models, the projection and the scenes against stub DOM, fetch, MessageChannel,
// a recording OceanFx and two fake v3 shells. Time is virtual: `advance(ms)` fires timers.
async function runCreatureDesktop({
  mode = 'local-synthetic', inferenceConfigured = false, templates = true, optedIn = false, search = '?profile=deception-abyss',
  reducedMotion = false, scripts = true, profileId = 'deception-abyss', silentShell = null, world: worldResponse = null,
  profiles = PROFILE_CATALOG, scenarios = null, scenarioData = null, attackApi = false, sandboxStart = () => ({ status: 202 }),
}) {
  const sandboxPosts = [];
  const elements = new Map();
  const documentListeners = {};
  const element = id => (elements.has(id) ? elements.get(id) : elements.set(id, new StubElement(id)).get(id));
  const assigned = [];
  const requested = [];
  const storage = new Map(optedIn ? [['ocean-opt-in', profileId]] : []);
  const clock = { now: Date.parse('2026-11-02T09:30:00Z'), timers: [], nextId: 1 };
  let inflight = 0;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const settle = async () => {
    for (let quiet = 0; quiet < 3; quiet++) {
      await tick();
      while (inflight > 0) { await tick(); quiet = 0; }
    }
  };
  const fakeSetTimeout = (fn, ms = 0) => {
    const id = clock.nextId++;
    clock.timers.push({ id, at: clock.now + Math.max(0, ms), fn });
    return id;
  };
  const fakeClearTimeout = id => { clock.timers = clock.timers.filter(timer => timer.id !== id); };
  const advance = async ms => {
    const target = clock.now + ms;
    for (;;) {
      const due = clock.timers.filter(timer => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock.timers = clock.timers.filter(timer => timer !== due);
      clock.now = Math.max(clock.now, due.at);
      due.fn();
      await settle();
    }
    clock.now = target;
    await settle();
  };

  class FakePort {
    constructor() { this.onmessage = null; this.peer = null; }
    postMessage(data) {
      const copy = structuredClone(data);
      inflight++;
      setImmediate(() => { try { this.peer.onmessage?.({ data: copy }); } finally { inflight--; } });
    }
    start() {}
    close() { this.closed = true; }
  }
  class FakeChannel {
    constructor() { this.port1 = new FakePort(); this.port2 = new FakePort(); this.port1.peer = this.port2; this.port2.peer = this.port1; }
  }
  // A fake v3 shell: logs what the parent sends, keeps the last world and active flag, and can send world intents.
  const frames = {};
  for (const [id, os] of [['windows-shell-frame', 'windows'], ['macos-shell-frame', 'macos']]) {
    const frameElement = element(id);
    const frameState = frames[os] = {
      os, log: [], attaches: [], urls: [], port: null, world: null, active: null, seq: 0,
      raw(message) { frameState.port.postMessage(message); },
      send(intent, patch = {}) {
        frameState.raw({ type: 'world-intent', version: 3, revision: frameState.world?.revision ?? 0, seq: ++frameState.seq, intent, ...patch });
      },
    };
    frameElement.contentWindow = {
      postMessage(message, origin, ports) {
        frameState.attaches.push(JSON.parse(JSON.stringify(message)));
        if (silentShell === os) return;
        frameState.port = ports[0];
        ports[0].onmessage = event => {
          const data = JSON.parse(JSON.stringify(event.data));
          frameState.log.push(data);
          if (data.type === 'world') frameState.world = data.world;
          else if (data.type === 'world-active') frameState.active = data.active;
        };
        ports[0].postMessage({ type: 'ready', version: 3, shell: os, apps: [] });
      },
    };
    Object.defineProperty(frameElement, 'src', { set(url) { frameState.urls.push(url); realSetTimeout(() => frameElement.fire('load'), 0); }, get: () => '' });
  }
  const fx = {
    calls: [], stops: 0,
    play(options) {
      const run = { stop: () => { fx.stops++; } };
      fx.calls.push({ options, run, via: 'play' });
      return run;
    },
    finish() { fx.calls.at(-1).options.onDone(); },
  };
  if (attackApi) {
    fx.playAttack = options => {
      const run = { stop: () => { fx.stops++; } };
      fx.calls.push({ options, run, via: 'playAttack' });
      return run;
    };
  }
  const json = (body, headers = {}) => ({ ok: true, status: 200, headers: { get: name => headers[name.toLowerCase()] ?? null }, json: async () => structuredClone(body) });
  const windowObject = {
    location: { search, assign: url => assigned.push(url), replace: url => assigned.push(url) },
    matchMedia: () => ({ matches: reducedMotion }),
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  const context = vm.createContext({
    console, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, structuredClone, queueMicrotask, TextEncoder, URLSearchParams, MessageChannel: FakeChannel,
    Date: Object.assign(function FakeDate(...args) { return new Date(...(args.length ? args : [clock.now])); }, { now: () => clock.now, parse: Date.parse }),
    document: {
      getElementById: element, body: { dataset: {} }, createElement: tag => new StubElement('', tag),
      addEventListener: (type, listener) => { (documentListeners[type] ??= []).push(listener); },
    },
    window: windowObject,
    ...(scenarioData ? { OceanScenarioData: structuredClone(scenarioData) } : {}),
    FileReader: class { readAsDataURL() { this.result = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; realSetTimeout(() => this.onload(), 0); } },
    fetch: async (url, init) => {
      if (String(url).startsWith('/api/desktop/sandbox/run')) {
        sandboxPosts.push({ url, method: init?.method, body: JSON.parse(init?.body ?? 'null') });
        const answer = await sandboxStart(url, init);
        return { ok: answer.status === 202, status: answer.status, json: async () => ({}) };
      }
      requested.push(url);
      if (url === '/api/ocean/profiles') return json({ profiles, ...(scenarios ? { scenarios } : {}) });
      if (url === '/api/healthz') return json({ ok: true, mode, inferenceConfigured });
      if (url === '/api/desktop-templates/status') return json(templates ? { enabled: true, shellOrigin: 'http://127.0.0.1:4371' } : { enabled: false });
      if (url.startsWith('/api/desktop/world')) {
        const answer = worldResponse?.(url);
        if (answer) return answer;
        return json(seed, { 'x-desktop-profile': 'none' });
      }
      if (profiles.some(profile => profile.assetUrl === url)) return { ok: true, headers: { get: () => 'image/gif' }, blob: async () => ({ size: 24 }) };
      throw new Error(`unexpected request ${url}`);
    },
  });
  context.window.queueMicrotask = queueMicrotask;
  if (scripts) {
    for (const [source, filename] of [[modelSource, 'desktop-model.js'], [worldSource, 'world-model.js'], [scenesSource, 'ocean-scenes.js'], [scenarioProfileSource, 'scenario-profile.js'], [sceneWorldSource, 'scene-world.js']]) {
      new vm.Script(source, { filename }).runInContext(context);
    }
    windowObject.OceanFx = fx;
  }
  new vm.Script(js, { filename: 'desktop.js' }).runInContext(context);
  const body = context.document.body.dataset;
  const waitFor = async (check, label) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (check()) return;
      await new Promise(resolve => realSetTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const messages = (os, type) => frames[os].log.filter(message => message.type === type);
  const act = async (os, intent, patch) => { frames[os].send(intent, patch); await settle(); };
  const ready = async () => { await waitFor(() => body.sessionState === 'profile-scene', 'profile scene'); await settle(); };
  const api = () => windowObject.OceanDesktop;
  const host = value => JSON.parse(JSON.stringify(value));
  const scene = () => host(api().getScene());
  const world = () => host(api().getWorld());
  const debriefButton = label => element('ocean-debrief').all().find(node => node.tag === 'button' && node.textContent === label);
  return { element, body, frames, fx, documentListeners, sandboxPosts, assigned, requested, storage, clock, advance, settle, waitFor, messages, act, ready, api, scene, world, debriefButton, host };
}

function acceptGate(env) {
  env.element('gate-opt-in').checked = true;
  env.element('gate-opt-in').fire('change');
  env.element('gate-enter').fire('click');
}

// The shell's sign-in: the world moves lock -> desktop, and the scene signs in with it.
async function signIn(env, os = 'windows') {
  await env.act(os, { kind: 'set-phase', phase: 'desktop' });
}

const choose = (env, choiceId, os = 'windows') => env.act(os, { kind: 'scene-choice', choiceId });

// Plays the toast and the lure mail up to the consent page.
async function toConsent(env, os = 'windows') {
  await signIn(env, os);
  await env.advance(900);
  await env.act(os, { kind: 'open-app', app: 'mail' });
  await choose(env, 'follow-link', os);
  await env.advance(350);
  assert.equal(env.scene().scene.stepId, 'consent');
}

const FORWARD_DELAYS = { allow: 600, continue: 300, 'open-ledger': 350, release: 700 };
async function releasePayment(env, os = 'windows', delays = FORWARD_DELAYS) {
  await choose(env, 'allow', os);
  await env.advance(delays.allow);
  assert.equal(env.scene().scene.stepId, 'mailbox');
  await choose(env, 'continue', os);
  await env.advance(delays.continue);
  assert.equal(env.scene().scene.stepId, 'redirect');
  await choose(env, 'open-ledger', os);
  await env.advance(delays['open-ledger']);
  assert.equal(env.scene().scene.stepId, 'payment');
  assert.equal(env.fx.calls.length, 0, 'no attack animation before the payment is released');
  await choose(env, 'release', os);
  await env.advance(delays.release);
}

test('real desktop.js attaches both shells with bridge v3, sends the world and starts nothing before sign-in', async () => {
  const env = await runCreatureDesktop({});
  await env.ready();
  assert.equal(env.element('ocean-gate').hidden, false, 'the opt-in gate is open before consent');
  assert.equal(env.element('ocean-chrome').hidden, true);
  assert.equal(env.element('template-shell-host').inert, true);
  assert.deepEqual(env.frames.windows.urls, ['http://127.0.0.1:4371/previews/win11-final/index.html?oceanShell=1']);
  assert.deepEqual(env.frames.macos.urls, ['http://127.0.0.1:4371/previews/macos-final/index.html?oceanShell=1']);
  for (const os of ['windows', 'macos']) {
    assert.deepEqual(env.frames[os].attaches, [{ type: 'ocean-shell-attach', version: 3 }]);
    assert.deepEqual(env.frames[os].log.map(message => message.type), ['world', 'world-active'], `${os} gets the world, then its active flag`);
  }
  const [message] = env.messages('windows', 'world');
  assert.deepEqual(Object.keys(message).sort(), ['revision', 'type', 'version', 'world']);
  assert.equal(message.revision, message.world.revision);
  assert.equal(message.world.phase, 'lock');
  assert.equal(message.world.sys.wallpaper, 'depth-abyss', 'without a profile overlay the wallpaper follows the scene depth');
  assert.deepEqual(message.world.scene, { phase: 'boot', stepId: null, highlight: null });
  assert.deepEqual(env.frames.macos.world, message.world, 'both shells start from the same world');
  assert.deepEqual([env.frames.windows.active, env.frames.macos.active], [true, false]);
  assert.ok(env.requested.includes('/api/desktop/world?profile=deception-abyss'));

  acceptGate(env);
  assert.equal(env.element('ocean-gate').hidden, true);
  assert.equal(env.element('ocean-chrome').hidden, false);
  assert.equal(env.storage.get('ocean-opt-in'), 'deception-abyss');
  const before = env.frames.windows.log.length;
  await env.advance(120_000);
  assert.equal(env.frames.windows.log.length, before, 'a locked desktop schedules nothing, however long it sits');
  assert.equal(env.scene().auth, 'locked');
});

test('intents are ignored until the opt-in card is accepted; the stored opt-in skips the card but never the sign-in', async () => {
  const gated = await runCreatureDesktop({});
  await gated.ready();
  await signIn(gated);
  assert.equal(gated.world().phase, 'lock', 'no world change behind the gate');
  acceptGate(gated);
  await signIn(gated);
  assert.equal(gated.world().phase, 'desktop');
  assert.equal(gated.scene().auth, 'desktop');

  const env = await runCreatureDesktop({ optedIn: true });
  await env.ready();
  assert.equal(env.element('ocean-gate').hidden, true);
  assert.equal(env.element('ocean-proof-link').hidden, false);
  await env.advance(60_000);
  assert.equal(env.scene().auth, 'locked', 'nothing signs in by itself');
  await env.act('windows', { kind: 'open-app', app: 'mail' });
  assert.equal(env.world().windows.length, 0, 'apps do not open on the lock screen');
  await signIn(env);
  assert.deepEqual([env.scene().auth, env.scene().scene.phase], ['desktop', 'boot']);
  assert.equal(env.frames.windows.world.phase, 'desktop', 'the shell gets the signed-in world');
});

test('one journey through world intents: toast, mail, consent, mailbox, redirect, payment, one attack over world windows, debrief', async () => {
  const env = await runCreatureDesktop({ optedIn: true });
  await env.ready();
  await signIn(env);
  await env.advance(900);
  let world = env.frames.windows.world;
  assert.deepEqual(world.scene, { phase: 'lure', stepId: 'toast', highlight: { app: 'mail', ref: 'sc-mail' } });
  assert.deepEqual(world.notifications.banners.map(item => item.id), ['sc-toast']);
  assert.equal(env.element('ocean-hint').hidden, false);
  assert.match(env.element('ocean-hint').textContent, /Open Mail/);
  await env.act('windows', { kind: 'open-app', app: 'mail' });
  world = env.frames.windows.world;
  assert.equal(env.scene().scene.stepId, 'mail', 'opening Mail opens the notification');
  assert.deepEqual(world.windows.map(win => [win.app, win.payload]), [['mail', { messageId: 'sc-mail' }]]);
  await choose(env, 'follow-link');
  assert.equal(env.scene().scene.pendingActionId, 'follow-link');
  await env.advance(350);
  world = env.frames.windows.world;
  assert.equal(world.scene.stepId, 'consent');
  assert.ok(world.windows.some(win => win.app === 'browser' && win.payload.url === 'scene:sc-consent'), 'the consent page opens in the browser');
  await releasePayment(env);
  assert.equal(env.scene().scene.phase, 'attack');
  assert.equal(env.frames.windows.world.scene.highlight, null);
  assert.ok(env.frames.windows.world.data.processes.some(item => item.id === 'sc-proc'));
  assert.equal(env.fx.calls.length, 1);
  const [{ options }] = env.fx.calls;
  assert.deepEqual([options.familyId, options.depthId, options.reducedMotion], ['deception', 'abyss', false]);
  assert.equal(options.container, env.element('ocean-fx-layer'), 'the attack draws in the parent overlay');
  const windowTarget = options.targets.find(target => target.kind === 'window');
  const top = env.world().windows.find(win => win.id === env.world().order.at(-1));
  assert.deepEqual(env.host(windowTarget.rect), { x: top.rect.x, y: top.rect.y, width: top.rect.w, height: top.rect.h }, 'targets come from the world windows, topmost first');
  assert.match(env.element('ocean-fx-caption').textContent, /your approval is the credential/);
  options.onEvent('effect', {});
  assert.equal(env.element('ocean-fx-caption').textContent, 'The payment is released to new bank details.');

  env.fx.finish();
  await env.settle();
  assert.equal(env.scene().scene.phase, 'debrief');
  assert.equal(env.element('ocean-fx-caption').hidden, true);
  assert.equal(env.element('ocean-debrief').hidden, false, 'the debrief window opens');
  assert.match(env.element('ocean-debrief').text(), /Each approval unlocked the next step/);
  assert.match(env.element('ocean-debrief').text(), /Stages/);
  assert.equal(env.element('ocean-hint').hidden, true);
  env.fx.calls[0].options.onDone();
  await env.settle();
  assert.equal(env.fx.calls.length, 1, 'one FX instance for the whole attack');
  env.debriefButton('Close').fire('click');
  await env.settle();
  assert.equal(env.scene().scene.phase, 'done');
  assert.equal(env.element('ocean-debrief').hidden, true);
});

test('OS swap is visual only: the target shell gets the latest world, the inactive shell cannot speak, the attack never restarts', async () => {
  const env = await runCreatureDesktop({ optedIn: true });
  await env.ready();
  const swap = async os => {
    const from = os === 'macos' ? 'windows' : 'macos';
    env.element(`os-${os}`).fire('click');
    await env.settle();
    assert.deepEqual(env.frames[os].world, env.world(), `${os} has the parent's world after the swap`);
    assert.deepEqual([env.frames[os].active, env.frames[from].active], [true, false]);
    assert.equal(env.element(`${os}-shell-frame`).dataset.active, 'true');
    assert.equal(env.element(`${from}-shell-frame`).inert, true);
    assert.equal(env.element(`os-${os}`).attributes['aria-pressed'], 'true');
    assert.equal(env.body.os, os);
  };
  await swap('macos');
  await signIn(env, 'windows');
  assert.equal(env.scene().auth, 'locked', 'the hidden shell cannot sign in');
  await signIn(env, 'macos');
  await env.advance(900);
  await env.act('macos', { kind: 'open-app', app: 'mail' });
  await swap('windows');
  assert.equal(env.frames.windows.world.windows[0].payload.messageId, 'sc-mail', 'the same window and lure mail on the other OS');
  await choose(env, 'follow-link');
  await env.advance(350);
  await choose(env, 'allow');
  await env.advance(300);
  await swap('macos');
  assert.equal(env.scene().scene.pendingActionId, 'allow', 'a pending countdown survives the swap');
  await env.advance(300);
  assert.equal(env.frames.macos.world.scene.stepId, 'mailbox');
  const windowsLog = env.frames.windows.log.length;
  await choose(env, 'continue', 'macos');
  await env.advance(300);
  assert.equal(env.frames.windows.log.length, windowsLog, 'only the visible shell is kept current');
  await choose(env, 'open-ledger', 'macos');
  await env.advance(350);
  await choose(env, 'release', 'macos');
  await env.advance(700);
  assert.equal(env.fx.calls.length, 1);
  await swap('windows');
  await swap('macos');
  assert.equal(env.fx.calls.length, 1, 'swapping never restarts the attack');
  assert.equal(env.fx.stops, 0);
  env.fx.finish();
  await env.settle();
  await swap('windows');
  assert.equal(env.frames.windows.world.scene.phase, 'debrief');
});

test('stale, duplicate, foreign and malformed intents never change the world; refused intents resync the shell', async () => {
  const env = await runCreatureDesktop({ optedIn: true });
  await env.ready();
  await signIn(env);
  const windows = env.frames.windows;
  const revision = () => env.world().revision;
  await env.act('windows', { kind: 'open-app', app: 'notes' });
  const start = revision();
  const duplicate = { type: 'world-intent', version: 3, revision: start, seq: windows.seq, intent: { kind: 'open-app', app: 'calendar' } };
  windows.raw(duplicate);
  await env.settle();
  assert.equal(revision(), start, 'a repeated seq is dropped');
  for (const patch of [
    { version: 2 }, { type: 'desktop-intent' }, { seq: 'x' }, { extra: true },
    { intent: { kind: 'open-app', app: 'camera' } }, { intent: { kind: 'set-sys', patch: { wallpaperUrl: 'https://cdn.example/x.png' } } },
    { intent: { kind: 'scene-choice', choiceId: 'Format Disk' } },
  ]) {
    windows.send({ kind: 'open-app', app: 'calendar' }, patch);
    await env.settle();
    assert.equal(revision(), start, `rejected: ${JSON.stringify(patch)}`);
  }
  const pushes = env.messages('windows', 'world').length;
  await env.act('windows', { kind: 'close-window', id: 'w-nope' });
  assert.equal(env.messages('windows', 'world').length, pushes + 1, 'a refused intent re-sends the accepted world');
  for (const message of [{ type: 'scene-state', version: 2 }, { type: 'rendered', version: 2, runId: 'x', revision: 1 }, 'text', null]) windows.raw(message);
  await env.settle();
  assert.equal(revision(), start);
  assert.deepEqual(env.assigned, []);
});

test('Restart returns to the locked profile world with a new run and stops a running attack', async () => {
  const env = await runCreatureDesktop({ optedIn: true });
  await env.ready();
  await toConsent(env);
  const oldRun = env.scene().runId;
  await releasePayment(env);
  assert.equal(env.fx.calls.length, 1);
  env.element('ocean-restart').fire('click');
  await env.settle();
  assert.equal(env.fx.stops, 1, 'Restart stops the attack animation');
  assert.notEqual(env.scene().runId, oldRun);
  const world = env.frames.windows.world;
  assert.deepEqual([world.phase, world.windows.length, world.scene.phase], ['lock', 0, 'boot']);
  assert.doesNotMatch(JSON.stringify(world.data), /"sc-/, 'no scene content survives a restart');
  env.fx.calls[0].options.onDone();
  await env.settle();
  assert.equal(env.scene().scene.phase, 'boot', 'a late onDone of the old attack is ignored');
  await signIn(env);
  assert.equal(env.scene().auth, 'desktop');
});

test('debrief buttons: the safe replay is a new signed-in run, Pick another leaves, the proof opens only where offered', async () => {
  const env = await runCreatureDesktop({ optedIn: true });
  await env.ready();
  await toConsent(env);
  await releasePayment(env);
  env.fx.finish();
  await env.settle();
  const oldRun = env.scene().runId;
  env.debriefButton('Try the safe path').fire('click');
  await env.settle();
  assert.notEqual(env.scene().runId, oldRun);
  assert.deepEqual([env.scene().auth, env.scene().scene.replayMode, env.scene().scene.phase], ['desktop', 'guided-safe', 'boot']);
  assert.equal(env.element('ocean-debrief').hidden, true);
  await env.advance(900);
  await env.act('windows', { kind: 'open-app', app: 'mail' });
  await choose(env, 'follow-link');
  await env.advance(350);
  await choose(env, 'deny');
  await env.advance(1500);
  assert.equal(env.scene().scene.path, 'safe');
  assert.equal(env.fx.calls.length, 1, 'the safe path never plays the attack');
  assert.match(env.element('ocean-debrief').text(), /You broke the chain/);
  env.debriefButton('Open the separate OAuth consent exercise').fire('click');
  assert.deepEqual(env.assigned, [PROOF_URL]);
  env.debriefButton('Pick another creature').fire('click');
  assert.deepEqual(env.assigned, [PROOF_URL, '/ocean-profiles.html']);

  const other = await runCreatureDesktop({ optedIn: true, search: '?profile=deception-midnight', profileId: 'deception-midnight' });
  await other.ready();
  await signIn(other);
  await other.advance(900);
  await other.act('windows', { kind: 'open-app', app: 'mail' });
  await choose(other, 'follow-link');
  await other.advance(350);
  await choose(other, 'sign-in');
  await other.advance(600);
  other.fx.finish();
  await other.settle();
  assert.equal(other.debriefButton('Open the separate OAuth consent exercise'), undefined, 'no proof outside deception-abyss');
});

test('reduced motion reaches the model delays and the attack animation', async () => {
  const env = await runCreatureDesktop({ optedIn: true, reducedMotion: true });
  await env.ready();
  await signIn(env);
  await env.advance(300);
  assert.equal(env.scene().scene.stepId, 'toast', 'boot is shortened, sign-in is not skipped');
  await env.act('windows', { kind: 'open-app', app: 'mail' });
  await choose(env, 'follow-link');
  await env.advance(80);
  await releasePayment(env, 'windows', { allow: 80, continue: 80, 'open-ledger': 80, release: 80 });
  assert.equal(env.fx.calls[0].options.reducedMotion, true);
});

test('the attack watchdog and a throwing OceanFx both still reach the debrief', async () => {
  const env = await runCreatureDesktop({ optedIn: true });
  await env.ready();
  await toConsent(env);
  await releasePayment(env);
  await env.advance(29_999);
  assert.equal(env.scene().scene.phase, 'attack');
  await env.advance(1);
  assert.equal(env.scene().scene.phase, 'debrief');
  assert.equal(env.fx.stops, 1, 'the watchdog also stops the animation');

  const broken = await runCreatureDesktop({ optedIn: true });
  broken.fx.play = () => { throw new Error('canvas unavailable'); };
  await broken.ready();
  await toConsent(broken);
  await releasePayment(broken);
  await broken.advance(1500);
  assert.equal(broken.scene().scene.phase, 'debrief');
});

test('the flagship worm scene projects the consent page, mailbox access and sent copies into the world', async () => {
  const env = await runCreatureDesktop({ optedIn: true, search: '?profile=network-abuse-abyss', profileId: 'network-abuse-abyss' });
  await env.ready();
  await toConsent(env);
  const page = env.world().data.web.pages['sc-consent'];
  assert.equal(page.url, 'accounts.gleam-docs-share.example/connect');
  assert.deepEqual(page.choices.map(choice => choice.choiceId), ['allow', 'deny', 'report', 'close-tab']);
  await choose(env, 'allow');
  await env.advance(600);
  assert.equal(env.scene().scene.stepId, 'mailbox');
  assert.deepEqual(env.world().scene.highlight, { app: 'mail', ref: 'sc-mailbox' });
  assert.equal(env.world().data.mail.messages.filter(item => item.folder === 'sent' && item.id.startsWith('sc-sent-')).length, 4);
  await env.act('windows', { kind: 'data', store: 'mail', op: 'move', item: { id: 'sc-mailbox', folder: 'junk' } });
  await choose(env, 'report');
  await env.advance(1500);
  assert.equal(env.scene().scene.path, 'safe', 'reporting the app mail is the safe exit at the mailbox stage');
  assert.equal(env.world().data.mail.messages.find(item => item.id === 'sc-mailbox').folder, 'junk', 'the trainee move persists');
});

test('runtime configuration: profile overlay via the API, a broken overlay falls back to the seed, replaceWorld and patchWorld apply live', async () => {
  const overlay = structuredClone(seed);
  Object.assign(overlay.sys, { theme: 'light', accent: 'orange', wallpaper: 'depth-twilight' });
  overlay.user = { ...overlay.user, name: 'Jordan Blake', short: 'jordan', email: 'jordan.blake@contoso.example' };
  const env = await runCreatureDesktop({ optedIn: true, world: url => url.includes('?profile=')
    ? { ok: true, status: 200, headers: { get: name => (name === 'x-desktop-profile' ? 'applied' : null) }, json: async () => structuredClone(overlay) } : null });
  await env.ready();
  assert.deepEqual([env.world().sys.theme, env.world().sys.wallpaper, env.world().user.short], ['light', 'depth-twilight', 'jordan'], 'an applied overlay keeps its own wallpaper');

  const fallback = await runCreatureDesktop({ optedIn: true, world: url => (url.includes('?profile=') ? { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) } : null) });
  await fallback.ready();
  assert.deepEqual(fallback.requested.filter(url => url.startsWith('/api/desktop/world')), ['/api/desktop/world?profile=deception-abyss', '/api/desktop/world']);
  assert.equal(fallback.world().user.short, 'alex');

  const missing = await runCreatureDesktop({ optedIn: true, world: () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ v: 2 }) }) });
  await missing.waitFor(() => missing.body.sessionState === 'preview-error', 'unavailable notice');
  assert.equal(missing.element('unavailable-title').textContent, 'The desktop world did not load');
  assert.deepEqual(missing.frames.windows.urls, [], 'no shell is loaded without a valid world');

  await signIn(env);
  await env.advance(900);
  const before = env.world().revision;
  assert.deepEqual(env.host(env.api().patchWorld({ sys: { theme: 'dark', wallpaper: 'depth-trench' }, installed: ['files', 'browser', 'mail', 'settings'] })), { ok: true, revision: before + 1 });
  await env.settle();
  const patched = env.frames.windows.world;
  assert.deepEqual([patched.sys.theme, patched.sys.wallpaper, patched.installed.length], ['dark', 'depth-trench', 4]);
  assert.ok(patched.data.mail.messages.some(item => item.id === 'sc-mail'), 'a patch keeps the scene content');
  assert.equal(env.api().patchWorld({ sys: { wallpaperUrl: 'https://cdn.example/w.png' } }).ok, false, 'external wallpaper URLs are refused');
  assert.equal(env.api().patchWorld({ installed: ['camera'] }).error, 'culled-app');

  const replacement = structuredClone(seed);
  replacement.user = { ...replacement.user, name: 'Sam Novak', short: 'sam', email: 'sam.novak@fabrikam.example' };
  replacement.sys.wallpaperUrl = '/previews/win11-final/img/wallpaper/default/img0.jpg';
  const replaced = env.api().replaceWorld(replacement);
  assert.equal(replaced.ok, true);
  await env.settle();
  const live = env.frames.windows.world;
  assert.equal(live.revision, replaced.revision);
  assert.ok(live.revision > patched.revision, 'revisions only go up');
  assert.deepEqual([live.phase, live.user.short, live.sys.wallpaperUrl], ['desktop', 'sam', replacement.sys.wallpaperUrl], 'the session phase is kept');
  assert.equal(live.data.mail.messages.find(item => item.id === 'sc-mail').to, 'sam.novak@fabrikam.example', 'scene content is re-applied for the new user');
  assert.deepEqual(env.host(env.api().replaceWorld({ ...replacement, installed: ['xbox'] })), { ok: false, error: 'culled-app' });
});

test('real desktop.js shows a local-simulation notice and no scene when templates are off in cloud modes', async () => {
  for (const options of [
    { mode: 'vultr-hackathon-ready', inferenceConfigured: false, templates: false },
    { mode: 'vultr', templates: false },
  ]) {
    const env = await runCreatureDesktop(options);
    await env.waitFor(() => env.body.sessionState === 'preview-error', 'unavailable notice');
    assert.equal(env.element('ocean-unavailable').hidden, false);
    assert.match(env.element('unavailable-detail').textContent, /runs no scripted scene and no in-process session/);
    assert.equal(env.element('unavailable-proof').hidden, true);
    assert.equal(env.element('ocean-chrome').hidden, true);
    assert.deepEqual(env.frames.windows.urls, [], 'no OS iframe is loaded');
    assert.deepEqual(env.fx.calls, []);
    assert.equal(env.requested.some(url => url.startsWith('/api/desktop/world')), false, 'no world is fetched');
  }
  const proof = await runCreatureDesktop({ mode: 'vultr-hackathon-ready', inferenceConfigured: true, templates: false });
  await proof.waitFor(() => proof.body.sessionState === 'preview-error', 'unavailable notice');
  assert.equal(proof.element('unavailable-proof').hidden, false);
  assert.equal(proof.element('unavailable-proof').textContent, 'Open the gated OAuth worker proof');
});

test('real desktop.js fails closed when the scripts did not load or a shell never answers', async () => {
  const env = await runCreatureDesktop({ scripts: false });
  await env.waitFor(() => env.body.sessionState === 'preview-error', 'unavailable notice');
  assert.equal(env.element('unavailable-title').textContent, 'The training scene did not load');
  assert.deepEqual(env.frames.windows.urls, []);

  const silent = await runCreatureDesktop({ optedIn: true, silentShell: 'macos' });
  await silent.waitFor(() => silent.frames.macos.attaches.length > 0, 'attach');
  await silent.advance(14_999);
  assert.notEqual(silent.body.sessionState, 'preview-error');
  assert.ok(silent.frames.macos.attaches.length >= 2, 'the attach is retried');
  await silent.advance(1);
  assert.equal(silent.element('unavailable-title').textContent, 'The OS desktops did not connect');
});

test('desktop.html without a usable profile redirects to the creature matrix and starts nothing', async () => {
  for (const search of ['', '?profile=', '?attack=oauth-2023', '?profile=Not%20A%20Profile', '?profile=x', `?profile=${'a'.repeat(65)}`]) {
    const env = await runCreatureDesktop({ search });
    await env.settle();
    assert.deepEqual(env.assigned, ['/ocean-profiles.html'], `redirects for ${search || '(no query)'}`);
    assert.deepEqual(env.requested, [], 'no request is made for a missing or malformed profile');
  }
  const unknown = await runCreatureDesktop({ search: '?profile=not-a-real-profile' });
  await unknown.waitFor(() => unknown.assigned.length > 0, 'redirect for an unknown profile');
  assert.deepEqual(unknown.frames.windows.urls, [], 'an unknown profile loads no OS iframe');
});

// ---- scenario scenes: profile, creature, OS, intro card, Brief, sandbox hooks and the receipt (SCENARIOS-60-CONTRACT) ------------

const SCENARIO_PROFILES = PROFILE_CATALOG.map((profile, index) => (index === 3
  ? { ...FAKE_PROFILE, id: 'deception-sunlight', depthId: 'sunlight', depth: 'Sunlight', assetUrl: '/ocean-creatures/anglerfish/sunlight.gif' } : profile));
const SCENARIO_LIST = [{
  id: 'fixture-scareware-sunlight', name: 'Fixture Scareware', year: 2011, role: 'free', familyId: null, depthId: 'sunlight',
  victimAction: 'Click a pop-up that says the computer is infected', status: 'sourced',
}];
const SCENARIO_ID = 'fixture-scareware-sunlight';
const SANDBOX = {
  runId: 'run-1', scenario: SCENARIO_ID, attackKind: 'scareware', mode: 'simulated', status: 'running',
  events: [{ seq: 1, kind: 'provisioned', label: 'Sandbox ready', count: 0, total: 3 }], receipt: null,
};
const RECEIPT = { provider: 'docker', instance: 'sandbox-7', startedAt: '2026-11-02T09:30:00Z', destroyedAt: '2026-11-02T09:31:00Z', teardownConfirmed: true, egress: 'none', dataset: 'synthetic' };
const scenarioEnv = (extra = {}) => runCreatureDesktop({
  optedIn: true, profileId: SCENARIO_ID, search: `?profile=${SCENARIO_ID}`, profiles: SCENARIO_PROFILES, scenarios: SCENARIO_LIST,
  scenarioData: FIXTURE_SCENARIOS, attackApi: true, ...extra,
});
const pressEscape = env => { for (const listener of env.documentListeners.keydown ?? []) listener({ key: 'Escape', preventDefault() {} }); };

// Plays the fixture scenario to the attack: toast, the lure page, the downloaded file.
async function playScenarioToAttack(env) {
  await signIn(env, 'macos');
  await env.advance(900);
  await choose(env, 'open', 'macos');
  await env.advance(400);
  await choose(env, 'download', 'macos');
  await env.advance(600);
  await choose(env, 'run-file', 'macos');
  await env.advance(1200);
}

test('a scenario id plays on its family profile: creature in the world, the real victim OS first, intro and focus apps projected', async () => {
  const env = await scenarioEnv();
  await env.ready();
  assert.equal(env.body.os, 'macos', 'the scenario starts on the OS its real victim used');
  assert.equal(env.frames.macos.active, true);
  assert.equal(env.frames.windows.active, false);
  const { scene } = env.frames.macos.world;
  assert.deepEqual(scene.focusApps, ['browser', 'files']);
  assert.deepEqual(scene.creature, { family: 'deception', depth: 'sunlight', sprite: '/ocean-creatures/anglerfish/sunlight.gif', state: 'idle', targetApp: null });
  assert.deepEqual(scene.intro, {
    title: 'Fixture Scareware (2011)',
    line: 'The year is 2011. You are a home user using a web browser. You click a pop-up that says your computer is infected...',
    next: 'A cleaner download is about to appear.',
  });
  assert.equal(env.element('ocean-intro').hidden, true, 'the card waits for the sign-in');
  assert.equal(env.element('ocean-brief').hidden, false, 'the Brief button is there once the scenario has a card');
  assert.match(env.element('ocean-chip-detail').textContent, /Fixture Scareware \(2011\)/);
});

test('the intro card opens after the one-click sign-in, closes with the button or Esc, and Brief reopens it', async () => {
  const env = await scenarioEnv();
  await env.ready();
  await signIn(env, 'macos');
  const card = env.element('ocean-intro');
  assert.equal(card.hidden, false);
  assert.equal(env.element('intro-title').textContent, 'Fixture Scareware (2011)');
  assert.match(env.element('intro-line').textContent, /^The year is 2011\. You are a home user using a web browser\. You click a pop-up/);
  assert.equal(env.element('intro-next').textContent, 'A cleaner download is about to appear.');
  assert.equal(env.element('template-shell-host').inert, false, 'the card does not block the desktop');
  await env.advance(900);
  assert.equal(env.frames.macos.world.scene.creature.state, 'notice', 'the first step has appeared');

  pressEscape(env);
  assert.equal(card.hidden, true, 'Esc closes the card');
  env.element('ocean-brief').fire('click');
  assert.equal(card.hidden, false, 'Brief reopens it');
  env.element('ocean-brief').fire('click');
  assert.equal(card.hidden, true, 'Brief toggles it');
  env.element('ocean-brief').fire('click');
  env.element('intro-dismiss').fire('click');
  assert.equal(card.hidden, true, 'the Got it button closes it');
  pressEscape(env);
  assert.equal(card.hidden, true);

  env.element('ocean-restart').fire('click');
  await env.settle();
  assert.equal(card.hidden, true, 'a restart locks the desktop and hides the card until the next sign-in');
  await signIn(env, 'macos');
  assert.equal(card.hidden, false, 'the next sign-in shows it again');
});

test('the 30 family scenes show no card, no Brief button and no creature state', async () => {
  const env = await runCreatureDesktop({ optedIn: true, scenarios: SCENARIO_LIST, scenarioData: FIXTURE_SCENARIOS, attackApi: true });
  await env.ready();
  await signIn(env);
  assert.equal(env.element('ocean-intro').hidden, true);
  assert.equal(env.element('ocean-brief').hidden, true);
  assert.equal(env.body.os, 'windows');
  assert.equal(Object.hasOwn(env.frames.windows.world.scene, 'creature'), false);
});

test('breakthrough: the final choice sets the creature to breakthrough and hands OceanFx the attack kind and live sandbox access', async () => {
  const env = await scenarioEnv();
  await env.ready();
  await signIn(env, 'macos');
  await env.advance(900);
  await choose(env, 'open', 'macos');
  await env.advance(400);
  assert.equal(env.scene().scene.stepId, 'page');
  assert.equal(env.frames.macos.world.scene.creature.state, 'circle');
  await choose(env, 'download', 'macos');
  await env.advance(600);
  assert.equal(env.scene().scene.stepId, 'files');
  assert.equal(env.frames.macos.world.scene.creature.state, 'press');
  assert.equal(env.fx.calls.length, 0);
  await choose(env, 'run-file', 'macos');
  await env.advance(1200);
  assert.equal(env.scene().scene.phase, 'attack');
  assert.equal(env.frames.macos.world.scene.creature.state, 'breakthrough');
  assert.equal(env.fx.calls.length, 1);
  const [{ options, via }] = env.fx.calls;
  assert.equal(via, 'playAttack');
  assert.equal(options.attackKind, 'scareware');
  assert.equal(options.creature.family, 'deception');
  assert.match(options.creature.sprite, /^data:image\/gif;base64,|^\/ocean-creatures\//);
  assert.ok(options.timeoutMs < 30000, 'the animation ends before the V2 attack watchdog');
  assert.equal(options.subscribe, options.subscribeSandbox);
  assert.equal(options.familyId, 'deception');
  assert.equal(options.depthId, 'sunlight');
  assert.equal(options.getSandbox(), null, 'no sandbox event has arrived yet');

  const seen = [];
  const unsubscribe = options.subscribe(sandbox => seen.push(sandbox));
  assert.equal(typeof unsubscribe, 'function');
  assert.equal(env.api().patchWorld({ sandbox: SANDBOX }).ok, true);
  assert.equal(seen.length, 1);
  assert.deepEqual(env.host(seen[0].events), SANDBOX.events);
  assert.deepEqual(env.host(options.getSandbox()), SANDBOX);
  const more = [...SANDBOX.events, { seq: 2, kind: 'file-encrypted', label: 'Fake file 1 of 3', count: 1, total: 3 }];
  assert.equal(env.api().patchWorld({ sandbox: { events: more } }).ok, true);
  assert.equal(seen.length, 2);
  assert.equal(options.getSandbox().events.length, 2);
  assert.equal(env.api().patchWorld({ sandbox: { status: 'running' } }).ok, true);
  assert.equal(seen.length, 2, 'a patch that changes nothing is not announced');

  env.fx.finish();
  await env.settle();
  assert.equal(env.scene().scene.phase, 'debrief');
  assert.equal(env.api().patchWorld({ sandbox: { status: 'done' } }).ok, true);
  assert.equal(seen.length, 2, 'the animation stops listening when it is done');
});

test('the debrief shows the sandbox receipt when world.sandbox.receipt exists, also when it arrives later', async () => {
  const env = await scenarioEnv();
  await env.ready();
  await playScenarioToAttack(env);
  env.fx.finish();
  await env.settle();
  const panel = env.element('ocean-debrief');
  assert.equal(panel.hidden, false);
  assert.doesNotMatch(panel.text(), /Sandbox receipt/, 'no receipt, no panel');
  env.api().patchWorld({ sandbox: { ...SANDBOX, status: 'destroyed', receipt: RECEIPT } });
  await env.settle();
  assert.match(panel.text(), /Sandbox receipt/);
  for (const expected of ['docker', 'sandbox-7', 'simulated', 'Teardown confirmed', 'yes', 'Network egress', 'none', 'synthetic']) {
    assert.ok(panel.text().includes(expected), `the receipt shows ${expected}`);
  }
  assert.ok(env.debriefButton('Replay'), 'the debrief buttons survive the re-render');
});

test('without OceanFx.playAttack the parent falls back to OceanFx.play with the same options', async () => {
  const env = await scenarioEnv({ attackApi: false });
  await env.ready();
  await playScenarioToAttack(env);
  assert.equal(env.fx.calls.length, 1);
  assert.equal(env.fx.calls[0].via, 'play');
  assert.equal(env.fx.calls[0].options.attackKind, 'scareware');
});

test('an id that is neither a creature profile nor a scenario goes back to the matrix', async () => {
  const env = await scenarioEnv({ profileId: 'nope-2000', search: '?profile=nope-2000' });
  await new Promise(resolve => setImmediate(resolve));
  await env.settle();
  assert.deepEqual(env.assigned, ['/ocean-profiles.html']);
});

test('a scenario date starts the scene clock in its era and runs on in real time', async () => {
  const dated = structuredClone(FIXTURE_SCENARIOS);
  dated['fixture-scareware-sunlight'].date = '2010-01-05T15:20:00Z';
  // The profile's own mail predates the era (the seed's mail is dated 2026, so a dated scenario needs its own profile).
  const era = structuredClone(seed);
  for (const message of era.data.mail.messages) message.time = '2009-12-01T10:00:00Z';
  const env = await scenarioEnv({
    scenarioData: dated,
    world: () => ({ ok: true, status: 200, headers: { get: name => (name === 'x-desktop-profile' ? 'applied' : null) }, json: async () => structuredClone(era) }),
  });
  await env.ready();
  await signIn(env, 'macos');
  await env.advance(900);
  const lure = env.world().notifications.history.find(item => item.id === 'sc-toast');
  assert.match(lure.time, /^2010-01-05T15:2\d:\d\dZ$/);
});

test('the attack starts one sandbox run for the page run id, and clears a stale sandbox first', async () => {
  const env = await scenarioEnv({ search: `?profile=${SCENARIO_ID}&run=demo-7` });
  await env.ready();
  await signIn(env, 'macos');
  await env.advance(900);
  await choose(env, 'open', 'macos');
  await env.advance(400);
  await choose(env, 'download', 'macos');
  await env.advance(600);
  assert.equal(env.sandboxPosts.length, 0, 'nothing starts before the final forward choice');
  env.api().patchWorld({ sandbox: { ...SANDBOX, status: 'destroyed', receipt: RECEIPT } });
  await choose(env, 'run-file', 'macos');
  await env.advance(1200);
  assert.deepEqual(env.sandboxPosts, [{ url: '/api/desktop/sandbox/run?run=demo-7', method: 'POST', body: { scenarioId: SCENARIO_ID } }]);
  assert.equal(env.world().sandbox ?? null, null, 'the previous run is cleared before the new one streams in');
  assert.equal(env.fx.calls.length, 1);
  env.fx.finish();
  await env.settle();
  assert.doesNotMatch(env.element('ocean-debrief').text(), /Sandbox unavailable/);
});

test('without ?run= the sandbox run uses the local run id, and family scenes start no run', async () => {
  const env = await scenarioEnv();
  await env.ready();
  await playScenarioToAttack(env);
  assert.equal(env.sandboxPosts[0].url, '/api/desktop/sandbox/run?run=local');
  const family = await runCreatureDesktop({ optedIn: true, scenarios: SCENARIO_LIST, scenarioData: FIXTURE_SCENARIOS, attackApi: true });
  await family.ready();
  await signIn(family);
  assert.equal(family.sandboxPosts.length, 0);
});

test('a sandbox that cannot start does not break the scene: the animation still plays and the debrief says so', async () => {
  for (const sandboxStart of [() => ({ status: 503 }), () => ({ status: 409 }), () => { throw new Error('network down'); }]) {
    const env = await scenarioEnv({ sandboxStart });
    await env.ready();
    await playScenarioToAttack(env);
    assert.equal(env.scene().scene.phase, 'attack');
    assert.equal(env.fx.calls.length, 1, 'OceanFx still plays; it falls back to its own sequence');
    env.fx.finish();
    await env.settle();
    assert.equal(env.scene().scene.phase, 'debrief');
    const panel = env.element('ocean-debrief');
    assert.match(panel.text(), /Sandbox unavailable/);
    assert.doesNotMatch(panel.text(), /Sandbox receipt/);
    assert.ok(env.debriefButton('Replay'));
  }
});

test('a late receipt replaces the unavailable note, and a started run shows no note', async () => {
  const env = await scenarioEnv({ sandboxStart: () => ({ status: 503 }) });
  await env.ready();
  await playScenarioToAttack(env);
  env.fx.finish();
  await env.settle();
  assert.match(env.element('ocean-debrief').text(), /Sandbox unavailable/);
  env.api().patchWorld({ sandbox: { ...SANDBOX, status: 'destroyed', receipt: RECEIPT } });
  await env.settle();
  assert.doesNotMatch(env.element('ocean-debrief').text(), /Sandbox unavailable/);
  assert.match(env.element('ocean-debrief').text(), /Sandbox receipt/);
  const ok = await scenarioEnv();
  await ok.ready();
  await playScenarioToAttack(ok);
  ok.fx.finish();
  await ok.settle();
  assert.doesNotMatch(ok.element('ocean-debrief').text(), /Sandbox unavailable/);
});
