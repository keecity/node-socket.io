(async function () {
'use strict';
const $ = id => document.getElementById(id);
try {
// ------------------------------------------------------------------ app, court, lights (from the court scene)
const app = new pc.Application($('scene'), { graphicsDeviceOptions: { antialias: true, alpha: false }, mouse: new pc.Mouse($('scene')), touch: new pc.TouchDevice($('scene')) });
window.app = app; app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW); app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(devicePixelRatio, 2);
app.scene.ambientLight = new pc.Color(.35, .38, .43); app.scene.toneMapping = pc.TONEMAP_ACES;
window.addEventListener('resize', () => app.resizeCanvas());
app.maxDeltaTime = 1 / 20;   // game logic and animation share one clamped clock
const camera = new pc.Entity('Camera'); camera.addComponent('camera', { clearColor: new pc.Color(.025, .04, .06), farClip: 160, fov: 40 }); app.root.addChild(camera);
const light = new pc.Entity('Key'); light.addComponent('light', { type: 'directional', color: new pc.Color(1, .94, .84), intensity: 1.15, castShadows: true, shadowDistance: 40, shadowResolution: 2048, shadowBias: .15, normalOffsetBias: .025 }); light.setEulerAngles(52, 25, 0); app.root.addChild(light);
const fill = new pc.Entity('Fill'); fill.addComponent('light', { type: 'directional', color: new pc.Color(.73, .84, 1), intensity: .45 }); fill.setEulerAngles(65, 210, 0); app.root.addChild(fill);
function mat(name, color) { const m = new pc.StandardMaterial(); m.name = name; m.diffuse = new pc.Color(...color); m.metalness = 0; m.gloss = 20; m.update(); return m; }
function primitive(name, type, scale, pos, material) { const e = new pc.Entity(name); e.addComponent('render', { type, material, castShadows: true, receiveShadows: true }); e.setLocalScale(...scale); e.setPosition(...pos); app.root.addChild(e); return e; }
primitive('Court foundation', 'box', [30, .24, 16], [0, -.13, 0], mat('Navy court edge', [.025, .065, .10]));
primitive('Surround', 'box', [43, .12, 29], [0, -.34, 0], mat('Charcoal surround', [.07, .095, .12]));
function bytes(b64) { const a = atob(b64), b = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) b[i] = a.charCodeAt(i); return b; }
function asset(key, type, filename, mime) { const url = URL.createObjectURL(new Blob([bytes(ASSETS[key])], { type: mime })); return new Promise((res, rej) => app.assets.loadFromUrlAndFilename(url, filename, type, (err, a) => { URL.revokeObjectURL(url); err ? rej(err) : res(a); })); }
$('status').textContent = 'Loading court and players…';
const [color, height, hoopAsset, playerAsset, tealAsset] = await Promise.all([
  asset('color', 'texture', 'court.png', 'image/png'), asset('height', 'texture', 'height.png', 'image/png'),
  asset('hoop', 'container', 'hoop.glb', 'model/gltf-binary'), asset('player', 'container', 'player.glb', 'model/gltf-binary'),
  asset('teal', 'texture', 'teal.jpg', 'image/jpeg')]);
const floorMat = mat('Maple', [1, 1, 1]); floorMat.diffuseMap = color.resource; floorMat.bumpMap = height.resource; floorMat.bumpiness = .035; floorMat.gloss = 42; floorMat.update();
const floor = primitive('Court', 'plane', [30, 1, 16], [0, 0, 0], floorMat); floor.render.castShadows = false;
const hoops = [];
for (const side of [-1, 1]) {
  const root = new pc.Entity(side < 0 ? 'West hoop' : 'East hoop'); app.root.addChild(root);
  const model = hoopAsset.resource.instantiateRenderEntity(); root.addChild(model); model.setLocalScale(4.88, 4.88, 4.88);
  root.setEulerAngles(0, side < 0 ? 90 : -90, 0); root.setPosition(side * 14.80, .012, 0); hoops.push({ root, model });
}
app.root.syncHierarchy();
// the game is played on the east hoop; measure the rim and backboard from the model
const hoopM = hoops[1].model.getWorldTransform();
const RIM = hoopM.transformPoint(new pc.Vec3(0.006, 0.625, 0.43));
const RIM_R = 0.066 * 4.88, TUBE = 0.022 * 4.88 * 0.25;
const BOARD = hoopM.transformPoint(new pc.Vec3(0, 0.70, 0.352));
const BOARD_HALF_W = 0.225 * 4.88, BOARD_Y0 = 0.57 * 4.88, BOARD_Y1 = 0.845 * 4.88;
const S = RIM.y / 1.35;                         // player scale so the authored dunk meets this rim
const BALL_R = 0.07 * S, G = 9.8;
const DUNK_DIST = 1.8 * S, DUNK_TRAVEL = 1.42 * S;
const ARC = 6.75, CHECK = new pc.Vec3(RIM.x - 7.4, 0, 0);

// ------------------------------------------------------------------ players
const CLIPS = { Idle: true, Dribble: true, Shoot: false, Dunk: false, Run: true, DribbleRun: true, Defend: true, Block: false };
const RUN_NATIVE = 0.30 / (0.5 * 0.42) * S;      // ground speed (m/s) the run cycles were authored for
function makePlayer(name, team, tex) {
  const ent = new pc.Entity(name); app.root.addChild(ent);
  const model = playerAsset.resource.instantiateRenderEntity(); ent.addChild(model); model.setLocalScale(S, S, S);
  if (tex) for (const r of model.findComponents('render')) for (const mi of r.meshInstances) {
    if (mi.material && mi.material.name === 'player') { const m = mi.material.clone(); m.diffuseMap = tex; m.update(); mi.material = m; }
  }
  model.addComponent('anim', { activate: true });
  model.anim.loadStateGraph({ layers: [{ name: 'Base', weight: 1, states: [{ name: 'START' }, ...Object.entries(CLIPS).map(([n, loop]) => ({ name: n, speed: 1, loop }))], transitions: [{ from: 'START', to: 'Idle' }] }], parameters: {} });
  for (const a of playerAsset.resource.animations) model.anim.assignAnimation(a.resource.name, a.resource, undefined, 1, CLIPS[a.resource.name] !== false);
  const p = { name, team, ent, model, ballNode: model.findByName('basketball'), rootBone: model.findByName('root'),
    pos: new pc.Vec3(), vel: new pc.Vec3(), yaw: 0, state: 'Idle', action: null, score: 0, speedTarget: 0 };
  return p;
}
const P = [makePlayer('Purple', 0, null), makePlayer('Teal', 1, tealAsset.resource)];
function setAnim(p, name, blend = 0.15) {
  if (p.state === name) return;
  p.state = name; p.model.anim.baseLayer.transition(name, blend);
}
function place(p) {
  p.ent.setPosition(p.pos.x, 0.012, p.pos.z); p.ent.setEulerAngles(0, p.yaw * 180 / Math.PI, 0);
}
function faceTo(p, x, z, rate, dt) {
  const want = Math.atan2(x - p.pos.x, z - p.pos.z); let d = want - p.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += rate ? Math.sign(d) * Math.min(Math.abs(d), rate * dt) : d;
}

// the free ball: a copy of the basketball from the player model
const ball = { ent: P[0].ballNode.clone(), pos: new pc.Vec3(), vel: new pc.Vec3(), q: new pc.Quat(), free: false, holder: null, spin: new pc.Vec3() };
app.root.addChild(ball.ent); ball.ent.setLocalScale(S, S, S); ball.ent.enabled = false;
function showHeld(p) { for (const q of P) q.ballNode.enabled = (q === p); ball.ent.enabled = false; }

// ------------------------------------------------------------------ game state
const game = { phase: 'intro', timer: 0, offense: 0, shotClock: 12, needClear: false, shot: null, crossed: false, lastShooter: null, target: 11, paused: false };
const off = () => P[game.offense], def = () => P[1 - game.offense];
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const rimDist = p => Math.hypot(RIM.x - p.pos.x, RIM.z - p.pos.z);
function toast(text, big) { const t = $('toast'); t.textContent = text; t.className = big ? 'show big' : 'show'; clearTimeout(toast.h); toast.h = setTimeout(() => t.className = '', big ? 2600 : 1500); }
function hud() {
  $('s0').textContent = P[0].score; $('s1').textContent = P[1].score;
  $('clock').textContent = game.phase === 'live' || game.phase === 'shot' ? Math.max(0, Math.ceil(game.shotClock)) : '';
  $('poss0').classList.toggle('on', game.offense === 0 && game.phase !== 'over'); $('poss1').classList.toggle('on', game.offense === 1 && game.phase !== 'over');
}
function setupCheck(team) {
  game.offense = team; game.phase = 'check'; game.timer = 1.1; game.shotClock = 12; game.needClear = false; game.shot = null;
  ball.free = false; ball.holder = off();
  const o = off(), d = def();
  for (const p of P) { p.action = null; p.vel.set(0, 0, 0); p.model.anim.speed = 1; }
  o.pos.set(CHECK.x, 0, CHECK.z + (Math.random() - .5) * 2.5); faceTo(o, RIM.x, RIM.z);
  const dir = new pc.Vec3(RIM.x - o.pos.x, 0, RIM.z - o.pos.z).normalize();
  d.pos.copy(o.pos).add(dir.mulScalar(1.5)); faceTo(d, o.pos.x, o.pos.z);
  setAnim(o, 'Idle', 0.1); setAnim(d, 'Defend', 0.1); showHeld(o);
  for (const p of P) place(p);
  hud();
}
function restartGame() { P[0].score = P[1].score = 0; $('banner').className = ''; setupCheck(Math.random() < .5 ? 0 : 1); toast('First to ' + game.target, true); }

// ------------------------------------------------------------------ ball physics
function releaseBall(p0, v, spinBack) {
  ball.free = true; ball.holder = null; ball.pos.copy(p0); ball.vel.copy(v); ball.ent.enabled = true;
  for (const q of P) q.ballNode.enabled = false;
  ball.spin.set(0, 0, 0); if (spinBack) { const ax = new pc.Vec3(v.z, 0, -v.x).normalize(); ball.spin.copy(ax.mulScalar(-14)); }
  game.crossed = false;
}
function stepBall(dt) {
  const n = 4, h = dt / n;
  for (let i = 0; i < n; i++) {
    const prevY = ball.pos.y;
    ball.vel.y -= G * h; ball.pos.add(ball.vel.clone().mulScalar(h));
    // rim (torus)
    const hx = ball.pos.x - RIM.x, hz = ball.pos.z - RIM.z, L = Math.hypot(hx, hz) || 1e-4;
    const R = new pc.Vec3(RIM.x + hx / L * RIM_R, RIM.y, RIM.z + hz / L * RIM_R);
    const d = ball.pos.clone().sub(R), dl = d.length();
    if (dl < BALL_R + TUBE) {
      const nn = d.mulScalar(1 / dl); ball.pos.copy(R).add(nn.clone().mulScalar(BALL_R + TUBE));
      const vn = ball.vel.dot(nn); if (vn < 0) { ball.vel.sub(nn.mulScalar(1.6 * vn)); ball.vel.mulScalar(0.88); sfx('rim'); }
    }
    // backboard
    if (ball.pos.x + BALL_R > BOARD.x && ball.pos.x < BOARD.x + 0.3 && Math.abs(ball.pos.z - BOARD.z) < BOARD_HALF_W && ball.pos.y > BOARD_Y0 && ball.pos.y < BOARD_Y1 && ball.vel.x > 0) {
      ball.pos.x = BOARD.x - BALL_R; ball.vel.x *= -0.6; ball.vel.z *= 0.9; sfx('board');
    }
    // through the hoop?
    if (!game.crossed && prevY >= RIM.y && ball.pos.y < RIM.y && L < RIM_R - BALL_R * 0.35 && ball.vel.y < 0) { game.crossed = true; scored(); }
    if (L < RIM_R && ball.pos.y < RIM.y && ball.pos.y > RIM.y - 0.55) { ball.vel.x *= 0.96; ball.vel.z *= 0.96; ball.vel.y = Math.max(ball.vel.y, -3.2); }
    // floor
    if (ball.pos.y < BALL_R) {
      ball.pos.y = BALL_R; if (ball.vel.y < -0.6) sfx('bounce');
      ball.vel.y = Math.abs(ball.vel.y) > 0.5 ? -ball.vel.y * 0.72 : 0; ball.vel.x *= 0.96; ball.vel.z *= 0.96;
    }
  }
  // roll / spin
  const vh = new pc.Vec3(ball.vel.x, 0, ball.vel.z);
  let w = ball.spin.clone();
  if (ball.pos.y <= BALL_R + 1e-3) w = new pc.Vec3(vh.z, 0, -vh.x).mulScalar(1 / BALL_R);
  const wl = w.length();
  if (wl > 1e-3) { const dq = new pc.Quat().setFromAxisAngle(w.clone().mulScalar(1 / wl), wl * dt * 57.2958); ball.q.mul2(dq, ball.q); }
  ball.ent.setPosition(ball.pos); ball.ent.setRotation(ball.q);
}

// ------------------------------------------------------------------ actions
function startShot(p) {
  faceTo(p, RIM.x, RIM.z); p.vel.set(0, 0, 0); p.action = { type: 'shoot', t: 0, released: false };
  setAnim(p, 'Shoot', 0.1); p.model.anim.speed = 1;
  const d = def(), g = dist2(d.pos, p.pos);
  if (g < 2.3 && Math.random() < 0.6) d.pendingBlock = { at: 0.12 + Math.random() * 0.12 };
}
function startDunk(p) {
  const dx = RIM.x - p.pos.x, dz = RIM.z - p.pos.z, l = Math.hypot(dx, dz);
  p.pos.set(RIM.x - dx / l * DUNK_DIST, 0, RIM.z - dz / l * DUNK_DIST); faceTo(p, RIM.x, RIM.z); place(p);
  p.vel.set(0, 0, 0); p.action = { type: 'dunk', t: 0, released: false }; setAnim(p, 'Dunk', 0.08); p.model.anim.speed = 1;
  const d = def(); if (dist2(d.pos, p.pos) < 2.6 && Math.random() < 0.45) d.pendingBlock = { at: 0.45 };
  toast(p.name + ' takes off…');
}
function startBlock(p) { p.action = { type: 'block', t: 0 }; p.vel.set(0, 0, 0); setAnim(p, 'Block', 0.08); p.model.anim.speed = 1; }

function shotRelease(p) {
  const p0 = p.ballNode.getPosition().clone(), d = rimDist(p), defn = def(), g = dist2(defn.pos, p.pos);
  game.shot = { pts: d > ARC ? 3 : 2, shooter: p };
  // blocked?
  const blk = defn.action && defn.action.type === 'block' && defn.action.t > 0.22 && defn.action.t < 0.75 && g < 1.5;
  if (blk && Math.random() < 0.55) {
    const away = new pc.Vec3(p.pos.x - RIM.x, 0, p.pos.z - RIM.z).normalize();
    releaseBall(p0, new pc.Vec3(away.x * 3 + (Math.random() - .5) * 3, 2.5, away.z * 3 + (Math.random() - .5) * 3), false);
    game.shot = null; toast('BLOCKED by ' + defn.name + '!', true); sfx('block'); return;
  }
  let make = Math.max(0.22, Math.min(0.74, 0.74 - 0.065 * (d - 4.5)));
  if (g < 1.3) make *= 0.55; else if (g < 2.2) make *= 0.8;
  if (game.shotClock < 1) make *= 0.8;
  const hit = Math.random() < make;
  const tgt = RIM.clone();
  if (hit) { const a = Math.random() * 6.283, r = Math.random() * 0.07; tgt.x += Math.cos(a) * r; tgt.z += Math.sin(a) * r; }
  else { const a = Math.random() * 6.283, r = RIM_R * (0.85 + Math.random() * 0.45); tgt.x += Math.cos(a) * r; tgt.z += Math.sin(a) * r; tgt.y += 0.02; }
  const T = 0.78 + 0.055 * d;
  const v = tgt.clone().sub(p0).sub(new pc.Vec3(0, -0.5 * G * T * T, 0)).mulScalar(1 / T);
  releaseBall(p0, v, true); sfx('swish0');
}
function dunkRelease(p) {
  const p0 = p.ballNode.getPosition().clone();
  game.shot = { pts: 2, shooter: p, dunk: true };
  p0.x = RIM.x; p0.z = RIM.z;                  // straight through the hoop
  releaseBall(p0, new pc.Vec3(0, -4.5, 0), false);
  game.crossed = true; scored(); sfx('board');
}
function scored() {
  const s = game.shot; if (!s) return;
  s.shooter.score += s.pts; game.lastScore = s;
  toast(s.dunk ? s.shooter.name.toUpperCase() + ' SLAMS IT!' : s.pts === 3 ? s.shooter.name + ' drains a three!' : s.shooter.name + ' scores', true);
  sfx('swish'); hud(); game.phase = 'scored'; game.timer = 2.4; game.shot = null;
  if (s.shooter.score >= game.target) { game.phase = 'over'; game.timer = 6; $('banner').textContent = s.shooter.name.toUpperCase() + ' WINS ' + P[0].score + '–' + P[1].score; $('banner').className = 'show t' + s.shooter.team; }
}

// ------------------------------------------------------------------ AI
const clampCourt = v => { v.x = Math.max(0.6, Math.min(14.2, v.x)); v.z = Math.max(-7.2, Math.min(7.2, v.z)); return v; };
function steer(p, target, maxSpeed, dt, accel = 14) {
  const want = new pc.Vec3(target.x - p.pos.x, 0, target.z - p.pos.z); const l = want.length();
  const sp = Math.min(maxSpeed, l * 3.2); if (l > 1e-3) want.mulScalar(sp / l);
  const dv = want.sub(p.vel), dl = dv.length(), mx = accel * dt; if (dl > mx) dv.mulScalar(mx / dl);
  p.vel.add(dv); p.pos.add(p.vel.clone().mulScalar(dt)); clampCourt(p.pos);
}
function offenseAI(p, dt) {
  const d = def(), dr = rimDist(p), g = dist2(d.pos, p.pos);
  const toRim = new pc.Vec3(RIM.x - p.pos.x, 0, RIM.z - p.pos.z).normalize();
  const side = new pc.Vec3(-toRim.z, 0, toRim.x);
  p.think = (p.think || 0) - dt; p.t = (p.t || Math.random() * 10) + dt;
  if (game.needClear) {
    const tgt = new pc.Vec3(RIM.x, 0, RIM.z).sub(toRim.clone().mulScalar(7.3));
    steer(p, tgt, 4.0, dt); if (dr > 7.1) { game.needClear = false; toast(p.name + ' clears it'); }
  } else {
    // defender ahead on the drive line?
    const rel = new pc.Vec3(d.pos.x - p.pos.x, 0, d.pos.z - p.pos.z), ahead = rel.dot(toRim), lat = rel.dot(side);
    const blocked = ahead > 0 && ahead < 2.2 && Math.abs(lat) < 1.0;
    if (p.think <= 0) {
      p.think = 0.25 + Math.random() * 0.2;
      const open = g > 1.9 || ahead < -0.3;
      if (dr < DUNK_DIST + 0.45 && dr > DUNK_DIST - 0.7 && (!blocked || Math.random() < 0.25) && toRim.dot(new pc.Vec3(Math.sin(p.yaw), 0, Math.cos(p.yaw))) > 0.6) return startDunk(p);
      if (dr > 4.6 && dr < 8.6 && (open && Math.random() < 0.45 || game.shotClock < 3.5 || Math.random() < 0.05)) return startShot(p);
      if (game.shotClock < 1.6) return startShot(p);
      p.stall = p.vel.length() < 0.8 ? (p.stall || 0) + 0.3 : 0;
      if (p.stall > 1.2 && dr > 3.0) { p.stall = 0; if (Math.random() < 0.55) return startShot(p); p.juke = (Math.random() < .5 ? -1 : 1) * 2.6; }
      if (blocked) p.juke = (lat > 0 ? -1 : 1) * (1.2 + Math.random());
    }
    p.juke = (p.juke || 0) * Math.pow(0.4, dt);
    const lane = Math.sin(p.t * 1.3) * 1.2 + p.juke;
    const goal = new pc.Vec3(RIM.x, 0, RIM.z).sub(toRim.clone().mulScalar(DUNK_DIST - 0.15)).add(side.clone().mulScalar(lane * Math.min(1, (dr - DUNK_DIST) / 3)));
    steer(p, goal, blocked ? 3.0 : 4.2, dt);
  }
  const sp = p.vel.length();
  if (sp > 0.5) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 7, dt); setAnim(p, 'DribbleRun', 0.2); p.model.anim.speed = Math.max(0.6, sp / RUN_NATIVE); }
  else { faceTo(p, RIM.x, RIM.z, 5, dt); setAnim(p, 'Dribble', 0.2); p.model.anim.speed = 1; }
}
function defenseAI(p, dt) {
  if (p.pendingBlock) { p.pendingBlock.at -= dt; if (p.pendingBlock.at <= 0) { p.pendingBlock = null; return startBlock(p); } }
  const o = off(); const anchor = o.action && o.action.type === 'dunk' ? o.rootBone.getPosition() : o.pos;
  const toRim = new pc.Vec3(RIM.x - anchor.x, 0, RIM.z - anchor.z).normalize();
  const gap = game.needClear ? 2.2 : Math.min(1.35, rimDist(o) * 0.4);
  const tgt = new pc.Vec3(anchor.x, 0, anchor.z).add(toRim.mulScalar(gap));
  steer(p, tgt, 4.6, dt, 11);
  const sp = p.vel.length();
  if (sp > 2.4) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 8, dt); setAnim(p, 'Run', 0.2); p.model.anim.speed = Math.max(0.7, sp / RUN_NATIVE); }
  else { faceTo(p, anchor.x, anchor.z, 6, dt); setAnim(p, 'Defend', 0.25); p.model.anim.speed = 1; }
}
function chaseBall(p, dt) {
  // predict where the ball will be reachable
  const t = ball.pos.y > 2 ? 0.45 : 0.15, tgt = new pc.Vec3(ball.pos.x + ball.vel.x * t, 0, ball.pos.z + ball.vel.z * t);
  clampCourt(tgt);
  steer(p, tgt, 4.8, dt);
  const sp = p.vel.length();
  if (sp > 0.6) { faceTo(p, p.pos.x + p.vel.x, p.pos.z + p.vel.z, 9, dt); setAnim(p, 'Run', 0.15); p.model.anim.speed = Math.max(0.7, sp / RUN_NATIVE); }
  else { faceTo(p, ball.pos.x, ball.pos.z, 6, dt); setAnim(p, 'Defend', 0.2); p.model.anim.speed = 1; }
  if (dist2(p.pos, ball.pos) < 0.8 && ball.pos.y < 1.6) {
    const change = p.team !== game.offense;
    game.offense = p.team; ball.free = false; ball.holder = p; game.shotClock = 12; game.phase = 'live'; showHeld(p);
    game.needClear = change || rimDist(p) < 2.5 && false;
    if (change) toast(p.name + ' rebound'); else toast('Offensive board — ' + p.name);
    setAnim(p, 'Dribble', 0.1); p.model.anim.speed = 1; hud();
  }
}

// ------------------------------------------------------------------ per-frame
function separate() {
  const a = P[0], b = P[1]; if ((a.action && a.action.type === 'dunk') || (b.action && b.action.type === 'dunk')) return;
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, l = Math.hypot(dx, dz), min = 0.95;
  if (l < min && l > 1e-4) {
    const push = (min - l) / 2, nx = dx / l, nz = dz / l;
    if (!a.action) { a.pos.x -= nx * push; a.pos.z -= nz * push; }
    if (!b.action) { b.pos.x += nx * push; b.pos.z += nz * push; }
  }
}
function updateActions(dt) {
  for (const p of P) {
    const a = p.action; if (!a) continue; a.t += dt;
    if (a.type === 'shoot') {
      if (!a.released && a.t >= 0.64) { a.released = true; game.phase = 'shot'; shotRelease(p); }
      if (a.t >= 1.55) { p.action = null; }
    } else if (a.type === 'dunk') {
      if (!a.released && a.t >= 1.06) { a.released = true; game.phase = 'shot'; dunkRelease(p); }
      if (a.t >= 2.9) {
        const r = p.rootBone.getPosition(); p.pos.set(r.x, 0, r.z); place(p);
        p.rootBone.setLocalPosition(0, 0, 0); p.action = null; setAnim(p, 'Idle', 0.0);
      }
    } else if (a.type === 'block') {
      if (a.t >= 1.15) { p.action = null; }
    }
  }
}
function updateCamera(dt) {
  const aspect = app.graphicsDevice.width / app.graphicsDevice.height;
  const focus = ball.free ? ball.pos : (ball.holder ? ball.holder.pos : CHECK);
  const fx = pc.math.clamp(focus.x, 2, 11.5), fz = pc.math.clamp(focus.z, -4, 4);
  const portrait = aspect < 1;
  let pos, look;
  if (camMode === 'broadcast') {
    const dist = portrait ? 15 / Math.max(0.55, aspect) * 0.62 : 15;
    pos = new pc.Vec3(fx - (portrait ? 5.5 : 0), portrait ? 8.5 : 7.2, dist * 0.93);
    look = new pc.Vec3(fx + (portrait ? 1.0 : 0.5), 1.2, fz * 0.35);
    if (portrait) { pos = new pc.Vec3(fx - 9.5, 7.5, 2.0 + fz * 0.3); look = new pc.Vec3(fx + 2.5, 1.2, fz * 0.4); }
  } else {
    pos = new pc.Vec3(RIM.x + 2.4, 3.6, (fz > 0 ? 1 : -1) * 0.4); pos.x = RIM.x + 1.6; pos.y = 4.4;
    look = new pc.Vec3(fx, 1.0, fz);
  }
  camPos.lerp(camPos, pos, Math.min(1, dt * 2.5)); camLook.lerp(camLook, look, Math.min(1, dt * 3.5));
  camera.setPosition(camPos); camera.lookAt(camLook);
  camera.camera.fov = camMode === 'broadcast' ? (portrait ? 52 : 38) : 62;
}
let camMode = 'broadcast'; const camPos = new pc.Vec3(8, 8, 16), camLook = new pc.Vec3(8, 1, 0);

app.on('update', rawDt => {
  const dt = rawDt;
  if (game.paused) return;
  game.timer -= dt;
  if (game.phase === 'intro') { if (game.timer <= 0) restartGame(); }
  else if (game.phase === 'check') {
    if (game.timer <= 0) { game.phase = 'live'; toast(off().name + ' ball'); }
  } else if (game.phase === 'live') {
    game.shotClock -= dt;
    const o = off(), d = def();
    if (!o.action) offenseAI(o, dt);
    if (!d.action) defenseAI(d, dt);
    if (game.shotClock <= 0 && !o.action) { toast('Shot clock violation'); setupCheck(1 - game.offense); }
  } else if (game.phase === 'shot' || game.phase === 'loose') {
    if (game.phase === 'shot') game.shotClock -= 0;
    for (const p of P) {
      if (p.action) continue;
      if (ball.free && (ball.pos.y < 2.6 && ball.vel.y < 0 || ball.pos.y < 1.2 || game.phase === 'loose')) chaseBall(p, dt);
      else { setAnim(p, p === off() ? 'Idle' : 'Defend', 0.3); p.vel.mulScalar(0.8); faceTo(p, ball.pos.x, ball.pos.z, 4, dt); }
    }
    if (ball.free && game.phase === 'shot' && ball.pos.y < RIM.y - 0.6 && !game.crossed) { game.phase = 'loose'; game.shot = null; }
    if (ball.free && (ball.pos.x > 14.7 || ball.pos.x < -0.2 || Math.abs(ball.pos.z) > 7.6)) { toast('Out of bounds'); setupCheck(game.lastTouch === 0 ? 1 : 0); }
  } else if (game.phase === 'scored') {
    for (const p of P) if (!p.action) { p.vel.mulScalar(0.85); setAnim(p, 'Idle', 0.3); }
    if (game.timer <= 0) setupCheck(1 - game.lastScore.shooter.team);
  } else if (game.phase === 'over') {
    for (const p of P) if (!p.action) setAnim(p, 'Idle', 0.3);
    if (game.timer <= 0) restartGame();
  }
  if (ball.holder) game.lastTouch = ball.holder.team;
  updateActions(dt);
  separate();
  for (const p of P) if (!p.action || p.action.type !== 'dunk') place(p);
  if (ball.free) stepBall(dt);
  updateCamera(dt); hud();
});

// ------------------------------------------------------------------ sound (tiny synthesized)
let actx = null;
function sfx(kind) {
  if (!actx || $('mute').classList.contains('on')) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
  const env = (a, d, f0, f1, type) => { o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.start(t); o.stop(t + d); };
  if (kind === 'bounce') env(0.25, 0.12, 140, 60, 'sine');
  else if (kind === 'rim') env(0.12, 0.25, 900, 600, 'triangle');
  else if (kind === 'board') env(0.18, 0.15, 220, 120, 'square');
  else if (kind === 'swish') env(0.08, 0.35, 2000, 600, 'sawtooth');
  else if (kind === 'block') env(0.2, 0.12, 300, 90, 'square');
  else if (kind === 'swish0') env(0.0001, 0.05, 100, 100, 'sine');
}
document.addEventListener('pointerdown', () => { if (!actx) try { actx = new AudioContext(); } catch (e) {} }, { once: true });

// ------------------------------------------------------------------ controls
$('pause').onclick = () => { game.paused = !game.paused; $('pause').textContent = game.paused ? 'Play' : 'Pause'; app.timeScale = game.paused ? 0 : speed; };
let speed = 1;
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; app.timeScale = game.paused ? 0 : speed; $('speed').textContent = speed + '×'; };
$('cam').onclick = () => { camMode = camMode === 'broadcast' ? 'baseline' : 'broadcast'; $('cam').textContent = camMode === 'broadcast' ? 'Baseline cam' : 'Broadcast cam'; };
$('restart').onclick = () => restartGame();
$('mute').onclick = () => $('mute').classList.toggle('on');
window.game = { game, P, ball, RIM, S, setupCheck, startShot, startDunk };
for (const p of P) { p.pos.set(CHECK.x, 0, p.team ? 2 : -2); place(p); showHeld(null); }
game.phase = 'intro'; game.timer = 0.8;
app.start(); $('loading').hidden = true; $('status').textContent = '';
} catch (e) { $('loading').textContent = 'Unable to start: ' + e.message; console.error(e); }
})();
