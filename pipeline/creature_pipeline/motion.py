"""Random motion inside joint limits: used for synthetic training poses and for the exam."""
import numpy as np

from . import quat


def random_euler(skel, rng, n):
    """n independent random poses (n, J, 3) in radians, uniform inside each joint's limits."""
    lo, hi = skel.limits[..., 0], skel.limits[..., 1]
    return lo + (hi - lo) * rng.random((n,) + lo.shape)


def ground(skel, local, root):
    """Shift the root vertically so the lowest foot rests on the floor in every frame.

    Feet are joints within 5% of body height of the lowest rest joint; "on the floor" means at
    their rest height. Without this, random motion swings feet through the ground, which no
    real creature does and which would make the exam punish the solver's floor constraint.
    """
    pos, _ = skel.forward(local, root)
    rest_y = skel.rest_positions[:, 1]
    feet = [j for j in range(len(skel)) if rest_y[j] < rest_y.min() + 0.05 * skel.height()]
    lift = -(pos[:, feet, 1] - rest_y[feet]).min(axis=1)
    out = root.copy()
    out[:, 1] += lift
    return out


def random_motion(skel, rng, frames=120, fps=24, speed=1.0, travel=0.0, grounded=True):
    """Smooth random motion: every joint axis is a sum of three sines mapped into its limits.

    Returns local rotations (T, J, 4), root positions (T, 3), euler (T, J, 3).
    ``travel`` moves the root forward (+Z) in metres per second.
    """
    J = len(skel)
    t = np.arange(frames) / fps
    freq = rng.uniform(0.3, 1.8, (3, J, 3)) * speed
    phase = rng.uniform(0, 2 * np.pi, (3, J, 3))
    amp = rng.dirichlet(np.ones(3), (J, 3)).transpose(2, 0, 1)
    s = np.sum(amp[None] * np.sin(2 * np.pi * freq[None] * t[:, None, None, None] + phase[None]), axis=1)
    lo, hi = skel.limits[..., 0], skel.limits[..., 1]
    euler = lo + (hi - lo) * (0.5 + 0.5 * s)
    euler[:, 0] *= 0.3  # keep the root's tilt modest so the creature stays upright
    local = quat.from_euler_xyz(euler)
    root = np.tile(skel.rest_positions[0], (frames, 1))
    root[:, 2] += travel * t
    root[:, 1] += 0.03 * skel.height() * np.sin(2 * np.pi * 1.5 * speed * t)
    if grounded:
        root = ground(skel, local, root)
    return local, root, euler
