// Derives ui/abyss/assets/index-retro.js from the packaged renderer bundle (left untouched) with two sets of hooks.
// Sprite hooks (ui/abyss/retro-pixel.js): draw billboarded pixel-art sprites in place of the 3D creature meshes and
// the 3D schooling fish. Menu hooks (ui/abyss/detonation-menu.js): feed the renderer the shared ocean from
// GET /api/ocean instead of its 50 historical attacks, label the dive with the five harm tiers, and send a click to
// the Bestiary. Each replacement must match exactly once, so a repackaged renderer fails loudly instead of silently.
// Usage: node tools/patch-abyss-sprites.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../ui/abyss/assets');
const source = join(dir, 'index-D8CplD1t.js');
const target = join(dir, 'index-retro.js');

const hooks = [
  // 1. Hand the renderer's own three.js classes to the theme (module scope, before the first creature is built).
  ['function UO(e){let t=qD(e.c);',
    'window.__retro?.init?.({Sprite:ci,SpriteMaterial:Jr,ShaderMaterial:cs,Texture:Zt,InstancedMesh:$i,PlaneGeometry:Xo,MeshBasicMaterial:hi});function UO(e){let t=qD(e.c);'],
  // 2. Every frame, for every creature: swap its 3D meshes for its sprite.
  ['e.c.group.visible=e.out<.985,',
    'e.c.group.visible=e.out<.985,window.__retro?.creature?.(e,$,n),'],
  // 3. After the schooling-fish instance matrices are written: mirror them as billboards and hide the 3D fish.
  ['fk.geometry.attributes.position.needsUpdate=!0}function bk(e){',
    'fk.geometry.attributes.position.needsUpdate=!0,window.__retro?.flock?.(uk,$)}function bk(e){'],

  // 4. The creature list: the shared ocean (plus ghosts that keep the camera framing), not the 50 attacks.
  ['var $C=JSON.parse(', 'var $C=await window.__menu.creatures(),__legacy=JSON.parse('],
  // 5. Creature size grows with what it has eaten.
  ['sizeMul:mO*(', 'sizeMul:(e.sizeMul??1)*mO*('],
  // 6. Tier names and meanings replace the user-action ladder.
  ['var rO={1:', 'var rO=window.__menu.meaning,__ladder={1:'],
  [',aO={5:{y:', ',iO=window.__menu.tiers,aO={5:{y:'],
  // 7. Gauge labels: tier name, depth and meaning at the middle of the band (fixed, so an empty ocean still has a gauge).
  ['n=t.reduce((e,t)=>e+t.base.y,0)/t.length,r=Zk(`li`,null,`SEV${e}`)',
    'n=(aO[e===1?`up`:e].y[0]+aO[e===1?`up`:e].y[1])/2,r=window.__menu.gaugeItem(e)'],
  // 8. Zone cards, legend text and ending are written from the tiers once the renderer has built them.
  ['var tA=document.querySelector(`.forms`)', 'window.__menu.zones();var tA=document.querySelector(`.forms`)'],
  // 9. Sections hidden by the menu (production) leave the dive.
  ['Sk=[...document.querySelectorAll(`.stage`)]', 'Sk=[...document.querySelectorAll(`.stage:not([hidden])`)]'],
  // 10. Ghosts are never listed or pickable.
  ['p=[...a].sort((e,t)=>e.a.year-t.a.year)', 'p=[...a].filter(e=>!e.a.ghost).sort((e,t)=>e.a.year-t.a.year)'],
  ['let t=xO(e).sort((e,t)=>e.a.year-t.a.year||e.a.name.localeCompare(t.a.name))', 'let t=xO(e).filter(e=>!e.a.ghost).sort((e,t)=>e.a.year-t.a.year||e.a.name.localeCompare(t.a.name))'],
  ['let n=yO.filter(t=>t.a.vector===e);if(!n.length)continue;', 'let n=yO.filter(t=>t.a.vector===e&&!t.a.ghost);if(!n.length)continue;'],
  ['let t=xO(e).length,n=Zk(`li`,`vec`)', 'let t=xO(e).filter(e=>!e.a.ghost).length,n=Zk(`li`,`vec`)'],
  ['for(let s of yO){if(!s.live||', 'for(let s of yO){if(s.a.ghost||!s.live||'],
  // 11. Lists show how much a creature has eaten where they showed a year.
  ['Zk(`span`,`nb-year mono`,String(e.a.year))', 'Zk(`span`,`nb-year mono`,window.__menu.badge(e.a))'],
  ['Zk(`span`,`row-year mono`,String(e.a.year))', 'Zk(`span`,`row-year mono`,window.__menu.badge(e.a))'],
  // 12. Click (canvas, list or panel) opens the Bestiary card instead of the attack demo.
  ['function bA(e,t=document.activeElement){let n=e.a;', 'function bA(e,t=document.activeElement){if(window.__menu.open(e.a))return;let n=e.a;'],
  ['fA=t,hA?.enter(t,document.activeElement)});', 'fA=t,window.__menu.open(t.a)||hA?.enter(t,document.activeElement)});'],
  // 13. Hover tag: name, what it means, how many files it has eaten.
  ['uA.textContent=`${e.a.year} · SEV${e.sev} · ${rO[e.sev]}`,dA.textContent=pA===e?e.name:`${e.name} · ${gA?`tap`:`click`} to enter the attack demo`',
    'uA.textContent=window.__menu.meta(e.a),dA.textContent=window.__menu.hint()'],
  // 14. Wording.
  ['Scroll to dive. Tap a creature to enter its attack demo. Use the list for historical details.', 'Scroll to dive. Tap a creature to open its Bestiary card.'],
  ['Underwater attack timeline. Use the attack list for keyboard selection.', 'Underwater ocean of file results. The Bestiary page lists every creature.'],
  ['SEV1 “Nothing”', 'the Trench'],
  // 15. Creatures keep clear of the Drop a file panel as they do of the hero text.
  ['.hero .eyebrow, .hero h1 .l, .premise, .hint`', '.hero .eyebrow, .hero h1 .l, .premise, .hero .drop, .hint`'],
];

let text = readFileSync(source, 'utf8');
for (const [from, to] of hooks) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one match, found ${count}: ${from.slice(0, 60)}`);
  text = text.replace(from, () => to);
}
// Remaining SEV labels (list rows, aria labels) become tier names.
text = text.replace(/SEV\$\{([^}]+)\}/g, (_, sev) => `\${window.__menu.tier(${sev}).name}`);
writeFileSync(target, text);
console.log(`wrote ${target} (${text.length} bytes)`);
