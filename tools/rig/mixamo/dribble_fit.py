"""DribbleRun from the per-frame fits: one key per video frame (24 fps), looped, lightly smoothed."""
import numpy as np, json, fitpose as FP, mixrig as M
cam = json.load(open('cam.json')); SC = cam['sc']; FIT = json.load(open('fitseq.json'))
K0, N = 30, 28                                                # frames 30..57; frame 58 ~ frame 30 (period 27.9)
P = np.array([FIT[str(K0 + k)] for k in range(N)])
Ps = (np.roll(P, 1, 0) + 2 * P + np.roll(P, -1, 0)) / 4      # cyclic 1-2-1 smoothing
import fold as FDx
_bx = np.array([b[1] if b[1] is not None else np.nan for b in FP.BALL]); _by = np.array([b[2] if b[2] is not None else np.nan for b in FP.BALL]); _br = np.array([b[3] if b[3] else np.nan for b in FP.BALL])
_ix = FDx.N[:, 20, 0] * 854; _iy = FDx.N[:, 20, 1] * 480
CONTACT = [np.hypot(_ix[K0 + k] - _bx[K0 + k], _iy[K0 + k] - _by[K0 + k]) / _br[K0 + k] < 1.5 for k in range(28)]   # video: index finger on the ball
FOOTV = np.where(M.P[:, 1] < 0.16)[0]; BR = 0.078; VR = float(np.nanmedian([b[3] for b in FP.BALL if b[3]])) / SC * 0.9
def frame(k):
    p = Ps[k]; local, Wd = FP.pose_from(p)
    hips = M.REST[M.ID['Hips']][0] + np.array([0, p[1], 0])
    V = M.skinned(M.fk(local, hips)); hips[1] -= V[FOOTV, 1].min()
    Wd = M.fk(local, hips)
    b = FP.BALL[K0 + k]; c = np.array([BALL_X, (419.3 - b[2]) / SC, (b[1] - p[0]) / SC])
    hand = Wd[M.ID['RightHand']][:3, 3]; mid = Wd[M.ID['RightHandMiddle2']][:3, 3]; palm = (hand + mid) / 2
    if CONTACT[k]:                                         # hand on the ball: keep the smaller ball under the palm
        dirv = (palm - c); dirv[0] = 0; dirv /= np.linalg.norm(dirv); c = palm - dirv * (BR + 0.025); c[0] = palm[0] - 0.01
    else:
        c[1] = c[1] - (VR - BR) * np.clip(1 - (c[1] - VR) / 0.25, 0, 1)
    c[1] = max(BR, c[1])
    return local, hips, np.zeros(3), c
def _palm_x():
    xs = []
    for k in range(N):
        if CONTACT[k]:
            l, Wd = FP.pose_from(Ps[k]); xs.append(((Wd[M.ID['RightHand']][:3, 3] + Wd[M.ID['RightHandMiddle2']][:3, 3]) / 2)[0])
    return float(np.median(xs)) if xs else -0.25
BALL_X = -0.25
def frames():
    fr = [frame(k) for k in range(N)]; return fr + [fr[0]]
if __name__ == '__main__':
    for k in range(0, N, 4):
        l, h, r, c = frame(k); print(k, 'hips', h.round(3), 'ball', c.round(3))

BALL_X = _palm_x() - 0.01
