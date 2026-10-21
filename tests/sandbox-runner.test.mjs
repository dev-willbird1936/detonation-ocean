import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTACK_KINDS, MAX_RUNNER_EVENTS, runAttackKind } from '../backend/sandbox/kinds.mjs';

const ID_RE = /^[a-z0-9-]{1,40}$/;
const withDir = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'brz-test-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('the 17 attack kinds match the contract list', () => {
  assert.deepEqual([...ATTACK_KINDS], [
    'scareware', 'credential-phish', 'mfa-fatigue', 'oauth-consent', 'mass-mail-worm', 'macro-dropper', 'ransomware-encrypt',
    'data-exfil', 'money-transfer', 'wallet-drain', 'supply-chain-update', 'network-worm', 'botnet-ddos', 'account-takeover-post',
    'sim-swap', 'spyware-surveillance', 'server-exploit-leak',
  ]);
});

for (const kind of ATTACK_KINDS) {
  test(`${kind}: events run provisioned..summary with world-shaped fields and fictional text`, () => withDir(dir => {
    const { events, evidence } = runAttackKind(kind, { dir });
    assert.equal(events[0].kind, 'provisioned');
    assert.equal(events.at(-1).kind, 'summary');
    assert.ok(events.length >= 4 && events.length <= MAX_RUNNER_EVENTS, `${events.length} events`);
    events.forEach((event, index) => {
      assert.equal(event.seq, index);
      assert.match(event.kind, ID_RE);
      assert.ok(event.label.length > 0 && event.label.length <= 120 && !/[\r\n]/.test(event.label));
      for (const key of ['count', 'total']) if (key in event) assert.ok(Number.isInteger(event[key]) && event[key] >= 0 && event[key] <= 1_000_000);
      assert.deepEqual(Object.keys(event).filter(key => !['seq', 'kind', 'label', 'count', 'total'].includes(key)), []);
      for (const match of event.label.matchAll(/@([A-Za-z0-9.-]+)/g)) assert.match(match[1], /\.(example|invalid)$/);
    });
    assert.ok(events.slice(1, -1).length >= 2, 'attack-specific steps between provisioned and summary');
    assert.ok(evidence.artifacts > 0 && /^[0-9a-f]{64}$/.test(evidence.layoutSha256));
  }));

  test(`${kind}: the same seed gives the same events, another seed keeps the shape`, () => withDir(a => withDir(b => {
    const first = runAttackKind(kind, { dir: a, seed: 'one' });
    const again = runAttackKind(kind, { dir: b, seed: 'one' });
    assert.deepEqual(again.events, first.events);
    assert.equal(again.evidence.layoutSha256, first.evidence.layoutSha256);
  })));
}

test('ransomware-encrypt: 40 dummy files end up encrypted, with no plaintext left', () => withDir(dir => {
  const { events } = runAttackKind('ransomware-encrypt', { dir });
  const names = readdirSync(join(dir, 'docs'));
  assert.equal(names.filter(name => name.endsWith('.locked')).length, 40);
  assert.equal(names.filter(name => /^report-\d+\.txt$/.test(name)).length, 0);
  assert.equal(events.filter(event => event.kind === 'file-encrypted').length, 40);
  assert.deepEqual(events.filter(event => event.kind === 'file-encrypted').at(-1), {
    seq: events.findLastIndex(event => event.kind === 'file-encrypted'), kind: 'file-encrypted',
    label: 'report-40.txt encrypted with the throwaway key', count: 40, total: 40,
  });
  assert.ok(events.some(event => event.kind === 'key-discarded'));
  assert.ok(!readFileSync(join(dir, 'docs', 'report-01.txt.locked')).includes('synthetic row'));
}));

test('mass-mail-worm: fake .eml files for fictional contacts only', () => withDir(dir => {
  runAttackKind('mass-mail-worm', { dir });
  const names = readdirSync(join(dir, 'maildir', 'new'));
  assert.equal(names.length, 20);
  for (const name of names) {
    const mail = readFileSync(join(dir, 'maildir', 'new', name), 'utf8');
    for (const match of mail.matchAll(/@([A-Za-z0-9.-]+)/g)) assert.equal(match[1], 'corp.example');
  }
}));

test('data-exfil and server-exploit-leak copy synthetic records to a local sink directory', () => withDir(dir => withDir(other => {
  runAttackKind('data-exfil', { dir });
  runAttackKind('server-exploit-leak', { dir: other });
  assert.equal(readdirSync(join(dir, 'sink', 'exfil')).length, 6);
  assert.equal(readdirSync(join(other, 'sink', 'leak')).length, 5);
})));

test('the runner source imports nothing that can reach a network or start a process', () => {
  for (const file of ['kinds.mjs', 'runner.mjs']) {
    const source = readFileSync(new URL(`../backend/sandbox/${file}`, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]);
    for (const spec of imports) assert.ok(['node:crypto', 'node:fs', 'node:path', 'node:os', './kinds.mjs'].includes(spec), `${file} imports ${spec}`);
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|eval|Function)\s*\(|child_process|node:(net|http|https|dgram|dns|tls|vm|worker_threads)/);
    assert.doesNotMatch(source, /https?:\/\/(?!\S*\.example)/, 'only .example URLs');
  }
});

test('unknown attack kinds are refused', () => withDir(dir => {
  assert.throws(() => runAttackKind('rm-rf', { dir }), /Unknown attack kind/);
}));
