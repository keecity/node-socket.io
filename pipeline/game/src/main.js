// Boot, loop and HUD. The simulation runs at a fixed 60 Hz on real time (a slow frame runs
// several steps; nothing plays in slow motion); the view renders whatever the latest step says.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World, Fighter, prepareMonster, STEP } from './sim.js';
import { makeStage, makeArena, FighterView } from './render.js';
import { Fx } from './fx.js';

// Binary assets ship base64-encoded as text (pack_assets.py) so any static host can serve them.
async function loadBinary(path) {
  const res = await fetch(path + '.b64.txt');
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const bin = atob((await res.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function loadMonster(dir) {
  const manifest = await (await fetch(`${dir}/monster.json`)).json();
  const mon = prepareMonster(manifest);
  const gl = new GLTFLoader();
  const clips = {};
  const names = new Set(Object.values(mon.clips).map((c) => c.name));
  await Promise.all([...names].map(async (n) => {
    clips[n] = (await gl.parseAsync(await loadBinary(`${dir}/clips/${n}.glb`), '')).animations[0];
  }));
  const rig = await loadBinary(`${dir}/${manifest.rig}`);
  const fbx = new FBXLoader();
  return { mon, clips, makeModel: () => fbx.parse(rig, '') };
}

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const logEl = $('log');
function log(html) {
  const p = document.createElement('p'); p.innerHTML = html; logEl.appendChild(p);
  while (logEl.children.length > 3) logEl.firstChild.remove();
}
let calloutT = 0;
function callout(title, sub) { $('callout').innerHTML = `${title}<small>${sub}</small>`; $('callout').classList.add('show'); calloutT = 0.9; }
function drawPlate(f, el) {
  const k = Math.max(0, f.hp) / f.maxHp, bar = el.querySelector('.hpbar i');
  bar.style.width = (k * 100) + '%';
  bar.style.backgroundColor = k > 0.5 ? 'var(--hp-high)' : k > 0.2 ? 'var(--hp-mid)' : 'var(--hp-low)';
  el.querySelector('.hpnum').textContent = `${Math.max(0, Math.ceil(f.hp))} / ${f.maxHp} HP`;
  el.querySelector('.enbar i').style.width = Math.max(0, f.energy) + '%';
  const big = Object.values(f.mon.moves).find((m) => m.energy);
  el.querySelector('.chips').innerHTML = (f.paralyzed > 0 ? '<span class="chip par">PAR</span>' : '') +
    (big && f.energy >= big.energy ? `<span class="chip chg">${big.name.toUpperCase()} READY</span>` : '');
}
const tag = (f) => `<b>${f.name}</b>`;

// ---------- boot ----------
const { renderer, scene, camera } = makeStage($('stage'));
const fx = new Fx(scene, camera, $('flash'));
let world, views = [], arena, roster, packs = {};
let speed = 1, paused = false, acc = 0, viewTime = 0;
const camTarget = new THREE.Vector3(0, 0.7, 0);
let camDist = 8;

function resize() {
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 0.8 ? 60 : 42; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function newMatch() {
  for (const v of views) scene.remove(v.root);
  fx.clear();
  world = new World({ arena: roster.arena.radius, seed: (Math.random() * 2 ** 31) | 0 });
  const fs = roster.fighters.map((r, i) => new Fighter(world, packs[r.monster].mon, { id: i, name: r.name, side: i ? 1 : -1, stats: r.stats, look: r.look }));
  world.setup(fs[0], fs[1]);
  views = fs.map((f) => new FighterView(scene, f, packs[roster.fighters[f.id].monster].makeModel(), packs[roster.fighters[f.id].monster].clips));
  for (const [i, f] of fs.entries()) {
    const el = $(i ? 'plateB' : 'plateA');
    el.querySelector('.name').textContent = f.name;
    drawPlate(f, el);
  }
  logEl.innerHTML = `<p>${tag(fs[0])} and ${tag(fs[1])} square off in the storm arena.</p>`;
}

// simulation events -> effects, HUD and log
function present(e) {
  const v = e.who ? views[e.who.id] : null;
  switch (e.type) {
    case 'fight': callout('Fight', `${world.fighters[0].name} vs ${world.fighters[1].name}`); break;
    case 'move': if (e.special) callout(e.name, e.who.name); break;
    case 'strike':
      if (e.fx === 'horn_bolt') { const tip = v.bone('head_tip'); fx.bolt(() => v.bone('head_tip'), () => tip.clone().add(new THREE.Vector3(Math.sin(e.who.yaw), 0, Math.cos(e.who.yaw)).multiplyScalar(e.who.mon.BL * 0.5)), { life: 0.25, jitter: 0.1 }); }
      if (e.fx === 'jaw_sparks') fx.sparks(v.bone('jaw_tip'), { count: 30, color: '#66d6ff', speed: 2 });
      break;
    case 'wave': fx.shockwave(e.x, e.z, { radius: 2.2 }); fx.kick(0.1); break;
    case 'slam': { const p = new THREE.Vector3(e.x, 0.05, e.z); fx.skyStrike(p, 0.45); fx.shockwave(e.x, e.z, { radius: 3.2, color: '#ffe14a' }); fx.sparks(p, { count: 120, speed: 4.5, up: 2.5 }); fx.kick(0.26); break; }
    case 'hit': {
      const p = e.at3 ? new THREE.Vector3(...e.at3) : v.body();
      v.hitFlash();
      fx.sparks(p, { count: e.crit ? 110 : 60 }); fx.light(p, '#ffe14a', e.crit ? 22 : 12);
      fx.screenFlash(e.crit ? 0.55 : 0.22); fx.kick(e.crit ? 0.2 : 0.1);
      fx.popText(v.body().add(new THREE.Vector3(0, 0.5, 0)), `${e.amount}${e.crit ? '!' : ''}`, e.crit ? 'crit' : '');
      if (e.crit || e.key === 'spin' || e.key === 'leap') log(`${tag(e.by)} lands ${e.name}${e.crit ? ' — critical' : ''} for ${e.amount}.`);
      break;
    }
    case 'miss': fx.popText(v.body().add(new THREE.Vector3(0, 0.5, 0)), 'MISS', 'miss'); break;
    case 'dodged': fx.popText(v.body().add(new THREE.Vector3(0, 0.5, 0)), 'DODGED', 'miss'); fx.sparks(v.body(), { count: 30, color: '#66d6ff', speed: 2.2 }); break;
    case 'jumped': fx.popText(v.body().add(new THREE.Vector3(0, 0.5, 0)), 'JUMPED', 'miss'); break;
    case 'paralyzed': log(`${tag(e.who)} is paralyzed.`); break;
    case 'buff_pulse': fx.skyStrike(v.body(), 0.35); fx.kick(0.06); break;
    case 'buffed': log(`${tag(e.who)} uses ${e.name}${e.heal ? ` and recovers ${e.heal} HP` : ''}.`); break;
    case 'ko': log(`${tag(e.who)} faints.`); break;
    case 'victory': callout(`${e.who.name} wins`, `${Math.round(world.time)} seconds`); fx.skyStrike(views[e.who.id].body(), 0.5); log(`${tag(e.who)} wins the battle.`); break;
  }
}

function frame(manualDt) {
  const raw = manualDt ?? Math.min(clock.getDelta(), 0.25);
  if (world) {
    acc += paused ? 0 : raw * speed;
    while (acc >= STEP) {
      world.step(STEP); acc -= STEP;
      for (const e of world.events) present(e);
      world.events.length = 0;
      if (world.phase === 'over') newMatch();
    }
    const dt = paused ? 0 : raw * speed;
    for (const v of views) v.update(dt);
    // electric crackle on a paralysed body, travelling ground waves
    for (const v of views) if (v.f.paralyzed > 0 && Math.random() < dt * 2.5)
      fx.bolt(() => v.body().add(new THREE.Vector3(0, 0.3, 0)), () => v.body().add(new THREE.Vector3(rand(-0.5, 0.5), -0.4, rand(-0.5, 0.5))), { life: 0.25, segments: 5, branches: 0, width: 0.015 });
    for (const w of world.waves) if (Math.random() < 0.8) fx.sparks(new THREE.Vector3(w.x, 0.05, w.z), { count: 5, speed: 1.6, life: 0.35 });
    fx.step(dt);
    if (calloutT > 0 && (calloutT -= dt) <= 0) $('callout').classList.remove('show');
    if (Math.random() < 0.25) views.forEach((v, i) => drawPlate(v.f, $(i ? 'plateB' : 'plateA')));
    $('turn').textContent = `${Math.floor(world.time / 60)}:${String(Math.floor(world.time % 60)).padStart(2, '0')}`;
    // camera frames both fighters
    const [a, b] = world.fighters;
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0.7, (a.z + b.z) / 2), span = Math.hypot(a.x - b.x, a.z - b.z);
    camTarget.lerp(mid, Math.min(1, raw * 3));
    const narrow = camera.aspect < 0.8;
    camDist += ((narrow ? 7.5 : 5.6) + span * (narrow ? 1.4 : 0.8) - camDist) * Math.min(1, raw * 2);
    viewTime += raw;
    camera.position.set(camTarget.x + Math.sin(viewTime * 0.05) * camDist * 0.25, 2.2 + camDist * 0.12, camTarget.z + camDist);
    if (fx.shake > 0) { camera.position.x += rand(-fx.shake, fx.shake); camera.position.y += rand(-fx.shake, fx.shake); fx.shake = Math.max(0, fx.shake - raw * 0.8); }
    camera.lookAt(camTarget);
    arena.update(viewTime, camera, camTarget);
  }
  renderer.render(scene, camera);
  if (!window.arenaManual) requestAnimationFrame(() => frame());
}
const rand = (a, b) => a + Math.random() * (b - a);
const clock = new THREE.Clock();
// test hook: with window.arenaManual set, frames advance only through arenaTick(dt)
window.arenaTick = (dt) => frame(dt);
window.arenaState = () => world && { phase: world.phase, time: world.time, fighters: world.fighters.map((f, i) => {
  const hip = views[i]?.bone('hip');
  return { name: f.name, x: f.x, z: f.z, yaw: f.yaw, hp: f.hp, pose: f.pose(), act: f.act?.key || null, hip: hip && [hip.x, hip.y, hip.z] };
}) };

$('btnPause').onclick = () => { paused = !paused; $('btnPause').textContent = paused ? 'Resume' : 'Pause'; $('btnPause').setAttribute('aria-pressed', String(paused)); };
$('btnSpeed').onclick = () => { speed = speed === 1 ? 2 : 1; $('btnSpeed').textContent = `Speed ${speed}×`; $('btnSpeed').setAttribute('aria-pressed', String(speed === 2)); };
$('btnNew').onclick = () => newMatch();

(async function boot() {
  resize(); frame();
  try {
    roster = await (await fetch('roster.json')).json();
    arena = makeArena(scene, roster.arena.radius);
    for (const r of roster.fighters) if (!packs[r.monster]) packs[r.monster] = await loadMonster(`monsters/${r.monster}`);
    $('loading').hidden = true;
    newMatch();
  } catch (e) {
    $('loadmsg').textContent = 'The arena could not load its files. Reload the page to try again.';
    console.error(e);
  }
})();
