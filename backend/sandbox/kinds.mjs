// Safe synthetic runners, one per attack kind (SCENARIOS-60-CONTRACT §4).
//
// Each runner generates fictional data in its work directory and performs a harmless equivalent of the attack
// (throwaway-key encryption of dummy files, fake .eml files in a local maildir, records copied to a local sink
// directory, simulated hosts as directories). Nothing here opens a socket, spawns a process or imports anything but
// node:crypto, node:fs and node:path; tests/sandbox-runner.test.mjs scans this file to keep it that way.
// Every name and address is fictional (.example only).
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ATTACK_KINDS = Object.freeze([
  'scareware', 'credential-phish', 'mfa-fatigue', 'oauth-consent', 'mass-mail-worm', 'macro-dropper', 'ransomware-encrypt',
  'data-exfil', 'money-transfer', 'wallet-drain', 'supply-chain-update', 'network-worm', 'botnet-ddos', 'account-takeover-post',
  'sim-swap', 'spyware-surveillance', 'server-exploit-leak',
]);

// world.sandbox holds at most 64 events; the controller adds `destroyed`, so the runner stops at 62.
export const MAX_RUNNER_EVENTS = 62;

const FIRST = ['dana', 'ravi', 'mei', 'tomas', 'aisha', 'luca', 'noor', 'kofi', 'ines', 'sven'];
const LAST = ['okafor', 'lind', 'park', 'silva', 'novak', 'haddad', 'mori', 'reyes', 'berg', 'ito'];

function makeRng(seed) {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const person = index => {
  const first = FIRST[index % FIRST.length];
  const last = LAST[(index * 7 + 3) % LAST.length];
  return { name: `${first} ${last}`, email: `${first}.${last}${index >= FIRST.length ? index : ''}@corp.example` };
};

function listFiles(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else found.push(full);
  }
  return found.sort();
}

function digestTree(root) {
  const hash = createHash('sha256');
  const files = listFiles(root);
  let bytes = 0;
  for (const file of files) {
    hash.update(relative(root, file).replaceAll('\\', '/'));
    bytes += statSync(file).size;
  }
  return { artifacts: files.length, bytes, layoutSha256: hash.digest('hex') };
}

// Context handed to every runner: `put` writes a file under the work directory, `step` emits an event.
function makeContext(dir, rng, emit) {
  return {
    rng,
    int: (low, high) => low + Math.floor(rng() * (high - low + 1)),
    step: emit,
    put(path, data) {
      const full = join(dir, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, typeof data === 'string' ? data : data);
      return full;
    },
    append(path, line) {
      const full = join(dir, path);
      mkdirSync(join(full, '..'), { recursive: true });
      appendFileSync(full, `${line}\n`);
    },
    dir,
  };
}

const RUNNERS = {
  scareware({ step, put, int }) {
    const popups = 6;
    for (let i = 1; i <= popups; i++) {
      put(`popups/popup-${i}.json`, JSON.stringify({ title: 'SYSTEM ALERT (synthetic)', phone: '+1-555-0100', closable: false }));
      step('popup-spawned', `Fake alert ${i} drawn inside the sandbox`, i, popups);
    }
    const threats = int(14, 49);
    put('scan/result.json', JSON.stringify({ threatsReported: threats, threatsReal: 0 }));
    step('fake-scan-result', `Fake scan claims ${threats} threats; 0 exist`, threats, threats);
    put('support/call.log', 'synthetic call to fictional line +1-555-0100\n');
    step('support-call-logged', 'Victim call to the fictional support line recorded', 1, 1);
  },

  'credential-phish'({ step, put, append, rng }) {
    put('site/login.html', '<form action="local-sink"><input name="user"><input name="secret"></form>');
    step('form-rendered', 'Look-alike form rendered by the local in-container sink', 1, 1);
    const posts = 3;
    for (let i = 1; i <= posts; i++) {
      const who = person(i);
      append('sink/captured.jsonl', JSON.stringify({ user: who.email, secret: `dummy-${Math.floor(rng() * 1e9).toString(16)}` }));
      step('credential-captured', `Form post ${i} captured by the sink (dummy credentials, redacted)`, i, posts);
    }
    step('sink-verified', 'Sink file holds only dummy credentials', posts, posts);
  },

  'mfa-fatigue'({ step, put, int }) {
    const prompts = 8;
    for (let i = 1; i <= prompts; i++) {
      put(`push/prompt-${i}.json`, JSON.stringify({ n: i, user: person(2).email }));
      step('mfa-prompt-sent', `Push prompt ${i} queued for the synthetic user`, i, prompts);
    }
    const denied = prompts - 1;
    put('push/outcomes.json', JSON.stringify({ denied, approved: 1, delayMs: int(300, 900) }));
    step('mfa-prompt-denied', `${denied} prompts denied by the synthetic user`, denied, prompts);
    step('mfa-prompt-approved', 'Prompt 8 approved to stop the noise', 1, 1);
  },

  'oauth-consent'({ step, put, rng }) {
    put('idp/consent.json', JSON.stringify({ app: 'Docs Helper (synthetic)', scopes: ['mail.read.synthetic'] }));
    step('consent-screen-rendered', 'Synthetic consent screen shown', 1, 1);
    const token = `syn_${Math.floor(rng() * 1e12).toString(36)}`;
    put('idp/token.json', JSON.stringify({ token, scopes: ['mail.read.synthetic'] }));
    step('token-granted', 'Synthetic token issued by the fake identity provider', 1, 1);
    const messages = 12;
    for (let i = 4; i <= messages; i += 4) {
      put(`mailbox/read-${i}.json`, JSON.stringify({ upTo: i }));
      step('mailbox-read', `Synthetic mailbox read: ${i} of ${messages} messages`, i, messages);
    }
  },

  'mass-mail-worm'({ step, put }) {
    const contacts = 20;
    step('contacts-harvested', `${contacts} fictional contacts read from the address book`, contacts, contacts);
    const sender = person(0);
    for (let i = 1; i <= contacts; i++) {
      const to = person(i);
      put(`maildir/new/${String(i).padStart(3, '0')}.eml`,
        `From: ${sender.email}\nTo: ${to.email}\nSubject: Fwd: invoice copy (synthetic)\n\nTraining message ${i}. No attachment.\n`);
      step('mail-sent', `Fake mail ${i} written to the local maildir for ${to.name}`, i, contacts);
    }
  },

  'macro-dropper'({ step, put }) {
    put('docs/invoice.doc.json', JSON.stringify({ kind: 'synthetic-document', macro: 'none (data only)' }));
    step('document-opened', 'Synthetic document opened; macros prompt shown', 1, 1);
    put('stage/macro-ran.marker', 'marker only, no code executed');
    step('macro-ran', 'Macro step recorded as a marker file', 1, 1);
    put('stage/dropped.marker', 'second-stage placeholder');
    step('stage-dropped', 'Second-stage placeholder file written', 1, 1);
    put('stage/autorun.txt', 'persistence entry recorded as text only');
    step('persistence-recorded', 'Persistence entry noted in a text file', 1, 1);
    put('stage/beacon.queue', 'queued for a sink that does not exist; nothing is sent');
    step('beacon-queued', 'Beacon queued locally and never sent', 1, 1);
  },

  'ransomware-encrypt'({ step, put, rng, dir }) {
    const total = 40;
    for (let i = 1; i <= total; i++) {
      const text = Array.from({ length: 64 }, () => `synthetic row ${Math.floor(rng() * 1e6)}`).join('\n');
      put(`docs/report-${String(i).padStart(2, '0')}.txt`, text);
    }
    step('files-generated', `${total} dummy documents generated`, total, total);
    const key = randomBytes(32);
    for (let i = 1; i <= total; i++) {
      const path = join(dir, 'docs', `report-${String(i).padStart(2, '0')}.txt`);
      const plain = readFileSync(path);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      writeFileSync(`${path}.locked`, Buffer.concat([iv, cipher.getAuthTag(), body]));
      rmSync(path);
      step('file-encrypted', `report-${String(i).padStart(2, '0')}.txt encrypted with the throwaway key`, i, total);
    }
    key.fill(0);
    step('key-discarded', 'Throwaway key wiped from memory; nothing can decrypt these files', 1, 1);
    put('docs/README-SYNTHETIC.txt', 'Training note. No ransom, no payment, no real data.');
    step('ransom-note-written', 'Synthetic training note written', 1, 1);
  },

  'data-exfil'({ step, put, int }) {
    const total = 60;
    const rows = Array.from({ length: total }, (_, i) => `${i + 1},${person(i).email},${int(1000, 9999)}`);
    put('db/customers.csv', `id,email,balance\n${rows.join('\n')}\n`);
    step('records-staged', `${total} synthetic records staged`, total, total);
    for (let batch = 1; batch <= 6; batch++) {
      put(`sink/exfil/batch-${batch}.csv`, `${rows.slice((batch - 1) * 10, batch * 10).join('\n')}\n`);
      step('record-exfiltrated', `Batch ${batch} copied to the local sink directory`, batch * 10, total);
    }
    step('archive-sealed', 'Sink directory sealed; it never left the sandbox', total, total);
  },

  'money-transfer'({ step, put, int, append }) {
    put('ledger/accounts.json', JSON.stringify({ victim: 'ACCT-1001', attacker: 'ACCT-9001', currency: 'TESTUSD' }));
    step('invoice-intercepted', 'Synthetic invoice intercepted in the ledger', 1, 1);
    step('payee-changed', 'Payee swapped to the lookalike synthetic account', 1, 1);
    let moved = 0;
    const entries = 5;
    for (let i = 1; i <= entries; i++) {
      const amount = int(100, 900);
      moved += amount;
      append('ledger/entries.jsonl', JSON.stringify({ n: i, from: 'ACCT-1001', to: 'ACCT-9001', amount, currency: 'TESTUSD' }));
      step('transfer-posted', `Ledger entry ${i}: ${amount} TESTUSD posted to the lookalike account`, i, entries);
    }
    step('ledger-reconciled', `Ledger total ${moved} TESTUSD (synthetic money)`, moved, moved);
  },

  'wallet-drain'({ step, put, append }) {
    put('wallet/state.json', JSON.stringify({ address: '0xSYNTHETIC-0001', assets: { TESTCOIN: 400, TESTNFT: 3 } }));
    step('wallet-connected', 'Synthetic wallet connected to the fake site', 1, 1);
    for (let i = 1; i <= 2; i++) {
      append('wallet/approvals.jsonl', JSON.stringify({ n: i, spender: 'drainer.example', unlimited: true }));
      step('approval-signed', `Unlimited approval ${i} signed on the synthetic ledger`, i, 2);
    }
    for (let i = 1; i <= 4; i++) {
      append('wallet/ledger.jsonl', JSON.stringify({ n: i, asset: 'TESTCOIN', amount: 100, to: 'drainer.example' }));
      step('asset-drained', `Ledger entry ${i}: 100 TESTCOIN moved to the fake drainer`, i * 100, 400);
    }
  },

  'supply-chain-update'({ step, put }) {
    put('registry/acme-lib/1.0.0/package.json', JSON.stringify({ name: 'acme-lib', version: '1.0.0' }));
    step('package-built', 'Benign package acme-lib 1.0.0 built', 1, 1);
    put('registry/acme-lib/1.0.1/package.json', JSON.stringify({ name: 'acme-lib', version: '1.0.1', canary: true }));
    step('update-published', 'Tampered-update stand-in 1.0.1 published to the local registry', 1, 1);
    const hosts = 8;
    for (let i = 1; i <= hosts; i++) {
      put(`hosts/build-${i}.corp.example/acme-lib/CANARY`, 'update installed; canary only, no code');
      step('update-installed', `Host build-${i} pulled 1.0.1 automatically`, i, hosts);
    }
    step('canary-fired', 'All canaries fired; no payload exists', hosts, hosts);
  },

  'network-worm'({ step, put, rng }) {
    const total = 24;
    const infected = new Set([1]);
    put('hosts/host-01.lab.example/INFECTED', 'patient zero marker');
    step('host-infected', 'Patient zero marked (host-01, a directory)', 1, total);
    for (let round = 1; infected.size < total; round++) {
      const wave = 1 + Math.floor(rng() * 4);
      step('host-scanned', `Round ${round}: scanning neighbours of ${infected.size} hosts (simulated)`, infected.size, total);
      for (let hit = 0; hit < wave && infected.size < total; hit++) {
        const next = infected.size + 1;
        infected.add(next);
        put(`hosts/host-${String(next).padStart(2, '0')}.lab.example/INFECTED`, 'infection marker');
        step('host-infected', `host-${String(next).padStart(2, '0')} marked infected`, infected.size, total);
      }
    }
  },

  'botnet-ddos'({ step, put, int }) {
    const bots = 30;
    for (let i = 1; i <= bots; i++) put(`bots/bot-${String(i).padStart(2, '0')}.json`, JSON.stringify({ id: i, cpu: int(5, 90) }));
    for (let batch = 1; batch <= 6; batch++) step('bot-enlisted', `${batch * 5} simulated bots enlisted`, batch * 5, bots);
    put('c2/command.json', JSON.stringify({ cmd: 'flood', target: 'target.example', simulated: true }));
    step('command-issued', 'Command written to a local file; no listener, no traffic', 1, 1);
    const perBot = 300;
    let sent = 0;
    for (let round = 1; round <= 5; round++) {
      sent += bots * perBot / 5;
      put(`flood/round-${round}.json`, JSON.stringify({ round, simulatedRequests: sent }));
      step('flood-simulated', `Round ${round}: ${sent} requests counted arithmetically`, sent, bots * perBot);
    }
    step('target-saturated', 'Model capacity of target.example exceeded (arithmetic only)', 1, 1);
  },

  'account-takeover-post'({ step, put, append, rng }) {
    put('session/cookie.json', JSON.stringify({ value: `syn_${Math.floor(rng() * 1e12).toString(36)}`, user: person(3).email }));
    step('session-hijacked', 'Synthetic session cookie reused on the local feed', 1, 1);
    put('feed/profile.json', JSON.stringify({ displayName: 'Support Team (synthetic)' }));
    step('profile-changed', 'Display name changed on the local feed', 1, 1);
    for (let i = 1; i <= 4; i++) {
      append('feed/posts.jsonl', JSON.stringify({ n: i, text: `Synthetic giveaway post ${i} (no real link)` }));
      step('post-published', `Post ${i} published to the local feed`, i, 4);
    }
    step('followers-reached', '480 synthetic followers would see the posts', 480, 480);
  },

  'sim-swap'({ step, put, append, int }) {
    const number = `+1-555-01${int(10, 99)}`;
    put('carrier/request.json', JSON.stringify({ number, channel: 'support-chat', forged: true }));
    step('carrier-request-filed', 'Forged SIM-change request filed with the toy carrier', 1, 1);
    put('carrier/port.json', JSON.stringify({ number, newSim: 'SIM-SYNTH-0042' }));
    step('number-ported', `${number} moved to a synthetic SIM`, 1, 1);
    append('sink/sms.log', `code=${int(100000, 999999)} (dummy)`);
    step('sms-code-intercepted', 'Dummy one-time code intercepted in the sink', 1, 1);
    put('bank/reset.json', JSON.stringify({ reset: true, account: 'ACCT-1001' }));
    step('account-reset', 'Toy bank account reset using the dummy code', 1, 1);
  },

  'spyware-surveillance'({ step, put, append }) {
    put('implant/installed.marker', 'marker only');
    step('implant-installed', 'Implant stand-in recorded as a marker file', 1, 1);
    for (let i = 1; i <= 5; i++) {
      append('capture/keys.log', `synthetic keystrokes sample ${i}`);
      step('keystroke-logged', `Keystroke sample ${i} generated, not typed by anyone`, i, 5);
    }
    for (let i = 1; i <= 3; i++) {
      put(`capture/frame-${i}.json`, JSON.stringify({ w: 64, h: 64, synthetic: true }));
      step('screen-captured', `Synthetic frame ${i} stored; no screen was read`, i, 3);
    }
    put('capture/contacts.json', JSON.stringify(Array.from({ length: 12 }, (_, i) => person(i).email)));
    step('contacts-collected', '12 fictional contacts copied', 12, 12);
    put('capture/location.json', JSON.stringify({ lat: 0, lon: 0, note: 'fixed null-island value' }));
    step('location-sampled', 'Fixed placeholder coordinates recorded', 1, 1);
  },

  'server-exploit-leak'({ step, put, int }) {
    // A toy search handler written for this project: it treats "*" as "no filter", which is the whole flaw.
    const db = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, email: person(i).email, note: `row ${int(1, 99)}` }));
    const toySearch = query => (query === '*' ? db : db.filter(row => row.email.startsWith(query)));
    for (const [i, query] of ['dana.okafor', 'zzz', '*'].entries()) {
      step('probe-sent', `Probe ${i + 1} to the toy handler: ${toySearch(query).length} rows returned`, i + 1, 3);
    }
    step('canary-triggered', 'Wildcard returned the whole table; canary row seen', 1, 1);
    const leaked = toySearch('*');
    for (let batch = 1; batch <= 5; batch++) {
      put(`sink/leak/part-${batch}.json`, JSON.stringify(leaked.slice((batch - 1) * 10, batch * 10)));
      step('record-leaked', `Part ${batch} copied to the local sink directory`, batch * 10, leaked.length);
    }
  },
};

/**
 * Run one attack kind inside `dir`. `onEvent` receives {seq, kind, label, count, total} as each step happens.
 * Returns the events and evidence (artifact count, bytes, directory layout digest).
 */
export function runAttackKind(attackKind, { dir, seed = attackKind, onEvent = () => {}, interfaces = [] }) {
  const runner = RUNNERS[attackKind];
  if (!runner) throw new Error(`Unknown attack kind: ${attackKind}`);
  mkdirSync(dir, { recursive: true });
  const events = [];
  const emit = (kind, label, count, total) => {
    if (events.length >= MAX_RUNNER_EVENTS) throw new Error('Runner exceeded the event budget.');
    const event = { seq: events.length, kind, label };
    if (Number.isInteger(count)) event.count = count;
    if (Number.isInteger(total)) event.total = total;
    events.push(event);
    onEvent(event);
  };
  emit('provisioned', `Sandbox ready: ${attackKind}, ${interfaces.length ? `${interfaces.length} non-loopback interface(s)` : 'no network'}, synthetic data`);
  runner(makeContext(dir, makeRng(seed), emit));
  const evidence = digestTree(dir);
  emit('summary', `${attackKind} finished: ${evidence.artifacts} synthetic artifacts, 0 bytes left the sandbox`, evidence.artifacts, evidence.artifacts);
  return { events, evidence };
}
