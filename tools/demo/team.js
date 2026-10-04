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
function applyRoster() {
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
  const key = r.hair + ':' + r.tint; if (PORTRAIT[key]) return PORTRAIT[key];
  try {
    if (!studio) {
      studio = new pc.Entity('studio'); app.root.addChild(studio); studio.setPosition(0, -200, 0);
      const m = playerAsset.resource.instantiateRenderEntity(); studio.addChild(m); m.setLocalScale(1, 1, 1); studio.model = m;
      const cam = new pc.Entity('pcam'); cam.addComponent('camera', { clearColor: new pc.Color(0.16, 0.08, 0.36), fov: 26, nearClip: 0.05, farClip: 10, enabled: false });
      app.root.addChild(cam); studio.cam = cam;
      const key2 = new pc.Entity(); key2.addComponent('light', { type: 'omni', range: 6, intensity: 1.6, color: new pc.Color(1, 0.95, 0.9) }); app.root.addChild(key2); key2.setPosition(0.5, -198.9, 1.2); studio.light = key2;
    }
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
  else if (a === 'color') { EDIT.color = +v; drawEdit(); }
  else if (a === 'font') { EDIT.font = +v; drawEdit(); }
  else if (a === 'mascot') { EDIT.mascot = +v; const sc = T.querySelector('.masc').scrollTop; drawEdit(); T.querySelector('.masc').scrollTop = sc; }
  else if (a === 'saveteam') { TEAM.name = (T.querySelector('#tname').value || 'MY TEAM').toUpperCase().slice(0, 20); TEAM.color = EDIT.color; TEAM.mascot = EDIT.mascot; TEAM.font = EDIT.font; saveTeam(); toastL('Team saved', false); openTeam('team'); }
  else if (a === 'pick') { DSEL = +v; drawDraft(); }
  else if (a === 'draftit') {
    if (TEAM.roster.length >= ROSTER_MAX) return toastL('Roster full (' + ROSTER_MAX + ' players)', true);
    const p = TEAM.draft[DSEL]; TEAM.roster.push(p); TEAM.draft = null; saveTeam(); toastL(p.name.toUpperCase() + ' drafted!', true); sfxL('cheer', 0.6); openTeam('team');
  }
  else if (a === 'upgrade') {
    const r = TEAM.roster[TSEL], c = upCost(r); if (TEAM.xp < c) return toastL('Not enough XP — earn XP by playing games', false);
    TEAM.xp -= c; r.lv++; for (const k of STATS) r.stats[k] = Math.min(99, r.stats[k] + NEXT[k]); saveTeam(); applyRoster(); sfxL('net', 0.6); toastL(r.name.toUpperCase() + ' is now level ' + r.lv, true); drawDetails();
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
    <button class="bgold tedit" data-act="go" data-val="edit"><i class="ic i-pencil"></i><span class="lbl">EDIT TEAM</span></button></div>
  <div class="sec"><i class="sec-start"></i><button class="bdark" data-act="editlineup"><span class="lbl">${T.classList.contains('swap') ? 'DONE' : 'EDIT LINEUP'}</span></button></div>
  <div class="cards">${R.slice(0, 3).map((r, i) => `<button class="card${LINEUP === i ? ' gold' : ''}" data-act="${swap ? 'lineup' : 'player'}" data-val="${i}">${pic(r)}<span class="lv">${num(r.lv)}</span><span class="nm">${esc(r.name)}</span><span class="st">${num(ovr(r), 'g')}</span></button>`).join('')}</div>
  <div class="sec"><i class="sec-bench"></i></div>
  ${R.slice(3).map((r, i) => `<button class="brow${LINEUP === i + 3 ? ' sel' : ''}" data-act="${swap ? 'lineup' : 'player'}" data-val="${i + 3}">${pic(r)}<span class="nm">${esc(r.name)}</span><span class="lv">${num(r.lv)}</span><span class="st">${num(ovr(r), 'g')}</span></button>`).join('') || '<p class="empty">No bench players — draft one below.</p>'}
  <div class="xprow">${pic(R[0])}<span class="nm">${esc(R[0].name)}</span><span class="xp">${TEAM.xp} XP</span><i class="bar"><b style="width:${Math.min(100, TEAM.xp / upCost(R[0]) * 50)}%"></b></i>
    <button class="bgold vup" data-act="player" data-val="0"><span class="lbl">VIEW &amp; UPGRADE ›</span></button></div>
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
  <div class="spanel">${pic(p)}<div class="pn">${esc(p.name)}</div><div class="pl">LEVEL ${p.lv}</div><div class="povr">${num(ovr(p))}</div>
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
  <div class="xpb">${num(TEAM.xp)}</div>
  <div class="upan"><div class="lvl">LEVEL ${r.lv} → LEVEL ${r.lv + 1}</div>${STATS.map((k, i) => `<div class="urow r${i}"><i class="ubar"><b style="width:${r.stats[k]}%"></b></i><span class="a">${r.stats[k]}</span><span class="b">${Math.min(99, r.stats[k] + NEXT[k])}</span></div>`).join('')}</div>
  <div class="cost"><div><small>UPGRADE COST</small>${num(c, 'g')}<b class="xpw">XP</b></div><div><small>XP AFTER UPGRADE</small>${TEAM.xp >= c ? num(TEAM.xp - c) : '<b class="no">NEED ' + (c - TEAM.xp) + '</b>'}</div></div>
  <button class="bigbtn${TEAM.xp < c ? ' off' : ''}" data-act="upgrade"><span>UPGRADE • ${c} XP</span></button>
  <button class="tealbtn" data-act="go" data-val="team"><span class="lbl">BACK TO ROSTER</span></button>
  <p class="sub">Earn XP by playing games.</p>`;
}
$('hteam').onclick = () => openTeam('team'); $('hplayers').onclick = () => openTeam('team'); $('hstats').onclick = () => openTeam('details', 0);
applyRoster();
