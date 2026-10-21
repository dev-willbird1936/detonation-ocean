// Scenario id -> attackKind, read from the content workers' scene files (SCENARIOS-60-CONTRACT §2).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ATTACK_KINDS } from './kinds.mjs';

const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];

/** The 60 scenario ids of data/ocean-selection.json, in depth order. */
export function selectionIds(root) {
  const selection = JSON.parse(readFileSync(join(root, 'data', 'ocean-selection.json'), 'utf8'));
  return DEPTHS.flatMap(depth => selection.depths[depth].map(item => item.id));
}

/**
 * Evaluate each depth file in an empty VM context and read `attackKind` per scenario.
 * Returns { kinds: {id: kind}, problems: [string] }; a missing file, a missing scenario or an unknown kind is a problem.
 */
export function loadScenarioKinds(root) {
  const dir = join(root, 'desktop-comparison', 'previews', 'ocean-scenarios');
  const kinds = {};
  const problems = [];
  for (const depth of DEPTHS) {
    const file = join(dir, `${depth}.js`);
    if (!existsSync(file)) { problems.push(`${depth}.js is missing`); continue; }
    const context = vm.createContext({});
    try {
      vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file, timeout: 2000 });
    } catch (error) {
      problems.push(`${depth}.js did not load: ${error.message}`);
      continue;
    }
    for (const [id, scene] of Object.entries(context.OceanScenarioData ?? {})) {
      if (ATTACK_KINDS.includes(scene?.attackKind)) kinds[id] = scene.attackKind;
      else problems.push(`${id}: attackKind ${JSON.stringify(scene?.attackKind)} is not in the fixed list`);
    }
  }
  for (const id of existsSync(join(root, 'data', 'ocean-selection.json')) ? selectionIds(root) : []) {
    if (!(id in kinds) && !problems.some(problem => problem.startsWith(`${id}:`))) problems.push(`${id}: no scenario data`);
  }
  return { kinds, problems };
}
