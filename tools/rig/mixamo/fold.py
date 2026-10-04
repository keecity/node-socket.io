"""Video landmarks -> one seamless loop of 2D sagittal segment directions (Fourier fit over all cycles)."""
import json, numpy as np
D = json.load(open('pose.json')); WPX, HPX = 854, 480
N = np.array([d['n'] for d in D])           # (T, 33, 4)
T = len(N); XY = np.stack([N[:, :, 0] * WPX, -N[:, :, 1] * HPX], -1)   # x forward, y up (px)
VIS = N[:, :, 3]
# leg identity: keep two tracks continuous (mediapipe swaps left/right labels in profile)
A = {'hip': 23, 'knee': 25, 'ankle': 27, 'heel': 29, 'toe': 31}; B = {k: v + 1 for k, v in A.items()}
legA = np.zeros((T, 5, 2)); legB = np.zeros((T, 5, 2)); ks = list(A)
for t in range(T):
    a = XY[t, [A[k] for k in ks]]; b = XY[t, [B[k] for k in ks]]
    if t == 0: legA[t], legB[t] = a, b; continue
    keep = np.linalg.norm(a[1:] - legA[t-1, 1:]) + np.linalg.norm(b[1:] - legB[t-1, 1:])
    swap = np.linalg.norm(b[1:] - legA[t-1, 1:]) + np.linalg.norm(a[1:] - legB[t-1, 1:])
    legA[t], legB[t] = (a, b) if keep <= swap else (b, a)
# near arm = right (camera side); fall back to whichever wrist is more visible
armR = XY[:, [12, 14, 16, 20]]; armL = XY[:, [11, 13, 15, 19]]
hipm = (XY[:, 23] + XY[:, 24]) / 2; shm = (XY[:, 11] + XY[:, 12]) / 2
ear = np.where(VIS[:, 8:9] > VIS[:, 7:8], XY[:, 8], XY[:, 7]); nose = XY[:, 0]
def ang(v): return np.arctan2(v[..., 1], v[..., 0])
def dang(v): return np.arctan2(v[..., 0], -v[..., 1])     # limb angle from straight down, + = swung forward (no wrap for limbs)
sig = {
 'torso': ang(shm - hipm), 'head': ang(nose - ear),
 'thighA': ang(legA[:, 1] - legA[:, 0]), 'shinA': ang(legA[:, 2] - legA[:, 1]), 'footA': ang(legA[:, 4] - legA[:, 3]),
 'thighB': ang(legB[:, 1] - legB[:, 0]), 'shinB': ang(legB[:, 2] - legB[:, 1]), 'footB': ang(legB[:, 4] - legB[:, 3]),
 'uarmR': dang(armR[:, 1] - armR[:, 0]), 'farmR': dang(armR[:, 2] - armR[:, 1]), 'handR': dang(armR[:, 3] - armR[:, 2]),
 'uarmL': dang(armL[:, 1] - armL[:, 0]), 'farmL': dang(armL[:, 2] - armL[:, 1]),
 'hipy': hipm[:, 1],
}
legpx = np.median(np.linalg.norm(legA[:, 1] - legA[:, 0], axis=1) + np.linalg.norm(legA[:, 2] - legA[:, 1], axis=1))
# period from the ball's bounce (clean, high-contrast track)
BALL = np.array([[o[1], o[2], o[3]] if o[1] is not None else [np.nan] * 3 for o in json.load(open('ball.json'))], float)
by = -BALL[:, 1]; ok = np.isfinite(by); best = None
for p in np.arange(24, 32, 0.01):
    ph = 2 * np.pi * np.arange(T)[ok] / p; X = np.c_[np.ones(ok.sum()), np.cos(ph), np.sin(ph), np.cos(2*ph), np.sin(2*ph), np.cos(3*ph), np.sin(3*ph)]
    r = np.linalg.lstsq(X, by[ok], rcond=None)[1][0]
    if best is None or r < best[0]: best = (r, p)
PER = best[1]
sig['ballx'] = BALL[:, 0] - hipm[:, 0]; sig['bally'] = -BALL[:, 1] - hipm[:, 1] * 0 - 0   # ball height in image (camera height fixed)
def fit(x, K=6):
    x = np.asarray(x, float); good = np.isfinite(x); x = np.where(good, x, np.nanmean(x))
    if np.ptp(x) > np.pi and np.ptp(x) < 7: x = np.unwrap(x)
    ph = 2 * np.pi * np.arange(T) / PER; X = np.ones((T, 1 + 2 * K))
    for k in range(1, K + 1): X[:, 2*k-1] = np.cos(k * ph); X[:, 2*k] = np.sin(k * ph)
    c = np.linalg.lstsq(X[5:-5], x[5:-5], rcond=None)[0]
    def ev(u):   # u in cycles
        ph = 2 * np.pi * np.asarray(u); out = c[0] + 0 * ph
        for k in range(1, K + 1): out = out + c[2*k-1] * np.cos(k * ph) + c[2*k] * np.sin(k * ph)
        return out
    resid = x[5:-5] - X[5:-5] @ c
    return ev, np.degrees(np.std(resid)) if 'y' not in str(x.dtype) else 0
CURVES = {}; ERR = {}
for k, v in sig.items(): CURVES[k], ERR[k] = fit(v)
if __name__ == '__main__':
    print('period frames', round(PER, 2), '=', round(PER / 24, 3), 's   leg px', round(legpx, 1))
    for k in sig: print(f'{k:7s} fit residual {ERR[k]:6.2f}' + (' deg' if k != 'hipy' else ' (rad->px n/a)'))

# ---- legs by role (front/back) folded at half the period: no left/right identity needed
L1 = XY[:, [23, 25, 27, 29, 31]]; L2 = XY[:, [24, 26, 28, 30, 32]]
def legang(L): return np.stack([dang(L[:, 1] - L[:, 0]), dang(L[:, 2] - L[:, 1]), ang(L[:, 4] - L[:, 3])], 1)
a1, a2 = legang(L1), legang(L2)
front = np.where((a1[:, 0] > a2[:, 0])[:, None], a1, a2); back = np.where((a1[:, 0] > a2[:, 0])[:, None], a2, a1)
v1 = VIS[:, [25, 27]].mean(1); v2 = VIS[:, [26, 28]].mean(1)
def fit_half(x, K=4):
    ph = 4 * np.pi * np.arange(T) / PER; X = np.ones((T, 1 + 2 * K))
    for k in range(1, K + 1): X[:, 2*k-1] = np.cos(k * ph); X[:, 2*k] = np.sin(k * ph)
    c = np.linalg.lstsq(X[5:-5], x[5:-5], rcond=None)[0]
    def ev(u):
        ph = 4 * np.pi * np.asarray(u); out = c[0] + 0 * ph
        for k in range(1, K + 1): out = out + c[2*k-1] * np.cos(k * ph) + c[2*k] * np.sin(k * ph)
        return out
    return ev, np.degrees(np.std(x[5:-5] - X[5:-5] @ c))
ROLE = {}
for i, nm in enumerate(['thigh', 'shin', 'foot']):
    ROLE['F' + nm], e1 = fit_half(front[:, i]); ROLE['B' + nm], e2 = fit_half(back[:, i])
    if __name__ == '__main__': print(f'{nm}: front resid {e1:.1f} deg, back resid {e2:.1f} deg')
# which half of the cycle is the near (right) leg in front? near leg = more visible
nearfront = np.where(v2 > v1, a2[:, 0] > a1[:, 0], a1[:, 0] > a2[:, 0])
uu = (np.arange(T) / PER) % 1.0
RIGHT_FRONT_FIRST_HALF = nearfront[(uu < 0.5)].mean() > nearfront[(uu >= 0.5)].mean()
if __name__ == '__main__': print('near leg in front during first half:', RIGHT_FRONT_FIRST_HALF, round(nearfront[(uu < 0.5)].mean(), 2), round(nearfront[(uu >= 0.5)].mean(), 2))
def leg(side, u):
    """side 'R' (near) or 'L'. returns thigh, shin, foot angles (rad) at cycle phase u"""
    u = u % 1.0; first = u < 0.5
    isfront = (first == RIGHT_FRONT_FIRST_HALF) if side == 'R' else (first != RIGHT_FRONT_FIRST_HALF)
    r = 'F' if isfront else 'B'
    return ROLE[r + 'thigh'](u), ROLE[r + 'shin'](u), ROLE[r + 'foot'](u)

# ---- near leg by depth (mediapipe z: smaller = closer to camera), fitted over the whole cycle; far leg = half a cycle later
Z = N[:, :, 2]
nearA = (Z[:, [25, 27]].mean(1) < Z[:, [26, 28]].mean(1))          # True: the 'left'-labelled landmarks are the near leg
NEAR = np.where(nearA[:, None], a1, a2)
NEAR_FIT = {}; NEAR_ERR = {}
for i, nm in enumerate(['thigh', 'shin', 'foot']):
    NEAR_FIT[nm], NEAR_ERR[nm] = fit(NEAR[:, i])
if __name__ == '__main__': print('near-leg fit residuals', {k: round(v, 1) for k, v in NEAR_ERR.items()}, 'near=left-label frac', nearA.mean().round(2))
def leg(side, u):
    u = u + (0.0 if side == 'R' else 0.5)
    return NEAR_FIT['thigh'](u), NEAR_FIT['shin'](u), NEAR_FIT['foot'](u)

# ---- legs by phase: thighs cross at phase a and a+0.5; the right (near) leg is in front over the half that contains
#      the ball's floor contact. Raw frames are labelled by phase, binned by median (outlier-proof), then fitted.
uu_fine = np.linspace(0, 0.5, 400, endpoint=False)
dth = ROLE['Fthigh'](uu_fine) - ROLE['Bthigh'](uu_fine); A_CROSS = uu_fine[np.argmin(dth)]
ub_fine = np.linspace(0, 1, 400, endpoint=False); U_FLOOR = ub_fine[np.argmin(CURVES['bally'](ub_fine))]
def r_front(u): return ((u - A_CROSS) % 1.0) < 0.5
R_FRONT_AT = r_front(U_FLOOR)
uu_all = (np.arange(T) / PER) % 1.0
Rraw = np.where((r_front(uu_all) == R_FRONT_AT)[:, None], front, back)
def binfit(x, K=5, nb=28):
    idx = (uu_all * nb).astype(int) % nb; med = np.array([np.median(x[5:-5][idx[5:-5] == b]) for b in range(nb)])
    ph = 2 * np.pi * (np.arange(nb) + 0.5) / nb; X = np.ones((nb, 1 + 2 * K))
    for k in range(1, K + 1): X[:, 2*k-1] = np.cos(k * ph); X[:, 2*k] = np.sin(k * ph)
    c = np.linalg.lstsq(X, med, rcond=None)[0]
    def ev(u):
        ph = 2 * np.pi * np.asarray(u); out = c[0] + 0 * ph
        for k in range(1, K + 1): out = out + c[2*k-1] * np.cos(k * ph) + c[2*k] * np.sin(k * ph)
        return out
    return ev, med
RLEG = {nm: binfit(Rraw[:, i])[0] for i, nm in enumerate(['thigh', 'shin', 'foot'])}
if __name__ == '__main__':
    print('thigh crossing phase', round(A_CROSS, 3), ' ball floor phase', round(U_FLOOR, 3), ' right leg front at floor:', R_FRONT_AT)
    uu = np.linspace(0, 1, 14, endpoint=False)
    for nm in RLEG: print(nm, np.degrees(RLEG[nm](uu)).round(0))
def leg(side, u):
    u = u + (0.0 if side == 'R' else 0.5)
    return RLEG['thigh'](u), RLEG['shin'](u), RLEG['foot'](u)
