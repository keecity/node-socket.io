"""Physically driven dribble. Timeline of one cycle (t=0 is the catch):
   contact [0, Tc]: hand rides the rising ball up, absorbs it, then pushes it down (ball glued under the palm)
   free   [Tc, T): ball leaves with the hand's velocity, falls, bounces, rises into the waiting hand."""
import numpy as np
from anim import BALL_R

G, E = 4.4, 0.80          # gravity (rig units, character ~0.9 tall) and floor restitution

def herm(p0, v0, p1, v1, T, t):
    u = t / T; h00 = 2*u**3 - 3*u**2 + 1; h10 = u**3 - 2*u**2 + u; h01 = -2*u**3 + 3*u**2; h11 = u**3 - u**2
    return h00*p0 + h10*T*v0 + h01*p1 + h11*T*v1

def periodic(keys, period, t):
    """Catmull-Rom through (t, value) keys, periodic."""
    ts = [k[0] for k in keys]; vs = [np.asarray(k[1], float) for k in keys]; n = len(keys); t = t % period
    i = max(j for j in range(n) if ts[j] <= t) if t >= ts[0] else n - 1
    t0 = ts[i]; t1 = ts[(i + 1) % n] + (period if i == n - 1 else 0)
    tm = ts[i - 1] - (period if i == 0 else 0); tp = ts[(i + 2) % n] + (period if i + 2 >= n else 0) + (period if i == n - 1 else 0)
    p0, p1, pm, pp = vs[i], vs[(i + 1) % n], vs[i - 1], vs[(i + 2) % n]
    m0 = (p1 - pm) / (t1 - tm); m1 = (pp - p0) / (tp - t0)
    tt = t if t >= t0 else t + period
    return herm(p0, m0, p1, m1, t1 - t0, tt - t0)

class Dribble:
    def __init__(self, base=(-0.26, 0.13), rel_y=0.235, vrel_y=-1.95, catch_y=0.25, Tc=0.27, bounce_fwd=0.035, bounce_out=-0.02):
        self.base = np.array([base[0], 0, base[1]]); self.Tc = Tc
        self.rel = self.base + np.array([0, rel_y, 0]); self.catch = self.base + np.array([0, catch_y, 0])
        self.floor = self.base + np.array([bounce_out, BALL_R, bounce_fwd])
        h = rel_y - BALL_R
        self.t1 = (vrel_y + np.sqrt(vrel_y**2 + 2 * G * h)) / G          # time to the floor
        vimp = vrel_y - G * self.t1; vup = -vimp * E
        hc = catch_y - BALL_R
        self.t2 = (vup - np.sqrt(vup**2 - 2 * G * hc)) / G               # floor -> catch
        self.vrel = np.array([(self.floor[0] - self.rel[0]) / self.t1, vrel_y, (self.floor[2] - self.rel[2]) / self.t1])
        self.vup = np.array([(self.catch[0] - self.floor[0]) / self.t2, vup, (self.catch[2] - self.floor[2]) / self.t2])
        self.vcatch = self.vup - np.array([0, G * self.t2, 0])
        self.T = Tc + self.t1 + self.t2
    def ball(self, t):
        t = t % self.T
        if t <= self.Tc: return herm(self.catch, self.vcatch, self.rel, self.vrel, self.Tc, t), True
        s = t - self.Tc
        if s <= self.t1: return self.rel + self.vrel * s + np.array([0, -0.5 * G * s * s, 0]), False
        s -= self.t1
        return self.floor + self.vup * s + np.array([0, -0.5 * G * s * s, 0]), False
    def wrist(self, t):
        """wrist flexion in degrees (+ = fingers snap down over the ball)"""
        Tc, T = self.Tc, self.T
        return periodic([(0.0, -8), (Tc * 0.45, -24), (Tc * 0.85, 8), (Tc + 0.03, 32), (Tc + 0.075, 38), (T - 0.045, -2)], T, t)
    def grip(self, th):
        """ball centre -> palm direction for wrist angle th (palm slides from top-back to top-front)"""
        a = np.radians(th * 0.55); return np.array([0.12, np.cos(a), np.sin(a)]) / np.sqrt(1 + 0.0144)
    def hand(self, t):
        """palm position, palm normal, finger direction (character space)"""
        t = t % self.T; th = self.wrist(t); g = self.grip(th)
        a = np.radians(th)
        fing = np.array([0.05, -np.sin(a), np.cos(a)])
        if t <= self.Tc:
            b, _ = self.ball(t); return b + g * BALL_R, -g, fing, True
        # free: hermite from the release palm state to the catch palm state, with a follow-through dip
        Tf = self.T - self.Tc; s = t - self.Tc
        g0, g1 = self.grip(self.wrist(self.Tc)), self.grip(self.wrist(0.0))
        p0 = self.rel + g0 * BALL_R; p1 = self.catch + g1 * BALL_R
        v0 = self.vrel * 0.85; v1 = self.vcatch * 0.9
        p = herm(p0, v0, p1, v1, Tf, s)
        n = -g; return p, n, fing, False

if __name__ == '__main__':
    d = Dribble(); print('period', round(d.T, 3), 'contact', d.Tc, 'fall', round(d.t1, 3), 'rise', round(d.t2, 3), 'vcatch', d.vcatch.round(2), 'vup', d.vup.round(2))
    for i in range(0, 24):
        t = d.T * i / 24; b, c = d.ball(t); p, n, f, c2 = d.hand(t)
        print(f'{t:.3f} ball_y={b[1]:.3f} palm_y={p[1]:.3f} gap={p[1]-b[1]-BALL_R:+.3f} wrist={d.wrist(t):5.1f} {"C" if c else ""}')
