import os

import numpy as np
import pytest

from creature_pipeline import quat
from creature_pipeline.cameras import stereo_rig
from creature_pipeline.exam import run_exam, simulate_detections, solve, score
from creature_pipeline.gltf import read_gltf_json, write_animation_glb
from creature_pipeline.motion import random_motion
from creature_pipeline.skeleton import Skeleton
from creature_pipeline.triangulate import body_size_px, check_view_agreement, triangulate
from creature_pipeline.video import default_layout, split_views

HERE = os.path.dirname(__file__)
WOLF = os.path.join(HERE, "..", "examples", "wolf_skeleton.json")


@pytest.fixture
def wolf():
    return Skeleton.load(WOLF)


def rig_for(skel):
    return stereo_rig(skel.extent(), 448, 448, center=skel.center())


def test_quat_roundtrip():
    rng = np.random.default_rng(0)
    q = quat.normalize(rng.normal(size=(20, 4)))
    back = quat.from_matrix(quat.to_matrix(q))
    assert np.allclose(np.abs(np.sum(q * back, -1)), 1, atol=1e-9)
    v = rng.normal(size=(20, 3))
    assert np.allclose(quat.rotate(q, v), np.einsum("nij,nj->ni", quat.to_matrix(q), v))


def test_between_handles_opposite_vectors():
    a = np.array([[1.0, 0, 0], [0, 1.0, 0]])
    b = -a
    q = quat.between(a, b)
    assert np.allclose(quat.rotate(q, a), b, atol=1e-9)


def test_noiseless_solve_is_exact(wolf):
    cams = rig_for(wolf)
    local, root, _ = random_motion(wolf, np.random.default_rng(1), frames=40, travel=0.5)
    pos, _ = wolf.forward(local, root)
    kp = simulate_detections(cams, pos, np.random.default_rng(0), noise_px=0, dropout=0)
    L, R, views = solve(wolf, cams, kp, sigma_frames=0)
    assert views["ok"]
    assert score(wolf, pos, L, R)["mpjpe_m"] < 1e-9


def test_exam_passes_with_detector_noise(wolf):
    local, root, _ = random_motion(wolf, np.random.default_rng(2), travel=0.5)
    result = run_exam(wolf, rig_for(wolf), local, root)
    assert result["passed"], result


def test_view_disagreement_is_rejected(wolf):
    cams = rig_for(wolf)
    rng = np.random.default_rng(3)
    a, ra, _ = random_motion(wolf, rng, frames=60)
    b, rb, _ = random_motion(wolf, rng, frames=60)
    pa, _ = wolf.forward(a, ra)
    pb, _ = wolf.forward(b, rb)
    kp = np.stack([simulate_detections([cams[0]], pa, rng)[0], simulate_detections([cams[1]], pb, rng)[0]])
    _, err, valid = triangulate(cams, kp)
    assert not check_view_agreement(err, valid, body_size_px(wolf, cams))["ok"]


def test_glb_export_structure(wolf, tmp_path):
    local, root, _ = random_motion(wolf, np.random.default_rng(4), frames=24)
    out = tmp_path / "clip.glb"
    write_animation_glb(str(out), wolf, local, root, fps=24)
    gl = read_gltf_json(str(out))
    assert [n["name"] for n in gl["nodes"]] == wolf.names
    channels = gl["animations"][0]["channels"]
    assert sum(c["target"]["path"] == "rotation" for c in channels) == len(wolf)
    assert gl["accessors"][0]["max"][0] == pytest.approx(23 / 24)


def test_split_views_scales_layout():
    layout = default_layout(1600, 900)
    frames = np.zeros((2, 720, 1280, 3), np.uint8)
    frames[:, :, 640:] = 255  # right half white
    left, right = split_views(frames, layout, 64)
    assert left.shape == (2, 64, 64, 3) and left.max() == 0 and right.min() == 255
