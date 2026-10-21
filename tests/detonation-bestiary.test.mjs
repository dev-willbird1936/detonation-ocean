// SPEC 9.6 (R-UI4): the Bestiary lists the depths, fish, all finding creatures and the system; undiscovered creatures
// are silhouettes. Also covers the About page (SPEC 4.1) and the page chrome rules of 9.3 and 9.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative) => readFileSync(join(root, relative), 'utf8');
const { render, TIERS } = createRequire(import.meta.url)(join(root, 'ui/bestiary/render.js'));
const roster = JSON.parse(read('data/creatures.json'));
const fish = JSON.parse(read('data/fish.json'));

const cardIds = (html) => [...html.matchAll(/<li class="card[^"]*" id="([^"]+)"/g)].map((match) => match[1]);
const cardOf = (html, id) => html.match(new RegExp(`<li class="card[^"]*" id="${id}"[\\s\\S]*?</li>`))[0];

test('every finding ID in data/creatures.json renders exactly one card', () => {
  const { creatures } = render(roster, fish, null);
  const ids = cardIds(creatures);
  assert.equal(roster.creatures.length, 22);
  assert.deepEqual(ids, roster.creatures.map((entry) => entry.findingId));
  assert.ok(ids.includes('other-harm'), 'the giant squid has a card');
});

test('an undiscovered creature is a dark silhouette marked "Not yet found" and hides its name', () => {
  const { creatures } = render(roster, fish, { schools: [], creatures: [] });
  const card = cardOf(creatures, 'encrypt');
  assert.match(card, /class="sprite dark"/);
  assert.match(card, />Not yet found</);
  assert.doesNotMatch(card, /Kraken/);
  assert.match(card, /Trench/);
  assert.match(card, /Has eaten 0 files/);
  // An entry with no art at all gets the letter tile.
  const bare = { ...roster, creatures: roster.creatures.map((c) => (c.findingId === 'other-harm' ? { ...c, sprite: null, fallbackSprite: null } : c)) };
  assert.match(cardOf(render(bare, fish, { schools: [], creatures: [] }).creatures, 'other-harm'), /class="sprite none dark"/);
});

test('a found creature shows sprite, name, finding, depth, family, why, protect and the eaten count', () => {
  const entry = roster.creatures.find((creature) => creature.findingId === 'steal-credentials');
  const { creatures } = render(roster, fish, { creatures: [{ findingId: 'steal-credentials', eaten: 42 }] });
  const card = cardOf(creatures, 'steal-credentials');
  assert.match(card, /class="sprite" data-pixel-bg="\/ui\/abyss\/pixel\/creatures\/cookiecutter-midnight-spritesheet\.png"/);
  for (const text of [entry.creature, entry.plainWords, entry.why, entry.protect, 'Midnight', 'Data access', 'Theft / surveillance']) {
    assert.ok(card.includes(text.replace(/'/g, '&#39;')), text);
  }
  assert.match(card, /Has eaten 42 files/);
  assert.doesNotMatch(card, /Not yet found/);
  assert.match(render(roster, fish, { creatures: [{ findingId: 'steal-credentials', eaten: 1 }] }).creatures, /Has eaten 1 file</);
});

test('a creature without its own sprite uses the design fallback sprite', () => {
  const bare = { ...roster, creatures: roster.creatures.map((c) => (c.findingId === 'keylog' ? { ...c, sprite: null } : c)) };
  const { creatures } = render(bare, fish, { creatures: [{ findingId: 'keylog', eaten: 2 }] });
  assert.match(cardOf(creatures, 'keylog'), /cookiecutter-midnight-spritesheet\.png/);
});

test('reveal shows undiscovered creatures in full (local development only)', () => {
  const { creatures } = render(roster, fish, null, { reveal: true });
  assert.doesNotMatch(creatures, /Not yet found/);
  assert.match(cardOf(creatures, 'encrypt'), /Kraken/);
});

test('depths, fish and system sections list everything', () => {
  const parts = render(roster, fish, { schools: [{ species: 'pufferfish', depth: 'sunlight', count: 12 }, { species: 'pufferfish', depth: 'twilight', count: 3 }], creatures: [] });
  for (const tier of TIERS) assert.ok(parts.depths.includes(`<h3>${tier.name}</h3>`) && parts.depths.includes(tier.depth) && parts.depths.includes(tier.meaning), tier.name);
  assert.deepEqual(cardIds(parts.fish), fish.fish.map((entry) => `fish-${entry.species}`));
  assert.match(cardOf(parts.fish, 'fish-pufferfish'), /School size: 15/);
  assert.match(cardOf(parts.fish, 'fish-pufferfish'), /\.zip \.rar \.7z \.iso \.img/);
  assert.match(cardOf(parts.fish, 'fish-lionfish'), /lionfish-swim\.png/);
  assert.deepEqual(cardIds(parts.system), ['octopus', 'giant-clam']);
  assert.match(cardOf(parts.system, 'octopus'), /The agent/);
  assert.match(cardOf(parts.system, 'giant-clam'), /giant-clam-spritesheet\.png/);
});

test('every card id the main menu links to exists: finding, octopus and fish anchors', () => {
  const parts = render(roster, fish, null);
  const ids = new Set([...cardIds(parts.creatures), ...cardIds(parts.system), ...cardIds(parts.fish)]);
  for (const entry of roster.creatures) assert.ok(ids.has(entry.findingId), entry.findingId);
  for (const entry of fish.fish) assert.ok(ids.has(`fish-${entry.species}`), entry.species);
  assert.ok(ids.has('octopus'));
});

test('roster text is escaped', () => {
  const evil = { creatures: [{ ...roster.creatures[0], plainWords: '<img src=x onerror=alert(1)>' }], system: [] };
  const { creatures } = render(evil, fish, { creatures: [{ findingId: evil.creatures[0].findingId, eaten: 1 }] });
  assert.doesNotMatch(creatures, /<img/);
  assert.match(creatures, /&lt;img src=x/);
});

test('pages: pixel chrome, nav, keyboard and reduced motion', () => {
  for (const [file, current] of [['bestiary.html', '/bestiary'], ['about.html', '/about']]) {
    const html = read(file);
    assert.match(html, /<link rel="stylesheet" href="\/ui\/abyss\/retro-pixel\.css">/, file);
    assert.match(html, /<a class="pg-skip" href="#main">/, file);
    assert.match(html, /<main class="pg-main" id="main">/, file);
    assert.match(html, new RegExp(`<a href="${current}" aria-current="page">`), file);
    for (const label of ['Upload', 'Bestiary', 'How it works']) assert.ok(html.includes(`>${label}</a>`), `${file} ${label}`);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, `${file} loads nothing third-party`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${file} has no inline script`);
  }
  const css = read('ui/bestiary/bestiary.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css + read('ui/abyss/retro-pixel.css').slice(read('ui/abyss/retro-pixel.css').indexOf('Detonation Ocean additions')), /border-radius:\s*[1-9]|blur\(/);
});

test('About page covers architecture, the four containment properties with their tests, limits and honest status', () => {
  const html = read('about.html');
  for (const heading of ['Architecture', 'Containment', 'Limits', 'Honest status']) assert.ok(html.includes(`>${heading}</h2>`), heading);
  for (const [property, tests] of [['Process isolation', ['AT-5', 'AT-16']], ['Secret hygiene', ['AT-1', 'AT-12']], ['Resource limits', ['AT-2', 'AT-3', 'AT-4']], ['Lifecycle', ['AT-9', 'AT-10']]]) {
    const row = html.match(new RegExp(`<th scope="row">${property}</th>[\\s\\S]*?</tr>`))?.[0];
    assert.ok(row, property);
    for (const id of tests) assert.ok(row.includes(id), `${property} → ${id}`);
  }
  assert.match(html, /not a guarantee/);
  assert.doesNotMatch(html, /\bSEV\d/);
});
