// ====================================================================== online head-to-head
// The host's screen runs the whole game (Purple). A guest who joins controls Teal: their taps travel to the
// host as commands, and the host streams the game state back. Both ride on the room's presence channel.
var NET = { role: null, peer: null, room: null, lobby: null, code: null, rdown: false, seq: 0, ev: [], evSeq: 0, lastCmd: 0, lastEv: 0, snap: null, cmds: [], sent: 0 };
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
  const p = P[c.p]; if (!p || p.team !== t || game.phase !== 'live' && c.t !== 'move') return;
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
    bh: ball.holder ? ball.holder.id : -1, b: [r2(ball.pos.x), r2(ball.pos.y), r2(ball.pos.z)],
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
    else if (e[1] === 'ban') { $('banner').textContent = String(e[2]).slice(0, 40); $('banner').className = e[3] === 'show t0' || e[3] === 'show t1' ? e[3] : ''; }
  }
}
function guestFrame(dt) {
  const s = NET.snap;
  if (s) {
    game.phase = s.ph; game.score = s.sc; game.shotClock = s.sk; game.offense = s.of;
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
  viewFrame(dt); updateCamera(dt); hud();
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
  HUMAN = team; human.on = true; game.paused = false; app.timeScale = 1; speed = 1; $('speed').textContent = '1×'; $('pause').textContent = 'Pause';
  for (const id of ['mode', 'pause', 'speed', 'restart']) $(id).hidden = on;
  $('hint').innerHTML = 'You are <b>' + (team ? 'Teal' : 'Purple') + '</b>' + (on ? ' · online vs a friend' : '') + ' · tap court to move · tap a teammate to pass · keep tapping the spot to sprint · hold to shoot · on defense get close and tap to steal';
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
      NET.peer = g.peer; NET.lobby.presence({ open: null }).catch(() => {}); panel.hidden = true; onlineMode(true, 0); restart(); toast('Friend joined — you are Purple', true); } }
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
