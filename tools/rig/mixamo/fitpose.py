"""Per-frame pose fitting: render the model's colour classes from the side and match the video frame."""
import numpy as np, cv2, json, io, time
from PIL import Image
import mixrig as M
from retarget import child_dir, qbetween, SAG, img2w
from rig import qmat, matq
from seg import classify_rgb
DS = 4                                                     # work at quarter resolution
# --- model vertex classes from the texture
img = M.g.images[0]; bv = M.g.bufferViews[img.bufferView]
TEX = np.array(Image.open(io.BytesIO(M.BLOB[bv.byteOffset:bv.byteOffset + bv.byteLength])).convert('RGB'))
UV = M.acc(M.prim.attributes.TEXCOORD_0)
def texsample(uv):
    x = np.clip((uv[:, 0] % 1) * TEX.shape[1], 0, TEX.shape[1] - 1).astype(int); y = np.clip((uv[:, 1] % 1) * TEX.shape[0], 0, TEX.shape[0] - 1).astype(int)
    return TEX[y, x]
def merge(c): c = c.copy(); c[c == 2] = 1; c[c == 6] = 0; return c       # skin+ball -> orange; white ignored
VC = merge(classify_rgb(texsample(UV)))
# triangle centroids add coverage
TC = merge(classify_rgb(texsample(UV[M.F].mean(1))))
CLS_W = np.array([0, 1.0, 1.4, 1.6, 2.0])                  # rarer, more telling colours count more
# --- video frames
cap = cv2.VideoCapture('ref/run_dribble2.mp4'); FR = []
while True:
    ok, f = cap.read()
    if not ok: break
    FR.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
BALL = json.load(open('ball.json'))
H, W = FR[0].shape[:2]; h, w = H // DS, W // DS
def video_classes(k):
    c = merge(classify_rgb(FR[k].reshape(-1, 3))).reshape(H, W)
    b = BALL[k]; ign = np.zeros((H, W), bool)
    if b[1] is not None:
        yy, xx = np.mgrid[0:H, 0:W]; ign = (xx - b[1]) ** 2 + (yy - b[2]) ** 2 < (b[3] * 1.05) ** 2
    c[ign] = -1
    c[int(H * 0.86):] = np.where(c[int(H * 0.86):] == 0, -1, c[int(H * 0.86):])   # reflections on the floor
    small = c[::DS, ::DS][:h, :w]; return small
# --- pose from parameters (degrees). limb angles measured from straight down, + = forward
PN = ['tx', 'hy', 'lean', 'neck', 'head', 'thR', 'shR', 'ftR', 'thL', 'shL', 'ftL', 'uaR', 'abR', 'faR', 'hdR', 'uaL', 'faL']
REST = M.fk()
def pose_from(p):
    d = dict(zip(PN, p)); t = {}
    lean = np.radians(d['lean']); td = np.array([0, np.cos(lean), np.sin(lean)])
    for b in ('Spine', 'Spine1', 'Spine2'): t[b] = td
    nk = np.radians(d['neck']); t['Neck'] = np.array([0, np.cos(nk), np.sin(nk)])
    hd = np.radians(d['head']); t['Head'] = np.array([0, np.cos(hd), np.sin(hd)])
    t['RightUpLeg'] = SAG(np.radians(d['thR']), -0.05); t['RightLeg'] = SAG(np.radians(d['shR']), -0.03)
    t['LeftUpLeg'] = SAG(np.radians(d['thL']), 0.05); t['LeftLeg'] = SAG(np.radians(d['shL']), 0.03)
    t['RightArm'] = SAG(np.radians(d['uaR']), -np.sin(np.radians(d['abR']))); t['RightForeArm'] = SAG(np.radians(d['faR']), -0.15)
    t['RightHand'] = SAG(np.radians(d['hdR']), -0.05)
    uaL = float(np.clip(-0.4 * (d['thL'] - d['thR']) + 5, -28, 24))          # hidden in the video: swings opposite the left leg (capped)
    t['LeftArm'] = SAG(np.radians(uaL), 0.12); t['LeftForeArm'] = SAG(np.radians(min(uaL + 80, 85)), 0.05)   # ~80 deg elbow, hand stays below the chest
    foot = {'Left': np.radians(d['ftL']), 'Right': np.radians(d['ftR'])}
    local = {}; Wd = {}
    for i in M.ORDER:
        tr, q, s = M.REST[i]; nm = M.NAME[i]
        Wp = Wd[M.PARENT[i]] if i in M.PARENT else np.eye(4)
        if nm == 'Hips': tr = tr + np.array([0, d['hy'], 0])
        Wc = Wp @ M.mat(tr, q, s); aim = t.get(nm)
        if nm in ('LeftFoot', 'RightFoot'):
            pitch = foot[nm[:-4]]; rd = REST[M.ID[nm.replace('Foot', 'ToeBase')]][:3, 3] - REST[i][:3, 3]; rd /= np.linalg.norm(rd)
            c, s_ = np.cos(pitch), np.sin(pitch); aim = np.array([rd[0], rd[1] * c + rd[2] * s_, -rd[1] * s_ + rd[2] * c])
        if aim is not None and nm in ('LeftArm', 'RightArm'):
            sg = 1 if nm.startswith('Left') else -1; L = np.linalg.norm(M.REST[M.NODES[i].children[0]][0]); sp = Wd[M.ID['Spine2']][:3, 3]
            a = aim / np.linalg.norm(aim)
            for _ in range(12):                                    # elbow clears the chest
                if sg * (Wc[0, 3] + a[0] * L - sp[0]) >= 0.125: break
                a = a + np.array([sg * 0.12, 0, 0]); a /= np.linalg.norm(a)
            aim = a
        if aim is not None and nm in ('LeftForeArm', 'RightForeArm'):
            # a real elbow: the forearm folds forward from the upper arm (5-140 deg), elbow pointing back and out
            sg = 1 if nm.startswith('Left') else -1
            a1 = Wp[:3, :3] @ child_dir(M.NAME[M.PARENT[i]]); a1 /= np.linalg.norm(a1)
            pole = np.array([sg * 0.35, 0.0, -1.0]); f = -(pole - (pole @ a1) * a1); f /= np.linalg.norm(f)
            a2 = aim / np.linalg.norm(aim); phi = np.arccos(np.clip(a2 @ a1, -1, 1))
            phi = np.clip(phi if (a2 @ f) >= 0 else 0.1, np.radians(5), np.radians(140))
            aim = np.cos(phi) * a1 + np.sin(phi) * f
            L = np.linalg.norm(M.REST[M.NODES[i].children[0]][0]); sp = Wd[M.ID['Spine2']][:3, 3]
            for _ in range(10):                                    # wrist clears the body too
                if sg * (Wc[0, 3] + aim[0] * L - sp[0]) >= 0.13: break
                aim = aim + np.array([sg * 0.1, 0, 0]); aim /= np.linalg.norm(aim)
        if aim is not None and nm in ('LeftHand', 'RightHand'):
            fa = Wp[:3, :3] @ child_dir(M.NAME[M.PARENT[i]]); fa /= np.linalg.norm(fa); a = aim / np.linalg.norm(aim)
            ang = np.arccos(np.clip(a @ fa, -1, 1))
            if ang > np.radians(70):                               # wrist bends at most ~70 deg
                perp = a - (a @ fa) * fa; perp /= np.linalg.norm(perp) + 1e-9; aim = np.cos(np.radians(70)) * fa + np.sin(np.radians(70)) * perp
        if aim is not None:
            cur = Wc[:3, :3] @ child_dir(nm); Rn = qmat(qbetween(cur, aim)) @ Wc[:3, :3]
            Ln = Wp[:3, :3].T @ Rn; local[nm] = matq(Ln); Wc = Wp @ M.mat(tr, local[nm], s)
        Wd[i] = Wc
    return local, Wd
def points(Wd):
    V = M.skinned(Wd); C = V[M.F].mean(1); return np.r_[V, C], np.r_[VC, TC]
SC_PX = None
def render(p, sc):
    _, Wd = pose_from(p); X, cl = points(Wd)
    # side camera: forward (+z) -> screen right, up -> screen up, near side (-x) in front
    u = ((p[0] + X[:, 2] * sc) / DS).astype(int); v = ((419.3 - X[:, 1] * sc) / DS).astype(int); depth = X[:, 0]
    ok = (u >= 0) & (u < w) & (v >= 0) & (v < h) & (cl > 0)
    img = np.zeros((h, w), int); zb = np.full((h, w), 1e9)
    o = np.argsort(-depth[ok])                               # far first, near overwrites
    uu, vv, cc = u[ok][o], v[ok][o], cl[ok][o]
    for du in (0, 1):
        for dv in (0, 1): img[np.clip(vv + dv, 0, h - 1), np.clip(uu + du, 0, w - 1)] = cc
    return img
def score(p, sc, target):
    r = render(p, sc); valid = target >= 0
    fg_t = (target > 0) & valid; fg_r = (r > 0) & valid
    inter = ((r == target) & fg_t).astype(float); wt = CLS_W[np.clip(target, 0, 4)]
    union = (fg_t | fg_r)
    iou = (inter * wt).sum() / ((union * np.maximum(wt, CLS_W[np.clip(r, 0, 4)])).sum() + 1e-9)
    d = dict(zip(PN, p))   # posture prior: the big head lets the silhouette hide a hunch, so keep the spine/head near upright
    return iou - 0.03 * ((d['lean'] - 18) / 20) ** 2 - 0.02 * ((d['neck'] - d['lean']) / 25) ** 2 - 0.02 * ((d['head'] - 5) / 20) ** 2
STEPS = {'tx': 12, 'hy': 0.03, 'lean': 8, 'neck': 8, 'head': 8}
def fit(p0, sc, target, iters=6):
    p = np.array(p0, float); best = score(p, sc, target); step = np.array([STEPS.get(n, 14.0) for n in PN])
    for it in range(iters):
        improved = True
        while improved:
            improved = False
            for i in range(len(PN)):
                for sgn in (1, -1):
                    q = p.copy(); q[i] += sgn * step[i]; s = score(q, sc, target)
                    if s > best + 1e-5: p, best, improved = q, s, True; break
        step *= 0.5
    return p, best
