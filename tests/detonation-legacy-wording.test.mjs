import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const OLD_LADDER_PHRASES = [
  'open or run a malicious file',
  'disclose a factor or approve attacker-induced mfa',
  'give the attacker a password',
  'navigate or authorise',
  'no fresh response by the displayed victim',
  'victim-action ladder',
  'victim-action depth',
  'the less its victim could have done',
  'the less the victim could have done',
  'open or run content',
  'supply a factor',
  'supply a password',
  'visit or authorize without giving',
  'no attack-specific victim response required',
  'depth is defined by the victim',
  'depth is the victim',
  'how far its victim would have to go',
  'how much the victim had to do',
  'no fresh victim response',
  'open / run a file',
  'visit / authorize',
];

const CHECKED_SOURCES = [
  'backend/ocean-profiles.mjs',
  'tools/generate-ocean-selection-doc.mjs',
  'docs/ocean-selection.md',
  'index.html',
  'ui/abyss/index.html',
  'ui/desktop/ocean-profiles.html',
  'src/index.template.html',
  'data/ocean-taxonomy.json',
  'data/ocean-menu-taxonomy.json',
  'tools/build-ocean-taxonomy.mjs',
  'tools/retrodiffusion-family-depth-study.py',
  'docs/ocean-taxonomy.md',
  'docs/ocean-menu-taxonomy.md',
  'docs/VISION.md',
  'docs/DETONATION-DESIGN.md',
  'tests/desktop-ui.test.mjs',
  'tests/browser-integration.test.mjs',
];

function assertNoOldLadderWording(path) {
  const text = readFileSync(join(root, path), 'utf8').toLowerCase();
  for (const phrase of OLD_LADDER_PHRASES) assert.ok(!text.includes(phrase), `${path} contains old ladder wording "${phrase}"`);
}

for (const path of CHECKED_SOURCES) {
  test(`${path} has no old victim-action ladder wording`, () => assertNoOldLadderWording(path));
}
