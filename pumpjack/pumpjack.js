// Procedural, animated, destructible oil pumpjack for an RTS.
//
//   import { createPumpjack } from './pumpjack.js';
//   const pj = createPumpjack({ scale: 1 });
//   scene.add(pj.object);
//   // every frame:
//   pj.update(dt);
//   // gameplay hooks:
//   pj.setHealth(0.4);        // 1 = intact, <0.6 smokes, <0.3 sputters, 0 = explodes
//   pj.breakPart('motor');    // knock a single part off
//   pj.destroy();             // blow the whole rig apart
//   pj.reset();               // rebuild (e.g. for pooling)
//
// Every part is a named THREE.Group in `pj.parts` so it can be detached,
// hidden, swapped or exported (GLTFExporter keeps the names).
//
// Units are metres; the footprint is ~14 x 7.5 m before `scale`.

import * as THREE from 'three';

// ---------------------------------------------------------------- textures

function noiseCanvas(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Worn olive-grey paint with rust blooms and streaks.
function paintedSteelTexture() {
  const r = rand(7);
  return noiseCanvas(512, (g, n) => {
    g.fillStyle = '#4a4d42';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 9000; i++) {
      const v = 60 + r() * 30;
      g.fillStyle = `rgba(${v},${v + 3},${v - 8},0.25)`;
      g.fillRect(r() * n, r() * n, 2 + r() * 3, 2 + r() * 3);
    }
    for (let i = 0; i < 70; i++) {
      const x = r() * n, y = r() * n, rad = 4 + r() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(120,62,32,0.85)');
      grd.addColorStop(0.6, 'rgba(98,56,34,0.45)');
      grd.addColorStop(1, 'rgba(90,60,40,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 40; i++) {
      const x = r() * n, y = r() * n;
      g.strokeStyle = `rgba(105,58,30,${0.15 + r() * 0.25})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y + 20 + r() * 60); g.stroke();
    }
  });
}

function concreteTexture() {
  const r = rand(21);
  return noiseCanvas(512, (g, n) => {
    g.fillStyle = '#a49c90';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 25000; i++) {
      const v = 130 + r() * 60;
      g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.18)`;
      g.fillRect(r() * n, r() * n, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 60; i++) {
      const x = r() * n, y = r() * n, rad = 10 + r() * 50;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(90,80,68,0.28)');
      grd.addColorStop(1, 'rgba(90,80,68,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  });
}

function smokeTexture() {
  return noiseCanvas(128, (g, n) => {
    const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, n, n);
  });
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const steelMap = paintedSteelTexture();
  const concMap = concreteTexture();
  SHARED = {
    smokeMap: smokeTexture(),
    steel: new THREE.MeshStandardMaterial({ map: steelMap, color: 0xffffff, metalness: 0.35, roughness: 0.7 }),
    steelDark: new THREE.MeshStandardMaterial({ map: steelMap, color: 0xb9b9b0, metalness: 0.4, roughness: 0.65 }),
    rust: new THREE.MeshStandardMaterial({ map: steelMap, color: 0xc9805a, metalness: 0.45, roughness: 0.8 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.95, roughness: 0.25 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.8, roughness: 0.45 }),
    concrete: new THREE.MeshStandardMaterial({ map: concMap, color: 0xc4bcae, roughness: 0.95, metalness: 0.0 }),
  };
  return SHARED;
}

// ---------------------------------------------------------------- helpers

const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function box(w, h, d, mat, x, y, z) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}

// Cylinder with its axis along `axis` ('x' | 'y' | 'z').
function cyl(r, len, mat, axis = 'y', x = 0, y = 0, z = 0, seg = 24, r2 = r) {
  const m = mesh(new THREE.CylinderGeometry(r, r2, len, seg), mat, x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  return m;
}

// Rectangular member spanning two points (legs, braces, rungs).
function strut(a, b, w, d, mat) {
  const len = a.distanceTo(b);
  const m = mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, tmpV.copy(b).sub(a).normalize());
  return m;
}

function pipe(a, b, r, mat) {
  const len = a.distanceTo(b);
  const m = mesh(new THREE.CylinderGeometry(r, r, len, 14), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, tmpV.copy(b).sub(a).normalize());
  return m;
}

function bolt(mat, x, y, z, axis = 'z', r = 0.05) {
  return cyl(r, 0.06, mat, axis, x, y, z, 6);
}

function group(name, parent) {
  const g = new THREE.Group();
  g.name = name;
  if (parent) parent.add(g);
  return g;
}

// ---------------------------------------------------------------- layout
// Side view in the XY plane, +X towards the motor, Z across the rig.

const PIVOT = new THREE.Vector3(0.6, 6.2, 0);   // saddle bearing
const HEAD_R = 4.6;                              // horsehead arc radius
const REAR_R = 3.1;                              // pivot -> equalizer
const CRANK = new THREE.Vector3(3.9, 2.25, 0);   // gearbox output shaft
const CRANK_R = 1.0;                             // crank pin radius
const PITMAN_L = 4.1;
const WELL_X = PIVOT.x - HEAD_R;                 // well centre line
const BEAM_Y = 0.45;                             // beam axis above pivot

// Walking-beam angle for a given crank angle: intersect the circle swept by
// the equalizer with the circle of reach of the pitman around the crank pin.
function solveBeam(theta, out) {
  const px = CRANK.x + CRANK_R * Math.cos(theta);
  const py = CRANK.y + CRANK_R * Math.sin(theta);
  const dx = px - PIVOT.x, dy = py - PIVOT.y;
  const d = Math.hypot(dx, dy);
  const a = (REAR_R * REAR_R - PITMAN_L * PITMAN_L + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, REAR_R * REAR_R - a * a));
  const mx = PIVOT.x + (a * dx) / d, my = PIVOT.y + (a * dy) / d;
  // upper intersection = equalizer above the crank
  const ex = mx - (h * dy) / d, ey = my + (h * dx) / d;
  const ex2 = mx + (h * dy) / d, ey2 = my - (h * dx) / d;
  const useFirst = ey >= ey2;
  out.pin.set(px, py, 0);
  out.eq.set(useFirst ? ex : ex2, useFirst ? ey : ey2, 0);
  out.phi = Math.atan2(out.eq.y - PIVOT.y, out.eq.x - PIVOT.x);
  return out;
}

// ---------------------------------------------------------------- builders

function buildBase(root, M) {
  const g = group('base', root);
  const tiles = [
    [-5.6, -1.6], [-1.6, 1.8], [1.8, 5.0], [5.0, 8.4],
  ];
  for (const [x0, x1] of tiles) {
    for (const [z0, z1] of [[-3.7, 0], [0, 3.7]]) {
      const w = x1 - x0 - 0.06, d = z1 - z0 - 0.06;
      const t = box(w, 0.55, d, M.concrete, (x0 + x1) / 2, 0.275, (z0 + z1) / 2);
      g.add(t);
    }
  }
  // chamfered skirt
  const skirt = box(14.2, 0.18, 7.6, M.concrete, 1.4, 0.06, 0);
  g.add(skirt);
  // equipment pads
  g.add(box(3.0, 0.35, 2.8, M.concrete, PIVOT.x, 0.72, 0));          // samson post
  g.add(box(2.6, 0.25, 2.8, M.concrete, CRANK.x, 0.67, 0));          // gearbox
  g.add(box(2.0, 0.3, 1.4, M.concrete, 6.0, 0.7, 0.1));              // motor
  g.add(box(1.1, 0.2, 1.0, M.concrete, 7.7, 0.65, 1.2));             // cabinet
  g.add(box(2.6, 0.12, 1.3, M.concrete, -2.1, 0.61, 1.7));           // tank
  return g;
}

function buildSamsonPost(root, M) {
  const g = group('samsonPost', root);
  const y0 = 0.9, y1 = PIVOT.y - 0.55;
  const bx = 1.15, bz = 1.05, tx = 0.32, tz = 0.32;
  const feet = [], tops = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = new THREE.Vector3(PIVOT.x + sx * bx, y0, sz * bz);
    const b = new THREE.Vector3(PIVOT.x + sx * tx, y1, sz * tz);
    feet.push(a); tops.push(b);
    g.add(strut(a, b, 0.26, 0.26, M.steel));
    g.add(box(0.55, 0.06, 0.55, M.steelDark, a.x, y0 + 0.03, a.z)); // foot plate
    for (const ox of [-0.18, 0.18]) for (const oz of [-0.18, 0.18])
      g.add(bolt(M.steelDark, a.x + ox, y0 + 0.07, a.z + oz, 'y', 0.035));
  }
  const lerp = (a, b, t) => a.clone().lerp(b, t);
  // ladder rungs on the front & back faces, horizontal bracing on the sides
  for (const t of [0.18, 0.36, 0.54, 0.72]) {
    for (const [i, j] of [[0, 2], [1, 3]]) {          // x pairs at same z
      g.add(strut(lerp(feet[i], tops[i], t), lerp(feet[j], tops[j], t), 0.1, 0.1, M.steel));
    }
    for (const [i, j] of [[0, 1], [2, 3]]) {          // z pairs at same x
      g.add(strut(lerp(feet[i], tops[i], t), lerp(feet[j], tops[j], t), 0.1, 0.1, M.steel));
    }
  }
  // diagonal braces
  g.add(strut(lerp(feet[1], tops[1], 0.36), lerp(feet[3], tops[3], 0.72), 0.08, 0.08, M.steel));
  g.add(strut(lerp(feet[0], tops[0], 0.36), lerp(feet[2], tops[2], 0.72), 0.08, 0.08, M.steel));
  // top cap + saddle bearing housing
  g.add(box(0.95, 0.14, 0.95, M.steelDark, PIVOT.x, y1 + 0.07, 0));
  g.add(box(0.7, 0.3, 0.9, M.steel, PIVOT.x, y1 + 0.28, 0));
  for (const sz of [-1, 1]) {
    g.add(cyl(0.32, 0.22, M.steelDark, 'z', PIVOT.x, PIVOT.y, sz * 0.42));
    g.add(cyl(0.14, 0.26, M.chrome, 'z', PIVOT.x, PIVOT.y, sz * 0.45));
    g.add(box(0.5, 0.35, 0.18, M.steel, PIVOT.x, PIVOT.y - 0.3, sz * 0.42));
  }
  return g;
}

function horseheadShape() {
  // Local coords around the pivot: arc on the left, tapered tail on the right.
  const s = new THREE.Shape();
  const a0 = Math.PI - 0.42, a1 = Math.PI + 0.34;
  s.moveTo(HEAD_R * Math.cos(a0), HEAD_R * Math.sin(a0));
  s.absarc(0, 0, HEAD_R, a0, a1, false);
  s.lineTo(-HEAD_R + 1.05, -1.25);
  s.lineTo(-HEAD_R + 1.55, BEAM_Y - 0.35);
  s.lineTo(-HEAD_R + 1.55, BEAM_Y + 0.35);
  s.lineTo(-HEAD_R + 1.25, HEAD_R * Math.sin(a0) - 0.05);
  s.closePath();
  return { shape: s, a0, a1 };
}

function buildWalkingBeam(root, M) {
  // `pivot` rotates; everything below it is in beam space (origin = bearing).
  const pivot = group('walkingBeamPivot', root);
  pivot.position.copy(PIVOT);

  const beam = group('walkingBeam', pivot);
  const x0 = -HEAD_R + 1.4, x1 = REAR_R + 0.35;
  // I-beam: web + flanges
  beam.add(box(x1 - x0, 0.6, 0.18, M.steel, (x0 + x1) / 2, BEAM_Y, 0));
  beam.add(box(x1 - x0, 0.08, 0.5, M.steel, (x0 + x1) / 2, BEAM_Y + 0.3, 0));
  beam.add(box(x1 - x0, 0.08, 0.5, M.steel, (x0 + x1) / 2, BEAM_Y - 0.3, 0));
  // splice plate over the bearing + rivets
  for (const sz of [-1, 1]) {
    beam.add(box(1.0, 0.64, 0.04, M.steelDark, 0, BEAM_Y, sz * 0.26));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
      beam.add(bolt(M.steelDark, -0.35 + i * 0.35, BEAM_Y - 0.17 + j * 0.34, sz * 0.29));
  }
  // centre bearing saddle on the beam underside
  beam.add(box(0.8, 0.3, 0.7, M.steelDark, 0, 0.05, 0));
  beam.add(cyl(0.24, 1.1, M.steel, 'z', 0, 0, 0));
  // rear knuckle where the equalizer hangs
  beam.add(box(0.7, 0.75, 0.55, M.steel, REAR_R, BEAM_Y - 0.05, 0));
  for (const sz of [-1, 1]) beam.add(cyl(0.2, 0.06, M.steelDark, 'z', REAR_R + 0.05, BEAM_Y, sz * 0.3));

  // Horsehead
  const head = group('horsehead', pivot);
  const { shape, a0, a1 } = horseheadShape();
  const headGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.5, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 36,
  });
  headGeo.translate(0, 0, -0.25);
  head.add(mesh(headGeo, M.steel));
  // curved wear band on the face (where the bridle wraps)
  const band = mesh(arcBand(HEAD_R + 0.05, a0, a1, 0.66, 0.08), M.rust);
  head.add(band);
  // rivet rows on both side plates
  for (const sz of [-1, 1]) {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (a1 - a0) * (k / 6);
      head.add(bolt(M.steelDark, (HEAD_R - 0.25) * Math.cos(a), (HEAD_R - 0.25) * Math.sin(a), sz * 0.3));
    }
    head.add(bolt(M.steelDark, -HEAD_R + 1.3, BEAM_Y + 0.15, sz * 0.3));
    head.add(bolt(M.steelDark, -HEAD_R + 1.3, BEAM_Y - 0.15, sz * 0.3));
  }

  // Equalizer: cross-bar on the beam tail carrying both pitman arms
  const eq = group('equalizer', pivot);
  eq.position.set(REAR_R, BEAM_Y - 0.15, 0);
  eq.add(box(0.45, 0.4, 2.15, M.steel, 0, -0.25, 0));
  for (const sz of [-1, 1]) {
    eq.add(cyl(0.2, 0.25, M.steelDark, 'z', 0, -0.35, sz * 1.0));
    eq.add(cyl(0.1, 0.3, M.chrome, 'z', 0, -0.35, sz * 1.08));
  }
  return { pivot, beam, head, eq, a0, a1 };
}

// Thin curved plate following the horsehead arc (XY plane, thickness along Z).
function arcBand(r, a0, a1, width, thick) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, a0, a1, false);
  s.absarc(0, 0, r - thick, a1, a0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 48 });
  g.translate(0, 0, -width / 2);
  return g;
}

function buildBridle(root, M) {
  // Hanger cables + carrier bar + polished rod. Animated in world space.
  const g = group('bridle', root);
  const cables = [];
  for (const sz of [-0.12, 0.12]) {
    const c = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8), M.cable);
    c.position.z = sz;
    g.add(c); cables.push(c);
  }
  const carrier = group('carrierBar', g);
  carrier.add(box(0.2, 0.22, 0.5, M.steelDark, 0, 0, 0));
  carrier.add(box(0.12, 0.35, 0.14, M.steel, 0, -0.25, 0));
  carrier.add(cyl(0.08, 0.15, M.steelDark, 'y', 0, -0.5, 0));
  const rod = cyl(0.045, 3.6, M.chrome, 'y', 0, -2.3, 0, 12);
  carrier.add(rod);
  return { g, cables, carrier };
}

function buildWellhead(root, M) {
  const g = group('wellhead', root);
  const x = WELL_X, z = 0;
  let y = 0.55;
  const stack = [
    [0.36, 0.14, M.steelDark], [0.22, 0.4, M.steel], [0.34, 0.12, M.steelDark],
    [0.26, 0.35, M.steel], [0.34, 0.12, M.steelDark], [0.18, 0.5, M.steel],
    [0.28, 0.1, M.steelDark], [0.14, 0.45, M.steel], [0.24, 0.12, M.steelDark],
    [0.1, 0.3, M.steel], [0.15, 0.1, M.steelDark],                    // stuffing box
  ];
  for (const [r, h, m] of stack) {
    g.add(cyl(r, h, m, 'y', x, y + h / 2, z));
    if (m === M.steelDark) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.add(cyl(0.03, h + 0.04, M.steelDark, 'y', x + Math.cos(a) * (r - 0.05), y + h / 2, z + Math.sin(a) * (r - 0.05), 6));
    }
    y += h;
  }
  g.userData.top = y;
  // casing outlet (bottom) -> tank, and tubing tee (top) -> tank
  g.add(cyl(0.08, 0.5, M.steel, 'x', x + 0.35, 0.95, z));
  g.add(cyl(0.12, 0.08, M.steelDark, 'x', x - 0.28, 0.95, z));
  g.add(cyl(0.06, 0.3, M.steel, 'x', x - 0.42, 0.95, z));
  return g;
}

function buildFlowline(root, M) {
  const g = group('flowline', root);
  const tee = new THREE.Vector3(WELL_X, 2.15, 0);
  const pts = [
    tee, new THREE.Vector3(WELL_X + 0.15, 2.15, 0),
    new THREE.Vector3(WELL_X + 0.15, 2.15, 0.4), new THREE.Vector3(-2.15, 2.15, 0.4),
    new THREE.Vector3(-2.15, 2.15, 1.7), new THREE.Vector3(-2.15, 1.7, 1.7),
  ];
  for (let i = 0; i < pts.length - 1; i++) g.add(pipe(pts[i], pts[i + 1], 0.07, M.steel));
  for (let i = 1; i < pts.length - 1; i++) g.add(mesh(new THREE.SphereGeometry(0.1, 12, 8), M.steelDark, pts[i].x, pts[i].y, pts[i].z));
  // lower line: casing outlet -> tank end
  const lo = [new THREE.Vector3(WELL_X + 0.6, 0.95, 0), new THREE.Vector3(WELL_X + 0.6, 0.95, 1.7), new THREE.Vector3(-3.15, 0.95, 1.7)];
  for (let i = 0; i < lo.length - 1; i++) g.add(pipe(lo[i], lo[i + 1], 0.07, M.steel));
  g.add(mesh(new THREE.SphereGeometry(0.1, 12, 8), M.steelDark, lo[1].x, lo[1].y, lo[1].z));
  return g;
}

function buildTank(root, M) {
  const g = group('separatorTank', root);
  const x = -2.1, y = 1.15, z = 1.7, L = 1.8, r = 0.48;
  g.add(cyl(r, L, M.steel, 'x', x, y, z, 32));
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.steel, x + s * L / 2, y, z);
    cap.rotation.z = -s * Math.PI / 2;
    g.add(cap);
    g.add(cyl(r + 0.02, 0.05, M.steelDark, 'x', x + s * (L / 2 - 0.05), y, z, 32)); // weld seam
    // saddles
    g.add(box(0.14, 0.45, 0.8, M.steelDark, x + s * 0.55, 0.85, z));
    g.add(box(0.4, 0.06, 0.9, M.steelDark, x + s * 0.55, 0.69, z));
  }
  g.add(cyl(0.11, 0.18, M.steelDark, 'y', x, y + r + 0.05, z)); // top nozzle
  return g;
}

function crankDisc(M, holeAngle) {
  // Round counterweight disc with two lightening holes.
  const s = new THREE.Shape();
  s.absarc(0, 0, 1.25, 0, Math.PI * 2, false);
  for (const [rr, a, hr] of [[0.75, holeAngle, 0.13], [0.55, holeAngle + Math.PI * 0.85, 0.11]]) {
    const h = new THREE.Path();
    h.absarc(rr * Math.cos(a), rr * Math.sin(a), hr, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.28, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2, curveSegments: 40,
  });
  geo.translate(0, 0, -0.14);
  return geo;
}

function buildGearbox(root, M) {
  const g = group('gearbox', root);
  const x = CRANK.x;
  // pedestal / skid
  g.add(box(2.1, 0.35, 1.5, M.steelDark, x, 0.97, 0));
  g.add(box(1.5, 0.75, 0.9, M.steel, x, 1.5, 0));
  // reducer housing: rounded body
  const body = cyl(0.85, 0.9, M.steel, 'z', x, 2.0, 0, 32);
  g.add(body);
  g.add(box(1.7, 0.6, 0.9, M.steel, x, 1.6, 0));
  for (const sz of [-1, 1]) {
    g.add(cyl(0.88, 0.05, M.steelDark, 'z', x, 2.0, sz * 0.45, 32));
    g.add(cyl(0.3, 0.2, M.steelDark, 'z', x, CRANK.y, sz * 0.55));
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      g.add(bolt(M.steelDark, x + Math.cos(a) * 0.75, 2.0 + Math.sin(a) * 0.75, sz * 0.48));
    }
  }
  // input shaft towards the motor
  g.add(cyl(0.1, 0.9, M.chrome, 'x', x + 1.1, 1.55, 0.25));
  return g;
}

function buildCranks(root, M) {
  // Two crank assemblies (one per side), each two discs on the output shaft.
  const cranks = [];
  for (const sz of [-1, 1]) {
    const c = group(sz < 0 ? 'crankLeft' : 'crankRight', root);
    c.position.set(CRANK.x, CRANK.y, sz * 0.72);
    const discs = new THREE.Group();
    discs.name = 'discs';
    c.add(discs);
    discs.add(mesh(crankDisc(M, 0.6), M.rust, 0, 0, 0));
    discs.add(mesh(crankDisc(M, 0.6), M.rust, 0, 0, sz * 0.36));
    discs.add(cyl(0.28, 0.75, M.steelDark, 'z', 0, 0, sz * 0.18));        // hub
    discs.add(cyl(0.16, 0.25, M.chrome, 'z', CRANK_R, 0, sz * 0.62));      // crank pin
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      discs.add(bolt(M.steelDark, Math.cos(a) * 0.4, Math.sin(a) * 0.4, sz * 0.52));
    }
    cranks.push({ group: c, discs, sz });
  }
  return cranks;
}

function buildPitmans(root, M) {
  const arms = [];
  for (const sz of [-1, 1]) {
    const a = group(sz < 0 ? 'pitmanLeft' : 'pitmanRight', root);
    // Built along +Y from the crank pin (origin) to the equalizer (y = L).
    a.add(box(0.26, PITMAN_L - 0.3, 0.16, M.steel, 0, PITMAN_L / 2, 0));
    a.add(cyl(0.22, 0.24, M.steelDark, 'z', 0, 0, 0));
    a.add(cyl(0.2, 0.24, M.steelDark, 'z', 0, PITMAN_L, 0));
    a.add(cyl(0.09, 0.3, M.chrome, 'z', 0, PITMAN_L, 0));
    arms.push({ group: a, sz });
  }
  return arms;
}

function buildMotor(root, M) {
  const g = group('motor', root);
  const x = 5.9, y = 1.35, z = 0.1;
  // belt guard / drive housing (the boxy unit next to the cranks)
  g.add(box(1.0, 1.05, 1.15, M.steel, x - 0.35, y + 0.05, z));
  g.add(box(0.06, 0.6, 0.6, M.steelDark, x - 0.35, y + 0.1, z + 0.6));
  g.add(box(1.1, 0.1, 1.25, M.steelDark, x - 0.35, y + 0.62, z));
  for (let i = 0; i < 4; i++) g.add(box(0.04, 0.9, 0.05, M.steelDark, x - 0.8 + i * 0.3, y, z + 0.59));
  // ribbed motor can
  g.add(cyl(0.42, 0.9, M.steel, 'x', x + 0.6, y + 0.05, z, 28));
  for (let i = 0; i < 6; i++) g.add(cyl(0.45, 0.04, M.steelDark, 'x', x + 0.25 + i * 0.14, y + 0.05, z, 28));
  g.add(cyl(0.38, 0.12, M.steelDark, 'x', x + 1.1, y + 0.05, z, 28));
  const fan = group('motorFan', g);
  fan.position.set(x + 1.17, y + 0.05, z);
  fan.add(cyl(0.1, 0.04, M.chrome, 'x', 0, 0, 0, 12));
  for (let k = 0; k < 4; k++) {
    const blade = box(0.02, 0.3, 0.07, M.steelDark, 0, 0, 0);
    blade.rotation.x = (k / 4) * Math.PI * 2;
    blade.position.set(0, 0.15 * Math.cos(blade.rotation.x), 0.15 * Math.sin(blade.rotation.x));
    fan.add(blade);
  }
  g.add(box(1.4, 0.15, 0.8, M.steelDark, x + 0.3, 0.88, z)); // motor skid
  // conduit to cabinet
  g.add(pipe(new THREE.Vector3(x + 0.6, y + 0.48, z), new THREE.Vector3(x + 0.6, y + 0.48, 1.2), 0.04, M.steelDark));
  g.add(pipe(new THREE.Vector3(x + 0.6, y + 0.48, 1.2), new THREE.Vector3(7.4, y + 0.48, 1.2), 0.04, M.steelDark));
  return { g, fan };
}

function buildCabinet(root, M) {
  const g = group('controlCabinet', root);
  const x = 7.75, z = 1.2;
  g.add(box(0.75, 1.45, 0.65, M.steel, x, 0.75 + 0.725, z));
  g.add(box(0.82, 0.05, 0.72, M.steelDark, x, 2.22, z));          // rain lid
  g.add(box(0.02, 1.25, 0.55, M.steelDark, x - 0.38, 1.47, z));   // door
  g.add(box(0.04, 0.12, 0.03, M.chrome, x - 0.4, 1.47, z + 0.2)); // handle
  for (let i = 0; i < 4; i++) g.add(box(0.02, 0.03, 0.25, M.steelDark, x - 0.395, 1.85 + i * 0.06, z - 0.05)); // louvres
  return g;
}

// ---------------------------------------------------------------- effects

class Smoke {
  constructor(parent, map) {
    this.parent = parent;
    this.map = map;
    this.items = [];
    this.acc = 0;
  }
  emit(pos, { color = 0x333333, size = 1, life = 2.5, vel = new THREE.Vector3(0, 1.4, 0), spread = 0.4, opacity = 0.6, additive = false } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: this.map, color, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.parent.add(s);
    this.items.push({
      s, life, age: 0, size, opacity,
      vel: vel.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread, (Math.random() - 0.5) * spread)),
    });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.parent.remove(p.s);
        p.s.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      p.s.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - 0.6 * dt);
      p.s.scale.setScalar(p.size * (1 + t * 2.5));
      p.s.material.opacity = p.opacity * (1 - t);
    }
  }
  clear() {
    for (const p of this.items) { this.parent.remove(p.s); p.s.material.dispose(); }
    this.items.length = 0;
  }
}

// ---------------------------------------------------------------- main

export function createPumpjack({ scale = 1, speed = 1, phase = Math.random() * Math.PI * 2 } = {}) {
  const M = shared();
  const object = new THREE.Group();
  object.name = 'Pumpjack';
  object.scale.setScalar(scale);

  let root, parts, rig, bridle, cranks, pitmans, motor, debris, fx;
  const state = { theta: phase, speed, health: 1, destroyed: false, smokeAcc: 0, fireLight: null, stutter: 0 };
  const kin = { pin: new THREE.Vector3(), eq: new THREE.Vector3(), phi: 0 };
  const rest = solveBeam(Math.PI / 2, { pin: new THREE.Vector3(), eq: new THREE.Vector3(), phi: 0 }).phi;

  function build() {
    root = group('rig', object);
    parts = {};
    parts.base = buildBase(root, M);
    parts.samsonPost = buildSamsonPost(root, M);
    rig = buildWalkingBeam(root, M);
    parts.walkingBeam = rig.beam;
    parts.horsehead = rig.head;
    parts.equalizer = rig.eq;
    bridle = buildBridle(root, M);
    parts.bridle = bridle.g;
    parts.wellhead = buildWellhead(root, M);
    parts.flowline = buildFlowline(root, M);
    parts.separatorTank = buildTank(root, M);
    parts.gearbox = buildGearbox(root, M);
    cranks = buildCranks(root, M);
    parts.crankLeft = cranks[0].group;
    parts.crankRight = cranks[1].group;
    pitmans = buildPitmans(root, M);
    parts.pitmanLeft = pitmans[0].group;
    parts.pitmanRight = pitmans[1].group;
    motor = buildMotor(root, M);
    parts.motor = motor.g;
    parts.controlCabinet = buildCabinet(root, M);
    for (const [k, g] of Object.entries(parts)) g.userData.part = k;
    debris = [];
    fx = new Smoke(object, M.smokeMap);
    pose(state.theta);
  }

  const attached = (name) => parts[name] && !parts[name].userData.detached;

  function pose(theta) {
    solveBeam(theta, kin);
    if (attached('walkingBeam')) rig.pivot.rotation.z = kin.phi;

    for (const c of cranks) if (attached(c.group.name)) c.discs.rotation.z = theta;

    // pitman arms: from crank pin to equalizer pin (world-ish rig space)
    const eqPin = new THREE.Vector3(REAR_R, BEAM_Y - 0.5, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rig.pivot.rotation.z).add(PIVOT);
    for (const p of pitmans) {
      if (!attached(p.group.name)) continue;
      const crankAlive = attached(p.sz < 0 ? 'crankLeft' : 'crankRight');
      const pin = crankAlive ? kin.pin : new THREE.Vector3(CRANK.x + CRANK_R, CRANK.y, 0);
      p.group.position.set(pin.x, pin.y, p.sz * 1.34);
      const dir = new THREE.Vector3(eqPin.x - pin.x, eqPin.y - pin.y, 0);
      p.group.rotation.set(0, 0, Math.atan2(dir.y, dir.x) - Math.PI / 2);
      p.group.scale.y = dir.length() / PITMAN_L;
    }

    // bridle: unwraps off the horsehead arc; tangent point stays at x = WELL_X
    if (attached('bridle')) {
      const phi = rig.pivot.rotation.z;
      const headAttached = attached('horsehead');
      const tangentY = PIVOT.y + (headAttached ? 0 : -0.5);
      const carrierY = 3.35 - HEAD_R * (phi - rest);
      bridle.carrier.position.set(WELL_X - 0.02, carrierY, 0);
      for (const c of bridle.cables) {
        const len = Math.max(0.05, tangentY - carrierY);
        c.scale.y = len;
        c.position.set(WELL_X - 0.02, carrierY + len / 2, c.position.z);
      }
    }
  }

  // ---- destruction -------------------------------------------------------

  function charMaterials(g) {
    g.traverse((o) => {
      if (!o.isMesh || o.userData.charred) return;
      o.material = o.material.clone();
      o.material.color.multiplyScalar(0.5);
      o.material.roughness = 0.95;
      o.userData.charred = true;
    });
  }

  function detach(name, impulse = 1, origin = null) {
    const g = parts[name];
    if (!g || g.userData.detached || name === 'base') return;
    g.userData.detached = true;
    // flatten into rig space so it keeps its current pose
    root.attach(g);
    if (name === 'walkingBeam') {           // beam takes horsehead + equalizer with it
      for (const n of ['horsehead', 'equalizer']) if (!parts[n].userData.detached) {
        parts[n].userData.detached = true;
        g.attach(parts[n]);
      }
    }
    const box3 = new THREE.Box3().setFromObject(g);
    const c = box3.getCenter(new THREE.Vector3());
    object.worldToLocal(c);
    const o = origin || new THREE.Vector3(2, 0.5, 0);
    const dir = c.clone().sub(o).setY(0).normalize();
    const vel = dir.multiplyScalar((2 + Math.random() * 3) * impulse);
    vel.y = (3 + Math.random() * 4) * impulse;
    charMaterials(g);
    debris.push({
      g, vel,
      ang: new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4).multiplyScalar(impulse),
      resting: false,
      smoke: Math.random() < 0.5 ? 3 + Math.random() * 4 : 0,
    });
  }

  const box3 = new THREE.Box3();
  const GROUND = 0;
  function stepDebris(dt) {
    for (const d of debris) {
      if (d.resting) continue;
      d.vel.y -= 9.8 * dt;
      d.g.position.addScaledVector(d.vel, dt);
      d.g.rotation.x += d.ang.x * dt;
      d.g.rotation.y += d.ang.y * dt;
      d.g.rotation.z += d.ang.z * dt;
      box3.setFromObject(d.g);
      const minY = box3.min.y / (object.scale.y || 1) - object.position.y;
      const floor = GROUND + (Math.abs(d.g.position.x - 1.4) < 7 && Math.abs(d.g.position.z) < 3.8 ? 0.55 : 0);
      if (minY < floor) {
        d.g.position.y += floor - minY;
        if (Math.abs(d.vel.y) < 1.2) {
          d.vel.set(0, 0, 0); d.ang.set(0, 0, 0); d.resting = true;
        } else {
          d.vel.y *= -0.3;
          d.vel.x *= 0.5; d.vel.z *= 0.5;
          d.ang.multiplyScalar(0.5);
        }
      }
    }
  }

  function explode(origin) {
    for (let i = 0; i < 18; i++) {
      fx.emit(origin, { color: 0xffa040, size: 2.2, life: 0.6, vel: new THREE.Vector3(0, 2, 0), spread: 8, opacity: 0.9, additive: true });
    }
    for (let i = 0; i < 26; i++) {
      fx.emit(origin, { color: 0x222222, size: 2.5, life: 3.5, vel: new THREE.Vector3(0, 3, 0), spread: 5, opacity: 0.7 });
    }
    if (!state.fireLight) {
      state.fireLight = new THREE.PointLight(0xff7a2a, 60, 20, 2);
      object.add(state.fireLight);
    }
    state.fireLight.position.copy(origin);
    state.fireLight.intensity = 120;
  }

  // ---- public API --------------------------------------------------------

  const api = {
    object,
    get parts() { return parts; },
    get health() { return state.health; },
    get destroyed() { return state.destroyed; },
    speed: speed,

    update(dt) {
      dt = Math.min(dt, 0.05);
      const working = !state.destroyed && attached('walkingBeam') && attached('gearbox') &&
        attached('motor') && (attached('pitmanLeft') || attached('pitmanRight'));
      if (working) {
        let w = 1.2 * api.speed;                       // rad/s, ~11 strokes/min
        if (state.health < 0.3) {                       // sputtering
          state.stutter += dt;
          w *= 0.35 + 0.65 * Math.max(0, Math.sin(state.stutter * 2.3)) ** 2;
        }
        state.theta -= w * dt;
        pose(state.theta);
        if (motor && attached('motor')) motor.fan.rotation.x += 30 * api.speed * dt;
      }
      // damage smoke
      state.smokeAcc += dt;
      const rate = state.destroyed ? 0.08 : state.health < 0.3 ? 0.12 : state.health < 0.6 ? 0.3 : Infinity;
      if (state.smokeAcc > rate) {
        state.smokeAcc = 0;
        const at = state.destroyed ? new THREE.Vector3(CRANK.x + (Math.random() - 0.5) * 3, 1.5, (Math.random() - 0.5) * 2)
          : new THREE.Vector3(CRANK.x, 3.2, 0);
        fx.emit(at, { color: state.health < 0.3 || state.destroyed ? 0x1c1c1c : 0x666666, size: 1.2, life: 3 });
        if (state.destroyed && Math.random() < 0.5) {
          fx.emit(at, { color: 0xff6a1a, size: 0.9, life: 0.5, vel: new THREE.Vector3(0, 2, 0), spread: 0.6, opacity: 0.8, additive: true });
        }
      }
      for (const d of debris) {
        if (d.smoke > 0) {
          d.smoke -= dt;
          if (Math.random() < 0.3) fx.emit(d.g.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(object.matrixWorld).invert()),
            { color: 0x2a2a2a, size: 0.7, life: 1.6, vel: new THREE.Vector3(0, 1, 0), spread: 0.3, opacity: 0.5 });
        }
      }
      if (state.fireLight) {
        state.fireLight.intensity = state.destroyed
          ? Math.max(8, state.fireLight.intensity * (1 - 2 * dt)) * (0.85 + Math.random() * 0.3)
          : 0;
      }
      stepDebris(dt);
      fx.update(dt);
    },

    // 1 = intact, 0 = destroyed. Part losses scale with damage.
    setHealth(h) {
      if (state.destroyed) return;
      state.health = THREE.MathUtils.clamp(h, 0, 1);
      if (state.health <= 0) return api.destroy();
      if (state.health < 0.25) { api.breakPart('controlCabinet', 0.5); api.breakPart('flowline', 0.4); }
      if (state.health < 0.15) api.breakPart('separatorTank', 0.6);
    },

    damage(amount) { api.setHealth(state.health - amount); },

    breakPart(name, impulse = 0.7) {
      if (state.destroyed || !parts[name] || parts[name].userData.detached) return;
      const c = new THREE.Box3().setFromObject(parts[name]).getCenter(new THREE.Vector3());
      object.worldToLocal(c);
      fx.emit(c, { color: 0xffa040, size: 1.6, life: 0.4, spread: 3, opacity: 0.9, additive: true });
      for (let i = 0; i < 6; i++) fx.emit(c, { color: 0x2a2a2a, size: 1.4, life: 2, spread: 2 });
      detach(name, impulse, c.clone().add(new THREE.Vector3(0, -1, 0)));
    },

    destroy(origin = new THREE.Vector3(CRANK.x - 0.8, 1.2, 0.3)) {
      if (state.destroyed) return;
      state.destroyed = true;
      state.health = 0;
      explode(origin);
      // order matters: the beam assembly leaves the post, then the rest
      for (const n of Object.keys(parts)) detach(n, n === 'samsonPost' ? 0.35 : n === 'gearbox' ? 0.45 : 1, origin);
      charMaterials(parts.base);
    },

    reset() {
      fx.clear();
      object.remove(root);
      root.traverse((o) => { if (o.isMesh && o.userData.charred) o.material.dispose(); });
      if (state.fireLight) { object.remove(state.fireLight); state.fireLight.dispose?.(); state.fireLight = null; }
      state.destroyed = false;
      state.health = 1;
      state.stutter = 0;
      build();
    },

    // Static parted snapshot for export (no FX), each part as a named node.
    exportRoot() { return root; },
  };

  build();
  return api;
}

export const PUMPJACK_PARTS = [
  'base', 'samsonPost', 'walkingBeam', 'horsehead', 'equalizer', 'bridle', 'wellhead',
  'flowline', 'separatorTank', 'gearbox', 'crankLeft', 'crankRight', 'pitmanLeft',
  'pitmanRight', 'motor', 'controlCabinet',
];
