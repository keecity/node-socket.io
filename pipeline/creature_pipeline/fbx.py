"""Minimal binary FBX reader (7.x) -> Skeleton, so an artist's rig can be used without Blender.

Reads LimbNode/Root/Null models, their parenting from Connections, and the bone transform
properties (Lcl Translation/Rotation, PreRotation, PostRotation, RotationOrder). Units follow
GlobalSettings UnitScaleFactor (FBX default is centimetres) and the file's up axis is converted
to glTF's Y-up / +Z-forward convention.
"""
import struct
import zlib

import numpy as np

from . import quat
from .skeleton import Joint, Skeleton


class Node:
    __slots__ = ("name", "props", "children")

    def __init__(self, name, props, children):
        self.name, self.props, self.children = name, props, children

    def find(self, name):
        return next((c for c in self.children if c.name == name), None)

    def find_all(self, name):
        return [c for c in self.children if c.name == name]


_ARRAY = {b"f": ("f", 4), b"d": ("d", 8), b"l": ("q", 8), b"i": ("i", 4), b"b": ("?", 1)}


def _read_prop(data, pos):
    t = data[pos:pos + 1]
    pos += 1
    if t == b"Y":
        return struct.unpack_from("<h", data, pos)[0], pos + 2
    if t == b"C":
        return bool(data[pos]), pos + 1
    if t == b"I":
        return struct.unpack_from("<i", data, pos)[0], pos + 4
    if t == b"F":
        return struct.unpack_from("<f", data, pos)[0], pos + 4
    if t == b"D":
        return struct.unpack_from("<d", data, pos)[0], pos + 8
    if t == b"L":
        return struct.unpack_from("<q", data, pos)[0], pos + 8
    if t in (b"S", b"R"):
        n = struct.unpack_from("<I", data, pos)[0]
        raw = data[pos + 4:pos + 4 + n]
        return (raw.decode("utf-8", "replace") if t == b"S" else raw), pos + 4 + n
    if t in _ARRAY:
        count, enc, clen = struct.unpack_from("<III", data, pos)
        pos += 12
        raw = data[pos:pos + clen]
        if enc:
            raw = zlib.decompress(raw)
        fmt, _ = _ARRAY[t]
        return np.frombuffer(raw, dtype="<" + fmt if fmt != "?" else bool, count=count), pos + clen
    raise ValueError(f"unknown FBX property type {t!r} at {pos - 1}")


def _read_node(data, pos, wide):
    if wide:
        end, nprops, _plen = struct.unpack_from("<QQQ", data, pos)
        pos += 24
    else:
        end, nprops, _plen = struct.unpack_from("<III", data, pos)
        pos += 12
    nlen = data[pos]
    name = data[pos + 1:pos + 1 + nlen].decode()
    pos += 1 + nlen
    if end == 0:
        return None, pos
    props = []
    for _ in range(nprops):
        p, pos = _read_prop(data, pos)
        props.append(p)
    children = []
    sentinel = 25 if wide else 13
    while end - pos > sentinel:
        child, pos = _read_node(data, pos, wide)
        if child is None:
            break
        children.append(child)
    return Node(name, props, children), end


def parse(path):
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(b"Kaydara FBX Binary"):
        raise ValueError("only binary FBX is supported; re-export as binary FBX or GLB")
    version = struct.unpack_from("<I", data, 23)[0]
    wide = version >= 7500
    pos, top = 27, []
    while pos < len(data):
        node, pos = _read_node(data, pos, wide)
        if node is None:
            break
        top.append(node)
    return Node("root", [], top), version


def _props70(node):
    out = {}
    p70 = node.find("Properties70")
    for p in (p70.children if p70 else []):
        out[p.props[0]] = p.props[4:] if len(p.props) > 4 else p.props[1:]
    return out


_ORDERS = ["XYZ", "XZY", "YZX", "YXZ", "ZXY", "ZYX"]


def _euler_matrix(deg, order="XYZ"):
    """FBX Euler: for order XYZ the matrix is Rz @ Ry @ Rx (X applied first)."""
    r = np.radians(np.asarray(deg, float))
    axes = {"X": np.array([1.0, 0, 0]), "Y": np.array([0, 1.0, 0]), "Z": np.array([0, 0, 1.0])}
    m = np.eye(3)
    for ax in order:
        i = "XYZ".index(ax)
        m = quat.to_matrix(quat.from_axis_angle(axes[ax], r[i])) @ m
    return m


def local_matrix(props):
    """Bone local transform from FBX properties (scaling pivots ignored, which rigs rarely use)."""
    t = np.array(props.get("Lcl Translation", (0, 0, 0)), float)
    order = _ORDERS[int(props.get("RotationOrder", (0,))[0])]
    rot = _euler_matrix(props.get("Lcl Rotation", (0, 0, 0)), order)
    pre = _euler_matrix(props.get("PreRotation", (0, 0, 0)))
    post = _euler_matrix(props.get("PostRotation", (0, 0, 0)))
    s = np.array(props.get("Lcl Scaling", (1, 1, 1)), float)
    m = np.eye(4)
    m[:3, :3] = pre @ rot @ np.linalg.inv(post) @ np.diag(s)
    m[:3, 3] = t
    return m


def _axis_matrix(settings):
    """FBX file axes -> glTF (X right, Y up, Z forward)."""
    def axis(name, default):
        a = int(settings.get(name, (default,))[0])
        sign = int(settings.get(name + "Sign", (1,))[0])
        v = np.zeros(3)
        v[a] = sign
        return v
    up = axis("UpAxis", 1)
    front = axis("FrontAxis", 2)
    right = axis("CoordAxis", 0)
    # Rows: where file vectors go in glTF space.
    return np.stack([right, up, front])


def summarize(path):
    root, version = parse(path)
    objects = root.find("Objects")
    kinds = {}
    for o in objects.children:
        sub = o.props[2] if len(o.props) > 2 else ""
        kinds[f"{o.name}:{sub}"] = kinds.get(f"{o.name}:{sub}", 0) + 1
    return version, kinds


def skeleton_from_fbx(path, name=None):
    root, _ = parse(path)
    settings = _props70(root.find("GlobalSettings"))
    unit = float(settings.get("UnitScaleFactor", (1.0,))[0]) / 100.0  # -> metres
    axes = _axis_matrix(settings)

    objects = root.find("Objects")
    models = {}
    for o in objects.find_all("Model"):
        if o.props[2] in ("LimbNode", "Root", "Null"):
            models[o.props[0]] = (o.props[1].split("\x00")[0], o.props[2], _props70(o))
    parent = {}
    for c in root.find("Connections").children:
        # Bones are also linked to skin clusters; only model-to-model links are hierarchy.
        if c.props[0] == "OO" and c.props[1] in models and c.props[2] in models:
            parent[c.props[1]] = c.props[2]

    bones = {k: v for k, v in models.items() if v[1] == "LimbNode"}
    if not bones:
        raise ValueError("no LimbNode bones found in FBX")
    world = {}

    def world_of(uid):
        if uid not in world:
            m = local_matrix(models[uid][2]) if uid in models else np.eye(4)
            p = parent.get(uid)
            world[uid] = world_of(p) @ m if p in models else m
        return world[uid]

    ids = list(bones)
    index = {uid: i for i, uid in enumerate(ids)}
    joints = []
    for uid in ids:
        m = world_of(uid)
        pos = axes @ (m[:3, 3] * unit)
        # Bone axes expressed in glTF world coordinates, so parent-relative rotations stay those of the file.
        rot = axes @ (m[:3, :3] / np.linalg.norm(m[:3, :3], axis=0))
        p = parent.get(uid)
        while p is not None and p not in bones:
            p = parent.get(p)
        joints.append(Joint(bones[uid][0], index[p] if p is not None else -1, pos, quat.from_matrix(rot)))
    roots = [j for j in joints if j.parent < 0]
    if len(roots) > 1:  # several top-level bones: hang them under a synthetic root
        joints.insert(0, Joint("root", -1, np.zeros(3)))
        for j in joints[1:]:
            j.parent = 0 if j.parent < 0 else j.parent + 1
    return Skeleton(joints, name or "creature")


def root_parent_space(path):
    """4x4 taking pipeline (glTF, metres) points into the local space of the root bone's parent
    as a loader such as three.js FBXLoader sees the file (file units and axes, no conversion).
    Pass it to gltf.write_animation_glb(root_space=...) when the game loads this FBX directly.
    """
    root, _ = parse(path)
    settings = _props70(root.find("GlobalSettings"))
    unit = float(settings.get("UnitScaleFactor", (1.0,))[0]) / 100.0
    axes = _axis_matrix(settings)
    objects = root.find("Objects")
    models = {o.props[0]: o for o in objects.find_all("Model")}
    parent = {}
    for c in root.find("Connections").children:
        if c.props[0] == "OO" and c.props[1] in models and c.props[2] in models:
            parent[c.props[1]] = c.props[2]
    bones = [uid for uid, o in models.items() if o.props[2] == "LimbNode"]
    top = next(uid for uid in bones if parent.get(uid) not in bones)
    chain, p = np.eye(4), parent.get(top)
    while p is not None:
        chain = local_matrix(_props70(models[p])) @ chain
        p = parent.get(p)
    to_file = np.eye(4)
    to_file[:3, :3] = axes.T / unit
    return np.linalg.inv(chain) @ to_file
