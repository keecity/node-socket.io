(async function () {
'use strict';
var NET = { role: null, peer: null, room: null, lobby: null, code: null, rdown: false, seq: 0, ev: [], evSeq: 0, lastCmd: 0, lastEv: 0, snap: null, cmds: [], sent: 0 };
const $ = id => document.getElementById(id);
try {
// ====================================================================== scene (court from the PlayCanvas court page)
const app = new pc.Application($('scene'), { graphicsDeviceOptions: { antialias: true, alpha: false }, mouse: new pc.Mouse($('scene')), touch: new pc.TouchDevice($('scene')) });
window.app = app; app.setCanvasFillMode(pc.FILLMODE_NONE); app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(devicePixelRatio, 2);
app.maxDeltaTime = 1 / 20;                       // game logic and animation share one clamped clock
app.scene.ambientLight = new pc.Color(.35, .38, .43); app.scene.toneMapping = pc.TONEMAP_ACES;
const fitCanvas = () => app.resizeCanvas(document.body.clientWidth, document.body.clientHeight);   // the game lives in a phone-shaped column
window.addEventListener('resize', fitCanvas); fitCanvas();
const camera = new pc.Entity('Camera'); camera.addComponent('camera', { clearColor: new pc.Color(.0196, .0314, .051), farClip: 160, fov: 40 }); app.root.addChild(camera);
const light = new pc.Entity('Key'); light.addComponent('light', { type: 'directional', color: new pc.Color(1, .94, .84), intensity: 1.15, castShadows: true, shadowDistance: 45, shadowResolution: 2048, shadowBias: .15, normalOffsetBias: .025 }); light.setEulerAngles(52, 25, 0); app.root.addChild(light);
const fill = new pc.Entity('Fill'); fill.addComponent('light', { type: 'directional', color: new pc.Color(.73, .84, 1), intensity: .45 }); fill.setEulerAngles(65, 210, 0); app.root.addChild(fill);
function mat(name, color) { const m = new pc.StandardMaterial(); m.name = name; m.diffuse = new pc.Color(...color); m.metalness = 0; m.gloss = 20; m.update(); return m; }
function primitive(name, type, scale, pos, material) { const e = new pc.Entity(name); e.addComponent('render', { type, material, castShadows: true, receiveShadows: true }); e.setLocalScale(...scale); e.setPosition(...pos); app.root.addChild(e); return e; }
primitive('Court foundation', 'box', [30, .24, 16], [0, -.13, 0], mat('Navy court edge', [.025, .065, .10]));
primitive('Surround', 'box', [43, .12, 29], [0, -.34, 0], mat('Charcoal surround', [.07, .095, .12]));
function bytes(b64) { const a = atob(b64), b = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) b[i] = a.charCodeAt(i); return b; }
// assets load straight from the embedded bytes (no blob: URLs, so sandboxed previews with a strict CSP still work)
function asset(key, type, filename) {
  const a = new pc.Asset(filename, type, { url: filename, filename, contents: bytes(ASSETS[key]).buffer });
  return new Promise((res, rej) => { a.ready(() => res(a)); a.once('error', e => rej(new Error(filename + ': ' + e))); app.assets.add(a); app.assets.load(a); });
}
const [color, height, hoopAsset, playerAsset, tealAsset, hairAsset] = await Promise.all([
  asset('color', 'texture', 'court.jpg'), asset('height', 'texture', 'height.jpg'),
  asset('hoop', 'container', 'hoop.glb', 'model/gltf-binary'), asset('player', 'container', 'player.glb', 'model/gltf-binary'),
  asset('teal', 'texture', 'teal.jpg', 'image/jpeg'), asset('hair', 'container', 'hair.glb', 'model/gltf-binary')]);
const floorMat = mat('Maple', [1, 1, 1]); floorMat.diffuseMap = color.resource; floorMat.bumpMap = height.resource; floorMat.bumpiness = .035; floorMat.gloss = 42; floorMat.update();
const floor = primitive('Court', 'plane', [30, 1, 16], [0, 0, 0], floorMat); floor.render.castShadows = false;
const HOOPS = [];
for (const side of [-1, 1]) {
  const root = new pc.Entity(side < 0 ? 'West hoop' : 'East hoop'); app.root.addChild(root);
  const model = hoopAsset.resource.instantiateRenderEntity(); root.addChild(model); model.setLocalScale(4.88, 4.88, 4.88);
  root.setEulerAngles(0, side < 0 ? 90 : -90, 0); root.setPosition(side * 14.80, .012, 0);
  app.root.syncHierarchy();
  const M = model.getWorldTransform();
  HOOPS.push({ side, rim: M.transformPoint(new pc.Vec3(0.006, 0.625, 0.43)), board: M.transformPoint(new pc.Vec3(0, 0.70, 0.352)) });
  splitHoop(model, HOOPS[HOOPS.length - 1]);
}
// The hoop model is one mesh. Split its triangles into rim+net (always solid), backboard glass (always see-through)
// and the stand (fades when play is near the camera-side basket), so the hoop never hides the players.
function splitHoop(model, H) {
  H.fade = []; H.op = 1;
  for (const r of model.findComponents('render')) {
    const mis = r.meshInstances.slice(), keep = [];
    for (const mi of mis) {
      const mesh = mi.mesh, pos = [], nrm = [], uv = [], idx = [];
      mesh.getPositions(pos); mesh.getNormals(nrm); mesh.getUvs(0, uv); mesh.getIndices(idx);
      const W = mi.node.getWorldTransform(), v = new pc.Vec3(), w = new pc.Vec3();
      const n = new pc.Vec3(H.rim.x - H.board.x, 0, H.rim.z - H.board.z).normalize(), perp = new pc.Vec3(-n.z, 0, n.x);
      const cls = [];
      for (let i = 0; i < pos.length / 3; i++) {
        W.transformPoint(v.set(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]), w);
        const dx = w.x - H.rim.x, dz = w.z - H.rim.z, hr = Math.hypot(dx, dz);
        const bx = w.x - H.board.x, bz = w.z - H.board.z, along = bx * n.x + bz * n.z, lat = bx * perp.x + bz * perp.z;
        cls.push(hr < 0.34 && w.y > H.rim.y - 0.55 && w.y < H.rim.y + 0.08 ? 0 : Math.abs(along) < 0.09 && Math.abs(lat) < 1.0 && w.y > H.rim.y - 0.2 ? 1 : 2);
      }
      const groups = [[], [], []];
      for (let t = 0; t < idx.length; t += 3) { const c = Math.min(cls[idx[t]], cls[idx[t + 1]], cls[idx[t + 2]]); groups[c].push(idx[t], idx[t + 1], idx[t + 2]); }
      groups.forEach((ix, c) => {
        if (!ix.length) return;
        const m = new pc.Mesh(app.graphicsDevice); m.setPositions(pos); m.setNormals(nrm); if (uv.length) m.setUvs(0, uv); m.setIndices(ix); m.update();
        const mat = mi.material.clone();
        if (c > 0) { mat.blendType = pc.BLEND_NORMAL; mat.depthWrite = c === 2; mat.opacity = c === 1 ? 0.28 : 1; }
        mat.update(); const nm = new pc.MeshInstance(m, mat, mi.node); nm.castShadow = mi.castShadow;
        keep.push(nm); if (c === 2) H.fade.push(mat);
      });
    }
    r.meshInstances = keep;
  }
}
function fadeHoops(dt) {   // the basket on the camera's side turns see-through while players are near it
  const side = HUMAN === 1 ? -1 : 1;
  for (const H of HOOPS) {
    const near = camMode === 'arena' && Math.sign(H.rim.x) === -side && P.some(p => Math.abs(p.pos.x - H.rim.x) < 7.5);
    const want = near ? 0.25 : 1; if (Math.abs(H.op - want) < 0.01) continue;
    H.op += (want - H.op) * Math.min(1, dt * 6);
    for (const m of H.fade) { m.opacity = H.op; m.depthWrite = H.op > 0.95; m.update(); }
  }
}
// HOOPS[0] = west, HOOPS[1] = east. Purple (team 0) attacks east, Teal (team 1) attacks west.
const attackHoop = team => HOOPS[team === 0 ? 1 : 0], defendHoop = team => HOOPS[team === 0 ? 0 : 1];
const RIM_Y = HOOPS[1].rim.y, RIM_R = 0.066 * 4.88, TUBE = 0.027;
const BOARD_HALF_W = 0.225 * 4.88, BOARD_Y0 = 0.57 * 4.88, BOARD_Y1 = 0.845 * 4.88;
const S = RIM_Y / 1.35, BALL_R = 0.07 * S, G = 9.8;
const DUNK_DIST = 1.8 * S, ARC = 6.75, BODY_R = 0.44, TARGET = 21, SHOT_CLOCK = 20;
const XMAX = 14.2, ZMAX = 7.2;

// ====================================================================== players
const CLIPS = { Idle: 1, Dribble: 1, Shoot: 0, Dunk: 0, Run: 1, RunB: 1, RunC: 1, DribbleRun: 1, Defend: 1, Block: 0, Ready: 1, Pass: 0, Steal: 0, SlideL: 1, SlideR: 1 };
const MS = 0.9;                                    // the Mixamo player model is 1.0 tall (old rig 0.9)
const RUN_NATIVE = 1.65 * MS * S / 1.4,           /* / 1.4: runs play 1.4x faster than the measured stride (requested) */                  // ground speed the Run cycle covers at 1x (measured on the retargeted clip)
     DRUN_NATIVE = 0.9 * MS * S / 1.4,                   /* DribbleRun: copied from the reference video, a slower jog */
     SLIDE_NATIVE = 0.16 / (0.5 * 0.45) * S;
const NAMES = [['Jax', 'Rook', 'Blaze'], ['Kai', 'Nova', 'Ziggy']];
const P = [];
const HAIR_TINT = [[0.10, 0.07, 0.05], [0.05, 0.04, 0.04], [0.16, 0.10, 0.06], [0.07, 0.05, 0.04], [0.12, 0.08, 0.05], [0.04, 0.03, 0.03]];
function setHair(model, k, tint, old) {   // put hairstyle k (0-19) on a model's head bone; returns the hair entity
  if (old) old.destroy();
  const hairs = hairAsset.resource.instantiateRenderEntity(), h = hairs.findByName('hair' + k);
  if (h) { const c = HAIR_TINT[tint % HAIR_TINT.length];
    for (const r of h.findComponents('render')) for (const mi of r.meshInstances) { const m = mi.material.clone(); m.diffuse = new pc.Color(...c.map(v => v * 3.2)); m.gloss = 0.35; m.update(); mi.material = m; }
    h.reparent(model.findByName('head')); h.setLocalPosition(0, 0, 0); h.setLocalEulerAngles(0, 0, 0); h.setLocalScale(1, 1, 1); }
  hairs.destroy(); return h;
}
function makePlayer(team, idx) {
  const ent = new pc.Entity(NAMES[team][idx]); app.root.addChild(ent);
  const model = playerAsset.resource.instantiateRenderEntity(); ent.addChild(model); const k = [1.0, 0.95, 1.05, 0.97, 1.04, 1.0][P.length]; model.setLocalScale(S * k * MS, S * k * MS, S * k * MS);
  if (team === 1) for (const r of model.findComponents('render')) for (const mi of r.meshInstances)
    if (mi.material && mi.material.name === 'player') { const m = mi.material.clone(); m.diffuseMap = tealAsset.resource; m.update(); mi.material = m; }
  model.addComponent('anim', { activate: true });
  model.anim.loadStateGraph({ layers: [{ name: 'Base', weight: 1, states: [{ name: 'START' }, ...Object.entries(CLIPS).map(([n, loop]) => ({ name: n, speed: 1, loop: !!loop }))], transitions: [{ from: 'START', to: 'Ready' }] }], parameters: {} });
  for (const a of playerAsset.resource.animations) model.anim.assignAnimation(a.resource.name, a.resource, undefined, 1, !!CLIPS[a.resource.name]);
  const label = document.createElement('div'); label.className = 'tag t' + team; label.textContent = NAMES[team][idx]; $('tags').appendChild(label);
  const sb = document.createElement('i'); sb.className = 'sbar'; const sf = document.createElement('b'); sb.appendChild(sf); label.appendChild(sb);
  const hairEnt = setHair(model, [0, 6, 13, 9, 14, 19][P.length], P.length);
  return { hairEnt, id: P.length, team, idx, name: NAMES[team][idx], ent, model, label, ballNode: model.findByName('basketball'), rootBone: model.findByName('root'), head: model.findByName('head'),
    k, runClip: ['Run', 'RunB', 'RunC', 'RunC', 'Run', 'RunB'][P.length], spd: [1.0, 0.94, 1.07, 1.04, 0.97, 1.0][P.length],
    stamina: 1, drain: 0, pos: new pc.Vec3(), vel: new pc.Vec3(), yaw: 0, state: 'Ready', action: null, think: Math.random() * .3, timer: 0, cut: 0, juke: 0, stall: 0, react: 0, holdT: 0 };
}
for (let t = 0; t < 2; t++) for (let i = 0; i < 3; i++) P.push(makePlayer(t, i));
const team = t => P.filter(p => p.team === t);
const man = p => P[(1 - p.team) * 3 + p.idx];          // matchup: same index on the other team
function setAnim(p, name, blend = 0.15, speed = 1) {
  p.model.anim.speed = speed; if (p.state === name) return; p.state = name;
  // looping clips start at each player's own phase (plus a little jitter) so teammates never move in lockstep
  const off = CLIPS[name] ? ((p.phase === undefined ? (p.phase = Math.random()) : p.phase) + Math.random() * 0.25) % 1 : 0;
  const L = p.model.anim.baseLayer;
  if (L.activeState === name) { if (CLIPS[name]) L.activeStateCurrentTime = off * (L.activeStateDuration || 1); }   // already in it (e.g. the start pose): just shift the phase
  else L.transition(name, blend, off);
}
function place(p) { p.ent.setPosition(p.pos.x, 0.012, p.pos.z); p.ent.setEulerAngles(0, p.yaw * 57.2958, 0); }
function faceTo(p, x, z, rate, dt) { const want = Math.atan2(x - p.pos.x, z - p.pos.z); let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += rate ? Math.sign(d) * Math.min(Math.abs(d), rate * dt) : d; }
const fwd = p => new pc.Vec3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
const left = p => new pc.Vec3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
const flat = (x, z) => new pc.Vec3(x, 0, z);
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const bodyPos = p => (p.action && p.action.type === 'dunk') ? p.rootBone.getPosition() : p.pos;

// ====================================================================== ball
const ball = { ent: P[0].ballNode.clone(), pos: new pc.Vec3(), vel: new pc.Vec3(), q: new pc.Quat(), spin: new pc.Vec3(), free: false, holder: null, pass: null, lastTouch: 0, crossed: false };
app.root.addChild(ball.ent); ball.ent.setLocalScale(S, S, S); ball.ent.enabled = false;
const ringMat = new pc.StandardMaterial(); ringMat.diffuse = new pc.Color(0, 0, 0); ringMat.emissive = new pc.Color(0.25, 1.6, 0.45); ringMat.opacity = 0.95; ringMat.blendType = pc.BLEND_NORMAL; ringMat.depthWrite = false; ringMat.update();
const ballRing = new pc.Entity('Ball ring'); ballRing.addComponent('render', { type: 'torus', material: ringMat, castShadows: false, receiveShadows: false });
ballRing.setLocalScale(1.7, 0.04, 1.7); app.root.addChild(ballRing); ballRing.enabled = false;
const game = { phase: 'intro', timer: 0.8, offense: 0, shotClock: SHOT_CLOCK, shot: null, score: [0, 0], paused: false, lastScoreTeam: 0, time: 0 };
function give(p) {
  if (ball.free) sfx('catch', 0.8);
  ball.free = false; ball.holder = p; ball.pass = null; ball.ent.enabled = false; ball.lastTouch = p.team;
  for (const q of P) q.ballNode.enabled = (q === p);
  if (game.offense !== p.team) { game.offense = p.team; game.shotClock = SHOT_CLOCK; }
  p.action = null; p.holdT = 0; p.stall = 0; p.react = 0.2; p.think = 0.05;
}
function release(p0, v, spinBack) {
  ball.free = true; ball.holder = null; ball.pos.copy(p0); ball.vel.copy(v); ball.ent.enabled = true; ball.crossed = false;
  for (const q of P) q.ballNode.enabled = false;
  ball.spin.set(0, 0, 0); if (spinBack) { const ax = flat(v.z, -v.x).normalize(); ball.spin.copy(ax.mulScalar(-14)); }
}
function stepBall(dt) {
  const n = 4, h = dt / n;
  for (let i = 0; i < n; i++) {
    const prevY = ball.pos.y;
    ball.vel.y -= G * h; ball.pos.add(ball.vel.clone().mulScalar(h));
    for (const H of HOOPS) {
      const C = H.rim, hx = ball.pos.x - C.x, hz = ball.pos.z - C.z, L = Math.hypot(hx, hz) || 1e-4;
      if (L > 1.6) continue;
      const R = new pc.Vec3(C.x + hx / L * RIM_R, C.y, C.z + hz / L * RIM_R), dv = ball.pos.clone().sub(R), dl = dv.length();
      if (dl < BALL_R + TUBE) {
        const nn = dv.mulScalar(1 / dl); ball.pos.copy(R).add(nn.clone().mulScalar(BALL_R + TUBE));
        const vn = ball.vel.dot(nn); if (vn < 0) { ball.vel.sub(nn.mulScalar(1.6 * vn)); ball.vel.mulScalar(0.86); sfx('rim', Math.min(1, 0.3 - vn * 0.15)); }
      }
      const s = H.side, past = s > 0 ? ball.pos.x + BALL_R > H.board.x : ball.pos.x - BALL_R < H.board.x;
      if (past && Math.abs(ball.pos.x - H.board.x) < 0.35 && Math.abs(ball.pos.z - H.board.z) < BOARD_HALF_W && ball.pos.y > BOARD_Y0 && ball.pos.y < BOARD_Y1 && ball.vel.x * s > 0) {
        ball.pos.x = H.board.x - s * BALL_R; ball.vel.x *= -0.6; ball.vel.z *= 0.9; sfx('board');
      }
      if (!ball.crossed && prevY >= C.y && ball.pos.y < C.y && L < RIM_R - BALL_R * 0.35 && ball.vel.y < 0) { ball.crossed = true; scored(H); }
      if (L < RIM_R && ball.pos.y < C.y && ball.pos.y > C.y - 0.55) { ball.vel.x *= 0.96; ball.vel.z *= 0.96; ball.vel.y = Math.max(ball.vel.y, -3.2); }
    }
    if (ball.pos.y < BALL_R) {
      ball.pos.y = BALL_R; if (ball.vel.y < -0.8) sfx('bounce', Math.min(1, -ball.vel.y * 0.18));
      ball.vel.y = Math.abs(ball.vel.y) > 0.5 ? -ball.vel.y * 0.72 : 0; ball.vel.x *= 0.95; ball.vel.z *= 0.95;
    }
  }
  const vh = flat(ball.vel.x, ball.vel.z); let w = ball.spin.clone();
  if (ball.pos.y <= BALL_R + 1e-3) w = flat(vh.z, -vh.x).mulScalar(1 / BALL_R);
  const wl = w.length(); if (wl > 1e-3) { const dq = new pc.Quat().setFromAxisAngle(w.clone().mulScalar(1 / wl), wl * dt * 57.2958); ball.q.mul2(dq, ball.q); }
  ball.ent.setPosition(ball.pos); ball.ent.setRotation(ball.q);
}

// ====================================================================== game flow
function toast(text, big) { netEv('toast', text, big ? 1 : 0); toastL(text, big); }
function toastL(text, big) { const t = $('toast'); t.textContent = text; t.className = big ? 'show big' : 'show'; clearTimeout(toast.h); toast.h = setTimeout(() => t.className = '', big ? 2400 : 1400); }
function digits(el, v, set) {   // numbers drawn with the sprite-sheet digits
  const s = String(v); if (el.dataset.v === s) return; el.dataset.v = s;
  el.innerHTML = [...s].map(c => '<i class="' + set + c + '"></i>').join('');
}
function hud() {
  digits($('s0'), game.score[0], 'w'); digits($('s1'), game.score[1], 'w');
  digits($('clock'), game.phase === 'live' || game.phase === 'air' || game.phase === 'loose' ? Math.max(0, Math.ceil(game.shotClock)) : game.phase === 'ftwait' && game.ft && game.timer <= 0 && ctl(game.ft.shooter.team) ? Math.max(0, Math.ceil(10 + game.timer)) : '', 'g');
  $('poss0').classList.toggle('on', game.offense === 0); $('poss1').classList.toggle('on', game.offense === 1);
}
function inbound(t, spot) {
  // team t takes the ball; spot defaults to under the basket they defend
  game.pendingFoul = null; game.offense = t; game.phase = 'inbound'; game.timer = 1.0; game.shotClock = SHOT_CLOCK; game.shot = null;
  const D = defendHoop(t), A = attackHoop(t), dir = Math.sign(A.rim.x - D.rim.x);
  const o = team(t), d = team(1 - t);
  const h = o[Math.floor(Math.random() * 3)];
  // the inbounder stands out of bounds: behind the baseline after a basket, on the sideline otherwise
  let out, a1, a2; const side = spot && Math.abs(spot.z) > 0.01 ? Math.sign(spot.z) : (Math.random() < .5 ? 1 : -1);
  if (!spot) { const bz = side * 1.9; out = flat(Math.sign(D.rim.x) * 14.8, bz); a1 = flat(D.rim.x + dir * 3.2, bz * 1.4); a2 = flat(D.rim.x + dir * 6.5, -bz * 2); }
  else { const sx = Math.max(-12.5, Math.min(12.5, spot.x)); out = flat(sx, side * 7.8); a1 = flat(sx + dir * 1.2, side * 4.6); a2 = flat(sx + dir * 4.5, -side * 1.5); }
  const rest = o.filter(p => p !== h); rest[0].pos.copy(a1); rest[1].pos.copy(a2);
  h.pos.copy(out); h.oob = true;
  for (const p of o) { p.vel.set(0, 0, 0); p.action = null; delete p.pendingBlock; if (p !== h) clamp(p.pos); faceTo(p, A.rim.x, 0); p.cut = 0; p.goal = null; }
  faceTo(h, a1.x, a1.z); game.inbounder = h; game.timer = 1.2;
  if (human.on && t === HUMAN && !TUT) setTimeout(() => { if (myInbound()) toastL('Tap a teammate to inbound', false); }, 1300);
  for (const p of d) { const m = man(p); p.vel.set(0, 0, 0); p.action = null; delete p.pendingBlock; p.pos.copy(flat(m.pos.x + dir * 2.5, m.pos.z * 0.8)); clamp(p.pos); faceTo(p, m.pos.x, m.pos.z); }
  for (const p of P) { p.rootBone.setLocalPosition(0, 0, 0); setAnim(p, p === h ? 'Idle' : p.team === t ? 'Ready' : 'Defend', 0.1); place(p); }
  give(h); hud();
}
function inboundPass(h, r) {   // throw it in; the clock and play start with the pass
  if (!r) { let bd = 1e9; for (const q of team(h.team)) { if (q === h) continue; const c = closestDefender(q), sc = d2(q.pos, h.pos) - (c ? Math.min(2, d2(c.pos, q.pos)) : 2) * 1.5; if (sc < bd) { bd = sc; r = q; } } }
  if (!r) return; r.lastPasser = null; game.phase = 'live'; game.inbounder = null; toast((h.team ? 'Teal' : 'Purple') + ' ball'); startPass(h, r);
}
function restart() { setTimeout(rephase, 50); game.score = [0, 0]; game.crowd = [1, 1]; game.distract = 0; $('banner').className = ''; netEv('ban', '', ''); toast('First to ' + TARGET, true); inbound(Math.random() < .5 ? 0 : 1, flat(0, 0)); }
function scored(H) {
  const s = game.shot; if (!s) return;
  const t = s.shooter.team; if (attackHoop(t) !== H) return;
  if (TUT) { game.shot = null; sfx('net'); tutEvent('made'); return; }
  stats.made++; game.score[t] += s.pts; game.lastScoreTeam = t; game.shot = null;
  if (s.ft) toast('Free throw good', false); else toast(s.dunk ? s.shooter.name.toUpperCase() + ' THROWS IT DOWN!' : s.pts === 3 ? s.shooter.name + ' from downtown!' : s.shooter.name + (s.assist ? ' scores — dime from ' + s.assist.name : ' scores'), true);
  sfx('net'); netEv('score', t); crowdReact(t); game.phase = 'scored'; game.timer = 1.6;
  const pf = game.pendingFoul; game.pendingFoul = null;
  game.andOne = pf && !s.ft && game.score[t] < TARGET ? pf : null;
  if (s.ft) { game.phase = 'ftair'; game.ftMade = true; }   // the free-throw loop decides what comes next
  hud();
  if (t === 0 && !NET.role && typeof teamXP === 'function') teamXP(s.pts * 5);
  if (game.score[t] >= TARGET && !NET.role && typeof teamXP === 'function') { teamXP(t === 0 ? 300 : 120); setTimeout(() => toastL('+' + (t === 0 ? 300 : 120) + ' XP — spend it in My Team', true), 2600); }
  if (game.score[t] >= TARGET) { game.phase = 'over'; game.timer = 7; $('banner').textContent = (t ? 'TEAL' : 'PURPLE') + ' WIN ' + game.score[0] + '–' + game.score[1]; $('banner').className = 'show t' + t; netEv('ban', $('banner').textContent, 'show t' + t); }
}

// ====================================================================== actions
const stats = { pass: 0, shot: 0, dunk: 0, steal: 0, block: 0, made: 0 }; window.__stats = stats;
function startShot(p) { stats.shot++;
  const A = attackHoop(p.team); faceTo(p, A.rim.x, A.rim.z); p.vel.set(0, 0, 0);
  p.action = { type: 'shoot', t: 0, done: false }; setAnim(p, 'Shoot', 0.1);
  const c = closestDefender(p); if (game.phase !== 'ftair' && c && d2(c.pos, p.pos) < 2.4 && !c.action && Math.random() < 0.75) c.pendingBlock = 0.1 + Math.random() * 0.15;
}
function shotRelease(p) {
  const A = attackHoop(p.team), p0 = p.ballNode.getPosition().clone(), dr = d2(p.pos, A.rim);
  const c = closestDefender(p), cd = c ? d2(c.pos, p.pos) : 9;
  game.shot = { shooter: p, pts: game.phase === 'ftair' ? 1 : dr > ARC ? 3 : 2, ft: game.phase === 'ftair', assist: p.lastPasser && p.holdT < 3 ? p.lastPasser : null };
  if (!game.shot.ft && c && c.action && c.action.type === 'block' && c.action.t > 0.2 && c.action.t < 0.75 && cd < 1.35 && Math.random() < 0.38) {
    const away = flat(p.pos.x - A.rim.x, p.pos.z - A.rim.z).normalize();
    const inC = flat(-p0.x, -p0.z).normalize(), dir2 = away.mulScalar(0.6).add(inC.mulScalar(0.4)).normalize();
    release(p0, new pc.Vec3(dir2.x * 2.6 + (Math.random() - .5) * 1.2, 1.6, dir2.z * 2.6 + (Math.random() - .5) * 1.2), false);
    game.shot = null; game.phase = 'loose'; ball.lastTouch = c.team; stats.block++; toast('REJECTED by ' + c.name + '!', true); sfx('block'); return;
  }
  let make = dr < 3 ? 0.7 : dr < 4.5 ? 0.62 : dr < ARC ? 0.58 - 0.03 * (dr - 4.5) : 0.45 - 0.06 * (dr - ARC);
  make = Math.max(0.18, make) * (cd < 1.0 ? 0.55 : cd < 1.6 ? 0.75 : cd < 2.4 ? 0.9 : 1);
  if (game.shotClock < 1) make *= 0.8;
  if (p.rat) make *= 0.8 + p.rat.shooting / 250;   // roster shooting rating (60 = +4%)
  if (game.shot.ft) make = 0.76 - 0.3 * Math.min(1, game.ftDistract || 0);   // a rattled shooter
  if (p.shotQ !== undefined) {   // player's timed release: 1 = dead centre, 0 = edge of the meter
    const q = p.shotQ; delete p.shotQ;
    make = q >= 1 ? 0.99 : make * (0.15 + 1.25 * q * q);
    toast(q >= 1 ? 'PERFECT release' : q > 0.7 ? 'Good release' : q > 0.4 ? 'Slightly off' : 'Way off', false);
  }
  const tgt = A.rim.clone(), made = Math.random() < make;
  if (!game.shot.ft && c && cd < 1.3 && Math.random() < (c.action && c.action.type === 'block' ? 0.2 : 0.1)) game.pendingFoul = { def: c, shooter: p, pts: game.shot.pts, made };
  if (made) { const a = Math.random() * 6.283, r = Math.random() * 0.07; tgt.x += Math.cos(a) * r; tgt.z += Math.sin(a) * r; }
  else { const a = Math.random() * 6.283, r = RIM_R * (0.85 + Math.random() * 0.45); tgt.x += Math.cos(a) * r; tgt.z += Math.sin(a) * r; tgt.y += 0.02; }
  const T = 0.75 + 0.055 * dr;
  release(p0, tgt.sub(p0).sub(new pc.Vec3(0, -0.5 * G * T * T, 0)).mulScalar(1 / T), true);
  ball.lastTouch = p.team;
}
function startDunk(p) { stats.dunk++;
  const A = attackHoop(p.team), dx = A.rim.x - p.pos.x, dz = A.rim.z - p.pos.z, l = Math.hypot(dx, dz);
  p.pos.set(A.rim.x - dx / l * DUNK_DIST, 0, A.rim.z - dz / l * DUNK_DIST); faceTo(p, A.rim.x, A.rim.z); place(p);
  p.vel.set(0, 0, 0); p.action = { type: 'dunk', t: 0, done: false }; setAnim(p, 'Dunk', 0.08);
  const c = closestDefender(p); if (c && d2(c.pos, A.rim) < 3 && Math.random() < 0.6) c.pendingBlock = 0.45;
  toast(p.name + ' rises up…');
}
function dunkRelease(p) {
  const A = attackHoop(p.team), p0 = p.ballNode.getPosition().clone(); p0.x = A.rim.x; p0.z = A.rim.z;
  game.shot = { shooter: p, pts: 2, dunk: true, assist: p.lastPasser && p.holdT < 3 ? p.lastPasser : null };
  release(p0, new pc.Vec3(0, -4.5, 0), false); ball.crossed = true; scored(A); sfx('board');
}
function startPass(p, r) { stats.pass++;
  faceTo(p, r.pos.x, r.pos.z); p.vel.mulScalar(0.3); p.action = { type: 'pass', t: 0, to: r, done: false }; setAnim(p, 'Pass', 0.08);
}
function passRelease(p, r) {
  const p0 = p.ballNode.getPosition().clone(), dist = d2(p.pos, r.pos);
  const T = 0.22 + dist / 11, lead = r.pos.clone().add(r.vel.clone().mulScalar(T * 0.35));
  lead.x = Math.max(-13.4, Math.min(13.4, lead.x)); lead.z = Math.max(-6.4, Math.min(6.4, lead.z));
  r.catchAt = lead.clone();
  const tgt = new pc.Vec3(lead.x, 1.25, lead.z);
  release(p0, tgt.sub(p0).sub(new pc.Vec3(0, -0.5 * G * T * T, 0)).mulScalar(1 / T), false);
  sfx('pass', 0.8); ball.pass = { from: p, to: r, t: 0, T, tried: new Set() }; ball.lastTouch = p.team; r.react = 0;
}
// ---- fouls and free throws
const FT_DIST = 4.6;
function callFoul(def, shooter, n = 2, kind = 'Reach-in foul') {
  if (TUT) return tutEvent('foul', def);
  game.pendingFoul = null;
  game.ft = { shooter, left: n, n, team: shooter.team }; game.shot = null; game.phase = 'ftset'; game.timer = 1.8;
  for (const q of P) { q.action = null; delete q.pendingBlock; q.vel.set(0, 0, 0); }
  toast(kind + ' on ' + def.name + ' (' + (def.team ? 'Teal' : 'Purple') + ') — ' + (shooter.team ? 'Teal' : 'Purple') + (n === 1 ? ' shoots 1' : ' shoots ' + n), true); sfx('whistle', 0.9);
}
// ---- crowd distraction: the other side taps while a free throw is being lined up. Each tap shakes the
// shooter's screen, speeds up their meter and makes the crowd boo; it burns a small crowd meter that never refills.
// Stop tapping (or run the meter dry) and the shooter's meter settles back to normal.
const CROWD_TAP = 0.1;
function canDistract(t) { return game.phase === 'ftwait' && game.ft && game.ft.shooter.team !== t && game.timer <= 0 && (game.crowd || [1, 1])[t] > 0; }
function distract(t) {
  if (!canDistract(t)) return;
  game.crowd[t] = Math.max(0, game.crowd[t] - CROWD_TAP); game.distract = Math.min(1.4, (game.distract || 0) + 0.45);
  sfx('boo', 0.3); netEv('shake'); shake(game.ft.shooter.team);
}
function shake(shooterTeam) {   // only the shooter's screen shakes
  if (!human.on || shooterTeam !== HUMAN) return;
  const c = document.body; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
}
function crowdFrame(dt) {      // host: decay the distraction, let the computer heckle a player at the line
  if (!game.crowd) game.crowd = [1, 1];
  game.distract = Math.max(0, (game.distract || 0) - dt * 1.6);
  if (game.ft && game.crowd[1 - game.ft.shooter.team] <= 0) game.distract = 0;
  if (game.phase === 'ftwait' && game.ft && game.timer <= 0) {
    const ai = 1 - game.ft.shooter.team;
    if (!ctl(ai) && ctl(game.ft.shooter.team) && game.crowd[ai] > 0.35 && Math.random() < dt * 2.2) distract(ai);
    if (ctl(game.ft.shooter.team) && game.timer < -10) { toast('Too slow — 10 seconds!', true); ftShoot(0); }   // 10 s to shoot
  }
}
function ftShoot(q) { game.ftDistract = game.distract || 0; const s = game.ft.shooter; game.phase = 'ftair'; game.ftMade = false; game.ft.left--; game.timer = 3.2; if (q !== undefined) s.shotQ = q; startShot(s); }
function lineUpFT() {
  const f = game.ft, s = f.shooter, A = attackHoop(f.team), dir = Math.sign(A.rim.x);   // dir points from centre to that hoop
  s.pos.copy(flat(A.rim.x - dir * FT_DIST, 0));
  const lane = [[1.6, 1], [1.6, -1], [2.7, 1], [2.7, -1], [3.8, 1]];   // along both sides of the key, defenders take the inside spots
  const others = P.filter(q => q !== s).sort((a, b) => (a.team === f.team) - (b.team === f.team));
  others.forEach((q, i) => { const [x, side] = lane[i]; q.pos.copy(flat(A.rim.x - dir * x, side * 2.1)); });
  for (const q of P) { q.vel.set(0, 0, 0); q.action = null; q.rootBone.setLocalPosition(0, 0, 0); faceTo(q, A.rim.x, A.rim.z); setAnim(q, q === s ? 'Idle' : 'Ready', 0.1); place(q); }
  give(s); setAnim(s, 'Dribble', 0.1);
}
function startBlock(p) { p.action = { type: 'block', t: 0 }; p.vel.mulScalar(0.2); setAnim(p, 'Block', 0.08); }
function startSteal(p) { p.action = { type: 'steal', t: 0, done: false }; p.vel.mulScalar(0.3); setAnim(p, 'Steal', 0.08); }

function updateActions(dt) {
  for (const p of P) {
    if (p.pendingBlock !== undefined) { p.pendingBlock -= dt; if (p.pendingBlock <= 0) { delete p.pendingBlock; if (!p.action) startBlock(p); } }
    const a = p.action; if (!a) continue; a.t += dt;
    if (a.type === 'shoot') { if (!a.done && a.t >= 0.64 && ball.holder === p) { a.done = true; if (game.phase !== 'ftair') game.phase = 'air'; shotRelease(p); } if (a.t >= 1.5) p.action = null; }
    else if (a.type === 'dunk') {
      if (!a.done && a.t >= 1.06 && ball.holder === p) { a.done = true; game.phase = 'air'; dunkRelease(p); }
      if (a.t >= 2.9) { const r = p.rootBone.getPosition(); p.pos.set(r.x, 0, r.z); place(p); p.rootBone.setLocalPosition(0, 0, 0); p.action = null; setAnim(p, 'Ready', 0); }
    }
    else if (a.type === 'pass') { if (!a.done && a.t >= 0.30 && ball.holder === p) { a.done = true; passRelease(p, a.to); } if (a.t >= 0.62) p.action = null; }
    else if (a.type === 'block') { if (a.t >= 1.15) p.action = null; }
    else if (a.type === 'steal') {
      if (!a.done && a.t >= 0.2) {
        a.done = true; const h = ball.holder;
        let chance = 0.22; const aiReach = p.stealQ === undefined;
        if (p.stealQ !== undefined) { const q = p.stealQ; delete p.stealQ; chance = q > 0.91 ? 1 : 0.35 + 0.5 * (q / 0.91); p.perfectSteal = q > 0.91;   // edge 35% -> just outside the box 85%
          toast(q > 0.91 ? 'PERFECT timing' : q > 0.6 ? 'Good reach' : q > 0.3 ? 'Late reach' : 'Off the mark', false);
          if (q < 0.15) p.react = 0.4;
          if (q < 0.25 && h && h.team !== p.team && !h.action && d2(h.pos, p.pos) < 2.0 && Math.random() < 0.7) { callFoul(p, h); continue; } }
        if (aiReach && h && h.team !== p.team && !h.action && d2(h.pos, p.pos) < 2.0 && Math.random() < 0.14) { callFoul(p, h); continue; }   // the computer reaches in too
        if (h && h.team !== p.team && !h.action && d2(h.pos, p.pos) < 2.0 && Math.random() < chance) {
          if (p.perfectSteal || Math.random() < 0.5) { p.perfectSteal = false; give(p); game.phase = 'live'; setAnim(p, 'DribbleRun', 0.1); stats.steal++, toast('STEAL! ' + p.name + ' takes it', true); sfx('block'); }
          else {
            const to = flat(p.pos.x - h.pos.x, p.pos.z - h.pos.z).normalize();
            release(h.ballNode.getPosition().clone(), new pc.Vec3(to.x * 2.2 + (Math.random() - .5), 0.8, to.z * 2.2 + (Math.random() - .5)), false);
            ball.lastTouch = p.team; game.phase = 'loose'; toast('STEAL! ' + p.name + ' pokes it loose', true); sfx('block');
            h.react = 0.5;
          }
        }
      }
      if (a.t >= 0.8) p.action = null;
    }
  }
}

// ====================================================================== AI helpers
function clamp(v) { v.x = Math.max(-XMAX, Math.min(XMAX, v.x)); v.z = Math.max(-ZMAX, Math.min(ZMAX, v.z)); return v; }
function steer(p, target, maxSpeed, dt, accel = 13) {
  maxSpeed *= p.spd;
  const want = flat(target.x - p.pos.x, target.z - p.pos.z), l = want.length(), sp = Math.min(maxSpeed, l * 3);
  p.goalDist = l;
  if (l > 1e-3) want.mulScalar(sp / l);
  // avoid bodies ahead (go around, don't plough through)
  const wl0 = want.length() || 1;
  for (const q of P) {
    if (q === p) continue; const qp = bodyPos(q), rx = qp.x - p.pos.x, rz = qp.z - p.pos.z, rl = Math.hypot(rx, rz);
    if (rl < 1.9 && rl > 1e-3) {
      const along = (rx * want.x + rz * want.z) / (rl * wl0);
      if (along > 0.35) { const side = Math.sign(want.x * rz - want.z * rx) || 1; const k = (1.9 - rl) * 1.8; want.x += rz / rl * side * k; want.z += -rx / rl * side * k; }
    }
  }
  const dv = want.sub(p.vel), dl = dv.length(), mx = accel * dt; if (dl > mx) dv.mulScalar(mx / dl);
  p.vel.add(dv); const vl = p.vel.length(); if (vl > maxSpeed) p.vel.mulScalar(maxSpeed / vl);
}
function closestDefender(p) { let best = null, bd = 1e9; for (const q of team(1 - p.team)) { const d = d2(q.pos, p.pos); if (d < bd) { bd = d; best = q; } } return best; }
function openness(p) { const c = closestDefender(p); return c ? d2(c.pos, p.pos) : 9; }
function laneClear(a, b, pad, t) {   // no player of team t near segment a->b
  for (const q of team(t)) {
    const ax = b.x - a.x, az = b.z - a.z, L2 = ax * ax + az * az; let u = ((q.pos.x - a.x) * ax + (q.pos.z - a.z) * az) / (L2 || 1); u = Math.max(0, Math.min(1, u));
    if (Math.hypot(a.x + ax * u - q.pos.x, a.z + az * u - q.pos.z) < pad) return false;
  }
  return true;
}
function animMove(p, dt, mode) {
  const sp = p.vel.length();
  if (mode === 'handler') {
    if (sp > 0.7) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 8, dt); setAnim(p, 'DribbleRun', 0.2, pc.math.clamp(sp / (DRUN_NATIVE * p.k), 0.42, 2.94)); }
    else { setAnim(p, 'Dribble', 0.2); p.vel.mulScalar(Math.pow(0.002, dt)); }
  } else if (mode === 'stance') {
    if (sp > 2.4 || (p.goalDist || 0) > 1.8) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 9, dt); setAnim(p, p.runClip, 0.2, pc.math.clamp(sp / (RUN_NATIVE * p.k), 0.42, 2.24)); return; }
    const lat = p.vel.dot(left(p)), lv = left(p), fw = p.vel.clone().sub(lv.clone().mulScalar(lat));
    if (fw.length() > 0.25) p.vel.sub(fw.mulScalar(1 - 0.25 / fw.length()));   // stance moves sideways only (no gliding)
    if (lat > 0.45) setAnim(p, 'SlideL', 0.15, pc.math.clamp(lat / SLIDE_NATIVE, 0.3, 1.4)); else if (lat < -0.45) setAnim(p, 'SlideR', 0.15, pc.math.clamp(-lat / SLIDE_NATIVE, 0.3, 1.4)); else { setAnim(p, 'Defend', 0.2); p.vel.mulScalar(Math.pow(0.002, dt)); }
  } else {
    if (sp > 1.0) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 9, dt); setAnim(p, p.runClip, 0.2, pc.math.clamp(sp / (RUN_NATIVE * p.k), 0.42, 2.24)); }
    else { setAnim(p, 'Ready', 0.25); p.vel.mulScalar(Math.pow(0.002, dt)); }
  }
}

// ====================================================================== offense
function spots(t) {
  const A = attackHoop(t).rim, dir = Math.sign(A.x);       // dir points toward the attacked baseline
  return [flat(A.x - dir * 1.1, 6.3), flat(A.x - dir * 1.1, -6.3), flat(A.x - dir * 5.6, 4.9), flat(A.x - dir * 5.6, -4.9), flat(A.x - dir * 7.4, 0)];
}
function handlerAI(p, dt) {
  const A = attackHoop(p.team), dir = Math.sign(A.rim.x), dr = d2(p.pos, A.rim);
  const toRim = flat(A.rim.x - p.pos.x, A.rim.z - p.pos.z).normalize(), side = flat(-toRim.z, toRim.x);
  const c = closestDefender(p), cd = d2(c.pos, p.pos);
  p.holdT += dt; p.think -= dt;
  const frontcourt = p.pos.x * dir > 0;
  const ahead = team(1 - p.team).filter(q => flat(q.pos.x - p.pos.x, q.pos.z - p.pos.z).dot(toRim) > 0 && d2(q.pos, A.rim) < dr + 0.5).length;
  const mates = team(p.team).filter(q => q !== p);
  if (p.react > 0) { p.react -= dt; p.vel.mulScalar(Math.pow(0.05, dt)); animMove(p, dt, 'handler'); return; }
  if (p.think <= 0) {
    p.think = 0.3 + Math.random() * 0.2;
    if (human.on && p.team !== HUMAN && cd < 1.7 && !c.action) {          // the player's defender is in steal range
      const open = mates.filter(m => !m.action && laneClear(p.pos, m.pos, 0.9, 1 - p.team) && openness(m) > 1.6);
      if (open.length && Math.random() < 0.45) { const m = open.sort((a, b) => openness(b) - openness(a))[0]; m.lastPasser = p; return startPass(p, m); }
      p.juke = (flat(c.pos.x - p.pos.x, c.pos.z - p.pos.z).dot(side) > 0 ? -1 : 1) * (2.4 + Math.random()); p.burst = 0.5;   // crossover away from the hand
    }
    const inFront = flat(c.pos.x - p.pos.x, c.pos.z - p.pos.z).dot(toRim) > 0.2 && cd < 1.6;
    const facing = toRim.dot(fwd(p)) > 0.55;
    const rimGuard = team(1 - p.team).some(q => d2(q.pos, A.rim) < 2.6);
    if (dr < DUNK_DIST + 0.5 && dr > DUNK_DIST - 0.8 && facing) {
      if (laneClear(p.pos, A.rim, 1.4, 1 - p.team) && !rimGuard) return startDunk(p);
      // walled off at the rim: kick it out or pull up over the help
      p.holdT = Math.max(p.holdT, 0.7); p.stall += 0.6;
    }
    const open = cd > 1.6, sc = game.shotClock;
    if (frontcourt && dr < 8.4 && (sc < 2.5 || (open && dr > 2.4 && Math.random() < (dr > ARC ? 0.35 : 0.5)) || (cd > 1.1 && dr < 6 && p.holdT > 2.5 && Math.random() < 0.25) || (p.stall > 1.2 && dr < 7.5 && Math.random() < 0.55))) return startShot(p);
    if (p.holdT > 0.6) {
      let best = null, bestScore = 0;
      for (const m of mates) {
        if (!laneClear(p.pos, m.pos, 0.9, 1 - p.team) || d2(p.pos, m.pos) > 13 || m.action) continue;
        const o = openness(m), mr = d2(m.pos, A.rim);
        const value = o + (mr < 4.5 ? 1.8 : 0) + (m.pos.x * dir > p.pos.x * dir ? 0.6 : 0) - cd * 0.6 - (frontcourt ? 0 : 1.2);
        if (value > bestScore) { bestScore = value; best = m; }
      }
      const pressure = cd < 1.3 || p.stall > 1.0;
      if (best && bestScore > (pressure ? 1.2 : 2.6) && Math.random() < 0.7) { best.lastPasser = p; return startPass(p, best); }
    }
    if (inFront) p.juke = (flat(c.pos.x - p.pos.x, c.pos.z - p.pos.z).dot(side) > 0 ? -1 : 1) * (1.6 + Math.random() * 1.2);
  }
  p.juke *= Math.pow(0.35, dt); if (p.burst > 0) p.burst -= dt;
  let goal, speed;
  if (!frontcourt || (ahead >= 2 && dr > 9)) {
    const fastBreak = ahead <= 1;
    goal = fastBreak ? flat(A.rim.x - dir * (DUNK_DIST - 0.2), A.rim.z * 0.5) : flat(A.rim.x - dir * 8.0, p.pos.z * 0.5 + p.juke);
    speed = fastBreak ? 3.8 : 3.2;
  } else {
    const lane = Math.sin((game.time + p.id) * 1.1) * 1.0 + p.juke;
    goal = flat(A.rim.x, A.rim.z).sub(toRim.clone().mulScalar(DUNK_DIST - 0.15)).add(side.clone().mulScalar(lane * Math.min(1, (dr - DUNK_DIST) / 3)));
    speed = 3.1;
  }
  steer(p, clamp(goal), speed * (p.burst > 0 ? 1.35 : 1), dt, p.burst > 0 ? 20 : 13);
  p.stall = p.vel.length() < 0.9 && frontcourt ? p.stall + dt : 0;
  animMove(p, dt, 'handler');
}
function offballAI(p, dt) {
  const A = attackHoop(p.team), dir = Math.sign(A.rim.x), h = ball.holder;
  p.timer -= dt;
  if (ball.pass && ball.pass.to === p) { steer(p, p.catchAt || p.pos, 4.5, dt, 20); faceTo(p, ball.pos.x, ball.pos.z, 10, dt); animMove(p, dt, 'offball'); if (p.vel.length() < 1) setAnim(p, 'Ready', 0.12); return; }
  let goal;
  const hb = h ? bodyPos(h) : ball.pos, frontcourt = hb.x * dir > 0;
  if (!frontcourt) {
    const lane = p.idx === 0 ? 4.6 : p.idx === 1 ? -4.6 : 0.0;
    goal = flat(Math.min(Math.abs(A.rim.x) - 4, Math.max(1, hb.x * dir + 6)) * dir, lane);
  } else if (p.cut > 0) {
    p.cut -= dt; goal = flat(A.rim.x - dir * 1.6, (p.idx % 2 ? 1 : -1) * 0.8);
  } else {
    const sp = spots(p.team).filter(s => d2(s, hb) > 3.2);
    const taken = team(p.team).filter(q => q !== p && q.goal).map(q => q.goal);
    sp.sort((a, b) => d2(a, p.pos) - d2(b, p.pos));
    goal = sp.find(s => !taken.some(t => d2(t, s) < 1.5)) || sp[0];
    if (p.timer <= 0) { p.timer = 1.5 + Math.random() * 2; if (d2(man(p).pos, p.pos) > 2.3 || Math.random() < 0.18) p.cut = 1.8; }
  }
  p.goal = goal; steer(p, clamp(goal.clone()), p.cut > 0 ? 3.9 : 3.5, dt);
  animMove(p, dt, 'offball'); if (p.vel.length() < 1.0) faceTo(p, hb.x, hb.z, 6, dt);
}

// ====================================================================== defense (man-to-man)
function isHelper(p) {
  const h = ball.holder; if (!h) return false;
  const D = defendHoop(p.team), hp = bodyPos(h), hd = d2(hp, D.rim); if (hd > 7.5) return false;
  const od = man(h);   // on-ball defender
  const beaten = d2(od.pos, D.rim) > hd - 0.3 || d2(od.pos, hp) > 2.2;
  if (!beaten && hd > 4.5) return false;
  const others = team(p.team).filter(q => q !== od);
  others.sort((a, b) => d2(a.pos, D.rim) - d2(b.pos, D.rim));
  return others[0] === p;
}
function defenseAI(p, dt) {
  const o = ball.holder;
  if (o && o.team !== p.team && o.action && o.action.type === 'shoot' && closestDefender(o) === p && d2(p.pos, o.pos) < 4) {
    // close out on the shooter, hand up
    const A = attackHoop(o.team), t = bodyPos(o).clone().add(flat(A.rim.x - o.pos.x, A.rim.z - o.pos.z).normalize().mulScalar(0.8));
    steer(p, t, 5.2, dt, 22); animMove(p, dt, 'stance'); faceTo(p, o.pos.x, o.pos.z, 12, dt);
    if (!p.action && p.pendingBlock === undefined && d2(p.pos, o.pos) < 1.5 && o.action.t < 0.45) p.pendingBlock = 0.05;
    return;
  }
  const m = man(p), D = defendHoop(p.team), mp = bodyPos(m), bp = ball.holder ? bodyPos(ball.holder) : ball.pos;
  const toRim = flat(D.rim.x - mp.x, D.rim.z - mp.z), mr = toRim.length(); toRim.normalize();
  let goal;
  const ds = Math.sign(D.rim.x);
  const behindPlay = (p.pos.x - mp.x) * ds < -1.0;                 // my man is closer to my basket than I am
  if (ball.holder === m) {
    const gap = (human.on && m.team === HUMAN) ? Math.max(0.8, Math.min(1.2, mr * 0.15)) : Math.max(0.95, Math.min(1.5, mr * 0.18));   // tighter on the player
    goal = mp.clone().add(toRim.mulScalar(gap));
    if (!ctl(p.team) && !p.action && !m.action && d2(p.pos, mp) < 1.35 && Math.random() < dt * (human.on && m.team === HUMAN ? 0.55 : 0.35)) startSteal(p);
  } else if (ball.holder && ball.holder.team !== p.team && isHelper(p)) {
    const hp = bodyPos(ball.holder), hr = flat(hp.x - D.rim.x, hp.z - D.rim.z).normalize();
    goal = flat(D.rim.x + hr.x * 1.7, D.rim.z + hr.z * 1.7);
  } else {
    const help = mr < 5 ? 0.25 : 0.4;
    goal = flat(mp.x * (1 - help) + (bp.x * 0.55 + D.rim.x * 0.45) * help, mp.z * (1 - help) + (bp.z * 0.55 + D.rim.z * 0.45) * help);
    goal.add(flat(D.rim.x - goal.x, D.rim.z - goal.z).normalize().mulScalar(0.9));
  }
  steer(p, clamp(goal), behindPlay ? 4.0 : 3.6, dt, 13);
  animMove(p, dt, 'stance');
  if (!p.state.startsWith('Run')) faceTo(p, mp.x, mp.z, 7, dt);
  if (ball.pass && ball.pass.to === m && !ball.pass.tried.has(p.id)) {
    const dB = ball.pos.distance(new pc.Vec3(p.pos.x, 1.2, p.pos.z));
    if (dB < 0.9 && ball.pos.y < 2.3) {
      ball.pass.tried.add(p.id);
      if (Math.random() < 0.45) { give(p); setAnim(p, 'Dribble', 0.1); game.phase = 'live'; stats.steal++, toast(p.name + ' picks it off!', true); sfx('block'); }
      else { ball.vel.x *= 0.25; ball.vel.z *= 0.25; ball.vel.y = 1.2; ball.pass = null; ball.lastTouch = p.team; game.phase = 'loose'; toast('Deflected by ' + p.name); }
    }
  }
}

// ====================================================================== loose ball / rebounds
function chase(p, dt) {
  const t = ball.pos.y > 2.2 ? 0.45 : 0.15, tgt = clamp(flat(ball.pos.x + ball.vel.x * t, ball.pos.z + ball.vel.z * t));
  steer(p, tgt, 4.0, dt, 13); animMove(p, dt, 'offball');
  if (p.vel.length() < 1.0) faceTo(p, ball.pos.x, ball.pos.z, 8, dt);
  if (d2(p.pos, ball.pos) < 0.85 && ball.pos.y < 1.8) {
    const was = game.offense; give(p); game.phase = 'live';
    toast(p.team === was ? 'Offensive board — ' + p.name : p.name + ' rebounds'); setAnim(p, 'Dribble', 0.1);
  }
}

// ====================================================================== solid bodies (a set defender outweighs the dribbler)
function bodies() { for (let it = 0; it < 3; it++) { bodies1(); for (const p of P) if (!p.oob) clamp(p.pos); } }
function bodies1() {
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j], pa = bodyPos(a), pb = bodyPos(b);
    const dx = pb.x - pa.x, dz = pb.z - pa.z, l = Math.hypot(dx, dz), min = BODY_R * 2;
    if (l >= min || l < 1e-4) continue;
    const mass = q => (q.action && q.action.type === 'dunk') ? 1e6 : q.action ? 6 : (q.team !== game.offense && !q.state.startsWith('Run')) ? 5 : ball.holder === q ? 1.2 : 2;
    const ma = mass(a), mb = mass(b), over = min - l, nx = dx / l, nz = dz / l, wa = mb / (ma + mb), wb = ma / (ma + mb);
    if (!(a.action && a.action.type === 'dunk')) { a.pos.x -= nx * over * wa; a.pos.z -= nz * over * wa; }
    if (!(b.action && b.action.type === 'dunk')) { b.pos.x += nx * over * wb; b.pos.z += nz * over * wb; }
    const va = a.vel.x * nx + a.vel.z * nz; if (va > 0) { a.vel.x -= nx * va; a.vel.z -= nz * va; }
    const vb = b.vel.x * nx + b.vel.z * nz; if (vb < 0) { b.vel.x -= nx * vb; b.vel.z -= nz * vb; }
  }
}

// ====================================================================== camera + name tags
let camMode = 'arena'; const camPos = new pc.Vec3(-24, 30, 0), camLook = new pc.Vec3(0, 1, 0);
function updateCamera(dt) {
  // arena cam: the whole screen is drawn (true proportions); the camera is zoomed and shifted so the court sits in the gap
  // between the scoreboard and the hint/meter, so the HUD never covers it
  let aspect = app.graphicsDevice.width / app.graphicsDevice.height, band = null;
  camera.camera.rect = new pc.Vec4(0, 0, 1, 1); camera.camera.scissorRect = camera.camera.rect; camera.camera.aspectRatioMode = pc.ASPECT_AUTO;
  if (camMode === 'arena') {
    const H = document.body.clientHeight || 1, top = Math.max($('board').getBoundingClientRect().bottom, $('ft21').getBoundingClientRect().bottom) + 4;
    const hr = $('hint').getBoundingClientRect(), mr = $('meter').getBoundingClientRect(), bot = Math.min(hr.height > 0 ? hr.top : 1e9, mr.top - 40) - 4;
    const bh = Math.max(0.3 * H, bot - top); band = { H, bh, off: (top + bot) / 2 - H / 2 };
    document.body.style.setProperty('--vt', top.toFixed(0) + 'px'); document.body.style.setProperty('--vb', bot.toFixed(0) + 'px');   // soft fades over the court's top/bottom edges
  }
  const portrait = aspect < 0.9;
  const f = ball.holder ? bodyPos(ball.holder) : ball.pos, att = attackHoop(game.offense).rim.x > 0 ? 1 : -1;
  const fx = pc.math.clamp(f.x + att * 2, -10.5, 10.5), fz = pc.math.clamp(f.z, -4, 4);
  let pos, look, fov;
  if (camMode === 'arena') {
    // Clash Royale style: high above Purple's baseline, looking down the length of the court (court runs bottom to top on a phone)
    const fit = portrait ? 1 : 0.8, drift = pc.math.clamp(f.x, -8, 8) * 0.12;
    const side = HUMAN === 1 ? -1 : 1;   // always look from behind your own basket
    const sh = side * 1.3;   // nudge the view toward the far basket so its backboard has room under the scoreboard
    pos = new pc.Vec3(side * -30 + drift + sh, 27, 0); look = new pc.Vec3(side * 0.8 + drift + sh, -1.5, 0);   /* steeper look-down: less foreshortening, court reads taller */ fov = 40;
    const ab = aspect * band.H / band.bh;                                    // shape of the gap the court must fit
    camera.camera.projection = pc.PROJECTION_ORTHOGRAPHIC; camera.camera.orthoHeight = Math.max(8.5 / ab, 10.4) * band.H / band.bh;
    // when the whole court can't fit (tall phones), keep the scale and pan along the court with the play
    const vis = camera.camera.orthoHeight * band.bh / band.H, need = 15.6 * 0.68 + 1.6;   // half the court as seen at this angle, + backboard
    const far = f.x * side > 0, panMax = Math.max(0, need + (far ? 2.6 : 0) - vis) / 0.68;   // the far backboard stands up toward the scoreboard
    const pan = side * Math.min(1, Math.abs(f.x) / 10) * panMax * Math.sign(f.x * side);
    pos.x += pan - drift - sh; look.x += pan - drift - sh;
  } else if ((camera.camera.projection = pc.PROJECTION_PERSPECTIVE) && camMode === 'broadcast') {
    if (portrait) { pos = new pc.Vec3(fx - att * 9.5, 9.5, fz * 0.3 + 3); look = new pc.Vec3(fx + att * 3, 0.8, fz * 0.4); fov = 58; }
    else { pos = new pc.Vec3(fx * 0.9, 9.2, 17.5); look = new pc.Vec3(fx, 0.6, fz * 0.3); fov = 40; }
  } else {
    pos = new pc.Vec3(fx - att * 7, 3.2, fz * 0.5 + (portrait ? 2.5 : 6)); look = new pc.Vec3(fx + att * 4, 1.3, fz * 0.6); fov = portrait ? 62 : 50;
  }
  if (window.__snapCam) { camPos.copy(pos); camLook.copy(look); window.__snapCam = false; }   // start in place, no swoop
  camPos.lerp(camPos, pos, Math.min(1, dt * 2.2)); camLook.lerp(camLook, look, Math.min(1, dt * 3));
  camera.setPosition(camPos); camera.lookAt(camLook); camera.camera.fov = fov;
  if (band && camMode === 'arena') {   // slide the view so the court's centre lands in the middle of the gap
    const d = band.off * 2 * camera.camera.orthoHeight / band.H; camera.setPosition(camPos.clone().add(camera.up.clone().mulScalar(d)));
  }
  const w = app.graphicsDevice.canvas.clientWidth, sp = new pc.Vec3();
  for (const p of P) {
    const bp = bodyPos(p), top = new pc.Vec3(bp.x, Math.max(2.3, p.head.getPosition().y + 0.75), bp.z);
    w2s(top, sp);
    p.label.style.transform = `translate(${sp.x.toFixed(0)}px, ${sp.y.toFixed(0)}px) translate(-50%,-100%)`;
    p.label.classList.toggle('ball', ball.holder === p);
    p.label.style.display = (camera.camera.projection === pc.PROJECTION_ORTHOGRAPHIC || sp.z > 0) && sp.x > -50 && sp.x < w + 50 ? '' : 'none';
  }
}

// ====================================================================== main loop
function rephase() {   // give every player their own point in whatever loop they are playing (the start pose is set before anim runs)
  for (const p of P) { const L = p.model.anim.baseLayer; if (p.phase === undefined) p.phase = Math.random(); if (CLIPS[L.activeState]) L.activeStateCurrentTime = p.phase * (L.activeStateDuration || 1); }
}
let _phased = 0;
app.on('update', dt => {
  if (_phased < 3 && ++_phased === 3) rephase();
  if (NET.role === 'guest') return guestFrame(dt);
  if (game.paused) return;
  game.time += dt; game.timer -= dt;
  const live = game.phase === 'live' || game.phase === 'air' || game.phase === 'loose';
  if (game.phase === 'intro') { if (game.timer <= 0) { if (!tutSeen() && !NET.role) startTutorial(); else restart(); } }
  else if (game.phase === 'inbound') {
    const h = game.inbounder;
    for (const p of P) if (!p.action) { p.vel.mulScalar(Math.pow(0.05, dt)); setAnim(p, p === h ? 'Idle' : p.team === game.offense ? 'Ready' : 'Defend', 0.25); if (p !== h && p.team === game.offense) faceTo(p, h.pos.x, h.pos.z, 5, dt); }
    if (h && ball.holder === h && !h.action && (game.timer <= 0 && !ctl(h.team) || game.timer < -5)) inboundPass(h);
  }
  else if (game.phase === 'scored') {
    for (const p of P) if (!p.action) { p.vel.mulScalar(Math.pow(0.1, dt)); animMove(p, dt, p.team === game.lastScoreTeam ? 'offball' : 'stance'); }
    if (game.timer <= 0 && !P.some(p => p.action && p.action.type === 'dunk')) { const a = game.andOne; game.andOne = null; if (a) callFoul(a.def, a.shooter, 1, 'And one! Foul'); else inbound(1 - game.lastScoreTeam); }
  } else if (game.phase === 'ftset') {
    for (const p of P) { p.vel.mulScalar(Math.pow(0.05, dt)); if (!p.action) animMove(p, dt, 'stance'); }
    if (game.timer <= 0) { lineUpFT(); game.phase = 'ftwait'; game.timer = 1.2; toast('Free throw ' + (game.ft.n - game.ft.left + 1) + ' of ' + game.ft.n + (ctl(game.ft.shooter.team) ? ' — hold & release' : '')); if (human.on && game.ft.shooter.team !== HUMAN && game.crowd && game.crowd[HUMAN] > 0) setTimeout(() => toastL('Tap to distract the shooter!', false), 1300); }
  } else if (game.phase === 'ftwait') {
    if (game.timer <= -2.4 && !ctl(game.ft.shooter.team)) ftShoot();   // a player-controlled shooter takes it with the meter
  } else if (game.phase === 'ftair') {
    if (game.timer <= 0 || (game.ftMade && game.timer < 1.4) || (!game.ftMade && game.ft.left === 0 && ball.free && ball.pos.y < RIM_Y - 0.7 && ball.vel.y < 0 && game.timer < 2.4)) {
      const f = game.ft;
      if (f.left > 0) { game.phase = 'ftwait'; game.timer = 1.0; lineUpFT(); const nx = 'free throw ' + (f.n - f.left + 1) + ' of ' + f.n; toast(game.ftMade ? 'Good — ' + nx : 'No good — ' + nx); }
      else if (game.ftMade) { game.ft = null; inbound(1 - f.team); }
      else { game.ft = null; game.shot = null; game.phase = 'loose'; ball.lastTouch = f.team; toast('Free throw no good — rebound!'); }
    }
  } else if (game.phase === 'over') {
    for (const p of P) if (!p.action) { p.vel.mulScalar(0.9); setAnim(p, 'Ready', 0.3); }
    if (game.timer <= 0) restart();
  }
  if (live) {
    if (game.phase === 'live' && !TUT) game.shotClock -= dt;
    if (TUT) tutFrame(dt);
    const crashers = ball.free && !ball.pass ? P.slice().sort((a, b) => d2(a.pos, ball.pos) - d2(b.pos, ball.pos)).slice(0, 3) : [];
    for (const p of P) {
      if (p.action) continue;
      if (TUT && !(ball.holder === p && ctl(p.team)) && !(ctl(p.team) && p === myDefender(p.team)) && !(ball.free && !ball.pass && crashers.includes(p))) { tutIdle(p, dt); continue; }
      if (ball.holder === p) (ctl(p.team) ? humanAI : handlerAI)(p, dt);
      else if (ball.free && !ball.pass && (game.phase === 'loose' || (ball.pos.y < 2.6 && ball.vel.y < 0)) && crashers.includes(p)) chase(p, dt);
      else if (p.team === game.offense) offballAI(p, dt);
      else if (ctl(p.team) && p === myDefender(p.team)) humanDefAI(p, dt);
      else defenseAI(p, dt);
    }
    if (ball.pass) {
      ball.pass.t += dt; const r = ball.pass.to;
      if (ball.free && d2(ball.pos, r.pos) < 1.0 && ball.pos.y < 2.4) { give(r); setAnim(r, 'Dribble', 0.12); }
      else if (ball.pass.t > ball.pass.T + 0.5) { ball.pass = null; game.phase = 'loose'; }
    }
    if (game.phase === 'air' && ball.free && ball.pos.y < RIM_Y - 0.7 && !ball.crossed) { game.phase = 'loose'; game.shot = null; const f = game.pendingFoul; if (f) callFoul(f.def, f.shooter, f.pts, 'Shooting foul'); }
    if (ball.free && (Math.abs(ball.pos.x) > 14.7 || Math.abs(ball.pos.z) > 7.6)) {
      const spot = clamp(flat(ball.pos.x * 0.97, ball.pos.z * 0.93));
      (window.__oob = window.__oob || []).push({ pass: !!ball.pass, phase: game.phase, pos: [ball.pos.x.toFixed(1), ball.pos.y.toFixed(1), ball.pos.z.toFixed(1)], vel: [ball.vel.x.toFixed(1), ball.vel.y.toFixed(1), ball.vel.z.toFixed(1)] });
      toast('Out of bounds'); sfx('whistle', 0.7); inbound(1 - ball.lastTouch, spot);
    }
    if (game.phase === 'live' && game.shotClock <= 0 && ball.holder && !ball.holder.action) { toast('Shot clock violation'); sfx('whistle', 0.7); inbound(1 - game.offense, flat(0, 0)); }
  }
  for (const q of P) if (ctl(q.team)) { if (q.drain > 0) q.drain -= dt; else q.stamina = Math.min(1, q.stamina + dt * 0.15); }   // each player has their own stamina
  viewFrame(dt);
  updateActions(dt);
  for (const p of P) if (!p.action || p.action.type === 'steal' || p.action.type === 'pass') p.pos.add(p.vel.clone().mulScalar(dt));
  bodies();
  for (const p of P) {
    if (p.oob) { if (ball.holder !== p && !p.action) { const tgt = clamp(p.pos.clone()); const d = d2(tgt, p.pos); if (d < 0.05) p.oob = false; else { p.pos.lerp(p.pos, tgt, Math.min(1, dt * 3 / d)); animMove(p, dt, 'offball'); } } place(p); continue; }
    if (!p.action || p.action.type !== 'dunk') { clamp(p.pos); place(p); }
  }
  if (ball.free) stepBall(dt);
  crowdFrame(dt); updateCamera(dt); fadeHoops(dt); hud(); netSend();
});
// HUD pieces every screen runs (host or guest): meters, stamina bars, ball ring, dribble sound
function viewFrame(dt) {
  meterTick();
  if (human.freeze > 0) {      // hold the marker where the player stopped it
    human.freeze -= dt;
    if (human.freeze <= 0) { human.mt = 0; if (human.after === 'hide') { human.meter = false; meterEl.className = ''; } human.after = null; }
  } else if (human.meter) { human.mt += dt * (human.mspeed || 1) * (myFT() ? 1 + (game.distract || 0) : 1); markEl.style.left = (50 + 46 * meterPos()) + '%'; }
  if (defMode()) {   // defense: the steal meter shows while your closest defender is in range
    const d = closestDef(), near = d && d2(d.pos, bodyPos(ball.holder)) < 1.6;
    if (near) { if (!human.meter || !human.auto) { human.meter = true; human.auto = true; human.mt = 0; human.stealT0 = performance.now(); meterEl.className = 'show steal'; setZone(0.087); human.mspeed = 1; } $('mlabel').textContent = 'STEAL TIMING'; }
    else if (human.auto && !(human.freeze > 0)) { human.meter = human.auto = false; meterEl.className = ''; }
    for (const q of team(HUMAN)) q.label.classList.toggle('near', q === d && near);
  } else if (human.auto && !(human.freeze > 0)) { human.meter = human.auto = false; meterEl.className = ''; for (const q of P) q.label.classList.remove('near'); }
  if (human.meter && !human.auto && !myBall() && !human.down && !(human.freeze > 0)) { human.meter = false; meterEl.className = ''; }
  if (!human.meter && !(human.freeze > 0)) $('mlabel').textContent = defMode() ? 'STEAL TIMING' : 'SHOT TIMING';
  for (const q of P) { const f = q.label.querySelector('.sbar b'); if (f) { f.style.width = (q.stamina * 100).toFixed(0) + '%'; f.parentNode.classList.toggle('low', q.stamina < 0.25); f.parentNode.hidden = !(human.on && q.team === HUMAN); } }
  const bh = ball.holder; ballRing.enabled = !!bh; if (bh) { const bp = bodyPos(bh); ballRing.setPosition(bp.x, 0.03, bp.z); }   // ring under the ball handler
  const mine = !bh || bh.team === HUMAN || !human.on;   // green: your team has it, red: the other team does
  if (ringMat.mine !== mine) { ringMat.mine = mine; ringMat.emissive = mine ? new pc.Color(0.25, 1.6, 0.45) : new pc.Color(1.7, 0.18, 0.15); ringMat.update(); }
  if (!ball.free) dribbleSound();
  const cs = human.on && game.ft && game.ft.shooter.team !== HUMAN && /^ft/.test(game.phase), cv = (game.crowd || [1, 1])[HUMAN];
  $('crowd').className = cs ? 'show' + (cv <= 0 ? ' empty' : '') : ''; $('crowdfill').style.width = (cv * 100).toFixed(0) + '%';
}

// ====================================================================== sound
let actx = null, master = null, crowdSrc = null, crowdGain = null; const SND = {}, lastPlay = {};
function crowdReact(t) { setTimeout(() => t === HUMAN ? cheer() : sfxL('boo', 0.6), 150); }
function sfx(kind, vol = 1) { netEv('sfx', kind, vol); sfxL(kind, vol); }
function sfxL(kind, vol = 1) {
  if (!actx) return;
  if (SND[kind]) {                                   // recorded samples
    const now = actx.currentTime; if (now - (lastPlay[kind] || -9) < 0.1) return; lastPlay[kind] = now;
    const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = SND[kind]; s.playbackRate.value = 0.94 + Math.random() * 0.12;
    g.gain.value = vol; s.connect(g); g.connect(master); s.start(); return;
  }
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(master);
  const env = (a, d, f0, f1, type) => { o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.start(t); o.stop(t + d); };
  ({ board: () => env(0.18, 0.15, 220, 120, 'square'), block: () => env(0.2, 0.12, 300, 90, 'square') }[kind] || (() => {}))();
}
function startAudio() {
  if (actx) { actx.resume(); return; }
  try { actx = new AudioContext(); } catch (e) { return; }
  master = actx.createGain(); master.gain.value = $('mute').classList.contains('on') ? 0 : 1; master.connect(actx.destination);
  for (const k of ['bounce', 'net', 'cheer', 'crowd', 'boo', 'rim', 'whistle', 'catch', 'pass']) actx.decodeAudioData(bytes(ASSETS['snd_' + k]).buffer).then(buf => {
    SND[k] = buf;
    if (k === 'crowd') { crowdSrc = actx.createBufferSource(); crowdSrc.buffer = buf; crowdSrc.loop = true; const g = crowdGain = actx.createGain(); g.gain.value = 0.35; crowdSrc.connect(g); g.connect(master); crowdSrc.start(); }
  }).catch(() => {});
}
// a made basket: layered cheer clips over a crowd swell that fades back down over ~4 s
function cheer() {
  if (!actx) return; sfxL('cheer', 0.9);
  [0.75, 1.5, 2.3].forEach((d, i) => setTimeout(() => { lastPlay.cheer = -9; sfxL('cheer', 0.7 - i * 0.18); }, d * 1000));
  if (crowdGain) { const t = actx.currentTime, gg = crowdGain.gain; gg.cancelScheduledValues(t); gg.setValueAtTime(gg.value, t); gg.linearRampToValueAtTime(1.0, t + 0.4); gg.setValueAtTime(1.0, t + 2.2); gg.linearRampToValueAtTime(0.35, t + 4.5); }
}
document.addEventListener('pointerdown', startAudio);
// dribble bounce: the held ball's lowest point in the bounce
let dribY = 9, dribDown = false, dribP = null;
function dribbleSound() {
  const h = ball.holder; if (!h || h.action || ball.free) { dribP = null; return; }
  const y = h.ballNode.getPosition().y;
  if (h !== dribP) { dribP = h; dribY = y; dribDown = false; return; }
  if (y < dribY - 0.002) dribDown = true;
  else if (dribDown && y > dribY + 0.002) { if (dribY < 0.35) sfxL('bounce', 0.55); dribDown = false; }
  dribY = y;
}

// ====================================================================== controls
let speed = 1;
$('menu-btn').onclick = () => { $('controls').hidden = !$('controls').hidden; };
$('board').appendChild($('menu-btn'));   // rests on the scoreboard's right corner, as in the reference
$('pause').onclick = () => { game.paused = !game.paused; $('pause').textContent = game.paused ? 'Play' : 'Pause'; app.timeScale = game.paused ? 0 : speed; };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; app.timeScale = game.paused ? 0 : speed; $('speed').textContent = speed + '×'; };
const CAMS = ['arena', 'broadcast', 'follow'], CAMNAME = { arena: 'Arena cam', broadcast: 'Broadcast cam', follow: 'Follow cam' };
$('cam').onclick = () => { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % 3]; $('cam').textContent = CAMNAME[CAMS[(CAMS.indexOf(camMode) + 1) % 3]]; };
$('restart').onclick = () => { if (TUT) endTutorial(true); restart(); };
$('mute').onclick = () => { $('mute').classList.toggle('on'); if (master) master.gain.value = $('mute').classList.contains('on') ? 0 : 1; };
// ====================================================================== player controls (Purple)
// tap court = move ball handler there, tap teammate = pass, hold 1 s = timing meter, release = shoot
let HUMAN = 0;   // the team this screen controls (Teal when joined as a guest)
const ctl = t => (human.on && t === HUMAN) || (NET.role === 'host' && NET.peer && t === 1);
// marker position -1..1; starts at the left edge so the first pass through the centre is catchable
function setZone(halfM) {   // halfM: perfect window half-width in marker units (marker spans 46% of the bar each side)
  human.zone = halfM; const w = halfM * 46 * 2, pf = meterEl.querySelector('.perfect');
  pf.style.left = (50 - w / 2) + '%'; pf.style.width = w + '%';
  meterEl.style.setProperty('--g0', (50 - w / 2) + '%'); meterEl.style.setProperty('--g1', (50 + w / 2) + '%');
}
const meterPos = () => Math.sin(human.mt * Math.PI * 1.15 - Math.PI / 2);
const human = { stamina: 1, lastTap: null, on: true, down: false, t0: 0, x: 0, y: 0, meter: false, mt: 0, target: null };
// screen <-> world for the camera's viewport rectangle (the court is drawn between the HUD bars)
function viewRect() { const c = app.graphicsDevice.canvas, W = c.clientWidth, H = c.clientHeight, r = camera.camera.rect; return { W, H, top: (1 - r.y - r.w) * H, h: Math.max(1, r.w * H) }; }
function w2s(world, out) { return camera.camera.worldToScreen(world, out); }   // the component already honours the viewport rect
function s2w(sx, sy, z) { const v = viewRect(); return camera.camera.camera.screenToWorld(sx, sy - v.top, z, v.W, v.h, new pc.Vec3()); }
function groundAt(sx, sy) {   // invert worldToScreen on the floor (exact for any viewport rect; two Newton steps)
  const g = flat(0, 0), s = new pc.Vec3(), sa = new pc.Vec3(), sb = new pc.Vec3();
  for (let it = 0; it < 4; it++) {
    w2s(g, s); w2s(new pc.Vec3(g.x + 1, 0, g.z), sa); w2s(new pc.Vec3(g.x, 0, g.z + 1), sb);
    const a = sa.x - s.x, b = sb.x - s.x, c = sa.y - s.y, d = sb.y - s.y, det = a * d - b * c; if (Math.abs(det) < 1e-9) return null;
    const ex = sx - s.x, ey = sy - s.y; g.x += (d * ex - b * ey) / det; g.z += (-c * ex + a * ey) / det;
  }
  return Number.isFinite(g.x) && Number.isFinite(g.z) ? g : null;
}
function screenOf(p) { const s = new pc.Vec3(); const bp = bodyPos(p); w2s(new pc.Vec3(bp.x, 1.0, bp.z), s); return s; }
const canEl = $('scene'), meterEl = $('meter'), markEl = $('mark');
function myInbound() { return human.on && game.phase === 'inbound' && game.inbounder && ball.holder === game.inbounder && ball.holder.team === HUMAN && !ball.holder.action && game.timer <= 0; }
function myFT() { return human.on && game.phase === 'ftwait' && game.timer <= 0 && game.ft && ball.holder === game.ft.shooter && ball.holder.team === HUMAN; }
function myBall() { return human.on && ball.holder && ball.holder.team === HUMAN && !ball.holder.action && (game.phase === 'live' || myFT() || myInbound()); }
canEl.addEventListener('pointerdown', e => {
  if (human.on && canDistract(HUMAN)) { act({ t: 'distract', p: -1 }); return; }
  if (!myBall() && !myDefender()) return; const r = canEl.getBoundingClientRect();
  if (defMode()) {
    const d = closestDef();
    // in range with the steal meter up long enough to read it: tap = steal now. A tap right after losing the ball
    // (meter not on screen yet, marker still in the red end) is a move, not a reach-in foul.
    if (d && !d.action && d2(d.pos, bodyPos(ball.holder)) < 1.6 && human.auto && human.meter && performance.now() - (human.stealT0 || 0) > 300) {
      const m = meterPos(); act({ t: 'steal', p: d.id, q: Math.max(0, 1 - Math.abs(m)) }); human.freeze = 0.3; human.after = null; return;
    }
  }
  try { canEl.setPointerCapture(e.pointerId); } catch (_) {}
  Object.assign(human, { down: true, t0: performance.now(), x: e.clientX - r.left, y: e.clientY - r.top });
  if (!human.auto) human.meter = false;
});
function onRelease(e) {
  if (!human.down) return; human.down = false;
  if (defMode()) {           // defense: a short tap moves the closest defender (holding just chases)
    const dd = myDefender(); if (dd && performance.now() - human.t0 < 250) { const g = groundAt(human.x, human.y); if (g) act({ t: 'move', p: dd.id, x: g.x, z: g.z }); } return;
  }
  if (!human.auto && !human.meter) meterEl.className = '';
  const h = ball.holder; if (!myBall()) { human.meter = false; return; }
  if (human.meter) {          // shoot with the meter reading
    const m = meterPos(); human.freeze = 0.7; human.after = 'hide';
    const am = Math.abs(m); act({ t: 'shoot', p: h.id, q: am <= human.zone ? 1 : Math.max(0, 0.9 * (1 - am) / (1 - human.zone)) }); return;
  }
  if (myFT()) return;   // at the line only the shot counts
  if (myInbound()) { human.meter = false; meterEl.className = ''; }
  // tap: teammate under the finger = pass, else move there
  let best = null, bd = 48;
  for (const q of team(HUMAN)) { if (q === h) continue; const s = screenOf(q), d = Math.hypot(s.x - human.x, s.y - human.y); if (d < bd) { bd = d; best = q; } }
  if (best) { act({ t: 'pass', p: h.id, to: best.id }); return; }
  if (myInbound()) return;   // out of bounds: only a pass
  const g = groundAt(human.x, human.y); if (g) act({ t: 'move', p: h.id, x: g.x, z: g.z });
}
window.addEventListener('pointerup', onRelease); canEl.addEventListener('contextmenu', e => e.preventDefault());
function myDefender(t = HUMAN) {
  const h = ball.holder; if (!ctl(t) || !h || h.team === t || game.phase !== 'live') return null;
  let d = null, bd = 1e9; for (const q of team(t)) { const dist = d2(q.pos, bodyPos(h)); if (dist < bd) { bd = dist; d = q; } }
  return d && !d.action ? d : null;
}
function defMode() { const h = ball.holder; return human.on && h && h.team !== HUMAN && game.phase === 'live'; }
function closestDef() { const h = ball.holder; let d = null, bd = 1e9; for (const q of team(HUMAN)) { const x = d2(q.pos, bodyPos(h)); if (x < bd) { bd = x; d = q; } } return d; }
function humanDefAI(p, dt) {
  const h = ball.holder, near = d2(p.pos, bodyPos(h)) < 1.6;
  if (p.team === HUMAN ? human.down : NET.rdown) {
    const hp = bodyPos(h), D = defendHoop(p.team), toR = flat(D.rim.x - hp.x, D.rim.z - hp.z).normalize();
    p.moveTarget = null; steer(p, hp.clone().add(toR.mulScalar(0.9)), 4.0, dt, 16); animMove(p, dt, 'stance'); faceTo(p, hp.x, hp.z, 9, dt);
    if (p.team === HUMAN) p.label.classList.toggle('near', near); return;
  }
  if (p.react > 0) { p.react -= dt; p.vel.mulScalar(Math.pow(0.05, dt)); animMove(p, dt, 'stance'); return; }
  if (p.moveTarget) {
    steer(p, p.moveTarget, 3.6 * sprintMul(p, dt), dt, p.sprint ? 18 : 15); animMove(p, dt, 'stance'); faceTo(p, h.pos.x, h.pos.z, 7, dt);
    if (d2(p.pos, p.moveTarget) < 0.35) { p.moveTarget = null; p.sprint = false; p.sprintT = 0; }
  } else defenseAI(p, dt);            // no order: stay on your man
  if (p.team === HUMAN) p.label.classList.toggle('near', near);
}
// sprint: tapping the same spot again (within 1.5 s) sprints there, burning stamina; empty bar = normal run
function sprintMul(p, dt) {
  // tap-driven sprint: every tap on the same spot adds boost (more the faster you tap); boost always bleeds off,
  // harder the higher it is (resistance), so top speed needs fast, steady tapping. Stop tapping and it eases away.
  p.boost = Math.max(0, (p.boost || 0) - dt * (0.22 + 0.9 * (p.boost || 0) * (p.boost || 0)));
  if (p.stamina <= 0) p.boost = Math.min(p.boost, 0);
  p.sprint = p.boost > 0.12;
  if (p.boost > 0) { p.stamina = Math.max(0, p.stamina - dt * 0.45 * p.boost); p.drain = 0.25; }
  return 1 + 1.1 * p.boost;                                  // up to 2.1x run speed
}
function moveOrder(p, g) {
  g = clamp(g.clone());                                       // compare in-bounds spots (taps past the baseline still count)
  const sameArea = p.moveTarget && d2(p.moveTarget, g) < 2.5, now = performance.now() / 1000;
  if (sameArea && p.stamina > 0.02) {
    const gap = Math.max(0.06, now - (p.lastTap || 0));      // faster taps add more
    p.boost = Math.min(1, (p.boost || 0) + Math.min(0.32, 0.075 / gap) * (1 - 0.55 * (p.boost || 0)));
  } else if (!sameArea) p.boost = (p.boost || 0) * 0.5;      // new destination: keep some momentum
  p.lastTap = now; p.sprintT = 0; if (p.team === HUMAN) tutEvent('move');
  p.moveTarget = g; if (p.team === HUMAN) ring(g, p.boost > 0.12);
}
function humanAI(p, dt) {
  p.holdT += dt;
  if (p.moveTarget) {
    steer(p, p.moveTarget, 3.4 * sprintMul(p, dt), dt, p.sprint ? 18 : 13);
    if (d2(p.pos, p.moveTarget) < 0.35) { p.moveTarget = null; p.sprint = false; p.sprintT = 0; }
  } else p.vel.mulScalar(Math.pow(0.02, dt));
  animMove(p, dt, 'handler');
  if (!p.moveTarget && p.vel.length() < 0.5) { const A = attackHoop(p.team); faceTo(p, A.rim.x, A.rim.z, 5, dt); }
}
function meterTick() {   // a 0.25 s hold brings up the shot meter
  const p = ball.holder; if (!myBall() || myInbound() || !human.down || performance.now() - human.t0 <= 250) return;
    if (!human.meter && performance.now() - human.t0 > 250) { human.meter = true; human.mt = 0; meterEl.className = 'show'; }
    // the more open the shooter, the wider the perfect (green) window
    const op = openness(p), dr = d2(p.pos, attackHoop(p.team).rim);
    const df = dr < 3 ? 1.3 : dr < 5 ? 1.1 : dr < ARC ? 0.9 : dr < 8 ? 0.75 : 0.6;   // closer shots get a wider window too
    setZone(Math.min(0.45, (op < 1.0 ? 0.06 : op < 1.6 ? 0.087 : op < 2.4 ? 0.14 : op < 3.5 ? 0.2 : 0.27) * df));
    human.mspeed = op < 1.0 ? 1.15 : op < 1.6 ? 1.0 : op < 2.4 ? 0.88 : op < 3.5 ? 0.78 : 0.68;   // open shooters get a slower sweep
    $('mlabel').textContent = op < 1.0 ? 'CONTESTED' : op < 1.6 ? 'GUARDED' : op < 2.4 ? 'SPACE' : op < 3.5 ? 'OPEN' : 'WIDE OPEN';
}
const ringEl = $('ring');
function ring(g, sprint) { ringEl.style.borderColor = sprint ? '#ff6a3d' : '#ffd27a'; const s = new pc.Vec3(); w2s(new pc.Vec3(g.x, 0, g.z), s); ringEl.style.left = s.x + 'px'; ringEl.style.top = s.y + 'px'; ringEl.className = ''; void ringEl.offsetWidth; ringEl.className = 'go'; }
$('mode').onclick = () => { human.on = !human.on; $('mode').textContent = human.on ? 'Watch AI' : 'Play'; $('hint').hidden = !human.on; };
// ====================================================================== online head-to-head
// The host's screen runs the whole game (Purple). A guest who joins controls Teal: their taps travel to the
// host as commands, and the host streams the game state back. Both ride on the room's presence channel.
const STATES = ['Idle', 'Dribble', 'Shoot', 'Dunk', 'Run', 'RunB', 'RunC', 'DribbleRun', 'Defend', 'Block', 'Ready', 'Pass', 'Steal', 'SlideL', 'SlideR'];
const ACTS = ['', 'shoot', 'dunk', 'pass', 'block', 'steal'];
function netEv(type, a, b) {   // host: queue something the guest should also see or hear
  if (NET.role !== 'host' || !NET.peer) return;
  NET.ev.push([++NET.evSeq, type, a, b]); if (NET.ev.length > 14) NET.ev.shift();
}
function act(c) {               // a command from this screen's player
  if (NET.role === 'guest') {
    c.n = ++NET.seq; NET.cmds.push(c); if (NET.cmds.length > 8) NET.cmds.shift();
    if (c.t === 'move') ring(flat(c.x, c.z), false);
    NET.room.presence({ cmds: NET.cmds, down: false }).catch(() => {});
  } else apply(c, HUMAN);
}
function apply(c, t) {          // runs on the host only; t = the team the command came from
  if (c.t === 'distract') return distract(t);
  const p = P[c.p]; if (!p || p.team !== t) return;
  if (game.phase === 'ftwait' && c.t === 'shoot' && game.ft && game.ft.shooter === p && game.timer <= 0) return ftShoot(Math.max(0, Math.min(1, +c.q || 0)));
  if (game.phase === 'inbound' && c.t === 'pass' && game.inbounder === p && game.timer <= 0) { const r = P[c.to]; if (r && r.team === t && r !== p) inboundPass(p, r); return; }
  if (game.phase !== 'live' && c.t !== 'move') return;
  const q = Math.max(0, Math.min(1, +c.q || 0));
  if (c.t === 'move') { if (Number.isFinite(c.x) && Number.isFinite(c.z)) moveOrder(p, flat(c.x, c.z)); }
  else if (c.t === 'steal') { const h = ball.holder; if (!p.action && h && h.team !== t && d2(p.pos, bodyPos(h)) < 1.9) { p.stealQ = q; p.moveTarget = null; startSteal(p); } }
  else if (ball.holder !== p || p.action) return;
  else if (c.t === 'shoot') { p.shotQ = q; p.moveTarget = null; startShot(p); }
  else if (c.t === 'pass') { const r = P[c.to]; if (r && r !== p && r.team === t) { r.lastPasser = p; p.moveTarget = null; startPass(p, r); } }
}
const r2 = v => Math.round(v * 100) / 100;
function netSend() {            // host: stream the state to the guest (presence is coalesced to ~30 Hz)
  if (NET.role !== 'host' || !NET.peer) return;
  const now = performance.now(); if (now - NET.sent < 40) return; NET.sent = now;
  const s = {
    ph: game.phase, sc: game.score, sk: Math.max(0, Math.ceil(game.shotClock)), of: game.offense,
    bh: ball.holder ? ball.holder.id : -1, ft: game.ft ? game.ft.shooter.id : -1, ib: game.inbounder ? game.inbounder.id : -1, cr: (game.crowd || [1, 1]).map(r2), dz: r2(game.distract || 0), tm: r2(game.timer), b: [r2(ball.pos.x), r2(ball.pos.y), r2(ball.pos.z)],
    p: P.map(p => [r2(p.pos.x), r2(p.pos.z), r2(p.yaw), STATES.indexOf(p.state), r2(p.model.anim.speed), ACTS.indexOf(p.action ? p.action.type : ''), r2(p.stamina)])
  };
  NET.room.presence({ host: 1, s, ev: NET.ev }).catch(() => {});
}
function onHostState(pr) {      // guest: take in the host's latest state
  if (!pr || !pr.s) return; NET.snap = pr.s;
  for (const e of (Array.isArray(pr.ev) ? pr.ev : [])) {
    if (!(e[0] > NET.lastEv)) continue; NET.lastEv = e[0];
    if (e[1] === 'toast') toast(String(e[2]).slice(0, 80), !!e[3]);
    else if (e[1] === 'sfx' && typeof e[2] === 'string') sfxL(e[2], +e[3] || 1);
    else if (e[1] === 'score') crowdReact(e[2]);
    else if (e[1] === 'shake') shake(game.ft ? game.ft.shooter.team : -1);
    else if (e[1] === 'ban') { $('banner').textContent = String(e[2]).slice(0, 40); $('banner').className = e[3] === 'show t0' || e[3] === 'show t1' ? e[3] : ''; }
  }
}
function guestFrame(dt) {
  const s = NET.snap;
  if (s) {
    game.phase = s.ph; game.score = s.sc; game.ft = s.ft >= 0 ? { shooter: P[s.ft] } : null; game.inbounder = s.ib >= 0 ? P[s.ib] : null; game.crowd = s.cr || [1, 1]; game.distract = s.dz || 0; game.timer = s.tm; game.shotClock = s.sk; game.offense = s.of;
    const k = Math.min(1, dt * 14);
    P.forEach((p, i) => {
      const v = s.p[i]; if (!v) return;
      const tx = v[0], tz = v[1], far = Math.hypot(tx - p.pos.x, tz - p.pos.z) > 3;
      p.pos.x += (tx - p.pos.x) * (far ? 1 : k); p.pos.z += (tz - p.pos.z) * (far ? 1 : k);
      let dy = Math.atan2(Math.sin(v[2] - p.yaw), Math.cos(v[2] - p.yaw)); p.yaw += dy * (far ? 1 : k);
      const st = STATES[v[3]]; if (st) { if (p.state === 'Dunk' && st !== 'Dunk') p.rootBone.setLocalPosition(0, 0, 0); setAnim(p, st, 0.12, v[4]); }
      const a = ACTS[v[5]]; p.action = a ? { type: a } : null; p.stamina = v[6];
      place(p);
    });
    const h = s.bh >= 0 ? P[s.bh] : null;
    if (h !== ball.holder || (!h) !== ball.free) {
      if (h) { ball.holder = h; ball.free = false; ball.ent.enabled = false; for (const q of P) q.ballNode.enabled = q === h; }
      else { ball.holder = null; ball.free = true; ball.ent.enabled = true; for (const q of P) q.ballNode.enabled = false; ball.pos.set(s.b[0], s.b[1], s.b[2]); }
    }
    if (ball.free) {
      const far = Math.hypot(s.b[0] - ball.pos.x, s.b[1] - ball.pos.y, s.b[2] - ball.pos.z) > 2.5, kb = far ? 1 : Math.min(1, dt * 20);
      ball.pos.x += (s.b[0] - ball.pos.x) * kb; ball.pos.y += (s.b[1] - ball.pos.y) * kb; ball.pos.z += (s.b[2] - ball.pos.z) * kb;
      ball.ent.setPosition(ball.pos);
    }
  }
  if (NET.room) NET.room.presence({ down: !!(human.down && defMode()) }).catch(() => {});
  viewFrame(dt); updateCamera(dt); fadeHoops(dt); hud();
}

// ---- lobby: "Online" opens a panel; hosts advertise a game in the lobby, guests pick one to join
const panel = document.createElement('div'); panel.id = 'online'; panel.hidden = true;
panel.innerHTML = '<b>Play online</b><p id="onmsg">Host a game, then send this page\'s link to a friend. When they open it and tap <i>Online</i>, your game shows up for them to join.</p><div id="onlist"></div><div class="onrow"><button id="onhost">Host a game</button><button id="onclose">Close</button></div>';
document.body.appendChild(panel);
const onBtn = document.createElement('button'); onBtn.id = 'online-btn'; onBtn.textContent = 'Online'; onBtn.hidden = true; $('controls').prepend(onBtn);
onBtn.onclick = () => { panel.hidden = !panel.hidden; renderLobby(); };
$('onclose').onclick = () => { panel.hidden = true; };
function renderLobby() {
  const list = $('onlist'); list.textContent = '';
  if (NET.role) { $('onhost').textContent = 'Leave online game'; return; }
  $('onhost').textContent = 'Host a game';
  const open = NET.lobby ? NET.lobby.peers().filter(p => !p.sameTab && p.presence && typeof p.presence.open === 'string' && /^[a-z0-9]{4,8}$/.test(p.presence.open)) : [];
  if (!open.length) { const i = document.createElement('i'); i.textContent = 'No open games yet.'; list.appendChild(i); }
  for (const p of open) { const b = document.createElement('button'); b.textContent = 'Join game ' + p.presence.open.toUpperCase(); b.onclick = () => joinGame(p.presence.open); list.appendChild(b); }
}
function onlineMode(on, team) {
  if (TUT) endTutorial(true); tutBtn.hidden = on;
  HUMAN = team; human.on = true; game.paused = false; app.timeScale = 1; speed = 1; $('speed').textContent = '1×'; $('pause').textContent = 'Pause';
  for (const id of ['mode', 'pause', 'speed', 'restart']) $(id).hidden = on;
  $('hint').innerHTML = (on ? 'You are <b>' + (team ? 'Teal' : 'Purple') + '</b> &nbsp;•&nbsp; ' : '') + 'Tap to move &nbsp;•&nbsp; Tap teammate to pass &nbsp;•&nbsp; Hold to shoot';
  $('hint').hidden = false; human.meter = human.auto = false; meterEl.className = '';
}
async function leaveGame(msg) {
  const r = NET.room; NET.role = NET.peer = NET.room = NET.snap = NET.code = null; NET.rdown = false;
  if (r) r.leave().catch(() => {}); if (NET.lobby) NET.lobby.presence({ open: null }).catch(() => {});
  onlineMode(false, 0); if (msg) toast(msg, true); restart(); renderLobby();
}
$('onhost').onclick = async () => {
  if (NET.role) return leaveGame('Left the online game');
  const code = Math.random().toString(36).slice(2, 7);
  let room; try { room = await NET.api.join('cc-' + code); } catch (e) { $('onmsg').textContent = 'Could not open a game here (' + (e && e.code || 'error') + ').'; return; }
  Object.assign(NET, { role: 'host', room, code, peer: null, ev: [], evSeq: 0, lastCmd: 0 });
  NET.lobby.presence({ open: code }).catch(() => {});
  $('onmsg').textContent = 'Game ' + code.toUpperCase() + ' is open. Waiting for your friend to join…'; renderLobby();
  room.onPeers(ch => {
    if (!NET.peer) { const g = ch.peers.find(p => !p.sameTab && p.presence && p.presence.guest); if (g) {
      NET.peer = g.peer; NET.lobby.presence({ open: null }).catch(() => {}); panel.hidden = true; onlineMode(true, 0); restart(); toastL('Friend joined — you are Purple', true); } }
    if (NET.peer && ch.left.some(p => p.peer === NET.peer)) return leaveGame('Your friend left');
    const g = ch.peers.find(p => p.peer === NET.peer); if (!g) return;
    const pr = g.presence; NET.rdown = !!pr.down;
    for (const c of (Array.isArray(pr.cmds) ? pr.cmds : [])) if (c && c.n > NET.lastCmd) { NET.lastCmd = c.n; apply(c, 1); }
  });
};
async function joinGame(code) {
  let room; try { room = await NET.api.join('cc-' + code); } catch (e) { $('onmsg').textContent = 'Could not join (' + (e && e.code || 'error') + ').'; return; }
  Object.assign(NET, { role: 'guest', room, code, seq: 0, cmds: [], lastEv: 0, snap: null, peer: null });
  room.presence({ guest: 1, cmds: [], down: false }).catch(() => {});
  onlineMode(true, 1); panel.hidden = true; toast('Joining game ' + code.toUpperCase() + '…', true);
  room.onPeers(ch => {
    const h = ch.peers.find(p => !p.sameTab && p.presence && p.presence.host);
    if (h) { if (!NET.peer) { NET.peer = h.peer; toast('Connected — you are Teal', true); } if (h.peer === NET.peer) onHostState(h.presence); }
    if (NET.peer && ch.left.some(p => p.peer === NET.peer)) leaveGame('The host left');
  });
}
(async () => {   // light up the Online button only where the page can reach a room
  try { if (!window.claude || !window.claude.use) return; const api = await window.claude.use('room'); if (!api) return;
    NET.api = api; NET.lobby = api; onBtn.hidden = false; api.onPeers(() => { if (!panel.hidden) renderLobby(); });
  } catch (e) {}
})();

// ====================================================================== tutorial
// A guided practice on an empty court: each step waits for the player to do the thing, then sets up the next.
var TUT = null;
const TSTEPS = [
  { title: 'Move', text: 'Tap anywhere on the court. Your ball handler (green ring) runs there.' },
  { title: 'Sprint', text: 'Tap a spot far away, then keep tapping the same spot. Each extra tap adds sprint time and uses stamina (the bar over your player).' },
  { title: 'Pass', text: 'Tap a teammate to pass them the ball.' },
  { title: 'Shoot', text: 'Hold your finger down. After a moment the shot meter appears. Let go when the marker is inside the white box. The more open and closer you are, the bigger the green zone.' },
  { title: 'Steal', text: 'Now Teal has the ball. Get close and the steal meter appears. Tap when the marker is in the middle. Tapping in the red ends can be a foul.' }
];
const tutEl = document.createElement('div'); tutEl.id = 'tut'; tutEl.hidden = true;
tutEl.innerHTML = '<div class="tsteps" id="tdots"></div><b id="ttitle"></b><p id="ttext"></p><div class="trow"><span id="tok"></span><button id="tskip">Skip tutorial</button></div>';
document.body.appendChild(tutEl);
const tutBtn = document.createElement('button'); tutBtn.id = 'tut-btn'; tutBtn.textContent = 'Tutorial'; $('controls').prepend(tutBtn);
tutBtn.onclick = () => TUT ? endTutorial() : startTutorial();
$('tskip').onclick = () => endTutorial();
function tutSeen() { try { return localStorage.getItem('cc_tut') === '1'; } catch (e) { return true; } }
function startTutorial() {
  if (NET.role) return;
  TUT = { step: 0, done: false, wait: 0, moved: false, mates: 0, holder: null };
  human.on = true; $('mode').textContent = 'Watch AI'; $('banner').className = ''; game.score = [0, 0]; hud();
  $('hint').hidden = true; tutEl.hidden = false; tutBtn.textContent = 'Exit'; tutSetup();
}
function endTutorial(silent) {
  if (!TUT) return; TUT = null; tutEl.hidden = true; tutBtn.textContent = 'Tutorial'; $('hint').hidden = !human.on;
  try { localStorage.setItem('cc_tut', '1'); } catch (e) {}
  if (!silent) restart();
}
function tutSetup() {
  const s = TUT.step, A = attackHoop(HUMAN), dir = Math.sign(A.rim.x), pur = team(HUMAN), tea = team(1 - HUMAN);
  const at = (p, x, z) => { p.pos.copy(flat(x, z)); p.vel.set(0, 0, 0); p.action = null; delete p.pendingBlock; p.moveTarget = null; p.sprintT = 0; p.stamina = 1; p.rootBone.setLocalPosition(0, 0, 0); faceTo(p, A.rim.x, 0); place(p); };
  if (s < 4) {
    at(pur[0], A.rim.x - dir * (s === 3 ? 4.2 : 9), s === 3 ? 1.2 : 0); at(pur[1], A.rim.x - dir * 7, 4.5); at(pur[2], A.rim.x - dir * 7, -4.5);
    tea.forEach((p, i) => at(p, -A.rim.x + dir * 2, (i - 1) * 3));   // Teal waits at the far end
    give(s === 3 && TUT.holder ? TUT.holder : pur[0]);
    if (s === 3) { const h = ball.holder; at(h, A.rim.x - dir * 4.2, 1.2); }
  } else {
    at(tea[0], A.rim.x - dir * 8, 0); at(tea[1], A.rim.x - dir * 4, 5.5); at(tea[2], A.rim.x - dir * 4, -5.5);
    at(pur[0], A.rim.x - dir * 5.2, 0.6); at(pur[1], A.rim.x - dir * 2, 4); at(pur[2], A.rim.x - dir * 2, -4);
    give(tea[0]); faceTo(tea[0], -A.rim.x, 0); place(tea[0]);
  }
  for (const p of P) setAnim(p, p === ball.holder ? 'Dribble' : p.team === HUMAN ? 'Ready' : 'Defend', 0.1, 0.9 + 0.2 * (p.phase || 0));
  game.phase = 'live'; game.shotClock = SHOT_CLOCK; game.shot = null; TUT.moved = false; TUT.wait = 0; TUT.done = false; TUT.passes = stats.pass;
  $('tdots').innerHTML = TSTEPS.map((_, i) => '<i class="' + (i < s ? 'd' : i === s ? 'c' : '') + '"></i>').join('');
  $('ttitle').textContent = (s + 1) + ' / ' + TSTEPS.length + ' · ' + TSTEPS[s].title; $('ttext').textContent = TSTEPS[s].text; $('tok').textContent = '';
}
function tutEvent(kind, who) {
  if (!TUT) return;
  if (kind === 'move') TUT.moved = true;
  else if (kind === 'made' && TUT.step === 3) tutPass('Bucket! Perfect timing makes it a sure thing.');
  else if (kind === 'foul') { toastL('Foul on ' + who.name + ' — tap closer to the middle', true); sfxL('whistle', 0.8); TUT.wait = 1.6; TUT.reset = true; }
}
function tutPass(msg) { if (TUT.done) return; TUT.done = true; TUT.wait = 1.8; $('tok').textContent = '✓ ' + msg; sfxL('net', 0.5); }
function tutFrame(dt) {
  const s = TUT.step, h = ball.holder;
  if (TUT.wait > 0) {
    TUT.wait -= dt; if (TUT.wait > 0) return;
    if (TUT.done) { TUT.step++; if (TUT.step >= TSTEPS.length) { endTutorial(true); toastL("You're ready — game on!", true); restart(); return; } }
    TUT.reset = false; tutSetup(); return;
  }
  if (TUT.done) return;
  if (s === 0 && TUT.moved && h && h.team === HUMAN && !h.moveTarget) tutPass('Nice. Tap anywhere to move.');
  else if (s === 1 && h && h.sprint) tutPass('Sprinting! Watch the stamina bar drain.');
  else if (s === 2 && h && h.team === HUMAN && stats.pass > TUT.passes && !ball.pass) { TUT.holder = h; tutPass('Good pass.'); }
  else if (s === 3 && game.phase === 'loose' && !TUT.miss) { TUT.miss = true; $('tok').textContent = 'Missed — try again. Aim for the white box.'; setTimeout(() => { if (TUT && TUT.step === 3 && !TUT.done) { TUT.miss = false; TUT.wait = 0.01; } }, 1400); }
  else if (s === 4 && ((h && h.team === HUMAN) || (ball.free && ball.lastTouch === HUMAN && game.phase === 'loose'))) tutPass('Steal! That is how you get the ball back.');
  if (s === 4 && game.phase === 'loose' && ball.lastTouch !== HUMAN && !TUT.done) TUT.wait = 1.0;   // a whiff: reset
}
function tutIdle(p, dt) {   // everyone the player isn't controlling waits in place
  p.vel.mulScalar(Math.pow(0.02, dt));
  const mode = ball.holder === p ? 'handler' : ball.holder && ball.holder.team === p.team ? 'offball' : 'stance';
  if (p.vel.length() > 0.6) animMove(p, dt, mode);                 // only animate movement when actually moving
  else setAnim(p, mode === 'handler' ? 'Dribble' : mode === 'offball' ? 'Ready' : 'Defend', 0.25);   // waiting: stand, no running in place
  const b = ball.holder ? bodyPos(ball.holder) : ball.pos; if (ball.holder !== p) faceTo(p, b.x, b.z, 4, dt);
}

// ---- home screen: the match waits behind it until Play
function showHome() { $('home').hidden = false; game.paused = true; if (TUT) endTutorial(true); $('controls').hidden = true; tutBtn.hidden = true; }
function leaveHome() { window.__snapCam = true; $('home').hidden = true; game.paused = false; app.timeScale = speed; tutBtn.hidden = !!NET.role; }
$('hplay').onclick = () => { leaveHome(); restart(); };
$('hprac').onclick = () => { leaveHome(); startTutorial(); };
$('hgear').onclick = () => { $('controls').hidden = !$('controls').hidden; };
// ====================================================================== team management (My Team / Edit Team / Draft / Player Details)
const STATS = ['speed', 'shooting', 'passing', 'defense', 'rebounding'];
const COLORS = [['PURPLE', '#7b3cf0'], ['TEAL', '#19c6c0'], ['RED', '#e0283a'], ['BLUE', '#2a7de8'], ['ORANGE', '#f5821f'], ['GREEN', '#22a83a'], ['WHITE', '#f2f2f2'], ['BLACK', '#1a1a1a']];
const MASCOTS = ["wolf", "bull", "falcon", "panther", "bear", "shark", "lion", "tiger", "eagle", "cobra", "rhino", "gorilla", "fox", "ram", "stag", "gator", "dragon", "scorpion", "stallion", "howler", "owl", "bat", "hornet", "boar", "kraken", "bolts", "fireball", "kings", "shield", "comets", "bison", "elephant", "hippo", "doberman", "raccoon", "crab", "mantis", "spider", "beetle", "lobster", "rooster", "peacock", "penguin", "hawk", "pelican", "hyena", "badger", "wolverine", "porcupine", "jackrabbit", "gargoyle", "knight", "mech", "alien", "pirate", "volcano", "wave", "cyclone", "summit", "rocket", "lightning", "shooting star", "crown", "diamond", "flame", "guardian", "sun", "moon", "peaks", "tornado", "axes", "hammers", "swords", "anchor", "tower", "chevrons", "links", "infinity", "delta", "compass", "power", "hourglass", "chain", "target", "planet", "fastbreak", "launch", "hex", "apex", "trident"];   // 90 logos; the first six keep the original order
const DRAFT_NAMES = ['Malik', 'Theo', 'Cruz', 'Dex', 'Remy', 'Zane', 'Omar', 'Luka', 'Ty', 'Niko', 'Ace', 'Jett', 'Rio', 'Sol', 'Bo', 'Kofi', 'Ezra', 'Max'];
const ROSTER_MAX = 9;
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.'&", FONTS = ['BLOCK', 'SPEED', 'CRACKED'];
const letters = (s, f) => '<span class="lw">' + [...String(s).toUpperCase()].map(ch => ch === ' ' ? '<i class="sp"></i>' : GLYPHS.indexOf(ch) >= 0 ? '<i class="lt' + f + ' c' + GLYPHS.indexOf(ch) + '"></i>' : '').join('') + '</span>';
const ovr = r => Math.round(STATS.reduce((a, k) => a + r.stats[k], 0) / STATS.length);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function newPlayer(name, base, hair) {
  const stats = {}; for (const k of STATS) stats[k] = Math.max(35, Math.min(85, base + rnd(-12, 12)));
  return { name, lv: 1, hair: hair === undefined ? rnd(0, 19) : hair, tint: rnd(0, 5), stats };
}
function defaultTeam() {
  const r = [['Rook', 64, 0, 4], ['Blaze', 62, 6, 3], ['Jax', 60, 13, 2], ['Kai', 61, 9, 2], ['Nova', 59, 14, 1], ['Theo', 58, 19, 1]].map(([n, b, h, l]) => { const p = newPlayer(n, b, h); p.lv = l; p.tint = h % 6; return p; });
  return { name: 'CITY WOLVES', color: 0, mascot: 0, xp: 640, roster: r, draft: null };
}
let TEAM;
try { TEAM = JSON.parse(localStorage.getItem('cc_team')) || defaultTeam(); } catch (e) { TEAM = defaultTeam(); }
function saveTeam() { try { localStorage.setItem('cc_team', JSON.stringify(TEAM)); } catch (e) {} }
const upCost = r => 50 * r.lv;
function teamXP(n) { TEAM.xp += Math.round(n); saveTeam(); }
// starters drive the Purple players on court: names, hairstyles, speed and shooting
function jerseyTex(base, ci) {   // recolour the purple jersey texture to a team colour, keeping its shading
  const k = '_j' + ci; if (base[k]) return base[k];
  const src = base.getSource(); if (!src || !src.width) return base;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data, hx = COLORS[ci][1], T3 = [1, 3, 5].map(i => parseInt(hx.substr(i, 2), 16));
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gg = p[i + 1], b = p[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), s = mx ? (mx - mn) / mx : 0; if (s < 0.2 || mx < 15) continue;
    const dd = mx - mn; let h = mx === r ? ((gg - b) / dd + 6) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4; h *= 60; if (h < 230 || h > 315) continue;
    const w = Math.min(1, (s - 0.2) / 0.25), L = (0.3 * r + 0.59 * gg + 0.11 * b) / 99;
    for (let j = 0; j < 3; j++) { const n = T3[j] * L + Math.max(0, L - 1) * 90; p[i + j] = p[i + j] * (1 - w) + Math.min(255, n) * w; }
  }
  g.putImageData(d, 0, 0);
  const tex = new pc.Texture(app.graphicsDevice, { width: c.width, height: c.height, format: base.format, mipmaps: true, flipY: base.flipY, addressU: base.addressU, addressV: base.addressV, minFilter: base.minFilter, magFilter: base.magFilter, anisotropy: base.anisotropy });
  tex.setSource(c); return (base[k] = tex);
}
function paintJersey(model, ci) {
  for (const r of model.findComponents('render')) for (const mi of r.meshInstances) {
    const m0 = mi.material; if (!m0 || (m0.name !== 'player' && !mi._jBase)) continue;
    if (!mi._jBase) { mi._jBase = m0.diffuseMap; mi.material = m0.clone(); }
    if (mi._jBase && mi._jCol !== ci) { mi._jCol = ci; mi.material.diffuseMap = jerseyTex(mi._jBase, ci); mi.material.update(); }
  }
}
function applyRoster() {
  T.style.setProperty('--tc', COLORS[TEAM.color][1]);
  team(0).forEach(p => paintJersey(p.model, TEAM.color));
  team(0).forEach((p, i) => {
    const r = TEAM.roster[i]; if (!r) return;
    p.name = r.name.toUpperCase().slice(0, 1) + r.name.slice(1).toLowerCase(); if (p.label.firstChild) p.label.firstChild.nodeValue = p.name;
    if (p.hairKey !== r.hair + ':' + r.tint) { p.hairEnt = setHair(p.model, r.hair, r.tint, p.hairEnt); p.hairKey = r.hair + ':' + r.tint; }
    if (p.spd0 === undefined) p.spd0 = p.spd; p.spd = p.spd0 * (0.86 + r.stats.speed / 300); p.rat = r.stats;
  });
}
// ---- portraits: photograph the real 3D player (with their hairstyle) once, then reuse the picture
const PORTRAIT = {};
let studio = null;
function portrait(r) {
  const key = r.hair + ':' + r.tint + ':' + TEAM.color; if (PORTRAIT[key]) return PORTRAIT[key];
  try {
    if (!studio) {
      studio = new pc.Entity('studio'); app.root.addChild(studio); studio.setPosition(0, -200, 0);
      const m = playerAsset.resource.instantiateRenderEntity(); studio.addChild(m); m.setLocalScale(1, 1, 1); studio.model = m;
      const cam = new pc.Entity('pcam'); cam.addComponent('camera', { clearColor: new pc.Color(0.16, 0.08, 0.36), fov: 26, nearClip: 0.05, farClip: 10, enabled: false });
      app.root.addChild(cam); studio.cam = cam;
      const key2 = new pc.Entity(); key2.addComponent('light', { type: 'omni', range: 6, intensity: 1.6, color: new pc.Color(1, 0.95, 0.9) }); app.root.addChild(key2); key2.setPosition(0.5, -198.9, 1.2); studio.light = key2;
    }
    paintJersey(studio.model, TEAM.color); { const h = COLORS[TEAM.color][1], q = i => parseInt(h.substr(i, 2), 16) / 255 * 0.32; studio.cam.camera.clearColor = new pc.Color(q(1) + 0.02, q(3) + 0.02, q(5) + 0.04); }
    studio.hair = setHair(studio.model, r.hair, r.tint, studio.hair);
    const cam = studio.cam; cam.setPosition(0.22, -199.08, 1.45); cam.lookAt(0, -199.17, 0);
    const main = camera.camera, wasRect = main.enabled; main.enabled = false; cam.camera.enabled = true;
    app.render();
    const c = app.graphicsDevice.canvas, s = Math.min(c.width, c.height), out = document.createElement('canvas'); out.width = out.height = 256;
    out.getContext('2d').drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 0, 0, 256, 256);
    cam.camera.enabled = false; main.enabled = wasRect; app.render();
    return (PORTRAIT[key] = out.toDataURL('image/jpeg', 0.85));
  } catch (e) { return ''; }
}
// ---- small helpers for the screens
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, set = 'w') => '<span class="dg">' + [...String(v)].map(c => /\d/.test(c) ? '<i class="t3' + set + c + '"></i>' : '<b>' + esc(c) + '</b>').join('') + '</span>';
const pic = r => '<img class="pt" alt="" src="' + portrait(r) + '">';
const teamRating = () => Math.round(TEAM.roster.slice(0, 3).reduce((a, r) => a + ovr(r), 0) / Math.max(1, Math.min(3, TEAM.roster.length)));
let TSEL = 0, DSEL = 1, LINEUP = null;
const T = $('team');
function fitNames() {   // shrink the sprite lettering until the name fits its slot
  T.querySelectorAll('.tn, .hn').forEach(box => { const lw = box.querySelector('.lw'); if (!lw) return; box.style.fontSize = ''; lw.style.height = '';
    let fs = parseFloat(getComputedStyle(box).fontSize), max = box.clientWidth - 4;
    for (let k = 0; k < 30 && lw.scrollWidth > max && fs > 7; k++) { fs *= 0.92; box.style.fontSize = fs + 'px'; lw.style.height = fs + 'px'; } });
}
function openTeam(view, arg) {
  if (arg !== undefined) TSEL = arg; if (view === 'edit' && T.dataset.view !== 'edit') { EDIT = null; const o = T.querySelector('#tname'); if (o) o.remove(); } if (view !== 'team') T.classList.remove('swap'); T.hidden = false; $('home').hidden = true;
  T.querySelectorAll('.scr').forEach(s => s.hidden = s.dataset.v !== view); T.dataset.view = view;
  T.querySelectorAll('.tnav button').forEach(b => b.classList.toggle('on', b.dataset.go === view || (view === 'details' && b.dataset.go === 'details')));
  T.style.setProperty('--tc', COLORS[view === 'edit' && EDIT ? EDIT.color : TEAM.color][1]);
  ({ team: drawTeam, edit: drawEdit, draft: drawDraft, details: drawDetails })[view]();
  T.querySelector('.scr[data-v="' + view + '"] .body').scrollTop = 0;
}
function closeTeam() { T.hidden = true; $('home').hidden = false; applyRoster(); }
T.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, v = b.dataset.val;
  if (a === 'back') { if (T.dataset.view === 'team') closeTeam(); else openTeam('team'); }
  else if (a === 'go') openTeam(v);
  else if (a === 'player') openTeam('details', +v);
  else if (a === 'lineup') {                      // tap two players to swap them (starters <-> bench)
    if (LINEUP === null) { LINEUP = +v; toastL('Now tap a player to swap with ' + TEAM.roster[+v].name, false); drawTeam(); }
    else { const i = LINEUP, j = +v; LINEUP = null; [TEAM.roster[i], TEAM.roster[j]] = [TEAM.roster[j], TEAM.roster[i]]; saveTeam(); applyRoster(); drawTeam(); }
  }
  else if (a === 'editlineup') { LINEUP = null; const on = T.classList.toggle('swap'); toastL(on ? 'Tap a player, then the player to swap with' : 'Lineup saved', false); drawTeam(); }
  else if (a === 'color') { EDIT.color = +v; T.style.setProperty('--tc', COLORS[EDIT.color][1]); drawEdit(); }
  else if (a === 'font') { EDIT.font = +v; drawEdit(); }
  else if (a === 'mascot') { EDIT.mascot = +v; const sc = T.querySelector('.masc').scrollTop; drawEdit(); T.querySelector('.masc').scrollTop = sc; }
  else if (a === 'saveteam') { TEAM.name = (T.querySelector('#tname').value || 'MY TEAM').toUpperCase().slice(0, 20); TEAM.color = EDIT.color; TEAM.mascot = EDIT.mascot; TEAM.font = EDIT.font; saveTeam(); applyRoster(); toastL('Team saved', false); openTeam('team'); }
  else if (a === 'pick') { DSEL = +v; drawDraft(); }
  else if (a === 'draftit') {
    if (TEAM.roster.length >= ROSTER_MAX) return toastL('Roster full (' + ROSTER_MAX + ' players)', true);
    const p = TEAM.draft[DSEL]; TEAM.roster.push(p); TEAM.draft = null; saveTeam(); toastL(p.name.toUpperCase() + ' drafted!', true); sfxL('cheer', 0.6); openTeam('team');
  }
  else if (a === 'ustat') {   // ask before spending XP on one stat
    const r = TEAM.roster[TSEL] || TEAM.roster[0], c = upCost(r), to = Math.min(99, r.stats[v] + NEXT[v]); if (r.stats[v] >= 99) return toastL(v.toUpperCase() + ' is maxed', false);
    let m = T.querySelector('#ucf'); if (!m) { m = el('div'); m.id = 'ucf'; T.appendChild(m); }
    m.innerHTML = `<div class="box"><h3>UPGRADE ${v.toUpperCase()}?</h3><div class="chg">${r.stats[v]} ▸ <b>${to}</b></div><div class="cst">Cost <b>${c} XP</b> · you have ${TEAM.xp} XP</div><div class="bts"><button class="no" data-act="ucancel">CANCEL</button><button class="ok${TEAM.xp < c ? ' off' : ''}" data-act="upgrade" data-val="${v}">UPGRADE</button></div></div>`;
    m.hidden = false;
  }
  else if (a === 'ucancel') T.querySelector('#ucf').hidden = true;
  else if (a === 'upgrade') {
    const r = TEAM.roster[TSEL] || TEAM.roster[0], c = upCost(r); if (TEAM.xp < c) return toastL('Not enough XP — earn XP by playing games', false);
    T.querySelector('#ucf').hidden = true;
    TEAM.xp -= c; r.stats[v] = Math.min(99, r.stats[v] + NEXT[v]); r.lv++; saveTeam(); applyRoster(); sfxL('net', 0.6); toastL(v.toUpperCase() + ' upgraded to ' + r.stats[v], true); drawDetails();
  }
  else if (a === 'prevp' || a === 'nextp') { TSEL = (TSEL + (a === 'nextp' ? 1 : -1) + TEAM.roster.length) % TEAM.roster.length; drawDetails(); }
});
function drawTeam() {
  const s = T.querySelector('.scr[data-v="team"] .body'), R = TEAM.roster, col = COLORS[TEAM.color], swap = T.classList.contains('swap');
  s.innerHTML = `
  <div class="tpanel"><i class="mascot lg${TEAM.mascot}"></i>
    <div class="tn">${letters(TEAM.name, TEAM.font || 0)}</div><div class="tc"><i style="background:${col[1]}"></i>TEAM COLOR: ${col[0]}</div>
    <div class="tcount">${num(R.length)}<b>/</b>${num(ROSTER_MAX)}<small>PLAYERS</small></div>
    <div class="trate"><small>TEAM RATING</small>${num(teamRating(), 'g')}</div>
    <button class="bgold tedit" data-act="go" data-val="edit"><span class="lbl">EDIT TEAM</span></button></div>
  <div class="sec"><i class="sec-start"></i><button class="bdark" data-act="editlineup"><span class="lbl">${T.classList.contains('swap') ? 'DONE' : 'EDIT LINEUP'}</span></button></div>
  <div class="cards">${R.slice(0, 3).map((r, i) => `<button class="card${LINEUP === i ? ' gold' : ''}" data-act="${swap ? 'lineup' : 'player'}" data-val="${i}">${pic(r)}<span class="lv">${num(r.lv)}</span><span class="nm">${esc(r.name)}</span><span class="st">${num(ovr(r), 'g')}</span></button>`).join('')}</div>
  <div class="sec"><i class="sec-bench"></i></div>
  ${R.slice(3).map((r, i) => `<button class="brow${LINEUP === i + 3 ? ' sel' : ''}" data-act="${swap ? 'lineup' : 'player'}" data-val="${i + 3}">${pic(r)}<span class="nm">${esc(r.name)}</span><span class="lv">${num(r.lv)}</span><span class="st">${num(ovr(r), 'g')}</span></button>`).join('') || '<p class="empty">No bench players — draft one below.</p>'}
  <button class="bigbtn" data-act="go" data-val="draft"><i class="ball"></i><span>DRAFT NEW PLAYER</span><i class="ic i-chev"></i></button>`;
  fitNames();
}
let EDIT = null;
function drawEdit() {
  const s = T.querySelector('.scr[data-v="edit"] .body'); if (!EDIT) EDIT = { color: TEAM.color, mascot: TEAM.mascot, font: TEAM.font || 0 };
  const typed = s.querySelector('#tname') ? s.querySelector('#tname').value : TEAM.name;
  s.innerHTML = `
  <div class="hero"><i class="mascot big lg${EDIT.mascot}"></i><div class="hn" style="border-color:${COLORS[EDIT.color][1]}">${letters(typed, EDIT.font)}</div>${pic(TEAM.roster[0])}</div>
  <div class="namef"><input id="tname" maxlength="20" value="${esc(typed)}" spellcheck="false"><span class="cnt">${typed.length} / 20</span></div>
  <div class="fonts">${FONTS.map((n, i) => `<button class="fnt${EDIT.font === i ? ' on' : ''}" data-act="font" data-val="${i}">${letters('ABC', i)}<small>${n}</small></button>`).join('')}</div>
  <div class="row-lbl"><i class="lbl-color"></i></div>
  <div class="dots">${COLORS.map((c, i) => `<button class="dot d${i}${EDIT.color === i ? ' on' : ''}" data-act="color" data-val="${i}" aria-label="${c[0]}"></button>`).join('')}</div>
  <div class="row-lbl"><i class="lbl-mascot"></i></div>
  <div class="masc">${MASCOTS.map((m, i) => `<button class="ms${EDIT.mascot === i ? ' on' : ''}" data-act="mascot" data-val="${i}"><i class="mascot lg${i}"></i><span>${m.toUpperCase()}</span></button>`).join('')}</div>
  <div class="two"><button class="bdark" data-act="go" data-val="team"><span class="lbl">CANCEL</span></button><button class="bgold" data-act="saveteam"><span class="lbl">SAVE TEAM</span></button></div>`;
  const inp = s.querySelector('#tname'); inp.oninput = () => { s.querySelector('.cnt').textContent = inp.value.length + ' / 20'; s.querySelector('.hn').innerHTML = letters(inp.value, EDIT.font); fitNames(); };
  fitNames();
}
function drawDraft() {
  if (!TEAM.draft) { const used = new Set(TEAM.roster.map(r => r.name)), names = DRAFT_NAMES.filter(n => !used.has(n)).sort(() => Math.random() - 0.5); TEAM.draft = [0, 1, 2].map(i => newPlayer(names[i] || 'Rookie', rnd(52, 66))); saveTeam(); }
  const s = T.querySelector('.scr[data-v="draft"] .body'), D = TEAM.draft, p = D[DSEL], full = TEAM.roster.length >= ROSTER_MAX;
  T.querySelector('.scr[data-v="draft"] .count').innerHTML = '<i class="ic i-team"></i>' + TEAM.roster.length + ' / ' + ROSTER_MAX;
  const barc = { speed: 'green', shooting: 'blue', passing: 'gold', defense: 'red', rebounding: 'purple' };
  s.innerHTML = `<p class="sub">Choose a player for your roster</p>
  <div class="dcards">${D.map((r, i) => `<button class="card${DSEL === i ? ' gold' : ''}" data-act="pick" data-val="${i}">${pic(r)}<span class="nm">${esc(r.name)}</span><span class="st nostar">${num(ovr(r), DSEL === i ? 'g' : 'w')}</span></button>`).join('')}</div>
  <div class="spanel">${pic(p)}<div class="pn">${esc(p.name)}<small>LV ${p.lv}</small></div><div class="povr">${num(ovr(p))}</div>
    ${STATS.map((k, i) => `<div class="srow r${i}"><i class="sbar ${barc[k]}"><b style="width:${p.stats[k]}%"></b></i><span>${p.stats[k]}</span></div>`).join('')}</div>
  <div class="dtable">${D.map((r, i) => `<button class="tr r${i}${DSEL === i ? ' on' : ''}" data-act="pick" data-val="${i}">${pic(r)}<span class="c1">${esc(r.name)}</span><span class="c2">${ovr(r)}</span><span class="c3">${r.stats.speed}</span></button>`).join('')}</div>
  <button class="bigbtn${full ? ' off' : ''}" data-act="draftit"><span>${full ? 'ROSTER FULL' : 'DRAFT ' + esc(p.name.toUpperCase())}</span><i class="ic i-play"></i></button>
  <button class="link" data-act="go" data-val="team">VIEW ROSTER</button>`;
}
let NEXT = {};
function drawDetails() {
  const s = T.querySelector('.scr[data-v="details"] .body'), r = TEAM.roster[TSEL] || TEAM.roster[0], c = upCost(r);
  NEXT = {}; for (const k of STATS) NEXT[k] = 2 + ((r.lv + k.length) % 2);   // +2 or +3 each level
  s.innerHTML = `
  <div class="dhead"><button class="arrow l" data-act="prevp">‹</button>${pic(r)}<div class="pn">${esc(r.name)}</div><div class="pl">LEVEL ${r.lv}</div>
    <i class="bar"><b style="width:${Math.min(100, TEAM.xp / c * 100)}%"></b></i><div class="lvb">${num(r.lv)}</div><div class="ovrb">${num(ovr(r))}</div><button class="arrow r" data-act="nextp">›</button></div>
  <div class="xpb"><i class="xpfill" style="width:${Math.min(100, TEAM.xp / c * 100) * 0.559}%"></i><b class="need">${TEAM.xp} / ${c} XP</b></div>
  <div class="upan"><i class="uh"></i>${STATS.map((k, i) => `<div class="ug">${k.toUpperCase()}${i === 0 ? `<span class="lvn">NEXT UPGRADE: LEVEL ${r.lv + 1}</span>` : ''}</div><div class="urow r${i}${r.stats[k] >= 99 ? ' max' : ''}" data-act="ustat" data-val="${k}"><i class="uic"></i><i class="ubar"><b style="width:${r.stats[k]}%"></b></i><span class="a">${r.stats[k]}</span><span class="b">${Math.min(99, r.stats[k] + NEXT[k])}</span></div>`).join('')}<i class="ug"></i><i class="uf"></i></div>
  <div class="cost"><div><small>UPGRADE COST</small>${num(c, 'g')}<b class="xpw">XP</b></div><div><small>XP AFTER UPGRADE</small>${TEAM.xp >= c ? num(TEAM.xp - c) : '<b class="no">NEED ' + (c - TEAM.xp) + '</b>'}</div></div>
  <button class="tealbtn" data-act="go" data-val="team"><span class="lbl">BACK TO ROSTER</span></button>
  <p class="sub">Earn XP by playing games.</p>`;
}
$('hteam').onclick = () => openTeam('team'); $('hnteam').onclick = () => openTeam('team'); $('hnup').onclick = () => openTeam('details', 0); $('hnshop').onclick = () => openTeam('draft');
applyRoster();

{ const hb = document.createElement('button'); hb.id = 'home-btn'; hb.textContent = 'Home'; $('controls').prepend(hb); hb.onclick = () => { if (NET.role) leaveGame(); showHome(); }; }
game.paused = true;
window.__act = act; window.__g = groundAt; window.__w2s = (x, z) => { const s = w2s(new pc.Vec3(x, 0, z), new pc.Vec3()); const r = app.graphicsDevice.canvas.getBoundingClientRect(); return [s.x + r.left, s.y + r.top]; };
window.game = { tutEvent, startTutorial, endTutorial, TUTS: () => TUT, stats, NET, callFoul, game, P, ball, HOOPS, S, inbound, give, human, scored, attackHoop, sfx };
P.forEach(p => { p.pos.set((p.team ? 1 : -1) * (2 + p.idx * 1.5), 0, (p.idx - 1) * 3); faceTo(p, 0, 0); place(p); p.ballNode.enabled = false; });
app.start(); $('loading').hidden = true;
} catch (e) { $('loading').textContent = 'Unable to start: ' + (e && e.message || e); console.error(e); }
})();
