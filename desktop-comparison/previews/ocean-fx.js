// Attack visualisation layer (owner: fx agent). Exposes window.OceanFx; see .planning/ocean-scenes/CONTRACT.md
(() => {
  'use strict';

  const FAMILIES = Object.freeze(['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction']);
  const DEPTHS = Object.freeze(['sunlight', 'twilight', 'midnight', 'abyss', 'trench']);
  const KINDS = new Set(['file', 'account', 'setting', 'window', 'network', 'secret']);
  const MAX_TARGETS = 12;
  const MAX_LABEL = 40;
  const MAX_SRC = 8000000;
  // Direction the creature art faces (+1 right, -1 left); the retrodiffusion GIFs face left.
  const ART_FACES = -1;
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const OK_GREEN = [96, 220, 150];

  const PALETTES = {
    sunlight: { accent: [125, 228, 209], hostile: [255, 99, 120], panel: [6, 52, 64], ink: '#eafffb', tint: 'rgba(20,184,166,.18)', vignette: 'rgba(0,45,58,.42)', under: 'radial-gradient(ellipse at 50% -12%,rgba(210,255,246,.34),rgba(210,255,246,0) 62%)', glow: .35, rays: .55, motes: 0, bubbles: 16 },
    twilight: { accent: [114, 201, 232], hostile: [255, 92, 118], panel: [8, 38, 70], ink: '#e8f6ff', tint: 'rgba(30,100,190,.24)', vignette: 'rgba(0,18,52,.55)', under: 'radial-gradient(ellipse at 50% -12%,rgba(120,190,255,.2),rgba(120,190,255,0) 60%)', glow: .55, rays: .3, motes: 6, bubbles: 14 },
    midnight: { accent: [155, 174, 255], hostile: [255, 88, 128], panel: [14, 16, 58], ink: '#eef0ff', tint: 'rgba(40,40,150,.3)', vignette: 'rgba(4,4,40,.66)', under: 'radial-gradient(ellipse at 50% 112%,rgba(99,102,241,.2),rgba(99,102,241,0) 62%)', glow: .8, rays: .13, motes: 12, bubbles: 12 },
    abyss: { accent: [209, 167, 255], hostile: [255, 84, 150], panel: [28, 10, 52], ink: '#f6eeff', tint: 'rgba(80,30,150,.34)', vignette: 'rgba(14,0,34,.76)', under: 'radial-gradient(ellipse at 50% 112%,rgba(168,85,247,.28),rgba(168,85,247,0) 62%)', glow: 1.05, rays: .05, motes: 18, bubbles: 10 },
    trench: { accent: [221, 155, 207], hostile: [255, 63, 180], panel: [14, 4, 24], ink: '#fff0fa', tint: 'rgba(4,0,14,.6)', vignette: 'rgba(0,0,3,.88)', under: 'radial-gradient(ellipse at 50% 112%,rgba(255,63,180,.34),rgba(255,63,180,0) 62%)', glow: 1.35, rays: 0, motes: 26, bubbles: 8 },
  };

  const DEFAULT_LABELS = {
    deception: [['Read your mail', 'setting'], ['Access contacts', 'account'], ['Stay signed in', 'setting'], ['Send on your behalf', 'account'], ['Offline access', 'setting']],
    intrusion: [['Vault service', 'window'], ['Admin panel', 'window'], ['Firewall rules', 'setting']],
    'network-abuse': [['node-a1', 'network'], ['relay-07', 'network'], ['edge-42', 'network'], ['cache-3', 'network'], ['mirror-9', 'network'], ['hub-12', 'network'], ['gate-5', 'network'], ['mesh-18', 'network']],
    'trusted-source': [['Doc sync', 'setting'], ['Photo tool', 'setting'], ['Installer', 'setting'], ['Browser helper', 'setting'], ['Backup agent', 'setting']],
    'theft-surveillance': [['budget-q3.xlsx', 'file'], ['family-photos.zip', 'file'], ['passwords.vault', 'secret'], ['Mail account', 'account'], ['Demo bank account', 'account'], ['notes.txt', 'file'], ['Cloud login', 'secret']],
    'extortion-destruction': [['report.docx', 'file'], ['photos.zip', 'file'], ['ledger.xlsx', 'file'], ['notes.txt', 'file'], ['backup.img', 'file'], ['invoice.pdf', 'file']],
  };
  const PREFERRED_KINDS = {
    deception: ['setting', 'account'],
    intrusion: ['window', 'setting', 'secret'],
    'network-abuse': ['network'],
    'trusted-source': ['setting', 'window'],
    'theft-surveillance': ['file', 'secret', 'account'],
    'extortion-destruction': ['file'],
  };
  const CAPTIONS = {
    deception: 'Fake consent approved: access flows to the creature',
    intrusion: 'Locks broken: panels forced open',
    'network-abuse': 'Copies spread: packets fan out across the network',
    'trusted-source': 'Trusted update turned hostile: spreading',
    'theft-surveillance': 'Files, passwords and accounts drawn out',
    'extortion-destruction': 'Files locked: ransom countdown (training only)',
  };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const smooth = t => t * t * (3 - 2 * t);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const bez = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
  const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
  const rgb = (c, a = 1) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')';
  const n1 = v => v.toFixed(1);
  const n3 = v => v.toFixed(3);
  const frac = v => v - Math.floor(v);

  const kid = (parent, css, text) => {
    const el = (parent.ownerDocument || document).createElement('div');
    el.style.cssText = 'position:absolute;' + css;
    if (text != null) el.textContent = text;
    parent.appendChild(el);
    return el;
  };
  // Free-standing node positioned by put(): its centre is the transform target.
  const box = (ctx, parent, w, h, css, text) => {
    const el = kid(parent, 'left:0;top:0;width:' + w + 'px;height:' + h + 'px;will-change:transform,opacity;opacity:0;' + css, text);
    el.fxW = w;
    el.fxH = h;
    el.fxU = ctx.u;
    return el;
  };
  const put = (el, x, y, o = 1, rot = 0, sx = 1, sy = sx) => {
    el.style.transform = 'translate3d(' + n1(x - el.fxW / 2) + 'px,' + n1(y - el.fxH / 2) + 'px,0) rotate(' + n1(rot) + 'deg) scale(' + n3(sx * el.fxU) + ',' + n3(sy * el.fxU) + ')';
    el.style.opacity = n3(clamp(o));
  };
  const glowShadow = (ctx, el, amount, color) => {
    el.style.boxShadow = '0 0 ' + n1(26 * ctx.pal.glow * amount) + 'px ' + n1(3 * amount) + 'px ' + rgb(color || ctx.pal.accent, .75 * clamp(amount)) + ',0 4px 18px rgba(0,0,0,.35)';
  };

  const ICONS = {
    file: 'width:10px;height:13px;border:2px solid;border-radius:2px;margin:0 2px',
    account: 'width:14px;height:14px;border:2px solid;border-radius:50%',
    secret: 'width:14px;height:14px;border:2px solid;border-radius:4px;background:currentColor;opacity:.75',
    setting: 'width:16px;height:9px;border:2px solid;border-radius:6px',
    window: 'width:15px;height:12px;border:2px solid;border-top-width:4px;border-radius:2px',
    network: 'width:14px;height:14px;border:2px dashed;border-radius:50%',
  };

  function card(ctx, parent, w, h, label, kind) {
    const el = box(ctx, parent, w, h, 'box-sizing:border-box;border-radius:9px;overflow:hidden;color:' + ctx.pal.ink + ';background:' + rgb(ctx.pal.panel, .93) + ';border:1px solid ' + rgb(ctx.pal.accent, .5) + ';box-shadow:0 4px 18px rgba(0,0,0,.35);font:600 12px/1.2 ' + FONT);
    const body = kid(el, 'left:0;top:0;right:0;bottom:0');
    const tall = h > 48;
    const row = kid(body, 'left:10px;right:10px;top:' + (tall ? 10 : (h - 16) / 2) + 'px;height:16px;display:flex;align-items:center;gap:8px;white-space:nowrap;color:' + rgb(ctx.pal.accent));
    kid(row, 'position:static;flex:none;box-sizing:border-box;' + (ICONS[kind] || ICONS.file));
    kid(row, 'position:static;overflow:hidden;text-overflow:ellipsis;color:' + ctx.pal.ink, label);
    if (tall) {
      [[34, '88%'], [46, '66%'], [58, '78%']].forEach(([y, wd]) => { if (y + 8 < h) kid(body, 'left:10px;top:' + y + 'px;width:' + wd + ';max-width:calc(100% - 20px);height:5px;border-radius:3px;background:rgba(255,255,255,.15)'); });
    }
    el.fxBody = body;
    return el;
  }

  function lock(ctx, parent, left, top) {
    const root = kid(parent, 'left:' + left + 'px;top:' + top + 'px;width:34px;height:42px');
    const shackle = kid(root, 'left:7px;top:0;width:20px;height:24px;box-sizing:border-box;border:4px solid ' + rgb(ctx.pal.accent) + ';border-bottom:0;border-radius:11px 11px 0 0');
    const body = kid(root, 'left:0;top:17px;width:34px;height:25px;border-radius:6px;background:' + rgb(ctx.pal.accent) + ';box-shadow:0 0 12px ' + rgb(ctx.pal.accent, .6));
    kid(body, 'left:14px;top:7px;width:6px;height:6px;border-radius:50%;background:' + rgb(ctx.pal.panel));
    const crackA = kid(body, 'left:16px;top:-4px;width:3px;height:34px;background:' + rgb(ctx.pal.hostile) + ';transform:rotate(18deg) scaleY(0);box-shadow:0 0 8px ' + rgb(ctx.pal.hostile));
    const crackB = kid(body, 'left:10px;top:-2px;width:2px;height:30px;background:' + rgb(ctx.pal.hostile) + ';transform:rotate(-24deg) scaleY(0)');
    return { root, shackle, body, crackA, crackB };
  }

  // ---- effects: each returns { hover:[fx,fy], update(p,e,dt), pose?(p,bx,by) }; p is 0..1 over the effect window, e is seconds into it.

  function deception(ctx) {
    const list = ctx.items(5);
    const n = list.length;
    const hd = 62 + n * 46;
    const dlg = box(ctx, ctx.stage, 250, hd, 'box-sizing:border-box;border-radius:14px;background:' + rgb(ctx.pal.panel, .8) + ';border:1px solid ' + rgb(ctx.pal.accent, .4) + ';box-shadow:0 12px 40px rgba(0,0,0,.4)');
    kid(dlg, 'left:16px;top:15px;font:700 13px ' + FONT + ';color:' + ctx.pal.ink, 'Allow the app to:');
    const chips = list.map(it => {
      const el = card(ctx, ctx.stage, 218, 40, it.label, it.kind);
      const track = kid(el, 'right:10px;top:12px;width:30px;height:16px;border-radius:8px;background:rgba(255,255,255,.18)');
      const knob = kid(track, 'left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#fff');
      const tokens = [0, 1].map(() => [12, 10, 8, 6].map(s => box(ctx, ctx.stage, s, s, 'border-radius:50%;background:radial-gradient(circle,#fff,' + rgb(ctx.pal.accent) + ' 55%,' + rgb(ctx.pal.accent, 0) + ' 78%);box-shadow:0 0 ' + n1(10 * ctx.pal.glow + 4) + 'px ' + rgb(ctx.pal.accent, .9))));
      return { el, track, knob, tokens, arrived: false };
    });
    return {
      hover: [.7, .5],
      update(p) {
        const { W, H, u } = ctx;
        const cx0 = W * .24;
        const top = H * .5 - hd / 2 * u;
        put(dlg, cx0, H * .5, seg(p, 0, .08) * .95);
        chips.forEach((c, i) => {
          const y = top + (72 + i * 46) * u;
          const inn = seg(p, .04 + .07 * i, .16 + .07 * i);
          const lit = smooth(seg(p, .22 + .08 * i, .28 + .08 * i));
          const drained = seg(p, .56 + .05 * i, .7 + .05 * i);
          put(c.el, cx0 + (1 - easeOut(inn)) * -30 * u * (ctx.reduced ? 0 : 1), y, inn * (1 - .55 * drained));
          glowShadow(ctx, c.el, lit * (1 - drained * .6));
          c.track.style.background = rgb(mix([255, 255, 255], ctx.pal.accent, lit), .18 + .6 * lit);
          c.knob.style.transform = 'translateX(' + n1(14 * lit) + 'px)';
          c.tokens.forEach((trail, k) => {
            const s0 = .3 + .08 * i + .05 * k;
            trail.forEach((el, j) => {
              const q = seg(p, s0, s0 + .26) - j * .035;
              if (ctx.reduced || q <= 0 || q >= 1) { el.style.opacity = '0'; if (j === 0 && q >= 1 && !c.arrived) { c.arrived = true; ctx.pulse(.55); } return; }
              const sx = cx0 + 109 * u, mx = (sx + ctx.cx) / 2;
              put(el, bez(sx, mx, ctx.cx, easeOut(q)), bez(y, Math.min(y, ctx.cy) - H * .16, ctx.cy, easeOut(q)), [1, .6, .35, .18][j]);
            });
          });
        });
        ctx.energy = seg(p, .35, .85);
      },
    };
  }

  function intrusion(ctx) {
    const list = ctx.items(3);
    const spots = [[.2, .3], [.4, .64], [.52, .26]];
    const panels = list.map((it, j) => {
      const el = box(ctx, ctx.stage, 232, 150, 'box-sizing:border-box;border-radius:10px;overflow:hidden;background:' + rgb(ctx.pal.panel, .94) + ';border:1px solid ' + rgb(ctx.pal.accent, .5) + ';box-shadow:0 8px 30px rgba(0,0,0,.4)');
      kid(el, 'left:0;top:0;right:0;height:26px;background:rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.1)');
      [0, 1, 2].forEach(d => kid(el, 'left:' + (10 + d * 13) + 'px;top:9px;width:8px;height:8px;border-radius:50%;background:' + rgb(ctx.pal.accent, .55)));
      kid(el, 'left:56px;top:6px;font:600 12px ' + FONT + ';color:' + ctx.pal.ink, it.label);
      [[38, '80%'], [52, '60%'], [66, '70%']].forEach(([y, w]) => kid(el, 'left:16px;top:' + y + 'px;width:' + w + ';height:6px;border-radius:3px;background:rgba(255,255,255,.14)'));
      const status = kid(el, 'left:16px;top:100px;font:700 12px ui-monospace,Consolas,monospace;letter-spacing:.06em;color:' + rgb(ctx.pal.accent), 'LOCKED');
      const plateCss = 'top:26px;width:116px;height:124px;box-sizing:border-box;background:' + rgb(mix(ctx.pal.panel, [255, 255, 255], .08), 1) + ';border:1px solid ' + rgb(ctx.pal.accent, .45);
      const left = kid(el, 'left:0;' + plateCss);
      const right = kid(el, 'left:116px;' + plateCss);
      const lk = lock(ctx, el, 99, 70);
      const link = box(ctx, ctx.stage, 100, 3, 'border-radius:2px;background:linear-gradient(90deg,' + rgb(ctx.pal.hostile, .1) + ',' + rgb(ctx.pal.hostile, .9) + ');box-shadow:0 0 10px ' + rgb(ctx.pal.hostile, .7));
      link.style.transformOrigin = '0 50%';
      const shards = Array.from({ length: 6 }, (_, s) => ({ el: kid(el, 'left:108px;top:86px;width:9px;height:9px;opacity:0;background:' + rgb(ctx.pal.hostile) + ';clip-path:polygon(0 0,100% 40%,30% 100%)'), a: s / 6 * Math.PI * 2 + j }));
      return { el, status, left, right, lk, shards, link, broke: false };
    });
    return {
      hover: [.76, .5],
      update(p) {
        const { W, H } = ctx;
        panels.forEach((pn, j) => {
          const [fx, fy] = spots[j];
          const inn = seg(p, .03 + .1 * j, .15 + .1 * j);
          const crack = seg(p, .25 + .13 * j, .38 + .13 * j);
          const brk = seg(p, .4 + .13 * j, .52 + .13 * j);
          const open = easeOut(seg(p, .44 + .13 * j, .62 + .13 * j));
          put(pn.el, W * fx, H * fy, inn * (1 - .25 * seg(p, .8, 1)), 0, lerp(.92, 1, easeOut(inn)));
          const lx = W * fx, ly = H * fy, ld = Math.hypot(ctx.cx - lx, ctx.cy - ly);
          pn.link.style.width = n1(ld / ctx.u) + 'px';
          pn.link.style.transform = 'translate3d(' + n1(ctx.cx) + 'px,' + n1(ctx.cy - 1.5) + 'px,0) rotate(' + n1(Math.atan2(ly - ctx.cy, lx - ctx.cx) * 180 / Math.PI) + 'deg) scale(' + n3(ctx.u * seg(p, .22 + .13 * j, .4 + .13 * j)) + ',1)';
          pn.link.style.opacity = n3(ctx.reduced ? 0 : .8 * Math.min(seg(p, .22 + .13 * j, .3 + .13 * j), 1 - seg(p, .52 + .13 * j, .66 + .13 * j)));
          glowShadow(ctx, pn.el, open * .9, ctx.pal.hostile);
          pn.lk.crackA.style.transform = 'rotate(18deg) scaleY(' + n3(crack) + ')';
          pn.lk.crackB.style.transform = 'rotate(-24deg) scaleY(' + n3(seg(crack, .3, 1)) + ')';
          pn.lk.shackle.style.transform = 'translate(' + n1(brk * 6) + 'px,' + n1(-16 * brk) + 'px) rotate(' + n1(brk * 34) + 'deg)';
          pn.lk.shackle.style.opacity = n3(1 - .85 * brk);
          pn.lk.root.style.opacity = n3(1 - seg(p, .5 + .13 * j, .66 + .13 * j));
          pn.left.style.transform = 'translateX(' + n1(-118 * open) + 'px)';
          pn.right.style.transform = 'translateX(' + n1(118 * open) + 'px)';
          pn.left.style.opacity = pn.right.style.opacity = n3(1 - seg(open, .6, 1));
          pn.status.textContent = open > .45 ? 'OPEN' : 'LOCKED';
          pn.status.style.color = rgb(mix(ctx.pal.accent, ctx.pal.hostile, open));
          pn.shards.forEach(s => {
            const d = easeOut(seg(brk, .1, 1)) * (ctx.reduced ? 0 : 1);
            s.el.style.opacity = n3(d > 0 ? 1 - seg(brk, .5, 1) : 0);
            s.el.style.transform = 'translate(' + n1(Math.cos(s.a) * 70 * d) + 'px,' + n1(Math.sin(s.a) * 50 * d) + 'px) rotate(' + n1(d * 280) + 'deg)';
          });
          if (brk >= 1 && !pn.broke) { pn.broke = true; ctx.pulse(.6); }
        });
        ctx.energy = seg(p, .3, .85);
      },
    };
  }

  function networkAbuse(ctx) {
    const list = ctx.items(8);
    const m = list.length;
    const n = ctx.reduced ? 6 : 9;
    const nodes = list.map(it => card(ctx, ctx.stage, 116, 30, it.label, 'network'));
    const rings = [];
    const packets = [];
    const copies = Array.from({ length: n }, (_, k) => {
      const c = ctx.makeCreature(ctx.stage, Math.round(ctx.S * .34), .5);
      c.a = k / n * Math.PI * 2 + .25;
      for (let j = 0; j < 2; j++) {
        const ring = box(ctx, ctx.stage, 60, 60, 'box-sizing:border-box;border-radius:50%;border:2px solid ' + rgb(ctx.pal.accent, .85));
        const head = box(ctx, ctx.stage, 9, 9, 'border-radius:2px;background:#fff;box-shadow:0 0 ' + n1(8 * ctx.pal.glow + 4) + 'px ' + rgb(ctx.pal.accent));
        const tail = box(ctx, ctx.stage, 7, 7, 'border-radius:2px;background:' + rgb(ctx.pal.accent, .7));
        rings.push(ring);
        packets.push({ k, j, ring, head, tail, dest: (k + 1 + j * 3) % m });
      }
      return c;
    });
    const nodePos = i => [ctx.W * (.5 + .43 * Math.cos(i / m * Math.PI * 2 + .4)), ctx.H * (.5 + .38 * Math.sin(i / m * Math.PI * 2 + .4))];
    const copyPos = k => [ctx.W * (.5 + .22 * Math.cos(copies[k].a)), ctx.H * (.5 + .2 * Math.sin(copies[k].a))];
    return {
      hover: [.5, .5],
      pose: (p, bx, by) => ({ x: bx, y: by, s: 1 - .24 * seg(p, .04, .3) + .24 * seg(p, .86, .98) }),
      update(p, e) {
        const hx = ctx.W * .5, hy = ctx.H * .5;
        const hit = new Array(m).fill(0);
        const flow = seg(p, .3, .36) * (1 - seg(p, .82, .86));
        packets.forEach(pk => {
          const [sx, sy] = copyPos(pk.k);
          const [dx, dy] = nodePos(pk.dest);
          const u = ctx.reduced ? .5 : frac(e * .9 + pk.k * .37 + pk.j * .5);
          put(pk.head, lerp(sx, dx, u), lerp(sy, dy, u), flow, 0, 1);
          put(pk.tail, lerp(sx, dx, Math.max(0, u - .07)), lerp(sy, dy, Math.max(0, u - .07)), flow * .6, 0, 1);
          const ping = ctx.reduced ? .35 : 1 - seg(u, 0, .45);
          hit[pk.dest] = Math.max(hit[pk.dest], ping * flow);
          put(pk.ring, dx, dy, ping * .6 * flow, 0, ctx.reduced ? 1 : .4 + 1.8 * seg(u, 0, .5));
        });
        nodes.forEach((nd, i) => {
          const [x, y] = nodePos(i);
          put(nd, x, y, seg(p, .12 + .02 * i, .24 + .02 * i) * (1 - seg(p, .9, 1)));
          glowShadow(ctx, nd, hit[i] * .9);
        });
        copies.forEach((c, k) => {
          const [cx, cy] = copyPos(k);
          const sp = ctx.reduced ? seg(p, .1 + .02 * k, .3) : easeOut(seg(p, .04 + .01 * k, .3));
          const mg = seg(p, .86, .98);
          const back = ctx.reduced ? 0 : smooth(mg);
          const x = lerp(hx, cx, ctx.reduced ? 1 : sp) * (1 - back) + hx * back + (ctx.reduced ? 0 : Math.sin(e * 2.2 + k) * 8 * (1 - back));
          const y = lerp(hy, cy, ctx.reduced ? 1 : sp) * (1 - back) + hy * back + (ctx.reduced ? 0 : Math.cos(e * 1.8 + k * 1.7) * 7 * (1 - back));
          const dir = Math.cos(c.a) >= 0 ? 1 : -1;
          c.draw(x, y, ctx.reduced ? sp : sp * (1 - seg(mg, .6, 1)), 0, dir * ART_FACES * (ctx.reduced ? 1 : 1), lerp(.3, 1, sp) * (1 - .4 * back));
        });
        ctx.energy = seg(p, .15, .6);
      },
    };
  }

  function trustedSource(ctx) {
    const list = ctx.items(5);
    const n = list.length;
    const bar = box(ctx, ctx.stage, 380, 70, 'box-sizing:border-box;border-radius:12px;background:' + rgb(ctx.pal.panel, .94) + ';border:1px solid ' + rgb(ctx.pal.accent, .5) + ';color:' + ctx.pal.ink + ';font:600 13px ' + FONT);
    const badge = kid(bar, 'left:14px;top:14px;width:30px;height:30px;border-radius:50%;text-align:center;font:800 16px/30px ' + FONT + ';color:#04141a', '\u2713');
    kid(bar, 'left:56px;top:10px;font:700 14px ' + FONT, 'Trusted update service');
    const sub = kid(bar, 'left:56px;top:30px;font:500 11px ' + FONT + ';opacity:.8', 'Verified publisher');
    const track = kid(bar, 'left:14px;top:56px;width:352px;height:6px;border-radius:3px;background:rgba(255,255,255,.14)');
    const fill = kid(track, 'left:0;top:0;height:6px;width:0;border-radius:3px');
    const tiles = list.map((it, i) => {
      const el = card(ctx, ctx.stage, 156, 40, it.label, it.kind);
      const dot = kid(el, 'right:10px;top:12px;width:16px;height:16px;border-radius:50%;text-align:center;font:800 10px/16px ' + FONT + ';color:#04141a', '\u2713');
      const link = box(ctx, ctx.stage, 100, 2, 'transform-origin:0 50%;border-radius:1px');
      link.style.transformOrigin = '0 50%';
      return { el, dot, link, x: .14 + .72 * i / Math.max(1, n - 1), y: .8 - .15 * Math.sin(Math.PI * i / Math.max(1, n - 1)) };
    });
    const wave = box(ctx, ctx.stage, 2, 2, 'box-sizing:border-box;border-radius:50%;border:2px solid ' + rgb(ctx.pal.hostile, .8));
    return {
      hover: [.5, .4],
      update(p) {
        const { W, H, u } = ctx;
        const bx = W * .5, by = H * .13;
        put(bar, bx, by, seg(p, 0, .08));
        const h = smooth(seg(p, .18, .38));
        const col = mix(OK_GREEN, ctx.pal.hostile, h);
        badge.style.background = rgb(col);
        badge.textContent = h > .5 ? '!' : '\u2713';
        sub.textContent = h > .5 ? 'Publisher key abused (training)' : 'Verified publisher';
        fill.style.width = n1(352 * seg(p, .02, .5)) + 'px';
        fill.style.background = rgb(col);
        bar.style.borderColor = rgb(mix(ctx.pal.accent, ctx.pal.hostile, h), .85);
        glowShadow(ctx, bar, h, ctx.pal.hostile);
        const maxD = Math.max(...tiles.map(t => Math.hypot(W * t.x - bx, H * t.y - by))) + 40;
        const radius = easeOut(seg(p, .22, .78)) * maxD;
        wave.fxW = wave.fxH = Math.max(2, 2 * radius / u);
        wave.style.width = wave.style.height = n1(wave.fxW) + 'px';
        put(wave, bx, by, ctx.reduced ? 0 : (.55 * (1 - seg(p, .6, .8)) * seg(p, .2, .26)));
        tiles.forEach((t, i) => {
          const tx = W * t.x, ty = H * t.y;
          const d = Math.hypot(tx - bx, ty - by);
          const start = .2 + .5 * (d / maxD);
          const th = smooth(seg(p, start, start + .12));
          put(t.el, tx, ty, seg(p, .08 + .03 * i, .2 + .03 * i));
          const tc = mix(OK_GREEN, ctx.pal.hostile, th);
          t.dot.style.background = rgb(tc);
          t.dot.textContent = th > .5 ? '!' : '\u2713';
          t.el.style.borderColor = rgb(mix(ctx.pal.accent, ctx.pal.hostile, th), .8);
          glowShadow(ctx, t.el, th * .85, ctx.pal.hostile);
          const ang = Math.atan2(ty - by, tx - bx);
          t.link.fxW = d / u;
          t.link.style.width = n1(d / u) + 'px';
          const lp = ctx.reduced ? seg(p, start, start + .12) : seg(p, .2, start + .02);
          t.link.style.background = 'linear-gradient(90deg,' + rgb(ctx.pal.hostile, .1) + ',' + rgb(ctx.pal.hostile, .85) + ')';
          t.link.style.transform = 'translate3d(' + n1(bx) + 'px,' + n1(by - 1) + 'px,0) rotate(' + n1(ang * 180 / Math.PI) + 'deg) scale(' + n3(lp * u) + ',1)';
          t.link.style.opacity = n3(.8 * (1 - seg(p, .88, 1)) * (lp > 0 ? 1 : 0));
          if (th >= 1 && !t.hit) { t.hit = true; ctx.pulse(.4); }
        });
        ctx.energy = h;
      },
    };
  }

  function theftSurveillance(ctx) {
    const list = ctx.items(8);
    const grid = [[.14, .26], [.32, .2], [.5, .28], [.2, .5], [.4, .5], [.14, .74], [.34, .7], [.54, .68]];
    const sizes = { file: [124, 78], account: [168, 56], secret: [150, 34] };
    const cards = list.map((it, i) => {
      const [w, h] = sizes[it.kind] || [150, 34];
      const el = card(ctx, ctx.stage, w, h, it.kind === 'secret' ? it.label + '  \u2022\u2022\u2022\u2022\u2022\u2022' : it.label, it.kind);
      return { el, it, fx: grid[i][0], fy: grid[i][1], seen: 0 };
    });
    const eye = box(ctx, ctx.stage, 96, 48, 'box-sizing:border-box;border:3px solid ' + rgb(ctx.pal.accent) + ';border-radius:50%;box-shadow:0 0 ' + n1(24 * ctx.pal.glow + 6) + 'px ' + rgb(ctx.pal.accent, .7) + ';overflow:hidden;background:' + rgb(ctx.pal.panel, .9));
    const iris = kid(eye, 'left:32px;top:6px;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle,#05121a 28%,' + rgb(ctx.pal.accent) + ' 32%)');
    const beam = box(ctx, ctx.stage, 560, 560, 'clip-path:polygon(50% 0,0 100%,100% 100%);background:linear-gradient(180deg,' + rgb(ctx.pal.accent, .5) + ',' + rgb(ctx.pal.accent, 0) + ' 92%)');
    beam.style.transformOrigin = '50% 0';
    return {
      hover: [.8, .5],
      update(p, e) {
        const { W, H, u } = ctx;
        const ex = W * .34, ey = H * .08;
        put(eye, ex, ey, seg(p, 0, .06) * (1 - seg(p, .88, 1)));
        const beamO = seg(p, .02, .08) * (1 - seg(p, .66, .8));
        const theta = ctx.reduced ? 0 : 32 * Math.sin(e * Math.PI * 0.5);
        iris.style.transform = 'translateX(' + n1(Math.sin(theta * Math.PI / 180) * 20) + 'px)';
        const bl = H * .95 / u;
        beam.fxW = bl; beam.fxH = bl;
        beam.style.width = beam.style.height = n1(bl) + 'px';
        beam.style.transform = 'translate3d(' + n1(ex - bl / 2) + 'px,' + n1(ey + 18 * u) + 'px,0) rotate(' + n1(theta) + 'deg) scale(' + n3(u) + ')';
        beam.style.opacity = n3(ctx.reduced ? 0 : beamO * .85);
        let taken = 0;
        cards.forEach((c, i) => {
          const hasRect = c.it.rect;
          const sx = hasRect ? hasRect.cx : W * c.fx;
          const sy = hasRect ? hasRect.cy : H * c.fy;
          const ang = Math.atan2(sx - ex, sy - ey) * 180 / Math.PI;
          c.seen = ctx.reduced ? seg(p, .1 + .03 * i, .3) : Math.max(c.seen, 1 - clamp(Math.abs(ang - theta) / 12) * (beamO > 0 ? 1 : 2));
          const q = seg(p, .38 + .07 * i, .62 + .07 * i);
          const mv = ctx.reduced ? 0 : easeOut(q);
          const x = bez(sx, (sx + ctx.cx) / 2, ctx.cx, mv), y = bez(sy, Math.min(sy, ctx.cy) - H * .12, ctx.cy, mv);
          put(c.el, x, y, seg(p, .03 + .03 * i, .12 + .03 * i) * (1 - seg(q, .82, 1)), mv * 14 * (i % 2 ? 1 : -1), 1 - .7 * mv);
          glowShadow(ctx, c.el, clamp(c.seen) * .8);
          if (q >= 1) taken++;
          if (q >= 1 && !c.taken) { c.taken = true; ctx.pulse(.35); }
        });
        ctx.energy = taken / Math.max(1, cards.length);
        if (ctx.reduced) ctx.energy = seg(p, .4, .85);
      },
    };
  }

  function extortionDestruction(ctx) {
    const list = ctx.items(6);
    const grid = [[.3, .26], [.5, .26], [.7, .26], [.3, .46], [.5, .46], [.7, .46]];
    const cards = list.map((it, i) => {
      const el = card(ctx, ctx.stage, 124, 78, it.label, 'file');
      const back = kid(el, 'left:0;top:0;right:0;bottom:0;background:' + rgb(mix(ctx.pal.panel, ctx.pal.hostile, .55)) + ';opacity:0');
      kid(back, 'left:10px;top:12px;width:14px;height:11px;border-radius:2px;background:' + rgb(ctx.pal.hostile) + ';box-shadow:0 0 8px ' + rgb(ctx.pal.hostile));
      kid(back, 'left:12px;top:5px;width:8px;height:9px;box-sizing:border-box;border:2px solid ' + rgb(ctx.pal.hostile) + ';border-bottom:0;border-radius:5px 5px 0 0');
      kid(back, 'left:32px;top:10px;font:800 12px ' + FONT + ';letter-spacing:.08em;color:' + ctx.pal.ink, 'LOCKED');
      kid(back, 'left:10px;top:44px;right:10px;font:500 11px ' + FONT + ';color:' + ctx.pal.ink + ';opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', it.label);
      return { el, back, fx: grid[i][0], fy: grid[i][1] };
    });
    const ransom = box(ctx, ctx.stage, 380, 128, 'box-sizing:border-box;border-radius:12px;overflow:hidden;background:' + rgb(mix(ctx.pal.panel, [0, 0, 0], .35), .96) + ';border:2px solid ' + rgb(ctx.pal.hostile, .9) + ';color:' + ctx.pal.ink + ';font:600 12px ' + FONT);
    kid(ransom, 'left:0;top:0;right:0;height:30px;background:' + rgb(ctx.pal.hostile, .85));
    kid(ransom, 'left:14px;top:7px;font:800 13px ' + FONT + ';color:#fff;letter-spacing:.04em', 'FILES LOCKED (TRAINING ONLY)');
    kid(ransom, 'left:14px;top:42px;right:14px;font:500 12px/1.4 ' + FONT + ';opacity:.9', 'Pay 0.00 demo-coins to restore your files. Nothing here is real.');
    const clock = kid(ransom, 'left:14px;top:88px;font:800 22px ui-monospace,Consolas,monospace;color:' + rgb(ctx.pal.hostile), '71:59:59');
    kid(ransom, 'right:14px;top:96px;font:600 10px ' + FONT + ';opacity:.7', 'time remaining');
    const rings = [0, 1, 2].map(i => box(ctx, ctx.stage, 420, 420, 'box-sizing:border-box;border-radius:50%;border:' + (4 - i) + 'px solid ' + rgb(ctx.pal.hostile, .7) + ';box-shadow:0 0 ' + n1(14 * ctx.pal.glow + 4) + 'px ' + rgb(ctx.pal.hostile, .5)));
    return {
      hover: [.88, .22],
      pose(p) {
        const { W, H } = ctx;
        const cc = [W * .5, H * .38];
        const q = seg(p, .62, .96);
        if (q <= 0 || ctx.reduced) return null;
        const hx = W * .88, hy = H * .22;
        const r0 = Math.hypot(hx - cc[0], hy - cc[1]);
        const a0 = Math.atan2(hy - cc[1], hx - cc[0]);
        const k = smooth(q);
        const r = lerp(r0, 50 * ctx.u, k);
        const a = a0 + Math.PI * 3.5 * k;
        return { x: cc[0] + Math.cos(a) * r, y: cc[1] + Math.sin(a) * r * .8, s: lerp(1, .9, k) };
      },
      update(p, e) {
        const { W, H } = ctx;
        cards.forEach((c, i) => {
          const f = seg(p, .08 + .07 * i, .18 + .07 * i);
          const face = ctx.reduced ? f : (f >= .5 ? 1 : 0);
          put(c.el, W * c.fx, H * c.fy, seg(p, .02 + .02 * i, .1 + .02 * i), 0, ctx.reduced ? 1 : Math.max(.02, Math.abs(Math.cos(Math.PI * f))), 1);
          c.back.style.opacity = n3(face);
          c.el.fxBody.style.opacity = n3(1 - face);
          glowShadow(ctx, c.el, face * .8, ctx.pal.hostile);
        });
        const rp = seg(p, .48, .6);
        const left = Math.max(0, 259199 - Math.floor(e * 2) * 3541);
        clock.textContent = String(Math.floor(left / 3600)).padStart(2, '0') + ':' + String(Math.floor(left / 60) % 60).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
        put(ransom, W * .5, H * .72, rp, 0, lerp(.92, 1, easeOut(rp)));
        glowShadow(ctx, ransom, .6 + .3 * Math.sin(e * Math.PI * 1.2) * rp, ctx.pal.hostile);
        const q = seg(p, .62, .96);
        rings.forEach((r, i) => {
          const k = easeOut(seg(q, 0, 1));
          put(r, W * .5, H * .38, ctx.reduced ? q * .35 : q * (1 - .4 * seg(q, .9, 1)) * (.7 - i * .15), (ctx.reduced ? 0 : q * 120) * (i % 2 ? -1 : 1), lerp(1.7, .78 - i * .12, k), lerp(1.3, .56 - i * .08, k));
        });
        ctx.energy = seg(p, .3, .9);
      },
    };
  }

  const EFFECTS = { deception, intrusion, 'network-abuse': networkAbuse, 'trusted-source': trustedSource, 'theft-surveillance': theftSurveillance, 'extortion-destruction': extortionDestruction };

  // ---- creature element

  function makeCreatureFactory(ctx) {
    return (parent, size, glowScale) => {
      const el = kid(parent, 'left:0;top:0;width:' + size + 'px;height:' + size + 'px;will-change:transform,opacity;opacity:0;filter:drop-shadow(0 0 ' + n1((5 + 9 * ctx.pal.glow) * glowScale) + 'px ' + rgb(ctx.pal.accent, .9) + ')');
      if (ctx.creatureSrc) {
        const img = (parent.ownerDocument || document).createElement('img');
        img.style.cssText = 'display:block;width:100%;height:100%;image-rendering:crisp-edges;image-rendering:pixelated';
        img.alt = '';
        img.setAttribute('draggable', 'false');
        img.src = ctx.creatureSrc;
        el.appendChild(img);
      } else {
        const dark = rgb(mix(ctx.pal.panel, ctx.pal.accent, .3));
        const bodyBg = 'linear-gradient(180deg,' + rgb(mix(ctx.pal.panel, ctx.pal.accent, .45)) + ',' + dark + ')';
        kid(el, 'left:2%;top:34%;width:28%;height:32%;background:' + bodyBg + ';clip-path:polygon(100% 50%,0 0,22% 50%,0 100%)');
        kid(el, 'left:38%;top:16%;width:26%;height:26%;background:' + dark + ';clip-path:polygon(0 100%,62% 0,100% 100%)');
        kid(el, 'left:18%;top:32%;width:66%;height:38%;border-radius:50%;background:' + bodyBg + ';border:2px solid ' + rgb(ctx.pal.accent, .7));
        kid(el, 'left:68%;top:42%;width:8%;height:8%;border-radius:50%;background:' + rgb(ctx.pal.accent) + ';box-shadow:0 0 10px ' + rgb(ctx.pal.accent));
        kid(el, 'left:42%;top:56%;width:28%;height:3px;border-radius:2px;background:' + rgb(ctx.pal.accent, .5));
      }
      const c = { el, face: 1, tilt: 0, px: null, py: null };
      // Draws centred at x,y; dir > 0 flips toward the art's facing; rot in degrees.
      c.draw = (x, y, o, rot, dir, scale) => {
        const sx = dir * ART_FACES;
        el.style.transform = 'translate3d(' + n1(x - size / 2) + 'px,' + n1(y - size / 2) + 'px,0) rotate(' + n1(rot) + 'deg) scale(' + n3(sx * scale) + ',' + n3(scale) + ')';
        el.style.opacity = n3(clamp(o));
      };
      return c;
    };
  }

  // ---- validation

  function cleanLabel(value) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_LABEL) : '';
  }

  function cleanTargets(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const t of value.slice(0, MAX_TARGETS)) {
      if (!t || typeof t !== 'object') continue;
      const label = cleanLabel(t.label);
      if (!label) continue;
      const r = t.rect;
      const x = r && Number(r.x != null ? r.x : r.left), y = r && Number(r.y != null ? r.y : r.top);
      const w = r && Number(r.width), h = r && Number(r.height);
      const rect = r && [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { cx: x + w / 2, cy: y + h / 2 } : null;
      out.push({ label, kind: KINDS.has(t.kind) ? t.kind : 'file', rect });
    }
    return out;
  }

  function cleanOptions(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('OceanFx.play: options object required');
    if (!FAMILIES.includes(opts.familyId)) throw new TypeError('OceanFx.play: unknown familyId');
    if (!DEPTHS.includes(opts.depthId)) throw new TypeError('OceanFx.play: unknown depthId');
    const c = opts.container;
    if (!c || typeof c !== 'object' || typeof c.appendChild !== 'function') throw new TypeError('OceanFx.play: container element required');
    const src = opts.creatureSrc;
    return {
      familyId: opts.familyId,
      depthId: opts.depthId,
      container: c,
      creatureSrc: typeof src === 'string' && src.length <= MAX_SRC && /^(data:image\/|blob:)/.test(src) ? src : null,
      targets: cleanTargets(opts.targets),
      reducedMotion: opts.reducedMotion === true,
      onEvent: typeof opts.onEvent === 'function' ? opts.onEvent : null,
      onDone: typeof opts.onDone === 'function' ? opts.onDone : null,
    };
  }

  // ---- run

  let current = null;

  function seeded(text) {
    let s = 2166136261;
    for (let i = 0; i < text.length; i++) s = Math.imul(s ^ text.charCodeAt(i), 16777619) >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  }

  function createRun(o) {
    const container = o.container;
    const doc = container.ownerDocument || document;
    const global = typeof window !== 'undefined' ? window : globalThis;
    const raf = typeof global.requestAnimationFrame === 'function' ? cb => global.requestAnimationFrame(cb) : cb => global.setTimeout(() => cb(Date.now()), 16);
    const caf = typeof global.cancelAnimationFrame === 'function' ? id => global.cancelAnimationFrame(id) : id => global.clearTimeout(id);
    const reduced = o.reducedMotion;
    const di = DEPTHS.indexOf(o.depthId);
    const pal = PALETTES[o.depthId];
    const rnd = seeded(o.familyId + ':' + o.depthId);
    const entryRight = di % 2 === 1;
    const tIn = reduced ? .7 : 1.9;
    const tE = tIn + .25;
    const total = reduced ? 3.6 : 6.6 + di * .5;
    const tX = total - (reduced ? .9 : 1.5);

    const ctx = { W: 1280, H: 720, u: 1, S: 128, pal, reduced, creatureSrc: o.creatureSrc, energy: 0, cx: 0, cy: 0, pulseV: 0 };
    const root = kid(container, 'left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;contain:strict');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-ocean-fx', o.familyId);

    const measure = () => {
      const w = container.clientWidth || global.innerWidth || 1280;
      const h = container.clientHeight || global.innerHeight || 720;
      ctx.W = w; ctx.H = h;
    };
    measure();
    ctx.u = clamp(Math.min(ctx.W / 1280, ctx.H / 720), .7, 1.6);
    ctx.S = Math.round(128 * clamp(Math.round(ctx.H / 480 * 2) / 2, 1, 2));
    ctx.pulse = v => { if (!reduced) ctx.pulseV = Math.max(ctx.pulseV, v); };
    ctx.box = (...a) => box(ctx, ...a);
    ctx.makeCreature = makeCreatureFactory(ctx);
    ctx.items = max => {
      const seen = new Set();
      const pref = PREFERRED_KINDS[o.familyId];
      const mine = o.targets.slice().sort((a, b) => (pref.includes(a.kind) ? 0 : 1) - (pref.includes(b.kind) ? 0 : 1));
      const defaults = DEFAULT_LABELS[o.familyId].map(([label, kind]) => ({ label, kind, rect: null }));
      const out = [];
      for (const it of mine.concat(defaults)) {
        if (out.length >= max) break;
        if (!seen.has(it.label)) { seen.add(it.label); out.push(it); }
      }
      return out;
    };

    // Ambience layers.
    const ambience = kid(root, 'left:0;top:0;right:0;bottom:0;opacity:0');
    kid(ambience, 'left:0;top:0;right:0;bottom:0;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 36%,' + pal.vignette + ' 100%),' + pal.under + ',linear-gradient(' + pal.tint + ',' + pal.tint + ')');
    const rays = pal.rays > 0 ? Array.from({ length: 5 }, (_, i) => ({ el: kid(ambience, 'top:-10%;height:130%;width:' + (90 + Math.round(rnd() * 80)) + 'px;left:0;background:linear-gradient(90deg,' + rgb(pal.accent, 0) + ',' + rgb(mix(pal.accent, [255, 255, 255], .6), .55) + ',' + rgb(pal.accent, 0) + ');-webkit-mask-image:linear-gradient(180deg,#000,rgba(0,0,0,0) 85%);mask-image:linear-gradient(180deg,#000,rgba(0,0,0,0) 85%);will-change:transform,opacity;opacity:0'), fx: .1 + i * .2 + rnd() * .08, ph: rnd() * 6 })) : [];
    const bubbles = reduced ? [] : Array.from({ length: pal.bubbles }, () => {
      const s = 4 + Math.round(rnd() * 9);
      return { el: kid(ambience, 'left:0;top:0;width:' + s + 'px;height:' + s + 'px;box-sizing:border-box;border-radius:50%;border:1px solid ' + rgb(pal.accent, .5) + ';background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.35),rgba(255,255,255,0) 70%);will-change:transform'), fx: rnd(), speed: 22 + rnd() * 50, ph: rnd(), sway: 6 + rnd() * 14, sp: 1 + rnd() * 1.5, size: s };
    });
    const motes = Array.from({ length: pal.motes }, () => {
      const s = 3 + Math.round(rnd() * 3);
      return { el: kid(ambience, 'left:0;top:0;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:' + rgb(pal.accent) + ';box-shadow:0 0 ' + n1(6 + 8 * pal.glow) + 'px ' + rgb(pal.accent, .9) + ';will-change:transform,opacity'), fx: rnd(), fy: rnd(), ph: rnd() * 6, dr: 10 + rnd() * 20, size: s };
    });

    ctx.stage = kid(root, 'left:0;top:0;right:0;bottom:0;opacity:0');
    const effect = EFFECTS[o.familyId](ctx);
    const caption = box(ctx, ctx.stage, 460, 30, 'box-sizing:border-box;border-radius:15px;text-align:center;color:' + pal.ink + ';background:' + rgb(pal.panel, .85) + ';border:1px solid ' + rgb(pal.accent, .45) + ';font:600 12px/28px ' + FONT + ';box-shadow:0 0 ' + n1(18 * pal.glow) + 'px ' + rgb(pal.accent, .35), CAPTIONS[o.familyId]);

    const aura = box(ctx, root, 100, 100, 'border-radius:50%;background:radial-gradient(circle,' + rgb(mix(pal.accent, [255, 255, 255], .2), .8) + ',' + rgb(pal.accent, 0) + ' 68%)');
    aura.fxW = aura.fxH = ctx.S * 2.4;
    aura.style.width = aura.style.height = aura.fxW + 'px';
    const ring = box(ctx, root, ctx.S, ctx.S, 'box-sizing:border-box;border-radius:50%;border:3px solid ' + rgb(pal.accent, .9) + ';box-shadow:0 0 ' + n1(20 * pal.glow) + 'px ' + rgb(pal.accent, .7));
    ring.fxU = 1;
    const creature = ctx.makeCreature(root, ctx.S, 1);

    let hoverX = ctx.W * effect.hover[0], hoverY = ctx.H * effect.hover[1];
    let last = [entryRight ? ctx.W + ctx.S : -ctx.S, hoverY];
    let outFrom = null;
    const phase = rnd() * 6.28;
    const marks = [['swim-in', 0], ['strike', tIn], ['effect', tE], ['swim-out', tX]];
    let nextMark = 0;
    let t0 = null;
    let prevT = 0;
    let rafId = null;
    let timer = null;
    let finished = false;

    const emit = (name, t) => {
      if (!o.onEvent) return;
      try { o.onEvent(name, { familyId: o.familyId, depthId: o.depthId, elapsedMs: Math.round(t * 1000) }); } catch (_) { /* host callback errors must not break the sequence */ }
    };

    const frame = t => {
      measure();
      const { W, H } = ctx;
      const dt = clamp(t - prevT, 0, .1);
      prevT = t;
      hoverX = W * effect.hover[0];
      hoverY = H * effect.hover[1];
      const env = Math.min(seg(t, 0, reduced ? .7 : .9), 1 - seg(t, total - 1, total));
      ambience.style.opacity = n3(env);
      rays.forEach(r => {
        const sway = reduced ? 0 : Math.sin(t * .25 + r.ph);
        r.el.style.transform = 'translate3d(' + n1(W * r.fx + sway * 40) + 'px,0,0) rotate(14deg)';
        r.el.style.opacity = n3(pal.rays * (reduced ? .8 : .65 + .35 * Math.sin(t * .4 + r.ph)));
      });
      bubbles.forEach(b => {
        const y = H + 20 - ((t * b.speed + b.ph * (H + 40)) % (H + 40));
        b.el.style.transform = 'translate3d(' + n1(W * b.fx + Math.sin(t * b.sp + b.ph * 6) * b.sway) + 'px,' + n1(y) + 'px,0)';
      });
      motes.forEach(m => {
        const dx = reduced ? 0 : Math.sin(t * .3 + m.ph) * m.dr, dy = reduced ? 0 : Math.cos(t * .23 + m.ph) * m.dr;
        m.el.style.transform = 'translate3d(' + n1(W * m.fx + dx) + 'px,' + n1(H * m.fy + dy) + 'px,0)';
        m.el.style.opacity = n3(.35 + .65 * (reduced ? .6 : .5 + .5 * Math.sin(t * 1.7 + m.ph)));
      });

      // creature path
      const p = seg(t, tE, tX);
      let x, y, scale = 1, co = 1, rot = 0, dirWant = null;
      if (t < tIn) {
        const q = seg(t, 0, tIn);
        if (reduced) { x = hoverX; y = hoverY; co = q; }
        else {
          const e = 1 - Math.pow(1 - q, 2);
          const start = entryRight ? W + ctx.S * .8 : -ctx.S * .8;
          x = lerp(start, hoverX, e);
          y = hoverY + H * .2 * (1 - q) * Math.sin(q * Math.PI * 2.2 + phase) + H * .05 * (1 - q);
        }
      } else if (t < tX) {
        x = hoverX + (reduced ? 0 : Math.sin((t - tIn) * .9) * W * .01);
        y = hoverY + (reduced ? 0 : Math.sin((t - tIn) * 1.3) * H * .012);
        const po = effect.pose && p > 0 ? effect.pose(p, x, y) : null;
        if (po) { x = po.x; y = po.y; scale = po.s != null ? po.s : 1; }
      } else {
        if (!outFrom) outFrom = last.slice();
        const q = seg(t, tX, total);
        if (reduced) { x = outFrom[0]; y = outFrom[1]; co = 1 - seg(q, 0, .8); }
        else {
          x = lerp(outFrom[0], entryRight ? -ctx.S * .8 : W + ctx.S * .8, q * q);
          y = outFrom[1] + Math.sin(q * Math.PI * 1.4) * H * .05 - q * H * .1;
        }
      }
      if (!reduced) y += Math.sin(t * 2.6) * 3;
      if (dt > 0 && !reduced) {
        const vx = (x - last[0]) / dt, vy = (y - last[1]) / dt;
        if (Math.abs(vx) > 25) creature.want = vx > 0 ? 1 : -1;
        const want = clamp(Math.atan2(vy, Math.max(Math.abs(vx), 140)) * 57.3, -18, 18);
        creature.tilt += (want - creature.tilt) * .12;
        creature.face += ((creature.want || (entryRight ? -1 : 1)) - creature.face) * clamp(dt * 14);
      } else if (creature.want == null) creature.face = reduced ? 1 : (entryRight ? -1 : 1);
      last = [x, y];
      ctx.cx = x; ctx.cy = y;
      ctx.pulseV *= Math.exp(-dt * 3.5);
      const face = Math.abs(creature.face) < .08 ? .08 * Math.sign(creature.face || 1) : creature.face;
      creature.draw(x, y, co, creature.tilt * Math.sign(face), face, scale * (1 + .08 * ctx.pulseV));

      // strike ring and aura
      const rs = seg(t, tIn, tIn + .9);
      put(ring, x, y, reduced ? 0 : .6 * (1 - rs) * (rs > 0 ? 1 : 0), 0, lerp(.4, 2.8, easeOut(rs)));
      const aur = (.2 + .45 * ctx.energy + .25 * ctx.pulseV) * seg(t, tIn - .8, tIn) * (1 - seg(t, tX, tX + .9));
      put(aura, x, y, reduced ? aur * .7 : aur, 0, 1 + .06 * Math.sin(t * 2.4));

      // effect
      ctx.stage.style.opacity = n3(seg(t, tE, tE + .3) * (1 - seg(t, tX - .5, tX + .3)));
      if (t >= tE - .1 && t <= tX + .4) {
        effect.update(p, Math.max(0, t - tE), dt);
        put(caption, W * .5, H * .93, seg(p, .05, .15));
      }
    };

    const finish = completed => {
      if (finished) return;
      finished = true;
      if (rafId != null) caf(rafId);
      if (timer != null) global.clearTimeout(timer);
      rafId = timer = null;
      try { container.removeChild(root); } catch (_) { /* container may already have dropped it */ }
      if (current === run) current = null;
      if (completed) {
        emit('done', total);
        if (o.onDone) { try { o.onDone(); } catch (_) { /* host callback errors are ignored */ } }
      }
    };

    const tick = ts => {
      rafId = null;
      if (finished) return;
      if (t0 == null) t0 = ts;
      const t = Math.max(0, (ts - t0) / 1000);
      while (nextMark < marks.length && t >= marks[nextMark][1]) emit(marks[nextMark++][0], t);
      if (t >= total) { finish(true); return; }
      frame(t);
      rafId = raf(tick);
    };

    const run = { stop: () => finish(false) };
    frame(0);
    rafId = raf(tick);
    timer = global.setTimeout(() => finish(true), (total + 2) * 1000);
    return run;
  }

  function play(opts) {
    const o = cleanOptions(opts);
    if (current) current.stop();
    const run = createRun(o);
    current = run;
    return { stop: run.stop };
  }

  // ==== playAttack: the creature breaks through the glass, then one pixel-art animation per attackKind shows what the
  // attack did. The animation advances on world.sandbox.events (kind, label, count, total); without events it plays a
  // self-timed version marked "simulated". Retro look follows ui/abyss/retro-pixel.css (palette, Jersey 10, hard edges).

  const ATTACK_KINDS = Object.freeze(['scareware', 'credential-phish', 'mfa-fatigue', 'oauth-consent', 'mass-mail-worm', 'macro-dropper', 'ransomware-encrypt', 'data-exfil', 'money-transfer', 'wallet-drain', 'supply-chain-update', 'network-worm', 'botnet-ddos', 'account-takeover-post', 'sim-swap', 'spyware-surveillance', 'server-exploit-leak']);
  const SANDBOX_MODES = ['docker', 'vultr', 'simulated'];
  const MAX_EVENTS = 64;
  const MAX_EVENT_LABEL = 60;
  const BREAKTHROUGH_S = 2.6;
  const BREAKTHROUGH_REDUCED_S = .9;
  const BURST_S = 1.75;
  const FALLBACK_AFTER_S = 4;
  const SUMMARY_HOLD_S = 2;
  const OUTRO_S = 1.2;
  const DEFAULT_TIMEOUT_MS = 24000;
  const SPRITE_PATH = /^\/ocean-creatures\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;
  const PIXEL_FONT = '"Jersey 10","Abyss Pixel Arrows",ui-monospace,"Cascadia Mono",Consolas,monospace';
  const FONT_FACE = '@font-face{font-family:"Jersey 10";src:url(/ui/abyss/fonts/Jersey10-Regular.woff) format("woff");font-weight:400;font-display:swap}';
  // retro-pixel.css palette: k/d/s/b/m/a/y/w = --p0..--p8 (dark to light), c = coral, g = gold, r = alert red.
  const PX = { k: '#040a14', d: '#07162a', s: '#12405d', b: '#1d6a82', m: '#35a0ac', a: '#6fe0d4', y: '#b9f4ea', w: '#effcf8', c: '#f08a63', g: '#f4d06a', r: '#e8506a', edge: '#2f7690', hi: '#164a66', lo: '#030a14' };
  const HOT = { a: 'r', b: 'c', y: 'c', m: 'c' };
  const FAMILY_TINT = { deception: { b: 'm' }, intrusion: { b: 'c' }, 'network-abuse': { b: 'a' }, 'trusted-source': { b: 'g' }, 'theft-surveillance': { b: 'r' }, 'extortion-destruction': { b: 'c', a: 'r' } };

  const BITMAPS = {
    file: ['kkkkkk..', 'kwwwwkk.', 'kwwwwwkk', 'kwwwwwwk', 'kwaaaawk', 'kwwwwwwk', 'kwaaaawk', 'kwwwwwwk', 'kwwwwwwk', 'kkkkkkkk'],
    lock: ['..kkkk..', '.kwwwwk.', '.kw..wk.', '.kw..wk.', 'kkkkkkkk', 'kcccccck', 'kccggcck', 'kccggcck', 'kcccccck', 'kkkkkkkk'],
    envelope: ['kkkkkkkkkk', 'kkwwwwwwkk', 'kwkwwwwkwk', 'kwwkkkkwwk', 'kwwwwwwwwk', 'kwwwwwwwwk', 'kkkkkkkkkk'],
    coin: ['..kkk..', '.kgggk.', 'kggwggk', 'kgggggk', 'kgggdgk', '.kgggk.', '..kkk..'],
    phone: ['kkkkkk', 'kyyyyk', 'kyaayk', 'kyaayk', 'kyaayk', 'kyyyyk', 'kyyyyk', 'kyyyyk', 'kkwwkk', 'kkkkkk'],
    eye: ['..kkkkkk..', '.kwwwwwwk.', 'kwwwkkwwwk', 'kwwkrrkwwk', 'kwwwkkwwwk', '.kwwwwwwk.', '..kkkkkk..'],
    card: ['kkkkkkkkkk', 'kwwwwwwwwk', 'kwddwaaawk', 'kwddwwwwwk', 'kwwwwaaawk', 'kwwwwwwwwk', 'kkkkkkkkkk'],
    host: ['kkkkkkkkkk', 'kbbbbbbbbk', 'kbaaaaaabk', 'kbaaaaaabk', 'kbbbbbbbbk', 'kkkkkkkkkk', '...kkkk...', '..kkkkkk..'],
    server: ['kkkkkkkkkk', 'kbbbbbbbbk', 'kbabbbbgbk', 'kkkkkkkkkk', 'kbbbbbbbbk', 'kbabbbbgbk', 'kkkkkkkkkk', 'kbbbbbbbbk', 'kbabbbbgbk', 'kkkkkkkkkk'],
    warning: ['....k....', '...kgk...', '..kgggk..', '..kgrgk..', '.kggrggk.', '.kgggggk.', 'kgggrgggk', 'kkkkkkkkk'],
    chip: ['.k.kk.k.', 'kkkkkkkk', '.kddddk.', 'kkdaadkk', '.kdaadk.', 'kkddddkk', 'kkkkkkkk', '.k.kk.k.'],
    token: ['kkkkkkk', 'kggggwk', 'kgwgggk', 'kggggdk', 'kgggddk', '.kgddk.', '..kdk..', '...k...'],
    person: ['..kkkk..', '.kwwwwk.', '.kwwwwk.', '..kkkk..', '.kkkkkk.', 'kbbbbbbk', 'kbbbbbbk', 'kbbbbbbk', 'kkkkkkkk'],
    wallet: ['kkkkkkkkkk', 'kbbbbbbbbk', 'kbbbbbbbbk', 'kbbbbkkkkk', 'kbbbbkgggk', 'kbbbbkkkkk', 'kbbbbbbbbk', 'kkkkkkkkkk'],
    pkg: ['kkkkkkkkkk', 'kggggkgggk', 'kggggkgggk', 'kkkkkkkkkk', 'kggggggggk', 'kggggggggk', 'kggggggggk', 'kkkkkkkkkk'],
    bubble: ['kkkkkkkkkk', 'kwwwwwwwwk', 'kwaaaaaawk', 'kwwwwwwwwk', 'kwaaaawwwk', 'kkkkkkkkkk', '..kk......', '...k......'],
    record: ['kkkkkkkk', 'kwwwaawk', 'kwwwwwwk', 'kwaaawwk', 'kkkkkkkk'],
    fish: ['......kkkk......', '....kkbbbbkk..kk', '..kkbbbbbbbbkkbk', '.kbwkbbbbbbbbbbk', 'kbbbbbbbbbbbbbbk', 'kkaaaabbbbbbbbbk', '.kkaaaabbbbbbbkk', '..kkaaaaaabbkbk.', '....kkkkkkkk.kk.'],
  };

  const SHADOWS = new Map();
  function pixelShadow(name, ps, tint) {
    const key = name + '|' + ps + '|' + (tint ? JSON.stringify(tint) : '');
    let out = SHADOWS.get(key);
    if (out == null) {
      const list = [];
      BITMAPS[name].forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch !== '.') list.push(x * ps + 'px ' + y * ps + 'px 0 0 ' + PX[(tint && tint[ch]) || ch]);
        }
      });
      out = list.join(',');
      SHADOWS.set(key, out);
    }
    return out;
  }
  const pxBox = (p, edge) => '0 -' + p + 'px 0 0 ' + edge + ',0 ' + p + 'px 0 0 ' + edge + ',-' + p + 'px 0 0 0 ' + edge + ',' + p + 'px 0 0 0 ' + edge + ',inset ' + p + 'px ' + p + 'px 0 0 ' + PX.hi + ',inset -' + p + 'px -' + p + 'px 0 0 ' + PX.lo + ',' + 2 * p + 'px ' + 2 * p + 'px 0 0 rgba(2,6,12,.7)';
  const textShadow = p => p + 'px ' + p + 'px 0 ' + PX.k;

  // Pixel-snapped counterpart of put(): the node centre goes to x,y on the art-pixel grid.
  function place(k, el, x, y, o = 1, rot = 0, sx = 1, sy = sx) {
    const p = k.px;
    const tx = Math.round((x - el.fxW / 2) / p) * p;
    const ty = Math.round((y - el.fxH / 2) / p) * p;
    el.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)' + (rot ? ' rotate(' + n1(rot) + 'deg)' : '') + (sx !== 1 || sy !== 1 ? ' scale(' + n3(sx) + ',' + n3(sy) + ')' : '');
    el.style.opacity = n3(clamp(o));
  }

  function makeToolkit(k) {
    k.X = v => k.W * v;
    k.Y = v => k.H * v;
    k.at = (el, ...a) => place(k, el, ...a);
    k.fs = m => Math.round(4.6667 * m * k.px);
    k.icon = (name, scale = 1, tint = null) => {
      const ps = Math.max(1, Math.round(k.px * scale));
      const rows = BITMAPS[name];
      const el = box(k, k.stage, rows[0].length * ps, rows.length * ps, '');
      const dot = kid(el, 'left:0;top:0;width:' + ps + 'px;height:' + ps + 'px');
      el.tint = t => { dot.style.boxShadow = pixelShadow(name, ps, t); };
      el.tint(tint);
      return el;
    };
    // Bitmap embedded in a panel or other parent node (not placed on its own).
    k.iconIn = (parent, name, scale, left, top, tint) => {
      const ps = Math.max(1, Math.round(k.px * scale));
      const dot = kid(parent, 'left:' + left + 'px;top:' + top + 'px;width:' + ps + 'px;height:' + ps + 'px');
      dot.style.boxShadow = pixelShadow(name, ps, tint);
      return dot;
    };
    k.txt = (str, w, m, color, align) => {
      const size = k.fs(m);
      const h = Math.round(size * 1.15);
      const el = box(k, k.stage, w, h, 'font:400 ' + size + 'px/' + h + 'px ' + PIXEL_FONT + ';color:' + color + ';text-align:' + (align || 'center') + ';white-space:nowrap;-webkit-font-smoothing:none;text-shadow:' + textShadow(k.px), str);
      el.set = s => { if (el.textContent !== s) el.textContent = s; };
      return el;
    };
    k.kt = (parent, str, left, top, m, color) => kid(parent, 'left:' + left + 'px;top:' + top + 'px;font:400 ' + k.fs(m) + 'px/1.1 ' + PIXEL_FONT + ';color:' + color + ';white-space:nowrap;-webkit-font-smoothing:none;text-shadow:' + textShadow(k.px), str);
    k.panel = (w, h, edge) => {
      const el = box(k, k.stage, w, h, 'background:' + PX.d + ';box-shadow:' + pxBox(k.px, edge || PX.edge));
      el.edge = c => { el.style.boxShadow = pxBox(k.px, c); };
      return el;
    };
    k.rect = (w, h, color) => box(k, k.stage, w, h, 'background:' + color);
    // Dashed pixel line from (x1,y1) to (x2,y2).
    k.line = () => {
      const el = box(k, k.stage, 100, k.px, '');
      el.style.transformOrigin = '0 50%';
      el.set = (x1, y1, x2, y2, o, color) => {
        el.style.width = Math.round(Math.hypot(x2 - x1, y2 - y1)) + 'px';
        el.style.background = 'repeating-linear-gradient(90deg,' + color + ' 0 ' + 2 * k.px + 'px,transparent ' + 2 * k.px + 'px ' + 4 * k.px + 'px)';
        el.style.transform = 'translate3d(' + Math.round(x1) + 'px,' + Math.round(y1 - k.px / 2) + 'px,0) rotate(' + n1(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) + 'deg)';
        el.style.opacity = n3(clamp(o));
      };
      return el;
    };
    k.slots = n => { k.n = n; k.act = new Array(n).fill(null); };
    k.on = i => k.act[i] != null && k.t >= k.act[i];
    k.q = (i, dur = .9) => (!k.on(i) ? 0 : k.reduced ? 1 : seg(k.t - k.act[i], 0, dur));
    k.once = key => (k.seen.has(key) ? false : (k.seen.add(key), true));
    k.arc = (a, b, q, lift) => [bez(a[0], (a[0] + b[0]) / 2, b[0], q), bez(a[1], Math.min(a[1], b[1]) - lift, b[1], q)];
    // Labels from the host's targets of one kind, topped up with fixed defaults.
    k.names = (kind, defaults, n) => {
      const own = k.targets.filter(t => t.kind === kind).map(t => t.label.slice(0, 16));
      return own.concat(defaults).slice(0, n || defaults.length);
    };
    return k;
  }

  // ---- one animation per attackKind. build(k) returns { hover:[fx,fy], draw(t) }; draw runs each frame, t = seconds
  // since the breakthrough ended. k.on(i) / k.q(i) say whether slot i is active and how far its flight has gone.

  const ATTACKS = {};
  const attack = (kind, meta, build) => { ATTACKS[kind] = { ...meta, build }; };
  const money = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  attack('scareware', { title: 'SCAREWARE: FAKE ALERTS MULTIPLY', unit: 'alerts', evKind: 'alert-shown', total: 12, labels: ['virus-found', 'disk-failing', 'call-support', 'update-now'] }, k => {
    const n = 12;
    k.slots(n);
    const p = k.px;
    const wins = Array.from({ length: n }, (_, i) => {
      const win = k.panel(p * 46, p * 30, PX.r);
      kid(win, 'left:0;top:0;right:0;height:' + p * 6 + 'px;background:' + PX.r);
      k.kt(win, 'SYSTEM ALERT', p * 2, p * 1, .75, PX.w).style.textShadow = 'none';
      k.iconIn(win, 'warning', 1.5, p * 3, p * 9);
      k.kt(win, 'VIRUS FOUND!', p * 18, p * 9, .85, PX.g);
      k.kt(win, 'CALL 555-0100', p * 18, p * 17, .7, PX.y);
      return { win, x: .14 + k.rnd() * .5, y: .13 + k.rnd() * .4 + i * .004 };
    });
    return {
      hover: [.88, .2],
      draw() {
        wins.forEach((w, i) => {
          const q = k.q(i, .35);
          const s = k.reduced ? 1 : .6 + .4 * Math.min(1, q * 2);
          k.at(w.win, k.X(w.x), k.Y(w.y), q > 0 ? 1 : 0, 0, s);
          if (q >= 1 && k.once('w' + i)) k.pulse();
        });
      },
    };
  });

  attack('credential-phish', { title: 'PHISHING: CREDENTIALS CAPTURED', unit: 'credentials', evKind: 'credential-captured', total: 3, labels: ['j.doe@corp.example', 'a.lee@mail.example', 'm.ruiz@work.example'] }, k => {
    const who = k.names('account', ['j.doe@corp.example', 'a.lee@mail.example', 'm.ruiz@work.example'], 3);
    k.slots(3);
    const rows = who.map(label => ({ card: k.icon('card', 3), label: k.txt(label, k.px * 56, .75, PX.y), pw: k.txt('pw: ********', k.px * 40, .7, PX.m) }));
    return {
      hover: [.72, .4],
      draw(t) {
        rows.forEach((r, i) => {
          const x = k.X(.2), y = k.Y(.3 + i * .18);
          const show = seg(t, .1 + .15 * i, .4 + .15 * i);
          const q = easeOut(k.q(i, 1));
          const [fx, fy] = k.reduced ? [x, y] : k.arc([x, y], [k.cx, k.cy], q, k.H * .12);
          const gone = k.reduced ? (q > 0 ? 1 : 0) : seg(q, .9, 1);
          k.at(r.card, fx, fy, show * (1 - gone), 0, 1 - .6 * q);
          k.at(r.label, x, y + k.px * 14, show * (q > 0 ? 0 : 1));
          k.at(r.pw, x, y + k.px * 20, show * (q > 0 ? 0 : 1));
          if (q >= 1 && k.once('c' + i)) k.pulse();
        });
      },
    };
  });

  attack('mfa-fatigue', { title: 'MFA FATIGUE: PUSH PROMPTS STACK UP', unit: 'prompts', evKind: 'prompt-sent', total: 30, labels: ['push-denied', 'push-ignored', 'push-denied', 'push-approved'] }, k => {
    const n = 8;
    k.slots(n);
    const p = k.px;
    const phone = k.icon('phone', 6);
    const cards = Array.from({ length: n }, (_, i) => {
      const c = k.panel(p * 52, p * 15, PX.edge);
      const head = k.kt(c, 'Approve sign-in? #' + (i + 1), p * 3, p * 2, .75, PX.w);
      kid(c, 'left:' + p * 3 + 'px;top:' + p * 9 + 'px;width:' + p * 18 + 'px;height:' + p * 4 + 'px;background:' + PX.s);
      const yes = kid(c, 'left:' + p * 26 + 'px;top:' + p * 9 + 'px;width:' + p * 22 + 'px;height:' + p * 4 + 'px;background:' + PX.a);
      return { c, head, yes };
    });
    return {
      hover: [.86, .14],
      draw(t) {
        const shake = k.reduced ? 0 : Math.sin(t * 9) * k.px * seg(k.f, 0, .1);
        k.at(phone, k.X(.26) + shake, k.Y(.46), seg(t, 0, .3));
        cards.forEach((c, i) => {
          const q = k.q(i, .4);
          const last = i === n - 1 && q >= 1 && k.f >= 1;
          k.at(c.c, k.X(.6) + (k.reduced ? 0 : (1 - easeOut(q)) * k.px * 40) + (i % 2) * k.px * 3, k.Y(.2) + i * k.px * 9, q);
          if (last) {
            c.c.edge(PX.c);
            c.head.textContent = 'APPROVED (tired user)';
            c.yes.style.background = PX.c;
          }
          if (q >= 1 && k.once('m' + i)) k.pulse();
        });
      },
    };
  });

  attack('oauth-consent', { title: 'OAUTH: CONSENT GRANTED, TOKEN HANDED OVER', unit: 'scopes', evKind: 'token-granted', total: 4, labels: ['read mail', 'see contacts', 'stay signed in', 'send as you'] }, k => {
    const p = k.px;
    k.slots(5);
    const dlg = k.panel(p * 72, p * 68, PX.edge);
    k.kt(dlg, 'Allow "Calendar Helper"?', p * 4, p * 3, .85, PX.w);
    const rows = ['read your mail', 'see contacts', 'stay signed in', 'send as you'].map((label, i) => {
      k.kt(dlg, label, p * 4, p * (15 + i * 11), .75, PX.y);
      const track = kid(dlg, 'left:' + p * 52 + 'px;top:' + p * (15 + i * 11) + 'px;width:' + p * 14 + 'px;height:' + p * 7 + 'px;background:' + PX.s);
      const knob = kid(track, 'left:' + p + 'px;top:' + p + 'px;width:' + p * 5 + 'px;height:' + p * 5 + 'px;background:' + PX.w);
      return { track, knob };
    });
    const token = k.icon('token', 3);
    return {
      hover: [.78, .36],
      draw(t) {
        k.at(dlg, k.X(.3), k.Y(.44), seg(t, 0, .3));
        rows.forEach((r, i) => {
          const on = k.q(i, .3) >= .5;
          r.track.style.background = on ? PX.c : PX.s;
          r.knob.style.transform = on ? 'translateX(' + p * 7 + 'px)' : 'none';
        });
        const q = easeOut(k.q(4, 1.1));
        const a = [k.X(.3), k.Y(.44)];
        const [x, y] = k.reduced ? [k.cx, k.cy + k.px * 14] : k.arc(a, [k.cx, k.cy], q, k.H * .2);
        k.at(token, x, y, q > 0 ? 1 - seg(q, .92, 1) : 0, 0, 1 - .4 * q);
        if (q >= 1 && k.once('t')) k.pulse();
      },
    };
  });

  attack('mass-mail-worm', { title: 'MAIL WORM: INFECTED MAIL FANS OUT', unit: 'mails', evKind: 'mail-sent', total: 48, labels: ['to ana@contacts.example', 'to ben@contacts.example', 'to cy@contacts.example', 'to dee@contacts.example'] }, k => {
    const n = 8;
    k.slots(n);
    const names = k.names('account', ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'], n);
    const src = k.icon('envelope', 4, HOT);
    const chips = names.map((name, i) => ({ person: k.icon('person', 1.5), name: k.txt(name, k.px * 24, .7, PX.y), mail: k.icon('envelope', 1), fly: k.icon('envelope', 1.5, HOT) }));
    const spot = i => [k.X(.52 + (i % 2) * .2), k.Y(.22 + Math.floor(i / 2) * .15)];
    return {
      hover: [.34, .16],
      draw(t) {
        const sx = k.X(.18), sy = k.Y(.46);
        k.at(src, sx, sy, seg(t, 0, .3));
        chips.forEach((c, i) => {
          const [x, y] = spot(i);
          const show = seg(t, .05 + .04 * i, .25 + .04 * i);
          const q = easeOut(k.q(i, .9));
          const hit = q >= 1;
          c.person.tint(hit ? HOT : null);
          k.at(c.person, x, y, show);
          k.at(c.name, x, y + k.px * 11, show);
          k.at(c.mail, x + k.px * 9, y - k.px * 6, hit ? 1 : 0);
          const [fx, fy] = k.arc([sx, sy], [x, y], q, k.H * .18);
          k.at(c.fly, fx, fy, !k.reduced && q > 0 && q < 1 ? 1 : 0);
          if (hit && k.once('e' + i)) k.pulse();
        });
      },
    };
  });

  attack('macro-dropper', { title: 'MACRO DROPPER: DOCUMENT SPAWNS A PAYLOAD', unit: 'processes', evKind: 'process-spawned', total: 4, labels: ['doc-viewer', 'script-host', 'stage2.tmp', 'beacon.invalid'] }, k => {
    const p = k.px;
    k.slots(4);
    const doc = k.icon('file', 5);
    const banner = k.panel(p * 54, p * 12, PX.g);
    k.kt(banner, 'ENABLE MACROS', p * 4, p * 2.5, .9, PX.g);
    const names = ['doc-viewer', 'script-host', 'stage2.tmp', 'beacon.invalid'];
    const procs = names.map(name => {
      const c = k.panel(p * 38, p * 17, PX.edge);
      k.iconIn(c, 'chip', 1.5, p * 2, p * 2);
      k.kt(c, name, p * 2, p * 11, .6, PX.y);
      return { c, link: k.line() };
    });
    return {
      hover: [.5, .16],
      draw(t) {
        const dx = k.X(.2), dy = k.Y(.42);
        k.at(doc, dx, dy, seg(t, 0, .3));
        const armed = k.f > 0;
        banner.edge(armed ? PX.r : PX.g);
        k.at(banner, dx, k.Y(.68), seg(t, .1, .4));
        procs.forEach((pr, i) => {
          const x = k.X(.42 + i * .16), y = k.Y(.42), q = k.q(i, .5);
          const px0 = i === 0 ? dx + k.px * 22 : k.X(.42 + (i - 1) * .16) + k.px * 19;
          k.at(pr.c, x, y, q, 0, k.reduced ? 1 : .7 + .3 * q);
          pr.link.set(px0, y, x - k.px * 19, y, q > .3 ? .9 : 0, armed ? PX.c : PX.edge);
          if (q >= 1 && k.once('p' + i)) k.pulse();
        });
      },
    };
  });

  attack('ransomware-encrypt', { title: 'RANSOMWARE: FILES ENCRYPTED', unit: 'files', evKind: 'file-encrypted', total: 40, labels: ['report.docx', 'photos.zip', 'ledger.xlsx', 'notes.txt', 'backup.img'] }, k => {
    const names = k.names('file', ['report.docx', 'photos.zip', 'ledger.xlsx', 'notes.txt', 'backup.img', 'invoice.pdf', 'budget.xlsx', 'family.zip', 'todo.md', 'deck.pptx', 'taxes.pdf', 'music.mp3'], 12);
    k.slots(12);
    const cells = names.map(name => ({ name, file: k.icon('file', 2), lock: k.icon('lock', 2), label: k.txt(name, k.px * 34, .7, PX.y) }));
    const beam = k.line();
    return {
      hover: [.82, .3],
      draw(t) {
        let hot = null;
        cells.forEach((c, i) => {
          const x = k.X(.16 + (i % 4) * .13), y = k.Y(.24 + Math.floor(i / 4) * .19);
          const show = seg(t, .05 + .04 * i, .3 + .04 * i);
          const q = k.q(i, .7);
          const locked = q >= .5;
          const sx = k.reduced ? 1 : Math.max(.06, Math.abs(Math.cos(Math.PI * q)));
          k.at(c.file, x, y, locked ? 0 : show, 0, sx, 1);
          k.at(c.lock, x, y, locked ? show : 0, 0, sx, 1);
          k.at(c.label, x, y + k.px * 14, show);
          c.label.set(locked ? c.name + '.lock' : c.name);
          if (q > 0 && q < 1) hot = [x, y];
          if (q >= 1 && k.once('f' + i)) k.pulse();
        });
        if (hot && !k.reduced) beam.set(k.cx, k.cy, hot[0], hot[1], .7, PX.r);
        else beam.set(0, 0, 0, 0, 0, PX.r);
      },
    };
  });

  attack('data-exfil', { title: 'DATA THEFT: RECORDS STREAM OUT', unit: 'records', evKind: 'record-exfiltrated', total: 240, labels: ['customers.db', 'orders.db', 'contacts.db', 'payroll.db'] }, k => {
    const n = 12;
    k.slots(n);
    const src = k.icon('server', 3);
    const sink = k.icon('server', 3);
    const sinkName = k.txt('sink.invalid', k.px * 40, .75, PX.c);
    const srcName = k.txt('db.corp.example', k.px * 50, .75, PX.y);
    const pipe = k.rect(k.W, k.px * 3, PX.s);
    const recs = Array.from({ length: n }, () => k.icon('record', 1.5));
    const beam = k.line();
    return {
      hover: [.5, .2],
      draw(t) {
        const ax = k.X(.18), bx = k.X(.82), y = k.Y(.46);
        k.at(src, ax, y, seg(t, 0, .3));
        k.at(srcName, ax, y + k.px * 24, seg(t, 0, .3));
        sink.tint(k.f > .4 ? HOT : null);
        k.at(sink, bx, y, seg(t, .1, .4));
        k.at(sinkName, bx, y + k.px * 24, seg(t, .1, .4));
        pipe.style.width = Math.round(bx - ax - k.px * 36) + 'px';
        pipe.fxW = bx - ax - k.px * 36;
        k.at(pipe, (ax + bx) / 2, y, seg(t, .1, .4) * .8);
        recs.forEach((r, i) => {
          const q = k.q(i, 1.1);
          const u = k.reduced ? 1 : easeOut(q);
          k.at(r, lerp(ax + k.px * 20, bx - k.px * 20, u), y + Math.sin(u * Math.PI * 2) * k.px * 3, !k.reduced && q > 0 && q < 1 ? 1 : 0);
        });
        beam.set(k.cx, k.cy, k.X(.5), y, k.f > 0 && !k.reduced ? .5 : 0, PX.m);
      },
    };
  });

  attack('money-transfer', { title: 'FRAUD: MONEY MOVES TO THE CREATURE', unit: 'transfers', evKind: 'transfer-posted', total: 6, labels: ['transfer #1', 'transfer #2', 'transfer #3', 'transfer #4'] }, k => {
    const p = k.px;
    k.slots(6);
    const acct = k.panel(p * 62, p * 52, PX.edge);
    k.kt(acct, 'DEMO ACCOUNT', p * 4, p * 3, .8, PX.y);
    const bal = k.kt(acct, '12,400', p * 4, p * 13, 1.6, PX.g);
    const last = k.kt(acct, 'no transfers', p * 4, p * 33, .7, PX.m);
    k.kt(acct, 'demo coins only', p * 4, p * 42, .6, PX.m);
    const coins = Array.from({ length: 6 }, () => k.icon('coin', 2));
    const sink = k.txt('mule-acct.example', k.px * 50, .75, PX.c);
    return {
      hover: [.74, .36],
      draw(t) {
        const ax = k.X(.22), ay = k.Y(.42);
        k.at(acct, ax, ay, seg(t, 0, .3));
        bal.textContent = money(12400 * (1 - k.f));
        last.textContent = k.label ? k.label.slice(0, 24) : 'no transfers';
        k.at(sink, k.cx, k.cy + k.px * 28, seg(t, .2, .5));
        coins.forEach((c, i) => {
          const q = easeOut(k.q(i, 1));
          const [x, y] = k.arc([ax + k.px * 10, ay], [k.cx, k.cy], q, k.H * .16);
          k.at(c, x, y, !k.reduced && q > 0 && q < 1 ? 1 : 0, 0, 1 - .3 * q);
          if (q >= 1 && k.once('m' + i)) k.pulse();
        });
      },
    };
  });

  attack('wallet-drain', { title: 'WALLET DRAIN: COINS LEAVE THE WALLET', unit: 'coins', evKind: 'transfer-posted', total: 10, labels: ['approve all', 'transfer #1', 'transfer #2', 'transfer #3'] }, k => {
    const n = 10;
    k.slots(n);
    const wallet = k.icon('wallet', 5);
    const addr = k.txt('wallet 0x00..e4', k.px * 50, .75, PX.y);
    const stock = k.txt('3.20 demo', k.px * 34, .85, PX.g);
    const coins = Array.from({ length: n }, () => k.icon('coin', 1.5));
    return {
      hover: [.76, .28],
      draw(t) {
        const wx = k.X(.24), wy = k.Y(.5);
        k.at(wallet, wx, wy, seg(t, 0, .3));
        k.at(addr, wx, wy + k.px * 26, seg(t, 0, .3));
        stock.set((3.2 * (1 - k.f)).toFixed(2) + ' demo');
        k.at(stock, wx, wy - k.px * 44, seg(t, .1, .4));
        coins.forEach((c, i) => {
          const sx = wx - k.px * 20 + (i % 5) * k.px * 10, sy = wy - k.px * 14 - Math.floor(i / 5) * k.px * 8;
          const q = easeOut(k.q(i, 1.1));
          const [x, y] = k.arc([sx, sy], [k.cx, k.cy], q, k.H * .3);
          const stay = seg(t, .1 + .03 * i, .3 + .03 * i);
          k.at(c, q > 0 ? x : sx, q > 0 ? y : sy, q > 0 ? (k.reduced || q >= 1 ? 0 : 1) : stay, 0, 1 - .3 * q);
          if (q >= 1 && k.once('d' + i)) k.pulse();
        });
      },
    };
  });

  attack('supply-chain-update', { title: 'SUPPLY CHAIN: A TRUSTED UPDATE IS POISONED', unit: 'hosts', evKind: 'update-installed', total: 6, labels: ['vendor update 4.2', 'client-a updated', 'client-b updated'] }, k => {
    const n = 6;
    k.slots(n);
    const vendor = k.icon('server', 3);
    const vName = k.txt('vendor.example', k.px * 44, .75, PX.y);
    const pkg = k.icon('pkg', 3);
    const pName = k.txt('update 4.2', k.px * 36, .75, PX.g);
    const tie = k.line();
    const clients = Array.from({ length: n }, (_, i) => ({ host: k.icon('host', 2), copy: k.icon('pkg', 1.5, HOT), name: k.txt('client-' + String.fromCharCode(97 + i), k.px * 30, .65, PX.y) }));
    return {
      hover: [.72, .15],
      draw(t) {
        const vx = k.X(.14), vy = k.Y(.26), gx = k.X(.4), gy = k.Y(.26);
        const poisoned = k.f > 0;
        k.at(vendor, vx, vy, seg(t, 0, .3));
        k.at(vName, vx, vy + k.px * 24, seg(t, 0, .3));
        pkg.tint(poisoned ? HOT : null);
        k.at(pkg, gx, gy, seg(t, .2, .5));
        k.at(pName, gx, gy + k.px * 20, seg(t, .2, .5));
        tie.set(vx + k.px * 24, vy, gx - k.px * 20, gy, seg(t, .2, .5) * .8, poisoned ? PX.r : PX.m);
        clients.forEach((c, i) => {
          const x = k.X(.14 + i * .144), y = k.Y(.64);
          const show = seg(t, .3 + .05 * i, .5 + .05 * i);
          const q = easeOut(k.q(i, 1));
          c.host.tint(q >= 1 ? HOT : null);
          k.at(c.host, x, y, show);
          k.at(c.name, x, y + k.px * 18, show);
          const [fx, fy] = k.arc([gx, gy], [x, y], q, k.H * .1);
          k.at(c.copy, fx, fy, !k.reduced && q > 0 && q < 1 ? 1 : 0);
          if (q >= 1 && k.once('s' + i)) k.pulse();
        });
      },
    };
  });

  attack('network-worm', { title: 'NETWORK WORM: HOSTS LIGHT UP', unit: 'hosts', evKind: 'host-infected', total: 24, labels: ['10.0.0.12', '10.0.0.31', '10.0.0.47', '10.0.0.58'] }, k => {
    const cols = 6, rows = 4, n = cols * rows;
    k.slots(n);
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (a % cols + Math.floor(a / cols)) - (b % cols + Math.floor(b / cols)) || a - b);
    const hosts = order.map(() => ({ host: k.icon('host', 1.5), ring: box(k, k.stage, k.px * 16, k.px * 16, 'box-sizing:border-box;border:' + k.px + 'px solid ' + PX.r) }));
    return {
      hover: [.88, .16],
      draw(t) {
        hosts.forEach((h, i) => {
          const cell = order[i];
          const x = k.X(.14 + (cell % cols) * .1), y = k.Y(.26 + Math.floor(cell / cols) * .14);
          const q = k.q(i, .8);
          h.host.tint(q > .2 ? HOT : null);
          k.at(h.host, x, y, seg(t, .02 * i, .02 * i + .25));
          k.at(h.ring, x, y, !k.reduced && q > 0 && q < 1 ? 1 - q : 0, 0, 1 + q * 1.4);
          if (q >= 1 && k.once('h' + i)) k.pulse();
        });
      },
    };
  });

  attack('botnet-ddos', { title: 'BOTNET: DEVICES FLOOD THE TARGET', unit: 'devices', evKind: 'device-enrolled', total: 10, labels: ['device-01', 'device-02', 'device-03', 'device-04'] }, k => {
    const n = 10;
    k.slots(n);
    const devs = Array.from({ length: n }, (_, i) => ({ icon: k.icon(i % 2 ? 'phone' : 'host', 1.5), pk: [k.rect(k.px * 2, k.px * 2, PX.c), k.rect(k.px * 2, k.px * 2, PX.g)] }));
    const target = k.icon('server', 4);
    const tName = k.txt('target.example', k.px * 44, .75, PX.y);
    const meter = k.panel(k.px * 44, k.px * 7, PX.edge);
    const fill = kid(meter, 'left:' + k.px + 'px;top:' + k.px + 'px;height:' + k.px * 5 + 'px;width:0;background:' + PX.r);
    return {
      hover: [.46, .12],
      draw(t, dt) {
        const tx = k.X(.7), ty = k.Y(.46);
        const hit = k.f > .5;
        target.tint(hit ? HOT : null);
        const jig = hit && !k.reduced ? (Math.floor(t * 12) % 2 ? k.px : -k.px) : 0;
        k.at(target, tx + jig, ty, seg(t, 0, .3));
        k.at(tName, tx, ty + k.px * 26, seg(t, 0, .3));
        k.at(meter, tx, ty - k.px * 28, seg(t, 0, .3));
        fill.style.width = Math.round(k.f * 42) * k.px + 'px';
        devs.forEach((d, i) => {
          const x = k.X(.1 + (i % 2) * .08), y = k.Y(.14 + i * .06);
          const live = k.on(i);
          d.icon.tint(live ? HOT : null);
          k.at(d.icon, x, y, seg(t, .02 * i, .02 * i + .25), 0, live && !k.reduced ? 1 + .1 * Math.sin(t * 6 + i) : 1);
          d.pk.forEach((pk, j) => {
            const u = k.reduced ? .5 : frac(t * 1.2 + i * .31 + j * .5);
            k.at(pk, lerp(x + k.px * 8, tx - k.px * 22, u), lerp(y, ty, u), live ? 1 : 0);
          });
        });
      },
    };
  });

  attack('account-takeover-post', { title: 'ACCOUNT TAKEOVER: A POST GOES OUT', unit: 'followers', evKind: 'post-published', total: 120, labels: ['post published', 'shared 14 times', 'followers reached'] }, k => {
    const p = k.px;
    const n = 8;
    k.slots(n);
    const text = 'free coins! link.example/win';
    const prof = k.panel(p * 70, p * 56, PX.edge);
    k.iconIn(prof, 'person', 3, p * 4, p * 4);
    k.kt(prof, 'sam.rivera', p * 32, p * 5, .9, PX.w);
    k.kt(prof, '(hijacked)', p * 32, p * 13, .7, PX.c);
    const body = k.kt(prof, '', p * 4, p * 32, .75, PX.y);
    const stamp = k.kt(prof, 'PUBLISHED', p * 40, p * 45, .8, PX.c);
    const fans = Array.from({ length: n }, () => ({ person: k.icon('person', 1.5), post: k.icon('bubble', 1), fly: k.icon('bubble', 1.5, HOT) }));
    return {
      hover: [.5, .12],
      draw(t) {
        const ax = k.X(.24), ay = k.Y(.42);
        k.at(prof, ax, ay, seg(t, 0, .3));
        const typed = k.reduced ? text.length : Math.floor(text.length * seg(t, .3, 1.6));
        body.textContent = text.slice(0, typed);
        stamp.style.opacity = k.f > 0 ? '1' : '0';
        fans.forEach((f, i) => {
          const x = k.X(.56 + (i % 2) * .16), y = k.Y(.2 + Math.floor(i / 2) * .15);
          const q = easeOut(k.q(i, .9));
          f.person.tint(q >= 1 ? HOT : null);
          k.at(f.person, x, y, seg(t, .05 + .04 * i, .25 + .04 * i));
          k.at(f.post, x + k.px * 9, y - k.px * 6, q >= 1 ? 1 : 0);
          const [fx, fy] = k.arc([ax + k.px * 20, ay], [x, y], q, k.H * .15);
          k.at(f.fly, fx, fy, !k.reduced && q > 0 && q < 1 ? 1 : 0);
          if (q >= 1 && k.once('a' + i)) k.pulse();
        });
      },
    };
  });

  attack('sim-swap', { title: 'SIM SWAP: YOUR NUMBER MOVES', unit: 'digits', evKind: 'number-ported', total: 10, labels: ['port request', 'carrier verified', 'number ported'] }, k => {
    const digits = '5550100123'.split('');
    k.slots(digits.length);
    const mine = k.icon('phone', 5);
    const theirs = k.icon('phone', 5, { a: 'c', y: 'g' });
    const status = k.txt('SIGNAL OK', k.px * 40, .8, PX.a);
    const owner = k.txt('NO SERVICE', k.px * 40, .8, PX.c);
    const dMine = digits.map(d => k.txt(d, k.px * 6, 1.2, PX.w));
    const dTheirs = digits.map(d => k.txt(d, k.px * 6, 1.2, PX.c));
    const slotX = (cx, i) => cx + (i - 4.5) * k.px * 7;
    return {
      hover: [.5, .3],
      draw(t) {
        const lx = k.X(.25), rx = k.X(.75), y = k.Y(.54), ny = k.Y(.24);
        k.at(mine, lx, y, seg(t, 0, .3));
        k.at(theirs, rx, y, seg(t, .1, .4));
        const lost = k.f >= .9;
        k.at(status, lx, y + k.px * 34, seg(t, 0, .3) * (lost ? 0 : 1));
        k.at(owner, lx, y + k.px * 34, lost ? 1 : 0);
        digits.forEach((d, i) => {
          const q = easeOut(k.q(i, .9));
          const a = [slotX(lx, i), ny], b = [slotX(rx, i), ny];
          const [x, y2] = k.reduced ? b : k.arc(a, b, q, k.H * .1);
          k.at(dMine[i], a[0], a[1], seg(t, 0, .3) * (q > 0 ? .2 : 1));
          k.at(dTheirs[i], x, y2, q > 0 ? 1 : 0);
          if (q >= 1 && k.once('n' + i)) k.pulse();
        });
      },
    };
  });

  attack('spyware-surveillance', { title: 'SPYWARE: EVERY APP IS WATCHED', unit: 'apps', evKind: 'app-watched', total: 6, labels: ['mail watched', 'chat watched', 'files watched', 'web watched'] }, k => {
    const n = 6;
    k.slots(n);
    const p = k.px;
    const apps = k.names('window', ['Mail', 'Chat', 'Files', 'Web', 'Notes', 'Calendar'], n);
    const tiles = apps.map(name => ({ tile: k.panel(p * 22, p * 22, PX.edge), eye: k.icon('eye', 2), name: k.txt(name, p * 26, .75, PX.y) }));
    tiles.forEach((tl, i) => k.kt(tl.tile, apps[i].slice(0, 1).toUpperCase(), p * 8, p * 5, 1.6, PX.m));
    const scan = k.rect(k.px * 2, k.H * .3, PX.a);
    return {
      hover: [.5, .17],
      draw(t) {
        tiles.forEach((tl, i) => {
          const x = k.X(.17 + i * .132), y = k.Y(.5);
          const q = k.q(i, .4);
          tl.tile.edge(q > 0 ? PX.r : PX.edge);
          k.at(tl.tile, x, y, seg(t, .04 * i, .04 * i + .25));
          k.at(tl.name, x, y + k.px * 17, seg(t, .04 * i, .04 * i + .25));
          const blink = !k.reduced && frac(t * .4 + i * .17) > .94 ? .2 : 1;
          const pop = k.reduced ? 1 : .5 + .5 * Math.min(1, q * 1.5);
          k.at(tl.eye, x, y, q, 0, pop, pop * blink);
          if (q >= 1 && k.once('y' + i)) k.pulse();
        });
        k.at(scan, k.X(.1 + .8 * frac(t * .3)), k.Y(.5), k.reduced || k.f <= 0 ? 0 : .25);
      },
    };
  });

  attack('server-exploit-leak', { title: 'SERVER EXPLOIT: RECORDS BLEED OUT', unit: 'records', evKind: 'record-leaked', total: 60, labels: ['customers row', 'orders row', 'sessions row', 'invoices row'] }, k => {
    const n = 12;
    k.slots(n);
    const rack = k.icon('server', 5);
    const name = k.txt('app.corp.example', k.px * 50, .75, PX.y);
    const cracks = Array.from({ length: 6 }, () => k.rect(k.px * 3, k.px * 3, PX.k));
    const recs = Array.from({ length: n }, () => k.icon('record', 1.5));
    const drips = Array.from({ length: 4 }, () => k.rect(k.px, k.px * 2, PX.r));
    return {
      hover: [.78, .34],
      draw(t) {
        const sx = k.X(.28), sy = k.Y(.46);
        rack.tint(k.f > .3 ? HOT : null);
        k.at(rack, sx, sy, seg(t, 0, .3));
        k.at(name, sx, sy + k.px * 30, seg(t, 0, .3));
        cracks.forEach((c, i) => k.at(c, sx - k.px * 4 + (i % 2) * k.px * 3 + i * k.px * 3, sy - k.px * 20 + i * k.px * 7, k.f > i / cracks.length ? 1 : 0));
        drips.forEach((d, i) => k.at(d, sx + k.px * (6 + i * 5), sy + k.px * 10 + (k.reduced ? 0 : frac(t * .8 + i * .27) * k.px * 14), k.f > 0 ? .9 : 0));
        recs.forEach((r, i) => {
          const q = easeOut(k.q(i, 1.1));
          const [x, y] = k.arc([sx + k.px * 10, sy], [k.cx, k.cy], q, k.H * .14);
          k.at(r, x, y, !k.reduced && q > 0 && q < 1 ? 1 : 0);
          if (q >= 1 && k.once('r' + i)) k.pulse();
        });
      },
    };
  });

  // ---- playAttack validation

  function cleanEventText(value, max) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  }
  const eventCount = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e9) : null);

  function cleanSandboxEvent(e, index) {
    if (!e || typeof e !== 'object') return null;
    const kind = cleanEventText(e.kind, 40);
    const label = cleanEventText(e.label, MAX_EVENT_LABEL);
    if (!kind && !label) return null;
    const seq = typeof e.seq === 'number' && Number.isFinite(e.seq) ? Math.floor(e.seq) : index;
    return { seq, kind, label, count: eventCount(e.count), total: eventCount(e.total) };
  }

  function cleanSprite(creature) {
    const src = creature && typeof creature === 'object' ? creature.sprite : null;
    if (typeof src !== 'string' || src.length > MAX_SRC) return null;
    return /^(data:image\/|blob:)/.test(src) || (SPRITE_PATH.test(src) && !src.includes('..')) ? src : null;
  }

  function cleanAttackOptions(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('OceanFx.playAttack: options object required');
    if (!ATTACK_KINDS.includes(opts.attackKind)) throw new TypeError('OceanFx.playAttack: unknown attackKind');
    const c = opts.container;
    if (c != null && (typeof c !== 'object' || typeof c.appendChild !== 'function')) throw new TypeError('OceanFx.playAttack: container must be an element');
    const creature = opts.creature && typeof opts.creature === 'object' ? opts.creature : {};
    const timeout = Number(opts.timeoutMs);
    return {
      attackKind: opts.attackKind,
      container: c || null,
      sprite: cleanSprite(creature.sprite != null ? creature : { sprite: opts.creatureSrc }),
      family: FAMILIES.includes(creature.family) ? creature.family : FAMILIES.includes(opts.familyId) ? opts.familyId : null,
      targets: cleanTargets(opts.targets),
      reducedMotion: typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : null,
      getSandbox: typeof opts.getSandbox === 'function' ? opts.getSandbox : null,
      subscribe: typeof opts.subscribe === 'function' ? opts.subscribe : typeof opts.subscribeSandbox === 'function' ? opts.subscribeSandbox : null,
      onEvent: typeof opts.onEvent === 'function' ? opts.onEvent : null,
      onDone: typeof opts.onDone === 'function' ? opts.onDone : null,
      timeoutMs: Number.isFinite(timeout) ? clamp(timeout, 500, 300000) : DEFAULT_TIMEOUT_MS,
    };
  }

  // ---- playAttack run

  function createAttackRun(o) {
    const global = typeof window !== 'undefined' ? window : globalThis;
    let container = o.container;
    let ownsContainer = false;
    if (!container) {
      if (typeof document === 'undefined' || !document.body) throw new TypeError('OceanFx.playAttack: container element required');
      container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483000;pointer-events:none';
      document.body.appendChild(container);
      ownsContainer = true;
    }
    const raf = typeof global.requestAnimationFrame === 'function' ? cb => global.requestAnimationFrame(cb) : cb => global.setTimeout(() => cb(Date.now()), 16);
    const caf = typeof global.cancelAnimationFrame === 'function' ? id => global.cancelAnimationFrame(id) : id => global.clearTimeout(id);
    const reduced = o.reducedMotion != null ? o.reducedMotion : typeof global.matchMedia === 'function' && !!global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const spec = ATTACKS[o.attackKind];
    const tB = reduced ? BREAKTHROUGH_REDUCED_S : BREAKTHROUGH_S;
    const timeoutS = o.timeoutMs / 1000;
    const rnd = seeded('attack:' + o.attackKind);

    const root = kid(container, 'left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;contain:strict');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-ocean-fx', 'attack:' + o.attackKind);
    const fontStyle = (container.ownerDocument || document).createElement('style');
    fontStyle.textContent = FONT_FACE;
    root.appendChild(fontStyle);
    const world = kid(root, 'left:0;top:0;right:0;bottom:0');

    const k = makeToolkit({ W: 1280, H: 720, px: 4, reduced, targets: o.targets, rnd, t: 0, f: 0, n: 0, act: [], seen: new Set(), cx: 0, cy: 0, pulseV: 0, label: '', u: 1 });
    const measure = () => {
      k.W = container.clientWidth || global.innerWidth || 1280;
      k.H = container.clientHeight || global.innerHeight || 720;
    };
    measure();
    k.px = Math.max(2, Math.round(k.H / 180));
    k.pulse = () => { if (!reduced) k.pulseV = 1; };
    const S = k.px * 32;

    k.stage = kid(world, 'left:0;top:0;right:0;bottom:0;opacity:0');
    const anim = spec.build(k);
    let hoverX = k.W * anim.hover[0], hoverY = k.H * anim.hover[1];
    k.cx = hoverX; k.cy = hoverY;

    // creature
    const cr = kid(world, 'left:0;top:0;width:' + S + 'px;height:' + S + 'px;will-change:transform,opacity;opacity:0;filter:drop-shadow(0 ' + k.px + 'px 0 rgba(2,6,12,.7))');
    if (o.sprite) {
      const img = (container.ownerDocument || document).createElement('img');
      img.style.cssText = 'display:block;width:100%;height:100%;image-rendering:crisp-edges;image-rendering:pixelated';
      img.alt = '';
      img.setAttribute('draggable', 'false');
      img.src = o.sprite;
      cr.appendChild(img);
    } else {
      const ps = S / BITMAPS.fish[0].length;
      kid(cr, 'left:0;top:' + (S - ps * BITMAPS.fish.length) / 2 + 'px;width:' + ps + 'px;height:' + ps + 'px;box-shadow:' + pixelShadow('fish', ps, FAMILY_TINT[o.family] || null));
    }
    const faceLeft = anim.hover[0] > .5;
    const drawCreature = (x, y, op, scale) => {
      const p = k.px;
      cr.style.transform = 'translate3d(' + Math.round((x - S / 2) / p) * p + 'px,' + Math.round((y - S / 2) / p) * p + 'px,0) scale(' + n3((faceLeft ? 1 : -1) * scale) + ',' + n3(scale) + ')';
      cr.style.opacity = n3(clamp(op));
    };

    // glass: pixel cracks, shards, flash and rings for the breakthrough
    const glass = kid(world, 'left:0;top:0;right:0;bottom:0');
    const veil = kid(glass, 'left:0;top:0;right:0;bottom:0;opacity:0;background:repeating-conic-gradient(rgba(255,255,255,.05) 0 25%,rgba(0,0,0,0) 0 50%) 0 0/' + k.px * 2 + 'px ' + k.px * 2 + 'px,rgba(4,10,20,.4)');
    const ix = k.W * .5, iy = k.H * .46;
    const cracks = [];
    const rays = 9;
    const step = k.px * 3;
    const maxLen = k.H * .5;
    for (let j = 0; j < rays; j++) {
      const a = j / rays * Math.PI * 2 + rnd() * .5;
      const len = maxLen * (.55 + rnd() * .45);
      for (let d = step, i = 0; d < len; d += step, i++) {
        const off = (rnd() - .5) * k.px * 3;
        const x = Math.round((ix + Math.cos(a) * d - Math.sin(a) * off) / k.px) * k.px;
        const y = Math.round((iy + Math.sin(a) * d + Math.cos(a) * off) / k.px) * k.px;
        const el = kid(glass, 'left:' + x + 'px;top:' + y + 'px;width:' + k.px * 2 + 'px;height:' + k.px * 2 + 'px;background:' + PX.w + ';box-shadow:' + k.px + 'px ' + k.px + 'px 0 0 ' + PX.s + ';opacity:0');
        cracks.push({ el, at: .06 + .86 * (d / maxLen) + rnd() * .04, on: false });
      }
    }
    const shards = Array.from({ length: 24 }, (_, i) => {
      const a = i / 24 * Math.PI * 2 + rnd() * .3;
      const r = k.H * (.06 + rnd() * .32);
      const sz = k.px * (5 + Math.round(rnd() * 9));
      const poly = 'polygon(' + [0, 1, 2].map(() => Math.round(rnd() * 100) + '% ' + Math.round(rnd() * 100) + '%').join(',') + ')';
      return { el: kid(glass, 'left:0;top:0;width:' + sz + 'px;height:' + sz + 'px;opacity:0;will-change:transform,opacity;clip-path:' + poly + ';background:linear-gradient(135deg,' + PX.y + ',' + PX.m + ')'), x0: ix + Math.cos(a) * r, y0: iy + Math.sin(a) * r * .7, vx: Math.cos(a) * (260 + rnd() * 640), vy: Math.sin(a) * (200 + rnd() * 420) - 160, spin: (rnd() - .5) * 720, sz };
    });
    const flash = kid(glass, 'left:0;top:0;right:0;bottom:0;opacity:0;background:' + PX.w);
    const bursts = [0, 1].map(() => kid(glass, 'left:0;top:0;width:100px;height:100px;box-sizing:border-box;border:' + k.px * 2 + 'px solid ' + PX.y + ';opacity:0'));

    // HUD: title, latest event label, counter, progress blocks and the source badge
    const p = k.px;
    const hudW = () => Math.min(k.W - p * 8, p * 190);
    const hud = box(k, root, p * 190, p * 24, 'background:' + PX.d + ';box-shadow:' + pxBox(p, PX.edge));
    const hudTitle = k.kt(hud, spec.title, p * 4, p * 2, .85, PX.a);
    const hudLabel = k.kt(hud, '', p * 4, p * 9, .8, PX.y);
    const hudCount = kid(hud, 'right:' + p * 4 + 'px;top:' + p * 2 + 'px;text-align:right;font:400 ' + k.fs(.95) + 'px/1.1 ' + PIXEL_FONT + ';color:' + PX.g + ';white-space:nowrap;-webkit-font-smoothing:none;text-shadow:' + textShadow(p), '');
    kid(hud, 'left:' + p * 4 + 'px;right:' + p * 4 + 'px;bottom:' + p * 4 + 'px;height:' + p * 3 + 'px;background:' + PX.s);
    const hudFill = kid(hud, 'left:' + p * 4 + 'px;bottom:' + p * 4 + 'px;height:' + p * 3 + 'px;width:0;background:repeating-linear-gradient(90deg,' + PX.a + ' 0 ' + p * 3 + 'px,transparent ' + p * 3 + 'px ' + p * 4 + 'px)');
    const badge = box(k, root, p * 86, p * 9, 'background:' + PX.d + ';box-shadow:' + pxBox(p, PX.edge));
    const badgeText = k.kt(badge, '', p * 3, p * 1.5, .75, PX.y);

    // sandbox events
    const queue = [];
    let lastSeq = 0;
    let runId = null;
    let sandboxMode = null;
    let sandboxStatus = null;
    let receipt = null;
    let source = 'none';
    let sawEvents = false;
    let summaryAt = null;
    let destroyed = false;
    let lastCount = 0;
    let activated = 0;
    let nextBeat = 0;
    let unsubscribe = null;
    let t0 = null;
    let rafId = null;
    let timer = null;
    let finished = false;
    let outroAt = null;
    let attackEmitted = false;
    let prevT = 0;
    let tNow = 0;

    const emit = (name, t, extra) => {
      if (!o.onEvent) return;
      try { o.onEvent(name, { attackKind: o.attackKind, elapsedMs: Math.round(t * 1000), source, ...extra }); } catch (_) { /* host callback errors must not break the sequence */ }
    };
    const safe = fn => { try { return fn(); } catch (_) { return null; } };

    const ingest = sb => {
      if (!sb || typeof sb !== 'object') return;
      if (typeof sb.runId === 'string' && sb.runId !== runId) { if (runId != null) lastSeq = 0; runId = sb.runId; }
      sandboxMode = SANDBOX_MODES.includes(sb.mode) ? sb.mode : null;
      sandboxStatus = typeof sb.status === 'string' ? sb.status : null;
      receipt = sb.receipt && typeof sb.receipt === 'object' ? sb.receipt : null;
      if (!Array.isArray(sb.events)) return;
      const fresh = sb.events.slice(0, MAX_EVENTS).map((e, i) => cleanSandboxEvent(e, i + 1)).filter(e => e && e.seq > lastSeq).sort((a, b) => a.seq - b.seq);
      if (!fresh.length) return;
      if (source === 'synthetic') {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].synthetic) queue.splice(i, 1);
        summaryAt = null;
        destroyed = false;
      }
      source = 'sandbox';
      sawEvents = true;
      for (const e of fresh) { lastSeq = e.seq; queue.push(e); }
    };
    const poll = arg => {
      if (arg && typeof arg === 'object') ingest(Array.isArray(arg.events) ? arg : arg.sandbox);
      else if (o.getSandbox) ingest(safe(o.getSandbox));
    };
    if (o.subscribe) {
      const off = safe(() => o.subscribe(poll));
      unsubscribe = typeof off === 'function' ? off : off && typeof off.unsubscribe === 'function' ? () => off.unsubscribe() : null;
    }
    poll();

    const startSynthetic = t => {
      source = 'synthetic';
      const steps = reduced ? 6 : 10;
      let seq = 1;
      queue.push({ seq: seq++, kind: 'provisioned', label: 'simulated run', count: null, total: null, synthetic: true });
      for (let i = 1; i <= steps; i++) queue.push({ seq: seq++, kind: spec.evKind, label: spec.labels[(i - 1) % spec.labels.length], count: Math.round(spec.total * i / steps), total: spec.total, synthetic: true });
      queue.push({ seq: seq++, kind: 'summary', label: 'summary', count: spec.total, total: spec.total, synthetic: true });
      queue.push({ seq: seq++, kind: 'destroyed', label: 'sandbox destroyed', count: null, total: null, synthetic: true });
      emit('fallback', t);
    };

    const activate = () => {
      const want = k.f > 0 ? Math.min(k.n, Math.ceil(k.f * k.n - 1e-9)) : 0;
      for (let i = activated; i < want; i++) k.act[i] = k.t + (reduced ? 0 : (i - activated) * .14);
      if (want > activated) k.pulse();
      activated = Math.max(activated, want);
    };

    const applyBeat = (ev, t) => {
      k.label = ev.kind === 'provisioned' ? 'sandbox ready' : ev.kind === 'destroyed' ? (receipt && receipt.teardownConfirmed === true ? 'sandbox destroyed, teardown confirmed' : 'sandbox destroyed') : ev.label || ev.kind;
      if (ev.count != null) lastCount = ev.count;
      if (ev.total != null && ev.total > 0) k.total = ev.total;
      if (ev.count != null && ev.total) k.f = Math.max(k.f, clamp(ev.count / ev.total));
      if (ev.kind === 'summary') { k.f = 1; summaryAt = t; }
      if (ev.kind === 'destroyed') destroyed = true;
      activate();
      emit(ev.kind === 'summary' ? 'summary' : ev.kind === 'destroyed' ? 'destroyed' : 'beat', t, { event: { seq: ev.seq, kind: ev.kind, label: ev.label, count: ev.count, total: ev.total } });
    };

    const badgeLabel = () => (source === 'sandbox' && (sandboxMode === 'docker' || sandboxMode === 'vultr') ? 'verified by sandbox (' + sandboxMode + ')' : source === 'none' ? 'waiting for sandbox' : 'simulated');
    const holdForSandbox = () => sandboxStatus === 'provisioning' && sandboxMode !== 'simulated';

    const finish = completed => {
      if (finished) return;
      finished = true;
      if (rafId != null) caf(rafId);
      if (timer != null) global.clearTimeout(timer);
      rafId = timer = null;
      if (unsubscribe) safe(unsubscribe);
      try { container.removeChild(root); } catch (_) { /* container may already have dropped it */ }
      if (ownsContainer) { try { container.parentNode.removeChild(container); } catch (_) { /* host page may have dropped it */ } }
      if (current === run) current = null;
      if (completed) {
        emit('done', tNow);
        if (o.onDone) { try { o.onDone(); } catch (_) { /* host callback errors are ignored */ } }
      }
    };

    const drawBreakthrough = t => {
      const shake = !reduced && t > .9 && t < BURST_S ? (seeded('shake' + Math.floor(t * 20))() - .5) * k.px * (1 + (t - .9) * 3) : 0;
      const shakeY = !reduced && t > .9 && t < BURST_S ? (seeded('shakey' + Math.floor(t * 20))() - .5) * k.px * (1 + (t - .9) * 3) : 0;
      world.style.transform = 'translate3d(' + Math.round(shake) + 'px,' + Math.round(shakeY) + 'px,0)';
      const c = reduced ? .8 : seg(t, .3, 1.5);
      cracks.forEach(cr2 => {
        const on = c >= cr2.at;
        if (on !== cr2.on) { cr2.on = on; cr2.el.style.opacity = on ? '1' : '0'; }
      });
      const burst = t - BURST_S;
      veil.style.opacity = n3(reduced ? .9 * (1 - seg(t, .5, tB)) : Math.min(seg(t, 0, .3), 1 - seg(t, BURST_S + .1, tB)) * .9);
      shards.forEach(s => {
        if (reduced) { s.el.style.opacity = '0'; return; }
        if (burst < 0) {
          s.el.style.opacity = n3(.5 * seg(c, .3, .7));
          s.el.style.transform = 'translate3d(' + Math.round(s.x0) + 'px,' + Math.round(s.y0) + 'px,0)';
        } else {
          const x = s.x0 + s.vx * burst, y = s.y0 + s.vy * burst + 700 * burst * burst;
          s.el.style.opacity = n3(.5 * (1 - seg(burst, .5, 1.1)));
          s.el.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0) rotate(' + Math.round(s.spin * burst / 15) * 15 + 'deg)';
        }
      });
      flash.style.opacity = !reduced && burst >= 0 && burst < .3 ? n3(Math.round((1 - burst / .3) * 4) / 4 * .8) : '0';
      bursts.forEach((b, i) => {
        const q = seg(burst, i * .12, i * .12 + .6);
        const size = Math.round(q * k.W * .9 / k.px) * k.px + k.px * 4;
        b.style.width = b.style.height = size + 'px';
        b.style.transform = 'translate3d(' + Math.round(ix - size / 2) + 'px,' + Math.round(iy - size / 2) + 'px,0)';
        b.style.opacity = !reduced && q > 0 && q < 1 ? n3(.6 * (1 - q)) : '0';
      });
      // creature: small behind the glass, growing and pressing, lunging at the burst, then settling at its hover spot
      if (reduced) { drawCreature(hoverX, hoverY, seg(t, 0, .6), 1); return; }
      let x = ix, y = iy, sc, op = seg(t, 0, .3) * .9;
      if (t < BURST_S) {
        sc = t < 1.5 ? lerp(.12, 1.1, smooth(seg(t, .3, 1.5))) : lerp(1.1, 1.35, seg(t, 1.5, BURST_S));
        if (t > .9) { x += shake; y += shakeY; }
      } else {
        op = 1;
        const lunge = seg(burst, 0, .3), settle = easeOut(seg(burst, .3, tB - BURST_S));
        sc = burst < .3 ? lerp(1.35, 3, easeOut(lunge)) : lerp(3, 1, settle);
        x = lerp(ix, hoverX, settle);
        y = lerp(iy, hoverY, settle);
      }
      drawCreature(x, y, op, Math.round(sc * 20) / 20);
    };

    const frame = t => {
      measure();
      const dt = clamp(t - prevT, 0, .1);
      prevT = t;
      tNow = t;
      k.t = t - tB;
      hoverX = k.W * anim.hover[0];
      hoverY = k.H * anim.hover[1];
      if (t < tB + .6) drawBreakthrough(t);
      else glass.style.display = 'none';
      if (k.t < 0) return;

      // sandbox events and beats
      if (!attackEmitted) { attackEmitted = true; emit('attack', t); emit('effect', t); }
      poll();
      if (!sawEvents && source === 'none' && t >= FALLBACK_AFTER_S && !holdForSandbox()) startSynthetic(t);
      if (queue.length && k.t >= nextBeat) {
        const ev = queue.shift();
        applyBeat(ev, t);
        nextBeat = k.t + (source === 'synthetic' ? (reduced ? .2 : .5) : Math.max(.06, (reduced ? .1 : .3) - .03 * queue.length));
      }
      if (outroAt == null) {
        const idle = queue.length === 0;
        const over = idle && source !== 'none' && (destroyed || sandboxStatus === 'destroyed' || sandboxStatus === 'failed' || (summaryAt != null && t - summaryAt >= SUMMARY_HOLD_S));
        if (sandboxStatus === 'failed' && idle && !destroyed) k.label = 'sandbox failed';
        if (over || t >= timeoutS) {
          outroAt = t;
          k.f = Math.max(k.f, summaryAt != null ? 1 : k.f);
          if (t >= timeoutS && !over) emit('timeout', t);
        }
      }
      const out = outroAt == null ? 0 : seg(t, outroAt + .5, outroAt + OUTRO_S);
      k.pulseV *= Math.exp(-dt * 3.5);

      // draw
      k.stage.style.opacity = n3(seg(k.t, 0, .3) * (1 - out));
      anim.draw(k.t, dt);
      const bob = reduced ? 0 : Math.round(Math.sin(t * 2.4) * 2) * k.px;
      drawCreature(hoverX, hoverY + bob - out * k.H * .1, 1 - out, 1 + .12 * k.pulseV);
      const hw = hudW();
      hud.fxW = hw;
      hud.style.width = hw + 'px';
      const hudO = seg(k.t, 0, .3) * (1 - out);
      k.at(hud, k.W / 2, k.H - p * 4 - hud.fxH / 2, hudO);
      hudLabel.textContent = k.label || (source === 'none' ? 'waiting for the sandbox...' : '');
      hudCount.textContent = k.total ? lastCount + ' / ' + k.total + ' ' + spec.unit : sawEvents || source === 'synthetic' ? String(lastCount) : '';
      hudFill.style.width = Math.round(Math.round(k.f * 20) / 20 * (hw - p * 8) / p) * p + 'px';
      const bt = badgeLabel();
      if (badgeText.textContent !== bt) badgeText.textContent = bt;
      k.at(badge, k.W - p * 3 - badge.fxW / 2, p * 3 + badge.fxH / 2, hudO);
    };

    const tick = ts => {
      rafId = null;
      if (finished) return;
      if (t0 == null) t0 = ts;
      const t = Math.max(0, (ts - t0) / 1000);
      if (outroAt != null && t >= outroAt + OUTRO_S) { finish(true); return; }
      frame(t);
      rafId = raf(tick);
    };

    const run = { stop: () => finish(false) };
    frame(0);
    emit('breakthrough', 0);
    rafId = raf(tick);
    timer = global.setTimeout(() => finish(true), o.timeoutMs + 4000);
    return run;
  }

  function playAttack(opts) {
    const o = cleanAttackOptions(opts);
    if (current) current.stop();
    const run = createAttackRun(o);
    current = run;
    return { stop: run.stop };
  }

  const api = { version: 1, families: FAMILIES.slice(), depths: DEPTHS.slice(), attackKinds: ATTACK_KINDS.slice(), play, playAttack };
  window.OceanFx = Object.freeze(api);
})();
