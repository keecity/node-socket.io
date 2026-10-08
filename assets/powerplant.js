// =====================================================================================
// Power plant asset (procedural, three.js r128), modelled after the reference concept:
// chamfered turbine hall with roof grilles, louvers and lightning emblem; entrance porch;
// AC annex; two banded chimneys with platforms and caged ladders; two cooling towers on
// X-lattice legs; big pipework; turbine/generator; transformer cabinets; X-braced plinth;
// yellow safety railings; steam and smoke.
//
// Every part is merged per material, so the whole plant is ~25 draw calls.
// Footprint ~44 x 44 units, origin at ground centre, +Z is the front.
//   const plant = PowerPlant.build({ accent: 0x2f6fd6 }); scene.add(plant.group); plant.update(dt, camera);
// =====================================================================================
(function () {
'use strict';
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// ------------------------------------------------------------------ textures (canvas)
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function grime(g, W, H, n = 9000, streaks = 50) {
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '30,30,30' : '255,255,255'},${rnd() * 0.05})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3); }
  for (let i = 0; i < streaks; i++) { const x = rnd() * W, y = rnd() * H, gr = g.createLinearGradient(x, y, x, y + 80 + rnd() * 140); gr.addColorStop(0, 'rgba(55,50,45,.13)'); gr.addColorStop(1, 'rgba(55,50,45,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + rnd() * 5, 220); }
}
// panelled cladding: one texture tile = one panel block (seams + rivets + grime)
function panelTex(base, seam, cols, rows) {
  return canvasTex(512, 512, (g, W, H) => { g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const v = (rnd() - .5) * 14; g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) / 255})`; g.fillRect(i * W / cols, j * H / rows, W / cols, H / rows); }
    grime(g, W, H);
    g.strokeStyle = seam; g.lineWidth = 3;
    for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * W / cols, 0); g.lineTo(i * W / cols, H); g.stroke(); }
    for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, j * H / rows); g.lineTo(W, j * H / rows); g.stroke(); }
    g.fillStyle = 'rgba(60,60,60,.45)'; for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) for (const [dx, dy] of [[6, 6], [-6, 6], [6, -6], [-6, -6]]) g.fillRect(i * W / cols + dx - 1, j * H / rows + dy - 1, 3, 3);
  });
}
function towerTex() { return canvasTex(1024, 512, (g, W, H) => { g.fillStyle = '#b9bab5'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 64; i++) for (let j = 0; j < 16; j++) { const v = (rnd() - .5) * 18; g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) / 255})`; g.fillRect(i * W / 64, j * H / 16, W / 64, H / 16); }
  grime(g, W, H, 14000, 120); g.strokeStyle = 'rgba(80,80,80,.5)'; g.lineWidth = 2;
  for (let i = 0; i <= 64; i++) { g.beginPath(); g.moveTo(i * W / 64, 0); g.lineTo(i * W / 64, H); g.stroke(); }
  for (let j = 0; j <= 16; j++) { g.beginPath(); g.moveTo(0, j * H / 16); g.lineTo(W, j * H / 16); g.stroke(); } }); }
function bandTex() { return canvasTex(64, 512, (g, W, H) => {                    // chimney top: red / white bands, top first
  const seq = ['#a3341f', '#e6e3dd', '#a3341f', '#e6e3dd', '#a3341f', '#c9c9c4']; const hs = [.16, .14, .16, .14, .16, .24]; let y = 0;
  seq.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, y * H, W, hs[i] * H + 1); y += hs[i]; }); grime(g, W, H, 3000, 20);
  g.strokeStyle = 'rgba(60,40,30,.35)'; g.lineWidth = 2; for (let j = 0; j < 20; j++) { g.beginPath(); g.moveTo(0, j * H / 20); g.lineTo(W, j * H / 20); g.stroke(); } }); }
function hazardTex() { return canvasTex(64, 256, (g, W, H) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, W, H); g.fillStyle = '#1c1c1c';
  for (let y = -W; y < H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + W); g.lineTo(W, y + W + 20); g.lineTo(0, y + 20); g.fill(); } }); }
function boltTex(css) { return canvasTex(256, 256, (g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = css;
  g.beginPath(); g.moveTo(150, 8); g.lineTo(62, 142); g.lineTo(118, 142); g.lineTo(84, 248); g.lineTo(196, 96); g.lineTo(138, 96); g.lineTo(184, 8); g.closePath(); g.fill(); }); }
function signTex() { return canvasTex(128, 128, (g, W, H) => { g.fillStyle = '#d8d8d4'; g.fillRect(0, 0, W, H); g.fillStyle = '#f2c230'; g.strokeStyle = '#111'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(64, 14); g.lineTo(118, 112); g.lineTo(10, 112); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#111'; g.font = 'bold 60px sans-serif'; g.textAlign = 'center'; g.fillText('!', 64, 100); }); }
function softTex() { return canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false); }

// ------------------------------------------------------------------ geometry builder: parts merged per material
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function T(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) { return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz)); }
class Builder {
  constructor() { this.parts = new Map(); }
  add(geo, mat, m) { const g = (geo.index ? geo.toNonIndexed() : geo.clone()); g.applyMatrix4(m); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(g); }
  build(group) {
    for (const [mat, list] of this.parts) {
      let n = 0; for (const g of list) n += g.attributes.position.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let o = 0;
      for (const g of list) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); U.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; g.dispose(); }
      const tile = mat.userData.tile;
      if (tile) for (let i = 0; i < n; i++) {                   // box-projected world UVs: panels line up across every surface
        const nx = Math.abs(N[i * 3]), ny = Math.abs(N[i * 3 + 1]), nz = Math.abs(N[i * 3 + 2]), x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (ny >= nx && ny >= nz) { U[i * 2] = x / tile; U[i * 2 + 1] = z / tile; } else if (nx >= nz) { U[i * 2] = z / tile; U[i * 2 + 1] = y / tile; } else { U[i * 2] = x / tile; U[i * 2 + 1] = y / tile; }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      geo.computeBoundingSphere(); const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    }
  }
}
// chamfered box (all edges bevelled), base at y=0
const cboxCache = new Map();
function cboxGeo(w, h, d, c) {
  const key = [w, h, d, c].join(); if (cboxCache.has(key)) return cboxCache.get(key);
  c = Math.min(c, w / 2 - .01, h / 2 - .01, d / 2 - .01);
  const s = new THREE.Shape(); s.moveTo(-w / 2 + c, -d / 2 + c); s.lineTo(w / 2 - c, -d / 2 + c); s.lineTo(w / 2 - c, d / 2 - c); s.lineTo(-w / 2 + c, d / 2 - c); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, steps: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, c, 0); cboxCache.set(key, g); return g;
}
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = n => new THREE.CylinderGeometry(1, 1, 1, n, 1), CYL8 = CYL(8), CYL16 = CYL(16), CYL32 = CYL(32);
// a box oriented between two points (struts, rails, braces)
function strut(B, mat, a, b, t, base) { const d = _v.subVectors(b, a), L = d.length(); const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.abs(d.y / L) > .99 ? 1 : 0));
  m.setPosition(a.clone().add(b).multiplyScalar(.5)); m.multiply(new THREE.Matrix4().makeScale(t, t, L)); B.add(BOX, mat, base ? base.clone().multiply(m) : m); }

function build(opts = {}) {
  seed = 11;
  const accent = opts.accent !== undefined ? opts.accent : 0x2f6fd6, accentCss = '#' + new THREE.Color(accent).getHexString();
  const group = new THREE.Group(); group.name = 'PowerPlant';
  const std = (o, tile) => { const m = new THREE.MeshStandardMaterial(o); if (tile) m.userData.tile = tile; return m; };
  const M = {
    concrete: std({ map: panelTex('#9fa09b', 'rgba(85,85,85,.6)', 2, 2), roughness: .9 }, 6),
    cladding: std({ map: panelTex('#aeafab', 'rgba(75,75,75,.65)', 2, 3), roughness: .7, metalness: .12 }, 4.5),
    dark: std({ map: panelTex('#6b6d6a', 'rgba(35,35,35,.6)', 2, 1), roughness: .95 }, 4),
    metal: std({ color: lin(0xb9bec3), metalness: .8, roughness: .28 }),
    pipe: std({ color: lin(0xc5cacf), metalness: .85, roughness: .22 }),
    dmetal: std({ color: lin(0x474c53), metalness: .6, roughness: .45 }),
    slat: std({ color: lin(0x3a3f45), metalness: .5, roughness: .5 }),
    black: std({ color: lin(0x15171a), roughness: .9 }),
    accent: std({ color: lin(accent), roughness: .55, metalness: .1 }),
    yellow: std({ color: lin(0xf0c02a), roughness: .5, metalness: .25 }),
    tower: std({ map: towerTex(), color: lin(0xd8d8d4), roughness: .95, side: THREE.DoubleSide }),
    towerIn: std({ color: lin(0x5a5c5a), roughness: 1, side: THREE.BackSide }),
    bands: std({ map: bandTex(), roughness: .8 }),
    stack: std({ map: panelTex('#a8a9a4', 'rgba(80,80,80,.5)', 1, 4), roughness: .9 }, 3),
    hazard: std({ map: hazardTex(), roughness: .7 }),
    bolt: new THREE.MeshBasicMaterial({ map: boltTex(accentCss), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    sign: std({ map: signTex(), roughness: .6 }),
    lamp: std({ color: lin(0xffe2a8), emissive: lin(0xffbf60), emissiveIntensity: 1.6 }),
  };
  const B = new Builder();
  const cbox = (w, h, d, c, mat, m) => B.add(cboxGeo(w, h, d, c), mat, m);
  const box = (w, h, d, mat, m) => B.add(BOX, mat, m.clone().multiply(T(0, h / 2, 0, 0, 0, 0, w, h, d)));
  const cyl = (r, h, mat, m, seg = CYL16) => B.add(seg, mat, m.clone().multiply(T(0, h / 2, 0, 0, 0, 0, r, h, r)));
  const W = (base, x, y, z, ry = 0, rx = 0, rz = 0) => base.clone().multiply(T(x, y, z, ry, rx, rz));
  const O = new THREE.Matrix4();

  // ---- details ----------------------------------------------------------------------------
  // railing along polyline points [[x,z],...] at height y in frame `base`
  function railing(base, pts, y, h = 1.1) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.5)), ang = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k <= n; k++) cyl(.055, h, M.yellow, W(base, ax + (bx - ax) * k / n, y, az + (bz - az) * k / n), CYL8);
      for (const hh of [h, h * .55]) box(.07, .07, L, M.yellow, W(base, (ax + bx) / 2, y + hh - .035, (az + bz) / 2, ang));
      box(.03, .14, L, M.yellow, W(base, (ax + bx) / 2, y, (az + bz) / 2, ang));
    }
  }
  const circle = (r, n = 24, cx = 0, cz = 0) => { const p = []; for (let i = 0; i <= n; i++) p.push([cx + Math.cos(i / n * 6.283) * r, cz + Math.sin(i / n * 6.283) * r]); return p; };
  // louvered vent panel in the XY plane facing +Z (w x h), angled slats in a frame
  function louver(base, w, h, slats) {
    box(w, h, .12, M.black, W(base, 0, 0, -.1));
    const fr = .18; box(w, fr, .3, M.dmetal, W(base, 0, h - fr, 0)); box(w, fr, .3, M.dmetal, base); box(fr, h, .3, M.dmetal, W(base, -w / 2 + fr / 2, 0, 0)); box(fr, h, .3, M.dmetal, W(base, w / 2 - fr / 2, 0, 0));
    const n = slats || Math.max(3, Math.round(h / .38));
    for (let i = 0; i < n; i++) box(w - 2 * fr, .06, .34, M.slat, W(base, 0, fr + (h - 2 * fr) * (i + .5) / n, .02, 0, -.6));
  }
  // flat roof grille: dark bed with parallel bars (w along x, d along z), top at local y=0
  function grille(base, w, d, bars) {
    box(w, .2, d, M.black, W(base, 0, -.2, 0));
    const fr = .22; box(w, .25, fr, M.dmetal, W(base, 0, -.05, -d / 2 + fr / 2)); box(w, .25, fr, M.dmetal, W(base, 0, -.05, d / 2 - fr / 2)); box(fr, .25, d, M.dmetal, W(base, -w / 2 + fr / 2, -.05, 0)); box(fr, .25, d, M.dmetal, W(base, w / 2 - fr / 2, -.05, 0));
    const n = bars || Math.round(w / .32); for (let i = 0; i < n; i++) box(.1, .12, d - 2 * fr, M.slat, W(base, -w / 2 + fr + (w - 2 * fr) * (i + .5) / n, -.02, 0));
    if (d > 3) for (let k = 1; k < 3; k++) box(w, .15, .12, M.dmetal, W(base, 0, -.03, -d / 2 + d * k / 3));
  }
  // rooftop AC unit with finned sides and a bladed fan
  function acUnit(base) {
    cbox(2.6, 1.9, 2.6, .08, M.metal, base);
    for (let s = 0; s < 4; s++) { const sb = W(base, 0, 0, 0, s * Math.PI / 2); for (let i = 0; i < 9; i++) box(.05, 1.5, .12, M.slat, W(sb, -1.05 + i * .26, .2, 1.32)); }
    const top = W(base, 0, 1.9, 0);
    B.add(new THREE.TorusGeometry(1, .09, 6, 24).rotateX(Math.PI / 2), M.dmetal, W(top, 0, .06, 0));
    cyl(1, .06, M.black, top, CYL32);
    for (let i = 0; i < 5; i++) box(1.8, .03, .34, M.slat, W(top, 0, .1, 0, i / 5 * Math.PI * 2, 0, .3).multiply(T(.45, 0, 0)));
    for (let i = -3; i <= 3; i++) box(2, .04, .04, M.dmetal, W(top, 0, .18, i * .28));
    cyl(.18, .16, M.dmetal, top);
  }
  // steel ladder with safety cage from y0 to y1 on the local +Z face
  function ladder(base, y0, y1, cage = true) {
    for (const x of [-.28, .28]) box(.06, y1 - y0, .06, M.yellow, W(base, x, y0, 0));
    for (let y = y0 + .3; y < y1; y += .35) box(.56, .04, .04, M.yellow, W(base, 0, y, 0));
    if (cage) { for (let y = y0 + 2.2; y < y1; y += .9) B.add(new THREE.TorusGeometry(.45, .03, 4, 12, Math.PI).rotateX(Math.PI / 2), M.yellow, W(base, 0, y, .05, Math.PI));
      for (const a of [.4, 1.57, 2.74]) box(.04, y1 - y0 - 2.2, .04, M.yellow, W(base, Math.cos(a) * .45, y0 + 2.2, .05 + Math.sin(a) * .45)); }
  }
  const lamp = (base) => { box(.12, .5, .12, M.dmetal, base); box(.45, .25, .35, M.lamp, W(base, 0, .45, .12)); };

  // ================================================================== PLINTH
  cbox(46, 1.2, 46, .5, M.dark, O);
  cbox(44, 1.3, 44, .35, M.concrete, W(O, 0, 1.2, 0));
  const TOP = 2.5;
  for (const [x, z] of [[-21, -21], [21, -21], [21, 21], [-21, 21]]) cbox(4.2, 3.4, 4.2, .4, M.dark, W(O, x, 0, z));   // corner blocks
  // front and left faces: accent band + recessed panels
  box(38, .5, .1, M.accent, W(O, 0, 1.6, 22.02)); box(.1, .5, 38, M.accent, W(O, -22.02, 1.6, 0));
  for (let i = -3; i <= 3; i++) { box(4.4, .7, .06, M.dark, W(O, i * 5.2, .35, 22.05)); box(.06, .7, 4.4, M.dark, W(O, -22.05, .35, i * 5.2)); }
  // right and back faces: steel frame with X bracing
  for (const [side, rot] of [[0, 0], [1, Math.PI / 2]]) {
    const fb = side ? W(O, 0, 0, -22.05, Math.PI) : W(O, 22.05, 0, 0, Math.PI / 2);
    for (let i = -4; i <= 4; i++) { box(.35, 2.5, .35, M.accent, W(fb, i * 4.6, 0, 0)); if (i < 4) { strut(B, M.dmetal, new THREE.Vector3(i * 4.6, .2, 0), new THREE.Vector3((i + 1) * 4.6, 2.3, 0), .14, fb); strut(B, M.dmetal, new THREE.Vector3(i * 4.6, 2.3, 0), new THREE.Vector3((i + 1) * 4.6, .2, 0), .14, fb); } }
    box(37, .3, .3, M.accent, W(fb, 0, 2.2, 0));
  }
  // entrance stairs
  for (let i = 0; i < 5; i++) box(7, .5, 1.2, M.concrete, W(O, -3.5, i * .5, 23.6 - i * 1));
  railing(O, [[-21.6, 21.6], [-7.4, 21.6]], TOP); railing(O, [[.4, 21.6], [21.6, 21.6], [21.6, -21.6], [-21.6, -21.6], [-21.6, 21.6]], TOP);

  // ================================================================== TURBINE HALL (front-left)
  const H0 = W(O, -3.5, TOP, 4);          // hall frame: 17 wide (x), 21 deep (z), front face at z=+10.5
  const HW = 17, HD = 21, HH = 11.5;
  // body with chamfered roof profile, extruded front->back
  { const s = new THREE.Shape(), c = 2.4; s.moveTo(-HW / 2, 0); s.lineTo(HW / 2, 0); s.lineTo(HW / 2, HH); s.lineTo(HW / 2 - c, HH + c); s.lineTo(-HW / 2 + c, HH + c); s.lineTo(-HW / 2, HH); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: HD, bevelEnabled: false }); g.translate(0, 0, -HD / 2); B.add(g, M.cladding, H0);
    // accent strips on the roof chamfers and a band around the walls
    const cs = new THREE.Shape(); cs.moveTo(HW / 2 + .05, HH - .1); cs.lineTo(HW / 2 - c + .05, HH + c - .05); cs.lineTo(HW / 2 - c + .05 - .45, HH + c - .05); cs.lineTo(HW / 2 + .05 - .45, HH - .1 + 0); cs.closePath();
    for (const sx of [1, -1]) { const g2 = new THREE.ExtrudeGeometry(cs, { depth: HD + .1, bevelEnabled: false }); g2.translate(0, 0, -(HD + .1) / 2); B.add(g2, M.accent, W(H0, 0, 0, 0).multiply(T(0, 0, 0, 0, 0, 0, sx, 1, 1))); } }
  box(HW + .12, 1.2, HD + .12, M.accent, W(H0, 0, 8.2, 0));
  box(HW + .3, 1.1, HD + .3, M.dark, H0);                                           // skirting
  for (const [x, z] of [[-HW / 2, HD / 2], [HW / 2, HD / 2], [-HW / 2, -HD / 2], [HW / 2, -HD / 2]]) cbox(1.3, HH + .3, 1.3, .25, M.dark, W(H0, x, 0, z));   // corner piers
  // raised clerestory with sloped grille sides and a row of vents
  { const RW = 9.5, RH = 2.2, rt = HH + 2.4; const s = new THREE.Shape(), c = 1.4; s.moveTo(-RW / 2, 0); s.lineTo(RW / 2, 0); s.lineTo(RW / 2 - c, RH); s.lineTo(-RW / 2 + c, RH); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: HD - 3, bevelEnabled: false }); g.translate(0, 0, -(HD - 3) / 2); B.add(g, M.cladding, W(H0, 0, rt, -.5));
    box(RW - 2 * c + .3, .25, HD - 2.6, M.dmetal, W(H0, 0, rt + RH, -.5));
    for (const sx of [1, -1]) { const sb = W(H0, sx * (RW / 2 - c / 2), rt + RH / 2 + .05, -.5, 0, 0, sx * -Math.atan2(RH, c)); for (let k = 0; k < 3; k++) grille(W(sb, 0, .02, -6 + k * 6), 1.3, 5.2, 4); }
    for (let k = 0; k < 4; k++) grille(W(H0, 0, rt + RH + .35, -7.5 + k * 4.8), 2.8, 3.6, 8);
    // big grille bays on the front roof slope (as on the reference)
    for (const sx of [1, -1]) for (let k = 0; k < 2; k++) grille(W(H0, sx * 5.2, rt - .02, 6.3 - k * 6.2), 3.6, 5.2, 10);
  }
  // ---- front facade (z = +HD/2)
  const F = W(H0, 0, 0, HD / 2 + .02);
  box(HW - 5, HH - 1.4, .25, M.cladding, W(F, 0, 1.1, .1));                            // recessed central panel frame
  louver(W(F, .6, 6.9, .3), 7.4, 3, 9);                                               // wide central vent above the porch
  for (const x of [-4.8, 4.8]) louver(W(F, x, 1.4, .3), 1.7, 7.6);                    // tall louver strips
  B.add(new THREE.PlaneGeometry(3.2, 3.2), M.bolt, W(F, -2.1, 10.3, .42));            // lightning emblem
  // side pilaster towers with chamfered caps, small vents and lamps
  for (const sx of [-1, 1]) { const pb = W(F, sx * (HW / 2 - 1.3), 0, .9); cbox(3, 10.2, 2.4, .35, M.cladding, pb); cbox(3.2, .6, 2.6, .3, M.dark, W(pb, 0, 10.2, 0));
    louver(W(pb, 0, 5.8, 1.22), 1.6, 2.6, 6); box(1.2, 2.4, .1, M.dmetal, W(pb, 0, 1.1, 1.21)); lamp(W(pb, 0, 4.6, 1.2)); box(3.05, .45, 2.45, M.accent, W(pb, 0, 8.2, 0)); }
  // entrance porch with pitched canopy, blue double door and hazard posts
  { const eb = W(F, 0, 0, 1.6); cbox(7.4, 5.2, 3.2, .3, M.cladding, eb);
    const s = new THREE.Shape(); s.moveTo(-4.3, 0); s.lineTo(4.3, 0); s.lineTo(4.3, .3); s.lineTo(0, 1.4); s.lineTo(-4.3, .3); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 4.2, bevelEnabled: false }); g.translate(0, 0, -2.1); B.add(g, M.dmetal, W(eb, 0, 5.2, .3));
    for (let i = 0; i < 9; i++) box(8.6 * .96, .05, .05, M.slat, W(eb, 0, 5.28 + .12 * i, -1.8 + i * .45));
    const db = W(eb, 0, .2, 1.63); box(3.6, 3.9, .1, M.dmetal, db); for (const x of [-.86, .86]) { box(1.62, 3.6, .08, M.accent, W(db, x, .12, .06)); for (let k = 0; k < 3; k++) box(1.3, .04, .04, M.dmetal, W(db, x, .8 + k * .9, .11)); }
    box(.1, 3.6, .12, M.dmetal, W(db, 0, .12, .1)); box(.06, .5, .1, M.metal, W(db, -.18, 1.8, .14)); box(.06, .5, .1, M.metal, W(db, .18, 1.8, .14));
    for (const x of [-2.9, 2.9]) { box(.9, 4.4, .25, M.hazard, W(eb, x, 0, 1.6)); lamp(W(eb, x, 4.4, 1.62)); } }
  // ---- right side wall (x = +HW/2): louvers, doors, stepped lower wing, cabinets
  const R = W(H0, HW / 2 + .02, 0, 0, Math.PI / 2);
  for (let k = 0; k < 3; k++) louver(W(R, -7 + k * 5.2, 3.2, .05), 2.4, 4.6, 11);
  { const wb = W(H0, HW / 2 + 2.2, 0, -5); cbox(4.4, 7.4, 10, .35, M.cladding, wb); box(4.5, .7, 10.1, M.accent, W(wb, 0, 5.6, 0)); cbox(4.8, .5, 10.4, .2, M.dark, W(wb, 0, 7.4, 0));
    const wr = W(wb, 2.23, 0, 0, Math.PI / 2); box(1.4, 2.8, .08, M.dmetal, W(wr, 2.5, .2, 0)); louver(W(wr, -1.5, 2, .05), 2.2, 2.6, 6); louver(W(wr, -3.6, 2, .05), 1.2, 2.6, 6);
    for (let k = 0; k < 2; k++) acUnit(W(wb, 0, 7.9, -2.4 + k * 4.8).multiply(T(0, 0, 0, 0, 0, 0, .75, .75, .75))); }
  for (let k = 0; k < 3; k++) { const cb = W(H0, HW / 2 + .9, 0, 3.5 + k * 1.9); cbox(1.6, 2.6, 1.7, .08, M.metal, cb); box(.06, 2.2, 1.4, M.dmetal, W(cb, .82, .2, 0)); box(.06, .3, .1, M.black, W(cb, .86, 1.3, .45)); }
  // ---- back wall details
  for (let k = 0; k < 3; k++) louver(W(H0, -5 + k * 5, 3, -HD / 2 - .05, Math.PI), 2.6, 4, 10);

  // ================================================================== AC ANNEX (left)
  const A0 = W(O, -16.5, TOP, 5);
  cbox(7, 6.2, 16, .4, M.cladding, A0); box(7.12, .8, 16.12, M.accent, W(A0, 0, 4.4, 0)); cbox(7.4, .45, 16.4, .2, M.dark, W(A0, 0, 6.2, 0));
  for (let k = 0; k < 3; k++) louver(W(A0, -3.52, 1.2, -5 + k * 5, -Math.PI / 2), 2.4, 2.8, 7);
  box(1.4, 2.8, .08, M.dmetal, W(A0, 1.2, .2, 8.04)); louver(W(A0, -1.8, 1.6, 8.04), 2, 2.4, 6);
  for (let i = 0; i < 6; i++) acUnit(W(A0, -1.5 + (i % 2) * 3, 6.65, -5.3 + Math.floor(i / 2) * 3.4));
  railing(A0, [[-3.4, -7.8], [3.4, -7.8], [3.4, 7.8], [-3.4, 7.8], [-3.4, -7.8]], 6.65, 1);
  ladder(W(A0, 2.2, 0, 8.1), 0, 6.8);

  // ================================================================== CHIMNEYS (back-left)
  function chimney(x, z, Hc, r0, r1) {
    const C = W(O, x, TOP, z);
    cbox(r0 * 2 + 1.6, 3.2, r0 * 2 + 1.6, .35, M.dark, C); box(r0 * 2 + 1.7, .5, r0 * 2 + 1.7, M.accent, W(C, 0, 2.2, 0));
    const lower = Hc * .6;
    B.add(new THREE.CylinderGeometry(r1 * 1.02 + (r0 - r1) * .4, r0, lower, 28, 1, true), M.stack, W(C, 0, 3.2 + lower / 2, 0));
    B.add(new THREE.CylinderGeometry(r1, r1 * 1.02 + (r0 - r1) * .4, Hc - lower - 3.2, 28, 1, true), M.bands, W(C, 0, 3.2 + lower + (Hc - lower - 3.2) / 2, 0));
    B.add(new THREE.CylinderGeometry(r1 + .18, r1 + .18, .7, 28, 1, true), M.dmetal, W(C, 0, Hc - .35, 0));
    B.add(new THREE.RingGeometry(r1 - .35, r1 + .18, 28).rotateX(-Math.PI / 2), M.dmetal, W(C, 0, Hc, 0)); cyl(r1 - .35, .1, M.black, W(C, 0, Hc - .15, 0), CYL32);
    for (const hy of [Hc * .5, Hc * .8]) { const rr = (hy < 3.2 + lower ? r0 - (r0 - r1) * (hy - 3.2) / Hc : r1) + 1.2;
      cyl(rr, .22, M.dmetal, W(C, 0, hy, 0), CYL32); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; strut(B, M.dmetal, new THREE.Vector3(Math.cos(a) * (rr - 1.1), hy - 1.1, Math.sin(a) * (rr - 1.1)), new THREE.Vector3(Math.cos(a) * rr * .95, hy, Math.sin(a) * rr * .95), .1, C); }
      railing(C, circle(rr - .1, 20), hy + .22); }
    ladder(W(C, 0, 0, r0 + .1), 3.2, Hc * .8 + .2);
  }
  chimney(-15.5, -12, 31, 1.75, 1.35); chimney(-8.5, -17, 35, 1.9, 1.45);

  // ================================================================== COOLING TOWERS (back-right)
  const towerTops = [];
  function coolingTower(x, z, Ht, R0, Rt, Rtop) {
    const C = W(O, x, TOP, z), legH = 3.2, th = (Ht - legH) * .74;
    cyl(R0 + 2.4, .8, M.concrete, W(C, 0, -.8, 0), CYL32); B.add(new THREE.TorusGeometry(R0 + 2.4, .25, 4, 40).rotateX(Math.PI / 2), M.dark, W(C, 0, 0, 0));
    const pts = [], pin = [];
    for (let i = 0; i <= 30; i++) { const y = legH + (Ht - legH) * i / 30, below = y < legH + th, u = below ? (legH + th - y) / th : (y - legH - th) / (Ht - legH - th);
      const rad = below ? Rt + (R0 - Rt) * u * u : Rt + (Rtop - Rt) * u * u; pts.push(new THREE.Vector2(rad, y)); pin.push(new THREE.Vector2(rad - .45, y)); }
    const shell = new THREE.LatheGeometry(pts, 64); const uv = shell.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 1.2);
    B.add(shell, M.tower, C); B.add(new THREE.LatheGeometry(pin, 48), M.towerIn, C);
    const band = pts.filter(p => p.y > legH + (Ht - legH) * .8 && p.y < legH + (Ht - legH) * .87).map(p => new THREE.Vector2(p.x + .07, p.y));
    B.add(new THREE.LatheGeometry(band, 64), M.accent, C);
    B.add(new THREE.TorusGeometry(Rtop - .1, .35, 6, 48).rotateX(Math.PI / 2), M.dark, W(C, 0, Ht, 0));
    // X-lattice legs + ring beam
    const legs = 28;
    for (let i = 0; i < legs; i++) { const a = i / legs * 6.283, b = (i + 1) / legs * 6.283, ro = R0 - .15;
      const pa0 = new THREE.Vector3(Math.cos(a) * ro, 0, Math.sin(a) * ro), pb1 = new THREE.Vector3(Math.cos(b) * ro, legH, Math.sin(b) * ro), pa1 = new THREE.Vector3(Math.cos(a) * ro, legH, Math.sin(a) * ro), pb0 = new THREE.Vector3(Math.cos(b) * ro, 0, Math.sin(b) * ro);
      strut(B, i % 2 ? M.dmetal : M.accent, pa0, pb1, .28, C); strut(B, M.dmetal, pb0, pa1, .28, C); }
    B.add(new THREE.TorusGeometry(R0 - .1, .4, 6, 56).rotateX(Math.PI / 2), M.dark, W(C, 0, legH, 0));
    B.add(new THREE.TorusGeometry(R0 - .1, .3, 6, 56).rotateX(Math.PI / 2), M.accent, W(C, 0, .25, 0));
    cyl(R0 - .6, .15, M.black, W(C, 0, .05, 0), CYL32);
    railing(C, circle(R0 + 2.1, 32), 0);
    towerTops.push({ p: new THREE.Vector3(x, TOP + Ht, z), R: Rtop });
  }
  coolingTower(4.5, -11, 27, 8.4, 5.6, 6.6);
  coolingTower(14, 1.5, 24.5, 7.4, 5, 5.9);
  // blue steel support frames under the towers (right edge)
  for (let k = 0; k < 3; k++) { const fb = W(O, 20, TOP, -14 + k * 8); for (const zz of [-2.4, 2.4]) box(.4, 4, .4, M.accent, W(fb, 0, 0, zz)); box(.4, .4, 5.2, M.accent, W(fb, 0, 3.8, 0));
    strut(B, M.dmetal, new THREE.Vector3(0, .2, -2.4), new THREE.Vector3(0, 3.8, 2.4), .16, fb); strut(B, M.dmetal, new THREE.Vector3(0, 3.8, -2.4), new THREE.Vector3(0, .2, 2.4), .16, fb); }

  // ================================================================== PIPEWORK
  function pipe(points, rad = .7, supports = true) {
    const v = points.map(p => new THREE.Vector3(p[0], TOP + p[1], p[2]));
    // straight runs with tight elbows (short arcs at each corner)
    const path = new THREE.CurvePath();
    for (let i = 0; i < v.length - 1; i++) {
      const a = v[i], b = v[i + 1];
      const aa = i > 0 ? a.clone().lerp(b, Math.min(.5, rad * 1.6 / a.distanceTo(b))) : a, bb = i < v.length - 2 ? b.clone().lerp(a, Math.min(.5, rad * 1.6 / a.distanceTo(b))) : b;
      if (i > 0) { const prevEnd = v[i - 1].clone().lerp(a, 1 - Math.min(.5, rad * 1.6 / v[i - 1].distanceTo(a))); path.add(new THREE.QuadraticBezierCurve3(prevEnd, a, aa)); }
      path.add(new THREE.LineCurve3(aa, bb));
    }
    B.add(new THREE.TubeGeometry(path, v.length * 24, rad, 16, false), M.pipe, O);
    for (let i = 0; i < v.length - 1; i++) { const a = v[i], b = v[i + 1], L = a.distanceTo(b), d = b.clone().sub(a).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      for (let k = 1; k < Math.max(2, Math.round(L / 3.5)); k++) { const p = a.clone().lerp(b, k / Math.max(2, Math.round(L / 3.5)));
        B.add(new THREE.TorusGeometry(rad + .1, .14, 6, 16), M.dmetal, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
        if (supports && Math.abs(d.y) < .3 && p.y - TOP > 2.5 && k % 2 === 1) { box(.25, p.y - TOP - rad, .25, M.dmetal, W(O, p.x, TOP, p.z)); box(rad * 2.4, .2, .5, M.dmetal, W(O, p.x, p.y - rad - .2, p.z)); } } }
  }
  pipe([[3, 12.8, 4], [8.2, 12.8, 4], [8.2, 12.8, -3.6], [8.2, 8.5, -5.2]], 1.05);
  pipe([[3, 10.2, 9.5], [10.6, 10.2, 9.5], [10.6, 10.2, 5.8], [10.6, 6.5, 4.6]], 1);
  pipe([[7.2, 6.2, -.5], [11, 6.2, -.5], [11, 6.2, -4.5], [11, 4, -6]], .8);
  pipe([[-1.5, 14.2, -8], [-1.5, 16, -8], [-1.5, 16, -10.5], [-.8, 12, -11]], .55);
  pipe([[6.8, 4.5, 11], [9.2, 4.5, 11], [9.2, 4.5, 13.2], [9.2, 3.4, 13.2]], .5, false);

  // ================================================================== TURBINE / GENERATOR (front-right)
  const G = W(O, 9.8, TOP, 14.5);
  cbox(15, .7, 7.6, .2, M.dark, G);
  for (const x of [-5.5, -1.5, 2.5, 5.5]) { box(.4, 1.2, 6, M.dmetal, W(G, x, .7, 0)); }
  { const ax = W(G, -.5, 4.1, 0, 0, 0, Math.PI / 2);
    cyl(3, 8, M.metal, W(ax, 0, -4, 0), CYL32);
    for (let i = 0; i <= 8; i++) B.add(new THREE.TorusGeometry(3.04, .14, 6, 32).rotateX(Math.PI / 2), M.dmetal, W(ax, 0, -4 + i, 0));
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; box(.08, 7.6, .12, M.dmetal, W(ax, Math.cos(a) * 3.02, -3.8, Math.sin(a) * 3.02, -a)); }
    B.add(new THREE.CylinderGeometry(1.1, 2.9, 2.2, 32), M.metal, W(ax, 0, 5.1, 0).multiply(T(0, 0, 0, 0, Math.PI, 0)));
    cyl(.45, 2.5, M.dmetal, W(ax, 0, 6, 0)); cyl(3.1, .3, M.dmetal, W(ax, 0, 3.85, 0), CYL32); cyl(3.1, .3, M.dmetal, W(ax, 0, -4.15, 0), CYL32); }
  { const hb = W(G, -6.2, .7, 0); cbox(3.2, 4.6, 5, .3, M.metal, hb); louver(W(hb, 0, 1.2, 2.52), 2.2, 2.4, 7); for (const zz of [-1.5, 1.5]) acUnit(W(hb, 0, 4.6, zz).multiply(T(0, 0, 0, 0, 0, 0, .55, .45, .55))); }
  { const eb = W(G, 6.2, .7, 0); cbox(2.4, 3, 3.2, .2, M.dmetal, eb); cbox(1.8, 2.4, 2.4, .15, M.metal, W(eb, 1.8, 0, 0)); }
  railing(G, [[-7.4, 3.7], [7.4, 3.7]], .7, 1); railing(G, [[-7.4, -3.7], [7.4, -3.7]], .7, 1);

  // ================================================================== TRANSFORMERS / CABINETS (right)
  for (const [x, z, s] of [[18.5, 13, 1], [18.5, 8.2, .9], [15, 19, .8]]) {
    const cb = W(O, x, TOP, z); cbox(3.4 * s, 4 * s, 3.8 * s, .15, M.cladding, cb);
    for (let k = -1; k <= 1; k += 2) box(.07, 3.2 * s, 1.6 * s, M.dmetal, W(cb, -1.72 * s, .3, k * .9 * s));
    B.add(new THREE.PlaneGeometry(.9, .9), M.sign, W(cb, -1.77 * s, 2.9 * s, 0, -Math.PI / 2));
    for (let i = 0; i < 6; i++) box(.05, 3 * s, .06, M.slat, W(cb, .4 + i * .22, .4, 1.92 * s));
    for (let i = 0; i < 3; i++) { const ib = W(cb, 0, 4 * s, -1 + i); for (let k = 0; k < 4; k++) cyl(.26 - k * .02, .3, M.dmetal, W(ib, 0, k * .32, 0), CYL8); }
    box(3.5 * s, .2, 3.9 * s, M.accent, W(cb, 0, 3.6 * s, 0));
  }
  // service block, crates and lamps
  { const sb = W(O, 16, TOP, -17.5); cbox(6, 3.8, 4.5, .3, M.cladding, sb); box(6.1, .6, 4.6, M.accent, W(sb, 0, 2.8, 0)); cbox(6.3, .35, 4.8, .15, M.dark, W(sb, 0, 3.8, 0)); louver(W(sb, -1.2, .9, 2.27), 2, 2, 6); box(1.2, 2.6, .08, M.dmetal, W(sb, 1.6, .2, 2.27)); }
  for (const [x, z] of [[-20, 20], [20, 20], [20, -20], [-20, -20]]) { cyl(.1, 5, M.dmetal, W(O, x, 3.4, z), CYL8); box(.6, .3, .6, M.lamp, W(O, x, 8.3, z)); }

  B.build(group);

  // ================================================================== steam + smoke
  const soft = softTex();
  const NP = 300, pos = new Float32Array(NP * 3), col = new Float32Array(NP * 4), size = new Float32Array(NP), life = new Float32Array(NP), vel = new Float32Array(NP * 3), kind = new Uint8Array(NP);
  const emitters = [...towerTops.map(t => ({ p: t.p, R: t.R * .75, steam: true })), { p: new THREE.Vector3(-15.5, TOP + 31, -12), R: .9 }, { p: new THREE.Vector3(-8.5, TOP + 35, -17), R: 1 }];
  const spawn = i => { const e = emitters[i % emitters.length], a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * e.R;
    pos.set([e.p.x + Math.cos(a) * rr, e.p.y, e.p.z + Math.sin(a) * rr], i * 3); vel.set([(Math.random() - .5) * .6 + .9, (e.steam ? 2.8 : 2.1) + Math.random(), (Math.random() - .5) * .6], i * 3); kind[i] = e.steam ? 1 : 0; life[i] = 0; };
  for (let i = 0; i < NP; i++) { spawn(i); life[i] = Math.random(); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(col, 4)); pg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const pm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: soft }, scale: { value: 400 } }]), { uTint: window.PP_TINT || (window.PP_TINT = { value: new THREE.Color(1, 1, 1) }) }),   // uTint: day/night light
    vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
      #include <fog_pars_vertex>
      void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_PointSize = size * scale / max(1., -mvPosition.z); gl_Position = projectionMatrix * mvPosition; vC = color;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 uTint; varying vec4 vC;
      #include <fog_pars_fragment>
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb * uTint, vC.a * t.a); if (gl_FragColor.a < .01) discard;
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <encodings_fragment>
      }` });
  const plume = new THREE.Points(pg, pm); plume.frustumCulled = false; group.add(plume);
  function update(dt, camera) {
    const ws = group.getWorldScale(_s).x;
    if (camera) { const h = (camera.userData.viewH || innerHeight) * Math.min(devicePixelRatio, 2); pm.uniforms.scale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * ws; }
    for (let i = 0; i < NP; i++) { const LIFE = kind[i] ? 6.5 : 5; life[i] += dt / LIFE; if (life[i] >= 1) spawn(i);
      const u = life[i]; pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt * (1 - u * .6); pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = (kind[i] ? 5.5 : 2.4) + u * (kind[i] ? 15 : 8);
      const a = Math.min(1, u * 6) * (1 - u) * (kind[i] ? .55 : .5), c = kind[i] ? .93 : .4 + u * .22; col.set([c, c, c * (kind[i] ? 1.02 : 1), a], i * 4); }
    pg.attributes.position.needsUpdate = pg.attributes.color.needsUpdate = pg.attributes.size.needsUpdate = true;
  }
  update(0.001);
  return { group, update, footprint: 46, height: 38 };
}
window.PowerPlant = { build };
})();
