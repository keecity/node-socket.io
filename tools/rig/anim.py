"""Control-rig animation system: keyframed controls -> IK -> per-frame bone poses."""
import numpy as np
from rig import *

FPS = 30
BALL_R = 0.07
RIM = np.array([0.0, 1.35, 1.8])      # rim centre the shoot/dunk are authored against
RIM_R = 0.14
ANKLE_H = HEAD['foot.L'][1]
TOE = np.array([0, -ANKLE_H, 0.075])    # toe pivot, foot-local
HEEL = np.array([0, -ANKLE_H, -0.06])   # heel pivot, foot-local

def arc(a, b):
    a, b = nrm(a), nrm(b); v = np.cross(a, b); c = a @ b
    if c < -0.9999:
        ax_ = perp(np.array([0, 0, 1.0]), a) if abs(a[2]) < 0.9 else perp(np.array([1, 0, 0.]), a)
        return 2 * np.outer(ax_, ax_) - np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)
def sstep_(a, b, v): u = min(max((v - a) / (b - a), 0), 1); return u * u * (3 - 2 * u)
def nrm(v): v = np.asarray(v, float); return v / (np.linalg.norm(v) + 1e-12)
def perp(v, axis): return nrm(v - (v @ axis) * axis)
def R3(*ops): return qmat(rot(*ops))
def euler(e):  # (pitch, yaw, roll) degrees; pitch + = lean forward / toe down
    return rot(('x', e[0]), ('z', e[2]), ('y', e[1]))

# ---------------------------------------------------------------- control defaults
def default_controls():
    c = {
        'root': [0, 0, 0], 'hips': [0, 0, 0], 'hipsR': [0, 0, 0], 'spineR': [0, 0, 0], 'chestR': [0, 0, 0],
        'neckR': [0, 0, 0], 'headR': [0, 0, 0],
        'ball': [0, 0.0, 0.16],   # chest-local, used while bw == 0
        'bw': [0],               # 0 = ball held in chest space, 1 = ball on its world path
    }
    for S, s in (('L', 1), ('R', -1)):
        c.update({
            f'hp{S}': [s * 0.19, -0.13, 0.0],   # free hand palm target (chest space or world, see hsp)
            f'hn{S}': [-s, 0, 0.15],             # free palm normal
            f'hf{S}': [0, -1, 0.2],              # finger direction
            f'he{S}': [s * 0.5, 0, -1],          # elbow pole
            f'hsp{S}': [0],                      # 0 chest space, 1 world space
            f'hg{S}': [-s, 0, 0],                # grip: direction from ball centre to palm (chest space)
            f'hw{S}': [0],                       # ball contact weight
            f'sh{S}': [0, 0, 0],                 # shoulder (clavicle) euler
            f'f{S}': [s * 0.11, 0, 0],           # foot: world x, lift, world z
            f'fr{S}': [0, s * 8],                # foot pitch (+ heel up on toe), yaw
            f'frel{S}': [0],                     # 0 world space, 1 follows hips
            f'fh{S}': [s * 0.075, -0.25, 0.02],   # ankle offset from hips joint when frel = 1
            f'fk{S}': [s * 0.15, 0, 1],          # knee pole
        })
    return {k: np.array(v, float) for k, v in c.items()}

# ---------------------------------------------------------------- curves
def build_track(keys, loop=False):
    """keys: [(t, {ctrl: value}, flags)] flags in {'stop', 'lin'}. Every control has its own keyframes:
    a key only affects the controls it names; others interpolate between their own neighbours."""
    defaults = default_controls()
    chans = {n: [] for n in defaults}
    t_first = keys[0][0]
    for k in keys:
        t, d = k[0], k[1]; fl = k[2] if len(k) > 2 else ''
        for n, v in d.items(): chans[n].append((t, np.array(v, float), fl))
    for n in chans:
        if not chans[n] or chans[n][0][0] > t_first: chans[n].insert(0, (t_first, defaults[n].copy(), ''))
    tr = {'chans': chans, 'loop': loop, 't0': t_first, 't1': keys[-1][0]}
    # hand orientation as a quaternion channel, keyed wherever any hand-orientation control is keyed
    for S, sg in (('L', 1), ('R', -1)):
        ts = sorted({t for n in (f'hn{S}', f'hf{S}', f'hg{S}', f'hw{S}') for (t, _, _) in chans[n]})
        qk = []; prev = None
        for t in ts:
            n_ = nrm(eval_chan(tr, f'hn{S}', t)); f_ = eval_chan(tr, f'hf{S}', t)
            if eval_chan(tr, f'hw{S}', t)[0] > 0.5: n_ = -nrm(eval_chan(tr, f'hg{S}', t))
            if abs(nrm(f_) @ n_) > 0.7: print(f'WARN key t={t} hand {S}: palm normal {np.round(n_,2)} ~ parallel to fingers {np.round(nrm(f_),2)}')
            if np.linalg.norm(f_ - (f_ @ n_) * n_) < 0.2 * np.linalg.norm(f_): f_ = f_ + np.array([0, 0, 1.0]) - n_[2] * n_
            Q = matq(frame_from(np.array([sg, 0, 0.]), np.array([0, -1, 0.]), perp(f_, n_), n_))
            if prev is not None and Q @ prev < 0: Q = -Q
            prev = Q; qk.append((t, Q, ''))
        chans[f'hq{S}'] = qk
    return tr

LINEAR = {'bw', 'hwL', 'hwR', 'hspL', 'hspR', 'frelL', 'frelR'}
def eval_chan(tr, name, t):
    ks = tr['chans'][name]; n = len(ks); loop = tr['loop']
    if n == 1 or t <= ks[0][0]: return ks[0][1].copy()
    if t >= ks[-1][0]: return ks[-1][1].copy()
    i = max(j for j in range(n - 1) if ks[j][0] <= t)
    (t0, p0, f0), (t1, p1, f1) = ks[i], ks[i + 1]; h = t1 - t0; u = (t - t0) / h
    if name in LINEAR or 'lin' in f1: return p0 + (p1 - p0) * u
    def tan(j):
        if 'stop' in ks[j][2]: return 0
        if j == 0 or j == n - 1:
            if not loop or n < 3: return 0
            return (ks[1][1] - ks[-2][1]) / ((ks[-1][0] - ks[-2][0]) + (ks[1][0] - ks[0][0]))
        return (ks[j + 1][1] - ks[j - 1][1]) / (ks[j + 1][0] - ks[j - 1][0])
    m0, m1 = tan(i) * h, tan(i + 1) * h
    h00 = 2*u**3 - 3*u**2 + 1; h10 = u**3 - 2*u**2 + u; h01 = -2*u**3 + 3*u**2; h11 = u**3 - u**2
    return h00*p0 + h10*m0 + h01*p1 + h11*m1

def interp(tr, t):
    out = {n: eval_chan(tr, n, t) for n in tr['chans']}
    for S, sg in (('L', 1), ('R', -1)):
        R = qmat(nrm(out[f'hq{S}'])); out[f'hn{S}'] = R @ np.array([0, -1, 0.]); out[f'hf{S}'] = R @ np.array([sg, 0, 0.])
    return out

# ---------------------------------------------------------------- IK
L_UA = np.linalg.norm(LOCAL_T['forearm.L']); L_FA = np.linalg.norm(LOCAL_T['hand.L'])
L_TH = np.linalg.norm(LOCAL_T['shin.L']); L_SH = np.linalg.norm(LOCAL_T['foot.L'])
PALM = lambda s: np.array([s * 0.06, -0.028, 0.0])   # palm centre, hand-local

def two_bone(A, T, l1, l2, pole, fallback=None):
    D = T - A; d = np.clip(np.linalg.norm(D), abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9995); u = nrm(D)
    pole = nrm(pole)
    if fallback is not None:
        k = np.clip((abs(pole @ u) - 0.6) / 0.35, 0, 1)
        pole = nrm(pole * (1 - k) + nrm(fallback) * k)
    w = perp(pole, u); ca = (l1*l1 + d*d - l2*l2) / (2*l1*d); sa = np.sqrt(max(0, 1 - ca*ca))
    E = A + l1 * (ca * u + sa * w); Wp = A + u * d
    return E, Wp, w

def frame_from(d0, b0, d, b):
    B0 = np.c_[d0, b0, np.cross(d0, b0)]; B1 = np.c_[d, b, np.cross(d, b)]
    return B1 @ B0.T

def swing_twist(qr, axis):
    v = qr[:3]; tw = np.r_[(v @ axis) * axis, qr[3]]; n = np.linalg.norm(tw)
    tw = tw / n if n > 1e-9 else IDQ.copy()
    sw = qmul(qr, tw * np.array([-1, -1, -1, 1]))
    ang = 2 * np.degrees(np.arctan2(tw[:3] @ axis, tw[3]))
    if ang > 180: ang -= 360
    if ang < -180: ang += 360
    return sw, ang
def clamp_q(qr, max_deg):
    if qr[3] < 0: qr = -qr
    ang = 2 * np.degrees(np.arccos(np.clip(qr[3], -1, 1)))
    return qr if ang <= max_deg else slerp(IDQ, qr, max_deg / ang)
def qax(axis, deg):
    a = np.radians(deg) / 2; return np.r_[np.sin(a) * axis, np.cos(a)]

WRIST_SWING, WRIST_TWIST, FORE_TWIST = 60, 25, 80
DEBUG = []
def solve_arm(M, S, palm_pt, palm_n, finger, pole, q, swing_max=WRIST_SWING):
    s = 1 if S == 'L' else -1; ax = np.array([s, 0, 0.])
    finger = perp(finger, palm_n)
    Rh_des = frame_from(ax, np.array([0, -1, 0.]), finger, palm_n)
    Rh = Rh_des
    A = (M[f'shoulder.{S}'] @ np.r_[LOCAL_T[f'upperarm.{S}'], 1])[:3]
    Rp = M[f'shoulder.{S}'][:3, :3]
    for it in range(1):
        wrist = palm_pt - Rh_des @ PALM(s)
        E, Wp, w = two_bone(A, wrist, L_UA, L_FA, pole, Rp @ np.array([s * 0.6, -0.2, -1.0]))
        dirv = nrm(E - A); f = nrm(Wp - E)
        b = perp(-w, dirv)
        Ru = frame_from(ax, np.array([0, 0, 1.]), dirv, b)
        th = np.degrees(np.arccos(np.clip(dirv @ f, -1, 1)))
        qbend = rot(('y', -s * th)); Rf0 = Ru @ qmat(qbend)
        rel = matq(Rf0.T @ Rh_des)
        _, tau = swing_twist(rel, ax)
        tf = float(np.clip(0.65 * tau, -FORE_TWIST, FORE_TWIST))
        qf = qmul(qbend, qax(ax, tf))                      # twist along the forearm, then bend
        Rf = Ru @ qmat(qf)
        rel2 = matq(Rf.T @ Rh_des)
        sw, t2 = swing_twist(rel2, ax)
        qh = qmul(clamp_q(sw, swing_max), qax(ax, float(np.clip(t2, -WRIST_TWIST, WRIST_TWIST))))
        Rh = Rf @ qmat(qh)
    q[f'upperarm.{S}'] = matq(Rp.T @ Ru); q[f'forearm.{S}'] = qf; q[f'hand.{S}'] = qh
    DEBUG.append((S, round(tau), round(tf), round(t2), np.round(finger, 2), np.round(palm_n, 2), round(th)))

def solve_leg(M, S, ankle, foot_R, pole, q):
    A = (M['hips'] @ np.r_[LOCAL_T[f'thigh.{S}'], 1])[:3]
    E, Wp, w = two_bone(A, ankle, L_TH, L_SH, pole, M['hips'][:3, :3] @ np.array([0, 0, 1.0]))
    dirv = nrm(E - A); f = nrm(Wp - E)
    b = perp(-w, dirv)
    Rt = frame_from(np.array([0, -1, 0.]), np.array([0, 0, -1.]), dirv, b)
    q[f'thigh.{S}'] = matq(M['hips'][:3, :3].T @ Rt)
    th = np.degrees(np.arccos(np.clip(dirv @ f, -1, 1)))
    q[f'shin.{S}'] = rot(('x', th))
    Rs = Rt @ qmat(q[f'shin.{S}'])
    q[f'foot.{S}'] = matq(Rs.T @ foot_R)

def ankle_from_foot(x, lift, z, pitch, yaw):
    Ry = R3(('y', yaw)); Rf = Ry @ R3(('x', pitch))
    if pitch >= 0: piv = np.array([x, 0, z]) + Ry @ (TOE - np.array([0, -ANKLE_H, 0])) + np.array([0, 0, 0]); off = Rf @ TOE
    else: piv = np.array([x, 0, z]) + Ry @ (HEEL - np.array([0, -ANKLE_H, 0])); off = Rf @ HEEL
    return piv - off + np.array([0, lift, 0]), Rf

# ---------------------------------------------------------------- per-frame solve
def solve(c, ball_path=None, t=0.0):
    q = {'hips': euler(c['hipsR']), 'spine': euler(c['spineR']), 'chest': euler(c['chestR']),
         'neck': euler(c['neckR']), 'head': euler(c['headR']),
         'shoulder.L': euler(c['shL']), 'shoulder.R': euler(c['shR'])}
    q['_root'] = c['root']; q['_hips'] = c['hips']
    M = fk(q)
    Ch = M['chest']; Cr = Ch[:3, :3]
    ball_c = (Ch @ np.r_[c['ball'], 1])[:3]
    bw = float(np.clip(c['bw'][0], 0, 1))
    ball = ball_c if ball_path is None or bw == 0 else ball_c * (1 - bw) + ball_path(t) * bw
    for S in 'LR':
        sp_ = float(np.clip(c[f'hsp{S}'][0], 0, 1))
        p_free = (Ch @ np.r_[c[f'hp{S}'], 1])[:3] * (1 - sp_) + c[f'hp{S}'] * sp_
        Rsp = Cr * (1 - sp_) + np.eye(3) * sp_
        n_free = nrm(Rsp @ c[f'hn{S}']); fing = nrm(Rsp @ c[f'hf{S}']); pole = nrm(Rsp @ c[f'he{S}'])
        hw = float(np.clip(c[f'hw{S}'][0], 0, 1))
        g = nrm(Rsp @ c[f'hg{S}'])
        p_ball = ball + g * BALL_R
        p = p_free * (1 - hw) + p_ball * hw
        sgn = 1 if S == 'L' else -1
        Rfree = frame_from(np.array([sgn, 0, 0.]), np.array([0, -1, 0.]), perp(fing, n_free), n_free)
        Rc = arc(n_free, -g) @ Rfree
        Rb = qmat(slerp(matq(Rfree), matq(Rc), hw))
        n = Rb @ np.array([0, -1, 0.]); fing = Rb @ np.array([sgn, 0, 0.])
        # automatic shrug: the clavicle lifts as the arm goes overhead
        A = (M[f'shoulder.{S}'] @ np.r_[LOCAL_T[f'upperarm.{S}'], 1])[:3]
        up = Cr @ np.array([0, 1, 0.])
        elev = np.degrees(np.arccos(np.clip(nrm(p - A) @ -up, -1, 1)))   # 0 = arm down, 180 = straight up
        shrug = 20 * sstep_(70, 165, elev)
        if shrug > 0.1:
            q[f'shoulder.{S}'] = qmul(rot(('z', sgn * shrug)), q[f'shoulder.{S}'])
            M = fk(q)
        solve_arm(M, S, p, n, fing, pole, q, WRIST_SWING + 15 * hw)
    for S in 'LR':
        fx, lift, fz = c[f'f{S}']; pitch, yaw = c[f'fr{S}']
        ank, Rf = ankle_from_foot(fx, lift, fz, pitch, yaw)
        rel = float(np.clip(c[f'frel{S}'][0], 0, 1))
        if rel > 0:
            hp = M['hips'][:3, 3]; ank_rel = hp + c[f'fh{S}']
            ank = ank * (1 - rel) + ank_rel * rel
        solve_leg(M, S, ank, Rf, nrm(c[f'fk{S}']), q)
    return q, ball

def bake(track, dur, ball_path=None, override=None):
    frames, balls = [], []
    for f in range(int(round(dur * FPS)) + 1):
        t = f / FPS; c = interp(track, t)
        if override: override(t, c)
        q, b = solve(c, ball_path, t); frames.append(q); balls.append(b)
    return frames, balls

def palm_world(q, S):
    M = fk(q); s = 1 if S == 'L' else -1
    return (M[f'hand.{S}'] @ np.r_[PALM(s), 1])[:3]
