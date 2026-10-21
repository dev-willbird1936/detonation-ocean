// backend/detonation/replay.mjs: every SPEC §9.1 row becomes a world patch that ui/desktop/world-model.js accepts (AT-17).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { DesktopEventHub } from '../backend/desktop-world-events.mjs';
import { evidenceToPatches, publish } from '../backend/detonation/replay.mjs';

const WorldModel = createRequire(import.meta.url)('../ui/desktop/world-model.js');
const seed = JSON.parse(readFileSync(new URL('../data/desktop-world-seed.json', import.meta.url), 'utf8'));
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/detonation/evidence/${name}.json`, import.meta.url), 'utf8'));
const at = index => `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`;
const item = (index, source, kind, fields) => ({ id: `ev-${index}`, source, kind, detail: `${kind} ${index}`, at: at(index), ...fields });

// Applies every patch to the live world the way the parent does, and checks each against the plain seed like the server.
function replay(evidence, options = { path: 'run' }) {
  const patches = evidenceToPatches(evidence, options);
  let world = WorldModel.createWorld(seed, null);
  for (const patch of patches) {
    WorldModel.createWorld(seed, patch);
    world = WorldModel.createWorld(world, patch);
    assert.deepEqual(WorldModel.validate(world), { ok: true, error: null });
  }
  return { patches, world };
}
const nodeNamed = (world, name) => Object.values(world.fs.nodes).find(node => node.name === name);
const titles = world => world.notifications.history.map(note => note.title);

test('invoice.py evidence gives valid patches: locked files, banners, process, ransom note', () => {
  const { path, evidence } = fixture('invoice.py');
  const { patches, world } = replay(evidence, { path });
  assert.ok(patches.length > 1 && patches.length <= 30);
  assert.equal(world.user.short, 'dana');
  for (const name of ['Q3-report.docx.locked', 'budget.xlsx.locked', 'notes.txt.locked', 'photos-list.csv.locked']) {
    const node = nodeNamed(world, name);
    assert.equal(node.encrypted, true, name);
    assert.equal(node.parentId, 'documents');
  }
  assert.equal(nodeNamed(world, 'Q3-report.docx'), undefined);
  assert.ok(titles(world).includes('Executed on Linux'));
  assert.ok(titles(world).includes('Credential file read'));
  assert.ok(titles(world).includes('Connection blocked: 203.0.113.9'));
  assert.ok(world.data.processes.some(entry => entry.name === 'python3'));
  const note = nodeNamed(world, 'README_DECRYPT.txt');
  assert.ok(world.windows.some(win => win.app === 'texteditor' && win.payload.fileId === note.id));
  assert.match(world.data.contents[note.contentId].text, /Fictional ransom note/);
});

test('patches follow evidence order', () => {
  const { patches } = replay([
    item(1, 'trace', 'execve', { path: '/usr/bin/python3', argv: ['python3'] }),
    item(2, 'trace', 'connect', { host: '203.0.113.9', port: 443 }),
    item(3, 'trace', 'file-read', { path: '/home/dana/.env' }),
  ]);
  const kinds = patches.slice(1).map(patch => (patch.data?.processes ? 'process' : patch.notifications.banners.at(-1).title));
  assert.deepEqual(kinds, ['process', 'Connection blocked: 203.0.113.9', 'Credential file read']);
});

test('files created, changed and renamed in the seeded folders show in File Explorer and Finder', () => {
  const { world } = replay([
    item(1, 'diff', 'added', { path: '/home/dana/Downloads/dropper.bin', seeded: false, sizeAfter: 64 }),
    item(2, 'diff', 'changed', { path: '/home/dana/Desktop/todo.txt', seeded: true, entropyAfter: 4.1, sizeBefore: 548, sizeAfter: 600 }),
    item(3, 'diff', 'renamed', { path: '/home/dana/Pictures/holiday-01.png', to: '/home/dana/Pictures/holiday-01-copy.png', seeded: true }),
    item(4, 'trace', 'file-write', { path: '/home/dana/Documents/new-notes.txt' }),
  ]);
  assert.equal(nodeNamed(world, 'dropper.bin').parentId, 'downloads');
  assert.equal(nodeNamed(world, 'todo.txt').size, 600);
  assert.equal(nodeNamed(world, 'todo.txt').encrypted, undefined);
  assert.equal(nodeNamed(world, 'holiday-01-copy.png').parentId, 'pictures');
  assert.equal(nodeNamed(world, 'holiday-01.png'), undefined);
  assert.equal(nodeNamed(world, 'new-notes.txt').parentId, 'documents');
});

test('encrypted: a new extension on a rename gets the locked icon too', () => {
  const { world } = replay([item(1, 'diff', 'renamed', { path: '/home/dana/Documents/budget.xlsx', to: '/home/dana/Documents/budget.xlsx.locked', seeded: true })]);
  assert.equal(nodeNamed(world, 'budget.xlsx.locked').encrypted, true);
});

test('deleted: the file leaves view and a "Deleted by sample" banner appears', () => {
  const { world } = replay([
    item(1, 'diff', 'deleted', { path: '/home/dana/Documents/notes.txt', seeded: true, sizeBefore: 474 }),
    item(2, 'trace', 'unlink', { path: '/home/dana/Desktop/todo.txt' }),
  ]);
  assert.equal(nodeNamed(world, 'notes.txt').trashed, true);
  assert.equal(nodeNamed(world, 'todo.txt').trashed, true);
  assert.equal(titles(world).filter(title => title === 'Deleted by sample').length, 2);
});

test('a path outside the seeded folders changes no file', () => {
  const { world } = replay([item(1, 'trace', 'unlink', { path: '/bin/ls' }), item(2, 'diff', 'added', { path: '/tmp/x', seeded: false })]);
  assert.equal(Object.values(world.fs.nodes).filter(node => node.id.startsWith('rp-')).length, 7);
});

test('process started: a Task Manager and Activity Monitor entry', () => {
  const { world } = replay([item(1, 'trace', 'execve', { path: '/bin/rm', argv: ['rm', '-rf', '/'] })]);
  assert.deepEqual(world.data.processes.map(entry => [entry.name, entry.suspicious]), [['rm', true]]);
});

test('connection attempt: "Connection blocked: <host>", once per host, never for loopback', () => {
  const { world } = replay([
    item(1, 'trace', 'connect', { host: 'evil.example', port: 443 }),
    item(2, 'trace', 'sendto', { host: 'evil.example', port: 443 }),
    item(3, 'trace', 'connect', { host: '127.0.0.1', port: 80 }),
    item(4, 'browser', 'request-blocked', { url: 'https://c2.example/collect', body: 'x' }),
  ]);
  assert.deepEqual(titles(world).filter(title => title.startsWith('Connection blocked')), ['Connection blocked: evil.example', 'Connection blocked: c2.example']);
});

test('honey credential read: banner "Credential file read"', () => {
  const { world } = replay([item(1, 'trace', 'file-read', { path: '/home/dana/.aws/credentials' }), item(2, 'trace', 'file-read', { path: '/home/dana/Documents/notes.txt' })]);
  assert.equal(titles(world).filter(title => title === 'Credential file read').length, 1);
});

test('persistence: a Startup apps and Login items entry', () => {
  const { world } = replay(fixture('finding-persistence').evidence, { path: 'wine' });
  assert.equal(world.data.startup.length, 1);
  assert.deepEqual(world.data.startup[0].name, 'Updater');
  assert.match(world.data.startup[0].command, /updater\.exe/);
  assert.ok(titles(world).includes('Ran under Wine'));
});

test('ransom note: opens in Notepad and TextEdit (texteditor window)', () => {
  const { world } = replay([item(1, 'diff', 'added', { path: '/home/dana/Desktop/HOW_TO_RECOVER_FILES.txt', seeded: false, sizeAfter: 120 })]);
  const note = nodeNamed(world, 'HOW_TO_RECOVER_FILES.txt');
  assert.ok(world.windows.some(win => win.app === 'texteditor' && win.payload.fileId === note.id));
  assert.equal(world.focusedId, world.windows[0].id);
});

test('browser hijack: the homepage changes to a training page', () => {
  for (const evidence of [fixture('finding-browser-hijack').evidence, [item(1, 'registry', 'key-changed', { hive: 'HKCU', key: 'Software\\Policies\\Google\\Chrome', value: 'HomepageLocation', data: 'x' })]]) {
    const { world } = replay(evidence);
    assert.equal(world.data.web.homepage, 'scene:replay-homepage');
    assert.ok(world.data.web.pages['replay-homepage']);
  }
});

test('labels: one per path', () => {
  for (const [path, label] of [['run', 'Executed on Linux'], ['wine', 'Ran under Wine'], ['emulate', 'Emulated'], ['inspect', 'Inspected']]) {
    assert.ok(titles(replay([], { path }).world).includes(label), label);
  }
  assert.ok(titles(replay([], { label: 'Ran under Wine' }).world).includes('Ran under Wine'));
});

test('Wine screenshots: "What the program showed" data, bounded and same-origin or data: only', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const { world } = replay([
    item(1, 'wine', 'screenshot', { image, caption: 'At 2 s' }),
    item(2, 'wine', 'screenshot', { image: 'https://cdn.example/x.png', caption: 'external' }),
    item(3, 'wine', 'screenshot', { image: '/artifacts/shot-2.png', caption: 'At 10 s' }),
  ], { path: 'wine' });
  assert.deepEqual(world.data.screenshots.map(shot => shot.caption), ['At 2 s', 'At 10 s']);
});

test('the world refuses an external screenshot or a homepage without a page', () => {
  const live = WorldModel.createWorld(seed, null);
  assert.throws(() => WorldModel.createWorld(live, { data: { screenshots: [{ id: 'a', caption: 'x', image: 'https://cdn.example/x.png' }] } }), /data-screenshots/);
  assert.throws(() => WorldModel.createWorld(live, { data: { web: { pages: {}, homepage: 'scene:nowhere' } } }), /data-web/);
});

test('a long replay is merged to fit the 32 events the hub remembers', () => {
  const evidence = Array.from({ length: 60 }, (_, index) => item(index + 1, 'trace', 'execve', { path: `/bin/tool${index}`, argv: [] }));
  const { patches, world } = replay(evidence);
  assert.ok(patches.length <= 30);
  assert.equal(world.data.processes.length, 60);
});

test('publish sends the patches in order to run=<jobId> through the hub or HTTP', async () => {
  const patches = evidenceToPatches(fixture('invoice.py').evidence, { path: 'run' });
  const hub = new DesktopEventHub();
  const sent = [];
  const frames = { writeHead() {}, write: frame => sent.push(frame), on() {}, end() {} };
  assert.ok(hub.subscribe('job-1', frames));
  const results = await publish('job-1', patches, { hub });
  assert.equal(results.length, patches.length);
  const events = sent.filter(frame => frame.startsWith('id:')).map(frame => JSON.parse(frame.split('data: ')[1]));
  assert.deepEqual(events.map(event => event.patch), patches);
  hub.close();

  const posted = [];
  const fetchImpl = async (url, init) => { posted.push([String(url), JSON.parse(init.body).type, init.headers.Authorization]); return { status: 202, json: async () => ({ ok: true }) }; };
  await publish('job-1', patches.slice(0, 2), { baseUrl: 'http://127.0.0.1:4173', token: 'fictional-token-0123456789', fetchImpl });
  assert.deepEqual(posted, [
    ['http://127.0.0.1:4173/api/desktop/events?run=job-1', 'patch', 'Bearer fictional-token-0123456789'],
    ['http://127.0.0.1:4173/api/desktop/events?run=job-1', 'patch', 'Bearer fictional-token-0123456789'],
  ]);
  await assert.rejects(publish('Bad Id', patches), /job id/);
  await assert.rejects(publish('job-1', patches, { fetchImpl: async () => ({ status: 422 }) }), /refused \(422\)/);
});

test('detonation-replay profile is the neutral desktop the replay seeds: Dana, the same files and ids, no scene content', () => {
  const profile = JSON.parse(readFileSync(new URL('../data/desktop-profiles/detonation-replay.json', import.meta.url), 'utf8'));
  const world = WorldModel.createWorld(seed, profile);
  assert.deepEqual(WorldModel.validate(world), { ok: true, error: null });
  const [seedPatch] = evidenceToPatches([], { path: 'run' });
  assert.deepEqual(world.user, seedPatch.user);
  for (const [id, node] of Object.entries(seedPatch.fs.nodes)) assert.deepEqual(world.fs.nodes[id], node, id);
  for (const [id, entry] of Object.entries(seedPatch.data.contents)) assert.deepEqual(world.data.contents[id], entry, id);
  const filesIn = folder => Object.values(world.fs.nodes).filter(node => node.parentId === folder && node.kind === 'file').map(node => node.name).sort();
  assert.deepEqual(filesIn('documents'), ['Q3-report.docx', 'budget.xlsx', 'notes.txt', 'photos-list.csv']);
  assert.deepEqual(filesIn('desktop'), ['todo.txt']);
  assert.deepEqual(filesIn('pictures'), ['holiday-01.png', 'holiday-02.png']);
  assert.deepEqual(filesIn('downloads'), []);
  assert.ok(!JSON.stringify(world).includes('Alex'), 'the plain seed user does not remain');
  assert.ok(!world.data.mail.messages.some(message => message.id.startsWith('sc-')), 'no scene mail');
  assert.equal(world.data.processes, undefined);
  // The replay's own seed patch lands on the profile without adding a second copy of any file.
  const live = WorldModel.createWorld(world, seedPatch);
  assert.equal(Object.keys(live.fs.nodes).length, Object.keys(world.fs.nodes).length);
});
