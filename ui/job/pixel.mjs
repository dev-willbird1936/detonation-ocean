// Code-drawn pixel art for the fish and creatures without a sprite sheet (design §5–6 fallbacks), and the swim-cycle fish canvas.
// One canvas pixel is one art pixel; CSS scales the canvas by whole multiples of --u with nearest-neighbour edges.

export const FISH_W = 24;
export const FISH_H = 12;

// Body shapes, nose to the right: o outline, b body, s belly, f fin, e eye, . empty.
const SHAPES = [
  [ // slim
    '........................',
    '........................',
    '..f.......oooooooo......',
    '.ff.....oobbbbbbbboo....',
    'fff...oobbbbbbbbbbbbo...',
    'ffooobbbbbbbbbbbbbbebo..',
    'ffooobssssssssssssssso..',
    'fff...oosssssssssssso...',
    '.ff.....oossssssssoo....',
    '..f.......oooooooo......',
    '........................',
    '........................',
  ],
  [ // round
    '........................',
    '.........ooooooo........',
    '......ooobbbbbbboo......',
    '..f..obbbbbbbbbbbbo.....',
    '.ff.obbbbbbbbbbbbbbo....',
    'ffooobbbbbbbbbbbbbebo...',
    'ffooobbssssssssssbbbo...',
    '.ff.obssssssssssssso....',
    '..f..osssssssssssso.....',
    '......oooosssssooo......',
    '.........ooooooo........',
    '........................',
  ],
  [ // long
    '........................',
    '........................',
    '........................',
    '.f....ooooooooooooo.....',
    'ff..oobbbbbbbbbbbbboo...',
    'fffoobbbbbbbbbbbbbbbbeo.',
    'fffoobssssssssssssssoo..',
    'ff..ooosssssssssssooo...',
    '.f....ooooooooooooo.....',
    '........................',
    '........................',
    '........................',
  ],
];

const PALETTES = [
  { o: '#17445e', b: '#7fc0d4', s: '#d6f4f2', f: '#9fd6e0', e: '#06182a' },
  { o: '#5b2f1c', b: '#f08a63', s: '#fbe3cf', f: '#f4d06a', e: '#06182a' },
  { o: '#1d3f2b', b: '#6fcf8a', s: '#e1f7d8', f: '#b8f0a0', e: '#06182a' },
  { o: '#3b2760', b: '#a98be0', s: '#ece0ff', f: '#d2bfff', e: '#06182a' },
  { o: '#5a4a12', b: '#f4d06a', s: '#fff3c4', f: '#f08a63', e: '#06182a' },
  { o: '#2c2c3c', b: '#8e9cb4', s: '#dfe6f2', f: '#b5c1d6', e: '#06182a' },
];

// Stable hash of the species name only (never of file content).
const hashName = name => [...String(name)].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);

function paint(canvas, rows, palette, width, height) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (palette[key]) { context.fillStyle = palette[key]; context.fillRect(x, y, 1, 1); }
  }));
  return canvas;
}

export function drawFish(doc, species) {
  const seed = hashName(species);
  return paint(doc.createElement('canvas'), SHAPES[seed % SHAPES.length], PALETTES[Math.floor(seed / 7) % PALETTES.length], FISH_W, FISH_H);
}

// Bite marks: square notches cleared from the fish, one more per bite. `count` of 0 restores nothing (call before painting).
const NOTCHES = [[16, 1, 5, 4], [3, 6, 5, 5], [10, 8, 5, 4], [8, 1, 5, 4], [18, 7, 5, 5], [12, 4, 5, 4]];

export function biteFish(canvas, count) {
  const context = canvas.getContext('2d');
  for (const [x, y, w, h] of NOTCHES.slice(0, count)) context.clearRect(x, y, w, h);
}

export function clearFish(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

const SWIM_SIZE = 64;
const SWIM_FRAMES = 14;
const SWIM_FRAME_MS = 150;

// The fish as { canvas, bite(count), clear() }. With a sprite URL the canvas plays the swim sheet (14 frames of 64 px, head
// left) and re-cuts the bite notches on every frame; without `animate` it stays on frame 0. No URL: the code-drawn fish.
export function createFish(doc, species, spriteUrl, animate) {
  if (!spriteUrl) {
    const canvas = drawFish(doc, species);
    return { canvas, bite: count => biteFish(canvas, count), clear: () => clearFish(canvas) };
  }
  const canvas = doc.createElement('canvas');
  canvas.width = SWIM_SIZE;
  canvas.height = SWIM_SIZE;
  const context = canvas.getContext('2d');
  let lit = null; // the lit swim sheet (pixel-lit.js), once it has loaded
  let alive = true;
  const scale = SWIM_SIZE / FISH_W;
  const top = (SWIM_SIZE - FISH_H * scale) / 2;
  let frame = 0;
  let bites = 0;
  let timer = 0;
  const paintFrame = () => {
    context.clearRect(0, 0, SWIM_SIZE, SWIM_SIZE);
    if (!lit) return;
    context.drawImage(lit, frame * SWIM_SIZE, 0, SWIM_SIZE, SWIM_SIZE, 0, 0, SWIM_SIZE, SWIM_SIZE);
    for (const [x, y, w, h] of NOTCHES.slice(0, bites)) context.clearRect(x * scale, top + y * scale, w * scale, h * scale);
  };
  window.PixelLit.image(spriteUrl).then((sheet) => { if (alive) { lit = sheet; paintFrame(); } }, () => {});
  if (animate) timer = setInterval(() => { frame = (frame + 1) % SWIM_FRAMES; paintFrame(); }, SWIM_FRAME_MS);
  return {
    canvas,
    bite(count) { bites = count; paintFrame(); },
    clear() { alive = false; clearInterval(timer); context.clearRect(0, 0, SWIM_SIZE, SWIM_SIZE); },
  };
}

// A grey pixel blob for a creature whose sprite sheet is not drawn yet.
export function drawSilhouette(doc) {
  const rows = [
    '................', '....oooooooo....', '..oobbbbbbbboo..', '.obbbbbbbbbbbbo.', 'obbbwbbbbbbwbbbo', 'obbbbbbbbbbbbbbo',
    'obbbbbooooobbbbo', '.obbbboooobbbbo.', '..obobobobobbo..', '..o.o.o.o.o.o...', '................', '................',
  ];
  return paint(doc.createElement('canvas'), rows, { o: '#030a14', b: '#3c8aa0', w: '#effcf8' }, 16, 12);
}
