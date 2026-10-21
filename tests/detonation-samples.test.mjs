import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = join(root, 'samples');
const header = 'Demo sample for Detonation Ocean. Refuses to run outside the sandbox.';
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/,
];

function zipEntries(buffer) {
  const entries = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const dataStart = offset + 30 + nameLength + buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const packed = buffer.subarray(dataStart, dataStart + size);
    entries[name] = (method === 8 ? inflateRawSync(packed) : packed).toString('utf8');
    offset = dataStart + size;
  }
  return entries;
}

// Static files that cannot read the environment; they run no code that touches the machine. The M4 samples test covers the rest.
const inertSamples = new Set(['invoice.pdf.html', 'report.pdf', 'hello.html', 'badge.svg', 'notice.eml']);

function sampleTexts() {
  const texts = {};
  for (const entry of readdirSync(samplesDir, { withFileTypes: true })) {
    // Directories (src, bin), the README and the binary budget.docm are covered by detonation-samples-m4.test.mjs.
    const name = entry.name;
    if (!entry.isFile() || name === 'README.md' || name.endsWith('.docm')) continue;
    const buffer = readFileSync(join(samplesDir, name));
    if (name === 'bundle.zip') {
      for (const [entry, text] of Object.entries(zipEntries(buffer))) texts[`bundle.zip:${entry}`] = text;
    } else {
      texts[name] = buffer.toString('utf8');
    }
  }
  return texts;
}

test('every sample carries the header comment and the sandbox guard near its top', () => {
  for (const [name, text] of Object.entries(sampleTexts())) {
    assert.ok(text.includes(header), `${name}: header comment`);
    if (inertSamples.has(name)) continue;
    const top = text.split('\n').slice(0, 12).join('\n');
    assert.ok(top.includes('DETONATION_SANDBOX'), `${name}: DETONATION_SANDBOX check near the top`);
    assert.ok(top.includes('/home/dana/Documents'), `${name}: /home/dana/Documents check near the top`);
  }
});

test('bundle.zip holds the two demo scripts', () => {
  const entries = zipEntries(readFileSync(join(samplesDir, 'bundle.zip')));
  assert.deepEqual(Object.keys(entries).sort(), ['clean-chart.py', 'obfuscated-hello.ps1']);
});

test('no sample contains a real-looking secret', () => {
  for (const [name, text] of Object.entries(sampleTexts())) {
    for (const pattern of secretPatterns) assert.ok(!pattern.test(text), `${name}: matches ${pattern.source}`);
  }
});

const python = process.platform === 'win32' ? 'python' : 'python3';

function runWithoutSandbox(command, args) {
  const env = { ...process.env };
  delete env.DETONATION_SANDBOX;
  // The guard returns before any work (loop.js would run for good without it). The limit is generous because the suite runs many test files at once, and
  // starting an interpreter under that load has taken over 2 s.
  const result = spawnSync(command, args, { cwd: root, env, timeout: 15_000, stdio: 'ignore' });
  assert.equal(result.error, undefined, 'finished before the 15 s limit');
  assert.equal(result.status, 0);
}

test('invoice.py exits 0 at once when run without DETONATION_SANDBOX', () => {
  runWithoutSandbox(python, ['samples/invoice.py']);
});

test('loop.js exits 0 at once when run without DETONATION_SANDBOX', () => {
  runWithoutSandbox(process.execPath, ['samples/loop.js']);
});
