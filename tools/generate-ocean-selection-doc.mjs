import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const selection = JSON.parse(readFileSync(join(root, 'data/ocean-selection.json'), 'utf8'));
const FAMILIES = {
  deception: 'Deception · Anglerfish',
  intrusion: 'Intrusion · Viperfish',
  'network-abuse': 'Coordinated abuse · Siphonophore',
  'trusted-source': 'Trusted-source compromise · Isopod host fish',
  'theft-surveillance': 'Theft / surveillance · Cookiecutter shark',
  'extortion-destruction': 'Extortion / destruction · Octopus / kraken',
};
const DEPTHS = {
  sunlight: 'Sunlight — Clean',
  twilight: 'Twilight — Risky or inconclusive',
  midnight: 'Midnight — Steals',
  abyss: 'Abyss — Takes control',
  trench: 'Trench — Destroys',
};
const label = entry => (entry.year ? `${entry.name} (${entry.year})` : entry.name);
const sources = entry => (entry.sources.length ? entry.sources.map((url, index) => `[${index + 1}](${url})`).join(' ') : '—');
const note = entry => (entry.note ? entry.note.replaceAll('|', '/').replaceAll('\n', ' ') : '—');
const lines = [
  '# The 60 main scenarios',
  '',
  '> Generated from `data/ocean-selection.json` by `node tools/generate-ocean-selection-doc.mjs`. Edit the JSON, not this file.',
  '',
  'This is the main vulnerability list: 12 scenarios per depth, six forced family anchors and six free picks.',
  '',
  '## Rules',
  '',
  '- **12 per depth, 60 in total.** Depth is the harm tier the attack reached, not historical severity.',
  '- **30 anchors.** Each depth has one forced anchor per vulnerability family. Each anchor is the scenario its creature profile shows (6 families × 5 depths = 30 creature variants).',
  '- **30 free picks.** Six per depth, chosen as the most iconic or well-known for that depth, with no family requirement.',
  '- Entries are incidents, malware families and documented technique variants, not 60 separate CVEs. Family placement of an anchor is an editorial browsing choice; sources establish the victim action.',
  '- Playable scenes are original, fictional reconstructions inspired by these entries. They contain no real payloads, credentials, brands or host effects.',
  '',
  '## Evidence status',
  '',
  '- **sourced** — a source for the victim action was fetched and read; the link is listed.',
  '- **partial** — the scenario and part of the victim action are sourced; the gap is stated in the note.',
  '- **unsupported** — research found no evidence for this depth or placement (see note). Not yet reclassified.',
  '- **needs-sources** / **provisional** — named but not yet evaluated.',
  '',
];
const counts = {};
const count = entry => { counts[entry.status] = (counts[entry.status] || 0) + 1; };
for (const depth of Object.keys(DEPTHS)) {
  const list = selection.depths[depth];
  lines.push(`## ${DEPTHS[depth]}`, '', '### Anchors', '', '| Family · creature | Scenario | Victim action | Status | Sources | Note |', '|---|---|---|---|---|---|');
  for (const entry of list.filter(item => item.role === 'anchor')) {
    lines.push(`| ${FAMILIES[entry.family]} | **${label(entry)}** | ${entry.victimAction} | ${entry.status} | ${sources(entry)} | ${note(entry)} |`);
    count(entry);
  }
  lines.push('', '### Free picks', '', '| Scenario | Victim action | Status | Sources | Note |', '|---|---|---|---|---|');
  for (const entry of list.filter(item => item.role === 'free')) {
    lines.push(`| ${label(entry)} | ${entry.victimAction} | ${entry.status} | ${sources(entry)} | ${note(entry)} |`);
    count(entry);
  }
  lines.push('');
}
lines.push('## Status totals', '', ...Object.entries(counts).map(([status, total]) => `- ${status}: ${total}`), '');
writeFileSync(join(root, 'docs/ocean-selection.md'), lines.join('\n'));
