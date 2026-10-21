// One-off merge of researcher findings into data/ocean-selection.json.
// usage: node tools/merge-ocean-sources.mjs <findings.json> [...]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'data/ocean-selection.json');
const selection = JSON.parse(readFileSync(file, 'utf8'));
const entries = new Map(Object.values(selection.depths).flat().map(entry => [entry.id, entry]));
const STATUS = { supported: 'sourced', partly: 'partial', unsupported: 'unsupported' };
let merged = 0;
for (const path of process.argv.slice(2)) {
  for (const finding of JSON.parse(readFileSync(path, 'utf8'))) {
    const entry = entries.get(finding.id);
    if (!entry) throw new Error(`unknown id ${finding.id}`);
    if (!STATUS[finding.verdict]) throw new Error(`bad verdict ${finding.id}`);
    // Only HTTPS sources are recorded; a plain-HTTP source (e.g. the 1989 CIAC bulletin) is kept in the note by hand.
    for (const source of finding.sources) if (!/^https:\/\//.test(source.url)) throw new Error(`non-https source ${finding.id}`);
    entry.status = STATUS[finding.verdict];
    if (finding.verdict !== 'unsupported') {
      entry.sources = [...new Set([...entry.sources, ...finding.sources.map(source => source.url)])];
      if (finding.victimAction_suggested) entry.victimAction = finding.victimAction_suggested;
      if (entry.year === null && Number.isInteger(finding.year_suggested)) entry.year = finding.year_suggested;
    }
    if (finding.verdict !== 'supported') entry.note = finding.note;
    merged += 1;
  }
}
selection.decision = selection.decision.replace(
  /status: sourced.*$/,
  'status: sourced = a source for the victim action was fetched and read; partial = occurrence and part of the victim action sourced, with the gap stated in note; unsupported = research did not find evidence for this depth/placement (see note; not yet reclassified); needs-sources = named in research with no source recorded yet; provisional = reporting establishes phishing but not that a password alone was enough.');
writeFileSync(file, `${JSON.stringify(selection, null, 2)}\n`);
console.log(`merged ${merged}`);
