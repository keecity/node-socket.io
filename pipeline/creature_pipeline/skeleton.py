"""Skeleton definition and forward kinematics.

Convention: glTF world (Y up, creature faces +Z, metres). Animation rotations are stored
relative to an identity rest pose, i.e. at rest every joint's global rotation is identity
and bones are described only by their rest offsets. ``rest_rotation`` keeps the source
rig's own bone orientation so exporters can convert back into that rig's frames.
"""
import json
from dataclasses import dataclass, field

import numpy as np

from . import quat

DEFAULT_LIMIT_DEG = 45.0


@dataclass
class Joint:
    name: str
    parent: int  # -1 for the root
    position: np.ndarray  # rest position, world space
    rest_rotation: np.ndarray = field(default_factory=lambda: quat.identity())
    limits_deg: np.ndarray = field(default_factory=lambda: np.full((3, 2), [-DEFAULT_LIMIT_DEG, DEFAULT_LIMIT_DEG]))


class Skeleton:
    def __init__(self, joints, name="creature"):
        self.name = name
        self.joints = self._parents_first(joints)
        self.names = [j.name for j in self.joints]
        self.parents = np.array([j.parent for j in self.joints])
        rest = np.array([j.position for j in self.joints], float)
        self.rest_positions = rest
        self.offsets = np.array([rest[i] - rest[p] if p >= 0 else rest[i] for i, p in enumerate(self.parents)])
        self.children = [[c for c, p in enumerate(self.parents) if p == i] for i in range(len(self.joints))]
        self.limits = np.radians(np.array([j.limits_deg for j in self.joints], float))

    def __len__(self):
        return len(self.joints)

    @staticmethod
    def _parents_first(joints):
        """Reorder joints so every parent precedes its children, remapping parent indices."""
        order, placed = [], set()
        while len(order) < len(joints):
            progressed = False
            for i, j in enumerate(joints):
                if i not in placed and (j.parent < 0 or j.parent in placed):
                    order.append(i)
                    placed.add(i)
                    progressed = True
            if not progressed:
                raise ValueError("skeleton has a cycle or a missing parent")
        if sum(joints[i].parent < 0 for i in order) != 1:
            raise ValueError("skeleton needs exactly one root joint")
        remap = {old: new for new, old in enumerate(order)}
        out = []
        for old in order:
            j = joints[old]
            out.append(Joint(j.name, remap[j.parent] if j.parent >= 0 else -1,
                             np.asarray(j.position, float), np.asarray(j.rest_rotation, float),
                             np.asarray(j.limits_deg, float)))
        return out

    # --- serialisation -------------------------------------------------
    @classmethod
    def load(cls, path):
        with open(path) as f:
            data = json.load(f)
        index = {j["name"]: i for i, j in enumerate(data["joints"])}
        joints = []
        for j in data["joints"]:
            joints.append(Joint(
                name=j["name"],
                parent=index[j["parent"]] if j.get("parent") else -1,
                position=np.array(j["position"], float),
                rest_rotation=np.array(j.get("rest_rotation", [0, 0, 0, 1]), float),
                limits_deg=np.array(j.get("limits", [[-DEFAULT_LIMIT_DEG, DEFAULT_LIMIT_DEG]] * 3), float),
            ))
        return cls(joints, data.get("name", "creature"))

    def save(self, path):
        data = {"name": self.name, "joints": [{
            "name": j.name,
            "parent": self.names[j.parent] if j.parent >= 0 else None,
            "position": [round(float(v), 6) for v in j.position],
            "rest_rotation": [round(float(v), 6) for v in j.rest_rotation],
            "limits": j.limits_deg.tolist(),
        } for j in self.joints]}
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    # --- kinematics ----------------------------------------------------
    def forward(self, local_rot, root_pos):
        """local_rot (T, J, 4), root_pos (T, 3) -> global positions (T, J, 3) and rotations (T, J, 4)."""
        T, J = local_rot.shape[:2]
        pos = np.zeros((T, J, 3))
        glob = np.zeros((T, J, 4))
        for j, p in enumerate(self.parents):
            if p < 0:
                glob[:, j] = local_rot[:, j]
                pos[:, j] = root_pos
            else:
                glob[:, j] = quat.mul(glob[:, p], local_rot[:, j])
                pos[:, j] = pos[:, p] + quat.rotate(glob[:, p], np.broadcast_to(self.offsets[j], (T, 3)))
        return pos, glob

    def clamp_to_limits(self, euler):
        return np.clip(euler, self.limits[..., 0], self.limits[..., 1])

    def bone_length(self):
        return float(np.mean(np.linalg.norm(self.offsets[1:], axis=-1)))

    def height(self):
        return float(np.ptp(self.rest_positions[:, 1]))
