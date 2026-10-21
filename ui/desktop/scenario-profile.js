// Profile for one of the 60 scenarios (SCENARIOS-60-CONTRACT §1). The catalog (GET /api/ocean/profiles) has 30 creature profiles
// (family x depth) and 60 scenarios. A scenario plays on the profile of its family and depth; a free scenario (familyId null)
// takes its family from its scene data (globalThis.OceanScenarioData[id].family).
//   resolve(catalog, scenarioId, data?) -> profile | null     (null when the id is not a scenario or its family is unknown)
(() => {
  'use strict';

  function resolve(catalog, scenarioId, data = globalThis.OceanScenarioData) {
    const scenarios = Array.isArray(catalog?.scenarios) ? catalog.scenarios : [];
    const profiles = Array.isArray(catalog?.profiles) ? catalog.profiles : [];
    const item = scenarios.find(entry => entry && entry.id === scenarioId);
    if (!item) return null;
    const familyId = item.familyId ?? (data && Object.hasOwn(data, scenarioId) ? data[scenarioId].family : null);
    const base = profiles.find(profile => profile.familyId === familyId && profile.depthId === item.depthId);
    if (!base) return null;
    return {
      ...base,
      id: item.id,
      action: String(item.victimAction).slice(0, 160),
      anchor: { id: item.id, name: item.name, year: item.year, victimAction: String(item.victimAction).slice(0, 240), status: item.status },
    };
  }

  const api = Object.freeze({ resolve });
  if (typeof window !== 'undefined') window.OceanScenarioProfile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
