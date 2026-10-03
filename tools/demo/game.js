(async function () {
'use strict';
const $ = id => document.getElementById(id);
try {
// ====================================================================== scene (court from the PlayCanvas court page)
const app = new pc.Application($('scene'), { graphicsDeviceOptions: { antialias: true, alpha: false }, mouse: new pc.Mouse($('scene')), touch: new pc.TouchDevice($('scene')) });
window.app = app; app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW); app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(devicePixelRatio, 2);
app.maxDeltaTime = 1 / 20;                       // game logic and animation share one clamped clock
app.scene.ambientLight = new pc.Color(.35, .38, .43); app.scene.toneMapping = pc.TONEMAP_ACES;
window.addEventListener('resize', () => app.resizeCanvas());
const camera = new pc.Entity('Camera'); camera.addComponent('camera', { clearColor: new pc.Color(.025, .04, .06), farClip: 160, fov: 40 }); app.root.addChild(camera);
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
const [color, height, hoopAsset, playerAsset, tealAsset] = await Promise.all([
  asset('color', 'texture', 'court.jpg'), asset('height', 'texture', 'height.jpg'),
  asset('hoop', 'container', 'hoop.glb', 'model/gltf-binary'), asset('player', 'container', 'player.glb', 'model/gltf-binary'),
  asset('teal', 'texture', 'teal.jpg', 'image/jpeg')]);
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
const RUN_NATIVE = 0.21 / (0.46 * 0.38) * S,      // ground speed the Run cycle covers at 1x (feet don't skate when matched)
     DRUN_NATIVE = RUN_NATIVE, SLIDE_NATIVE = 0.16 / (0.5 * 0.45) * S;
const NAMES = [['Jax', 'Rook', 'Blaze'], ['Kai', 'Nova', 'Ziggy']];
const P = [];
function makePlayer(team, idx) {
  const ent = new pc.Entity(NAMES[team][idx]); app.root.addChild(ent);
  const model = playerAsset.resource.instantiateRenderEntity(); ent.addChild(model); const k = [1.0, 0.95, 1.05, 0.97, 1.04, 1.0][P.length]; model.setLocalScale(S * k, S * k, S * k);
  if (team === 1) for (const r of model.findComponents('render')) for (const mi of r.meshInstances)
    if (mi.material && mi.material.name === 'player') { const m = mi.material.clone(); m.diffuseMap = tealAsset.resource; m.update(); mi.material = m; }
  model.addComponent('anim', { activate: true });
  model.anim.loadStateGraph({ layers: [{ name: 'Base', weight: 1, states: [{ name: 'START' }, ...Object.entries(CLIPS).map(([n, loop]) => ({ name: n, speed: 1, loop: !!loop }))], transitions: [{ from: 'START', to: 'Ready' }] }], parameters: {} });
  for (const a of playerAsset.resource.animations) model.anim.assignAnimation(a.resource.name, a.resource, undefined, 1, !!CLIPS[a.resource.name]);
  const label = document.createElement('div'); label.className = 'tag t' + team; label.textContent = NAMES[team][idx]; $('tags').appendChild(label);
  const sb = document.createElement('i'); sb.className = 'sbar'; const sf = document.createElement('b'); sb.appendChild(sf); if (team === 0) label.appendChild(sb);
  return { id: P.length, team, idx, name: NAMES[team][idx], ent, model, label, ballNode: model.findByName('basketball'), rootBone: model.findByName('root'), head: model.findByName('head'),
    k, runClip: ['Run', 'RunB', 'RunC', 'RunC', 'Run', 'RunB'][P.length], spd: [1.0, 0.94, 1.07, 1.04, 0.97, 1.0][P.length],
    stamina: 1, drain: 0, pos: new pc.Vec3(), vel: new pc.Vec3(), yaw: 0, state: 'Ready', action: null, think: Math.random() * .3, timer: 0, cut: 0, juke: 0, stall: 0, react: 0, holdT: 0 };
}
for (let t = 0; t < 2; t++) for (let i = 0; i < 3; i++) P.push(makePlayer(t, i));
const team = t => P.filter(p => p.team === t);
const man = p => P[(1 - p.team) * 3 + p.idx];          // matchup: same index on the other team
function setAnim(p, name, blend = 0.15, speed = 1) { p.model.anim.speed = speed; if (p.state === name) return; p.state = name; p.model.anim.baseLayer.transition(name, blend); }
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
function toast(text, big) { const t = $('toast'); t.textContent = text; t.className = big ? 'show big' : 'show'; clearTimeout(toast.h); toast.h = setTimeout(() => t.className = '', big ? 2400 : 1400); }
function hud() {
  $('s0').textContent = game.score[0]; $('s1').textContent = game.score[1];
  $('clock').textContent = game.phase === 'live' || game.phase === 'air' || game.phase === 'loose' ? Math.max(0, Math.ceil(game.shotClock)) : '';
  $('poss0').classList.toggle('on', game.offense === 0); $('poss1').classList.toggle('on', game.offense === 1);
}
function inbound(t, spot) {
  // team t takes the ball; spot defaults to under the basket they defend
  game.offense = t; game.phase = 'inbound'; game.timer = 1.0; game.shotClock = SHOT_CLOCK; game.shot = null;
  const D = defendHoop(t), A = attackHoop(t), dir = Math.sign(A.rim.x - D.rim.x);
  const o = team(t), d = team(1 - t);
  const h = o[Math.floor(Math.random() * 3)];
  const base = spot ? spot.clone() : flat(D.rim.x + dir * 1.2, (Math.random() - .5) * 3);
  const places = [base, flat(base.x + dir * 4.5, 4.2), flat(base.x + dir * 5.5, -4.2)];
  o.filter(p => p !== h).forEach((p, i) => { p.pos.copy(places[i + 1]); });
  h.pos.copy(places[0]);
  for (const p of o) { p.vel.set(0, 0, 0); p.action = null; delete p.pendingBlock; clamp(p.pos); faceTo(p, A.rim.x, 0); p.cut = 0; p.goal = null; }
  for (const p of d) { const m = man(p); p.vel.set(0, 0, 0); p.action = null; delete p.pendingBlock; p.pos.copy(flat(m.pos.x + dir * 2.5, m.pos.z * 0.8)); clamp(p.pos); faceTo(p, m.pos.x, m.pos.z); }
  for (const p of P) { p.rootBone.setLocalPosition(0, 0, 0); setAnim(p, p === h ? 'Idle' : p.team === t ? 'Ready' : 'Defend', 0.1); place(p); }
  give(h); hud();
}
function restart() { game.score = [0, 0]; $('banner').className = ''; toast('First to ' + TARGET, true); inbound(Math.random() < .5 ? 0 : 1, flat(0, 0)); }
function scored(H) {
  const s = game.shot; if (!s) return;
  const t = s.shooter.team; if (attackHoop(t) !== H) return;
  stats.made++; game.score[t] += s.pts; game.lastScoreTeam = t; game.shot = null;
  toast(s.dunk ? s.shooter.name.toUpperCase() + ' THROWS IT DOWN!' : s.pts === 3 ? s.shooter.name + ' from downtown!' : s.shooter.name + (s.assist ? ' scores — dime from ' + s.assist.name : ' scores'), true);
  sfx('net'); setTimeout(() => t === HUMAN ? cheer() : sfx('boo', 0.6), 150); game.phase = 'scored'; game.timer = 1.6; hud();
  if (game.score[t] >= TARGET) { game.phase = 'over'; game.timer = 7; $('banner').textContent = (t ? 'TEAL' : 'PURPLE') + ' WIN ' + game.score[0] + '–' + game.score[1]; $('banner').className = 'show t' + t; }
}

// ====================================================================== actions
const stats = { pass: 0, shot: 0, dunk: 0, steal: 0, block: 0, made: 0 }; window.__stats = stats;
function startShot(p) { stats.shot++;
  const A = attackHoop(p.team); faceTo(p, A.rim.x, A.rim.z); p.vel.set(0, 0, 0);
  p.action = { type: 'shoot', t: 0, done: false }; setAnim(p, 'Shoot', 0.1);
  const c = closestDefender(p); if (c && d2(c.pos, p.pos) < 2.4 && !c.action && Math.random() < 0.75) c.pendingBlock = 0.1 + Math.random() * 0.15;
}
function shotRelease(p) {
  const A = attackHoop(p.team), p0 = p.ballNode.getPosition().clone(), dr = d2(p.pos, A.rim);
  const c = closestDefender(p), cd = c ? d2(c.pos, p.pos) : 9;
  game.shot = { shooter: p, pts: dr > ARC ? 3 : 2, assist: p.lastPasser && p.holdT < 3 ? p.lastPasser : null };
  if (c && c.action && c.action.type === 'block' && c.action.t > 0.2 && c.action.t < 0.75 && cd < 1.35 && Math.random() < 0.38) {
    const away = flat(p.pos.x - A.rim.x, p.pos.z - A.rim.z).normalize();
    const inC = flat(-p0.x, -p0.z).normalize(), dir2 = away.mulScalar(0.6).add(inC.mulScalar(0.4)).normalize();
    release(p0, new pc.Vec3(dir2.x * 2.6 + (Math.random() - .5) * 1.2, 1.6, dir2.z * 2.6 + (Math.random() - .5) * 1.2), false);
    game.shot = null; game.phase = 'loose'; ball.lastTouch = c.team; stats.block++; toast('REJECTED by ' + c.name + '!', true); sfx('block'); return;
  }
  let make = dr < 3 ? 0.7 : dr < 4.5 ? 0.62 : dr < ARC ? 0.58 - 0.03 * (dr - 4.5) : 0.45 - 0.06 * (dr - ARC);
  make = Math.max(0.18, make) * (cd < 1.0 ? 0.55 : cd < 1.6 ? 0.75 : cd < 2.4 ? 0.9 : 1);
  if (game.shotClock < 1) make *= 0.8;
  if (p.shotQ !== undefined) {   // player's timed release: 1 = dead centre, 0 = edge of the meter
    const q = p.shotQ; delete p.shotQ;
    make = q >= 1 ? 0.99 : make * (0.15 + 1.25 * q * q);
    toast(q >= 1 ? 'PERFECT release' : q > 0.7 ? 'Good release' : q > 0.4 ? 'Slightly off' : 'Way off', false);
  }
  const tgt = A.rim.clone();
  if (Math.random() < make) { const a = Math.random() * 6.283, r = Math.random() * 0.07; tgt.x += Math.cos(a) * r; tgt.z += Math.sin(a) * r; }
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
  ball.pass = { from: p, to: r, t: 0, T, tried: new Set() }; ball.lastTouch = p.team; r.react = 0;
}
function startBlock(p) { p.action = { type: 'block', t: 0 }; p.vel.mulScalar(0.2); setAnim(p, 'Block', 0.08); }
function startSteal(p) { p.action = { type: 'steal', t: 0, done: false }; p.vel.mulScalar(0.3); setAnim(p, 'Steal', 0.08); }

function updateActions(dt) {
  for (const p of P) {
    if (p.pendingBlock !== undefined) { p.pendingBlock -= dt; if (p.pendingBlock <= 0) { delete p.pendingBlock; if (!p.action) startBlock(p); } }
    const a = p.action; if (!a) continue; a.t += dt;
    if (a.type === 'shoot') { if (!a.done && a.t >= 0.64 && ball.holder === p) { a.done = true; game.phase = 'air'; shotRelease(p); } if (a.t >= 1.5) p.action = null; }
    else if (a.type === 'dunk') {
      if (!a.done && a.t >= 1.06 && ball.holder === p) { a.done = true; game.phase = 'air'; dunkRelease(p); }
      if (a.t >= 2.9) { const r = p.rootBone.getPosition(); p.pos.set(r.x, 0, r.z); place(p); p.rootBone.setLocalPosition(0, 0, 0); p.action = null; setAnim(p, 'Ready', 0); }
    }
    else if (a.type === 'pass') { if (!a.done && a.t >= 0.30 && ball.holder === p) { a.done = true; passRelease(p, a.to); } if (a.t >= 0.62) p.action = null; }
    else if (a.type === 'block') { if (a.t >= 1.15) p.action = null; }
    else if (a.type === 'steal') {
      if (!a.done && a.t >= 0.2) {
        a.done = true; const h = ball.holder;
        let chance = 0.22;
        if (p.stealQ !== undefined) { const q = p.stealQ; delete p.stealQ; chance = q > 0.91 ? 1 : 0.35 + 0.5 * (q / 0.91); p.perfectSteal = q > 0.91;   // edge 35% -> just outside the box 85%
          toast(q > 0.91 ? 'PERFECT timing' : q > 0.6 ? 'Good reach' : q > 0.3 ? 'Late reach' : 'Off the mark', false);
          if (q < 0.15) p.react = 0.4; }
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
    if (sp > 0.7) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 8, dt); setAnim(p, 'DribbleRun', 0.2, pc.math.clamp(sp / (DRUN_NATIVE * p.k), 0.3, 1.6)); }
    else { setAnim(p, 'Dribble', 0.2); p.vel.mulScalar(Math.pow(0.002, dt)); }
  } else if (mode === 'stance') {
    if (sp > 2.4 || (p.goalDist || 0) > 1.8) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 9, dt); setAnim(p, p.runClip, 0.2, pc.math.clamp(sp / (RUN_NATIVE * p.k), 0.3, 1.6)); return; }
    const lat = p.vel.dot(left(p)), lv = left(p), fw = p.vel.clone().sub(lv.clone().mulScalar(lat));
    if (fw.length() > 0.25) p.vel.sub(fw.mulScalar(1 - 0.25 / fw.length()));   // stance moves sideways only (no gliding)
    if (lat > 0.45) setAnim(p, 'SlideL', 0.15, pc.math.clamp(lat / SLIDE_NATIVE, 0.3, 1.4)); else if (lat < -0.45) setAnim(p, 'SlideR', 0.15, pc.math.clamp(-lat / SLIDE_NATIVE, 0.3, 1.4)); else { setAnim(p, 'Defend', 0.2); p.vel.mulScalar(Math.pow(0.002, dt)); }
  } else {
    if (sp > 1.0) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 9, dt); setAnim(p, p.runClip, 0.2, pc.math.clamp(sp / (RUN_NATIVE * p.k), 0.3, 1.6)); }
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
    if (!(human.on && p.team === HUMAN) && !p.action && !m.action && d2(p.pos, mp) < 1.35 && Math.random() < dt * (human.on && m.team === HUMAN ? 0.55 : 0.35)) startSteal(p);
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
function bodies() { for (let it = 0; it < 3; it++) { bodies1(); for (const p of P) clamp(p.pos); } }
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
  const aspect = app.graphicsDevice.width / app.graphicsDevice.height, portrait = aspect < 0.9;
  const f = ball.holder ? bodyPos(ball.holder) : ball.pos, att = attackHoop(game.offense).rim.x > 0 ? 1 : -1;
  const fx = pc.math.clamp(f.x + att * 2, -10.5, 10.5), fz = pc.math.clamp(f.z, -4, 4);
  let pos, look, fov;
  if (camMode === 'arena') {
    // Clash Royale style: high above Purple's baseline, looking down the length of the court (court runs bottom to top on a phone)
    const fit = portrait ? 1 : 0.8, drift = pc.math.clamp(f.x, -8, 8) * 0.12;
    pos = new pc.Vec3(-34 + drift, 19, 0); look = new pc.Vec3(0.8 + drift, -1.5, 0); fov = 40;
    camera.camera.projection = pc.PROJECTION_ORTHOGRAPHIC; camera.camera.orthoHeight = Math.max(8.7 / aspect, 12.6);
  } else if ((camera.camera.projection = pc.PROJECTION_PERSPECTIVE) && camMode === 'broadcast') {
    if (portrait) { pos = new pc.Vec3(fx - att * 9.5, 9.5, fz * 0.3 + 3); look = new pc.Vec3(fx + att * 3, 0.8, fz * 0.4); fov = 58; }
    else { pos = new pc.Vec3(fx * 0.9, 9.2, 17.5); look = new pc.Vec3(fx, 0.6, fz * 0.3); fov = 40; }
  } else {
    pos = new pc.Vec3(fx - att * 7, 3.2, fz * 0.5 + (portrait ? 2.5 : 6)); look = new pc.Vec3(fx + att * 4, 1.3, fz * 0.6); fov = portrait ? 62 : 50;
  }
  camPos.lerp(camPos, pos, Math.min(1, dt * 2.2)); camLook.lerp(camLook, look, Math.min(1, dt * 3));
  camera.setPosition(camPos); camera.lookAt(camLook); camera.camera.fov = fov;
  const w = app.graphicsDevice.canvas.clientWidth, sp = new pc.Vec3();
  for (const p of P) {
    const bp = bodyPos(p), top = new pc.Vec3(bp.x, Math.max(2.3, p.head.getPosition().y + 0.75), bp.z);
    camera.camera.worldToScreen(top, sp);
    p.label.style.transform = `translate(${sp.x.toFixed(0)}px, ${sp.y.toFixed(0)}px) translate(-50%,-100%)`;
    p.label.classList.toggle('ball', ball.holder === p);
    p.label.style.display = (camera.camera.projection === pc.PROJECTION_ORTHOGRAPHIC || sp.z > 0) && sp.x > -50 && sp.x < w + 50 ? '' : 'none';
  }
}

// ====================================================================== main loop
app.on('update', dt => {
  if (game.paused) return;
  game.time += dt; game.timer -= dt;
  const live = game.phase === 'live' || game.phase === 'air' || game.phase === 'loose';
  if (game.phase === 'intro') { if (game.timer <= 0) restart(); }
  else if (game.phase === 'inbound') { if (game.timer <= 0) { game.phase = 'live'; toast((game.offense ? 'Teal' : 'Purple') + ' ball'); } }
  else if (game.phase === 'scored') {
    for (const p of P) if (!p.action) { p.vel.mulScalar(Math.pow(0.1, dt)); animMove(p, dt, p.team === game.lastScoreTeam ? 'offball' : 'stance'); }
    if (game.timer <= 0 && !P.some(p => p.action && p.action.type === 'dunk')) inbound(1 - game.lastScoreTeam);
  } else if (game.phase === 'over') {
    for (const p of P) if (!p.action) { p.vel.mulScalar(0.9); setAnim(p, 'Ready', 0.3); }
    if (game.timer <= 0) restart();
  }
  if (live) {
    if (game.phase === 'live') game.shotClock -= dt;
    const crashers = ball.free && !ball.pass ? P.slice().sort((a, b) => d2(a.pos, ball.pos) - d2(b.pos, ball.pos)).slice(0, 3) : [];
    for (const p of P) {
      if (p.action) continue;
      if (ball.holder === p) (human.on && p.team === HUMAN ? humanAI : handlerAI)(p, dt);
      else if (ball.free && !ball.pass && (game.phase === 'loose' || (ball.pos.y < 2.6 && ball.vel.y < 0)) && crashers.includes(p)) chase(p, dt);
      else if (p.team === game.offense) offballAI(p, dt);
      else if (human.on && p === myDefender()) humanDefAI(p, dt);
      else defenseAI(p, dt);
    }
    if (ball.pass) {
      ball.pass.t += dt; const r = ball.pass.to;
      if (ball.free && d2(ball.pos, r.pos) < 1.0 && ball.pos.y < 2.4) { give(r); setAnim(r, 'Dribble', 0.12); }
      else if (ball.pass.t > ball.pass.T + 0.5) { ball.pass = null; game.phase = 'loose'; }
    }
    if (game.phase === 'air' && ball.free && ball.pos.y < RIM_Y - 0.7 && !ball.crossed) { game.phase = 'loose'; game.shot = null; }
    if (ball.free && (Math.abs(ball.pos.x) > 14.7 || Math.abs(ball.pos.z) > 7.6)) {
      const spot = clamp(flat(ball.pos.x * 0.97, ball.pos.z * 0.93));
      (window.__oob = window.__oob || []).push({ pass: !!ball.pass, phase: game.phase, pos: [ball.pos.x.toFixed(1), ball.pos.y.toFixed(1), ball.pos.z.toFixed(1)], vel: [ball.vel.x.toFixed(1), ball.vel.y.toFixed(1), ball.vel.z.toFixed(1)] });
      toast('Out of bounds'); inbound(1 - ball.lastTouch, spot);
    }
    if (game.phase === 'live' && game.shotClock <= 0 && ball.holder && !ball.holder.action) { toast('Shot clock violation'); inbound(1 - game.offense, flat(0, 0)); }
  }
  if (human.freeze > 0) {      // hold the marker where the player stopped it
    human.freeze -= dt;
    if (human.freeze <= 0) { human.mt = 0; if (human.after === 'hide') { human.meter = false; meterEl.className = ''; } human.after = null; }
  } else if (human.meter) { human.mt += dt * (human.mspeed || 1); markEl.style.left = (50 + 46 * meterPos()) + '%'; }
  // defense: the steal meter stays on screen the whole time Teal has the ball
  if (defMode()) {
    const d = closestDef(), near = d && d2(d.pos, bodyPos(ball.holder)) < 1.6;
    if (near) { if (!human.meter || !human.auto) { human.meter = true; human.auto = true; human.mt = 0; meterEl.className = 'show steal'; setZone(0.087); human.mspeed = 1; } $('mlabel').textContent = 'TAP TO STEAL'; }
    else if (human.auto && !(human.freeze > 0)) { human.meter = human.auto = false; meterEl.className = ''; }
    for (const q of team(HUMAN)) q.label.classList.toggle('near', q === d && near);
  } else if (human.auto && !(human.freeze > 0)) { human.meter = human.auto = false; meterEl.className = ''; for (const q of P) q.label.classList.remove('near'); }
  if (human.meter && !human.auto && !myBall() && !human.down && !(human.freeze > 0)) { human.meter = false; meterEl.className = ''; }
  for (const q of team(HUMAN)) {   // each player has their own stamina
    if (q.drain > 0) q.drain -= dt; else q.stamina = Math.min(1, q.stamina + dt * 0.15);
    const f = q.label.querySelector('.sbar b'); if (f) { f.style.width = (q.stamina * 100).toFixed(0) + '%'; f.parentNode.classList.toggle('low', q.stamina < 0.25); f.parentNode.hidden = !human.on; }
  }
  // green ring under the ball handler
  const bh = ball.holder; ballRing.enabled = !!bh; if (bh) { const bp = bodyPos(bh); ballRing.setPosition(bp.x, 0.03, bp.z); }
  updateActions(dt);
  for (const p of P) if (!p.action || p.action.type === 'steal' || p.action.type === 'pass') p.pos.add(p.vel.clone().mulScalar(dt));
  bodies();
  for (const p of P) { if (!p.action || p.action.type !== 'dunk') { clamp(p.pos); place(p); } }
  if (ball.free) stepBall(dt); else dribbleSound();
  updateCamera(dt); hud();
});

// ====================================================================== sound
let actx = null, master = null, crowdSrc = null, crowdGain = null; const SND = {}, lastPlay = {};
function sfx(kind, vol = 1) {
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
  for (const k of ['bounce', 'net', 'cheer', 'crowd', 'boo', 'rim']) actx.decodeAudioData(bytes(ASSETS['snd_' + k]).buffer).then(buf => {
    SND[k] = buf;
    if (k === 'crowd') { crowdSrc = actx.createBufferSource(); crowdSrc.buffer = buf; crowdSrc.loop = true; const g = crowdGain = actx.createGain(); g.gain.value = 0.35; crowdSrc.connect(g); g.connect(master); crowdSrc.start(); }
  }).catch(() => {});
}
// a made basket: layered cheer clips over a crowd swell that fades back down over ~4 s
function cheer() {
  if (!actx) return; sfx('cheer', 0.9);
  [0.75, 1.5, 2.3].forEach((d, i) => setTimeout(() => { lastPlay.cheer = -9; sfx('cheer', 0.7 - i * 0.18); }, d * 1000));
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
  else if (dribDown && y > dribY + 0.002) { if (dribY < 0.35) sfx('bounce', 0.55); dribDown = false; }
  dribY = y;
}

// ====================================================================== controls
let speed = 1;
$('pause').onclick = () => { game.paused = !game.paused; $('pause').textContent = game.paused ? 'Play' : 'Pause'; app.timeScale = game.paused ? 0 : speed; };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; app.timeScale = game.paused ? 0 : speed; $('speed').textContent = speed + '×'; };
const CAMS = ['arena', 'broadcast', 'follow'], CAMNAME = { arena: 'Arena cam', broadcast: 'Broadcast cam', follow: 'Follow cam' };
$('cam').onclick = () => { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % 3]; $('cam').textContent = CAMNAME[CAMS[(CAMS.indexOf(camMode) + 1) % 3]]; };
$('restart').onclick = () => restart();
$('mute').onclick = () => { $('mute').classList.toggle('on'); if (master) master.gain.value = $('mute').classList.contains('on') ? 0 : 1; };
// ====================================================================== player controls (Purple)
// tap court = move ball handler there, tap teammate = pass, hold 1 s = timing meter, release = shoot
const HUMAN = 0;
// marker position -1..1; starts at the left edge so the first pass through the centre is catchable
function setZone(halfM) {   // halfM: perfect window half-width in marker units (marker spans 46% of the bar each side)
  human.zone = halfM; const w = halfM * 46 * 2, pf = meterEl.querySelector('.perfect');
  pf.style.left = (50 - w / 2) + '%'; pf.style.width = w + '%';
  meterEl.style.setProperty('--g0', (50 - w / 2) + '%'); meterEl.style.setProperty('--g1', (50 + w / 2) + '%');
}
const meterPos = () => Math.sin(human.mt * Math.PI * 1.15 - Math.PI / 2);
const human = { stamina: 1, lastTap: null, on: true, down: false, t0: 0, x: 0, y: 0, meter: false, mt: 0, target: null };
function groundAt(sx, sy) {
  const a = camera.camera.screenToWorld(sx, sy, camera.camera.nearClip), b = camera.camera.screenToWorld(sx, sy, camera.camera.farClip);
  if (Math.abs(b.y - a.y) < 1e-6) return null; const t = a.y / (a.y - b.y); return flat(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
}
function screenOf(p) { const s = new pc.Vec3(); const bp = bodyPos(p); camera.camera.worldToScreen(new pc.Vec3(bp.x, 1.0, bp.z), s); return s; }
const canEl = $('scene'), meterEl = $('meter'), markEl = $('mark');
function myBall() { return human.on && ball.holder && ball.holder.team === HUMAN && !ball.holder.action && (game.phase === 'live'); }
canEl.addEventListener('pointerdown', e => {
  if (!myBall() && !myDefender()) return; const r = canEl.getBoundingClientRect();
  if (defMode()) {
    const d = closestDef();
    if (d && !d.action && d2(d.pos, bodyPos(ball.holder)) < 1.6) {     // in range: tap = steal now
      const m = meterPos(); d.stealQ = Math.max(0, 1 - Math.abs(m)); d.moveTarget = null; startSteal(d); human.freeze = 0.3; human.after = null; return;
    }
  }
  try { canEl.setPointerCapture(e.pointerId); } catch (_) {}
  Object.assign(human, { down: true, t0: performance.now(), x: e.clientX - r.left, y: e.clientY - r.top });
  if (!human.auto) human.meter = false;
});
function onRelease(e) {
  if (!human.down) return; human.down = false;
  if (defMode()) {           // defense: a short tap moves the closest defender (holding just chases)
    const dd = myDefender(); if (dd && performance.now() - human.t0 < 250) { const g = groundAt(human.x, human.y); if (g) moveOrder(dd, g); } return;
  }
  if (!human.auto && !human.meter) meterEl.className = '';
  const h = ball.holder; if (!myBall()) { human.meter = false; return; }
  if (human.meter) {          // shoot with the meter reading
    const m = meterPos(); human.freeze = 0.7; human.after = 'hide';
    const am = Math.abs(m); h.shotQ = am <= human.zone ? 1 : Math.max(0, 0.9 * (1 - am) / (1 - human.zone)); h.moveTarget = null; startShot(h); return;
  }
  // tap: teammate under the finger = pass, else move there
  let best = null, bd = 48;
  for (const q of team(HUMAN)) { if (q === h) continue; const s = screenOf(q), d = Math.hypot(s.x - human.x, s.y - human.y); if (d < bd) { bd = d; best = q; } }
  if (best) { best.lastPasser = h; h.moveTarget = null; startPass(h, best); return; }
  const g = groundAt(human.x, human.y); if (g) moveOrder(h, g);
}
window.addEventListener('pointerup', onRelease); canEl.addEventListener('contextmenu', e => e.preventDefault());
function myDefender() {
  const h = ball.holder; if (!human.on || !h || h.team === HUMAN || game.phase !== 'live') return null;
  let d = null, bd = 1e9; for (const q of team(HUMAN)) { const dist = d2(q.pos, bodyPos(h)); if (dist < bd) { bd = dist; d = q; } }
  return d && !d.action ? d : null;
}
function defMode() { const h = ball.holder; return human.on && h && h.team !== HUMAN && game.phase === 'live'; }
function closestDef() { const h = ball.holder; let d = null, bd = 1e9; for (const q of team(HUMAN)) { const x = d2(q.pos, bodyPos(h)); if (x < bd) { bd = x; d = q; } } return d; }
function humanDefAI(p, dt) {
  const h = ball.holder, near = d2(p.pos, bodyPos(h)) < 1.6;
  if (human.down) {
    const hp = bodyPos(h), D = defendHoop(p.team), toR = flat(D.rim.x - hp.x, D.rim.z - hp.z).normalize();
    p.moveTarget = null; steer(p, hp.clone().add(toR.mulScalar(0.9)), 4.0, dt, 16); animMove(p, dt, 'stance'); faceTo(p, hp.x, hp.z, 9, dt);
    p.label.classList.toggle('near', near); return;
  }
  if (p.react > 0) { p.react -= dt; p.vel.mulScalar(Math.pow(0.05, dt)); animMove(p, dt, 'stance'); return; }
  if (p.moveTarget) {
    steer(p, p.moveTarget, 3.6 * sprintMul(p, dt), dt, p.sprint ? 18 : 15); animMove(p, dt, 'stance'); faceTo(p, h.pos.x, h.pos.z, 7, dt);
    if (d2(p.pos, p.moveTarget) < 0.35) { p.moveTarget = null; p.sprint = false; p.sprintT = 0; }
  } else defenseAI(p, dt);            // no order: stay on your man
  p.label.classList.toggle('near', near);
}
// sprint: tapping the same spot again (within 1.5 s) sprints there, burning stamina; empty bar = normal run
function sprintMul(p, dt) {
  // sprint while banked sprint time and stamina last
  if (!(p.sprintT > 0) || p.stamina <= 0) { p.sprint = false; return 1; }
  p.sprint = true; p.sprintT -= dt;
  p.stamina = Math.max(0, p.stamina - dt * 0.35); p.drain = 0.25; return 1.45;
}
function moveOrder(p, g) {
  // first tap: run there. Every extra tap in the same area while still on the way banks +0.5 s of sprint (max 3 s)
  const sameArea = p.moveTarget && d2(p.moveTarget, g) < 1.6;
  if (sameArea) p.sprintT = Math.min(3, (p.sprintT > 0 ? p.sprintT : 0) + 0.5);
  else p.sprintT = 0;
  p.moveTarget = clamp(g); ring(g, p.sprintT > 0 && p.stamina > 0.05);
}
function humanAI(p, dt) {
  p.holdT += dt;
  if (human.down && performance.now() - human.t0 > 250) {   // a 0.25 s hold brings up the shot meter
    if (!human.meter && performance.now() - human.t0 > 250) { human.meter = true; human.mt = 0; meterEl.className = 'show'; }
    // the more open the shooter, the wider the perfect (green) window
    const op = openness(p), dr = d2(p.pos, attackHoop(p.team).rim);
    const df = dr < 3 ? 1.3 : dr < 5 ? 1.1 : dr < ARC ? 0.9 : dr < 8 ? 0.75 : 0.6;   // closer shots get a wider window too
    setZone(Math.min(0.45, (op < 1.0 ? 0.06 : op < 1.6 ? 0.087 : op < 2.4 ? 0.14 : op < 3.5 ? 0.2 : 0.27) * df));
    human.mspeed = op < 1.0 ? 1.15 : op < 1.6 ? 1.0 : op < 2.4 ? 0.88 : op < 3.5 ? 0.78 : 0.68;   // open shooters get a slower sweep
    $('mlabel').textContent = op < 1.0 ? 'CONTESTED' : op < 1.6 ? 'GUARDED' : op < 2.4 ? 'SPACE' : op < 3.5 ? 'OPEN' : 'WIDE OPEN';
  }   // holding the meter does not stop the player: they keep travelling until the shot is released
  if (p.moveTarget) {
    steer(p, p.moveTarget, 3.4 * sprintMul(p, dt), dt, p.sprint ? 18 : 13);
    if (d2(p.pos, p.moveTarget) < 0.35) { p.moveTarget = null; p.sprint = false; p.sprintT = 0; }
  } else p.vel.mulScalar(Math.pow(0.02, dt));
  animMove(p, dt, 'handler');
  if (!p.moveTarget && p.vel.length() < 0.5) { const A = attackHoop(p.team); faceTo(p, A.rim.x, A.rim.z, 5, dt); }
}
const ringEl = $('ring');
function ring(g, sprint) { ringEl.style.borderColor = sprint ? '#ff6a3d' : '#ffd27a'; const s = new pc.Vec3(); camera.camera.worldToScreen(new pc.Vec3(g.x, 0, g.z), s); ringEl.style.left = s.x + 'px'; ringEl.style.top = s.y + 'px'; ringEl.className = ''; void ringEl.offsetWidth; ringEl.className = 'go'; }
$('mode').onclick = () => { human.on = !human.on; $('mode').textContent = human.on ? 'Watch AI' : 'Play'; $('hint').hidden = !human.on; };
window.game = { game, P, ball, HOOPS, S, inbound, give, human, scored, attackHoop, sfx };
P.forEach(p => { p.pos.set((p.team ? 1 : -1) * (2 + p.idx * 1.5), 0, (p.idx - 1) * 3); faceTo(p, 0, 0); place(p); p.ballNode.enabled = false; });
app.start(); $('loading').hidden = true;
} catch (e) { $('loading').textContent = 'Unable to start: ' + (e && e.message || e); console.error(e); }
})();
