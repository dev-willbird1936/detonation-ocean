// Build: retain the synthetic chamber; make the packaged Abyss renderer the homepage.
// Usage: node build.mjs
// The main 3D UI requires node server.mjs. The legacy catalogue remains available at chamber.html.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePersonaManifest } from './backend/personas.mjs';

const root = dirname(fileURLToPath(import.meta.url));

const data = JSON.parse(readFileSync(join(root, 'data/attacks.json'), 'utf8'));
const personas = validatePersonaManifest(JSON.parse(readFileSync(join(root, 'data/personas.json'), 'utf8')));
const template = readFileSync(join(root, 'src/index.template.html'), 'utf8');

if (!data.attacks?.length) throw new Error('data/attacks.json has no attacks array');

const payload = JSON.stringify(data).replace(/</g, '\\u003c');
const personaPayload = JSON.stringify(personas).replace(/</g, '\\u003c');

const dataMarker = '/*__DATA__*/';
const personaMarker = '/*__PERSONAS__*/';
if (!template.includes(dataMarker) || !template.includes(personaMarker)) {
  throw new Error(`template must contain both ${dataMarker} and ${personaMarker} markers`);
}

const html = template.replace(dataMarker, payload).replace(personaMarker, personaPayload);
const rendererDir = join(root, 'ui/abyss');
const hasRenderer = existsSync(rendererDir);
const main = hasRenderer ? readFileSync(join(rendererDir, 'index.html'), 'utf8') : html;
const out = join(root, 'chamber.html');
writeFileSync(out, html, 'utf8');
writeFileSync(join(root, 'index.html'), main, 'utf8');

const classCounts = Object.fromEntries(['A', 'B', 'C', 'D'].map((cls) => [
  cls,
  data.attacks.filter((attack) => attack.cls === cls).length,
]));
console.log(
  `built ${hasRenderer ? 'Abyss' : 'timeline (Abyss renderer not installed)'} index.html and chamber.html  ${data.attacks.length} attacks  A ${classCounts.A} / B ${classCounts.B} / C ${classCounts.C} / D ${classCounts.D}  ${(html.length / 1024).toFixed(1)} KB`,
);
