#!/usr/bin/env python3
"""Rig cartoonbabycharacter.glb: skeleton, eyeballs, eyelids (blink) and jaw.

usage: build_rig.py in.glb out.glb
Requires: numpy, pillow
"""
import json, struct, sys
import numpy as np

SRC, DST = sys.argv[1], sys.argv[2]

# ------------------------------------------------------------------ read glb
d = open(SRC, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]
J = json.loads(d[20:20 + jl])
BIN = d[20 + jl + 8:]
BV = J['bufferViews']

def acc(i, dt, n):
    a = J['accessors'][i]; v = BV[a['bufferView']]
    return np.frombuffer(BIN, dt, a['count'] * n, v.get('byteOffset', 0)).reshape(-1, n).copy()

P = acc(0, '<f4', 3).astype(float); N = acc(1, '<f4', 3).astype(float)
UV = acc(2, '<f4', 2).astype(float); F = acc(3, '<u2', 1).reshape(-1, 3).astype(int)
img = BIN[BV[4]['byteOffset']:BV[4]['byteOffset'] + BV[4]['byteLength']]

# ------------------------------------------------------- connected components
key = np.round(P, 5)
_, winv = np.unique(key, axis=0, return_inverse=True); winv = winv.ravel()
nw = winv.max() + 1
par = np.arange(nw)
def find(a):
    while par[a] != a:
        par[a] = par[par[a]]; a = par[a]
    return a
for tri in F:
    a, b, c = (find(winv[t]) for t in tri)
    par[b] = a; par[find(c)] = find(a)
root_of = np.array([find(i) for i in range(nw)])
comp = root_of[winv]                       # component id per original vertex
ids, counts = np.unique(comp, return_counts=True)
body_id = ids[np.argmax(counts)]
eye_ids = [i for i in ids if P[comp == i, 0].min() > 0.15 and P[comp == i, 1].min() > 0.6]
assert len(eye_ids) == 2, eye_ids
eye_ids.sort(key=lambda i: P[comp == i, 0].mean())   # lower x first


def _tex():
    import io
    from PIL import Image
    return np.array(Image.open(io.BytesIO(img)).convert('RGB'))

def _align(a, b):
    v = np.cross(a, b); c = a @ b
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)

# ------------------------------------------------------------------- constants
CX = -0.125            # body centre line
FX = -0.115            # face centre line
EYE_X = {'R': FX - 0.056, 'L': FX + 0.056}   # character's right eye is -x
EYE_Y, EYE_R = 0.740, 0.034
SKIN_Z = 0.170
EYE_Z = SKIN_Z - 0.022
R_UP, R_LO, R_RING = EYE_R * 1.13, EYE_R * 1.10, EYE_R * 1.09
LID_OPEN_UP, LID_OPEN_LO = np.radians(38), np.radians(28)
LID_ALPHA0 = np.radians(58)

# --------------------------------------------- 1. remove closed-eye geometry
keep_face = np.ones(len(F), bool)
cen = P[F].mean(1)
hole_verts = set()
for s in 'RL':
    ex = EYE_X[s]
    inside = (comp[F[:, 0]] == body_id) & (cen[:, 2] > 0.09) & \
        (((cen[:, 0] - ex) / 0.050) ** 2 + ((cen[:, 1] - EYE_Y) / 0.036) ** 2 < 1)
    keep_face &= ~inside
removed = F[~keep_face]
F = F[keep_face]
# boundary verts of the holes = verts of remaining faces welded to removed ones
removed_w = set(winv[removed.ravel()])
ring = np.array([i for i in np.unique(F.ravel()) if winv[i] in removed_w])
# snap ring vertices onto a sphere hidden just under the lids
for i in ring:
    s = 'R' if P[i, 0] < FX else 'L'
    ctr = np.array([EYE_X[s], EYE_Y, EYE_Z])
    dvec = P[i] - ctr
    P[i] = ctr + dvec / np.linalg.norm(dvec) * R_RING
# refresh normals of ring vertices from adjacent faces
fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
acc_n = np.zeros_like(P)
for k in range(3):
    np.add.at(acc_n, F[:, k], fn)
for i in ring:
    n = acc_n[i]
    if np.linalg.norm(n) > 0:
        N[i] = n / np.linalg.norm(n)
# drop orphan verts
used = np.unique(F.ravel())
# keep the two eyeball comps too (they are referenced by F already)
remap = -np.ones(len(P), int); remap[used] = np.arange(len(used))
P, N, UV, comp = P[used], N[used], UV[used], comp[used]
F = remap[F]

# ---------------------------------------------- 2. eyeballs (reuse the spheres)
vparts = [P]; nparts = [N]; uparts = [UV]; fparts = [F]
vtag = ['skin'] * len(P)          # per-vertex tag for weighting
nv = len(P)
sel_eyes = {}
for cid, s in zip(eye_ids, 'RL'):
    m = comp == cid
    idx = np.where(m)[0]
    q = P[idx]; ctr = (q.min(0) + q.max(0)) / 2
    rad = (q.max(0) - q.min(0)).mean() / 2
    # aim the iris/pupil (dark texels) straight down +Z
    tex_rgb = _tex()
    cols = tex_rgb[(UV[idx, 1] % 1 * (tex_rgb.shape[0] - 1)).astype(int), (UV[idx, 0] % 1 * (tex_rgb.shape[1] - 1)).astype(int)] / 255.
    dark = cols.sum(1) < 0.9
    fwd = (q[dark] - ctr).mean(0); fwd /= np.linalg.norm(fwd)
    Rm = _align(fwd, np.array([0., 0., 1.]))
    q = (q - ctr) @ Rm.T
    N[idx] = N[idx] @ Rm.T
    P[idx] = q * (EYE_R / rad) + np.array([EYE_X[s], EYE_Y, EYE_Z])
    for i in idx: vtag[i] = 'eye' + s
    sel_eyes[s] = idx

# ------------------------------------------------------------- 3. eyelids
# cheek UV for a flat skin colour
cheek = np.argmin(np.linalg.norm(P - np.array([FX - 0.056, 0.70, 0.178]), axis=1) +
                  (comp != body_id) * 10)
cheek_uv = UV[cheek].copy()

def lid_mesh(sc, upper, ex):
    R = R_UP if upper else R_LO
    open_a = LID_OPEN_UP if upper else LID_OPEN_LO
    far = np.radians(125)
    na, nr = 21, 10
    alphas = np.linspace(-np.radians(82), np.radians(82), na)
    verts, norms = [], []
    for a in alphas:
        edge = open_a * np.cos(a / LID_ALPHA0 * np.pi / 2) if abs(a) < LID_ALPHA0 else 0.0
        for t in np.linspace(0, 1, nr):
            phi = edge + t * (far - edge)
            if not upper: phi = -phi
            dvec = np.array([np.sin(a), np.cos(a) * np.sin(phi), np.cos(a) * np.cos(phi)])
            verts.append(np.array([ex, EYE_Y, EYE_Z]) + dvec * R); norms.append(dvec)
    tris = []
    for i in range(na - 1):
        for j in range(nr - 1):
            a0 = i * nr + j; a1 = a0 + 1; b0 = a0 + nr; b1 = b0 + 1
            if upper: tris += [(a0, b0, a1), (a1, b0, b1)]
            else: tris += [(a0, a1, b0), (a1, b1, b0)]
    return np.array(verts), np.array(norms), np.array(tris)

lid_tag = {}
for s in 'RL':
    for up in (True, False):
        v, n, t = lid_mesh(s, up, EYE_X[s])
        base = sum(len(x) for x in vparts)
        vparts.append(v); nparts.append(n); uparts.append(np.tile(cheek_uv, (len(v), 1)))
        fparts.append(t + base)
        vtag += [('upperlid' if up else 'lowerlid') + s] * len(v)
# note: vparts[0] is P which was edited in place for eye verts
Pall = np.vstack(vparts); Nall = np.vstack(nparts); UVall = np.vstack(uparts)
Fall = np.vstack(fparts)
vtag = np.array(vtag)
compall = np.concatenate([comp, -np.ones(len(Pall) - len(comp), int)])

# -------------------------------------------------------------- 4. skeleton
# name: (parent, head position, tail position)
def V(x, y, z): return np.array([x, y, z], float)
B = {}
def bone(name, parent, head, tail): B[name] = (parent, head, tail)
bone('root', None, V(CX, 0, 0.05), V(CX, 0.05, 0.05))
bone('hips', 'root', V(CX, 0.36, 0.055), V(CX, 0.44, 0.06))
bone('spine', 'hips', V(CX, 0.44, 0.06), V(CX, 0.52, 0.06))
bone('chest', 'spine', V(CX, 0.52, 0.06), V(CX, 0.585, 0.06))
bone('neck', 'chest', V(CX, 0.585, 0.06), V(FX, 0.635, 0.065))
bone('head', 'neck', V(FX, 0.635, 0.065), V(FX, 0.86, 0.08))
bone('jaw', 'head', V(FX, 0.685, 0.075), V(FX, 0.64, 0.175))
for s in 'RL':
    B['eye' + s] = ('head', V(EYE_X[s], EYE_Y, EYE_Z), V(EYE_X[s], EYE_Y, EYE_Z + 0.05))
    B['upperlid' + s] = ('head', V(EYE_X[s], EYE_Y, EYE_Z), V(EYE_X[s], EYE_Y + 0.04, EYE_Z))
    B['lowerlid' + s] = ('head', V(EYE_X[s], EYE_Y, EYE_Z), V(EYE_X[s], EYE_Y - 0.04, EYE_Z))
AY, AZ = 0.556, 0.045
arm = {'R': [-0.16, -0.21, -0.33, -0.43, -0.50], 'L': [-0.09, -0.04, 0.09, 0.21, 0.292]}
for s in 'RL':
    x = arm[s]
    bone('clavicle' + s, 'chest', V(x[0], 0.565, 0.055), V(x[1], AY, AZ))
    bone('upperarm' + s, 'clavicle' + s, V(x[1], AY, AZ), V(x[2], AY, AZ))
    bone('forearm' + s, 'upperarm' + s, V(x[2], AY, AZ), V(x[3], AY, AZ))
    bone('hand' + s, 'forearm' + s, V(x[3], AY, AZ), V(x[4], AY, AZ))
leg = {'R': -0.20, 'L': -0.05}
for s in 'RL':
    x = leg[s]
    bone('thigh' + s, 'hips', V(x, 0.36, 0.06), V(x, 0.19, 0.065))
    bone('shin' + s, 'thigh' + s, V(x, 0.19, 0.065), V(x, 0.055, 0.05))
    bone('foot' + s, 'shin' + s, V(x, 0.055, 0.05), V(x, 0.02, 0.12))
    bone('toe' + s, 'foot' + s, V(x, 0.02, 0.12), V(x, 0.01, 0.17))
names = list(B)
jidx = {n: i for i, n in enumerate(names)}

# --------------------------------------------------------------- 5. weights
def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t * ab), axis=1)

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

body_bones = [n for n in names if n not in ('root', 'head', 'jaw') and not n.startswith(('eye', 'upperlid', 'lowerlid'))]
nvtx = len(Pall)
W = np.zeros((nvtx, len(names)))
for i in range(nvtx):
    tag = vtag[i]
    if tag != 'skin':
        W[i, jidx[tag]] = 1
        continue
    p = Pall[i]
    if compall[i] != body_id:
        W[i, jidx['head']] = 1; continue
    ws = np.zeros(len(names))
    for n in body_bones:
        side = 1 if n.endswith('L') else -1 if n.endswith('R') else 0
        if side and n.startswith(('clavicle', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe')):
            if side * (p[0] - CX) < -0.03: continue
        _, a, b = B[n]
        ws[jidx[n]] = 1.0 / (seg_dist(p[None], a, b)[0] + 0.006) ** 4
    ws /= ws.sum()
    if p[1] > 0.60:
        h = smooth(0.605, 0.645, p[1])
        j = (1 - smooth(0.655, 0.685, p[1])) * smooth(0.09, 0.13, p[2]) * (1 - smooth(0.075, 0.11, abs(p[0] - FX)))
        wh = np.zeros(len(names)); wh[jidx['head']] = 1 - j; wh[jidx['jaw']] = j
        ws = (1 - h) * ws + h * wh
    W[i] = ws
# keep top 4
JOINTS = np.zeros((nvtx, 4), np.uint8); WEIGHTS = np.zeros((nvtx, 4), np.float32)
for i in range(nvtx):
    top = np.argsort(-W[i])[:4]; w = W[i, top]; w = w / w.sum()
    JOINTS[i] = top; WEIGHTS[i] = w
JOINTS[WEIGHTS == 0] = 0

# ------------------------------------------------------------------ 6. glTF
buf = bytearray(); bvs = []; accs = []
def add(data, target=None, **kw):
    while len(buf) % 4: buf.append(0)
    bvs.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(data), **({'target': target} if target else {})})
    buf.extend(data)
    a = {'bufferView': len(bvs) - 1, 'byteOffset': 0, **kw}; accs.append(a); return len(accs) - 1

pos = Pall.astype('<f4')
a_pos = add(pos.tobytes(), 34962, componentType=5126, count=len(pos), type='VEC3', min=pos.min(0).tolist(), max=pos.max(0).tolist())
a_nrm = add(Nall.astype('<f4').tobytes(), 34962, componentType=5126, count=len(pos), type='VEC3')
a_uv = add(UVall.astype('<f4').tobytes(), 34962, componentType=5126, count=len(pos), type='VEC2')
a_j = add(JOINTS.tobytes(), 34962, componentType=5121, count=len(pos), type='VEC4')
a_w = add(WEIGHTS.tobytes(), 34962, componentType=5126, count=len(pos), type='VEC4')
a_i = add(Fall.astype('<u2').ravel().tobytes(), 34963, componentType=5123, count=Fall.size, type='SCALAR')
ibm = np.zeros((len(names), 4, 4), '<f4')
for n, i in jidx.items():
    m = np.eye(4); m[:3, 3] = -B[n][1]; ibm[i] = m.T          # column-major
a_ibm = add(ibm.tobytes(), None, componentType=5126, count=len(names), type='MAT4')

nodes = []
for n in names:
    par_, head, _ = B[n]
    node = {'name': n}
    t = head - (B[par_][1] if par_ else 0)
    node['translation'] = [float(x) for x in t]
    nodes.append(node)
for n in names:
    ch = [jidx[m] for m in names if B[m][0] == n]
    if ch: nodes[jidx[n]]['children'] = ch
mesh_node = len(nodes)
nodes.append({'name': 'Character', 'mesh': 0, 'skin': 0})

# animations: rotations about X, angle in degrees per bone
def anim_channels(tracks):
    ch, smp = [], []
    for bone_name, (times, degs) in tracks.items():
        ti = add(np.array(times, '<f4').tobytes(), None, componentType=5126, count=len(times), type='SCALAR', min=[min(times)], max=[max(times)])
        q = np.array([[np.sin(np.radians(a) / 2), 0, 0, np.cos(np.radians(a) / 2)] for a in degs], '<f4')
        qi = add(q.tobytes(), None, componentType=5126, count=len(q), type='VEC4')
        smp.append({'input': ti, 'output': qi, 'interpolation': 'LINEAR'})
        ch.append({'sampler': len(smp) - 1, 'target': {'node': jidx[bone_name], 'path': 'rotation'}})
    return ch, smp

anims = []
BLINK = 66
ch, sm = anim_channels({
    'upperlidR': ([0, .06, .11, .22], [0, BLINK, BLINK, 0]),
    'upperlidL': ([0, .06, .11, .22], [0, BLINK, BLINK, 0]),
    'lowerlidR': ([0, .06, .11, .22], [0, -8, -8, 0]),
    'lowerlidL': ([0, .06, .11, .22], [0, -8, -8, 0])})
anims.append({'name': 'Blink', 'channels': ch, 'samplers': sm})
ch, sm = anim_channels({'jaw': ([0, .15, .3, .45, .6], [0, 16, 3, 12, 0])})
anims.append({'name': 'Talk', 'channels': ch, 'samplers': sm})
ch, sm = anim_channels({'jaw': ([0, .25, .5], [0, 20, 0])})
anims.append({'name': 'JawOpen', 'channels': ch, 'samplers': sm})

img_bv = len(bvs)
while len(buf) % 4: buf.append(0)
bvs.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(img)}); buf.extend(img)

out = {
    'asset': {'version': '2.0', 'generator': 'build_rig.py'},
    'scene': 0, 'scenes': [{'name': 'Scene', 'nodes': [jidx['root'], mesh_node]}],
    'nodes': nodes,
    'skins': [{'name': 'Armature', 'joints': list(range(len(names))), 'inverseBindMatrices': a_ibm, 'skeleton': jidx['root']}],
    'meshes': [{'name': 'Character', 'primitives': [{'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm, 'TEXCOORD_0': a_uv, 'JOINTS_0': a_j, 'WEIGHTS_0': a_w}, 'indices': a_i, 'material': 0}]}],
    'materials': J['materials'], 'textures': J['textures'], 'samplers': J['samplers'],
    'images': [{'bufferView': img_bv, 'mimeType': 'image/jpeg', 'name': 'basecolor'}],
    'animations': anims,
    'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(buf)}],
}
js = json.dumps(out, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(buf) % 4: buf.append(0)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf)) + \
    struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(buf), 0x004E4942) + bytes(buf)
open(DST, 'wb').write(glb)
print('wrote', DST, len(glb), 'bytes;', len(names), 'bones;', nvtx, 'verts')
np.savez('/tmp/claude-0/s/rig_dbg.npz', P=Pall, F=Fall, UV=UVall, J=JOINTS, W=WEIGHTS, tag=vtag)
