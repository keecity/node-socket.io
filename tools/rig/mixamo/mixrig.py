"""Load the Mixamo-rigged GLB, FK, skinning (numpy)."""
import pygltflib, numpy as np
from rig import qmat, matq, qmul
g = pygltflib.GLTF2().load('rigged.glb'); BLOB = g.binary_blob()
def acc(i):
    a = g.accessors[i]; bv = g.bufferViews[a.bufferView]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a.componentType]
    c = {'VEC3': 3, 'VEC2': 2, 'VEC4': 4, 'SCALAR': 1, 'MAT4': 16}[a.type]
    r = np.frombuffer(BLOB, dt, a.count * c, bv.byteOffset + (a.byteOffset or 0))
    return (r.reshape(a.count, c) if c > 1 else r).copy()
prim = g.meshes[0].primitives[0]
P = acc(prim.attributes.POSITION); F = acc(prim.indices).reshape(-1, 3)
JI = acc(prim.attributes.JOINTS_0).astype(int); WT = acc(prim.attributes.WEIGHTS_0).astype(float)
skin = g.skins[0]; JOINTS = skin.joints; IBM = acc(skin.inverseBindMatrices).reshape(-1, 4, 4).transpose(0, 2, 1)
NODES = g.nodes; NAME = {i: n.name.replace('mixamorig:', '') for i, n in enumerate(NODES)}; ID = {v: k for k, v in NAME.items()}
PARENT = {}
for i, n in enumerate(NODES):
    for c in (n.children or []): PARENT[c] = i
def trs(n):
    t = np.array(n.translation or [0, 0, 0], float); q = np.array(n.rotation or [0, 0, 0, 1], float); s = np.array(n.scale or [1, 1, 1], float)
    return t, q, s
REST = {i: trs(n) for i, n in enumerate(NODES)}
def mat(t, q, s): M = np.eye(4); M[:3, :3] = qmat(q) @ np.diag(s); M[:3, 3] = t; return M
ORDER = []
def _walk(i):
    ORDER.append(i)
    for c in (NODES[i].children or []): _walk(c)
for i in range(len(NODES)):
    if i not in PARENT: _walk(i)
def fk(local_q=None, hips_t=None):
    """local_q: {bone name: local quaternion}; hips_t: hips translation override. returns world 4x4 per node index"""
    local_q = local_q or {}; W = {}
    for i in ORDER:
        t, q, s = REST[i]; nm = NAME[i]
        if nm in local_q: q = local_q[nm]
        if nm == 'Hips' and hips_t is not None: t = hips_t
        L = mat(t, q, s); W[i] = W[PARENT[i]] @ L if i in PARENT else L
    return W
def skinned(W):
    S = np.stack([W[j] @ IBM[k] for k, j in enumerate(JOINTS)])
    Ph = np.c_[P, np.ones(len(P))]; out = np.zeros((len(P), 3))
    for k in range(4): out += WT[:, k:k+1] * np.einsum('nij,nj->ni', S[JI[:, k]], Ph)[:, :3]
    return out
def jpos(W, name): return W[ID[name]][:3, 3]
