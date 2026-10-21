// The ocean column of the job view: your fish inside the giant clam, the depth gauge, finding creatures that bite
// and eat, the camera-bite overlay and the receipt card. Pure presentation: main.mjs decides when each step plays.
// With reduced motion the scene only changes state (data attributes); creatures and the overlay are never created.
import { append, el } from './dom.mjs';
import { DEPTHS, DEPTH_INFO } from './state.mjs';
import { fishSprite, spriteFacesRight } from './creatures.mjs';
import { createFish, drawSilhouette } from './pixel.mjs';

const POD_Y = { sunlight: 0.1, twilight: 0.3, midnight: 0.5, abyss: 0.7, trench: 0.9 };

export function createScene(root, { doc, reduced, sleep }) {
  root.dataset.clam = 'open';
  root.dataset.ready = 'false';
  root.dataset.bites = '0';
  root.style.setProperty('--pod-y', '0');

  const water = el(doc, 'div', 'jv-water');
  const gauge = el(doc, 'div', 'jv-gauge');
  gauge.setAttribute('aria-label', 'Depth gauge');
  for (const depth of DEPTHS) {
    const info = DEPTH_INFO[depth];
    const zone = el(doc, 'div', 'jv-zone');
    zone.dataset.depth = depth;
    append(zone, el(doc, 'b', '', info.name), el(doc, 'span', '', `${info.range} · ${info.meaning}`));
    gauge.append(zone);
  }
  const dot = el(doc, 'i', 'jv-gauge-dot');
  const readout = el(doc, 'p', 'jv-readout', 'Surface · 0 m');
  readout.setAttribute('aria-live', 'polite');
  append(gauge, dot, readout);

  const pocket = el(doc, 'div', 'jv-pocket');
  const tag = el(doc, 'div', 'jv-fish-tag');
  const tagName = el(doc, 'b', '', 'Your file');
  const tagType = el(doc, 'span', 'jv-tag-type');
  const tagPath = el(doc, 'span', 'jv-tag-path');
  append(tag, tagName, tagType, tagPath);
  const clam = el(doc, 'div', 'jv-clam');
clam.dataset.pixelBg = '/ui/abyss/pixel/creatures/giant-clam-spritesheet.png'; // giant-clam sheet: open on frame 0, closing to frame 7 (job.css)
  const pod = el(doc, 'div', 'jv-pod');
  append(pod, clam, pocket, tag);

  const caption = el(doc, 'p', 'jv-caption');
  caption.setAttribute('role', 'status');
  append(root, water, gauge, pod, caption);

  let fish = null;
  let receiptCard = null;
  let creature = null;

  function say(text) { caption.textContent = text; }

  function spawn(facts) {
    creature?.remove();
    creature = el(doc, 'div', 'jv-creature');
    creature.dataset.phase = 'far';
    creature.dataset.finding = facts.id;
    if (facts.sprite) {
      creature.dataset.pixelBg = facts.sprite;
      if (spriteFacesRight(facts.sprite)) creature.classList.add('flip');
    } else {
      const silhouette = drawSilhouette(doc);
      silhouette.className = 'jv-silhouette';
      creature.append(silhouette);
    }
    creature.append(el(doc, 'span', 'jv-creature-name', facts.creature));
    pod.append(creature);
    void creature.offsetWidth; // commit the starting position so the move to "near" animates
    return creature;
  }

  async function phase(node, name, ms) {
    node.dataset.phase = name;
    await sleep(ms);
  }

  return {
    // The fish appears at the surface once its type is known.
    setFish(typed, pathLine) {
      if (!typed) return;
      if (root.dataset.ready !== 'true') {
        const sprite = fishSprite(typed.species);
        fish = createFish(doc, typed.species, sprite, !reduced);
        fish.canvas.className = sprite ? 'jv-fish jv-swim' : 'jv-fish';
        fish.canvas.setAttribute('role', 'img');
        fish.canvas.setAttribute('aria-label', 'Your file, shown as a fish');
        pocket.append(fish.canvas);
        root.dataset.ready = 'true';
        root.dataset.species = String(typed.species);
      }
      const mismatch = typed.mismatch ? ` · extension .${typed.claimedExtension} does not match` : '';
      tagType.textContent = `${typed.detectedType} file${mismatch}`;
      tagPath.textContent = pathLine;
    },

    closeClam() { if (root.dataset.clam === 'open') root.dataset.clam = 'closed'; },

    setDepth(depth, metres) {
      root.style.setProperty('--pod-y', String(depth ? POD_Y[depth] : 0));
      root.dataset.depth = depth ?? 'surface';
      readout.textContent = depth ? `${DEPTH_INFO[depth].name} · ${metres.toLocaleString('en-US')} m` : 'Surface · 0 m';
    },

    async bite(facts, count) {
      if (reduced || !fish || root.dataset.eatenBy) return;
      const node = spawn(facts);
      say(`${facts.creature} rises: ${facts.label}`);
      await phase(node, 'near', 700);
      root.dataset.bites = String(count);
      fish.bite(count);
      await phase(node, 'bite', 350);
      await phase(node, 'far', 500);
      node.remove();
      creature = null;
      say(`${facts.creature} took a bite of your file.`);
    },

    async eat(facts) {
      if (reduced || !fish || root.dataset.eatenBy) return;
      const node = spawn(facts);
      say(`${facts.creature} rises: ${facts.label}`);
      await phase(node, 'near', 800);
      await phase(node, 'eat', 600);
      fish.clear();
      root.dataset.eatenBy = facts.id;
      say(`${facts.creature} ate your file.`);
      await sleep(600);
    },

    // The creature swallows the camera (visual only), then the caller moves to the desktop replay.
    async cameraBite(facts) {
      if (reduced) return;
      const overlay = el(doc, 'div', 'jv-bite');
      overlay.id = 'jv-bite';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.dataset.depth = root.dataset.depth ?? 'surface';
      const camera = el(doc, 'div', 'jv-bite-camera');
      append(camera, el(doc, 'span', 'jv-bite-lens'), el(doc, 'span', 'jv-bite-label', 'SIMULATED VIEW · visual prop, no webcam'));
      const ring = el(doc, 'span', 'jv-bite-ring');
      const sprite = el(doc, 'div', 'jv-bite-creature');
      if (facts.sprite) {
        sprite.dataset.pixelBg = facts.sprite;
        if (spriteFacesRight(facts.sprite)) sprite.classList.add('flip');
      }
      append(overlay, camera, ring, sprite);
      doc.body.append(overlay);
      overlay.dataset.active = 'true';
      await sleep(3200);
      overlay.remove();
      creature?.remove();
      creature = null;
    },

    // Teardown: the clam shuts and sinks.
    async sinkClam() {
      if (root.dataset.clam === 'sunk') return;
      root.dataset.clam = 'shut';
      await sleep(600);
      root.dataset.clam = 'sunk';
      await sleep(1000);
    },

    showReceipt(view) {
      receiptCard?.remove();
      receiptCard = el(doc, 'section', 'jv-receipt');
      receiptCard.id = 'jv-receipt';
      receiptCard.dataset.ok = String(view.ok);
      const lines = el(doc, 'ul', 'jv-receipt-lines');
      for (const line of view.lines) lines.append(el(doc, 'li', '', line));
      append(receiptCard, el(doc, 'h3', '', view.headline), lines);
      root.append(receiptCard);
      void receiptCard.offsetWidth;
      receiptCard.dataset.shown = 'true';
    },
  };
}
