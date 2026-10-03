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
const TOWNS = [], TOWN_TREES = []; let Battle_roadSegs = [];                    // {x,z} centres in demo units, [0] = player HQ, [1] = enemy HQ
const RM = 2048;                     // road mask resolution (2 world units per texel)
const roadMask = new Float32Array(RM * RM), roadPerp = new Float32Array(RM * RM), roadDir = new Float32Array(RM * RM * 2), roadJunc = new Uint8Array(RM * RM), roadSeg = new Float32Array(RM * RM * 2);   // coverage, distance from centre line, doubled-angle direction
let roadTex = null, ROAD_NET = null;
const ROAD_HW = ROAD_W / 2 * S + 0.8;   // half of the painted road width incl. kerbs and sidewalks (world units)
function roadAt(xw, zw) { const i = Math.floor(mod(xw, SIZE) / SIZE * RM), j = Math.floor(mod(zw, SIZE) / SIZE * RM); return roadMask[j * RM + i]; }
function noTreesAt(xw, zw) {                    // world units: keep forests off roads and out of towns
  if (roadAt(xw, zw) > 0.02) return true;
  for (const t of TOWNS) if (Math.hypot(wd(xw / S - t.x), wd(zw / S - t.z)) < TOWN + 1.6) return true;
  for (let i = 0; i < Math.min(2, TOWNS.length); i++) { const t = TOWNS[i]; if (Math.abs(wd(xw / S - t.x - 5.3)) < 2.6 && Math.abs(wd(zw / S - t.z - 5.3)) < 2.6) return true; }   // power plant lots
  for (const o of outposts) if (wdist2(o.x, o.z, xw / S, zw / S) < OUTPOST_W * 0.8) return true;
  for (const b of airbases) if (inAirbaseLot(b, xw / S, zw / S)) return true;
  for (const p of pumpjacks) if (PJ_BOX && inPumpLot(p, wm(xw / S), wm(zw / S), 0.3)) return true;
  for (const f of oilFields) if (wdist2(f.x, f.z, xw / S, zw / S) < OIL_R * 1.1) return true;
  for (const p of camps) if (WC_BOX && inCampLot(p, wm(xw / S), wm(zw / S), 0.15)) return true;
  for (const p of farms) if (inFarmLot(p, wm(xw / S), wm(zw / S), 0.15)) return true;
  for (const w of warehouses) if (inWhLot(w, wm(xw / S), wm(zw / S), 0.25)) return true;
  for (const h of hangars) if (inHangarLot(h, wm(xw / S), wm(zw / S), 0.3)) return true;
  return false;
}
// terrain-aware link route (demo units in/out): A* over a coarse grid that penalises grade, high ground and water,
// then smoothed into a gentle curve that leaves and enters the towns along their streets
function routeRoad(ax, az, aox, aoz, bx, bz, box, boz) {
  const G = 16, NG = Math.round(SIZE / G), lead = 4.6;
  const used = routeRoad.used || (routeRoad.used = new Uint8Array(NG * NG));
  // towns (streets + ring) are off limits to link routes: a link never runs back through a town's own streets
  if (!routeRoad.town) { routeRoad.town = new Uint8Array(NG * NG); for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++)
    if (TOWNS.some(t => Math.hypot(wd(i * G / S - t.x), wd(j * G / S - t.z)) < TOWN + 3.3)) routeRoad.town[j * NG + i] = 1; }
  const townC = routeRoad.town;   // cells near earlier links: avoid running alongside them
  const sx = (ax + aox * lead) * S, sz = (az + aoz * lead) * S, ex = (bx + box * lead) * S, ez = (bz + boz * lead) * S;
  const cell = (x, z) => [mod(Math.round(x / G), NG), mod(Math.round(z / G), NG)], hc = (i, j) => heightAt(i * G, j * G);
  const [si, sj] = cell(sx, sz), [ei, ej] = cell(ex, ez), idx = (i, j) => j * NG + i;
  const gs = new Float32Array(NG * NG).fill(Infinity), from = new Int32Array(NG * NG).fill(-1), shut = new Uint8Array(NG * NG);
  const hd = (i, j) => { const di = Math.abs(i - ei), dj = Math.abs(j - ej); return Math.hypot(Math.min(di, NG - di), Math.min(dj, NG - dj)) * G; };
  const heap = [], push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  gs[idx(si, sj)] = 0; push(hd(si, sj), idx(si, sj)); let found = false;
  while (heap.length) { const [, k] = pop(); if (shut[k]) continue; shut[k] = 1; const i = k % NG, j = (k / NG) | 0; if (i === ei && j === ej) { found = true; break; }
    const h0 = hc(i, j);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue;
      const ni = mod(i + di, NG), nj = mod(j + dj, NG), nk = idx(ni, nj); if (shut[nk]) continue;
      const h1 = hc(ni, nj), len = Math.hypot(di, dj) * G, gr = Math.abs(h1 - h0) / len;
      const cost = len * (1 + 60 * gr * gr + Math.max(0, h1 - 55) * 0.04 + used[nk] * 12) + (h1 < 2.5 ? 400 : 0) + (townC[nk] ? 1e5 : 0);
      const g2 = gs[k] + cost; if (g2 < gs[nk]) { gs[nk] = g2; from[nk] = k; push(g2 + hd(ni, nj), nk); } } }
  let path = [[bx, bz], [bx + box * lead, bz + boz * lead]];
  if (found) { const cells = []; for (let k = idx(ei, ej); k >= 0; k = from[k]) cells.push([k % NG, (k / NG) | 0]); cells.reverse();
    // unwrap into one continuous line starting next to the start point, in demo units
    let px = sx, pz = sz; const mid = [[px / S, pz / S]];
    for (const [i, j] of cells) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) used[idx(mod(i + di, NG), mod(j + dj, NG))] = 1;
    for (const [i, j] of cells.slice(1, -1)) { const x = i * G, z = j * G; px += wd((x - px) / S) * S; pz += wd((z - pz) / S) * S; mid.push([px / S, pz / S]); }
    const L = mid[mid.length - 1], ex0 = bx + box * lead, ez0 = bz + boz * lead, ox = W * Math.round((L[0] - ex0) / W), oz = W * Math.round((L[1] - ez0) / W), tx2 = ex0 + ox, tz2 = ez0 + oz;
    mid.push([tx2, tz2], [bx + ox, bz + oz]); mid.unshift([ax, az]);
    path = mid; }
  else { path = [[ax, az], [ax + aox * lead, az + aoz * lead], [bx + box * lead, bz + boz * lead], [bx, bz]]; }
  // smooth (Chaikin) while pinning the two street stubs so the road leaves and enters straight along the streets
  // straight 1.5-unit stubs out of each junction are pinned; everything between them is smoothed (Chaikin) into a curve
  { const S0 = [ax + aox * 1.5, az + aoz * 1.5], E = path[path.length - 1], E0 = [E[0] + box * 1.5, E[1] + boz * 1.5];
    let mid2 = [S0, ...path.slice(1, -1), E0];
    for (let it = 0; it < 5; it++) { const o = [mid2[0]]; for (let k = 0; k + 1 < mid2.length; k++) { const p = mid2[k], q = mid2[k + 1]; o.push([p[0] * .75 + q[0] * .25, p[1] * .75 + q[1] * .25], [p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75]); } o.push(mid2[mid2.length - 1]); mid2 = o; }
    path = [path[0], ...mid2, E]; }
  return path;
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
  // 3) road network. The graph is laid out first (nodes + edges), pass-through nodes are merged into continuous
  //    chains, and everything downstream (terrain cut/fill, the mask, the road meshes, car routes) works on chains:
  //    one polyline and one running distance per road, so the surface never breaks at a join.
  const E = TOWN + 1, OFF = [...ROADS].sort((a, b) => a - b);
  const nodes = [], edges = [];
  const node = (x, z, kind) => { nodes.push({ id: nodes.length, x, z, kind, edges: [] }); return nodes.length - 1; };
  const edge = (a, b, pts) => { edges.push({ id: edges.length, a, b, pts }); nodes[a].edges.push(edges.length - 1); nodes[b].edges.push(edges.length - 1); };
  const endsOf = [];
  TOWNS.forEach(t => {
    const X = {}; for (const a of OFF) for (const b of OFF) X[a + ',' + b] = node(t.x + a, t.z + b, 'x');
    const ends = [], side = { W: {}, E: {}, S: {}, N: {} };
    for (const k of OFF) {
      const w = node(t.x - E, t.z + k, 'end'), e = node(t.x + E, t.z + k, 'end'), s = node(t.x + k, t.z - E, 'end'), n = node(t.x + k, t.z + E, 'end');
      side.W[k] = w; side.E[k] = e; side.S[k] = s; side.N[k] = n;
      ends.push({ n: w, ox: -1, oz: 0 }, { n: e, ox: 1, oz: 0 }, { n: s, ox: 0, oz: -1 }, { n, ox: 0, oz: 1 });
      const row = [w, ...OFF.map(a => X[a + ',' + k]), e], col = [s, ...OFF.map(b => X[k + ',' + b]), n];
      for (const line of [row, col]) for (let i = 0; i + 1 < line.length; i++) { const p = nodes[line[i]], q = nodes[line[i + 1]]; edge(line[i], line[i + 1], [[p.x, p.z], [q.x, q.z]]); }
    }
    // ring road: every street end joins its neighbours around the town, corners are rounded, so no street ends in nowhere
    const [k0, k1, k2] = OFF, ring = [side.S[k0], side.S[k1], side.S[k2], side.E[k0], side.E[k1], side.E[k2], side.N[k2], side.N[k1], side.N[k0], side.W[k2], side.W[k1], side.W[k0]];
    for (let i = 0; i < 12; i++) { const a = nodes[ring[i]], b = nodes[ring[(i + 1) % 12]];
      if (i % 3 !== 2) { edge(ring[i], ring[(i + 1) % 12], [[a.x, a.z], [b.x, b.z]]); continue; }
      const da = [Math.sign(Math.round((a.x - t.x) * 10) - 0) * 0, 0], c = 0.55 * (E - k2);   // corner: leave along a's side, arrive along b's side
      const ta = [(b.x - a.x) !== 0 && Math.abs(a.z - t.z) > Math.abs(a.x - t.x) ? Math.sign(b.x - a.x) : 0, Math.abs(a.x - t.x) > Math.abs(a.z - t.z) ? Math.sign(b.z - a.z) : 0];
      const tb = [Math.abs(b.z - t.z) > Math.abs(b.x - t.x) ? Math.sign(b.x - a.x) : 0, Math.abs(b.x - t.x) > Math.abs(b.z - t.z) ? Math.sign(b.z - a.z) : 0];
      const P = [[a.x, a.z], [a.x + ta[0] * c, a.z + ta[1] * c], [b.x - tb[0] * c, b.z - tb[1] * c], [b.x, b.z]], pts = [];
      for (let q = 0; q <= 16; q++) { const u = q / 16, v = 1 - u; pts.push([0, 1].map(j => v * v * v * P[0][j] + 3 * v * v * u * P[1][j] + 3 * v * u * u * P[2][j] + u * u * u * P[3][j])); }
      edge(ring[i], ring[(i + 1) % 12], pts); }
    for (const n of ring) nodes[n].kind = 'x';                                          // street ends are now T (or 4-way) junctions
    endsOf.push(ends);
  });
  // links: each town to its two nearest towns, from street ends that face each other; every street end is used at most once
  const links = new Set(), used = new Set();
  TOWNS.forEach((t, i) => {
    TOWNS.map((u, j) => ({ j, d: wdist2(t.x, t.z, u.x, u.z) })).filter(o => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 2).forEach(({ j }) => {
      const key = Math.min(i, j) + ':' + Math.max(i, j); if (links.has(key)) return; links.add(key);
      const u = TOWNS[j], sx = wd(u.x - t.x) - (u.x - t.x), sz = wd(u.z - t.z) - (u.z - t.z);
      let best = null;
      for (const A of endsOf[i]) for (const B of endsOf[j]) { if (used.has(A.n) || used.has(B.n)) continue;
        const a = nodes[A.n], b = nodes[B.n], bx = b.x + sx, bz = b.z + sz, dx = bx - a.x, dz = bz - a.z, d = Math.hypot(dx, dz);
        const face = (A.ox * dx + A.oz * dz - B.ox * dx - B.oz * dz) / d, score = d * (2.5 - 0.9 * face);   // strongly prefer ends facing each other (no hairpins out of town)
        if (!best || score < best.score) best = { score, d, A, B, bx, bz }; }
      if (!best) return; used.add(best.A.n); used.add(best.B.n);
      const a = nodes[best.A.n], pts = routeRoad(a.x, a.z, best.A.ox, best.A.oz, best.bx, best.bz, best.B.ox, best.B.oz);
      edge(best.A.n, best.B.n, pts); edges[edges.length - 1].link = true;
    });
  });
  // where two links cross, split both at the crossing and join them with a real junction node (so they connect instead of overlapping)
  const segX = (p, q, r, t) => { const d1x = q[0] - p[0], d1z = q[1] - p[1], d2x = t[0] - r[0], d2z = t[1] - r[1], den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) return null;
    const ux = (r[0] - p[0]) * d2z - (r[1] - p[1]) * d2x, uz = (r[0] - p[0]) * d1z - (r[1] - p[1]) * d1x, a = ux / den, b = uz / den; return a > 0.02 && a < 0.98 && b > 0.02 && b < 0.98 ? { a, b, den } : null; };
  const live = () => edges.filter(e => e.link && !e.dead);
  for (let guard = 0; guard < 60; guard++) {
    let hit = null;
    const L = live();
    outer: for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const A = L[i].pts, B = L[j].pts;
      for (let m = 0; m + 1 < A.length; m++) for (let k = 0; k + 1 < B.length; k++) {
        const ox = W * Math.round((A[m][0] - B[k][0]) / W), oz = W * Math.round((A[m][1] - B[k][1]) / W);
        const r = [B[k][0] + ox, B[k][1] + oz], t = [B[k + 1][0] + ox, B[k + 1][1] + oz];
        if (Math.max(A[m][0], A[m + 1][0]) < Math.min(r[0], t[0]) || Math.min(A[m][0], A[m + 1][0]) > Math.max(r[0], t[0])) continue;
        const x = segX(A[m], A[m + 1], r, t); if (x) { hit = { e1: L[i], e2: L[j], m, k, x, ox, oz }; break outer; } } }
    if (!hit) break;
    const { e1, e2, m, k, x, ox, oz } = hit, A = e1.pts, B = e2.pts, P = [A[m][0] + (A[m + 1][0] - A[m][0]) * x.a, A[m][1] + (A[m + 1][1] - A[m][1]) * x.a];
    const d1 = [A[m + 1][0] - A[m][0], A[m + 1][1] - A[m][1]], d2 = [B[k + 1][0] - B[k][0], B[k + 1][1] - B[k][1]];
    const sin = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / (Math.hypot(...d1) * Math.hypot(...d2) || 1);
    const nx = node(P[0], P[1], 'xc'); nodes[nx].trim = ROAD_HW * Math.min(3, Math.max(1.25, 1.15 / Math.max(0.2, sin))); nodes[nx].dir = d1;
    const PB = [P[0] - ox, P[1] - oz];
    e1.dead = e2.dead = true;
    edge(e1.a, nx, [...A.slice(0, m + 1), P]); edges[edges.length - 1].link = true; edge(nx, e1.b, [P, ...A.slice(m + 1)]); edges[edges.length - 1].link = true;
    edge(e2.a, nx, [...B.slice(0, k + 1), PB]); edges[edges.length - 1].link = true; edge(nx, e2.b, [PB, ...B.slice(k + 1)]); edges[edges.length - 1].link = true;
  }
  for (const n of nodes) n.edges = edges.filter(e => !e.dead && (e.a === n.id || e.b === n.id)).map(e => e.id);
  // merge: walk from every non-pass-through node, joining edges through street ends that continue into a link
  const pass = n => nodes[n].kind === 'end' && nodes[n].edges.length === 2;
  const seen = new Set(), chains = [];
  for (const n0 of nodes) { if (pass(n0.id)) continue;
    for (const e0 of n0.edges) { if (seen.has(e0) || edges[e0].dead) continue;
      let cur = n0.id, eid = e0; const pts = [];
      for (;;) { seen.add(eid); const e = edges[eid]; let p = e.a === cur ? e.pts.slice() : e.pts.slice().reverse();
        if (pts.length) { const L = pts[pts.length - 1], ox = W * Math.round((L[0] - p[0][0]) / W), oz = W * Math.round((L[1] - p[0][1]) / W); p = p.map(q => [q[0] + ox, q[1] + oz]); p.shift(); }
        pts.push(...p); cur = e.a === cur ? e.b : e.a;
        if (!pass(cur)) break;
        eid = nodes[cur].edges.find(x => x !== eid); if (seen.has(eid)) break; }
      chains.push({ a: n0.id, b: cur, pts }); } }
  // resample every chain evenly in world units, with tangents and one smoothed height profile per chain
  const STEP = 1.5, HW = ROAD_HW, inTown = (x, z) => TOWNS.some(t => Math.hypot(wd(x / S - t.x), wd(z / S - t.z)) < TOWN + 1.3);
  for (const c of chains) {
    const P = c.pts.map(p => [p[0] * S, p[1] * S]), cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = cum[cum.length - 1], n = Math.max(2, Math.ceil(L / STEP)); c.len = L; c.n = n; c.x = []; c.z = []; c.tx = []; c.tz = []; c.h = []; c.town = []; c.wet = [];
    for (let k = 0, j = 0; k <= n; k++) { const s = L * k / n; while (j < P.length - 2 && cum[j + 1] < s) j++; const f = clamp((s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]), 0, 1);
      c.x.push(P[j][0] + (P[j + 1][0] - P[j][0]) * f); c.z.push(P[j][1] + (P[j + 1][1] - P[j][1]) * f); }
    for (let k = 0; k <= n; k++) { const a = Math.max(0, k - 1), b = Math.min(n, k + 1), dx = c.x[b] - c.x[a], dz = c.z[b] - c.z[a], l = Math.hypot(dx, dz) || 1; c.tx.push(dx / l); c.tz.push(dz / l);
      c.town.push(inTown(c.x[k], c.z[k])); c.h.push(hAt(c.x[k], c.z[k])); }
    const R = Math.round(20 / STEP);
    for (let pass2 = 0; pass2 < 2; pass2++) { const src = c.h.slice(); c.h = src.map((_, k) => { let s2 = 0, m = 0; for (let q = -R; q <= R; q++) { s2 += src[clamp(k + q, 0, n)]; m++; } return s2 / m; }); }
    for (let k = 0; k <= n; k++) c.wet.push(!c.town[k] && c.h[k] < 1.5);
  }
  // terrain: each ground cell takes the profile height of its nearest road sample, with a soft shoulder
  const cut = new Map(), rc = Math.ceil((HW + 10) / CELL);
  for (const c of chains) for (let k = 0; k <= c.n; k++) { if (c.town[k] || c.wet[k]) continue;
    const ci = Math.round(c.x[k] / CELL), cj = Math.round(c.z[k] / CELL);
    for (let j = -rc; j <= rc; j++) for (let i = -rc; i <= rc; i++) {
      const d = Math.hypot((ci + i) * CELL - c.x[k], (cj + j) * CELL - c.z[k]); if (d > HW + 10) continue;
      const g = at(ci + i, cj + j), prev = cut.get(g); if (!prev || d < prev.d) cut.set(g, { d, tg: c.h[k] }); } }
  for (const [g, { d, tg }] of cut) { const w = d < HW + 1 ? 1 : 1 - smooth((d - HW - 1) / 8); H[g] += (tg - H[g]) * w; }
  // mask (for tree placement, the verge tint and unit pathing): road plus a dirt verge
  const tx = SIZE / RM, rm = Math.ceil((HW + 3) / tx);
  for (const c of chains) for (let k = 0; k <= c.n; k++) { if (c.wet[k]) continue;
    const mi = Math.round(mod(c.x[k], SIZE) / tx), mj = Math.round(mod(c.z[k], SIZE) / tx);
    for (let j = -rm; j <= rm; j++) for (let i = -rm; i <= rm; i++) {
      const d = Math.hypot((mi + i) * tx - mod(c.x[k], SIZE), (mj + j) * tx - mod(c.z[k], SIZE)), cov = 1 - smooth((d - HW) / 2.5); if (cov <= 0) continue;
      const g = mod(mj + j, RM) * RM + mod(mi + i, RM); roadMask[g] = Math.max(roadMask[g], cov); } }
  ROAD_NET = { nodes, chains, HW };
  Battle_roadSegs = [];
  const data = new Uint8Array(RM * RM * 4);
  for (let q = 0; q < RM * RM; q++) { data[q * 4] = roadMask[q] * 255; data[q * 4 + 3] = 255; }
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
// footprint impressions: the sole's normal map lit by the sun, so each print reads as pressed into the ground
const printLayer = (() => { const cap = 1600, g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const nt = texLoader.load('assets/footprint_n.png');
  const mat = new THREE.MeshStandardMaterial({ color: 0x0e0b08, normalMap: nt, envMapIntensity: 0, metalness: 0, normalScale: new THREE.Vector2(1.6, 1.6), alphaMap: null, transparent: true, depthWrite: false, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', 'diffuseColor.a *= texture2D(normalMap, vUv).a * 0.7;'); };
  mat.defines = { USE_UV: '' };
  const m = new THREE.InstancedMesh(g, mat, cap); m.frustumCulled = false; m.count = 0; m.receiveShadow = true; battleRoot.add(m);
  const L = { i: 0, n: 0 }, M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Qy = new THREE.Quaternion(), N = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  L.add = (x, z, yaw, w, l) => { x = wm(x); z = wm(z); window.__lastPrint = [x, z]; HN(x, z, N); Q.setFromUnitVectors(UP, N); Qy.setFromAxisAngle(UP, yaw + Math.PI); Q.multiply(Qy);
    M.compose(new THREE.Vector3(x, Hd(x, z) + 0.004, z), Q, new THREE.Vector3(w, 1, l)); m.setMatrixAt(L.i, M); L.i = (L.i + 1) % cap; L.n = Math.min(cap, L.n + 1); m.count = L.n; m.instanceMatrix.needsUpdate = true; };
  return L; })();
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
// facade sheet: 3x3 cells (brick door/window/plain, siding door/window/plain, shingle/metal/flat roof) + a height map.
// Each chunk shows one third of a cell per axis; aOff says which third, so a 3x3 block of chunks shows a whole door / window panel.
const T_FACADE = texLoader.load('assets/facade.jpg'), T_FACADE_H = texLoader.load('assets/facade_h.jpg');
T_FACADE.encoding = THREE.sRGBEncoding; for (const t of [T_FACADE, T_FACADE_H]) { t.anisotropy = 8; t.generateMipmaps = true; }
function rtex(f) { const t = texLoader.load('assets/' + f); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T_FACADE, roughness: .88 });
  m.onBeforeCompile = sh => { sh.uniforms.tH = { value: T_FACADE_H };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aOff; attribute float aTile; varying vec2 vLUV; varying float vTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 ap=abs(normal); vec2 pl = ap.y>0.5 ? position.xz : (ap.x>0.5 ? vec2(-position.z, position.y) : position.xy);
        vLUV = aOff + pl / 3.; vTile = aTile;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLUV; varying float vTile; uniform sampler2D tH;')
      .replace('#include <map_fragment>', `
        float tl = mod(vTile, 16.), lit = step(15.5, vTile); vec2 cell = vec2(mod(tl, 3.), floor(tl / 3.)); vec2 fr = clamp(vLUV, 0.004, 0.996);
        vec2 auv = vec2((cell.x + fr.x) / 3., 1. - (cell.y + 1. - fr.y) / 3.);
        vec4 texelColor = mapTexelToLinear(texture2D(map, auv)); float hh = texture2D(tH, auv).r;
        diffuseColor *= texelColor * mix(0.62, 1.08, hh);                              // height map as relief shading (grout, frames, recesses)
        float win = step(0.2, fr.x) * step(fr.x, 0.8) * step(0.37, fr.y) * step(fr.y, 0.76) * step(0.5, mod(tl, 3.)) * step(mod(tl, 3.), 1.5);
        totalEmissiveRadiance += vec3(1.0, 0.68, 0.32) * 1.4 * win * lit * (1. - hh);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>'); };
  m.customProgramCacheKey = () => 'facade'; return m;
}
const GROUP_DEFS = {
  facade: { geo: unitBox, mat: facadeMaterial(), cap: 30000 },
  roofMetal: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: rtex('roof_metal.jpg'), roughness: .5, metalness: .4 }, 3.2), cap: 4000 },
  roofFlat: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: rtex('roof_flat.jpg'), roughness: .95 }, 3.2), cap: 4000 },
  wall: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: T_SIDING, roughness: .9 }, 14, true), cap: 24000 },
  roof: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: (() => { const t = texLoader.load('assets/roof_shingle.jpg'); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })(), roughness: .85 }, 3.2), cap: 9000 },
  winLit: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: lin(0xffd690), emissive: lin(0xffb060), emissiveIntensity: 1.6, roughness: .3 }), cap: 5000 },
  winDark: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: lin(0x2a3444), metalness: .6, roughness: .15 }), cap: 5000 },
  trim: { geo: unitBox, mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85 }), cap: 4000 },
  stone: { geo: unitBox, mat: chunkMaterial({ color: 0xffffff, map: T_STONE, roughness: .95 }, 4), cap: 6000 },
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
function addChunk(g, pos, quat, scale, color, prop, meta, tile = 0, off = null) {
  const grp = curTown.G[g]; if (grp.n >= grp.im.instanceMatrix.count) return -1; const i = grp.n++; grp.im.count = grp.n;
  if (off) { const oa = grp.im.geometry.attributes.aOff; oa.setXY(i, off[0], off[1]); oa.needsUpdate = true; }
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
// houses are assembled from blocks (walls in breakable chunk grids + a roof); styles combine blocks
const WALLC = [0xffffff, 0xf0e4c8, 0xd6e2ea, 0xe0cdb2, 0xbfd0b4, 0xe8c8b8, 0xb8c6d6, 0xd8d0c0, 0xc8b8a0];
const TRIMC = [0x6b5040, 0xf0f0f0, 0x3a3f48, 0x7a3a2a, 0x2f4a3a];
function buildHouse(x, z, rot, r) {
  const pick = a => a[Math.floor(r() * a.length)];
  const style = pick(['cottage', 'cottage', 'twostory', 'lshape', 'lshape', 'modern', 'garage', 'porch', 'porch']);
  const brick = r() < 0.45, MAT_ROW = brick ? 0 : 1, litHouse = r() < 0.6, roofKind = r() < 0.72 ? 'roof' : 'roofMetal';
  const wallC = brick ? pick([0xffffff, 0xf2e6dc, 0xe0d4cc]) : pick(WALLC), roofC = roofKind === 'roof' ? pick([0xffffff, 0xd8d0c8, 0xb89080, 0xa0b0c0, 0x90a890]) : pick([0xffffff, 0xc86050, 0x6a8ab0, 0x708a70]), trimC = pick(TRIMC), tile = Math.floor(r() * 24), t = 0.018, CELLd = 0.045;
  // footprint of the main block decides the ground plinth
  let W = 0.24 + r() * 0.14, D = 0.2 + r() * 0.1;
  const blocks = [];
  if (style === 'cottage') blocks.push({ ox: 0, oz: 0, yaw: 0, w: W, d: D, h: 0.15 + r() * 0.03, roof: 'gable', rh: 0.08 + r() * 0.06, door: true });
  if (style === 'twostory') blocks.push({ ox: 0, oz: 0, yaw: 0, w: W, d: D, h: 0.26 + r() * 0.04, roof: 'gable', rh: 0.09 + r() * 0.05, door: true, floors: 2 });
  if (style === 'lshape') { const ww = 0.12 + r() * 0.06, wd = 0.14 + r() * 0.06, side = r() < 0.5 ? 1 : -1, h = 0.15 + r() * 0.05;
    blocks.push({ ox: 0, oz: 0, yaw: 0, w: W, d: D, h, roof: 'gable', rh: 0.09 + r() * 0.04, door: true, floors: h > 0.18 ? 2 : 1 });
    blocks.push({ ox: side * (W / 2 - ww / 2), oz: -(D / 2 + wd / 2 - 0.01), yaw: Math.PI / 2, w: wd + 0.02, d: ww, h: h * 0.92, roof: 'gable', rh: 0.07 + r() * 0.03 }); }
  if (style === 'modern') { const fl = 2 + (r() < 0.35 ? 1 : 0); W = 0.26 + r() * 0.1; D = 0.22 + r() * 0.08;
    blocks.push({ ox: 0, oz: 0, yaw: 0, w: W, d: D, h: 0.12 * fl, roof: 'flat', door: true, floors: fl, big: true }); }
  if (style === 'garage') { const gw = 0.13 + r() * 0.04, side = r() < 0.5 ? 1 : -1, h = 0.15 + r() * 0.03;
    blocks.push({ ox: -side * gw / 2, oz: 0, yaw: 0, w: W, d: D, h, roof: 'gable', rh: 0.08 + r() * 0.05, door: true });
    blocks.push({ ox: side * (W / 2), oz: 0.01, yaw: 0, w: gw, d: D * 0.9, h: 0.11, roof: 'flat', garage: true }); W += gw; }
  if (style === 'porch') blocks.push({ ox: 0, oz: -0.03, yaw: 0, w: W, d: D, h: 0.15 + r() * 0.05, roof: 'gable', rh: 0.08 + r() * 0.05, door: true, porch: true });
  const hw = W / 2 + 0.05, hd = D / 2 + (style === 'lshape' ? 0.2 : 0.08);
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => Hd(x + a * Math.cos(rot) + b * Math.sin(rot), z - a * Math.sin(rot) + b * Math.cos(rot)));
  const y0 = Math.min(...corners), yF = Math.max(...corners) + 0.012, topMax = Math.max(...blocks.map(b => b.h + (b.rh || 0.03)));
  const p = newProp('house', x, z, rot, Math.hypot(hw, hd) + 0.02, yF + topMax, { hw, hd, y0, walls: [] });
  const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  for (const B of blocks) {
    const q = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), B.yaw)), { w, d, h } = B;
    const Wp = (lx, ly, lz) => { const c = Math.cos(B.yaw), sn = Math.sin(B.yaw); return new THREE.Vector3(B.ox + lx * c + lz * sn, ly, B.oz - lx * sn + lz * c).applyQuaternion(q0).add(new THREE.Vector3(x, 0, z)); };
    addChunk('stone', Wp(0, (y0 + yF) / 2 - 0.01, 0), q, new THREE.Vector3(w + 0.03, yF - y0 + 0.02, d + 0.03), 0xbbb0a0, p, { found: true });
    const fl = B.floors || Math.max(1, Math.round(h / 0.13)), rows = 3 * fl, rhh = h / rows;
    const walls = [{ len: w, pos: u => [u, d / 2], ax: 'x' }, { len: w, pos: u => [-u, -d / 2], ax: 'x' }, { len: d - t, pos: u => [w / 2, -u], ax: 'z' }, { len: d - t, pos: u => [-w / 2, u], ax: 'z' }];
    walls.forEach((wl, wi) => {
      const panels = Math.max(1, Math.round(wl.len / (rhh * 3))), cols = panels * 3, cw = wl.len / cols, grid = [];
      // decide each panel: door (front, ground floor, middle), window, or plain wall
      const kind = (pi, st) => { if (B.garage) return wi === 0 && st === 0 ? 'metal' : 'plain';
        if (B.door && wi === 0 && st === 0 && pi === Math.floor(panels / 2)) return 'door';
        if (B.big) return 'win'; return (pi + st + wi) % 2 === (panels > 2 ? 1 : 0) || panels === 1 ? 'win' : 'plain'; };
      for (let rr = 0; rr < rows; rr++) { grid.push([]); const st = Math.floor(rr / 3), sub = rr % 3; for (let c = 0; c < cols; c++) {
        const pi = Math.floor(c / 3), sc3 = c % 3, k = kind(pi, st), u = -wl.len / 2 + cw * (c + 0.5), [lx, lz] = wl.pos(u), ly = yF + rhh * (rr + 0.5);
        const tileId = k === 'metal' ? 7 : MAT_ROW * 3 + (k === 'door' ? 0 : k === 'win' ? 1 : 2), lit = k === 'win' && litHouse ? 16 : 0;
        const glass = k === 'win' && sc3 === 1 && sub === 1;
        const sc = wl.ax === 'x' ? new THREE.Vector3(cw * 0.99, rhh * 0.99, t) : new THREE.Vector3(t, rhh * 0.99, cw * 0.99);
        grid[rr].push(addChunk('facade', Wp(lx, ly, lz), q, sc, k === 'metal' ? 0xd0d4d8 : wallC, p, { wall: wi, row: rr, col: c, glass }, tileId + lit, [(sc3 + 0.5) / 3, (sub + 0.5) / 3]));
      } }
      p.walls.push(grid);
    });
    const top = yF + h;
    if (B.roof === 'gable') { const rh = B.rh, slope = Math.atan2(rh, d / 2), slen = Math.hypot(rh, d / 2) + 0.02, nx = Math.max(3, Math.round((w + 0.05) / 0.06)), ns = 3, tw = (w + 0.05) / nx;
      for (const sx of [1, -1]) for (let k = 0; k < 3; k++) { const gh = rh / 3, gw = d * (1 - (k + 0.5) / 3) * 0.98; addChunk('facade', Wp(sx * w / 2, top + gh * (k + 0.5), 0), q, new THREE.Vector3(t, gh * 0.98, gw), wallC, p, { gable: true }, MAT_ROW * 3 + 2, [0.5, (k + 0.5) / 3]); }
      for (const sz of [1, -1]) { const qs = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sz * slope));
        for (let i = 0; i < nx; i++) for (let j = 0; j < ns; j++) { const along = (j + 0.5) / ns, lz = sz * (d / 2 + 0.02) * along, ly = top + rh * (1 - along) + 0.008;
          addChunk(roofKind, Wp(-(w + 0.05) / 2 + tw * (i + 0.5), ly, lz), qs, new THREE.Vector3(tw * 0.97, 0.012, slen / ns * 0.97), roofC, p, { roof: true }); } }
      if (r() < 0.55) { addChunk('stone', Wp(w * 0.25, top + rh * 0.55, -d * 0.15), q, new THREE.Vector3(0.03, 0.05, 0.03), 0x8a6a5a, p, { roof: true }); addChunk('stone', Wp(w * 0.25, top + rh * 0.55 + 0.05, -d * 0.15), q, new THREE.Vector3(0.032, 0.05, 0.032), 0x8a6a5a, p, { roof: true }); }
    } else {                                                                            // flat roof: slab, parapet, rooftop unit
      const nx = Math.max(2, Math.round(w / 0.08)), nz = Math.max(2, Math.round(d / 0.08));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) addChunk('roofFlat', Wp(-w / 2 + w * (i + 0.5) / nx, top + 0.006, -d / 2 + d * (j + 0.5) / nz), q, new THREE.Vector3(w / nx * 0.99, 0.012, d / nz * 0.99), 0xffffff, p, { roof: true });
      if (!B.garage) { for (const [px, pz, sx, sz] of [[0, d / 2, w + 0.01, 0.012], [0, -d / 2, w + 0.01, 0.012], [w / 2, 0, 0.012, d], [-w / 2, 0, 0.012, d]]) addChunk('stone', Wp(px, top + 0.02, pz), q, new THREE.Vector3(sx, 0.028, sz), 0xb0aaa0, p, { roof: true });
        addChunk('metal', Wp(w * (r() - 0.5) * 0.4, top + 0.035, d * (r() - 0.5) * 0.3), q, new THREE.Vector3(0.05, 0.04, 0.04), 0x8a8e94, p, { roof: true }); }
    }
    if (B.porch) {                                                                      // porch: posts + a thin roof over the door
      const pd = 0.07, pz = d / 2 + pd / 2, ph = Math.min(h * 0.75, 0.13);
      for (const px of [-w * 0.3, w * 0.3]) addChunk('trim', Wp(px, yF + ph / 2, d / 2 + pd - 0.005), q, new THREE.Vector3(0.012, ph, 0.012), trimC, p, {});
      addChunk('roof', Wp(0, yF + ph + 0.006, pz), q, new THREE.Vector3(w * 0.72, 0.012, pd + 0.01), roofC, p, { roof: true });
      addChunk('stone', Wp(0, yF + 0.004, pz), q, new THREE.Vector3(w * 0.7, 0.008, pd), 0xa89a88, p, {});
    }
  }
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
    const PK = 2.2 / 46, px = cx + 5.3, pz = cz + 5.3;   // inside the ring road              // ~43 world units across, just outside the houses
    const plant = PowerPlant.build({ accent: idx === 0 ? 0xe0579c : 0x2f6fd6 });
    plant.group.scale.setScalar(PK); plant.group.position.set(px, Hd(px, pz) - 0.02, pz); plant.group.rotation.y = Math.PI;   // front faces the plaza
    root.add(plant.group); curTown.plant = plant;
    const half = 23 * PK;
    blockers.push({ x: px, z: pz, hw: half + 0.25, hd: half + 0.25 });
    const pp = newProp('plant', px, pz, 0, half * 1.42, Hd(px, pz) + 38 * PK, { hw: half, hd: half, y0: Hd(px, pz) - 0.05 }); pp.total = 0; registerProp(pp);
  }
  curTown.hq = buildTower(cx + 0.95, cz - 0.95, teamCol);   // in the corner lot beside the central crossing (the plaza is a street crossing now)
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
  carImpact(pt, radius, power, kind); outpostImpact(pt, radius, power, kind); airbaseImpact(pt, radius, power, kind); pumpImpact(pt, radius, power, kind); campImpact(pt, radius, power, kind); mineImpact(pt, radius, power, kind); farmImpact(pt, radius, power, kind); warehouseImpact(pt, radius, power, kind); soldierImpact(pt, radius, power, kind); hangarImpact(pt, radius, power, kind); bridgeImpact(pt, radius, power, kind);
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
function propHit(pos) { if (outpostAt(pos) || airbaseAt(pos) || pumpAt(pos) || campAt(pos) || mineAt(pos) || warehouseAt(pos) || hangarAt(pos)) return true; for (const p of propsNear(pos.x, pos.z)) if (p.alive && pointInProp(p, pos)) return true; return false; }
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
// mech ships in two parts (artifact per-file size limit)
const loadGLBParts = urls => Promise.all(urls.map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.text(); })))
  .then(ts => new Promise((res, rej) => { const bin = Uint8Array.from(atob(ts.map(t => t.trim()).join('')), c => c.charCodeAt(0)); gltfLoader.parse(bin.buffer, '', res, rej); }));
const CARRY_BONES = ['Shoulder_R', 'UpperArm_R', 'ForeArm_R', 'Hand_R'], CARRY_Q = {};
let FOOT_SOLE = 0, MECH_K = 1, BL_BASE = new THREE.Vector3(), BL_TIP = new THREE.Vector3(0, 0.3, 0);
function prepMech(g) { const sc = g.scene; sc.updateMatrixWorld(true);
  const box = new THREE.Box3(); sc.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  MECH_K = 0.92 / Math.max(0.1, box.max.y - Math.min(0, box.min.y));
  { const fl = sc.getObjectByName('Foot_L'), fr = sc.getObjectByName('Foot_R'); if (fl && fr) FOOT_SOLE = Math.min(fl.getWorldPosition(new THREE.Vector3()).y, fr.getWorldPosition(new THREE.Vector3()).y) - box.min.y; }   // ankle height above the sole in bind pose
  // blade segment in the blade node's local frame: the long axis of its bounding box, tip = end farthest from the hilt
  // blade segment in the SaberBlade bone's frame. The blade is skinned into the body mesh, so take its vertices from bind space into that bone's space
  const bl = sc.getObjectByName('SaberBlade'); let core = null; sc.traverse(o => { if (o.isSkinnedMesh && /^SaberBladeCore/.test(o.material.name)) core = o; });
  const bi = core ? core.skeleton.bones.indexOf(bl) : -1;
  if (bi >= 0) { const m = new THREE.Matrix4().multiplyMatrices(core.skeleton.boneInverses[bi], core.bindMatrix), pos = core.geometry.attributes.position, v = new THREE.Vector3(), bb = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) bb.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    const sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3()); const ax = sz.x > sz.y ? (sz.x > sz.z ? 'x' : 'z') : (sz.y > sz.z ? 'y' : 'z');
    const e0 = c.clone(), e1 = c.clone(); e0[ax] = bb.min[ax]; e1[ax] = bb.max[ax];
    if (e0.length() < e1.length()) { BL_BASE = e0; BL_TIP = e1; } else { BL_BASE = e1; BL_TIP = e0; } }   // the bone sits at the emitter, so the far end is the tip
  console.info('saber blade', BL_BASE.toArray().map(x => x.toFixed(3)), BL_TIP.toArray().map(x => x.toFixed(3)));
  // rifle-carry arm pose, sampled from Gun_Idle, held over walk/run clips so the rifle stays pointed forward
  const ci = g.animations.find(a => a.name === 'Gun_Idle'); if (ci) { const tmp = THREE.SkeletonUtils.clone(sc), mx = new THREE.AnimationMixer(tmp); mx.clipAction(ci).play(); mx.update(0.3);
    for (const nm of CARRY_BONES) { const o = tmp.getObjectByName(nm); if (o) CARRY_Q[nm] = o.quaternion.clone(); } }
  return g; }
const battleAssets = Promise.all([loadGLBParts(['assets/mech.0.b64.txt', 'assets/mech.1.b64.txt']).then(prepMech), loadGLB('assets/heli.b64.txt'), loadGLB('assets/car.b64.txt').catch(() => null), loadGLB('assets/people.b64.txt').then(g => { pedProto = g.scene; }, () => null), loadGLB('assets/outpost.b64.txt').catch(e => { console.error('outpost model', e); OUTPOST_ERR = String(e && e.message || e); return null; }), loadGLB('assets/airbase.b64.txt').catch(e => { console.error('airbase model', e); AIRBASE_ERR = String(e && e.message || e); return null; })]).then(([g, h, c, , o, ab]) => { gltf = g; heliProto = h.scene; carProto = c && c.scene; outpostProto = o && o.scene; airbaseProto = ab && ab.scene; });
const pumpAssets = loadGLB('assets/pumpjack.b64.txt').then(preparePump, e => { console.error('pump model', e); PUMP_ERR = String(e && e.message || e); });
const woodAssets = loadGLB('assets/woodcutter.b64.txt').then(prepareWood, e => { console.error('woodcutter model', e); WOOD_ERR = String(e && e.message || e); });
const mineAssets = loadGLB('assets/mine.b64.txt').then(prepareMine, e => { console.error('mine model', e); MINE_ERR = String(e && e.message || e); });
const farmAssets = loadGLB('assets/farm.b64.txt').then(prepareFarm, e => { console.error('farm model', e); FARM_ERR = String(e && e.message || e); });
const semiAssets = loadGLB('assets/semi.b64.txt').then(prepareSemi, e => { console.error('semi model', e); SEMI_ERR = String(e && e.message || e); });
const soldierAssets = battleAssets.then(() => loadGLB('assets/soldiers.b64.txt')).then(g => prepareSoldiers(g, gltf && gltf.scene), e => console.error('soldier model', e));
const hangarAssets = loadGLB('assets/hangar.b64.txt').then(prepareHangar, e => { console.error('hangar model', e); HANGAR_ERR = String(e && e.message || e); });
const scaffoldAssets = Promise.all([loadGLB('assets/scaffold_wall.b64.txt'), loadGLB('assets/scaffold_top.b64.txt')]).then(([w, t]) => { scWallProto = w.scene; scTopProto = t.scene; }, e => console.error('scaffold models', e));

// ------------------------------------------------------------------ road meshes (built from the merged chains)
// straight road: u across the full painted width, v = running distance / HW (one texture tile per HW of road);
// intersections: one junction square per grid node; crosswalk strips on every approach. Geometry is bucketed into
// 512-unit tiles per material and drawn at the 3x3 wrap offsets, so off-screen tiles are culled.
const roadTiles = [];
let _roadMats = null; const roadMatsOnce = () => _roadMats || (_roadMats = roadMats());
function roadMats() {
  const T = (f, rep) => { const t = texLoader.load('assets/' + f); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.anisotropy = 8; return t; };
  const M = (f, h, rep) => { const map = T(f, rep); map.encoding = THREE.sRGBEncoding;
    const m = new THREE.MeshStandardMaterial({ map, bumpMap: T(h, rep), bumpScale: 0.35, roughness: 0.92, metalness: 0, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -12 });
    // fog exactly like the terrain shader (same colour, distance and blend before tone mapping), so roads fade with the ground
    m.onBeforeCompile = sh => { sh.uniforms.uH = { value: HORIZON }; sh.uniforms.uNear = { value: FOG_NEAR }; sh.uniforms.uFar = { value: FOG_FAR };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoadW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRoadW = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoadW; uniform vec3 uH; uniform float uNear, uFar;')
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uH, smoothstep(uNear, uFar, length(cameraPosition - vRoadW)));\n#include <tonemapping_fragment>'); };
    return m; };
  return { road: M('road2.jpg', 'road2_h.jpg', true), cross: M('road2_cross.jpg', 'road2_cross_h.jpg', false), junc: M('road2_junc.jpg', 'road2_junc_h.jpg', false) };
}
function roadSample(c, s) { const f = clamp(s / c.len, 0, 1) * c.n, k = Math.min(c.n - 1, Math.floor(f)), t = f - k;
  const tx = c.tx[k] + (c.tx[k + 1] - c.tx[k]) * t, tz = c.tz[k] + (c.tz[k + 1] - c.tz[k]) * t, l = Math.hypot(tx, tz) || 1;
  return { x: c.x[k] + (c.x[k + 1] - c.x[k]) * t, z: c.z[k] + (c.z[k + 1] - c.z[k]) * t, tx: tx / l, tz: tz / l, wet: (c.wet[k] && !(c.br && c.br[k])) || (c.wet[k + 1] && !(c.br && c.br[k + 1])), rawWet: c.wet[k] || c.wet[k + 1] }; }
function buildRoadMeshes() {
  if (!ROAD_NET) return; const { nodes, chains, HW } = ROAD_NET, CW = 1.25, LIFT = 0.35, ACROSS = [-1, -0.5, 0, 0.5, 1];
  const buckets = new Map(), mats = roadMatsOnce();
  const B = (mat, x, z) => { const key = mat + ':' + Math.floor(x / 512) + ':' + Math.floor(z / 512); let b = buckets.get(key); if (!b) buckets.set(key, b = { mat, p: [], uv: [], idx: [] }); return b; };
  const Y = (x, z) => heightAt(x, z) + LIFT;
  // strip between running distances s0..s1 of chain c; vOf(s) gives the texture v
  const strip = (c, s0, s1, mat, vOf) => { if (s1 - s0 < 0.05) return;
    const ss = [s0]; for (let k = 0; k <= c.n; k++) { const s = c.len * k / c.n; if (s > s0 + 0.05 && s < s1 - 0.05) ss.push(s); } ss.push(s1);
    for (let i = 0; i + 1 < ss.length; i++) {
      const a = roadSample(c, ss[i]), b = roadSample(c, ss[i + 1]); if (a.rawWet || b.rawWet) continue;
      const bk = B(mat, (a.x + b.x) / 2, (a.z + b.z) / 2), base = bk.p.length / 3;
      for (const [q, s] of [[a, ss[i]], [b, ss[i + 1]]]) for (const o of ACROSS) {
        const x = q.x - q.tz * o * HW, z = q.z + q.tx * o * HW; bk.p.push(x, Y(x, z), z); bk.uv.push((o + 1) / 2, vOf(s)); }
      const m = ACROSS.length;
      for (let j = 0; j + 1 < m; j++) bk.idx.push(base + j, base + j + 1, base + m + j, base + j + 1, base + m + j + 1, base + m + j);
    } };
  for (const c of chains) {
    const na = nodes[c.a], nb = nodes[c.b], xa = na.kind === 'x' || na.kind === 'xc', xb = nb.kind === 'x' || nb.kind === 'xc', ta = na.trim || HW, tb = nb.trim || HW;
    const s0 = xa ? ta + CW : 0, s1 = c.len - (xb ? tb + CW : 0);
    strip(c, s0, s1, 'road', s => s / HW);
    if (xa) strip(c, ta, ta + CW, 'cross', s => (s - ta) / CW);                          // v = 0 at the junction edge, 1 at the stop line
    if (xb) strip(c, c.len - tb - CW, c.len - tb, 'cross', s => (c.len - tb - s) / CW);
  }
  for (const n of nodes) { if (n.kind !== 'xc') continue;                             // crossings out of town: a disc covering every approach, textured along one road
    const cx = n.x * S, cz = n.z * S, R = n.trim + 0.4, l = Math.hypot(...n.dir), ux = n.dir[0] / l, uz = n.dir[1] / l, bk = B('junc', cx, cz), base = bk.p.length / 3, SEG = 24;
    const uvOf = (x, z) => [((x - cx) * ux + (z - cz) * uz) / (2 * R) + 0.5, ((x - cx) * -uz + (z - cz) * ux) / (2 * R) + 0.5];
    bk.p.push(cx, Y(cx, cz), cz); bk.uv.push(0.5, 0.5);
    for (let i = 0; i <= SEG; i++) { const a = i / SEG * Math.PI * 2, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R; bk.p.push(x, Y(x, z), z); bk.uv.push(...uvOf(x, z)); }
    for (let i = 0; i < SEG; i++) bk.idx.push(base, base + 2 + i, base + 1 + i); }
  for (const n of nodes) { if (n.kind !== 'x') continue;                              // junction squares (town grids are axis-aligned)
    const cx = n.x * S, cz = n.z * S, bk = B('junc', cx, cz), base = bk.p.length / 3, G = 4;
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const x = cx + (i / G * 2 - 1) * HW, z = cz + (j / G * 2 - 1) * HW; bk.p.push(x, Y(x, z), z); bk.uv.push(i / G, 1 - j / G); }
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = base + j * (G + 1) + i; bk.idx.push(a, a + G + 1, a + 1, a + 1, a + G + 1, a + G + 2); }
  }
  for (const b of buckets.values()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.idx); g.computeVertexNormals(); g.computeBoundingSphere();
    for (const ox of [-SIZE, 0, SIZE]) for (const oz of [-SIZE, 0, SIZE]) {
      const m = new THREE.Mesh(g, mats[b.mat]); m.position.set(ox, 0, oz); m.receiveShadow = true; scene.add(m); roadTiles.push(m); } }
}
// ------------------------------------------------------------------ bridges
// Where a road crosses a short or medium stretch of water it gets a bridge. Each bridge is built from separate pieces
// (deck sections, and piers on medium spans) that are damaged and knocked into the water one by one; a missing deck
// section closes the road there again.
const bridges = [], BR_SMALL = 45, BR_MEDIUM = 140, BR_SEG = 7;   // gap lengths and deck section length, world units
const BR_MAT = { deck: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9 }), steel: new THREE.MeshStandardMaterial({ color: 0x6d7a80, roughness: 0.55, metalness: 0.5 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xb8b2a2, roughness: 0.7 }), line: new THREE.MeshStandardMaterial({ color: 0xd8c25a, roughness: 0.8 }),
  pier: new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.95 }) };
const bx = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
// one deck section: a curved slab that follows the road between running distances sa..sb, so neighbouring sections meet
// with no gap; the roadway uses the road's own asphalt material. Built in world units around (cx, cy, cz), shrunk to demo units.
function deckPiece(c, br, sa, sb, W, medium, cx, cy, cz) { const HW = ROAD_NET.HW, n = Math.max(2, Math.ceil((sb - sa) / 1.5)), T = 0.7, groups = new Map();
  const G = mat => { let g = groups.get(mat); if (!g) groups.set(mat, g = { p: [], uv: [], idx: [] }); return g; };
  const rows = []; for (let i = 0; i <= n; i++) { const s = sa + (sb - sa) * i / n, q = roadSample(c, s); rows.push({ s, x: q.x - cx, z: q.z - cz, nx: -q.tz, nz: q.tx, y: br.deckY(s) - cy }); }
  // a strip across the deck from offset o0 to o1 at height h0..h1 (vertical when o0 === o1)
  const strip = (mat, o0, h0, o1, h1, uOf) => { const g = G(mat), base = g.p.length / 3;
    for (const r of rows) { g.p.push(r.x + r.nx * o0, r.y + h0, r.z + r.nz * o0, r.x + r.nx * o1, r.y + h1, r.z + r.nz * o1); g.uv.push(uOf ? uOf(0) : 0, r.s / HW, uOf ? uOf(1) : 1, r.s / HW); }
    for (let i = 0; i < n; i++) { const a = base + i * 2; g.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } };   /* one face, wound like the road meshes; walls use two-sided materials */
  strip('road', -HW, 0.02, HW, 0.02, k => k);                                                 // roadway
  for (const sd of [-1, 1]) { const ow = sd * W / 2, ih = sd * HW;
    strip('kerb', ih, 0.02, ow, 0.02); strip('kerb', ow, 0.02, ow, 1.1); strip('kerb', ow - sd * 0.35, 0.02, ow - sd * 0.35, 1.1); strip('kerb', ow, 1.1, ow - sd * 0.35, 1.1);   // walkway and parapet
    strip('steel', ow, 0.02, ow, -T); strip('steel', sd * (W / 2 - 1.2), -T, sd * (W / 2 - 1.2), -T - 1.6);              // slab edge and girder
    if (medium) strip('steel', ow - sd * 0.15, 2.2, ow - sd * 0.15, 2.4); }
  strip('steel', -W / 2, -T, W / 2, -T);                                                      // underside
  BR_MAT.rail.side = BR_MAT.steel.side = THREE.DoubleSide; const mats = { road: roadMatsOnce().road, kerb: BR_MAT.rail, steel: BR_MAT.steel }, root = new THREE.Group();
  for (const [k, g] of groups) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); geo.setIndex(g.idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats[k]); m.castShadow = k !== 'road'; m.receiveShadow = true; root.add(m); }
  if (medium) for (const i of [0, n]) { const r = rows[i]; for (const sd of [-1, 1]) { const m = bx(0.25, 2.4, 0.25, BR_MAT.steel, r.x + r.nx * sd * (W / 2 - 0.15), r.y + 1.2, r.z + r.nz * sd * (W / 2 - 0.15)); root.add(m); } }
  root.scale.setScalar(1 / S); return root; }
function pierPiece(top, W) { const g = new THREE.Group(), H = top + 8;
  for (const sd of [-1, 1]) g.add(bx(1.6, H, 1.6, BR_MAT.pier, sd * (W / 2 - 1.2), -H / 2 - 2.4, 0));
  g.add(bx(W - 0.6, 1.2, 1.8, BR_MAT.pier, 0, -2.4 - 0.6, 0)); g.scale.setScalar(1 / S); return g; }
function placeBridges() { if (!ROAD_NET) return; const { chains, HW } = ROAD_NET, W = HW * 2 + 1.4;
  for (const c of chains) { c.br = new Array(c.n + 1).fill(false); let k = 0;
    while (k <= c.n) { if (!c.wet[k]) { k++; continue; } let k1 = k; while (k1 + 1 <= c.n && c.wet[k1 + 1]) k1++;
      const a = k - 1, b = k1 + 1; k = k1 + 1; if (a < 0 || b > c.n) continue;                  // water touching a chain end: no banks to span between
      const s0 = c.len * a / c.n, s1 = c.len * b / c.n, L = s1 - s0; if (L > BR_MEDIUM) continue;
      const medium = L > BR_SMALL, ya = heightAt(c.x[a], c.z[a]) + 0.35, yb = heightAt(c.x[b], c.z[b]) + 0.35, n = Math.max(2, Math.round(L / BR_SEG));
      const mid = roadSample(c, (s0 + s1) / 2), br = { c, a, b, s0, s1, ya, yb, arch: medium ? Math.min(4, L * 0.03) : 0.6, x: wm(mid.x / S), z: wm(mid.z / S), pieces: [], broken: false, root: new THREE.Group() };
      br.deckY = s => { const u = clamp((s - s0) / L, 0, 1); return ya + (yb - ya) * u + Math.sin(u * Math.PI) * br.arch; };
      for (let i = 0; i < n; i++) { const sa = s0 + L * i / n, sb = s0 + L * (i + 1) / n, sm = (sa + sb) / 2, q = roadSample(c, sm), y = br.deckY(sm), seg = Math.hypot(...[0, 1].map(j => { const p0 = roadSample(c, sa), p1 = roadSample(c, sb); return j ? p1.z - p0.z : p1.x - p0.x; })) + 0.15;
        const o = deckPiece(c, br, sa, sb, W, medium, q.x, y, q.z); o.position.set(wd(q.x / S - br.x), y / S, wd(q.z / S - br.z));
        br.root.add(o); br.pieces.push({ o, kind: 'deck', sa, sb, hp: 160, alive: true, vel: new THREE.Vector3(), spin: new THREE.Vector3() }); }
      if (medium) for (let i = 1; i < n; i++) { if (n > 3 && i % 2) continue; const sm = s0 + L * i / n, q = roadSample(c, sm), y = br.deckY(sm);
        const o = pierPiece(y, W); o.position.set(wd(q.x / S - br.x), y / S, wd(q.z / S - br.z)); o.rotation.y = Math.atan2(q.tx, q.tz);
        br.root.add(o); br.pieces.push({ o, kind: 'pier', sa: sm, sb: sm, hp: 300, alive: true, vel: new THREE.Vector3(), spin: new THREE.Vector3() }); }
      for (let q = a; q <= b; q++) c.br[q] = true;
      battleRoot.add(br.root); bridges.push(br); c.bridges = c.bridges || []; c.bridges.push(br); } } }
// deck height under a car at running distance s of chain c (or null when not on an intact bridge)
function bridgeY(c, s) { if (!c.bridges) return null; for (const br of c.bridges) if (s >= br.s0 - 1 && s <= br.s1 + 1) {
    const p = br.pieces.find(p => p.kind === 'deck' && s >= p.sa - 0.5 && s <= p.sb + 0.5); return p && p.alive ? br.deckY(s) : null; } return null; }
function breakPiece(br, p, dir) { if (!p.alive) return; p.alive = false; const wp = new THREE.Vector3(); p.o.getWorldPosition(wp);
  p.vel.set((dir ? dir.x : rand(-1, 1)) * 0.4, 0.25, (dir ? dir.z : rand(-1, 1)) * 0.4); p.spin.set(rand(-1.5, 1.5), rand(-0.6, 0.6), rand(-1.5, 1.5));
  FX.dust(new THREE.Vector3(br.x + p.o.position.x, p.o.position.y, br.z + p.o.position.z), 18, { size: [0.1, 0.5], life: [0.8, 1.6], vel: 0.6, up: 0.2, a: 0.5 });
  FX.sparks(new THREE.Vector3(br.x + p.o.position.x, p.o.position.y, br.z + p.o.position.z), 12, [1, 0.8, 0.5], 1.2);
  if (p.kind === 'deck' && !br.broken) { br.broken = true; for (let q = br.a; q <= br.b; q++) br.c.br[q] = false; log(null, 'A <b>bridge</b> has been destroyed'); }
  // a fallen pier drops the deck sections it carried
  if (p.kind === 'pier') for (const d of br.pieces) if (d.kind === 'deck' && d.alive && Math.abs((d.sa + d.sb) / 2 - p.sa) < BR_SEG * 1.2) d.hp -= 200; }
function bridgeImpact(pt, radius, power, kind) {
  for (const br of bridges) { if (wdist2(br.x, br.z, pt.x, pt.z) > (br.s1 - br.s0) / S / 2 + radius + 0.6) continue;
    for (const p of br.pieces) { if (!p.alive) continue; const px = br.x + p.o.position.x, pz = br.z + p.o.position.z, half = Math.max(0.3, (p.sb - p.sa) / S / 2 + 0.25);
      if (wdist2(px, pz, pt.x, pt.z) > half + radius) continue; if (pt.y > p.o.position.y + 0.35 || pt.y < p.o.position.y - (p.kind === 'pier' ? 3 : 0.6)) continue;
      p.hp -= kind === 'bullet' ? 3 : kind === 'step' ? 70 : kind === 'land' ? 220 : 90 * power; } }
  for (const br of bridges) for (const p of br.pieces) if (p.alive && p.hp <= 0) breakPiece(br, p, null); }
function updateBridges(dt) { const c = camD();
  for (const br of bridges) { br.root.position.set(disp(br.x, c.x) - br.x + br.x, 0, disp(br.z, c.z)); br.root.position.x = disp(br.x, c.x);
    for (const p of br.pieces) { if (p.alive) { if (p.hp <= 0) breakPiece(br, p, null); continue; } if (!p.o.visible) continue;
      p.vel.y -= 1.6 * dt; p.o.position.addScaledVector(p.vel, dt); p.o.rotation.x += p.spin.x * dt; p.o.rotation.z += p.spin.z * dt; p.vel.multiplyScalar(Math.pow(0.6, dt));
      if (p.o.position.y < -0.05 && !p.splashed) { p.splashed = true; p.vel.multiplyScalar(0.2); FX.dust(new THREE.Vector3(br.x + p.o.position.x, 0.02, br.z + p.o.position.z), 30, { size: [0.15, 0.7], life: [0.8, 1.8], vel: 0.9, up: 0.5, a: 0.55, col: [0.85, 0.9, 0.95] }); }
      if (p.o.position.y < -1.2) p.o.visible = false; } } }
function updateRoadTiles() { const cx = cam.x, cz = cam.z, far = FOG_FAR + 400;
  for (const m of roadTiles) { const s = m.geometry.boundingSphere; m.visible = Math.hypot(s.center.x + m.position.x - cx, s.center.z + m.position.z - cz) < far + s.radius; } }

// ------------------------------------------------------------------ traffic: cars drive the chains, turning at intersections
const cars = []; let carProto = null;
const CAR_LEN = 4.2, LANE = 1.35;
// the car model is a parts sheet: four vehicle bodies stacked in rows (top to bottom: sedan, SUV, pickup, box truck), each with its tire beside it.
// Split the single mesh into connected pieces (vertices welded by position), group the pieces into rows, and per row keep the body and its tire.
function splitVehicles(root) {
  let mesh = null; root.updateMatrixWorld(true); root.traverse(o => { if (o.isMesh && !mesh) mesh = o; }); if (!mesh) return [];
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld);
  const pos = g.attributes.position, nv = pos.count, nt = nv / 3;
  const par = new Int32Array(nv).map((_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; }, uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const key = new Map();
  for (let i = 0; i < nv; i++) { const k = Math.round(pos.getX(i) * 2e4) + ',' + Math.round(pos.getY(i) * 2e4) + ',' + Math.round(pos.getZ(i) * 2e4); const j = key.get(k); if (j === undefined) key.set(k, i); else uni(i, j); }
  for (let t = 0; t < nt; t++) { uni(t * 3, t * 3 + 1); uni(t * 3, t * 3 + 2); }
  const comps = new Map();
  for (let t = 0; t < nt; t++) { const r = find(t * 3); let c = comps.get(r); if (!c) comps.set(r, c = { tris: [], box: new THREE.Box3() });
    c.tris.push(t); for (let v = 0; v < 3; v++) c.box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, t * 3 + v)); }
  let parts = [...comps.values()].filter(c => { const sz = c.box.getSize(new THREE.Vector3()); return c.tris.length > 2 && sz.y > 1e-3 && !(sz.y < 0.015 && (sz.x > 0.15 || sz.z > 0.15)); });   // drop flat ground cards / shadow planes   // drop flat ground cards / specks
  const all = new THREE.Box3(); parts.forEach(c => all.union(c.box)); const splitX = all.min.x + (all.max.x - all.min.x) * 0.68;
  // rows: sort the body pieces by their vertical centre and cut where the biggest pieces change
  const big = parts.filter(c => c.box.getCenter(new THREE.Vector3()).x < splitX).sort((a, b) => b.tris.length - a.tris.length);
  const rowC = []; for (const c of big) { const y = (c.box.min.y + c.box.max.y) / 2, h = c.box.max.y - c.box.min.y; if (rowC.length < 4 && rowC.every(r => Math.abs(r - y) > h * 0.45)) rowC.push(y); }
  rowC.sort((a, b) => b - a);                                                          // top row first
  const rowOf = c => { const y = (c.box.min.y + c.box.max.y) / 2; let best = 0; rowC.forEach((r, i) => { if (Math.abs(r - y) < Math.abs(rowC[best] - y)) best = i; }); return best; };
  const build = tris => { const out = new THREE.BufferGeometry();
    for (const name in g.attributes) { const a = g.attributes[name], arr = new a.array.constructor(tris.length * 3 * a.itemSize);
      tris.forEach((t, i) => { for (let v = 0; v < 3; v++) for (let c = 0; c < a.itemSize; c++) arr[(i * 3 + v) * a.itemSize + c] = a.array[(t * 3 + v) * a.itemSize + c]; });
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized)); }
    out.computeBoundingBox(); return out; };
  return rowC.map((_, r) => {
    const rowP = parts.filter(c => rowOf(c) === r), bodyP = rowP.filter(c => c.box.getCenter(new THREE.Vector3()).x < splitX), tireP = rowP.filter(c => !bodyP.includes(c));
    const main = bodyP.reduce((m, c) => c.tris.length > m.tris.length ? c : m, bodyP[0]);   // keep only pieces beside the main body (strays from the sheet widen the box)
    const body = [], tire = []; for (const c of bodyP) if (c.box.max.z > main.box.min.z - 0.03 && c.box.min.z < main.box.max.z + 0.03) body.push(...c.tris);
    const tmain = tireP.reduce((m, c) => (!m || c.tris.length > m.tris.length) ? c : m, null); if (tmain) tire.push(...tmain.tris);
    const bg = build(body), bb = bg.boundingBox.clone(); bg.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); bg.computeBoundingBox();
    let tg = null, rad = 0; if (tire.length) { tg = build(tire); const tb = tg.boundingBox, want = (bb.max.y - bb.min.y) * (TIRE_D[r] || 0.38) / (tb.max.y - tb.min.y);   // the sheet draws tires enlarged
      tg.translate(-(tb.min.x + tb.max.x) / 2, -(tb.min.y + tb.max.y) / 2, -(tb.min.z + tb.max.z) / 2); tg.scale(want, want, want); tg.computeBoundingBox(); rad = (tg.boundingBox.max.y - tg.boundingBox.min.y) / 2; }
    // track width: body width at wheel height (mirrors and the box sides would push the wheels out)
    const bp = bg.attributes.position, hh = bb.max.y - bb.min.y; let zlo = 1e9, zhi = -1e9;
    for (let i = 0; i < bp.count; i++) if (bp.getY(i) < hh * 0.3) { zlo = Math.min(zlo, bp.getZ(i)); zhi = Math.max(zhi, bp.getZ(i)); }
    return { geo: bg, tire: tg, rad, mat: mesh.material, len: bb.max.x - bb.min.x, wid: zhi > zlo ? zhi - zlo : bb.max.z - bb.min.z };
  });
}
// axle positions along the body (fraction of length from the centre, nose at -x) per kind: sedan, SUV, pickup, box truck
const TIRE_D = [0.42, 0.4, 0.38, 0.3];   // tire diameter as a fraction of body height
const AXLES = [[-0.31, 0.3], [-0.31, 0.3], [-0.33, 0.29], [-0.31, 0.25]];
let vehicleKinds = null;
function spawnCars(count) {
  if (!ROAD_NET || !carProto) return; const { chains, nodes } = ROAD_NET;
  vehicleKinds = vehicleKinds || splitVehicles(carProto); if (!vehicleKinds.length) return;
  const k = CAR_LEN / vehicleKinds[0].len;                                           // one scale for all: the sedan is CAR_LEN long
  ROAD_NET.at = nodes.map(() => []); chains.forEach((c, i) => { ROAD_NET.at[c.a].push({ i, start: true }); ROAD_NET.at[c.b].push({ i, start: false }); });
  // which town each node belongs to, and the in-town chains that have kerbside parking
  nodes.forEach(n => { let b = 0, bd = 1e9; TOWNS.forEach((t, i) => { const d = wdist2(n.x, n.z, t.x, t.z); if (d < bd) { bd = d; b = i; } }); n.town = b; });
  ROAD_NET.park = TOWNS.map((_, ti) => chains.map((c, i) => ({ c, i })).filter(o => nodes[o.c.a].town === ti && nodes[o.c.b].town === ti && o.c.len < 60 && o.c.len > 20).map(o => o.i));
  const total = chains.reduce((a, c) => a + c.len, 0), weights = [0.4, 0.3, 0.2, 0.1];
  for (let n = 0; n < count; n++) {
    let r = Math.random() * total, ci = 0; while (r > chains[ci].len && ci < chains.length - 1) { r -= chains[ci].len; ci++; }
    const c = chains[ci]; if (roadSample(c, r).wet) { n--; continue; }
    let w = Math.random(), kind = 0; while (kind < vehicleKinds.length - 1 && w > weights[kind]) { w -= weights[kind]; kind++; }
    const V = vehicleKinds[kind], holder = new THREE.Group(), mdl = new THREE.Group(); mdl.scale.setScalar(k); holder.add(mdl);
    const bodyM = new THREE.Mesh(V.geo, V.mat); bodyM.castShadow = bodyM.receiveShadow = true; mdl.add(bodyM);
    const wheels = []; if (V.tire) { const tw = V.tire.boundingBox.max.z - V.tire.boundingBox.min.z;
      for (const ax of AXLES[kind] || AXLES[0]) for (const side of [-1, 1]) { const w = new THREE.Mesh(V.tire, V.mat); w.castShadow = true;
        w.position.set(ax * V.len, V.rad, side * (V.wid / 2 - tw / 2)); if (side < 0) w.rotation.y = Math.PI; mdl.add(w); wheels.push(w); } }
    scene.add(holder);
    const car = { c: ci, s: r, dir: Math.random() < 0.5 ? 1 : -1, v: 0, vmax: kind === 3 ? rand(3.5, 5) : rand(4.5, 6.5), len: V.len * k, obj: holder, wheels, rad: V.rad * k, yaw: null, lat: LANE, route: [], park: 0, target: null };
    if (Math.random() < 0.6) { const ti = Math.floor(Math.random() * TOWNS.length), pk = ROAD_NET.park[ti]; if (pk.length) { car.c = pk[Math.floor(Math.random() * pk.length)]; car.s = rand(6, chains[car.c].len - 6); car.park = rand(2, 40); car.lat = PARK_LAT; car.v = 0; } }
    cars.push(car); if (!car.park) planTrip(car);
  }
}
const PARK_LAT = 2.35;   // kerbside, just inside the edge line
// shortest route (Dijkstra over chains) from the car's position to a parking spot in its own or a linked town
function planTrip(car) {
  const { chains, nodes, at, park } = ROAD_NET, here = nodes[chains[car.c].a].town;
  const linked = [...new Set(chains.filter(c => nodes[c.a].town !== nodes[c.b].town).flatMap(c => nodes[c.a].town === here ? [nodes[c.b].town] : nodes[c.b].town === here ? [nodes[c.a].town] : []))];
  const ti = linked.length && Math.random() < 0.4 ? linked[Math.floor(Math.random() * linked.length)] : here, pk = park[ti];
  if (!pk.length) return; const goal = pk[Math.floor(Math.random() * pk.length)], gc = chains[goal];
  // start from the node the car is heading to
  const cur = chains[car.c], startNode = car.dir > 0 ? cur.b : cur.a, dist = new Map([[startNode, 0]]), prev = new Map(), todo = [startNode], done = new Set();
  while (todo.length) { todo.sort((x, y) => dist.get(x) - dist.get(y)); const n = todo.shift(); if (done.has(n)) continue; done.add(n);
    for (const o of at[n]) { const c = chains[o.i]; if (c.wet.some((w, k) => w && !(c.br && c.br[k]))) continue; const m = o.start ? c.b : c.a, d = dist.get(n) + c.len;
      if (!dist.has(m) || d < dist.get(m)) { dist.set(m, d); prev.set(m, { n, i: o.i, start: o.start }); todo.push(m); } } }
  // enter the goal chain from whichever end is closer
  const ends = [[gc.a, true], [gc.b, false]].filter(([n]) => dist.has(n) || n === startNode).sort((x, y) => (dist.get(x[0]) || 0) - (dist.get(y[0]) || 0));
  if (!ends.length || goal === car.c) { car.route = []; car.target = { c: goal, s: rand(6, gc.len - 6) }; return; }
  const [en, st] = ends[0], steps = []; let n = en; while (n !== startNode && prev.has(n)) { const p = prev.get(n); steps.unshift({ i: p.i, start: p.start }); n = p.n; }
  steps.push({ i: goal, start: st }); car.route = steps; car.target = { c: goal, s: rand(6, gc.len - 6) };
}
// ------------------------------------------------------------------ construction sites
// A new building stays hidden behind scaffold walls: the walls go up one by one around its footprint, then the top covers;
// when the build timer has run out and everything is up, the covers come off and the walls come down one by one, revealing it.
let scWallProto = null, scTopProto = null; const sites = [];
const SC_W = 2.4, SC_H = 2.2;   // model size of one wall panel / one cover tile
// the compressed models keep part of their scale on the node (quantization), so carry the node transform over
function scPiece(proto) { let m = null; proto.updateMatrixWorld(true); proto.traverse(o => { if (o.isMesh && !m) m = o; });
  const mesh = new THREE.Mesh(m.geometry, m.material); mesh.applyMatrix4(m.matrixWorld); mesh.castShadow = mesh.receiveShadow = true; const g = new THREE.Group(); g.add(mesh); return g; }
// b: the building ({x, z, y, rot, obj}); rect: [x0, x1, z0, z1] footprint in demo units around its origin (before rotation); h: its height
function startSite(b, rect, h, time, onDone) {
  b.obj.visible = false; b.done = false;
  if (!scWallProto || !scTopProto) { b.obj.visible = true; b.done = true; onDone(); return; }   // no scaffold models: build instantly
  const k = 0.22, P = SC_W * k, rows = Math.max(1, Math.ceil(h * 1.05 / (SC_H * k))), top = rows * SC_H * k,   // fixed panel size, stacked in rows to the full height
     [x0, x1, z0, z1] = rect.map((v, i) => v + (i % 2 ? 1 : -1) * 0.06);
  const g = new THREE.Group(); g.rotation.y = b.rot; battleRoot.add(g);
  const walls = [], covers = [];
  // perimeter, clockwise from the north-west corner; each panel's front faces out, its bracing faces in
  let y0 = 0; const side = (ax, az, bx, bz, ry) => { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / P)), sx = L / (n * SC_W * k);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, m = scPiece(scWallProto); m.scale.set(k * sx, k, k); m.position.set(ax + (bx - ax) * t, y0, az + (bz - az) * t);
      const pivot = new THREE.Group(); pivot.rotation.y = ry; pivot.position.copy(m.position); m.position.set(0, 0, 0); pivot.add(m); pivot.visible = false; g.add(pivot); walls.push({ o: pivot, m, y: y0, drop: SC_H * k * 0.8 }); } };
  for (let r = 0; r < rows; r++) { y0 = r * SC_H * k; side(x0, z1, x1, z1, 0); side(x1, z1, x1, z0, Math.PI / 2); side(x1, z0, x0, z0, Math.PI); side(x0, z0, x0, z1, -Math.PI / 2); }
  const nx = Math.max(1, Math.round((x1 - x0) / P)), nz = Math.max(1, Math.round((z1 - z0) / P)), cw = (x1 - x0) / nx, cd = (z1 - z0) / nz;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const m = scPiece(scTopProto); m.scale.set(cw / SC_W, k, cd / SC_W); m.position.set(x0 + (i + 0.5) * cw, top, z0 + (j + 0.5) * cd); m.visible = false; g.add(m); covers.push({ o: m, y: top }); }
  const N = walls.length + covers.length, step = Math.min(0.45, time * 0.7 / N);
  const s = { b, g, walls, covers, k, t: 0, time: Math.max(time, N * step + 0.6), step, phase: 'up', downT: 0, onDone }; b.site = s; sites.push(s); return s; }
const easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);
function sitePuff(s, lx, lz) { const c = Math.cos(s.b.rot), sn = Math.sin(s.b.rot), x = s.b.x + lx * c + lz * sn, z = s.b.z - lx * sn + lz * c; FX.dust(new THREE.Vector3(x, s.b.y + 0.02, z), 3, { size: [0.05, 0.25], life: [0.5, 1], vel: 0.3, up: 0.08, a: 0.35 }); }
function updateSites(dt) { const c = camD();
  for (let i = sites.length - 1; i >= 0; i--) { const s = sites[i], b = s.b; s.g.position.set(disp(b.x, c.x), b.y, disp(b.z, c.z)); s.t += dt;
    if (!b.alive) { battleRoot.remove(s.g); sites.splice(i, 1); continue; }
    if (s.phase === 'up') {
      // walls first, tipping up from flat on the ground; then the covers drop on top
      s.walls.forEach((w, j) => { const u = (s.t - j * s.step) / 0.5; if (u <= 0) return; const e = easeOut(Math.min(1, u)); if (!w.o.visible) { w.o.visible = true; if (!w.y) sitePuff(s, w.o.position.x, w.o.position.z); }
        if (w.y) w.o.position.y = w.y + (1 - e) * w.drop; else w.m.rotation.x = (1 - e) * Math.PI / 2; });   // ground row tips up, upper rows are lowered on top
      s.covers.forEach((cv, j) => { const u = (s.t - (s.walls.length + j) * s.step) / 0.4; if (u <= 0) return; cv.o.visible = true; cv.o.position.y = cv.y + (1 - easeOut(Math.min(1, u))) * 0.5 * s.k * SC_H; });
      if (s.t >= s.time) { s.phase = 'down'; s.downT = 0; b.obj.visible = true; b.done = true; s.onDone(); } }
    else {
      // covers lift off, then the walls tip back down and vanish, in reverse order
      s.downT += dt; const st = Math.min(0.25, s.step * 0.7), nc = s.covers.length;
      s.covers.forEach((cv, j) => { const u = (s.downT - j * st) / 0.4; if (u <= 0 || !cv.o.visible) return; cv.o.position.y = cv.y + easeOut(Math.min(1, u)) * 0.8 * s.k * SC_H; if (u >= 1) cv.o.visible = false; });
      s.walls.forEach((w, j) => { const u = (s.downT - (nc + s.walls.length - 1 - j) * st) / 0.45; if (u <= 0 || !w.o.visible) return; const e = easeOut(Math.min(1, u)); if (w.y) w.o.position.y = w.y + e * w.drop; else w.m.rotation.x = e * Math.PI / 2; if (u >= 1) { w.o.visible = false; if (!w.y) sitePuff(s, w.o.position.x, w.o.position.z); } });
      if (s.downT > (nc + s.walls.length) * st + 0.6) { battleRoot.remove(s.g); sites.splice(i, 1); b.site = null; } } } }
const siteLeft = b => b.site && b.site.phase === 'up' ? Math.max(0, b.site.time - b.site.t) : 0;
// ------------------------------------------------------------------ territory + outposts
// Territory = union of discs: each HQ town, plus every outpost. An outpost may only be built inside its team's territory,
// so building near the edge pushes the border out locally, while one in the middle adds nothing new.
let outpostProto = null, OUTPOST_ERR = null; const outposts = [], TERR_HQ_R = TOWN + 11, OUTPOST_R = 11 * Math.sqrt(3), OUTPOST_SENSE = 11, OUTPOST_W = 2.2, OUTPOST_COST = 600;
// irregular, state-like outlines: radius varies with angle (random harmonics), rescaled so every shape of a kind has the same area
function blobShape(seedN, R0) { const r = mulberry(seedN), H = []; for (let k = 2; k <= 9; k++) H.push([k, (0.42 / k) * (0.5 + r()), r() * 6.283]);
  const f = a => Math.max(0.45, 1 + H.reduce((s, [k, am, ph]) => s + am * Math.cos(k * a + ph), 0) + 0.03 * Math.sin(23 * a + H[0][2]));
  let I = 0; for (let i = 0; i < 720; i++) { const v = f(i / 720 * 6.283); I += v * v; } I *= 6.283 / 720;
  const k = R0 * Math.sqrt(6.283 / I), tab = new Float32Array(721); for (let i = 0; i <= 720; i++) tab[i] = f(i / 720 * 6.283) * k;
  const rad = a => { const u = ((a / 6.283) % 1 + 1) % 1 * 720, i = Math.floor(u); return tab[i] + (tab[i + 1] - tab[i]) * (u - i); };
  rad.max = Math.max(...tab); return rad; }
let HQ_SHAPES = null;
// each entry: [x, z, radiusFn]
const terrDiscs = team => { if (!HQ_SHAPES) HQ_SHAPES = [blobShape(seed ^ 0x7a11, TERR_HQ_R), blobShape(seed ^ 0x3c09, TERR_HQ_R)];
  const d = []; const t = towns[team]; if (t) d.push([t.x, t.z, HQ_SHAPES[team]]); for (const o of outposts) if (o.team === team && o.alive && o.done !== false) d.push([o.x, o.z, o.shape]); return d; };
const shapeR = (fn, cx, cz, x, z) => fn(Math.atan2(wd(z - cz), wd(x - cx)));
function inTerritory(team, x, z) { for (const [cx, cz, fn] of terrDiscs(team)) if (wdist2(cx, cz, x, z) < shapeR(fn, cx, cz, x, z)) return true; return false; }
const TERR_N = 512, terrData = new Uint8Array(TERR_N * TERR_N * 4), terrTex = new THREE.DataTexture(terrData, TERR_N, TERR_N, THREE.RGBAFormat);
terrTex.wrapS = terrTex.wrapT = THREE.RepeatWrapping; terrTex.magFilter = terrTex.minFilter = THREE.LinearFilter;
function rebuildTerritory() {   // r = player territory, g = enemy: 0.5 at the border, a signed distance ramp around it
  terrData.fill(0); const px = W / TERR_N;
  for (const team of [0, 1]) for (const [cx, cz, fn] of terrDiscs(team)) { const R = Math.ceil((fn.max + 3) / px), ci = Math.round(wm(cx) / px), cj = Math.round(wm(cz) / px);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const ox = i * px + ci * px - wm(cx), oz = j * px + cj * px - wm(cz), d = Math.hypot(ox, oz), v = clamp(0.5 + (fn(Math.atan2(oz, ox)) - d) / 6, 0, 1) * 255;
      const g = (mod(cj + j, TERR_N) * TERR_N + mod(ci + i, TERR_N)) * 4 + team; if (v > terrData[g]) terrData[g] = v; } }
  terrTex.needsUpdate = true; }
function canPlaceOutpost(team, xw, zw) { const x = wm(xw / S), z = wm(zw / S);
  if (!inTerritory(team, x, z)) return 'Outside your territory';
  for (const f of oilFields) if (wdist2(f.x, f.z, x, z) < OIL_R + OUTPOST_W * 0.5) return 'Oil fields are for oil pumps';
  if (Hd(x, z) < 2 / S * 1.2 || heightAt(xw, zw) < 2.5) return 'Cannot build on water';
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) if (roadAt((x + dx * OUTPOST_W / 2) * S, (z + dz * OUTPOST_W / 2) * S) > 0.5) return 'Blocked by a road';
  const e = OUTPOST_W / 2; let lo = 1e9, hi = -1e9; for (const [a, b] of [[-e, -e], [e, -e], [e, e], [-e, e], [0, 0]]) { const h = Hd(x + a, z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); } if (hi - lo > 0.9) return 'Ground too steep';
  for (const o of outposts) if (o.alive && wdist2(o.x, o.z, x, z) < OUTPOST_W * 1.6) return 'Too close to another outpost';
  for (const [a, b] of [[0, 0], [e, 0], [-e, 0], [0, e], [0, -e]]) for (const p of propsNear(x + a, z + b)) if (p.alive && wdist2(p.x, p.z, x, z) < p.r + e * 0.9) return 'Blocked by a building';
  return null; }
function makeOutpostModel(ghost) { const g = outpostProto.clone(true), box = new THREE.Box3().setFromObject(g), sz = box.getSize(new THREE.Vector3()), k = OUTPOST_W / Math.max(sz.x, sz.z);
  g.scale.setScalar(k); g.position.y = -box.min.y * k; const holder = new THREE.Group(); holder.add(g);
  g.traverse(o => { if (!o.isMesh) return; o.castShadow = !ghost; o.receiveShadow = !ghost; if (ghost) o.material = GHOST_MAT; }); return holder; }
const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.45, depthWrite: false });
function buildOutpost(team, xw, zw, rot = 0) { if (!outpostProto) return null; const x = wm(xw / S), z = wm(zw / S);
  const e = OUTPOST_W / 2; let lo = 0; for (const [a, b] of [[-e, -e], [e, -e], [e, e], [-e, e], [0, 0]]) lo += Hd(x + a, z + b) / 5;
  if (window.levelTerrain) { const c = Math.cos(rot), s2 = Math.sin(rot), blend = 1;
    levelTerrain(x * S, z * S, (e + 1.5) * S, (xw, zw) => { if (groundLocked(xw, zw, null)) return 0; const dx = wd(xw / S - x), dz = wd(zw / S - z), u = Math.abs(dx * c - dz * s2), v = Math.abs(dx * s2 + dz * c), d = Math.hypot(Math.max(u - e * 1.05, 0), Math.max(v - e * 1.05, 0));
      return d <= 0 ? 1 : d >= blend ? 0 : 1 - (d / blend) * (d / blend) * (3 - 2 * d / blend); }, lo * S); }
  const obj = makeOutpostModel(false); battleRoot.add(obj); obj.updateMatrixWorld(true);
  obj.rotation.y = rot; const o = { kind: 'outpost', team, x, z, y: lo, obj, rot, pad: e * 1.05, shape: blobShape((seed ^ 0x55) + outposts.length * 7919 + Math.round(x * 97), OUTPOST_R), hp: 600, maxHp: 600, alive: true, seen: new Set(), alertT: 0 }; outposts.push(o);
  { const bx = new THREE.Box3().setFromObject(obj.children[0]); const r = [bx.min.x, bx.max.x, bx.min.z, bx.max.z].map(v => v / S); o.rot = rot; startSite(o, r, (bx.max.y - bx.min.y) / S, 20, () => { rebuildTerritory(); if (team === 0) log(0, '<b>Outpost</b> online: territory extended, radar active'); }); } if (window.clearTreesIn) clearTreesIn((xw, zw) => wdist2(o.x, o.z, xw / S, zw / S) < OUTPOST_W * 0.8);
  FX.dust(new THREE.Vector3(x, lo, z), 24, { size: [0.1, 0.6], life: [0.8, 1.6], vel: 0.5, up: 0.15, a: 0.5 }); return o; }
function outpostAt(pos) { for (const o of outposts) if (o.alive && Math.abs(wd(pos.x - o.x)) < OUTPOST_W * 0.45 && Math.abs(wd(pos.z - o.z)) < OUTPOST_W * 0.45 && pos.y < o.y + 0.6) return o; return null; }
function outpostImpact(pt, radius, power, kind) { for (const o of outposts) { if (!o.alive || wdist2(o.x, o.z, pt.x, pt.z) > radius + OUTPOST_W * 0.5) continue;
  o.hp -= kind === 'bullet' ? 4 : kind === 'step' ? 0 : 60 * power; if (o.hp <= 0) destroyOutpost(o); } }
function destroyOutpost(o) { o.alive = false; const p = new THREE.Vector3(o.x, o.y + 0.2, o.z); FX.explosion(p, 1.3); addShake(0.3, p); scorchMarks.add(o.x, o.z, 0, 1.4, 1.4);
  o.obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiplyScalar(0.25); } }); o.obj.scale.y *= 0.35; fires.push({ x: o.x, z: o.z, t: 25 });
  rebuildTerritory(); if (o.team === 0 && window.onOutpostAlert) window.onOutpostAlert('OUTPOST DESTROYED', 'Radar coverage lost in that sector.'); }
// radar: each player outpost reports enemies newly entering its range; there are no alerts without outposts
function updateOutposts(dt) { const c = camD();
  for (const o of outposts) { o.obj.position.set(disp(o.x, c.x), o.y, disp(o.z, c.z)); if (!o.alive || o.team !== 0 || o.done === false) continue; o.alertT -= dt; const now = new Set();
    for (const e of [...robots.filter(r => r.team !== 0 && r.state !== 'ko'), ...helis.filter(h => h.team !== 0 && h.alive)]) if (wdist2(e.pos.x, e.pos.z, o.x, o.z) < OUTPOST_SENSE) now.add(e);
    const fresh = [...now].filter(e => !o.seen.has(e)); o.seen = now;
    if (fresh.length && o.alertT <= 0 && window.onOutpostAlert) { o.alertT = 15; const air = fresh.some(e => e.kind === 'heli');
      const dx = wd(fresh[0].pos.x - o.x), dz = wd(fresh[0].pos.z - o.z), dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north');
      window.onOutpostAlert(air ? 'ENEMY AIRCRAFT DETECTED' : 'ENEMY UNITS DETECTED', `${now.size} contact${now.size > 1 ? 's' : ''} near outpost, approaching from the ${dir}.`, { x: o.x * S, z: o.z * S }); } } }
// ------------------------------------------------------------------ air bases
// An air base holds 3 gunships on its landing pads. It builds them, researches upgrades for the whole team, and refuels and
// repairs any landed gunship. Gunships burn fuel in flight and fly home when low or badly hurt. Air bases can be attacked.
let airbaseProto = null, AIRBASE_ERR = null; const airbases = [];
const AB_K = 0.105, AB_COST = 1500, AB_HP = 2500, HELI_COST = 900, HELI_BUILD = 30, AB_CAP = 3;
const AB_PADS = [[2.3, 12], [2.3, 1], [2.3, -10]], AB_EXT = [-15, 18, -29, 29], AB_TALL = [[-13.8, -4, -11.4, 4.9, 0.62], [-13, -4.8, -21.7, -13.2, 0.5], [-10.7, -7.8, 11.6, 14.5, 0.75]];
const HELI_UP = [0, 1].map(() => ({ armor: 0, guns: 0, fuel: 0, engine: 0 })), research = [null, null];
const UPGRADES = {
  armor: { name: 'Armor plating', desc: '+25% gunship hull', cost: [600, 1000, 1600], time: [25, 35, 45] },
  guns: { name: 'Weapon systems', desc: '+20% cannon and missile damage', cost: [700, 1100, 1700], time: [25, 35, 45] },
  fuel: { name: 'Extended tanks', desc: '+35% flight time', cost: [400, 700, 1100], time: [20, 30, 40] },
  engine: { name: 'Turbine engines', desc: '+15% speed', cost: [500, 900, 1400], time: [20, 30, 40] } };
const heliMaxHp = team => HELI_HP * (1 + 0.25 * HELI_UP[team].armor), heliFuelMax = team => 160 * (1 + 0.35 * HELI_UP[team].fuel), heliDmg = h => 1 + 0.2 * HELI_UP[h.team].guns;
// local (model) coordinates -> demo world, for a base at (x, z) turned by rot
const abWorld = (b, lx, lz) => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return { x: wm(b.x + (lx * c + lz * s) * AB_K), z: wm(b.z + (-lx * s + lz * c) * AB_K) }; };
const abLocal = (b, x, z) => { const dx = wd(x - b.x) / AB_K, dz = wd(z - b.z) / AB_K, c = Math.cos(b.rot), s = Math.sin(b.rot); return { lx: dx * c - dz * s, lz: dx * s + dz * c }; };
function abSamples(b) { const out = []; for (let lx = AB_EXT[0]; lx <= AB_EXT[1] + 0.01; lx += (AB_EXT[1] - AB_EXT[0]) / 6) for (let lz = AB_EXT[2]; lz <= AB_EXT[3] + 0.01; lz += (AB_EXT[3] - AB_EXT[2]) / 10) out.push(abWorld(b, lx, lz)); return out; }
function canPlaceAirbase(team, xw, zw, rot = 0) { const b = { x: wm(xw / S), z: wm(zw / S), rot }, pts = abSamples(b);
  let lo = 1e9, hi = -1e9;
  for (const p of pts) { if (!inTerritory(team, p.x, p.z)) return 'Must fit inside your territory';
    const h = Hd(p.x, p.z); if (h < 2 / S * 1.2) return 'Cannot build on water'; lo = Math.min(lo, h); hi = Math.max(hi, h);
    if (roadAt(p.x * S, p.z * S) > 0.5) return 'Blocked by a road';
    for (const f of oilFields) if (wdist2(f.x, f.z, p.x, p.z) < OIL_R) return 'Oil fields are for oil pumps';
    for (const q of propsNear(p.x, p.z)) if (q.alive && wdist2(q.x, q.z, p.x, p.z) < q.r + 0.25) return 'Blocked by a building'; }
  if (hi - lo > 1.1) return 'Ground too uneven';
  const R = 3.4; for (const o of outposts) if (o.alive && wdist2(o.x, o.z, b.x, b.z) < R) return 'Too close to an outpost';
  for (const a of airbases) if (a.alive && wdist2(a.x, a.z, b.x, b.z) < R * 2) return 'Too close to another air base';
  return null; }
function makeAirbaseModel(ghost) { const g = airbaseProto.clone(true), box = new THREE.Box3().setFromObject(g);
  g.scale.setScalar(AB_K); g.position.y = -box.min.y * AB_K; const holder = new THREE.Group(); holder.add(g);
  g.traverse(o => { if (!o.isMesh) return; o.castShadow = !ghost; o.receiveShadow = true; if (ghost) o.material = GHOST_MAT; }); return holder; }
function buildAirbase(team, xw, zw, rot = 0) { if (!airbaseProto) return null; const b = { kind: 'airbase', team, x: wm(xw / S), z: wm(zw / S), rot };
  let lo = 1e9, sum = 0; const pts = abSamples(b); for (const p of pts) { const h = Hd(p.x, p.z); lo = Math.min(lo, h); sum += h; }
  b.y = Math.max(2 / S * 1.3, sum / pts.length);    // cut the high side and fill the low side to the base's floor
  if (window.levelTerrain) { const blend = 1.5; levelTerrain(b.x * S, b.z * S, 4.8 * S, (xw, zw) => { if (groundLocked(xw, zw, b)) return 0; const { lx, lz } = abLocal(b, xw / S, zw / S);
      const ox = Math.max(AB_EXT[0] - 1 - lx, lx - AB_EXT[1] - 1, 0) * AB_K, oz = Math.max(AB_EXT[2] - 1 - lz, lz - AB_EXT[3] - 1, 0) * AB_K, d = Math.hypot(ox, oz);
      return d <= 0 ? 1 : d >= blend ? 0 : 1 - (d / blend) * (d / blend) * (3 - 2 * d / blend); }, b.y * S); }
  b.obj = makeAirbaseModel(false); b.obj.rotation.y = rot; battleRoot.add(b.obj);
  const top = 0.6 * AB_K;
  Object.assign(b, { hp: AB_HP, maxHp: AB_HP, alive: true, vel: new THREE.Vector3(), queue: 0, buildT: 0,
    pos: new THREE.Vector3(b.x, b.y + 0.25, b.z), pads: AB_PADS.map(([lx, lz]) => ({ ...abWorld(b, lx, lz), y: b.y + top, heli: null })) });
  airbases.push(b); if (window.clearTreesIn) clearTreesIn((xw, zw) => inAirbaseLot(b, xw / S, zw / S)); FX.dust(new THREE.Vector3(b.x, b.y, b.z), 40, { size: [0.2, 1.2], life: [1, 2], vel: 1.2, up: 0.2, a: 0.5 });
  startSite(b, [AB_EXT[0] * AB_K, AB_EXT[1] * AB_K, AB_EXT[2] * AB_K, AB_EXT[3] * AB_K], 7.1 * AB_K, 45, () => log(team, `<b>${TEAM_NAME[team]}</b> air base complete`)); return b; }
// is a point inside a base's buildings (hangars, tower) or just over its pavement?
function airbaseAt(pos) { for (const b of airbases) { if (!b.alive || wdist2(b.x, b.z, pos.x, pos.z) > 3.6) continue; const { lx, lz } = abLocal(b, pos.x, pos.z);
    if (lx < AB_EXT[0] || lx > AB_EXT[1] || lz < AB_EXT[2] || lz > AB_EXT[3]) continue;
    if (pos.y < b.y + 0.06) return b; for (const [x0, x1, z0, z1, ht] of AB_TALL) if (lx > x0 && lx < x1 && lz > z0 && lz < z1 && pos.y < b.y + ht) return b; }
  return null; }
function airbaseHit(b, amount) { if (!b.alive) return; b.hp -= amount; if (b.team === 0 && window.onOutpostAlert && !(b.alertT > 0)) { b.alertT = 20; window.onOutpostAlert('AIR BASE UNDER ATTACK', 'Your air base is taking damage.', { x: b.x * S, z: b.z * S }); }
  if (b.hp <= 0) destroyAirbase(b); return 'hit'; }
function airbaseImpact(pt, radius, power, kind) { for (const b of airbases) { if (!b.alive || wdist2(b.x, b.z, pt.x, pt.z) > radius + 3.4) continue; if (!airbaseAt(pt) && !airbaseAt(new THREE.Vector3(pt.x, pt.y - radius, pt.z))) continue;
  airbaseHit(b, kind === 'bullet' ? 3 : kind === 'step' ? 0 : 50 * power); } }
function destroyAirbase(b) { b.alive = false; b.queue = 0;
  for (const [lx, lz] of [[-9, -3], [-9, -17], [-9, 13], [2, 1], [-4, 8]]) { const p = abWorld(b, lx, lz), v = new THREE.Vector3(p.x, b.y + 0.3, p.z); FX.explosion(v, 1.1); fires.push({ x: p.x, z: p.z, t: rand(18, 30) }); scorchMarks.add(p.x, p.z, 0, 1.2, 1.2); }
  addShake(0.45, b.pos);
  b.obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiplyScalar(0.22); } });
  b.obj.children[0].scale.y *= 0.4;
  for (const p of b.pads) { const h = p.heli; p.heli = null; if (!h) continue; h.home = null; if (h.alive && h.mode === 'landed') heliHit(h, 220, null); if (h.alive) h.mode = 'takeoff'; }
  log(b.team, `<b>${TEAM_NAME[b.team]}</b> air base destroyed`);
  if (b.team === 0 && window.onOutpostAlert) window.onOutpostAlert('AIR BASE DESTROYED', 'Its gunships have lost their home pads.', { x: b.x * S, z: b.z * S }); }
// ground already levelled for a standing building is locked: later levelling (and its blend) never moves it
function groundLocked(xw, zw, self) { const x = xw / S, z = wm(zw / S), xx = wm(x), m = 1.5 * SIZE / 512 / S;   // + a grid cell or so, so the pad's edge cells stay put
  for (const o of outposts) if (o !== self && o.alive && o.pad) { const dx = wd(xx - o.x), dz = wd(z - o.z), c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0); if (Math.abs(dx * c - dz * s) < o.pad + m && Math.abs(dx * s + dz * c) < o.pad + m) return true; }
  for (const b of airbases) if (b !== self && b.alive && wdist2(b.x, b.z, xx, z) < 4.5) { const { lx, lz } = abLocal(b, xx, z); const mm = 1 + m / AB_K; if (lx > AB_EXT[0] - mm && lx < AB_EXT[1] + mm && lz > AB_EXT[2] - mm && lz < AB_EXT[3] + mm) return true; }
  for (const p of pumpjacks) if (p !== self && p.alive && wdist2(p.x, p.z, xx, z) < 2) { if (inPumpLot(p, xx, z, 0.15 + m)) return true; }
  for (const p of camps) if (p !== self && p.alive && wdist2(p.x, p.z, xx, z) < 2.2) { if (inCampLot(p, xx, z, 0.15 + m)) return true; }
  for (const w of warehouses) if (w !== self && w.alive && wdist2(w.x, w.z, xx, z) < 4) { if (inWhLot(w, xx, z, 0.1 + m)) return true; }
  for (const h of hangars) if (h !== self && h.alive && wdist2(h.x, h.z, xx, z) < 4.5) { if (inHangarLot(h, xx, z, 0.1 + m)) return true; }
  for (const p of farms) if (p !== self && p.alive && wdist2(p.x, p.z, xx, z) < 2) { if (inFarmLot(p, xx, z, 0.1 + m)) return true; }
  for (const p of mines) if (p !== self && p.alive && wdist2(p.x, p.z, xx, z) < 3) { const { lx, lz } = mnLocal(p, xx, z); if (inRect(MN_YARD, lx, lz, 0.15 + m) || inRect(MN_TUN, lx, lz, 0.15 + m)) return true; }
  return false; }
function inAirbaseLot(b, x, z) { if (wdist2(b.x, b.z, x, z) > 4) return false; const { lx, lz } = abLocal(b, x, z); return lx > AB_EXT[0] - 3 && lx < AB_EXT[1] + 3 && lz > AB_EXT[2] - 3 && lz < AB_EXT[3] + 3; }
const baseHelis = b => b.pads.filter(p => p.heli && (p.heli.alive || p.heli.falling)).length;
function freePad(team, near) { let best = null, bd = 1e9;
  for (const b of airbases) if (b.alive && b.done && b.team === team) for (const p of b.pads) { if (p.heli && (p.heli.alive || p.heli.falling)) continue; p.heli = null; const d = near ? wdist2(near.x, near.z, p.x, p.z) : 0; if (d < bd) { bd = d; best = [b, p]; } }
  return best; }
const hqHome = [0, 1].map(team => ({ hq: true, rot: 0, get alive() { return !!towns[team] && !towns[team].hqDown; } }));
function assignHome(h) { const f = freePad(h.team, h.pos);
  if (f) { if (h.pad && h.pad.heli === h) h.pad.heli = null; h.home = f[0]; h.pad = f[1]; f[1].heli = h; return true; }
  if (h.home || !hqHome[h.team].alive) return false;
  // no free air base pad: set down on open ground beside the HQ (slower service, no limit)
  const t = towns[h.team], k = helis.filter(e => e.team === h.team && e.home && e.home.hq).length, x = wm(t.x + 1.5 + (k % 3) * 0.7), z = wm(t.z - 0.7 + Math.floor(k / 3) * 0.7);
  h.home = hqHome[h.team]; h.pad = { x, z, y: Hd(x, z), heli: h }; return true; }
function queueHeli(b) { if (!b.alive || baseHelis(b) + b.queue >= AB_CAP) return 'All 3 pads are taken'; b.queue++; if (b.queue === 1) b.buildT = 0; return null; }
function startResearch(team, key) { if (research[team]) return 'Already researching'; if (!airbases.some(b => b.alive && b.done && b.team === team)) return 'Needs a finished air base';
  const U = UPGRADES[key], lvl = HELI_UP[team][key]; if (lvl >= U.cost.length) return 'Fully upgraded'; research[team] = { key, t: 0, total: U.time[lvl] }; return null; }
function finishResearch(team, key) { HELI_UP[team][key]++;
  if (key === 'armor') for (const h of helis) if (h.team === team && h.alive) { const m = heliMaxHp(team); h.hp += m - h.maxHp; h.maxHp = m; }
  if (key === 'fuel') for (const h of helis) if (h.team === team && h.alive) { const m = heliFuelMax(team); h.fuel += m - h.fuelMax; h.fuelMax = m; }
  log(team, `<b>${TEAM_NAME[team]}</b> research complete: ${UPGRADES[key].name} ${['I', 'II', 'III'][HELI_UP[team][key] - 1]}`); }
function updateAirbases(dt) { const c = camD();
  for (const b of airbases) { b.obj.position.set(disp(b.x, c.x), b.y, disp(b.z, c.z)); b.alertT = (b.alertT || 0) - dt; if (!b.alive) continue;
    if (b.queue > 0 && b.done) { if (baseHelis(b) >= AB_CAP) b.queue = 0; else { b.buildT += dt; if (b.buildT >= HELI_BUILD) { b.buildT = 0; b.queue--; const p = b.pads.find(p => !p.heli || !(p.heli.alive || p.heli.falling));
          const h = makeHeli(b.team, p.x, p.z); h.home = b; h.pad = p; p.heli = h; h.mode = 'landed'; h.pos.set(p.x, p.y + h.skid, p.z); h.yaw = b.rot; h.rotor = 0; h.anchor = { x: p.x, z: p.z };
          log(b.team, `<b>${TEAM_NAME[b.team]}</b> new gunship ready on the pad`); } } }
    const sev = 1 - b.hp / b.maxHp; if (sev > 0.35 && chance(dt * 4 * sev)) { const p = abWorld(b, rand(-13, -5), rand(-20, 4)); FX.darkSmoke(new THREE.Vector3(p.x, b.y + 0.5, p.z), 1, 0.8 + sev); } }
  for (const team of [0, 1]) { const r = research[team]; if (!r) continue; if (!airbases.some(b => b.alive && b.team === team)) { research[team] = null; continue; }
    r.t += dt; if (r.t >= r.total) { research[team] = null; finishResearch(team, r.key); } } }
// gunship logistics: fuel, return to base, land, refuel/repair, take off again. Returns true when the heli is parked this frame.
function heliService(h, dt) {
  if (h.home && (!h.home.alive || h.pad.heli !== h)) h.home = null;
  if (!h.home || (h.home.hq && h.mode !== 'landed' && h.mode !== 'land')) assignHome(h);
  const P = h.home ? h.pad : null;
  if (h.mode === 'landed') {
    if (!P) { h.mode = 'takeoff'; return false; }
    h.pos.set(P.x, P.y + h.skid, P.z); h.vel.set(0, 0, 0); h.pitch *= 0.9; h.roll *= 0.9; h.rotor = Math.max(0.12, h.rotor - dt * 0.4);
    const k = h.home.hq ? 0.4 : 1; h.fuel = Math.min(h.fuelMax, h.fuel + h.fuelMax / 18 * k * dt); h.hp = Math.min(h.maxHp, h.hp + h.maxHp / 30 * k * dt);
    if (h.fuel >= h.fuelMax && h.hp >= h.maxHp && h.sortie) { h.mode = 'takeoff'; h.sortie = false; }
    return true; }
  h.rotor = Math.min(1, (h.rotor ?? 1) + dt * 0.6);
  if (h.mode !== 'takeoff') h.fuel -= dt;
  if (h.mode === 'takeoff') { const top = (P ? P.y : Hd(h.pos.x, h.pos.z)) + 1.3; h.goTo = { x: h.pos.x, z: h.pos.z, y: top }; if (h.pos.y > top - 0.15) { h.mode = 'fly'; h.goTo = null; } return false; }
  const low = h.fuel < h.fuelMax * 0.22 || h.hp < h.maxHp * 0.3;
  if (P && (h.mode === 'rtb' || h.mode === 'land' || (low && h.mode === 'fly'))) {
    if (h.mode === 'fly') { h.mode = 'rtb'; h.sortie = true; if (h.team === 0) log(0, `<b>${unitName(h)}</b> returning to base (${h.fuel < h.fuelMax * 0.22 ? 'low fuel' : 'damaged'})`); }
    const d = wdist2(h.pos.x, h.pos.z, P.x, P.z);
    if (h.mode === 'rtb') { h.goTo = { x: P.x, z: P.z, y: Math.max(Hd(h.pos.x, h.pos.z), P.y) + 1.35 }; if (d < 0.25) h.mode = 'land'; }
    if (h.mode === 'land') { h.goTo = { x: P.x, z: P.z, y: P.y + h.skid, land: true }; const dy = h.pos.y - (P.y + h.skid);
      if (!h.home.hq) { const a = Math.atan2(Math.sin(h.home.rot - h.yaw), Math.cos(h.home.rot - h.yaw)); h.yaw += clamp(a, -dt, dt); }
      if (d < 0.08 && dy < 0.03) { h.mode = 'landed'; h.goTo = null; FX.dust(new THREE.Vector3(P.x, P.y, P.z), 10, { size: [0.1, 0.5], life: [0.6, 1.2], vel: 0.8, up: 0.05, a: 0.4 }); } }
    return false; }
  h.goTo = null; if (h.mode !== 'fly') h.mode = 'fly';
  if (h.fuel <= 0) { h.fuel = 0; if (!h.dryT) { h.dryT = 1; if (h.team === 0) log(0, `<b>${unitName(h)}</b> is out of fuel and going down`); } heliHit(h, h.maxHp * 2, null); }
  else if (h.fuel < h.fuelMax * 0.12 && !P && h.team === 0 && !(h.fuelWarn > 0)) { h.fuelWarn = 30; log(0, `<b>${unitName(h)}</b> low on fuel, no free landing pad`); }
  h.fuelWarn = (h.fuelWarn || 0) - dt;
  return false; }
// ---- oil fields: dark oil seeps on the ground; an oil pump can only be built on one (one pump per field)
const oilFields = [], OIL_R = 0.8;   // about half the length of a field, demo units
// a field is sized to sit under the pump's pad and runs along it (the pump is turned to match), so a pump covers it
const oilSize = () => PJ_BOX ? [(PJ_BOX.z1 - PJ_BOX.z0) * 0.9, (PJ_BOX.x1 - PJ_BOX.x0) * 0.9] : [0.55, 1.5];
const pjCentre = () => PJ_BOX ? [(PJ_BOX.x0 + PJ_BOX.x1) / 2, (PJ_BOX.z0 + PJ_BOX.z1) / 2] : [0, 0];
const oilTex = (() => { const L = new THREE.TextureLoader(), col = L.load('assets/oil_col.png'), nrm = L.load('assets/oil_nrm.jpg'); col.encoding = THREE.sRGBEncoding; col.anisotropy = nrm.anisotropy = 4; return { col, nrm }; })();
const oilMat = new THREE.MeshStandardMaterial({ map: oilTex.col, normalMap: oilTex.nrm, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.12, metalness: 0.15, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
function oilFieldOk(x, z) { if (Hd(x, z) < 2 / S * 1.6) return false;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const px = wm(x + i * OIL_R * 0.5), pz = wm(z + j * OIL_R * 0.5); if (Hd(px, pz) < 2 / S * 1.3 || roadAt(px * S, pz * S) > 0.02) return false;
    for (const pr of propsNear(px, pz)) if (pr.alive && wdist2(pr.x, pr.z, px, pz) < pr.r + 0.3) return false; }
  let lo = 1e9, hi = -1e9; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) { const h = Hd(x + a * OIL_R * 0.6, z + b * OIL_R * 0.6); lo = Math.min(lo, h); hi = Math.max(hi, h); } if (hi - lo > 0.7) return false;
  for (const f of oilFields) if (wdist2(f.x, f.z, x, z) < 6) return false;
  for (const t of TOWNS) if (wdist2(t.x, t.z, x, z) < TOWN + 2.2) return false;
  return true; }
function oilGeo(f) { const [w, L] = oilSize(), g = new THREE.PlaneGeometry(w, L, 6, 16).rotateX(-Math.PI / 2).rotateY(f.rot + Math.PI / 2), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) P.setY(i, Hd(wm(f.x + P.getX(i)), wm(f.z + P.getZ(i))) + 0.012); g.computeVertexNormals(); return g; }
function placeOilFields() { const r = mulberry(seed ^ 0x0115);
  const add = (x, z) => { const f = { x: wm(x), z: wm(z), rot: r() * 6.283, pump: null }; f.mesh = new THREE.Mesh(oilGeo(f), oilMat); f.mesh.receiveShadow = true; f.mesh.renderOrder = 1; battleRoot.add(f.mesh); oilFields.push(f);
    if (window.clearTreesIn) clearTreesIn((xw, zw) => wdist2(f.x, f.z, xw / S, zw / S) < OIL_R * 1.1); };
  // one inside each HQ's starting territory, then more scattered over open country
  for (let team = 0; team < 2; team++) { const t = towns[team]; for (let k = 0; k < 400; k++) { const a = r() * 6.283, d = TOWN + 2.5 + r() * (TERR_HQ_R - TOWN - 5), x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      let inside = inTerritory(team, wm(x), wm(z)); for (let q = 0; q < 12 && inside; q++) inside = inTerritory(team, wm(x + Math.cos(q * 0.5236) * OIL_R * 1.4), wm(z + Math.sin(q * 0.5236) * OIL_R * 1.4));   // whole field well inside, so a pump fits
      if (inside && oilFieldOk(x, z)) { add(x, z); break; } } }
  for (let k = 0; k < 4000 && oilFields.length < 20; k++) { const x = r() * W, z = r() * W; if (oilFieldOk(x, z)) add(x, z); } }
function refreshOilNear(x, z, R) { for (const f of oilFields) if (wdist2(f.x, f.z, x, z) < R + OIL_R * 1.5) { f.mesh.geometry.dispose(); f.mesh.geometry = oilGeo(f); } }
const fieldAt = (x, z) => oilFields.find(f => wdist2(f.x, f.z, x, z) < OIL_R * 0.75) || null;
function updateOilFields() { const c = camD(); for (const f of oilFields) f.mesh.position.set(disp(f.x, c.x), 0, disp(f.z, c.z)); }
// ------------------------------------------------------------------ oil pumps
// A pump jack generates oil for its team while it stands. Built inside your territory like the other buildings.
let pumpProto = null, pumpClip = null, PUMP_ERR = null, PJ_BOX = null; const pumpjacks = [], OIL = [400, 400];
const PJ_K = 0.13, PJ_COST = 800, PJ_HP = 900, PJ_RATE = 60;   // demo units per model unit, credits, hull, oil per minute
function preparePump(g) { pumpProto = g.scene; pumpClip = g.animations && g.animations[0];
  // unnamed animated nodes are bound by uuid, which a clone does not keep: give them names the clones share
  if (pumpClip) for (const tr of pumpClip.tracks) { const dot = tr.name.lastIndexOf('.'), id = tr.name.slice(0, dot), o = pumpProto.getObjectByProperty('uuid', id);
    if (o) { if (!o.name) o.name = 'pj_' + id.slice(0, 8); tr.name = o.name + tr.name.slice(dot); } }
  pumpProto.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(pumpProto); PJ_BOX = { x0: bx.min.x * PJ_K, x1: bx.max.x * PJ_K, z0: bx.min.z * PJ_K, z1: bx.max.z * PJ_K, h: (bx.max.y - bx.min.y) * PJ_K, y0: bx.min.y * PJ_K }; }
const pjWorld = (p, lx, lz) => { const c = Math.cos(p.rot), s = Math.sin(p.rot); return { x: wm(p.x + lx * c + lz * s), z: wm(p.z - lx * s + lz * c) }; };
const pjLocal = (p, x, z) => { const dx = wd(x - p.x), dz = wd(z - p.z), c = Math.cos(p.rot), s = Math.sin(p.rot); return { lx: dx * c - dz * s, lz: dx * s + dz * c }; };
function inPumpLot(p, x, z, m) { const { lx, lz } = pjLocal(p, x, z); return lx > PJ_BOX.x0 - m && lx < PJ_BOX.x1 + m && lz > PJ_BOX.z0 - m && lz < PJ_BOX.z1 + m; }
function pumpOnField(f, rot) { rot = f.rot + (Math.cos(rot - f.rot) < 0 ? Math.PI : 0); const [cx, cz] = pjCentre(), c = Math.cos(rot), s = Math.sin(rot);
  return { x: wm(f.x - (cx * c + cz * s)), z: wm(f.z - (-cx * s + cz * c)), rot }; }
function canPlacePump(team, xw, zw, rot = 0) { if (!PJ_BOX) return 'Pump model still loading';
  const fld = fieldAt(wm(xw / S), wm(zw / S)); if (!fld) return 'Must be built on an oil field'; if (fld.pump && fld.pump.alive) return 'This oil field already has a pump';
  const p = pumpOnField(fld, rot); let lo = 1e9, hi = -1e9;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 3; j++) { const q = pjWorld(p, PJ_BOX.x0 + (PJ_BOX.x1 - PJ_BOX.x0) * i / 6, PJ_BOX.z0 + (PJ_BOX.z1 - PJ_BOX.z0) * j / 3);
    if (!inTerritory(team, q.x, q.z)) return 'Must fit inside your territory';
    const h = Hd(q.x, q.z); if (h < 2 / S * 1.2) return 'Cannot build on water'; lo = Math.min(lo, h); hi = Math.max(hi, h);
    if (roadAt(q.x * S, q.z * S) > 0.5) return 'Blocked by a road';
    if (groundLocked(q.x * S, q.z * S, null)) return 'Too close to another building';
    for (const pr of propsNear(q.x, q.z)) if (pr.alive && wdist2(pr.x, pr.z, q.x, q.z) < pr.r + 0.15) return 'Blocked by a building'; }
  if (hi - lo > 0.9) return 'Ground too uneven';
  return null; }
function makePumpModel(ghost) { const g = pumpProto.clone(true); g.scale.setScalar(PJ_K); g.position.y = -PJ_BOX.y0; const holder = new THREE.Group(); holder.add(g); if (!ghost) holder.add(footing(PJ_BOX, 0.03));
  g.traverse(o => { if (!o.isMesh) return; o.castShadow = !ghost; o.receiveShadow = true; if (ghost) o.material = GHOST_MAT; }); return holder; }
function buildPump(team, xw, zw, rot = 0) { if (!pumpProto) return null; const fld = fieldAt(wm(xw / S), wm(zw / S)); const p = { kind: 'pumpjack', team, ...(fld ? pumpOnField(fld, rot) : { x: wm(xw / S), z: wm(zw / S), rot }) }; rot = p.rot;
  let sum = 0, n = 0; for (let i = 0; i <= 6; i++) for (let j = 0; j <= 3; j++) { const q = pjWorld(p, PJ_BOX.x0 + (PJ_BOX.x1 - PJ_BOX.x0) * i / 6, PJ_BOX.z0 + (PJ_BOX.z1 - PJ_BOX.z0) * j / 3); sum += Hd(q.x, q.z); n++; }
  p.y = Math.max(2 / S * 1.3, sum / n);
  if (window.levelTerrain) { const blend = 1; levelTerrain(p.x * S, p.z * S, 2.5 * S, (xw, zw) => { if (groundLocked(xw, zw, null)) return 0; const { lx, lz } = pjLocal(p, xw / S, zw / S);
      const d = Math.hypot(Math.max(PJ_BOX.x0 - 0.1 - lx, lx - PJ_BOX.x1 - 0.1, 0), Math.max(PJ_BOX.z0 - 0.1 - lz, lz - PJ_BOX.z1 - 0.1, 0));
      return d <= 0 ? 1 : d >= blend ? 0 : 1 - (d / blend) * (d / blend) * (3 - 2 * d / blend); }, p.y * S); }
  refreshOilNear(p.x, p.z, 2.5); p.field = fld; if (fld) fld.pump = p;
  p.obj = makePumpModel(false); p.obj.rotation.y = rot; battleRoot.add(p.obj);
  p.mixer = pumpClip ? new THREE.AnimationMixer(p.obj.children[0]) : null; if (p.mixer) p.mixer.clipAction(pumpClip).play();
  Object.assign(p, { hp: PJ_HP, maxHp: PJ_HP, alive: true, vel: new THREE.Vector3(), pos: new THREE.Vector3(p.x, p.y + PJ_BOX.h * 0.3, p.z) });
  pumpjacks.push(p); if (window.clearTreesIn) clearTreesIn((xw, zw) => inPumpLot(p, xw / S, zw / S, 0.3));
  startSite(p, [PJ_BOX.x0, PJ_BOX.x1, PJ_BOX.z0, PJ_BOX.z1], PJ_BOX.h, 25, () => log(team, `<b>${TEAM_NAME[team]}</b> oil pump online`)); return p; }
function pumpAt(pos) { for (const p of pumpjacks) { if (!p.alive || wdist2(p.x, p.z, pos.x, pos.z) > 1.5) continue; if (inPumpLot(p, pos.x, pos.z, 0) && pos.y < p.y + PJ_BOX.h * 0.7) return p; } return null; }
function pumpHit(p, amount) { if (!p.alive) return; p.hp -= amount; if (p.team === 0 && window.onOutpostAlert && !(p.alertT > 0)) { p.alertT = 20; window.onOutpostAlert('OIL PUMP UNDER ATTACK', 'One of your oil pumps is taking damage.', { x: p.x * S, z: p.z * S }); }
  if (p.hp <= 0) destroyPump(p); return 'hit'; }
function pumpImpact(pt, radius, power, kind) { for (const p of pumpjacks) { if (!p.alive || wdist2(p.x, p.z, pt.x, pt.z) > radius + 1.2) continue; if (!pumpAt(pt) && !pumpAt(new THREE.Vector3(pt.x, pt.y - radius, pt.z))) continue;
  pumpHit(p, kind === 'bullet' ? 4 : kind === 'step' ? 0 : 60 * power); } }
function destroyPump(p) { p.alive = false; const v = new THREE.Vector3(p.x, p.y + 0.2, p.z); FX.explosion(v, 1.2); addShake(0.3, v); scorchMarks.add(p.x, p.z, 0, 1.2, 1.2); fires.push({ x: p.x, z: p.z, t: 40 });   // oil burns a long time
  p.obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiplyScalar(0.22); } }); p.obj.children[0].scale.y *= 0.5;
  log(p.team, `<b>${TEAM_NAME[p.team]}</b> oil pump destroyed`); }
function updatePumps(dt) { const c = camD();
  for (const p of pumpjacks) { p.obj.position.set(disp(p.x, c.x), p.y, disp(p.z, c.z)); p.alertT = (p.alertT || 0) - dt; if (!p.alive || !p.done) continue;
    OIL[p.team] += PJ_RATE / 60 * dt;
    if (p.mixer && Math.hypot(wd(p.x * S - cam.x), wd(p.z * S - cam.z)) < 900) p.mixer.update(dt); } }
const oilRate = team => pumpjacks.filter(p => p.team === team && p.alive && p.done).length * PJ_RATE;
// ------------------------------------------------------------------ woodcutter camps
// A camp fells the trees around it: each tree puts 2 logs on the rack, the saw turns logs into boards on the drying stacks,
// and when the stacks are full a pickup (the truck, later) clears them and the wood is banked. No trees left in reach = no more wood.
let woodProto = null, WOOD_ERR = null, WC_BOX = null; const camps = [], WOOD = [400, 400];
const WC_K = 0.07, WC_COST = 500, WC_HP = 700, WC_REACH = 3.2, WC_MIN_TREES = 6, WC_FELL = 7, WC_SAW = 5, WC_PICKUP = 6, BOARDS_PER_LOG = 10, WOOD_PER_BOARD = 1.5;   // a tree = 2 logs = 20 boards = 30 wood
function prepareWood(g) { woodProto = g.scene; woodProto.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(woodProto);
  WC_BOX = { x0: bx.min.x * WC_K, x1: bx.max.x * WC_K, z0: bx.min.z * WC_K, z1: bx.max.z * WC_K, h: bx.max.y * WC_K, y0: 0 };   /* the slab sits at model y = 0; a few parts dip below it in the bounds */ }
const wcLocal = (p, x, z) => { const dx = wd(x - p.x), dz = wd(z - p.z), c = Math.cos(p.rot), s = Math.sin(p.rot); return { lx: dx * c - dz * s, lz: dx * s + dz * c }; };
const wcWorld = (p, lx, lz) => { const c = Math.cos(p.rot), s = Math.sin(p.rot); return { x: wm(p.x + lx * c + lz * s), z: wm(p.z - lx * s + lz * c) }; };
function inCampLot(p, x, z, m) { const { lx, lz } = wcLocal(p, x, z); return lx > WC_BOX.x0 - m && lx < WC_BOX.x1 + m && lz > WC_BOX.z0 - m && lz < WC_BOX.z1 + m; }
// trees in reach that the camp can still fell (not under its own lot)
const campTrees = p => window.treesNear ? treesNear(p.x * S, p.z * S, WC_REACH * S).filter(t => !inCampLot(p, wm(t.x / S), wm(t.z / S), 0.15)) : [];
function canPlaceCamp(team, xw, zw, rot = 0) { if (!WC_BOX) return 'Camp model still loading'; const p = { x: wm(xw / S), z: wm(zw / S), rot }; let lo = 1e9, hi = -1e9;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const q = wcWorld(p, WC_BOX.x0 + (WC_BOX.x1 - WC_BOX.x0) * i / 4, WC_BOX.z0 + (WC_BOX.z1 - WC_BOX.z0) * j / 4);
    if (!inTerritory(team, q.x, q.z)) return 'Must fit inside your territory';
    const h = Hd(q.x, q.z); if (h < 2 / S * 1.2) return 'Cannot build on water'; lo = Math.min(lo, h); hi = Math.max(hi, h);
    if (roadAt(q.x * S, q.z * S) > 0.5) return 'Blocked by a road';
    if (groundLocked(q.x * S, q.z * S, null)) return 'Too close to another building';
    for (const f of oilFields) if (wdist2(f.x, f.z, q.x, q.z) < OIL_R) return 'Oil fields are for oil pumps';
    for (const pr of propsNear(q.x, q.z)) if (pr.alive && wdist2(pr.x, pr.z, q.x, q.z) < pr.r + 0.15) return 'Blocked by a building'; }
  if (hi - lo > 0.9) return 'Ground too uneven';
  const n = campTrees(p).length; if (n < WC_MIN_TREES) return `Needs trees nearby (${n} in reach, ${WC_MIN_TREES} needed)`;
  return null; }
const FOOTING_MAT = new THREE.MeshStandardMaterial({ color: 0x8b8680, roughness: 0.95 });
function footing(box, inset) { const m = new THREE.Mesh(new THREE.BoxGeometry(box.x1 - box.x0 - inset * 2, 1.2, box.z1 - box.z0 - inset * 2), FOOTING_MAT); m.position.set((box.x0 + box.x1) / 2, -0.6 - 0.01, (box.z0 + box.z1) / 2); m.receiveShadow = true; return m; }
function makeCampModel(ghost) { const g = woodProto.clone(true); g.scale.setScalar(WC_K); g.position.y = -WC_BOX.y0; const holder = new THREE.Group(); holder.add(g);
  g.traverse(o => { if (!o.isMesh) return; o.castShadow = !ghost; o.receiveShadow = true; if (ghost) o.material = GHOST_MAT; }); return holder; }
function buildCamp(team, xw, zw, rot = 0) { if (!woodProto) return null; const p = { kind: 'woodcutter', team, x: wm(xw / S), z: wm(zw / S), rot };
  let sum = 0, n = 0; for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const q = wcWorld(p, WC_BOX.x0 + (WC_BOX.x1 - WC_BOX.x0) * i / 4, WC_BOX.z0 + (WC_BOX.z1 - WC_BOX.z0) * j / 4); sum += Hd(q.x, q.z); n++; }
  p.y = Math.max(2 / S * 1.3, sum / n);
  if (window.levelTerrain) { const blend = 1; levelTerrain(p.x * S, p.z * S, 2.6 * S, (xw, zw) => { if (groundLocked(xw, zw, null)) return 0; const { lx, lz } = wcLocal(p, xw / S, zw / S);
      const d = Math.hypot(Math.max(WC_BOX.x0 - 0.1 - lx, lx - WC_BOX.x1 - 0.1, 0), Math.max(WC_BOX.z0 - 0.1 - lz, lz - WC_BOX.z1 - 0.1, 0));
      return d <= 0 ? 1 : d >= blend ? 0 : 1 - (d / blend) * (d / blend) * (3 - 2 * d / blend); }, p.y * S); refreshOilNear(p.x, p.z, 2.6); }
  p.obj = makeCampModel(false); p.obj.rotation.y = rot; battleRoot.add(p.obj);
  Object.assign(p, { hp: WC_HP, maxHp: WC_HP, alive: true, vel: new THREE.Vector3(), pos: new THREE.Vector3(p.x, p.y + WC_BOX.h * 0.3, p.z), fellT: WC_FELL, sawT: WC_SAW, pickT: 0, felled: 0, depleted: false, logs: 0, boards: 0 });
  // the model's own logs and boards become the stock display: logs fill the rack bottom-up, boards stack layer by layer
  const L = [], B = [], K = [];   // a piece may be a mesh or a group of meshes (multi-material): take the outermost named object
  const pick = o => { const n = o.name || ''; if (/^log_/.test(n)) L.push(o); else if (/^board_/.test(n)) B.push(o); else if (/^sticker_/.test(n)) K.push(o); else o.children.forEach(pick); }; pick(p.obj);
  const yOf = o => { const bx = new THREE.Box3().setFromObject(o); return [bx.min.y, (bx.min.z + bx.max.z) / 2, (bx.min.x + bx.max.x) / 2]; };
  const byPos = (a, c) => { const A = yOf(a), C = yOf(c); return Math.abs(A[0] - C[0]) > 1e-3 ? A[0] - C[0] : Math.abs(A[1] - C[1]) > 1e-3 ? A[1] - C[1] : A[2] - C[2]; };
  p.obj.updateMatrixWorld(true); L.sort(byPos); B.sort(byPos); K.sort(byPos); K.forEach(k => k.userData.y = yOf(k)[0]); B.forEach(k => k.userData.y = yOf(k)[0]);
  p.logMeshes = L; p.boardMeshes = B; p.stickers = K; p.logCap = L.length || 6; p.boardCap = B.length || 110; showStock(p);
  camps.push(p); if (window.clearTreesIn) clearTreesIn((xw, zw) => inCampLot(p, xw / S, zw / S, 0.15));
  startSite(p, [WC_BOX.x0, WC_BOX.x1, WC_BOX.z0, WC_BOX.z1], WC_BOX.h, 20, () => log(team, `<b>${TEAM_NAME[team]}</b> woodcutter camp open: ${campTrees(p).length} trees in reach`)); return p; }
function showStock(p) { p.logMeshes.forEach((m, i) => m.visible = i < p.logs); p.boardMeshes.forEach((m, i) => m.visible = i < p.boards);
  const top = p.boards ? p.boardMeshes[Math.min(p.boards, p.boardMeshes.length) - 1].userData.y : -1e9; p.stickers.forEach(k => k.visible = p.boards > 0 && k.userData.y < top + 1e-3); }
function campAt(pos) { for (const p of camps) { if (!p.alive || wdist2(p.x, p.z, pos.x, pos.z) > 1.6) continue; if (inCampLot(p, pos.x, pos.z, 0) && pos.y < p.y + WC_BOX.h * 0.6) return p; } return null; }
function campHit(p, amount) { if (!p.alive) return; p.hp -= amount; if (p.team === 0 && window.onOutpostAlert && !(p.alertT > 0)) { p.alertT = 20; window.onOutpostAlert('WOODCUTTER UNDER ATTACK', 'Your woodcutter camp is taking damage.', { x: p.x * S, z: p.z * S }); }
  if (p.hp <= 0) destroyCamp(p); return 'hit'; }
function campImpact(pt, radius, power, kind) { for (const p of camps) { if (!p.alive || wdist2(p.x, p.z, pt.x, pt.z) > radius + 1.3) continue; if (!campAt(pt) && !campAt(new THREE.Vector3(pt.x, pt.y - radius, pt.z))) continue;
  campHit(p, kind === 'bullet' ? 4 : kind === 'step' ? 0 : 60 * power); } }
function destroyCamp(p) { p.alive = false; const v = new THREE.Vector3(p.x, p.y + 0.2, p.z); FX.explosion(v, 1.1); addShake(0.25, v); scorchMarks.add(p.x, p.z, 0, 1.2, 1.2); fires.push({ x: p.x, z: p.z, t: 30 });   // timber burns
  p.obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiplyScalar(0.22); } }); p.obj.children[0].scale.y *= 0.45;
  log(p.team, `<b>${TEAM_NAME[p.team]}</b> woodcutter camp destroyed`); }
function updateCamps(dt) { const c = camD();
  for (const p of camps) { p.obj.position.set(disp(p.x, c.x), p.y, disp(p.z, c.z)); p.alertT = (p.alertT || 0) - dt; if (!p.alive || !p.done || p.depleted) continue;
    let changed = false;
    // 1) fell the nearest standing tree in reach when the rack has room for its 2 logs
    if (!p.noTrees && p.logs + 2 <= p.logCap) { p.fellT -= dt; if (p.fellT <= 0) { p.fellT = WC_FELL; const T = campTrees(p);
        if (!T.length) { p.noTrees = true; log(p.team, `<b>${TEAM_NAME[p.team]}</b> woodcutter camp has no trees left in reach`); }
        else { T.sort((a, c) => a.d - c.d); const t = T[0]; if (fellTree(t)) { p.logs += 2; p.felled++; changed = true;
            FX.dust(new THREE.Vector3(wm(t.x / S), t.y / S + 0.05, wm(t.z / S)), 14, { size: [0.08, 0.4], life: [0.8, 1.6], vel: 0.35, up: 0.12, a: 0.45, col: [0.55, 0.47, 0.36] }); } } } }
    // 2) the saw cuts a log into boards while the drying stacks have room
    if (p.logs > 0 && p.boards < p.boardCap && !p.pickT) { p.sawT -= dt; if (p.sawT <= 0) { p.sawT = WC_SAW; p.logs--; p.boards = Math.min(p.boardCap, p.boards + BOARDS_PER_LOG); changed = true;
        const sp = wcWorld(p, -1 * WC_K, 0.7 * WC_K); FX.dust(new THREE.Vector3(sp.x, p.y + 0.15, sp.z), 6, { size: [0.03, 0.12], life: [0.5, 1], vel: 0.15, up: 0.06, a: 0.5, col: [0.85, 0.72, 0.5] }); } }
    // 3) full stacks (or the last boards once the forest is gone) are picked up and banked
    const last = p.noTrees && !p.logs && p.boards > 0;
    if (hasWarehouse(p.team)) { if (!p.truck && (p.boards >= p.boardCap || last)) sendTruck(p, 'wood'); }
    else if (!p.pickT && (p.boards >= p.boardCap || last)) p.pickT = WC_PICKUP;
    if (p.pickT) { p.pickT -= dt; if (p.pickT <= 0) { p.pickT = 0; WOOD[p.team] += p.boards * WOOD_PER_BOARD; p.boards = 0; changed = true; } }
    if (changed) showStock(p);
    if (p.noTrees && !p.logs && !p.boards && !p.pickT && !p.truck) { p.depleted = true;
      if (p.team === 0 && window.onOutpostAlert) window.onOutpostAlert('WOODCUTTER DEPLETED', 'No trees left in reach. Build a new camp near a forest.', { x: p.x * S, z: p.z * S }); } } }
const woodRate = team => camps.filter(p => p.team === team && p.alive && p.done && !p.noTrees).length * BOARDS_PER_LOG * WOOD_PER_BOARD * 60 / Math.max(WC_SAW, WC_FELL / 2);   // the slower of felling and sawing sets the pace
// ------------------------------------------------------------------ mines
// Dug into a mountain side: ore rides the conveyor out of the tunnel into the hopper; a full hopper tips into the three storage
// bins; when all bins are full the pickup (the truck, later) empties them and the ore is banked.
let mineProto = null, MINE_ERR = null; const mines = [], ORE = [600, 600], MN_COST = 1200, MN_HP = 1600, MN_SLOPE = 0.55, MN_ORE_PER_LOAD = 300, MN_K = 0.07;
// model-space layout (units of the mine model): the yard that is levelled, and the tunnel that runs into the hill
const MN_YARD = [-4.6, 13.4, -12.9, 5.5], MN_TUN = [-15.2, -3.9, -14.8, -3.6], MN_UP = Math.atan2(-0.9, -0.43);   // MN_UP: direction of the tunnel, into the hill
const MN_EXT = MN_YARD.map(v => v * MN_K);
const BELT_A = new THREE.Vector3(-1.45, 1.32, -7.62), BELT_B = new THREE.Vector3(8.95, 4.3, -2.98);
// merge loose ore pieces into one mesh whose triangles run bottom-up, so a fill level is just a draw range
// packed (quantized) attribute -> plain floats
function floatAttr(a) { const A = a.array, k = !a.normalized ? 0 : A instanceof Int16Array ? 32767 : A instanceof Uint16Array ? 65535 : A instanceof Int8Array ? 127 : A instanceof Uint8Array ? 255 : 0, n = a.count * a.itemSize, out = new Float32Array(n);
  const stride = a.isInterleavedBufferAttribute ? a.data.stride : a.itemSize, off = a.isInterleavedBufferAttribute ? a.offset : 0, src = a.isInterleavedBufferAttribute ? a.data.array : A;
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) { const v = src[i * stride + off + c]; out[i * a.itemSize + c] = k ? Math.max(-1, v / k) : v; } return new THREE.BufferAttribute(out, a.itemSize); }
function mergeFill(root, re) { const pieces = []; root.traverse(o => { if (o.isMesh && re.test(o.name)) pieces.push(o); }); if (!pieces.length) return null;
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), names = ['position', 'normal', 'uv'].filter(n => pieces.every(p => p.geometry.attributes[n]));
  const items = pieces.map(p => { const src = p.geometry, g = new THREE.BufferGeometry(); for (const n of names) g.setAttribute(n, floatAttr(src.attributes[n])); if (src.index) g.setIndex(src.index.clone());
    const f = g.index ? g.toNonIndexed() : g; f.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, p.matrixWorld)); f.computeBoundingBox();
    return { g: f, y: f.boundingBox.min.y + (f.boundingBox.max.y - f.boundingBox.min.y) * 0.3 + Math.random() * 0.15 }; }).sort((x, y) => x.y - y.y);
  const out = new THREE.BufferGeometry(), cum = [0];
  for (const n of names) { const sz = items[0].g.attributes[n].itemSize, arr = new Float32Array(items.reduce((s, it) => s + it.g.attributes[n].count, 0) * sz); let o = 0; for (const it of items) { arr.set(it.g.attributes[n].array, o); o += it.g.attributes[n].array.length; } out.setAttribute(n, new THREE.BufferAttribute(arr, sz)); }
  for (const it of items) cum.push(cum[cum.length - 1] + it.g.attributes.position.count); out.computeBoundingSphere();
  const m = new THREE.Mesh(out, pieces[0].material); m.castShadow = m.receiveShadow = true; m.userData.cum = cum; pieces.forEach(p => p.parent.remove(p)); root.add(m); return m; }
function prepareMine(g) { const r = g.scene; mineProto = r; r.userData.hopper = mergeFill(r, /^hopper_ore/); r.userData.bins = [0, 1, 2].map(i => mergeFill(r, new RegExp('^bin_' + i + '_ore')));
  r.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) o.material.side = THREE.FrontSide; } }); }
const setFill = (m, f) => { const cum = m.userData.cum, k = Math.round(clamp(f, 0, 1) * (cum.length - 1)); m.geometry.setDrawRange(0, cum[k]); m.visible = k > 0; };
function makeMineModel(ghost) { const g = mineProto.clone(true); g.scale.setScalar(MN_K); const holder = new THREE.Group(); holder.add(g);
  if (ghost) g.traverse(o => { if (o.isMesh) { o.material = GHOST_MAT; o.castShadow = false; } });
  else { // own fill geometries (draw ranges are per geometry) and the belt ore list
    const fills = []; g.traverse(o => { if (o.isMesh && o.userData.cum) fills.push(o); }); fills.forEach(o => { o.geometry = o.geometry.clone(); });
    const byOrder = n => fills.find(o => o.geometry.attributes.position.count === n); holder.userData.hopper = fills[0]; holder.userData.bins = fills.slice(1);
    const belt = []; g.traverse(o => { if (o.isMesh && /^conveyor_ore/.test(o.name)) belt.push(o); });
    const ax = BELT_B.clone().sub(BELT_A), L2 = ax.lengthSq();
    holder.userData.belt = belt.map(o => { const p = o.position.clone(), t = p.clone().sub(BELT_A).dot(ax) / L2; return { o, t, off: p.clone().sub(BELT_A.clone().addScaledVector(ax, t)) }; }); }
  return holder; }
const mnLocal = (p, x, z) => { const dx = wd(x - p.x), dz = wd(z - p.z), c = Math.cos(p.rot), s = Math.sin(p.rot); return { lx: dx * c - dz * s, lz: dx * s + dz * c }; };
const mnWorld = (p, lx, lz) => { const c = Math.cos(p.rot), s = Math.sin(p.rot); return { x: wm(p.x + lx * c + lz * s), z: wm(p.z - lx * s + lz * c) }; };
const inRect = (r, lx, lz, m = 0) => lx > r[0] * MN_K - m && lx < r[1] * MN_K + m && lz > r[2] * MN_K - m && lz < r[3] * MN_K + m;
// facing: turn the model so its tunnel points up the slope
function mineFacing(x, z) { const e = 0.6, gx = Hd(x + e, z) - Hd(x - e, z), gz = Hd(x, z + e) - Hd(x, z - e); return Math.atan2(gx, gz) - MN_UP; }
function canPlaceMine(team, xw, zw, rot) { if (!mineProto) return 'Mine model still loading'; const p = { x: wm(xw / S), z: wm(zw / S), rot };
  for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) { const q = mnWorld(p, (MN_YARD[0] + (MN_YARD[1] - MN_YARD[0]) * i / 5) * MN_K, (MN_YARD[2] + (MN_YARD[3] - MN_YARD[2]) * j / 5) * MN_K);
    if (!inTerritory(team, q.x, q.z)) return 'Must fit inside your territory';
    if (Hd(q.x, q.z) < 2 / S * 1.2) return 'Cannot build on water';
    if (roadAt(q.x * S, q.z * S) > 0.5) return 'Blocked by a road';
    if (groundLocked(q.x * S, q.z * S, null)) return 'Too close to another building';
    for (const f of oilFields) if (wdist2(f.x, f.z, q.x, q.z) < OIL_R) return 'Oil fields are for oil pumps';
    for (const pr of propsNear(q.x, q.z)) if (pr.alive && wdist2(pr.x, pr.z, q.x, q.z) < pr.r + 0.15) return 'Blocked by a building'; }
  const back = mnWorld(p, -13 * MN_K, -12 * MN_K), front = mnWorld(p, 6 * MN_K, 3 * MN_K);
  if (Hd(back.x, back.z) - Hd(front.x, front.z) < MN_SLOPE) return 'Must be built into a mountain side';
  return null; }
const smoothW = (d, blend) => d <= 0 ? 1 : d >= blend ? 0 : 1 - (d / blend) * (d / blend) * (3 - 2 * d / blend);
function buildMine(team, xw, zw, rot) { if (!mineProto) return null; const p = { kind: 'mine', team, x: wm(xw / S), z: wm(zw / S), rot };
  let sum = 0, n = 0; for (let i = 0; i <= 5; i++) { const q = mnWorld(p, (MN_YARD[0] + (MN_YARD[1] - MN_YARD[0]) * i / 5) * MN_K, 3 * MN_K); sum += Hd(q.x, q.z); n++; }
  p.y = Math.max(2 / S * 1.3, sum / n);
  if (window.levelTerrain) {
    // the yard is cut flat into the slope; the hill over the tunnel is built up so the tunnel really runs into rock
    levelTerrain(p.x * S, p.z * S, 3.6 * S, (xw, zw) => { if (groundLocked(xw, zw, null)) return 0; const { lx, lz } = mnLocal(p, xw / S, zw / S); if (inRect(MN_TUN, lx, lz)) return 0;
      const d = Math.hypot(Math.max(MN_YARD[0] * MN_K - lx, lx - MN_YARD[1] * MN_K, 0), Math.max(MN_YARD[2] * MN_K - lz, lz - MN_YARD[3] * MN_K, 0)); return smoothW(d, 0.8); }, p.y * S);
    const top = p.y + 5 * MN_K; levelTerrain(p.x * S, p.z * S, 3.6 * S, (xw, zw) => { const { lx, lz } = mnLocal(p, xw / S, zw / S); if (heightAt(xw, zw) / S >= top) return 0;
      const d = Math.hypot(Math.max(MN_TUN[0] * MN_K - lx, lx - (MN_TUN[1] - 0.3) * MN_K, 0), Math.max(MN_TUN[2] * MN_K - lz, lz - MN_TUN[3] * MN_K, 0)); return lx > (MN_TUN[1] - 0.3) * MN_K ? 0 : smoothW(d, 0.6); }, top * S);
    refreshOilNear(p.x, p.z, 3.6); }
  p.obj = makeMineModel(false); p.obj.rotation.y = rot; battleRoot.add(p.obj); const U = p.obj.userData;
  Object.assign(p, { hp: MN_HP, maxHp: MN_HP, alive: true, vel: new THREE.Vector3(), pos: new THREE.Vector3(p.x, p.y + 0.3, p.z), hopper: 0, bins: [0, 0, 0], dumpT: 0, pickT: 0, fillH: U.hopper, fillB: U.bins, belt: U.belt });
  mines.push(p); if (window.clearTreesIn) clearTreesIn((xw, zw) => { const { lx, lz } = mnLocal(p, xw / S, zw / S); return inRect(MN_YARD, lx, lz, 0.2) || inRect(MN_TUN, lx, lz, 0.1); });
  showMineStock(p); startSite(p, [MN_EXT[0], MN_EXT[1], MN_EXT[2], MN_EXT[3]], 5.8 * MN_K, 35, () => log(team, `<b>${TEAM_NAME[team]}</b> mine open`)); return p; }
function showMineStock(p) { if (p.fillH) setFill(p.fillH, p.hopper); p.bins.forEach((f, i) => { if (p.fillB[i]) setFill(p.fillB[i], f); }); }
function mineAt(pos) { for (const p of mines) { if (!p.alive || wdist2(p.x, p.z, pos.x, pos.z) > 2.6) continue; const { lx, lz } = mnLocal(p, pos.x, pos.z);
    if (inRect(MN_YARD, lx, lz) && pos.y < p.y + 0.7) return p; } return null; }
function mineHit(p, amount) { if (!p.alive) return; p.hp -= amount; if (p.team === 0 && window.onOutpostAlert && !(p.alertT > 0)) { p.alertT = 20; window.onOutpostAlert('MINE UNDER ATTACK', 'Your mine is taking damage.', { x: p.x * S, z: p.z * S }); }
  if (p.hp <= 0) { p.alive = false; const v = new THREE.Vector3(p.x, p.y + 0.3, p.z); FX.explosion(v, 1.3); addShake(0.3, v); scorchMarks.add(p.x, p.z, 0, 1.5, 1.5); fires.push({ x: p.x, z: p.z, t: 25 });
    p.obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiplyScalar(0.25); } }); p.obj.children[0].scale.y *= 0.5; log(p.team, `<b>${TEAM_NAME[p.team]}</b> mine destroyed`); } return 'hit'; }
function mineImpact(pt, radius, power, kind) { for (const p of mines) { if (!p.alive || wdist2(p.x, p.z, pt.x, pt.z) > radius + 2.4) continue; if (!mineAt(pt) && !mineAt(new THREE.Vector3(pt.x, pt.y - radius, pt.z))) continue;
  mineHit(p, kind === 'bullet' ? 4 : kind === 'step' ? 0 : 60 * power); } }
const MN_BELT_T = 9, MN_LOAD = 46 * 2;   // seconds for ore to ride the belt; chunks per full hopper
function updateMines(dt) { const c = camD(), ax = BELT_B.clone().sub(BELT_A);
  for (const p of mines) { p.obj.position.set(disp(p.x, c.x), p.y, disp(p.z, c.z)); p.alertT = (p.alertT || 0) - dt; if (!p.alive || !p.done) continue;
    const full = p.bins.every(f => f >= 1), running = !full && p.hopper < 1; let changed = false;
    // the belt carries its ore up to the hopper; each chunk that drops off the head pulley adds to the hopper and a new one comes out of the tunnel
    if (running) for (const b of p.belt) { b.t += dt / MN_BELT_T; if (b.t > 1.02) { b.t -= 1.04; p.hopper = Math.min(1, p.hopper + 1 / MN_LOAD); changed = true; }
      b.o.visible = b.t > -0.02 && b.t < 1.0; b.o.position.copy(BELT_A).addScaledVector(ax, clamp(b.t, 0, 1)).add(b.off); b.o.rotation.x += dt * 0.5; }
    // a full hopper tips into the first storage bin with room
    if (p.hopper >= 1 && !p.dumpT) p.dumpT = 1;
    if (p.dumpT) { const i = p.bins.findIndex(f => f < 1); if (i < 0) p.dumpT = 0; else { const k = Math.min(dt / 4, p.hopper); p.hopper -= k; p.bins[i] = Math.min(1, p.bins[i] + k / 1); changed = true; if (p.hopper <= 0) { p.hopper = 0; p.dumpT = 0; } } }
    // all three full: picked up (the truck, later) and banked
    if (full && hasWarehouse(p.team)) { if (!p.truck) sendTruck(p, 'ore'); }
    else if (full) { p.pickT = (p.pickT || 8) - dt; if (p.pickT <= 0) { p.pickT = 0; p.bins = [0, 0, 0]; ORE[p.team] += MN_ORE_PER_LOAD; changed = true; } }
    if (changed) showMineStock(p); } }
const oreRate = team => mines.filter(p => p.team === team && p.alive && p.done).length * Math.round(MN_ORE_PER_LOAD / ((3 * (MN_LOAD * MN_BELT_T / 46 + 4) + 8) / 60));
// ------------------------------------------------------------------ farms
// One crop per farm (picked at random for now), planted in all four plots. Crops grow out of the ground, are harvested
// when ripe for food, and are replanted.
let farmProto = null, FARM_ERR = null; const farms = [], FOOD = [300, 300], FM_K = 0.25, FM_COST = 400, FM_HP = 500, FM_GROW = 90, FM_HARVEST = 120;
const FM_HALF = 3.4, CROPS = ['Wheat', 'Cabbage', 'Lettuce', 'Carrot'], PLOTS = [[-1.58, 1.58], [1.58, 1.58], [-1.58, -1.58], [1.58, -1.58]];
const soilMat = (() => { const L = new THREE.TextureLoader(), map = L.load('assets/farm_soil.jpg'), h = L.load('assets/farm_soil_h.jpg'); map.encoding = THREE.sRGBEncoding;
  for (const t of [map, h]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return new THREE.MeshStandardMaterial({ map, bumpMap: h, bumpScale: 1.2, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }); })();
function prepareFarm(g) { farmProto = g.scene; farmProto.updateMatrixWorld(true); const drop = [];
  farmProto.traverse(o => { if (!o.isMesh) return; o.castShadow = o.receiveShadow = true; if (/^Farm_(Soil_Surface|Earth_Base)/.test(o.name)) drop.push(o); }); drop.forEach(o => o.parent.remove(o)); }
// the field's soil: a patch laid on the terrain itself (follows the ground), textured with the farm dirt
// the field's soil: a patch laid on the terrain itself (follows the ground), textured with the farm dirt. Its edge is
// ragged and soft: the plots are fully covered, beyond them the soil frays out into the surrounding ground.
const soilFadeMat = (() => { const m = soilMat.clone(); m.transparent = true; m.depthWrite = false;
  m.onBeforeCompile = sh => { sh.vertexShader = 'attribute float aMask;\nvarying float vMask;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = aMask;');
    sh.fragmentShader = 'varying float vMask;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vMask;'); };
  m.customProgramCacheKey = () => 'soilfade'; return m; })();
function soilPatch(p) { const in0 = FM_HALF * FM_K, e = in0 * 1.3, n = 48, geo = new THREE.PlaneGeometry(2 * e, 2 * e, n, n).rotateX(-Math.PI / 2), P = geo.attributes.position, uv = geo.attributes.uv, TILE = 0.65;
  const r = mulberry(Math.round(p.x * 997 + p.z * 131)), H = [...Array(7)].map((_, k) => [k + 2, (0.5 + r()) / (k + 2), r() * 6.283]), mask = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) { const lx = P.getX(i), lz = P.getZ(i), w = fmWorld(p, lx, lz); P.setY(i, Hd(w.x, w.z) - p.y + 0.004); uv.setXY(i, (lx + e) / TILE, (lz + e) / TILE);
    const u = lx / in0, v = lz / in0, ang = Math.atan2(v, u), d = Math.pow(Math.pow(Math.abs(u), 5) + Math.pow(Math.abs(v), 5), 1 / 5);
    const edge = 1.04 + 0.2 * (0.5 + 0.5 * H.reduce((s, [k, am, ph]) => s + am * Math.sin(k * ang + ph), 0)) + (r() - 0.5) * 0.05; mask[i] = clamp((edge - d) / 0.09, 0, 1); }
  geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 1)); geo.computeVertexNormals(); const m = new THREE.Mesh(geo, soilFadeMat); m.receiveShadow = true; m.renderOrder = 1; return m; }
const fmLocal = (p, x, z) => { const dx = wd(x - p.x), dz = wd(z - p.z), c = Math.cos(p.rot), s = Math.sin(p.rot); return { lx: dx * c - dz * s, lz: dx * s + dz * c }; };
const fmWorld = (p, lx, lz) => { const c = Math.cos(p.rot), s = Math.sin(p.rot); return { x: wm(p.x + lx * c + lz * s), z: wm(p.z - lx * s + lz * c) }; };
const inFarmLot = (p, x, z, m) => { const { lx, lz } = fmLocal(p, x, z), e = FM_HALF * FM_K + m; return Math.abs(lx) < e && Math.abs(lz) < e; };
function canPlaceFarm(team, xw, zw, rot = 0) { if (!farmProto) return 'Farm model still loading'; const p = { x: wm(xw / S), z: wm(zw / S), rot }, e = FM_HALF * FM_K; let lo = 1e9, hi = -1e9;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const q = fmWorld(p, -e + 2 * e * i / 4, -e + 2 * e * j / 4);
    if (!inTerritory(team, q.x, q.z)) return 'Must fit inside your territory';
    const h = Hd(q.x, q.z); if (h < 2 / S * 1.2) return 'Cannot build on water'; lo = Math.min(lo, h); hi = Math.max(hi, h);
    if (roadAt(q.x * S, q.z * S) > 0.5) return 'Blocked by a road';
    if (groundLocked(q.x * S, q.z * S, null)) return 'Too close to another building';
    for (const f of oilFields) if (wdist2(f.x, f.z, q.x, q.z) < OIL_R) return 'Oil fields are for oil pumps';
    for (const pr of propsNear(q.x, q.z)) if (pr.alive && wdist2(pr.x, pr.z, q.x, q.z) < pr.r + 0.15) return 'Blocked by a building'; }
  if (hi - lo > 0.8) return 'Ground too uneven'; return null; }
function makeFarmModel(ghost, crop) { const g = farmProto.clone(true); g.scale.setScalar(FM_K); const holder = new THREE.Group(); holder.add(g); const crops = [];
  const keep = g.getObjectByName('Crop_' + crop); CROPS.forEach(c => { const o = g.getObjectByName('Crop_' + c); if (o && o !== keep) o.parent.remove(o); });
  if (keep) { const [ox, oz] = PLOTS[CROPS.indexOf(crop)], base = keep.position.clone();   // the crop's own plot; copies are offset from it
    for (const [px, pz] of PLOTS) { const o = px === ox && pz === oz ? keep : keep.clone(); o.position.set(base.x + px - ox, base.y, base.z + pz - oz);
      if (o !== keep) keep.parent.add(o); if (o.morphTargetInfluences) o.morphTargetInfluences = o.morphTargetInfluences.slice(); crops.push(o); } }
  if (ghost) { const gm = GHOST_MAT.clone(); gm.morphTargets = true; gm.color = GHOST_MAT.color;   // same colour object: turns red/green with the placement check
    g.traverse(o => { if (o.isMesh) { o.material = gm; o.castShadow = false; if (o.morphTargetInfluences) o.morphTargetInfluences[0] = 1; } }); }
  holder.userData.crops = crops; return holder; }
function buildFarm(team, xw, zw, rot = 0, crop) { if (!farmProto) return null; crop = crop || CROPS[Math.floor(Math.random() * 4)]; const p = { kind: 'farm', team, x: wm(xw / S), z: wm(zw / S), rot, crop }, e = FM_HALF * FM_K;
  let sum = 0, n = 0; for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const q = fmWorld(p, -e + 2 * e * i / 4, -e + 2 * e * j / 4); sum += Hd(q.x, q.z); n++; }
  p.y = Math.max(2 / S * 1.3, sum / n);
  if (window.levelTerrain) { levelTerrain(p.x * S, p.z * S, 2.4 * S, (xw, zw) => { if (groundLocked(xw, zw, null)) return 0; const { lx, lz } = fmLocal(p, xw / S, zw / S);
      const d = Math.hypot(Math.max(Math.abs(lx) - e - 0.05, 0), Math.max(Math.abs(lz) - e - 0.05, 0)); return smoothW(d, 0.8); }, p.y * S); refreshOilNear(p.x, p.z, 2.4); }
  p.obj = makeFarmModel(false, crop); p.obj.rotation.y = rot; battleRoot.add(p.obj); p.obj.children[0].position.y = -0.25 * FM_K; p.obj.add(soilPatch(p));   // plants grow straight out of the ground
  Object.assign(p, { hp: FM_HP, maxHp: FM_HP, alive: true, vel: new THREE.Vector3(), pos: new THREE.Vector3(p.x, p.y + 0.1, p.z), crops: p.obj.userData.crops, grow: 0, ripeT: 0 });
  setGrowth(p); farms.push(p); if (window.clearTreesIn) clearTreesIn((xw, zw) => inFarmLot(p, xw / S, zw / S, 0.15));
  p.done = true; log(team, `<b>${TEAM_NAME[team]}</b> ${crop.toLowerCase()} farm planted`); return p; }   // fields need no construction
function setGrowth(p) { const g = p.grow, ease = g * g * (3 - 2 * g); for (const o of p.crops) { if (o.morphTargetInfluences) o.morphTargetInfluences[0] = ease; o.visible = g > 0.005; } }
function farmAt(pos) { for (const p of farms) if (p.alive && wdist2(p.x, p.z, pos.x, pos.z) < 1.8 && inFarmLot(p, pos.x, pos.z, 0) && pos.y < p.y + 0.15) return p; return null; }
function farmHit(p, amount) { if (!p.alive) return; p.hp -= amount; if (p.hp <= 0) { p.alive = false; scorchMarks.add(p.x, p.z, 0, 1.4, 1.4); fires.push({ x: p.x, z: p.z, t: 15 }); p.grow = 0; setGrowth(p); log(p.team, `<b>${TEAM_NAME[p.team]}</b> farm destroyed`); } return 'hit'; }
function farmImpact(pt, radius, power, kind) { for (const p of farms) { if (!p.alive || wdist2(p.x, p.z, pt.x, pt.z) > radius + 1.8) continue; if (!inFarmLot(p, pt.x, pt.z, radius)) continue;
  if (kind === 'step' && p.grow > 0.2) { p.grow = Math.max(0.05, p.grow - 0.15); setGrowth(p); }   // trampled
  farmHit(p, kind === 'bullet' ? 1 : kind === 'step' ? 2 : 40 * power); } }
// crops grow while the farm stands; ripe crops are harvested (food banked) and the plots replanted
function updateFarms(dt) { const c = camD();
  for (const p of farms) { p.obj.position.set(disp(p.x, c.x), p.y, disp(p.z, c.z)); if (!p.alive || !p.done) continue;
    if (p.grow < 1) { p.grow = Math.min(1, p.grow + dt / FM_GROW); setGrowth(p); }
    else if (hasWarehouse(p.team)) { if (!p.truck) sendTruck(p, 'food'); }   // ripe crops wait for a truck
    else { p.ripeT += dt; if (p.ripeT > 6) { p.ripeT = 0; p.grow = 0; FOOD[p.team] += FM_HARVEST; setGrowth(p);
        FX.dust(new THREE.Vector3(p.x, p.y + 0.05, p.z), 20, { size: [0.1, 0.5], life: [0.8, 1.6], vel: 0.5, up: 0.1, a: 0.4, col: [0.5, 0.4, 0.3] }); } } } }
const foodRate = team => Math.round(farms.filter(p => p.team === team && p.alive && p.done).length * FM_HARVEST * 60 / (FM_GROW + 6));
// ------------------------------------------------------------------ logistics: warehouses and semi trucks
// Trucks wait inside their warehouse. When a lumber mill or mine has a full load, a truck drives out, takes the roads to it,
// loads (the stock disappears), drives back and pulls into the warehouse, where the load is banked. Spare trailers rest on
// their landing gear in the lot. Without a warehouse, loads are collected the old way.
let semiParts = null, SEMI_ERR = null; const warehouses = [], trucks = [], SEMI_K = 0.5;   // demo units per model unit (a trailer is ~16 world units long)
const WH_COST = 1000, WH_HP = 2000, WH_W = 2.0, WH_D = 1.35, WH_H = 0.62, WH_LOT = 1.5, WH_TRUCKS = 2;
// split the model sheet into cab, box trailer, flatbed trailer and landing-gear stand; each re-centred so it sits on y = 0,
// the cab's origin at its fifth wheel and each trailer's origin at its kingpin, both facing -x
function prepareSemi(g) { let mesh = null; g.scene.updateMatrixWorld(true); g.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const g0 = new THREE.BufferGeometry(); for (const n of ['position', 'normal', 'uv']) if (mesh.geometry.attributes[n]) g0.setAttribute(n, floatAttr(mesh.geometry.attributes[n])); if (mesh.geometry.index) g0.setIndex(mesh.geometry.index.clone());
  const src = g0.index ? g0.toNonIndexed() : g0; src.applyMatrix4(mesh.matrixWorld);   /* plain float copy (the loaded data may be interleaved) */
  const pos = src.attributes.position, nv = pos.count, par = new Int32Array(nv).map((_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; }, uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const key = new Map(); for (let i = 0; i < nv; i++) { const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4); const j = key.get(k); if (j === undefined) key.set(k, i); else uni(i, j); }
  for (let t = 0; t < nv; t += 3) { uni(t, t + 1); uni(t, t + 2); }
  const comps = new Map(); for (let t = 0; t < nv; t += 3) { const r = find(t); let c = comps.get(r); if (!c) comps.set(r, c = { tris: [], box: new THREE.Box3() }); c.tris.push(t); for (let v = 0; v < 3; v++) c.box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, t + v)); }
  const bands = { truck: [], box: [], flat: [], stand: [], tire: [] };
  for (const c of comps.values()) { const cy = (c.box.min.y + c.box.max.y) / 2, cx = (c.box.min.x + c.box.max.x) / 2, cz = (c.box.min.z + c.box.max.z) / 2;
    const k = cy > 0.64 ? 'truck' : cy > 0.31 ? 'box' : cy > 0.175 && cz < 0.26 ? 'flat' : cx < -0.3 ? 'stand' : 'tire'; bands[k].push(c); }
  const build = (list, originX) => { const box = new THREE.Box3(); list.forEach(c => box.union(c.box)); const tris = list.flatMap(c => c.tris), out = new THREE.BufferGeometry();
    for (const n in src.attributes) { const a = src.attributes[n], arr = new Float32Array(tris.length * 3 * a.itemSize); tris.forEach((t, i) => { for (let v = 0; v < 3; v++) for (let q = 0; q < a.itemSize; q++) arr[(i * 3 + v) * a.itemSize + q] = a.array[(t + v) * a.itemSize + q]; }); out.setAttribute(n, new THREE.BufferAttribute(arr, a.itemSize)); }
    const ox = originX(box); out.translate(-ox, -box.min.y, -(box.min.z + box.max.z) / 2); out.scale(SEMI_K, SEMI_K, SEMI_K); out.computeVertexNormals(); out.computeBoundingBox(); return { geo: out, len: (box.max.x - box.min.x) * SEMI_K, front: (box.min.x - ox) * SEMI_K }; };
  const mat = mesh.material; mat.side = THREE.DoubleSide;   /* some tyre faces point inward in the source model */
  semiParts = { mat, truck: build(bands.truck, b => 0.12), box: build(bands.box, b => b.min.x + 0.03), flat: build(bands.flat.filter(c => c.box.min.y > 0.15), b => b.min.x + 0.05), stand: build(bands.stand, b => b.min.x) };
  semiParts.flat.geo.computeBoundingBox();
  // the cab's road wheels: the loose tyre on the sheet, centred and scaled to fit the cab's hubs (the cab has none of its own)
  const tc = bands.tire.sort((a, c) => c.tris.length - a.tris.length)[0];
  if (tc) { const tg = build([tc], b => (b.min.x + b.max.x) / 2); tg.geo.computeBoundingBox(); const bb = tg.geo.boundingBox, d = bb.max.y - bb.min.y, k = 0.092 * SEMI_K / d;
    tg.geo.translate(0, -(bb.max.y + bb.min.y) / 2, 0); tg.geo.scale(k, k, k); semiParts.tire = tg; } }
// the cab with its wheels: one front axle, two rear axles (model hub positions), wheels resting on the ground
const CAB_AXLES = [-0.41, 0.055, 0.183], CAB_SIDES = [-0.1, 0.1], WHEEL_R = 0.046;
function makeCab() { const g = new THREE.Group(), body = semiMesh('truck'); body.position.y = (WHEEL_R - 0.024) * SEMI_K; g.add(body);
  if (semiParts.tire) for (const ax of CAB_AXLES) for (const sz of CAB_SIDES) { const w = new THREE.Mesh(semiParts.tire.geo, semiParts.mat); w.position.set((ax - 0.12) * SEMI_K, WHEEL_R * SEMI_K, sz * 1.08 * SEMI_K); w.castShadow = true; g.add(w); }
  return g; }
const semiMesh = part => { const m = new THREE.Mesh(semiParts[part].geo, semiParts.mat); m.castShadow = m.receiveShadow = true; return m; };
// a trailer as its own group (origin at the kingpin); a lumber load can be shown on the flatbed
function makeTrailer(kind) { const g = new THREE.Group(); g.add(semiMesh(kind)); if (kind === 'flat') { const b = semiParts.flat.geo.boundingBox, L = (b.max.x - b.min.x) * 0.8;
    const load = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, (b.max.z - b.min.z) * 0.75), new THREE.MeshStandardMaterial({ color: 0xd6a463, roughness: 0.9 })); load.position.set((b.min.x + b.max.x) / 2 + 0.03, b.max.y + 0.07, 0); load.castShadow = true; load.visible = false; g.add(load); g.userData.load = load; } return g; }
// ---- the warehouse: house-style siding walls, metal roof, a drive-in bay on the front, a lot for parked trailers
const WH_MAT = (() => { const wall = canvasTex(256, (g, Z) => { g.fillStyle = '#b8b1a2'; g.fillRect(0, 0, Z, Z); const r = mulberry(11);   // corrugated cladding
    for (let x = 0; x < Z; x += 8) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#9c968a'); gr.addColorStop(0.5, '#d4cdbd'); gr.addColorStop(1, '#9c968a'); g.fillStyle = gr; g.fillRect(x, 0, 8, Z); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,80,50,${r() * 0.12})`; g.fillRect(r() * Z, r() * Z * 0.6, 2 + r() * 6, 20 + r() * 80); }
    g.fillStyle = 'rgba(60,60,60,0.35)'; g.fillRect(0, Z - 18, Z, 18); }); wall.repeat.set(6, 1); const roof = tex('roof_metal.jpg'); roof.repeat.set(4, 3);
  return { wall: new THREE.MeshStandardMaterial({ map: wall, roughness: 0.9, side: THREE.DoubleSide }), roof: new THREE.MeshStandardMaterial({ map: roof, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ color: 0x8c8a85, roughness: 0.8 }), floor: new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.95 }), lot: new THREE.MeshStandardMaterial({ color: 0x3b3b3d, roughness: 0.95 }),
    line: new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.8 }), dark: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 }) }; })();
const BAY_W = 0.5, BAY_H = 0.42;
function makeWarehouse(ghost) { const g = new THREE.Group(), B = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; }, t = 0.06;
  B(WH_W, 0.06, WH_D, WH_MAT.floor, 0, 0.0, 0);                                                         // floor slab
  B(WH_W, WH_H, t, WH_MAT.wall, 0, WH_H / 2, -WH_D / 2); B(t, WH_H, WH_D, WH_MAT.wall, -WH_W / 2, WH_H / 2, 0); B(t, WH_H, WH_D, WH_MAT.wall, WH_W / 2, WH_H / 2, 0);
  const side = (WH_W - BAY_W) / 2; B(side, WH_H, t, WH_MAT.wall, -WH_W / 2 + side / 2, WH_H / 2, WH_D / 2); B(side, WH_H, t, WH_MAT.wall, WH_W / 2 - side / 2, WH_H / 2, WH_D / 2);   // front, open bay in the middle
  B(BAY_W, WH_H - BAY_H, t, WH_MAT.wall, 0, BAY_H + (WH_H - BAY_H) / 2, WH_D / 2);
  for (const sx of [-1, 1]) B(0.07, BAY_H, 0.09, WH_MAT.trim, sx * BAY_W / 2, BAY_H / 2, WH_D / 2 + 0.01); B(BAY_W + 0.14, 0.07, 0.09, WH_MAT.trim, 0, BAY_H, WH_D / 2 + 0.01);
  B(BAY_W, 0.06, 0.04, WH_MAT.trim, 0, BAY_H - 0.06, WH_D / 2 + 0.03);                                // rolled-up door
  // gable roof
  const rh = 0.26, rw = Math.hypot(WH_W / 2 + 0.12, rh); for (const sx of [-1, 1]) { const r = B(rw, 0.04, WH_D + 0.24, WH_MAT.roof, sx * (WH_W / 4 + 0.03), WH_H + rh / 2, 0); r.rotation.z = -sx * Math.atan2(rh, WH_W / 2 + 0.12); }
  for (const sz of [-1, 1]) { const gs = new THREE.Shape([new THREE.Vector2(-WH_W / 2, 0), new THREE.Vector2(WH_W / 2, 0), new THREE.Vector2(0, rh)]), m = new THREE.Mesh(new THREE.ShapeGeometry(gs), WH_MAT.wall); m.position.set(0, WH_H, sz * WH_D / 2); m.material = WH_MAT.wall; g.add(m); }
  B(0.3, 0.15, 0.04, WH_MAT.dark, -WH_W / 2 + 0.3, WH_H - 0.18, WH_D / 2 + 0.03); B(0.3, 0.15, 0.04, WH_MAT.dark, WH_W / 2 - 0.3, WH_H - 0.18, WH_D / 2 + 0.03);   // windows
  // the lot in front: asphalt with parking lines
  B(WH_W, 0.03, WH_LOT, WH_MAT.lot, 0, 0.0, WH_D / 2 + WH_LOT / 2);
  for (let i = 0; i < 4; i++) B(0.02, 0.035, WH_LOT * 0.62, WH_MAT.line, WH_W / 2 - 0.13 - i * 0.26, 0.0, WH_D / 2 + WH_LOT * 0.38);
  if (ghost) g.traverse(o => { if (o.isMesh) { o.material = GHOST_MAT; o.castShadow = false; } });
  return g; }
const whLocal = (w, x, z) => { const dx = wd(x - w.x), dz = wd(z - w.z), c = Math.cos(w.rot), s = Math.sin(w.rot); return { lx: dx * c - dz * s, lz: dx * s + dz * c }; };
const whWorld = (w, lx, lz) => { const c = Math.cos(w.rot), s = Math.sin(w.rot); return { x: wm(w.x + lx * c + lz * s), z: wm(w.z - lx * s + lz * c) }; };
const inWhLot = (w, x, z, m) => { const { lx, lz } = whLocal(w, x, z); return Math.abs(lx) < WH_W / 2 + m && lz > -WH_D / 2 - m && lz < WH_D / 2 + WH_LOT + m; };
function canPlaceWarehouse(team, xw, zw, rot = 0) { const w = { x: wm(xw / S), z: wm(zw / S), rot }; let lo = 1e9, hi = -1e9;
  for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) { const q = whWorld(w, -WH_W / 2 + WH_W * i / 5, -WH_D / 2 + (WH_D + WH_LOT) * j / 5);
    if (!inTerritory(team, q.x, q.z)) return 'Must fit inside your territory';
    const h = Hd(q.x, q.z); if (h < 2 / S * 1.2) return 'Cannot build on water'; lo = Math.min(lo, h); hi = Math.max(hi, h);
    if (roadAt(q.x * S, q.z * S) > 0.5) return 'Blocked by a road';
    if (groundLocked(q.x * S, q.z * S, null)) return 'Too close to another building';
    for (const f of oilFields) if (wdist2(f.x, f.z, q.x, q.z) < OIL_R) return 'Oil fields are for oil pumps';
    for (const pr of propsNear(q.x, q.z)) if (pr.alive && wdist2(pr.x, pr.z, q.x, q.z) < pr.r + 0.15) return 'Blocked by a building'; }
  if (hi - lo > 1.0) return 'Ground too uneven'; return null; }
function buildWarehouse(team, xw, zw, rot = 0) { if (!semiParts) return null; const w = { kind: 'warehouse', team, x: wm(xw / S), z: wm(zw / S), rot };
  let sum = 0, n = 0; for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) { const q = whWorld(w, -WH_W / 2 + WH_W * i / 5, -WH_D / 2 + (WH_D + WH_LOT) * j / 5); sum += Hd(q.x, q.z); n++; }
  w.y = Math.max(2 / S * 1.3, sum / n);
  if (window.levelTerrain) { levelTerrain(w.x * S, w.z * S, 4 * S, (xw2, zw2) => { if (groundLocked(xw2, zw2, null)) return 0; const { lx, lz } = whLocal(w, xw2 / S, zw2 / S);
      const d = Math.hypot(Math.max(Math.abs(lx) - WH_W / 2 - 0.05, 0), Math.max(-WH_D / 2 - 0.05 - lz, lz - WH_D / 2 - WH_LOT - 0.05, 0)); return smoothW(d, 0.9); }, w.y * S); refreshOilNear(w.x, w.z, 4); }
  w.obj = new THREE.Group(); w.obj.add(makeWarehouse(false)); w.obj.rotation.y = rot; battleRoot.add(w.obj);
  // spare trailers in the lot, resting on their landing gear
  for (let i = 0; i < 3; i++) { const tr = makeTrailer(i === 1 ? 'box' : 'flat'), x = WH_W / 2 - 0.26 - i * 0.26, z0 = WH_D / 2 + 0.15; tr.rotation.y = -Math.PI / 2; tr.position.set(x, 0.015, z0);
    const st = semiMesh('stand'); st.position.set(0.02, 0, 0); tr.add(st); w.obj.add(tr); }
  Object.assign(w, { hp: WH_HP, maxHp: WH_HP, alive: true, vel: new THREE.Vector3(), pos: new THREE.Vector3(w.x, w.y + 0.4, w.z) });
  warehouses.push(w); if (window.clearTreesIn) clearTreesIn((x2, z2) => inWhLot(w, x2 / S, z2 / S, 0.25));
  startSite(w, [-WH_W / 2, WH_W / 2, -WH_D / 2, WH_D / 2], WH_H + 0.45, 30, () => { log(team, `<b>${TEAM_NAME[team]}</b> warehouse open`); for (let i = 0; i < WH_TRUCKS; i++) makeTruck(w, i); }); return w; }
function warehouseAt(pos) { for (const w of warehouses) { if (!w.alive || wdist2(w.x, w.z, pos.x, pos.z) > 3) continue; const { lx, lz } = whLocal(w, pos.x, pos.z); if (Math.abs(lx) < WH_W / 2 && Math.abs(lz) < WH_D / 2 && pos.y < w.y + WH_H + 0.4) return w; } return null; }
function warehouseHit(w, amount) { if (!w.alive) return; w.hp -= amount; if (w.hp <= 0) { w.alive = false; const v = new THREE.Vector3(w.x, w.y + 0.4, w.z); FX.explosion(v, 1.4); addShake(0.3, v); fires.push({ x: w.x, z: w.z, t: 30 }); scorchMarks.add(w.x, w.z, 0, 2, 2);
    w.obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color && m.material.color.multiplyScalar(0.25); } }); w.obj.children[0].scale.y *= 0.4; log(w.team, `<b>${TEAM_NAME[w.team]}</b> warehouse destroyed`);
    for (const t of trucks) if (t.home === w && t.state === 'home') t.dead = true; } return 'hit'; }
function warehouseImpact(pt, radius, power, kind) { for (const w of warehouses) { if (!w.alive || wdist2(w.x, w.z, pt.x, pt.z) > radius + 2.5) continue; if (!warehouseAt(pt) && !warehouseAt(new THREE.Vector3(pt.x, pt.y - radius, pt.z))) continue; warehouseHit(w, kind === 'bullet' ? 3 : kind === 'step' ? 0 : 55 * power); } }
// ---- routes: from a point, onto the nearest road, along the road graph, off again to the destination (all demo units)
function nearestRoad(x, z) { const { chains } = ROAD_NET; let best = null, bd = 1e9; for (let ci = 0; ci < chains.length; ci++) { const c = chains[ci]; if (c.len < 3) continue;
    for (let k = 0; k <= c.n; k += 2) { if (c.wet[k] && !(c.br && c.br[k])) continue; const d = Math.hypot(wd(c.x[k] / S - x), wd(c.z[k] / S - z)); if (d < bd) { bd = d; best = { c: ci, s: c.len * k / c.n, d }; } } } return best; }
function chainPts(c, s0, s1, out) { const ch = ROAD_NET.chains[c], dir = Math.sign(s1 - s0) || 1, step = 2.5, n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
  for (let i = 0; i <= n; i++) { const s = s0 + (s1 - s0) * i / n, q = roadSample(ch, s), o = dir * LANE * 0.8; out.push({ x: wm((q.x - q.tz * o) / S), z: wm((q.z + q.tx * o) / S) }); } }
function roadRoute(a, b) { const { chains, at } = ROAD_NET, ca = chains[a.c], cb = chains[b.c], out = [];
  if (a.c === b.c) { chainPts(a.c, a.s, b.s, out); return out; }
  const dist = new Map([[ca.a, a.s], [ca.b, ca.len - a.s]]), prev = new Map([[ca.a, null], [ca.b, null]]), todo = [ca.a, ca.b], done = new Set();
  while (todo.length) { todo.sort((x, y) => dist.get(x) - dist.get(y)); const n = todo.shift(); if (done.has(n)) continue; done.add(n);
    for (const o of at[n] || []) { const c = chains[o.i]; if (c.wet.some((wt, k) => wt && !(c.br && c.br[k]))) continue; const m = o.start ? c.b : c.a, d = dist.get(n) + c.len;
      if (!dist.has(m) || d < dist.get(m)) { dist.set(m, d); prev.set(m, { n, i: o.i, start: o.start }); todo.push(m); } } }
  const ends = [[cb.a, b.s], [cb.b, cb.len - b.s]].filter(([n]) => dist.has(n)).sort((x, y) => dist.get(x[0]) + x[1] - dist.get(y[0]) - y[1]); if (!ends.length) return null;
  const en = ends[0][0], steps = []; let n = en; while (prev.get(n)) { const p = prev.get(n); steps.unshift(p); n = p.n; }
  chainPts(a.c, a.s, n === ca.a ? 0 : ca.len, out);
  for (const p of steps) chainPts(p.i, p.start ? 0 : chains[p.i].len, p.start ? chains[p.i].len : 0, out);
  chainPts(b.c, en === cb.a ? 0 : cb.len, b.s, out); return out; }
// is this ground taken by a building (other than the exempt ones)? trucks drive around these
function lotBlocked(x, z, ex) { const m = 0.12;
  for (const o of outposts) if (o.alive && !ex.includes(o) && wdist2(o.x, o.z, x, z) < OUTPOST_W * 0.6 + m) return true;
  for (const a of airbases) if (a.alive && !ex.includes(a) && wdist2(a.x, a.z, x, z) < 4.5) { const { lx, lz } = abLocal(a, x, z); if (lx > AB_EXT[0] * 1 - 1 && lx < AB_EXT[1] + 1 && lz > AB_EXT[2] - 1 && lz < AB_EXT[3] + 1) return true; }
  for (const q of pumpjacks) if (q.alive && !ex.includes(q) && wdist2(q.x, q.z, x, z) < 2 && inPumpLot(q, x, z, m)) return true;
  for (const q of camps) if (q.alive && !ex.includes(q) && wdist2(q.x, q.z, x, z) < 2.2 && inCampLot(q, x, z, m)) return true;
  for (const q of mines) if (q.alive && !ex.includes(q) && wdist2(q.x, q.z, x, z) < 3) { const { lx, lz } = mnLocal(q, x, z); if (inRect(MN_YARD, lx, lz, m) || inRect(MN_TUN, lx, lz, m)) return true; }
  for (const q of farms) if (q.alive && !ex.includes(q) && wdist2(q.x, q.z, x, z) < 2 && inFarmLot(q, x, z, m)) return true;
  for (const w of warehouses) if (w.alive && !ex.includes(w) && wdist2(w.x, w.z, x, z) < 3 && inWhLot(w, x, z, m)) return true;
  for (const h of hangars) if (h.alive && !ex.includes(h) && wdist2(h.x, h.z, x, z) < 4 && inHangarLot(h, x, z, m) && hgLocal(h, x, z).lz < 13) return true;
  for (const pr of propsNear(x, z)) if (pr.alive && pr.kind !== 'lamp' && pr.kind !== 'car' && wdist2(pr.x, pr.z, x, z) < pr.r + m) return true;
  return false; }
// off-road leg: straight if clear, otherwise A* on a fine grid around the obstacles
function offroad(a, b, ex, foot) { const dx = wd(b.x - a.x), dz = wd(b.z - a.z), L = Math.hypot(dx, dz); let clear = true;
  for (let s = 0.1; s < L - 0.1; s += 0.08) { const px = wm(a.x + dx * s / L), pz = wm(a.z + dz * s / L); if ((s > 0.35 && lotBlocked(px, pz, ex)) || (foot && Hd(px, pz) < 2 / S * 1.1)) { clear = false; break; } } if (clear) return [b];
  const G = 0.12, pad = 2.5, nx = Math.ceil((Math.abs(dx) + pad * 2) / G), nz = Math.ceil((Math.abs(dz) + pad * 2) / G), ox = Math.min(0, dx) - pad, oz = Math.min(0, dz) - pad, N = nx * nz;
  const cell = (x, z) => Math.round((x - ox) / G) + Math.round((z - oz) / G) * nx, blocked = new Uint8Array(N).fill(255);
  const isB = i => { if (blocked[i] === 255) { const x = (i % nx) * G + ox, z = Math.floor(i / nx) * G + oz; blocked[i] = Math.hypot(x, z) > 0.35 && (lotBlocked(wm(a.x + x), wm(a.z + z), ex) || (foot && Hd(wm(a.x + x), wm(a.z + z)) < 2 / S * 1.1)) ? 1 : 0; } return blocked[i]; };
  const s0 = cell(0, 0), g0 = cell(dx, dz), gs = new Float32Array(N).fill(1e9), par = new Int32Array(N).fill(-1), open = [s0]; gs[s0] = 0;
  const h = i => Math.hypot((i % nx) - (g0 % nx), Math.floor(i / nx) - Math.floor(g0 / nx)); let it = 0;
  while (open.length && it++ < 40000) { let bi = 0; for (let k = 1; k < open.length; k++) if (gs[open[k]] + h(open[k]) < gs[open[bi]] + h(open[bi])) bi = k; const c = open.splice(bi, 1)[0]; if (c === g0) break;
    const cx = c % nx, cz = Math.floor(c / nx); for (let ddz = -1; ddz <= 1; ddz++) for (let ddx = -1; ddx <= 1; ddx++) { if (!ddx && !ddz) continue; const x2 = cx + ddx, z2 = cz + ddz; if (x2 < 0 || z2 < 0 || x2 >= nx || z2 >= nz) continue;
      const n = x2 + z2 * nx; if (n !== g0 && isB(n)) continue; const g = gs[c] + (ddx && ddz ? 1.414 : 1); if (g < gs[n]) { if (gs[n] === 1e9) open.push(n); gs[n] = g; par[n] = c; } } }
  if (par[g0] < 0) return [b]; const out = []; for (let c = g0, k = 0; c !== s0 && c >= 0; c = par[c], k++) if (k % 2 === 0) out.unshift({ x: wm(a.x + (c % nx) * G + ox), z: wm(a.z + Math.floor(c / nx) * G + oz) }); out.push(b); return out; }
function planRoute(from, to, ex = []) { const ra = nearestRoad(from.x, from.z), rb = nearestRoad(to.x, to.z), pts = [from];
  if (ra && rb && ra.d < 8 && rb.d < 8) { const r = roadRoute(ra, rb); if (r && r.length) { pts.push(...offroad(from, r[0], ex), ...r.slice(1)); pts.push(...offroad(r[r.length - 1], to, ex)); return pts; } }
  pts.push(...offroad(from, to, ex)); return pts; }
// ---- trucks
function makeTruck(w, i) { const obj = new THREE.Group(), cab = makeCab(); obj.add(cab); battleRoot.add(obj);
  const tr = makeTrailer('flat'); battleRoot.add(tr); const tb = makeTrailer('box'); tb.visible = false; battleRoot.add(tb);
  const t = { home: w, team: w.team, obj, flat: tr, box: tb, trailer: tr, state: 'home', path: null, job: null, v: 0, slot: i, dead: false }; parkInside(t); trucks.push(t); return t; }
// parked inside facing the bay door, trailer behind
function parkInside(t) { const w = t.home, p = whWorld(w, (t.slot - 0.5) * 0.24, -WH_D / 2 + 0.6); t.x = p.x; t.z = p.z; t.yaw = w.rot; t.tx = wm(t.x - Math.sin(t.yaw) * 0.77 * SEMI_K); t.tz = wm(t.z - Math.cos(t.yaw) * 0.77 * SEMI_K); t.v = 0; }
// pickup and drop-off points: in front of the producer's stock, and in front of / inside the warehouse bay
const pickupPoint = p => p.kind === 'woodcutter' ? wcWorld(p, (WC_BOX.x1 + 0.35), 0) : p.kind === 'farm' ? fmWorld(p, FM_HALF * FM_K + 0.45, 0) : mnWorld(p, 6 * MN_K, 9 * MN_K);
// trucks serve pickups in the order they were asked for, so busy woodcutters cannot starve the mines and farms
const truckReq = new Map();
function sendTruck(p, kind) { if (!truckReq.has(p)) truckReq.set(p, missionClock);
  const free = trucks.filter(t => !t.dead && t.team === p.team && t.state === 'home' && t.home.alive); if (!free.length) return false;
  let first = null; for (const [q, at] of truckReq) { if (!q.alive || q.truck) { truckReq.delete(q); continue; } if (q.team === p.team && (!first || at < truckReq.get(first))) first = q; }
  if (first && first !== p) return false; truckReq.delete(p);
  const t = free.sort((a, b) => wdist2(a.x, a.z, p.x, p.z) - wdist2(b.x, b.z, p.x, p.z))[0], w = t.home;
  t.job = { p, kind }; t.trailer.visible = false; t.trailer = kind === 'wood' ? t.flat : t.box; t.trailer.visible = true;
  const bay = whWorld(w, 0, WH_D / 2 + 0.9), out = whWorld(w, 0, WH_D / 2 + WH_LOT + 0.6);
  t.path = [bay, out, ...planRoute(out, pickupPoint(p), [w, p]).slice(1)]; t.pi = 0; t.state = 'out'; p.truck = t; return true; }
function truckHome(t) { const w = t.home, out = whWorld(w, 0, WH_D / 2 + WH_LOT + 0.6), bay = whWorld(w, 0, WH_D / 2 + 0.9), inside = whWorld(w, 0, -WH_D / 2 + 0.3);
  t.path = [...planRoute({ x: t.x, z: t.z }, out, [w, t.job && t.job.p]), bay, inside]; t.pi = 0; t.state = 'back'; }
function updateTrucks(dt) { const c = camD();
  for (const t of trucks) { if (t.dead) { t.obj.visible = t.trailer.visible = false; continue; }
    if (t.path) { const tgt = t.path[t.pi], dx = wd(tgt.x - t.x), dz = wd(tgt.z - t.z), d = Math.hypot(dx, dz), last = t.pi === t.path.length - 1;
      if (d < (last ? 0.12 : 0.35)) { t.pi++; if (t.pi >= t.path.length) { t.path = null; t.v = 0; t.wait = 3.5; } }
      else { const want = Math.atan2(dx, dz); let dy = Math.atan2(Math.sin(want - t.yaw), Math.cos(want - t.yaw)); t.yaw += clamp(dy, -1.4 * dt, 1.4 * dt);
        const vmax = (last || t.pi < 2 ? 0.3 : 0.65) * (Math.abs(dy) > 0.6 ? 0.45 : 1); t.v += (vmax - t.v) * Math.min(1, dt * 1.5); t.x = wm(t.x + Math.sin(t.yaw) * t.v * dt); t.z = wm(t.z + Math.cos(t.yaw) * t.v * dt); } }
    else if (t.wait > 0) { t.wait -= dt; if (t.wait <= 0) {
        if (t.state === 'out') { const p = t.job.p;   // loading done: the stock leaves with the truck
          if (p.alive) { if (t.job.kind === 'wood') { t.cargo = p.boards * WOOD_PER_BOARD; p.boards = 0; showStock(p); } else if (t.job.kind === 'food') { t.cargo = FM_HARVEST; p.grow = 0; p.ripeT = 0; setGrowth(p);   /* harvested onto the truck */
            FX.dust(new THREE.Vector3(p.x, p.y + 0.05, p.z), 20, { size: [0.1, 0.5], life: [0.8, 1.6], vel: 0.5, up: 0.1, a: 0.4, col: [0.5, 0.4, 0.3] }); } else { t.cargo = MN_ORE_PER_LOAD; p.bins = [0, 0, 0]; showMineStock(p); } }
          if (t.trailer.userData.load) t.trailer.userData.load.visible = true; p.truck = null; truckHome(t); }
        else if (t.state === 'back') { (t.job.kind === 'wood' ? WOOD : t.job.kind === 'food' ? FOOD : ORE)[t.team] += t.cargo || 0; t.cargo = 0; if (t.trailer.userData.load) t.trailer.userData.load.visible = false; t.state = 'home'; t.job = null; parkInside(t); } } }
    // the trailer follows its kingpin on the fifth wheel; its axle trails behind
    const L = 0.77 * SEMI_K, hx = t.x, hz = t.z, ax = wd(t.tx - hx), az = wd(t.tz - hz), al = Math.hypot(ax, az) || 1; t.tx = wm(hx + ax / al * L); t.tz = wm(hz + az / al * L);
    // follow the ground: the cab pitches between its rear axle (the fifth wheel) and front axle, the trailer between kingpin and rear axle
    const ty = Math.atan2(-ax, -az), F = 0.42 * SEMI_K, hB = Hd(t.x, t.z), hF = Hd(wm(t.x + Math.sin(t.yaw) * F), wm(t.z + Math.cos(t.yaw) * F)), hT = Hd(t.tx, t.tz);
    t.obj.rotation.order = t.trailer.rotation.order = 'YZX';
    t.obj.position.set(disp(t.x, c.x), hB, disp(t.z, c.z)); t.obj.rotation.set(0, t.yaw + Math.PI / 2, -Math.atan2(hF - hB, F));
    t.trailer.position.set(disp(t.x, c.x), hB, disp(t.z, c.z)); t.trailer.rotation.set(0, ty + Math.PI / 2, Math.atan2(hT - hB, L)); } }
// warehouses: keep display copies near the camera
function updateWarehouses() { const c = camD(); for (const w of warehouses) w.obj.position.set(disp(w.x, c.x), w.y, disp(w.z, c.z)); }
const hasWarehouse = team => warehouses.some(w => w.alive && w.done && w.team === team) && trucks.some(t => !t.dead && t.team === team);
// ------------------------------------------------------------------ infantry
// Four T-posed soldiers on one sheet (top row: navy uniform, bottom row: grey). Each side fields one uniform. They are
// rigged here: a 13-bone skeleton with blended skin weights, posed procedurally every frame (idle gun hold, walk/run gait,
// aim and fire with recoil, death fall). The rifle is a scaled copy of the mech's gun, carried at the chest.
let soldierKinds = null, soldierGun = null; const soldiers = [], SOLD_H = 1.75 / S, SOLD_HP = 60, SOLD_RANGE = 3.2, SOLD_SPEED = [0.11, 0.32];
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// bone layout in units of body height, character facing +z (its right hand is at -x)
const SB = [['root', -1, 0, 0], ['hips', 0, 0, 0.52], ['spine', 1, 0, 0.64], ['chest', 2, 0, 0.74], ['head', 3, 0, 0.86],
  ['armR', 3, -0.105, 0.8], ['foreR', 5, -0.255, 0.8], ['armL', 3, 0.105, 0.8], ['foreL', 7, 0.255, 0.8],
  ['thighR', 1, -0.05, 0.5], ['shinR', 9, -0.05, 0.27], ['thighL', 1, 0.05, 0.5], ['shinL', 11, 0.05, 0.27]];
const BI = Object.fromEntries(SB.map((b, i) => [b[0], i]));
function skinWeights(x, y) { const w = new Map(), add = (b, v) => { if (v > 1e-3) w.set(b, (w.get(b) || 0) + v); }, s = x < 0 ? 'R' : 'L', ax = Math.abs(x);
  const arm = sm(0.09, 0.125, ax) * (y > 0.64 ? 1 : 0), leg = (1 - sm(0.46, 0.53, y)) * (1 - arm);
  if (arm > 0) { const fo = sm(0.235, 0.275, ax); add('fore' + s, arm * fo); add('arm' + s, arm * (1 - fo)); }
  if (leg > 0) { const sh = 1 - sm(0.25, 0.29, y); add('shin' + s, leg * sh); add('thigh' + s, leg * (1 - sh)); }
  const body = 1 - arm - leg; if (body > 1e-3) { const hd = sm(0.84, 0.88, y), ch = sm(0.66, 0.74, y) * (1 - hd), sp = sm(0.56, 0.64, y) * (1 - ch - hd);
    add('head', body * hd); add('chest', body * ch); add('spine', body * Math.max(0, sp)); add('hips', body * Math.max(0, 1 - hd - ch - sp)); }
  const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s2, e) => s2 + e[1], 0) || 1; return top.map(([b, v]) => [BI[b], v / sum]); }
function prepareSoldiers(g, mechScene) { let mesh = null; g.scene.updateMatrixWorld(true); g.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const src0 = new THREE.BufferGeometry(); for (const n of ['position', 'normal', 'uv']) if (mesh.geometry.attributes[n]) src0.setAttribute(n, floatAttr(mesh.geometry.attributes[n])); if (mesh.geometry.index) src0.setIndex(mesh.geometry.index.clone());
  const src = src0.index ? src0.toNonIndexed() : src0; src.applyMatrix4(mesh.matrixWorld); const P = src.attributes.position, mat = mesh.material.clone(); mat.side = THREE.DoubleSide; mat.skinning = true;
  const kinds = [];
  for (let q = 0; q < 4; q++) { const right = q % 2, top = q < 2, tris = [];   // q: 0,1 navy (top row), 2,3 grey
    for (let t = 0; t < P.count; t += 3) { const cx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3, cy = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3; if ((cx > 0) === !!right && (cy > 0.5) === top) tris.push(t); }
    const out = new THREE.BufferGeometry(); for (const n in src.attributes) { const a = src.attributes[n], arr = new Float32Array(tris.length * 3 * a.itemSize); tris.forEach((t, i) => arr.set(a.array.subarray(t * a.itemSize, (t + 3) * a.itemSize), i * 3 * a.itemSize)); out.setAttribute(n, new THREE.BufferAttribute(arr, a.itemSize)); }
    out.computeBoundingBox(); const b = out.boundingBox, h = b.max.y - b.min.y; out.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); out.scale(1 / h, 1 / h, 1 / h);
    const pp = out.attributes.position, si = new Uint16Array(pp.count * 4), sw = new Float32Array(pp.count * 4);
    for (let i = 0; i < pp.count; i++) skinWeights(pp.getX(i), pp.getY(i)).forEach(([bi, v], k) => { si[i * 4 + k] = bi; sw[i * 4 + k] = v; });
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); out.computeVertexNormals(); kinds.push(out); }
  soldierKinds = { geos: kinds, mat };
  // the rifle: the mech's gun, shrunk (a simple rifle if the gun can't be detached)
  let gun = mechScene && mechScene.getObjectByName('Gun'), skinned = true; if (gun) { let meshes = 0; gun.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) meshes++; }); skinned = !meshes; }   /* the mech's gun is part of its skinned body: build the rifle instead */
  if (gun && !skinned) { const c = gun.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1); c.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(c), sz = bb.getSize(new THREE.Vector3()), L = Math.max(sz.x, sz.y, sz.z);
    const hold = new THREE.Group(); c.position.sub(bb.getCenter(new THREE.Vector3())); hold.add(c); if (sz.x === L) hold.rotation.y = Math.PI / 2; else if (sz.y === L) hold.rotation.x = Math.PI / 2; hold.scale.setScalar(0.55 / L); soldierGun = hold; }
  else { // a scaled-down beam rifle in the mech gun's colours: body, barrel, grip, magazine, stock, sight, emitter tip
    const g2 = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.45, metalness: 0.6 }), m2 = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 }),
      glow = new THREE.MeshBasicMaterial({ color: 0xff7ac8 }), bx = (w, h, d, z, y, mat = m) => { const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); k.position.set(0, y, z); k.castShadow = true; g2.add(k); };
    bx(0.04, 0.06, 0.26, 0.03, 0); bx(0.022, 0.022, 0.16, 0.24, 0.012, m2); bx(0.03, 0.03, 0.03, 0.33, 0.012); bx(0.026, 0.07, 0.035, -0.02, -0.06, m2); bx(0.03, 0.08, 0.04, 0.07, -0.06, m2);
    bx(0.036, 0.05, 0.11, -0.16, -0.008); bx(0.018, 0.02, 0.06, 0.04, 0.042, m2); bx(0.012, 0.012, 0.01, 0.35, 0.012, glow); g2.scale.setScalar(0.62); soldierGun = g2; } }
function makeSoldier(team, x, z, variant) { const geo = soldierKinds.geos[(team ? 2 : 0) + variant], bones = SB.map(([name, , bx, by]) => { const b = new THREE.Bone(); b.name = name; return b; });
  SB.forEach(([, p, bx, by], i) => { if (p < 0) bones[i].position.set(bx, by, 0); else { bones[i].position.set(bx - SB[p][2], by - SB[p][3], 0); bones[p].add(bones[i]); } });
  const skel = new THREE.Skeleton(bones), mesh = new THREE.SkinnedMesh(geo, soldierKinds.mat); mesh.add(bones[0]); mesh.bind(skel); mesh.castShadow = true; mesh.frustumCulled = false;
  const gun = soldierGun.clone(true); gun.position.set(-0.06, 0.02, 0.1); bones[BI.chest].add(gun); const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 0.3); gun.add(muzzle);
  const root = new THREE.Group(); root.scale.setScalar(SOLD_H); root.add(mesh); battleRoot.add(root);
  const s = { kind: 'soldier', team, col: TEAM_COL[team], root, mesh, bones, gun, muzzle, pos: new THREE.Vector3(wm(x), 0, wm(z)), vel: new THREE.Vector3(), yaw: rand(0, 6.28), hp: SOLD_HP, maxHp: SOLD_HP, alive: true,
    state: 'idle', speed: 0, ph: rand(0, 1), order: null, target: null, fireT: rand(0, 1), shots: 0, recoil: 0, deadT: 0, sel: false, st: Math.random() };
  s.pos.y = Hd(s.pos.x, s.pos.z); makeBars(s, 0.24, 0.18); soldiers.push(s); return s; }
// ---- pose: every bone set from the current state each frame
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const setRot = (b, x, y, z, order = 'XYZ') => b.quaternion.setFromEuler(_e.set(x, y, z, order));
const gw = (t, c, w) => { let d = t - c; d -= Math.floor(d + 0.5); return Math.exp(-d * d / (w * w)); };
function poseSoldier(s, dt) { const B = s.bones, b = n => B[BI[n]], run = s.speed > 0.2 ? 1 : 0, A = clamp(s.speed / 0.11, 0, 1);
  if (!s.alive) {   // death: knees go, the body falls back and settles
    const k = sm(0, 0.9, s.deadT); setRot(b('root'), -k * 1.42, 0, 0); setRot(b('thighR'), -k * 0.5, 0, 0); setRot(b('thighL'), -k * 0.2, 0, 0); setRot(b('shinR'), k * 0.9, 0, 0); setRot(b('shinL'), k * 0.4, 0, 0);
    s.gun.visible = s.deadT < 0.35;   // dropped as they fall
    setRot(b('armR'), 0, k * 0.4, 0.4 + k * 0.6, 'YZX'); setRot(b('armL'), 0, -k * 0.2, -0.3 - k * 0.9, 'YZX'); setRot(b('head'), -k * 0.3, 0, k * 0.2); return; }
  const tR = s.ph, legs = { R: tR, L: (tR + 0.5) % 1 };
  for (const sd of ['R', 'L']) { const t = legs[sd];
    const hip = (run ? 0.15 + 0.55 * Math.cos(6.283 * (t - 0.08)) : 0.07 + 0.3 * Math.cos(6.283 * (t - 0.03)) + 0.04 * Math.cos(12.566 * (t - 0.1))) * A;
    const knee = (run ? 0.15 + 0.65 * gw(t, 0.18, 0.09) + 1.75 * gw(t, 0.66, 0.14) : 0.06 + 0.3 * gw(t, 0.13, 0.07) + 1.05 * gw(t, 0.72, 0.1)) * A;
    setRot(b('thigh' + sd), -hip, 0, 0); setRot(b('shin' + sd), knee, 0, 0); }
  const aim = s.state === 'fire' ? 1 : 0, rec = s.recoil;
  // torso: lean into a run, bob with the steps, breathe at rest, kick back on each shot
  b('hips').position.y = SB[BI.hips][3] + Math.cos(12.566 * (tR - 0.3)) * 0.012 * A - 0.02 * A * run;
  setRot(b('spine'), 0.06 * A + 0.14 * run + 0.015 * Math.sin(performance.now() / 700 + s.st * 9) * (1 - A), Math.sin(6.283 * tR) * 0.12 * A, 0);
  setRot(b('chest'), -rec * 0.12, 0.25 * aim, 0); setRot(b('head'), -0.04 * aim, -0.2 * aim, 0);
  // arms on the rifle: right hand on the grip, left under the handguard; raised to the shoulder to aim
  setRot(b('armR'), 0, 0.55 + 0.25 * aim, 1.2 - 0.35 * aim, 'YZX'); setRot(b('foreR'), 0, 1.35 - 0.2 * aim, 0);
  setRot(b('armL'), 0, -1.0 - 0.15 * aim, -1.0 + 0.3 * aim, 'YZX'); setRot(b('foreL'), 0, -0.9 + 0.2 * aim, 0);
  s.gun.position.set(-0.03 + 0.02 * aim, -0.07 + 0.06 * aim, 0.14 - rec * 0.03); s.gun.rotation.set(-0.12 * (1 - aim), 0, 0);
  setRot(b('root'), 0, 0, 0); }
// ---- behaviour
const soldierTargets = s => [...soldiers.filter(o => o.alive && !o.inHeli && o.team !== s.team), ...robots.filter(r => r.team !== s.team && r.state !== 'ko')];
function soldierHit(s, amount, by) { if (!s.alive) return; s.hp -= amount; if (s.hp <= 0) { s.alive = false; s.sel = false; s.deadT = 0; s.state = 'dead'; if (by) log(s.team, `<b>${unitName(by)}</b> kills <b>${unitName(s)}</b>`); }
  else if (by && !s.target && (!s.order || s.order.type !== 'move')) s.target = by; return 'hit'; }
function soldierImpact(pt, radius, power, kind) { for (const s of soldiers) { if (!s.alive || s.inHeli) continue; const d = wdist2(s.pos.x, s.pos.z, pt.x, pt.z); if (d > radius + 0.06 || pt.y > s.pos.y + SOLD_H * 1.2) continue;
  soldierHit(s, kind === 'step' || kind === 'land' ? 999 : kind === 'bullet' ? 6 : 90 * power, null); } }
function soldierFire(s, T) { const m = new THREE.Vector3(); s.muzzle.getWorldPosition(m); m.divideScalar(S); m.x = s.pos.x + (m.x - s.root.position.x); m.z = s.pos.z + (m.z - s.root.position.z);
  const tp = tgtPos(T, new THREE.Vector3()); near(tp, s.pos, tp); FX.flash(m, 0.035, [1, 0.85, 0.5]); s.recoil = 1; s.shots++;
  const miss = Math.random() < 0.25; if (!miss) { if (T.kind === 'soldier') soldierHit(T, 9, s); else damage(s, T, 2, null, false, tp.clone().sub(s.pos).setY(0).normalize(), tp.clone()); }
  else tp.add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.05, 0.1), rand(-0.15, 0.15)));
  // tracer
  const tr = hRounds.find(r => !r.alive); if (tr) { tr.alive = true; tr.owner = s; tr.life = 0.25; tr.m.material = hRoundMats[s.team]; tr.m.visible = true; tr.p.copy(m); tr.v.subVectors(tp, m).normalize().multiplyScalar(14); tr.m.scale.set(1.2, 1.2, 1); tr.tracerOnly = true; } }
function updateSoldiers(dt) { const c = camD();
  for (let i = soldiers.length - 1; i >= 0; i--) { const s = soldiers[i];
    if (s.inHeli) { s.pos.x = s.inHeli.pos.x; s.pos.z = s.inHeli.pos.z; continue; }
    if (!s.alive) { s.deadT += dt; if (s.deadT > 30) { battleRoot.remove(s.root); scene.remove(s.bar.g); soldiers.splice(i, 1); continue; } }
    else {
      s.recoil = Math.max(0, s.recoil - dt * 8);
      if (s.target && (!alive(s.target) || wdist2(s.pos.x, s.pos.z, s.target.pos.x, s.target.pos.z) > SOLD_RANGE * 1.6)) s.target = null;
      if (!s.target && (!s.order || s.order.type !== 'move')) { let best = null, bd = SOLD_RANGE; for (const e of soldierTargets(s)) { const d = wdist2(s.pos.x, s.pos.z, e.pos.x, e.pos.z); if (d < bd) { bd = d; best = e; } } s.target = best; }
      let goal = null, want = 0;
      if (s.order && s.order.type === 'board' && (!alive(s.order.heli) || !s.order.heli.tr)) s.order = null;
      if (s.order && (s.order.type === 'move' || s.order.type === 'board')) { if (!s.order.path) s.order.path = offroad({ x: s.pos.x, z: s.pos.z }, { x: s.order.x, z: s.order.z }, [], true);
        const P = s.order.path; while (P.length > 1 && wdist2(s.pos.x, s.pos.z, P[0].x, P[0].z) < 0.15) P.shift(); goal = P[0]; want = SOLD_SPEED[1];
        if (P.length === 1 && wdist2(s.pos.x, s.pos.z, goal.x, goal.z) < (s.order.type === 'board' ? 0.3 : 0.08)) { if (s.order.type === 'board') { goal = null; want = 0; } else s.order = null; } }   /* boarding troops wait at the landing spot */
      else if (s.target) { const d = wdist2(s.pos.x, s.pos.z, s.target.pos.x, s.target.pos.z); if (d > SOLD_RANGE * 0.9) { goal = s.target.pos; want = SOLD_SPEED[1]; } }
      if (goal) { const dx = wd(goal.x - s.pos.x), dz = wd(goal.z - s.pos.z), yaw = Math.atan2(dx, dz); let dy = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw)); s.yaw += clamp(dy, -6 * dt, 6 * dt);
        s.speed += (want - s.speed) * Math.min(1, dt * 5);
        // step forward; if blocked, try angling off to either side; already inside an obstacle (spawned in a yard): walk out
        const free = (x, z) => Hd(x, z) > 2 / S * 1.1 && (!lotBlocked(x, z, []) || lotBlocked(s.pos.x, s.pos.z, [])); let moved = false;
        for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) { const a = s.yaw + off + (s.detour || 0), nx = wm(s.pos.x + Math.sin(a) * s.speed * dt), nz = wm(s.pos.z + Math.cos(a) * s.speed * dt);
          if (free(nx, nz)) { s.pos.x = nx; s.pos.z = nz; moved = true; if (off) s.detour = off * 0.5; else s.detour = (s.detour || 0) * 0.9; break; } }
        s.stuck = moved ? Math.max(0, (s.stuck || 0) - dt * 0.5) : (s.stuck || 0) + dt;
        if (!moved && s.stuck > 0.6) { s.detour = rand(-2.6, 2.6); s.yaw += s.detour * 0.5; }   // wedged in a corner: try a new heading
        if (s.stuck > 3 && s.order) { s.order.path = null; s.stuck = 0; s.replans = (s.replans || 0) + 1; if (s.replans > 3) { s.order = null; s.replans = 0; } }   /* replan, give up after a few tries */ s.state = 'move'; }
      else { s.speed += (0 - s.speed) * Math.min(1, dt * 6); s.state = s.speed > 0.03 ? 'move' : 'idle'; }
      // shooting: face the target, fire short bursts while standing
      if (s.target && !goal) { const T = s.target, dx = wd(T.pos.x - s.pos.x), dz = wd(T.pos.z - s.pos.z), yaw = Math.atan2(dx, dz); let dy = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw)); s.yaw += clamp(dy, -5 * dt, 5 * dt);
        s.state = 'fire'; s.fireT -= dt; if (s.fireT <= 0 && Math.abs(dy) < 0.3) { soldierFire(s, T); s.fireT = s.shots % 4 === 3 ? rand(0.9, 1.6) : 0.12; } }
      // gait phase follows the distance walked, so feet don't slide
      const stride = s.speed > 0.2 ? 0.17 : 0.12; s.ph = (s.ph + s.speed * dt / stride) % 1;
      s.pos.y = Hd(s.pos.x, s.pos.z); }
    poseSoldier(s, dt); s.root.position.set(disp(s.pos.x, c.x), s.pos.y, disp(s.pos.z, c.z)); s.root.rotation.y = s.yaw;
    placeBar(s, s.root.position.x * S, (s.pos.y + SOLD_H) * S, s.root.position.z * S, s.alive); } }
function spawnSquad(team, n) { const t = towns[team]; for (let i = 0; i < n; i++) { const a = rand(0, 6.28), r = rand(1.2, 2.4); let x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
  for (let k = 0; k < 30 && (lotBlocked(wm(x), wm(z), []) || roadAt(x * S, z * S) > 0.5); k++) { x += rand(-0.4, 0.4); z += rand(-0.4, 0.4); } makeSoldier(team, x, z, i % 2); } }
// ------------------------------------------------------------------ air transport: soldiers board gunships
// A gunship carries up to 6 soldiers. Told to pick them up it lands beside them and they walk aboard; given a destination
// while carrying troops it lands there and they jump out (DEPLOY unloads wherever it is).
const HELI_SEATS = 6;
function trGoal(h, dt) { const tr = h.tr, gy = Math.max(Hd(tr.x, tr.z), 0), d = wdist2(h.pos.x, h.pos.z, tr.x, tr.z);
  if (d > 0.25) { tr.down = false; return { x: tr.x, z: tr.z, y: Math.max(gy, Hd(h.pos.x, h.pos.z), 0) + 1.35 }; }
  const G = { x: tr.x, z: tr.z, y: gy + h.skid, land: true }; if (h.pos.y > G.y + 0.06) return G;
  // on the ground
  if (!tr.down) { tr.down = true; tr.t = 0; FX.dust(new THREE.Vector3(tr.x, gy, tr.z), 14, { size: [0.1, 0.5], life: [0.6, 1.2], vel: 0.8, up: 0.05, a: 0.4 }); }
  tr.t += dt; h.vel.set(0, 0, 0);
  if (tr.phase === 'pickup') { for (const s of soldiers) if (s.alive && !s.inHeli && s.order && s.order.type === 'board' && s.order.heli === h && wdist2(s.pos.x, s.pos.z, h.pos.x, h.pos.z) < 0.45) boardHeli(s, h);
    const coming = soldiers.some(s => s.alive && !s.inHeli && s.order && s.order.type === 'board' && s.order.heli === h);
    if ((!coming && tr.t > 1.5) || tr.t > 25 || h.cargo.length >= HELI_SEATS) { h.tr = null; if (h.cargo.length && h.team === 0) log(0, `<b>${unitName(h)}</b> lifts off with ${h.cargo.length} soldier${h.cargo.length > 1 ? 's' : ''}`); } }
  else if (tr.phase === 'drop') { tr.dt = (tr.dt || 0) - dt; if (tr.dt <= 0 && h.cargo.length) { tr.dt = 0.3; unloadOne(h); } if (!h.cargo.length && tr.t > 0.8) h.tr = null; }
  return G; }
function boardHeli(s, h) { if (h.cargo.length >= HELI_SEATS) { s.order = null; return; } s.inHeli = h; s.sel = false; s.order = null; s.target = null; s.root.visible = false; s.bar.g.visible = false; h.cargo.push(s); }
function unloadOne(h) { const s = h.cargo.shift(), k = HELI_SEATS - h.cargo.length, a = h.yaw + Math.PI / 2 + (k % 2 ? 1 : -1) * (0.4 + k * 0.25);
  s.inHeli = null; s.pos.set(wm(h.pos.x + Math.sin(a) * 0.35), 0, wm(h.pos.z + Math.cos(a) * 0.35)); s.pos.y = Hd(s.pos.x, s.pos.z); s.yaw = a; s.root.visible = true; s.speed = 0; s.state = 'idle';
  s.order = { type: 'move', x: wm(s.pos.x + Math.sin(a) * 0.4), z: wm(s.pos.z + Math.cos(a) * 0.4) }; }
// orders from the interface
function orderBoard(sel, h) { const troops = sel.filter(u => u.kind === 'soldier' && !u.inHeli).slice(0, HELI_SEATS - h.cargo.length); if (!troops.length) return;
  let cx = 0, cz = 0; for (const s of troops) { cx += wd(s.pos.x - troops[0].pos.x); cz += wd(s.pos.z - troops[0].pos.z); } cx = wm(troops[0].pos.x + cx / troops.length); cz = wm(troops[0].pos.z + cz / troops.length);
  // land on open ground near the group
  let best = { x: cx, z: cz }; for (let i = 0; i < 40; i++) { const a = rand(0, 6.28), r = rand(0, 1.2), x = wm(cx + Math.cos(a) * r), z = wm(cz + Math.sin(a) * r); if (Hd(x, z) > 2 / S * 1.2 && !lotBlocked(x, z, []) && roadAt(x * S, z * S) < 0.5) { best = { x, z }; break; } }
  h.tr = { phase: 'pickup', x: best.x, z: best.z }; h.target = null; h.anchor = { x: best.x, z: best.z }; if (h.mode === 'landed') h.mode = 'takeoff';
  for (const s of troops) { s.order = { type: 'board', heli: h, x: best.x, z: best.z }; s.target = null; s.stuck = 0; }
  log(troops[0].team, `${troops.length} soldier${troops.length > 1 ? 's' : ''} boarding <b>${unitName(h)}</b>`); }
function orderDrop(h, x, z) { h.tr = { phase: 'drop', x, z }; h.target = null; h.anchor = { x, z }; if (h.mode === 'landed') h.mode = 'takeoff'; }
// ------------------------------------------------------------------ mech hangars
// One bay per hangar. Mechs come in to be repaired, to be brought up to the team's researched upgrades, and new mechs are
// built in the bay. Mechs waiting their turn stand in line on the apron. Research here is team-wide: mechs built afterwards
// come out with it, older mechs get it by visiting a hangar (UPGRADE).
let hangarProto = null, hangarClips = null, HANGAR_ERR = null; const hangars = [], HG_K = 0.075, HG_COST = 1800, HG_HP = 3000, MECH_BUILD = 40;
const HG_EXT = [-20, 20, -13.5, 22], HG_BAY = [0, 0], HG_DOOR = [0, 16.5], HG_OUT = [0, 30];
const MECH_UP = [0, 1].map(() => ({ weapons: 0, armor: 0, boost: 0, repair: 0 })), mechResearch = [null, null];
const MECH_UPGRADES = {
  weapons: { name: 'Weapon systems', desc: '+15% weapon damage per level', cost: [800, 1300, 2000], time: [30, 40, 50] },
  armor: { name: 'Armour plating', desc: '+20% hull per level', cost: [800, 1300, 2000], time: [30, 40, 50] },
  boost: { name: 'Boosters', desc: '+25% booster recharge per level', cost: [600, 1000, 1600], time: [25, 35, 45] },
  repair: { name: 'Repair rigs', desc: '+50% repair speed per level', cost: [500, 900, 1400], time: [20, 30, 40] } };
const MECH_COST = { striker: 900, gunner: 1000 };
const mechLvl = f => f.lvl || (f.lvl = { weapons: 0, armor: 0, boost: 0 });
const needsUpgrade = f => { const L = mechLvl(f), T = MECH_UP[f.team]; return L.weapons < T.weapons || L.armor < T.armor || L.boost < T.boost; };
function applyMechLevels(f, levels) { const L = mechLvl(f); Object.assign(L, levels); const m = 1000 * (1 + 0.2 * L.armor); f.hp += m - f.maxHp; f.maxHp = m; }
const hgLocal = (h, x, z) => { const dx = wd(x - h.x), dz = wd(z - h.z), c = Math.cos(h.rot), s = Math.sin(h.rot); return { lx: (dx * c - dz * s) / HG_K, lz: (dx * s + dz * c) / HG_K }; };
const hgWorld = (h, lx, lz) => { const c = Math.cos(h.rot), s = Math.sin(h.rot); return { x: wm(h.x + (lx * c + lz * s) * HG_K), z: wm(h.z + (-lx * s + lz * c) * HG_K) }; };
const inHangarLot = (h, x, z, m = 0) => { const { lx, lz } = hgLocal(h, x, z), mm = m / HG_K; return lx > HG_EXT[0] - mm && lx < HG_EXT[1] + mm && lz > HG_EXT[2] - mm && lz < HG_EXT[3] + mm; };
function prepareHangar(g) { hangarProto = g.scene; hangarClips = g.animations; }
function canPlaceHangar(team, xw, zw, rot = 0) { if (!hangarProto) return 'Hangar model still loading'; const h = { x: wm(xw / S), z: wm(zw / S), rot }; let lo = 1e9, hi = -1e9;
  for (let i = 0; i <= 5; i++) for (let j = 0; j <= 6; j++) { const q = hgWorld(h, HG_EXT[0] + (HG_EXT[1] - HG_EXT[0]) * i / 5, HG_EXT[2] + (HG_EXT[3] + 14 - HG_EXT[2]) * j / 6);
    if (!inTerritory(team, q.x, q.z)) return 'Must fit inside your territory';
    const y = Hd(q.x, q.z); if (y < 2 / S * 1.2) return 'Cannot build on water'; lo = Math.min(lo, y); hi = Math.max(hi, y);
    if (roadAt(q.x * S, q.z * S) > 0.5 && j < 6) return 'Blocked by a road';
    if (groundLocked(q.x * S, q.z * S, null)) return 'Too close to another building';
    for (const f of oilFields) if (wdist2(f.x, f.z, q.x, q.z) < OIL_R) return 'Oil fields are for oil pumps';
    for (const pr of propsNear(q.x, q.z)) if (pr.alive && wdist2(pr.x, pr.z, q.x, q.z) < pr.r + 0.15) return 'Blocked by a building'; }
  if (hi - lo > 1.1) return 'Ground too uneven'; return null; }
function makeHangarModel(ghost) { const g = hangarProto.clone(true); g.scale.setScalar(HG_K); const holder = new THREE.Group(); holder.add(g);
  g.traverse(o => { if (!o.isMesh) return; o.castShadow = !ghost; o.receiveShadow = true; if (ghost) o.material = GHOST_MAT; }); return holder; }
function buildHangar(team, xw, zw, rot = 0) { if (!hangarProto) return null; const h = { kind: 'hangar', team, x: wm(xw / S), z: wm(zw / S), rot };
  let sum = 0, n = 0; for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) { const q = hgWorld(h, HG_EXT[0] + (HG_EXT[1] - HG_EXT[0]) * i / 5, HG_EXT[2] + (HG_EXT[3] - HG_EXT[2]) * j / 5); sum += Hd(q.x, q.z); n++; }
  h.y = Math.max(2 / S * 1.3, sum / n);
  if (window.levelTerrain) { levelTerrain(h.x * S, h.z * S, 4.5 * S, (xw2, zw2) => { if (groundLocked(xw2, zw2, null)) return 0; const { lx, lz } = hgLocal(h, xw2 / S, zw2 / S);
      const d = Math.hypot(Math.max(HG_EXT[0] - 1 - lx, lx - HG_EXT[1] - 1, 0), Math.max(HG_EXT[2] - 1 - lz, lz - HG_EXT[3] - 12, 0)) * HG_K; return smoothW(d, 1); }, h.y * S); refreshOilNear(h.x, h.z, 4.5); }
  h.obj = makeHangarModel(false); h.obj.rotation.y = rot; battleRoot.add(h.obj);
  h.mixer = new THREE.AnimationMixer(h.obj.children[0]); h.doorOpen = false; h.doorAct = null;
  Object.assign(h, { hp: HG_HP, maxHp: HG_HP, alive: true, vel: new THREE.Vector3(), pos: new THREE.Vector3(h.x, h.y + 0.6, h.z), queue: [], bay: null, job: null, buildQ: [], buildT: 0, outT: 0 });
  hangars.push(h); if (window.clearTreesIn) clearTreesIn((x2, z2) => inHangarLot(h, x2 / S, z2 / S, 0.3));
  startSite(h, [HG_EXT[0] * HG_K, HG_EXT[1] * HG_K, HG_EXT[2] * HG_K, 13 * HG_K], 35.2 * HG_K, 45, () => log(team, `<b>${TEAM_NAME[team]}</b> mech hangar open`)); return h; }
function setDoors(h, open) { if (h.doorOpen === open || !hangarClips) return; h.doorOpen = open; const clip = hangarClips.find(c => c.name === (open ? 'Open' : 'Close')); if (!clip) return;
  h.openAge = 0; if (h.doorAct) h.doorAct.stop(); const a = h.mixer.clipAction(clip); a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); h.doorAct = a; }
function hangarAt(pos) { for (const h of hangars) if (h.alive && wdist2(h.x, h.z, pos.x, pos.z) < 3 && inHangarLot(h, pos.x, pos.z) && hgLocal(h, pos.x, pos.z).lz < 13 && pos.y < h.y + 35 * HG_K) return h; return null; }
function hangarHit(h, amount) { if (!h.alive) return; h.hp -= amount; if (h.team === 0 && window.onOutpostAlert && !(h.alertT > 0)) { h.alertT = 20; window.onOutpostAlert('HANGAR UNDER ATTACK', 'Your mech hangar is taking damage.', { x: h.x * S, z: h.z * S }); }
  if (h.hp <= 0) { h.alive = false; const v = new THREE.Vector3(h.x, h.y + 0.6, h.z); FX.explosion(v, 1.6); addShake(0.4, v); fires.push({ x: h.x, z: h.z, t: 30 }); scorchMarks.add(h.x, h.z, 0, 2.2, 2.2);
    h.obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.multiplyScalar(0.25); } }); h.obj.children[0].scale.y *= 0.45;
    if (h.bay) release(h); for (const f of h.queue) { f.svc = null; f.order = null; } h.queue.length = 0; log(h.team, `<b>${TEAM_NAME[h.team]}</b> mech hangar destroyed`); } return 'hit'; }
function hangarImpact(pt, radius, power, kind) { for (const h of hangars) { if (!h.alive || wdist2(h.x, h.z, pt.x, pt.z) > radius + 3) continue; if (!hangarAt(pt) && !hangarAt(new THREE.Vector3(pt.x, pt.y - radius, pt.z))) continue;
  hangarHit(h, kind === 'bullet' ? 3 : kind === 'step' || kind === 'body' ? 0 : 50 * power); } }
// ---- service queue: send a mech to the nearest hangar that will take it soonest
function requestService(f, mode) { if (f.state === 'ko' || f.docked) return 'busy'; const H = hangars.filter(h => h.alive && h.done && h.team === f.team); if (!H.length) return 'No mech hangar';
  if (f.svc) { f.svc.mode = mode; return null; }
  const h = H.sort((a, b) => (a.queue.length + (a.bay || a.buildQ.length ? 1 : 0)) * 4 + wdist2(a.x, a.z, f.pos.x, f.pos.z) - (b.queue.length + (b.bay || b.buildQ.length ? 1 : 0)) * 4 - wdist2(b.x, b.z, f.pos.x, f.pos.z))[0];
  f.svc = { h, mode }; f.target = null; h.queue.push(f); placeQueue(h); return null; }
function cancelService(f) { if (!f.svc) return; const h = f.svc.h; h.queue = h.queue.filter(x => x !== f); f.svc = null; placeQueue(h); }
// the head of the line walks to the door when the bay is free, the rest wait in a row on the apron
function placeQueue(h) { h.queue = h.queue.filter(f => f.svc && f.svc.h === h && f.state !== 'ko');
  h.queue.forEach((f, i) => { const free = !h.bay && !h.building && i === 0, p = free ? hgWorld(h, HG_DOOR[0], HG_DOOR[1]) : hgWorld(h, (i - (h.bay || h.building ? 0 : 1) - 1.5) * 11 - 0, 34);
    if (!f.order || f.order.x !== p.x || f.order.z !== p.z) { f.order = { type: 'move', x: p.x, z: p.z }; f.target = null; f.thinkT = 0; f.svc.head = free; } }); }
function dock(h, f) { h.queue = h.queue.filter(x => x !== f); h.bay = f; f.docked = h; const b = hgWorld(h, HG_BAY[0], HG_BAY[1]); f.pos.x = b.x; f.pos.z = b.z; f.vel.set(0, 0, 0); f.yaw = h.rot; f.order = null; f.target = null; f.path = null;
  if (!['idle', 'walk'].includes(f.state)) toIdle(f, 0.2, 99); else toIdle(f, 0.2, 99);
  const T = MECH_UP[f.team], L = mechLvl(f), lv = (T.weapons - L.weapons) + (T.armor - L.armor) + (T.boost - L.boost);
  h.job = { f, mode: f.svc.mode, t: 0, upTime: f.svc.mode === 'upgrade' && lv > 0 ? lv * 10 : 0 }; f.svc = null; placeQueue(h); }
// the finished mech stays in the bay until the doors are fully open, then walks out
const doorsReady = h => h.doorOpen && h.openAge >= ((hangarClips && (hangarClips.find(c => c.name === 'Open') || {}).duration) || 2);
function undock(h) { h.job = null; }
function release(h) { const f = h.bay; h.bay = null; h.job = null; if (!f) return; f.docked = null; const o = hgWorld(h, HG_OUT[0], HG_OUT[1]); f.order = { type: 'move', x: o.x, z: o.z }; f.thinkT = 0; h.outT = 4; placeQueue(h); }
function updateHangars(dt) { const c = camD();
  for (const h of hangars) { h.obj.position.set(disp(h.x, c.x), h.y, disp(h.z, c.z)); h.alertT = (h.alertT || 0) - dt; if (!h.alive) continue;
    if (Math.hypot(wd(h.x * S - cam.x), wd(h.z * S - cam.z)) < 1200) h.mixer.update(dt); if (!h.done) continue;
    h.outT = Math.max(0, h.outT - dt); h.openAge = (h.openAge || 0) + dt; if (h.bay && !h.job && doorsReady(h)) release(h);
    // head of the queue reached the door: in it goes
    const head = h.queue[0]; if (head && !h.bay && !h.building && doorsReady(h) && head.svc && head.svc.head && !head.order && wdist2(head.pos.x, head.pos.z, ...Object.values(hgWorld(h, HG_DOOR[0], HG_DOOR[1]))) < 0.7) dock(h, head);
    if (head && head.svc && !head.order && !(head.svc.head)) placeQueue(h);
    // work on the docked mech: repair, then the upgrade; out it goes when done
    const J = h.job; if (J) { const f = J.f; if (f.state === 'ko' || !robots.includes(f)) { h.bay = null; h.job = null; placeQueue(h); }
      else { J.t += dt; const rate = f.maxHp / 30 * (1 + 0.5 * MECH_UP[f.team].repair); f.hp = Math.min(f.maxHp, f.hp + rate * dt); f.boost = 100;
        if (chance(dt * 6)) { const sp = hgWorld(h, rand(-4, 4), rand(-2, 4)); FX.sparks(new THREE.Vector3(sp.x, h.y + rand(0.3, 1.2), sp.z), 3, [1, 0.8, 0.4], 0.8); }
        if (J.upTime && J.t >= J.upTime) { applyMechLevels(f, { ...MECH_UP[f.team] }); J.upTime = 0; delete mechLvl(f).repair; log(f.team, `<b>${unitName(f)}</b> upgraded at the hangar`); }
        if (!J.upTime && f.hp >= f.maxHp) undock(h); } }
    // building a mech: only with an empty bay
    if (!h.bay && h.buildQ.length && !h.queue.some(f => f.svc && f.svc.head && wdist2(f.pos.x, f.pos.z, ...Object.values(hgWorld(h, HG_DOOR[0], HG_DOOR[1]))) < 1.5)) { h.building = true; h.buildT += dt;
      if (chance(dt * 8)) { const sp = hgWorld(h, rand(-4, 4), rand(-3, 3)); FX.sparks(new THREE.Vector3(sp.x, h.y + rand(0.2, 1.6), sp.z), 4, [1, 0.85, 0.5], 1); }
      if (h.buildT >= MECH_BUILD) { h.buildT = 0; h.building = false; const role = h.buildQ.shift(), b = hgWorld(h, HG_BAY[0], HG_BAY[1]), f = makeRobot(h.team, role, b.x, b.z); f.yaw = h.rot; applyMechLevels(f, { weapons: MECH_UP[h.team].weapons, armor: MECH_UP[h.team].armor, boost: MECH_UP[h.team].boost }); f.hp = f.maxHp;
        h.bay = f; f.docked = h; h.job = null; undock(h); log(h.team, `<b>${TEAM_NAME[h.team]}</b> new ${role} rolls out of the hangar`); } }
    else h.building = false;
    setDoors(h, !!(h.bay && !h.job) || h.outT > 0 || !!(h.queue[0] && h.queue[0].svc && h.queue[0].svc.head && wdist2(h.queue[0].pos.x, h.queue[0].pos.z, h.x, h.z) < 3.2)); }
  for (const team of [0, 1]) { const r = mechResearch[team]; if (!r) continue; if (!hangars.some(h => h.alive && h.done && h.team === team)) { mechResearch[team] = null; continue; }
    r.t += dt; if (r.t >= r.total) { mechResearch[team] = null; MECH_UP[team][r.key]++; log(team, `<b>${TEAM_NAME[team]}</b> research complete: ${MECH_UPGRADES[r.key].name} ${['I', 'II', 'III'][MECH_UP[team][r.key] - 1]}`); } } }
function startMechResearch(team, key) { if (mechResearch[team]) return 'Already researching'; if (!hangars.some(h => h.alive && h.done && h.team === team)) return 'Needs a finished hangar';
  const U = MECH_UPGRADES[key], lv = MECH_UP[team][key]; if (lv >= U.cost.length) return 'Fully upgraded'; mechResearch[team] = { key, t: 0, total: U.time[lv] }; return null; }
function queueMech(h, role) { if (!h.alive || !h.done) return 'Hangar not ready'; if (h.buildQ.length >= 3) return 'Build queue full'; h.buildQ.push(role); return null; }
// ---- smashing cars: robots crush them underfoot, weapons blow them up; wrecks burn, then explode
function carStomp(x, z, rad) {   // a foot or a landing robot comes down here (demo units)
  for (const car of cars) { if (car.dead || car.wx === undefined) continue; const dx = wd(car.wx / S - x), dz = wd(car.wz / S - z);
    const along = Math.abs(dx * (car.hx || 0) + dz * (car.hz || 1)), across = Math.abs(dx * (car.hz || 1) - dz * (car.hx || 0));
    if (along < car.len / S / 2 + rad && across < 1.0 / S + rad) { wreckCar(car, true); addShake(0.1, new THREE.Vector3(x, 0, z)); } } }
function carImpact(pt, radius, power, kind) {   // pt in demo units
  for (const car of cars) { if (car.dead || car.wx === undefined) continue;
    const d = Math.hypot(wd(car.wx / S - pt.x), wd(car.wz / S - pt.z)); if (d > radius + 0.22) continue;
    car.hp -= kind === 'bullet' ? 8 : kind === 'step' ? 0 : 40 * power; if (car.hp <= 0) wreckCar(car, false); } }
function wreckCar(car, crushed) {
  car.dead = true; car.v = 0; car.burn = rand(3, 7); car.fireT = rand(14, 24);
  const x = car.wx / S, z = car.wz / S, y = Hd(x, z) + 0.03;
  car.obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.55); o.material.roughness = 1; } });
  const mdl = car.obj.children[0], bodyM = mdl.children[0];
  if (bodyM && bodyM.geometry) {                                                     // cave the cabin in: roof and pillars fold down, sides bulge, random dents
    const g = bodyM.geometry.clone(), pa = g.attributes.position; g.computeBoundingBox(); const bb = g.boundingBox, H = bb.max.y - bb.min.y, cz = (bb.min.z + bb.max.z) / 2;
    const fx = rand(-0.3, 0.3), kfold = crushed ? 0.38 : 0.8;
    for (let i = 0; i < pa.count; i++) { let y = pa.getY(i), x = pa.getX(i), z = pa.getZ(i); const hN = (y - bb.min.y) / H;
      if (hN > 0.35) { const u = (hN - 0.35) / 0.65, dent = 1 - 0.25 * Math.exp(-((x / (bb.max.x - bb.min.x) - fx) ** 2) * 20); y = bb.min.y + H * (0.35 + u * 0.65 * kfold * dent);
        z = cz + (z - cz) * (1 + (crushed ? 0.12 : 0.04) * (1 - u)); }
      y += (Math.sin(x * 97 + z * 61) * 0.5 + 0.5) * H * (crushed ? 0.03 : 0.015) * (hN > 0.2 ? -1 : 0);
      pa.setXYZ(i, x, y, z); }
    g.computeVertexNormals(); bodyM.geometry = g; }
  mdl.rotation.set(0, 0, 0); mdl.rotateX(rand(-0.06, 0.06)); mdl.rotateZ(rand(-0.08, 0.08)); if (!crushed) mdl.position.y += 0.05;
  for (const w of car.wheels) { w.rotation.x += rand(-0.35, 0.35); if (crushed) w.scale.y *= 0.8; }
  FX.sparks(new THREE.Vector3(x, y, z), crushed ? 14 : 22, [1, 0.7, 0.35], 1.2); FX.dust(new THREE.Vector3(x, y, z), 10, { size: [0.05, 0.3], life: [0.6, 1.4], vel: 0.35, up: 0.1, a: 0.5 });
  if (!car.noFire) fires.push({ x, z, t: car.fireT }); if (!crushed) FX.explosion(new THREE.Vector3(x, y, z), 0.55);
}
function updateCars(dt) {
  if (!cars.length) return; const { chains, at } = ROAD_NET;
  for (const car of cars) {
    if (car.dead) { if (car.burn > 0) { car.burn -= dt; if (car.burn <= 0) { const x = car.wx / S, z = car.wz / S, p3 = new THREE.Vector3(x, Hd(x, z) + 0.04, z);   // fuel tank goes up
          FX.explosion(p3, 0.9); addShake(0.2, p3); scorchMarks.add(x, z, 0, 0.3, 0.3); car.obj.children[0].position.y += 0.02; impact(p3, 0.18, null, 1.2, 'blast'); } }
      continue; }
    // robots in the road ahead: brake and wait (cars never drive into them)
    let robotBlock = false; if (car.wx !== undefined && car.hx !== undefined) for (const r of robots) { if (r.state === 'ko') continue;
      const rx = wd(r.pos.x * S - car.wx), rz = wd(r.pos.z * S - car.wz), ahead = rx * car.hx + rz * car.hz, lat = Math.abs(rx * car.hz - rz * car.hx);
      if (ahead > -2 && ahead < 26 && lat < 7) { robotBlock = true; break; } }
    const c = chains[car.c];
    if (car.park > 0) {                                                                // parked at the kerb
      car.v = 0; car.lat += (PARK_LAT - car.lat) * (1 - Math.pow(0.2, dt)); car.park -= dt;
      if (car.park <= 0) { car.park = 0; car.dir = Math.random() < 0.5 ? 1 : -1; planTrip(car); }
    } else {
      let gap = 1e9; for (const o of cars) if (o !== car && !o.dead && o.c === car.c && o.dir === car.dir && !o.park) { const d = (o.s - car.s) * car.dir; if (d > 0 && d < gap) gap = d; }
      const q0 = roadSample(c, car.s), town = !q0.wet && c.town[Math.round(clamp(car.s / c.len, 0, 1) * c.n)];
      let want = Math.min(car.vmax * (town ? 1 : 1.6), Math.max(0, (gap - car.len - CAR_LEN * 0.8) * 1.2)); if (robotBlock) want = 0;
      const T = car.target, last = T && T.c === car.c && !car.route.length;
      if (last) { const togo = (T.s - car.s) * car.dir; want = Math.min(want, Math.max(0, togo) * 0.8 + 0.3);
        if (togo <= 0.3) { car.park = rand(40, 150); car.target = null; } }
      car.v += (want - car.v) * (1 - Math.pow(0.15, dt)); car.lat += ((last ? PARK_LAT : LANE) - car.lat) * (1 - Math.pow(last ? 0.3 : 0.05, dt));
      car.s += car.dir * car.v * dt;
      if (roadSample(c, car.s + car.dir * 6).wet) { car.dir = -car.dir; planTrip(car); }
      if (car.s > c.len || car.s < 0) {                                                // reached a node: follow the route (or wander if lost)
        const node = car.s > c.len ? c.b : c.a, over = car.s > c.len ? car.s - c.len : -car.s;
        let pick = car.route.length ? car.route.shift() : null;
        if (!pick) { const opts = at[node].filter(o => o.i !== car.c); pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : { i: car.c, start: car.s < 0 }; }
        car.c = pick.i; const nc = chains[car.c]; car.dir = pick.start ? 1 : -1; car.s = pick.start ? over : nc.len - over;
        if (!car.target) planTrip(car);
      }
    }
    for (const w of car.wheels) w.rotation.z += car.v * dt / Math.max(0.05, car.rad) * (w.rotation.y ? -1 : 1);
    const q = roadSample(chains[car.c], car.s), hx = q.tx * car.dir, hz = q.tz * car.dir;
    const x = q.x - hz * car.lat, z = q.z + hx * car.lat; car.wx = x; car.wz = z;
    car.hx = hx; car.hz = hz; const yaw = Math.atan2(hx, hz);
    if (car.yaw === null) car.yaw = yaw; let dy = yaw - car.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); car.yaw += dy * (1 - Math.pow(0.02, dt));
    let hf = heightAt(x + hx * 1.8, z + hz * 1.8), hb = heightAt(x - hx * 1.8, z - hz * 1.8); { const by = bridgeY(chains[car.c], car.s); if (by !== null) hf = hb = by; }
    const dxw = x + SIZE * Math.round((cam.x - x) / SIZE), dzw = z + SIZE * Math.round((cam.z - z) / SIZE);
    car.obj.position.set(dxw, (hf + hb) / 2 + 0.35, dzw); car.obj.rotation.set(0, 0, 0); car.obj.rotateY(car.yaw + CAR_FWD);
    car.obj.visible = Math.hypot(dxw - cam.x, dzw - cam.z) < FOG_FAR + 100;
  }
}
const CAR_FWD = Math.PI / 2;    // the vehicles' noses point along -x

// ------------------------------------------------------------------ pedestrians: 8 people from a T-pose sheet, animated in the vertex shader
// (no skeleton in the model): arms are rotated down to the sides about the shoulders, legs and arms swing for walk / run, a slight
// sway for idle. Each person type is one InstancedMesh; aAnim = (phase, cadence, swing, arms-down) per instance.
let pedProto = null; const peds = [], pedKinds = [], PED_H = 1.7, PED_UNIFORM = { value: 0 };
function splitPeople(root) {
  let mesh = null; root.updateMatrixWorld(true); root.traverse(o => { if (o.isMesh && !mesh) mesh = o; }); if (!mesh) return [];
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld);
  const pos = g.attributes.position, nt = pos.count / 3, box = new THREE.Box3().setFromBufferAttribute(pos), midY = (box.min.y + box.max.y) / 2, cw = (box.max.x - box.min.x) / 4;
  const cells = Array.from({ length: 8 }, () => []);
  for (let t = 0; t < nt; t++) { let cx = 0, cy = 0; for (let v = 0; v < 3; v++) { cx += pos.getX(t * 3 + v); cy += pos.getY(t * 3 + v); } cx /= 3; cy /= 3;
    const col = clamp(Math.floor((cx - box.min.x) / cw), 0, 3), row = cy > midY ? 0 : 1; cells[row * 4 + col].push(t); }
  return cells.filter(c => c.length > 100).map(ts => { const out = new THREE.BufferGeometry();
    for (const name in g.attributes) { const a = g.attributes[name], arr = new a.array.constructor(ts.length * 3 * a.itemSize);
      ts.forEach((t, i) => { for (let v = 0; v < 3; v++) for (let c = 0; c < a.itemSize; c++) arr[(i * 3 + v) * a.itemSize + c] = a.array[(t * 3 + v) * a.itemSize + c]; });
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized)); }
    out.computeBoundingBox(); const b = out.boundingBox, h = b.max.y - b.min.y; out.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); out.scale(PED_H / h, PED_H / h, PED_H / h); out.computeBoundingBox();
    return { geo: out, mat: mesh.material }; });
}
function pedMaterial(src) {
  const m = src.clone(); m.onBeforeCompile = sh => { sh.uniforms.uT = PED_UNIFORM;
    const pre = `attribute vec4 aAnim; uniform float uT;
      mat3 rX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
      mat3 rY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
      mat3 rZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
      void rot(inout vec3 p, inout vec3 n, mat3 R, vec3 piv, float w){ vec3 q = R*(p-piv)+piv; p = mix(p, q, w); n = normalize(mix(n, R*n, w)); }
      // procedural gait from gait-cycle curves (t: 0 heel strike, ~.6 toe off, swing after); model faces +z
      float g(float t, float c, float w){ float d = t - c; d -= floor(d + .5); return exp(-d*d/(w*w)); }
      void pedPose(inout vec3 p, inout vec3 n){
        float H=${PED_H.toFixed(3)}, TAU=6.2831853, amp=aAnim.z, st=fract(aAnim.y*7.13), side=sign(p.x+1e-5);
        float run = smoothstep(.6, .9, amp), A = min(1., amp/.55) * (.9 + .2*st);
        float tR = fract(aAnim.x/TAU), t = fract(tR + (side > 0. ? 0. : .5));
        // hip flexion (+ = thigh forward), knee flexion, ankle (+ = toes up)
        float hipW = .07 + .30*cos(TAU*(t - .03)) + .04*cos(2.*TAU*(t - .1));
        float hipR = .15 + .55*cos(TAU*(t - .08));
        float knW = .06 + .30*g(t, .13, .07) + 1.05*g(t, .72, .10);
        float knR = .15 + .65*g(t, .18, .09) + 1.75*g(t, .66, .14);
        float anW = .22*g(t, .0, .06) - .42*g(t, .58, .06) + .14*g(t, .8, .1);
        float anR = -.25*g(t, .05, .08) - .55*g(t, .38, .08) + .25*g(t, .75, .12);
        float hip = mix(hipW, hipR, run) * A, knee = mix(knW, knR, run) * A, ank = mix(anW, anR, run) * A;
        float isArm = smoothstep(.095*H, .125*H, abs(p.x)) * step(.66*H, p.y);
        float isLeg = (1. - smoothstep(.44*H, .52*H, p.y)) * (1. - isArm);
        if (isArm > 0.) {
          float fore = smoothstep(.24*H, .27*H, abs(p.x));
          float sw = -hip * (1.1 + .3*st);
          float elbow = .3 + .3*A + run*1.1 + max(0., sw)*.7;
          rot(p, n, rY(-side*elbow), vec3(side*.255*H, .8*H, 0.), fore*isArm);
          rot(p, n, rX(-sw) * rZ(-side*(aAnim.w - .1*run)), vec3(side*.105*H, .8*H, 0.), isArm);
        }
        if (isLeg > 0.) {
          float foot = 1. - smoothstep(.045*H, .075*H, p.y);
          float shin = 1. - smoothstep(.25*H, .29*H, p.y);
          rot(p, n, rX(-ank), vec3(side*.05*H, .05*H, 0.), foot*isLeg);
          rot(p, n, rX(knee), vec3(side*.05*H, .27*H, 0.), shin*isLeg);
          rot(p, n, rX(-hip), vec3(side*.05*H, .5*H, 0.), isLeg);
        }
        // pelvis twist and hip drop, torso counter-twist and lean
        float upper = smoothstep(.45*H, .6*H, p.y), s1 = sin(TAU*tR);
        rot(p, n, rY(-s1*A*.12) * rZ(sin(TAU*(tR - .1))*A*.05), vec3(0., .5*H, 0.), 1. - upper);
        rot(p, n, rY(s1*A*.16) * rX(run*.22 + A*.05), vec3(0., .5*H, 0.), upper);
        // two bounces per cycle: walking peaks at mid-stance, running peaks in flight; weight shifts over the stance foot
        float bob = cos(2.*TAU*(tR - .3));
        p.y += A*H*mix(.024*bob - .01, .045*cos(2.*TAU*(tR - .8)) - .03, run);
        p.x += cos(TAU*(tR - .25))*A*.02*H;
        rot(p, n, rZ(sin(uT*.6 + aAnim.y*3.)*.012*(1.-amp)), vec3(0.), upper);
      }`;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + pre)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vec3 pedP = position; pedPose(pedP, objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = pedP;'); };
  m.customProgramCacheKey = () => 'ped'; return m; }
function spawnPeds(count) {
  if (!pedProto || !ROAD_NET) return; const kinds = splitPeople(pedProto); if (!kinds.length) return;
  const { chains, nodes } = ROAD_NET, town = chains.map((c, i) => i).filter(nodes_town_ok);
  if (!town.length) return; const per = Math.ceil(count / kinds.length);
  kinds.forEach((K, ki) => { const geo = K.geo.clone(); geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(per * 4), 4));
    const im = new THREE.InstancedMesh(geo, pedMaterial(K.mat), per); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; scene.add(im); pedKinds.push(im);
    for (let i = 0; i < per; i++) { const c = town[Math.floor(Math.random() * town.length)];
      peds.push({ im, i, c, s: rand(3, chains[c].len - 3), dir: chance(.5) ? 1 : -1, side: chance(.5) ? 1 : -1, v: 0, mode: 'walk', t: rand(2, 12), ph: rand(0, 6.28), yaw: 0, spd: rand(0.95, 1.25), lat: rand(-0.3, 0.3) }); } }); }
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pv = new THREE.Vector3(), _ps = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
function updatePeds(dt) {
  if (!peds.length) return; PED_UNIFORM.value += dt; const { chains, at } = ROAD_NET, SW = ROAD_HW - 0.55;
  for (const p of peds) { const c = chains[p.c];
    // danger: robots or fire close by -> run away along the street
    let fear = null; for (const r of robots) { if (r.state === 'ko') continue; const q0 = roadSample(c, p.s), d = Math.hypot(wd(r.pos.x * S - q0.x), wd(r.pos.z * S - q0.z)); if (d < 55) { fear = { d, dot: (wd(r.pos.x * S - q0.x) * q0.tx + wd(r.pos.z * S - q0.z) * q0.tz) }; break; } }
    p.fleeT = (p.fleeT || 0) - dt;
    if (fear) { if (p.mode !== 'run' || (p.fleeT <= 0 && fear.dot * p.dir > 0 && fear.d < 30)) { p.dir = fear.dot > 0 ? -1 : 1; p.fleeT = rand(4, 6); } p.mode = 'run'; p.t = rand(3, 6); }   // pick a way to flee, then commit to it
    p.t -= dt; if (p.t <= 0) { if (p.mode === 'idle') { p.mode = 'walk'; p.t = rand(6, 20); if (chance(.3)) p.dir *= -1; } else { p.mode = chance(.35) ? 'idle' : 'walk'; p.t = p.mode === 'idle' ? rand(2, 7) : rand(6, 18); } }
    const want = p.mode === 'run' ? p.spd * 2.1 : p.mode === 'walk' ? p.spd : 0; p.v += (want - p.v) * Math.min(1, dt * 4);
    p.s += p.dir * p.v * dt;
    if (p.s < 0.5 || p.s > c.len - 0.5) { const node = p.s > c.len - 0.5 ? c.b : c.a, opts = (at[node] || []).filter(o => o.i !== p.c && nodes_town_ok(o.i));
      if (opts.length && (p.mode === 'run' || chance(.8))) { const o = opts[Math.floor(Math.random() * opts.length)]; p.c = o.i; p.dir = o.start ? 1 : -1; p.s = o.start ? 0.6 : chains[o.i].len - 0.6; }
      else { p.dir *= -1; p.s = clamp(p.s, 0.6, c.len - 0.6); p.fleeT = rand(3, 5); } }   // dead end: turn round and keep going that way
    const q = roadSample(chains[p.c], p.s), hx = q.tx * p.dir, hz = q.tz * p.dir, off = p.side * (SW + p.lat);
    const x = q.x - q.tz * off, z = q.z + q.tx * off, yaw = Math.atan2(hx, hz); let dy = yaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * Math.min(1, dt * 6);
    const dxw = x + SIZE * Math.round((cam.x - x) / SIZE), dzw = z + SIZE * Math.round((cam.z - z) / SIZE), far = Math.hypot(dxw - cam.x, dzw - cam.z) > 700;
    _pv.set(dxw, heightAt(x, z) + 0.35, dzw); _pq.setFromAxisAngle(_up, p.yaw); _ps.setScalar(far ? 0 : 1); _pm.compose(_pv, _pq, _ps); p.im.setMatrixAt(p.i, _pm);
    const k = Math.min(1, p.v / p.spd), run = p.mode === 'run', stride = (run ? 1.75 : 1.2 + 0.25 * p.lat) * Math.max(0.45, Math.min(1, k)), cad = 6.2832 * p.v / stride, sw = run ? 1.0 : 0.55 * k;
    p.gp = (p.gp || p.ph) + cad * dt; const a = p.im.geometry.attributes.aAnim; a.setXYZW(p.i, p.gp, p.ph, sw, 1.35); }   // phase accumulates, so speed changes never jump the stride
  for (const im of pedKinds) { im.instanceMatrix.needsUpdate = true; im.geometry.attributes.aAnim.needsUpdate = true; }
}
const nodes_town_ok = i => { const { chains, nodes } = ROAD_NET, c = chains[i]; return nodes[c.a].town === nodes[c.b].town && c.len < 90 && c.len > 2.5; };

// ------------------------------------------------------------------ robots
const TEAM_COL = [[1, 0.55, 0.8], [0.55, 0.85, 1]];
const TEAM_NAME = ['Violet', 'Cobalt'];
function recolor(mat) {
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('void main() {', `
      vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
        float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }
      vec3 cobalt(vec3 c){ vec3 h=rgb2hsv(c); float purple=smoothstep(0.50,0.56,h.x)*(1.-smoothstep(0.93,0.99,h.x))*smoothstep(0.06,0.16,h.y);   // navy/blue/purple panels
        vec3 blue=hsv2rgb(vec3(0.995,clamp(h.y*1.6,0.55,1.),h.z*1.35)); vec3 o=mix(c,blue,purple);
        float creamy=(1.-smoothstep(0.15,0.35,h.y))*smoothstep(0.35,0.6,h.z); o=mix(o,o*vec3(1.05,0.96,0.92),creamy); return o; }
      void main() {`).replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb=cobalt(diffuseColor.rgb);'); };
  mat.customProgramCacheKey = () => 'crimson';
}
const GUN_S = 0.34, GUN_SCALE = 1.6;   // rifle size, scaled about the grip
const robots = [], helis = [];
const _tmp = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), _fp = new THREE.Vector3();
function makeRobot(team, role, x, z) {
  const root = new THREE.Group(); const model = THREE.SkeletonUtils.clone(gltf.scene); const fit = new THREE.Group(); fit.scale.setScalar(MECH_K); fit.add(model); root.add(fit); root.scale.setScalar(RS); battleRoot.add(root);
  const mats = new Map();
  model.traverse(o => { if (o.isMesh && o.material && /^(Pilot|Winch)/.test(o.material.name)) o.visible = false; if (o.isMesh) { o.frustumCulled = false;
    const src = Array.isArray(o.material) ? o.material : [o.material]; const cl = src.map(m => { if (!mats.has(m)) mats.set(m, m.clone()); return mats.get(m); }); o.material = Array.isArray(o.material) ? cl : cl[0]; } });
  const bodyMats = []; for (const m of mats.values()) { if (/^(Gun|Saber)/.test(m.name)) continue; if (m.map) { m.roughness = 0.6; m.metalness = 0.2; bodyMats.push(m); }
    if (team === 1) { if (m.map) recolor(m); if (m.name === 'Weapon_Purple') m.color.set(0x6b1212).convertSRGBToLinear();
      if (m.name === 'Beam_Glow' || m.name === 'SaberBladeGlow') { m.color.setRGB(0.15, 0.75, 1.0); m.emissive.setRGB(0.1, 0.65, 1.0); } if (m.name === 'Beam_Core' || m.name === 'SaberBladeCore') m.emissive.setRGB(0.85, 0.97, 1.0); } }
  const mixer = new THREE.AnimationMixer(model); const actions = {}; for (const a of gltf.animations) actions[a.name] = mixer.clipAction(a);
  const n = name => model.getObjectByName(name);
  const nodes = { saber: n('Saber'), blade: n('SaberBlade'), gun: n('Gun'), muzzle: n('Gun_Muzzle') || n('Gun'),
    flashL: n('Vulcan_L'), flashR: n('Vulcan_R'), chest: n('Spine'), head: n('Head'), footL: n('Foot_L'), footR: n('Foot_R'), handL: n('Hand_L'), handR: n('Hand_R') };
  const col = TEAM_COL[team];
  const flameMat = new THREE.MeshBasicMaterial({ color: team ? 0x8fe3ff : 0xffa0d0, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending });
  const flames = []; for (const fx of [-0.045, 0.045]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.12, 10), flameMat); f.rotation.x = -Math.PI / 2; f.position.set(fx, 0.03, -0.13).divideScalar(MECH_K); f.scale.setScalar(1 / MECH_K); nodes.chest.add(f); flames.push(f); }
  // saber trail ribbon
  const TN = 22, tg = new THREE.BufferGeometry(); const tp = new Float32Array(TN * 2 * 3), ta = new Float32Array(TN * 2); const idx = [];
  for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  tg.setIndex(idx); tg.setAttribute('position', new THREE.BufferAttribute(tp, 3)); tg.setAttribute('alpha', new THREE.BufferAttribute(ta, 1));
  const tm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { c: { value: new THREE.Color(...col) } },
    vertexShader: `attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 c; varying float vA; void main(){ gl_FragColor=vec4(c*1.1,vA*0.45); }` });
  const trail = new THREE.Mesh(tg, tm); trail.frustumCulled = false; battleRoot.add(trail);
  const boneNames = ['Head', 'Spine', 'Hips', 'Shoulder_L', 'Shoulder_R', 'UpperArm_L', 'UpperArm_R', 'ForeArm_L', 'ForeArm_R', 'UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R'];
  const bones = boneNames.map(n).filter(Boolean);
  const f = { kind: 'robot', team, role, root, model, mixer, actions, nodes, flames, trail, trailHist: [], col, bodyMats, bones, wounds: [],
    pos: new THREE.Vector3(wm(x), 0, wm(z)), vel: new THREE.Vector3(), y: 0, vy: 0, yaw: rand(0, 6.28), hp: 1000, maxHp: 1000, state: 'idle', st: 0, clip: null, act: null,
    saberOut: false, cool: {}, hitDone: {}, fireAcc: 0, fireSide: 0, thinkT: rand(0, 0.5), bulletHits: 0, lastAction: '', lookT: 0, headQ: new THREE.Quaternion(),
    p: persona(role), boost: 100, strafeDir: 1, pending: null, airT: 0, gaitRate: rand(0.86, 1.14), idleName: 'Idle', idleRate: rand(0.78, 1.18), idleShiftT: rand(4, 12),
    lean: { x: rand(-0.06, 0.06), z: rand(-0.05, 0.05), y: rand(-0.12, 0.12), tx: 0, tz: 0, ty: 0, ph: rand(0, 6.28), sp: rand(0.25, 0.5) }, pilot: pilotStyle(), hopCool: 0, footY: { L: 0, R: 0 }, lastSkid: { L: null, R: null }, gun: role === 'gunner' ? { energy: 100 } : null, target: null, order: null, sel: false, alive: true, koT: 0 };
  f.lean.tx = f.lean.x; f.lean.tz = f.lean.z; f.lean.ty = f.lean.y;
  f.id = robots.length; robots.push(f);
  if (f.gun) makeGunFX(f);
  setState(f, 'idle', idleClip(f), 0.01); f.act.time = Math.random();
  makeBars(f, 0.95 * RS, 0.9);
  return f;
}
const LOOPS = new Set(['Idle', 'Battle_Idle', 'Boost_Forward', 'Boost_Back', 'Boost_Strafe_L', 'Boost_Strafe_R', 'Air_Hover', 'Head_Vulcan_Fire', 'Air_Vulcan_Fire', 'Saber_Idle', 'Walk_Forward', 'Walk_Back', 'Walk_Strafe_L', 'Walk_Strafe_R', 'Run_Forward', 'Gun_Idle', 'Saber_Clash_Loop']);
const SABER_CLIPS = new Set(['Saber_Draw', 'Saber_Idle', 'Saber_Slash_Combo', 'Saber_Dash_Thrust', 'Saber_Sheathe', 'Saber_Air_Slash', 'Saber_Run_Slash', 'Saber_Boost_Slash', 'Saber_Rising_Slash', 'Saber_Wide_Sweep', 'Saber_Stab_Combo', 'Saber_Cross_Cut', 'Saber_Parry_Riposte', 'Saber_Clash_Enter', 'Saber_Clash_Loop', 'Saber_Clash_Win', 'Saber_Clash_Lose']);
function play(f, name, fade = 0.12) { const next = f.actions[name]; if (!next) return; const once = !LOOPS.has(name);
  if (!once && f.act === next && next.isRunning()) { f.clip = name; if (/Idle$/.test(name)) next.timeScale = f.idleRate; else if (GAIT[name]) next.timeScale = f.gaitRate; return; }   // already looping this clip: don't restart it (caused idle pops)
  next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = once; next.enabled = true; next.setEffectiveWeight(1).play();
  if (!once) { next.time = Math.random() * next.getClip().duration; next.timeScale = GAIT[name] ? f.gaitRate : /Idle$/.test(name) ? f.idleRate : rand(0.9, 1.1); }   // loops start out of phase so squads don't move in lockstep
  if (f.act && f.act !== next) f.act.crossFadeTo(next, fade, false); f.act = next; f.clip = name; f.clipT0 = f.st; }
const clipT = f => f.act ? f.act.time : 0;
const clipDone = f => f.act && f.act.loop === THREE.LoopOnce && f.act.time >= f.act.getClip().duration - 1e-3;
function setState(f, s, clip, fade) { if (s !== 'idle') f.feetLock = null; if (f.act) f.act.timeScale = 1; f.lodge = null; f.flyV = 0; f.liftFx = 0; f.landFx = 0; f.state = s; f.st = 0; f.hitDone = {}; if (clip) play(f, clip, fade); }
const idleClip = f => f.saberOut ? 'Saber_Idle' : f.idleName;   // each pilot has their own stance; gunners keep the rifle lowered
function toIdle(f, fade = 0.14, think = 0.05) { setState(f, 'idle', idleClip(f), fade); f.thinkT = think; }
const groundY = f => Math.max(Hd(f.pos.x, f.pos.z), -3 / S);
const chestPos = (f, out) => out.set(f.pos.x, groundY(f) + (f.y + 0.56) * RS, f.pos.z);
const tgtPos = (t, out) => t.kind === 'robot' ? chestPos(t, out) : t.kind === 'soldier' ? out.copy(t.pos).setY(t.pos.y + SOLD_H * 0.7) : out.copy(t.pos);
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
function unitName(f) { return `${TEAM_NAME[f.team]} ${f.kind === 'airbase' ? 'air base' : f.kind === 'pumpjack' ? 'oil pump' : f.kind === 'woodcutter' ? 'woodcutter camp' : f.kind === 'mine' ? 'mine' : f.kind === 'farm' ? 'farm' : f.kind === 'warehouse' ? 'warehouse' : f.kind === 'hangar' ? 'hangar' : f.kind === 'soldier' ? 'soldier' : f.kind === 'heli' ? 'gunship' : (f.role === 'gunner' ? 'gunner' : 'striker')}`; }
function damage(att, def, amount, label, heavy, dir, at) {
  if (def.kind === 'heli') return heliHit(def, amount, att, at);
  if (def.kind === 'airbase') return airbaseHit(def, amount);
  if (def.kind === 'pumpjack') return pumpHit(def, amount);
  if (def.kind === 'woodcutter') return campHit(def, amount);
  if (def.kind === 'mine') return mineHit(def, amount);
  if (def.kind === 'farm') return farmHit(def, amount);
  if (def.kind === 'warehouse') return warehouseHit(def, amount);
  if (def.kind === 'hangar') return hangarHit(def, amount);
  if (att && att.kind === 'robot' && att.lvl) amount *= 1 + 0.15 * (att.lvl.weapons || 0);   // researched weapons
  if (def.kind === 'soldier') return soldierHit(def, amount, att);
  if (def.state === 'ko') return;
  if (def.state === 'clash' && def.hp - amount > 0) { def.hp -= amount; if (at) FX.sparks(at, 6, [1, 0.7, 0.4], 1.2); return 'hit'; }   // locked blades: stray hits chip armour but don't break the bind
  const facing = dir && new THREE.Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw)).dot(dir) < -0.3;
  const PA = def.state === 'attack' && ATTACKS[def.clip] && ATTACKS[def.clip].parry, pt = clipT(def);
  if (att && att.kind === 'robot' && PA && pt > PA[0] && pt < PA[1] && facing && (label || chance(0.7))) {    // parried: blades clash, attacker staggers
    def.nodes.blade.updateWorldMatrix(true, false); const clash = BL_BASE.clone().lerp(BL_TIP, 0.65).applyMatrix4(def.nodes.blade.matrixWorld).divideScalar(S); near(clash, def.pos, clash);
    FX.sparks(clash, label ? 60 : 6, [1, 0.85, 0.5], 2.4); if (label) { FX.sparks(clash, 25, att.col, 1.8); FX.sparks(clash, 25, def.col, 1.8); FX.flash(clash, 0.45, [1, 0.95, 0.8]); addShake(0.25, clash);
      if (att.state !== 'ko') { if (att.saberOut && def.saberOut && att.actions.Saber_Clash_Enter && chance(0.55)) startClash(att, def); else { setState(att, 'hitL', 'Hit_React_Light', 0.04); att.vel.copy(dir).multiplyScalar(-0.3); } } }
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
  if (!def.target && att && att.kind !== 'soldier' && def.order?.type !== 'move') def.target = att;   // robots shrug off rifle fire          // fight back
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
// every pilot flies differently: some cruise the whole way, others hop in short jump bursts and walk between them
function pilotStyle() { const hopper = chance(0.5);
  return { hopper, burst: hopper ? rand(2.2, 5.5) : rand(9, 30), alt: rand(0.65, 1.45), speed: rand(1.7, 2.35), minFuel: rand(32, 60), react: rand(0.05, 0.9), rest: hopper ? [0.7, 2.6] : [2, 5] }; }
function takeOff(f, x, z) { f.flyGoal = { x, z }; f.flyPhase = 'wait'; f.flyWait = f.pilot.react * rand(0.6, 1.4); f.flyDist = 0; f.path = null; setState(f, 'fly', null); }
function liftOff(f) { f.flyPhase = 'up'; play(f, 'Boost_Jump', 0.1);
  FX.dust(new THREE.Vector3(f.pos.x, groundY(f), f.pos.z), 12, { size: [0.08, 0.45], vel: 0.9, up: 0.06 }); }
const canFly = (f, d) => d > FLY_MIN_DIST * (f.pilot.hopper ? 0.8 : 1.2) && f.boost > f.pilot.minFuel && f.y < 0.02 && f.hopCool <= 0;
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
// ---- blade lock: two sabers bind, both push, the stronger/luckier pilot throws the other off
function startClash(a, b) { const T = rand(1.1, 2.4);
  for (const [f, o] of [[a, b], [b, a]]) { setState(f, 'clash', 'Saber_Clash_Enter', 0.06); f.clashFoe = o; f.clashT = T; f.vel.set(0, 0, 0); f.clashSpark = 0; }
  log(null, `<b>${unitName(a)}</b> and <b>${unitName(b)}</b> lock blades`); }
function clashMid(f, out) { tmpC.copy(f.clashFoe.pos); near(tmpC, f.pos, tmpC); return out.copy(f.pos).lerp(tmpC, 0.5).setY(groundY(f) + 0.62 * RS); }
function endClash(f, won) { const o = f.clashFoe; f.clashFoe = null; if (!o || o.state === 'ko') return toIdle(f, 0.12, 0.05);
  if (won) { setState(f, 'clashWin', 'Saber_Clash_Win', 0.06); }
  else { setState(f, 'clashLose', 'Saber_Clash_Lose', 0.06); tmpA.copy(f.pos).sub(near(tmpB.copy(o.pos), f.pos, tmpB)).setY(0).normalize(); f.vel.copy(tmpA).multiplyScalar(1.1); f.hp = Math.max(1, f.hp - Math.round(rand(40, 90))); } }
function updateClash(f, dt) { const o = f.clashFoe;
  if (!o || o.state !== 'clash' || o.clashFoe !== f) { f.clashFoe = null; return toIdle(f, 0.12, 0.03); }
  tmpB.copy(o.pos); near(tmpB, f.pos, tmpB); faceTo(f, Math.atan2(tmpB.x - f.pos.x, tmpB.z - f.pos.z), dt, 0.001);
  const gap = f.pos.distanceTo(tmpB), want = 0.62 * RS; if (gap > 1e-3) f.vel.copy(tmpB).sub(f.pos).setY(0).normalize().multiplyScalar((gap - want) * 1.5); skid(f, dt);
  if (f.clip === 'Saber_Clash_Enter' && clipDone(f)) play(f, 'Saber_Clash_Loop', 0.1);
  if (f.id < o.id) { f.clashSpark -= dt; if (f.clashSpark <= 0) { f.clashSpark = rand(0.05, 0.16); clashMid(f, tmpA); FX.sparks(tmpA, 8, [1, 0.85, 0.5], 1.6); if (chance(0.15)) FX.flash(tmpA, 0.25, [1, 0.9, 0.7]); }
    f.clashT -= dt; if (f.clashT <= 0) { const edge = f.hp / f.maxHp - o.hp / o.maxHp + (f.p.aggro || 0.5) - (o.p.aggro || 0.5); const fWins = Math.random() < 0.5 + edge * 0.35;
      clashMid(f, tmpA); FX.sparks(tmpA, 50, [1, 0.9, 0.6], 2.6); FX.flash(tmpA, 0.5, [1, 0.95, 0.8]); addShake(0.3, tmpA); endClash(f, fWins); endClash(o, !fWins); } } }
// idle variety: a personal lean/weight shift layered on the stance, plus an occasional switch between the two idle stances
const _iq = new THREE.Quaternion(), _ie = new THREE.Euler();
function idleFlavor(f, dt) {
  const idle = f.state === 'idle' && /Idle$/.test(f.clip || ''); f.idleW = (f.idleW || 0) + ((idle ? 1 : 0) - (f.idleW || 0)) * (1 - Math.pow(0.02, dt));
  const L0 = f.lean;   // weight shift: every so often settle into a new lean (Battle_Idle is not used: it raises a fist)
  if (idle) { f.idleShiftT -= dt; if (f.idleShiftT <= 0) { f.idleShiftT = rand(6, 14); L0.tx = rand(-0.07, 0.07); L0.tz = rand(-0.06, 0.06); L0.ty = rand(-0.18, 0.18); } }
  const k = 1 - Math.pow(0.3, dt); L0.x += (L0.tx - L0.x) * k; L0.z += (L0.tz - L0.z) * k; L0.y += (L0.ty - L0.y) * k;
  if (f.idleW < 0.01 || !f.nodes.chest) return; const L = f.lean, t = performance.now() / 1000 * L.sp + L.ph, w = f.idleW;
  _ie.set((L.x + Math.sin(t) * 0.015) * w, (L.y + Math.sin(t * 0.6) * 0.05) * w, (L.z + Math.sin(t * 0.8 + 1) * 0.02) * w); _iq.setFromEuler(_ie);
  f.nodes.chest.quaternion.multiply(_iq);
  if (f.nodes.head) { _ie.set(Math.sin(t * 0.7) * 0.04 * w, Math.sin(t * 0.45 + 2) * 0.12 * w, 0); _iq.setFromEuler(_ie); f.nodes.head.quaternion.multiply(_iq); }
}
// planted feet while idle: two-bone leg IK pins each foot to the spot (and angle) it had when the robot settled
const _ka = new THREE.Vector3(), _kb = new THREE.Vector3(), _kc = new THREE.Vector3(), _kt = new THREE.Vector3(), _kq = new THREE.Quaternion(), _kq2 = new THREE.Quaternion(), _kn = new THREE.Vector3(), _kv1 = new THREE.Vector3(), _kv2 = new THREE.Vector3();
function rotWorld(bone, q) { bone.parent.getWorldQuaternion(_kq2); const wq = bone.getWorldQuaternion(new THREE.Quaternion()); wq.premultiply(q); bone.quaternion.copy(_kq2.invert().multiply(wq)); bone.updateMatrixWorld(true); }
function footLock(f, dt) {
  const idle = f.state === 'idle' && f.y < 0.01 && /Idle$/.test(f.clip || '');
  f.lockW = (f.lockW || 0) + ((idle ? 1 : 0) - (f.lockW || 0)) * (1 - Math.pow(0.001, dt));
  if (!idle) { if (f.lockW < 0.02) f.feetLock = null; if (!f.feetLock) return; }
  if (!f.legs) { const n = nm => f.model.getObjectByName(nm); f.legs = ['L', 'R'].map(sd => ({ up: n('UpperLeg_' + sd), lo: n('LowerLeg_' + sd), ft: n('Foot_' + sd) })).filter(l => l.up && l.lo && l.ft); }
  if (!f.feetLock) { if (!idle || f.st < 0.25) return;                               // capture once the idle pose has blended in
    f.feetLock = f.legs.map(l => ({ p: f.root.worldToLocal(l.ft.getWorldPosition(new THREE.Vector3())), q: f.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(l.ft.getWorldQuaternion(new THREE.Quaternion())) })); return; }
  const w = f.lockW; if (w < 0.01) return;
  f.legs.forEach((l, i) => { const L = f.feetLock[i];
    l.up.getWorldPosition(_ka); l.lo.getWorldPosition(_kb); l.ft.getWorldPosition(_kc);
    _kt.copy(L.p); f.root.localToWorld(_kt); _kt.lerp(_kc, 1 - w);
    const l1 = _ka.distanceTo(_kb), l2 = _kb.distanceTo(_kc), d = clamp(_ka.distanceTo(_kt), 1e-4, l1 + l2 - 1e-4);
    // knee: set the angle between thigh and shin by the law of cosines, bending in the leg's own plane
    const cur = _kv1.subVectors(_ka, _kb).normalize().angleTo(_kv2.subVectors(_kc, _kb).normalize());
    const want = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
    _kn.crossVectors(_kv1.subVectors(_kb, _ka), _kv2.subVectors(_kc, _kb)); if (_kn.lengthSq() < 1e-10) _kn.set(1, 0, 0).applyQuaternion(f.root.quaternion); _kn.normalize();
    rotWorld(l.lo, _kq.setFromAxisAngle(_kn, cur - want));
    // hip: swing the whole leg so the foot lands on the target
    l.ft.getWorldPosition(_kc); _kq.setFromUnitVectors(_kv1.subVectors(_kc, _ka).normalize(), _kv2.subVectors(_kt, _ka).normalize()); rotWorld(l.up, _kq);
    // foot keeps its planted angle
    const tq = f.root.getWorldQuaternion(new THREE.Quaternion()).multiply(L.q), fq = l.ft.getWorldQuaternion(new THREE.Quaternion());
    fq.slerp(tq, w); l.ft.parent.getWorldQuaternion(_kq2); l.ft.quaternion.copy(_kq2.invert().multiply(fq)); l.ft.updateMatrixWorld(true);
  });
}
// keep grounded robots standing on the terrain: the clips lift the hips, so drop the model until the lower sole touches down
const _pf = new THREE.Vector3();
function plantFeet(f, dt) { const n = f.nodes; if (!n.footL || !n.footR) return;
  const k = S * RS * MECH_K, ry = f.root.getWorldPosition(_pf).y;
  const low = Math.min(n.footL.getWorldPosition(_pf).y, n.footR.getWorldPosition(_pf).y), soleLocal = (low - ry) / k - FOOT_SOLE;
  const grounded = f.y < 0.03 && !['fly', 'jump', 'air', 'airfire', 'dive', 'boost', 'hop'].includes(f.state);
  const want = grounded ? f.model.position.y - soleLocal : 0;
  f.model.position.y += (want - f.model.position.y) * (1 - Math.pow(0.0001, dt)); f.model.updateMatrixWorld(true); }
function landShock(f, rad) { carStomp(f.pos.x, f.pos.z, 0.14 * RS); const p = new THREE.Vector3(f.pos.x, groundY(f), f.pos.z); FX.dust(p, 18, { size: [0.08, 0.5], life: [0.7, 1.5], vel: 0.9, up: 0.1, a: 0.5 });
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
// ------------------------------------------------------------------ tactics: spacing, awareness, evasion, retreat
const SPACING = 1.6 * RS;                     // preferred gap between allied robots (demo units)
function alliesNear(f, r) { let n = 0, cx = 0, cz = 0; for (const a of robots) { if (a === f || a.team !== f.team || a.state === 'ko') continue; const dx = wd(a.pos.x - f.pos.x), dz = wd(a.pos.z - f.pos.z); if (Math.hypot(dx, dz) < r) { n++; cx += dx; cz += dz; } } return { n, cx: n ? cx / n : 0, cz: n ? cz / n : 0 }; }
function attackersOf(f) { let n = 0; for (const e of robots) if (e.team !== f.team && e.state !== 'ko' && e.target === f && wdist2(e.pos.x, e.pos.z, f.pos.x, f.pos.z) < 7 * RS) n++; for (const h of helis) if (h.team !== f.team && h.alive && h.target === f) n++; return n; }
// incoming fire: the soonest projectile that will pass within reach of this robot's chest in the next ~0.7 s
const _ip = new THREE.Vector3(), _ir = new THREE.Vector3();
function incoming(f) { chestPos(f, _ic); let best = null;
  const scan = (list, heavy) => { for (const b of list) { if (!b.alive || !b.owner || b.owner.team === f.team) continue; _ip.copy(b.p); near(_ip, f.pos, _ip); _ir.subVectors(_ic, _ip);
      const sp2 = b.v.lengthSq(); if (sp2 < 1e-6) continue; const t = _ir.dot(b.v) / sp2; if (t < 0 || t > 0.7) continue;
      const miss = _ir.clone().addScaledVector(b.v, -t).length(); if (miss < 0.3 * RS && (!best || t < best.t)) best = { t, v: b.v.clone(), heavy }; } };
  scan(lasers, false); scan(bullets, false); scan(missiles, true); return best; }
const _ic = new THREE.Vector3(), DEF_LOG = { n: 0 };
// react between decisions: sidestep a shot, guard against a strike already swinging, break away when mobbed
function defend(f, dt) {
  if (f.state === 'ko' || f.y > 0.02 || !['idle', 'walk', 'fire', 'turn'].includes(f.state)) return;
  f.defCool = (f.defCool || 0) - dt; if (f.defCool > 0) return;
  const P = f.p, inc = incoming(f);
  if (inc && chance(0.35 + 0.55 * P.dodge)) { f.defCool = rand(0.5, 1.1); DEF_LOG.n++;
    const side = new THREE.Vector3(-inc.v.z, 0, inc.v.x).normalize(), right = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    if (f.boost > 18 && (inc.heavy || chance(0.7))) { const hs = side.dot(right) > 0 ? 'R' : 'L'; hop(f, chance(0.8) ? hs : (hs === 'R' ? 'L' : 'R')); }
    else if (f.boost > 16) quickstep(f); else block(f); return; }
  const o = f.target; if (o && o.kind === 'robot' && isThreat(o, wdist2(f.pos.x, f.pos.z, o.pos.x, o.pos.z) / RS) && chance(0.5 + 0.4 * P.guard)) { f.defCool = rand(0.6, 1.2); block(f); return; }
  f.defCool = rand(0.15, 0.3);
}
function retreatTo(f) {   // fall back toward friends (or home), never straight into the enemy
  const home = towns[f.team] || { x: f.pos.x, z: f.pos.z }, al = alliesNear(f, 10 * RS);
  let tx = al.n ? f.pos.x + al.cx : f.pos.x + wd(home.x - f.pos.x), tz = al.n ? f.pos.z + al.cz : f.pos.z + wd(home.z - f.pos.z);
  const d = Math.hypot(wd(tx - f.pos.x), wd(tz - f.pos.z)) || 1, step = Math.min(d, rand(2.5, 4) * RS);
  tx = wm(f.pos.x + wd(tx - f.pos.x) / d * step); tz = wm(f.pos.z + wd(tz - f.pos.z) / d * step);
  if (f.boost > 45 && d > 3 * RS && chance(0.5)) return takeOff(f, tx, tz); goTo(f, tx, tz, 'run', 0.3, 2.5); }
// each robot approaches its target from its own side, so a squad surrounds an enemy instead of queuing behind each other
function flank(f, op, r) { const base = Math.atan2(f.pos.z - op.z, f.pos.x - op.x), slot = ((f.id * 7) % 5 - 2) * 0.55, R = Math.max(r, 0.2) * RS;
  const a = base + slot; return [wm(op.x + Math.cos(a) * R), wm(op.z + Math.sin(a) * R)]; }
// avoidance: friendly (own-town) buildings and every civilian vehicle push the walking direction sideways; never a hard stop,
// so a robot that has no way around still goes through (that damage is part of the game)
function friendlyProp(f, p) { return p.alive && (p.kind === 'house' || p.kind === 'tower' || p.kind === 'car') && p.town && p.town.idx === f.team; }
function steerAround(f, m) { const look = 0.9 * RS; let ax = 0, az = 0;
  const probe = (px, pz, r) => { const dx = wd(px - f.pos.x), dz = wd(pz - f.pos.z), ahead = dx * m.x + dz * m.z; if (ahead < -0.1 || ahead > look + r) return;
    const lat = dx * m.z - dz * m.x, clear = r + 0.18 * RS; if (Math.abs(lat) > clear) return;
    const w = (1 - Math.abs(lat) / clear) * (1 - Math.max(0, ahead) / (look + r)); const sgn = lat >= 0 ? -1 : 1; ax += m.z * sgn * w; az += -m.x * sgn * w; };
  for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) for (const p of propsNear(f.pos.x + m.x * look * 0.6 + ox, f.pos.z + m.z * look * 0.6 + oz)) if (friendlyProp(f, p) && !p._seen) { p._seen = true; probe(p.x, p.z, p.r); }
  for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) for (const p of propsNear(f.pos.x + m.x * look * 0.6 + ox, f.pos.z + m.z * look * 0.6 + oz)) p._seen = false;
  for (const c of cars) if (!c.dead && c.wx !== undefined) probe(c.wx / S, c.wz / S, 0.12);
  if (ax || az) { m.x += ax * 1.6; m.z += az * 1.6; m.normalize(); } }
// how much of our own town is around us (0 = none)
function friendlyNear(f, r) { let n = 0; for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.6, 0.6], [-0.6, -0.6]]) for (const p of propsNear(f.pos.x + ox, f.pos.z + oz)) if (friendlyProp(f, p) && wdist2(p.x, p.z, f.pos.x, f.pos.z) < r) n++; return n; }
// lure: back off away from our town (and sideways from the enemy) so the fight moves out of our streets
function lureAway(f) { const t = towns[f.team]; if (!t) return walkBack(f); const o = f.target, op = o ? tgtFrame(f, o) : f.pos;
  let ax = wd(f.pos.x - t.x), az = wd(f.pos.z - t.z); const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
  const ex = wd(f.pos.x - op.x), ez = wd(f.pos.z - op.z), el = Math.hypot(ex, ez) || 1; const dx = ax * 0.75 + ex / el * 0.35, dz = az * 0.75 + ez / el * 0.35, dl = Math.hypot(dx, dz) || 1;
  const R = rand(1.6, 2.6) * RS; walkTo(f, wm(f.pos.x + dx / dl * R), wm(f.pos.z + dz / dl * R), 'run', 0.3, rand(1.2, 2.2)); }
function spreadOut(f) { const al = alliesNear(f, SPACING); if (!al.n) return false; const l = Math.hypot(al.cx, al.cz) || 1, a = Math.atan2(-al.cz / l, -al.cx / l) + rand(-0.6, 0.6), r = rand(1.0, 1.6) * RS;
  walkTo(f, wm(f.pos.x + Math.cos(a) * r), wm(f.pos.z + Math.sin(a) * r), 'walk', 0.15, rand(1, 1.8)); return true; }
// an ally standing between a shooter and its target blocks the line of fire
function allyInLine(f, o) { const ox = wd(o.pos.x - f.pos.x), oz = wd(o.pos.z - f.pos.z), L = Math.hypot(ox, oz) || 1;
  for (const a of robots) { if (a === f || a.team !== f.team || a.state === 'ko') continue; const ax = wd(a.pos.x - f.pos.x), az = wd(a.pos.z - f.pos.z), t = (ax * ox + az * oz) / L;
    if (t > 0.3 * RS && t < L - 0.3 * RS && Math.abs(ax * oz - az * ox) / L < 0.35 * RS) return true; } return false; }
function bestTarget(f) {   // score: close, wounded, busy fighting one of ours
  let best = null, bs = -1e9; for (const e of robots) { if (e.team === f.team || e.state === 'ko') continue; const d = wdist2(f.pos.x, f.pos.z, e.pos.x, e.pos.z); if (d > SIGHT) continue;
    const s = -d / RS * 0.6 + (1 - e.hp / e.maxHp) * 3 + (e.target && e.target.team === f.team && e.target !== f ? 1.2 : 0) + (e.target === f ? 0.8 : 0); if (s > bs) { bs = s; best = e; } } return best; }
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
  if (!f.target || !(ord && ord.type === 'attack')) { const e = bestTarget(f) || nearestEnemy(f, SIGHT); if (e && (!f.target || e !== f.target && chance(0.25))) f.target = e; }
  if (!f.target) for (const b of [...airbases, ...pumpjacks, ...camps, ...mines]) if (b.alive && b.team !== f.team && wdist2(f.pos.x, f.pos.z, b.x, b.z) < SIGHT) { f.target = b; break; }
  const o = f.target;
  if (!o && ord && ord.type === 'hold') return toIdle(f, 0.2, rand(0.4, 0.9));
  if (!o) {
    if (ord && ord.type === 'amove') { const d = wdist2(f.pos.x, f.pos.z, ord.x, ord.z); if (d < 0.5) f.order = null;
      else { if (canFly(f, d)) return takeOff(f, ord.x, ord.z); goTo(f, ord.x, ord.z, 'run', 0.3, 2.5); return; } }
    if (f.saberOut && chance(0.3)) { setState(f, 'sheathe', 'Saber_Sheathe'); return; }
    if (!ord && alliesNear(f, SPACING * 0.8).n && chance(0.6) && spreadOut(f)) return;   // crowded while waiting: walk to a free spot
    return toIdle(f, 0.2, rand(0.4, 0.9));
  }
  const op = tgtFrame(f, o), d = Math.hypot(op.x - f.pos.x, op.z - f.pos.z) / RS, P = f.p, B = f.boost, cd = k => !(f.cool[k] > 0);
  const opts = []; const add = (name, s, fn) => opts.push({ name, s, fn });
  if (o.kind === 'airbase' || o.kind === 'pumpjack' || o.kind === 'woodcutter' || o.kind === 'mine') {           // structure: close in and shoot it up
    add('fire', d < 4.5 && cd('fire') ? 2 : 0, () => { f.cool.fire = rand(1.2, 2.4); f.fireT = rand(1, 1.8); setState(f, 'fire', 'Head_Vulcan_Fire'); });
    if (f.gun && f.gun.energy >= 12) add('gunBurst', d < 5.5 && cd('gunBurst') ? 2.2 : 0, () => { f.cool.gunBurst = rand(0.9, 1.6); gunBurst(f); });
    if (f.gun && f.gun.energy >= 40) add('gunCharge', d < 6 && cd('gunCharge') ? 1.4 : 0, () => { f.cool.gunCharge = rand(4, 6.5); gunCharge(f); });
    add('close', d > 3.2 ? 2.5 : 0, () => goTo(f, op.x, op.z, 'run', 2.6, 2.5));
    add('hold', 0.3, () => toIdle(f, 0.12, rand(0.2, 0.5)));
  } else if (o.kind === 'heli') {                                        // gunship overhead: head vulcans / rifle, keep it in range
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
  if (o.kind === 'robot') {                                       // squad-level options layered on the duel logic
    const mob = attackersOf(f), hpF = f.hp / f.maxHp, crowd = alliesNear(f, SPACING).n;
    add('fallBack', (hpF < 0.3 ? 1.8 : 0) + (mob >= 2 ? 0.7 * mob * (1.1 - P.aggro) : 0) + (hpF < 0.5 && mob >= 2 ? 1.5 : 0), () => retreatTo(f));
    const home = f.team < 2 && towns[f.team] ? friendlyNear(f, 1.4 * RS) : 0;
    add('lure', home ? Math.min(3, 0.6 + home * 0.35) : 0, () => lureAway(f));   // don't fight in our own streets
    add('spread', crowd ? 0.9 * crowd : 0, () => spreadOut(f) || toIdle(f, 0.12, 0.2));
    if (!f.saberOut && allyInLine(f, o)) { opts.forEach(q => { if (q.name === 'fire' || q.name === 'gunBurst' || q.name === 'gunCharge') q.s *= 0.1; }); add('clearShot', 2.0, () => reposition(f)); }
  }
  if (ord && ord.type === 'hold') { const keep = new Set(['fire', 'gunBurst', 'gunCharge', 'block', 'hold', 'slash', 'melee', 'draw', 'shootHeli', 'rifleHeli', 'sheathe']); for (const q of opts) if (!keep.has(q.name)) q.s = 0; }
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
    // the ankle's resting height depends on the model: track its low point and count a step when the foot comes down onto it
    const lo = f.footLo || (f.footLo = { L: h, R: h }); lo[s] = Math.min(lo[s] + 0.002, h);
    const down = lo[s] + 0.012 * RS, up = lo[s] + 0.03 * RS;
    if (h > up) f.footUp = Object.assign(f.footUp || {}, { [s]: true });
    if (f.y < 0.02 && f.footUp && f.footUp[s] && h <= down && ['walk', 'turn', 'idle', 'land', 'attack', 'hit'].includes(f.state)) { f.footUp[s] = false;
      printLayer.add(_fp.x, _fp.z, f.yaw, 0.11 * RS, 0.165 * RS); carStomp(_fp.x, _fp.z, 0.05 * RS); FX.dust(_fp, 4, { size: [0.04, 0.2], life: [0.5, 1.0], vel: 0.3, up: 0.05, a: 0.45 });
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
      if (dist > 0.3) { steerAround(f, m); }                                           // walk around friendly buildings and vehicles where it can
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
      if (f.flyPhase === 'wait') {                         // staggered take-off: each pilot reacts at their own pace
        skid(f, dt); faceTo(f, Math.atan2(gx, gz), dt, 0.02); f.flyWait -= dt; if (f.flyWait <= 0) liftOff(f);
      } else if (f.flyPhase === 'up') {                           // lift off
        const t = clipT(f); if (t < 0.22) skid(f, dt);
        else { f.vy = THREE.MathUtils.lerp(f.vy, 1.8, 1 - Math.pow(0.001, dt)); f.vel.lerp(gdir.clone().multiplyScalar(f.pilot.speed * 0.5), 1 - Math.pow(0.05, dt)); }
        faceTo(f, Math.atan2(gx, gz), dt, 0.01);
        if (f.y > f.pilot.alt * 0.8 || clipDone(f)) { f.flyPhase = 'cruise'; play(f, 'Boost_Forward', 0.25); }
      } else if (f.flyPhase === 'cruise') {                // fly straight at the goal, holding altitude over the terrain
        f.boost -= FLY_BURN * dt; faceTo(f, Math.atan2(gx, gz), dt, 0.02);
        const hopEnd = f.pilot.hopper ? Math.min(1, Math.max(0, f.pilot.burst - f.flyDist) / 1.5) : 1;   // hoppers arc down as their burst runs out
        f.vel.lerp(gdir.clone().multiplyScalar(f.pilot.speed * (gd < 2 ? 0.5 + gd / 4 : 1)), 1 - Math.pow(0.02, dt)); f.flyDist += f.vel.length() * dt;
        f.vy = THREE.MathUtils.lerp(f.vy, (f.pilot.alt * (0.35 + 0.65 * hopEnd) - f.y) * 2, 1 - Math.pow(0.01, dt));
        if (f.flyDist > f.pilot.burst && gd > 2 && passableD(f.pos.x, f.pos.z)) { f.flyPhase = 'down'; play(f, 'Air_Hover', 0.25); f.hopCool = rand(...f.pilot.rest); }
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
    case 'clash': updateClash(f, dt); break;
    case 'clashWin': skid(f, dt); if (clipDone(f) || f.st > 1.6) toIdle(f, 0.12, 0.03); break;
    case 'clashLose': skid(f, dt); if (clipDone(f) || f.st > 1.8) toIdle(f, 0.12, 0.1); break;
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
  if (f.hopCool > 0 && f.state !== 'fly') f.hopCool -= dt;
  if (!['jump', 'air', 'airfire', 'dive', 'fly'].includes(f.state) && f.y > 0) f.vy -= 4.5 * dt;
  f.y = Math.max(0, f.y + f.vy * dt); if (f.y === 0 && f.vy < 0) { if (f.vy < -1.2) landShock(f, 0.22); f.vy = 0; }
  if (!boosting && f.y === 0) f.boost = Math.min(100, f.boost + 26 * (1 + 0.25 * ((f.lvl && f.lvl.boost) || 0)) * dt); f.boost = Math.max(0, f.boost);
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
  if (w === 'blade') { n.blade.updateWorldMatrix(true, false); _wa.copy(BL_BASE).applyMatrix4(n.blade.matrixWorld).divideScalar(S); _wb.copy(BL_TIP).applyMatrix4(n.blade.matrixWorld).divideScalar(S); }
  else if (w === 'fistL' || w === 'fistR') { toDemo(w === 'fistL' ? n.handL : n.handR, _wa); _wb.copy(_wa); }
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
function bladeCut(f) { const n = f.nodes.blade; n.updateWorldMatrix(true, false); bladeBase.copy(BL_BASE).applyMatrix4(n.matrixWorld).divideScalar(S); bladeTip.copy(BL_TIP).applyMatrix4(n.matrixWorld).divideScalar(S);
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
function weaponOverride(f) { const n = f.nodes; if (n.gun) n.gun.scale.setScalar(f.gun ? GUN_SCALE : 0);
  if (SABER_CLIPS.has(f.clip)) return; const s = f.saberOut;
  if (n.saber) n.saber.scale.setScalar(s ? 1 : 0); if (n.blade) n.blade.scale.setScalar(s ? 1 : 0); }
const GUN_USE = new Set(['gunBurst', 'gunCharge', 'gunBeam']);
const _armDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.12), _armStraight = new THREE.Quaternion(), _gripQ = new THREE.Quaternion(0.054, 0.165, 0.135, 0.976).normalize();
function gunCarry(f, dt) {
  const punching = f.state === 'attack' && f.clip === 'Melee_Punch_Combo';
  const want = f.gun && !GUN_USE.has(f.state) && !punching ? 1 : 0; f.carryW = want ? (f.carryW || 0) + (1 - (f.carryW || 0)) * (1 - Math.pow(0.003, dt)) : 0;
  return;   // rifle carry pose disabled: the raised arm looked wrong; the clips hold the rifle lowered
  if (f.carryW < 0.01) return; const w = f.carryW;
  if (!f.carry) f.carry = CARRY_BONES.map(nm => [f.model.getObjectByName(nm), CARRY_Q[nm]]).filter(([o, q]) => o && q);
  for (const [o, q] of f.carry) o.quaternion.slerp(q, w);
}
function updateTrail(f) {
  const n = f.nodes.blade; const on = n.scale.y > 0.5 && f.saberOut; const Hh = f.trailHist;
  const swinging = on && (f.state === 'attack' || f.state === 'dive') && !f.lodge;
  if (swinging) { n.updateWorldMatrix(true, false); const b = BL_BASE.clone().applyMatrix4(n.matrixWorld).divideScalar(S), t = BL_TIP.clone().applyMatrix4(n.matrixWorld).divideScalar(S);
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
const HELI_S = 0.55, HELI_HP = 300; let HELI_SKID = 0.12;
function makeHeli(team, x, z) {
  if (!makeHeli.sk) { makeHeli.sk = 1; const bx = new THREE.Box3().setFromObject(heliProto); HELI_SKID = -bx.min.y * HELI_S; }
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
    pos: new THREE.Vector3(wm(x), Hd(x, z) + 1.6, wm(z)), vel: new THREE.Vector3(), acc: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, hp: heliMaxHp(team), maxHp: heliMaxHp(team), alive: true, falling: false,
    fuel: heliFuelMax(team), fuelMax: heliFuelMax(team), mode: 'fly', home: null, pad: null, rotor: 1, sortie: false, skid: HELI_SKID,
    target: null, retarget: 0, orb: rand(0, 6.28), orbDir: chance(.5) ? 1 : -1, gunT: 0, gunCD: rand(1, 2), fireAcc: 0, msCD: rand(3, 5), msQueue: 0, msT: 0, podI: 0, spin: 0,
    anchor: { x: wm(x), z: wm(z) }, sel: false, cargo: [], tr: null };
  helis.push(h); makeBars(h, 1.1, 1.35); return h;
}
function heliHit(h, amount, by, at) {
  if (!h.alive) return; h.hp -= amount; const p = at || h.pos; FX.sparks(p, amount > 30 ? 30 : 5, [1, 0.8, 0.45], 1.4); if (amount > 30) FX.flash(p, 0.3, [1, 0.8, 0.5]);
  if (by && !alive(h.target)) h.target = by;
  if (h.hp <= 0) { for (const s of h.cargo || []) { s.inHeli = null; s.alive = false; s.hp = 0; s.state = 'dead'; s.deadT = 99; } if (h.cargo) h.cargo.length = 0; h.tr = null; h.alive = false; h.falling = true; h.sel = false; h.vel.add(new THREE.Vector3(rand(-0.6, 0.6), 0.3, rand(-0.6, 0.6))); h.spin = rand(5, 8) * (chance(.5) ? 1 : -1); FX.explosion(h.pos.clone(), 0.45);
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
  for (const b of hRounds) { if (!b.alive) continue; b.life -= dt;
    if (b.tracerOnly) { b.p.addScaledVector(b.v, dt); b.m.position.set(disp(b.p.x, c.x), b.p.y, disp(b.p.z, c.z)); orient(b.m, b.v); if (b.life <= 0) { b.alive = false; b.m.visible = false; b.tracerOnly = false; b.m.scale.set(3.5, 3.5, 2); } continue; } b.v.y -= 1.0 * dt; b.p.addScaledVector(b.v, dt); const pos = b.p;
    b.m.position.set(disp(pos.x, c.x), pos.y, disp(pos.z, c.z)); orient(b.m, b.v);
    const t = projHits(pos, b.owner.team, 0);
    if (t) { b.alive = false; b.m.visible = false; if (t.kind === 'robot') t.bulletHits++; damage(b.owner, t, (t.kind === 'robot' ? 3 : 6) * heliDmg(b.owner), null, false, b.v.clone().setY(0).normalize(), pos.clone()); continue; }
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
    if (t || propHit(pos) || pos.y < gy || m.life <= 0) { m.alive = false; m.m.visible = false; FX.explosion(pos.clone(), 0.42); impact(pos.clone(), 0.26, m.v.clone().normalize(), 1.3 * heliDmg(m.owner), 'strike'); if (pos.y < gy + 0.05) scorchMarks.add(pos.x, pos.z, 0, 0.22, 0.22);
      if (t) damage(m.owner, t, (t.kind === 'robot' ? 40 : 90) * heliDmg(m.owner), 'a missile strike', false, m.v.clone().setY(0).normalize(), pos.clone()); }
  }
}
function heliTargetNear(h) {
  let best = null, bd = 9;
  for (const r of robots) if (r.team !== h.team && r.state !== 'ko') { const d = Math.min(wdist2(h.anchor.x, h.anchor.z, r.pos.x, r.pos.z), wdist2(h.pos.x, h.pos.z, r.pos.x, r.pos.z)); if (d < bd) { bd = d; best = r; } }
  for (const e of helis) if (e.team !== h.team && e.alive) { const d = wdist2(h.pos.x, h.pos.z, e.pos.x, e.pos.z); if (d < Math.min(bd, 5)) { bd = d; best = e; } }
  if (!best) for (const b of [...airbases, ...pumpjacks, ...camps, ...mines]) if (b.alive && b.team !== h.team) { const d = Math.min(wdist2(h.anchor.x, h.anchor.z, b.x, b.z), wdist2(h.pos.x, h.pos.z, b.x, b.z)); if (d < 7 && d < bd + 7) { bd = d; best = b; } }
  return best;
}
function updateHeli(h, dt) {
  const rs = h.alive ? (h.rotor ?? 1) : 1; h.main.rotation.y += (h.alive ? 42 * rs : h.falling ? 20 : 0) * dt; h.tail.rotation.z += (h.alive ? 60 * rs : 10) * dt;
  if (!h.alive) {
    if (h.falling) { h.vel.y -= 3.5 * dt; h.pos.addScaledVector(h.vel, dt); h.pos.x = wm(h.pos.x); h.pos.z = wm(h.pos.z); h.yaw += h.spin * dt; h.roll += (0.6 - h.roll) * dt;
      toDemo(h.bodyPt, tmpA); near(tmpA, h.pos, tmpA); FX.fire(tmpA, 2, 0.1); FX.darkSmoke(tmpA, 1, 1.2);
      const gy = Hd(h.pos.x, h.pos.z); if (h.pos.y < gy + 0.08) { h.falling = false; h.root.visible = false; const p = new THREE.Vector3(h.pos.x, gy + 0.05, h.pos.z); FX.explosion(p, 0.9); impact(p, 0.45, null, 1.6, 'land'); scorchMarks.add(p.x, p.z, 0, 0.6, 0.6); fires.push({ x: p.x, z: p.z, t: rand(8, 12) }); }
      else if (propHit(h.pos)) impact(h.pos.clone(), 0.2, h.vel.clone().normalize(), 1.2, 'strike'); }
    return; }
  const t = performance.now() / 1000;
  if (heliService(h, dt)) { h.nav.visible = (t * 2 + h.team) % 1 < 0.5; return; }
  const G = h.tr && h.mode === 'fly' ? trGoal(h, dt) : h.goTo, up = HELI_UP[h.team], vMax = 0.9 * (1 + 0.15 * up.engine) * (G && G.land ? 0.5 : 1), aMax = 1.1 * (1 + 0.15 * up.engine);
  h.retarget -= dt;
  if (h.retarget <= 0 || !alive(h.target)) { h.retarget = rand(2, 4); h.target = h.order?.type === 'attack' && alive(h.order.target) ? h.order.target : heliTargetNear(h); }
  const T = G ? null : alive(h.target) ? h.target : null;
  const cx = G ? h.pos.x + wd(G.x - h.pos.x) : T ? h.pos.x + wd(T.pos.x - h.pos.x) : h.pos.x + wd(h.anchor.x - h.pos.x), cz = G ? h.pos.z + wd(G.z - h.pos.z) : T ? h.pos.z + wd(T.pos.z - h.pos.z) : h.pos.z + wd(h.anchor.z - h.pos.z);
  h.orb += dt * 0.18 * h.orbDir; if (chance(dt * 0.1)) h.orbDir *= -1; const R = G ? 0 : T ? (T.kind === 'robot' ? 2.4 : T.kind === 'airbase' ? 2.6 : T.kind === 'pumpjack' || T.kind === 'woodcutter' ? 1.8 : 1.6) : 1.2;
  const want = new THREE.Vector3(cx + Math.cos(h.orb) * R, 0, cz + Math.sin(h.orb) * R);
  want.y = G ? G.y : Math.max(Hd(want.x, want.z), Hd(h.pos.x, h.pos.z), 0) + 1.35 + 0.12 * Math.sin(t * 0.9 + h.team * 2);
  if (!G) for (const e of helis) if (e !== h && e.alive && e.mode !== 'landed' && wdist3(e.pos, h.pos) < 0.55) want.add(new THREE.Vector3(-wd(e.pos.x - h.pos.x), 0, -wd(e.pos.z - h.pos.z)).normalize().multiplyScalar(0.6));
  h.acc.subVectors(want, h.pos).multiplyScalar(0.7).addScaledVector(h.vel, -1.0); if (h.acc.length() > aMax) h.acc.setLength(aMax);
  h.vel.addScaledVector(h.acc, dt); if (h.vel.length() > vMax) h.vel.setLength(vMax); h.pos.addScaledVector(h.vel, dt); h.pos.x = wm(h.pos.x); h.pos.z = wm(h.pos.z);
  const floor = G && G.land ? G.y : Math.max(Hd(h.pos.x, h.pos.z), 0) + 0.85; if (h.pos.y < floor) { const gyH = Math.max(Hd(h.pos.x, h.pos.z), 0) + h.skid; if (h.pos.y < gyH) h.pos.y = gyH; h.pos.y = Math.min(floor, h.pos.y + 0.45 * dt); h.vel.y = Math.max(0, h.vel.y); h.vel.x *= 1 - Math.min(1, dt * 2); h.vel.z *= 1 - Math.min(1, dt * 2); }   /* below cruise height (just lifted off): climb up, never snap */
  const tp = T ? near(tgtPos(T, tmpC), h.pos, tmpC) : tmpC.set(cx, h.pos.y, cz);
  const ty = Math.atan2(tp.x - h.pos.x, tp.z - h.pos.z); let dy = Math.atan2(Math.sin(ty - h.yaw), Math.cos(ty - h.yaw)); if (!(G && G.land) && (T || h.vel.length() > 0.15)) h.yaw += clamp(dy, -1.2 * dt, 1.2 * dt);
  const fw = new THREE.Vector3(Math.sin(h.yaw), 0, Math.cos(h.yaw)), sd = new THREE.Vector3(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
  h.pitch += (clamp(h.acc.dot(fw) * 0.16 + h.vel.dot(fw) * 0.1, -0.4, 0.4) - h.pitch) * (1 - Math.pow(0.02, dt)); h.roll += (clamp(-h.acc.dot(sd) * 0.16 - h.vel.dot(sd) * 0.08, -0.45, 0.45) - h.roll) * (1 - Math.pow(0.02, dt));
  h.nav.visible = (t * 2 + h.team) % 1 < 0.5;
  const sev = 1 - h.hp / h.maxHp; if (sev > 0.4 && chance(dt * 6 * sev)) { toDemo(h.bodyPt, tmpA); near(tmpA, h.pos, tmpA); FX.darkSmoke(tmpA, 1, 0.6 + sev); if (sev > 0.7 && chance(0.5)) FX.fire(tmpA, 1, 0.06); }
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
function placeBar(u, x, y, z, visible) { visible = visible && !!u.sel;   // unit markers only while selected
  const b = u.bar; b.g.visible = visible; if (!visible) return;
  b.g.position.set(x, y + b.yOff * S, z); b.g.quaternion.copy(camera.quaternion);
  const f = clamp(u.hp / u.maxHp, 0, 1); b.fill.scale.x = Math.max(0.001, b.W0 * f); b.fill.position.x = -b.W0 * (1 - f) / 2;
  b.fill.material.color.copy(f > 0.6 ? _barC.set(0x4ade5a) : f > 0.3 ? _barC.set(0xf5c542) : _barC.set(0xef4444));
  const dcam = camera.position.distanceTo(b.g.position); b.g.scale.setScalar(clamp(dcam / 420, 0.6, 1.6));
}

// ------------------------------------------------------------------ selection rings
const selRingGeo = new THREE.RingGeometry(0.34, 0.4, 32).rotateX(-Math.PI / 2);
const selRingMat = new THREE.MeshBasicMaterial({ color: 0x3fd0ff, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });   // depth-tested so units stand in front of it; offset keeps it above the ground
function ringFor(u) { if (!u.ring) { u.ring = new THREE.Mesh(selRingGeo, selRingMat); u.ring.renderOrder = 2; u.ring.scale.setScalar(u.kind === 'heli' ? 1.6 : RS); battleRoot.add(u.ring); } return u.ring; }

// ------------------------------------------------------------------ HUD: event feed + status
function log(team, html) { const feed = document.getElementById('feed'); if (!feed) return; const d = document.createElement('div'); d.className = team === 0 ? 'e1' : team === 1 ? 'e2' : ''; d.innerHTML = html; feed.append(d); while (feed.children.length > 5) feed.firstChild.remove(); }
function banner(text, sub) { const b = document.getElementById('banner'); if (!b) return; b.innerHTML = ''; b.append(text); const s = document.createElement('small'); s.textContent = sub; b.append(s); b.hidden = false; }

// ------------------------------------------------------------------ teams, reinforcements, enemy waves, victory
let gameOver = false, waveT = 60, reinforceT = [45, 45], aiAirT = 20, missionClock = 0;
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
// ------------------------------------------------------------------ economy: every building, vehicle, mech and research has a price
// in credits plus the gathered resources (oil, wood, ore, food). Both sides pay the same prices; mechs are the costliest thing in the game.
const CR = [6000, 6000], CR_RATE = 540;
const PRICE = {
  camp: { cr: 500 }, farm: { cr: 400, wood: 20 }, pump: { cr: 800, wood: 60 }, mine: { cr: 1200, wood: 120 },
  wh: { cr: 1000, wood: 150, ore: 50 }, outpost: { cr: 600, wood: 80, ore: 60 },
  airbase: { cr: 1500, wood: 250, ore: 300, oil: 150 }, hangar: { cr: 2500, wood: 300, ore: 500, oil: 200 },
  heli: { cr: 900, ore: 200, oil: 250, food: 40 },
  striker: { cr: 3500, ore: 700, oil: 400, food: 200 }, gunner: { cr: 4200, ore: 850, oil: 500, food: 200 } };
const RES_NAME = { cr: 'credits', oil: 'oil', wood: 'wood', ore: 'ore', food: 'food' };
const stock = (team, k) => k === 'cr' ? CR[team] : k === 'oil' ? OIL[team] : k === 'wood' ? WOOD[team] : k === 'ore' ? ORE[team] : FOOD[team];
const researchPrice = n => ({ cr: n, ore: Math.round(n * 0.25 / 10) * 10, oil: Math.round(n * 0.15 / 10) * 10 });
function canAfford(team, c) { const short = Object.entries(c).filter(([k, v]) => stock(team, k) < v).map(([k, v]) => Math.ceil(v - stock(team, k)) + ' ' + RES_NAME[k]); return short.length ? 'Not enough resources: need ' + short.join(', ') + ' more' : null; }
function spend(team, c) { for (const [k, v] of Object.entries(c)) { if (k === 'cr') CR[team] -= v; else if (k === 'oil') OIL[team] -= v; else if (k === 'wood') WOOD[team] -= v; else if (k === 'ore') ORE[team] -= v; else FOOD[team] -= v; } }
// ------------------------------------------------------------------ fog of war
// A map-wide grid: r = in sight right now, g = explored at some point. Your units and buildings light it up every few frames;
// the terrain, water and every lit object are darkened by it (black where never explored, dim grey where explored but out of sight),
// enemy units only show while in sight and enemy buildings once their ground has been explored.
const FOG_N = 256, FOG_C = W / FOG_N, fogVis = new Float32Array(FOG_N * FOG_N), fogExp = new Uint8Array(FOG_N * FOG_N), fogData = new Uint8Array(FOG_N * FOG_N * 4);
const fogTex = new THREE.DataTexture(fogData, FOG_N, FOG_N, THREE.RGBAFormat); fogTex.wrapS = fogTex.wrapT = THREE.RepeatWrapping; fogTex.magFilter = fogTex.minFilter = THREE.LinearFilter;
let fogT = 0, FOG_ON = true;
const fogIdx = (x, z) => (Math.floor(wm(z) / FOG_C) % FOG_N) * FOG_N + (Math.floor(wm(x) / FOG_C) % FOG_N);
const fogVisible = (x, z) => !FOG_ON || fogVis[fogIdx(x, z)] > 0.3, fogExplored = (x, z) => !FOG_ON || fogExp[fogIdx(x, z)] > 0;
function fogStamp(x, z, R) { const ci = Math.floor(wm(x) / FOG_C), cj = Math.floor(wm(z) / FOG_C), rc = Math.ceil(R / FOG_C) + 1;
  for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) { const d = Math.hypot((ci + di + 0.5) * FOG_C - wm(x), (cj + dj + 0.5) * FOG_C - wm(z)), v = clamp((R - d) / 1.2 + 0.5, 0, 1); if (v <= 0) continue;
    const k = (((cj + dj) % FOG_N + FOG_N) % FOG_N) * FOG_N + (((ci + di) % FOG_N + FOG_N) % FOG_N); if (v > fogVis[k]) fogVis[k] = v; if (v > 0.3) fogExp[k] = 1; } }
const FOG_SIGHT = { robot: 7, heli: 8, soldier: 4.5, truck: 3, building: 3.5 };
function updateFog(dt) { fogT -= dt; if (fogT > 0) return; fogT = 0.2; fogVis.fill(0);
  const t = towns[0]; if (!t.hqDown) fogStamp(t.x, t.z, TOWN + 4);
  for (const o of outposts) if (o.alive && o.team === 0) fogStamp(o.x, o.z, o.done === false ? FOG_SIGHT.building : OUTPOST_SENSE);
  for (const L of [airbases, pumpjacks, camps, mines, farms, warehouses, hangars]) for (const b of L) if (b.alive && b.team === 0) fogStamp(b.x, b.z, FOG_SIGHT.building);
  for (const f of robots) if (f.team === 0 && f.state !== 'ko') fogStamp(f.pos.x, f.pos.z, FOG_SIGHT.robot);
  for (const h of helis) if (h.team === 0 && h.alive) fogStamp(h.pos.x, h.pos.z, FOG_SIGHT.heli);
  for (const s of soldiers) if (s.team === 0 && s.alive && !s.inHeli) fogStamp(s.pos.x, s.pos.z, FOG_SIGHT.soldier);
  for (const k of trucks) if (k.team === 0 && !k.dead) fogStamp(k.x, k.z, FOG_SIGHT.truck);
  for (let i = 0; i < FOG_N * FOG_N; i++) { fogData[i * 4] = FOG_ON ? fogVis[i] * 255 : 255; fogData[i * 4 + 1] = FOG_ON ? fogExp[i] * 255 : 255; fogData[i * 4 + 3] = 255; }
  fogTex.needsUpdate = true; }
// hide what the player cannot see: enemy units out of sight, enemy buildings on unexplored ground
function applyFog() { if (!FOG_ON) return;
  for (const f of robots) if (f.team === 1 && !fogVisible(f.pos.x, f.pos.z)) { f.root.visible = false; if (f.bar) f.bar.g.visible = false; }
  for (const h of helis) if (h.team === 1) { const v = fogVisible(h.pos.x, h.pos.z); if (!v) { h.root.visible = false; h.fogHid = true; if (h.bar) h.bar.g.visible = false; } else if (h.fogHid) { h.root.visible = true; h.fogHid = false; } }
  for (const s of soldiers) if (s.team === 1 && !s.inHeli) { const v = fogVisible(s.pos.x, s.pos.z); s.root.visible = v; if (!v && s.bar) s.bar.g.visible = false; }
  for (const k of trucks) if (k.team === 1 && !k.dead) { const v = fogVisible(k.x, k.z); k.obj.visible = v; if (!v) { if (k.trailer.visible) { k.trailer.visible = false; k.fogTr = k.trailer; } } else if (k.fogTr) { if (k.fogTr === k.trailer) k.trailer.visible = true; k.fogTr = null; } }
  for (const L of [outposts, airbases, pumpjacks, camps, mines, farms, warehouses, hangars]) for (const b of L) if (b.team === 1 && b.obj) { if (!b.seen && fogVisible(b.x, b.z)) b.seen = true; b.obj.visible = !!b.seen; if (b.soil) b.soil.visible = !!b.seen; } }
const fogSeen = u => !FOG_ON || u.team !== 1 || (u.pos ? fogVisible(u.pos.x, u.pos.z) : fogVisible(u.x, u.z));
// ---- enemy AI helpers
let aiEcoT = 20, aiSquadT = 120;
const aiCount = (list, kind) => list.filter(p => p.alive && p.team === 1 && (!kind || p.kind === kind)).length;
// random points inside enemy territory: around the HQ and its outposts, optionally only near the border
function aiSpots(n, edge) { const t = towns[1], C = [{ x: t.x, z: t.z, r: TERR_HQ_R }, ...outposts.filter(o => o.alive && o.team === 1).map(o => ({ x: o.x, z: o.z, r: OUTPOST_R }))], out = [];
  for (let i = 0; i < n * 4 && out.length < n; i++) { const c = C[Math.floor(rand(0, C.length))], a = rand(0, 6.28), r = edge ? rand(c.r * 0.7, c.r * 0.97) : rand(TOWN * (c === C[0] ? 1 : 0) + 0.5, c.r - 1.5);
    const x = wm(c.x + Math.cos(a) * r), z = wm(c.z + Math.sin(a) * r); if (inTerritory(1, x, z)) out.push({ x, z, rot: Math.floor(rand(0, 4)) * Math.PI / 2 + rand(-0.3, 0.3) }); } return out; }
function aiTry(list, check, build, score) { let best = null, bs = -1e9; for (const q of list) { if (check(q)) continue; const s = score ? score(q) : 0; if (s > bs) { bs = s; best = q; } } if (!best) return false; build(best); return true; }
function aiBuildNext() { const T = missionClock, P = towns[0], pl = q => -wdist2(q.x, q.z, P.x, P.z);
  const plan = [
    // [condition, attempt]
    [aiCount(outposts) < Math.min && !canAfford(1, PRICE.outpost)(4, 1 + Math.floor(T / 150)), () => aiTry(aiSpots(40, true), q => canPlaceOutpost(1, q.x * S, q.z * S), q => buildOutpost(1, q.x * S, q.z * S, q.rot), pl)],
    [pumpProto && aiCount(pumpjacks) < 4 && !canAfford(1, PRICE.pump), () => aiTry(oilFields.filter(f => inTerritory(1, f.x, f.z)).map(f => ({ x: f.x, z: f.z, rot: f.rot })), q => canPlacePump(1, q.x * S, q.z * S, q.rot), q => buildPump(1, q.x * S, q.z * S, q.rot))],
    [semiParts && aiCount(warehouses) < 1 && !canAfford(1, PRICE.wh) && T > 90, () => aiTry(aiSpots(50), q => canPlaceWarehouse(1, q.x * S, q.z * S, q.rot), q => buildWarehouse(1, q.x * S, q.z * S, q.rot))],
    [mineProto && aiCount(mines) < (T > 300 ? 2 : 1) && !canAfford(1, PRICE.mine) && T > 80, () => aiTry(aiSpots(80).map(q => ({ ...q, rot: mineFacing(q.x, q.z) })), q => canPlaceMine(1, q.x * S, q.z * S, q.rot), q => buildMine(1, q.x * S, q.z * S, q.rot))],
    [WC_BOX && camps.filter(p => p.alive && p.team === 1 && !p.depleted).length < 2 && !canAfford(1, PRICE.camp) && T > 100, () => aiTry(aiSpots(50), q => canPlaceCamp(1, q.x * S, q.z * S, q.rot) || campTrees(q).length < 6, q => buildCamp(1, q.x * S, q.z * S, q.rot), q => campTrees(q).length)],
    [farmProto && aiCount(farms) < 3 && !canAfford(1, PRICE.farm) && T > 110, () => aiTry(aiSpots(40), q => canPlaceFarm(1, q.x * S, q.z * S, q.rot), q => buildFarm(1, q.x * S, q.z * S, q.rot))],
    [hangarProto && aiCount(hangars) < 1 && !canAfford(1, PRICE.hangar) && T > 200, () => aiTry(aiSpots(60), q => canPlaceHangar(1, q.x * S, q.z * S, q.rot), q => buildHangar(1, q.x * S, q.z * S, q.rot), q => -pl(q))] ];
  const keys = ['outpost', 'pump', 'wh', 'mine', 'camp', 'farm', 'hangar'];
  for (let i = 0; i < plan.length; i++) if (plan[i][0] && plan[i][1]()) { spend(1, PRICE[keys[i]]); return; } }
// hangar: build mechs while the army is small, research, send badly damaged mechs out of the fight for repair and idle ones for upgrades
function aiHangar() { const H = hangars.filter(h => h.alive && h.done && h.team === 1); if (!H.length) return;
  const army = robots.filter(r => r.team === 1 && r.state !== 'ko').length, queued = H.reduce((n, h) => n + h.buildQ.length, 0);
  const role = chance(0.4) ? 'gunner' : 'striker'; if (army + queued < 8 && !canAfford(1, PRICE[role]) && !queueMech(H[0], role)) spend(1, PRICE[role]);
  if (!mechResearch[1] && (army >= 3 || ORE[1] > 1500) && chance(0.4)) { const keys = Object.keys(MECH_UPGRADES).filter(k => MECH_UP[1][k] < MECH_UPGRADES[k].cost.length); if (keys.length) { const k = keys[Math.floor(rand(0, keys.length))], c = researchPrice(MECH_UPGRADES[k].cost[MECH_UP[1][k]]); if (!canAfford(1, c) && !startMechResearch(1, k)) spend(1, c); } }
  for (const f of robots) { if (f.team !== 1 || f.state === 'ko' || f.docked || f.svc) continue;
    if (f.hp < f.maxHp * 0.4 && !alive(f.target)) requestService(f, needsUpgrade(f) ? 'upgrade' : 'repair');
    else if (needsUpgrade(f) && !f.order && !alive(f.target) && chance(0.3)) requestService(f, 'upgrade'); } }
// infantry: replace lost squads at the HQ, ferry them to the front in a gunship
function aiInfantry() { if (!soldierKinds) return; const S1 = soldiers.filter(s => s.team === 1 && s.alive);
  aiSquadT -= 9; if (aiSquadT <= 0 && S1.length < 6) { aiSquadT = 120; spawnSquad(1, 6 - S1.length); log(1, `<b>${TEAM_NAME[1]}</b> infantry squad deploys at HQ`); }
  const h = helis.find(h => h.team === 1 && h.alive && !h.tr && h.fuel > h.fuelMax * 0.6 && h.hp > h.maxHp * 0.7), t = towns[1];
  if (h && missionClock > 120 && chance(0.25)) { if (h.cargo.length) { const tgt = robots.filter(r => r.team === 0 && r.state !== 'ko'), g = tgt.length ? tgt[Math.floor(rand(0, tgt.length))].pos : towns[0];
      for (let i = 0; i < 30; i++) { const a = rand(0, 6.28), x = wm(g.x + Math.cos(a) * 3), z = wm(g.z + Math.sin(a) * 3); if (Hd(x, z) > 2 / S * 1.2 && !lotBlocked(x, z, [])) { orderDrop(h, x, z); log(1, `<b>${TEAM_NAME[1]}</b> gunship ferries troops to the front`); break; } } }
    else { const idle = S1.filter(s => !s.order && !alive(s.target) && !s.inHeli && wdist2(s.pos.x, s.pos.z, t.x, t.z) < TERR_HQ_R); if (idle.length >= 3) orderBoard(idle, h); } }
  // soldiers already near the front advance with the robots
  for (const s of S1) if (!s.inHeli && !s.order && !alive(s.target) && wdist2(s.pos.x, s.pos.z, t.x, t.z) > TERR_HQ_R && chance(0.2)) { const e = robots.filter(r => r.team === 0 && r.state !== 'ko').sort((a, b) => wdist2(a.pos.x, a.pos.z, s.pos.x, s.pos.z) - wdist2(b.pos.x, b.pos.z, s.pos.x, s.pos.z))[0]; if (e && wdist2(e.pos.x, e.pos.z, s.pos.x, s.pos.z) < 8) s.order = { type: 'move', x: wm(e.pos.x + rand(-1, 1)), z: wm(e.pos.z + rand(-1, 1)) }; } }
function teamUpdate(dt) {
  for (const team of [0, 1]) { if (!towns[team].hqDown) CR[team] += CR_RATE / 60 * dt; }
  for (const team of [0, 1]) {
    if (towns[team].hqDown) continue;
    reinforceT[team] -= dt;
    const n = robots.filter(r => r.team === team && r.state !== 'ko').length;
    if (reinforceT[team] <= 0) { reinforceT[team] = 40; if (false) { const f = spawnRobot(team, chance(0.35) ? 'gunner' : 'striker', n); applyMechLevels(f, { weapons: MECH_UP[team].weapons, armor: MECH_UP[team].armor, boost: MECH_UP[team].boost }); f.hp = f.maxHp;
        const p = towns[team]; FX.flash(new THREE.Vector3(f.pos.x, Hd(f.pos.x, f.pos.z) + 0.4, f.pos.z), 0.8, f.col); FX.sparks(new THREE.Vector3(f.pos.x, Hd(f.pos.x, f.pos.z) + 0.3, f.pos.z), 30, f.col, 1.6);
        log(team, `<b>${TEAM_NAME[team]}</b> reinforcement arrives at HQ`); }
      if (false) { const t = towns[team]; const h = makeHeli(team, t.x + 1.5, t.z); log(team, `<b>${TEAM_NAME[team]}</b> replacement gunship arrives`); } }
  }
  // enemy AI: builds an air base after a while, keeps its pads full and researches upgrades
  aiAirT -= dt; if (aiAirT <= 0 && !towns[1].hqDown) { aiAirT = 12;
    const mine = airbases.filter(b => b.alive && b.team === 1);
    if (!mine.length && missionClock > 150 && hangars.some(h => h.alive && h.team === 1) && !canAfford(1, PRICE.airbase)) { const t = towns[1];
      for (let i = 0; i < 60; i++) { const a = rand(0, 6.28), r = rand(TOWN + 1, TERR_HQ_R - 3), rot = Math.floor(rand(0, 4)) * Math.PI / 2, x = wm(t.x + Math.cos(a) * r), z = wm(t.z + Math.sin(a) * r);
        if (!canPlaceAirbase(1, x * S, z * S, rot)) { buildAirbase(1, x * S, z * S, rot); spend(1, PRICE.airbase); break; } } }
    for (const b of mine) if (baseHelis(b) + b.queue < AB_CAP && (ORE[1] > 1200 || !helis.some(h => h.team === 1 && h.alive)) && !canAfford(1, PRICE.heli)) { queueHeli(b); spend(1, PRICE.heli); }
    if (mine.length && !research[1] && ORE[1] > 1500 && chance(0.3)) { const k = Object.keys(UPGRADES)[Math.floor(rand(0, 4))], lv = HELI_UP[1][k]; if (lv < UPGRADES[k].cost.length) { const c = researchPrice(UPGRADES[k].cost[lv]); if (!canAfford(1, c) && !startResearch(1, k)) spend(1, c); } } }
  // enemy AI: economy and support — outposts toward the player, pumps on its oil fields, a depot, woodcutters by forests,
  // farms, a mine in a hillside, a mech hangar; then keeps the hangar busy and sends its soldiers into battle by gunship
  aiEcoT -= dt; if (aiEcoT <= 0 && !towns[1].hqDown) { aiEcoT = 9; if (missionClock > 45) aiBuildNext(); aiHangar(); aiInfantry(); }
  missionClock += dt;
  for (const h of helis) if (h.team === 1 && h.alive && h.mode === 'landed' && h.fuel > h.fuelMax * 0.9 && h.hp > h.maxHp * 0.9 && chance(dt * 0.05)) h.sortie = true;
  // enemy AI: send attack waves toward the player's units / HQ
  waveT -= dt;
  if (waveT <= 0) { waveT = rand(55, 80);
    const idle = robots.filter(r => r.team === 1 && r.state !== 'ko' && !r.order && !alive(r.target));
    const targets = robots.filter(r => r.team === 0 && r.state !== 'ko');
    if (idle.length >= 2) {
      const keep = Math.max(1, Math.floor(idle.length * 0.3)); const go = idle.slice(keep);
      const pab = airbases.filter(b => b.alive && b.team === 0), tgt = pab.length && chance(0.4) ? pab[0] : targets.length ? targets[Math.floor(RNG() * targets.length)].pos : towns[0];
      go.forEach((r, i) => { r.order = { type: 'amove', x: wm(tgt.x + rand(-1, 1)), z: wm(tgt.z + rand(-1, 1)) }; });
      for (const eh of helis.filter(h => h.team === 1 && h.alive)) { eh.anchor = { x: wm(tgt.x), z: wm(tgt.z) }; eh.sortie = true; }
      log(1, `<b>Cobalt</b> launches an attack with ${go.length} robots`);
    }
  }
}

// ------------------------------------------------------------------ public API used by the page
const Battle = {
  ready: Promise.all([battleAssets, pumpAssets, woodAssets, mineAssets, farmAssets, semiAssets, soldierAssets, hangarAssets]),
  start() {
    const res = () => { for (const p of PARTS) p.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y); };
    addEventListener('resize', res); res();
    TOWNS.forEach((t, i) => buildTown(t, i));
    // neighbourhood trees: single trees in yards and along streets, clear of houses, roads, lots and the HQ corner
    TOWN_TREES.length = 0; TOWNS.forEach((t, idx) => { const r = mulberry(seed + idx * 131 + 7);
      for (let x = -TOWN - 0.8; x <= TOWN + 0.8; x += 0.32) for (let z = -TOWN - 0.8; z <= TOWN + 0.8; z += 0.32) {
        const jx = x + (r() - .5) * 0.22, jz = z + (r() - .5) * 0.22, wx = t.x + jx, wz = t.z + jz;
        if (r() > 0.2) continue;
        if (Math.hypot(jx, jz) < PLAZA_R + 0.4 || (idx < 2 && jx > 2.4 && jz > 2.4) || (Math.abs(jx - 0.95) < 0.4 && Math.abs(jz + 0.95) < 0.4)) continue;
        if (roadAt(wx * S, wz * S) > 0.01 || roadAt((wx + 0.25) * S, wz * S) > 0.01 || roadAt((wx - 0.25) * S, wz * S) > 0.01 || roadAt(wx * S, (wz + 0.25) * S) > 0.01 || roadAt(wx * S, (wz - 0.25) * S) > 0.01) continue;
        let blocked = false; for (const p of propsNear(wx, wz)) if (p.kind !== 'lamp' && wdist2(p.x, p.z, wx, wz) < p.r + 0.12) { blocked = true; break; }
        if (!blocked) TOWN_TREES.push([wm(wx) * S, wm(wz) * S, r()]); } });
    if (soldierKinds) for (const team of [0, 1]) spawnSquad(team, 6);
    placeBridges(); buildRoadMeshes(); placeOilFields(); spawnCars(40); spawnPeds(140); rebuildTerritory();
    const roles = [];   // mechs are precious: none to start, every one is built at a hangar
    for (const team of [0, 1]) roles.forEach((r, k) => spawnRobot(team, r, k));
    for (const team of [0, 1]) { const t = towns[team]; makeHeli(team, t.x + 1.5, t.z); }
    log(null, 'Destroy the <b>Cobalt</b> forces and their HQ tower. Build a mech hangar to field more mechs.');
    return { x: towns[0].x * S, z: (towns[0].z + 2) * S };
  },
  selectables() { return [...robots.filter(r => r.team === 0 && r.state !== 'ko'), ...helis.filter(h => h.team === 0 && h.alive), ...soldiers.filter(s => s.team === 0 && s.alive && !s.inHeli)]; },
  enemiesVisible() { return [...robots.filter(r => r.team === 1 && r.state !== 'ko'), ...helis.filter(h => h.team === 1 && h.alive), ...soldiers.filter(s => s.team === 1 && s.alive && !s.inHeli), ...airbases.filter(b => b.team === 1 && b.alive), ...pumpjacks.filter(p => p.team === 1 && p.alive), ...camps.filter(p => p.team === 1 && p.alive), ...mines.filter(p => p.team === 1 && p.alive)]; },
  // world-space anchor used for picking/selection (display copy nearest the camera)
  screenAnchor(u, out) { const c = camD(); const y = u.kind === 'robot' ? groundY(u) + (u.y + 0.5) * RS : u.kind === 'soldier' ? u.pos.y + SOLD_H * 0.6 : u.pos.y; return out.set(disp(u.pos.x, c.x) * S, y * S, disp(u.pos.z, c.z) * S); },
  // commands from the interface
  board: (sel, h) => orderBoard(sel, h),
  command(kind, sel) { sel = sel || Battle.selectables().filter(u => u.sel);
    if (kind === 'deploy') { for (const u of sel) if (u.kind === 'heli' && u.cargo && u.cargo.length) orderDrop(u, u.pos.x, u.pos.z); return; }
    for (const u of sel) { if (u.kind === 'soldier') { if (kind === 'stop' || kind === 'hold') { u.order = null; u.target = null; } continue; }
      if (u.kind !== 'robot') { if (kind === 'stop') { u.anchor = { x: u.pos.x, z: u.pos.z }; u.target = null; } continue; }
      if (kind === 'stop') { u.order = null; u.target = null; u.path = null; if (!['ko', 'fly', 'jump', 'air', 'dive'].includes(u.state)) toIdle(u, 0.12, 0.3); }
      if (kind === 'hold') { u.order = { type: 'hold', x: u.pos.x, z: u.pos.z }; u.path = null; if (u.state === 'walk') toIdle(u, 0.12, 0.2); } } },
  amove(sel, ground) { for (const u of sel) if (u.kind === 'robot') { u.order = { type: 'amove', x: wm(ground.x / S), z: wm(ground.z / S) }; u.target = null; u.thinkT = 0; } },
  select(list) { for (const u of Battle.selectables()) u.sel = false; for (const u of list) u.sel = true; },
  order(sel, ground, enemy) {
    if (!sel.length) return; if (enemy && !fogSeen(enemy)) enemy = null;
    if (enemy) { for (const u of sel) { u.order = { type: 'attack', target: enemy }; u.target = enemy; if (u.kind === 'robot' && u.state === 'idle') { u.thinkT = u.pilot.react * 0.5; u.st = 0; } if (u.kind === 'soldier') { u.order = null; u.target = enemy; continue; } if (u.kind === 'heli') { u.retarget = 0; u.anchor = { x: enemy.pos.x, z: enemy.pos.z }; u.sortie = true; if (u.mode === 'landed') u.mode = 'takeoff'; } }
      log(0, `Attack order: ${sel.length} unit${sel.length > 1 ? 's' : ''} → <b>${unitName(enemy)}</b>`); return; }
    const gx = ground.x / S, gz = ground.z / S;
    sel.forEach((u, i) => { const a = i * 2.4, r = 1.25 * Math.sqrt(i);   // spread formation
      let x = wm(gx + Math.cos(a) * r), z = wm(gz + Math.sin(a) * r);
      if (u.kind === 'robot' && !passableD(x, z)) {           // goal in deep water: stop at the last dry ground on the way
        const dx = wd(u.pos.x - x), dz = wd(u.pos.z - z), L = Math.hypot(dx, dz) || 1;
        for (let t = 0; t <= L; t += 0.1) { const px = x + dx * t / L, pz = z + dz * t / L; if (passableD(px, pz)) { x = wm(px); z = wm(pz); break; } } }
      if (u.kind === 'soldier') { const k = sel.filter(v => v.kind === 'soldier').indexOf(u), a2 = k * 2.4, r2 = 0.3 * Math.sqrt(k);   // soldiers form up tighter than mechs
        u.order = { type: 'move', x: wm(gx + Math.cos(a2) * r2), z: wm(gz + Math.sin(a2) * r2) }; u.target = null; u.stuck = 0; }
      else if (u.kind === 'heli' && u.cargo && u.cargo.length) orderDrop(u, x, z);
      else if (u.kind === 'heli') { u.anchor = { x, z }; u.order = null; u.target = null; u.retarget = 0; u.sortie = true; if (u.mode === 'landed') u.mode = 'takeoff'; }
      else { if (u.svc) cancelService(u); if (u.docked) return; u.order = { type: 'move', x, z }; u.target = null; if (u.state === 'fly') { u.flyGoal = { x, z }; if (u.flyPhase === 'down' && u.y > 0.3 && u.boost > 10) { u.flyPhase = 'cruise'; play(u, 'Boost_Forward', 0.2); } } else if (['idle', 'walk', 'fire'].includes(u.state)) { u.state === 'walk' ? (u.st = 99) : null; const rt = u.pilot.react * 0.5; u.thinkT = rt; if (u.state !== 'idle') toIdle(u, 0.12, rt); else u.st = 0; } } });
  },
  update(dt) {
    if (!gltf) return;
    updateRoadTiles(); updateCars(dt); updatePeds(dt); updateOutposts(dt); updateAirbases(dt); updateSites(dt); updatePumps(dt); updateOilFields(); updateCamps(dt); updateBridges(dt); updateMines(dt); updateFarms(dt); updateWarehouses(); updateTrucks(dt); if (soldierKinds) updateSoldiers(dt); updateHangars(dt);
    const c = camD();
    for (const f of robots) { if (f.docked) { f.vel.set(0, 0, 0); continue; } defend(f, dt); updateRobot(f, dt); }
    separate();
    for (const f of robots) {
      const dx = disp(f.pos.x, c.x), dz = disp(f.pos.z, c.z);
      f.visible = Math.hypot(dx - c.x, dz - c.z) * S < FOG_FAR + 100;
      f.root.visible = f.visible && !(f.sink > 0.9);
      f.root.position.set(dx, groundY(f) + f.y * RS - (f.sink || 0), dz); f.root.rotation.y = f.yaw;
      if (f.visible) { f.mixer.update(dt); weaponOverride(f); headTrack(f, dt); gunCarry(f, dt); idleFlavor(f, dt); f.model.updateMatrixWorld(true); plantFeet(f, dt); footLock(f, dt); footfalls(f); damageFX(f, dt); gunFX(f, dt); updateTrail(f);
        thrusters(f); }
      else { f.mixer.update(dt); }
      placeBar(f, dx * S, (groundY(f) + f.y * RS) * S, dz * S, f.visible && f.state !== 'ko');
      if (f.sel && f.state !== 'ko') { const r = ringFor(f); r.visible = true; r.position.set(dx, groundY(f) + 0.025, dz); } else if (f.ring) f.ring.visible = false;
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
    teamUpdate(dt); checkVictory(); updateFog(dt); applyFog();
    trauma = Math.max(0, trauma - dt * 1.1);
    Battle.hud();
  },
  shakeCamera() { const s = trauma * trauma; if (s < 0.0005) return; const t = performance.now() / 1000, amp = 0.012 * cam.dist * s;
    camera.position.x += amp * (Math.sin(t * 91) + Math.sin(t * 57)) * 0.5; camera.position.y += amp * (Math.sin(t * 73) + Math.sin(t * 41)) * 0.5; camera.position.z += amp * (Math.sin(t * 67) + Math.sin(t * 83)) * 0.5; },
  drawMini(ctx, s) {
    for (const t of towns) { ctx.strokeStyle = t.idx === 0 ? '#ff5aa8' : t.idx === 1 ? '#46b8ff' : '#e8e0d0'; ctx.lineWidth = 1.5; ctx.strokeRect(t.x * S * s - 5, t.z * S * s - 5, 10, 10); }
    for (const r of robots) { if (r.state === 'ko' || !fogSeen(r)) continue; ctx.fillStyle = r.team ? '#46b8ff' : '#ff5aa8'; ctx.fillRect(r.pos.x * S * s - 2, r.pos.z * S * s - 2, 4, 4); }
    for (const h of helis) { if (!h.alive || !fogSeen(h)) continue; ctx.fillStyle = h.team ? '#9fe0ff' : '#ffb0d8'; ctx.beginPath(); ctx.arc(h.pos.x * S * s, h.pos.z * S * s, 3, 0, 7); ctx.fill(); }
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
  fogTex, fogData, FOG_N, fogVisible, fogExplored, fogSeen, get fogOn() { return FOG_ON; }, set fogOn(v) { FOG_ON = v; fogT = 0; },
  CR, CR_RATE, PRICE, canAfford, spend, researchPrice,
  root: battleRoot, peds, outposts, OUTPOST_COST, airbases, AB_COST, HELI_COST, HELI_BUILD, AB_CAP, UPGRADES, HELI_UP, research, canPlaceAirbase, queueHeli, startResearch,
  buildAirbase: (xw, zw, rot) => buildAirbase(0, xw, zw, rot), airbaseGhost: () => airbaseProto ? makeAirbaseModel(true) : null, get airbaseError() { return AIRBASE_ERR; },
  airbaseAt2D: (xw, zw) => airbaseAt(new THREE.Vector3(wm(xw / S), -1e3, wm(zw / S))), baseHelis, siteLeft, pumpjacks, oilFields, bridges, mines, farms, warehouses, trucks, soldiers, hangars, HG_COST, MECH_UP, MECH_UPGRADES, MECH_COST, MECH_BUILD, mechResearch, canPlaceHangar, buildHangar: (xw, zw, rot) => buildHangar(0, xw, zw, rot), hangarGhost: () => hangarProto ? makeHangarModel(true) : null, get hangarError() { return HANGAR_ERR; },
  hangarAt2D: (xw, zw) => { const x = wm(xw / S), z = wm(zw / S); return hangars.find(h => h.alive && inHangarLot(h, x, z) && hgLocal(h, x, z).lz < 13) || null; }, requestService, startMechResearch, _hgL: hgLocal, _doorsReady: h => doorsReady(h), queueMech, needsUpgrade, mechLvl, _poseSoldier: poseSoldier, get _sgun() { return soldierGun; }, _offroad: offroad, _lotBlocked: lotBlocked, _semi: { cab: () => makeCab(), trailer: k => makeTrailer(k) }, WH_COST, canPlaceWarehouse, buildWarehouse: (xw, zw, rot) => buildWarehouse(0, xw, zw, rot), warehouseGhost: () => semiParts ? makeWarehouse(true) : null, get warehouseError() { return SEMI_ERR; }, FOOD, FM_COST, foodRate, canPlaceFarm, buildFarm: (xw, zw, rot, crop) => buildFarm(0, xw, zw, rot, crop), farmGhost: () => farmProto ? makeFarmModel(true, 'Lettuce') : null, get farmError() { return FARM_ERR; }, ORE, MN_COST, oreRate, canPlaceMine, buildMine: (xw, zw, rot) => buildMine(0, xw, zw, rot), mineGhost: () => mineProto ? makeMineModel(true) : null, get mineError() { return MINE_ERR; }, mineSnap: (xw, zw) => ({ x: xw, z: zw, rot: mineFacing(wm(xw / S), wm(zw / S)) }), _impact: (...a) => impact(...a), camps, WOOD, WC_COST, WC_REACH, woodRate, canPlaceCamp, buildCamp: (xw, zw, rot) => buildCamp(0, xw, zw, rot), campGhost: () => WC_BOX ? makeCampModel(true) : null, get campError() { return WOOD_ERR; }, campTreeCount: (xw, zw, rot) => WC_BOX ? campTrees({ x: wm(xw / S), z: wm(zw / S), rot: rot || 0 }).length : 0,
   oilSnap: (xw, zw) => { const f = fieldAt(wm(xw / S), wm(zw / S)) || oilFields.find(f => wdist2(f.x, f.z, wm(xw / S), wm(zw / S)) < OIL_R * 1.2); return f ? { x: f.x * S, z: f.z * S, rot: f.rot } : null; }, OIL, PJ_COST, PJ_RATE, oilRate, canPlacePump, buildPump: (xw, zw, rot) => buildPump(0, xw, zw, rot), pumpGhost: () => PJ_BOX ? makePumpModel(true) : null, get pumpError() { return PUMP_ERR; },
  canPlaceOutpost, inTerritory, terrDiscs, territoryTex: terrTex,
  buildOutpost: (xw, zw, rot) => buildOutpost(0, xw, zw, rot),
  outpostGhost: () => outpostProto ? makeOutpostModel(true) : null, get outpostError() { return OUTPOST_ERR; }, ghostMat: GHOST_MAT, OUTPOST_SENSE, townTrees: TOWN_TREES, _tac: { incoming, attackersOf, alliesNear, DEF_LOG, wreckCar }, cars, get roadNet() { return ROAD_NET; }, robots, helis, towns, TOWNS, wrecks, _startClash: (a, b) => startClash(a, b), get roadSegs() { return Battle_roadSegs; }, get debris() { return debris; },
};
window.Battle = Battle;
window.planTowns = planTowns;
window.noTreesAt = noTreesAt;
Object.defineProperty(Battle, 'roadTex', { get: () => roadTex });
})();
