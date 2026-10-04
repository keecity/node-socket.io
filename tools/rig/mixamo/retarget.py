"""Folded video curves -> Mixamo bone rotations (aim each bone along the measured sagittal direction)."""
import numpy as np, mixrig as M
from rig import qmat, matq, qmul
import fold as FD
def qbetween(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b); c = np.cross(a, b); d = a @ b
    if d < -0.9999: return np.array([1.0, 0, 0, 0])
    q = np.array([*c, 1 + d]); return q / np.linalg.norm(q)
def child_dir(name):
    i = M.ID[name]; ch = M.NODES[i].children
    # the main child (largest translation) defines the bone axis
    best = max(ch, key=lambda c: np.linalg.norm(M.REST[c][0])); v = M.REST[best][0]; return v / np.linalg.norm(v)
SAG = lambda th, lat=0.0: np.array([lat, -np.cos(th), np.sin(th)])          # limb angle from down, + forward
def img2w(v2): return np.array([0.0, v2[1], v2[0]])
import json
_B = np.array([[o[1], o[2], o[3]] if o[1] is not None else [np.nan] * 3 for o in json.load(open('ball.json'))])
FLOOR_PX = np.nanpercentile(_B[:, 1] + _B[:, 2], 95)
S_PX = 0.502 / (FLOOR_PX - (-FD.hipm[:, 1]).mean())                            # model hip height / video hip height
BALL_R = 0.078; BALL_X = -0.20; VID_R = 0.135                                   # game ball (rim-legal) vs the cartoon video ball                                                 # ball radius (model units), carried on the right side
_wr = FD.fit(FD.XY[:, 16, 0] - (_B[:, 0]))[0]; _wy = FD.fit(FD.XY[:, 16, 1] - (-_B[:, 1]))[0]   # wrist relative to ball (px)
def ball_pos(u):
    return np.array([BALL_X, (FLOOR_PX + FD.CURVES['bally'](u)) * S_PX * -1 * -1, FD.CURVES['ballx'](u) * S_PX])
BALL_DZ = [0.0, 0.0]
def ballp(u):
    y = (FLOOR_PX - (-FD.CURVES['bally'](u))) * S_PX + BALL_DZ[1]
    y = y - (VID_R - BALL_R) * np.clip(1 - (y - VID_R) / 0.25, 0, 1)     # smaller ball still lands on the floor
    return np.array([BALL_X, max(BALL_R, y), FD.CURVES['ballx'](u) * S_PX + BALL_DZ[0]])
def contact_w(u):
    u = u % 1.0; sm = lambda a, b, x: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    return sm(0.03, 0.09, u) * (1 - sm(0.60, 0.67, u))
def targets(u):
    """world-space aim directions per bone at cycle phase u (0..1)"""
    t = {}
    tor = np.pi / 2 - (np.pi / 2 - FD.CURVES['torso'](u)) * 0.8; td = img2w([np.cos(tor), np.sin(tor)])
    for b in ('Spine', 'Spine1', 'Spine2', 'Neck'): t[b] = td
    hd = (FD.CURVES['head'](u) - FD.CURVES['head'](np.linspace(0, 1, 30)).mean()) * 0.4; f = np.array([np.cos(hd), np.sin(hd)]); t['Head'] = img2w([-f[1], f[0]])
    for S in 'RL':
        th, sh, ft = FD.leg(S, u); lat = 0.05 if S == 'L' else -0.05
        t[f'{"Right" if S == "R" else "Left"}UpLeg'] = SAG(th, lat); t[f'{"Right" if S == "R" else "Left"}Leg'] = SAG(sh, lat * 0.5)
        t['_foot' + S] = ft
    t['RightArm'] = SAG(FD.CURVES['uarmR'](u), -0.30); t['RightForeArm'] = SAG(FD.CURVES['farmR'](u), -0.12); t['RightHand'] = SAG(FD.CURVES['handR'](u), -0.05)
    t['LeftArm'] = SAG(FD.CURVES['uarmL'](u), 0.35); t['LeftForeArm'] = SAG(FD.CURVES['farmL'](u), 0.15)
    return t
AIM = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg',
       'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm']
REST_W = M.fk()
FOOTV = np.where(M.P[:, 1] < 0.16)[0]                       # shoe vertices
def pose(u):
    t = targets(u); u = u % 1.0; local = {}; W = {}
    for i in M.ORDER:
        tr, q, s = M.REST[i]; nm = M.NAME[i]
        Wp = W[M.PARENT[i]] if i in M.PARENT else np.eye(4)
        L = M.mat(tr, q, s); Wc = Wp @ L
        aim = None
        if nm in AIM: aim = t[nm]
        elif nm in ('LeftFoot', 'RightFoot'):
            # sole pitch from the video (heel->toe), applied to the rest foot direction
            S = 'L' if nm.startswith('Left') else 'R'; pitch = t['_foot' + S]
            rd = REST_W[M.ID[nm.replace('Foot', 'ToeBase')]][:3, 3] - REST_W[i][:3, 3]; rd /= np.linalg.norm(rd)
            c, s_ = np.cos(pitch), np.sin(pitch); aim = np.array([rd[0], rd[1] * c + rd[2] * s_, -rd[1] * s_ + rd[2] * c])
        if nm == 'RightArm':
            w = contact_w(u)
            if w > 0:
                sh = Wc[:3, 3]; l1 = np.linalg.norm(M.REST[M.ID['RightForeArm']][0]); l2 = np.linalg.norm(M.REST[M.ID['RightHand']][0])
                b = ballp(u); rel = np.array([_wr(u), _wy(u)]); rel = rel / np.linalg.norm(rel)
                wrist = b + np.array([0.035, rel[1], rel[0]]) * (BALL_R + 0.035)                # palm on the ball, as in the video
                dv = wrist - sh; dd = min(np.linalg.norm(dv), (l1 + l2) * 0.999); dn = dv / np.linalg.norm(dv)
                a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd); h = np.sqrt(max(l1 * l1 - a * a, 0))
                pole = np.array([-0.55, -0.15, -0.8]); pole = pole - dn * (pole @ dn); pole /= np.linalg.norm(pole)
                elbow = sh + dn * a + pole * h
                t['RightArm'] = (1 - w) * t['RightArm'] + w * (elbow - sh) / l1
                t['RightForeArm'] = (1 - w) * t['RightForeArm'] + w * (sh + dn * dd - elbow) / l2
                fwd = np.array([0.0, -0.35, 1.0]); t['RightHand'] = (1 - w) * t['RightHand'] + w * fwd / np.linalg.norm(fwd)
                aim = t['RightArm']
        if aim is not None:
            cur = Wc[:3, :3] @ child_dir(nm); qd = qbetween(cur, aim)
            Rn = qmat(qd) @ Wc[:3, :3]
            Ln = np.linalg.inv(Wp[:3, :3]) @ Rn; local[nm] = matq(Ln / np.linalg.norm(Ln[:, 0]))
            L = M.mat(tr, local[nm], s); Wc = Wp @ L
        W[i] = Wc
    # keep the lowest point of the shoes on the floor (measured on the skinned mesh)
    hips = M.REST[M.ID['Hips']][0].copy(); V = M.skinned(M.fk(local, hips)); hips[1] -= V[FOOTV, 1].min()
    return local, hips
def ball(u):
    bx = FD.CURVES['ballx'](u) * S_PX; by = FD.CURVES['bally'](u)
    return bx, by

def calibrate():
    """put the ball where the video's arm angles put the hand (the tracker's hip point sits at the back of the shorts)"""
    global contact_w
    cw = contact_w; contact_w = lambda u: 0.0
    dz, dy = [], []
    for u in np.linspace(0.12, 0.58, 12):
        loc, hips = pose(u); W = M.fk(loc, hips); hand = W[M.ID['RightHand']][:3, 3]
        rel = np.array([_wr(u), _wy(u)]); rel = rel / np.linalg.norm(rel)
        want = hand - np.array([0, rel[1], rel[0]]) * (BALL_R + 0.035); b = ballp(u)
        dz.append(want[2] - b[2]); dy.append(want[1] - b[1])
    contact_w = cw; BALL_DZ[0] = float(np.median(dz))   # height stays as filmed: the bounce must land on the floor
calibrate()
