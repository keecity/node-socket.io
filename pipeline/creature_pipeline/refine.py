"""Refine a solved motion directly against the 2D detections in every view.

Triangulating each joint and then fitting rotations treats a joint hidden in one view (the
tail behind the body from the front, far legs from the side) as badly as a visible one.
Here the joint rotations themselves are optimised so the posed rig reprojects onto the
detections: bone lengths are fixed, each detection is weighted by its confidence, a robust
loss ignores outliers, and a temporal term keeps motion smooth. A joint hidden in one view
is then placed by the other view plus the skeleton.
"""
import numpy as np
import torch

from . import quat


def _qmul(a, b):
    ax, ay, az, aw = a.unbind(-1)
    bx, by, bz, bw = b.unbind(-1)
    return torch.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                        aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)


def _qrot(q, v):
    u, w = q[..., :3], q[..., 3:4]
    t = 2 * torch.cross(u, v, dim=-1)
    return v + w * t + torch.cross(u, t, dim=-1)


def _from_rotvec(r):
    angle = r.norm(dim=-1, keepdim=True).clamp(min=1e-8)
    return torch.cat([r / angle * torch.sin(angle / 2), torch.cos(angle / 2)], -1)


def _to_rotvec(q):
    q = quat.normalize(q) * np.sign(q[..., 3:4] + 1e-12)
    angle = 2 * np.arccos(np.clip(q[..., 3:4], -1, 1))
    s = np.sqrt(np.clip(1 - q[..., 3:4] ** 2, 1e-12, None))
    return q[..., :3] / s * angle


def _axis_q(axis, angle):
    z = torch.zeros_like(angle)
    half_s, half_c = torch.sin(angle / 2), torch.cos(angle / 2)
    parts = [z, z, z]
    parts[axis] = half_s
    return torch.stack(parts + [half_c], -1)


def _euler_xyz_q(e):
    """Same convention as quat.from_euler_xyz: q = qx * qy * qz."""
    return _qmul(_qmul(_axis_q(0, e[..., 0]), _axis_q(1, e[..., 1])), _axis_q(2, e[..., 2]))


def _to_euler_xyz(q):
    R = quat.to_matrix(quat.normalize(q))
    b = np.arcsin(np.clip(R[..., 0, 2], -1, 1))
    a = np.arctan2(-R[..., 1, 2], R[..., 2, 2])
    c = np.arctan2(-R[..., 0, 1], R[..., 0, 0])
    return np.stack([a, b, c], -1)


def _forward(parents, offsets, local_q, root):
    pos, glob = [None] * len(parents), [None] * len(parents)
    for j, p in enumerate(parents):
        if p < 0:
            glob[j], pos[j] = local_q[:, j], root
        else:
            glob[j] = _qmul(glob[p], local_q[:, j])
            pos[j] = pos[p] + _qrot(glob[p], offsets[j].expand_as(root))
    return torch.stack(pos, 1)


def refine(skel, cams, kp, local, root, sigma=None, iters=400, smooth_weight=0.01, huber=8.0, min_conf=0.05, lr=0.02,
           rot_smooth_weight=0.0, floor_weight=0.0, contact_weight=0.0, limits=None, rot_smooth_scale=None,
           log=None):
    """kp (V, T, J, 3) detections; local (T, J, 4), root (T, 3) initial solve. Returns refined (local, root).

    ``sigma`` (V, J) is the detector's measured pixel noise per view and joint (see calibrate);
    residuals are divided by it relative to its median, so a joint the detector cannot see well
    in one view counts for little there. ``huber`` is in pixels for a typical joint.

    Ground terms use the feet (joints within 5% of body height of the lowest rest joint):
    ``floor_weight`` keeps each foot at or above its rest height (the mesh below a foot joint
    then stays above the floor), and ``contact_weight`` stops a foot that is on the ground from
    sliding. ``rot_smooth_weight`` penalises rotational acceleration, which removes the jitter
    that position smoothing alone leaves in end joints.

    ``limits`` (J, 3, 2) radians (e.g. skel.limits after limits.apply) makes every non-root
    joint a hard-limited Euler XYZ rotation: each angle is squashed into its range, so a jaw
    cannot swing sideways and a knee cannot twist, however noisy the detections. The root
    stays free so the creature can rear up and turn. A range with min == max locks that axis.
    ``rot_smooth_scale`` (J,) multiplies the rotational smoothing per joint.
    """
    dt = torch.float64
    parents = [int(p) for p in skel.parents]
    offsets = torch.tensor(skel.offsets, dtype=dt)
    P = torch.tensor(np.stack([c.P for c in cams]), dtype=dt)  # (V, 3, 4)
    target = torch.tensor(kp[..., :2], dtype=dt)
    w = torch.tensor(np.where(kp[..., 2] >= min_conf, kp[..., 2], 0.0), dtype=dt)
    # Relative noise: shifts trust between views and joints without changing the overall scale,
    # so ``huber`` stays in (typical-joint) pixels and smooth_weight means the same either way.
    rel = np.ones(kp.shape[::2][:2]) if sigma is None else np.asarray(sigma) / np.median(sigma)
    sig = torch.tensor(rel, dtype=dt)[:, None, :]
    r = torch.tensor(_to_rotvec(local), dtype=dt, requires_grad=True)
    lim = None
    if limits is not None:
        lim = torch.tensor(np.asarray(limits, float), dtype=dt)
        lo, hi = lim[..., 0], lim[..., 1]
        e0 = torch.tensor(_to_euler_xyz(local), dtype=dt)
        frac = ((e0 - lo) / (hi - lo).clamp(min=1e-6)).clamp(0.02, 0.98)
        raw = torch.log(frac / (1 - frac)).detach().requires_grad_(True)
        root_idx = [j for j, p in enumerate(parents) if p < 0]

    def local_q():
        if lim is None:
            return _from_rotvec(r)
        q = _euler_xyz_q(lo + (hi - lo) * torch.sigmoid(raw))
        free = _from_rotvec(r)
        q = q.clone()
        q[:, root_idx] = free[:, root_idx]
        return q

    def rot_params():
        """Per-joint rotation parameters (T, J, 3): rotation vectors, or Euler angles when limited."""
        if lim is None:
            return r
        e = lo + (hi - lo) * torch.sigmoid(raw)
        e = e.clone()
        e[:, root_idx] = r[:, root_idx]
        return e
    js = torch.ones(len(parents), dtype=dt) if rot_smooth_scale is None else \
        torch.tensor(np.asarray(rot_smooth_scale, float), dtype=dt)
    t = torch.tensor(root, dtype=dt, requires_grad=True)
    scale = float(np.mean([c.K[0, 0] for c in cams]))
    h = skel.height()
    rest_y = skel.rest_positions[:, 1]
    feet = [j for j in range(len(skel)) if rest_y[j] < rest_y.min() + 0.05 * h]
    floor_y = torch.tensor(rest_y[feet], dtype=dt)
    px_per_m = scale / float(np.mean([np.linalg.norm(c.center - skel.center()) for c in cams]))
    opt = torch.optim.Adam([r, t] + ([raw] if lim is not None else []), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, iters, eta_min=lr * 0.02)
    for it in range(iters):
        opt.zero_grad()
        X = _forward(parents, offsets, local_q(), t)  # (T, J, 3)
        Xh = torch.cat([X, torch.ones_like(X[..., :1])], -1)
        uvw = torch.einsum("vij,tkj->vtki", P, Xh)
        uv = uvw[..., :2] / uvw[..., 2:3]
        res = (uv - target).norm(dim=-1) / sig
        robust = torch.where(res < huber, 0.5 * res ** 2, huber * (res - 0.5 * huber))
        data = (w * robust).sum() / w.sum().clamp(min=1)
        accel = X[2:] - 2 * X[1:-1] + X[:-2]
        smooth = (accel * scale).pow(2).sum(-1).mean() if len(X) > 2 else X.sum() * 0
        loss = data + smooth_weight * smooth
        if rot_smooth_weight and len(X) > 2:
            rp = rot_params()
            racc = rp[2:] - 2 * rp[1:-1] + rp[:-2]
            loss = loss + rot_smooth_weight * ((racc * 100).pow(2).sum(-1) * js).mean()
        if feet and (floor_weight or contact_weight):
            fy = X[:, feet, 1]
            below = (floor_y - fy).clamp(min=0) * px_per_m
            loss = loss + floor_weight * below.pow(2).mean()
            if contact_weight and len(X) > 1:
                on_ground = torch.sigmoid((floor_y + 0.03 * h - fy.detach()) / (0.01 * h))
                step = (X[1:, feet][..., [0, 2]] - X[:-1, feet][..., [0, 2]]).norm(dim=-1) * px_per_m
                loss = loss + contact_weight * (on_ground[1:] * on_ground[:-1] * step.pow(2)).mean()
        loss.backward()
        opt.step()
        sched.step()
        if log and (it % 100 == 0 or it == iters - 1):
            log(f"refine {it}: reprojection {data.item():.2f}, smooth {smooth.item():.2f}")
    with torch.no_grad():
        q = local_q().numpy()
    return quat.make_continuous(quat.normalize(q)), t.detach().numpy()


def calibrate(skel, cams, kp, gt_positions):
    """Robust per-view, per-joint pixel noise of a detector, measured on a rendered motion with known joints.

    Use a motion other than the exam's so the exam stays an honest test."""
    err = np.stack([np.linalg.norm(kp[v, ..., :2] - c.project(gt_positions)[0], axis=-1) for v, c in enumerate(cams)])
    return np.maximum(1.4826 * np.median(err, axis=1), 1.0)
