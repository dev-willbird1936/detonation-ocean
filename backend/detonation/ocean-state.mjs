// Public ocean state (SPEC §9.2, DETONATION-DESIGN §6). Holds only counts: no file names, hashes, job IDs or fine-grained times.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FISH_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'fish.json');
const FISH_DEPTHS = ['sunlight', 'twilight'];
const CREATURE_DEPTHS = ['midnight', 'abyss', 'trench'];
const RARE_BELOW = 5;

// Fallback when data/fish.json is absent or lacks a type: DETONATION-DESIGN §6, keyed by detectedType.
const INLINE_SPECIES = {
  pufferfish: ['zip', '7z', 'rar'], flounder: ['pdf'], 'leafy-seadragon': ['docx', 'docm', 'doc'],
  boxfish: ['xlsx', 'xlsm', 'xls'], lionfish: ['pptx', 'pptm', 'ppt'], ribbonfish: ['rtf'],
  barracuda: ['exe'], remora: ['dll'], 'mandarin-dragonet': ['html'], 'picasso-triggerfish': ['svg'],
  'flying-fish': ['eml', 'msg'], batfish: ['bat'], 'pilot-fish': ['js-wsh', 'vbs', 'hta'],
  'torpedo-ray': ['ps1'], archerfish: ['lnk'], 'snake-eel': ['py'], jack: ['js-node'],
  'sea-bass': ['sh'], 'goblin-shark': ['elf'], jawfish: ['msi'],
  butterflyfish: ['png', 'jpeg', 'gif'], plaice: ['text'], 'pocket-shark': ['apk'],
  mackerel: ['dmg', 'pkg', 'macho'], 'java-rabbitfish': ['jar'], sole: ['one'],
};

let speciesMap;
function species() {
  if (speciesMap) return speciesMap;
  const byType = new Map(Object.entries(INLINE_SPECIES).flatMap(([name, types]) => types.map((t) => [t, name])));
  let fallback = 'coelacanth';
  if (existsSync(FISH_FILE)) {
    const fish = JSON.parse(readFileSync(FISH_FILE, 'utf8'));
    for (const { species: name, types } of fish.fish) for (const t of types) byType.set(t, name);
    fallback = fish.fallback ?? fallback;
  }
  return (speciesMap = { byType, fallback });
}

export const emptyState = () => ({ schools: {}, creatures: {} });

export function loadState(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : emptyState();
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file);
}

// pending is a plain array; nothing reaches the public state until applyBatch.
export function addResult(pending, { detectedType, depth, findings = [] }) {
  if (FISH_DEPTHS.includes(depth)) {
    const { byType, fallback } = species();
    pending.push({ species: byType.get(detectedType) ?? fallback, depth });
  } else if (CREATURE_DEPTHS.includes(depth)) {
    for (const finding of findings) pending.push({ findingId: typeof finding === 'string' ? finding : finding.id });
  } else {
    throw new Error(`unknown depth: ${depth}`);
  }
  return pending;
}

export function applyBatch(state, pending) {
  for (const { species: name, depth, findingId } of pending) {
    if (findingId !== undefined) {
      state.creatures[findingId] = (state.creatures[findingId] ?? 0) + 1;
    } else {
      const school = (state.schools[name] ??= {});
      school[depth] = (school[depth] ?? 0) + 1;
    }
  }
  pending.length = 0;
  return state;
}

export function publicView(state, batchAt) {
  const { fallback } = species();
  const folded = {};
  for (const [name, depths] of Object.entries(state.schools)) {
    const total = Object.values(depths).reduce((a, b) => a + b, 0);
    const target = total < RARE_BELOW ? fallback : name;
    for (const [depth, count] of Object.entries(depths)) {
      folded[target] ??= {};
      folded[target][depth] = (folded[target][depth] ?? 0) + count;
    }
  }
  // Sorted, so output order cannot reveal arrival order.
  const schools = Object.entries(folded)
    .flatMap(([name, depths]) => Object.entries(depths).map(([depth, count]) => ({ species: name, depth, count })))
    .sort((a, b) => a.species.localeCompare(b.species) || a.depth.localeCompare(b.depth));
  const creatures = Object.entries(state.creatures)
    .map(([findingId, eaten]) => ({ findingId, eaten }))
    .sort((a, b) => a.findingId.localeCompare(b.findingId));
  return { batchAt, schools, creatures };
}

export const creatureSize = (base, eaten) => (eaten < 1 ? 0 : base * Math.min(3, 1 + Math.log2(eaten)));
