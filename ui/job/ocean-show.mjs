// The ocean show: after an upload the job plays out in the ocean menu itself. The agent octopus (its pose sheets in
// ui/abyss/pixel/creatures/octopus-poses.json: swim, reach, carry, pry, type, wave) catches the file, seals it in the giant
// clam, pries the clam open to reveal the file's fish, runs and analyses it, then the real ocean scrolls down to the verdict
// depth with the fish kept at the centre of the screen.
// drop-panel.js opens it after POST /api/jobs answers 202. It folds the job's event stream with the job view's state machine,
// and every step waits (Next stays disabled) until the events it shows have arrived. All event text goes in via textContent.
import { append, el } from './dom.mjs';
import { applyEvent, createJobState, deepestFinding, DEPTH_INFO, isDeepDepth, pathText, receiptView } from './state.mjs';
import { fishSprite, findingFacts, signalLabel, spriteFacesRight } from './creatures.mjs';
import { drawFish, drawSilhouette } from './pixel.mjs';
import { createNetworkSource } from './sse.mjs';
import { cleanName, generateName, nameFor, otherNames, saveName } from './fish-names.mjs';

// The ocean stage (data-st) for each verdict depth.
const ZONE = { sunlight: 1, twilight: 2, midnight: 3, abyss: 4, trench: 5 };
const STEPS = [
  { key: 'catch', label: 'Catch', ready: () => true },
  { key: 'reveal', label: 'Your fish', ready: s => s.typed !== null },
  { key: 'run', label: 'Running', ready: s => s.rank >= 2 },
  { key: 'analyse', label: 'Analysing', ready: s => s.rank >= 4 || s.verdict !== null },
  { key: 'dive', label: 'The dive', ready: s => s.verdict !== null },
  { key: 'verdict', label: 'Verdict', ready: s => s.verdict !== null },
  { key: 'done', label: 'Done', ready: s => s.receipt !== null || s.finished || s.failed },
];
// Severity colours (the verdict badge's), the "marked as food" stamps, and the Trench creatures' eyes in the dark.
const TIER_COLOUR = { sunlight: '#7fe8ff', twilight: '#b6a6ff', midnight: '#ffd166', abyss: '#ff9a5a', trench: '#ff4f6d' }; // the site's tier palette (bestiary, zone cards)
const MARK = depth => `/ui/abyss/pixel/marks/mark-${depth}.png`;
const FRONT = id => `/ui/abyss/pixel/creatures/front/${id}.png`;
const LUNGE = id => `/ui/abyss/pixel/creatures/front/${id}-lunge.png`;
const EYES = { 'system-wipe': 'jormungandr', encrypt: 'kraken', 'destroy-files': 'leviathan', spread: 'hydra' };
// How alarming one evidence item looks while the file runs, before the rules have judged anything: a quick read of the
// item's own fields (docs/detonation/EVIDENCE.md), shown as the bubble's colour. The verdict stays with the rule engine.
const HONEY = /\/(\.aws\/credentials|\.ssh\/id_|\.env$|wallet|login data|cookies)/i;
const PERSIST = /\/(\.config\/(autostart|systemd)|etc\/(cron|systemd|init\.d|rc\.local|passwd|shadow)|var\/spool\/cron|start menu\/programs\/startup)/i;
const SYSTEM = /^(\/(bin|etc|usr|boot|lib)(\/|$)|[a-z]:\\windows)/i;
const RANSOM = /ransom|decrypt|restore|recover|locked/i;
export function traceSeverity(item) {
  const path = String(item?.path ?? item?.to ?? '');
  switch (item?.kind) {
    case 'unlink': case 'rmdir': return SYSTEM.test(path) ? 'trench' : 'twilight';
    case 'deleted': case 'renamed': return item.seeded ? 'trench' : 'twilight';
    case 'changed': return item.seeded && (item.entropyAfter >= 7.5 || item.sizeAfter === 0) ? 'trench' : item.seeded ? 'abyss' : 'twilight';
    case 'added': return RANSOM.test(path.split('/').pop()) ? 'trench' : item.executable || item.copyOfSample ? 'abyss' : PERSIST.test(path) ? 'abyss' : 'sunlight';
    case 'mail-send': return 'trench';
    case 'file-read': return HONEY.test(path) ? 'midnight' : 'sunlight';
    case 'file-write': case 'rename': return PERSIST.test(path) ? 'abyss' : SYSTEM.test(path) ? 'abyss' : 'sunlight';
    case 'connect': case 'sendto': return item.payloadPreview ? 'midnight' : 'twilight';
    case 'request-blocked': case 'form-submit': return 'midnight';
    case 'setuid': case 'capability': case 'listen': case 'dll-hijack': case 'clone-eagain': return 'abyss';
    case 'key-added': case 'key-changed': case 'key-deleted': return /\\(Run|RunOnce|Winlogon|Services)\\?/i.test(String(item.key)) ? 'abyss' : 'twilight';
    case 'sleep': case 'api-call': return 'twilight';
    default: return 'sunlight';
  }
}
const SEV_RANK = { sunlight: 0, twilight: 1, midnight: 2, abyss: 3, trench: 4 };

const titleCase = slug => String(slug).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
// Pixel sprites load lit (pixel-lit.js): the normal map is applied once, then the sheet is drawn like any image.
const loadImage = src => window.PixelLit.image(src).catch(() => null);

function loadStyles(doc) {
  return new Promise(done => {
    if (doc.querySelector('link[data-os]')) return done();
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/ui/job/ocean-show.css';
    link.dataset.os = '';
    link.onload = link.onerror = () => done();
    doc.head.append(link);
    setTimeout(done, 3000);
  });
}

// ---- pixel art drawn in code ------------------------------------------------------------------------------------
function makeCanvas(doc, w, h) { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; }

// The uploaded file as a paper icon with a folded corner and a gold label band. 12 x 15.
function drawFile(doc) {
  const rows = ['ooooooooo...', 'oppppppppo..', 'opllllllpoo.', 'oppppppppoco', 'opllllllpooo', 'oppppppppppo', 'opllllllllpo',
    'oppppppppppo', 'opllllllllpo', 'oppppppppppo', 'oggggggggggo', 'oggggggggggo', 'oppppppppppo', 'opllllllllpo', 'oooooooooooo'];
  const pal = { o: '#06182a', p: '#effcf8', l: '#9fb4c4', g: '#f4d06a', c: '#c7d6e2' };
  const c = makeCanvas(doc, 12, 15), g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((k, x) => { if (pal[k]) { g.fillStyle = pal[k]; g.fillRect(x, y, 1, 1); } }));
  return c;
}

/**
 * @param {{jobId: string, token: string, fileName?: string, onFail?: () => void, onClose?: () => void, doc?: Document, storage?: Storage}} options
 * storage: where fish names are kept (the menu page passes its web storage); names last for the visit without it.
 */
export async function openOceanShow({ jobId, token, fileName = 'your file', onFail, onClose, doc = document, storage = null } = {}) {
  await loadStyles(doc);
  const win = doc.defaultView;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lenis = win.__lenis;
  const state = createJobState();
  const reportUrl = `/job/${jobId}#${token}`;
  const controller = new AbortController();
  const name = String(fileName).slice(0, 60);

  // ---- layers ---------------------------------------------------------------------------------------------------
  const root = el(doc, 'div', 'os');
  const canvas = el(doc, 'canvas', 'os-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const labels = el(doc, 'div', 'os-labels');
  const fileTag = el(doc, 'p', 'os-tag os-file-tag', name);
  const fishTag = el(doc, 'p', 'os-tag os-fish-tag');
  const term = el(doc, 'div', 'os-term');
  const termHead = el(doc, 'p', 'os-term-head', 'octopus@sandbox');
  const termBody = el(doc, 'ol', 'os-term-body');
  append(term, termHead, termBody);
  // The revealed fish is a real button: pointing at it makes it turn and drift toward you, pressing it makes it hop.
  const fishHit = el(doc, 'button', 'os-fish-hit');
  fishHit.type = 'button';
  for (const node of [fileTag, fishTag, term, fishHit]) node.hidden = true;
  append(labels, fishHit, fileTag, fishTag, term);

  const flash = el(doc, 'div', 'os-flash');
  flash.setAttribute('aria-hidden', 'true');
  const bar = el(doc, 'section', 'os-bar');
  bar.setAttribute('aria-labelledby', 'os-title');
  bar.setAttribute('role', 'region');
  const pips = el(doc, 'ol', 'os-pips');
  for (const step of STEPS) pips.append(el(doc, 'li', 'os-pip', step.label));
  const title = el(doc, 'h2', 'os-title');
  title.id = 'os-title';
  const text = el(doc, 'div', 'os-text');
  text.setAttribute('aria-live', 'polite');
  const status = el(doc, 'span', 'os-status');
  const next = el(doc, 'button', 'os-btn os-next', 'Next ▶');
  next.type = 'button';
  const nav = el(doc, 'div', 'os-nav');
  append(nav, status, next);
  const skip = el(doc, 'a', 'os-skip', 'Skip to the full report');
  skip.href = reportUrl;
  append(bar, pips, title, text, nav, skip);
  append(root, canvas, flash, labels, bar);

  // ---- art --------------------------------------------------------------------------------------------------------
  const paper = drawFile(doc);
  const [clamSheet, poseIndex] = await Promise.all([
    loadImage('/ui/abyss/pixel/creatures/giant-clam-spritesheet.png'),
    fetch('/ui/abyss/pixel/creatures/octopus-poses.json', { credentials: 'omit' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const poses = {};
  await Promise.all(Object.entries(poseIndex?.poses ?? { idle: { sheet: '/ui/abyss/pixel/creatures/octopus-sunlight-spritesheet.png', anchors: {} } })
    .map(async ([pose, entry]) => { poses[pose] = { img: await loadImage(entry.sheet), anchors: entry.anchors ?? {} }; }));
  let fishSheet = null;
  let fishPlain = null;
  let creatureSheet = null;
  let creatureFlip = false;
  let creaturePlain = null;

  // ---- canvas at the theme's pixel size --------------------------------------------------------------------------
  const P = Math.max(3, Math.round(1.5 * (parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue('--u')) || 4))); // 1.5x the theme pixel: the show is the main subject
  const g = canvas.getContext('2d');
  let W = 0, H = 0;
  function resize() {
    const w = Math.ceil(win.innerWidth / P), h = Math.ceil(win.innerHeight / P);
    if (W && H) for (const o of [oct, clam, file, fish, creature]) { o.x *= w / W; o.y *= h / H; }
    W = canvas.width = w;
    H = canvas.height = h;
    canvas.style.width = `${w * P}px`;
    canvas.style.height = `${h * P}px`;
    g.imageSmoothingEnabled = false;
  }
  // Stage centre: right of the caption bar (bottom left) and clear of the depth gauge (right).
  const cx = () => W * 0.63;
  const cy = () => H * 0.36;

  // ---- scene objects (art pixels) -------------------------------------------------------------------------------
  const OCT = 64; // drawn size of the 128 px octopus cell, in art pixels
  // prev/fade: the last pose cross-fades out so arms grow between keyframes. follow: [anchor, point()] keeps an arm tip on a moving point.
  const oct = { x: -60, y: -60, visible: false, pose: 'idle', prev: null, fade: 1, follow: null };
  const clam = { x: 0, y: 0, f: 7, visible: false, shake: false };
  // on: the octopus anchor an object rides on while held.
  const file = { x: 0, y: 0, visible: false, s: 1, a: 1, on: null };
  // free: the fish is idle and answers the pointer (ox, oy: its drift; hop: when it was last pressed).
  // tilt: nose-down angle while it sinks; rim: outline colour (the tier's colour once it is marked as food); mark: stamp scale.
  const fish = { x: 0, y: 0, visible: false, s: 1, a: 1, dir: -1, on: null, free: false, ox: 0, oy: 0, hop: -1e9, tilt: 0, rim: '#b9f4ea', mark: 0, shake: false };
  const pointer = { x: 0, y: 0, in: false };
  let fishName = '';
  // a: alpha (lurking creatures are dim), s: scale (Trench creatures come forward out of the dark). eyes: the Trench eyes layer.
  // view: 'side' (swim sheet), 'front' (facing the viewer), 'lunge' (the bite sheet, frame `f`); turn: side-to-front cross-fade.
  const creature = { x: 0, y: 0, visible: false, dir: -1, a: 1, s: 1, view: 'side', turn: 0, f: 0 };
  let frontImg = null, lungeSheet = null;
  const eyes = { x: 0, y: 0, visible: false, a: 0, s: 1 };
  let eyesSheet = null, markImg = null;
  const bubbles = [];
  const sparks = [];

  // ---- the frame loop and tweens --------------------------------------------------------------------------------
  const tasks = new Set();
  let raf = 0;
  let closed = false;
  function tween(ms, fn, curve = ease) {
    if (reduced || ms <= 0) { fn(1); return Promise.resolve(); }
    return new Promise(done => {
      let t0 = null;
      tasks.add(t => { t0 ??= t; const k = Math.min(1, (t - t0) / ms); fn(curve(k)); if (k < 1) return true; done(); return false; });
    });
  }
  const wait = ms => tween(ms, () => {});
  const moveTo = (o, x, y, ms, curve) => { const x0 = o.x, y0 = o.y; return tween(ms, k => { o.x = lerp(x0, x, k); o.y = lerp(y0, y, k); }, curve); };
  const clamTo = (f, ms) => { const f0 = clam.f; return tween(ms, k => { clam.f = lerp(f0, f, k); }); };
  function puff(x, y, n = 8) { for (let i = 0; i < n; i += 1) bubbles.push({ x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 6, vy: 0.25 + Math.random() * 0.5, life: 60 + Math.random() * 60, r: Math.random() < 0.3 ? 2 : 1 }); }
  function sparkle(x, y, n = 10, colour = '#f4d06a', speed = 0.9) { for (let i = 0; i < n; i += 1) { const a = (i / n) * Math.PI * 2; sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 34, colour }); } }
  const sparkleIn = (x, y, colour, n) => sparkle(x, y, n, colour, 0.6);

  // ---- drawing ------------------------------------------------------------------------------------------------
  // Pose sheets share one 128 px cell, so an anchor (a point measured on the art) maps to the same spot in every pose.
  // A missing in-between frame falls back to its nearest pose, or is skipped in a sequence.
  const FALLBACK = { 'dip-far': 'down-far', 'dip-mid': 'down-mid', 'down-mid': null, 'reach-mid': null,
    'dip1-far': 'dip-far', 'dip1-mid': 'dip-mid', carry1: 'carry', type1: 'type', guide1: 'idle', 'reach1-left-far': 'reach', 'reach1-left-mid': 'reach-mid' };
  function have(pose) {
    while (pose && !poses[pose]?.img) pose = FALLBACK[pose];
    return pose ?? null;
  }
  const sheetOf = pose => poses[have(pose) ?? 'idle'] ?? poses.idle;
  function rawAnchor(pose, name, x, y) {
    // `tip` is the moving arm of a one-arm pose; an older multi-arm stand-in has the same point under another name.
    const known = sheetOf(pose)?.anchors ?? {};
    const a = known[name] ?? (name === 'tip' ? known.paper ?? known.bottom ?? known.left : null) ?? [64, 64];
    return { x: x + (a[0] / 128 - 0.5) * OCT, y: y + (a[1] / 128 - 0.5) * OCT };
  }
  // Mid cross-fade, the anchor slides from the old pose's spot to the new one's, so held things move with the arm.
  function anchorAt(pose, name, x = oct.x, y = oct.y) {
    const now = rawAnchor(pose, name, x, y);
    if (pose !== oct.pose || !oct.prev || oct.fade >= 1) return now;
    const was = rawAnchor(oct.prev, name, x, y);
    return { x: lerp(was.x, now.x, oct.fade), y: lerp(was.y, now.y, oct.fade) };
  }
  // Where the octopus must be for `pose`'s anchor `name` to sit on `point`.
  function spotFor(pose, name, point) {
    const a = rawAnchor(pose, name, 0, 0);
    return { x: point.x - a.x, y: point.y - a.y };
  }
  function setPose(pose, ms = 0) {
    const next = have(pose) ?? 'idle';
    if (next === oct.pose) return Promise.resolve();
    oct.prev = oct.pose; oct.pose = next; oct.fade = 0;
    return tween(ms, k => { oct.fade = k; }, k => k).then(() => { if (oct.pose === next) oct.prev = null; });
  }
  // Step through keyframes so the arms visibly extend or pull back.
  async function animate(seq, ms = 280) {
    for (const pose of seq) if (have(pose)) { await setPose(pose, ms); await wait(ms * 0.25); }
  }
  // The two keyframes of a one-arm reach, shorter first (generated mid frames are not always shorter than far ones).
  const tipReach = pose => { const t = sheetOf(pose)?.anchors?.tip; return t ? Math.hypot(t[0] - 64, t[1] - 58) : 0; };
  const reachPair = dir => [`reach1-${dir}-mid`, `reach1-${dir}-far`].filter(have).sort((a, b) => tipReach(a) - tipReach(b));
  async function poseTo(pose, name, point, ms = 600) {
    setPose(pose);
    const at = spotFor(pose, name, point);
    await moveTo(oct, at.x, at.y, ms);
  }

  // A sprite with a one-pixel light rim, so dark creatures stay readable in the deep water.
  const rimCanvas = makeCanvas(doc, 128, 128), rim = rimCanvas.getContext('2d');
  function drawRimmed(img, sx, sy, sw, sh, dx, dy, dw, dh, colour = '#b9f4ea') {
    rimCanvas.width = dw; rimCanvas.height = dh;
    rim.imageSmoothingEnabled = false;
    rim.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    rim.globalCompositeOperation = 'source-in';
    rim.fillStyle = colour;
    rim.fillRect(0, 0, dw, dh);
    rim.globalCompositeOperation = 'source-over';
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.drawImage(rimCanvas, dx + ox, dy + oy);
    g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function drawFrame(t) {
    g.clearRect(0, 0, W, H);
    const tick = Math.floor(t / 150) % 14;
    if (clam.visible && clamSheet) {
      const shake = clam.shake && !reduced ? (Math.floor(t / 70) % 2 ? 1 : -1) * (1 + (clam.jolt ?? 0)) : 0;
      if (clam.jolt) clam.jolt = Math.max(0, clam.jolt - 0.05);
      g.drawImage(clamSheet, Math.round(clam.f) * 128, 0, 128, 128, Math.round(clam.x - 32 + shake), Math.round(clam.y - 32), 64, 64);
    }
    if (file.visible && file.a > 0) {
      g.globalAlpha = file.a;
      const w = Math.max(1, Math.round(12 * file.s)), h = Math.max(1, Math.round(15 * file.s));
      g.drawImage(paper, Math.round(file.x - w / 2), Math.round(file.y - h / 2), w, h);
      g.globalAlpha = 1;
    }
    if (fish.visible && fish.s > 0) {
      const size = Math.round(48 * fish.s);
      const hop = Math.max(0, 1 - (t - fish.hop) / 600);
      g.save();
      g.globalAlpha = fish.a;
      const jolt = fish.shake && !reduced ? (Math.floor(t / 60) % 2 ? 1 : -1) : 0;
      g.translate(Math.round(fish.x + fish.ox + jolt), Math.round(fish.y + fish.oy - Math.sin(hop * Math.PI) * 10));
      g.rotate(fish.tilt);
      if (fish.dir > 0) g.scale(-1, 1);
      if (fishSheet) drawRimmed(fishSheet, tick * 64, 0, 64, 64, -size / 2, -size / 2, size, size, fish.rim);
      else if (fishPlain) g.drawImage(fishPlain, -12 * fish.s, -6 * fish.s, 24 * fish.s, 12 * fish.s);
      g.restore();
      // The "marked as food" stamp sits on the fish's body (its name tag is above it), pulsing in the tier's colour.
      if (markImg && fish.mark > 0) {
        const m = Math.round(20 * fish.mark * (1 + 0.08 * Math.sin(t * 0.008)));
        g.globalAlpha = 0.92;
        g.drawImage(markImg, Math.round(fish.x + fish.ox - m / 2), Math.round(fish.y + fish.oy - m / 2), m, m);
        g.globalAlpha = 1;
      }
    }
    if (oct.visible) {
      const dx = Math.round(oct.x - OCT / 2), dy = Math.round(oct.y - OCT / 2 + Math.round(Math.sin(t * 0.003)));
      // Two-phase blend: the new arms fade in over the old pose, then the old arms fade out, so the mantle never thins.
      const blend = oct.prev && oct.fade < 1;
      const [under, over, a] = !blend ? [null, oct.pose, 1] : oct.fade < 0.5 ? [oct.prev, oct.pose, oct.fade * 2] : [oct.pose, oct.prev, (1 - oct.fade) * 2];
      if (under) g.drawImage(sheetOf(under).img, tick * 128, 0, 128, 128, dx, dy, OCT, OCT);
      g.globalAlpha = a;
      g.drawImage(sheetOf(over).img, tick * 128, 0, 128, 128, dx, dy, OCT, OCT);
      g.globalAlpha = 1;
    }
    // Trench eyes sit behind the creature: the creature comes forward out of them.
    if (eyes.visible && eyesSheet && eyes.a > 0) {
      const e = Math.round(110 * eyes.s);
      g.globalAlpha = eyes.a;
      g.drawImage(eyesSheet, tick * 128, 0, 128, 128, Math.round(eyes.x - e / 2), Math.round(eyes.y - e / 2), e, e);
      g.globalAlpha = 1;
    }
    if (creature.visible && creature.a > 0) {
      const c = Math.round(80 * creature.s);
      const rimColour = creature.a > 0.6 ? '#b9f4ea' : '#0a1a2a';
      g.save();
      g.translate(Math.round(creature.x), Math.round(creature.y));
      // Side view (cross-fading out while it turns), then the front-facing still or the bite sheet.
      const side = creature.view === 'side' ? 1 : 1 - creature.turn;
      if (side > 0) {
        g.save();
        g.globalAlpha = creature.a * side;
        if ((creature.dir > 0) !== creatureFlip) g.scale(-1, 1);
        if (creatureSheet) drawRimmed(creatureSheet, tick * 128, 0, 128, 128, -c / 2, -c / 2, c, c, rimColour);
        else if (creaturePlain) g.drawImage(creaturePlain, -16 * creature.s, -12 * creature.s, 32 * creature.s, 24 * creature.s);
        g.restore();
      }
      if (creature.view !== 'side' && (frontImg || lungeSheet)) {
        g.globalAlpha = creature.a * (creature.view === 'lunge' ? 1 : creature.turn);
        if (creature.view === 'lunge' && lungeSheet) drawRimmed(lungeSheet, Math.min(7, creature.f) * 128, 0, 128, 128, -c / 2, -c / 2, c, c, rimColour);
        else if (frontImg) drawRimmed(frontImg, 0, 0, 128, 128, -c / 2, -c / 2, c, c, rimColour);
      }
      g.restore();
      g.globalAlpha = 1;
    }
    g.fillStyle = '#b9f4ea';
    for (let i = bubbles.length - 1; i >= 0; i -= 1) {
      const b = bubbles[i];
      b.y -= b.vy; b.x += Math.sin((b.y + i) * 0.2) * 0.15; b.life -= 1;
      if (b.life <= 0 || b.y < -4) { bubbles.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, b.life / 30) * 0.8;
      g.fillRect(Math.round(b.x), Math.round(b.y), b.r, b.r);
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const s = sparks[i];
      g.fillStyle = s.colour ?? '#f4d06a';
      s.x += s.vx; s.y += s.vy; s.life -= 1;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      g.globalAlpha = s.life / 34;
      g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    g.globalAlpha = 1;
  }

  // DOM labels follow their objects (art pixels times P).
  function place(node, x, y) { node.style.transform = `translate(${Math.round(x * P)}px, ${Math.round(y * P)}px)`; }
  function drawLabels() {
    if (!fileTag.hidden) { const at = oct.pose.startsWith('carry') && !file.visible ? anchorAt(oct.pose, 'tip') : file; place(fileTag, at.x, at.y - 12); }
    if (!fishTag.hidden) place(fishTag, fish.x + fish.ox, fish.y + fish.oy - 26 * fish.s);
    fishHit.hidden = !(fish.free && fish.visible);
    if (!fishHit.hidden) { place(fishHit, fish.x + fish.ox, fish.y + fish.oy); fishHit.style.width = fishHit.style.height = `${Math.round(40 * fish.s * P)}px`; }
    if (!term.hidden) { const tip = anchorAt('type1', 'tip'); place(term, tip.x - 3, tip.y - 4); }
  }

  function frame(t) {
    if (closed) return;
    for (const task of [...tasks]) if (!task(t)) tasks.delete(task);
    if (oct.follow) { const [name, point] = oct.follow; const at = spotFor(oct.pose, name, point()); oct.x = at.x; oct.y = at.y; }
    for (const o of [file, fish]) if (o.on) { const at = anchorAt(oct.pose, o.on); o.x = at.x; o.y = at.y; }
    // A free fish turns to a nearby pointer and drifts up to 10 art pixels toward it; otherwise the drift eases back to a bob.
    const near = fish.free && pointer.in && Math.hypot(pointer.x - fish.x, pointer.y - fish.y) < 60;
    const dx = near ? Math.max(-10, Math.min(10, (pointer.x - fish.x) * 0.25)) : 0, dy = near ? Math.max(-6, Math.min(6, (pointer.y - fish.y) * 0.2)) : 0;
    fish.ox = lerp(fish.ox, dx, 0.06); fish.oy = lerp(fish.oy, dy + (fish.free ? Math.sin(t * 0.002) * 2 : 0), 0.06);
    if (near && Math.abs(pointer.x - fish.x) > 4) fish.dir = pointer.x > fish.x ? 1 : -1;
    if (clam.shake && !reduced && Math.random() < 0.15) puff(clam.x + (Math.random() - 0.5) * 20, clam.y - 10, 1);
    drawFrame(t);
    drawLabels();
    raf = win.requestAnimationFrame(frame);
  }

  // ---- story beats ------------------------------------------------------------------------------------------------
  const facts = () => { const f = deepestFinding(state.findings); return f ? findingFacts(f) : null; };
  const speciesName = () => titleCase(state.typed?.species ?? 'fish');
  const para = (value, className = '') => el(doc, 'p', className, value);
  const setText = (...nodes) => text.replaceChildren(...nodes.filter(Boolean));
  const lipOf = () => ({ x: clam.x + 9, y: clam.y + lerp(-20, -2, clam.f / 7) });
  const mouthOf = () => ({ x: clam.x + 1, y: clam.y + 6 });
  let evidenceShown = 0;
  let runCount = null;

  // Opening: the lower arms stretch down and hook the lid's lip, then heave it up, riding the lid as it lifts.
  // Closing: they hook the raised lip and push it shut. Either way the arms let go and curl back afterwards.
  async function prise(open, ms = 800) {
    const at = spotFor('down-far', 'bottom', lipOf());
    await setPose('idle', 150);
    await moveTo(oct, at.x, at.y, 450);
    await animate(['down-mid', 'down-far']);
    oct.follow = ['bottom', lipOf];
    await setPose(open ? 'lift' : 'push', 220);
    await clamTo(open ? 0 : 7, ms);
    puff(clam.x, clam.y - 4, open ? 10 : 6);
    await setPose('down-far', 200);
    oct.follow = null;
    await animate(['down-mid', 'idle']);
  }
  // One arm reaches down into the open clam and comes back up with `o` (the file or fish) curled in its tip.
  async function dip(o, into = false) {
    const at = spotFor('dip1-far', 'tip', mouthOf());
    await setPose('idle', 150);
    await moveTo(oct, at.x, at.y, 450);
    await animate(['dip1-mid', 'dip1-far']);
    const s0 = o?.s ?? 1;
    if (o && into) await Promise.all([moveTo(o, mouthOf().x, mouthOf().y + 2, 350), tween(350, k => { o.s = lerp(s0, 0.3, k); o.a = 1 - k; })]);
    else if (o) { o.on = 'tip'; o.visible = true; }
    if (o && into) o.visible = false;
    await wait(250);
    await animate(['dip1-mid', 'idle']);
    if (o) o.on = null;
  }
  // Highest the octopus may sit: its whole cell below the nav bar.
  const topSafe = () => (doc.querySelector('.bar')?.getBoundingClientRect().bottom ?? 64) / P + OCT / 2 + 2;
  const aside = () => ({ x: cx() + 18, y: Math.max(cy() - 28, topSafe()) }); // left of the depth gauge

  // Stamped as food for its depth: the fish shudders, takes the tier's colour and gets the tier's mark.
  async function markAsFood(depth) {
    markImg = await loadImage(MARK(depth));
    fish.rim = TIER_COLOUR[depth] ?? TIER_COLOUR.abyss;
    fish.shake = true;
    react(depth);
    sparkle(fish.x, fish.y, 10 + 4 * SEV_RANK[depth], fish.rim, 1.1);
    await tween(450, k => { fish.mark = k < 0.7 ? k / 0.7 * 1.3 : 1.3 - (k - 0.7) / 0.3 * 0.3; }, k => k);
    await wait(900);
    fish.shake = false;
  }

  // A screen-wide reaction scaled to severity: a soft gold glow for clean, an amber pulse for risky, then a flash in the
  // tier's colour with a screen shake that grows with depth (the bite adds a harder one).
  function react(depth, bite = false) {
    const rank = SEV_RANK[depth] ?? 0;
    flash.dataset.sev = depth;
    flash.classList.remove('on');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('on');
    if (rank >= 2 && !reduced) {
      root.style.setProperty('--shake', `${(rank - 1) * (bite ? 4 : 2)}px`);
      root.classList.remove('os-shake');
      void root.offsetWidth;
      root.classList.add('os-shake');
    }
  }
  const showFishTag = (suffix = '') => { fishTag.textContent = `${fishName} · ${speciesName()}${suffix}`; fishTag.hidden = false; };

  function pet() {
    if (!fish.free) return;
    fish.hop = performance.now();
    fish.dir = -fish.dir;
    sparkle(fish.x + fish.ox, fish.y + fish.oy, 10);
    puff(fish.x + fish.ox, fish.y + fish.oy - 4, 6);
  }
  fishHit.addEventListener('click', pet);
  const onPointer = event => { pointer.x = event.clientX / P; pointer.y = event.clientY / P; pointer.in = true; };
  const onLeave = () => { pointer.in = false; };
  win.addEventListener('pointermove', onPointer);
  doc.documentElement.addEventListener('pointerleave', onLeave);

  // Name the fish: a generated two-word name until the visitor types one. Stored in this browser only.
  function nameRow() {
    const row = el(doc, 'div', 'os-name');
    const label = el(doc, 'label', 'os-name-label', 'Name your fish');
    const input = el(doc, 'input', 'os-name-input');
    input.id = `os-name-${jobId}`;
    label.htmlFor = input.id;
    input.maxLength = 24;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = fishName;
    const reroll = el(doc, 'button', 'os-btn os-name-new', '↻ New name');
    reroll.type = 'button';
    let turn = 0;
    const commit = value => { fishName = value; saveName(jobId, value, storage); fishHit.setAttribute('aria-label', `${value} the ${speciesName()}: press to make it hop`); showFishTag(); };
    input.addEventListener('input', () => { const value = cleanName(input.value); if (value) commit(value); });
    input.addEventListener('change', () => { const value = cleanName(input.value) || generateName(jobId, state.typed?.species, otherNames(jobId, storage)); input.value = value; commit(value); });
    reroll.addEventListener('click', () => { turn += 1; const value = generateName(jobId, state.typed?.species, otherNames(jobId, storage), turn); input.value = value; commit(value); });
    append(row, label, input, reroll);
    return row;
  }

  // Where the fish's own school sits on screen (art pixels), from the renderer's school records; null if it has none yet.
  function schoolSpot(depth) {
    const ocean = win.__ocean;
    const ent = ocean?.ents?.find(e => e.a?.id === `school-${state.typed?.species}-${depth}`);
    if (!ent?.pos?.clone || !ocean.camera) return null;
    const v = ent.pos.clone().project(ocean.camera);
    if (!(v.z < 1)) return null;
    return { x: Math.max(-20, Math.min(W + 20, (v.x + 1) / 2 * win.innerWidth / P)), y: Math.max(-20, Math.min(H + 20, (1 - v.y) / 2 * win.innerHeight / P)) };
  }

  const beats = {
    async catch() {
      title.textContent = 'The octopus catches your file';
      setText(para('Every upload is handled by the octopus: it takes your file down to a giant clam that works as a sealed sandbox.'));
      // The file stays where it was dropped, in the upload panel; the octopus comes to it. The caption bar (bottom left,
      // over the panel) waits until the octopus has the file, so the grab is in view.
      bar.classList.add('os-bar-late');
      const panel = doc.getElementById('upload')?.getBoundingClientRect();
      file.x = Math.max(14, Math.min(W - 14, panel ? (panel.left + panel.width * 0.3) / P : cx() - 60));
      file.y = Math.max(14, Math.min(H - 14, panel ? (panel.top + panel.height * 0.4) / P : cy()));
      file.visible = true;
      fileTag.hidden = false;
      clam.x = cx(); clam.y = H + 40; clam.f = 7; clam.visible = true;
      // It starts where the menu octopus floats (or jet-swims in from the right), then stretches ONE arm to the file.
      const home = win.__menuOctopus?.at?.();
      if (home) { oct.x = home.x / P; oct.y = home.y / P; setPose('idle'); } else { oct.x = W + 40; oct.y = cy() - 40; setPose('swim'); }
      oct.visible = true;
      win.__menuOctopus?.hide?.();
      const [reachMid, reachFar] = reachPair('left');
      const grab = spotFor(reachFar ?? 'reach', 'tip', file);
      await Promise.all([moveTo(clam, cx(), cy() + 26, 1500), moveTo(oct, grab.x + 10, grab.y, 1400)]);
      await setPose('idle', 220);
      await animate([reachMid, reachFar].filter(Boolean));
      await moveTo(oct, grab.x, grab.y, 200);
      // Caught: the tip curls round the paper and pulls it in to the one-arm carry.
      file.on = 'tip';
      puff(file.x, file.y, 5);
      if (reachMid) await setPose(reachMid, 260);
      await setPose('carry1', 260);
      file.on = null; file.visible = false;
      bar.classList.remove('os-bar-late');
      title.textContent = 'Into the giant clam';
      await poseTo('carry1', 'tip', { x: clam.x + 24, y: clam.y + 2 }, 1500);
      // It lays the file on the sand by the clam, prises the lid open with its lower arms, and pushes the file in.
      const drop = anchorAt('carry1', 'tip');
      file.x = drop.x; file.y = drop.y; file.s = 1; file.a = 1; file.visible = true;
      await setPose('idle', 200);
      await moveTo(file, clam.x + 22, clam.y + 16, 400, k => k * k);
      await prise(true);
      await moveTo(file, mouthOf().x, mouthOf().y, 500);
      fileTag.hidden = true;
      await dip(file, true);
      await prise(false, 600);
      clam.shake = true;
      await wait(400);
      clam.shake = false;
      title.textContent = 'Sealed. Finding out what the file really is';
      setText(para('Inside the clam the server reads the file’s content, not its name, to find its real type.'));
    },

    async reveal() {
      const typed = state.typed;
      await prise(true, 900);
      fishSheet = null; fishPlain = null;
      const url = fishSprite(typed.species);
      fishSheet = url ? await loadImage(url) : null;
      if (!fishSheet) fishPlain = drawFish(doc, typed.species);
      // An arm reaches in and lifts the fish out.
      fish.s = 0.4; fish.dir = -1; fish.visible = false;
      await dip(fish);
      sparkle(fish.x, fish.y, 14);
      puff(fish.x, fish.y, 12);
      await Promise.all([moveTo(fish, cx(), cy() - 4, 900), tween(900, k => { fish.s = lerp(0.4, 1, k); }), moveTo(oct, aside().x, aside().y, 900)]);
      fishName = nameFor(jobId, typed.species, storage);
      fishHit.setAttribute('aria-label', `${fishName} the ${speciesName()}: press to make it hop`);
      showFishTag();
      fish.free = true;
      title.textContent = `Your file is a ${speciesName()}`;
      const lines = [
        para(`${name} is a ${typed.detectedType} file. Inside the clam every file is born as an innocent fish of its type: this one is a ${speciesName()}. What it does next decides where it ends up.`),
        nameRow(),
        para(pathText(typed, state.rank) || 'Waiting for a sandbox.', 'os-plan'),
      ];
      if (typed.mismatch) lines.push(para(`Its name says .${typed.claimedExtension}, but its content is ${typed.detectedType}.`, 'os-warn'));
      setText(...lines);
    },

    async run() {
      title.textContent = 'Sealed in, and running';
      runCount = para('', 'os-count');
      setText(para('Back into the clam. Inside: no network, a fake home folder full of bait files, and a canary file that shows if anything escapes. The file runs for up to 30 seconds.'), runCount);
      fishTag.hidden = true;
      fish.free = false;
      await Promise.all([moveTo(fish, mouthOf().x, mouthOf().y, 700), tween(700, k => { fish.s = 1 - k * 0.5; })]);
      fish.visible = false;
      await prise(false, 600);
      await moveTo(oct, aside().x, aside().y, 700);
      clam.shake = true;
      pumpEvidence();
    },

    async analyse() {
      clam.shake = false;
      labels.querySelectorAll('.os-ev').forEach(node => node.remove());
      title.textContent = 'The octopus reads the evidence';
      const n = state.attempts.length;
      setText(para(n
        ? `It wrote analysis code ${plural(n, 'time')}. Each script runs in a second sandbox; a failed one goes back for a fix.`
        : 'It checks everything the file did against the list of harmful behaviours.'),
      state.explanation?.modelAvailable === false ? para('The AI model was not available, so the verdict comes from the rules alone.', 'os-muted') : null);
      // One arm taps the slate.
      await moveTo(oct, cx() + 22, Math.max(cy() - 24, topSafe()), 700);
      await setPose('type1', 260);
      term.hidden = false;
      termBody.replaceChildren();
      for (const [line, sev] of analysisLines()) {
        const li = el(doc, 'li', '', line);
        if (sev) li.dataset.sev = sev;
        termBody.append(li);
        await wait(380);
      }
    },

    async dive() {
      term.hidden = true;
      const depth = state.depth ?? 'sunlight';
      title.textContent = 'The dive';
      setText(para('The deeper the fish sinks, the more harm the file did. Sunlight is clean; the Trench destroys.'),
        para(state.findings.length ? `${plural(state.findings.length, 'finding')} pull it down.` : state.signals.length ? `${plural(state.signals.length, 'warning sign')} pull it down a little.` : 'Nothing pulls it down.', 'os-muted'));
      await setPose('idle', 200);
      await prise(true, 700);
      fish.s = 0.5; fish.visible = false;
      await dip(fish);
      await Promise.all([moveTo(fish, cx(), cy(), 700), tween(700, k => { fish.s = lerp(0.5, 1, k); })]);
      if (isDeepDepth(depth)) {
        // The harm it did catches up with it: punished, marked as food for that depth, and pushed down to it.
        title.textContent = 'Punished';
        setText(para(`Born innocent, but this ${speciesName()} did harm. It is marked as food for the ${DEPTH_INFO[depth].name} and pushed down to it.`, 'os-warn'),
          para(state.findings.map(f => findingFacts(f).label).slice(0, 3).join(' · '), 'os-muted'));
        await markAsFood(depth);
        title.textContent = `Down to the ${DEPTH_INFO[depth].name}`;
      }
      // One arm curls under the fish and guides it down: the fish tips nose-down and the world rises past both of them.
      await setPose('guide1', 260);
      const cradle = () => ({ x: fish.x + 4, y: fish.y + 8 });
      await poseTo('guide1', 'tip', cradle(), 500);
      oct.follow = ['tip', cradle];
      const st = ZONE[depth] ?? ZONE.sunlight;
      const zone = doc.querySelector(`.zone[data-st="${st}"]`);
      const seconds = 2.2 + st * 0.6;
      const scrolled = new Promise(done => {
        if (!zone) return done();
        // The renderer's own camera stop for this stage, so the dive settles exactly where scrolling (and its snap) would.
        const range = doc.documentElement.scrollHeight - win.innerHeight;
        const anchor = win.__ocean?.anchors?.()[st];
        const top = Number.isFinite(anchor) ? anchor * range
          : zone.getBoundingClientRect().top + win.scrollY + Math.min(zone.offsetHeight, win.innerHeight) / 2 - win.innerHeight / 2;
        if (lenis) lenis.scrollTo(top, { duration: reduced ? 0 : seconds, immediate: reduced, force: true, onComplete: done });
        else { win.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' }); setTimeout(done, reduced ? 0 : seconds * 1000); }
      });
      let scrolling = true; // bubbles stream up past the fish while the ocean scrolls; the fish wiggles as it swims down
      const fx = fish.x;
      if (!reduced) tasks.add(t => {
        if (closed || !scrolling) return false;
        if (Math.random() < 0.6) bubbles.push({ x: Math.random() * W, y: H + 2, vy: 2.2 + Math.random() * 2, life: 140, r: Math.random() < 0.3 ? 2 : 1 });
        fish.x = fx + Math.sin(t * 0.006) * 3;
        return true;
      });
      await Promise.all([tween(600, k => { fish.tilt = -0.55 * k; }), moveTo(clam, clam.x, -80, seconds * 800), scrolled]);
      scrolling = false;
      clam.visible = false;
      // Arrived: the fish levels out, the octopus lets go and swims back up.
      oct.follow = null;
      await Promise.all([tween(500, k => { fish.tilt = -0.55 * (1 - k); fish.x = lerp(fish.x, fx, k); }), setPose('idle', 250)]);
      await setPose('swim', 200);
      await moveTo(oct, oct.x + 30, -90, 1100);
      oct.visible = false;
      showFishTag(` · ${DEPTH_INFO[depth].name} · ${DEPTH_INFO[depth].range}`);
      fish.free = true;
    },

    async verdict() {
      const depth = state.depth ?? 'sunlight';
      const deep = isDeepDepth(depth);
      const finding = facts();
      const badge = para(`${DEPTH_INFO[depth].name} · ${DEPTH_INFO[depth].meaning}`, 'os-badge');
      badge.dataset.depth = depth;
      const list = el(doc, 'ul', 'os-findings');
      for (const item of state.findings) { const f = findingFacts(item); list.append(el(doc, 'li', '', `${f.creature}: ${f.label}`)); }
      for (const signal of state.signals) list.append(el(doc, 'li', '', signalLabel(signal.id ?? signal)));
      title.textContent = deep ? 'Marked as food' : 'Your fish is safe';
      setText(badge, para(state.verdict?.statement ?? (deep ? 'Harmful behaviour observed.' : 'No harmful behaviour observed in the checks run. This is not a guarantee.')), list.children.length ? list : null);
      react(depth);
      if (!deep) {
        showFishTag(' joins its school');
        if (depth === 'sunlight') { sparkle(fish.x, fish.y, 18, '#f4d06a', 1.3); sparkle(fish.x, fish.y, 10, '#b9f4ea', 0.7); fish.hop = performance.now(); }
        else { fish.rim = TIER_COLOUR.twilight; sparkle(fish.x, fish.y, 8, TIER_COLOUR.twilight, 0.6); }
        await wait(1600);
        fish.free = false;
        // It swims off into the background to its own school, shrinking to the school's size, and fades in among them.
        // A species with no school yet swims off into the distance instead.
        const x0 = fish.x + fish.ox, y0 = fish.y + fish.oy;
        fish.x = x0; fish.y = y0; fish.ox = fish.oy = 0;
        const target = () => schoolSpot(depth) ?? { x: -40, y: cy() - 10 };
        fish.dir = target().x > x0 ? 1 : -1;
        await tween(2600, k => {
          const at = target();
          fish.x = lerp(x0, at.x, k); fish.y = lerp(y0, at.y, k) - Math.sin(k * Math.PI) * 12;
          fish.s = lerp(1, 0.28, k); fish.a = k > 0.8 ? (1 - k) / 0.2 : 1;
        });
        if (schoolSpot(depth)) sparkle(fish.x, fish.y, 8);
        fish.visible = false;
        fishTag.hidden = true;
        return;
      }
      fish.free = false;
      text.prepend(para(`Born an innocent ${speciesName()}, punished for what it did: food for the ${finding?.creature ?? 'creature'} of the ${DEPTH_INFO[depth].name}.`, 'os-warn'));
      if (!fish.mark) await markAsFood(depth);
      const findingId = deepestFinding(state.findings)?.id;
      [creatureSheet, eyesSheet, frontImg, lungeSheet] = await Promise.all([
        finding?.sprite ? loadImage(finding.sprite) : null,
        depth === 'trench' && EYES[findingId] ? loadImage(`/ui/abyss/pixel/creatures/eyes-${EYES[findingId]}-spritesheet.png`) : null,
        findingId ? loadImage(FRONT(findingId)) : null, findingId ? loadImage(LUNGE(findingId)) : null,
      ]);
      creatureFlip = spriteFacesRight(finding?.sprite);
      creaturePlain = creatureSheet ? null : drawSilhouette(doc);
      fishTag.textContent = `${finding?.creature ?? 'A creature'}: ${finding?.label ?? ''}`;
      fishTag.hidden = false;
      title.textContent = `The ${finding?.creature ?? 'creature'} comes for it`;
      const facing = Boolean(frontImg);
      creature.view = 'side'; creature.turn = 0; creature.f = 0;
      if (eyesSheet && facing) {
        // Trench: only eyes in the dark, then the creature's face comes out of them, facing the viewer, eyes on its eyes.
        eyes.x = Math.min(fish.x + 40, W - 70); eyes.y = fish.y - 6; eyes.s = 0.8; eyes.visible = true;
        await tween(1300, k => { eyes.a = k * 0.95; eyes.s = lerp(0.8, 1, k); });
        await wait(600);
        creature.x = eyes.x; creature.y = eyes.y + 10; creature.s = 1.05; creature.a = 0; creature.view = 'front'; creature.turn = 1; creature.visible = true;
        await tween(1000, k => { creature.a = k; eyes.a = 0.95 * (1 - k); });
        eyes.visible = false;
      } else {
        // Midnight and Abyss: the creature lurks dim at the edge of the light, side-on, then turns to face its prey.
        creature.x = W + 30; creature.y = fish.y + 10; creature.s = 1; creature.a = depth === 'abyss' ? 0.3 : 0.45; creature.dir = -1; creature.visible = true;
        await moveTo(creature, Math.min(fish.x + 56, W - 60), fish.y + 4, 1300);
        await tween(900, k => { creature.y = fish.y + 4 + Math.sin(k * Math.PI * 2) * 3; });
        if (facing) { creature.view = 'front'; await tween(450, k => { creature.turn = k; creature.a = lerp(creature.a, 1, k); }); }
        else await tween(350, k => { creature.a = lerp(creature.a, 1, k); });
      }
      if (facing && lungeSheet) {
        // The lunge: it surges toward the viewer over the fish while the bite plays (RetroDiffusion sheet, 8 frames).
        const x0 = creature.x, y0 = creature.y, s0 = creature.s;
        creature.view = 'lunge';
        await tween(reduced ? 0 : 1100, k => {
          creature.f = Math.floor(k * 8);
          creature.x = lerp(x0, fish.x, Math.min(1, k * 1.6)); creature.y = lerp(y0, fish.y, Math.min(1, k * 1.6));
          creature.s = lerp(s0, 1.3, Math.sin(Math.min(1, k * 1.3) * Math.PI / 2));
        }, k => k);
        creature.f = 7;
      } else {
        await moveTo(creature, fish.x + 54, fish.y + 6, 300);
        await moveTo(creature, fish.x + 22, fish.y, 260, k => k * k);
      }
      fish.visible = false;
      fish.mark = 0;
      fishTag.hidden = true;
      puff(fish.x, fish.y, 16);
      react(depth, true);
      title.textContent = `${finding?.creature ?? 'A creature'} ate ${fishName || 'your file'}`;
      await wait(500);
      if (creature.view !== 'side') {
        // Back into the dark: it shrinks and fades the way it came.
        await tween(900, k => { creature.s = lerp(1.3, 0.6, k); creature.a = 1 - k; });
      } else await moveTo(creature, -70, creature.y + 20, 1600);
      creature.visible = false;
    },

    async done() {
      const view = receiptView(state.receipt);
      title.textContent = state.receipt ? 'Sandbox destroyed' : 'The job ended';
      setText(
        para(state.receipt ? view.headline : 'The job ended before the sandbox receipt was issued.', 'os-receipt'),
        state.receipt ? para('Only the canary file is checked; that is not proof the whole machine was untouched.', 'os-muted') : null,
        finalButtons(),
      );
    },
  };

  function analysisLines() {
    const lines = [];
    state.attempts.forEach(a => lines.push([`attempt ${a.n}: exit ${a.exitCode}${a.exitCode === 0 ? ' ✓' : ' ✗'}`]));
    lines.push([`read ${plural(state.evidence.length, 'evidence item')}`]);
    for (const f of state.findings) lines.push([`match: ${findingFacts(f).label}`, findingFacts(f).depth === 'variable' ? state.depth : findingFacts(f).depth]);
    for (const s of state.signals) lines.push([`warn: ${signalLabel(s.id ?? s)}`, 'twilight']);
    if (!state.findings.length && !state.signals.length) lines.push(['no harmful pattern matched', 'sunlight']);
    if (state.verdict?.depth) lines.push([`verdict: ${DEPTH_INFO[state.verdict.depth]?.name ?? state.verdict.depth}`, state.verdict.depth]);
    return lines.slice(0, 9);
  }

  // Evidence comes out of the shaking clam as bubbles, one at a time, while the Running step is open.
  let pumping = false;
  let worst = 'sunlight';
  async function pumpEvidence() {
    if (pumping) return;
    pumping = true;
    while (!closed && index === 2 && evidenceShown < state.evidence.length) {
      const item = state.evidence[evidenceShown];
      evidenceShown += 1;
      const bubble = el(doc, 'p', 'os-ev', String(item.detail ?? item.kind ?? ''));
      bubble.dataset.src = String(item.source ?? 'evidence');
      // Its colour and weight follow how alarming it looks; the clam shudders harder for the worse ones.
      const sev = traceSeverity(item);
      bubble.dataset.sev = sev;
      worst = SEV_RANK[sev] > SEV_RANK[worst] ? sev : worst;
      clam.jolt = SEV_RANK[sev];
      if (SEV_RANK[sev] >= 2) sparkleIn(clam.x, clam.y - 14, TIER_COLOUR[sev], 4 + 2 * SEV_RANK[sev]);
      place(bubble, clam.x + (evidenceShown % 2 ? -16 : 16), clam.y - 22);
      labels.append(bubble);
      puff(clam.x, clam.y - 8, 4);
      setTimeout(() => bubble.remove(), reduced ? 2500 : 4200);
      if (runCount) runCount.textContent = `${plural(evidenceShown, 'thing')} observed so far.`;
      await wait(900);
    }
    if (runCount && !evidenceShown) runCount.textContent = 'Nothing observed yet.';
    pumping = false;
  }

  function finalButtons() {
    const row = el(doc, 'div', 'os-final');
    const open = el(doc, 'a', 'os-btn os-primary', 'Open the full report ▶');
    open.href = reportUrl;
    const back = el(doc, 'button', 'os-btn', 'Back to the surface');
    back.type = 'button';
    back.addEventListener('click', () => close(true));
    append(row, open, back);
    return row;
  }

  // ---- step control -----------------------------------------------------------------------------------------------
  let index = -1;
  let playing = false;
  async function play(at) {
    index = at;
    playing = true;
    pips.querySelectorAll('.os-pip').forEach((pip, i) => { pip.dataset.state = i < at ? 'done' : i === at ? 'now' : 'todo'; });
    sync();
    try { await beats[STEPS[at].key](); } catch (error) { if (!closed) console.error(`Ocean show step failed: ${error?.message ?? error}`); }
    playing = false;
    sync();
  }

  function sync() {
    if (closed) return;
    const last = index >= STEPS.length - 1;
    const ahead = STEPS[index + 1];
    const ok = !last && !playing && ahead.ready(state);
    next.hidden = last;
    next.disabled = !ok;
    status.textContent = last || ok ? '' : playing ? '' : state.failed && !state.verdict ? 'The job failed.' : 'Waiting for the sandbox…';
    if (state.failed && !state.verdict && !playing && !text.querySelector('.os-final')) text.append(finalButtons());
    if (ok && (doc.activeElement === doc.body || !doc.activeElement)) next.focus({ preventScroll: true });
  }
  next.addEventListener('click', () => { if (!next.disabled) play(index + 1); });
  const onKey = event => { if (event.key === 'ArrowRight' && !event.target.closest?.('input, textarea') && !next.disabled && !next.hidden) { event.preventDefault(); play(index + 1); } };
  doc.addEventListener('keydown', onKey);

  // ---- events -----------------------------------------------------------------------------------------------------
  function handle(event) {
    if (closed || !applyEvent(state, event)) return;
    if (event.event === 'evidence' && index === 2) pumpEvidence();
    sync();
  }
  const source = createNetworkSource({ jobId, token });
  source.stream(handle, controller.signal, () => state.finished || state.failed, () => state.lastEventId).catch(() => {
    if (closed || controller.signal.aborted) return;
    if (state.typed) { status.textContent = 'Lost the connection. Open the full report to continue.'; return; }
    close(false);
    onFail?.();
  });

  // ---- open and close -------------------------------------------------------------------------------------------
  function close(toSurface) {
    if (closed) return;
    closed = true;
    controller.abort();
    win.cancelAnimationFrame(raf);
    doc.removeEventListener('keydown', onKey);
    win.removeEventListener('pointermove', onPointer);
    doc.documentElement.removeEventListener('pointerleave', onLeave);
    win.removeEventListener('resize', resize);
    root.remove();
    doc.documentElement.classList.remove('os-on');
    lenis?.start?.();
    win.__menuOctopus?.show?.();
    if (toSurface) lenis ? lenis.scrollTo(0, { duration: reduced ? 0 : 2.4, immediate: reduced, force: true }) : win.scrollTo(0, 0);
    onClose?.();
  }

  doc.body.append(root);
  doc.documentElement.classList.add('os-on');
  lenis?.stop?.();
  resize();
  win.addEventListener('resize', resize);
  raf = win.requestAnimationFrame(frame);
  play(0);
  return { close: () => close(false) };
}
