// three.js presentation. Each fighter view plays exactly the clip and clip time the simulation
// reports (clips run at timeScale 0; the mixer only blends), and sits where the simulation puts
// it. Clips from a monster pack are in place, so the body never drifts from that spot.
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

export function makeStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070b16');
  scene.fog = new THREE.Fog('#070b16', 10, 26);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 90);
  scene.add(new THREE.HemisphereLight('#cfe6ff', '#2a2440', 1.25));
  const key = new THREE.DirectionalLight('#ffffff', 1.4); key.position.set(3, 6, 4); scene.add(key);
  const back = new THREE.DirectionalLight('#9fd8ff', 0.9); back.position.set(-4, 3, -5); scene.add(back);
  return { renderer, scene, camera };
}

export function makeArena(scene, radius) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(512, 512, 40, 512, 512, 512);
  grad.addColorStop(0, '#16233f'); grad.addColorStop(1, '#0a1022');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(102,214,255,0.35)'; g.lineWidth = 3;
  for (const r of [150, 300, 440, 500]) { g.beginPath(); g.arc(512, 512, r, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = 'rgba(102,214,255,0.12)'; g.lineWidth = 2;
  for (let a = 0; a < 12; a++) {
    const t = a / 12 * Math.PI * 2;
    g.beginPath(); g.moveTo(512 + Math.cos(t) * 150, 512 + Math.sin(t) * 150); g.lineTo(512 + Math.cos(t) * 500, 512 + Math.sin(t) * 500); g.stroke();
  }
  g.fillStyle = 'rgba(255,225,74,0.5)';
  g.beginPath(); g.moveTo(540, 380); g.lineTo(470, 520); g.lineTo(520, 520); g.lineTo(480, 650); g.lineTo(565, 490); g.lineTo(515, 490); g.closePath(); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const R = radius + 0.6;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.05, 8, 128), new THREE.MeshBasicMaterial({ color: '#66d6ff' }));
  rim.rotation.x = Math.PI / 2; scene.add(rim);
  const pylons = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: '#1a2647', emissive: i % 2 ? '#ffe14a' : '#66d6ff', emissiveIntensity: 0.35, transparent: true }));
    p.position.set(Math.cos(a) * (R + 0.8), 1.2, Math.sin(a) * (R + 0.8)); scene.add(p); pylons.push(p);
  }
  const n = 220, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = rand(-R - 3, R + 3); pos[i * 3 + 1] = rand(0.2, 6); pos[i * 3 + 2] = rand(-R - 3, R + 3); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#66d6ff', size: 0.04, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(motes);
  return {
    update(time, camera, target) {
      motes.rotation.y = time * 0.02;
      for (const [i, p] of pylons.entries()) {
        p.material.emissiveIntensity = 0.3 + 0.25 * Math.max(0, Math.sin(time * 3 + i * 1.7));
        // fade a pylon standing between the camera and the fight
        const cx = camera.position.x, cz = camera.position.z;
        const vx = target.x - cx, vz = target.z - cz, ox = p.position.x - cx, oz = p.position.z - cz;
        const along = (ox * vx + oz * vz) / (vx * vx + vz * vz);
        const miss = Math.hypot(ox - vx * along, oz - vz * along);
        p.material.opacity = along > 0 && along < 1 ? THREE.MathUtils.clamp((miss - 0.6) / 1.4, 0.08, 1) : 1;
      }
    },
  };
}

// Rotate a texture's hue in the shader so a variant keeps its shading but swaps colours.
function hueShift(material, degrees) {
  const a = degrees * Math.PI / 180;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hueAngle = { value: a };
    shader.fragmentShader = 'uniform float hueAngle;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      {
        const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 yiq = toYIQ * diffuseColor.rgb;
        float c = cos(hueAngle), s = sin(hueAngle);
        yiq.yz = vec2(yiq.y * c - yiq.z * s, yiq.y * s + yiq.z * c);
        diffuseColor.rgb = clamp(toRGB * yiq * vec3(1.3, 1.22, 1.0), 0.0, 1.0);
      }`);
  };
  material.customProgramCacheKey = () => 'hue' + degrees;
}

export class FighterView {
  // model: a fresh copy of the monster's rig; clips: {asset name: THREE.AnimationClip}
  constructor(scene, fighter, model, clips) {
    this.f = fighter;
    const mon = fighter.mon, roles = mon.manifest.roles;
    this.root = new THREE.Group(); scene.add(this.root);
    this.root.add(model); this.model = model;
    this.bones = {};
    this.materials = [];
    model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        for (const m of [].concat(o.material)) {
          if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.color.set('#ffffff'); }
          if (fighter.look.hue) hueShift(m, fighter.look.hue);
          m.needsUpdate = true; this.materials.push(m);
        }
      }
    });
    // scale: the rig's hip-to-head distance must match the manifest's, in world units
    model.updateMatrixWorld(true);
    const hip = this.bones[roles.hip], head = this.bones[roles.head_tip];
    const hw = hip.getWorldPosition(new THREE.Vector3()), tw = head.getWorldPosition(new THREE.Vector3());
    const r = mon.manifest.rest;
    const metres = Math.hypot(r.head_tip[0] - r.hip[0], r.head_tip[1] - r.hip[1], r.head_tip[2] - r.hip[2]);
    const s = mon.scale * metres / hw.distanceTo(tw);
    model.scale.setScalar(s);
    // the simulation's position is the hip's spot on the floor
    model.position.set(-hw.x * s, 0, -hw.z * s);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      a.timeScale = 0; a.clampWhenFinished = true; a.setLoop(THREE.LoopRepeat, Infinity);
      this.actions[name] = a;
    }
    this.current = null;
    this.flash = 0;
  }
  update(dt) {
    const f = this.f, pose = f.pose();
    const a = this.actions[pose.clip];
    if (a !== this.current) {
      a.reset(); a.timeScale = 0; a.setEffectiveWeight(1); a.play();
      if (this.current) this.current.crossFadeTo(a, pose.loop ? 0.2 : 0.1, false);   // into a gait slower, into a move quicker
      this.current = a;
    }
    a.time = pose.time;
    this.mixer.update(dt);                       // advances only the blend weights
    this.root.position.set(f.x, 0, f.z);
    this.root.rotation.y = f.yaw;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 0.3);
      for (const m of this.materials) m.emissive && m.emissive.setRGB(this.flash, this.flash * 0.95, this.flash * 0.6);
    }
  }
  bone(role) {
    const name = this.f.mon.manifest.roles[role] || this.f.mon.manifest.roles.hip;
    return (this.bones[name] || this.bones[this.f.mon.manifest.roles.hip]).getWorldPosition(new THREE.Vector3());
  }
  body() { return this.bone('hip').add(new THREE.Vector3(0, 0.1 * this.f.mon.BL, 0)); }
  hitFlash() { this.flash = 1; }
}
