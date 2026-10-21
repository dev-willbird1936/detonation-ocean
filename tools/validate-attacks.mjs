// Offline integrity check for the curated attack catalogue.
// Usage: node tools/validate-attacks.mjs
// Reads local attack and synthetic-persona manifests; makes no network requests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validatePersonaManifest } from '../backend/personas.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data', 'attacks.json'), 'utf8'));
const personas = JSON.parse(readFileSync(join(root, 'data', 'personas.json'), 'utf8'));
const attacks = data.attacks;
const errors = [];
const expectedClasses = { A: 14, B: 6, C: 27, D: 3 };
const expectedTypes = { Incident: 19, Campaign: 3, Malware: 16, Vulnerability: 3, Technique: 7, Disclosure: 2 };
const expectedVectors = data._meta.axes.vector.split('|').map(value => value.trim());
const ids = new Set();

try {
  validatePersonaManifest(personas);
} catch (error) {
  errors.push(`synthetic persona manifest: ${error.message}`);
}
if (attacks.length !== 50 || data._meta.count !== 50) errors.push('expected exactly 50 attacks');
for (const attack of attacks) {
  const id = attack.id || '(missing id)';
  if (ids.has(id)) errors.push(`${id}: duplicate id`);
  ids.add(id);

  for (const key of ['id', 'name', 'summary', 'lesson', 'source', 'vector', 'cls', 'type', 'fe', 'be']) {
    if (typeof attack[key] !== 'string' || !attack[key].trim()) errors.push(`${id}: missing ${key}`);
  }
  if (!Number.isInteger(attack.year) || attack.year < 1980 || attack.year > 2030) errors.push(`${id}: invalid year`);
  if (!['A', 'B', 'C', 'D'].includes(attack.cls)) errors.push(`${id}: invalid class`);
  if (!Object.hasOwn(expectedTypes, attack.type)) errors.push(`${id}: invalid type`);
  if (!expectedVectors.includes(attack.vector)) errors.push(`${id}: invalid vector`);
  if (!Number.isInteger(attack.stages) || attack.stages < 0 || attack.stages > 5) errors.push(`${id}: invalid stage count`);
  if (![1, 2, 3, 4, 5].includes(attack.sev)) errors.push(`${id}: invalid severity`);
  if (![1, 2, 3, 4, 5].includes(attack.attacker_cost)) errors.push(`${id}: invalid attacker_cost`);
  if (![1, 2, 3, 4, 5].includes(attack.impact)) errors.push(`${id}: invalid impact`);
  if (typeof attack.lure !== 'boolean' || typeof attack.simulatable !== 'boolean') errors.push(`${id}: invalid lure/simulatable flags`);
  if (['A', 'B'].includes(attack.cls) !== (attack.lure && attack.simulatable)) errors.push(`${id}: A/B must be playable human-triggered scenarios`);
  if (['C', 'D'].includes(attack.cls) && (attack.lure || attack.simulatable)) errors.push(`${id}: C/D must not claim a human lure`);

  if (!Array.isArray(attack.source_urls) || !attack.source_urls.length) errors.push(`${id}: no source URLs`);
  else for (const link of attack.source_urls) {
    try {
      const url = new URL(link);
      if (url.protocol !== 'https:') errors.push(`${id}: source URL must use HTTPS (${link})`);
    } catch {
      errors.push(`${id}: malformed source URL (${link})`);
    }
  }
  if (attack.type === 'Technique' && !attack.date_note) errors.push(`${id}: technique family needs a date-scope note`);
}

const classCounts = Object.fromEntries(Object.keys(expectedClasses).map(c => [c, attacks.filter(a => a.cls === c).length]));
const typeCounts = Object.fromEntries(Object.keys(expectedTypes).map(t => [t, attacks.filter(a => a.type === t).length]));
for (const [key, expected] of Object.entries(expectedClasses)) if (classCounts[key] !== expected) errors.push(`class ${key}: expected ${expected}, got ${classCounts[key]}`);
for (const [key, expected] of Object.entries(expectedTypes)) if (typeCounts[key] !== expected) errors.push(`type ${key}: expected ${expected}, got ${typeCounts[key]}`);

if (errors.length) {
  console.error(`dataset validation failed (${errors.length} issue(s))`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`dataset valid: ${attacks.length} entries; classes ${JSON.stringify(classCounts)}; types ${JSON.stringify(typeCounts)}; ${attacks.reduce((n, a) => n + a.source_urls.length, 0)} source links; ${personas.personas.length} synthetic persona(s)`);
}
