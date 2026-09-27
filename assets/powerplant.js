// =====================================================================================
// Power plant asset (procedural, three.js r128): main turbine hall, two cooling towers,
// two banded chimneys, pipework, turbine/generator, transformers, AC units, safety railings,
// steam and smoke. Footprint ~40 x 40 units, origin at ground centre, +Z is the front.
//
//   const plant = PowerPlant.build({ accent: 0x2f6fd6 });   // accent = stripe / door colour
//   scene.add(plant.group);  ...  plant.update(dt, camera);  // animates steam and smoke
// =====================================================================================
(function () {
'use strict';
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
const r = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
}
// weathered concrete / metal cladding with panel seams and grime
function panelTex(base, seam, cols, rows) {
  return canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = `rgba(${v < .5 ? '40,40,40' : '255,255,255'},${r() * 0.05})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
    for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H; const gr = g.createLinearGradient(x, y, x, y + 60 + r() * 120); gr.addColorStop(0, 'rgba(60,55,50,.12)'); gr.addColorStop(1, 'rgba(60,55,50,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 6, 180); }
    g.strokeStyle = seam; g.lineWidth = 2;
    for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * W / cols, 0); g.lineTo(i * W / cols, H); g.stroke(); }
    for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, j * H / rows); g.lineTo(W, j * H / rows); g.stroke(); }
    g.fillStyle = 'rgba(70,70,70,.35)'; for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) g.fillRect(i * W / cols - 3, j * H / rows - 3, 3, 3);
  });
}
function louverTex() { return canvasTex(128, 256, (g, W, H) => { g.fillStyle = '#2a2e33'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 10) { const gr = g.createLinearGradient(0, y, 0, y + 10); gr.addColorStop(0, '#5b6168'); gr.addColorStop(0.5, '#3a3f45'); gr.addColorStop(1, '#16191c'); g.fillStyle = gr; g.fillRect(4, y + 1, W - 8, 8); }
  g.strokeStyle = '#8a9096'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4); }); }
function grilleTex() { return canvasTex(256, 128, (g, W, H) => { g.fillStyle = '#23272b'; g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 8) { g.fillStyle = '#4a5057'; g.fillRect(x, 4, 4, H - 8); } g.strokeStyle = '#8c939a'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6); }); }
function hazardTex() { return canvasTex(128, 32, (g, W, H) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, W, H); g.fillStyle = '#1b1b1b';
  for (let x = -H; x < W; x += 24) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 12, H); g.lineTo(x + 12 + H, 0); g.lineTo(x + H, 0); g.fill(); } }); }
function boltTex(accentCss) { return canvasTex(256, 256, (g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = accentCss;
  g.beginPath(); g.moveTo(150, 10); g.lineTo(70, 140); g.lineTo(120, 140); g.lineTo(90, 246); g.lineTo(190, 100); g.lineTo(138, 100); g.lineTo(180, 10); g.closePath(); g.fill(); }); }
function stripeTex(c1, c2, n) { return canvasTex(64, 256, (g, W, H) => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? c2 : c1; g.fillRect(0, i * H / n, W, H / n); }
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(30,20,15,${r() * 0.12})`; g.fillRect(r() * W, r() * H, 2, 2); } }); }
function softTex() { return canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }); }

function build(opts = {}) {
  const accent = opts.accent !== undefined ? opts.accent : 0x2f6fd6;
  const accentCss = '#' + new THREE.Color(accent).getHexString();
  const group = new THREE.Group(); group.name = 'PowerPlant';
  const M = {
    concrete: new THREE.MeshStandardMaterial({ map: panelTex('#c9c9c4', 'rgba(90,90,90,.55)', 6, 6), roughness: .9 }),
    cladding: new THREE.MeshStandardMaterial({ map: panelTex('#d6d7d4', 'rgba(80,80,80,.6)', 4, 8), roughness: .75, metalness: .1 }),
    darkConcrete: new THREE.MeshStandardMaterial({ map: panelTex('#8d8e8a', 'rgba(40,40,40,.6)', 4, 2), roughness: .95 }),
    tower: new THREE.MeshStandardMaterial({ map: panelTex('#b8b9b4', 'rgba(70,70,70,.45)', 24, 10), roughness: .95, side: THREE.DoubleSide }),
    towerIn: new THREE.MeshStandardMaterial({ color: lin(0x5c5e5c), roughness: 1, side: THREE.BackSide }),
    metal: new THREE.MeshStandardMaterial({ color: lin(0xa9aeb3), metalness: .7, roughness: .35 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: lin(0x4b5057), metalness: .6, roughness: .45 }),
    accent: new THREE.MeshStandardMaterial({ color: lin(accent), roughness: .6, metalness: .1 }),
    yellow: new THREE.MeshStandardMaterial({ color: lin(0xf2c230), roughness: .5, metalness: .2 }),
    louver: new THREE.MeshStandardMaterial({ map: louverTex(), roughness: .6, metalness: .3 }),
    grille: new THREE.MeshStandardMaterial({ map: grilleTex(), roughness: .6, metalness: .4 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: .7 }),
    chimney: new THREE.MeshStandardMaterial({ map: stripeTex('#b8b9b4', '#b8b9b4', 1), roughness: .9 }),
    bands: new THREE.MeshStandardMaterial({ map: stripeTex('#9f3a24', '#e3e1dc', 5), roughness: .8 }),
    bolt: new THREE.MeshBasicMaterial({ map: boltTex(accentCss), transparent: true, depthWrite: false }),
    lamp: new THREE.MeshStandardMaterial({ color: lin(0xffe0a0), emissive: lin(0xffc060), emissiveIntensity: 1.5 }),
  };
  const add = (geo, mat, x, y, z, parent = group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, parent);

  // ---- railings: posts + two rails along a polyline (closed when the ends meet)
  function railing(pts, y, h = 1.1, parent = group) {
    const postG = new THREE.CylinderGeometry(0.06, 0.06, h, 5);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.6)), ang = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k <= n; k++) add(postG, M.yellow, ax + (bx - ax) * k / n, y + h / 2, az + (bz - az) * k / n, parent);
      for (const hh of [h, h * 0.55]) { const rail = add(new THREE.BoxGeometry(0.08, 0.08, L), M.yellow, (ax + bx) / 2, y + hh, (az + bz) / 2, parent); rail.rotation.y = ang; }
    }
  }
  const ringRail = (cx, cz, rad, y, parent = group) => { const pts = []; for (let i = 0; i <= 20; i++) pts.push([cx + Math.cos(i / 20 * 6.283) * rad, cz + Math.sin(i / 20 * 6.283) * rad]); railing(pts, y, 1.1, parent); };

  // ---- plinth (stepped concrete base) with perimeter railing
  box(42, 0.8, 42, M.darkConcrete, 0, 0, 0);
  box(40, 0.9, 40, M.concrete, 0, 0.8, 0);
  const TOP = 1.7;
  railing([[-19.6, 19.6], [19.6, 19.6], [19.6, -19.6], [-19.6, -19.6], [-19.6, 19.6]], TOP);
  // accent band around the plinth
  for (const [x, z, w, d] of [[0, 20.02, 40, .05], [0, -20.02, 40, .05], [20.02, 0, .05, 40], [-20.02, 0, .05, 40]]) box(w, .35, d, M.accent, x, 1.0, z);

  // ---- main turbine hall (front-left)
  const hall = new THREE.Group(); group.add(hall); hall.position.set(-5, TOP, 5);
  box(17, 12, 19, M.cladding, 0, 0, 0, hall);
  box(17.4, 1.2, 19.4, M.darkConcrete, 0, 0, 0, hall);                       // skirting
  box(17.3, 1.1, 19.3, M.accent, 0, 9.4, 0, hall);                             // blue band
  box(17.6, 0.5, 19.6, M.darkMetal, 0, 12, 0, hall);                           // eave trim
  // roof: raised clerestory with grilles
  box(12, 2.2, 15, M.cladding, 0, 12.5, -0.5, hall);
  box(12.4, .5, 15.4, M.darkMetal, 0, 14.7, -0.5, hall);
  for (let i = 0; i < 3; i++) { const g = box(3.2, .25, 11, M.grille, -4 + i * 4, 14.9, -0.5, hall); }
  for (let i = 0; i < 4; i++) box(2.6, .3, 1.8, M.grille, -6 + (i % 2) * 12, 12.1, -7 + Math.floor(i / 2) * 14, hall);
  // front facade (+z): louvers, lightning bolt, door with canopy and hazard stripes, lamps
  const front = 9.52;
  for (const x of [-6.2, 6.2]) { const lv = add(new THREE.PlaneGeometry(2.2, 7.5), M.louver, x, 5.2, front, hall); }
  add(new THREE.PlaneGeometry(6.5, 3.2), M.louver, 0, 7.6, front, hall).scale.set(1, 1, 1);
  const bolt = add(new THREE.PlaneGeometry(4.2, 4.2), M.bolt, 0, 7.6, front + .02, hall);
  box(9, 5.2, 1.6, M.cladding, 0, 0, front + .6, hall);                          // entrance block
  box(9.4, .35, 2.4, M.darkMetal, 0, 5.2, front + .9, hall);                     // canopy
  add(new THREE.PlaneGeometry(3.4, 4), M.accent, 0, 2.1, front + 1.42, hall);    // blue double door
  box(.08, 4, .1, M.darkMetal, 0, 0.1, front + 1.44, hall);
  for (const x of [-3.3, 3.3]) { add(new THREE.PlaneGeometry(1.1, 3.2), M.hazard, x, 1.6, front + 1.42, hall).rotation.z = Math.PI / 2; box(.4, .3, .3, M.lamp, x, 4.4, front + 1.5, hall); }
  // side facade (+x): louvers + blue panels
  for (let i = 0; i < 3; i++) { const lv = add(new THREE.PlaneGeometry(2.4, 6.5), M.louver, 8.52, 4.6, -5 + i * 5, hall); lv.rotation.y = Math.PI / 2; }
  // corner pilasters
  for (const [x, z] of [[-8.6, 9.6], [8.6, 9.6], [-8.6, -9.6], [8.6, -9.6]]) box(1, 12.4, 1, M.darkConcrete, x, 0, z, hall);

  // ---- annex with rooftop AC units (left)
  const ann = new THREE.Group(); group.add(ann); ann.position.set(-16, TOP, 4);
  box(6.5, 6, 14, M.cladding, 0, 0, 0, ann); box(6.7, .8, 14.2, M.accent, 0, 3.6, 0, ann); box(6.9, .35, 14.4, M.darkMetal, 0, 6, 0, ann);
  const fanG = new THREE.CircleGeometry(.9, 16);
  for (let i = 0; i < 4; i++) { const u = box(2.6, 2, 2.6, M.metal, -1.4 + (i % 2) * 2.8, 6.3, -3.5 + Math.floor(i / 2) * 3, ann);
    const f = add(fanG, M.grille, -1.4 + (i % 2) * 2.8, 8.32, -3.5 + Math.floor(i / 2) * 3, ann); f.rotation.x = -Math.PI / 2; }
  railing([[-3.2, -7], [3.2, -7], [3.2, 7], [-3.2, 7], [-3.2, -7]], 6.35, 1, ann);

  // ---- chimneys (back-left): banded tops, platforms, ladders
  function chimney(x, z, H) {
    const c = new THREE.Group(); group.add(c); c.position.set(x, TOP, z);
    add(new THREE.CylinderGeometry(1.35, 1.7, H * 0.62, 20, 1), M.chimney, 0, H * 0.31, 0, c);
    add(new THREE.CylinderGeometry(1.3, 1.35, H * 0.38, 20, 1, true), M.bands, 0, H * 0.62 + H * 0.19, 0, c);
    add(new THREE.CylinderGeometry(1.45, 1.45, .6, 20, 1, true), M.darkMetal, 0, H - .3, 0, c);
    add(new THREE.CylinderGeometry(1.05, 1.05, .2, 20), new THREE.MeshBasicMaterial({ color: 0x151515 }), 0, H - .05, 0, c);
    for (const hy of [H * 0.55, H * 0.82]) { add(new THREE.CylinderGeometry(2.4, 2.4, .25, 20), M.darkMetal, 0, hy, 0, c); ringRail(0, 0, 2.3, hy + .12, c); }
    box(.5, H * 0.95, .12, M.yellow, 0, 0, 1.75, c);
    box(2.8, 1.8, 2.8, M.darkConcrete, 0, 0, 0, c);
    return c;
  }
  chimney(-15, -12, 30); chimney(-8.5, -15.5, 34);

  // ---- cooling towers (back-right): hyperboloid shells on lattice legs, accent band
  function coolingTower(x, z, H, R0, Rt, Rtop) {
    const t = new THREE.Group(); group.add(t); t.position.set(x, TOP, z);
    const pts = [], pin = [], th = H * 0.72, legH = 2.4;
    for (let i = 0; i <= 24; i++) { const y = legH + (H - legH) * i / 24; const u = (y - (legH + th * 0.9)) / (y < legH + th * 0.9 ? th * 0.9 : H - legH - th * 0.9);
      const rad = y < legH + th * 0.9 ? Rt + (R0 - Rt) * u * u : Rt + (Rtop - Rt) * u * u; pts.push(new THREE.Vector2(rad, y)); pin.push(new THREE.Vector2(rad - .35, y)); }
    add(new THREE.LatheGeometry(pts, 48), M.tower, 0, 0, 0, t);
    add(new THREE.LatheGeometry(pin, 48), M.towerIn, 0, 0, 0, t);
    const bandPts = pts.filter(p => p.y > H * 0.8 && p.y < H * 0.88).map(p => new THREE.Vector2(p.x + .06, p.y));
    if (bandPts.length > 1) add(new THREE.LatheGeometry(bandPts, 48), M.accent, 0, 0, 0, t);
    add(new THREE.TorusGeometry(Rtop, .25, 6, 48).rotateX(Math.PI / 2), M.darkConcrete, 0, H, 0, t);
    // lattice legs
    const legs = 24;
    for (let i = 0; i < legs; i++) { const a = i / legs * 6.283, a2 = (i + .5) / legs * 6.283;
      const leg = add(new THREE.BoxGeometry(.3, legH * 1.25, .3), M.darkMetal, Math.cos(a) * (R0 - .2), legH / 2, Math.sin(a) * (R0 - .2), t);
      leg.rotation.set(0, -a, 0); leg.rotateOnAxis(new THREE.Vector3(1, 0, 0), .45 * (i % 2 ? 1 : -1)); }
    add(new THREE.TorusGeometry(R0 + .3, .5, 6, 48).rotateX(Math.PI / 2), M.accent, 0, .4, 0, t);
    add(new THREE.CylinderGeometry(R0 + 1.6, R0 + 1.8, .7, 48), M.darkConcrete, 0, .35 - .7, 0, t);
    ringRail(0, 0, R0 + 1.4, .05, t);
    return { group: t, top: new THREE.Vector3(x, TOP + H, z), R: Rtop };
  }
  const towers = [coolingTower(3, -10, 25, 7.8, 5.2, 6.1), coolingTower(12.5, 0.5, 23, 7.2, 4.8, 5.6)];

  // ---- pipework between hall, towers and generator
  function pipe(points, rad = .55) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.05);
    add(new THREE.TubeGeometry(curve, points.length * 12, rad, 12, false), M.metal, 0, 0, 0);
    for (let i = 0; i <= 6; i++) { const p = curve.getPointAt(i / 6), tg = curve.getTangentAt(i / 6);
      const fl = add(new THREE.TorusGeometry(rad + .08, .12, 6, 14), M.darkMetal, p.x, p.y, p.z); fl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg); }
  }
  pipe([[1, 15.5, 1], [3, 15.5, -2], [3, 15.5, -5], [3, 12, -5.5]]);
  pipe([[3.5, 13.5, 6], [6.5, 13.5, 6], [9, 13.5, 4], [9, 9, 2.5]], .6);
  pipe([[3.7, 6, 9], [7, 6, 11], [9.5, 6, 11], [9.5, 3.2, 11]], .5);
  pipe([[-1, 15.2, -4.5], [-1, 17, -7], [0, 17, -10], [0.5, 12, -10]], .45);

  // ---- turbine / generator (front-right) with transformers
  const gen = new THREE.Group(); group.add(gen); gen.position.set(9.5, TOP, 13);
  box(14, .8, 7, M.darkConcrete, 0, 0, 0, gen);
  const body = add(new THREE.CylinderGeometry(2.8, 2.8, 8.5, 28), M.metal, -.5, 3.6, 0, gen); body.rotation.z = Math.PI / 2;
  for (let i = 0; i < 7; i++) { const rib = add(new THREE.TorusGeometry(2.85, .14, 6, 28), M.darkMetal, -4.2 + i * 1.25, 3.6, 0, gen); rib.rotation.y = Math.PI / 2; }
  const cone = add(new THREE.CylinderGeometry(1.2, 2.6, 2, 24), M.metal, 4.6, 3.6, 0, gen); cone.rotation.z = -Math.PI / 2;
  box(2.6, 3.2, 3.2, M.metal, -6, .8, 0, gen); box(2.2, 2.2, 2.4, M.darkMetal, 6.6, .8, 0, gen);
  railing([[-7, 3.6], [7, 3.6]], .8, 1, gen); railing([[-7, -3.6], [7, -3.6]], .8, 1, gen);
  for (const [x, z] of [[16.5, 7.5], [16.5, 12]]) { const tf = new THREE.Group(); group.add(tf); tf.position.set(x, TOP, z);
    box(3, 3.6, 3.4, M.cladding, 0, 0, 0, tf); for (let i = 0; i < 4; i++) box(.15, 3, 3, M.darkMetal, -1.6, .3, 0, tf).position.x = -1.55 - i * .001;
    const w = add(new THREE.PlaneGeometry(.8, .7), M.hazard, 0, 2.6, 1.72, tf); for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(.15, .2, 1.2, 8), M.darkMetal, -.8 + i * .8, 4.2, 0, tf); }
  // small service buildings and stairs
  box(5, 3.5, 4, M.cladding, 15.5, TOP, -14); box(5.2, .6, 4.2, M.accent, 15.5, TOP + 2.4, -14);
  box(3.5, 2.8, 3, M.metal, -16, TOP, 14.5);

  // ---- lamps on the plinth corners
  for (const [x, z] of [[-19, 19], [19, 19], [19, -19], [-19, -19]]) { add(new THREE.CylinderGeometry(.08, .1, 4.5, 6), M.darkMetal, x, TOP + 2.25, z); box(.5, .25, .5, M.lamp, x, TOP + 4.5, z); }

  // ---- steam (cooling towers) and smoke (chimneys): soft points drifting up and fading
  const soft = softTex(); soft.encoding = THREE.LinearEncoding;
  const N = 260, pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N), life = new Float32Array(N), vel = new Float32Array(N * 3), kind = new Uint8Array(N);
  const emitters = [...towers.map(t => ({ p: t.top, R: t.R * 0.7, steam: true })), { p: new THREE.Vector3(-15, TOP + 30, -12), R: .6 }, { p: new THREE.Vector3(-8.5, TOP + 34, -15.5), R: .6 }];
  const spawn = i => { const e = emitters[i % emitters.length], a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * e.R;
    pos.set([e.p.x + Math.cos(a) * rr, e.p.y, e.p.z + Math.sin(a) * rr], i * 3); vel.set([(Math.random() - .5) * .6 + .8, (e.steam ? 2.6 : 2.0) + Math.random(), (Math.random() - .5) * .6], i * 3);
    kind[i] = e.steam ? 1 : 0; life[i] = 0; };
  for (let i = 0; i < N; i++) { spawn(i); life[i] = Math.random(); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(col, 4)); pg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const pm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: soft }, scale: { value: 400 } }]),
    vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
      #include <fog_pars_vertex>
      void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_PointSize = size * scale / max(1., -mvPosition.z); gl_Position = projectionMatrix * mvPosition; vC = color;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; varying vec4 vC;
      #include <fog_pars_fragment>
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < .01) discard;
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <encodings_fragment>
      }` });
  const plume = new THREE.Points(pg, pm); plume.frustumCulled = false; group.add(plume);

  function update(dt, camera) {
    const wScale = group.getWorldScale(new THREE.Vector3()).x;
    if (camera) { const h = (camera.userData.viewH || innerHeight) * Math.min(devicePixelRatio, 2); pm.uniforms.scale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * wScale; }
    for (let i = 0; i < N; i++) {
      const LIFE = kind[i] ? 6 : 5; life[i] += dt / LIFE; if (life[i] >= 1) spawn(i);
      const u = life[i]; pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt * (1 - u * .6); pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = (kind[i] ? 5 : 2.2) + u * (kind[i] ? 14 : 7);
      const a = Math.min(1, u * 6) * (1 - u) * (kind[i] ? .55 : .5), c = kind[i] ? .92 : .42 + u * .2;
      col.set([c, c, c * (kind[i] ? 1.02 : 1), a], i * 4);
    }
    pg.attributes.position.needsUpdate = pg.attributes.color.needsUpdate = pg.attributes.size.needsUpdate = true;
  }
  update(0.001);
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, update, footprint: 42, height: 36 };
}
window.PowerPlant = { build };
})();
