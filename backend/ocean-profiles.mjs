import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TAXONOMY_PATH = 'data/ocean-taxonomy.json';
const SELECTION_PATH = 'data/ocean-selection.json';
const ANIMATION_ROOT = 'ocean-style-prototypes/retrodiffusion-creature-animation';
const EVOLUTION_ROOT = 'ocean-style-prototypes/codex-creature-depth-evolution';
const DEPTH_COLOR_ROOT = `${EVOLUTION_ROOT}/depth-colors`;
const LIT_ROOT = 'ocean-style-prototypes/lit-ocean'; // lit copies served to the desktops (tools/build-lit-ocean-sprites.py)
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_ANIMATION_BYTES = 1024 * 1024;
const MAX_COLOR_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_LIT_MANIFEST_BYTES = 256 * 1024;
const MAX_MORPHOLOGY_BYTES = 512 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MORPHOLOGY_STAGE_BY_DEPTH = Object.freeze({
  sunlight: 'base-rich', twilight: 'base-rich',
  midnight: 'midnight-abyss', abyss: 'midnight-abyss', trench: 'trench',
});
const MORPHOLOGY_LABELS = Object.freeze({
  'base-rich': 'Shared base · Sunlight / Twilight',
  'midnight-abyss': 'Midnight / Abyss evolution',
  trench: 'Advanced Trench form',
});

const FAMILY_LABELS = Object.freeze({
  deception: { label: 'Deception', creature: 'Anglerfish', displayCreature: 'Anglerfish', asset: 'anglerfish', morphology: 'anglerfish' },
  intrusion: { label: 'Intrusion', creature: 'Viperfish', displayCreature: 'Viperfish', asset: 'viperfish', morphology: 'viperfish' },
  'network-abuse': { label: 'Coordinated abuse', creature: 'Siphonophore', displayCreature: 'Siphonophore', asset: 'siphonophore', morphology: 'siphonophore' },
  'trusted-source': { label: 'Trusted-source compromise', creature: 'Isopod host fish', displayCreature: 'Isopod host fish', asset: 'isopod-host', morphology: 'isopod-host' },
  'theft-surveillance': { label: 'Theft / surveillance', creature: 'Cookiecutter shark', displayCreature: 'Cookiecutter shark', asset: 'cookiecutter', morphology: 'cookiecutter' },
  'extortion-destruction': { label: 'Extortion / destruction', creature: 'Octopus / kraken', displayCreature: 'Squid / Kraken', asset: 'octopus', morphology: 'squid' },
});
const DEPTH_TIERS = Object.freeze({
  sunlight: 'Clean',
  twilight: 'Risky or inconclusive',
  midnight: 'Steals',
  abyss: 'Takes control',
  trench: 'Destroys',
});
const DEPTH_IDS = Object.freeze(['sunlight', 'twilight', 'midnight', 'abyss', 'trench']);
const SELECTION_STATUSES = new Set(['sourced', 'partial', 'unsupported', 'needs-sources', 'provisional']);
const SELECTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isHttpsSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function loadOceanSelection(root) {
  const selection = readJson(root, SELECTION_PATH, MAX_MANIFEST_BYTES);
  const ids = new Set();
  const entries = [];
  for (const depthId of DEPTH_IDS) {
    const list = selection.depths?.[depthId];
    if (!Array.isArray(list) || list.length !== 12) throw new Error(`ocean_selection_depth_rejected: ${depthId}`);
    const anchors = new Set();
    for (const entry of list) {
      if (typeof entry.id !== 'string' || !SELECTION_ID.test(entry.id) || ids.has(entry.id)) throw new Error(`ocean_selection_id_rejected: ${entry.id}`);
      if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 160 ||
          (entry.year !== null && (!Number.isInteger(entry.year) || entry.year < 1900 || entry.year > 2100)) ||
          typeof entry.victimAction !== 'string' || !entry.victimAction.trim() || entry.victimAction.length > 500 ||
          !SELECTION_STATUSES.has(entry.status) || !Array.isArray(entry.sources) || entry.sources.length > 10 ||
          entry.sources.some(source => typeof source !== 'string' || source.length > 2048 || !isHttpsSource(source)) ||
          (entry.status === 'sourced' && entry.sources.length === 0)) {
        throw new Error(`ocean_selection_entry_rejected: ${entry.id}`);
      }
      ids.add(entry.id);
      if (entry.role === 'anchor') {
        if (typeof entry.family !== 'string' || !Object.hasOwn(FAMILY_LABELS, entry.family) || anchors.has(entry.family)) throw new Error(`ocean_selection_anchor_rejected: ${entry.id}`);
        anchors.add(entry.family);
      } else if (entry.role !== 'free' || entry.family !== null) {
        throw new Error(`ocean_selection_role_rejected: ${entry.id}`);
      }
      entries.push(Object.freeze({ ...entry, sources: Object.freeze([...entry.sources]), depthId }));
    }
    if (anchors.size !== Object.keys(FAMILY_LABELS).length) throw new Error(`ocean_selection_anchors_incomplete: ${depthId}`);
  }
  return Object.freeze(entries);
}

function readJson(root, relativePath, maxBytes) {
  const file = join(root, relativePath);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`ocean_profile_file_rejected: ${relativePath}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readVerifiedMorphology(root, relativePath, expectedSha256, id, size = 256) {
  const file = join(root, relativePath);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 26 || stat.size > MAX_MORPHOLOGY_BYTES) {
    throw new Error(`ocean_profile_morphology_rejected: ${id}`);
  }
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size || bytes[25] !== 6) {
    throw new Error(`ocean_profile_morphology_integrity_failed: ${id}`);
  }
  return { bytes, sha256 };
}

// 30 depth-colour variants (6 forms x 5 depths) built from 18 shared morphology sources.
// Every output and its source are hash- and RGBA-checked; routes are /ocean-morphology/{form}/{depth}.png.
// Lit copies of the animations and depth-colour images. Each entry names the pipeline original it was lit from
// (source_sha256), so the chain back to the original is still checked.
function readLitManifest(root) {
  const manifest = readJson(root, `${LIT_ROOT}/lit-manifest.json`, MAX_LIT_MANIFEST_BYTES);
  if (manifest.schema !== 'lit-ocean-v1' || !Array.isArray(manifest.creatures) || !Array.isArray(manifest.morphology)) {
    throw new Error('ocean_profile_lit_manifest_rejected');
  }
  const byName = list => new Map(list.map(item => [item.name, item]));
  return { creatures: byName(manifest.creatures), morphology: byName(manifest.morphology) };
}

function loadMorphologyVariants(root) {
  const manifest = readJson(root, `${DEPTH_COLOR_ROOT}/depth-color-manifest.json`, MAX_COLOR_MANIFEST_BYTES);
  if (manifest.schema !== 'evolution-depth-colors-v1' || manifest.status !== 'candidate' ||
      manifest.counts?.sources !== 18 || manifest.counts?.variants !== 30 ||
      !Array.isArray(manifest.sources) || manifest.sources.length !== 18 ||
      !Array.isArray(manifest.variants) || manifest.variants.length !== 30) {
    throw new Error('ocean_profile_morphology_catalog_rejected');
  }
  const forms = new Set(Object.values(FAMILY_LABELS).map(family => family.morphology));
  const stages = new Set(Object.values(MORPHOLOGY_STAGE_BY_DEPTH));
  const sourcesById = new Map();
  for (const item of manifest.sources) {
    if (!forms.has(item.form) || !stages.has(item.stage) || item.id !== `${item.form}-${item.stage}` ||
        item.display_file !== `morphology/${item.form}-${item.stage}-256.png` || sourcesById.has(item.id) ||
        !SHA256_PATTERN.test(item.sha256) || !SHA256_PATTERN.test(item.display_sha256)) {
      throw new Error(`ocean_profile_morphology_source_rejected: ${item.id}`);
    }
    sourcesById.set(item.id, item);
  }
  const variants = new Map();
  const assets = new Map();
  const lit = readLitManifest(root).morphology;
  for (const item of manifest.variants) {
    const id = `${item.form}/${item.depth}`;
    const stage = MORPHOLOGY_STAGE_BY_DEPTH[item.depth];
    const source = sourcesById.get(`${item.form}-${stage}`);
    if (!forms.has(item.form) || !stage || variants.has(id) || item.id !== `${item.form}-${item.depth}` ||
        item.stage !== stage || !source || item.source_id !== source.id || item.source_sha256 !== source.sha256 ||
        item.file !== `${item.form}-${item.depth}-128.png` || item.display_file !== `${item.form}-${item.depth}-256.png` ||
        item.status !== 'candidate' || !SHA256_PATTERN.test(item.sha256) || !SHA256_PATTERN.test(item.display_sha256)) {
      throw new Error(`ocean_profile_morphology_entry_rejected: ${id}`);
    }
    readVerifiedMorphology(root, `${DEPTH_COLOR_ROOT}/${source.file}`, source.sha256, `${id} source`, 128);
    readVerifiedMorphology(root, `${DEPTH_COLOR_ROOT}/${item.file}`, item.sha256, `${id} 128`, 128);
    const litItem = lit.get(item.display_file.replace(/\.png$/, ''));
    if (!litItem || litItem.source_sha256 !== item.display_sha256) throw new Error(`ocean_profile_lit_morphology_rejected: ${id}`);
    const verified = readVerifiedMorphology(root, `${LIT_ROOT}/${litItem.file}`, litItem.sha256, id);
    const url = `/ocean-morphology/${item.form}/${item.depth}.png`;
    variants.set(id, { url, ...verified, status: item.status });
    assets.set(url, verified);
  }
  if (variants.size !== 30 || assets.size !== 30) throw new Error('ocean_profile_morphology_matrix_incomplete');
  return { variants, assets };
}

export function loadOceanProfiles(root) {
  const taxonomy = readJson(root, TAXONOMY_PATH, MAX_MANIFEST_BYTES);
  const manifest = readJson(root, `${ANIMATION_ROOT}/manifest.json`, MAX_MANIFEST_BYTES);
  if (!Array.isArray(taxonomy.families) || taxonomy.families.length !== Object.keys(FAMILY_LABELS).length ||
      !Array.isArray(taxonomy.depths) || taxonomy.depths.length !== DEPTH_IDS.length ||
      !Array.isArray(manifest.derivatives) || manifest.derivatives.length !== Object.keys(FAMILY_LABELS).length * DEPTH_IDS.length) {
    throw new Error('ocean_profile_catalog_rejected');
  }

  const expectedFamilies = new Map(Object.entries(FAMILY_LABELS));
  for (const family of taxonomy.families) {
    const expected = expectedFamilies.get(family.id);
    if (!expected || family.creature !== expected.creature) throw new Error(`ocean_profile_family_rejected: ${family.id}`);
  }
  const depths = new Map(taxonomy.depths.map(depth => [depth.id, depth]));
  if (DEPTH_IDS.some(id => !depths.has(id))) throw new Error('ocean_profile_depths_rejected');
  const morphology = loadMorphologyVariants(root);
  const litCreatures = readLitManifest(root).creatures;

  const selection = loadOceanSelection(root);
  const scenarios = Object.freeze(selection.map(entry => {
    const family = entry.family ? expectedFamilies.get(entry.family) : null;
    return Object.freeze({
      id: entry.id,
      name: entry.name,
      year: entry.year,
      role: entry.role,
      familyId: entry.family,
      family: family?.label ?? null,
      creature: family?.displayCreature ?? family?.creature ?? null,
      depthId: entry.depthId,
      depth: depths.get(entry.depthId).name,
      victimAction: entry.victimAction,
      status: entry.status,
      sources: entry.sources,
      note: typeof entry.note === 'string' ? entry.note : null,
    });
  }));
  const derivatives = new Map(manifest.derivatives.map(item => [item.id, item]));
  const profiles = [];
  const assets = new Map();
  for (const [familyId, family] of expectedFamilies) {
    const taxonomyFamily = taxonomy.families.find(item => item.id === familyId);
    for (const depthId of DEPTH_IDS) {
      const id = `${family.asset}-${depthId}`;
      const derivative = derivatives.get(id);
      if (!derivative || derivative.family !== family.asset || derivative.depth !== depthId ||
          derivative.file !== `animations/${family.asset}-${depthId}-256.gif` ||
          typeof derivative.display_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(derivative.display_sha256)) {
        throw new Error(`ocean_profile_animation_rejected: ${id}`);
      }
      const lit = litCreatures.get(id);
      if (!lit || lit.source_sha256 !== derivative.display_sha256 || lit.frames !== derivative.frames) {
        throw new Error(`ocean_profile_lit_animation_rejected: ${id}`);
      }
      const full = join(root, LIT_ROOT, lit.file);
      const stat = lstatSync(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 10 || stat.size > MAX_ANIMATION_BYTES) {
        throw new Error(`ocean_profile_animation_rejected: ${id}`);
      }
      const bytes = readFileSync(full);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== lit.sha256) throw new Error(`ocean_profile_animation_hash_mismatch: ${id}`);

      const assetUrl = `/ocean-creatures/${family.asset}/${depthId}.gif`;
      assets.set(assetUrl, { bytes, sha256 });
      const morphologyStage = MORPHOLOGY_STAGE_BY_DEPTH[depthId];
      const morphologyVariant = morphology.variants.get(`${family.morphology ?? family.asset}/${depthId}`);
      if (!morphologyVariant) throw new Error(`ocean_profile_morphology_missing: ${familyId}/${depthId}`);
      profiles.push(Object.freeze({
        id: `${familyId}-${depthId}`,
        familyId,
        family: family.label,
        creature: taxonomyFamily.creature,
        displayCreature: family.displayCreature ?? taxonomyFamily.creature,
        depthId,
        depth: depths.get(depthId).name,
        action: DEPTH_TIERS[depthId],
        assetUrl,
        assetSha256: sha256,
        frameCount: derivative.frames,
        morphologyStage,
        morphologyLabel: MORPHOLOGY_LABELS[morphologyStage],
        morphologyStatus: morphologyVariant.status,
        morphologyUrl: morphologyVariant.url,
        morphologySha256: morphologyVariant.sha256,
        anchor: Object.freeze((({ id, name, year, victimAction, status }) => ({ id, name, year, victimAction, status }))(
          selection.find(entry => entry.role === 'anchor' && entry.family === familyId && entry.depthId === depthId))),
      }));
    }
  }

  if (profiles.length !== 30 || assets.size !== 30 || scenarios.length !== 60 || morphology.assets.size !== 30) throw new Error('ocean_profile_matrix_incomplete');
  return { profiles: Object.freeze(profiles), scenarios, assets, morphologyAssets: morphology.assets };
}
