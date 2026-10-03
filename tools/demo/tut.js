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
  $('hint').hidden = true; tutEl.hidden = false; tutBtn.textContent = 'End tutorial'; tutSetup();
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
  for (const p of P) setAnim(p, p === ball.holder ? 'Dribble' : p.team === HUMAN ? 'Ready' : 'Defend', 0.1);
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
  animMove(p, dt, ball.holder === p ? 'handler' : ball.holder && ball.holder.team === p.team ? 'offball' : 'stance');
  const b = ball.holder ? bodyPos(ball.holder) : ball.pos; if (ball.holder !== p) faceTo(p, b.x, b.z, 4, dt);
}
