import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadMaterials } from './textures.js';
import { buildCamp, FLOOR, SLAB, LINE_X, SAW_Z, DECK_Y, ROLLER_R, BOARD } from './camp.js';

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe3e6);
scene.fog = new THREE.Fog(0xdfe3e6, 60, 140);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 300);
camera.position.set(22, 20, 26);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1, 2, 1);
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x6b5a45, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-14, 26, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const M = await loadMaterials('./assets/atlas.webp', renderer);
const { root, parts, refs, homes } = buildCamp(M);
scene.add(root);
document.getElementById('loading').remove();

const lamp = new THREE.PointLight(0xffd59a, 6, 9, 1.5);
refs.bulb.add(lamp);

// ------------------------------------------------------------------ tiny tween system
const tweens = new Set();
let epoch = 0;
function tween(duration, fn, ease = (t) => t * t * (3 - 2 * t)) {
  return new Promise((resolve) => tweens.add({ t: 0, duration, fn, ease, resolve }));
}
const wait = (s) => tween(s, () => {});
function stepTweens(dt) {
  for (const tw of tweens) {
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    tw.fn(tw.ease(tw.t));
    if (tw.t >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}
function cancelAnimations() { epoch++; tweens.clear(); }

// ------------------------------------------------------------------ destruction physics
const bodies = new Map();
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), box3 = new THREE.Box3();
const isFree = (m) => m.visible && m.userData.destructible && !bodies.has(m);
const floorAt = (x, z) => (x > SLAB.x0 && x < SLAB.x1 && z > SLAB.z0 && z < SLAB.z1 ? FLOOR : 0);

function detach(mesh, impulse, spin = 4) {
  if (bodies.has(mesh)) return;
  scene.attach(mesh);
  mesh.geometry.computeBoundingBox();
  box3.copy(mesh.geometry.boundingBox);
  const size = box3.getSize(tmpV).multiply(mesh.scale);
  const rest = Math.min(size.x, size.y, size.z) / 2;
  // Thinnest local axis: debris settles lying flat on it.
  const flat = rest * 2 === size.x ? new THREE.Vector3(1, 0, 0) : rest * 2 === size.y ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  bodies.set(mesh, {
    v: impulse.clone(),
    w: new THREE.Vector3(THREE.MathUtils.randFloatSpread(spin), THREE.MathUtils.randFloatSpread(spin), THREE.MathUtils.randFloatSpread(spin)),
    rest: Math.max(rest, 0.03),
    flat,
    sleep: 0,
  });
}

function stepPhysics(dt) {
  for (const [m, b] of bodies) {
    if (b.sleep > 1) continue;
    b.v.y -= 9.8 * dt;
    m.position.addScaledVector(b.v, dt);
    const wl = b.w.length();
    if (wl > 1e-4) m.quaternion.premultiply(tmpQ.setFromAxisAngle(tmpV.copy(b.w).divideScalar(wl), wl * dt));
    const fy = floorAt(m.position.x, m.position.z) + b.rest;
    if (m.position.y < fy) {
      m.position.y = fy;
      b.v.y = Math.abs(b.v.y) * 0.25;
      b.v.x *= 0.6; b.v.z *= 0.6;
      b.w.multiplyScalar(0.6);
      // Topple onto the flattest face so debris doesn't balance on edges.
      const up = tmpV.copy(b.flat).applyQuaternion(m.quaternion);
      const target = new THREE.Vector3(0, Math.sign(up.y) || 1, 0);
      m.quaternion.premultiply(tmpQ.setFromUnitVectors(up, target).slerp(IDENTITY, 1 - Math.min(1, dt * 8)));
      if (b.v.lengthSq() < 0.05 && Math.abs(up.y) > 0.98) b.sleep += dt * 6;
    }
  }
}

const IDENTITY = new THREE.Quaternion();
const CENTER = new THREE.Vector3(0, 2, 0);
function blast(mesh, power = 6) {
  const p = mesh.getWorldPosition(new THREE.Vector3());
  const dir = p.sub(CENTER).setY(0).normalize();
  const imp = dir.multiplyScalar(THREE.MathUtils.randFloat(0.5, 1) * power).add(new THREE.Vector3(0, THREE.MathUtils.randFloat(1, 4), 0));
  detach(mesh, imp);
}

// Damage stages, roughly how an RTS health bar would step down.
const STAGES = [
  { label: 'Roof off', pick: (m) => m.userData.category === 'roof' || (m.userData.category === 'siding' && Math.random() < 0.3) || (m.userData.category === 'board' && Math.random() < 0.2) },
  { label: 'Walls down', pick: (m) => ['siding', 'planks', 'window', 'trim', 'rack', 'log', 'dust', 'board', 'lumber'].includes(m.userData.category) || (m.userData.category === 'frame' && Math.random() < 0.35) },
  { label: 'Collapsed', pick: () => true },
];
let stage = 0;
function damage() {
  if (stage >= STAGES.length) return;
  stopProduction();
  const s = STAGES[stage++];
  const victims = parts.filter((m) => isFree(m) && s.pick(m));
  victims.sort((a, b) => b.getWorldPosition(tmpV).y - a.getWorldPosition(new THREE.Vector3()).y);
  victims.forEach((m, i) => setTimeout(() => isFree(m) && blast(m, stage === 3 ? 7 : 4), (i / victims.length) * 1200));
  setStatus(`Damage stage ${stage}/3 – ${s.label}`);
}

function repair() {
  cancelAnimations();
  stopProduction();
  bodies.clear();
  for (const [m, h] of homes) {
    h.parent.add(m);
    m.position.copy(h.position);
    m.quaternion.copy(h.quaternion);
    m.scale.copy(h.scale);
    m.visible = true;
  }
  for (const b of produced) { b.removeFromParent(); parts.splice(parts.indexOf(b), 1); }
  produced.length = 0;
  slotCount.fill(0);
  stage = 0;
  setStatus('Repaired');
}

// ------------------------------------------------------------------ build-up animation
const BUILD_ORDER = { foundation: 0, decal: 0, concrete: 1, frame: 2, machine: 3, planks: 4, siding: 4, window: 5, trim: 5, dust: 5, rack: 5, roof: 6, lumber: 7, board: 7, log: 8 };
async function construct() {
  repair();
  const ep = epoch;
  const list = [...homes.keys()].sort((a, b) =>
    BUILD_ORDER[a.userData.category] - BUILD_ORDER[b.userData.category] || homes.get(a).position.y - homes.get(b).position.y);
  for (const m of list) m.visible = false;
  setStatus('Constructing…');
  const total = 6;
  await Promise.all(list.map((m, i) => {
    const h = homes.get(m), delay = (i / list.length) * total;
    return wait(delay).then(() => {
      if (ep !== epoch) return;
      m.visible = true;
      return tween(0.45, (t) => {
        m.position.copy(h.position).y += (1 - t) * 2.5;
        m.scale.copy(h.scale).multiplyScalar(Math.max(t, 0.001));
      });
    });
  }));
  if (ep === epoch) setStatus('Built');
}

// ------------------------------------------------------------------ production loop (log -> saw -> boards -> stack)
const produced = [];
let producing = false;
const slotCount = refs.stacks.map(() => 0);
const AXIS_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

// Saw dust particles.
const DUST_N = 300;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xe0b77a, size: 0.05 }));
dustPts.frustumCulled = false;
scene.add(dustPts);
const dustVel = Array.from({ length: DUST_N }, () => new THREE.Vector3());
const dustLife = new Float32Array(DUST_N);
let dustRate = 0, dustCursor = 0;
function stepDust(dt) {
  const pos = dustGeo.attributes.position;
  for (let n = Math.floor(dustRate * dt * 60); n > 0; n--) {
    const i = dustCursor++ % DUST_N;
    pos.setXYZ(i, LINE_X, DECK_Y + 0.4, SAW_Z);
    dustVel[i].set(THREE.MathUtils.randFloatSpread(1.5), THREE.MathUtils.randFloat(0.5, 2.5), THREE.MathUtils.randFloat(-2.5, -0.5));
    dustLife[i] = 1.2;
  }
  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) { pos.setY(i, -10); continue; }
    dustLife[i] -= dt;
    dustVel[i].y -= 6 * dt;
    pos.setXYZ(i, pos.getX(i) + dustVel[i].x * dt, Math.max(FLOOR + 0.01, pos.getY(i) + dustVel[i].y * dt), pos.getZ(i) + dustVel[i].z * dt);
  }
  pos.needsUpdate = true;
}

let bladeSpeed = 0, rollerSpeed = 0;
function arc(obj, from, to, qFrom, qTo, height) {
  return (t) => {
    obj.position.lerpVectors(from, to, t).y += Math.sin(Math.PI * t) * height;
    obj.quaternion.slerpQuaternions(qFrom, qTo, t);
  };
}

async function refillLogs(ep) {
  for (const log of refs.logs) {
    const h = homes.get(log);
    h.parent.add(log);
    log.position.copy(h.position).y += 3;
    log.quaternion.copy(h.quaternion);
    log.scale.copy(h.scale);
    log.visible = true;
    await tween(0.35, (t) => { log.position.y = h.position.y + (1 - t) * 3; }, (t) => t * t);
    if (ep !== epoch) return;
  }
}

async function produce() {
  const ep = epoch;
  while (ep === epoch && producing) {
    const logs = refs.logs.filter((l) => l.visible && homes.get(l).parent === l.parent && !bodies.has(l));
    if (!logs.length) { await refillLogs(ep); continue; }
    const log = logs.reduce((a, b) => (b.position.y > a.position.y ? b : a));
    const r = log.userData.radius;
    const len = log.geometry.parameters.height;
    scene.attach(log);

    // 1. Lift log from the rack onto the infeed deck, turning it in line with the saw.
    const start = new THREE.Vector3(LINE_X, DECK_Y + r, -2.3);
    await tween(1.6, arc(log, log.position.clone(), start, log.quaternion.clone(), AXIS_Z, 2.5));
    if (ep !== epoch) return;

    // 2. Feed into the saw: log is consumed from its front end while boards grow out the far side.
    bladeSpeed = 40;
    dustRate = 3;
    const boards = [];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w, BOARD.h, BOARD.len), M.lightWood);
      b.name = `produced_board_${produced.length}`;
      b.castShadow = b.receiveShadow = true;
      b.userData = { category: 'board', destructible: true };
      b.position.set(LINE_X + (i - 1) * BOARD.pitch, DECK_Y + ROLLER_R + BOARD.h / 2, SAW_Z);
      b.scale.z = 0.001;
      scene.add(b);
      boards.push(b);
      produced.push(b);
      parts.push(b);
    }
    const frontZ = start.z + len / 2;
    await tween(1.0, (t) => { log.position.z = start.z + (SAW_Z - frontZ) * t; });
    if (ep !== epoch) return;
    await tween(3.0, (t) => {
      const remaining = Math.max(1 - t, 0.001);
      log.scale.x = remaining;                         // log's length axis is local X
      log.position.z = SAW_Z - (len * remaining) / 2;
      for (const b of boards) {
        b.scale.z = Math.max(t, 0.001);
        b.position.z = SAW_Z + 0.1 + (BOARD.len * t) / 2;
      }
    }, (t) => t);
    if (ep !== epoch) return;
    log.visible = false;
    homes.get(log).parent.add(log);
    dustRate = 0;
    bladeSpeed = 10;

    // 3. Roll boards down the outfeed.
    rollerSpeed = 12;
    const z0 = boards[0].position.z;
    await tween(1.2, (t) => boards.forEach((b) => { b.position.z = z0 + (5.3 - BOARD.len / 2 - z0) * t; }));
    rollerSpeed = 0;
    if (ep !== epoch) return;

    // 4. Carry each board to the next free slot on a lumber stack.
    for (const b of boards) {
      const s = slotCount[0] <= slotCount[1] ? 0 : 1;
      const st = refs.stacks[s];
      const k = slotCount[s]++;
      const layer = st.layers + Math.floor(k / 10);
      const target = new THREE.Vector3(st.cx + ((k % 10) - 4.5) * BOARD.pitch, st.base + layer * st.layerH + BOARD.h / 2, st.zc);
      await tween(0.9, arc(b, b.position.clone(), target, b.quaternion.clone(), b.quaternion.clone(), 2));
      if (ep !== epoch) return;
    }

    // Ship the extra lumber once the stacks are tall.
    if (slotCount[0] + slotCount[1] >= 60) {
      const batch = produced.splice(0);
      await tween(0.8, (t) => batch.forEach((b) => b.scale.setScalar(1 - t * 0.999)));
      batch.forEach((b) => { b.removeFromParent(); parts.splice(parts.indexOf(b), 1); });
      slotCount.fill(0);
    }
  }
}

function startProduction() {
  if (producing) return;
  if (stage > 0) repair();
  producing = true;
  bladeSpeed = 10;
  setStatus('Producing lumber');
  produce();
}
function stopProduction() {
  if (!producing) return;
  producing = false;
  cancelAnimations();
  bladeSpeed = 0; rollerSpeed = 0; dustRate = 0;
  setStatus('Production stopped');
}

// ------------------------------------------------------------------ picking: click a part to knock it off
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const tip = document.getElementById('tip');
let down = null, hovered = null;
function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(parts.filter(isFree), false)[0];
  return hit?.object;
}
renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointermove', (e) => {
  const m = pick(e);
  if (m !== hovered) {
    hovered = m;
    tip.style.display = m ? 'block' : 'none';
    if (m) tip.textContent = pathOf(m);
  }
  tip.style.left = e.clientX + 14 + 'px';
  tip.style.top = e.clientY + 14 + 'px';
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const m = pick(e);
  if (!m) return;
  if (producing) stopProduction();
  const dir = ray.ray.direction.clone().setY(0).normalize().multiplyScalar(5).add(new THREE.Vector3(0, 3, 0));
  detach(m, dir, 8);
});
function pathOf(o) {
  const names = [];
  for (let p = homes.get(o)?.parent ?? o.parent; p && p !== root && p !== scene; p = p.parent) names.unshift(p.name);
  return [...names, o.name].join(' / ');
}

// ------------------------------------------------------------------ UI
const statusEl = document.getElementById('status');
function setStatus(s) { statusEl.textContent = s; }
const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
on('build', construct);
on('produce', () => (producing ? stopProduction() : startProduction()));
on('damage', damage);
on('repair', repair);
on('export', () => {
  repair();
  new GLTFExporter().parse(root, (glb) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    a.download = 'woodcutter_camp.glb';
    a.click();
  }, (err) => setStatus('Export failed: ' + err.message), { binary: true });
});

// Hierarchy summary.
const tree = document.getElementById('tree');
(function list(obj, depth) {
  for (const c of obj.children) {
    if (!c.isGroup) continue;
    let count = 0;
    c.traverse((o) => o.isMesh && count++);
    const li = document.createElement('div');
    li.style.paddingLeft = depth * 12 + 'px';
    li.innerHTML = `<span>${c.name}</span><b>${count}</b>`;
    tree.appendChild(li);
    list(c, depth + 1);
  }
})(root, 0);
document.getElementById('count').textContent = `${parts.length} parts`;

// ------------------------------------------------------------------ loop
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  stepTweens(dt);
  stepPhysics(dt);
  stepDust(dt);
  refs.blade.rotation.x -= bladeSpeed * dt;
  for (const r of refs.rollers) r.rotateY(-rollerSpeed * dt);
  controls.update();
  renderer.render(scene, camera);
});

window.camp = { root, parts, damage, repair, construct, startProduction, stopProduction };
