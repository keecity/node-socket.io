"""Pinhole cameras and the two-view "front + side in one picture" rig.

The video model is prompted with a single image holding two views side by side
(front on the left, side on the right). Generating both views in one clip keeps them
in sync, which two separate generations never are. Each half is one ``Camera``.
Camera convention is OpenCV: x right, y down, z forward.
"""
import json
from dataclasses import dataclass

import numpy as np


@dataclass
class Camera:
    name: str
    K: np.ndarray  # 3x3 intrinsics
    R: np.ndarray  # 3x3 world -> camera
    t: np.ndarray  # 3
    width: int
    height: int

    @property
    def P(self):
        return self.K @ np.hstack([self.R, self.t[:, None]])

    @property
    def center(self):
        return -self.R.T @ self.t

    def project(self, X):
        """World points (..., 3) -> pixels (..., 2) and depth (...)."""
        cam = X @ self.R.T + self.t
        uv = cam @ self.K.T
        return uv[..., :2] / uv[..., 2:3], cam[..., 2]

    def to_dict(self):
        return {"name": self.name, "K": self.K.tolist(), "R": self.R.tolist(), "t": self.t.tolist(),
                "width": self.width, "height": self.height}

    @classmethod
    def from_dict(cls, d):
        return cls(d["name"], np.array(d["K"]), np.array(d["R"]), np.array(d["t"]), d["width"], d["height"])


def look_at(name, eye, target, fov_deg, width, height, up=(0.0, 1.0, 0.0)):
    eye, target, up = (np.asarray(v, float) for v in (eye, target, up))
    z = target - eye
    z /= np.linalg.norm(z)
    x = np.cross(z, up)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    R = np.stack([x, y, z])
    f = 0.5 * width / np.tan(np.radians(fov_deg) / 2)
    K = np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1.0]])
    return Camera(name, K, R, -R @ eye, width, height)


def stereo_rig(subject_height, view_width=640, view_height=640, fov_deg=35.0, margin=2.2):
    """Front camera on +Z looking back at the creature, side camera on +X. Distance frames the subject."""
    dist = margin * subject_height / (2 * np.tan(np.radians(fov_deg) / 2))
    target = np.array([0.0, subject_height / 2, 0.0])
    front = look_at("front", target + [0, 0, dist], target, fov_deg, view_width, view_height)
    side = look_at("side", target + [dist, 0, 0], target, fov_deg, view_width, view_height)
    return [front, side]


def save_rig(cams, path):
    with open(path, "w") as f:
        json.dump([c.to_dict() for c in cams], f, indent=2)


def load_rig(path):
    with open(path) as f:
        return [Camera.from_dict(d) for d in json.load(f)]


def split_side_by_side(frame, n_views=2):
    """Cut one composite frame (H, n*W, C) into its per-camera halves."""
    w = frame.shape[1] // n_views
    return [frame[:, i * w:(i + 1) * w] for i in range(n_views)]
