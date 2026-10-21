// AT-25 (R-UI2): the main menu shows the five tier names on the depth gauge, the Drop a file panel and the new
// navigation; no SEV labels, and no Chamber or All 50 links in production. Static checks on the served source and
// the built bundle, plus the menu script run against a stub page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative) => readFileSync(join(root, relative), 'utf8');
const source = read('ui/abyss/index.html');
const built = read('index.html');
const menuScript = read('ui/abyss/detonation-menu.js');
const dropScript = read('ui/abyss/drop-panel.js');
const bundle = read('ui/abyss/assets/index-retro.js');
const roster = JSON.parse(read('data/creatures.json'));

const TIERS = [
  ['Sunlight', '0–200 m', 'Clean'], ['Twilight', '200–1,000 m', 'Risky'], ['Midnight', '1,000–4,000 m', 'Steals'],
  ['Abyss', '4,000–6,000 m', 'Takes control'], ['Trench', '6,000–11,000 m', 'Destroys'],
];
const CONSENT = 'I own this file or have permission to analyse it, and I understand it will be executed in a sandbox';

// Runs detonation-menu.js against a stub page and returns the context (window.__menu) and what it removed or hid.
function runMenu({ meta, hostname = 'localhost', ocean = null, fish = { fish: [] } } = {}) {
  const removed = [], hidden = [];
  const devLinks = ['Legend', 'All 50', 'Chamber'].map((text) => ({ text, remove() { removed.push(text); } }));
  const devSections = ['legend', 'index'].map((id) => ({ id, set hidden(value) { hidden.push(id); } }));
  const document = {
    documentElement: { dataset: {} },
    querySelector: (selector) => (selector === 'meta[name="do-env"]' && meta !== undefined ? { content: meta } : null),
    querySelectorAll: (selector) => (selector === 'nav [data-dev-only]' ? devLinks : selector === 'section[data-dev-only]' ? devSections : []),
  };
  const responses = { '/api/ocean': ocean, '/data/creatures.json': roster, '/data/fish.json': fish };
  const context = {
    document, location: { hostname }, matchMedia: () => ({ matches: false }), AbortSignal, addEventListener() {}, removeEventListener() {},
    fetch: async (url) => ({ ok: responses[url] != null, json: async () => responses[url] }),
  };
  context.window = context;
  vm.runInNewContext(menuScript, context);
  return { menu: context.__menu, removed, hidden, document };
}

test('the served page has the hero wording of SPEC 9.4', () => {
  assert.match(source, /<p class="eyebrow mono">File detonation sandbox · on Vultr<\/p>/);
  assert.match(source, /<p class="premise">Drop a file\. We open it in a sealed box and show you what it really does\. The deeper it sinks, the more harm it did\.<\/p>/);
  assert.doesNotMatch(source, /50 real cyberattacks|Every attack is a creature/);
});

test('the five tier names, depths and meanings are on the depth gauge', () => {
  for (const [name, depth, meaning] of TIERS) {
    assert.ok(menuScript.includes(`name: '${name}', depth: '${depth}', meaning: '${meaning}'`), name);
  }
  assert.match(menuScript, /gauge-sub/);
  assert.match(menuScript, /gauge-sun/); // the sun mark on Sunlight
  assert.ok(bundle.includes('window.__menu.gaugeItem(e)'), 'the built bundle builds the gauge from the tiers');
  const { menu } = runMenu();
  assert.deepEqual(Object.values(menu.tiers).map((tier) => tier.name).reverse(), TIERS.map(([name]) => name));
  assert.deepEqual({ ...menu.meaning }, { 5: 'Clean', 4: 'Risky', 3: 'Steals', 2: 'Takes control', 1: 'Destroys' });
});

test('no SEV labels in the page, the menu scripts or the built bundle', () => {
  for (const [name, text] of [['ui/abyss/index.html', source], ['index.html', built], ['detonation-menu.js', menuScript], ['drop-panel.js', dropScript], ['index-retro.js', bundle]]) {
    assert.doesNotMatch(text, /\bSEV(?:\d|\$\{)/, name);
    if (name !== 'index-retro.js') assert.doesNotMatch(text, /“Nothing”|Open a File|One Click/, name); // the bundle keeps the old ladder as unused data
  }
});

test('the Drop a file panel has the picker, the exact consent text and the upload contract', () => {
  assert.match(source, /<form class="drop glass" id="upload"/);
  assert.match(source, />Drop a file<\/h2>/);
  assert.match(source, /<input class="drop-file" type="file" id="drop-file" name="file">/);
  assert.ok(source.includes(`<span>${CONSENT}</span>`));
  assert.match(source, /<button class="drop-go" type="submit">Upload<\/button>/);
  assert.match(dropScript, /fetch\('\/api\/jobs', \{ method: 'POST'/);
  assert.match(dropScript, /body\.append\('file', file\)/);
  assert.match(dropScript, /body\.append\('consent', 'true'\)/);
  assert.match(dropScript, /response\.status === 202/);
  assert.ok(dropScript.includes('`/job/${jobId}#${token}`')); // the full report link
  assert.match(dropScript, /import\('\/ui\/job\/ocean-show\.mjs'\)/); // the ocean show plays the job out on this page
  assert.ok(dropScript.includes('location.assign(jobUrl)')); // fallback when the guide cannot open
  for (const status of ['400', '413', '429', '503']) assert.ok(dropScript.includes(`${status}:`), `message for ${status}`);
  assert.match(dropScript, /drop/); // drag and drop handlers
  assert.match(dropScript, /dataTransfer/);
});

test('navigation is Upload, Bestiary, How it works and Sound', () => {
  const nav = source.match(/<nav aria-label="Page">([\s\S]*?)<\/nav>/)[1];
  const labels = [...nav.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map(([, inner]) => inner.replace(/<[^>]+>/g, '').trim());
  assert.deepEqual(labels.slice(0, 4), ['Upload', 'Bestiary', 'How it works', 'Sound off']);
  assert.match(nav, /<a class="nav-upload" href="#upload">Upload<\/a>/);
  assert.match(nav, /<a href="\/bestiary">Bestiary<\/a>/);
  assert.match(nav, /<a href="\/about">How it works<\/a>/);
  assert.match(nav, /<button class="snd"/);
});

test('Legend, All 50 and Chamber exist only as development-only elements', () => {
  const nav = source.match(/<nav aria-label="Page">([\s\S]*?)<\/nav>/)[1];
  const dev = nav.match(/<span class="nav-dev" data-dev-only>([\s\S]*?)<\/span>/)[1];
  assert.match(dev, /Legend/); assert.match(dev, /All 50/); assert.match(dev, /Chamber/);
  assert.doesNotMatch(nav.replace(dev, '').replace(/<!--[\s\S]*?-->/g, ''), /All 50|Chamber|chamber\.html|#index|#legend|Creature matrix/);
  assert.match(source, /<section class="stage legend"[^>]*data-dev-only>/);
  assert.match(source, /<section class="stage index"[^>]*data-dev-only>/);
  assert.doesNotMatch(source, /Explore all 50/);
  assert.equal(built, source, 'index.html is the build of ui/abyss/index.html (run node build.mjs)');
});

test('production rule: the do-env meta wins, otherwise a non-loopback host is production', () => {
  const { menu } = runMenu();
  assert.equal(menu.isProduction('production', 'localhost'), true);
  assert.equal(menu.isProduction('development', 'detonation.example'), false);
  assert.equal(menu.isProduction('auto', 'detonation.example'), true);
  assert.equal(menu.isProduction(undefined, 'detonation.example'), true);
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'demo.localhost']) assert.equal(menu.isProduction('auto', host), false, host);
});

test('with the production flag set, the Chamber and All 50 links and sections are gone', () => {
  const production = runMenu({ meta: 'production' });
  assert.equal(production.document.documentElement.dataset.env, 'production');
  assert.deepEqual(production.removed, ['Legend', 'All 50', 'Chamber']);
  assert.deepEqual(production.hidden, ['legend', 'index']);
  const development = runMenu({ meta: 'auto' });
  assert.equal(development.document.documentElement.dataset.env, 'development');
  assert.deepEqual(development.removed, []);
});

test('the shared ocean: empty water, one creature per eaten finding, sizes, caps', async () => {
  const empty = await runMenu().menu.creatures();
  const ghosts = empty.filter((record) => record.ghost);
  assert.equal(empty.filter((record) => !record.ghost).length, 1, 'only the octopus when /api/ocean returns nothing');
  assert.equal(ghosts.length, 11);

  const ocean = {
    schools: [{ species: 'pufferfish', depth: 'sunlight', count: 400 }, { species: 'barracuda', depth: 'twilight', count: 3 }],
    creatures: [{ findingId: 'encrypt', eaten: 8 }, { findingId: 'steal-credentials', eaten: 1 }, { findingId: 'keylog', eaten: 0 }, { findingId: 'not-a-finding', eaten: 5 }],
  };
  const { menu } = runMenu({ ocean });
  const records = (await menu.creatures()).filter((record) => !record.ghost);
  const byId = Object.fromEntries(records.map((record) => [record.id, record]));
  assert.ok(byId.encrypt && byId['steal-credentials'], 'eaten findings appear');
  assert.ok(!byId.keylog && !byId['not-a-finding'], 'undiscovered and unknown findings are absent');
  assert.equal(byId.encrypt.sev, 1);
  assert.equal(byId['steal-credentials'].sev, 3);
  assert.ok(Math.abs(byId.encrypt.sizeMul / byId['steal-credentials'].sizeMul - Math.min(3, 1 + Math.log2(8))) < 1e-9, 'size = base × min(3, 1 + log2(eaten))');
  assert.equal(records.filter((record) => record.kind === 'school').length, 2);

  const many = { creatures: roster.creatures.map((entry) => ({ findingId: entry.findingId, eaten: 1 })) };
  const capped = (await runMenu({ ocean: many }).menu.creatures()).filter((record) => record.kind === 'creature');
  assert.equal(capped.length, 22);
});

test('hover tag, click and fish caps', async () => {
  const ocean = { schools: [{ species: 'pufferfish', depth: 'sunlight', count: 40 }], creatures: [{ findingId: 'encrypt', eaten: 42 }] };
  const fish = { fish: [{ species: 'pufferfish', types: ['zip', 'iso'] }] };
  const { menu } = runMenu({ ocean, fish });
  const records = (await menu.creatures()).filter((record) => !record.ghost);
  const kraken = records.find((record) => record.id === 'encrypt');
  assert.match(menu.meta(kraken), /^Scrambles your files so you cannot open them\b.* · has eaten 42 files$/);
  assert.equal(kraken.name, 'Kraken');
  assert.match(menu.meta(records.find((record) => record.kind === 'school')), /\.zip \.iso · 40 files in this school/);
  assert.ok(bundle.includes('window.__menu.open(t.a)'), 'canvas click opens the Bestiary card');
  assert.ok(bundle.includes('if(window.__menu.open(e.a))return;'), 'list and panel click open the Bestiary card');
  assert.match(menuScript, /location\.assign\(`\/bestiary#\$\{encodeURIComponent\(a\.anchor\)\}`\)/);
  assert.match(read('ui/abyss/retro-pixel.js'), /SCHOOL_FISH = 30/);
  assert.match(menuScript, /MAX_CREATURES = 22/);
});

test('accessibility: text is always present and the panel is keyboard reachable', () => {
  assert.match(source, /<label class="drop-zone" for="drop-file">/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(read('ui/abyss/retro-pixel.js'), /prefers-reduced-motion: reduce/);
  assert.match(read('ui/abyss/retro-pixel.css'), /@media \(prefers-reduced-motion: reduce\)/);
});
