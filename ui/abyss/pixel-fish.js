// Stand-in fish art for a species without a swim sheet: one 13 x 7 pixel fish,
// coloured by a hue taken from the species name. The main menu (fish schools) and the Bestiary both draw it.
(() => {
  'use strict';
  const ROWS = ['.............', '.o.....oooo..', 'oto..oobbbbo.', 'ottoossswsseo', 'oto..ossssso.', '.o....ooooo..', '.............'];
  const hue = (species) => [...species].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);

  function canvas(species) {
    const h = hue(species);
    const palette = { o: `hsl(${h} 45% 18%)`, b: `hsl(${h} 55% 52%)`, s: `hsl(${h} 45% 80%)`, w: '#ffffff', e: '#06182a', t: `hsl(${h} 60% 38%)` };
    const cv = document.createElement('canvas');
    cv.width = ROWS[0].length;
    cv.height = ROWS.length;
    const g = cv.getContext('2d');
    ROWS.forEach((row, y) => [...row].forEach((ch, x) => { if (palette[ch]) { g.fillStyle = palette[ch]; g.fillRect(x, y, 1, 1); } }));
    return cv;
  }

  window.PixelFish = { canvas };
})();
