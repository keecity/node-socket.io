import * as THREE from 'three';

// Slices the 4x4 material atlas (assets/atlas.webp) into individual tiling textures.
// Grid cells: [col, row, widthInCells, heightInCells]
const TILES = {
  corrugated:  [0, 0, 2, 1],
  greenSiding: [2, 0, 2, 1],
  darkWood:    [0, 1, 1, 1],
  lightWood:   [1, 1, 1, 1],
  bark:        [2, 1, 1, 1],
  endLight:    [3, 1, 1, 1],
  concrete:    [0, 2, 2, 1],
  sawdust:     [2, 2, 2, 1],
  greenMetal:  [0, 3, 1, 1],
  steel:       [1, 3, 1, 1],
  rust:        [2, 3, 1, 1],
  endDark:     [3, 3, 1, 1],
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function loadMaterials(url, renderer) {
  const img = await loadImage(url);
  const cell = img.width / 4;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const crop = ([c, r, w, h], inset = 5) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512 * w;
    canvas.height = 512 * h;
    canvas.getContext('2d').drawImage(
      img, c * cell + inset, r * cell + inset, w * cell - inset * 2, h * cell - inset * 2,
      0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = aniso;
    return tex;
  };

  // tu/tv: metres covered by one texture repeat. uv: 'auto' turns the grain along a face's long axis.
  const std = (tile, { tu = 1.5, tv = tu, uv = 'none', ...params } = {}) => {
    const m = new THREE.MeshStandardMaterial({ map: crop(TILES[tile]), roughness: 0.85, ...params });
    m.name = tile;
    m.userData = { tu, tv, uv };
    return m;
  };

  const M = {
    corrugated:  std('corrugated', { tu: 2.4, tv: 1.2, metalness: 0.45, roughness: 0.55 }),
    greenSiding: std('greenSiding', { tu: 3.9, tv: 1.95 }),
    darkWood:    std('darkWood', { tu: 1.6, uv: 'auto' }),
    lightWood:   std('lightWood', { tu: 1.4, uv: 'auto', roughness: 0.75 }),
    bark:        std('bark', { tu: 1.2, roughness: 0.95 }),
    endLight:    std('endLight'),
    endDark:     std('endDark'),
    concrete:    std('concrete', { tu: 4, tv: 2, roughness: 0.95 }),
    sawdust:     std('sawdust', { tu: 3, tv: 1.5, roughness: 1 }),
    greenMetal:  std('greenMetal', { tu: 1.2, metalness: 0.3, roughness: 0.6 }),
    steel:       std('steel', { tu: 1.2, metalness: 0.8, roughness: 0.4 }),
    rust:        std('rust', { tu: 1.2, metalness: 0.5, roughness: 0.75 }),
  };
  // End-grain caps use the whole tile once (no tiling).
  M.endLight.map.wrapS = M.endLight.map.wrapT = THREE.ClampToEdgeWrapping;
  M.endDark.map.wrapS = M.endDark.map.wrapT = THREE.ClampToEdgeWrapping;

  M.glass = new THREE.MeshStandardMaterial({
    name: 'glass', color: 0x9fb6c2, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2,
  });
  M.bulb = new THREE.MeshStandardMaterial({ name: 'bulb', color: 0xfff2c0, emissive: 0xffd77a, emissiveIntensity: 2 });

  // Soft-edged sawdust decal for the floor.
  const a = document.createElement('canvas');
  a.width = a.height = 256;
  const g = a.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  M.sawdustDecal = new THREE.MeshStandardMaterial({
    name: 'sawdustDecal', map: M.sawdust.map, alphaMap: new THREE.CanvasTexture(a),
    transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2,
  });
  return M;
}
