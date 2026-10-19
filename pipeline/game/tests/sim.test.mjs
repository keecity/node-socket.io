// Headless fight tests: whole matches on the real monster packs, checked every simulation step.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, Fighter, prepareMonster, STEP } from '../src/sim.js';

const here = new URL('..', import.meta.url);
const roster = JSON.parse(readFileSync(new URL('roster.json', here)));
const packs = {};
for (const r of roster.fighters) packs[r.monster] ??= prepareMonster(JSON.parse(readFileSync(new URL(`monsters/${r.monster}/monster.json`, here))));

// Fastest any body may legitimately move, from the pack: its fastest own motion (a gait at full
// rate, a clip's root motion at its rate, or a dash's warp) plus knockback. Being shoved by the
// other body (a turning sweep, a lunge) is not allowed: contact stops the mover instead.
function speedLimit(mon) {
  const gait = Math.max(...mon.loops.map((c) => c.speed)) * 2.0;
  const clip = Math.max(...Object.values(mon.clips).map((c) => (c.max_speed || 0) * mon.scale * (c.rate || 1)));
  const dash = Math.max(0, ...Object.values(mon.moves).filter((m) => m.type === 'dash_strike').map((m) => {
    const c = m.clipData, air = c.event - (c.airborne?.length ? c.airborne[0][0] : 0);
    return (m.range?.[1] || 4) * mon.BL / (air / (c.rate || 1));
  }));
  const knock = Math.max(0, ...Object.values(mon.moves).map((m) => (m.knockback || 0) * mon.BL)) * 2;
  const lunge = gait + clip;                     // melee homing on top of the clip's own travel
  return Math.max(gait, clip, dash, lunge) + knock + 1.0;       // + a little contact settling; never a shove
}

function runMatch(seed, maxSeconds = 240) {
  const world = new World({ arena: roster.arena.radius, seed });
  const fs = roster.fighters.map((r, i) => new Fighter(world, packs[r.monster], { id: i, name: r.name, side: i ? 1 : -1, stats: r.stats, look: r.look }));
  world.setup(fs[0], fs[1]);
  const t = { maxSpeed: [0, 0], maxStep: 0, maxOverlap: 0, overlapSteps: 0, steps: 0, minRate: Infinity, outside: 0,
    wrongWay: 0, turnTooFast: 0, stalled: 0, belowWalk: 0, prevYaw: null, moving: [0, 0], clips: new Set(), events: {}, moves: {}, hits: {} };
  let prev = fs.map((f) => [f.x, f.z]);
  while (world.phase !== 'over' && world.time < maxSeconds) {
    world.step(STEP);
    t.steps++;
    fs.forEach((f, i) => {
      const d = Math.hypot(f.x - prev[i][0], f.z - prev[i][1]);
      t.maxStep = Math.max(t.maxStep, d);
      t.maxSpeed[i] = Math.max(t.maxSpeed[i], d / STEP);
      if (d / STEP > 0.2) t.moving[i]++;
      const p = f.pose();
      t.clips.add(p.clip);
      const rate = f.act ? f.act.rate : f.loco.rate * (f.mon.clips[f.loco.clip].rate || 1);
      t.minRate = Math.min(t.minRate, rate);
      if (Math.hypot(f.x, f.z) > world.arena + 1e-6) t.outside++;
      // locomotion: limited turning while moving, never slower than the walk, never stuck
      if (!f.act && f.loco && t.prevYaw) {
        const dy = Math.abs(Math.atan2(Math.sin(f.yaw - t.prevYaw[i]), Math.cos(f.yaw - t.prevYaw[i])));
        if (dy > 3.2 * STEP + 1e-9) t.turnTooFast++;
        if (f.speed > 0 && f.speed < Math.min(...f.gaits().map((c) => c.speed)) - 1e-9) t.belowWalk++;
        if (f.nav && !f.nav.arrived && f.speed === 0 && world.phase === 'fight') t.stalled++;
      }
      // a gait must carry the body the way its legs go (no backwards run, no sideways walk)
      if (!f.act && f.lastV && Math.hypot(...f.lastV) > 1e-6) {
        const c = f.mon.clips[f.loco.clip];
        const travel = Math.atan2(f.lastV[0], f.lastV[1]) - f.yaw - (c.heading_deg || 0) * Math.PI / 180;
        if (c.kind !== 'loop' || Math.abs(Math.atan2(Math.sin(travel), Math.cos(travel))) > Math.PI / 4) t.wrongWay++;
      }
    });
    prev = fs.map((f) => [f.x, f.z]);
    t.prevYaw = fs.map((f) => f.yaw);
    const ov = -fs[0].gapTo(fs[1]);
    if (ov > 0) { t.maxOverlap = Math.max(t.maxOverlap, ov); if (ov > 0.15 * fs[0].mon.capsule.r) t.overlapSteps++; }
    for (const e of world.events) {
      t.events[e.type] = (t.events[e.type] || 0) + 1;
      if (e.type === 'move') t.moves[e.key] = (t.moves[e.key] || 0) + 1;
      if (e.type === 'hit') t.hits[e.key] = (t.hits[e.key] || 0) + 1;
    }
    world.events.length = 0;
  }
  return { world, fs, t };
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);
const results = SEEDS.map((s) => runMatch(s));

test('every match ends in a knock-out and a victory', () => {
  for (const { world, t } of results) {
    assert.equal(world.phase, 'over', `match did not finish (t=${world.time.toFixed(1)})`);
    assert.ok(t.events.ko >= 1 && t.events.victory === 1);
  }
});

test('nobody teleports: no body moves faster than its clips, warps and knockback allow', () => {
  for (const { fs, t } of results) {
    fs.forEach((f, i) => assert.ok(t.maxSpeed[i] <= speedLimit(f.mon), `${f.name} reached ${t.maxSpeed[i].toFixed(2)} u/s, limit ${speedLimit(f.mon).toFixed(2)}`));
    assert.ok(t.maxStep < 0.25, `a single step moved a body ${t.maxStep.toFixed(3)} units`);
  }
});

test('no clip ever plays slower than it was generated', () => {
  for (const { t } of results) assert.ok(t.minRate >= 1, `rate ${t.minRate}`);
});

test('bodies do not sink into each other', () => {
  for (const { fs, t } of results) {
    const r = fs[0].mon.capsule.r;
    assert.ok(t.maxOverlap < 0.25 * r, `overlap ${t.maxOverlap.toFixed(3)} (radius ${r.toFixed(3)})`);
    assert.ok(t.overlapSteps / t.steps < 0.02, `overlapping ${(100 * t.overlapSteps / t.steps).toFixed(1)}% of the time`);
  }
});

test('bodies only travel the way the playing gait goes', () => {
  for (const { t } of results) assert.equal(t.wrongWay, 0, `${t.wrongWay} steps moved against the gait`);
});

test('movement: turns are arcs at a limited rate, speed never below the walk, never stalled', () => {
  for (const { t } of results) {
    assert.equal(t.turnTooFast, 0, `${t.turnTooFast} steps turned faster than allowed`);
    assert.equal(t.belowWalk, 0, `${t.belowWalk} steps moved slower than the walk clip`);
    assert.ok(t.stalled / t.steps < 0.01, `stalled ${(100 * t.stalled / t.steps).toFixed(1)}% of the fight`);
  }
});

test('fighters stay in the arena', () => {
  for (const { t } of results) assert.equal(t.outside, 0);
});

test('fighters move about: each is on the move a good part of the fight', () => {
  for (const { t } of results) t.moving.forEach((n) => assert.ok(n / t.steps > 0.3, `moving only ${(100 * n / t.steps).toFixed(0)}% of the time`));
});

test('every move gets used and every attack connects across the matches', () => {
  const used = {}, hits = {}, ev = {};
  for (const { t } of results) {
    for (const [k, n] of Object.entries(t.moves)) used[k] = (used[k] || 0) + n;
    for (const [k, n] of Object.entries(t.hits)) hits[k] = (hits[k] || 0) + n;
    for (const [k, n] of Object.entries(t.events)) ev[k] = (ev[k] || 0) + n;
  }
  const mon = Object.values(packs)[0];
  for (const [key, mv] of Object.entries(mon.moves)) {
    assert.ok(used[key] > 0, `${key} never used`);
    if (mv.damage) assert.ok(hits[key] > 0, `${key} never hit`);
  }
  assert.ok(ev.dodged > 0, 'Spark Step never dodged an attack');
  assert.ok(ev.jumped > 0, 'nobody ever jumped a shockwave');
  console.log('moves used', used, '\nhits', hits, '\nevents', ev);
});

test('same seed, same fight', () => {
  const a = runMatch(42), b = runMatch(42);
  assert.equal(a.world.time, b.world.time);
  assert.deepEqual(a.fs.map((f) => [f.x, f.z, f.hp]), b.fs.map((f) => [f.x, f.z, f.hp]));
});

test('match length is reasonable', () => {
  const secs = results.map((r) => r.world.time).sort((x, y) => x - y);
  console.log('match seconds (median, min, max):', secs[secs.length >> 1].toFixed(0), secs[0].toFixed(0), secs.at(-1).toFixed(0));
  assert.ok(secs[secs.length >> 1] > 15 && secs[secs.length >> 1] < 150);
});
