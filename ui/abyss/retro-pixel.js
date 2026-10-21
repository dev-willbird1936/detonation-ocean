// Retro pixel theme for the Abyss main menu (surface page only). Runs before the renderer bundle, so it sets
// the render scale, mirrors the scene through a small palette/dither pass and swaps the legend art. It never
// touches the renderer's logic, data, routes or events; every step degrades to a plain low-resolution canvas.
(() => {
  'use strict';
  const root = document.documentElement;
  const PixelLit = window.PixelLit; // lit pixel sprites, loaded before this script (pixel-lit.js)

  // One art pixel = this many CSS pixels. Mirrors the --u breakpoints in retro-pixel.css.
  const unit = () => (innerWidth <= 760 ? 2 : innerWidth < 1280 ? 3 : innerWidth < 2000 ? 4 : 5);

  // The renderer sizes its canvas as CSS size × min(devicePixelRatio, maxDpr). Reporting 1/unit makes the
  // WebGL buffer exactly one art pixel per `unit` CSS pixels; CSS then scales it with nearest-neighbour edges.
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 1 / unit() });

  // Keep the last rendered frame readable so the pixel pass can sample it outside the renderer's own frame.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (this.id === 'gl' && /^webgl/.test(type)) attrs = { ...attrs, preserveDrawingBuffer: true };
    return getContext.call(this, type, attrs);
  };

  // Legend cards ask for rendered 3D thumbnails; serve the matching lit pixel sprites instead, and fall back to the
  // original thumbnail if a sprite is ever missing.
  const legend = /^\/ui\/abyss\/textures\/abyss\/legend\/([a-z-]+)\.png$/;
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...srcDesc,
    set(value) {
      let path = String(value);
      try { path = new URL(path, location.href).pathname; } catch { /* keep the raw value */ }
      const hit = legend.exec(path);
      if (!hit) return srcDesc.set.call(this, value);
      const img = this;
      PixelLit.dataUrl(`/ui/abyss/pixel/legend/${hit[1]}.png`).then((src) => srcDesc.set.call(img, src), () => srcDesc.set.call(img, value));
    },
  });

  // ---- Sprites instead of 3D animals --------------------------------------------------------------------------
  // The renderer keeps simulating every creature (position, hunt, hover, picking, entry) but its meshes are never
  // drawn: each creature gets a billboarded pixel sprite, and the schooling fish become billboarded pixel fish.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]rm\b/.test(location.search);
  const DEPTH = { 5: 'sunlight', 4: 'twilight', 3: 'midnight', 2: 'abyss', 1: 'trench' };
  const SHADE = { 5: 1, 4: 0.92, 3: 0.82, 2: 0.74, 1: 0.66 }; // single-pose sprites darken with depth
  // Ocean creatures lurk: dimmer the deeper they live, brightening when pointed at. In the Trench only their eyes show
  // (eyes-<name> sheets); pointed at, the creature's face comes forward out of the dark (front/<findingId>.png).
  const LURK = { 3: 0.78, 2: 0.58, 1: 1 };
  const TRENCH_EYES = { 'system-wipe': 'jormungandr', encrypt: 'kraken', 'destroy-files': 'leviathan', spread: 'hydra' };
  // Sheet family (14 animation frames per depth) or single pose; `face` is the way the art looks (+1 right, -1 left);
  // `k` converts body length to the sprite cell (art fills 96 of 128 px).
  const ART = {
    phishing: { sheet: 'anglerfish', face: -1, k: 1.33 }, exploit: { sheet: 'viperfish', face: -1, k: 1.33 },
    botnet: { sheet: 'siphonophore', face: -1, k: 1.33 }, theft: { sheet: 'cookiecutter', face: -1, k: 1.33 },
    'supply-chain': { sheet: 'isopod-host', face: -1, k: 1.33 }, ransomware: { sheet: 'octopus', face: 1, k: 1.33 },
    bec: { single: 'bec', face: 1, k: 1.33 }, 'card-fraud': { single: 'card-fraud', face: -1, k: 1.33 },
    espionage: { single: 'espionage', face: -1, k: 1.33 }, social: { single: 'social', face: 1, k: 1.33 },
    vulnerability: { single: 'vulnerability', face: 1, k: 1.33 }, wiper: { single: 'wiper', face: -1, k: 1.33 },
  };
  const FRAMES = 14, STEP = 150;
  let T = null; // three.js classes handed over by the patched bundle
  // Lit sprites: a sheet's colour and normal map become textures, and LIT_FRAG shades each frame (pixel-lit.js).
  const sprites = new Map();
  const load = (url, done) => {
    let hit = sprites.get(url);
    if (!hit) {
      hit = { tex: null, waiting: [] };
      PixelLit.pair(url).then((pair) => {
        hit.tex = { color: texture(pair.color), normal: texture(pair.normal) };
        hit.waiting.splice(0).forEach((f) => f());
      }, () => {});
      sprites.set(url, hit);
    }
    hit.tex ? done(hit.tex) : hit.waiting.push(() => done(hit.tex));
  };
  const texture = (source) => {
    const t = new T.Texture(source);
    t.magFilter = 1003; t.minFilter = 1003; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  const litMaterial = (uv = [1, 0, 1, 0]) => new T.ShaderMaterial({
    uniforms: { map: { value: null }, normalMap: { value: null }, uUv: { value: uv }, uLight: { value: PixelLit.LIGHT }, uTint: { value: [1, 1, 1] }, uOpacity: { value: 1 } },
    vertexShader: PixelLit.VERT, fragmentShader: PixelLit.LIT_FRAG, transparent: true, depthWrite: true, toneMapped: false,
  });
  const useTex = (material, tex) => { material.uniforms.map.value = tex.color; material.uniforms.normalMap.value = tex.normal; };

  function spriteFor(e) {
    if (e.a.school) return schoolFor(e);
    const c = e.c, art = e.a.sprite ? { face: -1, k: 1.33 } : ART[e.a.vector];
    if (!art) return null;
    // Ocean creatures name their own sprite (data/creatures.json); the legacy records pick one by family and depth.
    const eyes = e.a.kind === 'creature' && e.a.sev === 1 ? TRENCH_EYES[e.a.anchor] : null;
    const url = eyes ? `/ui/abyss/pixel/creatures/eyes-${eyes}-spritesheet.png`
      : e.a.sprite ? `/${e.a.sprite}` : art.sheet ? `/ui/abyss/pixel/creatures/${art.sheet}-${DEPTH[e.a.sev]}-spritesheet.png` : `/ui/abyss/pixel/creatures/${art.single}.png`;
    const frames = /spritesheet/.test(url) ? FRAMES : 1;
    const material = litMaterial();
    const sprite = new T.Sprite(material);
    sprite.visible = false; sprite.renderOrder = 2;
    c.group.add(sprite);
    const state = { sprite, material, art, frames, tex: null, face: null, flip: e.heading >= 0 ? 1 : -1, v: 0, last: null, phase: (e.phase || 0) * 7, ready: false };
    load(url, (tex) => { state.tex = tex; useTex(material, tex); state.ready = true; });
    if (eyes) {
      state.eyes = true;
      load(`/ui/abyss/pixel/creatures/front/${e.a.anchor}.png`, (tex) => { state.face = tex; });
    }
    return state;
  }

  const world = [0, 0, 0], here = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  function creature(e, cam, dt) {
    if (!T || !e.c) return;
    camera = cam;
    const c = e.c;
    if (c.inner) c.inner.visible = false;
    if (e.a.ghost) { e.hid = true; return; } // framing placeholder: never drawn, never picked
    let st = e.__sprite;
    if (st === undefined) {
      if (e.out >= 0.985) return;
      st = e.__sprite = spriteFor(e) || null;
    }
    if (!st) return;
    if (st.school) return school(e, st, cam, dt);
    const { sprite, material, art } = st;
    const visible = st.ready && e.out < 0.985;
    sprite.visible = visible;
    if (!visible) return;
    // Face the way the creature swims on screen (camera right vector); keep the last heading when it hovers.
    const m = cam.matrixWorld.elements, p = c.group.position;
    world[0] = p.x; world[1] = p.y; world[2] = p.z;
    if (st.last) {
      const vx = ((world[0] - st.last[0]) * m[0] + (world[1] - st.last[1]) * m[1] + (world[2] - st.last[2]) * m[2]) / Math.max(dt, 1e-3);
      st.v += (vx - st.v) * Math.min(1, dt * 4);
      if (Math.abs(st.v) > 0.03 * c.L) st.flip = st.v > 0 ? 1 : -1;
    }
    st.last = world.slice();
    const gs = c.group.scale.x || 1, w = (c.L * art.k) / gs;
    sprite.scale.set(w, w, 1);
    // Trench lurker pointed at: swap the eyes for the face coming forward (a still that faces the viewer, never flipped).
    const showFace = st.eyes && st.face && (e.hi || 0) > 0.4;
    const tex = showFace ? st.face : st.tex;
    if (material.uniforms.map.value !== tex.color) useTex(material, tex);
    const frames = showFace ? 1 : st.frames;
    const frame = frames > 1 && !still ? Math.floor(performance.now() / STEP + st.phase) % frames : 0;
    const toRight = st.eyes || st.flip * art.face * -1 > 0; // art that looks left is drawn as-is when the creature swims left
    material.uniforms.uUv.value = PixelLit.uvFor(frame, frames, !toRight);
    sprite.position.y = st.frames === 1 && !still ? Math.round(Math.sin(performance.now() / 700 + st.phase) * 3) * (c.L / 48) : 0;
    // Brightness follows the renderer's own light for this creature (torch, hover) with a readable floor.
    const lit = Math.max(0.34, Math.min(1, c.u?.uVis?.value ?? 1));
    const lurk = e.a.kind === 'creature' ? LURK[e.a.sev] ?? 1 : 1;
    const k = lit * (st.frames > 1 ? 1 : SHADE[e.a.sev]) * (lurk + (1 - lurk) * Math.min(1, e.hi || 0)) * (1 + 0.3 * (e.hi || 0));
    // Lurkers keep a floor (70% of their lurk level), so the renderer's own deep-water dimming never blacks them out.
    const level = Math.max(e.a.kind === 'creature' ? lurk * 0.7 : 0, Math.min(1.35, k * 1.12));
    material.uniforms.uTint.value = [level, level, level];
    material.uniforms.uOpacity.value = 1 - e.out;
    if (e.halo) e.halo.visible = false;
    if (e.glints) for (const g of e.glints) g.s.visible = false;
  }

  // ---- Ocean fish schools --------------------------------------------------------------------------------------
  // One anchor creature per school (GET /api/ocean). Up to 30 billboarded fish swim around it, drawn from the species'
  // swim sheet (school.art, faces left) or, without one, the stand-in from pixel-fish.js (faces right).
  const SCHOOL_FISH = 30;
  const schoolArt = new Map();
  function schoolTexture(species, sheet) {
    let art = schoolArt.get(species);
    if (art) return art;
    // A sheet arrives as a lit crop of its first frame (detonation-menu.js); a species without one gets the stand-in.
    const pic = sheet ?? { color: window.PixelFish.canvas(species) };
    art = { tex: { color: texture(pic.color), normal: texture(pic.normal ?? PixelLit.normalFromAlpha(pic.color)) }, aspect: pic.color.height / pic.color.width };
    schoolArt.set(species, art);
    return art;
  }
  function schoolFor(e) {
    const { species, count, art: sheet } = e.a.school, textures = schoolTexture(species, sheet);
    // Materials are per school: a species can have a Sunlight and a Twilight school, lit differently. Sheets face left.
    const art = { right: litMaterial(PixelLit.uvFor(0, 1, !!sheet)), left: litMaterial(PixelLit.uvFor(0, 1, !sheet)), aspect: textures.aspect };
    useTex(art.right, textures.tex); useTex(art.left, textures.tex);
    let seed = 0;
    for (const ch of species) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const n = Math.min(SCHOOL_FISH, count), radius = e.c.L * (0.55 + 0.02 * n);
    const fish = Array.from({ length: n }, () => {
      const sprite = new T.Sprite(art.right);
      sprite.renderOrder = 2;
      e.c.group.add(sprite);
      return { sprite, x: (rnd() - 0.5) * 2 * radius, y: (rnd() - 0.5) * radius, z: (rnd() - 0.5) * radius, phase: rnd() * 6.283, speed: 0.6 + rnd() * 0.6 };
    });
    e.r = Math.max(e.r, radius * 1.1); // picking and the hover tag cover the whole school
    return { school: true, art, fish, radius, flip: 1, v: 0, last: null };
  }
  function school(e, st, cam, dt) {
    const c = e.c, m = cam.matrixWorld.elements, p = c.group.position;
    if (st.last) {
      const vx = ((p.x - st.last[0]) * m[0] + (p.y - st.last[1]) * m[1] + (p.z - st.last[2]) * m[2]) / Math.max(dt, 1e-3);
      st.v += (vx - st.v) * Math.min(1, dt * 4);
      if (Math.abs(st.v) > 0.03 * c.L) st.flip = st.v > 0 ? 1 : -1;
    }
    st.last = [p.x, p.y, p.z];
    const visible = e.out < 0.985, gs = c.group.scale.x || 1, w = (c.L * 0.5) / gs, now = still ? 0 : performance.now() / 1000;
    const lit = Math.max(0.34, Math.min(1, c.u?.uVis?.value ?? 1)) * SHADE[e.a.sev] * (1 + 0.3 * (e.hi || 0));
    for (const f of st.fish) {
      const { sprite } = f;
      sprite.visible = visible;
      if (!visible) continue;
      sprite.material = st.flip > 0 ? st.art.right : st.art.left;
      const level = Math.min(1.35, lit * 1.12);
      sprite.material.uniforms.uTint.value = [level, level, level];
      sprite.material.uniforms.uOpacity.value = 1 - e.out;
      sprite.scale.set(w, w * st.art.aspect, 1);
      sprite.position.set((f.x + Math.sin(now * f.speed + f.phase) * st.radius * 0.18) / gs, (f.y + Math.sin(now * f.speed * 1.3 + f.phase) * st.radius * 0.1) / gs, f.z / gs);
    }
    if (e.halo) e.halo.visible = false;
    if (e.glints) for (const g of e.glints) g.s.visible = false;
  }

  // Tiny pixel fish for the schools: art nose points right, tail left.
  const FISH = {
    bait: { w: 13, h: 7, pal: { o: '#2c6a88', b: '#7fc0d4', s: '#d6f4f2', w: '#ffffff', e: '#17445e', t: '#9fd6e0' }, rows: [
      '.............',
      '.o.....oooo..',
      'oto..oobbbbo.',
      'ottoossswsseo',
      'oto..ossssso.',
      '.o....ooooo..',
      '.............'] },
    hatchet: { w: 12, h: 9, pal: { o: '#2a5f8c', b: '#6aa4d8', s: '#d6f4f2', w: '#ffffff', p: '#7fe8ff', e: '#17445e', t: '#8fbfe0' }, rows: [
      '............',
      '......oooo..',
      '.o...obbbbo.',
      'oto.obbsssbo',
      'ottoossswseo',
      'oto.ospspsso',
      '.o...ossssoo',
      '......oooo..',
      '............'] },
    lantern: { w: 13, h: 7, pal: { o: '#06182a', b: '#17445e', s: '#2b6f86', p: '#7fe8ff', e: '#9ff3ff', t: '#17445e' }, rows: [
      '.............',
      '.o....oooo...',
      'oto..obbbbo..',
      'ottoobspspseo',
      'oto..osssso..',
      '.o....oooo...',
      '.............'] },
  };
  FISH.deeplantern = FISH.lantern;
  const fishArt = {};
  function fishTexture(kind) {
    if (fishArt[kind]) return fishArt[kind];
    const f = FISH[kind] || FISH.bait, cv = document.createElement('canvas'), g = cv.getContext('2d');
    cv.width = f.w + 1; cv.height = f.h;
    f.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (f.pal[ch]) { g.fillStyle = f.pal[ch]; g.fillRect(x, y, 1, 1); } }));
    // Lit with the bevel of its own silhouette: a code-drawn fish has no normal map file.
    const t = new T.Texture(PixelLit.bake(cv, PixelLit.normalFromAlpha(cv)));
    t.magFilter = 1003; t.minFilter = 1003; t.generateMipmaps = false; t.colorSpace = 'srgb'; t.needsUpdate = true;
    return (fishArt[kind] = { tex: t, aspect: f.h / (f.w + 1) });
  }
  const schools = new Map();
  function flock(uk, cam) {
    if (!T) return;
    const m = cam.matrixWorld.elements;
    for (const [kind, { hi, lo }] of Object.entries(uk)) {
      hi.visible = false; lo.visible = false;
      let s = schools.get(kind);
      if (!s) {
        const cap = hi.instanceMatrix.array.length / 16 + lo.instanceMatrix.array.length / 16;
        hi.geometry.computeBoundingBox();
        const art = fishTexture(kind);
        const mat = new T.MeshBasicMaterial({ map: art.tex, transparent: true, alphaTest: 0.5, side: 2, fog: false, toneMapped: false });
        mat.color.setScalar(kind === 'bait' || kind === 'hatchet' ? 1.1 : 1.3);
        const mesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1), mat, cap);
        mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.count = 0;
        hi.parent.add(mesh);
        s = { mesh, art, width: hi.geometry.boundingBox.max.x - hi.geometry.boundingBox.min.x, kind };
        schools.set(kind, s);
      }
      const out = s.mesh.instanceMatrix.array;
      let n = 0;
      for (const src of [hi, lo]) {
        const a = src.instanceMatrix.array;
        for (let i = 0; i < src.count; i++, n++) {
          const o = i * 16, d = n * 16;
          const sx = Math.hypot(a[o], a[o + 1], a[o + 2]) * s.width * 0.8, sy = sx * s.art.aspect;
          const face = (a[o] * m[0] + a[o + 1] * m[1] + a[o + 2] * m[2]) >= 0 ? 1 : -1;
          out[d] = m[0] * sx * face; out[d + 1] = m[1] * sx * face; out[d + 2] = m[2] * sx * face; out[d + 3] = 0;
          out[d + 4] = m[4] * sy; out[d + 5] = m[5] * sy; out[d + 6] = m[6] * sy; out[d + 7] = 0;
          out[d + 8] = m[8]; out[d + 9] = m[9]; out[d + 10] = m[10]; out[d + 11] = 0;
          out[d + 12] = a[o + 12]; out[d + 13] = a[o + 13]; out[d + 14] = a[o + 14]; out[d + 15] = 1;
        }
      }
      s.mesh.count = n;
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Acceptance probe: nothing 3D is left to draw for any animal. `targets` lists the on-screen sprites in CSS px.
  const seen = new Set();
  let camera = null;
  const screen = (p) => {
    const v = camera.matrixWorldInverse.elements, q = camera.projectionMatrix.elements;
    const x = v[0] * p.x + v[4] * p.y + v[8] * p.z + v[12], y = v[1] * p.x + v[5] * p.y + v[9] * p.z + v[13], z = v[2] * p.x + v[6] * p.y + v[10] * p.z + v[14];
    const w = q[3] * x + q[7] * y + q[11] * z + q[15];
    return [Math.round(((q[0] * x + q[4] * y + q[8] * z + q[12]) / w + 1) * innerWidth / 2), Math.round((1 - (q[1] * x + q[5] * y + q[9] * z + q[13]) / w) * innerHeight / 2), w > 0];
  };
  function report() {
    let meshes3d = 0, sprites = 0;
    const targets = [];
    for (const e of seen) {
      if (e.c?.inner?.visible) meshes3d++;
      if (e.__sprite?.sprite?.visible) {
        sprites++;
        const [x, y, front] = screen(e.c.group.position);
        if (front && x > 0 && y > 0 && x < innerWidth && y < innerHeight) targets.push({ name: e.c.name, x, y });
      }
    }
    return { creatures: seen.size, visibleSprites: sprites, visible3dCreatureMeshes: meshes3d, targets, schools: [...schools].map(([k, v]) => [k, v.mesh.count]) };
  }
  window.__retro = { init: (classes) => { T = classes; }, creature: (e, cam, dt) => { seen.add(e); creature(e, cam, dt); }, flock, report };

  // Palette + ordered-dither pass: samples the renderer canvas and redraws it on #gl-px, one texel per art pixel.
  const VERT = 'attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}';
  const FRAG = `precision mediump float;
varying vec2 v;uniform sampler2D t;uniform vec2 r;
const vec3 K=vec3(.299,.587,.114);
float b2(vec2 p){return mod(p.x*2.+p.y*3.,4.);}
float b4(vec2 p){return b2(p)*4.+b2(floor(p*.5));}
vec3 s(vec2 o){return texture2D(t,vec2(v.x,1.-v.y)+vec2(o.x,-o.y)/r).rgb;}
void main(){
  vec3 c=s(vec2(0.));
  vec3 e=(s(vec2(1.,0.))+s(vec2(-1.,0.))+s(vec2(0.,1.))+s(vec2(0.,-1.)))*.25;
  float l=dot(c,K);
  float n=max(max(dot(s(vec2(1.,0.)),K),dot(s(vec2(-1.,0.)),K)),max(dot(s(vec2(0.,1.)),K),dot(s(vec2(0.,-1.)),K)));
  c=mix(c,e,.3);
  c=(c-.5)*1.1+.5;
  c=mix(vec3(dot(c,K)),c,1.3);
  c*=1.-.5*smoothstep(.1,.24,n-l);
  float d=(b4(floor(gl_FragCoord.xy))+.5)/16.-.5;
  const vec3 L=vec3(11.,12.,10.);
  c=floor(c*L+.5+d*.4)/L;
  gl_FragColor=vec4(c*vec3(.97,1.,1.03),1.);
}`;

  function pixelPass(src, dst) {
    const gl = dst.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const shader = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const size = gl.getUniformLocation(program, 'r');
    return () => {
      const w = src.width, h = src.height;
      if (!w || !h || gl.isContextLost()) return false;
      if (dst.width !== w || dst.height !== h) { dst.width = w; dst.height = h; gl.viewport(0, 0, w, h); }
      gl.uniform2f(size, w, h);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch { return false; }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    };
  }

  function start() {
    const src = document.getElementById('gl'), dst = document.getElementById('gl-px');
    if (!src || !dst) return;
    const draw = pixelPass(src, dst);
    if (!draw) return; // plain low-resolution canvas stays visible
    const frame = () => {
      requestAnimationFrame(frame);
      if (draw()) root.classList.add('px-pass');
    };
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
