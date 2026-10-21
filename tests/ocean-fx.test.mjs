import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../desktop-comparison/previews/ocean-fx.js', import.meta.url), 'utf8');
const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];
const DATA_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

// Minimal DOM: enough for tree building, attribute/style writes and node counting.
function createFakeDom() {
  const doc = {
    createElement(tag) {
      const node = {
        tag, style: { cssText: '' }, children: [], parentNode: null, attrs: {}, textContent: '', ownerDocument: doc,
        appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
        removeChild(child) {
          const i = node.children.indexOf(child);
          if (i < 0) throw new Error('not a child');
          node.children.splice(i, 1);
          child.parentNode = null;
          return child;
        },
        setAttribute(name, value) { node.attrs[name] = String(value); },
      };
      return node;
    },
  };
  return doc;
}

const countNodes = node => node.children.reduce((n, c) => n + 1 + countNodes(c), 0);
const allNodes = node => node.children.flatMap(c => [c, ...allNodes(c)]);

// Fake clock driving rAF and timers; step() advances 16 ms.
function createSandbox({ starveRaf = false } = {}) {
  let now = 0;
  let nextId = 1;
  let rafQueue = [];
  const timers = new Map();
  const sandbox = {
    console,
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  sandbox.requestAnimationFrame = cb => { const id = nextId++; rafQueue.push({ id, cb }); return id; };
  sandbox.cancelAnimationFrame = id => { rafQueue = rafQueue.filter(r => r.id !== id); };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'ocean-fx.js' });
  const clock = {
    get now() { return now; },
    pendingRaf: () => rafQueue.length,
    pendingTimers: () => timers.size,
    step(ms = 16) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
      if (starveRaf) return;
      const queue = rafQueue;
      rafQueue = [];
      queue.forEach(r => r.cb(now));
    },
    run(maxMs, until) {
      for (let spent = 0; spent < maxMs && !until(); spent += 16) clock.step();
    },
  };
  return { OceanFx: sandbox.OceanFx, clock, sandbox };
}

function playToEnd(familyId, depthId, extra = {}) {
  const { OceanFx, clock } = createSandbox();
  const doc = createFakeDom();
  const container = doc.createElement('div');
  const events = [];
  let done = 0;
  OceanFx.play({
    familyId, depthId, container,
    creatureSrc: null, targets: [],
    onEvent: (name, detail) => events.push({ name, detail, nodes: countNodes(container) }),
    onDone: () => { done++; },
    ...extra,
  });
  assert.ok(countNodes(container) > 10, 'overlay nodes are drawn into the container');
  clock.run(12000, () => done > 0);
  return { events, done, container, clock };
}

test('OceanFx exposes the contract API', () => {
  const { OceanFx } = createSandbox();
  assert.equal(OceanFx.version, 1);
  assert.deepEqual([...OceanFx.families], FAMILIES);
  assert.deepEqual([...OceanFx.depths], DEPTHS);
  assert.equal(typeof OceanFx.play, 'function');
  const doc = createFakeDom();
  const handle = OceanFx.play({ familyId: 'deception', depthId: 'abyss', container: doc.createElement('div') });
  assert.equal(typeof handle.stop, 'function');
  handle.stop();
});

test('play rejects bad ids, missing options and missing container', () => {
  const { OceanFx } = createSandbox();
  const container = createFakeDom().createElement('div');
  const good = { familyId: 'intrusion', depthId: 'midnight', container };
  assert.throws(() => OceanFx.play(), { name: 'TypeError' });
  assert.throws(() => OceanFx.play(null), { name: 'TypeError' });
  assert.throws(() => OceanFx.play({ ...good, familyId: 'phishing' }), { name: 'TypeError' });
  assert.throws(() => OceanFx.play({ ...good, familyId: undefined }), { name: 'TypeError' });
  assert.throws(() => OceanFx.play({ ...good, depthId: 'surface' }), { name: 'TypeError' });
  assert.throws(() => OceanFx.play({ ...good, container: null }), { name: 'TypeError' });
  assert.throws(() => OceanFx.play({ ...good, container: {} }), { name: 'TypeError' });
  assert.equal(container.children.length, 0, 'rejected calls leave nothing behind');
});

test('all 30 family/depth combinations emit ordered events, run 6-9 s, call onDone and clean up', () => {
  for (const familyId of FAMILIES) {
    for (const depthId of DEPTHS) {
      const { events, done, container, clock } = playToEnd(familyId, depthId);
      const label = `${familyId}/${depthId}`;
      assert.equal(done, 1, `${label}: onDone called once`);
      assert.deepEqual(events.map(e => e.name), ['swim-in', 'strike', 'effect', 'swim-out', 'done'], label);
      const ms = events.at(-1).detail.elapsedMs;
      assert.ok(ms >= 6000 && ms <= 9000, `${label}: ${ms} ms within 6-9 s`);
      assert.equal(events.at(-1).nodes, 0, `${label}: nodes removed before done`);
      assert.equal(container.children.length, 0, label);
      assert.equal(clock.pendingRaf(), 0, `${label}: no rAF left`);
      assert.equal(clock.pendingTimers(), 0, `${label}: no timer left`);
    }
  }
});

test('deeper depths run a longer sequence', () => {
  const durations = DEPTHS.map(depthId => playToEnd('theft-surveillance', depthId).events.at(-1).detail.elapsedMs);
  for (let i = 1; i < durations.length; i++) assert.ok(durations[i] > durations[i - 1], durations.join(','));
});

test('reducedMotion completes quickly for every family and cleans up', () => {
  for (const familyId of FAMILIES) {
    const { events, done, container } = playToEnd(familyId, 'abyss', { reducedMotion: true });
    assert.equal(done, 1, familyId);
    assert.deepEqual(events.map(e => e.name), ['swim-in', 'strike', 'effect', 'swim-out', 'done'], familyId);
    assert.ok(events.at(-1).detail.elapsedMs < 4500, `${familyId}: short reduced sequence`);
    assert.equal(container.children.length, 0, familyId);
  }
});

test('stop() removes every node, cancels rAF and timers, skips onDone and is idempotent', () => {
  const { OceanFx, clock } = createSandbox();
  const container = createFakeDom().createElement('div');
  const names = [];
  let done = 0;
  const handle = OceanFx.play({ familyId: 'network-abuse', depthId: 'trench', container, onEvent: n => names.push(n), onDone: () => { done++; } });
  clock.run(3000, () => false);
  assert.ok(countNodes(container) > 10);
  handle.stop();
  handle.stop();
  assert.equal(container.children.length, 0);
  assert.equal(clock.pendingRaf(), 0);
  assert.equal(clock.pendingTimers(), 0);
  clock.run(12000, () => false);
  assert.equal(done, 0);
  assert.ok(!names.includes('done'));
});

test('a repeated play() replaces the earlier run instead of stacking overlays', () => {
  const { OceanFx, clock } = createSandbox();
  const container = createFakeDom().createElement('div');
  let firstDone = 0;
  let secondDone = 0;
  OceanFx.play({ familyId: 'deception', depthId: 'sunlight', container, onDone: () => { firstDone++; } });
  clock.run(1000, () => false);
  OceanFx.play({ familyId: 'intrusion', depthId: 'twilight', container, onDone: () => { secondDone++; } });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].attrs['data-ocean-fx'], 'intrusion');
  clock.run(12000, () => secondDone > 0);
  assert.equal(firstDone, 0);
  assert.equal(secondDone, 1);
  assert.equal(container.children.length, 0);
});

test('the fallback timer finishes the sequence when rAF never fires', () => {
  const { OceanFx, clock } = createSandbox({ starveRaf: true });
  const container = createFakeDom().createElement('div');
  let done = 0;
  OceanFx.play({ familyId: 'trusted-source', depthId: 'midnight', container, onDone: () => { done++; } });
  for (let ms = 0; ms < 12000 && !done; ms += 100) clock.step(100);
  assert.equal(done, 1);
  assert.equal(container.children.length, 0);
});

test('targets are capped, labels truncated, unknown kinds and fields tolerated', () => {
  const { OceanFx, clock } = createSandbox();
  const container = createFakeDom().createElement('div');
  const targets = Array.from({ length: 20 }, (_, i) => ({ label: i === 0 ? 'A'.repeat(100) : `item-${i}`, kind: i % 2 ? 'file' : 'bogus', evil: '<img>', rect: i === 1 ? { x: 10, y: 20, width: 100, height: 50 } : 'nope' }));
  targets.push(null, 5, { label: '' }, { kind: 'file' });
  OceanFx.play({ familyId: 'theft-surveillance', depthId: 'abyss', container, targets, unknownField: true });
  clock.run(3000, () => false);
  const texts = allNodes(container).map(n => n.textContent).filter(Boolean);
  assert.ok(texts.includes('A'.repeat(40)), 'label cut to 40 characters');
  assert.ok(!texts.some(t => t.includes('A'.repeat(41))));
  assert.ok(!texts.some(t => t.includes('<img>')));
  assert.ok(texts.filter(t => /^item-\d+/.test(t)).length <= 7, 'at most 8 cards drawn for theft');
  assert.ok(allNodes(container).every(n => n.tag !== 'img'), 'no creature image without creatureSrc');
});

test('creatureSrc: data: URLs render as pixelated images, other schemes are ignored', () => {
  const { OceanFx } = createSandbox();
  const doc = createFakeDom();
  const withData = doc.createElement('div');
  OceanFx.play({ familyId: 'deception', depthId: 'sunlight', container: withData, creatureSrc: DATA_GIF });
  const imgs = allNodes(withData).filter(n => n.tag === 'img');
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].src, DATA_GIF);
  assert.match(imgs[0].style.cssText, /image-rendering:pixelated/);
  const external = doc.createElement('div');
  OceanFx.play({ familyId: 'deception', depthId: 'sunlight', container: external, creatureSrc: 'https://example.invalid/x.gif' });
  assert.equal(allNodes(external).filter(n => n.tag === 'img').length, 0);
});

test('throwing host callbacks do not break the sequence', () => {
  const { OceanFx, clock } = createSandbox();
  const container = createFakeDom().createElement('div');
  let done = 0;
  OceanFx.play({
    familyId: 'extortion-destruction', depthId: 'trench', container,
    onEvent() { throw new Error('boom'); },
    onDone() { done++; throw new Error('boom'); },
  });
  clock.run(12000, () => done > 0);
  assert.equal(done, 1);
  assert.equal(container.children.length, 0);
});

test('overlay root is a single non-interactive aria-hidden layer inside the container', () => {
  const { OceanFx, clock } = createSandbox();
  const container = createFakeDom().createElement('div');
  OceanFx.play({ familyId: 'extortion-destruction', depthId: 'trench', container });
  clock.run(5000, () => false);
  const root = container.children[0];
  assert.match(root.style.cssText, /pointer-events:none/);
  assert.equal(root.attrs['aria-hidden'], 'true');
  assert.equal(container.children.length, 1);
});

test('source has no network, media, storage, eval or external URL access', () => {
  for (const banned of ['fetch(', 'XMLHttpRequest', 'http://', 'https://', 'getUserMedia', 'eval(', 'new Function', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'innerHTML', 'import(', 'importScripts']) {
    assert.ok(!source.includes(banned), `ocean-fx.js must not contain ${banned}`);
  }
  assert.equal([...source.matchAll(/window\.(\w+)\s*=/g)].map(m => m[1]).join(','), 'OceanFx');
});

// ---- playAttack: breakthrough, one animation per attackKind, sandbox-event driven

const ATTACK_KINDS = ['scareware', 'credential-phish', 'mfa-fatigue', 'oauth-consent', 'mass-mail-worm', 'macro-dropper', 'ransomware-encrypt', 'data-exfil', 'money-transfer', 'wallet-drain', 'supply-chain-update', 'network-worm', 'botnet-ddos', 'account-takeover-post', 'sim-swap', 'spyware-surveillance', 'server-exploit-leak'];

// World-side stand-in: world.sandbox plus the subscribe/getSandbox pair the engine hands to playAttack.
function fakeSandbox(extra = {}) {
  const state = { runId: 'run-1', scenario: 'mydoom-2004', attackKind: 'x', mode: 'docker', status: 'running', events: [], receipt: null, ...extra };
  const subs = new Set();
  return {
    state, subs,
    getSandbox: () => state,
    subscribe: cb => { subs.add(cb); return () => subs.delete(cb); },
    push(kind, label, count = null, total = null) {
      state.events.push({ seq: state.events.length + 1, kind, label, count, total });
      subs.forEach(cb => cb(state));
    },
  };
}

function startAttack(kind, { sandbox, ...extra } = {}) {
  const env = createSandbox();
  const container = createFakeDom().createElement('div');
  const log = [];
  const run = { done: 0 };
  const handle = env.OceanFx.playAttack({
    attackKind: kind, container,
    getSandbox: sandbox ? sandbox.getSandbox : undefined,
    subscribe: sandbox ? sandbox.subscribe : undefined,
    onEvent: (name, detail) => log.push({ name, detail }),
    onDone: () => { run.done++; },
    ...extra,
  });
  return { ...env, container, log, handle, run, names: () => log.map(e => e.name) };
}

const advance = (a, ms) => { for (let spent = 0; spent < ms; spent += 16) a.clock.step(); };
const untilDone = (a, maxMs = 40000) => a.clock.run(maxMs, () => a.run.done > 0);
const texts = container => allNodes(container).map(n => n.textContent).filter(Boolean);
const elapsed = (a, name) => a.log.find(e => e.name === name)?.detail.elapsedMs;
const snapshot = container => allNodes(container).map(n => `${n.style.transform}|${n.style.opacity}`).join(';');

test('playAttack exposes the 17 contract attack kinds next to the existing API', () => {
  const { OceanFx } = createSandbox();
  assert.equal(OceanFx.version, 1);
  assert.equal(typeof OceanFx.play, 'function');
  assert.equal(typeof OceanFx.playAttack, 'function');
  assert.deepEqual([...OceanFx.attackKinds], ATTACK_KINDS);
});

test('playAttack rejects bad options and leaves nothing behind', () => {
  const { OceanFx } = createSandbox();
  const container = createFakeDom().createElement('div');
  assert.throws(() => OceanFx.playAttack(), { name: 'TypeError' });
  assert.throws(() => OceanFx.playAttack(null), { name: 'TypeError' });
  assert.throws(() => OceanFx.playAttack({ container }), { name: 'TypeError' });
  assert.throws(() => OceanFx.playAttack({ attackKind: 'phishing', container }), { name: 'TypeError' });
  assert.throws(() => OceanFx.playAttack({ attackKind: 'sim-swap', container: {} }), { name: 'TypeError' });
  assert.throws(() => OceanFx.playAttack({ attackKind: 'sim-swap' }), { name: 'TypeError' }, 'no container and no document');
  assert.equal(container.children.length, 0);
});

test('every attackKind plays a breakthrough, a self-timed "simulated" animation, calls onDone once and cleans up', () => {
  for (const kind of ATTACK_KINDS) {
    const a = startAttack(kind);
    assert.ok(countNodes(a.container) > 100, `${kind}: cracks, shards and the animation are drawn`);
    untilDone(a);
    assert.equal(a.run.done, 1, `${kind}: onDone once`);
    assert.deepEqual([...new Set(a.names())], ['breakthrough', 'attack', 'effect', 'fallback', 'beat', 'summary', 'destroyed', 'done'], kind);
    const ms = elapsed(a, 'done');
    assert.ok(ms >= 9000 && ms <= 14000, `${kind}: ${ms} ms`);
    assert.equal(a.container.children.length, 0, kind);
    assert.equal(a.clock.pendingRaf(), 0, `${kind}: no rAF left`);
    assert.equal(a.clock.pendingTimers(), 0, `${kind}: no timer left`);
  }
});

test('each attackKind draws its own animation and caption', () => {
  const structures = new Set();
  const titles = new Set();
  for (const kind of ATTACK_KINDS) {
    const a = startAttack(kind);
    advance(a, 7000);
    const root = a.container.children[0];
    assert.equal(root.attrs['data-ocean-fx'], `attack:${kind}`);
    const structure = createHash('sha1').update(allNodes(root).map(n => n.style.cssText).sort().join('|')).digest('hex');
    assert.ok(!structures.has(structure), `${kind}: structure differs from every other kind`);
    structures.add(structure);
    const title = texts(root).find(t => /^[A-Z ]+[A-Z]:/.test(t));
    assert.ok(title, `${kind}: pixel caption shown`);
    assert.ok(!titles.has(title), `${kind}: caption ${title} is unique`);
    titles.add(title);
    a.handle.stop();
  }
  assert.equal(structures.size, 17);
});

test('sandbox events drive the animation: label, count/total, verified badge, progression and end', () => {
  for (const kind of ATTACK_KINDS) {
    const sb = fakeSandbox();
    const a = startAttack(kind, { sandbox: sb });
    advance(a, 3200);
    assert.ok(texts(a.container).includes('waiting for the sandbox...'), kind);
    const before = snapshot(a.container);
    sb.push('provisioned', 'vm up');
    sb.push('thing-done', 'first thing', 5, 40);
    advance(a, 1500);
    const t1 = texts(a.container);
    assert.ok(t1.some(t => /^5 \/ 40 \S+/.test(t)), `${kind}: counter 5 / 40`);
    assert.ok(t1.includes('first thing'), `${kind}: label shown`);
    assert.ok(t1.includes('verified by sandbox (docker)'), `${kind}: verified badge`);
    assert.ok(!t1.includes('simulated'), kind);
    sb.push('thing-done', 'second thing', 20, 40);
    advance(a, 1500);
    const t2 = texts(a.container);
    assert.ok(t2.some(t => /^20 \/ 40 /.test(t)) && t2.includes('second thing'), kind);
    assert.notEqual(snapshot(a.container), before, `${kind}: animation state moved with the events`);
    sb.push('thing-done', 'last thing', 40, 40);
    sb.push('summary', 'done', 40, 40);
    sb.state.status = 'done';
    advance(a, 1200);
    assert.equal(a.run.done, 0, `${kind}: waits for the sandbox to finish`);
    sb.push('destroyed', 'gone');
    sb.state.status = 'destroyed';
    untilDone(a, 8000);
    assert.equal(a.run.done, 1, kind);
    assert.ok(!a.names().includes('fallback'), `${kind}: no self-timed fallback with real events`);
    assert.equal(sb.subs.size, 0, `${kind}: unsubscribed`);
    assert.equal(a.container.children.length, 0, kind);
    assert.equal(a.clock.pendingRaf() + a.clock.pendingTimers(), 0, kind);
  }
});

test('each event is one beat, shown in order and paced', () => {
  const sb = fakeSandbox();
  const a = startAttack('ransomware-encrypt', { sandbox: sb });
  advance(a, 3200);
  for (let i = 1; i <= 4; i++) sb.push('file-encrypted', `file ${i}`, i * 10, 40);
  const seen = [];
  for (let ms = 0; ms < 3000; ms += 16) {
    a.clock.step();
    const label = texts(a.container).find(t => /^file \d$/.test(t));
    if (label && seen.at(-1) !== label) seen.push(label);
  }
  assert.deepEqual(seen, ['file 1', 'file 2', 'file 3', 'file 4']);
  const beats = a.log.filter(e => e.name === 'beat');
  assert.deepEqual(beats.map(b => b.detail.event.count), [10, 20, 30, 40]);
  assert.ok(beats.every((b, i) => i === 0 || b.detail.elapsedMs - beats[i - 1].detail.elapsedMs >= 50));
});

test('ransomware locks files one by one as count grows', () => {
  const sb = fakeSandbox();
  const a = startAttack('ransomware-encrypt', { sandbox: sb, targets: [{ label: 'taxes-2025.xlsx', kind: 'file' }] });
  advance(a, 3500);
  assert.ok(texts(a.container).includes('taxes-2025.xlsx'));
  assert.ok(!texts(a.container).some(t => t.endsWith('.lock')));
  sb.push('file-encrypted', 'x', 6, 12);
  advance(a, 2500);
  assert.equal(texts(a.container).filter(t => t.endsWith('.lock')).length, 6);
  sb.push('file-encrypted', 'y', 12, 12);
  advance(a, 3000);
  assert.equal(texts(a.container).filter(t => t.endsWith('.lock')).length, 12);
});

test('vultr mode shows its own badge; a simulated sandbox is labelled simulated', () => {
  const vultr = fakeSandbox({ mode: 'vultr' });
  const a = startAttack('data-exfil', { sandbox: vultr });
  advance(a, 3500);
  vultr.push('record-exfiltrated', 'rows', 1, 10);
  advance(a, 800);
  assert.ok(texts(a.container).includes('verified by sandbox (vultr)'));
  a.handle.stop();
  const simulated = fakeSandbox({ mode: 'simulated' });
  const b = startAttack('data-exfil', { sandbox: simulated });
  advance(b, 3500);
  simulated.push('record-exfiltrated', 'rows', 1, 10);
  advance(b, 800);
  assert.ok(texts(b.container).includes('simulated'));
  assert.ok(!texts(b.container).some(t => t.startsWith('verified by sandbox')));
});

test('without events the self-timed version starts after about 4 s with a simulated badge', () => {
  const a = startAttack('credential-phish', { sandbox: fakeSandbox() });
  advance(a, 3800);
  assert.ok(!texts(a.container).includes('simulated'));
  assert.ok(!a.names().includes('fallback'));
  advance(a, 800);
  assert.ok(a.names().includes('fallback'));
  const at = elapsed(a, 'fallback');
  assert.ok(at >= 3900 && at <= 4200, `fallback at ${at} ms`);
  assert.ok(texts(a.container).includes('simulated'));
  assert.ok(!texts(a.container).some(t => t.startsWith('verified')));
  advance(a, 2500);
  assert.ok(texts(a.container).some(t => /^\d+ \/ 3 credentials$/.test(t)), 'synthetic counter');
  untilDone(a);
  assert.equal(a.run.done, 1);
});

test('events that arrive in time prevent the fallback; late events replace a running one', () => {
  const early = fakeSandbox();
  const a = startAttack('network-worm', { sandbox: early });
  advance(a, 2000);
  early.push('host-infected', 'host 1', 1, 24);
  advance(a, 4000);
  assert.ok(!a.names().includes('fallback'));
  a.handle.stop();

  const late = fakeSandbox();
  const b = startAttack('network-worm', { sandbox: late });
  advance(b, 6000);
  assert.ok(b.names().includes('fallback'));
  assert.ok(texts(b.container).includes('simulated'));
  late.push('host-infected', 'real host', 3, 24);
  advance(b, 1000);
  assert.ok(texts(b.container).includes('verified by sandbox (docker)'));
  assert.ok(texts(b.container).includes('real host'));
  advance(b, 4000);
  assert.equal(b.run.done, 0, 'the synthetic end no longer closes a sandbox-driven run');
  late.push('destroyed', 'gone');
  untilDone(b, 8000);
  assert.equal(b.run.done, 1);
});

test('a provisioning vultr sandbox is waited for, until the timeout', () => {
  const sb = fakeSandbox({ mode: 'vultr', status: 'provisioning' });
  const a = startAttack('botnet-ddos', { sandbox: sb, timeoutMs: 15000 });
  advance(a, 12000);
  assert.ok(!a.names().includes('fallback'), 'no fallback while provisioning');
  assert.equal(a.run.done, 0);
  untilDone(a, 10000);
  assert.equal(a.run.done, 1);
  assert.ok(a.names().includes('timeout'));
  assert.ok(elapsed(a, 'done') >= 15000 && elapsed(a, 'done') <= 17500);
  assert.equal(a.container.children.length, 0);
});

test('the run ends on destroyed status, on failed status, or two seconds after summary', () => {
  const destroyed = fakeSandbox();
  const a = startAttack('sim-swap', { sandbox: destroyed });
  advance(a, 3500);
  destroyed.push('number-ported', 'ported', 10, 10);
  destroyed.state.status = 'destroyed';
  untilDone(a, 8000);
  assert.equal(a.run.done, 1);

  const failed = fakeSandbox();
  const b = startAttack('sim-swap', { sandbox: failed });
  advance(b, 3500);
  failed.push('provisioned', 'vm up');
  failed.state.status = 'failed';
  advance(b, 600);
  assert.ok(texts(b.container).includes('sandbox failed'));
  untilDone(b, 8000);
  assert.equal(b.run.done, 1);

  const summary = fakeSandbox();
  const c = startAttack('sim-swap', { sandbox: summary });
  advance(c, 3500);
  summary.push('summary', 'done', 10, 10);
  advance(c, 1600);
  assert.equal(c.run.done, 0);
  untilDone(c, 8000);
  assert.equal(c.run.done, 1);
});

test('the destroyed beat reports a confirmed teardown', () => {
  const sb = fakeSandbox({ receipt: { teardownConfirmed: true } });
  const a = startAttack('scareware', { sandbox: sb });
  advance(a, 3500);
  sb.push('summary', 'done', 12, 12);
  sb.push('destroyed', 'gone');
  advance(a, 700);
  assert.ok(texts(a.container).includes('sandbox destroyed, teardown confirmed'));
});

test('at most 64 events are read, and a fresh runId restarts the sequence numbers', () => {
  const sb = fakeSandbox();
  const a = startAttack('mass-mail-worm', { sandbox: sb });
  advance(a, 3500);
  for (let i = 1; i <= 80; i++) sb.state.events.push({ seq: i, kind: 'mail-sent', label: `mail ${i}`, count: i, total: 80 });
  sb.subs.forEach(cb => cb(sb.state));
  advance(a, 6000);
  assert.equal(a.log.filter(e => e.name === 'beat').length, 64);
  sb.state.runId = 'run-2';
  sb.state.events = [{ seq: 1, kind: 'summary', label: 'second run', count: 5, total: 5 }];
  sb.state.status = 'destroyed';
  untilDone(a, 8000);
  assert.ok(a.names().includes('summary'));
  assert.equal(a.run.done, 1);
});

test('reduced motion: short breakthrough, no travelling shards, shorter run', () => {
  const normal = startAttack('wallet-drain');
  const calm = startAttack('wallet-drain', { reducedMotion: true });
  assert.ok(countNodes(calm.container) <= countNodes(normal.container));
  untilDone(normal);
  untilDone(calm);
  assert.equal(calm.run.done, 1);
  assert.ok(elapsed(calm, 'attack') <= 1000, `reduced breakthrough ends at ${elapsed(calm, 'attack')} ms`);
  assert.ok(elapsed(normal, 'attack') >= 2500);
  assert.ok(elapsed(calm, 'done') < elapsed(normal, 'done'));
  assert.equal(calm.container.children.length, 0);
  const sb = fakeSandbox();
  const c = startAttack('ransomware-encrypt', { sandbox: sb, reducedMotion: true });
  advance(c, 1500);
  sb.push('file-encrypted', 'f', 12, 12);
  advance(c, 800);
  assert.equal(texts(c.container).filter(t => t.endsWith('.lock')).length, 12, 'reduced motion flips states without travelling');
});

test('stop() removes the overlay, unsubscribes, skips onDone and is idempotent; a new run replaces the old', () => {
  const sb = fakeSandbox();
  const a = startAttack('oauth-consent', { sandbox: sb });
  advance(a, 3000);
  assert.equal(sb.subs.size, 1);
  a.handle.stop();
  a.handle.stop();
  assert.equal(a.container.children.length, 0);
  assert.equal(sb.subs.size, 0);
  assert.equal(a.clock.pendingRaf() + a.clock.pendingTimers(), 0);
  advance(a, 15000);
  assert.equal(a.run.done, 0);
  assert.ok(!a.names().includes('done'));

  const env = createSandbox();
  const container = createFakeDom().createElement('div');
  let first = 0;
  env.OceanFx.playAttack({ attackKind: 'sim-swap', container, onDone: () => { first++; } });
  env.OceanFx.playAttack({ attackKind: 'scareware', container });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].attrs['data-ocean-fx'], 'attack:scareware');
  env.OceanFx.play({ familyId: 'deception', depthId: 'abyss', container });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].attrs['data-ocean-fx'], 'deception');
  advance({ clock: env.clock }, 20000);
  assert.equal(first, 0);
});

test('creature sprite: data, blob and /ocean-creatures URLs render pixelated; anything else draws the pixel fish', () => {
  const imgs = sprite => {
    const a = startAttack('spyware-surveillance', { creature: { sprite, family: 'theft-surveillance' } });
    const found = allNodes(a.container).filter(n => n.tag === 'img');
    a.handle.stop();
    return found;
  };
  for (const ok of [DATA_GIF, 'blob:null/1234', '/ocean-creatures/octopus/abyss.gif']) {
    const found = imgs(ok);
    assert.equal(found.length, 1, ok);
    assert.equal(found[0].src, ok);
    assert.match(found[0].style.cssText, /image-rendering:pixelated/);
  }
  for (const bad of ['https://example.invalid/x.gif', '//example.invalid/x.gif', '/ocean-creatures/../secret.gif', '/other/x.gif', 'javascript:alert(1)', 'file:///x.gif', 5, null, undefined]) {
    assert.equal(imgs(bad).length, 0, String(bad));
  }
});

test('hostile sandbox data is cleaned: labels, counts, junk events, bad shapes', () => {
  const sb = fakeSandbox();
  const a = startAttack('data-exfil', { sandbox: sb });
  advance(a, 3500);
  sb.state.events = [null, 5, 'x', {}, { seq: 1, kind: 'record-exfiltrated', label: 'A'.repeat(200), count: -4, total: 'many' }, { seq: 2, kind: 'record-exfiltrated', label: 'tab\there\u0007<b>x</b>', count: 3, total: 10 }, { seq: 3, kind: 'record-exfiltrated', label: 'inf', count: Infinity, total: 0 }];
  sb.subs.forEach(cb => cb(sb.state));
  const all = [];
  for (let ms = 0; ms < 2500; ms += 16) { a.clock.step(); all.push(...texts(a.container)); }
  assert.ok(all.includes('A'.repeat(60)));
  assert.ok(!all.some(t => t.includes('A'.repeat(61))));
  assert.ok(all.includes('tab here <b>x</b>'), 'control characters removed, markup stays plain text');
  assert.ok(!all.some(t => /NaN|Infinity|undefined|null/.test(t)));
  sb.subs.forEach(cb => cb(undefined));
  sb.subs.forEach(cb => cb({ sandbox: null }));
  sb.subs.forEach(cb => cb('nope'));
  advance(a, 500);
  a.handle.stop();
});

test('throwing host callbacks do not break playAttack', () => {
  const env = createSandbox();
  const container = createFakeDom().createElement('div');
  let done = 0;
  env.OceanFx.playAttack({
    attackKind: 'macro-dropper', container,
    getSandbox() { throw new Error('boom'); },
    subscribe() { throw new Error('boom'); },
    onEvent() { throw new Error('boom'); },
    onDone() { done++; throw new Error('boom'); },
  });
  env.clock.run(40000, () => done > 0);
  assert.equal(done, 1);
  assert.equal(container.children.length, 0);
});

test('subscribe may return an object with unsubscribe, and a world or sandbox can be passed to the callback', () => {
  const env = createSandbox();
  const container = createFakeDom().createElement('div');
  let cb = null;
  let off = 0;
  env.OceanFx.playAttack({ attackKind: 'mfa-fatigue', container, subscribe: fn => { cb = fn; return { unsubscribe() { off++; } }; } });
  for (let ms = 0; ms < 3200; ms += 16) env.clock.step();
  cb({ sandbox: { runId: 'w', mode: 'docker', status: 'running', events: [{ seq: 1, kind: 'prompt-sent', label: 'push 1', count: 1, total: 30 }] } });
  for (let ms = 0; ms < 1200; ms += 16) env.clock.step();
  assert.ok(texts(container).includes('push 1'));
  assert.ok(texts(container).includes('verified by sandbox (docker)'));
  env.OceanFx.play({ familyId: 'deception', depthId: 'abyss', container });
  assert.equal(off, 1, 'replaced run unsubscribes');
});

test('the attack overlay is one non-interactive aria-hidden layer and the HUD stays inside it', () => {
  const a = startAttack('server-exploit-leak', { sandbox: fakeSandbox() });
  advance(a, 5000);
  assert.equal(a.container.children.length, 1);
  const root = a.container.children[0];
  assert.match(root.style.cssText, /pointer-events:none/);
  assert.equal(root.attrs['aria-hidden'], 'true');
  assert.ok(allNodes(root).every(n => !/position:fixed/.test(n.style.cssText)), 'nothing positioned against the page');
  assert.ok(allNodes(root).every(n => !['a', 'input', 'script', 'iframe'].includes(n.tag)));
});

test('pixel style: stage nodes sit on the art-pixel grid and text uses the retro font', () => {
  const sb = fakeSandbox();
  const a = startAttack('ransomware-encrypt', { sandbox: sb });
  advance(a, 3500);
  sb.push('file-encrypted', 'x', 12, 12);
  advance(a, 3000);
  const px = 4; // 720 px tall overlay
  const moves = allNodes(a.container).filter(n => parseFloat(n.style.opacity) > 0).map(n => /^translate3d\((-?\d+)px,(-?\d+)px,0\)/.exec(n.style.transform || '')).filter(Boolean);
  assert.ok(moves.length > 15, String(moves.length));
  const off = moves.filter(m => Number(m[1]) % px !== 0 || Number(m[2]) % px !== 0);
  assert.ok(off.length / moves.length < .1, `${off.length} of ${moves.length} placed off the pixel grid`);
  assert.ok(allNodes(a.container).some(n => /Jersey 10/.test(n.style.cssText)));
  assert.ok(allNodes(a.container).some(n => /Jersey10-Regular\.woff/.test(n.textContent)));
});

test('engine-core call shape: creatureSrc, familyId, subscribeSandbox, effect event and the 25 s hard cap', () => {
  const sb = fakeSandbox({ mode: 'vultr', status: 'provisioning' });
  const env = createSandbox();
  const container = createFakeDom().createElement('div');
  const log = [];
  let done = 0;
  env.OceanFx.playAttack({
    attackKind: 'credential-phish', familyId: 'deception', depthId: 'sunlight', creatureSrc: DATA_GIF, container,
    getSandbox: sb.getSandbox, subscribeSandbox: sb.subscribe,
    onEvent: (name, detail) => log.push({ name, detail }), onDone: () => { done++; },
  });
  assert.equal(allNodes(container).filter(n => n.tag === 'img').length, 1, 'creatureSrc drawn');
  assert.equal(sb.subs.size, 1, 'subscribeSandbox used');
  env.clock.run(40000, () => done > 0);
  assert.equal(done, 1, 'never-ending sandbox is cut off by the default cap');
  const ms = log.find(e => e.name === 'done').detail.elapsedMs;
  assert.ok(ms >= 24000 && ms <= 26000, ms + ' ms');
  assert.ok(log.some(e => e.name === 'effect'), 'effect event for the parent caption');
  assert.equal(sb.subs.size, 0);
});
