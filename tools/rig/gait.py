"""Run gait generator. Feet are placed in character space (in place: the game moves the root).
A foot in stance slides back at exactly the ground speed, so nothing skates when the root moves at V."""
import numpy as np
from drib import periodic

class Run:
    def __init__(self, T=0.60, stance=0.38, L=0.27, track=0.07, hip_h=-0.006, bob=0.030, lean=9):
        self.T, self.s, self.L, self.track, self.hip_h, self.bob, self.lean = T, stance, L, track, hip_h, bob, lean
        self.z0 = -0.03
        self.V = L / (stance * T)                         # ground speed the cycle is authored for (rig units / s)
        L2 = L / 2
        # swing path keys: (u, z, lift, pitch); pitch > 0 = heel up rolling over the toe, < 0 = toes up on the heel
        # toe-off -> heel kick (foot trails, mildly pointed) -> passing (foot level) -> reach (toes up) -> heel strike
        self.swing = [(0.00, -L2, 0.000, 45), (0.25, -L2 - 0.010, 0.100, 20), (0.50, 0.005, 0.125, 0),
                      (0.76, L2 + 0.035, 0.050, -14), (1.00, L2, 0.000, -14)]
    def foot(self, ph):
        """ph in [0,1): 0 = heel strike. returns z, lift, pitch"""
        s, L2 = self.s, self.L / 2
        if ph < s:
            u = ph / s
            z = L2 - self.L * u + self.z0
            # heel strike, roll flat by 20%, stay flat (heel down) until 75%, then peel onto the toe
            pitch = -14 * (1 - u / 0.2) ** 2 if u < 0.2 else 45 * ((u - 0.7) / 0.3) ** 2 if u > 0.7 else 0.0
            return z, 0.0, pitch
        u = (ph - s) / (1 - s); k = self.swing
        # monotone-ish catmull through keys (non periodic)
        us = [a[0] for a in k]; i = min(max(np.searchsorted(us, u) - 1, 0), len(k) - 2)
        def val(j, idx): return k[j][idx]
        out = []
        for idx in (1, 2, 3):
            p0, p1 = val(i, idx), val(i + 1, idx)
            pm = val(i - 1, idx) if i > 0 else p0 - (p1 - p0)
            pp = val(i + 2, idx) if i + 2 < len(k) else p1 + (p1 - p0)
            if i == 0 and idx == 1: pm = p0 + self.V * (us[1] - us[0]) * (self.T * (1 - s))  # leave the ground at stance speed
            if i + 2 >= len(k) and idx == 1: pp = p1 - self.V * (us[-1] - us[-2]) * (self.T * (1 - s))
            t0, t1 = us[i], us[i + 1]; tm = us[i - 1] if i > 0 else t0 - (t1 - t0); tp = us[i + 2] if i + 2 < len(k) else t1 + (t1 - t0)
            m0 = (p1 - pm) / (t1 - tm) * (t1 - t0); m1 = (pp - p0) / (tp - t0) * (t1 - t0); w = (u - t0) / (t1 - t0)
            out.append((2*w**3 - 3*w**2 + 1)*p0 + (w**3 - 2*w**2 + w)*m0 + (-2*w**3 + 3*w**2)*p1 + (w**3 - w**2)*m1)
        z, lift, pitch = out
        z += self.z0
        return z, max(lift, 0.0), pitch
