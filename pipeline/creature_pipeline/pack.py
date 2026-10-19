"""Monster pack: measure solved clips and write everything a game needs to drive the monster.

Input
  * the skeleton (skeleton.json) and the rig the clips play on (for the GLB root space)
  * one motion file per solved clip (``solve --motion``: local rotations, root, fps)
  * an animation set (animset.json): which source clip plays which role, and how to time it
  * the monster's move list (moves in animset.json), in body lengths so it scales to any size

Output (``out_dir``)
  * clips/<name>.glb  in-place clips: the hip's floor travel is taken out of every clip
  * monster.json      the manifest: body, bone roles, and per clip its timing, root motion,
                      airborne windows, events, strike-bone path, loop and locomotion speed

Everything is measured from the solved 3D motion, nothing is tuned per monster. Lengths are in
skeleton metres; the game scales them with the rig it loads.
"""
import json
import os
import shutil

import numpy as np

from . import quat

FOOT_LIFT = 0.06      # a foot higher than this fraction of body height above its planted height is off the floor
MIN_AIR = 0.08        # seconds; shorter lifts are not airborne
MAX_GAP = 0.12        # seconds; shorter touches inside an airborne phase are ignored
ROOT_SMOOTH = 0.08    # seconds; root motion is a body's path, so detector jitter is smoothed out


# --- bone roles ---------------------------------------------------------------
def _chains(skel):
    """Every root-to-leaf path, as joint index lists."""
    leaves = [j for j in range(len(skel)) if not skel.children[j]]
    out = []
    for leaf in leaves:
        path, j = [], leaf
        while j >= 0:
            path.append(j)
            j = skel.parents[j]
        out.append(path[::-1])
    return out


def smooth_path(x, sigma):
    """Gaussian low-pass along time, ends held (a path keeps where it starts and finishes)."""
    if sigma <= 0 or len(x) < 3:
        return x
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)])
    out = np.stack([np.convolve(pad[:, i], k, mode="valid") for i in range(x.shape[1])], 1)
    return out - out[0] + x[0]


def bone_roles(skel, overrides=None):
    """Find the hip, feet, tail, head tip and jaw tip from the skeleton's shape.

    Legs are chains ending at the floor; the tail is the non-leg chain reaching furthest back;
    the head tip is the non-leg leaf furthest forward; the jaw tip is a second forward leaf under
    the same head (if the rig has one). Bone names only break ties; ``overrides`` wins.
    """
    rest = skel.rest_positions
    h = skel.height()
    floor = rest[:, 1].min()
    chains = _chains(skel)
    leaves = [c[-1] for c in chains]
    feet = [l for l in leaves if rest[l, 1] - floor < 0.15 * h]
    others = [l for l in leaves if l not in feet]
    roles = {"hip": skel.names[0], "feet": [skel.names[f] for f in feet]}
    if others:
        tail = min(others, key=lambda l: rest[l, 2])
        head_tip = max(others, key=lambda l: (rest[l, 2], "head" in skel.names[l].lower()))
        roles["tail_tip"] = skel.names[tail]
        roles["head_tip"] = skel.names[head_tip]
        # the tail chain: joints on the tail leaf's path after it leaves the trunk
        path = next(c for c in chains if c[-1] == tail)
        trunk = set().union(*[set(c) for c in chains if c[-1] != tail])
        roles["tail"] = [skel.names[j] for j in path if j not in trunk]
        # jaw: another forward leaf sharing the head tip's parent chain
        head_path = set(next(c for c in chains if c[-1] == head_tip)[:-2])
        jaws = [l for l in others if l not in (head_tip, tail)
                and set(next(c for c in chains if c[-1] == l)) & head_path
                and rest[l, 2] > rest[0, 2] + 0.5 * (rest[head_tip, 2] - rest[0, 2])]
        named = [l for l in jaws if "jaw" in skel.names[l].lower()]
        roles["jaw_tip"] = skel.names[(named or jaws or [head_tip])[0]]
    roles.update(overrides or {})
    return roles


def body_shape(skel, roles):
    """Ground footprint as a capsule along the facing axis, relative to the hip (metres)."""
    rest = skel.rest_positions
    tail = {skel.names.index(n) for n in roles.get("tail", [])}
    body = np.array([rest[j] for j in range(len(skel)) if j not in tail])
    hip = rest[0]
    half_width = float(np.abs(body[:, 0] - hip[0]).max())
    radius = 1.15 * half_width                      # joints sit inside the flesh
    front = float(body[:, 2].max() - hip[2])
    back = float(body[:, 2].min() - hip[2])
    return {
        "radius": round(radius, 4),
        "front": round(front - 0.6 * radius, 4),     # capsule segment ends, along facing
        "back": round(min(back + radius, 0.0), 4),
        "length": round(front - back, 4),             # nose to rump, the size unit for moves
        "height": round(float(rest[:, 1].max() - rest[:, 1].min()), 4),
        "hip_height": round(float(hip[1] - rest[:, 1].min()), 4),
    }


# --- per-clip measurements ----------------------------------------------------
def _heading(q):
    f = quat.rotate(q, np.array([0.0, 0.0, 1.0]))
    return float(np.arctan2(f[0], f[2]))


def _yaw_matrix(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])    # rotates world into a frame turned by a


def measure(skel, roles, local, root, fps):
    """Motion facts for one clip: positions in the clip's start facing frame, contacts, energy."""
    pos, glob = skel.forward(local, root)
    T = len(local)
    yaw0 = _heading(glob[0, 0])
    R = _yaw_matrix(yaw0)
    pos = (pos - root[0] * [1, 0, 1]) @ R.T           # start at the origin, facing +Z
    rootp = pos[:, 0]
    h = skel.height()
    feet = [skel.names.index(n) for n in roles["feet"]]
    # each foot's planted height in this clip (solved feet rest a little above or below y=0)
    planted = np.percentile(pos[:, feet, 1], 10, axis=0)
    lift = pos[:, feet, 1] - planted
    contact = lift < FOOT_LIFT * h
    clean = lambda x: _min_runs(_fill_gaps(x, int(round(MAX_GAP * fps))), int(round(MIN_AIR * fps)))
    airborne = clean(~contact.any(1))                                   # every foot off the floor
    raised = clean((~contact).sum(1) >= int(np.ceil(len(feet) / 2)))   # half the feet up: rear, leap
    rel = pos - rootp[:, None]                         # pose relative to the hip
    vel = np.gradient(pos, axis=0) * fps
    energy = np.linalg.norm(vel, axis=-1).mean(1)
    return {"pos": pos, "rel": rel, "root": rootp, "contact": contact, "airborne": airborne, "raised": raised,
            "energy": energy, "fps": fps, "T": T, "h": h, "yaw": _unwrap_yaw(glob[:, 0], yaw0)}


def _unwrap_yaw(q_root, yaw0):
    a = np.array([_heading(q) for q in q_root]) - yaw0
    return np.unwrap(a)


def _min_runs(mask, n):
    out = mask.copy()
    for s, e in _runs(mask):
        if e - s < n:
            out[s:e] = False
    return out


def _fill_gaps(mask, n):
    out = mask.copy()
    runs = _runs(mask)
    for (s0, e0), (s1, e1) in zip(runs, runs[1:]):
        if s1 - e0 < n:
            out[e0:s1] = True
    return out


def _runs(mask):
    runs, start = [], None
    for i, m in enumerate(list(mask) + [False]):
        if m and start is None:
            start = i
        elif not m and start is not None:
            runs.append((start, i))
            start = None
    return runs


def active_window(m, pad_before=0.15, pad_after=0.3):
    """Frames where the clip actually moves (one-shot clips start and end in a still stance)."""
    e, fps = m["energy"], m["fps"]
    base = np.median(e[: max(3, int(0.4 * fps))])
    thr = base + 0.25 * (e.max() - base)
    on = np.flatnonzero(e > thr)
    s = max(0, on[0] - int(pad_before * fps))
    t = min(m["T"] - 1, on[-1] + int(pad_after * fps))
    return int(s), int(t)


def loop_window(m):
    """A gait loop cut at footfalls: from the first touchdown of the steadiest foot to its last
    touchdown, so every leg finishes every stroke inside the loop and the end pose is the start
    pose (the same moment of the stride). Nothing is trimmed mid-stride and nothing is blended."""
    fps, T = m["fps"], m["T"]
    e = m["energy"]
    steady = np.flatnonzero(e > 0.5 * np.median(e[int(0.5 * fps): T - int(0.5 * fps)]))
    lo = max(steady[0], int(0.3 * fps))
    best = None
    for j in range(m["contact"].shape[1]):
        c = m["contact"][:, j]
        td = [t for t in range(max(1, lo), T) if c[t] and not c[t - 1]]
        if len(td) < 3:
            continue
        gaps = np.diff(td)
        regular = np.std(gaps) / np.mean(gaps)            # 0 = perfectly even rhythm
        if best is None or regular < best[0]:
            best = (regular, td, j)
    if best is None:
        raise ValueError("gait has no regular footfalls to loop on")
    regular, td, j = best
    # all of the running: from the first footfall to the last one in the clip, nothing trimmed
    feet = m["feet_idx"]
    size = np.ptp(m["rel"][td[0]], axis=0).max()
    a, b = td[0], td[-1]
    worst = max(np.linalg.norm(m["rel"][a, f] - m["rel"][b, f]) for f in feet) / size
    F = m["rel"].reshape(T, -1)
    seam = float(worst)
    return int(a), int(b), {"period_s": round(float(np.mean(np.diff(td))) / fps, 3), "cycles": len(td) - 1,
                            "seam_error": round(seam, 4), "footfall_foot": int(j), "rhythm_spread": round(float(regular), 3)}


def _first_min(d):
    for i in range(1, len(d) - 1):
        if d[i] <= d[i - 1] and d[i] <= d[i + 1] and d[i] < 0.6 * d.max():
            return i
    return int(np.argmin(d))


def treadmill_speed(m, a, b, period_s):
    """Ground velocity an in-place gait implies: the body advances one stride per gait cycle.

    Direction: planted feet slide opposite to the way the body travels. Magnitude: the stride,
    each stepping foot's range of motion along that direction, over the cycle time. Feet that
    never lift (stiff in the solve) are left out.
    """
    fps, rel = m["fps"], m["rel"]
    slides, strides = [], []
    for j, f in enumerate(m["feet_idx"]):
        if m["contact"][a:b, j].mean() > 0.85:
            continue
        for s, e in _runs(m["contact"][a:b, j]):
            if e - s >= max(3, int(0.1 * fps)):
                slides.append(-(rel[a + e - 1, f, [0, 2]] - rel[a + s, f, [0, 2]]))
        strides.append(f)
    if not slides:
        return 0.0, 0.0
    d = np.sum(slides, axis=0)
    d = d / max(1e-9, np.linalg.norm(d))
    stride = np.median([np.ptp(rel[a:b, f][:, [0, 2]] @ d) for f in strides])
    g = d * stride / period_s
    root_v = (m["root"][b - 1] - m["root"][a])[[0, 2]] / max(1e-6, (b - 1 - a) / fps)
    g = g + root_v                                            # plus any real travel the clip has
    return float(np.linalg.norm(g)), float(np.degrees(np.arctan2(g[0], g[1])))


def _lull(e, lo, hi):
    lo, hi = max(0, lo), min(len(e) - 1, hi)
    return lo + int(np.argmin(e[lo:hi + 1])) if hi > lo else lo


def beat_window(m, a, b, event_frame, spec):
    """One beat around the key moment: from the lull before the wind-up to the lull after the
    recovery. Clips often repeat a move (three horn thrusts); the game wants exactly one."""
    e, fps = m["energy"], m["fps"]
    if spec["type"] == "peak_speed":
        s = _lull(e, event_frame - int(1.2 * fps), event_frame - int(0.12 * fps))
    else:
        s = a
    t = _lull(e, event_frame + int(0.15 * fps), event_frame + int(0.9 * fps))
    return max(a, s), max(min(b, t + int(0.1 * fps)), event_frame + 2)


def event_time(m, a, b, spec, skel):
    """Time (seconds from the segment start) of a clip's key moment."""
    fps = m["fps"]
    kind = spec["type"]
    if kind == "peak_speed":
        j = skel.names.index(spec["bone_name"])
        sp = np.linalg.norm(np.gradient(m["pos"][:, j], axis=0), axis=1) * fps
        t = a + int(np.argmax(sp[a:b]))
    elif kind == "landing":
        runs = [(s, e) for s, e in _runs(m["raised"][a:b])]
        if not runs:
            raise ValueError("clip never lifts its feet, so it has no landing")
        which = spec.get("which", "last")
        s, e = runs[-1] if which == "last" else runs[0] if which == "first" else max(runs, key=lambda r: r[1] - r[0])
        t = a + e
    elif kind == "start":
        t = a + int(spec.get("after", 0.1) * fps)
    else:
        raise ValueError(f"unknown event type {kind}")
    return t


# --- the pack -----------------------------------------------------------------
def pack(skel, animset, motions, out_dir, root_space=None, rig_path=None):
    """Write monster.json and in-place clips. ``motions``: {source name: (local, root, fps)}."""
    from .gltf import write_animation_glb
    roles = bone_roles(skel, animset.get("roles"))
    shape = body_shape(skel, roles)
    feet_idx = [skel.names.index(n) for n in roles["feet"]]
    clip_dir = os.path.join(out_dir, "clips")
    os.makedirs(clip_dir, exist_ok=True)
    for old in os.listdir(clip_dir):                  # this pack owns its clips: no stale ones
        if old.endswith((".glb", ".glb.b64.txt")):
            os.remove(os.path.join(clip_dir, old))
    manifest = {"name": animset["name"], "type": animset.get("type", "electric"), "roles": roles, "body": shape,
                "rest": {"hip": skel.rest_positions[0].round(5).tolist(),
                         "head_tip": skel.rest_positions[skel.names.index(roles["head_tip"])].round(5).tolist()},
                "clips": {}, "moves": animset.get("moves", {}), "stats": animset.get("stats", {}),
                "display": animset.get("display", {})}
    missing, rejected = [], {}
    for name, c in animset["clips"].items():
        if c["source"] not in motions:
            missing.append(name)
            continue
        local, root, fps = motions[c["source"]]
        m = measure(skel, roles, local, root, fps)
        m["feet_idx"] = feet_idx
        kind = c["kind"]
        rate = float(c.get("rate", 1.0))
        if rate < 1.0:
            raise ValueError(f"clip {name}: rate {rate} would play it slower than it was generated")
        info = {"kind": kind, "source": c["source"], "rate": rate}
        if kind == "loop":
            a, b, loop = loop_window(m)
            info["loop"] = loop
            speed, heading = treadmill_speed(m, a, b, loop["period_s"])
            info["speed"] = round(speed, 4)           # metres/second at 1x
            info["heading_deg"] = round(heading, 1)  # direction of travel relative to facing
            want = c.get("heading")
            if want is not None:
                off = abs((heading - want + 180) % 360 - 180)
                if off > 45 or speed < 0.05 * skel.extent():
                    # the generated gait does not go where its role needs (video models often
                    # fall back to walking forward): leave it out so the game uses the fallback
                    rejected[name] = (f"travels at {heading:.0f} deg, {speed:.2f} m/s; "
                                      f"needs {want:.0f} deg. Regenerate this clip.")
                    missing.append(name)
                    continue
        elif kind == "idle":
            a, b = 0, m["T"] - 1
        else:
            a, b = active_window(m)
            if c.get("window") == "first_airborne":
                runs = _runs(m["airborne"][a:b])
                if runs:
                    b = min(b, a + runs[0][1] + int(0.3 * fps))
            if kind == "hold":                        # e.g. knock-out: keep the final pose
                b = m["T"] - 1
        ev = None
        if "event" in c:
            spec = dict(c["event"])
            if "bone" in spec:
                spec["bone_name"] = roles[spec["bone"]]
            ev = event_time(m, a, b, spec, skel)
            a, b = beat_window(m, a, b, ev, spec)
        b = max(b, a + 2)
        seg = slice(a, b + 1)
        info["frames"] = [a, b]
        info["duration"] = round((b - a) / fps, 4)
        info["fps"] = fps
        # root motion: hip floor travel in the start facing frame, taken out of the clip
        travel = smooth_path(m["root"][seg] - m["root"][a], ROOT_SMOOTH * fps)
        step = max(1, int(round(fps / 30)))
        info["root_motion"] = np.round(travel[::step][:, [0, 2]], 4).tolist()
        info["root_motion_fps"] = fps / step
        info["travel"] = round(float(np.linalg.norm(travel[-1, [0, 2]])), 4)
        info["max_speed"] = round(float((np.linalg.norm(np.diff(travel[:, [0, 2]], axis=0), axis=1) * fps).max(initial=0)), 4)
        info["net_turn_deg"] = round(float(np.degrees(m["yaw"][b] - m["yaw"][a])), 1)
        info["airborne"] = [[round((s) / fps, 4), round((e) / fps, 4)] for s, e in _runs(m["airborne"][seg])]
        if ev is not None:
            info["event"] = round((ev - a) / fps, 4)
            if "bone" in spec:
                j = skel.names.index(spec["bone_name"])
                path = m["rel"][seg, j] + (m["root"][seg] - m["root"][a])   # strike point, start frame
                info["strike_bone"] = spec["bone"]
                info["strike_path"] = np.round(path[::step], 4).tolist()
                k = int(round(info["event"] * fps))
                info["reach"] = round(float(path[k, 2]), 4)             # forward of the hip at impact
        # in-place GLB of the segment: the game supplies floor travel from root_motion
        lr = local[seg].copy()
        rr = root[seg].copy()
        if kind == "loop":
            # a gait keeps its body motion within each stride (surge, sway); only the steady
            # drift across the loop is removed, since the game supplies the travel
            n = np.arange(len(rr)) / max(1, len(rr) - 1)
            for k in (0, 2):
                drift = rr[0, k] + (rr[-1, k] - rr[0, k]) * n
                rr[:, k] = rr[:, k] - drift + skel.rest_positions[0, k]
        else:
            rr[:, 0] = skel.rest_positions[0, 0]
            rr[:, 2] = skel.rest_positions[0, 2]
        write_animation_glb(os.path.join(out_dir, "clips", f"{name}.glb"), skel, lr, rr, fps,
                            clip_name=name, root_space=root_space)
        manifest["clips"][name] = info
    manifest["missing_clips"] = missing
    manifest["rejected_clips"] = rejected
    manifest["fallbacks"] = {k: v for k, v in animset.get("fallbacks", {}).items() if k in missing}
    if rig_path:
        shutil.copy(rig_path, os.path.join(out_dir, os.path.basename(rig_path)))
        manifest["rig"] = os.path.basename(rig_path)
    with open(os.path.join(out_dir, "monster.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    return manifest
