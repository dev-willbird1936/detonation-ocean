// Lit pixel sprites. Every pixel sprite is drawn with its normal map from ui/abyss/pixel/normals/ (same path; made by
// tools/build-pixel-normals.py). One light serves both views: the renderer lights sprites per frame with LIT_FRAG
// (retro-pixel.js), and the DOM and canvas views get a baked copy from bake(), which runs the same model on the CPU.
// Keep bake() and LIT_FRAG in step. Normal maps are data: they are never colour-converted.
(() => {
  'use strict';
  const LIGHT = [-0.45, 0.6, 0.66]; // upper left, in front: x right, y up, z towards the viewer
  const len = Math.hypot(...LIGHT);
  const UNIT_LIGHT = LIGHT.map((v) => v / len);

  // Billboard vertex shader for the renderer's sprites: the placement three.js uses for a Sprite.
  const VERT = `varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
}`;
  // uUv = (scale.x, offset.x, scale.y, offset.y): one frame of a sheet; a negative scale.x mirrors it.
  const LIT_FRAG = `varying vec2 vUv;
uniform sampler2D map;
uniform sampler2D normalMap;
uniform vec4 uUv;
uniform vec3 uLight;
uniform vec3 uTint;
uniform float uOpacity;
void main() {
  vec2 uv = vec2(vUv.x * uUv.x + uUv.y, vUv.y * uUv.z + uUv.w);
  vec4 c = texture2D(map, uv);
  if (c.a < 0.5) discard;
  vec3 m = texture2D(normalMap, uv).rgb * 2.0 - 1.0;
  vec3 n = normalize(vec3(m.x * sign(uUv.x), m.y, m.z));
  float lambert = max(dot(n, uLight), 0.0);
  gl_FragColor = vec4(c.rgb * uTint * (0.28 + 1.35 * lambert), uOpacity);
}`;

  // Frame `frame` of a sheet of `frames` cells, mirrored when the sprite faces the other way.
  const uvFor = (frame = 0, frames = 1, mirror = false) => (mirror ? [-1 / frames, (frame + 1) / frames, 1, 0] : [1 / frames, frame / frames, 1, 0]);

  const normalUrl = (url) => url.replace(/(^|\/)ui\/abyss\/pixel\//, (_, lead) => `${lead}ui/abyss/pixel/normals/`);

  const loadImage = (src) => new Promise((done, fail) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => fail(new Error(`cannot load ${src}`));
    img.src = src;
  });
  const toCanvas = (source) => {
    const cv = document.createElement('canvas');
    cv.width = source.naturalWidth ?? source.width;
    cv.height = source.naturalHeight ?? source.height;
    cv.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0);
    return cv;
  };

  // Height from the silhouette, as a rounded bevel: for a sprite that has no normal map of its own (the code-drawn stand-ins).
  function normalFromAlpha(cv) {
    const { width: w, height: h } = cv;
    const a = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const H = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[(y * w + x) * 4 + 3] / 255);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const og = out.getContext('2d', { willReadFrequently: true }), img = og.createImageData(w, h), o = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const nx = -(H(x + 1, y) - H(x - 1, y)) * 2, ny = (H(x, y + 1) - H(x, y - 1)) * 2;
      const l = Math.hypot(nx, ny, 1);
      o[i] = ((nx / l) * 0.5 + 0.5) * 255; o[i + 1] = ((ny / l) * 0.5 + 0.5) * 255; o[i + 2] = ((1 / l) * 0.5 + 0.5) * 255; o[i + 3] = a[i + 3];
    }
    og.putImageData(img, 0, 0);
    return out;
  }

  // Colour and normal map for a pixel sprite, as images or canvases (three.js takes either). A missing normal map is
  // derived from the silhouette and reported, so a new sprite without one still renders lit.
  const pairs = new Map();
  function pair(url) {
    if (!pairs.has(url)) pairs.set(url, (async () => {
      const color = await loadImage(url);
      const normal = await loadImage(normalUrl(url)).catch(() => {
        console.warn(`pixel-lit: no normal map for ${url}; deriving one from its silhouette`);
        return null;
      });
      return { color, normal: normal ?? normalFromAlpha(toCanvas(color)) };
    })());
    return pairs.get(url);
  }

  // The same model as LIT_FRAG, once, over a whole image (frame 0 of 1, not mirrored), with pixels below half alpha dropped.
  function bake(colorCv, normalCv) {
    const { width: w, height: h } = colorCv;
    const c = colorCv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const n = normalCv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const og = out.getContext('2d', { willReadFrequently: true }), img = og.createImageData(w, h), o = img.data;
    const [lx, ly, lz] = UNIT_LIGHT;
    for (let i = 0; i < c.length; i += 4) {
      if (c[i + 3] < 127.5) continue;
      const mx = n[i] / 127.5 - 1, my = n[i + 1] / 127.5 - 1, mz = n[i + 2] / 127.5 - 1;
      const l = Math.hypot(mx, my, mz) || 1;
      const lambert = Math.max(((mx / l) * lx + (my / l) * ly + (mz / l) * lz), 0);
      const k = 0.28 + 1.35 * lambert;
      o[i] = Math.min(255, c[i] * k); o[i + 1] = Math.min(255, c[i + 1] * k); o[i + 2] = Math.min(255, c[i + 2] * k); o[i + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    return out;
  }

  // Lit copy of a pixel sprite (whole sheet, all frames), cached per URL.
  const baked = new Map();
  function image(url) {
    if (!baked.has(url)) baked.set(url, pair(url).then(({ color, normal }) => bake(toCanvas(color), toCanvas(normal))));
    return baked.get(url);
  }

  // Lit data URL for CSS backgrounds and <img> elements.
  const dataUrls = new Map();
  function dataUrl(url) {
    if (!dataUrls.has(url)) dataUrls.set(url, image(url).then((cv) => cv.toDataURL('image/png')));
    return dataUrls.get(url);
  }

  // Elements that name a pixel sprite get its lit copy: <el data-pixel-bg="/ui/abyss/pixel/...">.
  const hydrateOne = (el) => {
    const url = el.dataset.pixelBg;
    if (!url) return;
    dataUrl(url).then((src) => { if (el.dataset.pixelBg === url) el.style.backgroundImage = `url("${src}")`; }, () => {});
  };
  const hydrate = (root = document) => {
    if (root.matches?.('[data-pixel-bg]')) hydrateOne(root);
    root.querySelectorAll?.('[data-pixel-bg]').forEach(hydrateOne);
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') hydrateOne(record.target);
      else record.addedNodes.forEach((node) => { if (node.nodeType === 1) hydrate(node); });
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pixel-bg'] });
  hydrate();

  window.PixelLit = { LIGHT: UNIT_LIGHT, VERT, LIT_FRAG, uvFor, normalUrl, pair, bake, image, dataUrl, normalFromAlpha, hydrate };
})();
