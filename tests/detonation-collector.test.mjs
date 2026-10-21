// Runs deploy/detonation/collect/collect.py with the host Python against temp directories (no Docker).
// Pins the EVIDENCE.md `diff` items: added, changed, deleted, renamed, entropy, seeded, executable, copyOfSample.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const collector = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'detonation', 'collect', 'collect.py');
const python = ['python3', 'python'].find(name => spawnSync(name, ['--version']).status === 0);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const text = 'Quarterly notes, mostly plain English prose with repeated words and words and words.\n'.repeat(20);

/** Seeds a temp home from {relativePath: Buffer|string} and returns helpers to mutate it and run the collector. */
function sandbox(seed, manifestExtras = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'collector-'));
  const home = join(dir, 'home');
  const put = (rel, data) => {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), data);
  };
  for (const [rel, data] of Object.entries(seed)) put(rel, data);
  const manifest = Object.entries(seed).map(([rel, data]) => ({ path: rel, size: Buffer.byteLength(data), sha256: sha256(data), ...manifestExtras[rel] }));
  const manifestPath = join(dir, 'seed-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const run = (...extra) => {
    const out = join(dir, 'diff.json');
    const result = spawnSync(python, [collector, '--home', home, '--manifest', manifestPath, '--out', out, ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(out, 'utf8'));
  };
  return { home, put, run, path: rel => join(home, rel), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const find = (diff, kind, path) => diff.items.find(entry => entry.kind === kind && entry.path === `/home/dana/${path}`);
const seedDocs = () => ({
  'Documents/Q3-report.docx': text + '1',
  'Documents/budget.xlsx': text + '2',
  'Documents/notes.txt': text + '3',
  'Documents/photos-list.csv': text + '4',
  'Desktop/todo.txt': text + '5',
  'Downloads/.keep': '',
});

test('python is available for the collector tests', () => assert.ok(python, 'python3 or python must be on PATH'));

test('an untouched home yields no items', () => {
  const box = sandbox(seedDocs());
  try {
    const diff = box.run();
    assert.deepEqual(diff.items, []);
    assert.deepEqual(diff.counts, { added: 0, changed: 0, deleted: 0, renamed: 0 });
    assert.equal(diff.truncated, false);
  } finally { box.cleanup(); }
});

test('reports added, changed and deleted files with seeded, sizes and entropy', () => {
  const box = sandbox(seedDocs(), { 'Documents/notes.txt': { entropy: 4.1 } });
  try {
    box.put('Documents/notes.txt', randomBytes(4096));
    box.put('Pictures/new.bin', Buffer.alloc(1024, 0x41));
    unlinkSync(box.path('Documents/photos-list.csv'));
    const diff = box.run();

    const changed = find(diff, 'changed', 'Documents/notes.txt');
    assert.equal(changed.source, 'diff');
    assert.equal(changed.seeded, true);
    assert.equal(changed.entropyBefore, 4.1);
    assert.ok(changed.entropyAfter > 7.5, `entropyAfter ${changed.entropyAfter}`);
    assert.equal(changed.sizeBefore, Buffer.byteLength(text + '3'));
    assert.equal(changed.sizeAfter, 4096);

    const added = find(diff, 'added', 'Pictures/new.bin');
    assert.equal(added.seeded, false);
    assert.equal(added.entropyBefore, null);
    assert.equal(added.entropyAfter, 0);
    assert.equal(added.sizeBefore, null);
    assert.equal(added.sizeAfter, 1024);
    assert.equal(added.executable, undefined);

    const deleted = find(diff, 'deleted', 'Documents/photos-list.csv');
    assert.equal(deleted.seeded, true);
    assert.equal(deleted.sizeAfter, null);
    assert.equal(deleted.entropyAfter, null);
    assert.deepEqual(diff.counts, { added: 1, changed: 1, deleted: 1, renamed: 0 });
  } finally { box.cleanup(); }
});

test('a changed seeded file truncated to zero bytes reports sizeAfter 0', () => {
  const box = sandbox(seedDocs());
  try {
    box.put('Documents/notes.txt', '');
    const changed = find(box.run(), 'changed', 'Documents/notes.txt');
    assert.equal(changed.sizeAfter, 0);
    assert.equal(changed.entropyAfter, 0);
  } finally { box.cleanup(); }
});

test('AT-7 shape: files the sample created and then deleted never appear', () => {
  const box = sandbox(seedDocs());
  try {
    box.put('Downloads/stage.tmp', 'payload');
    box.put('Documents/cache/a.bin', randomBytes(64));
    unlinkSync(box.path('Downloads/stage.tmp'));
    rmSync(box.path('Documents/cache'), { recursive: true });
    const diff = box.run();
    assert.deepEqual(diff.items, []);
  } finally { box.cleanup(); }
});

test('encrypt shape: three seeded documents renamed to .locked with high entropy', () => {
  const box = sandbox(seedDocs(), { 'Documents/budget.xlsx': { entropy: 4.4 } });
  try {
    for (const name of ['Q3-report.docx', 'budget.xlsx', 'notes.txt']) {
      unlinkSync(box.path(`Documents/${name}`));
      box.put(`Documents/${name}.locked`, randomBytes(2048));
    }
    box.put('Documents/README_DECRYPT.txt', 'Your files are encrypted. Pay to decrypt.');
    const diff = box.run();

    assert.deepEqual(diff.counts, { added: 1, changed: 0, deleted: 0, renamed: 3 });
    for (const name of ['Q3-report.docx', 'budget.xlsx', 'notes.txt']) {
      const renamed = find(diff, 'renamed', `Documents/${name}`);
      assert.equal(renamed.to, `/home/dana/Documents/${name}.locked`);
      assert.equal(renamed.seeded, true);
      assert.ok(renamed.entropyAfter >= 7.5, `${name} entropyAfter ${renamed.entropyAfter}`);
      assert.equal(renamed.sizeAfter, 2048);
    }
    assert.equal(find(diff, 'renamed', 'Documents/budget.xlsx').entropyBefore, 4.4);
    assert.equal(find(diff, 'renamed', 'Documents/notes.txt').entropyBefore, null);
    assert.equal(find(diff, 'added', 'Documents/README_DECRYPT.txt').ransomNoteCandidate, true);
  } finally { box.cleanup(); }
});

test('encrypt shape: in-place encryption reports changed files with high entropyAfter', () => {
  const box = sandbox(seedDocs());
  try {
    for (const name of ['Q3-report.docx', 'budget.xlsx', 'notes.txt']) box.put(`Documents/${name}`, randomBytes(2048));
    const diff = box.run();
    const changed = diff.items.filter(entry => entry.kind === 'changed');
    assert.equal(changed.length, 3);
    assert.ok(changed.every(entry => entry.seeded && entry.entropyAfter >= 7.5));
  } finally { box.cleanup(); }
});

test('renames: same extension swap, same hash in another folder; unrelated deletion stays deleted', () => {
  const box = sandbox(seedDocs());
  try {
    renameSync(box.path('Desktop/todo.txt'), box.path('Desktop/todo.enc'));
    mkdirSync(box.path('Pictures'), { recursive: true });
    renameSync(box.path('Documents/notes.txt'), box.path('Pictures/elsewhere.dat'));
    unlinkSync(box.path('Documents/budget.xlsx'));
    const diff = box.run();
    assert.equal(find(diff, 'renamed', 'Desktop/todo.txt').to, '/home/dana/Desktop/todo.enc');
    assert.equal(find(diff, 'renamed', 'Documents/notes.txt').to, '/home/dana/Pictures/elsewhere.dat');
    assert.ok(find(diff, 'deleted', 'Documents/budget.xlsx'));
    assert.deepEqual(diff.counts, { added: 0, changed: 0, deleted: 1, renamed: 2 });
  } finally { box.cleanup(); }
});

test('flags executables and copies of the sample; the runner copy of the sample is not reported', () => {
  const sample = '#!/bin/sh\necho sample\n';
  const box = sandbox(seedDocs());
  try {
    box.put('Downloads/sample.sh', sample);
    box.put('Downloads/dropper', '#!/bin/sh\necho second stage\n');
    box.put('Documents/copy1.sh', sample);
    box.put('Pictures/copy2.txt', sample);
    const diff = box.run('--sample-sha256', sha256(sample));
    assert.equal(find(diff, 'added', 'Downloads/sample.sh'), undefined);
    assert.equal(find(diff, 'added', 'Downloads/dropper').executable, true);
    assert.equal(find(diff, 'added', 'Downloads/dropper').copyOfSample, undefined);
    assert.equal(find(diff, 'added', 'Documents/copy1.sh').copyOfSample, true);
    assert.equal(find(diff, 'added', 'Pictures/copy2.txt').copyOfSample, true);
  } finally { box.cleanup(); }
});

test('a modified runner copy of the sample is reported as added', () => {
  const box = sandbox(seedDocs());
  try {
    box.put('Downloads/sample.py', 'print("tampered")\n');
    assert.ok(find(box.run('--sample-sha256', sha256('print("original")\n')), 'added', 'Downloads/sample.py'));
  } finally { box.cleanup(); }
});

test('symlinks are reported without being followed; a symlinked directory cannot hide a deletion', { skip: process.platform === 'win32' }, () => {
  const box = sandbox(seedDocs());
  try {
    symlinkSync('/etc/passwd', box.path('Desktop/passwd-link'));
    rmSync(box.path('Documents'), { recursive: true });
    symlinkSync('/etc', box.path('Documents'));
    const diff = box.run();
    assert.equal(find(diff, 'added', 'Desktop/passwd-link').entropyAfter, null);
    assert.equal(diff.items.filter(entry => entry.kind === 'deleted' && entry.path.startsWith('/home/dana/Documents/')).length, 4);
  } finally { box.cleanup(); }
});

test('manifest paths outside the home are ignored', () => {
  const box = sandbox(seedDocs());
  try {
    const manifestPath = join(box.home, '..', 'seed-manifest.json');
    writeFileSync(manifestPath, JSON.stringify([{ path: '../../etc/passwd', size: 1, sha256: 'x' }, { path: '/etc/passwd', size: 1, sha256: 'x' }]));
    assert.deepEqual(box.run().items.length, 6);
  } finally { box.cleanup(); }
});

test('caps: more than 5000 added files sets truncated; output stays within 64 KB', () => {
  const box = sandbox(seedDocs());
  try {
    for (let i = 0; i < 5001; i += 1) writeFileSync(join(box.home, 'Pictures-flood-' + i), '');
    unlinkSync(box.path('Documents/notes.txt'));
    const diff = box.run();
    assert.equal(diff.truncated, true);
    assert.ok(diff.truncation.includes('files'));
    assert.ok(diff.truncation.includes('output'));
    assert.ok(diff.counts.added <= 5000);
    assert.ok(find(diff, 'deleted', 'Documents/notes.txt'), 'seeded deletions are checked directly and survive the file cap');
    assert.ok(Buffer.byteLength(readFileSync(join(box.home, '..', 'diff.json'))) <= 64 * 1024);
  } finally { box.cleanup(); }
});

// POSIX names may hold a backslash; the manifest turns backslashes into separators, a name on disk never does.
const BS = String.fromCharCode(92);
const posixOnly = { skip: process.platform === 'win32' };

test('a directory named "..<BS>x" and a file named "a<BS>b" are reported under their real names', posixOnly, () => {
  const box = sandbox(seedDocs());
  try {
    box.put(`..${BS}x/loot.bin`, 'payload');
    box.put(`a${BS}b`, 'payload');
    const diff = box.run();
    assert.equal(find(diff, 'added', `..${BS}x/loot.bin`).sizeAfter, 7);
    assert.equal(find(diff, 'added', `a${BS}b`).sizeAfter, 7);
    assert.equal(diff.counts.added, 2);
    assert.equal(diff.truncated, false);
  } finally { box.cleanup(); }
});

test('a manifest path with backslashes names the seeded file; a backslash file of that name does not hide the deletion', posixOnly, () => {
  const box = sandbox(seedDocs());
  try {
    const manifestPath = join(box.home, '..', 'seed-manifest.json');
    writeFileSync(manifestPath, JSON.stringify([{ path: `Documents${BS}notes.txt`, size: Buffer.byteLength(text + '3'), sha256: sha256(text + '3') }]));
    assert.deepEqual(box.run().items.filter(entry => entry.path.endsWith('notes.txt')), []);
    unlinkSync(box.path('Documents/notes.txt'));
    box.put(`Documents${BS}notes.txt`, 'payload');
    const diff = box.run();
    assert.ok(find(diff, 'deleted', 'Documents/notes.txt'), 'the real Documents/notes.txt is gone');
    assert.ok(find(diff, 'added', `Documents${BS}notes.txt`), 'the backslash file is a different file');
  } finally { box.cleanup(); }
});

test('an unreadable directory marks the diff truncated and is not reported as a deletion', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const box = sandbox(seedDocs());
  try {
    box.put('Pictures/hidden/loot.bin', 'payload');
    chmodSync(box.path('Pictures/hidden'), 0o000);
    chmodSync(box.path('Documents'), 0o000);
    const diff = box.run();
    chmodSync(box.path('Pictures/hidden'), 0o755);
    chmodSync(box.path('Documents'), 0o755);
    assert.equal(diff.truncated, true);
    assert.deepEqual(diff.truncation, ['unreadable-dir']);
    assert.equal(diff.items.filter(entry => entry.kind === 'deleted').length, 0);
  } finally { box.cleanup(); }
});
