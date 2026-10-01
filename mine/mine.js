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
    return [92 * k, 90 * k, 84 * k];
  });
  T.ore = makeTex(256, (x, y) => {
    const n = fbm(x / 12, y / 12, 6, 5), m = fbm(x / 30, y / 30, 7, 3);
    const b = m > 0.55 ? [165, 82, 36] : m < 0.4 ? [70, 40, 32] : [112, 52, 32];
    const k = 0.6 + 0.7 * n + (hash3(x, y, 3) > 0.985 ? 0.6 : 0);
    return [b[0] * k, b[1] * k, b[2] * k];
  });
  T.ground = makeTex(256, (x, y) => {
    let k = 0.72 + 0.4 * fbm(x / 20, y / 20, 8, 4);
    if (hash3(x >> 1, y >> 1, 4) > 0.97) k *= 0.6;
    return [255 * k, 250 * k, 240 * k];
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
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
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

// ---------------------------------------------------------------- terrain
const PORTAL_X = -3.8, PORTAL_Z = -3.2;
function rectMask(x, z, x0, x1, z0, z1, margin) {
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  return 1 - smoothstep(0, margin, Math.hypot(dx, dz));
}
export function heightAt(x, z) {
  let h = 10 * Math.exp(-((x + 1) ** 2 / 50 + (z + 9) ** 2 / 28));
  h += 1.6 * (fbm(x * 0.25, z * 0.25, 7, 4) - 0.5) * Math.min(1, h / 2);
  h *= clamp((-z - 1.5) / 2.5, 0, 1);                       // steep face behind the yard
  h *= 1 - rectMask(x, z, 4.0, 11.0, -4.5, 3.5, 1.5);       // flatten under the building
  // tunnel: clear the mouth, and cap the hill to the tunnel-roof height over the bore
  const k = smoothstep(2.1, 2.8, Math.abs(x - PORTAL_X));
  if (z > -3.4 && z < -2.0) h *= k;
  else if (z <= -3.4) h = lerp(lerp(3.9, Math.max(h, 3.9), smoothstep(-6.5, -9, z)), h, k);
  return Math.max(0, h) + 0.06 * (fbm(x * 0.6, z * 0.6, 3, 3) - 0.5);
}

// ---------------------------------------------------------------- main factory
/**
 * createMine(options) → controller
 *   root                 THREE.Group to add to your scene
 *   parts                { name: Object3D } every destroyable part (+ section groups)
 *   sections             section names, e.g. 'portal', 'conveyor', 'hopper', 'building', 'bin_0'...
 *   update(dt)           call every frame
 *   setConveyor({running, speed})
 *   setFill(name, 0..1, {instant, rate}) / getFill(name)   name: 'bin_0'|'bin_1'|'bin_2'|'hopper'
 *   destroy(name)        name of a part or section; pieces fly off and come to rest as rubble
 *   destroyAll()         staged demolition
 *   rebuild()            restore everything
 *   partOf(object3D)     -> { part, section } for raycast picking
 */
export function createMine(options = {}) {
  const opts = Object.assign({ autoCycle: true, beltSpeed: 1.2, seed: 1 }, options);
  const r = rng(opts.seed * 9973);
  const T = buildTextures();
  const beltTex = makeBeltTexture();
  const std = (map, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ map, roughness: 0.9, metalness: 0.05 }, o));
  const M = {
    concrete: std(T.concrete),
    roofGreen: std(T.corrugated, { roughness: 0.7, metalness: 0.2 }),
    panel: std(T.panel, { roughness: 0.75, metalness: 0.2 }),
    panel2: std(T.panel, { roughness: 0.75, metalness: 0.2, side: THREE.DoubleSide }),
    rust: std(T.rust, { roughness: 0.85, metalness: 0.2 }),
    steel: std(T.steel, { roughness: 0.6, metalness: 0.3 }),
    belt: std(beltTex, { roughness: 0.95 }),
    rock: std(T.rock, { flatShading: true, roughness: 1 }),
    ore: std(T.ore, { flatShading: true, roughness: 0.85 }),
    ground: std(T.ground, { vertexColors: true, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1d262d, roughness: 0.25, metalness: 0.4 }),
    void: new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide }),
  };
  const rockGeos = Array.from({ length: 10 }, (_, i) => rockGeometry(i + opts.seed * 31));

  const root = new THREE.Group();
  root.name = 'Mine';
  const parts = {};
  const sections = [];
  const P = (name, obj, parent) => {
    obj.name = name; obj.userData.part = name; parts[name] = obj; parent.add(obj); return obj;
  };
  const S = name => { const g = new THREE.Group(); P(name, g, root); sections.push(name); return g; };
  const rock = (mat, s) => {
    const m = shadowed(new THREE.Mesh(rockGeos[Math.floor(r() * rockGeos.length)], mat));
    m.scale.setScalar(s);
    m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
    return m;
  };

  // ---------------- terrain (static, not destroyable)
  {
    const g = new THREE.PlaneGeometry(34, 34, 150, 150);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const n = g.attributes.normal, col = [], c = new THREE.Color();
    const dirt = new THREE.Color().setRGB(0.6, 0.5, 0.3, THREE.SRGBColorSpace);
    const grass = new THREE.Color().setRGB(0.5, 0.45, 0.22, THREE.SRGBColorSpace);
    const stone = new THREE.Color().setRGB(0.36, 0.34, 0.31, THREE.SRGBColorSpace);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      c.copy(dirt).lerp(grass, fbm(x * 0.3, z * 0.3, 11, 3));
      const rocky = smoothstep(0.85, 0.6, n.getY(i)) * smoothstep(0.5, 1.5, y) + 0.5 * smoothstep(0.55, 0.7, fbm(x * 0.4, z * 0.4, 12, 3)) * smoothstep(1, 3, y);
      c.lerp(stone, clamp(rocky, 0, 1));
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 9, uv.getY(i) * 9);
    // irregular round footprint
    const idx = g.index.array, keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      const cx = (p.getX(idx[i]) + p.getX(idx[i + 1]) + p.getX(idx[i + 2])) / 3;
      const cz = (p.getZ(idx[i]) + p.getZ(idx[i + 1]) + p.getZ(idx[i + 2])) / 3;
      if (Math.abs(cx - PORTAL_X) < 1.95 && cz < -2.7 && cz > -6.5) continue; // tunnel bore
      const a = Math.atan2(cz, cx);
      if (Math.hypot(cx, cz + 1) < 14.5 + 2 * (noise3(Math.cos(a) * 2, Math.sin(a) * 2, 5) - 0.5) + 0.5 * hash3(cx * 9, cz * 9, 1))
        keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g.setIndex(keep);
    const terrain = new THREE.Mesh(g, M.ground);
    terrain.receiveShadow = true;
    terrain.userData.static = true;
    P('terrain', terrain, root);
  }

  // ---------------- tunnel portal
  {
    const sec = S('portal');
    sec.position.set(PORTAL_X, 0, PORTAL_Z);
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P('portal_' + name, m, sec); };
    add('pillar_left', box(0.9, 3.0, 1.2, M.concrete), -2.15, 1.5, 0);
    add('pillar_right', box(0.9, 3.0, 1.2, M.concrete), 2.15, 1.5, 0);
    add('lintel', box(5.2, 0.9, 1.2, M.concrete), 0, 3.45, 0);
    add('lintel_cap', box(5.4, 0.2, 1.35, M.concrete), 0, 4.0, 0);
    const steel = [
      ['post_left', -1.6, 0, -1.6, 2.4], ['post_right', 1.6, 0, 1.6, 2.4],
      ['brace_left', -1.6, 2.4, -1.0, 3.0], ['brace_right', 1.6, 2.4, 1.0, 3.0], ['header', -1.0, 3.0, 1.0, 3.0],
    ];
    for (const [n, x1, y1, x2, y2] of steel) {
      const m = beamXY(x1, y1, x2, y2, 0.2, 1.35, M.rust);
      P('portal_steel_' + n, m, sec);
      m.position.z = 0.02;
    }
    for (const x of [-0.9, 0.9]) add('plate_' + (x < 0 ? 'left' : 'right'), box(0.6, 0.18, 0.08, M.steel), x, 3.55, 0.64);
    const wl = add('wing_left', box(2.4, 1.5, 0.4, M.concrete), -3.4, 0.75, 0.6); wl.rotation.y = 0.55;
    const wr = add('wing_right', box(2.0, 1.3, 0.4, M.concrete), 3.3, 0.65, 0.5); wr.rotation.y = -0.55;
    add('wing_cap_left', box(0.6, 1.9, 0.6, M.concrete), -4.35, 0.95, 1.2);
    add('wing_cap_right', box(0.6, 1.7, 0.6, M.concrete), 4.15, 0.85, 1.05);
    // tunnel lining that roofs the trench cut into the hill, plus a dark interior
    add('lining_left', box(0.5, 3.6, 7, M.concrete), -1.85, 1.8, -3.6);
    add('lining_right', box(0.5, 3.6, 7, M.concrete), 1.85, 1.8, -3.6);
    const roof = add('lining_roof', box(5.6, 1.0, 7.5, M.rock, 3), 0, 3.6, -3.9);
    roof.rotation.x = 0;
    const voidBox = new THREE.Mesh(new THREE.BoxGeometry(3.08, 2.95, 7), M.void);
    voidBox.position.set(0, 1.47, -3.55);
    voidBox.userData.static = true;
    sec.add(voidBox);
    // a few tunnel rails / sleepers
    for (let i = 0; i < 5; i++) add('sleeper_' + i, box(1.8, 0.08, 0.25, M.steel), 0.9, 0.05, -0.4 - i * 0.8);
  }

  // ---------------- conveyor
  const A = new THREE.Vector3(PORTAL_X, 0.9, PORTAL_Z - 2.6);
  const B = new THREE.Vector3(3.15, 3.45, 2.75);
  const beltDir = B.clone().sub(A);
  const beltLen = beltDir.length();
  beltDir.normalize();
  const side = new THREE.Vector3().crossVectors(beltDir, new THREE.Vector3(0, 1, 0)).normalize();
  const upv = new THREE.Vector3().crossVectors(side, beltDir);
  const beltOre = [], rollers = [];
  const BELT_TILE = 0.6;
  {
    const sec = S('conveyor');
    const frame = new THREE.Group();
    frame.position.copy(A);
    frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(beltDir, upv, side));
    sec.add(frame);
    const mid = beltLen / 2;
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P('conveyor_' + name, m, frame); };
    add('rail_left', box(beltLen, 0.28, 0.08, M.steel), mid, 0.02, -0.48);
    add('rail_right', box(beltLen, 0.28, 0.08, M.steel), mid, 0.02, 0.48);
    add('return_frame', box(beltLen, 0.08, 0.7, M.steel), mid, -0.2, 0);
    beltTex.repeat.set(1, 1);
    const belt = add('belt', box(beltLen, 0.05, 0.84, M.belt, BELT_TILE), mid, 0.1, 0);
    belt.material = M.belt;
    for (const [n, x] of [['head', beltLen], ['tail', 0]]) {
      const rl = add('roller_' + n, shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.95, 12), M.steel)), x, 0.0, 0);
      rl.userData.spin = 0; rl.rotation.set(Math.PI / 2, 0, 0);
      rollers.push(rl);
    }
    for (let i = 0; i < 8; i++) {
      const rl = add('idler_' + i, shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), M.steel)), (i + 0.5) * beltLen / 8, 0.04, 0);
      rl.userData.spin = 0; rl.rotation.set(Math.PI / 2, 0, 0);
      rollers.push(rl);
    }
    // ore riding the belt — each rock its own part
    const N = 16;
    for (let i = 0; i < N; i++) {
      const s = 0.13 + r() * 0.1;
      const m = P('conveyor_ore_' + i, rock(M.ore, s), frame);
      beltOre.push({ mesh: m, s: i / N + r() * 0.02, z: (r() - 0.5) * 0.45, h: s * 0.6 });
    }
    // trestle legs in world space
    const legYaw = Math.atan2(side.x, side.z);
    [0.38, 0.62, 0.86].forEach((t, i) => {
      const p = A.clone().addScaledVector(beltDir, t * beltLen);
      const hgt = p.y - 0.2;
      for (const sgn of [-1, 1]) {
        const lp = p.clone().addScaledVector(side, sgn * 0.45);
        const leg = P(`conveyor_leg_${i}_${sgn < 0 ? 'l' : 'r'}`, box(0.14, hgt, 0.14, M.rust, 1), sec);
        leg.position.set(lp.x, hgt / 2 + 0.2, lp.z);
        const foot = P(`conveyor_footing_${i}_${sgn < 0 ? 'l' : 'r'}`, box(0.45, 0.4, 0.45, M.concrete, 1), sec);
        foot.position.set(lp.x, 0.2, lp.z);
      }
      for (const [k, y] of [['low', 0.2 + hgt * 0.35], ['high', 0.2 + hgt * 0.85]]) {
        const cb = P(`conveyor_cross_${i}_${k}`, box(0.08, 0.1, 1.0, M.rust, 1), sec);
        cb.position.set(p.x, y, p.z);
        cb.rotation.y = legYaw;
      }
    });
  }

  // ---------------- fillables (bins + hopper)
  const fills = {};
  function makeFill(name, parent, { cx, cz, floorY, w, d, maxH, count }) {
    const items = [];
    for (let i = 0; i < count; i++) {
      const x = (r() - 0.5) * w * 0.9, z = (r() - 0.5) * d * 0.9;
      const nx = x / (w / 2), nz = z / (d / 2);
      const hm = maxH * Math.max(0.2, 1 - 0.65 * (nx * nx + nz * nz));
      const s = 0.17 + r() * 0.17;
      items.push({ base: new THREE.Vector3(cx + x, floorY + s * 0.4 + r() * hm, cz + z), s });
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

  // ---------------- hopper
  const HX = 3.2, HZ = 2.8;
  {
    const sec = S('hopper');
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P('hopper_' + name, m, sec); };
    add('wall_front', box(1.9, 1.0, 0.1, M.panel, 1.2), HX, 2.6, HZ + 0.8);
    add('wall_back', box(1.9, 1.0, 0.1, M.panel, 1.2), HX, 2.6, HZ - 0.8);
    add('wall_left', box(0.1, 1.0, 1.6, M.panel, 1.2), HX - 0.95, 2.6, HZ);
    add('wall_right', box(0.1, 1.0, 1.6, M.panel, 1.2), HX + 0.95, 2.6, HZ);
    add('rim', box(2.05, 0.08, 0.12, M.rust, 1), HX, 3.12, HZ + 0.82);
    const fun = add('funnel', shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1, 0.22, 1.0, 4, 1, true), M.panel2)), HX, 1.6, HZ);
    fun.rotation.y = Math.PI / 4; fun.scale.set(1.34, 1, 1.13);
    for (const [n, dx, dz] of [['fl', -0.85, 0.72], ['fr', 0.85, 0.72], ['bl', -0.85, -0.72], ['br', 0.85, -0.72]]) {
      add('leg_' + n, box(0.14, 2.1, 0.14, M.rust, 1), HX + dx, 1.05, HZ + dz);
      add('footing_' + n, box(0.4, 0.3, 0.4, M.concrete, 1), HX + dx, 0.15, HZ + dz);
    }
    const ch = add('chute', box(1.5, 0.12, 0.45, M.steel, 1), HX + 0.95, 1.0, HZ - 0.4);
    ch.rotation.z = 0.25;
    makeFill('hopper', sec, { cx: HX, cz: HZ, floorY: 2.15, w: 1.75, d: 1.5, maxH: 1.15, count: 34 });
  }

  // ---------------- processing building
  {
    const sec = S('building');
    sec.position.set(7.5, 0, -1.5);
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P('building_' + name, m, sec); };
    add('foundation', box(5.9, 0.3, 4.6, M.concrete), 0, 0.15, 0);
    add('wall_front', box(5.5, 3.2, 0.2, M.concrete), 0, 1.9, 2.0);
    add('wall_back', box(5.5, 3.2, 0.2, M.concrete), 0, 1.9, -2.0);
    add('wall_left', box(0.2, 3.2, 3.8, M.concrete), -2.65, 1.9, 0);
    add('wall_right', box(0.2, 3.2, 3.8, M.concrete), 2.65, 1.9, 0);
    const tri = new THREE.Shape([new THREE.Vector2(-2.1, 0), new THREE.Vector2(2.1, 0), new THREE.Vector2(0, 1.3)]);
    const gableGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false });
    const guv = gableGeo.attributes.uv;
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) / 2, guv.getY(i) / 2);
    for (const [n, x] of [['left', -2.75], ['right', 2.55]]) {
      const g = add('gable_' + n, shadowed(new THREE.Mesh(gableGeo, M.concrete)), x, 3.5, 0);
      g.rotation.y = Math.PI / 2;
    }
    const a = Math.atan2(1.3, 2.1);
    for (const [n, sgn] of [['front', 1], ['back', -1]]) {
      const rf = add('roof_' + n, box(6.1, 0.08, 2.85, M.roofGreen, 2), 0, 4.15 - 0.09 + 0.05, sgn * (1.05 + 0.15));
      rf.rotation.x = sgn * a;
    }
    add('roof_ridge', box(6.15, 0.12, 0.32, M.panel, 1), 0, 4.84, 0);
    for (const [i, x] of [[0, -1.4], [1, 0.4]]) {
      const v = add('roof_vent_' + i, box(0.65, 0.35, 0.5, M.panel, 1), x, 4.62, 0.55);
      add('roof_vent_cap_' + i, box(0.8, 0.07, 0.62, M.roofGreen, 1), x, 4.83, 0.55);
      v.rotation.x = 0;
    }
    add('chimney', box(0.38, 1.1, 0.38, M.concrete, 1), 2.0, 4.75, -0.8);
    add('chimney_cap', box(0.5, 0.1, 0.5, M.steel, 1), 2.0, 5.33, -0.8);
    add('door', box(1.25, 2.3, 0.08, M.panel, 1.2), 1.45, 1.45, 2.12);
    add('door_frame_top', box(1.5, 0.12, 0.12, M.steel, 1), 1.45, 2.66, 2.12);
    add('door_frame_left', box(0.12, 2.4, 0.12, M.steel, 1), 0.76, 1.5, 2.12);
    add('door_frame_right', box(0.12, 2.4, 0.12, M.steel, 1), 2.14, 1.5, 2.12);
    [-0.1, 1.45].forEach((x, i) => {
      add('window_front_' + i, box(1.0, 0.5, 0.06, M.glass), x, 3.12, 2.12);
      add('window_front_frame_' + i, box(1.1, 0.08, 0.1, M.steel, 1), x, 2.85, 2.13);
    });
    [-1.0, 0.4].forEach((z, i) => add('window_right_' + i, box(0.06, 0.5, 1.0, M.glass), 2.77, 3.0, z));
    // annex (receives the hopper chute)
    add('annex_foundation', box(2.7, 0.3, 2.1, M.concrete), -1.75, 0.15, 3.1);
    add('annex_wall_front', box(2.5, 2.2, 0.2, M.concrete), -1.75, 1.4, 4.05);
    add('annex_wall_left', box(0.2, 2.2, 1.95, M.concrete), -2.9, 1.4, 3.05);
    add('annex_wall_right', box(0.2, 2.2, 1.95, M.concrete), -0.6, 1.4, 3.05);
    const ar = add('annex_roof', box(2.85, 0.15, 2.35, M.concrete, 1.4), -1.75, 2.6, 3.1);
    ar.rotation.x = 0.12;
    add('annex_door', box(0.9, 1.6, 0.06, M.panel, 1), -1.4, 1.1, 4.17);
  }

  // ---------------- storage bins
  for (let b = 0; b < 3; b++) {
    const sec = S('bin_' + b);
    const cx = -6.5 + 3.3 * b, cz = 5.5;
    const add = (name, m, x, y, z) => { m.position.set(x, y, z); return P(`bin_${b}_${name}`, m, sec); };
    add('floor', box(3.3, 0.15, 3.3, M.concrete), cx, 0.075, cz);
    add('wall_front', box(3.0, 1.0, 0.3, M.concrete), cx, 0.65, cz + 1.45);
    add('wall_back', box(3.0, 1.0, 0.3, M.concrete), cx, 0.65, cz - 1.45);
    const dividers = b === 2 ? [['left', -1.65], ['right', 1.65]] : [['left', -1.65]];
    for (const [n, dx] of dividers) {
      add('divider_' + n, box(0.3, 1.1, 3.3, M.concrete), cx + dx, 0.7, cz);
      const bt = add('buttress_' + n, box(0.42, 1.25, 0.5, M.concrete, 1), cx + dx, 0.62, cz + 1.85);
      bt.rotation.x = -0.12;
    }
    makeFill('bin_' + b, sec, { cx, cz, floorY: 0.2, w: 2.75, d: 2.55, maxH: 1.1, count: 75 });
  }

  // ---------------- loose rocks (each separate)
  const avoid = [[-8.5, 2.0, 3.6, 7.6], [4.2, 11.0, -4.2, 3.0], [1.8, 4.6, 1.6, 4.0], [-7, -0.6, -4.2, -1.5]];
  const nearBelt = (x, z) => {
    const ax = A.x, az = A.z, bx = B.x, bz = B.z, dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 1.1;
  };
  const blocked = (x, z) => nearBelt(x, z) || avoid.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  {
    const sec = S('hill_rocks');
    let n = 0;
    for (let tries = 0; n < 70 && tries < 3000; tries++) {
      const x = -13 + r() * 18, z = -14 + r() * 12;
      const h = heightAt(x, z);
      if (h < 1.2 || (Math.abs(x - PORTAL_X) < 2.9 && z > -8)) continue;
      const s = 0.35 + r() * 0.6;
      const m = P('hill_rock_' + n++, rock(M.rock, 1), sec);
      m.scale.set(s * (0.8 + r() * 0.6), s * (0.6 + r() * 0.6), s * (0.8 + r() * 0.6));
      m.position.set(x, h - 0.2 * s, z);
    }
    // a couple sitting on the tunnel roof
    for (let i = 0; i < 6; i++) {
      const s = 0.4 + r() * 0.6;
      const m = P('hill_rock_' + n++, rock(M.rock, s), sec);
      m.position.set(PORTAL_X + (r() - 0.5) * 4.5, 4.1 + s * 0.2, PORTAL_Z - 1.5 - r() * 5);
    }
  }
  {
    const sec = S('ground_rocks');
    let n = 0;
    for (let tries = 0; n < 70 && tries < 3000; tries++) {
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 13.5;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad - 1;
      if (blocked(x, z) || heightAt(x, z) > 0.6) continue;
      const s = 0.08 + r() * r() * 0.35;
      const m = P('ground_rock_' + n++, rock(r() < 0.25 ? M.ore : M.rock, s), sec);
      m.position.set(x, heightAt(x, z) + s * 0.3, z);
    }
  }

  // tag every mesh with its section, remember original transform for rebuild
  for (const name of sections) parts[name].traverse(o => {
    o.userData.section = name;
    if (o.isMesh && !o.userData.static) o.userData.orig = { parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
  });

  // ---------------------------------------------------------------- runtime state
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
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, color: 0xa08a68, transparent: true, depthWrite: false, opacity: 0.7 }));
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * size, Math.random() * size * 0.5, (Math.random() - 0.5) * size));
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
    const center = tmpBox.setFromObject(target).getCenter(new THREE.Vector3());
    const size = tmpBox.getSize(tmpV).length();
    center.y = Math.max(0, center.y - size * 0.25);
    for (const m of meshes) {
      if (!m.visible) { m.userData.debris = true; continue; } // empty fill slot
      root.attach(m);
      const dims = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).getSize(new THREE.Vector3()).multiply(m.scale);
      const minHalf = Math.min(dims.x, dims.y, dims.z) / 2;
      const vol = dims.x * dims.y * dims.z;
      const dir = m.getWorldPosition(new THREE.Vector3()).sub(center);
      dir.y = Math.abs(dir.y) + 0.5;
      dir.normalize();
      const speed = (2.5 + Math.random() * 4) / (1 + Math.cbrt(vol) * 0.6);
      m.userData.flying = true;
      flying.push({
        m, r: minHalf, life: 0,
        v: dir.multiplyScalar(speed).add(new THREE.Vector3(0, 2 + Math.random() * 3, 0)),
        w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8 / (1 + Math.cbrt(vol))),
      });
    }
    puff(center, Math.min(4, 1 + size * 0.3));
  }

  function destroyAll() {
    const order = ['conveyor', 'hopper', 'building', 'portal', 'bin_0', 'bin_1', 'bin_2'];
    order.forEach((n, i) => queue.push({ t: time + i * 0.45, name: n }));
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
  const fillAlive = n => parts[n] && (n === 'hopper' ? alive('hopper_funnel') : alive(`${n}_floor`));

  function update(dt) {
    dt = Math.min(dt, 0.05);
    time += dt;
    while (queue.length && queue[0].t <= time) destroy(queue.shift().name);

    // conveyor
    if (state.running && alive('conveyor_belt')) {
      const d = state.speed * dt;
      beltTex.offset.x -= d / BELT_TILE;
      for (const rl of rollers) if (alive(rl.name)) {
        rl.userData.spin -= d / (rl.geometry.parameters.radiusTop);
        rl.rotation.set(Math.PI / 2, rl.userData.spin, 0);
      }
      for (const o of beltOre) {
        if (!alive(o.mesh.name)) continue;
        o.s += d / beltLen;
        if (o.s >= 1) {
          o.s -= 1;
          if (fillAlive('hopper')) fills.hopper.target = Math.min(1, fills.hopper.target + 0.035);
        }
        o.mesh.position.set(o.s * beltLen, 0.14 + o.h, o.z);
        o.mesh.visible = o.s > 0.01 && o.s < 0.985;
      }
    }

    // processing loop: hopper drains into the building, output stockpiles in the bins
    if (state.autoCycle && alive('building_wall_front') && fills.hopper.level > 0.02) {
      const take = Math.min(fills.hopper.target, 0.04 * dt);
      fills.hopper.target -= take;
      fills.hopper.rate = 0.4;
      let tries = 0;
      while (tries++ < 3) {
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

    // debris physics
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
