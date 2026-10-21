import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { inflateSync } from 'node:zlib';
import { loadOceanProfiles } from '../backend/ocean-profiles.mjs';

const root = path.resolve(import.meta.dirname, '..');
const protos = path.join(root, 'ocean-style-prototypes');
const gridDir = path.join(protos, 'codex-creature-palette-base');
const evolutionDir = path.join(protos, 'codex-creature-depth-evolution');
const colorDir = path.join(evolutionDir, 'depth-colors');
const manifestBytes = readFileSync(path.join(colorDir, 'depth-color-manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const status = JSON.parse(readFileSync(path.join(gridDir, 'evolution-grid-status.json'), 'utf8'));
const gridHtml = readFileSync(path.join(gridDir, 'index.html'), 'utf8');
const gridScript = readFileSync(path.join(gridDir, 'evolution-grid.js'), 'utf8');
const galleryHtml = readFileSync(path.join(evolutionDir, 'index.html'), 'utf8');
const grid = createRequire(import.meta.url)(path.join(gridDir, 'evolution-grid.js'));

const FAMILIES = ['anglerfish', 'viperfish', 'siphonophore', 'isopod-host', 'cookiecutter', 'squid'];
const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];
const STAGE = { sunlight: 'base-rich', twilight: 'base-rich', midnight: 'midnight-abyss', abyss: 'midnight-abyss', trench: 'trench' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const byId = new Map(manifest.variants.map(item => [item.id, item]));

// Minimal 8-bit RGBA PNG decoder (no dependency): returns size, colour type and pixel bytes.
function decodePng(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'PNG signature');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], type = bytes[25], interlace = bytes[28];
  const idat = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), kind = bytes.toString('latin1', at + 4, at + 8);
    if (kind === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  if (type !== 6 || depth !== 8 || interlace !== 0) return { width, height, type, pixels: null };
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 4, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0, b = y ? pixels[(y - 1) * stride + x] : 0, c = x >= 4 && y ? pixels[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[y * stride + x] = (raw[line + x] + predictor) & 255;
    }
  }
  return { width, height, type, pixels };
}
const alphaOf = png => Uint8Array.from({ length: png.width * png.height }, (_, i) => png.pixels[i * 4 + 3]);
const load = relative => readFileSync(path.join(colorDir, relative));

test('30 family/depth join: six keys, five depths, Squid never Octopus', () => {
  assert.equal(manifest.variants.length, 30);
  assert.deepEqual(manifest.variants.map(item => item.id), FAMILIES.flatMap(family => DEPTHS.map(depth => `${family}-${depth}`)));
  assert.equal(new Set(manifest.variants.map(item => item.id)).size, 30);
  assert.deepEqual(grid.FAMILIES.map(([key]) => key), FAMILIES);
  assert.equal(grid.FAMILIES.find(([key]) => key === 'squid')[1], 'Squid → Kraken');
  for (const item of manifest.variants) {
    assert.equal(item.form, item.id.slice(0, -item.depth.length - 1));
    assert.doesNotMatch(`${item.id} ${item.file} ${item.display_file} ${item.source_id} ${item.source_file}`, /octopus/i, item.id);
    // `octopus` survives only as the palette-profile key of the Squid line, never as an asset.
    assert.equal(item.palette_family === 'octopus', item.form === 'squid', item.id);
  }
  assert.equal(grid.buildCells(manifest, status, sha256(manifestBytes)).length, 30);
});

test('stage mapping: Sunlight/Twilight share Base, Midnight/Abyss share Mid, Trench stands alone; 18 sources', () => {
  assert.deepEqual(grid.STAGE_BY_DEPTH, STAGE);
  assert.equal(manifest.sources.length, 18);
  for (const family of FAMILIES) {
    const cell = depth => byId.get(`${family}-${depth}`);
    assert.equal(cell('sunlight').source_id, cell('twilight').source_id);
    assert.equal(cell('sunlight').source_sha256, cell('twilight').source_sha256);
    assert.equal(cell('midnight').source_id, cell('abyss').source_id);
    assert.equal(new Set([cell('twilight'), cell('midnight'), cell('trench')].map(item => item.source_id)).size, 3);
    for (const depth of DEPTHS) assert.equal(cell(depth).stage, STAGE[depth], `${family}-${depth}`);
  }
  assert.equal(new Set(manifest.variants.map(item => item.source_id)).size, 18);
});

test('recorded status stays candidate; QVL pass is bound to this manifest; animation and promotion pending', () => {
  assert.equal(manifest.status, 'candidate');
  assert.equal(manifest.qvl, 'pending', 'manifest qvl field is left as recorded');
  assert.ok(manifest.variants.every(item => item.status === 'candidate' && item.qvl === 'pending'));
  assert.ok(manifest.sources.every(item => item.status === 'candidate'));
  assert.equal(status.depth_color_manifest_sha256, sha256(manifestBytes));
  assert.equal(status.qvl.result, 'pass');
  assert.equal(status.animation.status, 'pending');
  assert.equal(status.animation.reviewed_manifest, null);
  assert.equal(status.integration.status, 'pending-final-qa');
});

test('30 variant and 18 source PNGs: hashes, dimensions, RGBA, binary alpha, source alpha, 256 = 128 x2', () => {
  for (const source of manifest.sources) {
    assert.equal(sha256(load(source.file)), source.sha256, source.id);
    assert.equal(sha256(load(source.display_file)), source.display_sha256, source.id);
  }
  const sources = new Map(manifest.sources.map(item => [item.id, item]));
  for (const item of manifest.variants) {
    const small = load(item.file), large = load(item.display_file);
    assert.equal(sha256(small), item.sha256, item.id);
    assert.equal(sha256(large), item.display_sha256, item.id);
    const a = decodePng(small), b = decodePng(large);
    assert.deepEqual([a.width, a.height, a.type, b.width, b.height, b.type], [128, 128, 6, 256, 256, 6], item.id);
    assert.ok(a.pixels && b.pixels, `${item.id} is 8-bit non-interlaced RGBA`);
    const alpha = alphaOf(a);
    assert.ok(alpha.every(value => value === 0 || value === 255), `${item.id} alpha is binary`);
    assert.ok(alpha.some(value => value === 255), item.id);
    assert.deepEqual(alpha, alphaOf(decodePng(load(sources.get(item.source_id).file))), `${item.id} alpha equals its source`);
    for (const [x, y] of [[0, 0], [37, 61], [64, 64], [100, 90], [127, 127]]) {
      const from = (y * 128 + x) * 4;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const to = ((2 * y + dy) * 256 + 2 * x + dx) * 4;
        assert.ok(a.pixels.subarray(from, from + 4).equals(b.pixels.subarray(to, to + 4)), `${item.id} ${x},${y}`);
      }
    }
  }
});

test('buildCells shows status per cell and never substitutes a missing or mismatched entry', () => {
  const sha = sha256(manifestBytes);
  const cells = grid.buildCells(manifest, status, sha);
  assert.ok(cells.every(cell => cell.state === 'ok' && cell.candidate && cell.qvl === 'pass'));
  const squid = cells.find(cell => cell.id === 'squid-trench');
  assert.equal(squid.familyName, 'Squid → Kraken');
  assert.equal(squid.displayFile, 'squid-trench-256.png');
  assert.equal(squid.stageLabel, 'Trench form');
  assert.equal(cells.find(cell => cell.id === 'anglerfish-abyss').stageLabel, 'Mid form');
  assert.equal(cells.find(cell => cell.id === 'anglerfish-twilight').stageLabel, 'Base form');
  assert.ok(grid.buildCells(manifest, status, 'f'.repeat(64)).every(cell => cell.qvl === 'unbound'));
  assert.ok(grid.buildCells(manifest, status, null).every(cell => cell.qvl === 'unbound'));
  const broken = { variants: manifest.variants.filter(item => item.id !== 'viperfish-abyss').map(item => item.id === 'squid-abyss' ? { ...item, display_file: 'octopus-abyss-256.png' } : item) };
  const result = grid.buildCells(broken, status, sha);
  assert.equal(result.find(cell => cell.id === 'viperfish-abyss').state, 'missing');
  assert.equal(result.find(cell => cell.id === 'squid-abyss').state, 'mismatch');
  assert.equal(result.filter(cell => cell.state === 'ok').length, 28);
});

// Runs the real grid script against a stub DOM that serves the project files.
async function renderGrid() {
  class Element {
    constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attrs: {}, className: '', style: { setProperty() {} } }); }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener() {}
    get textContent() { return this.text ?? this.children.map(child => child.textContent ?? child.text ?? '').join(''); }
    set textContent(value) { this.text = value; this.children = []; }
  }
  const all = [];
  const slots = { '#grid': new Element('tbody'), '#grid-status': new Element('p'), '#bg': new Element('select') };
  const document = {
    body: new Element('body'),
    querySelector: selector => slots[selector],
    createElement: tag => { const element = new Element(tag); all.push(element); return element; },
    createTextNode: text => ({ text }),
  };
  const requested = [];
  const fetch = async url => {
    requested.push(url);
    const file = path.resolve(gridDir, url);
    if (!existsSync(file)) return { ok: false };
    const bytes = readFileSync(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    return { ok: true, arrayBuffer: async () => buffer, json: async () => JSON.parse(bytes.toString('utf8')) };
  };
  const context = { document, fetch, crypto: webcrypto, TextDecoder, Uint8Array };
  context.window = context;
  vm.runInNewContext(gridScript, context);
  for (let waited = 0; waited < 8000; waited += 20) {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (slots['#grid-status'].text && !all.some(element => element.className === 'integrity unverified')) break;
  }
  return { all, slots, requested };
}

test('grid renders 30 cells with labels, statuses, downloads, integrity, "Animation playback pending" and no player or legacy loop', async () => {
  const { all, slots, requested } = await renderGrid();
  assert.match(slots['#grid-status'].text, /^30 of 30 candidate stills loaded · 30 QVL pass · 0 animations · final promotion pending\.$/);
  assert.equal(slots['#grid'].children.length, 6);
  const images = all.filter(element => element.tag === 'img');
  assert.deepEqual(images.map(image => image.src.split('/').pop()), FAMILIES.flatMap(family => DEPTHS.map(depth => `${family}-${depth}-256.png`)));
  assert.ok(images.every(image => image.src.startsWith('../codex-creature-depth-evolution/depth-colors/') && image.alt));
  const texts = element => all.filter(item => item.className.split(' ').includes(element)).map(item => item.text);
  assert.equal(texts('badge').filter(text => text === 'QVL pass').length, 30);
  assert.equal(texts('badge').filter(text => text === 'Candidate').length, 30);
  assert.equal(texts('badge').filter(text => text === 'Animation pending').length, 30);
  assert.equal(all.filter(element => element.tag === 'a' && element.download !== undefined).length, 60, '256 and 128 downloads per cell');
  assert.deepEqual([...new Set(texts('integrity'))], ['Integrity: SHA-256 verified']);
  assert.equal(all.filter(element => element.tag === 'button').length, 0, 'no Play control exists');
  const squidRow = slots['#grid'].children[5];
  assert.equal(squidRow.children[0].text, 'Squid → Kraken');
  assert.ok(![...requested, ...all.map(element => element.src ?? element.href ?? '')].some(url => /retrodiffusion|\.gif|octopus|depth-variants/i.test(url)), 'no legacy loop or Octopus fallback is requested');
});

test('grid page: honest pending notice, no player, legacy content confined to <details id="legacy">', () => {
  const legacy = gridHtml.match(/<details id="legacy">[\s\S]*?<\/details>/);
  assert.ok(legacy, 'legacy archive present');
  const current = gridHtml.replace(legacy[0], '');
  assert.match(current, /<p id="animation-notice"[^>]*role="status"><strong>Animation playback pending\.<\/strong>/);
  assert.doesNotMatch(current, /(?:href|src)="[^"]*(?:retrodiffusion|depth-variants\/)|<button|autoplay|<canvas|<video|<audio/i, 'no legacy link and no player element outside #legacy');
  assert.doesNotMatch(current, /https?:\/\//i, 'no external or demo URL');
  assert.doesNotMatch(gridScript, /retrodiffusion|depth-variants|\.gif|octopus|createElement\('(?:button|canvas|video)'\)|autoplay|https?:\/\//i);
  assert.match(legacy[0], /superseded, not current/);
  assert.match(gridHtml, /<script src="legacy-archive\.js">/);
  assert.doesNotMatch(readFileSync(path.join(protos, 'index.html'), 'utf8'), /evolution-grid|codex-creature-palette-base/, 'six-style viewer stays separate');
});

test('3-form gallery shows the 18 normalized morphology sources and keeps its own purpose', () => {
  const stages = ['base-rich', 'midnight-abyss', 'trench'];
  for (const family of FAMILIES) for (const stage of stages) {
    for (const size of [128, 256]) assert.ok(existsSync(path.join(colorDir, `morphology/${family}-${stage}-${size}.png`)), `${family}-${stage}-${size}`);
  }
  assert.ok(galleryHtml.includes("depth-colors/morphology/${f.id}-${s.key}-${size}.png"));
  for (const family of FAMILIES) assert.ok(galleryHtml.includes(`id:'${family}'`), family);
  for (const stage of stages) assert.ok(galleryHtml.includes(`key:'${stage}'`), stage);
  assert.match(galleryHtml, /18 normalized morphology sources/);
  assert.match(galleryHtml, /Three forms\./);
  assert.match(galleryHtml, /not final art/);
  assert.doesNotMatch(galleryHtml, /octopus-[a-z-]*\.png|revisions\/squid/i, 'no Octopus asset reference');
});

test('backend serves 30 hash-verified assets at /ocean-morphology/{form}/{depth}.png and keeps the legacy loops', () => {
  const { profiles, assets, morphologyAssets } = loadOceanProfiles(root);
  assert.deepEqual([...morphologyAssets.keys()], FAMILIES.flatMap(family => DEPTHS.map(depth => `/ocean-morphology/${family}/${depth}.png`)));
  for (const item of manifest.variants) {
    const asset = morphologyAssets.get(`/ocean-morphology/${item.form}/${item.depth}.png`);
    assert.equal(asset.sha256, item.display_sha256, item.id);
    assert.ok(asset.bytes.equals(load(item.display_file)), item.id);
  }
  const stageLabels = { 'base-rich': 'Shared base · Sunlight / Twilight', 'midnight-abyss': 'Midnight / Abyss evolution', trench: 'Advanced Trench form' };
  for (const profile of profiles) {
    assert.equal(profile.morphologyStage, STAGE[profile.depthId]);
    assert.equal(profile.morphologyLabel, stageLabels[profile.morphologyStage]);
    assert.equal(profile.morphologyStatus, 'candidate');
  }
  assert.equal(assets.size, 30);
  assert.ok(assets.has('/ocean-creatures/octopus/trench.gif'), 'legacy animation behaviour is preserved for the app');
  assert.ok([...assets.keys()].every(url => url.endsWith('.gif')));
});

test('backend refuses a tampered variant, a tampered source and a wrong manifest hash', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'evolution-grid-'));
  try {
    for (const dir of ['data', 'ocean-style-prototypes/retrodiffusion-creature-animation', 'ocean-style-prototypes/codex-creature-depth-evolution/depth-colors']) {
      cpSync(path.join(root, dir), path.join(temp, dir), { recursive: true });
    }
    assert.doesNotThrow(() => loadOceanProfiles(temp));
    const colors = path.join(temp, 'ocean-style-prototypes/codex-creature-depth-evolution/depth-colors');
    const flip = file => { const bytes = readFileSync(file); bytes[bytes.length - 20] ^= 1; writeFileSync(file, bytes); };
    const original = readFileSync(path.join(colors, 'viperfish-abyss-256.png'));
    flip(path.join(colors, 'viperfish-abyss-256.png'));
    assert.throws(() => loadOceanProfiles(temp), /ocean_profile_morphology_integrity_failed: viperfish\/abyss/);
    writeFileSync(path.join(colors, 'viperfish-abyss-256.png'), original);
    flip(path.join(colors, 'morphology/squid-trench-128.png'));
    assert.throws(() => loadOceanProfiles(temp), /ocean_profile_morphology_integrity_failed: squid\/trench source/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
