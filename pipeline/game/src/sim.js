// Fight simulation. Pure data and maths: no three.js, no DOM, so it runs the same in the browser
// and in the headless tests. Everything about a monster comes from its pack manifest
// (creature_pipeline pack): body capsule, clip timing, root motion, airborne windows, strike
// paths, gait speeds. Moves are data too. The renderer only shows what this decides.
//
// Units: world units = manifest metres x scale, where scale makes the monster's body
// (nose to rump) `display.length` long. Move distances in the manifest are in body lengths.
// Time: seconds. Fixed step (STEP) for determinism.

export const STEP = 1 / 60;
const TURN_RATE = 7;            // rad/s a fighter can turn while acting on its own
const MAX_RATE = 1.8;           // locomotion clips play between 1x and this
const REACTION = 0.18;          // s: fastest a fighter can respond to something it sees
const LUNGE_SPEED = 1.5;        // body lengths/s: melee homing during a wind-up
const LUNGE_MAX = 0.4;          // body lengths: most a melee wind-up may home in
const TURN_WALK = 2.6;          // rad/s turning while walking (tight arcs)
const TURN_RUN = 1.6;           // rad/s turning while running (wide arcs)
const ACCEL = 2.5;              // body lengths/s^2 between walk and run speeds

// ---------- maths ----------
export const rot = (x, z, yaw) => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const len = (x, z) => Math.hypot(x, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function closestOnSegment(px, pz, qx, qz, x, z) {
  const dx = qx - px, dz = qz - pz, l = dx * dx + dz * dz;
  const t = l > 1e-12 ? clamp(((x - px) * dx + (z - pz) * dz) / l, 0, 1) : 0;
  return [px + dx * t, pz + dz * t];
}
function segmentsDistance(a0, a1, b0, b1) {
  // closest distance between two 2D segments (no intersection case needed: capsules are short)
  let best = Infinity;
  for (const [p, s0, s1] of [[a0, b0, b1], [a1, b0, b1], [b0, a0, a1], [b1, a0, a1]]) {
    const c = closestOnSegment(s0[0], s0[1], s1[0], s1[1], p[0], p[1]);
    best = Math.min(best, len(p[0] - c[0], p[1] - c[1]));
  }
  return best;
}
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- monster data ----------
// Turn a manifest into world units and quick lookups. Shared by every fighter of that monster.
export function prepareMonster(manifest) {
  const body = manifest.body;
  const scale = (manifest.display?.length || 2) / body.length;
  const BL = body.length * scale;                                   // one body length, world units
  const clips = {};
  for (const [name, c] of Object.entries(manifest.clips)) {
    clips[name] = {
      ...c, key: name, name,               // key: role in this monster; name: the clip asset
      rm: c.root_motion.map(([x, z]) => [x * scale, z * scale]),
      path: c.strike_path ? c.strike_path.map(([x, y, z]) => [x * scale, y * scale, z * scale]) : null,
      speed: c.speed != null ? c.speed * scale * (c.rate || 1) : null,   // ground speed at the clip's own rate
    };
  }
  for (const [missing, use] of Object.entries(manifest.fallbacks || {})) {
    if (!clips[missing] && clips[use]) clips[missing] = { ...clips[use], key: missing, fallback: true };
  }
  const loops = Object.values(clips).filter((c) => c.kind === 'loop' && c.speed > 0 && !c.fallback);
  const moves = {};
  for (const [key, mv] of Object.entries(manifest.moves || {})) {
    const clip = clips[mv.clip];
    if (!clip) throw new Error(`${manifest.name}: move ${key} uses missing clip ${mv.clip}`);
    moves[key] = { key, ...mv, clipData: clip };
  }
  return {
    name: manifest.name, manifest, scale, BL, clips, moves, loops,
    capsule: { r: body.radius * scale, front: body.front * scale, back: body.back * scale },
    stats: manifest.stats || {},
  };
}

// sample a per-frame curve at time t (seconds into the clip)
function sample(curve, fps, t) {
  const f = clamp(t * fps, 0, curve.length - 1), i = Math.floor(f), k = f - i;
  const a = curve[i], b = curve[Math.min(i + 1, curve.length - 1)];
  return a.map((v, j) => v + (b[j] - v) * k);
}
const inWindows = (wins, t) => (wins || []).some(([a, b]) => t >= a && t <= b);

// ---------- fighter ----------
export class Fighter {
  constructor(world, monster, opts) {
    this.world = world; this.mon = monster;
    this.id = opts.id; this.name = opts.name; this.side = opts.side;
    const st = { ...monster.stats, ...(opts.stats || {}) };
    this.maxHp = st.hp || 100; this.atk = st.attack || 1; this.def = st.defense || 1;
    this.skill = st.skill ?? 0.5; this.aggression = st.aggression ?? 0.5;
    this.look = opts.look || {};
  }
  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0;                 // knockback, decays
    this.hp = this.maxHp; this.energy = 20; this.paralyzed = 0;
    this.state = 'move'; this.act = null; this.ko = false;
    this.loco = { clip: 'idle', phase: 0, rate: 1 };
    this.cd = {}; for (const k of Object.keys(this.mon.moves)) this.cd[k] = 0.5 + this.world.random();
    this.ai = { plan: 'press', planT: 0, think: 0, strafe: 1, goal: null, seen: new Set(), react: null };
    this.nav = null; this.speed = 0; this.lastV = [0, 0];
  }
  // what the renderer needs: which clip, at what time, blended how
  pose() {
    if (this.act) return { clip: this.act.clip.name, time: this.act.t, loop: false };
    const c = this.mon.clips[this.loco.clip];
    return { clip: c.name, time: this.loco.phase * c.duration, loop: true, rate: this.loco.rate };
  }
  facing() { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }
  capsule() {
    const [fx, fz] = this.facing(), c = this.mon.capsule;
    return [[this.x + fx * c.back, this.z + fz * c.back], [this.x + fx * c.front, this.z + fz * c.front]];
  }
  // surface distance from a point to this body
  distanceFrom(x, z) {
    const [a, b] = this.capsule(), c = closestOnSegment(a[0], a[1], b[0], b[1], x, z);
    return len(x - c[0], z - c[1]) - this.mon.capsule.r;
  }
  gapTo(o) { return segmentsDistance(...this.capsule(), ...o.capsule()) - this.mon.capsule.r - o.mon.capsule.r; }
  airborne() { return !!this.act && inWindows(this.act.clip.airborne, this.act.t); }
  invulnerable() { return !!this.act && !!this.act.iframes && inWindows(this.act.iframes, this.act.t); }
  busy() { return !!this.act; }

  // ----- actions -----
  start(key, target) {
    const mv = this.mon.moves[key];
    const clip = mv.clipData;
    this.act = { key, mv, clip, t: 0, rate: clip.rate || 1, yaw0: this.yaw, rm0: [0, 0], fired: false,
      target, warp: null, iframes: null, ends: mv.duration || clip.duration };
    if (mv.type === 'evade') {
      // invulnerable while off the floor, with a little grace either side
      this.act.iframes = (clip.airborne || []).map(([a, b]) => [Math.max(0, a - 0.12), b + 0.05]);
      if (!this.act.iframes.length) this.act.iframes = [[0.1, clip.duration * 0.8]];
    }
    if (mv.type === 'dash_strike' && target) {
      // motion warping: spread the distance still to cover over the airborne phase, so the
      // strike lands at the target however far it was (within the move's range)
      const a0 = clip.airborne?.length ? clip.airborne[0][0] : 0;     // from take-off to the strike
      const own = sample(clip.rm, clip.root_motion_fps, clip.event)[1];
      const want = Math.max(0, len(target.x - this.x, target.z - this.z) - target.mon.capsule.r - this.mon.capsule.front * 0.6);
      this.act.warp = { a: a0, b: clip.event, extra: clamp(want - own, 0, (mv.range?.[1] || 4) * this.mon.BL) };
    }
    this.cd[key] = mv.cooldown || 1;
    if (mv.energy) this.energy -= mv.energy;
    this.state = 'act';
    this.world.emit({ type: 'move', who: this, key, name: mv.name, special: !['melee', 'evade'].includes(mv.type) });
  }
  hurt(from, knock) {
    if (this.act?.mv.armor) return;
    const hc = this.mon.clips.hurt;
    const dx = this.x - from.x, dz = this.z - from.z, d = len(dx, dz) || 1;
    this.vx += dx / d * knock * this.mon.BL; this.vz += dz / d * knock * this.mon.BL;
    if (hc) this.act = { key: 'hurt', mv: { type: 'hurt' }, clip: hc, t: 0, rate: hc.rate || 1, yaw0: this.yaw, rm0: [0, 0], ends: hc.duration * 0.8 };
    this.ai.planT = 0; this.ai.reason = 'hit'; this.ai.react = null;
  }
  knockOut() {
    this.ko = true; this.hp = 0;
    const fc = this.mon.clips.faint;
    this.act = fc ? { key: 'faint', mv: { type: 'ko' }, clip: fc, t: 0, rate: fc.rate || 1, yaw0: this.yaw, rm0: [0, 0], ends: Infinity } : null;
    this.world.emit({ type: 'ko', who: this });
  }

  step(dt, foe) {
    for (const k in this.cd) this.cd[k] -= dt;
    if (!this.ko) this.energy = Math.min(100, this.energy + dt * 2.5);
    if (this.paralyzed > 0) this.paralyzed -= dt;
    // knockback slide
    this.x += this.vx * dt; this.z += this.vz * dt;
    const decay = Math.exp(-6 * dt); this.vx *= decay; this.vz *= decay;

    this.lastV = [0, 0];
    if (this.act) this.stepAction(dt, foe);
    else if (!this.ko) {
      if (!this.world.frozen) this.think(dt, foe);
      if (this.act) this.speed = 0;                   // an action took over this step
      else { if (this.world.frozen) this.nav = null; this.locomote(dt); }
    }
  }

  stepAction(dt, foe) {
    const act = this.act, clip = act.clip;
    const t0 = act.t;
    act.t = Math.min(t0 + dt * act.rate, clip.duration);
    // root motion from the clip, in the facing the action started with
    const rm = sample(clip.rm, clip.root_motion_fps, act.t), prev = sample(clip.rm, clip.root_motion_fps, t0);
    let dx = rm[0] - prev[0], dz = rm[1] - prev[1];
    if (act.warp && act.t > act.warp.a && t0 < act.warp.b) {
      const span = act.warp.b - act.warp.a;
      dz += act.warp.extra * (Math.min(act.t, act.warp.b) - Math.max(t0, act.warp.a)) / span;
    }
    const [wx, wz] = rot(dx, dz, act.yaw0);
    this.x += wx; this.z += wz;
    // keep turning toward the target during the wind-up of an attack
    if (act.target && act.mv.type !== 'evade' && clip.event != null && act.t < clip.event * 0.6) {
      this.turnToward(act.target.x, act.target.z, dt, TURN_RATE * 0.6);
      act.yaw0 = this.yaw;
    }
    // melee homing: before the strike lands, close a little distance if it would fall short
    if (act.mv.type === 'melee' && act.target && act.t < clip.event) {
      const short = this.strikeMissAt(act, act.target);
      const budget = LUNGE_MAX * this.mon.BL - (act.homed || 0);
      if (short > 0 && budget > 0) {
        const step = Math.min(short, budget, LUNGE_SPEED * this.mon.BL * dt);
        const [fx, fz] = this.facing();
        this.x += fx * step; this.z += fz * step; act.homed = (act.homed || 0) + step;
      }
    }
    if (clip.event != null && !act.fired && act.t >= clip.event) { act.fired = true; this.world.resolve(this, foe, act); }
    if (act.mv.type === 'buff') this.world.buffTick(this, act, t0);
    if (act.t >= Math.min(act.ends, clip.duration) - 1e-6 && act.mv.type !== 'ko') {
      if (act.mv.type === 'buff') this.world.buffDone(this, act);
      this.act = null; this.state = this.ko ? 'ko' : 'move';
      this.loco = { clip: 'idle', phase: 0, rate: 1 };
    }
  }

  // Turn toward a point. A long body cannot swing through the other one: a turn that would push
  // into it is held back (contact stops the sweep instead of shoving the other creature away).
  turnToward(x, z, dt, rate = TURN_RATE) {
    const want = Math.atan2(x - this.x, z - this.z);
    const d = wrap(want - this.yaw), s = rate * dt;
    const other = this.world.fighters?.find((f) => f !== this);
    const before = this.yaw, gap0 = other ? this.gapTo(other) : Infinity;
    this.yaw = wrap(this.yaw + clamp(d, -s, s));
    if (other) {
      const gap1 = this.gapTo(other);
      if (gap1 < 0 && gap1 < gap0) this.yaw = before;
    }
  }

  // ----- locomotion -----
  // The body moves only the way it faces, at the speed of the forward gait it is playing
  // (between that gait's natural speed and MAX_RATE times it, never slower). It turns while
  // moving, at a limited rate, so changes of direction are arcs; a sharp turn drops to the walk
  // for a tighter arc. There is no sliding, no sidestepping and no turning on the spot.
  gaits() {
    if (!this._gaits) this._gaits = this.mon.loops.filter((c) => Math.abs(c.heading_deg) < 45).sort((a, b) => a.speed - b.speed);
    return this._gaits;
  }
  locomote(dt) {
    const nav = this.nav, gaits = this.gaits();
    let target = 0;                                   // wanted forward speed
    let err = 0;
    if (nav && gaits.length) {
      const wp = nav.path[0];
      err = wrap(Math.atan2(wp[0] - this.x, wp[1] - this.z) - this.yaw);
      const walk = gaits[0], fast = gaits[gaits.length - 1];
      target = nav.pace === 'run' ? fast.speed * MAX_RATE : walk.speed;
      if (Math.abs(err) > Math.PI / 3) target = walk.speed;          // sharp turn: walk it
      if (nav.arrived) target = Math.abs(nav.alignErr || 0) > 0.5 ? walk.speed : 0;   // only step to line up
    }
    // speed changes smoothly between gaits; starting and stopping happen at the walk
    const walkV = gaits.length ? gaits[0].speed : 0;
    if (target === 0) this.speed = this.speed > walkV * 1.05 ? Math.max(walkV, this.speed - ACCEL * this.mon.BL * dt) : 0;
    else if (this.speed < walkV) this.speed = walkV;
    else this.speed += clamp(target - this.speed, -ACCEL * this.mon.BL * dt, ACCEL * this.mon.BL * dt);
    let clip = this.mon.clips.idle, rate = 1;
    if (this.speed > 0) {
      clip = gaits.find((c) => c.speed * MAX_RATE >= this.speed - 1e-9) || gaits[gaits.length - 1];
      rate = clamp(this.speed / clip.speed, 1, MAX_RATE);
      this.speed = clip.speed * rate;
      // turn toward the path while moving; slower turns at higher speed
      const turn = (clip === gaits[0] ? TURN_WALK : TURN_RUN) * dt;
      const steer = nav?.arrived && nav.alignErr != null ? nav.alignErr : err;
      this.turnBy(clamp(steer, -turn, turn));
    }
    const [fx, fz] = this.facing();
    const vx = fx * this.speed, vz = fz * this.speed;
    if (clip.key !== this.loco.clip) this.loco = { clip: clip.key, phase: 0, rate };
    this.loco.rate = rate;
    this.loco.phase = (this.loco.phase + dt * rate * (clip.rate || 1) / clip.duration) % 1;
    this.lastV = [vx, vz];
    this.x += vx * dt; this.z += vz * dt;
  }
  turnBy(a) {
    const before = this.yaw, other = this.world.fighters?.find((f) => f !== this);
    const gap0 = other ? this.gapTo(other) : Infinity;
    this.yaw = wrap(this.yaw + a);
    if (other) { const g = this.gapTo(other); if (g < 0 && g < gap0) this.yaw = before; }   // can't swing through a body
  }

  // ----- brain: utility AI over what the manifest says this monster can do -----
  think(dt, foe) {
    const ai = this.ai, W = this.world, BL = this.mon.BL;
    const gap = this.gapTo(foe);
    const dist = len(foe.x - this.x, foe.z - this.z);
    const [fx, fz] = this.facing();
    const toX = (foe.x - this.x) / (dist || 1), toZ = (foe.z - this.z) / (dist || 1);
    const facingErr = Math.acos(clamp(fx * toX + fz * toZ, -1, 1));
    const slow = this.paralyzed > 0 ? 0.6 : 1;

    // React to danger. Each attack is read (or missed) once, by skill. A read threat is then
    // tracked every step, and the evade starts when the impact is due to land in the middle of
    // its invulnerable / airborne time - so moving about during a long wind-up doesn't spoil it.
    const hazards = W.hazardsFor(this);
    for (const hz of hazards) {
      if (ai.seen.has(hz.id)) continue;
      ai.seen.add(hz.id);
      if (ai.react && ai.react.source === hz.source && ai.react.kind === hz.kind) continue;   // same attack, new phase
      const read = hz.kind === 'wave' ? this.skill : this.skill * 0.6;   // a big wind-up is easier to read
      if (this.pickEvade() && this.paralyzed <= 0 && W.random() <= read) ai.react = { source: hz.source, kind: hz.kind, seenAt: W.time };
    }
    if (ai.react) {
      const hz = hazards.find((h) => h.source === ai.react.source && h.kind === ai.react.kind);
      const ev = this.pickEvade();
      if (!hz || !ev) ai.react = null;
      else {
        const c = this.mon.moves[ev].clipData, rate = c.rate || 1;
        const win = c.airborne?.length ? c.airborne[0] : [0.1, c.duration * 0.8];
        const safeIn = (win[0] + win[1]) / 2 / rate;                  // start -> middle of the safe window
        if (hz.eta <= safeIn && W.time - ai.react.seenAt >= REACTION) { ai.react = null; return this.start(ev, foe); }
      }
    }

    // replan movement
    ai.planT -= dt;
    if (ai.planT <= 0) this.choosePlan(foe);

    // attack choice
    ai.think -= dt;
    if (ai.think <= 0 && !ai.react) {
      ai.think = (0.12 + W.random() * 0.18) / slow;
      const opts = [];
      for (const mv of Object.values(this.mon.moves)) {
        if (this.cd[mv.key] > 0 || (mv.energy && this.energy < mv.energy)) continue;
        const s = this.score(mv, foe, { gap, dist, facingErr });
        if (s > 0) opts.push([mv.key, s]);
      }
      if (opts.length && W.random() < 0.8) {
        let r = W.random() * opts.reduce((s, o) => s + o[1], 0);
        for (const [key, s] of opts) if ((r -= s) <= 0) {
          this.start(key, foe);
          if (this.mon.moves[key].type === 'melee') { ai.reason = 'swung'; ai.planT = Math.min(ai.planT, 0.4); }
          return;
        }
      }
    }
    this.steer(foe, { gap, dist, toX, toZ, slow });
  }

  // Where this move's strike point would land if started now (from the clip's measured strike
  // path at its impact frame, including the clip's own travel), and how far that is from the
  // foe's body. <= hit radius means it connects if the foe stays put.
  strikeMiss(mv, foe) {
    const c = mv.clipData;
    if (!c.path) return Infinity;
    const p = sample(c.path, c.root_motion_fps, c.event);
    const [x, z] = rot(p[0], p[2], this.yaw);
    return foe.distanceFrom(this.x + x, this.z + z) - (mv.hit_radius || 0.15) * this.mon.BL;
  }
  // Same during an action: where the strike point will be at impact from the current frame.
  strikeMissAt(act, foe) {
    const c = act.clip;
    const now = sample(c.rm, c.root_motion_fps, act.t), at = sample(c.path, c.root_motion_fps, c.event);
    const [x, z] = rot(at[0] - now[0], at[2] - now[1], this.yaw);
    return foe.distanceFrom(this.x + x, this.z + z) - (act.mv.hit_radius || 0.15) * this.mon.BL;
  }
  // The body-to-body gap a melee move can close: how far its strike point (plus hit radius)
  // gets past this body's own front surface. Same terms as gapTo(), so they compare directly.
  meleeGap(mv) {
    const c = mv.clipData, cap = this.mon.capsule;
    const strike = c.reach != null ? c.reach * this.mon.scale : cap.front + cap.r;
    return Math.max(0, strike + (mv.hit_radius || 0.15) * this.mon.BL - (cap.front + cap.r));
  }
  score(mv, foe, s) {
    const BL = this.mon.BL;
    if (mv.type === 'melee') {
      // only swing when the strike would land on the foe's body from where we stand
      if (this.strikeMiss(mv, foe) > -0.05 * this.mon.BL) return 0;
      return 3 * (mv.damage || 1) / 10 * (mv.paralyze && foe.paralyzed > 0 ? 0.4 : 1);
    }
    if (mv.type === 'wave') {
      const [lo, hi] = mv.range || [2, 6];
      if (s.dist < lo * BL || s.dist > hi * BL || s.facingErr > 0.5) return 0;
      return this.ai.plan === 'press' ? 0.6 : 1.6;
    }
    if (mv.type === 'dash_strike') {
      const [lo, hi] = mv.range || [1.5, 4];
      if (s.dist < lo * BL || s.dist > hi * BL || s.facingErr > 0.4) return 0;
      return 2.2;
    }
    if (mv.type === 'buff') {
      // power up only with room to do it and a reason: hurt, or the big move nearly charged
      const big = Object.values(this.mon.moves).find((m) => m.energy);
      const nearly = big && this.energy >= big.energy * 0.5 && this.energy < big.energy;
      if (s.dist < 2.8 * BL || foe.act || !(nearly || this.hp < this.maxHp * 0.6)) return 0;
      return 1.0;
    }
    return 0;                                 // evades are reactive
  }
  pickEvade() {
    const evs = Object.values(this.mon.moves).filter((m) => m.type === 'evade' && this.cd[m.key] <= 0);
    return evs.length ? evs[0].key : null;
  }
  choosePlan(foe) {
    // press: get to melee range. flank: run to a spot beside or behind the foe. circle: strafe
    // round it. poke: hold mid range (waves, dash). retreat: back off (after a hit, or when the
    // foe has its big move charged). Plans are short, so fighters keep moving about.
    const ai = this.ai, W = this.world, r = W.random();
    const low = this.hp < this.maxHp * 0.35, foeCharged = Object.values(foe.mon.moves).some((m) => m.energy && foe.energy >= m.energy);
    if (ai.reason === 'hit') ai.plan = r < 0.3 ? 'retreat' : r < 0.55 ? 'flank' : 'press';
    else if (ai.reason === 'swung') ai.plan = r < 0.25 ? 'circle' : r < 0.45 ? 'flank' : 'press';
    else if (foeCharged && r < 0.3) ai.plan = 'retreat';
    else if (low && r < 0.3) ai.plan = 'poke';
    else {
      const a = 0.35 + this.aggression * 0.4;              // mostly engage; reposition in between
      ai.plan = r < a ? 'press' : r < a + 0.2 ? 'flank' : r < a + 0.35 ? 'circle' : 'poke';
    }
    ai.reason = null;
    ai.planT = ai.plan === 'retreat' ? 0.8 + W.random() * 0.8 : 1.2 + W.random() * 1.4;
    ai.strafe = W.random() < 0.5 ? 1 : -1;
    if (ai.plan === 'flank') {
      const ang = Math.atan2(this.x - foe.x, this.z - foe.z) + ai.strafe * (1.2 + W.random() * 1.6);
      const rr = (2.2 + W.random()) * this.mon.BL;
      ai.goal = W.clampToArena(foe.x + Math.sin(ang) * rr, foe.z + Math.cos(ang) * rr, this.mon.capsule.front);
    }
  }
  // Plans pick a destination and a pace; the path goes around the foe's body and stays inside
  // the arena. Pressing heads straight for the foe and stops at striking distance.
  steer(foe, s) {
    const ai = this.ai, BL = this.mon.BL, W = this.world;
    const melee = Object.values(this.mon.moves).filter((m) => m.type === 'melee').map((m) => this.meleeGap(m));
    const strike = melee.length ? Math.min(...melee) * 0.7 : 0.2 * BL;
    const around = Math.atan2(this.x - foe.x, this.z - foe.z);       // our bearing from the foe
    let goal, pace = 'walk', avoid = true, stopAt = 0.3 * BL;
    if (ai.plan === 'press') {
      goal = [foe.x, foe.z]; avoid = false; pace = s.gap > 2 * BL ? 'run' : 'walk';
    } else if (ai.plan === 'circle') {
      const r = clamp(s.dist, 2.2 * BL, 3.5 * BL), a = around + ai.strafe * 0.9;
      goal = [foe.x + Math.sin(a) * r, foe.z + Math.cos(a) * r];
    } else if (ai.plan === 'flank' && ai.goal) {
      goal = ai.goal; pace = len(goal[0] - this.x, goal[1] - this.z) > 1.5 * BL ? 'run' : 'walk';
    } else if (ai.plan === 'poke') {
      const r = 4 * BL, a = around + ai.strafe * 0.4;
      goal = [foe.x + Math.sin(a) * r, foe.z + Math.cos(a) * r];
    } else {                                                           // retreat
      const r = 4 * BL, a = around + ai.strafe * 0.5;
      goal = [foe.x + Math.sin(a) * r, foe.z + Math.cos(a) * r]; pace = 'run';
    }
    goal = W.clampToArena(goal[0], goal[1], this.mon.capsule.front + 0.6 * BL);
    const path = avoid ? W.planPath(this, [this.x, this.z], goal, foe) : [goal];
    const d = len(goal[0] - this.x, goal[1] - this.z);
    let arrived = ai.plan === 'press' ? s.gap <= strike : d <= stopAt;
    // a destination inside our turning circle can't be reached on an arc (we would orbit it):
    // treat it as reached and move on rather than loop around
    const g = this.gaits()[0], rTurn = g ? g.speed / TURN_WALK : 0;
    const bearing = Math.abs(wrap(Math.atan2(goal[0] - this.x, goal[1] - this.z) - this.yaw));
    if (ai.plan !== 'press' && d < 2.2 * rTurn && bearing > Math.PI / 3) arrived = true;
    if (arrived && ai.plan !== 'press') ai.planT = Math.min(ai.planT, 0.3);   // reached: pick the next plan soon
    // at striking distance, line up on the foe (a step or two on an arc), then hold
    const alignErr = ai.plan === 'press' ? wrap(Math.atan2(foe.x - this.x, foe.z - this.z) - this.yaw) : null;
    this.nav = { goal, path, pace: s.slow < 1 ? 'walk' : pace, arrived, alignErr };
  }

}

// ---------- world ----------
export class World {
  constructor({ arena = 6, seed = 1 } = {}) {
    this.arena = arena; this.random = rng(seed);
    this.events = []; this.waves = []; this.time = 0; this.nextId = 1;
    this.phase = 'intro'; this.phaseT = 0; this.winner = null;
  }
  emit(e) { this.events.push({ ...e, at: this.time }); }
  setup(a, b) {
    this.fighters = [a, b];
    const d = Math.max(a.mon.BL, b.mon.BL) * 1.6;
    a.reset(-d, 0, Math.PI / 2); b.reset(d, 0, -Math.PI / 2);
    this.waves = []; this.phase = 'intro'; this.phaseT = 1.2; this.winner = null; this.time = 0;
    this.emit({ type: 'start' });
  }
  get frozen() { return this.phase === 'intro'; }
  clampToArena(x, z, margin) {
    const r = len(x, z), lim = this.arena - margin;
    return r > lim ? [x * lim / r, z * lim / r] : [x, z];
  }

  step(dt = STEP) {
    this.time += dt;
    const [a, b] = this.fighters;
    for (const f of this.fighters) f.prev = [f.x, f.z];
    if (this.phase === 'intro' && (this.phaseT -= dt) <= 0) { this.phase = 'fight'; this.emit({ type: 'fight' }); }
    a.step(dt, b); b.step(dt, a);
    this.stepWaves(dt);
    this.separate();
    for (const f of this.fighters) [f.x, f.z] = this.clampToArena(f.x, f.z, f.mon.capsule.r);
    if (this.phase === 'fight' && (a.ko || b.ko)) {
      this.phase = 'ko'; this.phaseT = 1.0; this.winner = a.ko ? b : a;
    } else if (this.phase === 'ko' && (this.phaseT -= dt) <= 0) {
      this.phase = 'victory'; this.phaseT = 4;
      const w = this.winner;
      if (w.mon.clips.victory) { w.act = null; w.act = { key: 'victory', mv: { type: 'pose' }, clip: w.mon.clips.victory, t: 0, rate: w.mon.clips.victory.rate || 1, yaw0: w.yaw, rm0: [0, 0], ends: w.mon.clips.victory.duration }; }
      this.emit({ type: 'victory', who: w });
    } else if (this.phase === 'victory' && (this.phaseT -= dt) <= 0) {
      this.phase = 'over';
    }
  }

  // bodies are capsules. Contact is resolved fully every step; per-step penetration is bounded by
  // how fast bodies move, so the correction is small and continuous.
  separate() {
    const [a, b] = this.fighters;
    const [a0, a1] = a.capsule(), [b0, b1] = b.capsule();
    let best = null;
    for (const [p, s0, s1, sign] of [[a0, b0, b1, 1], [a1, b0, b1, 1], [b0, a0, a1, -1], [b1, a0, a1, -1]]) {
      const c = closestOnSegment(s0[0], s0[1], s1[0], s1[1], p[0], p[1]);
      const d = len(p[0] - c[0], p[1] - c[1]);
      if (!best || d < best.d) best = { d, nx: (p[0] - c[0]) * sign, nz: (p[1] - c[1]) * sign };
    }
    const min = a.mon.capsule.r + b.mon.capsule.r;
    if (best.d >= min) return;
    let nx = best.nx, nz = best.nz, nl = len(nx, nz);
    if (nl < 1e-6) { nx = a.x - b.x; nz = a.z - b.z; nl = len(nx, nz) || 1; }
    nx /= nl; nz /= nl;                                   // points from b toward a
    // whoever moved into the other this step takes the correction (an attacker stops at its
    // target instead of shoving it); bodies that merely met share it
    const inA = Math.max(0, -((a.x - a.prev[0]) * nx + (a.z - a.prev[1]) * nz));
    const inB = Math.max(0, (b.x - b.prev[0]) * nx + (b.z - b.prev[1]) * nz);
    const total = min - best.d, eps = 1e-4;
    const shareA = (inA + eps) / (inA + inB + 2 * eps);
    a.x += nx * total * shareA; a.z += nz * total * shareA;
    b.x -= nx * total * (1 - shareA); b.z -= nz * total * (1 - shareA);
  }

  // Path from `from` to `goal` around the other fighter's body (a circle that covers its length
  // plus our own width), inside the arena. One detour waypoint at the tangent, shorter side.
  planPath(me, from, goal, other) {
    const c = other.capsule(), cx = (c[0][0] + c[1][0]) / 2, cz = (c[0][1] + c[1][1]) / 2;
    const R = len(c[1][0] - c[0][0], c[1][1] - c[0][1]) / 2 + other.mon.capsule.r + me.mon.capsule.r + 0.1 * me.mon.BL;
    const [ax, az] = from, [bx, bz] = goal;
    const q = closestOnSegment(ax, az, bx, bz, cx, cz);
    if (len(q[0] - cx, q[1] - cz) >= R || len(ax - cx, az - cz) < R) return [goal];   // clear, or already beside it
    const d = len(ax - cx, az - cz), base = Math.atan2(ax - cx, az - cz), spread = Math.acos(clamp(R / d, -1, 1));
    let best = null;
    for (const side of [1, -1]) {
      const a = base + side * spread, m = 1.15;                           // a little outside the circle
      const t = this.clampToArena(cx + Math.sin(a) * R * m, cz + Math.cos(a) * R * m, me.mon.capsule.r);
      const cost = len(t[0] - ax, t[1] - az) + len(bx - t[0], bz - t[1]);
      if (!best || cost < best.cost) best = { t, cost };
    }
    return [best.t, goal];
  }

  // things about to hit a fighter, with time to impact, for its evade decisions
  hazardsFor(f) {
    const out = [];
    for (const o of this.fighters) {
      if (o === f || !o.act || o.act.fired || o.act.clip.event == null) continue;
      const mv = o.act.mv;
      if (!['melee', 'dash_strike', 'wave'].includes(mv.type)) continue;
      let eta = (o.act.clip.event - o.act.t) / o.act.rate;
      if (mv.type === 'wave') {
        // read from the wind-up: the wave leaves on the landing and travels to us
        eta += Math.max(0, f.distanceFrom(o.x, o.z)) / ((mv.wave_speed || 7) * o.mon.BL);
        out.push({ id: `${o.id}:${o.act.key}:${Math.round((this.time - o.act.t / o.act.rate) * 60)}`, eta, kind: 'wave', source: o.id });
        continue;
      }
      const near = mv.type === 'dash_strike' || f.gapTo(o) < o.meleeGap(mv) + 0.5 * o.mon.BL;
      if (near) out.push({ id: `${o.id}:${o.act.key}:${Math.round((this.time - o.act.t / o.act.rate) * 60)}`, eta, kind: mv.type, source: o.id });
    }
    for (const w of this.waves) {
      if (w.target !== f || w.hit) continue;
      const d = f.distanceFrom(w.x, w.z);
      out.push({ id: `${w.owner.id}:wave:${w.id}`, eta: Math.max(0, d) / w.speed, kind: 'wave', source: w.owner.id });
    }
    return out;
  }

  resolve(att, def, act) {
    const mv = act.mv, mon = att.mon;
    // a target mid-evade at the moment of impact dodged it, wherever its hop took it
    const evading = def.act?.mv.type === 'evade' && def.invulnerable();
    if (mv.type === 'melee') {
      const p = this.strikePoint(att, act);
      this.emit({ type: 'strike', who: att, key: mv.key, fx: mv.fx, at3: p });
      if (evading) this.emit({ type: 'dodged', who: def });
      else if (def.distanceFrom(p[0], p[2]) <= (mv.hit_radius || 0.15) * mon.BL) this.hit(att, def, mv, p);
      else this.emit({ type: 'miss', who: def });
    } else if (mv.type === 'wave') {
      const dx = def.x - att.x, dz = def.z - att.z, d = len(dx, dz) || 1;
      this.waves.push({ id: this.nextId++, x: att.x, z: att.z, dx: dx / d, dz: dz / d, speed: (mv.wave_speed || 7) * mon.BL,
        left: (mv.wave_reach || 7) * mon.BL, owner: att, target: def, mv, hit: false });
      this.emit({ type: 'wave', who: att, fx: mv.fx, x: att.x, z: att.z });
    } else if (mv.type === 'dash_strike') {
      const p = act.clip.path ? this.strikePoint(att, act) : [att.x, 0, att.z];
      this.emit({ type: 'slam', who: att, fx: mv.fx, x: p[0], z: p[2] });
      if (evading) this.emit({ type: 'dodged', who: def });
      else if (def.distanceFrom(p[0], p[2]) <= (mv.area || 1) * mon.BL) this.hit(att, def, mv, p);
      else this.emit({ type: 'miss', who: def });
    }
  }
  // the strike bone's position now: its path is stored relative to the hip at the clip start
  strikePoint(att, act) {
    const c = act.clip, p = sample(c.path, c.root_motion_fps, act.t), rm = sample(c.rm, c.root_motion_fps, act.t);
    const [x, z] = rot(p[0] - rm[0], p[2] - rm[1], att.yaw);
    return [att.x + x, p[1], att.z + z];
  }
  hit(att, def, mv, p) {
    if (def.ko) return;
    if (def.invulnerable() || (mv.type === 'wave' && def.airborne())) {
      this.emit({ type: def.airborne() ? 'jumped' : 'dodged', who: def });
      return;
    }
    const crit = this.random() < 0.1;
    const amount = Math.max(1, Math.round((mv.damage || 5) * att.atk / def.def * (0.9 + this.random() * 0.2) * (crit ? 1.5 : 1)));
    def.hp -= amount;
    att.energy = Math.min(100, att.energy + 8); def.energy = Math.min(100, def.energy + 4);
    this.emit({ type: 'hit', who: def, by: att, key: mv.key, name: mv.name, amount, crit, at3: p });
    if (mv.paralyze && def.paralyzed <= 0 && this.random() < mv.paralyze.chance) {
      def.paralyzed = mv.paralyze.seconds; this.emit({ type: 'paralyzed', who: def });
    }
    if (def.hp <= 0) def.knockOut();
    else def.hurt(att, mv.knockback ?? 0.5);
  }
  stepWaves(dt) {
    for (const w of this.waves) {
      const s = w.speed * dt;
      w.x += w.dx * s; w.z += w.dz * s; w.left -= s;
      if (!w.hit && w.target.distanceFrom(w.x, w.z) <= 0.1 * w.owner.mon.BL) { w.hit = true; this.hit(w.owner, w.target, w.mv, [w.x, 0, w.z]); }
    }
    this.waves = this.waves.filter((w) => w.left > 0);
  }
  buffTick(f, act, t0) {
    const n = 3, every = act.ends / (n + 1);
    for (let i = 1; i <= n; i++) if (t0 < i * every && act.t >= i * every) this.emit({ type: 'buff_pulse', who: f, fx: act.mv.fx });
  }
  buffDone(f, act) {
    const mv = act.mv;
    f.energy = Math.min(100, f.energy + (mv.energy_gain || 0));
    const heal = Math.min(f.maxHp - f.hp, mv.heal || 0);
    f.hp += heal;
    this.emit({ type: 'buffed', who: f, heal, name: mv.name });
  }
}
