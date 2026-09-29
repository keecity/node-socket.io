// Saber clash for the demo game's fighter loop (drop-in sketch).
// Both fighters must use mech_rigged.glb (or any rig with the same Saber_Clash_* clips).
// Call clashCheck(dt) once per frame after both fighters are updated.

const CLASH_RANGE = 0.08;      // blade-to-blade distance (game units) that counts as a clash
const CLASH_TIME = [1.0, 1.8]; // how long the lock lasts before someone wins (s)

function bladeSegment(f, a, b) {                 // world-space blade segment of fighter f
  const blade = f.model.findByName('SaberBlade');
  const m = blade.getWorldTransform();
  m.getTranslation(a);
  const dir = new pc.Vec3(); m.getY(dir);         // bone Y runs along the blade
  b.copy(a).add(dir.mulScalar(BLADE_LEN * blade.getLocalScale().y));
}
function segSegDist(a0, a1, b0, b1) {            // sampled closest distance between two segments
  let best = 1e9; const p = new pc.Vec3(), q = new pc.Vec3();
  for (let i = 0; i <= 12; i++) { p.lerp(a0, a1, i / 12);
    for (let j = 0; j <= 12; j++) { q.lerp(b0, b1, j / 12); best = Math.min(best, p.distance(q)); } }
  return best;
}
function inHitWindow(f) {
  const A = ATTACKS[f.clip]; if (!A || !A.saber) return false; const t = clipT(f);
  return A.hits.some(([t0, t1]) => t > t0 - 0.05 && t < t1);
}
function clashCheck(dt) {
  const [a, b] = F;
  if (a.state === 'clash') {                     // lock in progress: sparks + resolve
    a.clashT -= dt; b.clashT = a.clashT;
    FX.sparks(a.clashPt, 6, [1, 0.85, 0.6], 1.6); FX.sparks(a.clashPt, 3, a.col, 1.2);
    FX.sparks(a.clashPt, 3, b.col, 1.2); addShake(0.05, a.clashPt);
    if (a.clashT <= 0) {
      const aWins = Math.random() < 0.5 + (a.p.aggro - b.p.aggro) * 0.5;
      const [w, l] = aWins ? [a, b] : [b, a];
      setState(w, 'attack', 'Saber_Clash_Win', 0.06);
      setState(l, 'hit', 'Saber_Clash_Lose', 0.06);
      l.vel.copy(l.pos).sub(w.pos).setY(0).normalize().multiplyScalar(1.2);
      FX.flash(a.clashPt, 0.6, [1, 1, 1]); addShake(0.4, a.clashPt);
    }
    return;
  }
  if (!(a.saberOut && b.saberOut && inHitWindow(a) && inHitWindow(b))) return;
  const a0 = new pc.Vec3(), a1 = new pc.Vec3(), b0 = new pc.Vec3(), b1 = new pc.Vec3();
  bladeSegment(a, a0, a1); bladeSegment(b, b0, b1);
  if (segSegDist(a0, a1, b0, b1) > CLASH_RANGE) return;
  // blades met: both lock into the clash (clips are built for ~0.64 game units apart)
  const pt = new pc.Vec3().add2(a0, a1).add(b0).add(b1).mulScalar(0.25);
  for (const f of F) { setState(f, 'clash', 'Saber_Clash_Enter', 0.05); f.vel.set(0, 0, 0); f.clashPt = pt; }
  a.clashT = CLASH_TIME[0] + Math.random() * (CLASH_TIME[1] - CLASH_TIME[0]);
  FX.flash(pt, 0.8, [1, 1, 1]); hitStop = 0.12;  // anime-style freeze on impact
  // when Saber_Clash_Enter ends, play the looping Saber_Clash_Loop until clashT runs out
}
