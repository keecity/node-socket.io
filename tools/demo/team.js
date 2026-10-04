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
// ---- cash + contracts: wins and contracts pay cash; cash buys draft picks
const draftCost = () => 500 + 250 * Math.max(0, TEAM.roster.length - 6);
const CT_KINDS = [   // [key, label, team target, team reward, matches allowed]
  ['pts', 'Score {n} points', 8, 120, 1], ['threes', 'Make {n} threes', 3, 100, 2], ['steals', 'Get {n} steals', 2, 100, 1],
  ['reb', 'Grab {n} rebounds', 4, 90, 1], ['skills', 'Use {n} skills', 3, 150, 3], ['wins', 'Win {n} games', 3, 400, 5], ['margin', 'Win a game by {n}+', 8, 250, 3]];
const nextMidnight = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return +d; };
const nextMonday = () => { const d = new Date(); d.setHours(24, 0, 0, 0); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); if (+d - Date.now() < 2 * 864e5) d.setDate(d.getDate() + 7); return +d; };   // a fresh weekly always gets 2+ days
function newContract(named, wk, list) {   // wk: weekly contracts ask for ~3x more and pay ~3.5x
  const used = list.filter(c => c.wk === wk).map(c => c.k), pool = CT_KINDS.filter(x => !used.includes(x[0]) && (wk || x[0] !== 'wins') && !(named && (x[0] === 'wins' || x[0] === 'margin'))), k = pool[Math.floor(Math.random() * pool.length)], solo = k[0] === 'wins' || k[0] === 'margin';
  const who = named && !solo ? Math.floor(Math.random() * Math.min(3, TEAM.roster.length)) : null;
  let n = who === null ? k[2] : Math.max(1, Math.round(k[2] * 0.75)); if (wk) n = k[0] === 'wins' ? 5 : k[0] === 'margin' ? 12 : n * 3;
  return { k: k[0], n, who, name: who === null ? null : TEAM.roster[who].name, got: 0, wk, exp: wk ? nextMonday() : nextMidnight(), pay: Math.round(k[3] * (who === null ? 1 : 1.75) * (wk ? 3.5 : 1) / 5) * 5 };
}
function ctText(c) { const k = CT_KINDS.find(x => x[0] === c.k); return k[1].replace('{n}', c.n) + (c.name ? ' with ' + c.name : ''); }
function ctLeft(c) { const m = Math.max(0, Math.round((c.exp - Date.now()) / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); return d ? d + 'd ' + h + 'h left' : h + 'h ' + (m % 60) + 'm left'; }
function ensureContracts() {   // 3 daily contracts reset at midnight, 2 weekly reset Monday midnight; expired ones just disappear
  TEAM.cash ??= 500; TEAM.ct = (TEAM.ct || []).filter(c => c.exp && c.exp > Date.now() && c.got < c.n);
  const fill = (wk, max) => { let i = 0; while (TEAM.ct.filter(c => c.wk === wk).length < max) TEAM.ct.push(newContract(i++ === 1 || (i > 2 && Math.random() < 0.5), wk, TEAM.ct)); };
  fill(false, 3); fill(true, 2);
}
let CT = null;   // this match's tallies: CT[stat][roster index]
function ctStart() { CT = { pts: {}, threes: {}, steals: {}, reb: {}, skills: {} }; }
function ctAdd(stat, p, n = 1) {
  if (!CT || !p || p.team !== 0 || NET.role === 'guest') return; const i = team(0).indexOf(p); CT[stat][i] = (CT[stat][i] || 0) + n;
  ensureContracts(); for (const c of TEAM.ct) if (c.k === stat && (c.who === null || c.who === i)) { const was = c.got; c.got = Math.min(c.n, c.got + n); if (c.got > was && c.got < c.n) toastL('Contract: ' + c.got + '/' + c.n + ' — ' + ctText(c), false); if (c.got >= c.n && was < c.n) toastL('CONTRACT DONE: ' + ctText(c), true); }
}
function ctEnd(won, margin) {   // after a match: pay for the win/loss and any finished contracts
  if (NET.role) return { pay: 0, done: [] }; ensureContracts(); let pay = won ? 300 : 75; const done = [];
  for (const c of TEAM.ct) { if (c.k === 'wins' && won) c.got++; if (c.k === 'margin' && won && margin >= c.n) c.got = c.n; }
  TEAM.ct = TEAM.ct.filter(c => { if (c.got >= c.n) { pay += c.pay; done.push(c); return false; } return true; });
  TEAM.cash += pay; ensureContracts(); saveTeam(); CT = null;
  return { pay, done };
}
// ---- gym: buy and upgrade equipment with cash; every level adds +5% to all match XP (bonuses stack, max level 3)
const EQUIP = ['SHOOTING MACHINE', 'WEIGHT BENCH', 'TREADMILL', 'RECOVERY STATION', 'SPIN BIKE', 'ROWING MACHINE', 'POWER RACK', 'DUMBBELL RACK', 'CABLE MACHINE', 'PLYO BOXES', 'MEDICINE BALLS', 'PUSH SLED',
  'STAIR CLIMBER', 'ELLIPTICAL', 'LEG PRESS', 'LEG EXTENSION', 'LAT PULLDOWN', 'PULL-UP TOWER', 'KETTLEBELL RACK', 'REBOUNDER NET', 'HEAVY BAG', 'ICE BATH', 'MASSAGE TABLE', 'AGILITY HURDLES'];
const EQ_MAX = 3;
const eqPct = i => Math.round((0.5 + 1.5 * i / (EQUIP.length - 1)) * 2) / 2;   // % per level: 0.5% for the first machine up to 2% for the last (full gym about +90%)
const fmtPct = v => +v.toFixed(1);
const eqCost = (i, lv) => Math.round((300 + 150 * i) * (1 + 0.6 * lv) / 50) * 50;   // later machines cost more   // buy (lv 0) or upgrade price
const gymPct = () => fmtPct(EQUIP.reduce((a, _, i) => a + ((TEAM.gym || {})[i] || 0) * eqPct(i), 0));
function drawGym() {
  ensureContracts(); TEAM.gym ??= {}; const s = T.querySelector('.scr[data-v="gym"] .body'), pct = gymPct(), coin = '<i class="gcoin"></i>';
  T.querySelector('.scr[data-v="gym"] .gcash').innerHTML = coin + TEAM.cash.toLocaleString();
  s.innerHTML = `<div class="ghero"><i class="groom"></i><i class="glogo mascot lg${TEAM.mascot}"></i><div class="gtt"><b>TEAM TRAINING</b><em>+${pct}% MATCH XP</em><small>APPLIES TO EVERY ROSTER PLAYER.</small></div><div class="gex"><small>EXAMPLE:</small><b>100 XP → <em>${Math.round(100 + pct)} XP</em></b></div></div>
  <div class="gsec"><b>EQUIPMENT</b><small>PERMANENT XP BONUSES STACK.</small></div>
  ${EQUIP.map((n, i) => { const lv = TEAM.gym[i] || 0, max = lv >= EQ_MAX, c = eqCost(i, lv);
    return `<div class="geq"><i class="gimg" style="background-image:var(--g-eq${i})"></i><div class="ginfo"><b>${n}</b><span class="glv">${lv ? 'LV ' + lv : 'NOT OWNED'}</span><small>${max ? `+${fmtPct(lv * eqPct(i))}% XP · MAX` : lv ? `+${fmtPct(lv * eqPct(i))}% → <em>+${fmtPct((lv + 1) * eqPct(i))}% XP</em>` : `UNLOCK <em>+${eqPct(i)}% XP</em>`}</small></div>${max ? '<div class="gbtn max"><b>MAXED</b></div>' : `<button class="gbtn${TEAM.cash < c ? ' off' : ''}" data-act="gymbuy" data-val="${i}"><b>${lv ? 'UPGRADE' : 'BUY'}</b><span>${coin}${c.toLocaleString()}</span></button>`}</div>`; }).join('')}
  <p class="ginf"><i class="ginfo-i"></i>EARN COINS BY PLAYING MATCHES.</p>`;
}
const upCost = r => 50 * (r.ups ?? r.lv);   // every upgrade costs more than the one before
const lvNeed = lv => 3 + 3 * lv;   // level points for the next level: 6, 9, 12 ... (each upgrade gives +3)
const SKILLS = {   // [name, what it does] - every skill lasts 8 seconds once activated; icon order follows the skill sheet
  middunk: ['MID-COURT DUNK', 'Shots inside the arc go in far more often'], speedboost: ['SPEED BOOST', 'Runs 35% faster'],
  stamina: ['HIGH STAMINA', 'Sprinting uses no stamina'], superjump: ['SUPER JUMP', 'Higher blocks and longer reach for rebounds'],
  powerdunk: ['POWER DUNK', 'Shots at the rim can\'t be blocked and rarely miss'],
  longrange: ['LONG RANGE', '3-pointers go in 40% more often'], accuracy: ['SHOT ACCURACY', 'Every shot is 25% more accurate'],
  quickrelease: ['QUICK RELEASE', 'Shot meter sweeps much slower'], hotstreak: ['HOT STREAK', 'Wider perfect window; each make adds 3 seconds'],
  clutch: ['CLUTCH SHOOTING', 'Big accuracy boost in close games and late in the shot clock'],
  stealboost: ['STEAL BOOST', 'Steals succeed far more often'], block: ['SHOT BLOCKING', 'Blocks almost every shot you contest'],
  lockdown: ['LOCKDOWN DEFENSE', 'The player you guard shoots far worse'], rebound: ['REBOUND BOOST', 'Grabs rebounds from much further away'],
  intercept: ['PASS INTERCEPTION', 'Picks off passes near you twice as often'],
  fastpass: ['FAST PASSING', 'Passes fly much faster'], teamassist: ['TEAM ASSIST', 'Teammates shoot 30% better off your passes'],
  dribble: ['DRIBBLE MASTERY', 'The ball can\'t be stolen from you'], crossover: ['CROSSOVER', 'Freezes nearby defenders and gives a burst of speed'],
  vision: ['COURT VISION', 'Your passes can\'t be picked off'],
  recovery: ['STAMINA RECOVERY', 'Refills the whole team\'s stamina and speeds recovery'], finishing: ['STRONG FINISHING', 'Close shots go in 40% more often'],
  contact: ['CONTACT RESISTANCE', 'Defenders contesting your shot don\'t bother you'], footwork: ['BALANCED FOOTWORK', 'Steadier shot meter and a little extra speed'],
  allaround: ['ALL-AROUND BOOST', 'Faster, better shooting and better steals'],
};
// skills charge only for the player you control: slowly while you have the ball, faster for shooting, running, passing and
// rebounding; the one defensive action that charges is a steal. A full charge shows the button.
function skillCharge(p, n) { if (!p || p.team !== 0 || !p.skill || !ctl(0) || NET.role === 'guest') return; p.chg = Math.min(100, (p.chg || 0) + n); }
function buffOn(p, k) { return !!p && p.buff === k && performance.now() < p.buffT; }
// how each skill runs: 'shot' / 'pass' = armed until your next shot / pass, 'now' = instant, otherwise an 8 s timer
const SKILL_USE = { longrange: 'shot', accuracy: 'shot', quickrelease: 'shot', clutch: 'shot', finishing: 'shot', powerdunk: 'shot', middunk: 'shot', contact: 'shot',
  teamassist: 'pass', fastpass: 'pass', crossover: 'now', recovery: 'now' };
const SKILL_FX = { gold: 'middunk powerdunk longrange accuracy quickrelease hotstreak clutch finishing contact', green: 'speedboost stamina footwork allaround superjump crossover recovery',
  red: 'stealboost block lockdown rebound intercept', teal: 'fastpass teamassist dribble vision' };
const fxOf = k => Object.keys(SKILL_FX).find(c => SKILL_FX[c].split(' ').includes(k)) || 'gold';
const FX_RGB = { gold: [1, 0.7, 0.1], green: [0.2, 1, 0.35], red: [1, 0.15, 0.15], teal: [0.1, 0.9, 1], blue: [0.3, 0.6, 1] };
function glowModel(p, c) {   // tint the whole 3D player (jersey, skin, hair) with an emissive colour; null clears it
  for (const r of p.model.findComponents('render')) for (const mi of r.meshInstances) {
    if (!mi.material) continue; if (!mi._own) { mi._own = true; mi.material = mi.material.clone(); }
    const m = mi.material; m.emissive = c ? new pc.Color(c[0] * 0.55, c[1] * 0.55, c[2] * 0.55) : new pc.Color(0, 0, 0); m.update();
  }
}
// visual effect on a player that both screens see: a glow on the model, a glowing name tag and a badge over it
function setFx(p, kind, ms, label) {
  if (!p) return; p.fx = kind ? { kind, until: performance.now() + ms, label } : null;
  glowModel(p, kind ? FX_RGB[kind] : null); fxTag(p);
  if (NET.role === 'host') netEv('fx', p.id, (kind || '') + '|' + ms + '|' + (label || ''));
}
function fxTag(p) {
  const L = p.label; L.classList.remove('fx-gold', 'fx-green', 'fx-red', 'fx-teal', 'fx-blue');
  let b = L.querySelector('.fxb'); if (!p.fx) { if (b) b.remove(); return; }
  L.classList.add('fx-' + p.fx.kind); if (!b) { b = el('em', 'fxb'); L.appendChild(b); } b.textContent = p.fx.label;
}
function useSkill(p, kind) {   // an armed shot / pass skill is spent
  if (p && p.buff && SKILL_USE[p.buff] === kind && performance.now() < p.buffT) { p.buffT = 0; setFx(p, null); }
}
function activate(p) {
  const k = p.skill, use = SKILL_USE[k], now = performance.now(), c = fxOf(k); p.chg = 0; p.buff = k;
  toast(p.name.toUpperCase() + ': ' + SKILLS[k][0] + '!', true); sfx('cheer', 0.4);
  if (use === 'shot' || use === 'pass') { p.buffT = now + 60000; setFx(p, c, 60000, SKILLS[k][0] + ' • NEXT ' + use.toUpperCase()); }
  else if (k === 'crossover') {
    p.buffT = now + 3000; setFx(p, c, 3000, 'CROSSOVER');
    team(1).forEach(q => { if (d2(q.pos, p.pos) < 3.2) { q.react = 1.5; q.vel.set(0, 0, 0); setFx(q, 'blue', 1500, 'FROZEN'); } });
  } else if (k === 'recovery') { p.buffT = now + 8000; team(0).forEach(q => { q.stamina = 1; setFx(q, c, 1500, 'RECHARGED'); }); setTimeout(() => setFx(p, c, 6500, SKILLS[k][0]), 1500); }
  else { p.buffT = now + 8000; setFx(p, c, 8000, SKILLS[k][0]); }
}
let abilEl = null;
function abilTick() {
  if (!abilEl) {
    abilEl = el('button'); abilEl.id = 'abil'; abilEl.hidden = true; document.body.appendChild(abilEl);
    abilEl.onclick = e => { e.stopPropagation(); const p = abilEl.p; if (!p || p.chg < 100 || abilEl.classList.contains('act')) return; activate(p); abilEl.p = null; };
    ['pointerdown', 'touchstart', 'mousedown'].forEach(ev => abilEl.addEventListener(ev, e => e.stopPropagation()));
  }
  const now = performance.now();
  for (const q of P) if (q.fx && now > q.fx.until) setFx(q, null);
  const inGame = $('home').hidden && T.hidden && game.phase !== 'over';
  const h = ball.holder; if (inGame && game.phase === 'live' && h && h.team === 0) skillCharge(h, 0.1 + (h.vel.length() > 2 ? 0.25 : 0));
  const ready = inGame ? team(0).filter(q => q.skill && q.chg >= 100) : [], p = ready.find(q => q === ball.holder) || ready[0] || null;
  const on = inGame && NET.role !== 'guest' ? team(0).find(q => q.buff && now < q.buffT) : null;   // an active skill shows its timer / armed state
  if (on) {
    const use = SKILL_USE[on.buff], armed = use === 'shot' || use === 'pass', left = (on.buffT - now) / 1000;
    const k = 'on' + on.id + on.buff + (armed ? 'a' : Math.ceil(left));
    if (abilEl.k !== k) { abilEl.k = k; abilEl.p = null; abilEl.innerHTML = '<i class="ski ski-' + on.buff + '"></i><b>' + SKILLS[on.buff][0] + '</b><small>' + (armed ? 'NEXT ' + use.toUpperCase() : Math.ceil(left) + 's') + '</small>'; }
    abilEl.classList.add('act'); abilEl.classList.toggle('armed', armed); abilEl.style.setProperty('--left', armed ? 1 : Math.min(1, left / (on.buff === 'crossover' ? 3 : 8))); abilEl.hidden = false; return;
  }
  abilEl.classList.remove('act', 'armed');
  if (p !== abilEl.p || abilEl.k) { abilEl.k = null; abilEl.p = p; if (p) abilEl.innerHTML = '<i class="ski ski-' + p.skill + '"></i><b>' + SKILLS[p.skill][0] + '</b><small>' + esc(p.name) + '</small>'; }
  abilEl.hidden = !p;
}
setInterval(abilTick, 100);
function skillPick(r) {   // level up: choose one of two skills (replaces the current one) or skip
  const pool = Object.keys(SKILLS).filter(k => !(r.skills || []).includes(k)), two = [];
  while (two.length < 2) { const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; two.push(k); }
  let m = T.querySelector('#ucf'); if (!m) { m = el('div'); m.id = 'ucf'; T.appendChild(m); }
  m.innerHTML = `<div class="box"><h3>${esc(r.name.toUpperCase())} REACHED LEVEL ${r.lv}!</h3><div class="cst">Choose a new skill — it becomes active, and your other skills stay unlocked</div><div class="sks">${two.map(k => `<button class="sk" data-act="skill" data-val="${k}"><i class="ski ski-${k}"></i><b>${SKILLS[k][0]}</b><small>${SKILLS[k][1]}</small></button>`).join('')}</div><div class="bts"><button class="no" data-act="ucancel">SKIP</button></div></div>`;
  m.hidden = false;
}
function teamXP(n) { TEAM.xp += Math.round(n * (1 + gymPct() / 100)); saveTeam(); }   // gym equipment boosts all match XP
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
function setTC(i) { T.style.setProperty('--tc', COLORS[i][1]); T.style.setProperty('--tcb', i >= 6 ? '#ffc233' : COLORS[i][1]); }   // bars fall back to gold for white/black teams
function applyRoster() {
  setTC(TEAM.color);
  team(0).forEach(p => paintJersey(p.model, TEAM.color));
  team(0).forEach((p, i) => {
    const r = TEAM.roster[i]; if (!r) return;
    p.name = r.name.toUpperCase().slice(0, 1) + r.name.slice(1).toLowerCase(); if (p.label.firstChild) p.label.firstChild.nodeValue = p.name;
    if (p.hairKey !== r.hair + ':' + r.tint) { p.hairEnt = setHair(p.model, r.hair, r.tint, p.hairEnt); p.hairKey = r.hair + ':' + r.tint; }
    if (p.spd0 === undefined) p.spd0 = p.spd; p.spd = p.spd0 * (0.86 + r.stats.speed / 300); p.rat = r.stats; p.skill = r.skill || null;
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
  setTC(view === 'edit' && EDIT ? EDIT.color : TEAM.color);
  ({ team: drawTeam, edit: drawEdit, draft: drawDraft, details: drawDetails, contracts: drawContracts, gym: drawGym })[view]();
  T.querySelector('.scr[data-v="' + view + '"] .body').scrollTop = 0;
}
function closeTeam() { T.hidden = true; $('home').hidden = false; applyRoster(); }
T.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, v = b.dataset.val;
  if (a === 'back') { if (T.dataset.view === 'team') closeTeam(); else openTeam('team'); }
  else if (a === 'go') openTeam(v);
  else if (a === 'player') openTeam('details', +v);
  else if (a === 'gymbuy') {
    TEAM.gym ??= {}; const i = +v, lv = TEAM.gym[i] || 0, c = eqCost(i, lv); if (lv >= EQ_MAX) return;
    if (TEAM.cash < c) return toastL('Need ' + c.toLocaleString() + ' coins — earn coins by playing matches', false);
    TEAM.cash -= c; TEAM.gym[i] = lv + 1; saveTeam(); sfxL('cheer', 0.4); toastL(EQUIP[i] + (lv ? ' upgraded to LV ' + (lv + 1) : ' bought') + ' — team XP +' + gymPct() + '%', true); drawGym();
  }
  else if (a === 'lineup') {                      // tap two players to swap them (starters <-> bench)
    if (LINEUP === null) { LINEUP = +v; toastL('Now tap a player to swap with ' + TEAM.roster[+v].name, false); drawTeam(); }
    else { const i = LINEUP, j = +v; LINEUP = null; [TEAM.roster[i], TEAM.roster[j]] = [TEAM.roster[j], TEAM.roster[i]]; saveTeam(); applyRoster(); drawTeam(); }
  }
  else if (a === 'editlineup') { LINEUP = null; const on = T.classList.toggle('swap'); toastL(on ? 'Tap a player, then the player to swap with' : 'Lineup saved', false); drawTeam(); }
  else if (a === 'color') { EDIT.color = +v; setTC(EDIT.color); drawEdit(); }
  else if (a === 'font') { EDIT.font = +v; drawEdit(); }
  else if (a === 'mascot') { EDIT.mascot = +v; const sc = T.querySelector('.masc').scrollTop; drawEdit(); T.querySelector('.masc').scrollTop = sc; }
  else if (a === 'saveteam') { TEAM.name = (T.querySelector('#tname').value || 'MY TEAM').toUpperCase().slice(0, 20); TEAM.color = EDIT.color; TEAM.mascot = EDIT.mascot; TEAM.font = EDIT.font; saveTeam(); applyRoster(); toastL('Team saved', false); openTeam('team'); }
  else if (a === 'pick') { DSEL = +v; drawDraft(); }
  else if (a === 'draftit') {
    if (TEAM.roster.length >= ROSTER_MAX) return toastL('Roster full (' + ROSTER_MAX + ' players)', true);
    const p = TEAM.draft[DSEL], dc = draftCost(); ensureContracts(); if (TEAM.cash < dc) return toastL('Need $' + dc + ' to draft — win games and finish contracts', false); TEAM.cash -= dc; TEAM.roster.push(p); TEAM.draft = null; saveTeam(); toastL(p.name.toUpperCase() + ' drafted!', true); sfxL('cheer', 0.6); openTeam('team');
  }
  else if (a === 'ustat') {   // ask before spending XP on one stat
    const r = TEAM.roster[TSEL] || TEAM.roster[0], c = upCost(r), to = Math.min(99, r.stats[v] + NEXT[v]); if (r.stats[v] >= 99) return toastL(v.toUpperCase() + ' is maxed', false);
    let m = T.querySelector('#ucf'); if (!m) { m = el('div'); m.id = 'ucf'; T.appendChild(m); }
    m.innerHTML = `<div class="box"><h3>UPGRADE ${v.toUpperCase()}?</h3><div class="chg">${r.stats[v]} ▸ <b>${to}</b></div><div class="cst">Cost <b>${c} XP</b> · you have ${TEAM.xp} XP</div><div class="bts"><button class="no" data-act="ucancel">CANCEL</button><button class="ok${TEAM.xp < c ? ' off' : ''}" data-act="upgrade" data-val="${v}">UPGRADE</button></div></div>`;
    m.hidden = false;
  }
  else if (a === 'ucancel') T.querySelector('#ucf').hidden = true;
  else if (a === 'viewskill') {
    const r = TEAM.roster[TSEL] || TEAM.roster[0], u = SKILL_USE[v], how = u === 'shot' ? 'Powers up your next shot' : u === 'pass' ? 'Powers up your next pass' : v === 'crossover' ? 'Instant, with a 3 second burst' : u === 'now' ? 'Instant' : 'Lasts 8 seconds';
    let m = T.querySelector('#ucf'); if (!m) { m = el('div'); m.id = 'ucf'; T.appendChild(m); }
    m.innerHTML = `<div class="box"><i class="ski ski-${v} skbig"></i><h3>${SKILLS[v][0]}</h3><div class="cst">${SKILLS[v][1]}.</div><div class="cst"><b>${how}.</b> Charges while you control ${esc(r.name)}.</div><div class="bts"><button class="no" data-act="ucancel">CLOSE</button><button class="ok${v === r.skill ? ' off' : ''}" data-act="setskill" data-val="${v}">${v === r.skill ? 'EQUIPPED' : 'EQUIP'}</button></div></div>`;
    m.hidden = false;
  }
  else if (a === 'setskill') { if (T.querySelector('#ucf')) T.querySelector('#ucf').hidden = true; if ((TEAM.roster[TSEL] || TEAM.roster[0]).skill === v) return; const r = TEAM.roster[TSEL] || TEAM.roster[0]; r.skill = v; saveTeam(); applyRoster(); toastL(SKILLS[v][0] + ' is now active', false); drawDetails(); }
  else if (a === 'skill') { const r = TEAM.roster[TSEL] || TEAM.roster[0]; r.skills = [...new Set([...(r.skills || (r.skill ? [r.skill] : [])), v])]; r.skill = v; saveTeam(); applyRoster(); T.querySelector('#ucf').hidden = true; toastL(r.name.toUpperCase() + ' learned ' + SKILLS[v][0], true); drawDetails(); }
  else if (a === 'upgrade') {
    const r = TEAM.roster[TSEL] || TEAM.roster[0], c = upCost(r); if (TEAM.xp < c) return toastL('Not enough XP — earn XP by playing games', false);
    T.querySelector('#ucf').hidden = true;
    TEAM.xp -= c; r.stats[v] = Math.min(99, r.stats[v] + NEXT[v]); r.ups = (r.ups ?? r.lv) + 1; r.lp = (r.lp || 0) + 3; let up = false;
    while (r.lp >= lvNeed(r.lv)) { r.lp -= lvNeed(r.lv); r.lv++; up = true; }
    saveTeam(); applyRoster(); sfxL('net', 0.6); toastL(v.toUpperCase() + ' upgraded to ' + r.stats[v], true); drawDetails(); if (up) skillPick(r);
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
  <div class="cashbar"><i class="coin">$</i><b>${(ensureContracts(), TEAM.cash).toLocaleString()}</b><span>CASH</span><button class="bgold ctb" data-act="go" data-val="contracts"><span class="lbl">CONTRACTS${TEAM.ct.some(c => c.got >= c.n) ? ' ✓' : ''}</span></button></div>
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
function drawContracts() {
  ensureContracts(); const s = T.querySelector('.scr[data-v="contracts"] .body');
  s.innerHTML = `<div class="cashbar"><i class="coin">$</i><b>${TEAM.cash.toLocaleString()}</b><span>CASH</span></div>
  <p class="uhow">Finish contracts before the timer runs out to earn bonus cash. Contracts that name a player pay more — you must control that player.</p>
  ${[['DAILY', false, 'Resets every day at midnight'], ['WEEKLY', true, 'Resets every Monday']].map(([h, wk, sub]) => `<h4 class="cth">${h} <small>${sub}</small></h4>` + TEAM.ct.filter(c => c.wk === wk).map(c => `<div class="ctc${c.name ? ' named' : ''}">${c.who !== null && TEAM.roster[c.who] ? pic(TEAM.roster[c.who]) : `<i class="mascot lg${TEAM.mascot}"></i>`}<div class="ctm"><b>${esc(ctText(c))}</b><i class="bar"><b style="width:${c.got / c.n * 100}%"></b></i><small>${c.k === 'margin' ? (c.got >= c.n ? 'Done' : 'Not yet') : c.got + ' / ' + c.n} · ${ctLeft(c)}</small></div><div class="ctp">$${c.pay}</div></div>`).join('')).join('')}
  <p class="sub">Win: $300 · Loss: $75 · Draft pick: $${draftCost()}</p>
  <button class="tealbtn" data-act="go" data-val="team"><span class="lbl">BACK TO ROSTER</span></button>`;
}
function drawDetails() {
  const s = T.querySelector('.scr[data-v="details"] .body'), r = TEAM.roster[TSEL] || TEAM.roster[0], c = upCost(r);
  NEXT = {}; for (const k of STATS) NEXT[k] = 2 + ((r.lv + k.length) % 2);   // +2 or +3 each level
  s.innerHTML = `
  <div class="dhead"><button class="arrow l" data-act="prevp">‹</button>${pic(r)}<div class="pn">${esc(r.name)}</div><div class="pl">LEVEL ${r.lv}</div>
    <i class="bar"><b style="width:${Math.min(100, (r.lp || 0) / lvNeed(r.lv) * 100)}%"></b></i><div class="lvb">${num(r.lv)}</div><div class="ovrb">${num(ovr(r))}</div><button class="arrow r" data-act="nextp">›</button></div>
  <div class="xpb"><i class="xpfill" style="width:${Math.min(100, TEAM.xp / c * 100) * 0.559}%"></i><b class="need">${TEAM.xp} / ${c} XP</b></div>
  <p class="uhow">Tap a stat to upgrade it. Each upgrade raises one stat, adds +3 level points and costs more XP than the last. Level up to choose a skill.</p>
  <p class="uskill">${r.skill ? `<i class="ski ski-${r.skill}"></i>SKILL: <b>${SKILLS[r.skill][0]}</b> — ${SKILLS[r.skill][1]}. Charges as you play; tap its button in a match.` : `No skill yet — reach level ${r.lv + 1} to choose one.`}</p>
  <div class="upan"><i class="uh"></i>${STATS.map((k, i) => `<div class="ug">${k.toUpperCase()}${i === 0 ? `<span class="lvn">LEVEL PTS ${r.lp || 0} / ${lvNeed(r.lv)}</span>` : ''}</div><div class="urow r${i}${r.stats[k] >= 99 ? ' max' : ''}" data-act="ustat" data-val="${k}"><i class="uic"></i><i class="ubar"><b style="width:${r.stats[k]}%"></b></i><span class="a">${r.stats[k]}</span><span class="b">${Math.min(99, r.stats[k] + NEXT[k])}</span></div>`).join('')}<i class="ug"></i><i class="uf"></i></div>
  <div class="cost"><div><small>UPGRADE COST</small>${num(c, 'g')}<b class="xpw">XP</b></div><div><small>XP AFTER UPGRADE</small>${TEAM.xp >= c ? num(TEAM.xp - c) : '<b class="no">NEED ' + (c - TEAM.xp) + '</b>'}</div></div>
  <div class="skl"><h4>UNLOCKED SKILLS <small>tap a skill to view or equip it</small></h4>${(() => { const L = r.skills || (r.skill ? [r.skill] : []); return L.length ? '<div class="skg">' + L.map(k => `<button class="sko${k === r.skill ? ' on' : ''}" data-act="viewskill" data-val="${k}"><i class="ski ski-${k}"></i><b>${SKILLS[k][0]}</b>${k === r.skill ? '<small>ACTIVE</small>' : ''}</button>`).join('') + '</div>' : `<p>No skills yet — level up to level ${r.lv + 1} to unlock your first.</p>`; })()}</div>
  <button class="tealbtn" data-act="go" data-val="team"><span class="lbl">BACK TO ROSTER</span></button>
  <p class="sub">Earn XP by playing games.</p>`;
}
$('hteam').onclick = () => openTeam('team'); $('hnteam').onclick = () => openTeam('team'); $('hndraft').onclick = () => openTeam('draft'); $('hnup').onclick = () => openTeam('details', 0); $('hngym').onclick = () => openTeam('gym');
applyRoster();
