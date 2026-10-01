import * as THREE from 'three';

// Woodcutter camp built entirely from separate meshes so every piece can be
// knocked off, animated or swapped. Units are metres, Y up, camp centred near origin.
export const FLOOR = 0.3;                 // top of the concrete slab
export const SLAB = { x0: -10, x1: 12, z0: -7, z1: 10 };
const EAVE = FLOOR + 4.6;
const RIDGE = FLOOR + 7.0;
const SLOPE = (RIDGE - EAVE) / 5;         // rise per metre on the main gable
const THETA = Math.atan(SLOPE);
const roofY = (z) => RIDGE - Math.abs(z) * SLOPE;

export const LINE_X = -1;                 // saw line centre
export const SAW_Z = 0.7;
export const DECK_Y = FLOOR + 1.0;        // infeed / outfeed working height
export const ROLLER_R = 0.07;
export const BOARD = { w: 0.22, h: 0.1, len: 3.6, pitch: 0.235, sticker: 0.04 };

function rand(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// World-scale UVs on a BoxGeometry so textures keep a constant size on any part.
function boxUV(geo, [w, h, d], mat, mode, rng) {
  const { tu = 1, tv = 1 } = mat.userData;
  const uv = geo.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const ou = rng(), ov = rng();
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    const swap = mode === 'swap' || (mode === 'auto' && su > sv);
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = uv.getX(k), v = uv.getY(k);
      if (swap) uv.setXY(k, ou + (v * sv) / tu, ov + (u * su) / tv);
      else uv.setXY(k, ou + (u * su) / tu, ov + (v * sv) / tv);
    }
  }
}

export function buildCamp(M) {
  const rng = rand(1337);
  const R = (a, b) => a + (b - a) * rng();
  const root = new THREE.Group();
  root.name = 'WoodcutterCamp';
  const parts = [];

  const group = (name, parent = root) => {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  };
  const reg = (mesh, name, category, destructible = true) => {
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.category = category;
    mesh.userData.destructible = destructible;
    parts.push(mesh);
    return mesh;
  };
  const box = (parent, name, cat, size, mat, pos, rot = [0, 0, 0], uvMode) => {
    const geo = new THREE.BoxGeometry(...size);
    boxUV(geo, size, mat, uvMode ?? mat.userData.uv ?? 'none', rng);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    parent.add(m);
    return reg(m, name, cat);
  };
  const cyl = (parent, name, cat, rTop, rBot, h, seg, mat, pos, rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    parent.add(m);
    return reg(m, name, cat);
  };

  // ---------------------------------------------------------------- Foundation
  const fnd = group('Foundation');
  {
    const nx = 8, nz = 8;
    const tw = (SLAB.x1 - SLAB.x0) / nx, td = (SLAB.z1 - SLAB.z0) / nz;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const m = box(fnd, `slab_${i}_${j}`, 'foundation', [tw - 0.03, FLOOR, td - 0.03], M.concrete,
          [SLAB.x0 + tw * (i + 0.5), FLOOR / 2, SLAB.z0 + td * (j + 0.5)]);
        m.userData.destructible = false;
        m.castShadow = false;
      }
  }

  // ---------------------------------------------------------------- Workshop (closed room)
  const shop = group('Workshop');
  const conc = group('ConcreteWall', shop);
  const siding = group('Siding', shop);
  const partition = group('Partition', shop);
  const trim = group('Trim', shop);
  const win = group('Window', shop);
  {
    const T = 0.25, H = 2.2;
    let n = 0;
    for (const x of [-6.75, -4.25]) {
      box(conc, `concrete_front_${n}`, 'concrete', [2.48, H, T], M.concrete, [x, FLOOR + H / 2, 5 - T / 2]);
      box(conc, `concrete_back_${n++}`, 'concrete', [2.48, H, T], M.concrete, [x, FLOOR + H / 2, -5 + T / 2]);
    }
    [-3.75, -1.25, 1.25, 3.75].forEach((z, i) =>
      box(conc, `concrete_side_${i}`, 'concrete', [T, H, 2.48], M.concrete, [-8 + T / 2, FLOOR + H / 2, z]));

    // Vertical green siding boards above the concrete, one mesh per board.
    const y0 = FLOOR + H, BW = 0.3, STEP = 0.31, TH = 0.07;
    const WIN = { x0: -6.3, x1: -4.0, y0: FLOOR + 2.55, y1: FLOOR + 3.95 };
    const vBoard = (name, x, z, ya, yb, alongZ = false) => {
      const h = yb - ya;
      const size = alongZ ? [TH, h, BW] : [BW, h, TH];
      return box(siding, name, 'siding', size, M.greenSiding, [x, ya + h / 2, z]);
    };
    n = 0;
    for (let x = -8 + BW / 2; x < -3; x += STEP) {
      if (x > WIN.x0 && x < WIN.x1) {
        vBoard(`siding_front_${n}_low`, x, 5 - TH / 2, y0, WIN.y0);
        vBoard(`siding_front_${n++}_high`, x, 5 - TH / 2, WIN.y1, EAVE);
      } else vBoard(`siding_front_${n++}`, x, 5 - TH / 2, y0, EAVE);
    }
    n = 0;
    for (let x = -8 + BW / 2; x < -3; x += STEP) vBoard(`siding_back_${n++}`, x, -5 + TH / 2, y0, EAVE);
    n = 0;
    for (let z = -5 + BW / 2; z < 5; z += STEP)
      vBoard(`siding_gable_${n++}`, -8 + TH / 2, z, y0, roofY(Math.abs(z) + BW / 2) - 0.02, true);

    // Interior partition facing the open bay (dark weathered boards, full height).
    n = 0;
    for (let z = -5 + BW / 2; z < 5; z += STEP) {
      const top = roofY(Math.abs(z) + BW / 2) - 0.02;
      box(partition, `partition_board_${n++}`, 'planks', [TH, top - FLOOR, BW], M.darkWood,
        [-3 - 0.2, FLOOR + (top - FLOOR) / 2, z]);
    }

    // Trim over the concrete line.
    box(trim, 'trim_front', 'trim', [5.1, 0.18, 0.1], M.darkWood, [-5.5, y0, 5.04]);
    box(trim, 'trim_back', 'trim', [5.1, 0.18, 0.1], M.darkWood, [-5.5, y0, -5.04]);
    box(trim, 'trim_side', 'trim', [0.1, 0.18, 10.1], M.darkWood, [-8.04, y0, 0]);
    box(trim, 'trim_front_eave', 'trim', [5.1, 0.2, 0.1], M.darkWood, [-5.5, EAVE - 0.1, 5.06]);
    box(trim, 'trim_back_eave', 'trim', [5.1, 0.2, 0.1], M.darkWood, [-5.5, EAVE - 0.1, -5.06]);

    // Window: frame, mullions and individual panes.
    const wz = 5 - 0.03, wcx = (WIN.x0 + WIN.x1) / 2, wcy = (WIN.y0 + WIN.y1) / 2;
    const ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0;
    box(win, 'window_sill', 'window', [ww + 0.2, 0.1, 0.18], M.darkWood, [wcx, WIN.y0, wz]);
    box(win, 'window_head', 'window', [ww + 0.2, 0.1, 0.14], M.darkWood, [wcx, WIN.y1, wz]);
    box(win, 'window_jamb_l', 'window', [0.1, wh, 0.14], M.darkWood, [WIN.x0, wcy, wz]);
    box(win, 'window_jamb_r', 'window', [0.1, wh, 0.14], M.darkWood, [WIN.x1, wcy, wz]);
    const cols = 4, rows = 2;
    for (let i = 1; i < cols; i++)
      box(win, `window_mullion_${i}`, 'window', [0.05, wh, 0.08], M.darkWood, [WIN.x0 + (ww * i) / cols, wcy, wz]);
    box(win, 'window_transom', 'window', [ww, 0.05, 0.08], M.darkWood, [wcx, wcy, wz]);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        box(win, `window_pane_${i}_${j}`, 'window', [ww / cols - 0.06, wh / rows - 0.06, 0.02], M.glass,
          [WIN.x0 + (ww * (i + 0.5)) / cols, WIN.y0 + (wh * (j + 0.5)) / rows, wz]).castShadow = false;
  }

  // ---------------------------------------------------------------- Timber frame
  const frame = group('Frame');
  {
    const ph = EAVE - FLOOR;
    const posts = group('Posts', frame);
    const footings = group('Footings', frame);
    for (const z of [4.85, -4.85])
      for (const x of [-3, 1, 5]) {
        const tag = `${z > 0 ? 'front' : 'back'}_${x}`;
        box(posts, `post_${tag}`, 'frame', [0.3, ph, 0.3], M.darkWood, [x, FLOOR + ph / 2, z]);
        if (x !== -3) box(footings, `footing_${tag}`, 'concrete', [0.6, 0.7, 0.6], M.concrete, [x, FLOOR + 0.35, z]);
      }

    const beams = group('Beams', frame);
    const segs = [[-8.3, -3], [-3, 1], [1, 5.2]];
    for (const z of [4.85, -4.85])
      segs.forEach(([a, b], i) =>
        box(beams, `beam_${z > 0 ? 'front' : 'back'}_${i}`, 'frame', [b - a, 0.3, 0.26], M.darkWood,
          [(a + b) / 2, EAVE - 0.15, z]));
    for (const x of [-3, 1, 5])
      box(beams, `tie_beam_${x}`, 'frame', [0.24, 0.28, 9.7], M.darkWood, [x, EAVE - 0.14, 0]);
    for (let i = 0; i < 5; i++) {
      const a = -8.4 + i * 2.76;
      box(beams, `ridge_beam_${i}`, 'frame', [2.76, 0.3, 0.24], M.darkWood, [a + 1.38, RIDGE - 0.2, 0]);
    }

    // Knee braces (post -> beam), in the plane of each wall line.
    const braces = group('Braces', frame);
    const bl = Math.hypot(1.1, 1.0), ba = Math.atan2(1.0, 1.1);
    let n = 0;
    for (const z of [4.85, -4.85])
      for (const [x, dir] of [[-3, 1], [1, -1], [1, 1], [5, -1]])
        box(braces, `brace_${n++}`, 'frame', [bl, 0.16, 0.16], M.darkWood,
          [x + dir * 0.55, EAVE - 0.3 - 0.5, z], [0, 0, dir * ba]);
    // King posts & struts over the tie beams.
    for (const x of [1, 5]) {
      const kh = RIDGE - EAVE;
      box(braces, `king_post_${x}`, 'frame', [0.2, kh, 0.2], M.darkWood, [x, EAVE + kh / 2 - 0.2, 0]);
      for (const s of [1, -1]) {
        const len = Math.hypot(2.5, kh * 0.5);
        box(braces, `strut_${x}_${s > 0 ? 'f' : 'b'}`, 'frame', [0.15, 0.15, len], M.darkWood,
          [x, EAVE + kh * 0.25, s * 1.25], [s * Math.atan2(kh * 0.5, 2.5), 0, 0]);
      }
    }

    const rafters = group('Rafters', frame);
    const rl = 5.6 / Math.cos(THETA);
    for (const x of [-8.2, -6, -3, -1, 1, 3, 5.2])
      for (const s of [1, -1])
        box(rafters, `rafter_${x}_${s > 0 ? 'f' : 'b'}`, 'frame', [0.14, 0.22, rl], M.darkWood,
          [x, roofY(2.8) - 0.04, s * 2.8], [s * THETA, 0, 0]);
  }

  // ---------------------------------------------------------------- Main roof (individual sheets)
  const roof = group('Roof');
  {
    const sl = 5.6 / Math.cos(THETA) + 0.1;
    let n = 0;
    for (let i = 0; i < 12; i++) {
      const x = -8.4 + 0.6 + i * 1.2;
      for (const s of [1, -1])
        box(roof, `roof_sheet_${n++}`, 'roof', [1.18, 0.04, sl], M.corrugated,
          [x, roofY(2.8) + 0.1, s * 2.8], [s * THETA, 0, 0]);
    }
    for (let i = 0; i < 6; i++)
      box(roof, `ridge_cap_${i}`, 'roof', [2.4, 0.06, 0.6], M.rust, [-8.4 + 1.2 + i * 2.4, RIDGE + 0.14, 0]);
    // Raised skylight vents.
    [-2.2, 0.4].forEach((x, i) => {
      box(roof, `roof_vent_${i}`, 'roof', [2.4, 0.18, 1.3], M.steel, [x, roofY(1.3) + 0.24, 1.3], [THETA, 0, 0]);
      box(roof, `roof_vent_glass_${i}`, 'roof', [2.2, 0.04, 1.1], M.glass, [x, roofY(1.3) + 0.34, 1.3], [THETA, 0, 0]);
    });
    // Barge boards at the gable ends.
    for (const x of [-8.45, 5.45])
      for (const s of [1, -1])
        box(roof, `barge_${x}_${s > 0 ? 'f' : 'b'}`, 'roof', [0.08, 0.26, sl], M.darkWood,
          [x, roofY(2.8) + 0.05, s * 2.8], [s * THETA, 0, 0]);
  }

  // ---------------------------------------------------------------- Lean-to lumber shed
  const lean = group('LeanTo');
  {
    const hi = EAVE - 0.1, lo = FLOOR + 3.7, run = 5.8;
    const phi = Math.atan((hi - lo) / run);
    const cx = 5.2 + run / 2, cy = (hi + lo) / 2;
    const lf = group('Frame', lean);
    for (const z of [-4.6, 0, 4.6]) {
      box(lf, `lt_post_${z}`, 'frame', [0.28, lo - FLOOR, 0.28], M.darkWood, [10.6, FLOOR + (lo - FLOOR) / 2, z]);
      box(lf, `lt_footing_${z}`, 'concrete', [0.55, 0.6, 0.55], M.concrete, [10.6, FLOOR + 0.3, z]);
      box(lf, `lt_rafter_${z}`, 'frame', [run / Math.cos(phi) + 0.4, 0.22, 0.14], M.darkWood,
        [cx + 0.1, cy - 0.1, z], [0, 0, -phi]);
      box(lf, `lt_brace_${z}`, 'frame', [1.3, 0.14, 0.14], M.darkWood, [10.15, lo - 0.65, z], [0, 0, -Math.PI / 4]);
    }
    box(lf, 'lt_beam_0', 'frame', [0.26, 0.28, 4.8], M.darkWood, [10.6, lo - 0.1, -2.3]);
    box(lf, 'lt_beam_1', 'frame', [0.26, 0.28, 4.8], M.darkWood, [10.6, lo - 0.1, 2.3]);
    const lr = group('Roof', lean);
    for (let i = 0; i < 9; i++)
      box(lr, `lt_roof_sheet_${i}`, 'roof', [run / Math.cos(phi) + 0.6, 0.04, 1.18], M.corrugated,
        [cx + 0.2, cy + 0.06, -5.4 + 0.6 + i * 1.2], [0, 0, -phi], 'swap');
  }

  // ---------------------------------------------------------------- Saw line
  const mill = group('Sawmill');
  const refs = { rollers: [] };
  {
    const inf = group('Infeed', mill);
    for (const z of [-4, -2.1, -0.2])
      for (const s of [-1, 1])
        box(inf, `infeed_leg_${z}_${s}`, 'machine', [0.12, DECK_Y - FLOOR, 0.12], M.greenMetal,
          [LINE_X + s * 0.55, FLOOR + (DECK_Y - FLOOR) / 2, z]);
    for (const s of [-1, 1])
      box(inf, `infeed_rail_${s}`, 'machine', [0.12, 0.2, 4.3], M.greenMetal, [LINE_X + s * 0.6, DECK_Y - 0.05, -2.1]);
    for (let i = 0; i < 9; i++)
      box(inf, `infeed_slat_${i}`, 'machine', [1.1, 0.06, 0.18], M.darkWood, [LINE_X, DECK_Y - 0.03, -4 + i * 0.48]);

    const saw = group('Saw', mill);
    box(saw, 'saw_table', 'machine', [1.5, 0.12, 1.1], M.greenMetal, [LINE_X, DECK_Y - 0.06, SAW_Z]);
    for (const z of [SAW_Z - 0.45, SAW_Z + 0.45])
      for (const s of [-1, 1])
        box(saw, `saw_leg_${z.toFixed(2)}_${s}`, 'machine', [0.14, DECK_Y - FLOOR, 0.14], M.greenMetal,
          [LINE_X + s * 0.65, FLOOR + (DECK_Y - FLOOR) / 2, z]);
    box(saw, 'saw_motor', 'machine', [0.7, 0.6, 0.7], M.greenMetal, [LINE_X + 1.15, FLOOR + 0.5, SAW_Z]);
    box(saw, 'saw_motor_base', 'machine', [0.9, 0.12, 0.9], M.rust, [LINE_X + 1.15, FLOOR + 0.06, SAW_Z]);
    cyl(saw, 'saw_arbor', 'machine', 0.06, 0.06, 1.2, 12, M.steel, [LINE_X + 0.55, DECK_Y - 0.2, SAW_Z], [0, 0, Math.PI / 2]);
    box(saw, 'saw_belt_guard', 'machine', [0.12, 0.9, 0.35], M.rust, [LINE_X + 1.05, FLOOR + 0.85, SAW_Z]);

    // Toothed circular blade, spins about X.
    const shape = new THREE.Shape();
    const teeth = 36, r0 = 0.82, r1 = 0.9;
    for (let i = 0; i <= teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.6) / teeth) * Math.PI * 2;
      if (i === 0) shape.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
      else shape.lineTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
      if (i < teeth) shape.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.07, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
    bg.translate(0, 0, -0.0125);
    bg.rotateY(Math.PI / 2);
    const blade = reg(new THREE.Mesh(bg, M.steel), 'saw_blade', 'machine');
    blade.position.set(LINE_X, DECK_Y + 0.2, SAW_Z);
    saw.add(blade);
    refs.blade = blade;

    const out = group('Outfeed', mill);
    for (const z of [1.5, 3.4, 5.2])
      for (const s of [-1, 1])
        box(out, `outfeed_leg_${z}_${s}`, 'machine', [0.12, DECK_Y - FLOOR, 0.12], M.greenMetal,
          [LINE_X + s * 0.55, FLOOR + (DECK_Y - FLOOR) / 2, z]);
    for (const s of [-1, 1])
      box(out, `outfeed_rail_${s}`, 'machine', [0.1, 0.2, 4.2], M.greenMetal, [LINE_X + s * 0.56, DECK_Y - 0.04, 3.35]);
    for (let i = 0; i < 13; i++) {
      const r = cyl(out, `roller_${i}`, 'machine', ROLLER_R, ROLLER_R, 1.0, 12, M.steel,
        [LINE_X, DECK_Y, 1.4 + i * 0.32], [0, 0, Math.PI / 2]);
      refs.rollers.push(r);
    }

    // Hanging work lamp.
    const lamp = group('Lamp', mill);
    cyl(lamp, 'lamp_cord', 'trim', 0.01, 0.01, 0.9, 4, M.steel, [2.6, EAVE - 0.6, 0]);
    cyl(lamp, 'lamp_shade', 'trim', 0.08, 0.32, 0.22, 16, M.steel, [2.6, EAVE - 1.15, 0]);
    const bulb = reg(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), M.bulb), 'lamp_bulb', 'trim');
    bulb.position.set(2.6, EAVE - 1.27, 0);
    lamp.add(bulb);
    refs.bulb = bulb;
  }

  // ---------------------------------------------------------------- Log yard (each log separate)
  const yard = group('LogYard');
  const logs = group('Logs', yard);
  refs.logs = [];
  {
    const rack = group('Rack', yard);
    let n = 0;
    for (const x of [-8.8, -6, -3.2])
      for (const z of [6.0, 8.95])
        box(rack, `rack_post_${n++}`, 'rack', [0.26, 1.9, 0.26], M.darkWood, [x, FLOOR + 0.95, z]);
    n = 0;
    for (const z of [6.0, 8.95])
      for (const y of [0.6, 1.4])
        for (const [a, b] of [[-8.8, -6], [-6, -3.2]])
          box(rack, `rack_rail_${n++}`, 'rack', [b - a, 0.14, 0.12], M.darkWood, [(a + b) / 2, FLOOR + y, z]);
    for (const x of [-8.2, -6, -3.8])
      box(rack, `rack_sleeper_${x}`, 'rack', [0.26, 0.25, 3.0], M.darkWood, [x, FLOOR + 0.125, 7.475]);

    const LOG_LEN = 4.4;
    const spots = [];
    for (const z of [6.62, 7.47, 8.32]) spots.push([z, 0]);
    for (const z of [7.045, 7.895]) spots.push([z, 1]);
    spots.push([7.47, 2]);
    spots.forEach(([z, row], i) => {
      const r = R(0.39, 0.42);
      const g = new THREE.CylinderGeometry(r, r * 1.03, LOG_LEN + R(-0.2, 0.2), 20, 1);
      const uv = g.attributes.uv;
      for (let k = 0; k < 42; k++) uv.setXY(k, (uv.getX(k) * Math.PI * 2 * r) / 1.2, (uv.getY(k) * LOG_LEN) / 1.2);
      g.rotateZ(Math.PI / 2);
      const end = rng() < 0.3 ? M.endDark : M.endLight;
      const m = new THREE.Mesh(g, [M.bark, end, end]);
      m.position.set(-6 + R(-0.15, 0.15), FLOOR + 0.25 + 0.41 + row * 0.7, z);
      m.rotation.x = R(0, Math.PI * 2);
      logs.add(m);
      reg(m, `log_${i}`, 'log');
      m.userData.radius = r;
      refs.logs.push(m);
    });
  }

  // ---------------------------------------------------------------- Lumber stacks (each board separate)
  const lumber = group('LumberYard');
  refs.stacks = [];
  {
    const cx = 7.85;
    [[-2.4, 6], [2.4, 5]].forEach(([zc, layers], s) => {
      const st = group(`Stack_${s}`, lumber);
      const pal = group('Pallet', st);
      for (const x of [cx - 1.15, cx, cx + 1.15])
        box(pal, `runner_${x.toFixed(1)}`, 'lumber', [0.16, 0.12, 3.8], M.darkWood, [x, FLOOR + 0.06, zc]);
      for (let i = 0; i < 8; i++)
        box(pal, `deck_${i}`, 'lumber', [2.6, 0.04, 0.16], M.darkWood, [cx, FLOOR + 0.14, zc - 1.75 + i * 0.5]);
      const boards = group('Boards', st);
      const base = FLOOR + 0.16;
      const layerH = BOARD.h + BOARD.sticker;
      for (let L = 0; L < layers; L++) {
        for (let i = 0; i < 10; i++)
          box(boards, `board_${L}_${i}`, 'board', [BOARD.w, BOARD.h, BOARD.len + R(-0.04, 0.04)], M.lightWood,
            [cx + (i - 4.5) * BOARD.pitch, base + L * layerH + BOARD.h / 2, zc + R(-0.03, 0.03)]);
        for (const dz of [-1.5, 0, 1.5])
          box(boards, `sticker_${L}_${dz}`, 'board', [2.45, BOARD.sticker, 0.06], M.lightWood,
            [cx, base + L * layerH + BOARD.h + BOARD.sticker / 2, zc + dz]);
      }
      refs.stacks.push({ group: boards, cx, zc, base, layers, layerH });
    });
  }

  // ---------------------------------------------------------------- Dust collector
  const dust = group('DustCollector');
  {
    const x = -6, z = -6.1;
    for (const dx of [-0.85, 0.85])
      for (const dz of [-0.85, 0.85])
        box(dust, `dc_leg_${dx}_${dz}`, 'dust', [0.14, 3.7, 0.14], M.steel, [x + dx, FLOOR + 1.85, z + dz]);
    box(dust, 'dc_cross_0', 'dust', [1.84, 0.1, 0.1], M.steel, [x, FLOOR + 1.6, z - 0.85]);
    box(dust, 'dc_cross_1', 'dust', [1.84, 0.1, 0.1], M.steel, [x, FLOOR + 1.6, z + 0.85]);
    cyl(dust, 'dc_hopper', 'dust', 1.41, 0.3, 1.2, 4, M.steel, [x, FLOOR + 3.6, z], [0, Math.PI / 4, 0]);
    box(dust, 'dc_body', 'dust', [2, 2.8, 2], M.steel, [x, FLOOR + 5.6, z]);
    box(dust, 'dc_band', 'dust', [2.06, 0.12, 2.06], M.rust, [x, FLOOR + 6.2, z]);
    cyl(dust, 'dc_cap', 'dust', 0.5, 1.4, 0.6, 8, M.steel, [x, FLOOR + 7.3, z], [0, Math.PI / 8, 0]);
    cyl(dust, 'dc_stack', 'dust', 0.25, 0.25, 0.6, 12, M.steel, [x, FLOOR + 7.9, z]);
    cyl(dust, 'dc_stack_hat', 'dust', 0.05, 0.45, 0.25, 8, M.steel, [x, FLOOR + 8.35, z]);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x - 1.0, FLOOR + 6.4, z),
      new THREE.Vector3(x - 1.6, FLOOR + 6.6, z + 0.1),
      new THREE.Vector3(x - 1.9, FLOOR + 6.0, z + 0.9),
      new THREE.Vector3(x - 1.4, roofY(4) + 0.6, -4.2),
      new THREE.Vector3(x - 1.2, roofY(3.6) - 0.6, -3.6),
    ]);
    const pipe = reg(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.28, 14), M.steel), 'dc_pipe', 'dust');
    dust.add(pipe);
    cyl(dust, 'dc_pipe_flange', 'dust', 0.36, 0.36, 0.08, 14, M.rust, [x - 1.0, FLOOR + 6.4, z], [0, 0, Math.PI / 2]);
  }

  // ---------------------------------------------------------------- Sawdust decals
  const decals = group('Decals');
  [[LINE_X, 0.6, 3.2], [LINE_X + 1.2, -1.5, 2.6], [LINE_X - 0.8, 3.0, 2.8], [3, 1.5, 3], [-4.5, 7.5, 3]].forEach(
    ([x, z, s], i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.8), M.sawdustDecal);
      m.rotation.set(-Math.PI / 2, 0, R(0, Math.PI));
      m.position.set(x, FLOOR + 0.005, z);
      decals.add(m);
      reg(m, `sawdust_${i}`, 'decal', false).castShadow = false;
    });

  // Remember every part's rest transform so damage can be undone.
  // (kept outside userData so GLTF export doesn't serialise parent references)
  const homes = new Map();
  for (const p of parts)
    homes.set(p, { parent: p.parent, position: p.position.clone(), quaternion: p.quaternion.clone(), scale: p.scale.clone() });

  return { root, parts, refs, homes };
}
