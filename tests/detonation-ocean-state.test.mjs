import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectType } from '../backend/detonation/filetype.mjs';
import { addResult, applyBatch, creatureSize, emptyState, loadState, publicView, saveState } from '../backend/detonation/ocean-state.mjs';

const BATCH_AT = '2026-01-01T00:05:00.000Z';
const fish = (detectedType, depth = 'sunlight') => ({ detectedType, depth, findings: [] });

const zipOf = (...names) => Buffer.concat(names.map((name) => {
  const header = Buffer.alloc(30);
  header.write('PK\x03\x04', 0, 'latin1');
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, Buffer.from(name, 'latin1')]);
}));
const pe = (characteristics) => {
  const buf = Buffer.alloc(0x100);
  buf.write('MZ', 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.write('PE\0\0', 0x80, 'latin1');
  buf.writeUInt16LE(characteristics, 0x80 + 22);
  return buf;
};
const ole2Header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// One real buffer per species in data/fish.json (coelacanth is the fallback and takes any unrecognised buffer).
const SPECIES_BUFFERS = {
  pufferfish: zipOf('a.txt'),
  flounder: Buffer.from('%PDF-1.7'),
  'leafy-seadragon': zipOf('[Content_Types].xml', 'word/document.xml'),
  boxfish: zipOf('[Content_Types].xml', 'xl/workbook.xml'),
  lionfish: zipOf('[Content_Types].xml', 'ppt/presentation.xml'),
  ribbonfish: Buffer.from('{\\rtf1'),
  barracuda: pe(0x0102),
  remora: pe(0x2102),
  'mandarin-dragonet': Buffer.from('<html><body></body></html>'),
  'picasso-triggerfish': Buffer.from('<svg xmlns="x"></svg>'),
  'flying-fish': Buffer.from('Received: x\nFrom: a@b.c\nTo: d@e.f\nSubject: hi\n\nbody'),
  batfish: Buffer.from('@echo off\r\necho hi'),
  'pilot-fish': Buffer.from('Dim x\nSet o = CreateObject("WScript.Shell")'),
  'torpedo-ray': Buffer.from('Write-Host "hi"'),
  archerfish: Buffer.from([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0]),
  'snake-eel': Buffer.from('import os\nos.listdir(".")'),
  jack: Buffer.from('const fs = require("fs");'),
  'sea-bass': Buffer.from('#!/bin/sh\nls'),
  'goblin-shark': Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
  jawfish: Buffer.concat([ole2Header, Buffer.from([0x84, 0x10, 0x0c, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46])]),
  'pocket-shark': zipOf('AndroidManifest.xml', 'classes.dex'),
  mackerel: Buffer.from('feedfacf00000007', 'hex'),
  'java-rabbitfish': zipOf('META-INF/MANIFEST.MF'),
  sole: Buffer.from('e4525c7b8cd8a74daeb15378d02996d3', 'hex'),
  butterflyfish: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  plaice: Buffer.from('hello world'),
};

test('every species in data/fish.json is reached by at least one detected buffer', () => {
  const { fish: roster, fallback } = JSON.parse(readFileSync(new URL('../data/fish.json', import.meta.url), 'utf8'));
  const reached = new Set();
  for (const buffer of Object.values(SPECIES_BUFFERS)) {
    reached.add(addResult([], { depth: 'sunlight', detectedType: detectType(buffer).detectedType })[0].species);
  }
  for (const [expected, buffer] of Object.entries(SPECIES_BUFFERS)) {
    assert.equal(addResult([], { depth: 'sunlight', detectedType: detectType(buffer).detectedType })[0].species, expected);
  }
  for (const { species } of roster) if (species !== fallback) assert.ok(reached.has(species), species);
});

test('AT-15: a single job is invisible until the batch is applied', () => {
  const state = emptyState();
  const pending = addResult([], fish('pdf'));
  assert.deepEqual(publicView(state, BATCH_AT), { batchAt: BATCH_AT, schools: [], creatures: [] });
  applyBatch(state, pending);
  assert.equal(pending.length, 0);
  assert.equal(publicView(state, BATCH_AT).schools.length, 1);
});

test('Sunlight and Twilight add fish; Midnight and deeper add creature eats, not fish', () => {
  const state = emptyState();
  const pending = [];
  addResult(pending, fish('pdf', 'twilight'));
  addResult(pending, { detectedType: 'pdf', depth: 'midnight', findings: ['credential-theft', { id: 'keylogger' }] });
  addResult(pending, { detectedType: 'exe', depth: 'trench', findings: ['credential-theft'] });
  applyBatch(state, pending);
  assert.deepEqual(state.schools, { flounder: { twilight: 1 } });
  assert.deepEqual(state.creatures, { 'credential-theft': 2, keylogger: 1 });
});

test('species with fewer than 5 fish fold into the coelacanth until they reach 5', () => {
  const state = emptyState();
  const pending = [];
  for (let i = 0; i < 4; i++) addResult(pending, fish('pdf'));
  for (let i = 0; i < 5; i++) addResult(pending, fish('exe', i % 2 ? 'twilight' : 'sunlight'));
  applyBatch(state, pending);
  const view = publicView(state, BATCH_AT);
  assert.deepEqual(view.schools, [
    { species: 'barracuda', depth: 'sunlight', count: 3 },
    { species: 'barracuda', depth: 'twilight', count: 2 },
    { species: 'coelacanth', depth: 'sunlight', count: 4 },
  ]);
  addResult(pending, fish('pdf'));
  applyBatch(state, pending);
  assert.ok(publicView(state, BATCH_AT).schools.some((s) => s.species === 'flounder' && s.count === 5));
});

test('unknown types become coelacanths; unknown depths are rejected', () => {
  const state = emptyState();
  applyBatch(state, addResult([], fish('mystery')));
  assert.ok('coelacanth' in state.schools);
  assert.throws(() => addResult([], fish('pdf', 'surface')), /unknown depth/);
});

test('public view carries no names, hashes, job IDs or finer times', () => {
  const state = emptyState();
  const pending = [];
  const secret = { name: 'invoice-secret.pdf', sha256: 'a'.repeat(64), jobId: 'job-123', at: '2026-01-01T00:03:17Z' };
  addResult(pending, { detectedType: 'pdf', depth: 'sunlight', findings: [], ...secret });
  addResult(pending, { detectedType: 'pdf', depth: 'midnight', findings: ['credential-theft'], ...secret });
  applyBatch(state, pending);
  const json = JSON.stringify(publicView(state, BATCH_AT)) + JSON.stringify(state);
  for (const value of Object.values(secret)) assert.ok(!json.includes(value), value);
  assert.deepEqual(Object.keys(publicView(state, BATCH_AT)), ['batchAt', 'schools', 'creatures']);
});

test('creature size is base * min(3, 1 + log2(eaten))', () => {
  assert.equal(creatureSize(10, 0), 0);
  assert.equal(creatureSize(10, 1), 10);
  assert.equal(creatureSize(10, 4), 30);
  assert.equal(creatureSize(10, 1024), 30);
  assert.equal(creatureSize(10, 2), 20);
});

test('state round-trips through an atomically written JSON file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocean-state-'));
  const file = join(dir, 'sub', 'ocean-state.json');
  assert.deepEqual(loadState(file), emptyState());
  const state = applyBatch(emptyState(), addResult([], { detectedType: 'exe', depth: 'abyss', findings: ['persistence'] }));
  saveState(file, state);
  assert.deepEqual(loadState(file), state);
  assert.deepEqual(readdirSync(join(dir, 'sub')), ['ocean-state.json']);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { schools: {}, creatures: { persistence: 1 } });
  assert.ok(existsSync(file));
});
