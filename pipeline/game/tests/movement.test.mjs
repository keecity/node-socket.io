// Movement only (combat off): the monsters roam the arena around each other. Checked every step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, Fighter, prepareMonster, STEP } from '../src/sim.js';

const here = new URL('..', import.meta.url);
const roster = JSON.parse(readFileSync(new URL('roster.json', here)));
const packs = {};
for (const r of roster.fighters) packs[r.monster] ??= prepareMonster(JSON.parse(readFileSync(new URL(`monsters/${r.monster}/monster.json`, here))));

const m = { steps: 0, runInPlace: 0, clipSwitches: 0, rapid: 0, touching: 0, wrongWay: 0, minutes: 0 };
for (let s = 0; s < 12; s++) {
  const w = new World({ arena: roster.arena.radius, seed: 2000 + s * 7919, combat: false });
  const fs = roster.fighters.map((r, i) => new Fighter(w, packs[r.monster], { id: i, name: r.name, stats: r.stats }));
  w.setup(fs[0], fs[1]);
  const prev = fs.map(() => ({}));
  while (w.time < 60) {
    const before = fs.map((f) => ({ x: f.x, z: f.z, yaw: f.yaw, clip: f.loco.clip }));
    w.step(STEP);
    if (w.frozen) continue;
    fs.forEach((f, i) => {
      m.steps++;
      const b = before[i], p = prev[i];
      const moved = Math.hypot(f.x - b.x, f.z - b.z) / STEP;
      if (f.speed > 0 && moved < 0.5 * f.speed) m.runInPlace++;
      if (f.speed > 0) {
        const dir = Math.atan2(f.x - b.x, f.z - b.z) - f.yaw;
        if (Math.abs(Math.atan2(Math.sin(dir), Math.cos(dir))) > Math.PI / 4) m.wrongWay++;
      }
      if (f.loco.clip !== b.clip) m.clipSwitches++;
      const dy = Math.atan2(Math.sin(f.yaw - b.yaw), Math.cos(f.yaw - b.yaw));
      if (Math.abs(dy) > 1e-4) {
        if (p.dy && Math.sign(dy) !== Math.sign(p.dy)) { if (p.flip != null && w.time - p.flip < 0.2) m.rapid++; p.flip = w.time; }
        p.dy = dy;
      }
      if (f.gapTo(fs[1 - i]) < 0) m.touching++;
    });
  }
}
const perMin = (n) => n / (m.steps * STEP / 60);

test('no running in place', () => assert.ok(m.runInPlace / m.steps < 0.001, `${(100 * m.runInPlace / m.steps).toFixed(2)}%`));
test('the body goes where it faces (only a rare bump pushes it)', () => assert.ok(m.wrongWay / m.steps < 0.0005, `${m.wrongWay} steps`));
test('no run/idle flicker', () => assert.ok(perMin(m.clipSwitches) < 3, `${perMin(m.clipSwitches).toFixed(1)}/min`));
test('no heading wobble', () => assert.ok(perMin(m.rapid) < 8, `${perMin(m.rapid).toFixed(1)}/min`));
test('bodies keep apart', () => assert.ok(m.touching / m.steps < 0.01, `${(100 * m.touching / m.steps).toFixed(2)}%`));
