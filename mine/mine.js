// Iron-ore mine for an RTS.
// Every piece is a separate named mesh so it can be destroyed; every ore rock is its own mesh;
// the belt scrolls and carries ore; the bins and hopper fill/empty with an animation.
// Surfaces are textured from the supplied material atlas (atlas.webp); hard-surface parts are
// chamfered solids. No terrain is included: footings, walls and the tunnel lining continue
// below y = 0 and back into the hill so the asset sinks into the game terrain when placed.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

// ---------------------------------------------------------------- math / random
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
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- material atlas
// rect: [u, v, w, h] as fractions of the atlas image; size: metres covered by one tile [u, v].
export const ATLAS_TILES = {
  concrete:       { rect: [0.00, 0.00, 0.50, 0.25], size: [3.2, 1.6] },  // stained cast concrete with joints
  corrugated:     { rect: [0.50, 0.00, 0.50, 0.25], size: [3.0, 1.5] },  // green corrugated sheet
  greenPanel:     { rect: [0.00, 0.25, 0.25, 0.25], size: [1.6, 1.6] },  // riveted green plate, rust straps
  corrugatedFine: { rect: [0.25, 0.25, 0.25, 0.25], size: [1.2, 1.2] },  // fine-rib green sheet
  darkSteel:      { rect: [0.50, 0.25, 0.25, 0.25], size: [1.4, 1.4] },  // scratched dark steel
  rustFrame:      { rect: [0.75, 0.25, 0.25, 0.25], size: [1.2, 1.2] },  // rusted bolted steel
  rock:           { rect: [0.00, 0.50, 0.50, 0.25], size: [3.0, 1.5] },  // grey rock
  ore:            { rect: [0.50, 0.50, 0.50, 0.25], size: [1.4, 0.7] },  // iron ore
  galvanized:     { rect: [0.00, 0.75, 0.25, 0.25], size: [1.5, 1.5] },  // spangled galvanised sheet
  grid:           { rect: [0.25, 0.75, 0.25, 0.25], size: [1.0, 1.0] },  // dark glazing / grid panel
  plate:          { rect: [0.50, 0.75, 0.25, 0.25], size: [1.5, 1.5] },  // framed steel plate
  concretePanel:  { rect: [0.75, 0.75, 0.25, 0.25], size: [2.2, 2.2] },  // precast concrete panel
};

function loadAtlas(url) {
  const textures = {};
  for (const key of Object.keys(ATLAS_TILES)) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8a8478'; ctx.fillRect(0, 0, 4, 4);
    const t = new THREE.CanvasTexture(c);
    // the tiles are not authored to repeat seamlessly; mirrored repeats hide the seams
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textures[key] = t;
  }
  const ready = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight, inset = Math.round(W * 0.006);
      for (const [key, { rect: [u, v, w, h] }] of Object.entries(ATLAS_TILES)) {
        const sx = u * W + inset, sy = v * H + inset, sw = w * W - inset * 2, sh = h * H - inset * 2;
        const c = textures[key].image;
        c.width = Math.round(sw); c.height = Math.round(sh);
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        textures[key].dispose();
        textures[key].needsUpdate = true;
      }
      resolve(textures);
    };
    img.onerror = reject;
    img.src = url;
  });
  return { textures, ready };
}

// ---------------------------------------------------------------- geometry helpers
const _e1 = V(), _e2 = V(), _p0 = V();
// Per-triangle box projection in metres (tile size from the material): no stretching on any shape.
function projectUV(geo, size) {
  if (geo.index) geo = geo.toNonIndexed();
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    _p0.fromBufferAttribute(p, i);
    _e1.fromBufferAttribute(p, i + 1).sub(_p0);
    _e2.fromBufferAttribute(p, i + 2).sub(_p0);
    _e1.cross(_e2);
    const ax = Math.abs(_e1.x), ay = Math.abs(_e1.y), az = Math.abs(_e1.z);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      let u, v;
      if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = x; v = z; } else { u = x; v = y; }
      uv[(i + k) * 2] = u / size[0];
      uv[(i + k) * 2 + 1] = v / size[1];
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
// Inset a convex polygon by c (either winding).
function offsetConvex(pts, c) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
  const P = area < 0 ? pts.slice().reverse() : pts.slice();
  const n = P.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n], dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy);
    lines.push([x1 - dy / l * c, y1 + dx / l * c, dx, dy]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay, adx, ady] = lines[(i - 1 + n) % n], [bx, by, bdx, bdy] = lines[i];
    const cr = adx * bdy - ady * bdx;
    const t = Math.abs(cr) < 1e-9 ? 0 : ((bx - ax) * bdy - (by - ay) * bdx) / cr;
    out.push([ax + t * adx, ay + t * ady]);
  }
  return out;
}
// Convex 2D profile (XY) extruded along +Z by depth, every edge chamfered by c.
function chamferPrismGeo(profile, depth, c) {
  const inner = offsetConvex(profile, c), pts = [];
  for (const [x, y] of inner) pts.push(V(x, y, 0), V(x, y, depth));
  for (const [x, y] of profile) pts.push(V(x, y, c), V(x, y, depth - c));
  return new ConvexGeometry(pts);
}
function chamferBoxGeo(w, h, d, c) {
  c = Math.min(c, w * 0.3, h * 0.3, d * 0.3);
  const g = chamferPrismGeo([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], d, c);
  g.translate(0, 0, -d / 2);
  return g;
}
// I-section along +Z (web along Y), with bevelled ends and edges.
function iBeamGeo(len, w, h) {
  const tf = h * 0.13, tw = Math.max(0.012, w * 0.16);
  const s = new THREE.Shape([
    [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [w / 2, h / 2 - tf],
    [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-w / 2, -h / 2 + tf],
  ].map(([x, y]) => new THREE.Vector2(x, y)));
  const b = Math.min(0.006, tf * 0.3);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, len - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 1 });
  g.translate(0, 0, b);
  return g;
}
// C-channel along +Z, open toward +X.
function channelGeo(len, h, f) {
  const t = Math.max(0.012, h * 0.06);
  const s = new THREE.Shape([[0, -h / 2], [f, -h / 2], [f, -h / 2 + t], [t, -h / 2 + t], [t, h / 2 - t], [f, h / 2 - t], [f, h / 2], [0, h / 2]].map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
}
// Corrugated sheet in the XZ plane; the wave runs along X so the ribs run along Z.
function corrugatedGeo(len, width, pitch, amp, tile) {
  const g = new THREE.PlaneGeometry(len, width, Math.ceil(len / pitch * 8), 1);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, amp * Math.sin((x / pitch) * Math.PI * 2));
    uv.setXY(i, (x + len / 2) / tile[0], (z + width / 2) / tile[1]);
  }
  g.computeVertexNormals();
  return g;
}
// Grey vertex colours from a function of position (tunnel interior falloff).
function shadeGeo(geo, f) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = f(p.getX(i), p.getY(i), p.getZ(i)); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
// Orient an object whose local +Z is its length axis from a to b; `up` picks the roll.
function orientAlong(obj, a, b, up = V(0, 1, 0)) {
  const dir = b.clone().sub(a).normalize();
  let u = up.clone();
  if (Math.abs(u.dot(dir)) > 0.95) u = Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const x = V().crossVectors(u, dir).normalize(), y = V().crossVectors(dir, x);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, dir));
  obj.position.copy(a);
  return obj;
}
function rockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = V(), off = seed * 17.3;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.7 + 0.6 * fbm(v.x * 1.2 + off, v.y * 1.2, v.z * 1.2, 3));
    v.y *= 0.8;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- layout
// Metres, matched to the reference render with a fitted orthographic camera (REFERENCE_VIEW).
// +X runs down-right on screen along the bin row, +Z runs down-left toward the viewer. Ground is y = 0.
export const REFERENCE_VIEW = { azimuth: 0.6023, elevation: 0.4456, pxPerMetre: 58.0176, origin: [470.05, 616.31], size: [1536, 1024] };
export const PORTAL = { x: -1.225, z: -6.04, rot: 1.133 };   // tunnel portal (face centre) and yaw
// portal-local (x along the face, z out of the face) → world xz
export const portalToWorld = (lx, lz) => [
  PORTAL.x + Math.cos(PORTAL.rot) * lx + Math.sin(PORTAL.rot) * lz,
  PORTAL.z - Math.sin(PORTAL.rot) * lx + Math.cos(PORTAL.rot) * lz,
];
const BIN = { x0: 0, w: 4.2, d: 4.85, wall: 1.45, t: 0.45 };
const BELT_TAIL = V(-1.58, 1.2, -7.64);
const BELT_HEAD = V(8.95, 4.05, -3.0);
const HOPPER = { x: 9.95, z: -2.9, size: 2.7, top: 3.8, boxH: 1.45 };
const BUILDING = { x0: 6.7, x1: 12.5, z0: -11.6, z1: -6.9, plinth: 0.45, eave: 3.3, ridge: 4.6, yaw: -0.15 };
const ANNEX = { x0: 9.6, x1: 12.3, z0: -6.9, z1: -4.4, h: 2.8 };
const SINK = 0.6; // foundations and walls continue this far below y = 0

// ---------------------------------------------------------------- main factory
/**
 * createMine(options) → controller
 *   options: { atlasUrl, tunnelLength = 12, beltSpeed, autoCycle, seed, groundHeight(x, z) }
 *   root                 THREE.Group to add to your scene
 *   ready                Promise resolved once the atlas textures are in
 *   parts                { name: Object3D } every destroyable part (+ section groups)
 *   sections             'portal', 'tunnel', 'conveyor', 'hopper', 'building', 'bin_0', 'bin_1', 'bin_2'
 *   update(dt)           call every frame
 *   setConveyor({running, speed})
 *   setFill(name, 0..1, {instant, rate}) / getFill(name)   name: 'bin_0'|'bin_1'|'bin_2'|'hopper'
 *   destroy(name)        a part or a section; pieces fly off and settle as rubble
 *   destroyAll() / rebuild()
 *   partOf(object3D)     -> { part, section } for raycast picking
 */
export function createMine(options = {}) {
  const opts = Object.assign({
    atlasUrl: new URL('./atlas.webp', import.meta.url).href,
    tunnelLength: 12, beltSpeed: 1.0, autoCycle: true, seed: 1, groundHeight: () => 0,
  }, options);
  const r = rng(opts.seed * 9973);
  const atlas = loadAtlas(opts.atlasUrl);
  const T = atlas.textures;

  const mat = (key, o = {}) => {
    const m = new THREE.MeshStandardMaterial(Object.assign({ map: T[key], roughness: 0.85, metalness: 0.05 }, o));
    m.userData.tile = ATLAS_TILES[key].size;
    return m;
  };
  const M = {
    concrete: mat('concrete'),
    concretePanel: mat('concretePanel'),
    tunnel: mat('concrete', { vertexColors: true }),
    roof: mat('corrugated', { roughness: 0.6, metalness: 0.25, side: THREE.DoubleSide }),
    roofSolid: mat('corrugated', { roughness: 0.6, metalness: 0.25 }),
    greenPanel: mat('greenPanel', { roughness: 0.65, metalness: 0.25 }),
    doorSheet: mat('corrugatedFine', { roughness: 0.6, metalness: 0.25 }),
    steel: mat('darkSteel', { roughness: 0.5, metalness: 0.45 }),
    rust: mat('rustFrame', { roughness: 0.8, metalness: 0.3 }),
    galv: mat('galvanized', { roughness: 0.45, metalness: 0.5 }),
    glazing: mat('grid', { roughness: 0.25, metalness: 0.35 }),
    plate: mat('plate', { roughness: 0.6, metalness: 0.4 }),
    belt: mat('darkSteel', { roughness: 0.9, metalness: 0.05, color: 0x505050, side: THREE.DoubleSide }),
    ore: mat('ore', { flatShading: true, roughness: 0.8, color: 0xcfa592 }),
    rock: mat('rock', { flatShading: true, roughness: 0.95 }),
    void: new THREE.MeshBasicMaterial({ color: 0x030303 }),
  };
  // the belt surface scrolls, so it gets its own texture instance (sharing the tile canvas)
  const beltTex = T.darkSteel.clone();
  M.belt.map = beltTex;
  atlas.ready.then(() => { beltTex.needsUpdate = true; });

  const shadowed = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const meshOf = (geo, m) => shadowed(new THREE.Mesh(projectUV(geo, m.userData.tile || [1, 1]), m));
  const cbox = (w, h, d, m, c = 0.04) => meshOf(chamferBoxGeo(w, h, d, c), m);
  const cprism = (profile, depth, m, c = 0.05) => meshOf(chamferPrismGeo(profile, depth, c), m);
  const member = (a, b, w, h, m, up, c = 0.015) => {   // chamfered rectangular member a → b
    const len = a.distanceTo(b), g = chamferBoxGeo(w, h, len, c);
    g.translate(0, 0, len / 2);
    return orientAlong(meshOf(g, m), a, b, up);
  };
  const ibeam = (a, b, w, h, m, up) => orientAlong(meshOf(iBeamGeo(a.distanceTo(b), w, h), m), a, b, up);
  const bolt = (m = M.steel, s = 0.03) => shadowed(new THREE.Mesh(projectUV(new THREE.CylinderGeometry(s, s, s * 0.8, 6), [0.3, 0.3]), m));
  const cyl = (rad, len, m, seg = 16) => {             // cylinder along local Z
    const g = new THREE.CylinderGeometry(rad, rad, len, seg);
    g.rotateX(Math.PI / 2);
    return shadowed(new THREE.Mesh(projectUV(g, m.userData.tile || [1, 1]), m));
  };
  const oreGeos = Array.from({ length: 12 }, (_, i) => rockGeometry(i + opts.seed * 31, i % 3 ? 0 : 1));
  const rock = (m, s) => {
    const k = shadowed(new THREE.Mesh(oreGeos[Math.floor(r() * oreGeos.length)], m));
    k.scale.setScalar(s);
    k.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
    return k;
  };

  const root = new THREE.Group();
  root.name = 'Mine';
  const parts = {}, sections = [];
  const P = (name, obj, parent) => { obj.name = name; obj.userData.part = name; parts[name] = obj; parent.add(obj); return obj; };
  const S = name => { const g = new THREE.Group(); P(name, g, root); sections.push(name); return g; };

  // ================================================================ tunnel portal
  {
    const sec = S('portal');
    sec.position.set(PORTAL.x, 0, PORTAL.z);
    sec.rotation.y = PORTAL.rot;
    const add = (name, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return P('portal_' + name, m, sec); };
    const D = 1.8; // frame depth; face at local z = 0, outward +Z
    const frame = {
      pillar_left: [[-3.5, -SINK], [-2.45, -SINK], [-2.45, 2.85], [-3.5, 3.45]],
      haunch_left: [[-3.5, 3.45], [-2.45, 2.85], [-1.65, 3.65], [-1.65, 4.75], [-2.45, 4.75]],
      lintel: [[-1.65, 3.65], [1.65, 3.65], [1.65, 4.75], [-1.65, 4.75]],
    };
    frame.haunch_right = frame.haunch_left.map(([x, y]) => [-x, y]);
    frame.pillar_right = frame.pillar_left.map(([x, y]) => [-x, y]);
    for (const [n, pts] of Object.entries(frame)) add(n, cprism(pts, D, M.concrete, 0.07), 0, 0, -D);
    // proud outer rim, chamfered
    const rim = {
      rim_left: [[-3.85, -SINK], [-3.5, -SINK], [-3.5, 3.45], [-3.85, 3.62]],
      rim_left_chamfer: [[-3.85, 3.62], [-3.5, 3.45], [-2.45, 4.75], [-2.45, 5.1]],
      rim_top: [[-2.45, 4.75], [2.45, 4.75], [2.45, 5.1], [-2.45, 5.1]],
    };
    rim.rim_right = rim.rim_left.map(([x, y]) => [-x, y]);
    rim.rim_right_chamfer = rim.rim_left_chamfer.map(([x, y]) => [-x, y]);
    for (const [n, pts] of Object.entries(rim)) add(n, cprism(pts, D + 0.12, M.concrete, 0.06), 0, 0, -D);
    // inner rusted I-beam frame following the chamfered opening, base plates, anchors, knee gussets
    const inner = [[-2.28, 0], [-2.28, 2.78], [-1.56, 3.5], [1.56, 3.5], [2.28, 2.78], [2.28, 0]];
    const names = ['post_left', 'knee_left', 'header', 'knee_right', 'post_right'];
    for (let i = 0; i < 5; i++) {
      const [x1, y1] = inner[i], [x2, y2] = inner[i + 1];
      P('portal_steel_' + names[i], ibeam(V(x1, y1, 0.16), V(x2, y2, 0.16), 0.32, 0.3, M.rust, V(0, 0, 1)), sec);
    }
    for (const sx of [-1, 1]) {
      const s = sx < 0 ? 'l' : 'r';
      add('steel_baseplate_' + s, cbox(0.5, 0.05, 0.45, M.steel, 0.01), sx * 2.28, 0.025, 0.16);
      for (const [dx, dz] of [[-0.17, -0.15], [0.17, -0.15], [-0.17, 0.15], [0.17, 0.15]])
        add(`steel_anchor_${s}_${dx > 0 ? 1 : 0}${dz > 0 ? 1 : 0}`, bolt(), sx * 2.28 + dx, 0.06, 0.16 + dz);
      add('steel_gusset_' + s, cbox(0.5, 0.5, 0.03, M.rust, 0.01), sx * 2.0, 3.05, 0.33).rotation.z = Math.PI / 4;
    }
    // lintel band: rust channel with three plates and bolts
    add('band', cbox(5.0, 0.34, 0.2, M.rust, 0.03), 0, 4.2, 0.1);
    add('band_lower', cbox(3.6, 0.14, 0.15, M.rust, 0.02), 0, 3.86, 0.1);
    [-1.3, 0, 1.3].forEach((x, i) => {
      add('plate_' + i, cbox(0.62, 0.16, 0.05, M.galv, 0.012), x, 4.22, 0.23);
      for (const dx of [-0.25, 0.25]) add(`plate_bolt_${i}_${dx > 0 ? 'r' : 'l'}`, bolt(M.steel, 0.022), x + dx, 4.22, 0.265).rotation.x = Math.PI / 2;
    });
    for (let i = 0; i < 8; i++) add('band_bolt_' + i, bolt(M.steel, 0.025), -2.2 + i * 0.63, 4.32, 0.21).rotation.x = Math.PI / 2;
    // buttress, retaining wall running back into the terrain, big block and wing walls
    add('buttress_left', cbox(1.05, 2.3 + SINK, 1.6, M.concrete, 0.07), -3.0, (2.3 - SINK) / 2, 0.7);
    const lw = add('retaining_wall_left', cbox(4.4, 1.35 + SINK, 0.55, M.concrete, 0.06), -5.2, (1.35 - SINK) / 2, 0.15);
    lw.rotation.y = -0.55;
    const lwc = add('retaining_wall_left_coping', cbox(4.5, 0.12, 0.7, M.concrete, 0.03), -5.2, 1.4, 0.15);
    lwc.rotation.y = -0.55;
    add('retaining_wall_left_end', cbox(0.75, 1.5 + SINK, 0.75, M.concrete, 0.06), -6.25, (1.5 - SINK) / 2, 0.85);
    add('block_right', cbox(1.9, 2.45 + SINK, 2.2, M.concrete, 0.08), 3.95, (2.45 - SINK) / 2, 0.45);
    add('block_right_coping', cbox(2.05, 0.12, 2.35, M.concrete, 0.03), 3.95, 2.51, 0.45);
    add('wing_right', cbox(0.55, 1.8 + SINK, 3.5, M.concrete, 0.06), 4.6, (1.8 - SINK) / 2, -2.2);
    add('wing_left', cbox(0.55, 2.4 + SINK, 3.5, M.concrete, 0.06), -3.7, (2.4 - SINK) / 2, -2.6);
  }

  // ================================================================ tunnel lining (long, sinks into the terrain)
  {
    const sec = S('tunnel');
    sec.position.set(PORTAL.x, 0, PORTAL.z);
    sec.rotation.y = PORTAL.rot;
    const add = (name, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return P('tunnel_' + name, m, sec); };
    const D = 1.8, TL = opts.tunnelLength;
    const falloff = depth => lerp(1, 0.05, smoothstep(0.1, 2.4, depth));
    const ring = {
      wall_left: [[-3.05, -SINK], [-2.45, -SINK], [-2.45, 2.85], [-3.05, 3.17]],
      haunch_left: [[-3.05, 3.17], [-2.45, 2.85], [-1.65, 3.65], [-1.65, 4.25], [-2.0, 4.25]],
      crown: [[-1.65, 3.65], [1.65, 3.65], [1.65, 4.25], [-1.65, 4.25]],
    };
    ring.haunch_right = ring.haunch_left.map(([x, y]) => [-x, y]);
    ring.wall_right = ring.wall_left.map(([x, y]) => [-x, y]);
    for (const [n, pts] of Object.entries(ring)) {
      const g = chamferPrismGeo(pts, TL, 0.05);
      g.translate(0, 0, -TL);
      add(n, shadowed(new THREE.Mesh(shadeGeo(projectUV(g, M.tunnel.userData.tile), (x, y, z) => falloff(-z)), M.tunnel)), 0, 0, -D + 0.02);
    }
    const fg = chamferBoxGeo(4.95, 0.35 + SINK, TL + D, 0.04);
    fg.translate(0, -(0.35 + SINK) / 2 + 0.02, -(TL + D) / 2);
    add('floor', shadowed(new THREE.Mesh(shadeGeo(projectUV(fg, M.tunnel.userData.tile), (x, y, z) => falloff(-z - D)), M.tunnel)));
    // steel arch sets, sleepers and rails, darkening with depth
    const depthMat = new Map();
    const dm = (base, depth) => {
      const k = Math.round(falloff(depth) * 20) / 20, key = base.uuid + k;
      if (!depthMat.has(key)) { const m = base.clone(); m.color.multiplyScalar(k); depthMat.set(key, m); }
      return depthMat.get(key);
    };
    const arch = [[-2.3, 0], [-2.3, 2.76], [-1.58, 3.5], [1.58, 3.5], [2.3, 2.76], [2.3, 0]];
    for (let s = 0, z = -D - 0.5; z > -D - 2.4; z -= 0.9, s++) {
      for (let i = 0; i < 5; i++) {
        const [x1, y1] = arch[i], [x2, y2] = arch[i + 1];
        P(`tunnel_set_${s}_${i}`, ibeam(V(x1, y1, z), V(x2, y2, z), 0.22, 0.2, dm(M.rust, -z - D), V(0, 0, 1)), sec);
      }
    }
    for (let i = 0, z = 0.4; z > -D - 2.4; z -= 0.65, i++) add('sleeper_' + i, cbox(1.7, 0.1, 0.24, dm(M.steel, Math.max(0, -z - D)), 0.02), 1.3, 0.07, z);
    for (const sx of [-1, 1]) P('tunnel_rail_' + (sx < 0 ? 'left' : 'right'), member(V(1.3 + sx * 0.5, 0.17, 0.5), V(1.3 + sx * 0.5, 0.17, -D - 2.35), 0.07, 0.1, M.steel, V(0, 1, 0), 0.01), sec);
    const PLUG = 2.4; // metres inside the frame where the bore fades to black and is closed
    const bore = new THREE.Shape([[-2.46, -0.1], [2.46, -0.1], [2.46, 2.85], [1.66, 3.66], [-1.66, 3.66], [-2.46, 2.85]].map(([x, y]) => new THREE.Vector2(x, y)));
    const cap = new THREE.Mesh(new THREE.ShapeGeometry(bore), M.void);
    cap.position.set(0, 0, -D - PLUG);
    cap.userData.static = true;
    sec.add(cap);
    for (let i = 0; i < 14; i++) {
      const s = 0.14 + r() * 0.22;
      add('spill_' + i, rock(i % 3 ? M.ore : M.rock, s), -2.0 + r() * 2.0, 0.17 + s * 0.4, -0.4 - r() * 3.2);
    }
  }

  // ================================================================ conveyor
  const beltDir = BELT_HEAD.clone().sub(BELT_TAIL);
  const beltLen = beltDir.length();
  beltDir.normalize();
  const side = V().crossVectors(beltDir, V(0, 1, 0)).normalize();
  const upv = V().crossVectors(side, beltDir);
  const beltOre = [], rollers = [];
  const BELT_TILE = M.belt.userData.tile[0];
  const TROUGH = 0.13; // wing rise of the troughed belt
  {
    const sec = S('conveyor');
    const frame = new THREE.Group();
    frame.position.copy(BELT_TAIL);
    frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(beltDir, upv, side));
    sec.add(frame);
    const add = (name, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return P('conveyor_' + name, m, frame); };
    // C-channel stringers (frame-local: x along the belt, y up, z across)
    for (const sz of [-1, 1]) {
      const g = channelGeo(beltLen + 0.6, 0.34, 0.09);
      g.rotateY(Math.PI / 2);
      if (sz > 0) g.scale(1, 1, -1);
      add('stringer_' + (sz < 0 ? 'left' : 'right'), shadowed(new THREE.Mesh(projectUV(g, M.steel.userData.tile), M.steel)), -0.3, -0.05, sz * 0.66);
      add('stringer_cap_' + (sz < 0 ? 'left' : 'right'), cbox(beltLen + 0.6, 0.03, 0.12, M.rust, 0.008), beltLen / 2, 0.13, sz * 0.62);
    }
    // troughed belt: flat centre and raised wings; UVs run along the belt so the texture scrolls
    {
      const zs = [-0.5, -0.19, 0.19, 0.5], ys = [TROUGH, 0, 0, TROUGH], seg = Math.ceil(beltLen / 0.25);
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= seg; i++) {
        const x = (i / seg) * beltLen;
        for (let j = 0; j < 4; j++) { pos.push(x, 0.1 + ys[j], zs[j]); uv.push(x / BELT_TILE, (zs[j] + 0.5) / 1.4); }
      }
      for (let i = 0; i < seg; i++) for (let j = 0; j < 3; j++) {
        const a = i * 4 + j, b = a + 4;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      add('belt', shadowed(new THREE.Mesh(g, M.belt)));
      const rg = new THREE.PlaneGeometry(beltLen, 0.9);
      rg.rotateX(-Math.PI / 2);
      rg.translate(beltLen / 2, 0, 0);
      add('return_belt', shadowed(new THREE.Mesh(rg, M.belt)), 0, -0.24, 0);
    }
    // troughed idler sets + return idlers
    const n = Math.floor(beltLen / 1.05);
    for (let i = 1; i < n; i++) {
      const x = (i / n) * beltLen;
      add(`idler_frame_${i}`, cbox(0.08, 0.06, 1.25, M.rust, 0.01), x, -0.06, 0);
      [[0, 0.035, 0.36, 0], [-0.345, 0.105, 0.3, Math.atan2(TROUGH, 0.31)], [0.345, 0.105, 0.3, -Math.atan2(TROUGH, 0.31)]].forEach(([z, y, len, tilt], k) => {
        const rl = add(`idler_${i}_${k}`, cyl(0.05, len, M.steel, 10), x, y, z);
        rl.userData.radius = 0.05; rl.userData.tilt = tilt; rl.userData.spin = 0;
        rl.rotation.set(tilt, 0, 0);
        rollers.push(rl);
      });
      if (i % 2) {
        const rr = add(`return_idler_${i}`, cyl(0.045, 1.0, M.steel, 10), x, -0.3, 0);
        rr.userData.radius = 0.045; rr.userData.tilt = 0; rr.userData.spin = 0;
        rollers.push(rr);
      }
    }
    for (const [nme, x, rad] of [['head_pulley', beltLen, 0.19], ['tail_pulley', 0, 0.17]]) {
      const pl = add(nme, cyl(rad, 1.08, M.steel, 20), x, -0.02, 0);
      pl.userData.radius = rad; pl.userData.tilt = 0; pl.userData.spin = 0;
      rollers.push(pl);
      for (const sz of [-1, 1]) add(`${nme}_bearing_${sz < 0 ? 'l' : 'r'}`, cbox(0.22, 0.16, 0.1, M.rust, 0.015), x, -0.02, sz * 0.7);
    }
    // drive: motor + gearbox beside the head pulley; head hood over the hopper; tail take-up
    add('motor', cyl(0.16, 0.55, M.greenPanel, 16), beltLen - 0.45, 0.02, 1.05);
    add('motor_fan_cover', cyl(0.17, 0.08, M.steel, 16), beltLen - 0.45, 0.02, 1.36);
    add('gearbox', cbox(0.42, 0.36, 0.3, M.greenPanel, 0.03), beltLen - 0.02, 0.02, 0.88);
    add('motor_base', cbox(0.9, 0.05, 0.5, M.steel, 0.01), beltLen - 0.25, -0.18, 1.0);
    add('head_hood', cbox(0.6, 0.55, 1.25, M.greenPanel, 0.03), beltLen + 0.05, 0.3, 0);
    add('tail_takeup_left', cbox(0.8, 0.12, 0.08, M.rust, 0.01), 0.25, -0.02, -0.72);
    add('tail_takeup_right', cbox(0.8, 0.12, 0.08, M.rust, 0.01), 0.25, -0.02, 0.72);
    for (let i = 0, s = 0; i < 46; i++) {
      const sz = 0.07 + r() * 0.1;
      s += 1 / 46 * (0.4 + r() * 1.2);
      const m = P('conveyor_ore_' + i, rock(M.ore, sz), frame);
      beltOre.push({ mesh: m, s: s % 1, z: (r() - 0.5) * 0.42, h: sz * 0.55 });
    }
    // trestle bents: splayed I-beam legs, top and mid ties, X bracing, base plates, anchored footings
    const yaw = Math.atan2(side.x, side.z);
    const along = V(beltDir.x, 0, beltDir.z).normalize();
    [-1.1, 2.45, 5.34].forEach((fx, i) => {
      const p = BELT_TAIL.clone().addScaledVector(beltDir, (fx - BELT_TAIL.x) / beltDir.x);
      const top = p.y - 0.42;
      const foot = sz => p.clone().setY(0.32).addScaledVector(side, sz * 0.82);
      const head = sz => p.clone().setY(top).addScaledVector(side, sz * 0.62);
      for (const sz of [-1, 1]) {
        const tag = `${i}_${sz < 0 ? 'l' : 'r'}`, fp = foot(sz);
        P('conveyor_leg_' + tag, ibeam(fp, head(sz), 0.16, 0.16, M.steel, beltDir), sec);
        const ft = P('conveyor_footing_' + tag, cbox(0.75, 0.3 + SINK, 0.75, M.concrete, 0.05), sec);
        ft.position.set(fp.x, (0.3 - SINK) / 2, fp.z); ft.rotation.y = yaw;
        const bp = P('conveyor_baseplate_' + tag, cbox(0.38, 0.03, 0.38, M.steel, 0.008), sec);
        bp.position.set(fp.x, 0.315, fp.z); bp.rotation.y = yaw;
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
          P(`conveyor_anchor_${tag}_${a}${b}`, bolt(), sec).position.copy(fp).addScaledVector(side, a * 0.13).addScaledVector(along, b * 0.13).setY(0.34);
      }
      P(`conveyor_tie_${i}_top`, ibeam(head(-1).addScaledVector(side, -0.15), head(1).addScaledVector(side, 0.15), 0.14, 0.16, M.steel, V(0, 1, 0)), sec);
      const mid = sz => foot(sz).lerp(head(sz), 0.42);
      P(`conveyor_tie_${i}_mid`, member(mid(-1), mid(1), 0.08, 0.08, M.steel, V(0, 1, 0)), sec);
      P(`conveyor_brace_${i}_a`, member(mid(-1), head(1), 0.05, 0.05, M.rust, beltDir), sec);
      P(`conveyor_brace_${i}_b`, member(mid(1), head(-1), 0.05, 0.05, M.rust, beltDir), sec);
    });
  }

  // ================================================================ fillables (bins + hopper)
  const fills = {};
  function makeFill(name, parent, { cx, cz, floorY, w, d, maxH, count, smin = 0.17, smax = 0.36 }) {
    const items = [];
    const sp = (smin + smax) * 0.95; // a floor-covering base layer first, then the heap
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

  // ================================================================ hopper
  {
    const sec = S('hopper');
    const { x: HX, z: HZ, size: Hs, top: Ht, boxH } = HOPPER, h2 = Hs / 2, yb = Ht - boxH, yc = yb + boxH / 2;
    const add = (name, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return P('hopper_' + name, m, sec); };
    add('wall_front', cbox(Hs, boxH, 0.08, M.greenPanel, 0.02), HX, yc, HZ + h2);
    add('wall_back', cbox(Hs, boxH, 0.08, M.greenPanel, 0.02), HX, yc, HZ - h2);
    add('wall_left', cbox(0.08, boxH, Hs, M.greenPanel, 0.02), HX - h2, yc, HZ);
    add('wall_right', cbox(0.08, boxH, Hs, M.greenPanel, 0.02), HX + h2, yc, HZ);
    for (const [n, w, d, z, x] of [['front', Hs + 0.2, 0.14, HZ + h2, HX], ['back', Hs + 0.2, 0.14, HZ - h2, HX], ['left', 0.14, Hs, HZ, HX - h2], ['right', 0.14, Hs, HZ, HX + h2]]) {
      add('rim_' + n, cbox(w, 0.12, d, M.rust, 0.02), x, Ht + 0.02, z);
      add('stiffener_' + n, cbox(w, 0.09, d, M.rust, 0.015), x, yb + 0.55, z);
      add('skirt_' + n, cbox(w, 0.1, d, M.rust, 0.015), x, yb + 0.04, z);
    }
    for (const [n, sx, sz] of [['fl', -1, 1], ['fr', 1, 1], ['bl', -1, -1], ['br', 1, -1]])
      add('corner_' + n, cbox(0.12, boxH + 0.1, 0.12, M.rust, 0.015), HX + sx * h2, yc, HZ + sz * h2);
    // funnel: truncated pyramid (ore sits on its top face), outlet, gate, chute into the annex
    const fp = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) fp.push(V(sx * (h2 - 0.02), 0, sz * (h2 - 0.02)), V(sx * 0.32, -1.3, sz * 0.32));
    add('funnel', meshOf(new ConvexGeometry(fp), M.greenPanel), HX, yb, HZ);
    add('outlet', cbox(0.72, 0.36, 0.72, M.rust, 0.03), HX, yb - 1.45, HZ);
    add('gate', cbox(0.9, 0.06, 0.5, M.steel, 0.01), HX + 0.2, yb - 1.62, HZ);
    P('hopper_chute', member(V(HX, yb - 1.55, HZ), V(HX + 0.7, 1.15, ANNEX.z1 + 0.1), 0.5, 0.36, M.greenPanel, V(0, 1, 0), 0.02), sec);
    // legs, X-bracing on two faces, ties, base plates, footings, access ladder
    const legTop = yb + 0.15, legBot = 0.32;
    const c = (sx, sz, y) => V(HX + sx * (h2 - 0.06), y, HZ + sz * (h2 - 0.06));
    for (const [n, sx, sz] of [['fl', -1, 1], ['fr', 1, 1], ['bl', -1, -1], ['br', 1, -1]]) {
      const b = c(sx, sz, legBot);
      P('hopper_leg_' + n, ibeam(b, c(sx, sz, legTop), 0.18, 0.18, M.greenPanel, V(1, 0, 0)), sec);
      add('footing_' + n, cbox(0.8, 0.32 + SINK, 0.8, M.concrete, 0.05), b.x, (0.32 - SINK) / 2, b.z);
      add('baseplate_' + n, cbox(0.4, 0.03, 0.4, M.steel, 0.008), b.x, 0.335, b.z);
      for (const [a, k] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(`anchor_${n}_${a}${k}`, bolt(), b.x + a * 0.14, 0.36, b.z + k * 0.14);
    }
    P('hopper_brace_front_a', member(c(-1, 1, 0.5), c(1, 1, legTop - 0.25), 0.06, 0.06, M.rust, V(0, 0, 1)), sec);
    P('hopper_brace_front_b', member(c(1, 1, 0.5), c(-1, 1, legTop - 0.25), 0.06, 0.06, M.rust, V(0, 0, 1)), sec);
    P('hopper_brace_left_a', member(c(-1, -1, 0.5), c(-1, 1, legTop - 0.25), 0.06, 0.06, M.rust, V(1, 0, 0)), sec);
    P('hopper_brace_left_b', member(c(-1, 1, 0.5), c(-1, -1, legTop - 0.25), 0.06, 0.06, M.rust, V(1, 0, 0)), sec);
    P('hopper_tie_front', member(c(-1, 1, 1.3), c(1, 1, 1.3), 0.08, 0.1, M.steel, V(0, 1, 0)), sec);
    P('hopper_tie_left', member(c(-1, -1, 1.3), c(-1, 1, 1.3), 0.08, 0.1, M.steel, V(0, 1, 0)), sec);
    const lx = HX + h2 + 0.18;
    for (const dz of [-0.22, 0.22]) P(`hopper_ladder_rail_${dz > 0 ? 'r' : 'l'}`, member(V(lx, 0, HZ + dz), V(lx, Ht + 0.9, HZ + dz), 0.045, 0.06, M.steel, V(1, 0, 0), 0.008), sec);
    for (let i = 0; i < 14; i++) P('hopper_ladder_rung_' + i, member(V(lx, 0.3 + i * 0.3, HZ - 0.22), V(lx, 0.3 + i * 0.3, HZ + 0.22), 0.03, 0.03, M.steel, V(0, 1, 0), 0.006), sec);
    makeFill('hopper', sec, { cx: HX, cz: HZ, floorY: yb - 0.05, w: Hs - 0.35, d: Hs - 0.35, maxH: boxH + 0.6, count: 80, smin: 0.12, smax: 0.22 });
  }

  // ================================================================ processing building
  {
    const sec = S('building');
    const B = BUILDING, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, L = B.x1 - B.x0, Wd = B.z1 - B.z0;
    sec.position.set(cx, 0, cz);
    sec.rotation.y = B.yaw; // the reference building sits slightly skewed to the yard
    const local = new THREE.Group();
    local.position.set(-cx, 0, -cz);
    sec.add(local);
    const add = (name, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return P('building_' + name, m, local); };
    const wallH = B.eave - B.plinth, wy = B.plinth + wallH / 2;
    add('plinth', cbox(L + 0.5, B.plinth + SINK, Wd + 0.5, M.concrete, 0.06), cx, (B.plinth - SINK) / 2, cz);
    add('wall_front', cbox(L, wallH, 0.25, M.concretePanel, 0.03), cx, wy, B.z1);
    add('wall_back', cbox(L, wallH, 0.25, M.concretePanel, 0.03), cx, wy, B.z0);
    add('wall_left', cbox(0.25, wallH, Wd, M.concretePanel, 0.03), B.x0, wy, cz);
    add('wall_right', cbox(0.25, wallH, Wd, M.concretePanel, 0.03), B.x1, wy, cz);
    for (const [n, x, z] of [['fl', B.x0, B.z1], ['fr', B.x1, B.z1], ['bl', B.x0, B.z0], ['br', B.x1, B.z0], ['fm', cx, B.z1 + 0.02], ['bm', cx, B.z0 - 0.02]])
      add('pilaster_' + n, cbox(0.34, wallH + 0.04, 0.34, M.steel, 0.03), x, wy, z);
    add('eave_beam_front', cbox(L + 0.35, 0.22, 0.32, M.rust, 0.03), cx, B.eave - 0.14, B.z1);
    add('eave_beam_back', cbox(L + 0.35, 0.22, 0.32, M.rust, 0.03), cx, B.eave - 0.14, B.z0);
    const half = Wd / 2, rise = B.ridge - B.eave;
    for (const [n, x] of [['left', B.x0 - 0.125], ['right', B.x1 - 0.125]])
      add('gable_' + n, cprism([[-half, 0], [half, 0], [0, rise]], 0.25, M.concretePanel, 0.03), x, B.eave, cz).rotation.y = Math.PI / 2;
    // corrugated roof sheets, fascia, barge boards, ridge cap, gutters, downpipes
    const a = Math.atan2(rise, half), slant = Math.hypot(rise, half), over = 0.45, pw = slant + over, rl = L + 0.8;
    for (const [n, sg] of [['front', 1], ['back', -1]]) {
      const sheet = add('roof_' + n, shadowed(new THREE.Mesh(corrugatedGeo(rl, pw, 0.3, 0.035, ATLAS_TILES.corrugated.size), M.roof)));
      sheet.rotation.x = sg * a;
      sheet.position.set(cx, B.ridge + 0.15 - Math.sin(a) * pw / 2, cz + sg * Math.cos(a) * pw / 2);
      const eaveY = B.eave - Math.sin(a) * over + 0.15, eaveZ = cz + sg * (half + Math.cos(a) * over);
      add('fascia_' + n, cbox(rl + 0.06, 0.2, 0.05, M.rust, 0.012), cx, eaveY - 0.06, eaveZ + sg * 0.02).rotation.x = sg * a;
      add('gutter_' + n, cbox(rl, 0.12, 0.16, M.galv, 0.02), cx, eaveY - 0.16, eaveZ + sg * 0.1);
      for (const [e, x] of [['left', B.x0 - 0.4], ['right', B.x1 + 0.4]])
        add(`barge_${n}_${e}`, cbox(0.07, 0.22, pw + 0.04, M.rust, 0.012), x, B.ridge - Math.sin(a) * pw / 2 + 0.11, cz + sg * Math.cos(a) * pw / 2).rotation.x = sg * a;
      for (const [e, x] of [['left', B.x0 + 0.15], ['right', B.x1 - 0.15]])
        add(`downpipe_${n}_${e}`, cyl(0.055, eaveY - 0.2, M.galv, 10), x, (eaveY - 0.2) / 2, eaveZ + sg * 0.12).rotation.x = Math.PI / 2;
      add('ridge_cap_' + n, cbox(rl + 0.05, 0.035, 0.32, M.galv, 0.01), cx, B.ridge + 0.17, cz + sg * 0.13).rotation.x = sg * a;
    }
    for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) {
      const t = (k + 0.5) / 3, z = cz + sg * half * t, y = B.ridge - (B.ridge - B.eave) * t + 0.05;
      add(`purlin_${sg > 0 ? 'f' : 'b'}${k}`, cbox(L + 0.7, 0.1, 0.08, M.steel, 0.01), cx, y, z).rotation.x = sg * a;
    }
    const roofY = z => B.ridge - Math.abs(z - cz) * Math.tan(a) + 0.17;
    // louvred roof monitors and chimney
    [[B.x0 + 1.5, cz + 0.55, 1.1], [B.x0 + 3.6, cz + 1.25, 1.0]].forEach(([x, z, w], i) => {
      const base = roofY(z) - 0.15, hh = 0.55;
      add(`vent_${i}_body`, cbox(w, hh + 0.2, 0.8, M.greenPanel, 0.025), x, base + (hh + 0.2) / 2, z);
      for (let k = 0; k < 4; k++) add(`vent_${i}_louvre_${k}`, cbox(w - 0.12, 0.05, 0.07, M.steel, 0.01), x, base + 0.3 + k * 0.11, z + 0.42).rotation.x = -0.5;
      add(`vent_${i}_cap`, cbox(w + 0.3, 0.08, 1.05, M.roofSolid, 0.02), x, base + hh + 0.26, z);
      add(`vent_${i}_cap_trim`, cbox(w + 0.34, 0.05, 1.09, M.rust, 0.01), x, base + hh + 0.21, z);
    });
    const chx = B.x1 - 0.9, chz = cz + 1.2, chy = roofY(chz);
    add('chimney', cbox(0.46, 1.5, 0.46, M.concrete, 0.04), chx, chy + 0.5, chz);
    add('chimney_band', cbox(0.52, 0.1, 0.52, M.concrete, 0.02), chx, chy + 1.05, chz);
    add('chimney_cap', cbox(0.62, 0.08, 0.62, M.steel, 0.02), chx, chy + 1.38, chz);
    add('chimney_flue', cyl(0.09, 0.3, M.rust, 12), chx, chy + 1.48, chz).rotation.x = Math.PI / 2;
    // sliding door on the +X gable: sheet, frame, diagonal brace, track, hangers, handle
    const dz = B.z1 - 1.4, dw = 2.0, dh = 2.55, dx = B.x1;
    add('door', cbox(0.09, dh, dw, M.doorSheet, 0.02), dx + 0.2, B.plinth + dh / 2 + 0.02, dz);
    add('door_frame_top', cbox(0.12, 0.12, dw + 0.16, M.steel, 0.015), dx + 0.26, B.plinth + dh + 0.04, dz);
    add('door_frame_bottom', cbox(0.12, 0.08, dw + 0.16, M.steel, 0.015), dx + 0.26, B.plinth + 0.04, dz);
    add('door_frame_left', cbox(0.12, dh, 0.1, M.steel, 0.015), dx + 0.26, B.plinth + dh / 2, dz - dw / 2 - 0.03);
    add('door_frame_right', cbox(0.12, dh, 0.1, M.steel, 0.015), dx + 0.26, B.plinth + dh / 2, dz + dw / 2 + 0.03);
    add('door_brace', cbox(0.05, 0.08, Math.hypot(dw, dh) - 0.3, M.steel, 0.01), dx + 0.26, B.plinth + dh / 2, dz).rotation.x = Math.atan2(dh, dw);
    add('door_track', cbox(0.1, 0.12, dw * 2 + 0.4, M.steel, 0.015), dx + 0.22, B.plinth + dh + 0.22, dz - dw / 2);
    for (const k of [-1, 1]) add(`door_hanger_${k > 0 ? 'r' : 'l'}`, cyl(0.07, 0.06, M.rust, 12), dx + 0.3, B.plinth + dh + 0.16, dz + k * dw * 0.32).rotation.y = Math.PI / 2;
    add('door_handle', cbox(0.05, 0.4, 0.05, M.rust, 0.01), dx + 0.28, B.plinth + 1.2, dz - dw / 2 + 0.2);
    // windows: grid glazing in steel frames with concrete sills
    const win = (name, x, y, z, w, h, face) => {
      const nx = face === 'x' ? 1 : 0, nz = face === 'z' ? 1 : face === '-z' ? -1 : 0, ax = face === 'x';
      const dims = (len, hh, th) => (ax ? [th, hh, len] : [len, hh, th]);
      add(name, cbox(...dims(w, h, 0.05), M.glazing, 0.01), x + nx * 0.13, y, z + nz * 0.13);
      const f = (n, ww, hh, o, oy) => add(`${name}_frame_${n}`, cbox(...dims(ww, hh, 0.08), M.steel, 0.012), x + nx * 0.15 + (ax ? 0 : o), y + oy, z + nz * 0.15 + (ax ? o : 0));
      f('top', w + 0.12, 0.07, 0, h / 2); f('bottom', w + 0.12, 0.07, 0, -h / 2);
      f('left', 0.07, h, -w / 2, 0); f('right', 0.07, h, w / 2, 0);
      add(`${name}_sill`, cbox(...dims(w + 0.2, 0.07, 0.18), M.concrete, 0.015), x + nx * 0.17, y - h / 2 - 0.06, z + nz * 0.17);
    };
    [[B.x0 + 0.9, 1.1], [B.x0 + 2.3, 1.1]].forEach(([x, w], i) => win('window_front_' + i, x, B.eave - 0.5, B.z1, w, 0.5, 'z'));
    win('window_gable', B.x1, B.plinth + 2.25, B.z0 + 0.95, 1.3, 0.5, 'x');
    [B.x0 + 1.4, B.x0 + 3.9].forEach((x, i) => win('window_back_' + i, x, B.eave - 0.5, B.z0, 1.3, 0.5, '-z'));
    // annex (receives the hopper chute)
    const A = ANNEX, ax = (A.x0 + A.x1) / 2, az = (A.z0 + A.z1) / 2, aw = A.x1 - A.x0, ad = A.z1 - A.z0, ah = A.h - B.plinth;
    add('annex_plinth', cbox(aw + 0.4, B.plinth + SINK, ad + 0.3, M.concrete, 0.05), ax, (B.plinth - SINK) / 2, az + 0.12);
    add('annex_wall_front', cbox(aw, ah, 0.24, M.concretePanel, 0.03), ax, B.plinth + ah / 2, A.z1);
    add('annex_wall_left', cbox(0.24, ah, ad, M.concretePanel, 0.03), A.x0, B.plinth + ah / 2, az);
    add('annex_wall_right', cbox(0.24, ah, ad, M.concretePanel, 0.03), A.x1, B.plinth + ah / 2, az);
    for (const [n, x] of [['l', A.x0], ['r', A.x1]]) add('annex_pilaster_' + n, cbox(0.3, ah, 0.3, M.steel, 0.03), x, B.plinth + ah / 2, A.z1);
    add('annex_roof', cbox(aw + 0.5, 0.14, ad + 0.55, M.galv, 0.03), ax, A.h + 0.1, az + 0.15).rotation.x = 0.07;
    for (let i = 0; i < 5; i++) add('annex_roof_seam_' + i, cbox(0.05, 0.05, ad + 0.55, M.galv, 0.01), A.x0 + 0.35 + i * (aw - 0.7) / 4, A.h + 0.19, az + 0.15).rotation.x = 0.07;
    add('annex_flashing_front', cbox(aw + 0.55, 0.16, 0.06, M.rust, 0.01), ax, A.h + 0.02, A.z1 + 0.42);
    add('annex_door', cbox(1.0, 2.0, 0.07, M.greenPanel, 0.015), A.x1 - 0.85, B.plinth + 1.0, A.z1 + 0.14);
    add('annex_door_frame', cbox(1.16, 0.08, 0.1, M.steel, 0.01), A.x1 - 0.85, B.plinth + 2.04, A.z1 + 0.15);
    win('annex_window', A.x1, A.h - 0.75, az, 1.1, 0.45, 'x');
    add('annex_downpipe', cyl(0.05, A.h, M.galv, 10), A.x0 + 0.2, A.h / 2, A.z1 + 0.2).rotation.x = Math.PI / 2;
    add('annex_chute_collar', cbox(0.75, 0.6, 0.12, M.rust, 0.02), HOPPER.x + 0.7, 1.15, A.z1 + 0.13);
    // low concrete platform at the hill end
    add('platform', cbox(2.2, 1.2 + SINK, 2.6, M.concrete, 0.06), 4.3, (1.2 - SINK) / 2, -9.3);
    add('platform_coping', cbox(2.32, 0.1, 2.72, M.concrete, 0.025), 4.3, 1.25, -9.3);
  }

  // ================================================================ storage bins
  const dividerProfile = [[-BIN.t, -SINK], [BIN.d + 0.55, -SINK], [BIN.d + 0.55, 0.4], [BIN.d - 0.15, BIN.wall], [-BIN.t, BIN.wall]];
  for (let b = 0; b < 3; b++) {
    const sec = S('bin_' + b);
    const x0 = BIN.x0 + b * BIN.w, x1 = x0 + BIN.w, cx = (x0 + x1) / 2, cz = BIN.d / 2;
    const add = (name, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return P(`bin_${b}_${name}`, m, sec); };
    add('floor', cbox(BIN.w, 0.16 + SINK, BIN.d, M.concrete, 0.03), cx, (0.16 - SINK) / 2, cz);
    add('wall_back', cbox(BIN.w + BIN.t, BIN.wall + SINK, BIN.t, M.concrete, 0.05), cx, (BIN.wall - SINK) / 2, -BIN.t / 2);
    for (const [n, x] of (b === 2 ? [['left', x0], ['right', x1]] : [['left', x0]])) {
      add('divider_' + n, cprism(dividerProfile, BIN.t, M.concrete, 0.05), x + BIN.t / 2, 0, 0).rotation.y = -Math.PI / 2;
      add('divider_coping_' + n, cbox(BIN.t + 0.08, 0.08, BIN.d + 0.3, M.concrete, 0.02), x, BIN.wall + 0.04, BIN.d / 2 - BIN.t / 2 - 0.15);
    }
    add('curb', cbox(BIN.w - BIN.t, 0.45 + SINK, 0.42, M.concrete, 0.04), cx, (0.45 - SINK) / 2, BIN.d + 0.21);
    for (let g = 0; g < 2; g++) {
      add('grate_' + g, cbox(1.5, 0.24, 0.05, M.glazing, 0.012), cx + (g - 0.5) * 1.8, 0.22, BIN.d + 0.43);
      add('grate_frame_' + g, cbox(1.6, 0.32, 0.03, M.steel, 0.01), cx + (g - 0.5) * 1.8, 0.22, BIN.d + 0.415);
    }
    makeFill('bin_' + b, sec, { cx, cz: cz + 0.1, floorY: 0.16, w: BIN.w - 0.65, d: BIN.d - 0.3, maxH: 1.75, count: 210, smin: 0.13, smax: 0.27 });
  }

  // tag meshes with their section, remember original transforms for rebuild
  for (const name of sections) parts[name].traverse(o => {
    o.userData.section = name;
    if (o.isMesh && !o.userData.static) o.userData.orig = { parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
  });

  // ================================================================ runtime
  const groundAt = opts.groundHeight;
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

  const tmpBox = new THREE.Box3(), tmpV = V();
  function destroy(name) {
    const target = parts[name];
    if (!target) return;
    const meshes = [];
    target.traverse(o => { if (o.isMesh && o.userData.orig && !o.userData.debris && !o.userData.flying) meshes.push(o); });
    if (!meshes.length) return;
    const center = tmpBox.setFromObject(target).getCenter(V());
    const size = tmpBox.getSize(tmpV).length();
    center.y = Math.max(0, center.y - size * 0.25);
    for (const m of meshes) {
      if (!m.visible) { m.userData.debris = true; continue; }
      root.attach(m);
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const dims = m.geometry.boundingBox.getSize(V()).multiply(m.scale);
      const vol = dims.x * dims.y * dims.z;
      const dir = m.getWorldPosition(V()).sub(center);
      dir.y = Math.abs(dir.y) + 0.5;
      dir.normalize();
      const speed = (2.5 + Math.random() * 4) / (1 + Math.cbrt(vol) * 0.6);
      m.userData.flying = true;
      flying.push({
        m, r: Math.min(dims.x, dims.y, dims.z) / 2, life: 0,
        v: dir.multiplyScalar(speed).add(V(0, 2 + Math.random() * 3, 0)),
        w: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8 / (1 + Math.cbrt(vol))),
      });
    }
    puff(center, Math.min(4, 1 + size * 0.3));
  }

  function destroyAll() {
    ['conveyor', 'hopper', 'building', 'portal', 'tunnel', 'bin_0', 'bin_1', 'bin_2'].forEach((n, i) => queue.push({ t: time + i * 0.45, name: n }));
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
        rl.userData.spin -= d / rl.userData.radius;
        rl.rotation.set(rl.userData.tilt, 0, rl.userData.spin);
      }
      for (const o of beltOre) {
        if (!alive(o.mesh.name)) continue;
        o.s += d / beltLen;
        if (o.s >= 1) {
          o.s -= 1;
          if (fillAlive('hopper')) fills.hopper.target = Math.min(1, fills.hopper.target + 0.03);
        }
        o.mesh.position.set(o.s * beltLen, 0.12 + o.h, o.z);
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
      const g = groundAt(m.position.x, m.position.z) + f.r;
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
    root, parts, sections, ready: atlas.ready,
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
