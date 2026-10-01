// Procedural iron-ore mine for an RTS. Every piece is a separate named mesh so it can be
// destroyed, every ore rock is its own mesh, the conveyor belt scrolls and carries ore,
// and the bins/hopper can be filled or emptied with an animation.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise / random
const fade = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, v) => fade(clamp((v - a) / (b - a), 0, 1));
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const u = fade(x - X), v = fade(y - Y), w = fade(z - Z);
  const h = (a, b, c) => hash3(X + a, Y + b, Z + c);
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
function fbm(x, y, z, o = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < o; i++) { s += a * noise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- textures (match the reference atlas)
function makeTex(size, pixel, post) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = pixel(x, y), i = (y * size + x) * 4;
    img.data[i] = p[0]; img.data[i + 1] = p[1]; img.data[i + 2] = p[2]; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (post) post(ctx, size, rng(size * 7 + 1));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function rustStreaks(ctx, S, r, n, alpha = 0.45) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y0 = r() * S, len = 20 + r() * S * 0.5, w = 1 + r() * 4;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, `rgba(125,65,25,${alpha})`);
    g.addColorStop(1, 'rgba(125,65,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, len);
  }
}
function buildTextures() {
  const T = {};
  T.concrete = makeTex(256, (x, y) => {
    const k = 0.8 + 0.32 * fbm(x / 22, y / 22, 1) + 0.08 * (hash3(x, y, 9) - 0.5);
    return [186 * k, 174 * k, 152 * k];
  }, (ctx, S, r) => {
    ctx.strokeStyle = 'rgba(70,60,50,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(S, 1); ctx.moveTo(1, 0); ctx.lineTo(1, S);
    ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
    rustStreaks(ctx, S, r, 14, 0.35);
    ctx.fillStyle = 'rgba(60,50,40,.5)';
    for (let i = 0; i < 40; i++) ctx.fillRect(r() * S, r() * S, 2, 2);
  });
  T.corrugated = makeTex(256, (x, y) => {
    const sh = 0.78 + 0.25 * Math.cos(((x % 16) / 16) * Math.PI * 2);
    const n = 0.9 + 0.2 * fbm(x / 30, y / 30, 2, 3);
    return [104 * sh * n, 118 * sh * n, 84 * sh * n];
  }, (ctx, S, r) => rustStreaks(ctx, S, r, 30, 0.5));
  T.panel = makeTex(256, (x, y) => {
    const k = 0.85 + 0.25 * fbm(x / 25, y / 25, 3, 4);
    return [96 * k, 110 * k, 70 * k];
  }, (ctx, S, r) => {
    ctx.fillStyle = 'rgba(110,58,28,.85)';
    ctx.fillRect(0, 0, S, 8); ctx.fillRect(0, 0, 8, S); ctx.fillRect(0, S / 2 - 4, S, 8);
    ctx.fillStyle = 'rgba(90,50,25,1)';
    for (let i = 8; i < S; i += 32) { ctx.beginPath(); ctx.arc(4, i, 3, 0, 7); ctx.arc(i, 4, 3, 0, 7); ctx.fill(); }
    rustStreaks(ctx, S, r, 10, 0.4);
  });
  T.rust = makeTex(256, (x, y) => {
    const n = fbm(x / 18, y / 18, 3, 4), m = fbm(x / 40, y / 40, 5, 3);
    const b = m > 0.55 ? [150, 78, 38] : m < 0.4 ? [70, 45, 32] : [100, 56, 34];
    const k = 0.75 + 0.5 * n;
    return [b[0] * k, b[1] * k, b[2] * k];
  });
  T.steel = makeTex(256, (x, y) => {
    const k = 0.8 + 0.35 * fbm(x / 20, y / 20, 4, 4);
    return [58 * k, 61 * k, 64 * k];
  }, (ctx, S, r) => {
    ctx.strokeStyle = 'rgba(160,160,160,.18)'; ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) { const x = r() * S, y = r() * S; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - .5) * 60, y + (r() - .5) * 60); ctx.stroke(); }
    ctx.fillStyle = 'rgba(120,60,25,.35)';
    for (let i = 0; i < 25; i++) ctx.fillRect(r() * S, r() * S, 3 + r() * 6, 2 + r() * 5);
  });
  T.rock = makeTex(256, (x, y) => {
    const k = 0.55 + 0.75 * fbm(x / 14, y / 14, 4, 5);
    return [140 * k, 132 * k, 118 * k];
  });
  T.ore = makeTex(256, (x, y) => {
    const n = fbm(x / 12, y / 12, 6, 5), m = fbm(x / 30, y / 30, 7, 3);
    const b = m > 0.58 ? [150, 88, 58] : m < 0.42 ? [55, 35, 28] : [112, 58, 40];
    const k = 0.6 + 0.7 * n + (hash3(x, y, 3) > 0.985 ? 0.6 : 0);
    return [b[0] * k, b[1] * k, b[2] * k];
  });
  T.ground = makeTex(256, (x, y) => {
    let k = 0.72 + 0.4 * fbm(x / 20, y / 20, 8, 4);
    if (hash3(x >> 1, y >> 1, 4) > 0.97) k *= 0.6;
    return [255 * k, 250 * k, 240 * k];
  });
  T.paving = makeTex(256, (x, y) => {
    const k = 0.78 + 0.3 * fbm(x / 18, y / 18, 13, 4) + 0.06 * (hash3(x >> 6, y >> 5, 14) - 0.5);
    return [150 * k, 132 * k, 102 * k];
  }, (ctx, S, r) => {
    ctx.strokeStyle = 'rgba(60,48,32,.75)'; ctx.lineWidth = 3;
    for (let y = 0; y <= S; y += S / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
    for (let row = 0; row < 8; row++) for (let x = (row % 2) * S / 8; x <= S; x += S / 4) {
      ctx.beginPath(); ctx.moveTo(x, row * S / 8); ctx.lineTo(x, (row + 1) * S / 8); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(95,80,50,.35)';
    for (let i = 0; i < 60; i++) ctx.fillRect(r() * S, r() * S, 2 + r() * 10, 2 + r() * 6);
  });
  T.grate = makeTex(128, (x, y) => {
    const k = 0.75 + 0.3 * fbm(x / 10, y / 10, 15, 3);
    return [150 * k, 140 * k, 120 * k];
  }, (ctx, S) => {
    ctx.fillStyle = 'rgba(55,48,40,.85)';
    for (let x = 8; x < S - 8; x += 10) ctx.fillRect(x, 10, 4, S - 20);
    ctx.strokeStyle = 'rgba(55,48,40,.9)'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, S - 10, S - 10);
  });
  return T;
}
function makeBeltTexture() {
  return makeTex(128, (x, y) => {
    const k = 0.85 + 0.3 * hash3(x, y, 2);
    return [34 * k, 34 * k, 35 * k];
  }, (ctx, S) => { ctx.fillStyle = 'rgba(78,78,80,1)'; for (let x = 0; x < S; x += 32) ctx.fillRect(x, 0, 6, S); });
}

// ---------------------------------------------------------------- geometry helpers
function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }
// Box with world-scaled UVs (texture tile = ts metres) so textures don't stretch.
function box(w, h, d, mat, ts = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / ts, uv.getY(i) * dims[f][1] / ts);
  }
  return shadowed(new THREE.Mesh(g, mat));
}
// Box spanning two points in the XY plane (used for the portal's steel frame).
function beamXY(x1, y1, x2, y2, thick, depth, mat) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const m = box(len + thick, thick, depth, mat, 1.5);
  m.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
  m.rotation.z = Math.atan2(y2 - y1, x2 - x1);
  return m;
}
function rockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = new THREE.Vector3(), off = seed * 17.3;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.7 + 0.6 * fbm(v.x * 1.2 + off, v.y * 1.2, v.z * 1.2, 3));
    v.y *= 0.8;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Extruded prism from a 2D outline; UVs scaled to `ts` metres per texture tile.
function prism(points, depth, mat, ts = 2) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: false });
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / ts, uv.getY(i) / ts);
  return shadowed(new THREE.Mesh(g, mat));
}
// Box stretched between two world points (used for legs, braces, chutes).
function beam(a, b, w, h, mat, ts = 1) {
  const len = a.distanceTo(b);
  const m = box(w, h, len, mat, ts);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b);
  return m;
}

// ---------------------------------------------------------------- layout
// Metres. Matched to the reference render with a fitted orthographic camera (REFERENCE_VIEW).
// +X runs down-right on screen along the bin row, +Z runs down-left toward the viewer.
export const REFERENCE_VIEW = { azimuth: 0.6023, elevation: 0.4456, pxPerMetre: 58.0176, origin: [470.05, 616.31], size: [1536, 1024] };

const PORTAL = { x: -1.225, z: -6.04, rot: 1.133 };       // tunnel portal centre (face) and yaw
const PT = [Math.cos(PORTAL.rot), -Math.sin(PORTAL.rot)];  // portal local +X in world xz
const PN = [Math.sin(PORTAL.rot), Math.cos(PORTAL.rot)];   // portal local +Z (face normal)
const toPortal = (x, z) => { const dx = x - PORTAL.x, dz = z - PORTAL.z; return [dx * PT[0] + dz * PT[1], dx * PN[0] + dz * PN[1]]; };

const BIN = { x0: 0, w: 4.2, d: 4.85, wall: 1.45, t: 0.45 };
const BELT_TAIL = new THREE.Vector3(-1.58, 1.2, -7.64);
const BELT_HEAD = new THREE.Vector3(8.95, 4.05, -3.0);
const HOPPER = { x: 9.95, z: -2.9, size: 2.7, top: 3.8, boxH: 1.45 };
const BUILDING = { x0: 6.7, x1: 12.5, z0: -11.6, z1: -6.9, plinth: 0.4, eave: 3.3, ridge: 4.6, yaw: -0.15 };
const ANNEX = { x0: 9.6, x1: 12.3, z0: -6.9, z1: -4.4, h: 2.8 };

// Foot of the hill, ordered left-front → right-back (hill lies on the back side).
const HILL_EDGE = [[-40, 12], [-15, 5.5], [-11, 4.3], [-6.5, 3.1], [-4.4, 0.6], [-3.3, -1.6], [-2.75, -2.9], [-1.0, -6.4], [0.4, -9.2], [3.0, -10.9], [5.2, -12.3], [9, -13.1], [14, -14.3], [20, -16], [45, -24]];
// Outline of the ground tile.
const GROUND_EDGE = [[-9.7, -0.7], [-7, 2.1], [-3.6, 4.3], [-2.0, 5.8], [1.4, 7.5], [5.7, 9.8], [9.6, 10.1], [13.4, 9.4], [15.7, 6.7], [16.9, 3.6], [17.3, -0.1], [17.2, -3.9], [16.3, -7.6], [13.6, -12.1], [11.5, -14.6], [7, -21], [-2, -23], [-11, -19], [-15.5, -10], [-13.5, -3.6]];
// Paved yard between the portal, conveyor, hopper and bins.
const YARD = [[-2.6, -2.4], [-1.6, -5.0], [-0.3, -8.4], [1.5, -9.4], [4.6, -8.6], [8.2, -6.0], [8.6, -1.3], [5.5, -0.6], [0.5, -0.5], [-1.8, -0.9]];

function polyDist(poly, x, z) { // signed: >0 on the back (left-hand) side of the polyline
  let best = 1e9, sgn = 1;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[i + 1], vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) { best = d; sgn = vx * (z - az) - vz * (x - ax) < 0 ? 1 : -1; }
  }
  return best * sgn;
}
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function edgeDistClosed(poly, x, z) {
  let best = 1e9;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return inPoly(poly, x, z) ? best : -best;
}

export function heightAt(x, z) {
  let h = 0.05 * (fbm(x * 0.6, z * 0.6, 3, 3) - 0.5);
  const d = polyDist(HILL_EDGE, x, z) + 0.6 * (noise3(x * 0.5, z * 0.5, 41) - 0.5);
  if (d > 0) {
    // mound fitted to the reference silhouette, cut by the hill foot line, with ribs and gullies
    const ramp = 1 - Math.exp(-d / 2.2);
    const u = ((x - 1.125) / 12.55) ** 2 + ((z + 7.04) / 13.56) ** 2;
    const [plx, plz] = toPortal(x, z);
    const H = 16.5 * Math.max(0, 1 - u) ** 1.078 + 4 * Math.exp(-(plx * plx / 18 + (plz + 5) ** 2 / 10));
    const gully = Math.abs(noise3(x * 0.3 + z * 0.12, z * 0.3, 31) - 0.5) * 2;
    const rough = fbm(x * 0.9, z * 0.9, 33, 3) - 0.5;
    const rim = smoothstep(0.3, 7, edgeDistClosed(GROUND_EDGE, x, z)) ** 0.8;
    h += Math.max(0, H * ramp * (0.9 + 0.25 * (gully - 0.5)) + 0.5 * rough * ramp) * rim;
  }
  // the ground tile rolls off at its rim
  h -= 0.35 * smoothstep(0.8, -0.2, edgeDistClosed(GROUND_EDGE, x, z));
  // tunnel: clear the mouth, flatten the hill onto the lining roof over the bore
  const [lx, lz] = toPortal(x, z);
  if (Math.abs(lx) < 4.6 && lz < 3 && lz > -7) {
    const k = smoothstep(3.7, 4.5, Math.abs(lx));
    if (lz > -1.5) h *= k;
    else h = lerp(Math.max(h, 5.3), h, Math.max(k, smoothstep(-5.9, -6.9, lz))); // keep the hill over the lining roof
  }
  return h;
}

// ---------------------------------------------------------------- main factory
/**
 * createMine(options) → controller
 *   root                 THREE.Group to add to your scene
 *   parts                { name: Object3D } every destroyable part (+ section groups)
 *   sections             section names: 'portal', 'conveyor', 'hopper', 'building', 'bin_0'...
 *   update(dt)           call every frame
 *   setConveyor({running, speed})
 *   setFill(name, 0..1, {instant, rate}) / getFill(name)   name: 'bin_0'|'bin_1'|'bin_2'|'hopper'
 *   destroy(name)        a part or a section; pieces fly off and settle as rubble
 *   destroyAll() / rebuild()
 *   partOf(object3D)     -> { part, section } for raycast picking
 */
export function createMine(options = {}) {
  const opts = Object.assign({ autoCycle: true, beltSpeed: 1.0, seed: 1 }, options);
  const r = rng(opts.seed * 9973);
  const T = buildTextures();
  const beltTex = makeBeltTexture();
  const std = (map, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ map, roughness: 0.9, metalness: 0.05 }, o));
  const M = {
    concrete: std(T.concrete),
    roofGreen: std(T.corrugated, { roughness: 0.7, metalness: 0.2 }),
    roofGreen2: std(T.corrugated, { roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }),
    panel: std(T.panel, { roughness: 0.75, metalness: 0.2 }),
    panel2: std(T.panel, { roughness: 0.75, metalness: 0.2, side: THREE.DoubleSide }),
    rust: std(T.rust, { roughness: 0.85, metalness: 0.2 }),
    steel: std(T.steel, { roughness: 0.6, metalness: 0.3 }),
    grate: std(T.grate),
    belt: std(beltTex, { roughness: 0.95 }),
    rock: std(T.rock, { flatShading: true, roughness: 1 }),
    ore: std(T.ore, { flatShading: true, roughness: 0.85 }),
    ground: std(T.ground, { vertexColors: true, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2228, roughness: 0.3, metalness: 0.4 }),
    void: new THREE.MeshBasicMaterial({ color: 0x060504, side: THREE.BackSide }),
  };
  const oreGeos = Array.from({ length: 12 }, (_, i) => rockGeometry(i + opts.seed * 31, i % 3 ? 0 : 1));
  const cliffGeos = Array.from({ length: 10 }, (_, i) => rockGeometry(i * 3 + 7 + opts.seed * 31, 0));

  const root = new THREE.Group();
  root.name = 'Mine';
  const parts = {};
  const sections = [];
  const P = (name, obj, parent) => { obj.name = name; obj.userData.part = name; parts[name] = obj; parent.add(obj); return obj; };
  const S = name => { const g = new THREE.Group(); P(name, g, root); sections.push(name); return g; };
  const rock = (mat, s, geos = oreGeos) => {
    const m = shadowed(new THREE.Mesh(geos[Math.floor(r() * geos.length)], mat));
    m.scale.setScalar(s);
    m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
    return m;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------------- terrain (static)
  {
    const g = new THREE.PlaneGeometry(40, 40, 200, 200);
    g.rotateX(-Math.PI / 2);
    g.translate(3, 0, -5.5);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const n = g.attributes.normal, col = [], c = new THREE.Color();
    const C = (r_, g_, b_) => new THREE.Color().setRGB(r_, g_, b_, THREE.SRGBColorSpace);
    const dirt = C(0.5, 0.42, 0.28), olive = C(0.53, 0.48, 0.27), dry = C(0.58, 0.5, 0.34), stone = C(0.44, 0.4, 0.34);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      c.copy(dirt).lerp(olive, smoothstep(0.35, 0.7, fbm(x * 0.3, z * 0.3, 11, 3)));
      c.lerp(dry, 0.5 * smoothstep(0.5, 0.75, fbm(x * 0.8, z * 0.8, 17, 3)));
      const steep = smoothstep(0.8, 0.55, n.getY(i)) * smoothstep(0.8, 2, y);
      c.lerp(stone, clamp(steep * 0.45, 0, 1));
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 11, uv.getY(i) * 11);
    const idx = g.index.array, keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      const cx = (p.getX(idx[i]) + p.getX(idx[i + 1]) + p.getX(idx[i + 2])) / 3;
      const cz = (p.getZ(idx[i]) + p.getZ(idx[i + 1]) + p.getZ(idx[i + 2])) / 3;
      const [lx, lz] = toPortal(cx, cz);
      const low = Math.max(p.getY(idx[i]), p.getY(idx[i + 1]), p.getY(idx[i + 2])) < 5.0;
      if (low && Math.abs(lx) < 2.45 && lz < -0.1 && lz > -5.6) continue; // tunnel bore
      if (edgeDistClosed(GROUND_EDGE, cx, cz) + 0.12 * (hash3(cx * 13, cz * 13, 1) - 0.5) + 0.5 * (noise3(cx * 1.4, cz * 1.4, 2) - 0.5) + 0.6 * (noise3(cx * 0.5, cz * 0.5, 3) - 0.5) > 0)
        keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g.setIndex(keep);
    const terrain = new THREE.Mesh(g, M.ground);
    terrain.receiveShadow = true;
    terrain.userData.static = true;
    P('terrain', terrain, root);

    // paved yard: a draped decal with a soft, ragged edge
    const yg = new THREE.PlaneGeometry(14, 12, 70, 60);
    yg.rotateX(-Math.PI / 2);
    yg.translate(3, 0, -4.8);
    const yp = yg.attributes.position, yc = [];
    for (let i = 0; i < yp.count; i++) {
      const x = yp.getX(i), z = yp.getZ(i);
      yp.setY(i, heightAt(x, z) + 0.025);
      const e = edgeDistClosed(YARD, x, z) + 0.7 * (noise3(x * 0.9, z * 0.9, 51) - 0.5);
      yc.push(1, 1, 1, smoothstep(-0.1, 0.6, e));
    }
    yg.setAttribute('color', new THREE.Float32BufferAttribute(yc, 4));
    const yuv = yg.attributes.uv;
    for (let i = 0; i < yuv.count; i++) yuv.setXY(i, yuv.getX(i) * 14 / 4.8, yuv.getY(i) * 12 / 4.8);
    const yard = new THREE.Mesh(yg, std(T.paving, { vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    yard.receiveShadow = true;
    yard.userData.static = true;
    P('yard_paving', yard, root);
  }

  // ---------------- tunnel portal
  {
    const sec = S('portal');
    sec.position.set(PORTAL.x, 0, PORTAL.z);
    sec.rotation.y = PORTAL.rot;
    const add = (name, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return P('portal_' + name, m, sec); };
    const D = 1.7; // frame depth, face at local z = 0
    const frame = {
      pillar_left: [[-3.5, 0], [-2.45, 0], [-2.45, 2.85], [-3.5, 3.45]],
      haunch_left: [[-3.5, 3.45], [-2.45, 2.85], [-1.65, 3.65], [-1.65, 4.75], [-2.45, 4.75]],
      lintel: [[-1.65, 3.65], [1.65, 3.65], [1.65, 4.75], [-1.65, 4.75]],
    };
    frame.haunch_right = frame.haunch_left.map(([x, y]) => [-x, y]).reverse();
    frame.pillar_right = frame.pillar_left.map(([x, y]) => [-x, y]).reverse();
    for (const [n, pts] of Object.entries(frame)) add(n, prism(pts, D, M.concrete), 0, 0, -D);
    // outer chamfered rim of the frame
    const rim = { left: [[-3.75, 0], [-3.5, 0], [-3.5, 3.45], [-2.45, 4.75], [-2.45, 5.0], [-3.75, 3.55]], top: [[-2.45, 4.75], [2.45, 4.75], [2.45, 5.0], [-2.45, 5.0]] };
    rim.right = rim.left.map(([x, y]) => [-x, y]).reverse();
    for (const [n, pts] of Object.entries(rim)) add('rim_' + n, prism(pts, D - 0.3, M.concrete), 0, 0, -D + 0.1);
    // inner rusted steel frame following the chamfered opening
    const inner = [[-2.3, 0], [-2.3, 2.8], [-1.55, 3.55], [1.55, 3.55], [2.3, 2.8], [2.3, 0]];
    const names = ['post_left', 'brace_left', 'header', 'brace_right', 'post_right'];
    for (let i = 0; i < 5; i++) {
      const [x1, y1] = inner[i], [x2, y2] = inner[i + 1];
      const m = P('portal_steel_' + names[i], beamXY(x1, y1, x2, y2, 0.3, 0.3, M.rust), sec);
      m.position.z = 0.12;
      const fl = P('portal_steel_' + names[i] + '_flange', beamXY(x1, y1, x2, y2, 0.46, 0.06, M.rust), sec);
      fl.position.z = 0.3;
    }
    add('steel_band', box(4.9, 0.32, 0.18, M.rust, 1), 0, 4.2, 0.1);
    add('steel_band_low', box(3.5, 0.14, 0.14, M.rust, 1), 0, 3.85, 0.12);
    [-1.3, 0, 1.3].forEach((x, i) => add('plate_' + i, box(0.55, 0.14, 0.05, M.concrete, 1), x, 4.22, 0.21));
    // forward buttress on the left, low retaining wall stepping into the hill, big block on the right
    add('buttress_left', box(1.05, 2.3, 1.5, M.concrete), -3.0, 1.15, 0.7);
    const lw = add('retaining_wall_left', box(3.2, 1.35, 0.5, M.concrete), -4.9, 0.67, 0.55);
    lw.rotation.y = -0.55;
    add('retaining_cap_left', box(0.7, 1.45, 0.7, M.concrete, 1), -6.3, 0.72, -0.35);
    add('block_right', box(1.9, 2.45, 2.0, M.concrete), 3.95, 1.22, 0.55);
    add('block_right_cap', box(2.0, 0.12, 2.1, M.concrete, 1), 3.95, 2.5, 0.55);
    // bore: lining walls + roof slab under the hill, dark interior
    add('lining_left', box(0.6, 4.0, 4.0, M.concrete), -2.75, 2.0, -D - 2.0);
    add('lining_right', box(0.6, 4.0, 4.0, M.concrete), 2.75, 2.0, -D - 2.0);
    add('lining_roof', box(6.4, 1.0, 4.3, M.rock, 3), 0, 4.6, -D - 2.0);
    const voidBox = new THREE.Mesh(new THREE.BoxGeometry(4.55, 3.95, 5.6), M.void);
    voidBox.position.set(0, 1.97, -2.75);
    voidBox.userData.static = true;
    sec.add(voidBox);
    for (let i = 0; i < 6; i++) add('sleeper_' + i, box(1.6, 0.08, 0.22, M.steel, 1), 1.3, 0.05, 0.2 - i * 0.7);
    for (let i = 0; i < 10; i++) {
      const s = 0.15 + r() * 0.25;
      add('rubble_' + i, rock(r() < 0.5 ? M.ore : M.rock, s), -1.9 + r() * 2.2, s * 0.5, -1.2 - r() * 3.2);
    }
  }

  // ---------------- conveyor
  const beltDir = BELT_HEAD.clone().sub(BELT_TAIL);
  const beltLen = beltDir.length();
  beltDir.normalize();
  const side = new THREE.Vector3().crossVectors(beltDir, V(0, 1, 0)).normalize();
  const upv = new THREE.Vector3().crossVectors(side, beltDir);
  const beltOre = [], rollers = [];
  const BELT_TILE = 0.6;
  {
    const sec = S('conveyor');
    const frame = new THREE.Group();
    frame.position.copy(BELT_TAIL);
    frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(beltDir, upv, side));
    sec.add(frame);
    const mid = beltLen / 2;
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P('conveyor_' + name, m, frame); };
    // channel frame: tall side stringers, belt, return strand
    add('stringer_left', box(beltLen, 0.42, 0.1, M.steel, 1), mid, -0.02, -0.58);
    add('stringer_right', box(beltLen, 0.42, 0.1, M.steel, 1), mid, -0.02, 0.58);
    add('skirt_left', box(beltLen - 0.4, 0.14, 0.05, M.rust, 1), mid, 0.25, -0.5);
    add('skirt_right', box(beltLen - 0.4, 0.14, 0.05, M.rust, 1), mid, 0.25, 0.5);
    add('return_strand', box(beltLen, 0.04, 0.9, M.belt, BELT_TILE), mid, -0.2, 0);
    const belt = add('belt', box(beltLen, 0.05, 1.0, M.belt, BELT_TILE), mid, 0.1, 0);
    belt.material = M.belt;
    add('tail_housing', box(0.9, 0.7, 1.3, M.steel, 1), 0.25, 0.05, 0);
    for (const [n, x, rad] of [['head', beltLen, 0.16], ['tail', 0, 0.16]]) {
      const rl = add('roller_' + n, shadowed(new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 1.1, 12), M.steel)), x, 0, 0);
      rl.userData.spin = 0; rl.rotation.set(Math.PI / 2, 0, 0);
      rollers.push(rl);
    }
    for (let i = 0; i < 10; i++) {
      const rl = add('idler_' + i, shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.05, 8), M.steel)), (i + 0.5) * beltLen / 10, 0.04, 0);
      rl.userData.spin = 0; rl.rotation.set(Math.PI / 2, 0, 0);
      rollers.push(rl);
    }
    const N = 26;
    for (let i = 0; i < N; i++) {
      const s = 0.13 + r() * 0.12;
      const m = P('conveyor_ore_' + i, rock(M.ore, s), frame);
      beltOre.push({ mesh: m, s: i / N + r() * 0.015, z: (r() - 0.5) * 0.5, h: s * 0.6 });
    }
    // H-frame supports on paired concrete footings (positions taken from the reference)
    const yaw = Math.atan2(side.x, side.z);
    [[-1.1, -7.45], [2.45, -5.87], [5.34, -4.56]].forEach(([fx, fz], i) => {
      const L = (fx - BELT_TAIL.x) / beltDir.x;
      const p = BELT_TAIL.clone().addScaledVector(beltDir, L);
      const top = p.y - 0.22;
      for (const sgn of [-1, 1]) {
        const lp = p.clone().addScaledVector(side, sgn * 0.62);
        const tag = `${i}_${sgn < 0 ? 'l' : 'r'}`;
        const leg = P('conveyor_leg_' + tag, box(0.16, top - 0.3, 0.16, M.steel, 1), sec);
        leg.position.set(lp.x, 0.3 + (top - 0.3) / 2, lp.z);
        const foot = P('conveyor_footing_' + tag, box(0.6, 0.45, 0.6, M.concrete, 1), sec);
        foot.position.set(lp.x, 0.225, lp.z);
        foot.rotation.y = yaw;
      }
      for (const [k, y] of [['top', top], ['mid', 0.3 + (top - 0.3) * 0.45]]) {
        const cb = P(`conveyor_cross_${i}_${k}`, box(0.12, 0.14, 1.4, M.steel, 1), sec);
        cb.position.set(p.x, y, p.z);
        cb.rotation.y = yaw;
      }
    });
  }

  // ---------------- fillables (bins + hopper)
  const fills = {};
  function makeFill(name, parent, { cx, cz, floorY, w, d, maxH, count, smin = 0.17, smax = 0.36 }) {
    const items = [];
    const sp = (smin + smax) * 0.95;
    for (let gx = -w / 2 + sp / 2; gx < w / 2; gx += sp) for (let gz = -d / 2 + sp / 2; gz < d / 2; gz += sp) {
      const s = smin + r() * (smax - smin);
      items.push({ base: V(cx + gx + (r() - 0.5) * sp * 0.4, floorY + s * 0.4, cz + gz + (r() - 0.5) * sp * 0.4), s });
    }
    for (let i = 0; i < count; i++) {
      const x = (r() - 0.5) * w, z = (r() - 0.5) * d;
      const nx = x / (w / 2), nz = z / (d / 2);
      const hm = maxH * Math.max(0.12, 1 - 0.75 * Math.max(nx * nx, nz * nz) - 0.25 * (nx * nx + nz * nz));
      const s = smin + r() * (smax - smin);
      items.push({ base: V(cx + x, floorY + s * 0.45 + Math.sqrt(r()) * hm, cz + z), s });
    }
    items.sort((a, b) => a.base.y - b.base.y);
    items.forEach((it, i) => {
      it.mesh = P(`${name}_ore_${i}`, rock(M.ore, it.s), parent);
      it.mesh.position.copy(it.base);
      it.mesh.visible = false;
      it.on = false; it.t = 0;
    });
    fills[name] = { items, level: 0, target: 0, rate: 0.5 };
  }

  // ---------------- hopper (green bin on legs, funnel bottom, chute into the annex)
  {
    const sec = S('hopper');
    const { x: HX, z: HZ, size: Hs, top: Ht, boxH } = HOPPER, h2 = Hs / 2, yb = Ht - boxH;
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P('hopper_' + name, m, sec); };
    add('wall_front', box(Hs, boxH, 0.08, M.panel, 1.2), HX, yb + boxH / 2, HZ + h2);
    add('wall_back', box(Hs, boxH, 0.08, M.panel, 1.2), HX, yb + boxH / 2, HZ - h2);
    add('wall_left', box(0.08, boxH, Hs, M.panel, 1.2), HX - h2, yb + boxH / 2, HZ);
    add('wall_right', box(0.08, boxH, Hs, M.panel, 1.2), HX + h2, yb + boxH / 2, HZ);
    add('rim_front', box(Hs + 0.16, 0.1, 0.16, M.rust, 1), HX, Ht, HZ + h2);
    add('rim_back', box(Hs + 0.16, 0.1, 0.16, M.rust, 1), HX, Ht, HZ - h2);
    add('rim_left', box(0.16, 0.1, Hs, M.rust, 1), HX - h2, Ht, HZ);
    add('rim_right', box(0.16, 0.1, Hs, M.rust, 1), HX + h2, Ht, HZ);
    add('band', box(Hs + 0.12, 0.1, Hs + 0.12, M.rust, 1), HX, yb + 0.05, HZ);
    const fun = add('funnel', shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1, 0.28, 1.25, 4, 1, true), M.panel2)), HX, yb - 0.625, HZ);
    fun.rotation.y = Math.PI / 4; fun.scale.set(h2 / 0.707, 1, h2 / 0.707);
    add('outlet', box(0.45, 0.35, 0.45, M.steel, 1), HX, yb - 1.4, HZ);
    for (const [n, sx, sz] of [['fl', -1, 1], ['fr', 1, 1], ['bl', -1, -1], ['br', 1, -1]]) {
      const x = HX + sx * (h2 - 0.05), z = HZ + sz * (h2 - 0.05);
      add('leg_' + n, box(0.16, yb - 0.35 + boxH, 0.16, M.panel, 1), x, 0.35 + (yb - 0.35 + boxH) / 2, z);
      add('footing_' + n, box(0.7, 0.4, 0.7, M.concrete, 1), x, 0.2, z);
    }
    P('hopper_brace_front', beam(V(HX - h2, 0.5, HZ + h2), V(HX + h2, yb - 0.2, HZ + h2), 0.08, 0.08, M.rust), sec);
    P('hopper_brace_left', beam(V(HX - h2, 0.5, HZ - h2), V(HX - h2, yb - 0.2, HZ + h2), 0.08, 0.08, M.rust), sec);
    P('hopper_chute', beam(V(HX, yb - 1.45, HZ), V(HX + 0.6, 1.25, ANNEX.z1 + 0.05), 0.4, 0.3, M.steel), sec);
    makeFill('hopper', sec, { cx: HX, cz: HZ, floorY: yb - 0.1, w: Hs - 0.3, d: Hs - 0.3, maxH: boxH + 0.7, count: 55, smin: 0.16, smax: 0.32 });
  }

  // ---------------- processing building (gable roof along X, sliding door on the +X gable)
  {
    const sec = S('building');
    const B = BUILDING, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, L = B.x1 - B.x0, Wd = B.z1 - B.z0;
    // the reference building sits slightly skewed to the yard: rotate the whole section about its centre
    sec.position.set(cx, 0, cz);
    sec.rotation.y = B.yaw;
    const local = new THREE.Group();
    local.position.set(-cx, 0, -cz);
    sec.add(local);
    const wallH = B.eave - B.plinth, wy = B.plinth + wallH / 2;
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P('building_' + name, m, local); };
    add('plinth', box(L + 0.5, B.plinth, Wd + 0.5, M.concrete), cx, B.plinth / 2, cz);
    add('wall_front', box(L, wallH, 0.22, M.concrete), cx, wy, B.z1);
    add('wall_back', box(L, wallH, 0.22, M.concrete), cx, wy, B.z0);
    add('wall_left', box(0.22, wallH, Wd, M.concrete), B.x0, wy, cz);
    add('wall_right', box(0.22, wallH, Wd, M.concrete), B.x1, wy, cz);
    for (const [n, x, z] of [['fl', B.x0, B.z1], ['fr', B.x1, B.z1], ['bl', B.x0, B.z0], ['br', B.x1, B.z0]])
      add('corner_' + n, box(0.3, wallH + 0.05, 0.3, M.steel, 1), x, wy, z);
    add('eave_beam_front', box(L + 0.3, 0.18, 0.3, M.steel, 1), cx, B.eave, B.z1);
    add('eave_beam_back', box(L + 0.3, 0.18, 0.3, M.steel, 1), cx, B.eave, B.z0);
    const half = Wd / 2, rise = B.ridge - B.eave;
    for (const [n, x] of [['left', B.x0 - 0.11], ['right', B.x1 - 0.11]]) {
      const g = add('gable_' + n, prism([[-half, 0], [half, 0], [0, rise]], 0.22, M.concrete), x, B.eave, cz);
      g.rotation.y = Math.PI / 2;
    }
    const a = Math.atan2(rise, half), slant = Math.hypot(rise, half), over = 0.4, pw = slant + over;
    for (const [n, sgn] of [['front', 1], ['back', -1]]) {
      const rf = add('roof_' + n, box(L + 0.7, 0.09, pw, M.roofGreen, 1.6), cx, 0, 0);
      rf.rotation.x = sgn * a;
      const midS = (slant + over) / 2; // distance from ridge along the slope to the panel centre
      rf.position.set(cx, B.ridge - Math.sin(a) * midS + 0.07, cz + sgn * Math.cos(a) * midS);
      const trim = add('roof_trim_' + n, box(L + 0.75, 0.12, 0.14, M.rust, 1), cx, B.eave - Math.sin(a) * over + 0.04, cz + sgn * (half + Math.cos(a) * over));
      trim.rotation.x = sgn * a;
    }
    add('roof_ridge', box(L + 0.75, 0.14, 0.4, M.panel, 1), cx, B.ridge + 0.1, cz);
    const roofY = z => B.ridge - Math.abs(z - cz) * Math.tan(a) + 0.05;
    [[B.x0 + 1.6, cz + 0.6], [B.x0 + 3.9, cz + 1.3]].forEach(([x, z], i) => {
      add('roof_vent_' + i, box(0.95, 0.5, 0.75, M.panel, 1), x, roofY(z) + 0.2, z);
      add('roof_vent_cap_' + i, box(1.15, 0.1, 0.95, M.roofGreen, 1), x, roofY(z) + 0.5, z);
    });
    add('chimney', box(0.42, 1.3, 0.42, M.concrete, 1), B.x1 - 0.9, roofY(cz + 1.2) + 0.55, cz + 1.2);
    add('chimney_cap', box(0.56, 0.1, 0.56, M.steel, 1), B.x1 - 0.9, roofY(cz + 1.2) + 1.25, cz + 1.2);
    // big green sliding door + rail on the +X gable, high strip windows
    add('door', box(0.1, 2.5, 1.9, M.panel, 1.2), B.x1 + 0.13, B.plinth + 1.25, B.z1 - 1.35);
    add('door_rail', box(0.14, 0.12, 3.6, M.steel, 1), B.x1 + 0.17, B.plinth + 2.6, B.z1 - 1.8);
    add('door_frame_left', box(0.14, 2.6, 0.12, M.steel, 1), B.x1 + 0.15, B.plinth + 1.3, B.z1 - 2.35);
    add('door_frame_right', box(0.14, 2.6, 0.12, M.steel, 1), B.x1 + 0.15, B.plinth + 1.3, B.z1 - 0.35);
    add('window_gable', box(0.06, 0.45, 1.3, M.glass), B.x1 + 0.12, B.plinth + 2.3, B.z0 + 1.0);
    [[B.x0 + 0.9, 1.0], [B.x0 + 2.4, 1.0], [B.x0 + 3.6, 0.6]].forEach(([x, w], i) => {
      add('window_front_' + i, box(w, 0.42, 0.06, M.glass), x, B.eave - 0.45, B.z1 + 0.12);
      add('window_front_sill_' + i, box(w + 0.15, 0.07, 0.12, M.steel, 1), x, B.eave - 0.7, B.z1 + 0.14);
    });
    [B.x0 + 1.5, B.x0 + 4.2].forEach((x, i) => add('window_back_' + i, box(1.2, 0.42, 0.06, M.glass), x, B.eave - 0.45, B.z0 - 0.12));
    // annex in front (receives the hopper chute)
    const A = ANNEX, ax = (A.x0 + A.x1) / 2, az = (A.z0 + A.z1) / 2, aw = A.x1 - A.x0, ad = A.z1 - A.z0;
    add('annex_plinth', box(aw + 0.4, B.plinth, ad + 0.2, M.concrete), ax, B.plinth / 2, az + 0.1);
    add('annex_wall_front', box(aw, A.h - B.plinth, 0.22, M.concrete), ax, B.plinth + (A.h - B.plinth) / 2, A.z1);
    add('annex_wall_left', box(0.22, A.h - B.plinth, ad, M.concrete), A.x0, B.plinth + (A.h - B.plinth) / 2, az);
    add('annex_wall_right', box(0.22, A.h - B.plinth, ad, M.concrete), A.x1, B.plinth + (A.h - B.plinth) / 2, az);
    add('annex_corner', box(0.28, A.h - B.plinth, 0.28, M.steel, 1), A.x0, B.plinth + (A.h - B.plinth) / 2, A.z1);
    const ar = add('annex_roof', box(aw + 0.5, 0.16, ad + 0.6, M.concrete, 1.2), ax, A.h + 0.1, az + 0.15);
    ar.rotation.x = 0.08;
    for (let i = 0; i < 4; i++) add('annex_roof_seam_' + i, box(0.06, 0.04, ad + 0.6, M.steel, 1), A.x0 + 0.6 + i * (aw - 1.2) / 3, A.h + 0.2, az + 0.15).rotation.x = 0.08;
    add('annex_window', box(0.06, 0.4, 1.2, M.glass), A.x1 + 0.12, A.h - 0.6, az);
    add('annex_pipe', box(0.1, A.h - 0.4, 0.1, M.rust, 1), A.x1 + 0.15, A.h / 2 + 0.1, A.z1 - 0.2);
    // low concrete platform at the hill end of the building
    add('platform', box(2.2, 1.2, 2.6, M.concrete), 4.3, 0.6, -9.3);
    add('platform_cap', box(2.3, 0.1, 2.7, M.concrete, 1), 4.3, 1.25, -9.3);
  }

  // ---------------- three storage bins
  const dividerProfile = [[-BIN.t, 0], [BIN.d + 0.55, 0], [BIN.d + 0.55, 0.4], [BIN.d - 0.15, BIN.wall], [-BIN.t, BIN.wall]];
  for (let b = 0; b < 3; b++) {
    const sec = S('bin_' + b);
    const x0 = BIN.x0 + b * BIN.w, x1 = x0 + BIN.w, cx = (x0 + x1) / 2, cz = BIN.d / 2;
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P(`bin_${b}_${name}`, m, sec); };
    add('floor', box(BIN.w, 0.14, BIN.d, M.concrete), cx, 0.07, cz);
    add('wall_back', box(BIN.w + BIN.t, BIN.wall, BIN.t, M.concrete), cx, BIN.wall / 2, -BIN.t / 2);
    const dividers = b === 2 ? [['left', x0], ['right', x1]] : [['left', x0]];
    for (const [n, x] of dividers) {
      const dv = add('divider_' + n, prism(dividerProfile, BIN.t, M.concrete), x + BIN.t / 2, 0, 0);
      dv.rotation.y = -Math.PI / 2;
      add('divider_cap_' + n, box(BIN.t + 0.06, 0.08, BIN.d, M.concrete, 1), x, BIN.wall + 0.04, BIN.d / 2 - BIN.t / 2);
    }
    add('curb', box(BIN.w - BIN.t, 0.45, 0.4, M.concrete, 1.5), cx, 0.225, BIN.d + 0.2);
    for (let g = 0; g < 2; g++) add('grate_' + g, box(1.5, 0.26, 0.04, M.grate, 1.5), cx + (g - 0.5) * 1.8, 0.22, BIN.d + 0.41);
    makeFill('bin_' + b, sec, { cx, cz: cz + 0.1, floorY: 0.14, w: BIN.w - 0.65, d: BIN.d - 0.3, maxH: 1.75, count: 170, smin: 0.15, smax: 0.34 });
  }

  // ---------------- rocks: cliff ribs running down the hill, scree and gravel (every rock separate)
  const nearStructure = (x, z) => {
    const [lx, lz] = toPortal(x, z), h = heightAt(x, z);
    if (Math.abs(lx) < 4.6 && lz > -6.5 && lz < 2.5 && h < 6.2) return true;
    if (x > 3 && x < 14 && z > -12.6 && z < -1 && h < 1.2) return true;
    if (x > -0.8 && x < 13.5 && z > -1 && z < 6.2) return true;
    return false;
  };
  {
    const sec = S('hill_rocks');
    let n = 0;
    const grad = (x, z) => [heightAt(x + 0.2, z) - heightAt(x - 0.2, z), heightAt(x, z + 0.2) - heightAt(x, z - 0.2)];
    const starts = [];
    for (let gx = -12; gx <= 15; gx += 1.8) for (let gz = -20; gz <= 0; gz += 1.8) starts.push([gx + (r() - 0.5) * 1.8, gz + (r() - 0.5) * 1.8]);
    for (let si = 0, rib = 0; si < starts.length; si++) {
      if (r() < 0.3) continue;
      let [x, z] = starts[si];
      if (heightAt(x, z) < 3.5 || nearStructure(x, z)) continue;
      rib++;
      const big = 0.45 + r() * 0.45, width = 0.9 + r() * 1.3;
      for (let step = 0; step < 9 + r() * 14; step++) {
        const h = heightAt(x, z);
        if (h < 0.8 || nearStructure(x, z)) break;
        const [gx, gz] = grad(x, z), gl = Math.hypot(gx, gz) || 1;
        const nx = -gz / gl, nz = gx / gl; // across the slope
        for (let k = 0; k < 3; k++) {
          if (r() > 0.6) continue;
          const s = big * (0.4 + r() * 0.7);
          const m = P('hill_rock_' + n++, rock(M.rock, 1, cliffGeos), sec);
          const o = (r() - 0.5) * width, px = x + nx * o, pz = z + nz * o;
          const [hx, hz] = grad(px, pz), normal = V(-hx / 0.4, 1, -hz / 0.4).normalize();
          m.quaternion.setFromUnitVectors(V(0, 1, 0), normal).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * 6.28));
          m.scale.set(s * (1 + r() * 0.7), s * (0.45 + r() * 0.45), s * (0.8 + r() * 0.6));
          m.position.set(px, heightAt(px, pz) - 0.05 * s, pz);
        }
        x -= gx / gl * 0.3 + (r() - 0.5) * 0.2;
        z -= gz / gl * 0.3 + (r() - 0.5) * 0.2;
      }
    }
    for (let i = 0, tries = 0; i < 90 && tries < 2000; tries++) {
      const x = -13 + r() * 28, z = -20 + r() * 25;
      const h = heightAt(x, z);
      if (h < 0.3 || nearStructure(x, z) || edgeDistClosed(GROUND_EDGE, x, z) < 0.3) continue;
      i++;
      const s = 0.12 + r() * 0.3;
      const m = P('hill_rock_' + n++, rock(M.rock, s, cliffGeos), sec);
      m.position.set(x, h + s * 0.2, z);
    }
  }
  {
    const sec = S('ground_rocks');
    let n = 0;
    const place = (x, z, s, ore) => {
      const m = P('ground_rock_' + n++, rock(ore ? M.ore : M.rock, s, ore ? oreGeos : cliffGeos), sec);
      m.position.set(x, heightAt(x, z) + s * 0.3, z);
    };
    // gravel strip along the bin fronts and ends
    for (let i = 0; i < 110; i++) {
      const t = r();
      let x, z;
      if (t < 0.7) { x = -0.6 + r() * 13.8; z = BIN.d + 0.6 + r() * r() * 1.4; }
      else if (t < 0.85) { x = -0.6 - r() * 1.2; z = -0.3 + r() * 5.5; }
      else { x = 12.9 + r() * 1.3; z = -0.3 + r() * 5.8; }
      place(x, z, 0.06 + r() * r() * 0.28, r() < 0.12);
    }
    // scree at the hill foot / portal, around hopper and building
    for (let i = 0, tries = 0; i < 110 && tries < 4000; tries++) {
      const x = -10 + r() * 27, z = -14 + r() * 24;
      const e = edgeDistClosed(GROUND_EDGE, x, z), hd = polyDist(HILL_EDGE, x, z);
      if (e < 0.3 || heightAt(x, z) > 0.4) continue;
      const nearHill = hd > -1.8, nearHop = Math.hypot(x - HOPPER.x, z - HOPPER.z) < 2.6 && Math.hypot(x - HOPPER.x, z - HOPPER.z) > 1.6;
      const nearBld = x > 12.9 && x < 14.5 && z > -11 && z < -4;
      if (!(nearHill || nearHop || nearBld || r() < 0.08)) continue;
      if (x > -0.8 && x < 13.5 && z > -1 && z < 5.6) continue;
      const [lx, lz] = toPortal(x, z);
      if (Math.abs(lx) < 2.3 && lz > -0.5 && lz < 2) continue;
      if (Math.abs((x - BELT_TAIL.x) * side.x + (z - BELT_TAIL.z) * side.z) < 1.0 && x < BELT_HEAD.x + 0.5) continue;
      i++;
      place(x, z, 0.08 + r() * r() * 0.4, r() < 0.15);
    }
  }

  // tag meshes with their section, remember original transforms for rebuild
  for (const name of sections) parts[name].traverse(o => {
    o.userData.section = name;
    if (o.isMesh && !o.userData.static) o.userData.orig = { parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
  });

  // ---------------------------------------------------------------- runtime
  const state = { running: true, speed: opts.beltSpeed, autoCycle: opts.autoCycle, activeBin: 0 };
  const flying = [], dust = [], queue = [];
  let time = 0;

  const dustTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  function puff(pos, size) {
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, color: 0xa08a68, transparent: true, depthWrite: false, opacity: 0.7 }));
      s.position.copy(pos).add(V((Math.random() - 0.5) * size, Math.random() * size * 0.5, (Math.random() - 0.5) * size));
      s.scale.setScalar(size * 0.5);
      root.add(s);
      dust.push({ s, life: 0, max: 1.5 + Math.random(), grow: size * (0.8 + Math.random()) });
    }
  }

  const tmpBox = new THREE.Box3(), tmpV = new THREE.Vector3();
  function destroy(name) {
    const target = parts[name];
    if (!target) return;
    const meshes = [];
    target.traverse(o => { if (o.isMesh && o.userData.orig && !o.userData.debris && !o.userData.flying) meshes.push(o); });
    if (!meshes.length) return;
    const center = tmpBox.setFromObject(target).getCenter(V(0, 0, 0));
    const size = tmpBox.getSize(tmpV).length();
    center.y = Math.max(0, center.y - size * 0.25);
    for (const m of meshes) {
      if (!m.visible) { m.userData.debris = true; continue; }
      root.attach(m);
      const dims = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).getSize(V(0, 0, 0)).multiply(m.scale);
      const minHalf = Math.min(dims.x, dims.y, dims.z) / 2;
      const vol = dims.x * dims.y * dims.z;
      const dir = m.getWorldPosition(V(0, 0, 0)).sub(center);
      dir.y = Math.abs(dir.y) + 0.5;
      dir.normalize();
      const speed = (2.5 + Math.random() * 4) / (1 + Math.cbrt(vol) * 0.6);
      m.userData.flying = true;
      flying.push({
        m, r: minHalf, life: 0,
        v: dir.multiplyScalar(speed).add(V(0, 2 + Math.random() * 3, 0)),
        w: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8 / (1 + Math.cbrt(vol))),
      });
    }
    puff(center, Math.min(4, 1 + size * 0.3));
  }

  function destroyAll() {
    ['conveyor', 'hopper', 'building', 'portal', 'bin_0', 'bin_1', 'bin_2'].forEach((n, i) => queue.push({ t: time + i * 0.45, name: n }));
    queue.sort((a, b) => a.t - b.t);
  }

  function rebuild() {
    queue.length = 0; flying.length = 0;
    for (const d of dust) root.remove(d.s);
    dust.length = 0;
    const all = [];
    root.traverse(o => { if (o.isMesh && o.userData.orig) all.push(o); });
    for (const m of all) {
      const o = m.userData.orig;
      o.parent.add(m);
      m.position.copy(o.p); m.quaternion.copy(o.q); m.scale.copy(o.s);
      m.userData.flying = false; m.userData.debris = false;
      m.visible = true;
    }
    for (const f of Object.values(fills)) {
      const n = Math.round(f.level * f.items.length);
      f.items.forEach((it, i) => {
        it.on = i < n; it.t = 1;
        it.mesh.visible = it.on;
        it.mesh.position.copy(it.base); it.mesh.scale.setScalar(it.s);
      });
    }
  }

  function syncFill(f, dt) {
    const n = Math.round(f.level * f.items.length);
    f.items.forEach((it, i) => {
      const m = it.mesh;
      if (m.userData.flying || m.userData.debris) return;
      const want = i < n;
      if (want && !it.on) { it.on = true; it.t = 0; m.visible = true; }
      else if (!want && it.on) { it.on = false; it.t = 1; }
      if (it.on && it.t < 1) {
        it.t = Math.min(1, it.t + dt * 2.5);
        const k = 1 - it.t;
        m.position.set(it.base.x, it.base.y + 1.6 * k * k, it.base.z);
        m.scale.setScalar(it.s * Math.min(1, 0.3 + it.t * 2));
      } else if (!it.on && m.visible) {
        it.t -= dt * 3;
        if (it.t <= 0) { m.visible = false; m.scale.setScalar(it.s); }
        else m.scale.setScalar(it.s * it.t);
      }
    });
  }

  const alive = n => { const p = parts[n]; return p && !p.userData.flying && !p.userData.debris; };
  const fillAlive = n => (n === 'hopper' ? alive('hopper_funnel') : alive(`${n}_floor`));

  function update(dt) {
    dt = Math.min(dt, 0.05);
    time += dt;
    while (queue.length && queue[0].t <= time) destroy(queue.shift().name);

    if (state.running && alive('conveyor_belt')) {
      const d = state.speed * dt;
      beltTex.offset.x -= d / BELT_TILE;
      for (const rl of rollers) if (alive(rl.name)) {
        rl.userData.spin -= d / rl.geometry.parameters.radiusTop;
        rl.rotation.set(Math.PI / 2, rl.userData.spin, 0);
      }
      for (const o of beltOre) {
        if (!alive(o.mesh.name)) continue;
        o.s += d / beltLen;
        if (o.s >= 1) {
          o.s -= 1;
          if (fillAlive('hopper')) fills.hopper.target = Math.min(1, fills.hopper.target + 0.03);
        }
        o.mesh.position.set(o.s * beltLen, 0.14 + o.h, o.z);
        o.mesh.visible = o.s > 0.04 && o.s < 0.985;
      }
    }

    // processing loop: the hopper drains into the building, output stockpiles in the bins
    if (state.autoCycle && alive('building_wall_front') && fills.hopper.level > 0.02) {
      const take = Math.min(fills.hopper.target, 0.035 * dt);
      fills.hopper.target -= take;
      fills.hopper.rate = 0.4;
      for (let tries = 0; tries < 3; tries++) {
        const bin = fills['bin_' + state.activeBin];
        if (fillAlive('bin_' + state.activeBin) && bin.target < 1) { bin.target = Math.min(1, bin.target + take * 0.6); bin.rate = 0.5; break; }
        state.activeBin = (state.activeBin + 1) % 3;
      }
    }

    for (const f of Object.values(fills)) {
      if (f.level !== f.target) {
        const step = f.rate * dt;
        f.level = f.level < f.target ? Math.min(f.target, f.level + step) : Math.max(f.target, f.level - step);
      }
      syncFill(f, dt);
    }

    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], m = f.m;
      f.v.y -= 12 * dt;
      m.position.addScaledVector(f.v, dt);
      m.rotation.x += f.w.x * dt; m.rotation.y += f.w.y * dt; m.rotation.z += f.w.z * dt;
      const g = heightAt(m.position.x, m.position.z) + f.r;
      let grounded = false;
      if (m.position.y < g) {
        m.position.y = g; grounded = true;
        if (f.v.y < 0) f.v.y *= -0.25;
        f.v.x *= 0.55; f.v.z *= 0.55; f.w.multiplyScalar(0.5);
      }
      f.life += dt;
      if ((grounded && f.life > 0.8 && f.v.lengthSq() < 0.4) || f.life > 8) {
        m.userData.flying = false; m.userData.debris = true;
        flying.splice(i, 1);
      }
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.life += dt;
      const k = d.life / d.max;
      d.s.scale.setScalar(d.grow * (0.5 + k));
      d.s.position.y += dt * 0.4;
      d.s.material.opacity = 0.7 * (1 - k);
      if (k >= 1) { root.remove(d.s); d.s.material.dispose(); dust.splice(i, 1); }
    }
  }

  return {
    root, parts, sections, heightAt,
    fillNames: Object.keys(fills),
    update, destroy, destroyAll, rebuild,
    setConveyor({ running, speed } = {}) {
      if (running !== undefined) state.running = running;
      if (speed !== undefined) state.speed = speed;
    },
    setAutoCycle(v) { state.autoCycle = v; },
    setFill(name, value, { instant = false, rate = 0.5 } = {}) {
      const f = fills[name]; if (!f) return;
      f.target = clamp(value, 0, 1); f.rate = rate;
      if (instant) { f.level = f.target; f.items.forEach(it => { it.t = 1; }); }
    },
    getFill: name => fills[name]?.level ?? 0,
    partOf(obj) {
      while (obj && !obj.userData.part) obj = obj.parent;
      return obj ? { part: obj.userData.part, section: obj.userData.section } : null;
    },
  };
}
