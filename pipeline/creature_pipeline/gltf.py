"""Read a rig out of a glTF/GLB and write solved animation as a GLB clip for three.js.

The exported GLB holds one node per joint (same names as the source rig) and a single
animation. In three.js, load it with GLTFLoader and play ``gltf.animations[0]`` with an
AnimationMixer on the creature's own scene: tracks bind to bones by name.
"""
import json
import struct

import numpy as np

from . import quat
from .retarget import rig_local_offsets, to_rig_frames
from .skeleton import Joint, Skeleton

FLOAT, SCALAR, VEC3, VEC4 = 5126, "SCALAR", "VEC3", "VEC4"


# --- reading ---------------------------------------------------------------
def read_gltf_json(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] == b"glTF":
        length = struct.unpack_from("<I", data, 12)[0]
        return json.loads(data[20:20 + length])
    return json.loads(data)


def _node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], float).reshape(4, 4).T
    m = np.eye(4)
    r = quat.to_matrix(np.array(node.get("rotation", [0, 0, 0, 1]), float))
    m[:3, :3] = r * np.array(node.get("scale", [1, 1, 1]), float)
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def skeleton_from_gltf(path, skin_index=0, name=None):
    """Build a Skeleton from a glTF skin (e.g. a UniRig output or any rigged model)."""
    gl = read_gltf_json(path)
    nodes = gl["nodes"]
    joint_ids = gl["skins"][skin_index]["joints"]
    parent_of = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent_of[c] = i
    world = {}

    def world_of(i):
        if i not in world:
            p = parent_of.get(i)
            world[i] = _node_matrix(nodes[i]) if p is None else world_of(p) @ _node_matrix(nodes[i])
        return world[i]

    in_skin = set(joint_ids)
    joints = []
    index = {nid: k for k, nid in enumerate(joint_ids)}
    for nid in joint_ids:
        m = world_of(nid)
        rot = m[:3, :3] / np.linalg.norm(m[:3, :3], axis=0)
        p = parent_of.get(nid)
        while p is not None and p not in in_skin:
            p = parent_of.get(p)
        joints.append(Joint(nodes[nid].get("name", f"joint_{nid}"), index[p] if p is not None else -1,
                            m[:3, 3].copy(), quat.from_matrix(rot)))
    return Skeleton(joints, name or gl.get("asset", {}).get("extras", {}).get("name", "creature"))


# --- writing ---------------------------------------------------------------
class _Buffer:
    def __init__(self):
        self.blob = bytearray()
        self.views, self.accessors = [], []

    def add(self, array, type_, with_bounds=False):
        a = np.ascontiguousarray(array, dtype=np.float32)
        while len(self.blob) % 4:
            self.blob.append(0)
        self.views.append({"buffer": 0, "byteOffset": len(self.blob), "byteLength": a.nbytes})
        self.blob += a.tobytes()
        acc = {"bufferView": len(self.views) - 1, "componentType": FLOAT, "count": len(a), "type": type_}
        if with_bounds:
            flat = a.reshape(len(a), -1)
            acc["min"], acc["max"] = flat.min(0).tolist(), flat.max(0).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1


def write_animation_glb(path, skel, local, root, fps, clip_name="clip", root_space=None):
    """local (T, J, 4) identity-rest rotations and root (T, 3) world positions -> GLB.

    ``root_space`` (4x4) maps pipeline space into the root bone's parent space of the model the
    clip will play on (see fbx.root_parent_space). Omit it for a glTF model in metres, Y up,
    whose root bone has no transformed parent.
    """
    T = len(local)
    rig_rot = to_rig_frames(skel, local)
    root = np.asarray(root, float)
    if root_space is not None:
        S = np.asarray(root_space, float)
        lin = S[:3, :3]
        q_space = quat.from_matrix(lin / np.linalg.norm(lin, axis=0))
        root = root @ lin.T + S[:3, 3]
        rig_rot = rig_rot.copy()
        rig_rot[:, 0] = quat.mul(np.broadcast_to(q_space, (T, 4)), rig_rot[:, 0])
    offsets = rig_local_offsets(skel)
    W = np.array([j.rest_rotation for j in skel.joints])

    nodes = []
    for j, p in enumerate(skel.parents):
        rest_local = W[j] if p < 0 else quat.mul(quat.conj(W[p]), W[j])
        nodes.append({"name": skel.names[j],
                      "translation": (skel.rest_positions[0] if p < 0 else offsets[j]).tolist(),
                      "rotation": quat.normalize(rest_local).tolist()})
    for j, kids in enumerate(skel.children):
        if kids:
            nodes[j]["children"] = kids

    buf = _Buffer()
    times = buf.add(np.arange(T) / fps, SCALAR, with_bounds=True)
    samplers, channels = [], []
    for j in range(len(skel)):
        samplers.append({"input": times, "output": buf.add(rig_rot[:, j], VEC4), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": j, "path": "rotation"}})
    samplers.append({"input": times, "output": buf.add(root, VEC3), "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": 0, "path": "translation"}})

    gl = {
        "asset": {"version": "2.0", "generator": "creature_pipeline"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes,
        "animations": [{"name": clip_name, "samplers": samplers, "channels": channels}],
        "buffers": [{"byteLength": len(buf.blob)}],
        "bufferViews": buf.views, "accessors": buf.accessors,
    }
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bin_ = bytes(buf.blob) + b"\0" * (-len(buf.blob) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(bin_), b"BIN\0") + bin_)
