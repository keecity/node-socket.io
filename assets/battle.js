// =====================================================================================
// Battle system for Flat Planet, ported from "Town Duel" (demo.html):
// mecha robots, gunships, destructible towns, roads, weapons, damage and effects.
//
// The demo was authored in small "demo units" (a robot is ~0.9 tall). The whole battle
// runs in those units inside `battleRoot`, which is scaled by S onto the planet.
// Positions wrap every W demo units (the planet is a torus), so every distance and
// direction goes through wd()/wdist(); rendered objects are drawn at the copy nearest
// the camera (disp()).
//
// Uses from the page (global scope): THREE, scene, camera, renderer, cam, SIZE, heightAt,
// slopeAt, mod, HORIZON, FOG_NEAR, FOG_FAR, SUN, pickGround.
// =====================================================================================
(function () {
'use strict';
const BATTLE_S = 12;
// robots are drawn RS times the demo's size; their motion, reach and hit volumes scale with them
const RS = 1.5;
const S = BATTLE_S, W = SIZE / S;
const wd = d => d - W * Math.round(d / W);                          // shortest wrapped delta
const wm = x => ((x % W) + W) % W;
const wdist2 = (ax, az, bx, bz) => Math.hypot(wd(bx - ax), wd(bz - az));
const Hd = (x, z) => heightAt(x * S, z * S) / S;                     // terrain height, demo units
function HN(x, z, out) { const e = 0.05; return out.set(Hd(x - e, z) - Hd(x + e, z), 2 * e, Hd(x, z - e) - Hd(x, z + e)).normalize(); }
const RNG = Math.random, rand = (a, b) => a + RNG() * (b - a), chance = p => RNG() < p;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
const camD = () => ({ x: cam.x / S, z: cam.z / S });
const disp = (x, c) => x + W * Math.round((c - x) / W);             // copy of x nearest to c
const _Zax = new THREE.Vector3(0, 0, 1), _odir = new THREE.Vector3();
const orient = (m, v) => { _odir.copy(v).normalize(); if (_odir.lengthSq() > 0) m.quaternion.setFromUnitVectors(_Zax, _odir); };   // point +Z along v
const toDemo = (obj, out) => obj.getWorldPosition(out).divideScalar(S);
// wrap-aware distance between two demo-space points
function wdist3(a, b) { return Math.hypot(wd(b.x - a.x), b.y - a.y, wd(b.z - a.z)); }
// bring point b into a's frame (so b - a is the short way round)
function near(b, a, out) { return out.set(a.x + wd(b.x - a.x), b.y, a.z + wd(b.z - a.z)); }

const RUN_SLASH_X = [0.0, 0.03609, 0.0694, 0.09994, 0.1277, 0.15268, 0.17489, 0.19432, 0.21098, 0.22486, 0.23596, 0.24429, 0.24984, 0.25262, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297, 0.25297];
const GAIT = { Walk_Forward: 0.5279, Walk_Back: 0.3495, Walk_Strafe_L: 0.25, Walk_Strafe_R: 0.25, Run_Forward: 1.1243 };

// ------------------------------------------------------------------ towns & roads (planned before the light bake)
const TOWN = 6.4, ROADS = [0, -3.2, 3.2], ROAD_W = 0.46, PLAZA_R = 1.35;
const TOWNS = []; let Battle_roadSegs = [];                    // {x,z} centres in demo units, [0] = player HQ, [1] = enemy HQ
const RM = 2048;                     // road mask resolution (2 world units per texel)
const roadMask = new Float32Array(RM * RM), paintMask = new Float32Array(RM * RM);
let roadTex = null;
function roadAt(xw, zw) { const i = Math.floor(mod(xw, SIZE) / SIZE * RM), j = Math.floor(mod(zw, SIZE) / SIZE * RM); return roadMask[j * RM + i]; }
function noTreesAt(xw, zw) {                    // world units: keep forests off roads and out of towns
  if (roadAt(xw, zw) > 0.02) return true;
  for (const t of TOWNS) if (Math.hypot(wd(xw / S - t.x), wd(zw / S - t.z)) < TOWN + 1.6) return true;
  for (let i = 0; i < Math.min(2, TOWNS.length); i++) { const t = TOWNS[i]; if (Math.abs(wd(xw / S - t.x - 6.2)) < 2.8 && Math.abs(wd(zw / S - t.z - 6.2)) < 2.8) return true; }   // power plant lots
  return false;
}
function planTowns() {
  const r = mulberry(seed ^ 0x51ab);
  const hAt = (x, z) => heightAt(x, z);
  // 1) pick flat, dry sites far apart and away from the wrap seam
  const cands = [];
  for (let k = 0; k < 2500; k++) {
    const x = 200 + r() * (SIZE - 400), z = 200 + r() * (SIZE - 400), h0 = hAt(x, z);
    if (h0 < 4 || h0 > 45) continue;
    let s = 0, lo = 1e9, hi = -1e9;
    for (let a = 0; a < 12; a++) for (const rr of [40, 80]) { const h = hAt(x + Math.cos(a / 12 * 6.283) * rr, z + Math.sin(a / 12 * 6.283) * rr); lo = Math.min(lo, h); hi = Math.max(hi, h); s += Math.abs(h - h0); }
    if (lo < 2) continue;
    cands.push({ x, z, score: s + (hi - lo) * 4 });
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands) {
    if (TOWNS.length >= 5) break;
    if (TOWNS.every(t => Math.hypot(wd(c.x / S - t.x), wd(c.z / S - t.z)) * S > 700)) TOWNS.push({ x: c.x / S, z: c.z / S });
  }
  // HQs: the two towns furthest apart
  let best = [0, 1], bd = -1;
  for (let i = 0; i < TOWNS.length; i++) for (let j = i + 1; j < TOWNS.length; j++) { const d = wdist2(TOWNS[i].x, TOWNS[i].z, TOWNS[j].x, TOWNS[j].z); if (d > bd) { bd = d; best = [i, j]; } }
  const [a, b] = best, ta = TOWNS[a], tb = TOWNS[b];
  const rest = TOWNS.filter((_, i) => i !== a && i !== b); TOWNS.length = 0; TOWNS.push(ta, tb, ...rest);

  // 2) flatten the ground under each town
  const R0 = (TOWN + 3.6) * S, R1 = R0 * 1.6;
  for (const t of TOWNS) {
    const cx = t.x * S, cz = t.z * S; let sum = 0, n = 0;
    for (let k = 0; k < 200; k++) { const a2 = r() * 6.283, rr = Math.sqrt(r()) * R0; sum += hAt(cx + Math.cos(a2) * rr, cz + Math.sin(a2) * rr); n++; }
    const T = Math.max(4, sum / n); t.h = T;
    const i0 = Math.floor((cx - R1) / CELL), i1 = Math.ceil((cx + R1) / CELL), j0 = Math.floor((cz - R1) / CELL), j1 = Math.ceil((cz + R1) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * CELL - cx, j * CELL - cz); if (d > R1) continue;
      const w = d < R0 ? 1 : 1 - smooth((d - R0) / (R1 - R0)); const g = at(i, j);
      H[g] += (T + (H[g] - T) * 0.04 - H[g]) * w;       // keep a hint of the original relief
    }
  }
  // 3) roads: town grids + roads linking each town to its two nearest neighbours
  const segs = [];
  for (const t of TOWNS) for (const k of ROADS) {
    const E = TOWN + 1;
    segs.push([t.x - E, t.z + k, t.x + E, t.z + k, true], [t.x + k, t.z - E, t.x + k, t.z + E, true]);
  }
  const links = new Set();
  TOWNS.forEach((t, i) => {
    TOWNS.map((u, j) => ({ j, d: wdist2(t.x, t.z, u.x, u.z) })).filter(o => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 2)
      .forEach(({ j }) => { const key = Math.min(i, j) + ':' + Math.max(i, j); if (!links.has(key)) { links.add(key); const u = TOWNS[j]; segs.push([t.x, t.z, t.x + wd(u.x - t.x), t.z + wd(u.z - t.z), false]); } });
  });
  const rhalf = ROAD_W / 2 * S;
  Battle_roadSegs = segs;
  for (const [x0, z0, x1, z1, town] of segs) {
    const X0 = x0 * S, Z0 = z0 * S, X1 = x1 * S, Z1 = z1 * S, L = Math.hypot(X1 - X0, Z1 - Z0), dx = (X1 - X0) / L, dz = (Z1 - Z0) / L;
    // smoothed height profile along the road, then cut/fill the ground to it
    const n = Math.ceil(L / 4), prof = [];
    for (let k = 0; k <= n; k++) prof.push(hAt(X0 + dx * L * k / n, Z0 + dz * L * k / n));
    // smooth the profile twice (wide box filters ≈ gaussian) so grades change gradually
    let sm = prof; for (let pass = 0; pass < 2; pass++) sm = sm.map((_, k) => { let s2 = 0, c = 0; for (let q = -10; q <= 10; q++) { s2 += sm[clamp(k + q, 0, n)]; c++; } return s2 / c; });
    const cut = new Map();
    for (let k = 0; k <= n; k++) {
      const px = X0 + dx * L * k / n, pz = Z0 + dz * L * k / n, target = sm[k];
      if (!town && target < 1.5) continue;             // no roads through the sea
      const ci = Math.round(px / CELL), cj = Math.round(pz / CELL);
      if (!town) for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) {
        // each ground cell gets ONE target: the profile height at its own position along the road (no per-sample steps)
        const qx = (ci + i) * CELL, qz = (cj + j) * CELL, perp = Math.abs((qx - X0) * -dz + (qz - Z0) * dx);
        if (perp > rhalf + 10) continue;
        const u = clamp(((qx - X0) * dx + (qz - Z0) * dz) / L, 0, 1) * n, k0 = Math.floor(u), k1 = Math.min(n, k0 + 1);
        const g = at(ci + i, cj + j), tg = sm[k0] + (sm[k1] - sm[k0]) * (u - k0), prev = cut.get(g);
        if (!prev || perp < prev.perp) cut.set(g, { perp, tg });
      }
      // paint the mask
      const mi = Math.round(mod(px, SIZE) / SIZE * RM), mj = Math.round(mod(pz, SIZE) / SIZE * RM), tx = SIZE / RM;
      for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) {
        const qx = (mi + i) * tx, qz = (mj + j) * tx, rx = qx - mod(px, SIZE), rz = qz - mod(pz, SIZE);
        const perp = Math.abs(rx * -dz + rz * dx), along = (k * L / n) + rx * dx + rz * dz;
        const cov = 1 - smooth((perp - rhalf + 1) / 2); if (cov <= 0) continue;
        const g = mod(mj + j, RM) * RM + mod(mi + i, RM); roadMask[g] = Math.max(roadMask[g], cov);
      }
    }
    for (const [g, { perp, tg }] of cut) {                  // cut / fill with a soft shoulder
      if (tg < 1.5) continue;
      const w = perp < rhalf + 2 ? 1 : 1 - smooth((perp - rhalf - 2) / 8);
      H[g] += (tg - H[g]) * w;
    }
  }
  const data = new Uint8Array(RM * RM * 4);
  for (let q = 0; q < RM * RM; q++) { data[q * 4] = roadMask[q] * 255; data[q * 4 + 1] = paintMask[q] * 255; data[q * 4 + 3] = 255; }
  roadTex = new THREE.DataTexture(data, RM, RM, THREE.RGBAFormat);
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping; roadTex.magFilter = roadTex.minFilter = THREE.LinearFilter; roadTex.needsUpdate = true;
}

// ------------------------------------------------------------------ scene root, lights, shared textures
const battleRoot = new THREE.Group(); battleRoot.scale.setScalar(S); scene.add(battleRoot);
const hitLight = new THREE.PointLight(0xffffff, 0, 1.8 * S); scene.add(hitLight);
const texLoader = new THREE.TextureLoader();
function tex(name) { const t = texLoader.load('assets/' + name); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; }
const T_SIDING = tex('siding.jpg'), T_ROOF = tex('roof.jpg');
function canvasTex(size, draw, srgb = true) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); if (srgb) t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
const T_STONE = canvasTex(256, (g, Sz) => { const r = mulberry(5); g.fillStyle = '#b9aa92'; g.fillRect(0, 0, Sz, Sz);
  for (let y = 0; y < Sz; y += 42) for (let x = -(y / 42 % 2) * 40; x < Sz; x += 80) { const v = 160 + r() * 50 | 0; g.fillStyle = `rgb(${v},${v - 10},${v - 26})`; g.fillRect(x + 3, y + 3, 74, 36); }
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(60,50,40,${r() * .25})`; g.fillRect(r() * Sz, r() * Sz, 2, 2); } });
const T_SOFT = canvasTex(64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);
const T_MARK = canvasTex(64, (g) => { g.clearRect(0, 0, 64, 64); const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.25, 'rgba(255,255,255,.9)'); gr.addColorStop(0.75, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);

// ------------------------------------------------------------------ particles (CPU simulated points)
let trauma = 0;
function addShake(a, at) { const c = camD(); const d = at ? Math.hypot(wd(at.x - c.x), wd(at.z - c.z)) : 0; trauma = Math.min(1, trauma + a * 0.5 * clamp(1.4 - d * 0.04, 0, 1)); }
class Particles {
  constructor(cap, additive, atlas = null) {
    this.cap = cap; this.n = 0; const g = new THREE.BufferGeometry();
    this.raw = new Float32Array(cap * 3); this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.size = new Float32Array(cap);
    this.v = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap);
    this.c0 = new Float32Array(cap * 4); this.c1 = new Float32Array(cap * 4); this.grav = new Float32Array(cap); this.drag = new Float32Array(cap); this.fr = new Float32Array(cap * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('fr', new THREE.BufferAttribute(this.fr, 2).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: atlas || T_SOFT }, scale: { value: 600 }, fogColor: { value: HORIZON }, fogNear: { value: FOG_NEAR }, fogFar: { value: FOG_FAR } },
      vertexShader: `attribute float size; attribute vec4 color; attribute vec2 fr; varying vec4 vC; varying float vFog; varying vec2 vFr; uniform float scale,fogNear,fogFar;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/max(0.5,-mv.z); gl_Position=projectionMatrix*mv; vC=color; vFr=fr; vFog=smoothstep(fogNear,fogFar,-mv.z); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; varying vec4 vC; varying float vFog; varying vec2 vFr; void main(){
        ${atlas ? `vec2 pc=gl_PointCoord-0.5; float cs=cos(vFr.y), sn=sin(vFr.y); pc=vec2(cs*pc.x-sn*pc.y, sn*pc.x+cs*pc.y)+0.5; if(pc.x<0.||pc.x>1.||pc.y<0.||pc.y>1.) discard;
          vec2 cell=vec2(mod(vFr.x,3.),floor(vFr.x/3.)); vec4 tx=texture2D(map,vec2((cell.x+pc.x)/3.,1.-(cell.y+pc.y)/2.));` : `vec4 tx=texture2D(map,gl_PointCoord);`}
        float a=tx.a*vC.a; if(a<0.004) discard; vec3 rgb=vC.rgb*${atlas ? 'tx.rgb' : 'vec3(1.)'};
        gl_FragColor=vec4(mix(rgb,fogColor,vFog*${additive ? '0.0' : '0.8'}),a*${additive ? '(1.0-vFog)' : '1.0'});
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }` });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; battleRoot.add(this.pts); this.geo = g;
  }
  setScale(h) { this.mat.uniforms.scale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * S; }
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, grav = 0, drag = 0) {
    let i; if (this.n < this.cap) i = this.n++; else i = Math.floor(RNG() * this.cap);
    this.raw[i * 3] = x; this.raw[i * 3 + 1] = y; this.raw[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.c0.set(c0, i * 4); this.c1.set(c1, i * 4); this.grav[i] = grav; this.drag[i] = drag; this.fr[i * 2] = Math.floor(RNG() * 6); this.fr[i * 2 + 1] = RNG() * 6.283; return i;
  }
  update(dt) {
    const c = camD();
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { const j = --this.n; if (i !== j) { this.raw.copyWithin(i * 3, j * 3, j * 3 + 3); this.v.copyWithin(i * 3, j * 3, j * 3 + 3); this.col.copyWithin(i * 4, j * 4, j * 4 + 4);
          this.c0.copyWithin(i * 4, j * 4, j * 4 + 4); this.c1.copyWithin(i * 4, j * 4, j * 4 + 4); this.fr.copyWithin(i * 2, j * 2, j * 2 + 2); this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
          this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; } i--; continue; }
      const k = i * 3, u = 1 - this.life[i] / this.max[i], dr = Math.pow(1 - Math.min(0.99, this.drag[i]), dt);
      this.v[k] *= dr; this.v[k + 1] = this.v[k + 1] * dr - this.grav[i] * dt; this.v[k + 2] *= dr;
      this.raw[k] += this.v[k] * dt; this.raw[k + 1] += this.v[k + 1] * dt; this.raw[k + 2] += this.v[k + 2] * dt;
      const gy = Hd(this.raw[k], this.raw[k + 2]); if (this.raw[k + 1] < gy) { this.raw[k + 1] = gy; this.v[k + 1] *= -0.3; this.v[k] *= 0.6; this.v[k + 2] *= 0.6; }
      this.pos[k] = disp(this.raw[k], c.x); this.pos[k + 1] = this.raw[k + 1]; this.pos[k + 2] = disp(this.raw[k + 2], c.z);
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(u);
      const q4 = i * 4; for (let q = 0; q < 4; q++) this.col[q4 + q] = this.c0[q4 + q] + (this.c1[q4 + q] - this.c0[q4 + q]) * u;
      this.col[q4 + 3] *= Math.min(1, u / 0.08);
    }
    this.geo.setDrawRange(0, this.n); for (const a of ['position', 'color', 'size', 'fr']) this.geo.attributes[a].needsUpdate = true;
  }
}
const T_SMOKE = texLoader.load('assets/smoke.png'), T_FIRE = texLoader.load('assets/fire.png');
const particlesA = new Particles(8000, true), particlesN = new Particles(6000, false, T_SMOKE), particlesF = new Particles(3000, true, T_FIRE);
const PARTS = [particlesA, particlesN, particlesF];
const FX = {
  sparks(p, n, col = [1, 0.8, 0.5], speed = 1.6) { for (let i = 0; i < n; i++) { const a = rand(0, 6.28), e = rand(-0.2, 1.1), s = speed * rand(0.3, 1);
    particlesA.emit(p.x, p.y, p.z, Math.cos(a) * s, e * s, Math.sin(a) * s, rand(0.15, 0.45), 0.018, 0.004, [...col, 1], [col[0], col[1] * 0.5, col[2] * 0.3, 0], 3.2, 0.8); } },
  smoke(p, n, { size = [0.1, 0.5], life = [1.2, 2.6], col = [0.42, 0.4, 0.4], a = 0.55, vel = 0.12, up = 0.18 } = {}) { for (let i = 0; i < n; i++)
    particlesN.emit(p.x + rand(-.05, .05), p.y + rand(0, .04), p.z + rand(-.05, .05), rand(-1, 1) * vel, rand(0.4, 1) * up, rand(-1, 1) * vel, rand(...life), size[0], size[1] * rand(0.7, 1.2), [...col, a], [col[0] * 1.1, col[1] * 1.1, col[2] * 1.1, 0], -0.03, 0.6); },
  darkSmoke(p, n, big = 1) { for (let i = 0; i < n; i++) particlesN.emit(p.x + rand(-.015, .015), p.y, p.z + rand(-.015, .015), rand(-.03, .03), rand(0.22, 0.4), rand(-.03, .03), rand(1.4, 2.6), 0.05 * big, rand(0.3, 0.45) * big, [0.05, 0.045, 0.04, 0.75], [0.12, 0.11, 0.1, 0], -0.02, 0.5); },
  dust(p, n, { size = [0.06, 0.32], life = [0.6, 1.3], vel = 0.45, up = 0.08, a = 0.45 } = {}) { for (let i = 0; i < n; i++) { const ang = rand(0, 6.28), s = vel * rand(0.3, 1);
    particlesN.emit(p.x, p.y + 0.01, p.z, Math.cos(ang) * s, rand(0.2, 1) * up, Math.sin(ang) * s, rand(...life), size[0], size[1] * rand(0.7, 1.2), [0.62, 0.55, 0.44, a], [0.7, 0.64, 0.54, 0], 0.02, 1.8); } },
  fire(p, n, sz = 0.07) { for (let i = 0; i < n; i++) particlesF.emit(p.x + rand(-.03, .03), p.y + sz * 0.6, p.z + rand(-.03, .03), rand(-.03, .03), rand(0.15, 0.35), rand(-.03, .03), rand(0.35, 0.7), sz * 2.2, sz * 1.1, [1, 0.95, 0.85, 1], [1, 0.6, 0.3, 0], -0.1, 0.4); },
  flash(p, size = 0.35, col = [1, 0.85, 0.6]) { particlesA.emit(p.x, p.y, p.z, 0, 0, 0, 0.12, size, size * 1.6, [...col, 1], [...col, 0]); },
  explosion(p, power = 1) { FX.flash(p, 0.7 * power); for (let i = 0; i < 40 * power; i++) { const a = rand(0, 6.28), e = rand(0, 1), s = rand(0.3, 1.2) * power;
      particlesA.emit(p.x, p.y + 0.03, p.z, Math.cos(a) * s, e * s * 1.2, Math.sin(a) * s, rand(0.3, 0.7), rand(0.05, 0.12) * power, 0.02, [1, 0.7, 0.3, 1], [0.8, 0.15, 0.05, 0], 0.4, 2.2); }
    FX.sparks(p, 40 * power, [1, 0.75, 0.4], 2.6 * power); FX.smoke(p, 18 * power, { size: [0.15, 0.8 * power], life: [1.8, 3.5], col: [0.2, 0.18, 0.18], a: 0.7, vel: 0.35, up: 0.35 }); addShake(0.45 * power, p); },
  glass(p, n) { for (let i = 0; i < n; i++) particlesA.emit(p.x, p.y, p.z, rand(-.6, .6), rand(0, .9), rand(-.6, .6), rand(0.3, 0.7), 0.012, 0.006, [0.7, 0.85, 1, 0.9], [0.5, 0.7, 1, 0], 3.5, 0.4); },
  exhaust(p, dir, col) { particlesA.emit(p.x, p.y, p.z, dir.x * 1.2 + rand(-.1, .1), dir.y * 1.2 + rand(-.05, .1), dir.z * 1.2 + rand(-.1, .1), rand(0.08, 0.18), 0.05, 0.015, [...col, 0.9], [col[0] * 0.5, col[1] * 0.5, col[2], 0], 0, 1.5); },
};

// ------------------------------------------------------------------ ground marks (instanced decals)
function decalLayer(cap, texture, color, opacity) {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ map: texture, color: lin(color), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), cap);
  m.frustumCulled = false; m.count = 0; battleRoot.add(m); const layer = { m, cap, i: 0, n: 0 };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Qy = new THREE.Quaternion(), N = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  layer.add = (x, z, yaw, w, l) => { x = wm(x); z = wm(z); HN(x, z, N); Q.setFromUnitVectors(UP, N); Qy.setFromAxisAngle(UP, yaw); Q.multiply(Qy);
    M.compose(new THREE.Vector3(x, Hd(x, z) + 0.01, z), Q, new THREE.Vector3(w, 1, l)); m.setMatrixAt(layer.i, M); layer.i = (layer.i + 1) % cap; layer.n = Math.min(cap, layer.n + 1); m.count = layer.n; m.instanceMatrix.needsUpdate = true; };
  return layer;
}
const skidMarks = decalLayer(3000, T_MARK, 0x2a2420, 0.42), footprints = decalLayer(1200, T_MARK, 0x2e2822, 0.5), scorchMarks = decalLayer(900, T_SOFT, 0x0e0a08, 0.75);

// ------------------------------------------------------------------ destructible towns (instanced chunks)
const unitBox = new THREE.BoxGeometry(1, 1, 1);
function chunkMaterial(opts, K, atlas = false) {       // per-instance planar texture mapping that stays stuck to each flying chunk
  const m = new THREE.MeshStandardMaterial(opts);
  if (opts.map) { m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aOff; attribute float aTile; varying vec2 vLUV; varying float vTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 sc=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        vec3 ap=abs(normal); vec2 pl = ap.y>0.5 ? position.xz*sc.xz : (ap.x>0.5 ? position.zy*sc.zy : position.xy*sc.xy);
        vLUV=pl*${K.toFixed(2)}+aOff; vTile=aTile;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLUV; varying float vTile;').replace('#include <map_fragment>', atlas ?
      `vec2 fr=fract(vLUV); vec2 cell=vec2(mod(vTile,8.),floor(vTile/8.)); vec2 auv=vec2((cell.x+0.03+fr.x*0.94)/8., 1.-(cell.y+0.97-fr.y*0.94)/4.);
       vec2 gs=vec2(0.94/8.,0.94/4.); vec4 texelColor=textureGrad(map,auv,dFdx(vLUV)*gs,dFdy(vLUV)*gs); texelColor=mapTexelToLinear(texelColor); diffuseColor*=texelColor;`
      : 'vec4 texelColor=texture2D(map,vLUV); texelColor=mapTexelToLinear(texelColor); diffuseColor*=texelColor;');
  }; m.customProgramCacheKey = () => 'chunk' + K + atlas; }
  return m;
}
const GROUP_DEFS = {
  wall: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: T_SIDING, roughness: .9 }, 14, true), cap: 16000 },
  roof: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: T_ROOF, roughness: .8 }, 2.6), cap: 6000 },
  winLit: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: lin(0xffd690), emissive: lin(0xffb060), emissiveIntensity: 1.6, roughness: .3 }), cap: 2000 },
  winDark: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: lin(0x2a3444), metalness: .6, roughness: .15 }), cap: 2000 },
  trim: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85 }), cap: 1500 },
  stone: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: T_STONE, roughness: .95 }, 4), cap: 1500 },
  metal: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .55, roughness: .35 }), cap: 1800 },
  lamp: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: lin(0xffe2a8), emissive: lin(0xffc070), emissiveIntensity: 2 }), cap: 200 },
  wheel: { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateZ(Math.PI / 2), mat: new THREE.MeshStandardMaterial({ color: lin(0x1b1b1e), roughness: .8 }), cap: 500 },
};
function makeTownGroups(parent) {
  const G = {};
  for (const [k, d] of Object.entries(GROUP_DEFS)) {
    const geo = d.geo.clone(); const off = new Float32Array(d.cap * 2); for (let i = 0; i < off.length; i++) off[i] = Math.random();
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2)); geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(d.cap), 1)); geo.computeBoundingBox();
    const im = new THREE.InstancedMesh(geo, d.mat, d.cap); im.frustumCulled = false; im.count = 0;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(d.cap * 3).fill(1), 3);
    parent.add(im); G[k] = { im, n: 0, bb: geo.boundingBox, dirty: false };
  }
  return G;
}
const CH = [];                                   // chunk registry {grp, i, c, r, prop, attached, meta}
const _M = new THREE.Matrix4(), _P = new THREE.Vector3(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(), _C = new THREE.Color();
let curTown = null;
function addChunk(g, pos, quat, scale, color, prop, meta, tile = 0) {
  const grp = curTown.G[g]; if (grp.n >= grp.im.instanceMatrix.count) return -1; const i = grp.n++; grp.im.count = grp.n;
  const ta = grp.im.geometry.attributes.aTile; ta.setX(i, tile); ta.needsUpdate = true;
  _M.compose(pos, quat, scale); grp.im.setMatrixAt(i, _M); _C.set(color).convertSRGBToLinear(); grp.im.setColorAt(i, _C); grp.dirty = true;
  const id = CH.length; CH.push({ grp, i, c: pos.clone(), r: Math.max(scale.x, scale.y, scale.z) * 0.5, prop, attached: true, meta }); prop.chunks.push(id); return id;
}
const props = []; const propGrid = new Map(); const GRID = 0.6;
const gk = (x, z) => Math.floor(wm(x) / GRID) + ',' + Math.floor(wm(z) / GRID);
function registerProp(p) { props.push(p); for (let x = p.x - p.r; x <= p.x + p.r + GRID; x += GRID) for (let z = p.z - p.r; z <= p.z + p.r + GRID; z += GRID) { const k = gk(x, z); if (!propGrid.has(k)) propGrid.set(k, new Set()); propGrid.get(k).add(p); } }
function propsNear(x, z) { return propGrid.get(gk(x, z)) || []; }
function newProp(kind, x, z, rotY, r, h, extra = {}) { return Object.assign({ kind, x, z, rotY, r, h, y0: Hd(x, z), chunks: [], alive: true, detached: 0, hits: 0, town: curTown }, extra); }
const ROOFC = [0xffffff, 0xc0503a, 0x4a6a9a, 0x3f6e4a, 0x5a5560, 0x8a5a3a, 0x2f7a7a, 0xa83a4a, 0xc8a060, 0x6a4a7a];
function buildHouse(x, z, rot, r) {
  const w = 0.24 + r() * 0.14, d = 0.2 + r() * 0.1, two = r() < 0.25, h = (two ? 0.24 : 0.15) + r() * 0.03, t = 0.018, rh = 0.08 + r() * 0.05;
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => Hd(x + a * Math.cos(rot) + b * Math.sin(rot), z - a * Math.sin(rot) + b * Math.cos(rot)));
  const y0 = Math.min(...corners), yF = Math.max(...corners) + 0.012;
  const p = newProp('house', x, z, rot, Math.hypot(w, d) / 2 + 0.02, yF + h + rh, { hw: w / 2 + 0.02, hd: d / 2 + 0.02, y0, walls: [] });
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  const Wp = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
  const tile = Math.floor(r() * 24), wallC = 0xffffff, roofC = ROOFC[Math.floor(r() * ROOFC.length)], trimC = 0x6b5040;
  addChunk('stone', Wp(0, (y0 + yF) / 2 - 0.01, 0), q, new THREE.Vector3(w + 0.03, yF - y0 + 0.02, d + 0.03), 0xbbb0a0, p, { found: true });
  const CELLd = 0.045, rows = Math.max(3, Math.round(h / CELLd)), rhh = h / rows;
  const walls = [{ len: w, pos: (u) => [u, d / 2], ax: 'x' }, { len: w, pos: (u) => [u, -d / 2], ax: 'x' }, { len: d - t, pos: (u) => [w / 2, u], ax: 'z' }, { len: d - t, pos: (u) => [-w / 2, u], ax: 'z' }];
  walls.forEach((wl, wi) => {
    const cols = Math.max(3, Math.round(wl.len / CELLd)), cw = wl.len / cols, grid = [];
    for (let rr = 0; rr < rows; rr++) { grid.push([]); for (let c = 0; c < cols; c++) {
      const u = -wl.len / 2 + cw * (c + 0.5), [lx, lz] = wl.pos(u), ly = yF + rhh * (rr + 0.5);
      const isWin = (rr === 1 || (two && rr === rows - 2)) && c % 2 === 1 && c > 0 && c < cols - 1, isDoor = wi === 0 && rr === 0 && c === Math.floor(cols / 2);
      const sc = wl.ax === 'x' ? new THREE.Vector3(cw * 0.985, rhh * 0.985, isWin ? t * 0.6 : t) : new THREE.Vector3(isWin ? t * 0.6 : t, rhh * 0.985, cw * 0.985);
      const g = isWin ? (r() < 0.55 ? 'winLit' : 'winDark') : isDoor ? 'trim' : 'wall';
      grid[rr].push(addChunk(g, Wp(lx, ly, lz), q, sc, isWin ? 0xffffff : isDoor ? trimC : wallC, p, { wall: wi, row: rr, col: c, glass: isWin }, tile));
    } }
    p.walls.push(grid);
  });
  const top = yF + h, slope = Math.atan2(rh, d / 2), slen = Math.hypot(rh, d / 2) + 0.02, nx = Math.max(3, Math.round((w + 0.05) / 0.06)), ns = 3, tw = (w + 0.05) / nx;
  for (const sx of [1, -1]) for (let k = 0; k < 3; k++) { const gh = rh / 3, gw = d * (1 - (k + 0.5) / 3) * 0.98; addChunk('wall', Wp(sx * w / 2, top + gh * (k + 0.5), 0), q, new THREE.Vector3(t, gh * 0.98, gw), wallC, p, { gable: true }, tile); }
  for (const sz of [1, -1]) { const qs = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sz * slope));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ns; j++) { const along = (j + 0.5) / ns; const lz = sz * (d / 2 + 0.02) * along, ly = top + rh * (1 - along) + 0.008;
      addChunk('roof', Wp(-(w + 0.05) / 2 + tw * (i + 0.5), ly, lz), qs, new THREE.Vector3(tw * 0.97, 0.012, slen / ns * 0.97), roofC, p, { roof: true }); } }
  if (r() < 0.6) { addChunk('stone', Wp(w * 0.25, top + rh * 0.55, -d * 0.15), q, new THREE.Vector3(0.03, 0.05, 0.03), 0x8a6a5a, p, { roof: true }); addChunk('stone', Wp(w * 0.25, top + rh * 0.55 + 0.05, -d * 0.15), q, new THREE.Vector3(0.032, 0.05, 0.032), 0x7a5a4a, p, { roof: true }); }
  p.fire = r() < 0.5; p.total = p.chunks.length; registerProp(p);
}
function buildLamp(x, z) { const y = Hd(x, z), p = newProp('lamp', x, z, 0, 0.03, y + 0.18); const q = new THREE.Quaternion();
  for (let i = 0; i < 3; i++) addChunk('metal', new THREE.Vector3(x, y + 0.028 + i * 0.055, z), q, new THREE.Vector3(0.008, 0.054, 0.008), 0x2b2b30, p, {});
  addChunk('lamp', new THREE.Vector3(x, y + 0.172, z), q, new THREE.Vector3(0.024, 0.012, 0.024), 0xffffff, p, {}); p.total = p.chunks.length; registerProp(p); }
function buildCar(x, z, rot, r) { const y = Hd(x, z), p = newProp('car', x, z, rot, 0.045, y + 0.04); const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  const Wp = (a, b, c) => new THREE.Vector3(a, b, c).applyQuaternion(q).add(new THREE.Vector3(x, y, z));
  const col = [0xb83a32, 0x2f5d8a, 0xd8c24a, 0xe8e4dc, 0x3a3a40, 0x4a7a52][Math.floor(r() * 6)];
  addChunk('metal', Wp(0, 0.014, 0.018), q, new THREE.Vector3(0.036, 0.014, 0.036), col, p, {}); addChunk('metal', Wp(0, 0.014, -0.018), q, new THREE.Vector3(0.036, 0.014, 0.036), col, p, {});
  addChunk('winDark', Wp(0, 0.028, -0.004), q, new THREE.Vector3(0.03, 0.013, 0.034), 0xffffff, p, { glass: true });
  for (const [a, b] of [[0.019, 0.024], [-0.019, 0.024], [0.019, -0.024], [-0.019, -0.024]]) addChunk('wheel', Wp(a, 0.007, b), q, new THREE.Vector3(0.006, 0.014, 0.014), 0xffffff, p, {});
  p.total = p.chunks.length; registerProp(p); }
function buildFence(x, z, rot, len) { const y = Hd(x, z), p = newProp('fence', x, z, rot, len / 2, y + 0.04); const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  const Wp = (a, b, c) => new THREE.Vector3(a, b, c).applyQuaternion(q).add(new THREE.Vector3(x, y, z)); const n = Math.max(2, Math.round(len / 0.05));
  for (let i = 0; i < n; i++) addChunk('trim', Wp(-len / 2 + i * (len / (n - 1)), 0.018, 0), q, new THREE.Vector3(0.006, 0.036, 0.006), 0xe8e0d0, p, {});
  for (let i = 0; i < n - 1; i++) addChunk('trim', Wp(-len / 2 + (i + 0.5) * (len / (n - 1)), 0.028, 0), q, new THREE.Vector3(len / (n - 1), 0.006, 0.004), 0xe8e0d0, p, {});
  p.total = p.chunks.length; registerProp(p); }
function buildTower(x, z, teamCol) { const y = Hd(x, z), p = newProp('tower', x, z, 0, 0.12, y + 0.66, { hw: 0.09, hd: 0.09 }); const q = new THREE.Quaternion();
  for (let L = 0; L < 9; L++) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addChunk('stone', new THREE.Vector3(x + a * 0.04, y + 0.028 + L * 0.056, z + b * 0.04), q, new THREE.Vector3(0.079, 0.055, 0.079), 0xffffff, p, { row: L });
  addChunk('winLit', new THREE.Vector3(x, y + 0.4, z + 0.081), q, new THREE.Vector3(0.06, 0.06, 0.004), 0xffffff, p, { glass: true });
  for (let k = 0; k < 3; k++) addChunk('roof', new THREE.Vector3(x, y + 0.53 + k * 0.045, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)), new THREE.Vector3(0.16 - k * 0.05, 0.045, 0.16 - k * 0.05), teamCol || 0xa0a8c0, p, { roof: true });
  p.total = p.chunks.length; registerProp(p); return p; }
const onRoad = (v, m = 0) => ROADS.some(k => Math.abs(v - k) < ROAD_W / 2 + m);
const towns = [];
function buildTown(t, idx) {
  const root = new THREE.Group(); battleRoot.add(root);
  curTown = { root, G: makeTownGroups(root), x: t.x, z: t.z, idx, props: [] };
  const r = mulberry(seed + idx * 977); const STEP = 0.5, cx = t.x, cz = t.z;
  for (let x = -TOWN + 0.3; x <= TOWN - 0.3; x += STEP) for (let z = -TOWN + 0.3; z <= TOWN - 0.3; z += STEP) {
    const jx = x + (r() - .5) * 0.08, jz = z + (r() - .5) * 0.08, rr = Math.hypot(jx, jz);
    if (rr < PLAZA_R + 0.35 || onRoad(jx, 0.25) || onRoad(jz, 0.25) || rr > TOWN) continue;
    if (idx < 2 && jx > 3.9 && jz > 3.9) continue;                   // power plant lot
    const nearX = ROADS.some(k => Math.abs(jz - k) < 0.8), nearZ = ROADS.some(k => Math.abs(jx - k) < 0.8);
    if (r() < ((nearX || nearZ) ? 0.62 : 0.3)) {
      const nearestZ = ROADS.reduce((a, k) => Math.abs(jz - k) < Math.abs(jz - a) ? k : a, 99), nearestX = ROADS.reduce((a, k) => Math.abs(jx - k) < Math.abs(jx - a) ? k : a, 99);
      const rot = nearX ? (jz > nearestZ ? Math.PI : 0) : (jx > nearestX ? -Math.PI / 2 : Math.PI / 2);
      buildHouse(cx + jx, cz + jz, rot + (r() - .5) * 0.08, r);
      if (r() < 0.3) buildFence(cx + jx + (r() - .5) * 0.1, cz + jz + (r() < .5 ? 0.2 : -0.2), rot, 0.16 + r() * 0.1);
    }
  }
  for (const k of ROADS) for (let s = -TOWN + 0.6; s < TOWN - 0.6; s += 0.9) {
    if (Math.hypot(s, k) > PLAZA_R + 0.2 && !onRoad(s, 0.3)) { buildLamp(cx + s, cz + k + ROAD_W / 2 + 0.05); buildLamp(cx + k - ROAD_W / 2 - 0.05, cz + s); }
    if (r() < 0.3 && !onRoad(s, 0.3) && !(idx < 2 && s > 3.7 && k > 3)) buildCar(cx + s + 0.2, cz + k + (r() < .5 ? 0.1 : -0.1), Math.PI / 2, r);
    if (r() < 0.3 && !onRoad(s, 0.3) && !(idx < 2 && s > 3.7 && k > 3)) buildCar(cx + k + (r() < .5 ? 0.1 : -0.1), cz + s + 0.2, 0, r);
  }
  const teamCol = idx === 0 ? 0xff5aa8 : idx === 1 ? 0x46b8ff : null;
  if (idx < 2 && window.PowerPlant) {
    const PK = 2.3 / 46, px = cx + 6.2, pz = cz + 6.2;              // ~43 world units across, just outside the houses
    const plant = PowerPlant.build({ accent: idx === 0 ? 0xe0579c : 0x2f6fd6 });
    plant.group.scale.setScalar(PK); plant.group.position.set(px, Hd(px, pz) - 0.02, pz); plant.group.rotation.y = Math.PI;   // front faces the plaza
    root.add(plant.group); curTown.plant = plant;
    const half = 23 * PK;
    blockers.push({ x: px, z: pz, hw: half + 0.25, hd: half + 0.25 });
    const pp = newProp('plant', px, pz, 0, half * 1.42, Hd(px, pz) + 38 * PK, { hw: half, hd: half, y0: Hd(px, pz) - 0.05 }); pp.total = 0; registerProp(pp);
  }
  curTown.hq = buildTower(cx, cz - PLAZA_R + 0.2, teamCol);
  for (const k in curTown.G) { curTown.G[k].im.instanceMatrix.needsUpdate = true; curTown.G[k].im.instanceColor.needsUpdate = true; }
  towns.push(curTown); curTown.total = props.filter(p => p.town === curTown && p.kind !== 'plant').length; curTown.destroyed = 0;
  return curTown;
}

// ----------------------------------------------------- destruction
const debris = [], fires = [];
function detach(id, v, spin = 8) {
  const ch = CH[id]; if (!ch || !ch.attached) return; ch.attached = false; const p = ch.prop; p.detached++;
  const grp = ch.grp; grp.im.getMatrixAt(ch.i, _M); _M.decompose(_P, _Q, _S);
  if (ch.meta.glass) { FX.glass(_P, 8); if (grp === p.town.G.winLit) FX.flash(_P, 0.08, [1, 0.8, 0.5]); _S.set(0, 0, 0); _M.compose(_P, _Q, _S); grp.im.setMatrixAt(ch.i, _M); grp.dirty = true; return; }
  debris.push({ ch, grp, i: ch.i, p: _P.clone(), q: _Q.clone(), s: _S.clone(), v: v.clone(), w: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spin * rand(0.3, 1)), sleep: 0, age: 0 });
  if (debris.length > 2500) debris.shift();
}
function propDestroyed(p) { if (!p.alive) return; p.alive = false; p.town.destroyed++;
  const c = new THREE.Vector3(p.x, p.y0 + p.h * 0.3, p.z);
  if (p.kind === 'house' || p.kind === 'tower') { FX.dust(c, 26, { size: [0.15, 0.7], life: [1.6, 3.2], vel: 0.55, up: 0.2, a: 0.55 }); FX.smoke(c, 8, { size: [0.2, 0.9], col: [0.5, 0.46, 0.42], a: 0.5 }); addShake(0.28, c); if (p.fire) fires.push({ x: p.x, z: p.z, t: rand(6, 11) }); }
  if (p.kind === 'car') { FX.explosion(new THREE.Vector3(p.x, p.y0 + 0.03, p.z), 0.8); fires.push({ x: p.x, z: p.z, t: rand(5, 9) }); scorchMarks.add(p.x, p.z, 0, 0.35, 0.35); impact(new THREE.Vector3(p.x, p.y0 + 0.03, p.z), 0.22, null, 1.4, 'blast'); }
  if (p.kind === 'tower' && p === p.town.hq) hqDestroyed(p.town);
}
function collapse(p, push) { const c = new THREE.Vector3(p.x, 0, p.z);
  for (const id of p.chunks) { const ch = CH[id]; if (!ch.attached || ch.meta.found) continue; const out = ch.c.clone().sub(c).setY(0).normalize();
    detach(id, out.multiplyScalar(rand(0.1, 0.5)).add(push ? push.clone().multiplyScalar(rand(0.2, 0.6)) : new THREE.Vector3()).setY(rand(-0.1, 0.3)), 4); }
  propDestroyed(p); }
function checkIntegrity(p) {
  if (!p.alive) return;
  if (p.kind === 'house') {
    for (const grid of p.walls) { for (let r = 1; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) { const id = grid[r][c]; if (!CH[id].attached) continue;
        const below = CH[grid[r - 1][c]].attached, left = c > 0 && CH[grid[r][c - 1]].attached, right = c < grid[r].length - 1 && CH[grid[r][c + 1]].attached;
        if (!below && !(left && right)) detach(id, new THREE.Vector3(rand(-.1, .1), 0, rand(-.1, .1)), 3); } }
    let wallTotal = 0, wallOn = 0; for (const grid of p.walls) for (const row of grid) for (const id of row) { wallTotal++; if (CH[id].attached) wallOn++; }
    const frac = wallOn / wallTotal;
    if (frac < 0.72) for (const id of p.chunks) { const ch = CH[id]; if (ch.attached && (ch.meta.roof || ch.meta.gable)) detach(id, new THREE.Vector3(rand(-.2, .2), -0.1, rand(-.2, .2)), 3); }
    if (frac < 0.45) collapse(p);
  } else if (p.kind === 'tower') { const rows = {}; for (const id of p.chunks) { const ch = CH[id]; if (ch.meta.row !== undefined && ch.attached) rows[ch.meta.row] = (rows[ch.meta.row] || 0) + 1; }
    for (let L = 0; L < 9; L++) if ((rows[L] || 0) < 2) { collapse(p); break; } }
  else if (p.detached > 0) collapse(p);
}
// damage everything within radius of a point (pt in demo units, any wrapped copy)
function impact(pt, radius, dir, power, kind = 'hit') {
  const seen = new Set(); let any = false;
  for (let gx = pt.x - radius - GRID; gx <= pt.x + radius + GRID; gx += GRID) for (let gz = pt.z - radius - GRID; gz <= pt.z + radius + GRID; gz += GRID) for (const p of propsNear(gx, gz)) {
    if (seen.has(p) || !p.alive) continue; seen.add(p);
    if (wdist2(p.x, p.z, pt.x, pt.z) > p.r + radius + 0.05) continue; if (pt.y - radius > p.h) continue;
    const lp = near(pt, p, new THREE.Vector3());                  // impact point in the prop's frame
    let hitAny = false;
    if (p.kind === 'car' && kind !== 'bullet') p.hits = 99;
    for (const id of p.chunks) { const ch = CH[id]; if (!ch.attached) continue; const d = ch.c.distanceTo(lp); if (d > radius + ch.r) continue;
      const out = ch.c.clone().sub(lp); out.y = Math.max(out.y, 0); if (out.lengthSq() < 1e-6) out.set(rand(-1, 1), 0.5, rand(-1, 1)); out.normalize();
      const v = (dir ? dir.clone().multiplyScalar(power * rand(0.6, 1.1)) : new THREE.Vector3()).addScaledVector(out, power * rand(0.3, 0.8)); v.y += power * rand(0.15, 0.6);
      if (ch.meta.found) continue; detach(id, v, power * 8); hitAny = true; }
    if (hitAny) { any = true; p.hits++; if (p.kind === 'house' || p.kind === 'tower') FX.dust(lp, kind === 'bullet' ? 2 : 8, { size: [0.04, kind === 'bullet' ? 0.14 : 0.35], life: [0.6, 1.4], vel: 0.25, up: 0.12, a: 0.5 });
      if (p.kind === 'car' && p.hits < 3) FX.sparks(lp, 6, [1, 0.8, 0.5], 1.2);
      if (p.kind === 'car' && p.hits >= 3) collapse(p); else checkIntegrity(p); }
  }
  return any;
}
function pointInProp(p, pt) { if (pt.y > p.h + 0.01 || pt.y < p.y0 - 0.05) return false; const dx = wd(pt.x - p.x), dz = wd(pt.z - p.z);
  if (p.hw) { const c = Math.cos(-p.rotY), s = Math.sin(-p.rotY); const lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < p.hw && Math.abs(lz) < p.hd; }
  return Math.hypot(dx, dz) < p.r; }
function propHit(pos) { for (const p of propsNear(pos.x, pos.z)) if (p.alive && pointInProp(p, pos)) return true; return false; }
const _corner = new THREE.Vector3();
function updateDebris(dt) {
  for (const t of towns) for (const k in t.G) t.G[k].touched = false;
  for (let n = debris.length - 1; n >= 0; n--) { const d = debris[n]; if (d.sleep > 0.35) continue;
    d.age += dt; d.v.y -= 3.4 * dt; d.p.addScaledVector(d.v, dt);
    const ang = d.w.length(); if (ang > 1e-4) { _Q.setFromAxisAngle(_corner.copy(d.w).divideScalar(ang), ang * dt); d.q.premultiply(_Q); }
    const bb = d.grp.bb; let minY = 1e9;
    for (let k = 0; k < 8; k++) { _corner.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).multiply(d.s).applyQuaternion(d.q); minY = Math.min(minY, _corner.y); }
    const floor = Hd(d.p.x, d.p.z) - minY + 0.001;
    if (d.p.y < floor) { const vy = d.v.y; d.p.y = floor; if (vy < 0) d.v.y *= -0.25; d.v.x *= 0.62; d.v.z *= 0.62; d.w.multiplyScalar(0.55);
      if (vy < -0.9 && chance(0.25)) FX.dust(d.p, 1, { size: [0.03, 0.12], life: [0.4, 0.9], vel: 0.15, up: 0.05, a: 0.4 });
      if (d.v.lengthSq() < 0.004 && d.w.lengthSq() < 0.25) d.sleep += dt; }
    if (d.age > 9) d.sleep = 1;
    _M.compose(d.p, d.q, d.s); d.grp.im.setMatrixAt(d.i, _M); d.grp.touched = true;
  }
  for (const t of towns) for (const k in t.G) { const g = t.G[k]; if (g.touched || g.dirty) { g.im.instanceMatrix.needsUpdate = true; g.dirty = false; } }
  for (let i = fires.length - 1; i >= 0; i--) { const f = fires[i]; f.t -= dt; const y = Hd(f.x, f.z) + 0.02;
    if (chance(dt * 14)) FX.fire(new THREE.Vector3(f.x + rand(-.07, .07), y, f.z + rand(-.07, .07)), 1, 0.06);
    if (chance(dt * 7)) FX.darkSmoke(new THREE.Vector3(f.x, y + 0.08, f.z), 1, 1.3);
    if (f.t <= 0) fires.splice(i, 1); }
}

// ------------------------------------------------------------------ assets
let gltf = null, heliProto = null;
const gltfLoader = new THREE.GLTFLoader();
// decode embedded model textures straight from their buffers (no blob: URL fetches, which the page's CSP can block)
gltfLoader.register(parser => ({ name: 'csp_safe_textures', loadTexture(i) {
  const json = parser.json, t = json.textures[i], img = json.images[t.source]; if (img.bufferView === undefined || typeof createImageBitmap !== 'function') return null;
  return parser.getDependency('bufferView', img.bufferView).then(buf => createImageBitmap(new Blob([buf], { type: img.mimeType || 'image/png' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
    .then(bmp => { const tx = new THREE.Texture(bmp); tx.flipY = false; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = 4;
      const smp = t.sampler !== undefined ? json.samplers[t.sampler] : null; if (smp && smp.wrapS === 33071) tx.wrapS = THREE.ClampToEdgeWrapping; if (smp && smp.wrapT === 33071) tx.wrapT = THREE.ClampToEdgeWrapping;
      tx.needsUpdate = true; return tx; }); } }));
// models ship as base64 text (the artifact host serves text, not .glb)
const loadGLB = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); })
  .then(t => new Promise((res, rej) => { const bin = Uint8Array.from(atob(t.trim()), c => c.charCodeAt(0)); gltfLoader.parse(bin.buffer, '', res, rej); }));
const battleAssets = Promise.all([loadGLB('assets/mecha.b64.txt'), loadGLB('assets/heli.b64.txt')]).then(([g, h]) => { gltf = g; heliProto = h.scene; });

// ------------------------------------------------------------------ robots
const TEAM_COL = [[1, 0.55, 0.8], [0.55, 0.85, 1]];
const TEAM_NAME = ['Violet', 'Cobalt'];
function recolor(mat) {
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('void main() {', `
      vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
        float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }
      vec3 cobalt(vec3 c){ vec3 h=rgb2hsv(c); float purple=smoothstep(0.62,0.70,h.x)*(1.-smoothstep(0.93,0.99,h.x))*smoothstep(0.12,0.25,h.y);
        vec3 blue=hsv2rgb(vec3(0.595,min(1.,h.y*1.15),h.z*1.25)); vec3 o=mix(c,blue,purple);
        float creamy=(1.-smoothstep(0.15,0.35,h.y))*smoothstep(0.35,0.6,h.z); o=mix(o,o*vec3(0.9,0.96,1.06),creamy); return o; }
      void main() {`).replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb=cobalt(diffuseColor.rgb);'); };
  mat.customProgramCacheKey = () => 'cobalt';
}
const GUN_S = 0.34;
const robots = [], helis = [];
const _tmp = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), _fp = new THREE.Vector3();
function makeRobot(team, role, x, z) {
  const root = new THREE.Group(); const model = THREE.SkeletonUtils.clone(gltf.scene); root.add(model); root.scale.setScalar(RS); battleRoot.add(root);
  const mats = new Map();
  model.traverse(o => { if (o.isMesh) { o.frustumCulled = false;
    const src = Array.isArray(o.material) ? o.material : [o.material]; const cl = src.map(m => { if (!mats.has(m)) mats.set(m, m.clone()); return mats.get(m); }); o.material = Array.isArray(o.material) ? cl : cl[0]; } });
  const bodyMats = []; for (const m of mats.values()) { if (m.name === 'BeamRifle') continue; if (m.map) { m.roughness = 0.6; m.metalness = 0.2; bodyMats.push(m); }
    if (team === 1) { if (m.map) recolor(m); if (m.name === 'Weapon_Purple') m.color.set(0x12356b).convertSRGBToLinear();
      if (m.name === 'Beam_Glow') { m.color.setRGB(0.15, 0.75, 1.0); m.emissive.setRGB(0.1, 0.65, 1.0); } if (m.name === 'Beam_Core') m.emissive.setRGB(0.85, 0.97, 1.0); } }
  const mixer = new THREE.AnimationMixer(model); const actions = {}; for (const a of gltf.animations) actions[a.name] = mixer.clipAction(a);
  const n = name => model.getObjectByName(name);
  const nodes = { saber: n('BeamSaber'), blade: n('BeamSaber_Blade'), stowed: n('BeamSaber_Stowed'), fistR: n('HandFistR'), openR: n('HandOpenR'),
    gun: n('BeamRifle'), muzzle: n('BeamRifle_Muzzle'), fistL: n('HandFistL'), openL: n('HandOpenL'),
    flashL: n('HeadTurret_FlashL'), flashR: n('HeadTurret_FlashR'), chest: n('Chest'), head: n('Head'), footL: n('FootL'), footR: n('FootR') };
  const col = TEAM_COL[team];
  const flameMat = new THREE.MeshBasicMaterial({ color: team ? 0x8fe3ff : 0xffa0d0, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending });
  const flames = []; for (const fx of [-0.045, 0.045]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.12, 10), flameMat); f.rotation.x = -Math.PI / 2; f.position.set(fx, 0.03, -0.13); nodes.chest.add(f); flames.push(f); }
  // saber trail ribbon
  const TN = 22, tg = new THREE.BufferGeometry(); const tp = new Float32Array(TN * 2 * 3), ta = new Float32Array(TN * 2); const idx = [];
  for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  tg.setIndex(idx); tg.setAttribute('position', new THREE.BufferAttribute(tp, 3)); tg.setAttribute('alpha', new THREE.BufferAttribute(ta, 1));
  const tm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { c: { value: new THREE.Color(...col) } },
    vertexShader: `attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 c; varying float vA; void main(){ gl_FragColor=vec4(c*1.1,vA*0.45); }` });
  const trail = new THREE.Mesh(tg, tm); trail.frustumCulled = false; battleRoot.add(trail);
  const boneNames = ['Head', 'Chest', 'Waist', 'Pelvis', 'ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR', 'ForearmL', 'ForearmR', 'ThighL', 'ThighR', 'ShinL', 'ShinR'];
  const bones = boneNames.map(n).filter(Boolean);
  const f = { kind: 'robot', team, role, root, model, mixer, actions, nodes, flames, trail, trailHist: [], col, bodyMats, bones, wounds: [],
    pos: new THREE.Vector3(wm(x), 0, wm(z)), vel: new THREE.Vector3(), y: 0, vy: 0, yaw: rand(0, 6.28), hp: 1000, maxHp: 1000, state: 'idle', st: 0, clip: null, act: null,
    saberOut: false, cool: {}, hitDone: {}, fireAcc: 0, fireSide: 0, thinkT: rand(0, 0.5), bulletHits: 0, lastAction: '', lookT: 0, headQ: new THREE.Quaternion(),
    p: persona(role), boost: 100, strafeDir: 1, pending: null, airT: 0, gaitRate: rand(0.93, 1.07), footY: { L: 0, R: 0 }, lastSkid: { L: null, R: null }, gun: role === 'gunner' ? { energy: 100 } : null, target: null, order: null, sel: false, alive: true, koT: 0 };
  f.id = robots.length; robots.push(f);
  if (f.gun) makeGunFX(f);
  setState(f, 'idle', idleClip(f), 0.01); f.act.time = Math.random();
  makeBars(f, 0.95 * RS, 0.9);
  return f;
}
const LOOPS = new Set(['Battle_Idle', 'Boost_Forward', 'Boost_Back', 'Boost_Strafe_L', 'Boost_Strafe_R', 'Air_Hover', 'Head_Vulcan_Fire', 'Air_Vulcan_Fire', 'Saber_Idle', 'Walk_Forward', 'Walk_Back', 'Walk_Strafe_L', 'Walk_Strafe_R', 'Run_Forward', 'Gun_Idle']);
const SABER_CLIPS = new Set(['Saber_Draw', 'Saber_Idle', 'Saber_Slash_Combo', 'Saber_Dash_Thrust', 'Saber_Sheathe', 'Saber_Air_Slash', 'Saber_Run_Slash', 'Saber_Boost_Slash', 'Saber_Rising_Slash', 'Saber_Wide_Sweep', 'Saber_Stab_Combo', 'Saber_Cross_Cut', 'Saber_Parry_Riposte']);
function play(f, name, fade = 0.12) { const next = f.actions[name]; if (!next) return; const once = !LOOPS.has(name);
  next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = once; next.enabled = true; next.setEffectiveWeight(1).play();
  if (!once) { next.time = Math.random() * next.getClip().duration; next.timeScale = GAIT[name] ? f.gaitRate : rand(0.9, 1.1); }   // loops start out of phase so squads don't move in lockstep
  if (f.act && f.act !== next) f.act.crossFadeTo(next, fade, false); f.act = next; f.clip = name; f.clipT0 = f.st; }
const clipT = f => f.act ? f.act.time : 0;
const clipDone = f => f.act && f.act.loop === THREE.LoopOnce && f.act.time >= f.act.getClip().duration - 1e-3;
function setState(f, s, clip, fade) { if (f.act) f.act.timeScale = 1; f.lodge = null; f.flyV = 0; f.liftFx = 0; f.landFx = 0; f.state = s; f.st = 0; f.hitDone = {}; if (clip) play(f, clip, fade); }
const idleClip = f => f.saberOut ? 'Saber_Idle' : (f.gun ? 'Gun_Idle' : 'Battle_Idle');
function toIdle(f, fade = 0.14, think = 0.05) { setState(f, 'idle', idleClip(f), fade); f.thinkT = think; }
const groundY = f => Math.max(Hd(f.pos.x, f.pos.z), -3 / S);
const chestPos = (f, out) => out.set(f.pos.x, groundY(f) + (f.y + 0.56) * RS, f.pos.z);
const tgtPos = (t, out) => t.kind === 'robot' ? chestPos(t, out) : out.copy(t.pos);
const alive = t => t && (t.kind === 'robot' ? t.state !== 'ko' : t.alive);
const enemiesOf = team => robots.filter(r => r.team !== team && r.state !== 'ko');
const enemyHelisOf = team => helis.filter(h => h.team !== team && h.alive);

// ----------------------------------------------------- combat
const ATTACKS = {
  Saber_Slash_Combo: { hits: [[0.15, 0.31, 55, 'a saber cut', 'blade'], [0.45, 0.6, 55, 'a backhand sweep', 'blade'], [0.84, 1.0, 95, 'an overhead cleave', 'blade', 1]], saber: true },
  Saber_Run_Slash: { hits: [[0.13, 0.3, 85, 'a running cut', 'blade', 1]], saber: true, root: 'run' },
  Saber_Boost_Slash: { hits: [[0.5, 0.76, 110, 'a boost slash', 'blade', 1]], saber: true, root: 'boost' },
  Saber_Air_Slash: { hits: [[0.26, 0.43, 110, 'a diving cleave', 'blade', 1]], saber: true },
  Saber_Dash_Thrust: { hits: [[0.3, 0.44, 100, 'a thrust', 'blade', 1]], saber: true },
  Saber_Parry_Riposte: { hits: [[0.42, 0.57, 80, 'a riposte', 'blade', 1]], saber: true, parry: [0.04, 0.33] },
  Saber_Rising_Slash: { hits: [[0.16, 0.36, 65, 'a rising slash', 'blade', 1]], saber: true },
  Saber_Wide_Sweep: { hits: [[0.28, 0.48, 80, 'a wide sweep', 'blade', 1]], saber: true },
  Saber_Stab_Combo: { hits: [[0.1, 0.26, 45, 'a thrust', 'blade'], [0.34, 0.5, 55, 'a second thrust', 'blade']], saber: true },
  Saber_Cross_Cut: { hits: [[0.15, 0.3, 55, 'a cross cut', 'blade'], [0.46, 0.64, 70, 'an X-cut finisher', 'blade', 1]], saber: true },
  Melee_Punch_Combo: { hits: [[0.06, 0.16, 40, 'a jab', 'fistL'], [0.36, 0.48, 62, 'a cross', 'fistR']] },
  Melee_Boost_Kick: { hits: [[0.22, 0.36, 75, 'a boost kick', 'footR', 1]] },
};
function unitName(f) { return `${TEAM_NAME[f.team]} ${f.kind === 'heli' ? 'gunship' : (f.role === 'gunner' ? 'gunner' : 'striker')}`; }
function damage(att, def, amount, label, heavy, dir, at) {
  if (def.kind === 'heli') return heliHit(def, amount, att, at);
  if (def.state === 'ko') return;
  const facing = dir && new THREE.Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw)).dot(dir) < -0.3;
  const PA = def.state === 'attack' && ATTACKS[def.clip] && ATTACKS[def.clip].parry, pt = clipT(def);
  if (att && att.kind === 'robot' && PA && pt > PA[0] && pt < PA[1] && facing && (label || chance(0.7))) {    // parried: blades clash, attacker staggers
    def.nodes.blade.updateWorldMatrix(true, false); const clash = new THREE.Vector3(0, 0.2, 0).applyMatrix4(def.nodes.blade.matrixWorld).divideScalar(S); near(clash, def.pos, clash);
    FX.sparks(clash, label ? 60 : 6, [1, 0.85, 0.5], 2.4); if (label) { FX.sparks(clash, 25, att.col, 1.8); FX.sparks(clash, 25, def.col, 1.8); FX.flash(clash, 0.45, [1, 0.95, 0.8]); addShake(0.25, clash);
      if (att.state !== 'ko') { setState(att, 'hitL', 'Hit_React_Light', 0.04); att.vel.copy(dir).multiplyScalar(-0.3); } }
    return 'blocked'; }
  if (def.state === 'block' && clipT(def) > 0.04 && clipT(def) < 0.64 && facing) { amount = Math.round(amount * (label ? 0.2 : 0.3)); if (at) tmpA.copy(at); else chestPos(def, tmpA).addScaledVector(dir, -0.12);
    FX.sparks(tmpA, label ? 40 : 4, [1, 0.8, 0.45], 2);
    if (label) { setState(def, 'blockHit', 'Guard_Block_Hit', 0.04); def.vel.copy(dir).multiplyScalar(0.3); addShake(0.15, tmpA); }
    def.hp = Math.max(1, def.hp - amount); return 'blocked'; }
  def.hp = Math.max(0, def.hp - amount); def.lastHitBy = att;
  if (heavy || label || chance(0.08)) addWound(def, at ? at.clone() : chestPos(def, new THREE.Vector3()).add(new THREE.Vector3(rand(-.08, .08), rand(-.15, .1), rand(-.08, .08))));
  if (heavy && def.hp < 700) electricStorm(def, 3);
  if (at) tmpA.copy(at); else chestPos(def, tmpA);
  const acol = att ? att.col : [1, 0.8, 0.5];
  if (heavy || label) { FX.sparks(tmpA, heavy ? 60 : 22, acol, heavy ? 3 : 2); FX.flash(tmpA, heavy ? 0.5 : 0.25, acol); addShake(heavy ? 0.4 : 0.15, tmpA); hitLight.position.copy(tmpA).multiplyScalar(S); hitLight.color.setRGB(...acol); hitLight.intensity = heavy ? 6 : 3; }
  else FX.sparks(tmpA, 3, acol, 1);
  if (def.team === 0 && !def.underAttackT) { def.underAttackT = 6; }
  if (def.hp <= 0) { knockOut(def, att, dir); return 'hit'; }
  if (!def.target && att && def.order?.type !== 'move') def.target = att;          // fight back
  if (heavy) { setState(def, 'hit', 'Hit_React_Heavy', 0.05); if (dir) def.vel.copy(dir).multiplyScalar(0.7); }
  else if (!['attack', 'draw', 'sheathe', 'hit', 'dive', 'turn', 'gunBurst', 'gunCharge', 'gunBeam'].includes(def.state) && !(def.cool.flinch > 0) && (def.bulletHits >= 9 || amount >= 40)) {
    def.bulletHits = 0; def.cool.flinch = 1.6; if (def.y > 0.05) return 'hit'; setState(def, 'hitL', 'Hit_React_Light', 0.05); if (dir) def.vel.copy(dir).multiplyScalar(0.25); }
  return 'hit';
}
function knockOut(def, att, dir) {
  setState(def, 'ko', 'Defeat_Shutdown', 0.1); def.koT = 0; def.sel = false; if (dir) def.vel.copy(dir).multiplyScalar(0.9);
  addWound(def, chestPos(def, new THREE.Vector3())); electricStorm(def, 8); FX.explosion(chestPos(def, new THREE.Vector3()), 0.5);
  log(def.team, `${att ? `<b>${unitName(att)}</b> destroys ` : ''}<b>${unitName(def)}</b>`);
}
const bulletGeo = new THREE.BoxGeometry(0.007, 0.007, 0.09);
const bulletMats = [0xffb0d6, 0xb5ecff].map(c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
const bullets = []; for (let i = 0; i < 400; i++) { const m = new THREE.Mesh(bulletGeo, bulletMats[0]); m.visible = false; m.scale.set(4, 4, 2.2); m.frustumCulled = false; battleRoot.add(m); bullets.push({ m, p: new THREE.Vector3(), alive: false, v: new THREE.Vector3(), owner: null, life: 0 }); }
function aimAt(f, out) { const T = f.target; tgtPos(T, out); near(out, f.pos, out); out.addScaledVector(T.vel || _tmp.set(0, 0, 0), 0.12); return out; }
function fireBullet(f) {
  const node = (f.fireSide ^= 1) ? f.nodes.flashL : f.nodes.flashR; toDemo(node, tmpA); near(tmpA, f.pos, tmpA);
  if (!alive(f.target)) return; aimAt(f, tmpB);
  const b = bullets.find(b => !b.alive); if (!b) return;
  b.alive = true; b.m.visible = true; b.m.material = bulletMats[f.team]; b.owner = f; b.life = 1.8; b.p.copy(tmpA); b.v.subVectors(tmpB, tmpA).normalize().multiplyScalar(8);
  b.v.x += rand(-.15, .15); b.v.y += rand(-.1, .1); b.v.z += rand(-.15, .15);
  FX.flash(tmpA, 0.06, [1, 0.8, 0.5]); if (chance(0.3)) FX.smoke(tmpA, 1, { size: [0.02, 0.08], life: [0.3, 0.6], col: [0.6, 0.58, 0.55], a: 0.3, vel: 0.02, up: 0.05 });
}
// what does a projectile at pos (team) hit? returns {t: robot|heli} or null
function projHits(pos, team, rad) {
  for (const r of robots) { if (r.team === team || r.state === 'ko') continue; chestPos(r, tmpC); const tb = groundY(r) + r.y * RS;
    if (wdist3(pos, tmpC) < 0.17 * RS + rad || (Math.abs(wd(pos.x - r.pos.x)) < 0.09 * RS + rad && Math.abs(wd(pos.z - r.pos.z)) < 0.09 * RS + rad && pos.y > tb + 0.05 * RS && pos.y < tb + 0.8 * RS)) return r; }
  for (const h of helis) if (h.team !== team && h.alive && wdist3(pos, h.pos) < 0.22 + rad) return h;
  return null;
}
function updateBullets(dt) {
  const c = camD();
  for (const b of bullets) { if (!b.alive) continue; b.life -= dt; b.v.y -= 1.3 * dt; b.p.addScaledVector(b.v, dt); const pos = b.p;
    b.m.position.set(disp(pos.x, c.x), pos.y, disp(pos.z, c.z)); orient(b.m, b.v);
    const t = projHits(pos, b.owner.team, 0);
    if (t) { b.alive = false; b.m.visible = false; if (t.kind === 'robot') t.bulletHits++; damage(b.owner, t, t.kind === 'robot' ? 5 : 5, null, false, b.v.clone().setY(0).normalize(), pos.clone()); continue; }
    if (propHit(pos)) { impact(pos.clone(), 0.032, b.v.clone().normalize(), 0.9, 'bullet'); FX.sparks(pos, 2, [1, 0.75, 0.4], 0.8); b.alive = false; b.m.visible = false; continue; }
    const gy = Hd(pos.x, pos.z); if (pos.y < gy) { pos.y = gy + 0.005; FX.sparks(pos, 2, [1, 0.7, 0.4], 0.7); FX.dust(pos, 1, { size: [0.03, 0.12], life: [0.4, 0.8], vel: 0.08, up: 0.1 }); scorchMarks.add(pos.x, pos.z, 0, 0.03, 0.03); b.alive = false; b.m.visible = false; continue; }
    if (b.life <= 0) { b.alive = false; b.m.visible = false; }
  }
  hitLight.intensity *= Math.pow(0.001, dt);
}
// ---- beam rifle: laser bursts + charged beam (gunners)
const lasers = [];
const laserGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.24, 6, 1).rotateX(Math.PI / 2);
const laserMats = [0, 1].map(i => new THREE.MeshBasicMaterial({ color: i ? 0xbff0ff : 0xffc4e6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(laserGeo, laserMats[0]); m.visible = false; m.scale.set(3.2, 3.2, 1.6); m.frustumCulled = false; battleRoot.add(m); lasers.push({ m, p: new THREE.Vector3(), alive: false, v: new THREE.Vector3(), owner: null, life: 0 }); }
function muzzle(f, out) { toDemo(f.nodes.muzzle, out); return near(out, f.pos, out); }
function fireLaser(f) {
  if (!alive(f.target)) return; muzzle(f, tmpA); aimAt(f, tmpB);
  const l = lasers.find(l => !l.alive); if (!l) return; l.alive = true; l.owner = f; l.life = 1.2; l.m.material = laserMats[f.team]; l.m.visible = true; l.p.copy(tmpA); l.v.subVectors(tmpB, tmpA).normalize().multiplyScalar(13);
  FX.flash(tmpA, 0.16, f.col); FX.flash(tmpA, 0.07, [1, 1, 1]); FX.sparks(tmpA, 4, f.col, 0.9); f.gun.energy = Math.max(0, f.gun.energy - 4);
}
function updateLasers(dt) {
  const c = camD();
  for (const l of lasers) { if (!l.alive) continue; l.life -= dt; l.p.addScaledVector(l.v, dt); const pos = l.p, att = l.owner, col = att.col;
    l.m.position.set(disp(pos.x, c.x), pos.y, disp(pos.z, c.z)); orient(l.m, l.v);
    particlesA.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.07, 0.06, 0.02, [...col, 0.45], [...col, 0]);
    const end = () => { l.alive = false; l.m.visible = false; FX.flash(pos, 0.14, col); FX.sparks(pos, 8, col, 1.3); FX.sparks(pos, 4, [1, 0.9, 0.6], 1.0); };
    const t = projHits(pos, att.team, 0.01);
    if (t) { if (t.kind === 'robot') t.bulletHits += 3; damage(att, t, 20, null, false, l.v.clone().setY(0).normalize(), pos.clone()); end(); continue; }
    if (propHit(pos)) { impact(pos.clone(), 0.06, l.v.clone().normalize(), 1.1, 'bullet'); end(); continue; }
    const gy = Hd(pos.x, pos.z); if (pos.y < gy) { pos.y = gy + 0.005; end(); scorchMarks.add(pos.x, pos.z, 0, 0.06, 0.06); FX.dust(pos, 2, { size: [0.03, 0.14], vel: 0.15, up: 0.1 }); continue; }
    if (l.life <= 0) { l.alive = false; l.m.visible = false; }
  }
}
function makeGunFX(f) {
  const g = new THREE.Group(); const core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(...f.col), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(2.3);
  g.add(core, halo); g.visible = false; battleRoot.add(g); f.glow = g; f.glowHalo = halo;
  const bg = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5); const B = new THREE.Group();
  const mk = (c, o) => { const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false })); m.frustumCulled = false; B.add(m); return m; };
  const outer = mk(new THREE.Color(...f.col), 0.35), mid = mk(new THREE.Color(...f.col).lerp(new THREE.Color(1, 1, 1), 0.4), 0.7), core2 = mk(0xffffff, 1);
  B.visible = false; battleRoot.add(B); f.beamFx = { g: B, outer, mid, core: core2, on: false, t: 0, dur: 0.7, a: new THREE.Vector3(), dir: new THREE.Vector3(), len: 1, p1: new THREE.Vector3(), p2: new THREE.Vector3() };
}
const _rd = () => new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
const _mz = new THREE.Vector3();
function gunFX(f, dt) {
  if (!f.glow) return; const col = f.col;
  if (f.state === 'gunCharge') { const u = clamp(clipT(f) / 1.4, 0, 1); f.chargeU = u; muzzle(f, _mz);
    const c = camD(); f.glow.visible = true; f.glow.position.set(disp(_mz.x, c.x), _mz.y, disp(_mz.z, c.z)); f.glow.scale.setScalar(0.008 + 0.032 * u * u + rand(0, 0.004)); f.glowHalo.material.opacity = 0.25 + 0.25 * u;
    const k = Math.ceil(dt * (90 + 300 * u)); for (let i = 0; i < k; i++) { const d = _rd(), r = rand(0.1, 0.42) * (1.15 - 0.45 * u), life = rand(0.16, 0.3);
      particlesA.emit(_mz.x + d.x * r, _mz.y + d.y * r, _mz.z + d.z * r, -d.x * r / life, -d.y * r / life, -d.z * r / life, life, 0.01 + 0.012 * u, 0.003, [...col, 0.9], [1, 1, 1, 1]); }
    if (chance(dt * (4 + 26 * u))) arc(_mz, _mz.clone().addScaledVector(_rd(), rand(0.07, 0.14 + 0.14 * u)), 0.45 + 0.7 * u);
    if (u > 0.6 && chance(dt * 6 * u)) { const g = new THREE.Vector3(f.pos.x + rand(-0.35, 0.35), 0, f.pos.z + rand(-0.35, 0.35)); g.y = Hd(g.x, g.z); arc(_mz, g, 0.8); FX.sparks(g, 5, col, 0.8); scorchMarks.add(g.x, g.z, 0, 0.04, 0.04); }
    addShake(dt * 0.4 * u * u, _mz);
  } else { f.chargeU = 0; f.glow.visible = false; }
}
function fireBeam(f) {
  const B = f.beamFx; muzzle(f, B.a); B.dir.subVectors(f.aimPt, B.a).normalize();
  const p = new THREE.Vector3(); let len = 9, hit = null, groundHit = false;
  for (let s = 0.05; s < 9; s += 0.05) { p.copy(B.a).addScaledVector(B.dir, s);
    if (p.y < Hd(p.x, p.z)) { len = s; groundHit = true; break; }
    const t = projHits(p, f.team, 0.08); if (t) { len = s; hit = t; break; }
    if (Math.round(s / 0.05) % 2 === 0) impact(p.clone(), 0.13, B.dir.clone(), 1.6, 'strike');
    if (p.y - Hd(p.x, p.z) < 0.12 && Math.round(s / 0.05) % 3 === 0) scorchMarks.add(p.x, p.z, Math.atan2(B.dir.x, B.dir.z), 0.07, 0.16); }
  const c = camD();
  B.len = len; B.on = true; B.t = 0; B.g.visible = true; B.g.position.set(disp(B.a.x, c.x), B.a.y, disp(B.a.z, c.z)); orient(B.g, B.dir); B.g.scale.set(1, 1, len);
  const end = B.a.clone().addScaledVector(B.dir, len); B.end = end;
  FX.flash(B.a, 0.6, f.col); FX.flash(B.a, 0.3, [1, 1, 1]); FX.sparks(B.a, 40, f.col, 2.4); addShake(0.5, B.a);
  for (let i = 0; i < 4; i++) arc(B.a, B.a.clone().addScaledVector(_rd(), 0.25), 1.2);
  if (hit) { damage(f, hit, hit.kind === 'robot' ? 185 : 200, 'a charged beam shot', true, B.dir.clone().setY(0).normalize(), end.clone()); FX.explosion(end, 0.55); if (hit.kind === 'robot') electricStorm(hit, 6); }
  else { FX.explosion(end, groundHit ? 0.75 : 0.4); impact(end, 0.32, B.dir.clone(), 1.8, 'strike'); if (groundHit) scorchMarks.add(end.x, end.z, 0, 0.4, 0.4); }
  f.vel.copy(B.dir).setY(0).normalize().multiplyScalar(-1.15);
}
function updateBeams(dt) {
  for (const f of robots) { const B = f.beamFx; if (!B || !B.on) continue; B.t += dt; const u = B.t / B.dur;
    if (u >= 1) { B.on = false; B.g.visible = false; continue; }
    const w = Math.pow(1 - u, 0.6), fl = 1 + rand(-0.18, 0.18);
    B.core.scale.set(0.014 * w * fl, 0.014 * w * fl, 1); B.mid.scale.set(0.03 * w * fl, 0.03 * w * fl, 1); B.outer.scale.set(0.06 * w * (1 + 0.6 * u), 0.06 * w * (1 + 0.6 * u), 1);
    B.outer.material.opacity = 0.35 * (1 - u); B.mid.material.opacity = 0.75 * (1 - u * u); B.core.material.opacity = 1 - u * u * u;
    for (let i = 0; i < 5; i++) { const s = rand(0, B.len); const q = B.a.clone().addScaledVector(B.dir, s);
      particlesA.emit(q.x, q.y, q.z, rand(-.5, .5), rand(-.5, .5), rand(-.5, .5), rand(0.15, 0.35), 0.03, 0.005, [...f.col, 0.8], [1, 1, 1, 0]); }
    if (B.end && chance(0.6)) { FX.sparks(B.end, 4, f.col, 1.4); if (chance(0.3)) FX.fire(B.end, 1, 0.08); }
  }
}
// ---- battle damage: wounds, sparks, arcs
const _wp = new THREE.Vector3(), _wq = new THREE.Vector3();
function addWound(f, at) {
  if (!at) return; near(at, f.pos, at); let best = null, bd = 1e9; for (const b of f.bones) { toDemo(b, _wp); near(_wp, f.pos, _wp); const d = _wp.distanceTo(at); if (d < bd) { bd = d; best = b; } }
  if (!best) return; const o = new THREE.Object3D(); best.add(o); f.wounds.push(o);
  if (f.wounds.length > 7) { const old = f.wounds.shift(); old.parent && old.parent.remove(old); }
}
function boltPath(a, b, dispv, levels) { let pts = [a.clone(), b.clone()]; const len = a.distanceTo(b);
  for (let lvl = 0; lvl < levels; lvl++) { const np = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const m = pts[i].clone().lerp(pts[i + 1], 0.5); const off = len * dispv / (lvl + 1);
      m.x += rand(-off, off); m.y += rand(-off, off); m.z += rand(-off, off); np.push(m, pts[i + 1]); } pts = np; } return pts; }
function drawBolt(pts, size, step, col) { for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1]; const n = Math.max(1, Math.ceil(p.distanceTo(q) / step));
    for (let k = 0; k < n; k++) { _wq.copy(p).lerp(q, k / n); particlesA.emit(_wq.x, _wq.y, _wq.z, 0, 0, 0, rand(0.05, 0.1), size, size * 0.35, col, [0.35, 0.55, 1, 0], 0, 0); } } }
function arc(a, b, intensity = 1) { const pts = boltPath(a, b, 0.18, 4); drawBolt(pts, 0.011 * intensity, 0.006, [0.78, 0.9, 1, 1]); FX.flash(a, 0.05 * intensity, [0.7, 0.85, 1]); FX.flash(b, 0.04 * intensity, [0.7, 0.85, 1]); }
function zap(f, intensity = 1) {
  if (!f.wounds.length) return; const w = f.wounds[Math.floor(RNG() * f.wounds.length)]; toDemo(w, _wp); const a = near(_wp, f.pos, new THREE.Vector3()); let b;
  const bone = f.bones[Math.floor(RNG() * f.bones.length)]; toDemo(bone, _wq); b = near(_wq, f.pos, new THREE.Vector3()).add(new THREE.Vector3(rand(-.05, .05), rand(-.05, .05), rand(-.05, .05)));
  if (a.distanceTo(b) > 0.45) b.lerp(a, 0.5);
  arc(a, b, intensity); FX.sparks(a, 3, [0.75, 0.9, 1], 0.9);
}
function electricStorm(f, n) { for (let i = 0; i < n; i++) zap(f, 1.3); }
function damageFX(f, dt) {
  const sev = 1 - f.hp / f.maxHp; if (!f.wounds.length && sev < 0.15) return;
  const k = 1 - 0.42 * Math.min(1, sev * 1.1); f.bodyMats.forEach(m => m.color.setRGB(k, k * 0.97, k * 0.94));
  const m = f.state === 'ko' ? 2.2 : 1;
  for (const w of f.wounds) { toDemo(w, _wp); near(_wp, f.pos, _wp);
    if (sev > 0.25 && chance(dt * (1.5 + 7 * sev) * m)) FX.sparks(_wp, chance(0.3) ? 6 : 2, [1, 0.78, 0.4], 1.1);
    if (sev > 0.4 && chance(dt * (0.8 + 4 * sev) * m)) zap(f, 1);
    if (sev > 0.55) { if (chance(dt * 5 * sev * m)) FX.fire(_wp, 1, 0.015 + 0.012 * sev); if (chance(dt * 7 * sev * m)) FX.darkSmoke(_wp, 1, 0.8 + 0.5 * sev); }
    else if (sev > 0.35 && chance(dt * 2 * sev * m)) FX.darkSmoke(_wp, 1, 0.6);
  }
}

// ----------------------------------------------------- RTS AI for one robot
const SIGHT = 13;                       // demo units (~156 world)
function choose(opts) { const T = 0.32; const list = opts.filter(o => o.s > 0.01); if (!list.length) return null; const mx = Math.max(...list.map(o => o.s)); let sum = 0;
  list.forEach(o => { o.w = Math.exp((o.s - mx) / T); sum += o.w; }); let r = RNG() * sum; for (const o of list) { r -= o.w; if (r <= 0) return o; } return list[list.length - 1]; }
function nearestEnemy(f, range) {
  let best = null, bd = range;
  for (const r of robots) if (r.team !== f.team && r.state !== 'ko') { const d = wdist2(f.pos.x, f.pos.z, r.pos.x, r.pos.z); if (d < bd) { bd = d; best = r; } }
  if (!best) for (const h of helis) if (h.team !== f.team && h.alive) { const d = wdist2(f.pos.x, f.pos.z, h.pos.x, h.pos.z); if (d < Math.min(bd, 6)) { bd = d; best = h; } }
  return best;
}
// mechs climb any slope; only deep water blocks them
const blockers = [];                                   // solid structures: {x, z, hw, hd} in demo units (axis aligned)
function passableD(x, z) { if (heightAt(x * S, z * S) <= -5) return false; for (const b of blockers) if (Math.abs(wd(x - b.x)) < b.hw && Math.abs(wd(z - b.z)) < b.hd) return false; return true; }
// ---- pathfinding: A* over a wrapping walkability grid (1 cell = 1 demo unit = 12 world units)
const PG = Math.floor(W), PC = W / PG; let passGrid = null;
function buildPassGrid() {
  passGrid = new Uint8Array(PG * PG);
  for (let j = 0; j < PG; j++) for (let i = 0; i < PG; i++) {
    let ok = 1; for (const [a, b] of [[.5, .5], [.15, .15], [.85, .15], [.15, .85], [.85, .85]]) if (!passableD((i + a) * PC, (j + b) * PC)) { ok = 0; break; }
    passGrid[j * PG + i] = ok; }
}
const cellOf = v => ((Math.floor(wm(v) / PC)) % PG + PG) % PG;
function clearLine(x0, z0, x1, z1) {                      // straight walk possible? (x1,z1 in x0's frame)
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 0.25);
  for (let k = 1; k <= n; k++) if (!passableD(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n)) return false;
  return true;
}
function nearestOpenCell(ci, cj) {
  if (passGrid[cj * PG + ci]) return [ci, cj];
  for (let r = 1; r < 40; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = (ci + di + PG) % PG, j = (cj + dj + PG) % PG; if (passGrid[j * PG + i]) return [i, j]; }
  return [ci, cj];
}
function findPath(sx, sz, gx, gz) {                       // returns waypoints in the start's frame (may lie outside [0,W))
  if (!passGrid) buildPassGrid();
  const [si, sj] = nearestOpenCell(cellOf(sx), cellOf(sz)), [gi, gj] = nearestOpenCell(cellOf(gx), cellOf(gz));
  const N2 = PG * PG, g = new Float32Array(N2).fill(1e9), came = new Int32Array(N2).fill(-1), closed = new Uint8Array(N2);
  const heap = []; const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const hw = (i, j) => { const dx = Math.abs(wdC(gi - i)), dz = Math.abs(wdC(gj - j)); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const s0 = sj * PG + si, goal = gj * PG + gi; g[s0] = 0; push(s0, hw(si, sj)); let found = false, iter = 0;
  while (heap.length && iter++ < 120000) {
    const [, n] = pop(); if (closed[n]) continue; closed[n] = 1; if (n === goal) { found = true; break; }
    const i = n % PG, j = (n / PG) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue;
      const ni = (i + di + PG) % PG, nj = (j + dj + PG) % PG, m = nj * PG + ni; if (!passGrid[m] || closed[m]) continue;
      if (di && dj && (!passGrid[j * PG + ni] || !passGrid[nj * PG + i])) continue;          // no corner cutting
      const ng = g[n] + (di && dj ? 1.414 : 1); if (ng < g[m]) { g[m] = ng; came[m] = n; push(m, ng + hw(ni, nj)); } }
  }
  if (!found) return null;
  const cells = []; for (let n = goal; n !== -1; n = came[n]) cells.push(n); cells.reverse();
  // unwrap into the start's frame, then keep only the corners needed (line of sight)
  const pts = []; let px = sx, pz = sz;
  for (const n of cells) { const cx = (n % PG + 0.5) * PC, cz = (((n / PG) | 0) + 0.5) * PC; px += wd(cx - px); pz += wd(cz - pz); pts.push([px, pz]); }
  pts[pts.length - 1] = [pts[pts.length - 1][0] + wd(gx - pts[pts.length - 1][0]), pts[pts.length - 1][1] + wd(gz - pts[pts.length - 1][1])];
  if (!passableD(pts[pts.length - 1][0], pts[pts.length - 1][1])) pts[pts.length - 1] = [pts[pts.length - 1][0] + wd((gi + .5) * PC - pts[pts.length - 1][0]), pts[pts.length - 1][1] + wd((gj + .5) * PC - pts[pts.length - 1][1])];
  const out = []; let ax = sx, az = sz, k = 0;
  while (k < pts.length) { let far = k; for (let q = pts.length - 1; q > k; q--) if (clearLine(ax, az, pts[q][0], pts[q][1])) { far = q; break; }
    out.push(pts[far]); ax = pts[far][0]; az = pts[far][1]; k = far + 1; }
  return out;
}
const wdC = d => d - PG * Math.round(d / PG);
// walk to (x,z) (any frame): straight if clear, otherwise along an A* path
function goTo(f, x, z, mode, stopAt, moveT) {
  const tx = f.pos.x + wd(x - f.pos.x), tz = f.pos.z + wd(z - f.pos.z);
  f.path = null;
  if (!clearLine(f.pos.x, f.pos.z, tx, tz)) { const p = findPath(f.pos.x, f.pos.z, tx, tz); if (p && p.length) { f.path = p.slice(1); const w0 = p[0]; walkTo(f, w0[0], w0[1], mode, 0.12, 30); f.pathStop = stopAt; return; } }
  walkTo(f, tx, tz, mode, stopAt, moveT);
}
const STEER = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2];
// move by (vx, vz) * dt; if the way is blocked, steer to the nearest open direction instead of stopping
function tryMove(f, dt) {
  const vx = f.vel.x, vz = f.vel.z; if (vx * vx + vz * vz < 1e-8) return;
  dt *= RS;                                                         // velocities are in robot units
  if (f.y > 0.25 || !passableD(f.pos.x, f.pos.z)) { f.pos.x = wm(f.pos.x + vx * dt); f.pos.z = wm(f.pos.z + vz * dt); return; }   // already in deep water: always let it wade out
  for (const a of STEER) {
    const c = Math.cos(a), s2 = Math.sin(a), rx = vx * c - vz * s2, rz = vx * s2 + vz * c;
    const nx = f.pos.x + rx * dt, nz = f.pos.z + rz * dt;
    if (passableD(nx + rx * 0.25, nz + rz * 0.25) && passableD(nx, nz)) { f.pos.x = wm(nx); f.pos.z = wm(nz); if (a) f.vel.set(rx, 0, rz); return; }
  }
  f.vel.multiplyScalar(0.5);                                          // boxed in: slow down but keep the order
}

// ---- personalities (from the demo): strikers fight like Violet, gunners like Cobalt, each with some variation
const PERSONA = {
  striker: { aggro: 0.74, range: 0.35, guard: 0.6, air: 0.45, saber: 0.9, dodge: 0.58, react: [0.09, 0.18] },
  gunner: { aggro: 0.45, range: 0.9, guard: 0.55, air: 0.5, saber: 0.35, dodge: 0.72, react: [0.1, 0.2] },
};
function persona(role) { const b = PERSONA[role], o = {}; for (const k in b) o[k] = Array.isArray(b[k]) ? b[k] : clamp(b[k] * rand(0.85, 1.15), 0.05, 1); return o; }
function walkTo(f, x, z, mode, stopAt = 0.1, moveT = 3) { f.onArrive = null; f.wp = new THREE.Vector3(x, 0, z); f.stopAt = stopAt; f.walkMode = mode; setState(f, 'walk', null); f.gaitClip = null; f.moveT = moveT; }
const tgtFrame = (f, t) => near(t.pos, f.pos, new THREE.Vector3());          // target position in f's frame
// ---- the demo's reaction system: an attacker "announces" and the defender may dodge / block / counter
function announce(f, type) {
  const o = f.target; if (!o || o.kind !== 'robot' || o.state === 'ko') return;
  const [a, b] = o.p.react; o.pending = { type, at: rand(a, b), from: f };
}
function isRecovering(o) { if (['land', 'hitL', 'hit', 'sheathe', 'draw', 'blockHit', 'turn', 'gunBeam'].includes(o.state)) return true;
  if (o.state === 'attack' || o.state === 'dive') { const A = ATTACKS[o.clip]; return A && clipT(o) > A.hits[A.hits.length - 1][1] + 0.04; } return false; }
function isThreat(o, d) { if (o.state !== 'attack' && o.state !== 'dive') return false; const A = ATTACKS[o.clip]; if (!A) return false; const t = clipT(o); return A.hits.some(([, t1]) => t < t1) && d < (A.root ? 2.2 : 1.5); }
function pickStrike(f, d, rec) {
  const opts = [['Saber_Slash_Combo', d < 0.64 ? 1.0 : 0], ['Saber_Rising_Slash', d < 0.62 ? 0.9 : 0], ['Saber_Wide_Sweep', d < 0.64 ? (rec ? 1.1 : 0.7) : 0], ['Saber_Stab_Combo', d < 0.74 ? 0.9 : 0],
    ['Saber_Cross_Cut', d < 0.54 ? 0.9 : 0], ['Saber_Dash_Thrust', d > 0.5 && d < 0.95 ? 0.7 : 0]].filter(o => o[1] > 0).map(([n, s]) => ({ name: n, s: s * (n === f.lastStrike ? 0.35 : 1) }));
  const c = choose(opts) || { name: 'Saber_Stab_Combo' }; f.lastStrike = c.name; return c.name;
}
function gunBurst(f) { setState(f, 'gunBurst', 'Gun_Burst', 0.08); f.shots = 0; f.gun.energy -= 12; announce(f, 'fire'); }
function gunCharge(f) { setState(f, 'gunCharge', 'Gun_Charge', 0.12); f.gun.energy -= 40; f.aimPt = near(tgtPos(f.target, new THREE.Vector3()), f.pos, new THREE.Vector3()); f.chargeU = 0;
  if (f.target.kind === 'robot') f.target.pending = { type: 'charge', at: rand(0.7, 1.15), from: f }; }
function attack(f, clip) { setState(f, 'attack', clip); announce(f, 'melee'); }
function walkBack(f) { const o = f.target; const t = tgtFrame(f, o); const away = f.pos.clone().sub(t).setY(0).normalize(); walkTo(f, f.pos.x + away.x * rand(0.6, 1.2), f.pos.z + away.z * rand(0.6, 1.2), 'walk', 0.05, rand(0.9, 1.6)); }
function strafe(f, dir, boost) { if (boost) { setState(f, 'boostStrafe', dir > 0 ? 'Boost_Strafe_L' : 'Boost_Strafe_R', 0.1); f.moveT = rand(0.35, 0.6); f.strafeDir = dir; return; }
  const side = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw)).multiplyScalar(dir); walkTo(f, f.pos.x + side.x * rand(0.3, 0.5), f.pos.z + side.z * rand(0.3, 0.5), 'walk', 0.03, rand(1.0, 1.8)); }
function reposition(f) { const t = tgtFrame(f, f.target); const a0 = Math.atan2(f.pos.z - t.z, f.pos.x - t.x) + rand(-1.3, 1.3); const R = rand(1.8, 3.2);
  const wx = t.x + Math.cos(a0) * R, wz = t.z + Math.sin(a0) * R; walkTo(f, wx, wz, Math.hypot(wx - f.pos.x, wz - f.pos.z) > 1.2 ? 'run' : 'walk', 0.1, 2.6); }
const HOPS = { B: 'Boost_Hop_Back', L: 'Boost_Hop_L', R: 'Boost_Hop_R' };
function hop(f, side) { f.cool.hop = 1.1; f.boost -= 18; f.hopSide = side; setState(f, 'hop', HOPS[side], 0.06); f.hopFx = 0; }
function boostBack(f) { f.boost -= 6; setState(f, 'boostBack', 'Boost_Back', 0.1); f.moveT = rand(0.4, 0.75); }
function burstTo(f) { announce(f, 'approach'); f.cool.dash = 4; setState(f, 'burst', 'Boost_Dash_Burst', 0.06); f.boost -= 10; }
function block(f) { setState(f, 'block', 'Guard_Block', 0.05); }
function jump(f, plan) { f.cool.jump = 5; f.boost -= 24; f.airPlan = plan; f.strafeDir = chance(.5) ? 1 : -1; setState(f, 'jump', 'Boost_Jump'); }
function quickstep(f) { f.boost -= 16; const left = chance(0.5); setState(f, 'dodge', left ? 'QuickStep_L' : 'QuickStep_R', 0.05);
  f.vel.set(Math.cos(f.yaw), 0, -Math.sin(f.yaw)).multiplyScalar(2.6 * (left ? 1 : -1)); }
// ---- thruster flight for long trips: faster than walking, burns the boost meter
const FLY_SPEED = 2.0, FLY_ALT = 1.0, FLY_MIN_DIST = 4, FLY_BURN = 11;
function takeOff(f, x, z) { f.flyGoal = { x, z }; f.flyPhase = 'up'; f.path = null; setState(f, 'fly', 'Boost_Jump', 0.1);
  FX.dust(new THREE.Vector3(f.pos.x, groundY(f), f.pos.z), 12, { size: [0.08, 0.45], vel: 0.9, up: 0.06 }); }
const canFly = (f, d) => d > FLY_MIN_DIST && f.boost > 40 && f.y < 0.02;
// wrecked at sea: stays in the water (partly submerged) until a recovery craft exists to fetch it
function lostAtSea(f) {
  f.y = 0; f.vy = 0; f.vel.multiplyScalar(0.2);
  const p = new THREE.Vector3(f.pos.x, 0, f.pos.z);
  for (let i = 0; i < 70; i++) { const a = rand(0, 6.28), sp = rand(0.3, 1.4);
    particlesA.emit(p.x, 0.02, p.z, Math.cos(a) * sp * 0.6, rand(1, 2.4), Math.sin(a) * sp * 0.6, rand(0.5, 1.1), rand(0.02, 0.05), 0.01, [0.85, 0.95, 1, 0.9], [0.7, 0.85, 1, 0], 3.2, 0.5); }
  FX.smoke(p, 14, { size: [0.15, 0.7], life: [1.2, 2.6], col: [0.85, 0.9, 0.95], a: 0.55, vel: 0.4, up: 0.25 }); addShake(0.3, p);
  setState(f, 'ko', 'Defeat_Shutdown', 0.1); f.koT = 0; f.lost = true; f.sel = false; f.order = null; f.target = null;
  wrecks.push(f); log(f.team, `<b>${unitName(f)}</b> crashes into the sea — wrecked, awaiting recovery`);
}
const wrecks = [];
function landShock(f, rad) { const p = new THREE.Vector3(f.pos.x, groundY(f), f.pos.z); FX.dust(p, 18, { size: [0.08, 0.5], life: [0.7, 1.5], vel: 0.9, up: 0.1, a: 0.5 });
  impact(p.clone().setY(p.y + 0.05 * RS), rad * RS, null, 1.1, 'land'); addShake(0.25, p); scorchMarks.add(p.x, p.z, f.yaw, 0.3, 0.3); }
function react(f) {
  const r = f.pending; f.pending = null; if (!r || (r.from && r.from.state === 'ko')) return;
  const o = r.from, d = o ? wdist2(f.pos.x, f.pos.z, o.pos.x, o.pos.z) / RS : 3, P = f.p;
  if (!o && r.type !== 'fire') return;                           // incoming missiles (no robot attached): dodge only
  if (!['idle', 'walk', 'fire', 'burst', 'boostStrafe', 'boostBack'].includes(f.state) || f.y > 0.05) return;
  if (f.order && f.order.type === 'move') return;                 // obeying a move order: don't get distracted
  if (!chance(Math.min(0.95, P.dodge + 0.15))) return;
  if (o) f.target = o;                                            // turn to face whoever is coming at us
  const B = f.boost, canHop = B > 18 && !(f.cool.hop > 0), opts = []; const add = (n, s, fn) => opts.push({ name: n, s, fn });
  if (r.type === 'melee') { if (o.state !== 'attack' && o.state !== 'dive') return; const A = ATTACKS[o.clip]; if (!A || d > (A.root ? 2.6 : 1.5)) return;
    add('block', (f.saberOut ? 0.6 : 1.2) * P.guard, () => block(f)); add('parry', f.saberOut && !A.root ? 2.4 * P.guard : 0, () => attack(f, 'Saber_Parry_Riposte')); add('hopBack', canHop ? 1.1 * P.dodge + (A.root ? 0.3 : 0) : 0, () => hop(f, 'B'));
    add('sideHop', canHop ? 0.9 * P.dodge + (A.root ? 0.5 : 0) : 0, () => hop(f, chance(.5) ? 'L' : 'R')); add('skid', B > 16 ? 0.4 : 0, () => quickstep(f)); }
  else if (r.type === 'fire') { add('boostStrafe', B > 20 ? 1.1 : 0, () => strafe(f, chance(.5) ? 1 : -1, true)); add('sideHop', canHop ? 0.9 : 0, () => hop(f, chance(.5) ? 'L' : 'R'));
    add('jump', B > 40 && !(f.cool.jump > 0) ? 0.5 * P.air : 0, () => jump(f, 'fire')); add('skid', B > 16 ? 0.3 : 0, () => quickstep(f)); }
  else if (r.type === 'charge') { if (o.state !== 'gunCharge') return;
    add('sideHop', canHop ? 1.4 * P.dodge : 0, () => hop(f, chance(.5) ? 'L' : 'R')); add('boostStrafe', B > 20 ? 1.2 : 0, () => strafe(f, chance(.5) ? 1 : -1, true));
    add('rush', f.saberOut && d > 1.1 && d < 3.8 && B > 30 ? 1.2 * P.aggro : 0, () => { f.boost -= 22; attack(f, 'Saber_Boost_Slash'); });
    add('block', 0.4 * P.guard, () => block(f)); add('jump', B > 40 && !(f.cool.jump > 0) ? 0.6 * P.air : 0, () => jump(f, 'fire')); }
  else if (r.type === 'approach') { add('boostBack', B > 25 ? 1.3 * P.range : 0, () => boostBack(f)); add('hopBack', canHop ? 0.9 : 0, () => hop(f, 'B'));
    add('sideHop', canHop ? 0.7 : 0, () => hop(f, chance(.5) ? 'L' : 'R')); add('block', o.clip === 'Saber_Boost_Slash' ? 0.8 * P.guard : 0.2, () => block(f)); add('stand', 0.5 * P.aggro, () => {}); }
  const c = choose(opts); if (c) c.fn();
}
// ---- the demo's fighting brain, pointed at the robot's current target
function think(f) {
  const ord = f.order;
  // plain move order: go there, ignore enemies until arrival
  if (ord && ord.type === 'move') {
    const d = wdist2(f.pos.x, f.pos.z, ord.x, ord.z);
    if (d < 0.25) { f.order = null; }
    else { if (f.saberOut && d > 3) { setState(f, 'sheathe', 'Saber_Sheathe'); return; } if (canFly(f, d)) return takeOff(f, ord.x, ord.z); goTo(f, ord.x, ord.z, d > 1.2 ? 'run' : 'walk', 0.1, 3); return; }
  }
  if (ord && ord.type === 'attack') { if (alive(ord.target)) f.target = ord.target; else f.order = null; }
  if (!alive(f.target) || wdist2(f.pos.x, f.pos.z, f.target.pos.x, f.target.pos.z) > SIGHT * 1.3) f.target = null;
  if (!f.target || !(ord && ord.type === 'attack')) { const e = nearestEnemy(f, SIGHT); if (e && (!f.target || e !== f.target && chance(0.25))) f.target = e; }
  const o = f.target;
  if (!o) {
    if (ord && ord.type === 'amove') { const d = wdist2(f.pos.x, f.pos.z, ord.x, ord.z); if (d < 0.5) f.order = null;
      else { if (canFly(f, d)) return takeOff(f, ord.x, ord.z); goTo(f, ord.x, ord.z, 'run', 0.3, 2.5); return; } }
    if (f.saberOut && chance(0.3)) { setState(f, 'sheathe', 'Saber_Sheathe'); return; }
    return toIdle(f, 0.2, rand(0.4, 0.9));
  }
  const op = tgtFrame(f, o), d = Math.hypot(op.x - f.pos.x, op.z - f.pos.z) / RS, P = f.p, B = f.boost, cd = k => !(f.cool[k] > 0);
  const opts = []; const add = (name, s, fn) => opts.push({ name, s, fn });
  if (o.kind === 'heli') {                                        // gunship overhead: head vulcans / rifle, keep it in range
    add('shootHeli', d < 5 && cd('fire') ? 1.6 : 0, () => { f.cool.fire = rand(1.6, 3); f.fireT = rand(0.8, 1.4); setState(f, 'fire', 'Head_Vulcan_Fire'); });
    if (f.gun && f.gun.energy >= 12) add('rifleHeli', d < 6 && cd('gunBurst') ? 1.4 : 0, () => { f.cool.gunBurst = rand(0.9, 1.6); gunBurst(f); });
    add('close', d > 3.5 ? 1.2 : 0, () => goTo(f, op.x, op.z, 'run', 3, 1.5));
    add('boostStrafe', B > 25 ? 0.5 : 0, () => strafe(f, chance(.5) ? 1 : -1, true));
    add('hold', 0.3, () => toIdle(f, 0.12, rand(0.2, 0.5)));
  } else {
    const rec = isRecovering(o), firing = o.state === 'fire' || o.state === 'airfire', threat = isThreat(o, d), lowHp = f.hp < o.hp * 0.6;
    if (d > 8) { add('close', 3, () => canFly(f, d - 5) ? takeOff(f, op.x - (op.x - f.pos.x) / d * 4, op.z - (op.z - f.pos.z) / d * 4) : goTo(f, op.x, op.z, 'run', 4, 2.5)); }   // far away (RTS scale): run in first
    else if (f.saberOut) {
      add('slash', d < 0.74 && cd('slash') ? 3.0 * P.aggro * (rec ? 1.9 : 1) : 0, () => { f.cool.slash = 1.6; attack(f, pickStrike(f, d, rec)); });
      add('runSlash', d > 0.95 && d < 3.6 && cd('runSlash') ? 1.8 * P.aggro * (rec ? 1.6 : 1) : 0, () => { f.cool.runSlash = 2.2; walkTo(f, op.x, op.z, 'run', 0.6, 2.5); f.onArrive = 'runSlash'; announce(f, 'approach'); });
      add('boostSlash', d > 1.1 && d < 3.8 && B > 30 && cd('boostSlash') ? 1.6 * P.aggro * (rec ? 1.5 : 1) * (o.state === 'gunCharge' ? 1.8 : 1) : 0, () => { f.cool.boostSlash = 2.6; f.boost -= 22; attack(f, 'Saber_Boost_Slash'); announce(f, 'approach'); });
      add('close', d > 0.7 ? (1.0 + (d - 0.7) * 0.9) * P.aggro : 0, () => walkTo(f, op.x, op.z, d > 1.4 ? 'run' : 'walk', 0.35, rand(1.2, 2.6)));
      add('circle', 0.5 + (firing ? 0.8 : 0), () => strafe(f, chance(.5) ? 1 : -1, firing && B > 25));
      add('block', threat ? 2.4 * P.guard : 0, () => block(f));
      add('jumpDive', d > 1.0 && d < 2.6 && B > 35 && cd('jump') ? 0.6 * P.air : 0, () => jump(f, 'dive'));
      add('sheathe', d > 3.2 ? 0.9 * (1 - P.saber) + 0.2 : 0, () => setState(f, 'sheathe', 'Saber_Sheathe'));
      add('retreat', lowHp && d < 1.2 ? 1.0 * (1 - P.aggro) : 0, () => walkBack(f));
      add('hold', 0.25, () => toIdle(f, 0.12, rand(0.2, 0.45)));
    } else {
      const pref = P.saber > 0.6 ? 1.2 : 3.0;
      add('fire', d > 0.9 && d < 5 && cd('fire') ? (f.gun ? 0.9 : 2.1) * P.range * (rec ? 1.5 : 1) * (d > 1.8 ? 1.2 : 0.75) : 0, () => { f.cool.fire = rand(1.6, 3.0); f.fireT = rand(0.8, 1.5); setState(f, 'fire', 'Head_Vulcan_Fire'); announce(f, 'fire'); });
      add('draw', d < 2.8 && cd('draw') ? 1.7 * P.saber * P.aggro : 0, () => { f.cool.draw = 3; setState(f, 'draw', 'Saber_Draw'); });
      add('melee', d < 0.58 ? 2.4 * P.aggro * (rec ? 1.6 : 1) : 0, () => attack(f, chance(0.5) ? 'Melee_Punch_Combo' : 'Melee_Boost_Kick'));
      add('close', d > pref ? 0.8 + (d - pref) * 0.7 : 0, () => walkTo(f, op.x, op.z, d - pref > 1.2 ? 'run' : 'walk', pref, rand(1.2, 2.6)));
      add('dash', d > 3.2 && B > 40 && cd('dash') ? 0.5 : 0, () => burstTo(f));
      add('retreat', d < 1.4 ? 1.2 * P.range * (1.2 - P.aggro) : 0, () => walkBack(f));
      add('circle', 0.9 + (firing ? 1.0 : 0), () => strafe(f, chance(.5) ? 1 : -1, firing && B > 25));
      add('reposition', 0.55 + (d < 1.0 ? 0.4 : 0), () => reposition(f));
      add('jump', B > 40 && cd('jump') ? 0.2 * P.air + (firing ? 0.5 * P.air : 0) : 0, () => jump(f, 'fire'));
      add('block', threat ? 2.2 * P.guard : 0, () => block(f));
      add('hold', 0.3, () => toIdle(f, 0.12, rand(0.2, 0.5)));
    }
    if (d <= 8 && f.gun) { const E = f.gun.energy, sm = f.saberOut ? 0.55 : 1;
      add('gunBurst', d > 0.8 && d < 6.5 && E >= 12 && cd('gunBurst') ? 2.5 * (0.5 + P.range) * (rec ? 1.4 : 1) * sm : 0, () => { f.cool.gunBurst = rand(0.9, 1.6); gunBurst(f); });
      add('gunCharge', d > 1.3 && d < 7.5 && E >= 40 && cd('gunCharge') ? (1.1 + P.range) * (rec ? 2.2 : 1) * (firing ? 0.5 : 1) * sm : 0, () => { f.cool.gunCharge = rand(4, 6.5); gunCharge(f); }); }
    if (d <= 8) {
      if (o.state === 'gunCharge' && o.target === f) add('evadeBeam', B > 25 ? 1.5 * P.dodge : 0.7, () => strafe(f, chance(.5) ? 1 : -1, B > 25));
      const threatish = threat || (o.state === 'walk' && o.onArrive) || o.state === 'burst' || o.state === 'boost';
      add('hopBack', d < 1.3 && B > 22 && cd('hop') ? 0.7 * (1 - P.aggro) + (lowHp ? 0.6 : 0) + (threatish ? 1.2 : 0) - (rec ? 0.6 : 0) : 0, () => hop(f, 'B'));
      add('sideHop', d < 2.4 && B > 22 && cd('hop') ? 0.35 + (firing ? 0.9 : 0) + (threatish ? 0.6 : 0) : 0, () => hop(f, chance(.5) ? 'L' : 'R'));
      add('boostBack', d < 2.0 && B > 30 ? 0.7 * P.range + (lowHp ? 0.5 : 0) + (threatish ? 0.8 * P.range : 0) : 0, () => boostBack(f));
      add('boostStrafe', B > 25 ? 0.3 + (firing ? 1.1 : 0) : 0, () => strafe(f, chance(.5) ? 1 : -1, true));
    }
  }
  opts.forEach(q => { if (q.name === f.lastAction && q.name !== 'slash') q.s *= 0.6; });
  const c = choose(opts); if (!c) return toIdle(f, 0.12, 0.2); f.lastAction = c.name; c.fn();
}

// ----------------------------------------------------- per-robot update (the demo's state machine)
const FRICTION = 3.4;
function skid(f, dt) { const sp = f.vel.length(); if (sp < 1e-3) { f.vel.set(0, 0, 0); return; }
  const dec = (sp > 0.25 ? FRICTION : 12) * dt; f.vel.multiplyScalar(Math.max(0, sp - dec) / sp);
  if (sp > 0.45 && f.y < 0.02 && f.visible) skidTrail(f, sp); else { f.lastSkid.L = null; f.lastSkid.R = null; } }
function skidTrail(f, sp) {
  for (const s of ['L', 'R']) { const node = s === 'L' ? f.nodes.footL : f.nodes.footR; toDemo(node, _fp); near(_fp, f.pos, _fp);
    const last = f.lastSkid[s]; if (last && last.distanceTo(_fp) < 0.035) continue;
    if (last && last.distanceTo(_fp) < 0.25) { const mid = last.clone().add(_fp).multiplyScalar(0.5); skidMarks.add(mid.x, mid.z, Math.atan2(_fp.x - last.x, _fp.z - last.z), 0.032, last.distanceTo(_fp) + 0.008); }
    f.lastSkid[s] = _fp.clone();
    FX.dust(_fp, 1, { size: [0.05, 0.22], life: [0.5, 1.1], vel: 0.2, up: 0.1, a: 0.5 }); if (sp > 0.9 && chance(0.6)) FX.sparks(_fp, 2, [1, 0.75, 0.4], 0.9); }
}
function footfalls(f) {
  for (const s of ['L', 'R']) { const node = s === 'L' ? f.nodes.footL : f.nodes.footR; toDemo(node, _fp); near(_fp, f.pos, _fp); const h = _fp.y - Hd(_fp.x, _fp.z);
    const prev = f.footY[s]; f.footY[s] = h;
    if (f.y < 0.02 && prev > 0.158 * RS && h <= 0.155 * RS && ['walk', 'turn', 'idle', 'land', 'attack', 'hit'].includes(f.state)) {
      footprints.add(_fp.x, _fp.z, f.yaw, 0.07, 0.13); FX.dust(_fp, 4, { size: [0.04, 0.2], life: [0.5, 1.0], vel: 0.3, up: 0.05, a: 0.45 });
      addShake(f.walkMode === 'run' ? 0.05 : 0.03, _fp); impact(new THREE.Vector3(_fp.x, Hd(_fp.x, _fp.z) + 0.02, _fp.z), 0.07, null, 0.6, 'step'); }
  }
}
function faceTo(f, target, dt, rate = 0.0002) { let dy = target - f.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); f.yaw += dy * (1 - Math.pow(rate, dt)); return dy; }
function updateRobot(f, dt) {
  f.st += dt; for (const k in f.cool) f.cool[k] -= dt;
  const T = alive(f.target) ? f.target : null, fight = !!T && f.state !== 'ko';
  const dx = T ? wd(T.pos.x - f.pos.x) : 0, dz = T ? wd(T.pos.z - f.pos.z) : 0, d = T ? Math.hypot(dx, dz) / RS : 99;   // robot units
  const dir = T ? new THREE.Vector3(dx, 0, dz).normalize() : new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  const fwd = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), side = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
  const targetYaw = T ? Math.atan2(dx, dz) : f.yaw; let boosting = false;
  f.bulletHits = Math.max(0, f.bulletHits - dt * 2);
  if (f.gun) f.gun.energy = Math.min(100, f.gun.energy + 7 * dt);
  if (f.underAttackT) f.underAttackT = Math.max(0, f.underAttackT - dt);
  if (f.pending) { f.pending.at -= dt; if (f.pending.at <= 0) react(f); }
  const onMove = f.order && f.order.type === 'move';
  switch (f.state) {
    case 'idle': skid(f, dt);
      if (fight && !onMove && Math.abs(Math.atan2(Math.sin(targetYaw - f.yaw), Math.cos(targetYaw - f.yaw))) > 0.55 && f.vel.length() < 0.1) { const s = Math.sign(Math.atan2(Math.sin(targetYaw - f.yaw), Math.cos(targetYaw - f.yaw)));
        setState(f, 'turn', s > 0 ? 'Turn_L_45' : 'Turn_R_45', 0.12); f.turnFrom = f.yaw; f.turnDir = s; break; }
      if (f.st > f.thinkT) think(f); break;
    case 'turn': { const u = clipT(f) / 0.7; f.yaw = f.turnFrom + f.turnDir * Math.PI / 4 * smooth(Math.min(1, u / 0.72)); skid(f, dt); if (clipDone(f)) toIdle(f, 0.12, 0.02); break; }
    case 'walk': {
      if (f.onArrive === 'runSlash' && T) f.wp.set(f.pos.x + dx, 0, f.pos.z + dz);
      const m = new THREE.Vector3(wd(f.wp.x - f.pos.x), 0, wd(f.wp.z - f.pos.z)); const dist = m.length(); m.normalize();
      const travel = onMove || !T || (f.order && f.order.type === 'amove' && d > 6) || f.path || d > 6;   // long moves face the way they go
      faceTo(f, travel ? Math.atan2(m.x, m.z) : targetYaw, dt, 0.02);
      const fw = m.dot(fwd), lf = m.dot(side);
      let clip = Math.abs(fw) >= Math.abs(lf) * 0.9 ? (fw > 0 ? (f.walkMode === 'run' ? 'Run_Forward' : 'Walk_Forward') : 'Walk_Back') : (lf > 0 ? 'Walk_Strafe_L' : 'Walk_Strafe_R');
      if (clip !== f.clip && (f.gaitClip === null || f.st - f.clipT0 > 0.35)) { play(f, clip, 0.2); f.gaitClip = clip; }
      // foot speed matches this robot's stride rate
      const cs = (GAIT[f.clip] || 0) * f.gaitRate; const ramp = smooth((f.st - f.clipT0) / 0.2);
      const cv = (f.clip === 'Walk_Forward' || f.clip === 'Run_Forward') ? fwd : f.clip === 'Walk_Back' ? fwd.clone().negate() : f.clip === 'Walk_Strafe_L' ? side : side.clone().negate();
      f.vel.copy(cv).multiplyScalar(cs * ramp);
      if (f.path && dist < 0.35) { if (f.path.length) { const w = f.path.shift(); f.wp.set(f.pos.x + wd(w[0] - f.pos.x), 0, f.pos.z + wd(w[1] - f.pos.z)); if (!f.path.length) f.stopAt = f.pathStop; f.st = Math.min(f.st, 0.3); break; } f.path = null; }
      const reach = !onMove && T && f.walkMode === 'walk' && f.stopAt > 0.2 ? d < f.stopAt : dist < Math.max(0.08, onMove || !T ? 0.08 : f.stopAt);
      if (f.onArrive === 'runSlash' && T && T.kind === 'robot' && d < 0.7 && f.clip === 'Run_Forward' && f.saberOut) { f.onArrive = null; setState(f, 'attack', 'Saber_Run_Slash', 0.08); announce(f, 'melee'); break; }
      if ((reach && !(f.path && f.path.length)) || f.st > f.moveT || (!onMove && T && T.kind === 'robot' && f.saberOut && d < 0.62 && !f.onArrive)) { f.onArrive = null; f.path = null; toIdle(f, 0.2, rand(0.02, 0.12)); }
      break; }
    case 'burst': boosting = true; faceTo(f, targetYaw, dt); f.vel.lerp(dir.clone().multiplyScalar(clipT(f) > 0.1 ? 2.4 : 0.3), 1 - Math.pow(0.0005, dt)); if (clipDone(f) || f.st > 0.45) { setState(f, 'boost', 'Boost_Forward', 0.1); f.moveT = rand(0.3, 0.6); } break;
    case 'boost': boosting = true; f.boost -= 20 * dt; faceTo(f, targetYaw, dt); f.vel.lerp(dir.clone().multiplyScalar(2.2), 1 - Math.pow(0.001, dt));
      if (!fight || f.st > f.moveT || f.boost <= 0 || d < (f.saberOut ? 0.7 : 1.3)) toIdle(f, 0.15, 0.02); break;
    case 'boostStrafe': boosting = true; f.boost -= 22 * dt; faceTo(f, targetYaw, dt); f.vel.lerp(side.clone().multiplyScalar(1.7 * f.strafeDir).addScaledVector(dir, (Math.min(d, 6) - 2) * 0.4), 1 - Math.pow(0.001, dt));
      if (!fight || f.st > f.moveT || f.boost <= 0) toIdle(f, 0.15, 0.02); break;
    case 'dodge': boosting = true; skid(f, dt); if (f.st > 0.45) toIdle(f, 0.12, 0.03); break;
    case 'hop': { const t = clipT(f); faceTo(f, targetYaw, dt, 0.01); const hv = f.hopSide === 'B' ? fwd.clone().negate().multiplyScalar(2.0) : side.clone().multiplyScalar(f.hopSide === 'L' ? 2.2 : -2.2);
      if (t < 0.12) skid(f, dt);
      else if (t < 0.48) { boosting = true; if (!f.hopFx) { f.hopFx = 1; FX.dust(new THREE.Vector3(f.pos.x, groundY(f), f.pos.z), 10, { size: [0.06, 0.35], vel: 0.8, up: 0.06 }); addShake(0.06, f.pos); } f.vel.lerp(hv, 1 - Math.pow(0.0002, dt)); }
      else { if (f.hopFx === 1) { f.hopFx = 2; FX.dust(new THREE.Vector3(f.pos.x, groundY(f), f.pos.z), 8, { size: [0.06, 0.3], vel: 0.6, up: 0.05 }); addShake(0.08, f.pos); } skid(f, dt); }
      if (clipDone(f)) toIdle(f, 0.12, rand(0.02, 0.1)); break; }
    case 'boostBack': boosting = true; f.boost -= 20 * dt; faceTo(f, targetYaw, dt); f.vel.lerp(dir.clone().multiplyScalar(-1.7), 1 - Math.pow(0.001, dt));
      if (!fight || f.st > f.moveT || f.boost <= 0) toIdle(f, 0.15, 0.02); break;
    case 'block': skid(f, dt); faceTo(f, targetYaw, dt); if (clipDone(f) || f.st > 0.8) toIdle(f, 0.1, 0.02); break;
    case 'blockHit': skid(f, dt); if (clipDone(f)) toIdle(f, 0.08, 0.02); break;
    case 'fire': { skid(f, dt); if (!T) { toIdle(f, 0.1, 0.05); break; } faceTo(f, targetYaw, dt, 0.002);
      f.fireAcc += dt; while (f.fireAcc > 1 / 12) { f.fireAcc -= 1 / 12; fireBullet(f); }
      if (f.st > f.fireT) toIdle(f, 0.12, rand(0.05, 0.2)); break; }
    case 'jump': { boosting = true; const t = clipT(f); faceTo(f, targetYaw, dt); if (t < 0.22) skid(f, dt); else f.vel.lerp(side.clone().multiplyScalar(f.strafeDir * 0.8), 1 - Math.pow(0.05, dt));
      if (t > 0.24) f.vy = THREE.MathUtils.lerp(f.vy, t < 0.62 ? 1.7 : 0.15, 1 - Math.pow(0.001, dt));
      if (t > 0.22 && t < 0.3 && f.y < 0.03) { FX.dust(new THREE.Vector3(f.pos.x, groundY(f), f.pos.z), 6, { size: [0.08, 0.4], vel: 0.8 }); addShake(0.1, f.pos); }
      if (clipDone(f)) { f.airT = rand(0.8, 1.4); f.strafeDir = chance(0.5) ? 1 : -1; if (f.airPlan === 'fire' && fight) { setState(f, 'airfire', 'Air_Vulcan_Fire', 0.12); announce(f, 'fire'); } else setState(f, 'air', 'Air_Hover', 0.15); } break; }
    case 'air': case 'airfire': boosting = true; f.boost -= 9 * dt; faceTo(f, targetYaw, dt);
      f.vy = THREE.MathUtils.lerp(f.vy, f.st < f.airT ? 0 : -1.8, 1 - Math.pow(0.01, dt));
      f.vel.lerp(side.clone().multiplyScalar(f.strafeDir * 1.0).addScaledVector(dir, (Math.min(d, 6) - (f.saberOut ? 0.9 : 2.0)) * 0.6), 1 - Math.pow(0.05, dt));
      if (f.state === 'airfire' && fight && f.st < f.airT) { f.fireAcc += dt; while (f.fireAcc > 1 / 12) { f.fireAcc -= 1 / 12; fireBullet(f); } }
      if (f.saberOut && fight && T.kind === 'robot' && d < 1.5 && f.st > 0.25 && f.y > 0.12) { setState(f, 'dive', 'Saber_Air_Slash', 0.08); announce(f, 'melee'); break; }
      if (f.state === 'airfire' && f.st > f.airT) setState(f, 'air', 'Air_Hover', 0.12);
      if (f.y <= 0.001 && f.st > 0.3) { f.y = 0; f.vy = 0; setState(f, 'land', 'Landing', 0.08); landShock(f, 0.3); } break;
    case 'dive': { boosting = true; const t = clipT(f); faceTo(f, targetYaw, dt);
      if (t < 0.33) { f.vy = THREE.MathUtils.lerp(f.vy, t < 0.18 ? 0.2 : -(f.y / Math.max(0.03, 0.33 - t)), 1 - Math.pow(0.0001, dt)); } else { if (f.y > 0) { f.y = 0; landShock(f, 0.36); } f.vy = 0; }
      doAttack(f, d, dir, fwd, dt); break; }
    case 'fly': { boosting = true;
      const g = f.flyGoal, gx = wd(g.x - f.pos.x), gz = wd(g.z - f.pos.z), gd = Math.hypot(gx, gz), gdir = new THREE.Vector3(gx, 0, gz).normalize();
      if (f.flyPhase === 'up') {                           // lift off
        const t = clipT(f); if (t < 0.22) skid(f, dt);
        else { f.vy = THREE.MathUtils.lerp(f.vy, 1.8, 1 - Math.pow(0.001, dt)); f.vel.lerp(gdir.clone().multiplyScalar(FLY_SPEED * 0.5), 1 - Math.pow(0.05, dt)); }
        faceTo(f, Math.atan2(gx, gz), dt, 0.01);
        if (f.y > FLY_ALT * 0.8 || clipDone(f)) { f.flyPhase = 'cruise'; play(f, 'Boost_Forward', 0.25); }
      } else if (f.flyPhase === 'cruise') {                // fly straight at the goal, holding altitude over the terrain
        f.boost -= FLY_BURN * dt; faceTo(f, Math.atan2(gx, gz), dt, 0.02);
        f.vel.lerp(gdir.clone().multiplyScalar(FLY_SPEED * (gd < 2 ? 0.5 + gd / 4 : 1)), 1 - Math.pow(0.02, dt));
        f.vy = THREE.MathUtils.lerp(f.vy, (FLY_ALT - f.y) * 2, 1 - Math.pow(0.01, dt));
        const overWater = !passableD(f.pos.x, f.pos.z);
        if ((gd < 1.2 || f.boost <= 4) && !overWater) { f.flyPhase = 'down'; play(f, 'Air_Hover', 0.25); }
        if (f.boost <= 0) { f.boost = 0; if (overWater) { f.flyPhase = 'fall'; play(f, 'Defeat_Shutdown', 0.2); log(f.team, `<b>${unitName(f)}</b> runs out of thruster fuel over the sea`); } }
      } else if (f.flyPhase === 'fall') {                   // out of fuel over water: dead drop into the sea
        boosting = false; f.vel.multiplyScalar(Math.pow(0.5, dt)); f.vy -= 4.5 * dt;
        if (f.y <= 0.001) lostAtSea(f);
      } else {                                             // descend and land
        f.vel.multiplyScalar(Math.pow(0.15, dt)); f.vy = THREE.MathUtils.lerp(f.vy, -1.8, 1 - Math.pow(0.02, dt));
        if (f.y <= 0.001) { f.y = 0; f.vy = 0; setState(f, 'land', 'Landing', 0.08); landShock(f, 0.3); }
      }
      if (f.order && f.order.type !== 'move' && f.order.type !== 'amove') { f.flyPhase = 'down'; }
      break; }
    case 'land': skid(f, dt); if (f.st > 0.7) toIdle(f, 0.15, 0.02); break;
    case 'draw': skid(f, dt); if (clipT(f) > 0.22) f.saberOut = true; if (clipDone(f)) toIdle(f, 0.12, 0.03); break;
    case 'sheathe': skid(f, dt); if (clipT(f) > 0.54) f.saberOut = false; if (clipDone(f)) toIdle(f, 0.12, 0.03); break;
    case 'attack': faceTo(f, targetYaw, dt, clipT(f) < 0.2 || f.clip === 'Saber_Boost_Slash' && clipT(f) < 0.6 ? 0.00005 : 0.3); doAttack(f, d, dir, fwd, dt);
      boosting = f.clip === 'Saber_Boost_Slash' && clipT(f) > 0.1 && clipT(f) < 0.8; break;
    case 'hit': skid(f, dt); if (clipDone(f) || f.st > 1.3) { if (fight && f.boost > 22 && chance(0.55)) { chance(0.5) ? hop(f, 'B') : boostBack(f); } else toIdle(f, 0.12, 0.08); } break;
    case 'hitL': skid(f, dt); if (f.st > 0.55) toIdle(f, 0.1, 0.03); break;
    case 'gunBurst': { skid(f, dt); faceTo(f, targetYaw, dt, 0.0005); const t = clipT(f), ST = [0.18, 0.28, 0.38];
      while (f.shots < 3 && t >= ST[f.shots]) { f.shots++; if (f.gun) fireLaser(f); } if (clipDone(f)) toIdle(f, 0.12, rand(0.05, 0.2)); break; }
    case 'gunCharge': { skid(f, dt); const t = clipT(f); if (t < 1.3 && T) { tgtPos(T, tmpA); near(tmpA, f.pos, tmpA); f.aimPt.lerp(tmpA, 1 - Math.pow(0.01, dt)); }
      faceTo(f, Math.atan2(f.aimPt.x - f.pos.x, f.aimPt.z - f.pos.z), dt, 0.002);
      if (clipDone(f)) { setState(f, 'gunBeam', 'Gun_Charge_Shot', 0.03); f.beamFired = false; } break; }
    case 'gunBeam': { const t = clipT(f); if (!f.beamFired && t >= 0.05) { f.beamFired = true; fireBeam(f); } skid(f, dt); if (clipDone(f)) toIdle(f, 0.14, rand(0.1, 0.3)); break; }
    case 'ko': skid(f, dt); f.koT += dt; break;
  }
  if (f.lost) { f.sink = Math.min(0.5 * RS, (f.sink || 0) + dt * 0.12); if (chance(dt * 1.5)) particlesA.emit(f.pos.x + rand(-.1, .1), 0.01, f.pos.z + rand(-.1, .1), 0, rand(0.1, 0.3), 0, rand(0.4, 0.8), 0.02, 0.035, [0.8, 0.9, 1, 0.6], [0.8, 0.9, 1, 0], 0, 0.5); }
  else if (f.state === 'ko' && f.koT > 18) { f.sink = (f.sink || 0) + dt * 0.04; }
  // vertical: gravity outside the flight states, landing shocks
  if (!['jump', 'air', 'airfire', 'dive', 'fly'].includes(f.state) && f.y > 0) f.vy -= 4.5 * dt;
  f.y = Math.max(0, f.y + f.vy * dt); if (f.y === 0 && f.vy < 0) { if (f.vy < -1.2) landShock(f, 0.22); f.vy = 0; }
  if (!boosting && f.y === 0) f.boost = Math.min(100, f.boost + 26 * dt); f.boost = Math.max(0, f.boost);
  f.boosting = boosting;
  tryMove(f, dt);
  // stuck watchdog: if a walking robot makes no progress for a while, give it a new plan
  if (f.state === 'walk') { f.stuckT = (f.stuckT || 0) + dt; if (f.stuckT > 1.5) { const moved = f.lastPos ? wdist2(f.pos.x, f.pos.z, f.lastPos.x, f.lastPos.z) : 1;
      if (moved < 0.15) { f.stuckN = (f.stuckN || 0) + 1; if (f.stuckN > 4 && f.order && f.order.type !== 'attack') { f.order = null; f.stuckN = 0; } const a = rand(0, 6.28); walkTo(f, f.pos.x + Math.cos(a) * 0.8, f.pos.z + Math.sin(a) * 0.8, 'walk', 0.05, 1.2); }
      else f.stuckN = 0;
      f.stuckT = 0; f.lastPos = { x: f.pos.x, z: f.pos.z }; } } else f.stuckT = 0;
  // body vs town: crush whatever the robot moves through
  const sp = f.vel.length(); if (sp > 0.08 || f.y > 0) { const base = groundY(f) + f.y * RS; const dv = sp > 0.01 ? f.vel.clone().setY(0).normalize() : null;
    for (const hh of [0.06, 0.22, 0.42]) impact(new THREE.Vector3(f.pos.x, base + hh * RS, f.pos.z), 0.13 * RS, dv, 0.4 + sp * RS * 0.7, 'body'); }
}
// thrusters: flames + exhaust while boosting or airborne
function thrusters(f) {
  const on = f.boosting || f.y > 0.02;
  f.flames.forEach(m => { const s = on ? rand(0.8, 1.3) : 0.001; m.scale.set(on ? 1 : 0.001, s * (['boost', 'jump', 'burst', 'dive', 'boostStrafe', 'boostBack', 'hop', 'fly'].includes(f.state) ? 1.5 : 1), on ? 1 : 0.001);
    if (on && chance(0.5)) { toDemo(m, _fp); near(_fp, f.pos, _fp); const back = new THREE.Vector3(0, -0.2, -1).applyQuaternion(f.nodes.chest.getWorldQuaternion(new THREE.Quaternion())); FX.exhaust(_fp, back, f.col); } });
  if (on && f.y < 0.2 && chance(0.4)) FX.dust(new THREE.Vector3(f.pos.x, groundY(f), f.pos.z), 1, { size: [0.06, 0.35], life: [0.5, 1.0], vel: 0.6, up: 0.04, a: 0.35 });
}

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _s4 = new THREE.Vector3(), _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _cp = new THREE.Vector3();
function segDist(p1, q1, p2, q2, out) {
  const d1 = _s1.subVectors(q1, p1), d2 = _s2.subVectors(q2, p2), r = _s3.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r); let s, t;
  if (a < 1e-9 && e < 1e-9) { out.copy(p1); return p1.distanceTo(p2); }
  if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); } else { const c = d1.dot(r); if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); } else { const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e; if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); } } }
  out.copy(p1).addScaledVector(d1, s); _s4.copy(p2).addScaledVector(d2, t); return out.distanceTo(_s4);
}
function weaponSeg(f, w) { const n = f.nodes;
  if (w === 'blade') { n.blade.updateWorldMatrix(true, false); _wa.setFromMatrixPosition(n.blade.matrixWorld).divideScalar(S); _wb.set(0, 0.3, 0).applyMatrix4(n.blade.matrixWorld).divideScalar(S); }
  else if (w === 'fistL' || w === 'fistR') { toDemo(f.model.getObjectByName(w === 'fistL' ? 'HandL' : 'HandR'), _wa); _wb.copy(_wa); }
  else { toDemo(f.nodes.footR, _wa); _wb.copy(_wa).add(new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)).multiplyScalar(0.12)); }
  near(_wa, f.pos, _wa); near(_wb, f.pos, _wb);
  return w === 'blade' ? 0.012 : w === 'footR' ? 0.05 : 0.045;
}
function doAttack(f, d, dir, fwd, dt) {
  const A = ATTACKS[f.clip], t = clipT(f), o = alive(f.target) && f.target.kind === 'robot' ? f.target : null;
  if (f.lodge) { f.lodge.t -= dt; FX.sparks(f.lodge.p, f.lodge.blade ? 3 : 1, [1, 0.72, 0.35], 1.1);
    if (f.lodge.t <= 0 && f.lodge.release === undefined) { f.act.timeScale = f.lodge.after; f.lodge.release = 0.1; }
    if (f.lodge.release !== undefined) { f.lodge.release -= dt; if (f.lodge.release <= 0) { f.act.timeScale = 1; f.lodge = null; } } }
  if (A.root === 'run') { const i = Math.min(RUN_SLASH_X.length - 2, Math.floor(t * 30)); const v = (RUN_SLASH_X[i + 1] - RUN_SLASH_X[i]) * 30 * (f.act.timeScale > 0 ? 1 : 0); f.vel.copy(fwd).multiplyScalar(d < 0.45 ? v * 0.3 : v); }
  else if (A.root === 'boost') { const B0 = 0.28, B1 = 0.72;
    if (t < 0.12) skid(f, dt);
    else if (t < B0) { f.vel.multiplyScalar(Math.pow(0.001, dt)); if (!f.liftFx) { f.liftFx = 1; FX.dust(new THREE.Vector3(f.pos.x, groundY(f), f.pos.z), 14, { size: [0.08, 0.45], vel: 0.9, up: 0.06 }); addShake(0.12, f.pos); } }
    else if (t < B1) { if (!f.flyV) { f.flyV = clamp(Math.min(d, 4) - 0.36, 0.2, 2.8) / (0.62 - B0); } f.vel.lerp(dir.clone().multiplyScalar(d < 0.5 ? 0 : f.flyV * (f.act.timeScale > 0 ? 1 : 0.05)), 1 - Math.pow(0.0001, dt)); }
    else if (t < 0.8) { f.vel.multiplyScalar(Math.pow(0.02, dt)); }
    else { if (!f.landFx) { f.landFx = 1; landShock(f, 0.26); } skid(f, dt); }
  } else if (f.clip !== 'Saber_Air_Slash') skid(f, dt);
  A.hits.forEach(([t0, t1, dmg, label, w, heavy], i) => {
    if (f.hitDone[i]) return;
    if (t > t1) { f.hitDone[i] = true;                    // whiff: the swing still wrecks whatever is in front
      const hp = new THREE.Vector3(f.pos.x + fwd.x * 0.34 * RS, groundY(f) + (f.y + 0.25) * RS, f.pos.z + fwd.z * 0.34 * RS); if (impact(hp, (A.saber ? 0.24 : 0.14) * RS, fwd.clone(), heavy ? 1.2 : 0.7, 'strike')) addShake(0.08, hp); return; }
    if (t < t0 || !o) return;
    const rad = weaponSeg(f, w); const ob = groundY(o) + o.y * RS; const op = near(o.pos, f.pos, new THREE.Vector3()); _s1.set(op.x, ob + 0.12 * RS, op.z); _s2.set(op.x, ob + 0.8 * RS, op.z);
    const p1 = _wa.clone(), q1 = _wb.clone(), dist = segDist(p1, q1, _s1.clone(), _s2.clone(), _cp);
    if (dist < 0.15 * RS + rad) { f.hitDone[i] = true; const at = _cp.clone(); const res = damage(f, o, dmg, label, !!heavy, dir, at);
      const blade = w === 'blade'; f.lodge = { t: res === 'blocked' ? 0.07 : (blade ? 0.15 : 0.07), p: at, blade, after: blade ? 0.55 : 0.8 }; f.act.timeScale = 0;
      FX.sparks(at, blade ? 45 : 18, [1, 0.85, 0.5], blade ? 2.2 : 1.4); FX.flash(at, blade ? 0.3 : 0.15, [1, 0.9, 0.7]); if (blade) FX.sparks(at, 20, f.col, 1.6);
      if (A.hits.length === 1 || heavy) impact(at, 0.2, fwd.clone(), 0.9, 'strike'); }
  });
  if (A.saber && f.nodes.blade.scale.y > 0.5) bladeCut(f);
  if (clipDone(f)) { f.flyV = 0; f.liftFx = 0; f.landFx = 0; if (f.lodge) { f.act.timeScale = 1; f.lodge = null; } toIdle(f, 0.14, rand(0.03, 0.2)); }
}
const bladeTip = new THREE.Vector3(), bladeBase = new THREE.Vector3();
function bladeCut(f) { const n = f.nodes.blade; n.updateWorldMatrix(true, false); bladeBase.setFromMatrixPosition(n.matrixWorld).divideScalar(S); bladeTip.set(0, 0.3, 0).applyMatrix4(n.matrixWorld).divideScalar(S);
  near(bladeBase, f.pos, bladeBase); near(bladeTip, f.pos, bladeTip);
  for (let k = 1; k <= 4; k++) { const pt = bladeBase.clone().lerp(bladeTip, k / 4); if (propHit(pt) && impact(pt, 0.035, pt.clone().sub(f.pos).setY(0).normalize(), 0.9, 'blade')) FX.sparks(pt, 5, [1, 0.6, 0.25], 1.2); }
  const gy = Hd(bladeTip.x, bladeTip.z); if (bladeTip.y < gy + 0.01) { scorchMarks.add(bladeTip.x, bladeTip.z, 0, 0.05, 0.05); FX.sparks(bladeTip, 3, [1, 0.6, 0.3], 1); } }
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _d = new THREE.Vector3();
function headTrack(f, dt) {
  const T = alive(f.target) ? f.target : null; const w = ['hit', 'ko', 'hitL'].includes(f.state) || !T ? 0 : 1;
  f.lookT -= dt; if (T && f.lookT <= 0) { f.lookT = rand(0.12, 0.3); tgtPos(T, tmpA); near(tmpA, f.pos, tmpA); tmpA.y += 0.12; toDemo(f.nodes.head, tmpB); near(tmpB, f.pos, tmpB); f.lookTarget = (f.lookTarget || new THREE.Vector3()).copy(tmpA.sub(tmpB).normalize()); }
  if (!f.lookTarget || w === 0) f.headQ.slerp(_qa.identity(), 1 - Math.pow(0.001, dt));
  else { const head = f.nodes.head; head.updateWorldMatrix(true, false); head.getWorldQuaternion(_qa); _d.set(0, 0, 1).applyQuaternion(_qa);
    _qb.setFromUnitVectors(_d, f.lookTarget); const ang = 2 * Math.acos(Math.min(1, Math.abs(_qb.w))), lim = THREE.MathUtils.degToRad(40); if (ang > lim) _qb.slerp(_qa.identity(), 1 - lim / ang);
    f.headQ.slerp(_qb, 1 - Math.pow(0.00002, dt)); }
  const head = f.nodes.head; head.parent.getWorldQuaternion(_qa); const inv = _qa.clone().invert(); head.quaternion.premultiply(inv.multiply(f.headQ).multiply(_qa));
}
function weaponOverride(f) { const n = f.nodes; if (n.gun) { n.gun.scale.setScalar(f.gun ? GUN_S : 0); if (f.gun && n.fistL) { n.fistL.scale.setScalar(1); n.openL.scale.setScalar(0); } }
  if (SABER_CLIPS.has(f.clip)) return; const s = f.saberOut;
  n.saber.scale.setScalar(s ? 1 : 0); n.blade.scale.setScalar(s ? 1 : 0); n.stowed.scale.setScalar(s ? 0 : 1); if (s) { n.fistR.scale.setScalar(1); n.openR.scale.setScalar(0); } }
const GUN_USE = new Set(['gunBurst', 'gunCharge', 'gunBeam']);
const _armDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.12), _armStraight = new THREE.Quaternion(), _gripQ = new THREE.Quaternion(0.054, 0.165, 0.135, 0.976).normalize();
function gunCarry(f, dt) {
  const punching = f.state === 'attack' && f.clip === 'Melee_Punch_Combo';
  const want = f.gun && !GUN_USE.has(f.state) && !punching ? 1 : 0; f.carryW = want ? (f.carryW || 0) + (1 - (f.carryW || 0)) * (1 - Math.pow(0.003, dt)) : 0;
  if (f.carryW < 0.01) return; const m = f.model;
  if (!f.armUp) { f.armSh = m.getObjectByName('ShoulderL'); f.armUp = m.getObjectByName('UpperArmL'); f.armFore = m.getObjectByName('ForearmL'); f.armHand = m.getObjectByName('HandL'); }
  if (!f.armUp || !f.armFore || !f.armHand) return; const w = f.carryW;
  if (f.armSh) f.armSh.quaternion.slerp(_armStraight, w); f.armUp.quaternion.slerp(_armDown, w); f.armFore.quaternion.slerp(_armStraight, w); f.armHand.quaternion.slerp(_gripQ, w);
}
function updateTrail(f) {
  const n = f.nodes.blade; const on = n.scale.y > 0.5 && f.saberOut; const Hh = f.trailHist;
  const swinging = on && (f.state === 'attack' || f.state === 'dive') && !f.lodge;
  if (swinging) { n.updateWorldMatrix(true, false); const b = new THREE.Vector3().setFromMatrixPosition(n.matrixWorld).divideScalar(S), t = new THREE.Vector3(0, 0.3, 0).applyMatrix4(n.matrixWorld).divideScalar(S);
    if (Hh[0] && Hh[0].t.distanceTo(t) > 0.22) Hh.length = 0; Hh.unshift({ b, t }); } else Hh.length = 0;
  if (Hh.length > 14) Hh.length = 14;
  const pos = f.trail.geometry.attributes.position, al = f.trail.geometry.attributes.alpha;
  for (let i = 0; i < 22; i++) { const h = Hh[i] || (Hh.length ? Hh[Hh.length - 1] : null);
    if (h) { pos.setXYZ(i * 2, h.b.x, h.b.y, h.b.z); pos.setXYZ(i * 2 + 1, h.t.x, h.t.y, h.t.z); } else { pos.setXYZ(i * 2, 0, -10, 0); pos.setXYZ(i * 2 + 1, 0, -10, 0); }
    const a = Hh[i] ? (1 - i / 13) ** 1.5 : 0; al.setX(i * 2, a * 0.15); al.setX(i * 2 + 1, a); }
  pos.needsUpdate = al.needsUpdate = true;
}
function separate() {
  for (let i = 0; i < robots.length; i++) for (let j = i + 1; j < robots.length; j++) { const a = robots[i], b = robots[j]; if (a.state === 'ko' && b.state === 'ko') continue;
    const dx = wd(b.pos.x - a.pos.x), dz = wd(b.pos.z - a.pos.z), d = Math.hypot(dx, dz), min = 0.38 * RS;
    if (d < min && d > 1e-4) { const p = (min - d) / 2; a.pos.x = wm(a.pos.x - dx / d * p); a.pos.z = wm(a.pos.z - dz / d * p); b.pos.x = wm(b.pos.x + dx / d * p); b.pos.z = wm(b.pos.z + dz / d * p); } }
}

// ------------------------------------------------------------------ gunships
const HELI_S = 0.55, HELI_HP = 300;
function makeHeli(team, x, z) {
  const root = new THREE.Group(); const model = heliProto.clone(true); model.scale.setScalar(HELI_S); model.rotation.y = Math.PI / 2; root.add(model); battleRoot.add(root);
  const tint = team ? [0.82, 0.92, 1.12] : [1.1, 0.84, 0.95]; const mats = new Map();
  model.traverse(o => { if (o.isMesh) { if (!mats.has(o.material)) { const m = o.material.clone(); m.color.setRGB(...tint); m.metalness = 0.35; m.roughness = 0.55; mats.set(o.material, m); } o.material = mats.get(o.material); } });
  const tr = model.getObjectByName('Heli_TailRotor'); if (tr) tr.position.set(0.395, 0.13, 0.018);
  const pt = (px, py, pz) => { const o = new THREE.Object3D(); o.position.set(px, py, pz); model.add(o); return o; };
  const col = TEAM_COL[team];
  const nav = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(...col), blending: THREE.AdditiveBlending, transparent: true }));
  pt(0.34, 0.2, 0).add(nav); nav.scale.setScalar(1 / HELI_S);
  const h = { kind: 'heli', team, col, root, model, main: model.getObjectByName('Heli_MainRotor'), tail: model.getObjectByName('Heli_TailRotor'), mats: [...mats.values()], nav,
    gunPt: pt(-0.45, 0.045, 0), pods: [pt(-0.08, 0.08, 0.18), pt(-0.08, 0.08, -0.18)], bodyPt: pt(-0.1, 0.13, 0),
    pos: new THREE.Vector3(wm(x), Hd(x, z) + 1.6, wm(z)), vel: new THREE.Vector3(), acc: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, hp: HELI_HP, maxHp: HELI_HP, alive: true, falling: false,
    target: null, retarget: 0, orb: rand(0, 6.28), orbDir: chance(.5) ? 1 : -1, gunT: 0, gunCD: rand(1, 2), fireAcc: 0, msCD: rand(3, 5), msQueue: 0, msT: 0, podI: 0, spin: 0,
    anchor: { x: wm(x), z: wm(z) }, sel: false };
  helis.push(h); makeBars(h, 1.1, 1.35); return h;
}
function heliHit(h, amount, by, at) {
  if (!h.alive) return; h.hp -= amount; const p = at || h.pos; FX.sparks(p, amount > 30 ? 30 : 5, [1, 0.8, 0.45], 1.4); if (amount > 30) FX.flash(p, 0.3, [1, 0.8, 0.5]);
  if (by && !alive(h.target)) h.target = by;
  if (h.hp <= 0) { h.alive = false; h.falling = true; h.sel = false; h.vel.add(new THREE.Vector3(rand(-0.6, 0.6), 0.3, rand(-0.6, 0.6))); h.spin = rand(5, 8) * (chance(.5) ? 1 : -1); FX.explosion(h.pos.clone(), 0.45);
    log(h.team, `${by ? `<b>${unitName(by)}</b> shoots down ` : ''}<b>${unitName(h)}</b>`); }
  return 'hit';
}
const hRounds = []; const hRoundMats = [0, 1].map(i => new THREE.MeshBasicMaterial({ color: i ? 0xd8f4ff : 0xffd8ec, toneMapped: false, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
for (let i = 0; i < 160; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.08), hRoundMats[0]); m.visible = false; m.scale.set(3.5, 3.5, 2); m.frustumCulled = false; battleRoot.add(m); hRounds.push({ m, p: new THREE.Vector3(), alive: false, v: new THREE.Vector3(), owner: null, life: 0 }); }
const msGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.075, 8).rotateX(Math.PI / 2), msMat = new THREE.MeshStandardMaterial({ color: 0xd6d2cc, metalness: 0.4, roughness: 0.5 });
const missiles = []; for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(msGeo, msMat); m.visible = false; m.scale.setScalar(1.5); battleRoot.add(m); missiles.push({ m, p: new THREE.Vector3(), alive: false, v: new THREE.Vector3(), owner: null, life: 0, tgt: null }); }
function heliFireRound(h) {
  toDemo(h.gunPt, tmpA); near(tmpA, h.pos, tmpA); tgtPos(h.target, tmpB); near(tmpB, h.pos, tmpB); tmpB.addScaledVector(h.target.vel, 0.15); tmpB.x += rand(-0.1, 0.1); tmpB.y += rand(-0.1, 0.08); tmpB.z += rand(-0.1, 0.1);
  const b = hRounds.find(b => !b.alive); if (!b) return; b.alive = true; b.owner = h; b.life = 1.6; b.m.material = hRoundMats[h.team]; b.m.visible = true; b.p.copy(tmpA); b.v.subVectors(tmpB, tmpA).normalize().multiplyScalar(9);
  FX.flash(tmpA, 0.07, [1, 0.85, 0.55]);
}
function heliFireMissile(h) {
  const pod = h.pods[h.podI ^= 1]; toDemo(pod, tmpA); near(tmpA, h.pos, tmpA); const m = missiles.find(m => !m.alive); if (!m) return;
  const fwd = new THREE.Vector3(Math.sin(h.yaw), -0.15, Math.cos(h.yaw)).normalize();
  m.alive = true; m.owner = h; m.life = 3.2; m.tgt = h.target; m.age = 0; m.m.visible = true; m.p.copy(tmpA); m.v.copy(fwd).multiplyScalar(1.2).add(h.vel);
  if (h.target && h.target.kind === 'robot' && h.target.state !== 'ko' && !h.target.pending) { const [a, b] = h.target.p.react; h.target.pending = { type: 'fire', at: rand(a, b) + 0.2, from: null }; }
  FX.flash(tmpA, 0.14, [1, 0.7, 0.4]); FX.smoke(tmpA, 4, { size: [0.04, 0.2], life: [0.6, 1.2], col: [0.55, 0.53, 0.5], a: 0.4, vel: 0.1, up: 0.02 });
}
function updateHeliProjectiles(dt) {
  const c = camD();
  for (const b of hRounds) { if (!b.alive) continue; b.life -= dt; b.v.y -= 1.0 * dt; b.p.addScaledVector(b.v, dt); const pos = b.p;
    b.m.position.set(disp(pos.x, c.x), pos.y, disp(pos.z, c.z)); orient(b.m, b.v);
    const t = projHits(pos, b.owner.team, 0);
    if (t) { b.alive = false; b.m.visible = false; if (t.kind === 'robot') t.bulletHits++; damage(b.owner, t, t.kind === 'robot' ? 3 : 6, null, false, b.v.clone().setY(0).normalize(), pos.clone()); continue; }
    if (propHit(pos)) { impact(pos.clone(), 0.035, b.v.clone().normalize(), 0.9, 'bullet'); FX.sparks(pos, 2, [1, 0.75, 0.4], 0.8); b.alive = false; b.m.visible = false; continue; }
    if (pos.y < Hd(pos.x, pos.z)) { FX.dust(pos, 1, { size: [0.03, 0.12], life: [0.4, 0.8], vel: 0.08, up: 0.1 }); scorchMarks.add(pos.x, pos.z, 0, 0.03, 0.03); b.alive = false; b.m.visible = false; continue; }
    if (b.life <= 0) { b.alive = false; b.m.visible = false; } }
  for (const m of missiles) { if (!m.alive) continue; m.life -= dt; m.age += dt; const pos = m.p;
    if (m.age > 0.18 && alive(m.tgt)) { tgtPos(m.tgt, tmpB); near(tmpB, pos, tmpB); const want = tmpB.sub(pos).normalize().multiplyScalar(Math.min(3.8, m.v.length() + 6 * dt)); m.v.lerp(want, 1 - Math.pow(0.08, dt)); }
    else m.v.y -= 0.6 * dt;
    pos.addScaledVector(m.v, dt); m.m.position.set(disp(pos.x, c.x), pos.y, disp(pos.z, c.z)); orient(m.m, m.v);
    const back = m.v.clone().normalize().multiplyScalar(-0.04).add(pos); particlesA.emit(back.x, back.y, back.z, 0, 0, 0, 0.06, 0.045, 0.01, [1, 0.8, 0.4, 1], [1, 0.3, 0.1, 0]);
    if (chance(0.7)) particlesN.emit(back.x, back.y, back.z, rand(-.02, .02), rand(0, .05), rand(-.02, .02), rand(0.8, 1.5), 0.03, rand(0.12, 0.2), [0.72, 0.7, 0.68, 0.35], [0.8, 0.78, 0.76, 0], -0.02, 0.6);
    const t = projHits(pos, m.owner.team, 0.06), gy = Hd(pos.x, pos.z);
    if (t || propHit(pos) || pos.y < gy || m.life <= 0) { m.alive = false; m.m.visible = false; FX.explosion(pos.clone(), 0.42); impact(pos.clone(), 0.26, m.v.clone().normalize(), 1.3, 'strike'); if (pos.y < gy + 0.05) scorchMarks.add(pos.x, pos.z, 0, 0.22, 0.22);
      if (t) damage(m.owner, t, t.kind === 'robot' ? 40 : 90, 'a missile strike', false, m.v.clone().setY(0).normalize(), pos.clone()); }
  }
}
function heliTargetNear(h) {
  let best = null, bd = 9;
  for (const r of robots) if (r.team !== h.team && r.state !== 'ko') { const d = Math.min(wdist2(h.anchor.x, h.anchor.z, r.pos.x, r.pos.z), wdist2(h.pos.x, h.pos.z, r.pos.x, r.pos.z)); if (d < bd) { bd = d; best = r; } }
  for (const e of helis) if (e.team !== h.team && e.alive) { const d = wdist2(h.pos.x, h.pos.z, e.pos.x, e.pos.z); if (d < Math.min(bd, 5)) { bd = d; best = e; } }
  return best;
}
function updateHeli(h, dt) {
  h.main.rotation.y += (h.alive ? 42 : h.falling ? 20 : 0) * dt; h.tail.rotation.z += (h.alive ? 60 : 10) * dt;
  if (!h.alive) {
    if (h.falling) { h.vel.y -= 3.5 * dt; h.pos.addScaledVector(h.vel, dt); h.pos.x = wm(h.pos.x); h.pos.z = wm(h.pos.z); h.yaw += h.spin * dt; h.roll += (0.6 - h.roll) * dt;
      toDemo(h.bodyPt, tmpA); near(tmpA, h.pos, tmpA); FX.fire(tmpA, 2, 0.1); FX.darkSmoke(tmpA, 1, 1.2);
      const gy = Hd(h.pos.x, h.pos.z); if (h.pos.y < gy + 0.08) { h.falling = false; h.root.visible = false; const p = new THREE.Vector3(h.pos.x, gy + 0.05, h.pos.z); FX.explosion(p, 0.9); impact(p, 0.45, null, 1.6, 'land'); scorchMarks.add(p.x, p.z, 0, 0.6, 0.6); fires.push({ x: p.x, z: p.z, t: rand(8, 12) }); }
      else if (propHit(h.pos)) impact(h.pos.clone(), 0.2, h.vel.clone().normalize(), 1.2, 'strike'); }
    return; }
  const t = performance.now() / 1000;
  h.retarget -= dt;
  if (h.retarget <= 0 || !alive(h.target)) { h.retarget = rand(2, 4); h.target = h.order?.type === 'attack' && alive(h.order.target) ? h.order.target : heliTargetNear(h); }
  const T = alive(h.target) ? h.target : null;
  const cx = T ? h.pos.x + wd(T.pos.x - h.pos.x) : h.pos.x + wd(h.anchor.x - h.pos.x), cz = T ? h.pos.z + wd(T.pos.z - h.pos.z) : h.pos.z + wd(h.anchor.z - h.pos.z);
  h.orb += dt * 0.18 * h.orbDir; if (chance(dt * 0.1)) h.orbDir *= -1; const R = T ? (T.kind === 'robot' ? 2.4 : 1.6) : 1.2;
  const want = new THREE.Vector3(cx + Math.cos(h.orb) * R, 0, cz + Math.sin(h.orb) * R);
  want.y = Math.max(Hd(want.x, want.z), Hd(h.pos.x, h.pos.z), 0) + 1.35 + 0.12 * Math.sin(t * 0.9 + h.team * 2);
  for (const e of helis) if (e !== h && e.alive && wdist3(e.pos, h.pos) < 0.55) want.add(new THREE.Vector3(-wd(e.pos.x - h.pos.x), 0, -wd(e.pos.z - h.pos.z)).normalize().multiplyScalar(0.6));
  h.acc.subVectors(want, h.pos).multiplyScalar(0.7).addScaledVector(h.vel, -1.0); if (h.acc.length() > 1.1) h.acc.setLength(1.1);
  h.vel.addScaledVector(h.acc, dt); if (h.vel.length() > 0.9) h.vel.setLength(0.9); h.pos.addScaledVector(h.vel, dt); h.pos.x = wm(h.pos.x); h.pos.z = wm(h.pos.z);
  const floor = Math.max(Hd(h.pos.x, h.pos.z), 0) + 0.85; if (h.pos.y < floor) { h.pos.y = floor; h.vel.y = Math.max(0, h.vel.y); }
  const tp = T ? near(tgtPos(T, tmpC), h.pos, tmpC) : tmpC.set(cx, h.pos.y, cz);
  const ty = Math.atan2(tp.x - h.pos.x, tp.z - h.pos.z); let dy = Math.atan2(Math.sin(ty - h.yaw), Math.cos(ty - h.yaw)); if (T || h.vel.length() > 0.15) h.yaw += clamp(dy, -1.2 * dt, 1.2 * dt);
  const fw = new THREE.Vector3(Math.sin(h.yaw), 0, Math.cos(h.yaw)), sd = new THREE.Vector3(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
  h.pitch += (clamp(h.acc.dot(fw) * 0.16 + h.vel.dot(fw) * 0.1, -0.4, 0.4) - h.pitch) * (1 - Math.pow(0.02, dt)); h.roll += (clamp(-h.acc.dot(sd) * 0.16 - h.vel.dot(sd) * 0.08, -0.45, 0.45) - h.roll) * (1 - Math.pow(0.02, dt));
  h.nav.visible = (t * 2 + h.team) % 1 < 0.5;
  const sev = 1 - h.hp / HELI_HP; if (sev > 0.4 && chance(dt * 6 * sev)) { toDemo(h.bodyPt, tmpA); near(tmpA, h.pos, tmpA); FX.darkSmoke(tmpA, 1, 0.6 + sev); if (sev > 0.7 && chance(0.5)) FX.fire(tmpA, 1, 0.06); }
  const alt = h.pos.y - Hd(h.pos.x, h.pos.z); if (alt < 1.3 && chance(dt * 8)) { const a = rand(0, 6.28), r = rand(0.1, 0.4); FX.dust(new THREE.Vector3(h.pos.x + Math.cos(a) * r, Hd(h.pos.x, h.pos.z), h.pos.z + Math.sin(a) * r), 1, { size: [0.06, 0.3], life: [0.5, 1], vel: 0.6, up: 0.05, a: 0.3 }); }
  if (!T) return;
  const dist = tp.distanceTo(h.pos), aimed = Math.abs(dy) < 0.35;
  h.gunCD -= dt; if (h.gunT > 0) { h.gunT -= dt; h.fireAcc += dt; while (h.fireAcc > 1 / 11) { h.fireAcc -= 1 / 11; heliFireRound(h); } }
  else if (h.gunCD <= 0 && aimed && dist < 5) { h.gunT = rand(0.6, 1.0); h.gunCD = h.gunT + rand(2, 3.5); h.fireAcc = 0; }
  h.msCD -= dt; if (h.msQueue > 0) { h.msT -= dt; if (h.msT <= 0) { h.msQueue--; h.msT = 0.18; heliFireMissile(h); } }
  else if (h.msCD <= 0 && aimed && dist > 1.2 && dist < 6) { h.msQueue = 2; h.msT = 0; h.msCD = rand(4.5, 7); }
}

// ------------------------------------------------------------------ RTS health bars (above each unit, facing the camera)
const barGeo = new THREE.PlaneGeometry(1, 1);
function makeBars(u, yOff, width) {
  const g = new THREE.Group(); g.renderOrder = 20;
  const mk = (color, z) => { const m = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false })); m.renderOrder = 20 + z; m.position.z = z * 0.001; g.add(m); return m; };
  const frame = mk(new THREE.Color(...TEAM_COL[u.team]), 0), back = mk(0x101418, 1), fill = mk(0x4ade5a, 2);
  const W0 = width * S, H0 = 0.085 * S; frame.scale.set(W0 + 0.5, H0 + 0.5, 1); back.scale.set(W0, H0, 1); fill.scale.set(W0, H0 * 0.8, 1);
  scene.add(g); u.bar = { g, fill, W0, yOff };
}
const _barC = new THREE.Color();
function placeBar(u, x, y, z, visible) {
  const b = u.bar; b.g.visible = visible; if (!visible) return;
  b.g.position.set(x, y + b.yOff * S, z); b.g.quaternion.copy(camera.quaternion);
  const f = clamp(u.hp / u.maxHp, 0, 1); b.fill.scale.x = Math.max(0.001, b.W0 * f); b.fill.position.x = -b.W0 * (1 - f) / 2;
  b.fill.material.color.copy(f > 0.6 ? _barC.set(0x4ade5a) : f > 0.3 ? _barC.set(0xf5c542) : _barC.set(0xef4444));
  const dcam = camera.position.distanceTo(b.g.position); b.g.scale.setScalar(clamp(dcam / 420, 0.6, 1.6));
}

// ------------------------------------------------------------------ selection rings
const selRingGeo = new THREE.RingGeometry(0.34, 0.4, 32).rotateX(-Math.PI / 2);
const selRingMat = new THREE.MeshBasicMaterial({ color: 0x7fff7f, depthTest: false, transparent: true, opacity: 0.9 });
function ringFor(u) { if (!u.ring) { u.ring = new THREE.Mesh(selRingGeo, selRingMat); u.ring.renderOrder = 15; u.ring.scale.setScalar(u.kind === 'heli' ? 1.6 : RS); battleRoot.add(u.ring); } return u.ring; }

// ------------------------------------------------------------------ HUD: event feed + status
function log(team, html) { const feed = document.getElementById('feed'); if (!feed) return; const d = document.createElement('div'); d.className = team === 0 ? 'e1' : team === 1 ? 'e2' : ''; d.innerHTML = html; feed.append(d); while (feed.children.length > 5) feed.firstChild.remove(); }
function banner(text, sub) { const b = document.getElementById('banner'); if (!b) return; b.innerHTML = ''; b.append(text); const s = document.createElement('small'); s.textContent = sub; b.append(s); b.hidden = false; }

// ------------------------------------------------------------------ teams, reinforcements, enemy waves, victory
let gameOver = false, waveT = 60, reinforceT = [45, 45];
function hqDestroyed(town) {
  const team = town.idx; if (team > 1) return;
  log(1 - team, `<b>${TEAM_NAME[team]} HQ tower</b> destroyed — no more reinforcements`);
  town.hqDown = true;
}
function spawnPoint(team, k) { const t = towns[team]; const a = k * 2.4 + rand(-.2, .2), r = PLAZA_R + 0.4 + 0.3 * Math.sqrt(k); return { x: t.x + Math.cos(a) * r, z: t.z + 0.9 + Math.sin(a) * r * 0.6 }; }
function spawnRobot(team, role, k) { const p = spawnPoint(team, k); const f = makeRobot(team, role, p.x, p.z); f.yaw = team ? Math.PI : 0; return f; }
function checkVictory() {
  if (gameOver) return;
  for (const team of [0, 1]) {
    const units = robots.filter(r => r.team === team && r.state !== 'ko').length + helis.filter(h => h.team === team && h.alive).length;
    if (units === 0 && towns[team].hqDown) { gameOver = true; banner(team === 0 ? 'Defeat' : 'Victory', team === 0 ? 'Your forces and HQ are destroyed' : 'Enemy forces and HQ destroyed'); }
  }
}
function teamUpdate(dt) {
  for (const team of [0, 1]) {
    if (towns[team].hqDown) continue;
    reinforceT[team] -= dt;
    const n = robots.filter(r => r.team === team && r.state !== 'ko').length;
    if (reinforceT[team] <= 0) { reinforceT[team] = 40; if (n < 8) { const f = spawnRobot(team, chance(0.35) ? 'gunner' : 'striker', n);
        const p = towns[team]; FX.flash(new THREE.Vector3(f.pos.x, Hd(f.pos.x, f.pos.z) + 0.4, f.pos.z), 0.8, f.col); FX.sparks(new THREE.Vector3(f.pos.x, Hd(f.pos.x, f.pos.z) + 0.3, f.pos.z), 30, f.col, 1.6);
        log(team, `<b>${TEAM_NAME[team]}</b> reinforcement arrives at HQ`); }
      if (!helis.some(h => h.team === team && (h.alive || h.falling))) { const t = towns[team]; const h = makeHeli(team, t.x + 1.5, t.z); log(team, `<b>${TEAM_NAME[team]}</b> replacement gunship arrives`); } }
  }
  // enemy AI: send attack waves toward the player's units / HQ
  waveT -= dt;
  if (waveT <= 0) { waveT = rand(55, 80);
    const idle = robots.filter(r => r.team === 1 && r.state !== 'ko' && !r.order && !alive(r.target));
    const targets = robots.filter(r => r.team === 0 && r.state !== 'ko');
    if (idle.length >= 3) {
      const keep = Math.max(1, Math.floor(idle.length * 0.3)); const go = idle.slice(keep);
      const tgt = targets.length ? targets[Math.floor(RNG() * targets.length)].pos : towns[0];
      go.forEach((r, i) => { r.order = { type: 'amove', x: wm(tgt.x + rand(-1, 1)), z: wm(tgt.z + rand(-1, 1)) }; });
      const eh = helis.find(h => h.team === 1 && h.alive); if (eh) eh.anchor = { x: wm(tgt.x), z: wm(tgt.z) };
      log(1, `<b>Cobalt</b> launches an attack with ${go.length} robots`);
    }
  }
}

// ------------------------------------------------------------------ public API used by the page
const Battle = {
  ready: battleAssets,
  start() {
    const res = () => { for (const p of PARTS) p.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y); };
    addEventListener('resize', res); res();
    TOWNS.forEach((t, i) => buildTown(t, i));
    const roles = ['striker', 'striker', 'gunner', 'striker', 'gunner', 'striker'];
    for (const team of [0, 1]) roles.forEach((r, k) => spawnRobot(team, r, k));
    for (const team of [0, 1]) { const t = towns[team]; makeHeli(team, t.x + 1.5, t.z); }
    log(null, 'Destroy the <b>Cobalt</b> forces and their HQ tower. Your HQ tower brings reinforcements.');
    return { x: towns[0].x * S, z: (towns[0].z + 2) * S };
  },
  selectables() { return [...robots.filter(r => r.team === 0 && r.state !== 'ko'), ...helis.filter(h => h.team === 0 && h.alive)]; },
  enemiesVisible() { return [...robots.filter(r => r.team === 1 && r.state !== 'ko'), ...helis.filter(h => h.team === 1 && h.alive)]; },
  // world-space anchor used for picking/selection (display copy nearest the camera)
  screenAnchor(u, out) { const c = camD(); const y = u.kind === 'robot' ? groundY(u) + (u.y + 0.5) * RS : u.pos.y; return out.set(disp(u.pos.x, c.x) * S, y * S, disp(u.pos.z, c.z) * S); },
  select(list) { for (const u of Battle.selectables()) u.sel = false; for (const u of list) u.sel = true; },
  order(sel, ground, enemy) {
    if (!sel.length) return;
    if (enemy) { for (const u of sel) { u.order = { type: 'attack', target: enemy }; u.target = enemy; if (u.kind === 'robot' && u.state === 'idle') u.thinkT = 0; if (u.kind === 'heli') { u.retarget = 0; u.anchor = { x: enemy.pos.x, z: enemy.pos.z }; } }
      log(0, `Attack order: ${sel.length} unit${sel.length > 1 ? 's' : ''} → <b>${unitName(enemy)}</b>`); return; }
    const gx = ground.x / S, gz = ground.z / S;
    sel.forEach((u, i) => { const a = i * 2.4, r = 0.45 * Math.sqrt(i);
      let x = wm(gx + Math.cos(a) * r), z = wm(gz + Math.sin(a) * r);
      if (u.kind === 'robot' && !passableD(x, z)) {           // goal in deep water: stop at the last dry ground on the way
        const dx = wd(u.pos.x - x), dz = wd(u.pos.z - z), L = Math.hypot(dx, dz) || 1;
        for (let t = 0; t <= L; t += 0.1) { const px = x + dx * t / L, pz = z + dz * t / L; if (passableD(px, pz)) { x = wm(px); z = wm(pz); break; } } }
      if (u.kind === 'heli') { u.anchor = { x, z }; u.order = null; u.target = null; u.retarget = 0; }
      else { u.order = { type: 'move', x, z }; u.target = null; if (u.state === 'fly') { u.flyGoal = { x, z }; if (u.flyPhase === 'down' && u.y > 0.3 && u.boost > 10) { u.flyPhase = 'cruise'; play(u, 'Boost_Forward', 0.2); } } else if (['idle', 'walk', 'fire'].includes(u.state)) { u.state === 'walk' ? (u.st = 99) : null; u.thinkT = 0; if (u.state !== 'idle') toIdle(u, 0.12, 0); } } });
  },
  update(dt) {
    if (!gltf) return;
    const c = camD();
    for (const f of robots) updateRobot(f, dt);
    separate();
    for (const f of robots) {
      const dx = disp(f.pos.x, c.x), dz = disp(f.pos.z, c.z);
      f.visible = Math.hypot(dx - c.x, dz - c.z) * S < FOG_FAR + 100;
      f.root.visible = f.visible && !(f.sink > 0.9);
      f.root.position.set(dx, groundY(f) + f.y * RS - (f.sink || 0), dz); f.root.rotation.y = f.yaw;
      if (f.visible) { f.mixer.update(dt); weaponOverride(f); headTrack(f, dt); gunCarry(f, dt); f.model.updateMatrixWorld(true); footfalls(f); damageFX(f, dt); gunFX(f, dt); updateTrail(f);
        thrusters(f); }
      else { f.mixer.update(dt); }
      placeBar(f, dx * S, (groundY(f) + f.y * RS) * S, dz * S, f.visible && f.state !== 'ko');
      if (f.sel && f.state !== 'ko') { const r = ringFor(f); r.visible = true; r.position.set(dx, groundY(f) + 0.01, dz); } else if (f.ring) f.ring.visible = false;
    }
    for (let i = robots.length - 1; i >= 0; i--) { const f = robots[i]; if (f.sink > 1) { battleRoot.remove(f.root); battleRoot.remove(f.trail); scene.remove(f.bar.g); if (f.ring) battleRoot.remove(f.ring); if (f.glow) { battleRoot.remove(f.glow); battleRoot.remove(f.beamFx.g); } robots.splice(i, 1); } }
    for (const h of helis) { updateHeli(h, dt);
      const dx = disp(h.pos.x, c.x), dz = disp(h.pos.z, c.z);
      h.root.position.set(dx, h.pos.y, dz); h.root.rotation.set(h.pitch, h.yaw, h.roll, 'YXZ');
      placeBar(h, dx * S, h.pos.y * S, dz * S, h.alive && Math.hypot(dx - c.x, dz - c.z) * S < FOG_FAR);
      if (h.sel && h.alive) { const r = ringFor(h); r.visible = true; r.position.set(dx, Math.max(Hd(h.pos.x, h.pos.z), 0) + 0.01, dz); } else if (h.ring) h.ring.visible = false; }
    for (let i = helis.length - 1; i >= 0; i--) { const h = helis[i]; if (!h.alive && !h.falling) { battleRoot.remove(h.root); scene.remove(h.bar.g); if (h.ring) battleRoot.remove(h.ring); helis.splice(i, 1); } }
    for (const t of towns) { const sx = W * Math.round((c.x - t.x) / W), sz = W * Math.round((c.z - t.z) / W); t.root.position.set(sx, 0, sz);
      t.root.visible = Math.hypot(t.x + sx - camera.position.x / S, t.z + sz - camera.position.z / S) * S < FOG_FAR + TOWN * S; }
    for (const t of towns) if (t.plant && t.root.visible) t.plant.update(dt, camera);
    updateBullets(dt); updateLasers(dt); updateBeams(dt); updateHeliProjectiles(dt); updateDebris(dt);
    for (const p of PARTS) p.update(dt);
    teamUpdate(dt); checkVictory();
    trauma = Math.max(0, trauma - dt * 1.1);
    Battle.hud();
  },
  shakeCamera() { const s = trauma * trauma; if (s < 0.0005) return; const t = performance.now() / 1000, amp = 0.012 * cam.dist * s;
    camera.position.x += amp * (Math.sin(t * 91) + Math.sin(t * 57)) * 0.5; camera.position.y += amp * (Math.sin(t * 73) + Math.sin(t * 41)) * 0.5; camera.position.z += amp * (Math.sin(t * 67) + Math.sin(t * 83)) * 0.5; },
  drawMini(ctx, s) {
    for (const t of towns) { ctx.strokeStyle = t.idx === 0 ? '#ff5aa8' : t.idx === 1 ? '#46b8ff' : '#e8e0d0'; ctx.lineWidth = 1.5; ctx.strokeRect(t.x * S * s - 5, t.z * S * s - 5, 10, 10); }
    for (const r of robots) { if (r.state === 'ko') continue; ctx.fillStyle = r.team ? '#46b8ff' : '#ff5aa8'; ctx.fillRect(r.pos.x * S * s - 2, r.pos.z * S * s - 2, 4, 4); }
    for (const h of helis) { if (!h.alive) continue; ctx.fillStyle = h.team ? '#9fe0ff' : '#ffb0d8'; ctx.beginPath(); ctx.arc(h.pos.x * S * s, h.pos.z * S * s, 3, 0, 7); ctx.fill(); }
  },
  hud() {
    const el = document.getElementById('status'); if (!el) return;
    const my = robots.filter(r => r.team === 0 && r.state !== 'ko'), en = robots.filter(r => r.team === 1 && r.state !== 'ko');
    const sel = Battle.selectables().filter(u => u.sel);
    const heliTxt = team => { const h = helis.find(h => h.team === team && h.alive); return h ? `gunship ${Math.round(h.hp / h.maxHp * 100)}%` : 'no gunship'; };
    const tw = towns.map(t => `${t.idx === 0 ? 'Your HQ' : t.idx === 1 ? 'Enemy HQ' : 'Town ' + (t.idx - 1)} ${t.idx < 2 ? (t.hqDown ? '(tower down)' : '') : ''} ${Math.round(t.destroyed / t.total * 100)}% ruined`);
    el.innerHTML = `<b class="t0">Violet</b> ${my.length} robots · ${heliTxt(0)}${towns[0]?.hqDown ? ' · HQ down' : ''}<br><b class="t1">Cobalt</b> ${en.length} robots · ${heliTxt(1)}${towns[1]?.hqDown ? ' · HQ down' : ''}`
      + (sel.length ? `<br>Selected: ${sel.length} · ${sel.map(u => Math.ceil(u.hp / u.maxHp * 100) + '%').slice(0, 8).join(' ')}` : '');
  },
  robots, helis, towns, TOWNS, wrecks, get roadSegs() { return Battle_roadSegs; }, get debris() { return debris; },
};
window.Battle = Battle;
window.planTowns = planTowns;
window.noTreesAt = noTreesAt;
Object.defineProperty(Battle, 'roadTex', { get: () => roadTex });
})();
