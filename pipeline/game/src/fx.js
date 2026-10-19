// Electric effects: bolts, sparks, shockwaves, sky strikes, floating numbers, screen flash and
// camera shake. Purely visual; the simulation never reads any of this.
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

export class Fx {
  constructor(scene, camera, flashEl) {
    this.scene = scene; this.camera = camera; this.flashEl = flashEl;
    this.list = []; this.shake = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  step(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.t += dt; const k = Math.min(1, f.t / f.life);
      f.update(k, dt);
      if (k >= 1) { f.dispose(); this.list.splice(i, 1); }
    }
  }
  clear() { for (const f of this.list) f.dispose(); this.list = []; }
  add(life, update, dispose = () => {}) { this.list.push({ life, t: 0, update, dispose }); }

  screenFlash(strength = 0.5) {
    if (this.reduced) strength *= 0.3;
    const el = this.flashEl;
    el.style.transition = 'none'; el.style.opacity = strength;
    requestAnimationFrame(() => { el.style.transition = 'opacity 0.35s ease-out'; el.style.opacity = 0; });
  }
  kick(amount) { this.shake = Math.max(this.shake, this.reduced ? amount * 0.3 : amount); }

  light(pos, color = '#ffe14a', intensity = 14, life = 0.35) {
    const l = new THREE.PointLight(color, intensity, 6, 2); l.position.copy(pos); this.scene.add(l);
    this.add(life, (k) => { l.intensity = intensity * (1 - k); }, () => this.scene.remove(l));
  }
  bolt(from, to, { life = 0.4, jitter = 0.16, segments = 12, color = '#fff6b0', glow = '#66d6ff', width = 0.025, branches = 2 } = {}) {
    const group = new THREE.Group(); this.scene.add(group);
    const tube = (pts, r, c, o) => {
      const path = new THREE.CurvePath();
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      return new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 3, r, 5, false),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false }));
    };
    const jag = (a, b, n, j) => {
      const pts = [a.clone()], d = b.clone().sub(a);
      for (let i = 1; i < n; i++) pts.push(a.clone().addScaledVector(d, i / n).add(new THREE.Vector3(rand(-j, j), rand(-j, j), rand(-j, j))));
      pts.push(b.clone()); return pts;
    };
    const free = () => { group.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); }); group.clear(); };
    let refresh = 0;
    const rebuild = () => {
      free();
      const pts = jag(from(), to(), segments, jitter);
      group.add(tube(pts, width, color, 1), tube(pts, width * 4, glow, 0.35));
      for (let b = 0; b < branches; b++) {
        const s = pts[Math.floor(rand(2, pts.length - 2))];
        group.add(tube(jag(s, s.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.5, 0.3), rand(-0.6, 0.6))), 5, jitter * 0.6), width * 0.6, color, 0.8));
      }
    };
    rebuild();
    this.add(life, (k, dt) => {
      if ((refresh -= dt) <= 0) { rebuild(); refresh = 0.05; }
      if (k > 0.6) group.children.forEach((m) => { m.material.opacity *= 0.9; });
    }, () => { free(); this.scene.remove(group); });
  }
  sparks(pos, { count = 60, color = '#ffe14a', speed = 3.2, life = 0.8, up = 1.5 } = {}) {
    const geo = new THREE.BufferGeometry(), p = new Float32Array(count * 3), v = [];
    for (let i = 0; i < count; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      v.push(new THREE.Vector3(rand(-1, 1), rand(-0.2, 1) * up, rand(-1, 1)).normalize().multiplyScalar(rand(0.4, 1) * speed));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat); this.scene.add(pts);
    this.add(life, (k, dt) => {
      for (let i = 0; i < count; i++) {
        v[i].y -= 6 * dt;
        p[i * 3] += v[i].x * dt; p[i * 3 + 1] = Math.max(0.02, p[i * 3 + 1] + v[i].y * dt); p[i * 3 + 2] += v[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true; mat.opacity = 1 - k;
    }, () => { geo.dispose(); mat.dispose(); this.scene.remove(pts); });
  }
  shockwave(x, z, { radius = 3, life = 0.6, color = '#66d6ff' } = {}) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.04, z); this.scene.add(ring);
    this.add(life, (k) => { const s = 0.2 + k * radius; ring.scale.set(s, s, s); ring.material.opacity = 1 - k; },
      () => { ring.geometry.dispose(); ring.material.dispose(); this.scene.remove(ring); });
  }
  skyStrike(pos, life = 0.5) {
    this.bolt(() => new THREE.Vector3(pos.x + rand(-0.3, 0.3), 9, pos.z + rand(-0.3, 0.3)), () => pos.clone(), { life, jitter: 0.35, segments: 18, width: 0.05, branches: 4 });
    this.light(pos.clone().setY(1.5), '#fff6b0', 22, life);
  }
  popText(worldPos, text, cls = '') {
    const el = document.createElement('div'); el.className = 'dmg ' + cls; el.textContent = text;
    document.body.appendChild(el);
    const start = worldPos.clone();
    this.add(1.1, (k) => {
      const p = start.clone(); p.y += k * 0.8; p.project(this.camera);
      el.style.left = ((p.x + 1) / 2 * innerWidth) + 'px';
      el.style.top = ((1 - p.y) / 2 * innerHeight) + 'px';
      el.style.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      el.style.transform = `translate(-50%,-50%) scale(${k < 0.15 ? 0.6 + k * 2.7 : 1})`;
    }, () => el.remove());
  }
}
