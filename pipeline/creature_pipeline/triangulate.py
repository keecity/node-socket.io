"""Two-view (or n-view) triangulation of per-frame 2D joints, plus the "do both halves agree" check."""
import numpy as np


def triangulate(cams, kp, min_conf=0.3):
    """kp: (V, T, J, 3) of (u, v, confidence). Returns points (T, J, 3), reprojection error px (T, J), valid (T, J).

    Weighted DLT: each view contributes two rows scaled by its confidence. A joint is valid
    only when at least two views see it with confidence >= min_conf.
    """
    V, T, J, _ = kp.shape
    Ps = [c.P for c in cams]
    conf = kp[..., 2]
    seen = conf >= min_conf
    valid = seen.sum(axis=0) >= 2

    rows = []
    for v in range(V):
        u, w = kp[v, ..., 0:1], kp[v, ..., 1:2]
        c = np.where(seen[v], conf[v], 0.0)[..., None]
        rows.append(c * (u * Ps[v][2] - Ps[v][0]))
        rows.append(c * (w * Ps[v][2] - Ps[v][1]))
    A = np.stack(rows, axis=-2)  # (T, J, 2V, 4)
    _, _, vt = np.linalg.svd(A)
    Xh = vt[..., -1, :]
    with np.errstate(divide="ignore", invalid="ignore"):
        X = Xh[..., :3] / Xh[..., 3:4]

    err = np.zeros((T, J))
    for v, cam in enumerate(cams):
        uv, _ = cam.project(X)
        e = np.linalg.norm(uv - kp[v, ..., :2], axis=-1)
        err = np.maximum(err, np.where(seen[v], e, 0.0))
    X[~valid] = np.nan
    err[~valid] = np.nan
    return X, err, valid


def body_size_px(skel, cams):
    """How many pixels the creature's largest rest extent spans, averaged over the cameras."""
    return float(np.mean([skel.extent() * c.K[0, 0] / np.linalg.norm(c.center - skel.center()) for c in cams]))


def check_view_agreement(err, valid, body_px, max_median=0.01, bad=0.04, max_bad_fraction=0.1):
    """Reject clips where the two halves show different motions.

    If the video model drew two different moves, the rays from the two cameras stop meeting
    and the reprojection error grows. With a front and a side camera only the vertical
    coordinate is seen twice, so this catches height mismatches (legs lifted at different
    times, a head up in one view and down in the other); it cannot see a left/right swap.
    Errors are measured relative to the creature's size on screen (``body_px``); with ~2px
    detector noise matching views sit near 0.5% and mismatched ones above 1.3%.
    Regenerating a bad clip is cheaper than repairing it, so this gate runs before solving.
    """
    e = err[valid] / body_px
    if e.size == 0:
        return {"ok": False, "reason": "no joint seen in two views", "median": None, "bad_fraction": 1.0}
    median = float(np.median(e))
    bad_fraction = float(np.mean(e > bad))
    coverage = float(valid.mean())
    disagree = median > max_median or bad_fraction > max_bad_fraction
    ok = not disagree and coverage >= 0.8
    reason = "ok" if ok else ("views disagree" if disagree else "low coverage")
    return {"ok": ok, "reason": reason, "median": median, "median_px": median * body_px,
            "bad_fraction": bad_fraction, "coverage": coverage}


def fill_gaps(X):
    """Linearly interpolate NaN frames per joint; edge gaps take the nearest valid value."""
    X = X.copy()
    T = len(X)
    t = np.arange(T)
    for j in range(X.shape[1]):
        good = ~np.isnan(X[:, j, 0])
        if good.sum() == 0:
            raise ValueError(f"joint {j} is never triangulated")
        for k in range(3):
            X[:, j, k] = np.interp(t, t[good], X[good, j, k])
    return X


def smooth(X, sigma_frames=1.0):
    """Gaussian smoothing along time to remove detector jitter."""
    if sigma_frames <= 0:
        return X
    r = int(np.ceil(3 * sigma_frames))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_frames) ** 2)
    k /= k.sum()
    pad = np.pad(X, ((r, r), (0, 0), (0, 0)), mode="edge")
    out = np.zeros_like(X)
    for i, w in enumerate(k):
        out += w * pad[i:i + len(X)]
    return out
