"""Anatomical joint limits from bone names.

Rest frames are world aligned (X across the body, Y up, Z forward), so for every bone:
X is the pitch/hinge axis (a positive X rotation tips a forward-pointing bone down),
Y turns the bone left/right (or twists a vertical leg bone), and Z rolls a horizontal bone
(or swings a vertical leg bone sideways). Each rule gives (min, max) degrees for X, Y, Z;
the first rule whose keywords all appear in the lower-cased bone name wins. Unmatched
bones keep the limits they already have. Edit skeleton.json afterwards to fine-tune.
"""
import numpy as np

RULES = [
    # end-of-chain markers only carry tips; they should not rotate
    (("nub",), [[0, 0], [0, 0], [0, 0]]),
    # jaw: a pure hinge, locked sideways and in roll. Both directions: many rigs rest with the
    # mouth part open, so closing goes past rest (this rig's attack spans about -19..+11 deg).
    (("jaw",), [[-30, 35], [0, 0], [0, 0]]),
    (("head",), [[-30, 30], [-30, 30], [-8, 8]]),
    (("neck",), [[-30, 30], [-30, 30], [-8, 8]]),
    (("spine",), [[-20, 20], [-20, 20], [-8, 8]]),
    (("chest",), [[-15, 15], [-15, 15], [-6, 6]]),
    (("tail",), [[-30, 30], [-35, 35], [-4, 4]]),
    # legs: lower segments are near-hinges, upper segments swing and splay a little
    (("lower", "leg"), [[-60, 60], [-5, 5], [-5, 5]]),
    (("upper", "leg"), [[-45, 45], [-10, 10], [-15, 15]]),
    (("foot",), [[-45, 45], [-8, 8], [-8, 8]]),
    (("paw",), [[-45, 45], [-8, 8], [-8, 8]]),
    (("knee",), [[-60, 60], [-5, 5], [-5, 5]]),
    (("elbow",), [[-60, 60], [-5, 5], [-5, 5]]),
    (("hock",), [[-60, 60], [-5, 5], [-5, 5]]),
    (("wrist",), [[-45, 45], [-8, 8], [-8, 8]]),
    (("shoulder",), [[-45, 45], [-10, 10], [-15, 15]]),
    (("thigh",), [[-45, 45], [-10, 10], [-15, 15]]),
]


# Extra rotational smoothing for joints whose noise shows most on screen. The jaw rides on the
# head, so a jittery head nod reads as a loose jaw.
# The jaw is excluded: smoothing it flattens a quick bite.
SMOOTHING = [(("head",), 40.0), (("neck",), 10.0)]


def smoothing_scale(skel):
    """Per-joint multiplier for the solver's rotational smoothing, from bone names."""
    out = np.ones(len(skel))
    for i, j in enumerate(skel.joints):
        name = j.name.lower()
        for keys, k in SMOOTHING:
            if all(key in name for key in keys) and "nub" not in name:
                out[i] = k
                break
    return out


def anatomical_limits(skel):
    """Return a copy of the skeleton's joint limits (degrees, J x 3 x 2) with name rules applied."""
    limits = np.array([j.limits_deg for j in skel.joints], float)
    matched = []
    for i, j in enumerate(skel.joints):
        if j.parent < 0:
            continue
        name = j.name.lower()
        for keys, lim in RULES:
            if all(k in name for k in keys):
                limits[i] = lim
                matched.append(j.name)
                break
    return limits, matched


def apply(skel):
    """Set anatomical limits on the skeleton in place; returns names of bones that matched a rule."""
    limits, matched = anatomical_limits(skel)
    for j, lim in zip(skel.joints, limits):
        j.limits_deg = lim
    skel.limits = np.radians(limits)
    return matched
