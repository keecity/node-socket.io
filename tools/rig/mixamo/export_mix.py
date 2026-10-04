"""New Mixamo-rigged player + all clips -> player_rigged.glb (same node names the game expects: root, head, basketball)."""
import numpy as np, pygltflib as G
import mixrig as M, retarget_old as RO, retarget as RV, fold as FD, clips
from rig import qmat, qaxis, qmul, matq
FPS = 60
blob = bytearray(); g = G.GLTF2(); g.asset = G.Asset(generator='mixamo retarget')
def add(arr, ctype, typ, target=None, mm=False):
    arr = np.ascontiguousarray(arr)
    while len(blob) % 4: blob.append(0)
    off = len(blob); blob.extend(arr.tobytes())
    g.bufferViews.append(G.BufferView(buffer=0, byteOffset=off, byteLength=arr.nbytes, target=target))
    a = G.Accessor(bufferView=len(g.bufferViews) - 1, componentType=ctype, count=len(arr), type=typ)
    if mm: a.min = arr.min(0).tolist() if arr.ndim > 1 else [float(arr.min())]; a.max = arr.max(0).tolist() if arr.ndim > 1 else [float(arr.max())]
    g.accessors.append(a); return len(g.accessors) - 1
f32 = lambda a: np.asarray(a, np.float32)
img = M.g.images[0]; bv = M.g.bufferViews[img.bufferView]; IMG = M.BLOB[bv.byteOffset:bv.byteOffset + bv.byteLength]
while len(blob) % 4: blob.append(0)
off = len(blob); blob.extend(IMG); g.bufferViews.append(G.BufferView(buffer=0, byteOffset=off, byteLength=len(IMG)))
g.images = [G.Image(bufferView=0, mimeType=img.mimeType)]; g.samplers = [G.Sampler()]; g.textures = [G.Texture(source=0, sampler=0)]
g.materials = [G.Material(name='player', pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorTexture=G.TextureInfo(index=0), metallicFactor=0, roughnessFactor=0.9), doubleSided=True),
               G.Material(name='ball', pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorFactor=[1.0, 0.33, 0.04, 1], metallicFactor=0, roughnessFactor=0.7)),
               G.Material(name='ballSeam', pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorFactor=[0.05, 0.03, 0.02, 1], metallicFactor=0, roughnessFactor=0.8))]
pa = M.prim.attributes; NRM = M.acc(pa.NORMAL); UV = M.acc(pa.TEXCOORD_0)
prim = G.Primitive(attributes=G.Attributes(POSITION=add(f32(M.P), 5126, 'VEC3', 34962, True), NORMAL=add(f32(NRM), 5126, 'VEC3', 34962),
        TEXCOORD_0=add(f32(UV), 5126, 'VEC2', 34962), JOINTS_0=add(M.JI.astype(np.uint16), 5123, 'VEC4', 34962), WEIGHTS_0=add(f32(M.WT), 5126, 'VEC4', 34962)),
        indices=add(M.F.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963), material=0)
g.meshes.append(G.Mesh(name='player', primitives=[prim]))
BR = RV.BALL_R
def sphere(r, nu=24, nv=16):
    v = []
    for i in range(nv + 1):
        th = np.pi * i / nv
        for j in range(nu + 1): ph = 2 * np.pi * j / nu; v.append([np.sin(th) * np.cos(ph), np.cos(th), np.sin(th) * np.sin(ph)])
    v = np.array(v); f = []
    for i in range(nv):
        for j in range(nu): a = i * (nu + 1) + j; b = a + nu + 1; f += [[a, b, a + 1], [a + 1, b, b + 1]]
    return v * r, v, np.array(f)
def ring(r, axis, tr=0.0045, nu=48, nv=6):
    v, n, f = [], [], []
    for i in range(nu):
        a = 2 * np.pi * i / nu; c = np.array([np.cos(a), np.sin(a), 0])
        for j in range(nv):
            b = 2 * np.pi * j / nv; d = np.cos(b) * c + np.sin(b) * np.array([0, 0, 1]); v.append(c * r + d * tr); n.append(d)
    for i in range(nu):
        for j in range(nv):
            a = i * nv + j; b = ((i + 1) % nu) * nv + j; a2 = i * nv + (j + 1) % nv; b2 = ((i + 1) % nu) * nv + (j + 1) % nv; f += [[a, b, a2], [a2, b, b2]]
    v, n = np.array(v), np.array(n); R = {'z': np.eye(3), 'x': qmat(qaxis('y', 90)), 'y': qmat(qaxis('x', 90))}[axis]
    return v @ R.T, n @ R.T, np.array(f)
bp = []
for k, (v, n, f) in enumerate([sphere(BR)] + [ring(BR * 1.005, a) for a in 'xyz']):
    bp.append(G.Primitive(attributes=G.Attributes(POSITION=add(f32(v), 5126, 'VEC3', 34962, True), NORMAL=add(f32(n), 5126, 'VEC3', 34962)),
              indices=add(f.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963), material=1 if k == 0 else 2))
g.meshes.append(G.Mesh(name='basketball', primitives=bp))
# nodes: root (index 0) -> Hips ... ; mixamo node i -> new index map
bones = [i for i in M.ORDER if i in M.JOINTS]
NEW = {i: k + 1 for k, i in enumerate(bones)}
nm = lambda i: 'head' if M.NAME[i] == 'Head' else M.NAME[i]
g.nodes.append(G.Node(name='root', translation=[0, 0, 0], children=[NEW[M.ID['Hips']]]))
for i in bones:
    t, q, s = M.REST[i]
    g.nodes.append(G.Node(name=nm(i), translation=t.tolist(), rotation=q.tolist(), scale=s.tolist(), children=[NEW[c] for c in (M.NODES[i].children or []) if c in NEW]))
nb = len(g.nodes)
W0 = M.fk(); IBMn = np.stack([np.linalg.inv(W0[j]).T for j in M.JOINTS]).astype(np.float32)
g.skins = [G.Skin(name='rig', joints=[NEW[j] for j in M.JOINTS], skeleton=0, inverseBindMatrices=add(IBMn.reshape(-1, 16), 5126, 'MAT4'))]
g.nodes.append(G.Node(name='player_mesh', mesh=0, skin=0)); g.nodes.append(G.Node(name='basketball', mesh=1))
g.scenes = [G.Scene(nodes=[0, nb, nb + 1])]; g.scene = 0
ANIM_BONES = [M.ID[b] for b in list(RO.MAP) + ['Spine1']]
def write(name, frames, fps=FPS):
    """frames: list of (local{name: q}, hips_t, root_t, ball)"""
    t = add(f32(np.arange(len(frames)) / fps), 5126, 'SCALAR', None, True); an = G.Animation(name=name)
    def ch(node, path, data):
        an.samplers.append(G.AnimationSampler(input=t, output=add(f32(data), 5126, 'VEC4' if path == 'rotation' else 'VEC3'), interpolation='LINEAR'))
        an.channels.append(G.AnimationChannel(sampler=len(an.samplers) - 1, target=G.AnimationChannelTarget(node=node, path=path)))
    for i in ANIM_BONES:
        qs = np.array([fr[0].get(M.NAME[i], M.REST[i][1]) for fr in frames])
        for k in range(1, len(qs)):
            if qs[k] @ qs[k - 1] < 0: qs[k] = -qs[k]
        ch(NEW[i], 'rotation', qs)
    ch(NEW[M.ID['Hips']], 'translation', [fr[1] for fr in frames]); ch(0, 'translation', [fr[2] for fr in frames])
    B = np.array([fr[3] for fr in frames]); ch(nb + 1, 'translation', B)
    q = np.array([0, 0, 0, 1.]); w = np.zeros(3); qs = [q.copy()]
    for k in range(1, len(B)):
        v = (B[k] - B[k - 1]) * fps
        if name == 'Shoot' and abs(k / FPS - 0.69) < 0.5 / FPS: w = np.array([-16.0, 0, 0])
        if B[k][1] < BR + 1e-3: w = np.cross([0, 1, 0], np.array([v[0], 0, v[2]])) / BR
        if name in ('Idle', 'Dribble'): w = np.zeros(3)
        a = np.linalg.norm(w) / fps
        if a > 1e-6: q = qmul(np.r_[w / np.linalg.norm(w) * np.sin(a / 2), np.cos(a / 2)], q)
        qs.append(q.copy())
    ch(nb + 1, 'rotation', qs); g.animations.append(an)
for name, fn in clips.CLIPS.items():
    if name == 'DribbleRun': continue
    fr, balls = fn(); write(name, [RO.frame(p, b) for p, b in zip(fr, balls)]); print('clip', name, len(fr))
# DribbleRun: posed to the reference video frame by frame (one key per video frame, 24 fps)
import dribble_fit as DF
write('DribbleRun', DF.frames(), fps=24); print('clip DribbleRun (per-frame fit)', DF.N + 1)
g.buffers = [G.Buffer(byteLength=len(blob))]; g.set_binary_blob(bytes(blob)); g.save_binary('player_rigged.glb')
print('ok', len(blob))
