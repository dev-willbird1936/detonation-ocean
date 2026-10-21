// The agent octopus floating beside the upload panel on the surface screen. While a file is dragged over the page it
// stretches ONE arm toward it (the pose for that direction from octopus-poses.json; the right side is the left pose
// mirrored) and drifts so the arm tip meets the file, as if taking it. Decoration only: aria-hidden, no pointer events.
// window.__menuOctopus lets the ocean show start its octopus from this one and hide it.
(() => {
  'use strict';
  const form = document.getElementById('upload');
  if (!form) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'menu-octopus';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const g = canvas.getContext('2d');

  const CELL = 128, ART = 48; // the 128 px pose cell drawn 48 art pixels wide: 3/4 of the ocean show's octopus, so it clears the HUD
  const poses = {};
  // prev/prevFlip/fade: the last pose cross-fades out over FADE ms, so the arm grows instead of popping.
  const FADE = 220;
  const state = { prev: null, prevFlip: false, changed: 0, pose: 'idle', flip: false, x: 0, y: 0, dx: 0, dy: 0, tx: 0, ty: 0, drag: null, hidden: false, lastDrag: 0 };
  let P = 4;

  // Direction from the octopus to the file -> [pose direction, mirrored]. Screen angles, y down.
  const SECTORS = [['left', false], ['upleft', false], ['up', false], ['upleft', true], ['left', true], ['downleft', true], ['down', false], ['downleft', false]];
  const tipOf = (pose) => poses[pose]?.anchors?.tip;
  const reach = (pose) => { const t = tipOf(pose); return t ? Math.hypot(t[0] - 64, t[1] - 58) : 0; };

  function home() {
    const r = form.getBoundingClientRect();
    const size = ART * P;
    // To the right of the panel when there is room, otherwise above it.
    const right = r.right + size * 0.55;
    return right + size / 2 < innerWidth - 8 ? { x: right, y: r.top + r.height * 0.28 } : { x: r.left + r.width * 0.8, y: r.top - size * 0.42 };
  }

  function pick(px, py) {
    const a = Math.atan2(py - state.y, px - state.x); // -pi..pi, 0 = right
    const i = (Math.round(((a + Math.PI) / (Math.PI * 2)) * 8) % 8 + 8) % 8; // 0 = left, going clockwise via up
    const [dir, flip] = SECTORS[i];
    const pair = [`reach1-${dir}-mid`, `reach1-${dir}-far`].filter((p) => poses[p]).sort((m, n) => reach(m) - reach(n));
    if (!pair.length) return { pose: 'idle', flip: false };
    const dist = Math.hypot(px - state.x, py - state.y) / P * (CELL / ART);
    return { pose: dist < (reach(pair[0]) + (reach(pair[1] ?? pair[0]))) / 2 ? pair[0] : pair[pair.length - 1], flip };
  }

  function frame(t) {
    requestAnimationFrame(frame);
    const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 4;
    P = Math.max(3, Math.round(1.5 * u));
    const size = ART * P;
    if (canvas.width !== size) { canvas.width = canvas.height = size; canvas.style.width = canvas.style.height = `${size}px`; }
    const base = home();
    const dragging = state.drag && t - state.lastDrag < 250;
    if (!dragging) state.drag = null;
    if (dragging) {
      const next = pick(state.drag.x, state.drag.y);
      setPose(next.pose, next.flip, t);
      // Drift (at most 70 px) so the arm tip lands on the file.
      const tip = tipOf(state.pose);
      if (tip) {
        const off = { x: ((state.flip ? CELL - tip[0] : tip[0]) / CELL - 0.5) * size, y: (tip[1] / CELL - 0.5) * size };
        const want = { x: state.drag.x - off.x - base.x, y: state.drag.y - off.y - base.y };
        const k = Math.min(1, 70 / Math.max(1, Math.hypot(want.x, want.y)));
        state.tx = want.x * k; state.ty = want.y * k;
      }
    } else {
      setPose('idle', false, t); state.tx = 0; state.ty = Math.sin(t * 0.0012) * 6;
    }
    const ease = reduced ? 1 : 0.12;
    state.dx += (state.tx - state.dx) * ease; state.dy += (state.ty - state.dy) * ease;
    state.x = base.x + state.dx; state.y = base.y + state.dy;
    // Only on the surface screen, and never while the ocean show runs (it has its own octopus).
    const visible = !state.hidden && !document.documentElement.classList.contains('os-on') && scrollY < innerHeight * 0.6;
    canvas.style.opacity = visible ? String(Math.max(0, 1 - scrollY / (innerHeight * 0.6))) : '0';
    canvas.style.transform = `translate(${Math.round(state.x - size / 2)}px, ${Math.round(state.y - size / 2)}px)`;
    g.clearRect(0, 0, size, size);
    if (!poses.idle?.img || !visible) return;
    g.imageSmoothingEnabled = false;
    // Two-phase blend: the new pose fades in over the old one, then the old fades out, so the body never thins.
    const k = reduced ? 1 : Math.min(1, (t - state.changed) / FADE);
    const tick = (Math.floor(t / 150) % 14) * CELL;
    const draw = (pose, flip, alpha) => {
      const sheet = poses[pose]?.img ?? poses.idle.img;
      g.save();
      g.globalAlpha = alpha;
      if (flip) { g.translate(size, 0); g.scale(-1, 1); }
      g.drawImage(sheet, tick, 0, CELL, CELL, 0, 0, size, size);
      g.restore();
    };
    if (state.prev && k < 1) {
      if (k < 0.5) { draw(state.prev, state.prevFlip, 1); draw(state.pose, state.flip, k * 2); }
      else { draw(state.pose, state.flip, 1); draw(state.prev, state.prevFlip, (1 - k) * 2); }
    } else draw(state.pose, state.flip, 1);
  }

  function setPose(pose, flip, t) {
    if (pose === state.pose && flip === state.flip) return;
    state.prev = state.pose; state.prevFlip = state.flip; state.changed = t;
    state.pose = pose; state.flip = flip;
  }

  const onDrag = (event) => { state.drag = { x: event.clientX, y: event.clientY }; state.lastDrag = performance.now(); };
  addEventListener('dragover', onDrag);
  addEventListener('dragenter', onDrag);
  addEventListener('drop', () => { state.lastDrag = 0; });
  addEventListener('dragend', () => { state.lastDrag = 0; });
  form.addEventListener('submit', () => { state.lastDrag = 0; });

  fetch('/ui/abyss/pixel/creatures/octopus-poses.json', { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)).then((index) => {
    const wanted = Object.entries(index?.poses ?? {}).filter(([name]) => name === 'idle' || name.startsWith('reach1-'));
    for (const [name, entry] of wanted) {
      window.PixelLit.image(entry.sheet).then((img) => { poses[name] = { img, anchors: entry.anchors ?? {} }; }, () => {});
    }
  }).catch(() => {});
  requestAnimationFrame(frame);

  window.__menuOctopus = {
    at: () => (state.hidden ? null : { x: state.x, y: state.y }),
    hide: () => { state.hidden = true; },
    show: () => { state.hidden = false; },
  };
})();
