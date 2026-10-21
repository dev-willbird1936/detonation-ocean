import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanName, generateName, nameFor, otherNames, saveName } from '../ui/job/fish-names.mjs';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('generated names are two words, alliterate with the species and repeat for the same job', () => {
  const name = generateName('j-1', 'snake-eel');
  assert.match(name, /^S\w+ S\w+$/);
  assert.equal(generateName('j-1', 'snake-eel'), name);
  assert.notEqual(generateName('j-1', 'snake-eel', [], 1), name, 'a reroll gives another name');
});

test('generated names avoid names already taken, even when every alliterating pair is used', () => {
  const taken = [];
  for (let i = 0; i < 400; i += 1) taken.push(generateName(`j-${i}`, 'zebra', taken));
  assert.equal(new Set(taken.map(n => n.toLowerCase())).size, taken.length);
});

test('names say nothing about the file: only the job id and species go in', () => {
  assert.equal(generateName.length, 2); // (jobId, species, taken = [], turn = 0)
  const name = generateName('j-secret-report.docx', 'barracuda');
  assert.doesNotMatch(name.toLowerCase(), /secret|report|docx/);
});

test('cleanName keeps text, strips control characters and caps the length', () => {
  assert.equal(cleanName('  Captain <b>Nemo</b>\u0000 '), 'Captain <b>Nemo</b>');
  assert.equal(cleanName('a'.repeat(40)).length, 24);
  assert.equal(cleanName('   '), '');
});

test('nameFor stores a name once; saveName overrides it; otherNames leaves out the job itself', () => {
  const storage = memory();
  const first = nameFor('j-a', 'jack', storage);
  assert.equal(nameFor('j-a', 'jack', storage), first);
  saveName('j-b', 'Bubbles', storage);
  assert.deepEqual(otherNames('j-a', storage), ['Bubbles']);
  assert.notEqual(nameFor('j-c', 'jack', storage), first);
});
