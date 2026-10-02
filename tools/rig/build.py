"""Rig + animate the chibi basketball player. Outputs player_rigged.glb."""
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
    if m.sum() > 1000 and hi[1] < 0.2:          # floating sneakers -> onto the feet
        P[m, 0] += -cx + np.sign(cx) * 0.109; P[m, 2] -= 0.02
    elif m.sum() < 300 and (cx > 0.15 or lo[2] < 0):  # stray armband / patch / vertex
        keep[m] = False
remap = -np.ones(len(P), int); remap[keep] = np.arange(keep.sum())
F = F[keep[F].all(1)]; F = remap[F]; P, N, U = P[keep], N[keep], U[keep]
P[:, 0] -= 0.0; P[:, 2] -= 0.33   # centre on origin, feet on y=0, facing +z
lab = lab[keep]

# ---------------------------------------------------------------- skeleton
Z = -0.02
J = {  # name: (parent, head position)
 'root': (None, (0, 0, 0)),
 'hips': ('root', (0, 0.30, 0)),
 'spine': ('hips', (0, 0.40, 0)),
 'chest': ('spine', (0, 0.50, 0)),
 'neck': ('chest', (0, 0.62, 0)),
 'head': ('neck', (0, 0.66, 0)),
}
for s, S in ((1, 'L'), (-1, 'R')):
    J.update({
     f'shoulder.{S}': ('chest', (s * 0.06, 0.60, Z)),
     f'upperarm.{S}': (f'shoulder.{S}', (s * 0.17, 0.61, Z)),
     f'forearm.{S}': (f'upperarm.{S}', (s * 0.30, 0.61, Z)),
     f'hand.{S}': (f'forearm.{S}', (s * 0.41, 0.61, Z)),
     f'thigh.{S}': ('hips', (s * 0.09, 0.28, Z)),
     f'shin.{S}': (f'thigh.{S}', (s * 0.10, 0.15, Z)),
     f'foot.{S}': (f'shin.{S}', (s * 0.105, 0.045, Z)),
    })
NAMES = list(J)
IDX = {k: i for i, k in enumerate(NAMES)}
HEAD = {k: np.array(v[1], float) for k, v in J.items()}
TAIL = {'hips': HEAD['spine'], 'spine': HEAD['chest'], 'chest': HEAD['neck'], 'neck': HEAD['head'],
        'head': np.array([0, 0.89, 0.0]), 'root': np.array([0, 0.3, 0])}
for S, s in (('L', 1), ('R', -1)):
    TAIL[f'shoulder.{S}'] = HEAD[f'upperarm.{S}']; TAIL[f'upperarm.{S}'] = HEAD[f'forearm.{S}']
    TAIL[f'forearm.{S}'] = HEAD[f'hand.{S}']; TAIL[f'hand.{S}'] = np.array([s * 0.49, 0.61, Z])
    TAIL[f'thigh.{S}'] = HEAD[f'shin.{S}']; TAIL[f'shin.{S}'] = HEAD[f'foot.{S}']
    TAIL[f'foot.{S}'] = np.array([s * 0.105, 0.02, 0.13])

# ---------------------------------------------------------------- skin weights
def segdist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
x, y = P[:, 0], P[:, 1]; ax = np.abs(x); side = np.where(x >= 0, 'L', 'R')
D = np.full((len(P), len(NAMES)), np.inf)
for k in NAMES:
    if k == 'root': continue
    D[:, IDX[k]] = segdist(P, HEAD[k], TAIL[k])
allow = np.zeros_like(D, bool)
def ok(mask, bones):
    for b in bones: allow[mask, IDX[b]] = True
for S in 'LR':
    sm = side == S
    arm = sm & (ax > 0.15) & (y > 0.5)
    leg = sm & (y < 0.29) & (ax < 0.25)
    ok(arm, [f'shoulder.{S}', f'upperarm.{S}', f'forearm.{S}', f'hand.{S}'])
    ok(arm & (ax < 0.2), ['chest'])
    ok(leg, [f'thigh.{S}', f'shin.{S}', f'foot.{S}'])
    ok(leg & (y > 0.22), ['hips'])
    torso = sm & ~arm & ~leg
    ok(torso, ['hips', 'spine', 'chest', 'neck', 'head', f'shoulder.{S}'])
    ok(torso & (y < 0.31), [f'thigh.{S}'])
head = (y > 0.66) & (ax < 0.2); allow[head] = False; ok(head, ['head'])
W = np.where(allow, 1 / (D + 0.01) ** 4, 0)
W /= W.sum(1, keepdims=True)
# laplacian smoothing on the welded graph
_, inv2 = np.unique(np.round(P, 5), axis=0, return_inverse=True); inv2 = inv2.ravel()
Fw = inv2[F]; nw = inv2.max() + 1
Aw = sp.coo_matrix((np.ones(len(F) * 6), (np.r_[Fw[:, 0], Fw[:, 1], Fw[:, 2], Fw[:, 1], Fw[:, 2], Fw[:, 0]],
                                          np.r_[Fw[:, 1], Fw[:, 2], Fw[:, 0], Fw[:, 0], Fw[:, 1], Fw[:, 2]])), (nw, nw)).tocsr()
Aw.data[:] = 1; deg = np.asarray(Aw.sum(1)).ravel() + 1
Ww = np.zeros((nw, len(NAMES))); np.add.at(Ww, inv2, W); cnt = np.bincount(inv2, minlength=nw)[:, None]; Ww /= cnt
alw = np.zeros((nw, len(NAMES)), bool); np.logical_or.at(alw, inv2, allow)
for _ in range(4):
    Ww = ((Aw @ Ww) + Ww) / deg[:, None]; Ww *= alw; Ww /= Ww.sum(1, keepdims=True)
W = Ww[inv2]
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
def slerp(a, b, t):
    d = a @ b
    if d < 0: b, d = -b, -d
    if d > 0.9995: r = a + t * (b - a); return r / np.linalg.norm(r)
    th = np.arccos(d); return (np.sin((1-t)*th)*a + np.sin(t*th)*b) / np.sin(th)
def rot(*ops):  # ops applied in order, each in the parent frame
    q = np.array([0, 0, 0, 1.0])
    for axis, deg in ops: q = qmul(qaxis(axis, deg), q)
    return q
LOCAL_T = {k: HEAD[k] - (HEAD[J[k][0]] if J[k][0] else 0) for k in NAMES}

def fk(pose):
    """pose: {bone: quat, '_root': translation, '_hips': offset} -> world 4x4 per bone"""
    M = {}
    for k in NAMES:
        L = np.eye(4); L[:3, :3] = qmat(pose.get(k, np.array([0, 0, 0, 1.0])))
        t = LOCAL_T[k].copy()
        if k == 'root': t = t + pose.get('_root', 0)
        if k == 'hips': t = t + pose.get('_hips', 0)
        L[:3, 3] = t
        M[k] = L if J[k][0] is None else M[J[k][0]] @ L
    return M
def palm(M, S, fwd=0.0):
    s = 1 if S == 'L' else -1
    return (M[f'hand.{S}'] @ np.array([s * 0.045, -0.05, fwd, 1]))[:3]

# ---------------------------------------------------------------- pose library
def arm(S, down=0, fwd=0, elbow=0, wrist=0, twist=0, up=None):
    """down: lower from T-pose; fwd: swing forward about x; elbow bends forearm 'forward'."""
    s = 1 if S == 'L' else -1
    ua = rot(('x', s * twist), ('z', -s * down), ('x', -fwd))
    return {f'upperarm.{S}': ua, f'forearm.{S}': rot(('y', -s * elbow)), f'hand.{S}': rot(('y', -s * wrist))}
def leg(S, hip=0, knee=0, ankle=0, spread=0):
    s = 1 if S == 'L' else -1
    return {f'thigh.{S}': rot(('z', s * spread), ('x', -hip)), f'shin.{S}': rot(('x', knee)), f'foot.{S}': rot(('x', -ankle))}
def body(lean=0, chest=0, head=0, twist=0, hips=0, hy=0.0, root=(0, 0, 0), side=0):
    return {'hips': rot(('y', twist / 2), ('x', hips)), 'spine': rot(('x', lean), ('z', side)), 'chest': rot(('y', twist / 2), ('x', chest)),
            'head': rot(('x', head)), '_hips': np.array([0, hy, 0.0]), '_root': np.array(root, float)}
def pose(*parts):
    d = {}
    for p in parts: d.update(p)
    return d
def crouch(depth):  # depth 0..1  -> knee bend with feet planted
    k = 70 * depth
    return pose(leg('L', hip=k * 0.55, knee=k, ankle=k * 0.45, spread=4), leg('R', hip=k * 0.55, knee=k, ankle=k * 0.45, spread=4))

def drop_for(depth):  # hips height change for crouch depth
    th = np.radians(70 * depth); return -(0.13 * (1 - np.cos(th * 0.55)) + 0.105 * (1 - np.cos(th * 0.45))) - 0.01 * depth

def ease(t): return t * t * (3 - 2 * t)

def sample(keys, dur, extra=None):
    """keys: [(time, pose, ease?)] -> list of poses per frame"""
    frames = []
    nf = int(round(dur * FPS)) + 1
    for f in range(nf):
        t = f / FPS
        i = max(j for j in range(len(keys)) if keys[j][0] <= t + 1e-9)
        if i == len(keys) - 1: a = b = keys[i]; u = 0
        else: a, b = keys[i], keys[i + 1]; u = (t - a[0]) / (b[0] - a[0]); u = ease(u) if (len(b) < 3 or b[2]) else u
        p = {}
        for k in NAMES:
            qa = a[1].get(k, np.array([0, 0, 0, 1.0])); qb = b[1].get(k, np.array([0, 0, 0, 1.0])); p[k] = slerp(qa, qb, u)
        for k in ('_hips', '_root'):
            va = a[1].get(k, np.zeros(3)); vb = b[1].get(k, np.zeros(3)); p[k] = va + (vb - va) * u
        frames.append(p)
    return frames

REST = pose(body(), arm('L', down=72, elbow=12, fwd=5), arm('R', down=72, elbow=12, fwd=5), crouch(0.08), {'_hips': np.array([0, drop_for(0.08), 0])})

# ---------------------------------------------------------------- clips
CLIPS = {}

def idle():
    dur = 2.0
    def k(b):
        return pose(body(chest=-2 + 3 * b, head=2 - 3 * b, hy=drop_for(0.1) - 0.006 * b, side=1.5 * b),
                    crouch(0.1), arm('L', down=74 + 3 * b, fwd=5, elbow=14 + 4 * b),
                    arm('R', down=58 + 2 * b, fwd=18, elbow=55, wrist=10))
    fr = sample([(0, k(0)), (1.0, k(1)), (2.0, k(0))], dur)
    balls = [palm(fk(p), 'R', 0.02) + np.array([-0.02, 0, 0.02]) for p in fr]
    return fr, balls, [np.zeros(3) for _ in fr]

def dribble():
    dur = 0.8; per = 0.4
    def k(push, bob):  # push 0 = hand high, 1 = hand pushed down
        return pose(body(lean=20, chest=6, head=-20, hy=drop_for(0.6) - 0.012 * bob, twist=-8),
                    crouch(0.6), leg("L", hip=0.6*70*0.55+14, knee=0.6*70+5, ankle=0.6*70*0.45-5),
                    arm('R', down=62 + 14 * push, fwd=28 - 6 * push, elbow=55 - 35 * push, wrist=-20 + 45 * push),
                    arm('L', down=50, fwd=38, elbow=45, twist=0))
    fr = sample([(0, k(0, 0)), (0.12, k(1, 1)), (0.28, k(0.15, 0.3)), (0.4, k(0, 0)), (0.52, k(1, 1)), (0.68, k(0.15, 0.3)), (0.8, k(0, 0))], dur)
    hand = [palm(fk(p), 'R') + np.array([0, -BALL_R * 0.9, 0]) for p in fr]
    balls = []
    for f, p in enumerate(fr):
        t = (f / FPS) % per
        floor = np.array([hand[0][0] - 0.01, BALL_R, hand[0][2] + 0.06])
        rel, hit, catch = 0.10, 0.19, 0.36
        if t <= rel or t >= catch: b = hand[f]
        elif t < hit:
            u = (t - rel) / (hit - rel); r0 = hand[int(rel * FPS)]; b = r0 + (floor - r0) * (u * u * 0.5 + u * 0.5)
        else:
            u = (t - hit) / (catch - hit); c1 = hand[int(catch * FPS)]; e = 1 - (1 - u) ** 2; b = floor + (c1 - floor) * e
        balls.append(b)
    spin = [np.array([-1440 * f / FPS / dur * dur, 0, 0]) for f in range(len(fr))]
    return fr, balls, [np.zeros(3) for _ in fr]

def shoot():
    dur = 2.0
    set_ = lambda: pose(arm('R', down=90, fwd=105, elbow=115, wrist=-35), arm('L', down=90, fwd=70, elbow=80, twist=20))
    keys = [
        (0.0, pose(REST, arm('R', down=58, fwd=18, elbow=55, wrist=10), body(hy=drop_for(0.1)), crouch(0.1))),
        (0.30, pose(body(lean=12, head=-8, hy=drop_for(0.55)), crouch(0.55), set_())),
        (0.50, pose(body(lean=2, head=-12, hy=0.02), leg('L', hip=5, knee=10, ankle=-20), leg('R', hip=5, knee=10, ankle=-20),
                    arm('R', down=90, fwd=140, elbow=60, wrist=-30), arm('L', down=90, fwd=110, elbow=70, twist=20))),
        (0.66, pose(body(lean=-2, head=-16, hy=0.13), leg('L', hip=10, knee=25, ankle=-25), leg('R', hip=4, knee=12, ankle=-30),
                    arm('R', down=90, fwd=165, elbow=5, wrist=55), arm('L', down=90, fwd=135, elbow=40, twist=20)), False),
        (0.85, pose(body(lean=0, head=-14, hy=0.10), leg('L', hip=12, knee=28, ankle=-20), leg('R', hip=6, knee=16, ankle=-25),
                    arm('R', down=90, fwd=162, elbow=5, wrist=75), arm('L', down=85, fwd=120, elbow=40, twist=20))),
        (1.05, pose(body(lean=8, head=-10, hy=drop_for(0.45)), crouch(0.45), arm('R', down=90, fwd=150, elbow=8, wrist=70), arm('L', down=80, fwd=80, elbow=40))),
        (1.45, pose(body(lean=3, head=-8, hy=drop_for(0.15)), crouch(0.15), arm('R', down=90, fwd=120, elbow=15, wrist=60), arm('L', down=74, fwd=10, elbow=20))),
        (2.0, REST),
    ]
    fr = sample(keys, dur)
    rel_f = int(0.66 * FPS)
    hand = [palm(fk(p), 'R', 0.0) + np.array([0, 0.035, 0.02]) for p in fr]
    p0 = hand[rel_f]; T = 0.62; g = np.array([0, -6.0, 0]); tgt = RIM + np.array([0, 0.02, -0.02])
    v0 = (tgt - p0 - 0.5 * g * T * T) / T
    balls = []
    for f in range(len(fr)):
        t = f / FPS
        if f <= rel_f: balls.append(hand[f]); continue
        dt = t - 0.66
        if dt <= T: balls.append(p0 + v0 * dt + 0.5 * g * dt * dt); continue
        # through the net, drop and bounce
        d2 = dt - T; vy = 0.0
        y_ = tgt[1] - 0.5 * 6 * d2 * d2 - 0.4 * d2
        if y_ > BALL_R: balls.append(np.array([tgt[0], y_, tgt[2] - 0.03 * d2])); continue
        tl = (-0.4 + np.sqrt(0.16 + 12 * (tgt[1] - BALL_R))) / 6; d3 = d2 - tl; vb = 0.35 * (0.4 + 6 * tl)
        balls.append(np.array([tgt[0], max(BALL_R, BALL_R + vb * d3 - 3 * d3 * d3), tgt[2] - 0.03 * d2]))
    return fr, balls, None

def dunk():
    dur = 2.4
    R0 = np.zeros(3)
    def stride(S_fwd, z, hy=0.0, lean=10):
        o = 'R' if S_fwd == 'L' else 'L'
        return pose(body(lean=lean, head=-lean, hy=drop_for(0.25) + hy, root=(0, 0, z)), leg(S_fwd, hip=40, knee=35, ankle=5), leg(o, hip=-20, knee=30, ankle=-15),
                    arm('R', down=60, fwd=22, elbow=60, wrist=10), arm(o == 'L' and 'L' or 'L', down=70, fwd=-25 if S_fwd == 'R' else 30, elbow=30))
    hang_z = 1.66
    keys = [
        (0.0, pose(REST, arm('R', down=58, fwd=18, elbow=55, wrist=10), body(hy=drop_for(0.1)), crouch(0.1))),
        (0.22, stride('L', 0.18, 0.02)),
        (0.44, stride('R', 0.46, 0.02)),
        (0.66, pose(body(lean=22, head=-20, hy=drop_for(0.7), root=(0, 0, 0.72)), crouch(0.7),
                    arm('R', down=80, fwd=-10, elbow=40, wrist=10), arm('L', down=80, fwd=-20, elbow=30))),
        (0.95, pose(body(lean=-6, head=-25, hy=0.45, root=(0, 0, 1.25)), leg('L', hip=60, knee=90, ankle=0), leg('R', hip=-10, knee=40, ankle=-30),
                    arm('R', down=-60, fwd=10, elbow=40, wrist=-30), arm('L', down=30, fwd=60, elbow=30))),
        (1.12, pose(body(lean=-14, head=-30, hy=0.62, root=(0, 0, 1.52)), leg('L', hip=50, knee=95, ankle=0), leg('R', hip=-20, knee=70, ankle=-30),
                    arm('R', down=-85, fwd=-25, elbow=35, wrist=-40), arm('L', down=40, fwd=50, elbow=30)), False),
        (1.24, pose(body(lean=12, head=-5, hy=0.60, root=(0, 0, hang_z)), leg('L', hip=30, knee=60, ankle=-10), leg('R', hip=10, knee=50, ankle=-20),
                    arm('R', down=-90, fwd=40, elbow=10, wrist=40), arm('L', down=0, fwd=90, elbow=10))),
        (1.55, pose(body(lean=-4, head=5, hy=0.57, root=(0, 0, hang_z)), leg('L', hip=15, knee=35, ankle=-30), leg('R', hip=20, knee=45, ankle=-30),
                    arm('R', down=-90, fwd=20, elbow=8, wrist=30), arm('L', down=-80, fwd=20, elbow=10))),
        (1.80, pose(body(lean=16, head=-10, hy=drop_for(0.8), root=(0, 0, hang_z - 0.08)), crouch(0.8), arm('R', down=70, fwd=50, elbow=30), arm('L', down=70, fwd=50, elbow=30)), False),
        (2.4, pose(REST, body(hy=drop_for(0.08), root=(0, 0, hang_z - 0.08)))),
    ]
    fr = sample(keys, dur)
    hand = [palm(fk(p), 'R', 0.0) + np.array([0, -0.01, 0.03]) for p in fr]
    rel = 1.2; rel_f = int(rel * FPS)
    balls = []
    for f in range(len(fr)):
        t = f / FPS
        if f <= rel_f: balls.append(hand[f]); continue
        p0 = hand[rel_f]; d = t - rel
        y_ = p0[1] - 1.8 * d - 4.5 * d * d
        if y_ > BALL_R:
            xz = RIM + (p0 - RIM) * np.exp(-12 * d); balls.append(np.array([xz[0], y_, xz[2] + 0.12 * d])); continue
        tl = (-1.8 + np.sqrt(3.24 + 18 * (p0[1] - BALL_R))) / 9; d3 = d - tl; vb = 0.4 * (1.8 + 9 * tl)
        yy = BALL_R + abs(vb * d3 - 4.5 * d3 * d3) if d3 < 2 * vb / 9 else BALL_R + max(0, 0.3 * vb * (d3 - 2 * vb / 9) - 4.5 * (d3 - 2 * vb / 9) ** 2)
        balls.append(np.array([RIM[0], yy, RIM[2] + 0.12 * d]))
    return fr, balls, None

CLIPS = {'Idle': idle(), 'Dribble': dribble(), 'Shoot': shoot(), 'Dunk': dunk()}
