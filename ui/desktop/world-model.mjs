// ESM entry for Vite and other ESM apps. world-model.js stays UMD: in a browser it defines window.OceanWorldModel,
// in Node it sets module.exports (seen here as the CommonJS default export).
import * as umd from './world-model.js';

const OceanWorldModel = globalThis.OceanWorldModel ?? umd.default;
export default OceanWorldModel;
export const {
  CANONICAL_APPS, CULLED_APPS, CORE_APPS, APP_NAMES, WORK, WORLD_MAX_BYTES, PHASES, ACCENTS, WALLPAPERS, OVERLAYS, TILES,
  FIXED_FOLDERS, FS_OPS, CREATURE_STATES, ATTACK_KINDS, SANDBOX_MODES, SANDBOX_STATUSES, SANDBOX_MAX_EVENTS, createWorld, validate, applyIntent, parseIntent, parseIntentMessage, mergeProfile,
  SYNCED_DATA, SYS_DEFAULTS, normalise, normaliseStore, emptyStore,
} = OceanWorldModel;
