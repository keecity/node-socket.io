"""Turn triangulated joint positions into joint rotations on the creature's skeleton.

Bone lengths come from the rig, never from the video, so the result always has the
creature's real proportions. For a joint with one child we take the shortest-arc
rotation onto the observed bone direction; for a branching joint (hips, chest) we fit
all child directions at once with Kabsch. Twist along a single bone is not observable
from joint positions and is left at rest.
"""
import numpy as np

from . import quat


def solve_rotations(skel, X, conf=None):
    """X (T, J, 3) world joint positions -> local rotations (T, J, 4), root positions (T, 3)."""
    T, J = X.shape[:2]
    w = np.ones((T, J)) if conf is None else conf
    local = quat.identity(T, J)
    glob = quat.identity(T, J)
    for j in range(J):
        p = skel.parents[j]
        parent_glob = glob[:, p] if p >= 0 else quat.identity(T)
        kids = skel.children[j]
        if len(kids) == 1:
            c = kids[0]
            observed = X[:, c] - X[:, j]
            local_dir = quat.rotate(quat.conj(parent_glob), observed)
            local[:, j] = quat.between(np.broadcast_to(skel.offsets[c], (T, 3)), local_dir)
        elif len(kids) > 1:
            src = skel.offsets[kids]
            for t in range(T):
                dst = quat.rotate(quat.conj(parent_glob[t]), X[t, kids] - X[t, j])
                local[t, j] = quat.kabsch(src, dst, w[t, kids])
        glob[:, j] = quat.mul(parent_glob, local[:, j])
    local = quat.make_continuous(local)
    return local, X[:, 0].copy()


def to_rig_frames(skel, local):
    """Convert identity-rest local rotations into the source rig's own bone frames.

    With W = rest global rotation of a bone in the original rig, the rig's local rotation is
    (G_parent W_parent)^-1 (G W). This is what a glTF/three.js skeleton expects.
    """
    T, J = local.shape[:2]
    glob = np.zeros_like(local)
    out = np.zeros_like(local)
    W = np.array([j.rest_rotation for j in skel.joints])
    for j, p in enumerate(skel.parents):
        glob[:, j] = local[:, j] if p < 0 else quat.mul(glob[:, p], local[:, j])
        g = quat.mul(glob[:, j], W[j])
        if p < 0:
            out[:, j] = g
        else:
            out[:, j] = quat.mul(quat.conj(quat.mul(glob[:, p], W[p])), g)
    return quat.make_continuous(quat.normalize(out))


def rig_local_offsets(skel):
    """Rest translations of each bone in its parent's rig frame (glTF node translations)."""
    W = np.array([j.rest_rotation for j in skel.joints])
    out = skel.offsets.copy()
    for j, p in enumerate(skel.parents):
        if p >= 0:
            out[j] = quat.rotate(quat.conj(W[p]), skel.offsets[j])
    return out
