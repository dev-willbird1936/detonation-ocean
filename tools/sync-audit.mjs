// Syncs claim/source lines in the audit docs from data/attacks.json; --check reports drift without writing.
import { readFileSync, writeFileSync } from 'node:fs';
const check = process.argv.includes('--check');
const data = JSON.parse(readFileSync('data/attacks.json', 'utf8')).attacks;
const byId = new Map(data.map(a => [a.id, a]));
const fmt = urls => urls.map(u => `<${u}>`).join(' · ');
let drift = 0;

function rewrite(file, lineFor) {
  const src = readFileSync(file, 'utf8');
  const parts = src.split(/^(?=## )/m);
  const out = parts.map(block => {
    const id = block.match(/^## (\S+) — /)?.[1];
    const a = id && byId.get(id);
    if (!a) return block;
    return lineFor(block, a);
  });
  const next = out.join('');
  if (next !== src) { drift++; console.log(`${check ? 'drift' : 'updated'}: ${file}`); if (!check) writeFileSync(file, next); }
}
const sub = (block, re, repl) => block.replace(re, () => repl);

rewrite('docs/source-audit.md', (b, a) => {
  b = sub(b, /^\*\*Current claim:\*\* .*$/m, `**Current claim:** ${a.summary}`);
  return sub(b, /^\*\*Sources:\*\* .*$/m, `**Sources:** ${fmt(a.source_urls)}`);
});
const audit = readFileSync('docs/source-audit.md', 'utf8');
const notes = new Map();
for (const b of audit.split(/^(?=## )/m)) {
  const id = b.match(/^## (\S+) — /)?.[1];
  const n = b.match(/^\*\*Cross-check note:\*\* (.*)$/m)?.[1];
  if (id && n) notes.set(id, n);
}
rewrite('docs/source-audit-excerpts.md', (b, a) => {
  b = sub(b, /^\*\*Current claim:\*\* .*$/m, `**Current claim:** ${a.summary}`);
  b = sub(b, /^\*\*Record source URLs:\*\* .*$/m, `**Record source URLs:** ${fmt(a.source_urls)}`);
  const n = notes.get(a.id);
  return n ? sub(b, /^\*\*Cross-check note:\*\* .*$/m, `**Cross-check note:** ${n}`) : b;
});
if (check && drift) process.exitCode = 1;
else console.log(drift ? 'sync complete' : 'audit docs in sync');
