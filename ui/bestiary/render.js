// Bestiary markup (SPEC 9.6). Pure functions from the rosters (data/creatures.json, data/fish.json) and the shared
// ocean (GET /api/ocean) to an HTML string, so the browser page and the tests build the same cards.
// Every value is escaped; creature text never reaches the page as markup.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BestiaryRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIERS = [
    { id: 'sunlight', name: 'Sunlight', depth: '0–200 m', meaning: 'Clean', line: 'The run finished and no harmful or suspicious behaviour was observed.' },
    { id: 'twilight', name: 'Twilight', depth: '200–1,000 m', meaning: 'Risky', line: 'Suspicious but unproven, or the run was inconclusive.' },
    { id: 'midnight', name: 'Midnight', depth: '1,000–4,000 m', meaning: 'Steals', line: 'The file read credentials or browser data, logged keystrokes, captured the screen or tried to send data out.' },
    { id: 'abyss', name: 'Abyss', depth: '4,000–6,000 m', meaning: 'Takes control', line: 'The file planted itself, took remote control, injected code, switched off defences or fetched a second stage.' },
    { id: 'trench', name: 'Trench', depth: '6,000–11,000 m', meaning: 'Destroys', line: 'The file encrypted, wiped or deleted data, dropped a ransom note or tried to spread.' },
  ];
  // Species with a swim sheet in ui/abyss/pixel/fish; every other fish gets the stand-in from pixel-fish.js.
  const FISH_ART = new Set(['barracuda', 'boxfish', 'coelacanth', 'flounder', 'flying-fish', 'jack', 'leafy-seadragon', 'mandarin-dragonet', 'pilot-fish', 'pufferfish', 'snake-eel', 'torpedo-ray', 'lionfish', 'ribbonfish', 'remora', 'picasso-triggerfish', 'batfish', 'archerfish', 'sea-bass', 'goblin-shark', 'jawfish', 'pocket-shark', 'mackerel', 'java-rabbitfish', 'sole', 'butterflyfish', 'plaice']);
  const tierOf = (id) => TIERS.find((tier) => tier.id === id);

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const files = (count) => `${count} ${count === 1 ? 'file' : 'files'}`;
  const titleCase = (slug) => slug.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
  const idOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Sprite: a 14-frame sheet shown one frame at a time (CSS steps); no art at all gives a letter tile (design fallback).
  const sprite = (entry, silhouette) => {
    const path = entry.sprite ?? entry.fallbackSprite;
    const dark = silhouette ? ' dark' : '';
    if (!path) return `<span class="sprite none${dark}" aria-hidden="true">${escapeHtml(entry.creature[0])}</span>`;
    return `<span class="sprite${dark}" data-pixel-bg="/${escapeHtml(path)}" aria-hidden="true"></span>`;
  };

  const card = ({ id, tint, art, tag, title, lines, foot }) => `<li class="card glass" id="${escapeHtml(id)}" tabindex="-1" style="--tint:${tint}">`
    + `${art}<div class="card-text"><p class="pg-tag">${escapeHtml(tag)}</p><h3>${escapeHtml(title)}</h3>`
    + `${lines.map(([label, text]) => `<p><b>${escapeHtml(label)}</b> ${escapeHtml(text)}</p>`).join('')}`
    + `<p class="eaten">${escapeHtml(foot)}</p></div></li>`;

  const tintOf = (depth) => ({ sunlight: '#7fe8ff', twilight: '#b6a6ff', midnight: '#ffd166', abyss: '#ff9a5a', trench: '#ff4f6d' })[depth] ?? '#6fe0d4';

  // `eaten` for a finding comes from /api/ocean; `reveal` shows undiscovered creatures in full (local development only).
  function creatureCard(entry, eatenById, reveal) {
    const eaten = eatenById.get(entry.findingId) ?? 0;
    const found = eaten > 0 || reveal;
    const tier = tierOf(entry.depth);
    const depth = tier ? `${tier.name} · ${tier.depth} · ${tier.meaning}` : 'Depends on the evidence: Midnight, Abyss or Trench';
    if (!found) {
      return card({
        id: entry.findingId, tint: tintOf(entry.depth), art: sprite(entry, true), tag: tier ? tier.name : 'Variable depth',
        title: 'Not yet found', lines: [['Depth', depth]], foot: 'Has eaten 0 files. It appears here when a real file proves it.',
      });
    }
    return card({
      id: entry.findingId, tint: tintOf(entry.depth), art: sprite(entry, false), tag: tier ? tier.name : 'Variable depth',
      title: entry.creature,
      lines: [
        ['Finding', entry.plainWords],
        ['Depth', depth],
        ['Family', entry.family === 'variable' ? 'Set by the evidence' : `${titleCase(entry.family)} (${entry.familyAttackName} at Midnight and deeper)`],
        ['Why this creature', entry.why],
        ['Protect yourself', entry.protect],
      ],
      foot: `Has eaten ${files(eaten)}`,
    });
  }

  function systemCard(entry) {
    return card({
      id: idOf(entry.creature), tint: '#6fe0d4', art: sprite(entry, false), tag: 'System', title: entry.creature,
      lines: [['Role', entry.plainWords], ['Why this creature', entry.why]], foot: 'Not a finding. It is part of the sandbox.',
    });
  }

  function fishCard(entry, size) {
    const types = entry.types.map((type) => `.${type}`).join(' ');
    const sheet = FISH_ART.has(entry.species) ? ` data-pixel-bg="/ui/abyss/pixel/fish/${escapeHtml(entry.species)}-swim.png"` : ' data-stand-in';
    const art = `<span class="sprite fish" data-species="${escapeHtml(entry.species)}"${sheet} aria-hidden="true"></span>`;
    return `<li class="card glass fish-card" id="fish-${escapeHtml(entry.species)}" tabindex="-1" style="--tint:#6fe0d4">${art}<div class="card-text">`
      + `<h3>${escapeHtml(titleCase(entry.species))}</h3><p><b>File types</b> ${escapeHtml(types)}</p><p class="eaten">School size: ${size}</p></div></li>`;
  }

  function render(roster, fish, ocean, { reveal = false } = {}) {
    const eatenById = new Map((ocean?.creatures ?? []).map((item) => [item.findingId, item.eaten]));
    const schoolSize = new Map();
    for (const school of ocean?.schools ?? []) schoolSize.set(school.species, (schoolSize.get(school.species) ?? 0) + school.count);

    const depths = `<ol class="tiers-list">${TIERS.map((tier) => `<li class="card glass" style="--tint:${tintOf(tier.id)}">`
      + `<p class="pg-tag">${escapeHtml(tier.meaning)}</p><h3>${escapeHtml(tier.name)}</h3><p><b>Real ocean depth</b> ${escapeHtml(tier.depth)}</p><p>${escapeHtml(tier.line)}</p></li>`).join('')}</ol>`;
    const fishList = `<ul class="pg-grid">${fish.fish.map((entry) => fishCard(entry, schoolSize.get(entry.species) ?? 0)).join('')}</ul>`;
    const finding = `<ul class="pg-grid">${roster.creatures.map((entry) => creatureCard(entry, eatenById, reveal)).join('')}</ul>`;
    const system = `<ul class="pg-grid">${roster.system.map(systemCard).join('')}</ul>`;
    return { depths, fish: fishList, creatures: finding, system };
  }

  return { render, creatureCard, TIERS, escapeHtml };
});
