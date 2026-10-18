"""Minimal vectorised quaternion helpers. Quaternions are (x, y, z, w), matching glTF."""
import numpy as np


def identity(*shape):
    q = np.zeros(shape + (4,))
    q[..., 3] = 1.0
    return q


def normalize(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def mul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], axis=-1)


def conj(q):
    return q * np.array([-1.0, -1.0, -1.0, 1.0])


def rotate(q, v):
    """Rotate vectors v (..., 3) by unit quaternions q (..., 4)."""
    u = q[..., :3]
    w = q[..., 3:4]
    t = 2.0 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def from_axis_angle(axis, angle):
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis, axis=-1, keepdims=True)
    half = np.asarray(angle)[..., None] / 2.0
    return np.concatenate([axis * np.sin(half), np.cos(half)], axis=-1)


def from_euler_xyz(e):
    """Intrinsic X then Y then Z rotation, angles in radians, shape (..., 3)."""
    e = np.asarray(e, float)
    qx = from_axis_angle([1, 0, 0], e[..., 0])
    qy = from_axis_angle([0, 1, 0], e[..., 1])
    qz = from_axis_angle([0, 0, 1], e[..., 2])
    return mul(mul(qx, qy), qz)


def to_matrix(q):
    x, y, z, w = np.moveaxis(q, -1, 0)
    return np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1),
        np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1),
        np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1),
    ], -2)


def from_matrix(m):
    m = np.asarray(m, float)
    flat = m.reshape(-1, 3, 3)
    out = np.empty((flat.shape[0], 4))
    for i, r in enumerate(flat):
        tr = np.trace(r)
        if tr > 0:
            s = np.sqrt(tr + 1.0) * 2
            out[i] = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
            out[i] = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
        elif r[1, 1] > r[2, 2]:
            s = np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
            out[i] = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
        else:
            s = np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
            out[i] = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
    return normalize(out).reshape(m.shape[:-2] + (4,))


def between(a, b):
    """Shortest-arc rotation taking direction a onto direction b (..., 3)."""
    a = a / np.linalg.norm(a, axis=-1, keepdims=True)
    b = b / np.linalg.norm(b, axis=-1, keepdims=True)
    d = np.sum(a * b, axis=-1, keepdims=True)
    c = np.cross(a, b)
    q = np.concatenate([c, 1.0 + d], axis=-1)
    # Opposite vectors: rotate 180 degrees around any perpendicular axis.
    opposite = (d[..., 0] < -0.999999)
    if np.any(opposite):
        ao = a[opposite]
        perp = np.cross(ao, np.array([1.0, 0, 0]))
        weak = np.linalg.norm(perp, axis=-1) < 1e-6
        perp[weak] = np.cross(ao[weak], np.array([0, 1.0, 0]))
        q[opposite] = np.concatenate([perp / np.linalg.norm(perp, axis=-1, keepdims=True), np.zeros((len(ao), 1))], -1)
    return normalize(q)


def kabsch(src, dst, weights=None):
    """Rotation R (as quaternion) minimising sum w * |R src_i - dst_i|^2."""
    w = np.ones(len(src)) if weights is None else np.asarray(weights)
    h = (src * w[:, None]).T @ dst
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    r = vt.T @ np.diag([1.0, 1.0, d]) @ u.T
    return from_matrix(r)


def make_continuous(q):
    """Flip signs along the time axis (axis 0) so consecutive quaternions stay in one hemisphere."""
    q = q.copy()
    for t in range(1, len(q)):
        flip = np.sum(q[t] * q[t - 1], axis=-1) < 0
        q[t][flip] *= -1
    return q
