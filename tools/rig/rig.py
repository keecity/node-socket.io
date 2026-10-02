"""Mesh cleanup, skeleton, skin weights and FK for the chibi basketball player."""
import numpy as np, scipy.sparse as sp, scipy.sparse.csgraph as cg, pygltflib as G, struct, json
from load import load

FPS = 30
BALL_R = 0.055
RIM = np.array([0.0, 1.35, 1.8])  # rim centre the shoot/dunk are authored against

# ---------------------------------------------------------------- mesh cleanup
P, N, U, F, IMG, MIME = load('player.glb')
_, inv = np.unique(np.round(P, 5), axis=0, return_inverse=True); inv = inv.ravel()
Fi = inv[F]; n = inv.max() + 1
A = sp.coo_matrix((np.ones(len(F) * 3), (np.r_[Fi[:, 0], Fi[:, 1], Fi[:, 2]], np.r_[Fi[:, 1], Fi[:, 2], Fi[:, 0]])), (n, n))
_, lab = cg.connected_components(A, directed=False); lab = lab[inv]
comp = {}
for c in np.unique(lab):
    m = lab == c; comp[c] = (m, P[m].min(0), P[m].max(0))
keep = np.ones(len(P), bool)
for c, (m, lo, hi) in comp.items():
    cx = (lo[0] + hi[0]) / 2
    if m.sum() > 1000 and hi[1] < 0.2:          # floating sneakers -> onto the feet, a bit chunkier
        P[m, 0] += -cx + np.sign(cx) * 0.112; P[m, 2] -= 0.02
        c0 = np.array([np.sign(cx) * 0.112, 0.0, (lo[2] + hi[2]) / 2 - 0.025])
        P[m] = c0 + (P[m] - c0) * np.array([1.08, 1.06, 1.06])
    elif 300 < m.sum() < 500 and hi[1] < 0.31:  # sock/leg: tuck the foot part inside the shoe
        k = m & (P[:, 1] < 0.17)
        t = np.clip((0.17 - P[k, 1]) / 0.06, 0, 1)[:, None]       # 0 at the ankle top, 1 below 0.11
        ctr = np.array([np.sign(cx) * 0.11, 0, 0.30])             # foot axis (pre-centring z)
        sq = 1 - 0.22 * t
        P[k, 0] = ctr[0] + (P[k, 0] - ctr[0]) * sq[:, 0]
        P[k, 2] = ctr[2] + (P[k, 2] - ctr[2]) * sq[:, 0]
        P[k, 1] = P[k, 1] + 0.012 * t[:, 0]
    elif m.sum() < 300 and (cx > 0.15 or lo[2] < 0):  # stray armband / patch / vertex
        keep[m] = False
# any sock vertex still outside a shoe gets pushed just inside the nearest shoe surface
from scipy.spatial import cKDTree
shoe_m = np.zeros(len(P), bool); sock_m = np.zeros(len(P), bool)
for c, (m, lo, hi) in comp.items():
    if m.sum() > 1000 and hi[1] < 0.2: shoe_m |= m
    elif 300 < m.sum() < 500 and hi[1] < 0.31: sock_m |= m
tree = cKDTree(P[shoe_m]); SP, SN = P[shoe_m], N[shoe_m] / np.linalg.norm(N[shoe_m], axis=1, keepdims=True)
for _ in range(3):
    idx = np.where(sock_m & (P[:, 1] < 0.15))[0]
    _, nn = tree.query(P[idx], k=6)
    q = SP[nn].mean(1); nrm = SN[nn].mean(1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    out = ((P[idx] - q) * nrm).sum(1) > -0.006
    P[idx[out]] = q[out] - nrm[out] * 0.008
remap = -np.ones(len(P), int); remap[keep] = np.arange(keep.sum())
F = F[keep[F].all(1)]; F = remap[F]; P, N, U = P[keep], N[keep], U[keep]
shoe_m, sock_m = shoe_m[keep], sock_m[keep]
P[:, 2] -= 0.33   # centre on origin, feet on y=0, facing +z

# ---------------------------------------------------------------- skeleton (measured from the mesh)
J = {  # name: (parent, head position)
 'root': (None, (0, 0, 0)),
 'hips': ('root', (0, 0.33, -0.01)),
 'spine': ('hips', (0, 0.42, -0.01)),
 'chest': ('spine', (0, 0.52, -0.015)),
 'neck': ('chest', (0, 0.645, -0.02)),
 'head': ('neck', (0, 0.685, -0.01)),
}
for s, S in ((1, 'L'), (-1, 'R')):
    J.update({
     f'shoulder.{S}': ('chest', (s * 0.05, 0.60, -0.035)),
     f'upperarm.{S}': (f'shoulder.{S}', (s * 0.15, 0.612, -0.04)),
     f'forearm.{S}': (f'upperarm.{S}', (s * 0.275, 0.613, -0.037)),
     f'hand.{S}': (f'forearm.{S}', (s * 0.345, 0.613, -0.035)),
     f'thigh.{S}': ('hips', (s * 0.068, 0.33, -0.02)),
     f'shin.{S}': (f'thigh.{S}', (s * 0.088, 0.205, -0.025)),
     f'foot.{S}': (f'shin.{S}', (s * 0.108, 0.075, -0.03)),
    })
NAMES = list(J)
IDX = {k: i for i, k in enumerate(NAMES)}
HEAD = {k: np.array(v[1], float) for k, v in J.items()}
TAIL = {'hips': HEAD['spine'], 'spine': HEAD['chest'], 'chest': HEAD['neck'], 'neck': HEAD['head'],
        'head': np.array([0, 0.89, 0.0]), 'root': np.array([0, 0.3, 0])}
for S, s in (('L', 1), ('R', -1)):
    TAIL[f'shoulder.{S}'] = HEAD[f'upperarm.{S}']; TAIL[f'upperarm.{S}'] = HEAD[f'forearm.{S}']
    TAIL[f'forearm.{S}'] = HEAD[f'hand.{S}']; TAIL[f'hand.{S}'] = np.array([s * 0.48, 0.61, -0.03])
    TAIL[f'thigh.{S}'] = HEAD[f'shin.{S}']; TAIL[f'shin.{S}'] = HEAD[f'foot.{S}']
    TAIL[f'foot.{S}'] = np.array([s * 0.115, 0.03, 0.14])

# ---------------------------------------------------------------- skin weights
# Structured weights (like hand-painted ones): spine blends by height, arms and legs by position along
# the limb with soft joints, shorts blending from hips to thighs, shoulders only near the shoulder.
def sstep(a, b, v): u = np.clip((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u)
x, y, z = P[:, 0], P[:, 1], P[:, 2]; ax = np.abs(x); side = np.where(x >= 0, 'L', 'R')
W = np.zeros((len(P), len(NAMES)))
def add(mask, bone, w): W[mask, IDX[bone]] += np.broadcast_to(w, mask.shape)[mask]

head_m = (y > 0.665) & (ax < 0.2)
arm_m = (ax > 0.115) & (y > 0.50) & ~head_m
leg_m = (y < 0.255) & ~arm_m
torso_m = ~(head_m | arm_m | leg_m)

# spine chain by height (bone centres)
cent = [('hips', 0.375), ('spine', 0.47), ('chest', 0.58), ('neck', 0.665), ('head', 0.75)]
def spine_w(yy):
    out = {k: np.zeros_like(yy) for k, _ in cent}
    for (k0, y0), (k1, y1) in zip(cent[:-1], cent[1:]):
        u = sstep(y0, y1, yy); m = (yy >= y0) & (yy < y1)
        out[k0] += np.where(m, 1 - u, 0); out[k1] += np.where(m, u, 0)
    out['hips'] += (yy < cent[0][1]); out['head'] += (yy >= cent[-1][1])
    return out
sw = spine_w(y)
# shorts: hips -> thighs toward the hem, split left/right smoothly at the crotch
thigh_share = (1 - sstep(0.27, 0.38, y)) * torso_m
left = sstep(-0.03, 0.03, x)
for k, w in sw.items():
    add(torso_m, k, w * (1 - thigh_share))
add(torso_m, 'thigh.L', thigh_share * left)
add(torso_m, 'thigh.R', thigh_share * (1 - left))
# shoulders: a soft share near the top of the shoulder only
for S, sg in (('L', 1), ('R', -1)):
    sm = (side == S)
    shw = 0.45 * sstep(0.06, 0.12, ax) * sstep(0.55, 0.61, y) * sm * torso_m
    for k in ('chest', 'neck'): W[:, IDX[k]] -= shw * W[:, IDX[k]]
    W[:, IDX[f'shoulder.{S}']] += shw * 1.0
head_n = head_m.copy()
add(head_n, 'neck', 1 - sstep(0.665, 0.70, y)); add(head_n, 'head', sstep(0.665, 0.70, y))
# arms along |x|: chest/shoulder -> upper arm (0.15) -> forearm (0.275) -> hand (0.345)
for S, sg in (('L', 1), ('R', -1)):
    m = arm_m & (side == S); t = ax
    body = 1 - sstep(0.115, 0.17, t)
    ua = sstep(0.115, 0.17, t) * (1 - sstep(0.255, 0.295, t))
    fa = sstep(0.255, 0.295, t) * (1 - sstep(0.33, 0.36, t))
    hd = sstep(0.33, 0.36, t)
    add(m, 'chest', body * 0.55); add(m, f'shoulder.{S}', body * 0.45)
    add(m, f'upperarm.{S}', ua); add(m, f'forearm.{S}', fa); add(m, f'hand.{S}', hd)
# legs along y: thigh -> shin (knee 0.205) -> foot (ankle 0.075)
for S, sg in (('L', 1), ('R', -1)):
    m = leg_m & (side == S)
    th = sstep(0.18, 0.235, y)
    ft = 1 - sstep(0.07, 0.11, y)
    sh = (1 - th) * (1 - ft)
    add(m, f'thigh.{S}', th); add(m, f'shin.{S}', sh); add(m, f'foot.{S}', ft)
W = np.clip(W, 0, None); W /= W.sum(1, keepdims=True)
# light smoothing on the welded surface
_, inv2 = np.unique(np.round(P, 5), axis=0, return_inverse=True); inv2 = inv2.ravel()
Fw = inv2[F]; nw = inv2.max() + 1
Aw = sp.coo_matrix((np.ones(len(F) * 6), (np.r_[Fw[:, 0], Fw[:, 1], Fw[:, 2], Fw[:, 1], Fw[:, 2], Fw[:, 0]],
                                          np.r_[Fw[:, 1], Fw[:, 2], Fw[:, 0], Fw[:, 0], Fw[:, 1], Fw[:, 2]])), (nw, nw)).tocsr()
Aw.data[:] = 1; deg = np.asarray(Aw.sum(1)).ravel() + 1
Ww = np.zeros((nw, len(NAMES))); np.add.at(Ww, inv2, W); Ww /= np.bincount(inv2, minlength=nw)[:, None]
for _ in range(2):
    Ww = ((Aw @ Ww) + Ww) / deg[:, None]
W = Ww[inv2]
# shoes are rigid on the foot; sock inside the shoe follows the foot too
for S in 'LR':
    m = (shoe_m | (sock_m & (y < 0.10))) & (side == S); W[m] = 0; W[m, IDX[f'foot.{S}']] = 1
top = np.argsort(-W, 1)[:, :4]; TW = np.take_along_axis(W, top, 1); TW /= TW.sum(1, keepdims=True)
JOINTS, WEIGHTS = top.astype(np.uint16), TW.astype(np.float32)

# ---------------------------------------------------------------- math
def qaxis(axis, deg):
    a = np.radians(deg) / 2; v = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
    return np.array([*(np.sin(a) * np.array(v)), np.cos(a)])
def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1*x2 + x1*w2 + y1*z2 - z1*y2, w1*y2 - x1*z2 + y1*w2 + z1*x2,
                     w1*z2 + x1*y2 - y1*x2 + z1*w2, w1*w2 - x1*x2 - y1*y2 - z1*z2])
def qmat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def matq(m):
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1) * 2; return np.array([(m[2,1]-m[1,2])/s, (m[0,2]-m[2,0])/s, (m[1,0]-m[0,1])/s, s/4])
    i = np.argmax(np.diag(m)); j, k = (i+1) % 3, (i+2) % 3
    s = np.sqrt(1 + m[i,i] - m[j,j] - m[k,k]) * 2; q = np.zeros(4)
    q[i] = s/4; q[j] = (m[j,i]+m[i,j])/s; q[k] = (m[k,i]+m[i,k])/s; q[3] = (m[k,j]-m[j,k])/s
    return q / np.linalg.norm(q)
def slerp(a, b, t):
    d = a @ b
    if d < 0: b, d = -b, -d
    if d > 0.9995: r = a + t * (b - a); return r / np.linalg.norm(r)
    th = np.arccos(d); return (np.sin((1-t)*th)*a + np.sin(t*th)*b) / np.sin(th)
def rot(*ops):  # ops applied in order, each about the parent's axes
    q = np.array([0, 0, 0, 1.0])
    for axis, deg in ops: q = qmul(qaxis(axis, deg), q)
    return q
IDQ = np.array([0, 0, 0, 1.0])
LOCAL_T = {k: HEAD[k] - (HEAD[J[k][0]] if J[k][0] else 0) for k in NAMES}

def fk(pose):
    """pose: {bone: quat, '_root': translation, '_hips': offset, '_scale': hips scale} -> world 4x4 per bone"""
    M = {}
    for k in NAMES:
        L = np.eye(4); L[:3, :3] = qmat(pose.get(k, IDQ))
        if k == 'hips' and '_scale' in pose: L[:3, :3] = L[:3, :3] @ np.diag(pose['_scale'])
        t = LOCAL_T[k].copy()
        if k == 'root': t = t + pose.get('_root', 0)
        if k == 'hips': t = t + pose.get('_hips', 0)
        L[:3, 3] = t
        M[k] = L if J[k][0] is None else M[J[k][0]] @ L
    return M
