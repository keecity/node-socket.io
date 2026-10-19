"""Monster pack: measurements on synthetic motion with known answers, on a rig other than the
one the game ships with, so nothing here depends on one monster."""
import json
import os

import numpy as np
import pytest

from creature_pipeline import pack as P
from creature_pipeline import quat
from creature_pipeline.gltf import read_gltf_json
from creature_pipeline.skeleton import Skeleton

HERE = os.path.dirname(__file__)
WOLF = os.path.join(HERE, "..", "examples", "wolf_skeleton.json")
FPS = 30.0


@pytest.fixture
def wolf():
    return Skeleton.load(WOLF)


def still(skel, seconds):
    T = int(seconds * FPS)
    local = np.tile(quat.identity(), (T, len(skel), 1))
    root = np.tile(skel.rest_positions[0], (T, 1))
    return local, root


def test_roles_from_structure(wolf):
    roles = P.bone_roles(wolf)
    assert roles["hip"] == "pelvis"
    assert sorted(roles["feet"]) == ["front_paw_L", "front_paw_R", "rear_paw_L", "rear_paw_R"]
    assert roles["head_tip"] == "snout" and roles["tail_tip"] == "tail_3"
    assert roles["jaw_tip"] == "snout"          # no jaw on this rig: falls back to the head tip


def test_roles_override(wolf):
    assert P.bone_roles(wolf, {"jaw_tip": "head"})["jaw_tip"] == "head"


def test_landing_is_when_the_feet_come_down(wolf):
    local, root = still(wolf, 3.0)
    up = (np.arange(len(root)) >= 30) & (np.arange(len(root)) < 45)      # airborne 1.0-1.5 s
    root[up, 1] += 0.3
    m = P.measure(wolf, P.bone_roles(wolf), local, root, FPS)
    assert P._runs(m["airborne"]) == [(30, 45)]
    t = P.event_time(m, 0, len(root) - 1, {"type": "landing", "which": "last"}, wolf)
    assert t == 45


def test_peak_speed_finds_the_strike(wolf):
    local, root = still(wolf, 3.0)
    neck = wolf.names.index("neck")
    t = np.arange(len(root)) / FPS
    angle = 0.6 / (1 + np.exp(-(t - 1.2) * 25))                         # fastest at 1.2 s
    local[:, neck] = quat.from_axis_angle(np.array([1.0, 0, 0]), angle)
    roles = P.bone_roles(wolf)
    m = P.measure(wolf, roles, local, root, FPS)
    f = P.event_time(m, 0, len(root) - 1, {"type": "peak_speed", "bone_name": roles["head_tip"]}, wolf)
    assert abs(f - 36) <= 1


def test_gait_speed_is_stride_per_cycle():
    # one foot planted half the cycle, sliding back 0.3 m under the body; cycle 0.6 s
    T, period = 120, 0.6
    t = np.arange(T) / FPS
    phase = (t / period) % 1.0
    z = np.where(phase < 0.5, 0.15 - 0.6 * phase, -0.15 + 0.6 * (phase - 0.5))   # stance: back, swing: forward
    rel = np.zeros((T, 2, 3))
    rel[:, 1, 2] = z
    m = {"fps": FPS, "rel": rel, "root": np.zeros((T, 3)), "feet_idx": [1],
         "contact": (phase < 0.5)[:, None]}
    speed, heading = P.treadmill_speed(m, 0, T, period)
    assert speed == pytest.approx(0.3 / period, rel=0.05)
    assert abs(heading) < 2                                  # forward


def test_gait_heading_sideways():
    T, period = 120, 0.6
    phase = (np.arange(T) / FPS / period) % 1.0
    x = np.where(phase < 0.5, -0.1 + 0.4 * phase, 0.1 - 0.4 * (phase - 0.5))     # feet slide to +x
    rel = np.zeros((T, 2, 3))
    rel[:, 1, 0] = x
    m = {"fps": FPS, "rel": rel, "root": np.zeros((T, 3)), "feet_idx": [1], "contact": (phase < 0.5)[:, None]}
    _, heading = P.treadmill_speed(m, 0, T, period)
    assert heading == pytest.approx(-90, abs=2)                  # body goes to -x


def test_pack_extracts_root_motion_and_writes_in_place_clips(wolf, tmp_path):
    local, root = still(wolf, 3.0)
    T = len(root)
    root[:, 2] += np.clip((np.arange(T) - 30) / 30, 0, 1) * 0.5        # 0.5 m forward during 1-2 s
    animset = {"name": "Test", "clips": {
        "dash": {"source": "dash", "kind": "oneshot", "rate": 1.2},
        "idle": {"source": "rest", "kind": "idle"},
        "walk": {"source": "nope", "kind": "loop"}},
        "fallbacks": {"walk": "idle"}}
    motions = {"dash": (local, root, FPS), "rest": still(wolf, 1.0) + (FPS,)}
    m = P.pack(wolf, animset, motions, str(tmp_path))
    dash = m["clips"]["dash"]
    assert dash["travel"] == pytest.approx(0.5, abs=0.01)
    assert dash["root_motion"][-1][1] == pytest.approx(0.5, abs=0.01)
    assert m["missing_clips"] == ["walk"] and m["fallbacks"] == {"walk": "idle"}
    gl = read_gltf_json(str(tmp_path / "clips" / "dash.glb"))
    assert gl["animations"][0]["name"] == "dash"
    with open(tmp_path / "monster.json") as f:
        assert json.load(f)["body"]["length"] > 0


def test_pack_refuses_slow_motion(wolf, tmp_path):
    animset = {"name": "Test", "clips": {"idle": {"source": "rest", "kind": "idle", "rate": 0.8}}}
    with pytest.raises(ValueError, match="slower"):
        P.pack(wolf, animset, {"rest": still(wolf, 1.0) + (FPS,)}, str(tmp_path))


def test_gait_going_the_wrong_way_is_rejected(wolf, tmp_path, monkeypatch):
    # a "strafe" that really walks forward must not be used as a strafe
    monkeypatch.setattr(P, "loop_window", lambda m: (0, m["T"] - 1, {"period_s": 0.5, "cycles": 2, "seam_error": 0.0}))
    monkeypatch.setattr(P, "treadmill_speed", lambda m, a, b, period: (0.5, 3.0))
    animset = {"name": "Test", "clips": {"strafe_left": {"source": "s", "kind": "loop", "heading": 90}},
               "fallbacks": {"strafe_left": "walk"}}
    m = P.pack(wolf, animset, {"s": still(wolf, 2.0) + (FPS,)}, str(tmp_path))
    assert "strafe_left" in m["rejected_clips"] and m["missing_clips"] == ["strafe_left"]
