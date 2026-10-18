"""The exam: a motion we invented, so we know every joint in every frame.

Run it for every monster before paying for any generated video, and after every change
to the pipeline. With ``keypoints=None`` it simulates the detector with pixel noise and
dropouts (tests the geometry and solver). For the full exam, render the saved motion in
the same two cameras (blender/render_synthetic.py --motion), run the trained detector on
that video, and pass its keypoints here.
"""
import numpy as np

from .retarget import solve_rotations
from .triangulate import body_size_px, check_view_agreement, fill_gaps, smooth, triangulate


def simulate_detections(cams, X, rng, noise_px=1.5, dropout=0.03):
    V = len(cams)
    T, J = X.shape[:2]
    kp = np.zeros((V, T, J, 3))
    for v, cam in enumerate(cams):
        uv, _ = cam.project(X)
        kp[v, ..., :2] = uv + rng.normal(0, noise_px, uv.shape)
        kp[v, ..., 2] = rng.uniform(0.7, 1.0, (T, J))
        kp[v, ..., 2][rng.random((T, J)) < dropout] = 0.0
    return kp


def solve(skel, cams, kp, sigma_frames=1.0, min_conf=0.3):
    X, err, valid = triangulate(cams, kp, min_conf=min_conf)
    report = check_view_agreement(err, valid, body_size_px(skel, cams))
    X = smooth(fill_gaps(X), sigma_frames)
    local, root = solve_rotations(skel, X)
    return local, root, report


def score(skel, gt_positions, local, root):
    pos, _ = skel.forward(local, root)
    per_joint = np.linalg.norm(pos - gt_positions, axis=-1)
    h = skel.height() or 1.0
    return {
        "mpjpe_m": float(per_joint.mean()),
        "mpjpe_pct_height": float(100 * per_joint.mean() / h),
        "worst_joint": skel.names[int(per_joint.mean(0).argmax())],
        "worst_joint_pct_height": float(100 * per_joint.mean(0).max() / h),
    }


def run_exam(skel, cams, gt_local, gt_root, keypoints=None, rng=None, pass_pct_height=3.0):
    rng = rng or np.random.default_rng(0)
    gt_pos, _ = skel.forward(gt_local, gt_root)
    kp = simulate_detections(cams, gt_pos, rng) if keypoints is None else keypoints
    local, root, views = solve(skel, cams, kp)
    result = score(skel, gt_pos, local, root)
    result["views"] = views
    result["passed"] = bool(views["ok"] and result["mpjpe_pct_height"] <= pass_pct_height)
    return result
