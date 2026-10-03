from anim import *
from anim import sstep_

def hold_ball(spread=1.0):
    """both palms on the sides of the ball, fingers forward-up"""
    return {'hwL': [1], 'hwR': [1], 'hgL': [0.95, -0.2, -0.25], 'hgR': [-0.95, -0.2, -0.25],
            'hfL': [-0.15, 0.25, 1], 'hfR': [0.15, 0.25, 1], 'heL': [0.6, -1, -0.3], 'heR': [-0.6, -1, -0.3]}

READY = {'fL': [0.118, 0, 0.025], 'frL': [0, 5], 'fR': [-0.118, 0, -0.01], 'frR': [0, -5],
         'hips': [0, -0.025, 0], 'spineR': [4, 0, 0], 'chestR': [-2, 0, 0], 'neckR': [-3, 0, 0], 'headR': [-5, 0, 0],
         'ball': [0, 0.0, 0.17], 'fkL': [0.12, 0, 1], 'fkR': [-0.12, 0, 1], **hold_ball()}

def idle():
    k = [(0.0, READY),
         (0.6, {'hips': [0.008, -0.032, 0], 'hipsR': [0, 0, -2], 'chestR': [-5, 0, 1.5], 'headR': [-7, 6, -1], 'ball': [0, 0.006, 0.17]}),
         (1.2, {'hips': [0, -0.022, 0], 'hipsR': [0, 0, 0], 'chestR': [-3, 0, 0], 'headR': [-5, 0, 0], 'ball': [0, 0.0, 0.17]}),
         (1.8, {'hips': [-0.008, -0.032, 0], 'hipsR': [0, 0, 2], 'chestR': [-5, 0, -1.5], 'headR': [-7, -6, 1], 'ball': [0, 0.006, 0.17]}),
         (2.4, READY)]
    return bake(build_track(k, loop=True), 2.4)

def knots(ks, period=None):
    """ks: [(t, pos, vel)] cubic Hermite path; periodic if period given"""
    ts = [k[0] for k in ks]
    def f(t):
        if period: t = t % period
        i = max(j for j in range(len(ks) - 1) if ts[j] <= t + 1e-9) if t < ts[-1] else len(ks) - 2
        (t0, p0, v0), (t1, p1, v1) = ks[i], ks[i + 1]; h = t1 - t0; u = np.clip((t - t0) / h, 0, 1)
        p0, p1, v0, v1 = map(lambda a: np.array(a, float), (p0, p1, v0, v1))
        return (2*u**3-3*u**2+1)*p0 + (u**3-2*u**2+u)*h*v0 + (-2*u**3+3*u**2)*p1 + (u**3-u**2)*h*v1
    return f

DRIB = {'fL': [0.14, 0, 0.08], 'frL': [0, 7], 'fR': [-0.14, 0, -0.08], 'frR': [0, -12],
        'fkL': [0.15, 0, 1], 'fkR': [-0.25, 0, 1],
        'hips': [0, -0.085, 0], 'hipsR': [12, -10, 0], 'spineR': [9, 0, 0], 'chestR': [5, -4, 0], 'neckR': [-8, 0, 0], 'headR': [-20, 8, 0],
        'bw': [1],
        # left: guard arm, palm out front
        'hwL': [0], 'hspL': [0], 'hpL': [0.21, 0.11, 0.13], 'hnL': [0.25, 0.1, 1], 'hfL': [0.15, 1, -0.1], 'heL': [0.4, -1, 0.15],
        # right: world-space hand riding the ball
        'hspR': [1], 'hgR': [0.12, 1, -0.3], 'heR': [-1, -0.2, -0.5], 'hnR': [0, -1, 0.1], 'hfR': [0, 0.1, 1]}

BX, BZ = -0.25, 0.14
def drib_ball(period=0.45, x=BX, z=BZ):
    top, rel, flo, cat = 0.30, 0.27, BALL_R, 0.27
    return knots([(0.00, [x, top, z], [0, 0, 0]),
                  (0.06, [x, rel, z + 0.005], [0, -1.4, 0.08]),
                  (0.17, [x - 0.025, flo, z + 0.045], [0, -2.3, 0.15]),
                  (0.17001, [x - 0.025, flo, z + 0.045], [0, 1.7, -0.1]),
                  (0.36, [x, cat, z + 0.005], [0, 0.4, -0.05]),
                  (0.45, [x, top, z], [0, 0, 0])], period)

def dribble():
    from drib import Dribble
    d = Dribble(); T = d.T; dur = 2 * T
    def ovr(t, c):
        ph = (t % T) / T
        b, contact = d.ball(t); p, n, f, _ = d.hand(t)
        c['bw'] = np.array([1.0]); c['hspR'] = np.array([1.0]); c['hwR'] = np.array([0.0])
        c['hpR'] = p; c['hnR'] = n; c['hfR'] = f; c['heR'] = np.array([-0.55, -0.35, -1.0])
        # body rides the rhythm: sink + shoulder drop on the push, rise on the catch
        push = np.sin(2 * np.pi * (ph - 0.30))            # peaks just after the push starts
        sway = np.sin(2 * np.pi * t / dur)                 # slow weight shift over the two bounces
        c['hips'] = np.array([0.006 * sway - 0.006, -0.10 - 0.007 * push, 0.0])
        c['hipsR'] = np.array([12 + 1.5 * push, -10, -1.5 * sway])
        c['spineR'] = np.array([11 + 1.0 * push, 0, 5]); c['chestR'] = np.array([7 + 2.0 * push, -5, 6 + 2.0 * push])
        c['shR'] = np.array([0, 0, -5 * push - 4]); c['shL'] = np.array([0, 0, 1.5 * push])
        c['neckR'] = np.array([-8 - 1.0 * push, 0, 0]); c['headR'] = np.array([-22 - 1.5 * push, 8 + 2 * sway, -9 - 2 * push])  # eyes stay up
        # guard arm floats a touch with the rhythm
        c['hpL'] = np.array([0.21, 0.11 + 0.008 * push, 0.13 + 0.006 * sway])
    return bake(build_track([(0, DRIB), (dur, {})], loop=True), dur, ball_path=lambda t: d.ball(t)[0], override=ovr)

G_BALL = 6.0
def flight(p0, t0, target, T):
    """ballistic path from p0 at t0 through target at t0+T; returns (fn, v_at_target)"""
    g = np.array([0, -G_BALL, 0]); v0 = (target - p0 - 0.5 * g * T * T) / T
    return (lambda t: p0 + v0 * (t - t0) + 0.5 * g * (t - t0) ** 2), v0 + g * T

def drop_and_bounce(p0, v0, t0, rest=0.5, drag=0.6):
    """after the net: fall from p0 with velocity v0, bounce on the floor"""
    segs = []; p, v, t = np.array(p0, float), np.array(v0, float), t0
    for _ in range(6):
        a = 0.5 * G_BALL; b = v[1]; c = p[1] - BALL_R   # solve c + b*dt - a*dt^2 = 0
        if c < 1e-4 and b < 0.15: break
        dt = (b + np.sqrt(b * b + 4 * a * max(c, 0))) / (2 * a)
        segs.append((t, p.copy(), v.copy(), dt)); p = p + v * dt + 0.5 * np.array([0, -G_BALL, 0]) * dt * dt
        v = np.array([v[0] * drag, -(v[1] - G_BALL * dt) * rest, v[2] * drag]); t += dt; p[1] = BALL_R
    def f(tt):
        for (ts, ps, vs, dt) in segs:
            if tt <= ts + dt: d = tt - ts; return ps + vs * d + 0.5 * np.array([0, -G_BALL, 0]) * d * d
        ts, ps, vs, dt = segs[-1]; q = ps + vs * dt + 0.5 * np.array([0, -G_BALL, 0]) * dt * dt; q[1] = BALL_R
        return q + np.array([vs[0], 0, vs[2]]) * 0.3 * (1 - np.exp(-(tt - ts - dt)))
    return f

def shoot():
    dur = 2.0; T_REL = 0.62; T_OFF, T_LAND = 0.46, 0.94; APEX = 0.13
    set_R = {'hwR': [1], 'hgR': [0.05, -0.85, -0.55], 'hfR': [0.05, 0.3, -1], 'heR': [-0.15, -1, 0.35]}
    set_L = {'hwL': [0], 'hpL': [0.2, 0.14, 0.12], 'hnL': [-0.3, 0, 1], 'hfL': [0.2, 1, 0.1], 'heL': [1, -1, -0.2]}
    k = [
        (0.00, READY),
        (0.18, {'hwL': [1], 'hips': [0, -0.10, 0.0], 'hipsR': [16, 0, 0], 'spineR': [10, 0, 0], 'chestR': [4, 0, 0], 'neckR': [-10, 0, 0], 'headR': [-22, 0, 0],
                'ball': [-0.01, 0.0, 0.16], 'fkL': [0.15, 0, 1], 'fkR': [-0.15, 0, 1]}),
        (0.27, {'hwL': [0.0], 'hpL': [0.12, 0.02, 0.2], 'hnL': [-0.6, 0, 0.8], 'hfL': [0, 0.6, 1], 'hgR': [-0.9, -0.25, -0.35], 'hfR': [0.15, 0.45, 0.9]}),
        (0.33, {'hgR': [-0.55, -0.6, -0.6], 'hfR': [-0.4, 0.8, -0.4]}),
        (0.38, {'hips': [0, -0.03, 0.0], 'hipsR': [6, 0, 0], 'spineR': [3, 0, 0], 'chestR': [-4, 0, 0], 'neckR': [-6, 0, 0], 'headR': [-12, 0, 0],
                'ball': [-0.16, 0.20, 0.10], **set_R, **set_L, 'frL': [18, 5], 'frR': [18, -5]}),
        (0.46, {'hips': [0, 0.02, 0.0], 'hipsR': [2, 0, 0], 'spineR': [0, 0, 0], 'chestR': [-6, 0, 0], 'headR': [-10, 0, 0],
                'ball': [-0.16, 0.25, 0.11], 'frL': [38, 5], 'frR': [38, -5]}),
        (0.60, {'ball': [-0.15, 0.32, 0.12], 'hgR': [0.0, -0.7, -0.7], 'hfR': [0, 0.6, -0.6], 'heR': [-0.1, -1, 0.5],
                'hpL': [0.2, 0.2, 0.12], 'chestR': [-8, 0, 0], 'headR': [-8, 0, 0]}),
        (T_REL, {'hwR': [1], 'bw': [0]}),
        (T_REL + 0.035, {'hwR': [0.4], 'bw': [1], 'hpR': [-0.16, 0.34, 0.13], 'hnR': [0, -0.2, 1], 'hfR': [0, 1, 0.2]}),
        (T_REL + 0.07, {'hwR': [0], 'bw': [1], 'hpR': [-0.17, 0.35, 0.15], 'hnR': [0, -0.6, -0.8], 'hfR': [0, -0.8, 0.6], 'heR': [-0.1, -1, 0.5],
                        'hpL': [0.21, 0.21, 0.11]}),
        (0.85, {'chestR': [-6, 0, 0], 'headR': [-10, 0, 0], 'hpR': [-0.17, 0.355, 0.16], 'hfR': [0, -0.8, 0.6], 'hpL': [0.21, 0.19, 0.10]}),
        (T_LAND, {'hips': [0, 0.02, 0.0], 'frL': [12, 5], 'frR': [12, -5]}),
        (1.08, {'hips': [0, -0.07, 0.0], 'hipsR': [10, 0, 0], 'spineR': [5, 0, 0], 'chestR': [0, 0, 0], 'headR': [-14, 0, 0],
                'frL': [0, 5], 'frR': [0, -5], 'hpR': [-0.18, 0.32, 0.16], 'hpL': [0.19, 0.12, 0.10]}, 'stop'),
        (1.24, {'hpR': [-0.21, 0.10, 0.12], 'hnR': [0.3, -1, 0.3], 'hfR': [-1, -0.2, 0.5], 'heR': [-1, -0.6, -0.4],
                'hpL': [0.21, 0.04, 0.10], 'hnL': [-0.3, -1, 0.3], 'hfL': [1, -0.2, 0.5], 'heL': [1, -0.6, -0.4]}),
        (1.40, {'hips': [0, -0.03, 0.0], 'hipsR': [4, 0, 0], 'spineR': [3, 0, 0], 'headR': [-8, 0, 0],
                'hpR': [-0.165, -0.07, 0.08], 'hnR': [1, 0, 0.25], 'hfR': [0, -1, 0.3], 'heR': [-0.3, -0.1, -1],
                'hpL': [0.165, -0.09, 0.07], 'hnL': [-1, 0, 0.25], 'hfL': [0, -1, 0.3], 'heL': [0.3, -0.1, -1]}),
        (2.00, {'hips': [0, -0.025, 0], 'hipsR': [0, 0, 0], 'spineR': [4, 0, 0], 'chestR': [-2, 0, 0], 'neckR': [-3, 0, 0], 'headR': [-5, 0, 0],
                'hpR': [-0.165, -0.13, 0.05], 'hnR': [1, 0, 0.2], 'hfR': [0, -1, 0.2], 'heR': [-0.3, 0, -1],
                'hpL': [0.165, -0.13, 0.05], 'hnL': [-1, 0, 0.2], 'hfL': [0, -1, 0.2], 'heL': [0.3, 0, -1]}),
    ]
    tr = build_track(k)
    def air(t, c):  # ballistic hips + dangling feet while airborne
        if T_OFF < t < T_LAND:
            u = (t - T_OFF) / (T_LAND - T_OFF); h = 4 * APEX * u * (1 - u)
            c['hips'][1] = 0.02 + h
            for S in 'LR': c[f'f{S}'][1] = max(0.0, h - 0.025 * np.sin(np.pi * u))
    fr, bl = bake(tr, dur, override=air)                   # pass 1: where the ball leaves the hand
    f_rel = int(round(T_REL * FPS)); p0 = bl[f_rel]
    T_FLY = 0.86; tgt = RIM + np.array([0, 0.0, 0])
    fl, v_in = flight(p0, T_REL, tgt, T_FLY)
    t_in = T_REL + T_FLY
    net_v = np.array([0, v_in[1] * 0.45, -0.25])           # the net slows it and kicks it back a touch
    db = drop_and_bounce(tgt + np.array([0, -0.03, 0]), net_v, t_in + 0.05)
    def path(t):
        if t <= t_in: return fl(t)
        if t <= t_in + 0.05: u = (t - t_in) / 0.05; return tgt + np.array([0, -0.03 * u, 0])
        return db(t)
    fr, bl = bake(tr, dur, ball_path=path, override=air)
    spin = [0.0]
    return fr, bl

def foot_steps(c, t, S, steps):
    """steps: [(t_lift, t_plant, (x,z) from, (x,z) to, height, yaw_to)] -> world foot arc with heel/toe roll"""
    for (t0, t1, a, b, h, yaw) in steps:
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0); e = u * u * (3 - 2 * u)
            c[f'f{S}'] = np.array([a[0] + (b[0] - a[0]) * e, h * np.sin(np.pi * u) ** 1.2, a[1] + (b[1] - a[1]) * e])
            c[f'fr{S}'][0] = 35 * np.sin(np.pi * min(u * 2, 1)) * (u < 0.5) - 18 * np.sin(np.pi * max(0, u - 0.5) * 2) * (u >= 0.5)
            c[f'fr{S}'][1] = c[f'fr{S}'][1] + (yaw - c[f'fr{S}'][1]) * e
        elif t > t1:
            c[f'f{S}'] = np.array([b[0], 0, b[1]]); c[f'fr{S}'][1] = yaw

def dunk():
    dur = 2.9; T_OFF, T_APEX, T_GO, T_LAND = 0.74, 1.02, 1.52, 1.84
    APEX_Y, HANG_Y = 0.82, 0.52
    SLAM = RIM + np.array([0, 0.11, -0.02])
    grabR = [-0.10, RIM[1] + 0.02, RIM[2] - 0.095]; grabL = [0.065, RIM[1] + 0.02, RIM[2] - RIM_R + 0.015]
    hip_ball = {'ball': [-0.13, -0.07, 0.10], 'hwL': [1], 'hgL': [0.55, -0.1, 0.85], 'hfL': [-0.3, 0.3, 1], 'heL': [1, -0.8, -0.2],
                'hwR': [1], 'hgR': [-0.85, -0.2, -0.45], 'hfR': [0.2, 0.2, 1], 'heR': [-0.6, -0.8, -0.6]}
    k = [
        (0.00, READY),
        (0.12, {**hip_ball, 'hips': [0, -0.045, 0.0], 'hipsR': [8, -6, 0], 'spineR': [8, 0, 0], 'chestR': [2, -6, 0], 'headR': [-14, 4, 0], 'root': [0, 0, 0.02]}),
        (0.34, {'root': [0, 0, 0.30], 'hips': [0, -0.06, 0.0], 'hipsR': [16, -8, 0], 'spineR': [10, 0, 0], 'headR': [-22, 6, 0]}),
        (0.48, {'root': [0, 0, 0.55], 'hips': [0, -0.035, 0.0]}),
        (0.62, {'root': [0, 0, 0.84], 'hips': [0, -0.13, 0.0], 'hipsR': [14, -4, 0], 'spineR': [8, 0, 0], 'chestR': [3, -2, 0], 'neckR': [-8, 0, 0], 'headR': [-34, 0, 0],
                'ball': [-0.12, -0.10, 0.10]}),
        (T_OFF, {'root': [0, 0, 1.04], 'hips': [0, 0.03, 0.0], 'hipsR': [4, 0, 0], 'spineR': [0, 0, 0], 'chestR': [-6, 0, 0], 'headR': [-30, 0, 0],
                 'ball': [-0.12, 0.08, 0.15], 'hgR': [-0.8, -0.4, -0.3]}),
        (0.82, {'ball': [-0.18, 0.22, 0.07], 'hwL': [0], 'hpL': [0.21, 0.15, 0.12], 'hnL': [-0.6, -0.6, 0.2], 'hfL': [0, 0.45, 1], 'heL': [1, -1, -0.2], 'hgR': [-0.7, 0.3, -0.6], 'hfR': [0.2, 1, 0.3]}),
        (0.90, {'ball': [-0.16, 0.32, -0.04], 'hgR': [0, 0.25, -1], 'hfR': [0, 1, 0.1], 'heR': [-1, 0.2, -0.4],
                'chestR': [-14, 0, 0], 'spineR': [-6, 0, 0], 'headR': [-25, 0, 0], 'bw': [0], 'hpL': [0.21, 0.22, 0.12]}),
        (T_APEX, {'root': [0, 0, 1.52], 'hips': [0, APEX_Y, 0.0], 'hipsR': [8, 0, 0], 'spineR': [12, 0, 0], 'chestR': [10, 0, 0], 'headR': [-5, 0, 0],
                  'bw': [1], 'hgR': [0.0, 0.75, -0.65], 'hfR': [0, 0.3, 1], 'heR': [-1, -0.3, -0.3]}),
        (1.05, {'hwR': [1], 'hspR': [0], 'hpR': [-0.06, 0.30, 0.2], 'hnR': [0, -1, 0.2], 'hfR': [0, 0.1, 1]}),
        (1.09, {'hwR': [0], 'hspR': [1], 'hpR': grabR, 'hnR': [0, -1, 0.15], 'hfR': [0, -0.2, 1], 'heR': [-1, -0.5, -0.3],
                'root': [0, 0, 1.49], 'hips': [0, 0.64, 0.0], 'hipsR': [2, 0, 0], 'spineR': [2, 0, 0], 'chestR': [0, 0, 0], 'headR': [-8, 0, 0]}),
        (1.15, {'hpL': [0.25, 0.04, 0.10], 'hnL': [-0.3, -1, 0.1], 'hfL': [1, -0.3, 0.3], 'heL': [0.5, -0.3, -1]}),
        (1.20, {'root': [0, 0, 1.41], 'hips': [-0.03, HANG_Y, 0.0], 'hipsR': [-12, 0, -6], 'spineR': [-4, 0, 0], 'headR': [0, 0, 0]}),
        (1.36, {'root': [0, 0, 1.45], 'hips': [0, HANG_Y - 0.01, 0.0], 'hipsR': [10, 0, 0], 'spineR': [4, 0, 0], 'headR': [-10, 0, 0], 'hpL': [0.23, -0.06, -0.04]}),
        (1.48, {'root': [0, 0, 1.45], 'hips': [0, HANG_Y, 0.0], 'hipsR': [0, 0, 0], 'spineR': [0, 0, 0], 'hspR': [1], 'hpR': grabR, 'hnR': [0, -1, 0.15], 'hfR': [0, -0.2, 1], 'heR': [-1, -0.5, -0.3], 'hpL': [0.25, 0.03, 0.08]}),
        (1.58, {'hspL': [0], 'hspR': [0], 'hpL': [0.27, 0.30, 0.09], 'hnL': [-0.5, -0.3, 0.8], 'hfL': [0.3, 1, 0.2], 'heL': [1, -0.6, -0.4],
                'hpR': [-0.27, 0.30, 0.09], 'hnR': [0.5, -0.3, 0.8], 'hfR': [-0.3, 1, 0.2], 'heR': [-1, -0.6, -0.4], 'headR': [-5, 0, 0]}),
        (T_LAND, {'root': [0, 0, 1.42], 'hips': [0, 0.0, 0.0], 'hipsR': [6, 0, 0], 'spineR': [4, 0, 0], 'chestR': [0, 0, 0],
                  'hpL': [0.30, 0.04, 0.12], 'hpR': [-0.30, 0.04, 0.12]}),
        (1.96, {'hips': [0, -0.14, 0.0], 'hipsR': [22, 0, 0], 'spineR': [12, 0, 0], 'chestR': [6, 0, 0], 'headR': [-26, 0, 0],
                'hpL': [0.31, -0.04, 0.12], 'hnL': [0, -1, 0.3], 'hfL': [1, 0, 0.4], 'heL': [0.3, -0.3, -1],
                'hpR': [-0.31, -0.04, 0.12], 'hnR': [0, -1, 0.3], 'hfR': [-1, 0, 0.4], 'heR': [-0.3, -0.3, -1]}, 'stop'),
        (2.25, {'hips': [0, -0.045, 0.0], 'hipsR': [4, 0, 0], 'spineR': [2, 0, 0], 'chestR': [-4, 0, 0], 'headR': [-10, 0, 0],
                'hpL': [0.2, -0.04, 0.08], 'hnL': [-0.6, -0.4, 0.6], 'hfL': [0.2, -1, 0.2], 'heL': [0.4, -0.2, -1],
                'hpR': [-0.2, -0.04, 0.08], 'hnR': [0.6, -0.4, 0.6], 'hfR': [-0.2, -1, 0.2], 'heR': [-0.4, -0.2, -1]}),
        (2.45, {'hips': [0, -0.02, 0.0], 'hipsR': [-4, 0, 0], 'spineR': [-4, 0, 0], 'chestR': [-12, 0, 0], 'neckR': [-6, 0, 0], 'headR': [-12, 0, 0],
                'hpL': [0.27, -0.06, -0.03], 'hnL': [0.2, -0.3, 1], 'hfL': [0.6, -1, -0.2], 'heL': [0.5, 0.2, -1],
                'hpR': [-0.27, -0.06, -0.03], 'hnR': [-0.2, -0.3, 1], 'hfR': [-0.6, -1, -0.2], 'heR': [-0.5, 0.2, -1],
                'shL': [0, 0, 6], 'shR': [0, 0, -6]}),
        (2.62, {'chestR': [-14, 0, 0], 'headR': [-20, 0, 0], 'hpL': [0.28, -0.05, -0.04], 'hpR': [-0.28, -0.05, -0.04]}),
        (2.90, {'hips': [0, -0.025, 0], 'hipsR': [0, 0, 0], 'spineR': [4, 0, 0], 'chestR': [-2, 0, 0], 'neckR': [-3, 0, 0], 'headR': [-5, 0, 0], 'shL': [0, 0, 0], 'shR': [0, 0, 0],
                'hpR': [-0.165, -0.13, 0.05], 'hnR': [1, 0, 0.2], 'hfR': [0, -1, 0.2], 'heR': [-0.3, 0, -1],
                'hpL': [0.165, -0.13, 0.05], 'hnL': [-1, 0, 0.2], 'hfL': [0, -1, 0.2], 'heL': [0.3, 0, -1]}),
    ]
    # leg controls while airborne (hips-relative)
    leg_keys = [  # t, frelL, frelR, fhL, fhR, pitchL, pitchR
        (0.56, 0, 0, None, [-0.075, -0.25, 0.02], None, 10),
        (0.68, 0, 1, None, [-0.07, -0.14, 0.14], None, 25),
        (T_OFF, 0, 1, [0.075, -0.255, -0.02], [-0.07, -0.12, 0.15], 40, 25),
        (0.82, 1, 1, [0.08, -0.20, -0.13], [-0.07, -0.13, 0.13], 50, 25),
        (T_APEX, 1, 1, [0.075, -0.17, -0.14], [-0.07, -0.19, -0.07], 40, 35),
        (1.20, 1, 1, [0.07, -0.22, 0.10], [-0.07, -0.22, 0.11], 25, 25),
        (1.36, 1, 1, [0.07, -0.23, -0.08], [-0.07, -0.23, -0.07], 35, 35),
        (1.52, 1, 1, [0.075, -0.24, 0.04], [-0.075, -0.24, 0.03], 25, 25),
        (1.76, 1, 1, [0.09, -0.24, 0.03], [-0.09, -0.24, 0.0], 15, 15),
        (T_LAND, 0, 0, [0.09, -0.24, 0.03], [-0.09, -0.24, 0.0], 0, 0),
    ]
    lk = []
    for (t, rl, rr, fl, fr_, pl, pr) in leg_keys:
        d = {'frelL': [rl], 'frelR': [rr]}
        if fl is not None: d['fhL'] = fl
        if fr_ is not None: d['fhR'] = fr_
        lk.append((t, d, pl, pr))
    # merge leg keys into the main key list
    allk = {kk[0]: dict(kk[1]) for kk in k}; flags = {kk[0]: (kk[2] if len(kk) > 2 else '') for kk in k}
    for (t, d, pl, pr) in lk: allk.setdefault(t, {}).update(d); flags.setdefault(t, '')
    keys = [(t, allk[t], flags[t]) for t in sorted(allk)]
    tr = build_track(keys)
    pitch_tr = {S: [(t, p) for (t, d, *pp) in lk for p in [pp[0] if S == 'L' else pp[1]] if p is not None] for S in 'LR'}
    stepsR = [(0.12, 0.34, (-0.118, -0.01), (-0.10, 0.36), 0.06, -3)]
    stepsL = [(0.30, 0.60, (0.118, 0.025), (0.07, 0.98), 0.09, 3)]
    landL, landR = (0.10, 1.46), (-0.11, 1.38)
    def ovr(t, c):
        foot_steps(c, t, 'R', stepsR); foot_steps(c, t, 'L', stepsL)
        if t >= 0.56: c['fR'] = np.array([landR[0], 0, landR[1]]) if t >= T_LAND - 0.1 else c['fR']
        if t >= T_OFF: c['fL'] = np.array([landL[0], 0, landL[1]]) if t >= T_LAND - 0.1 else c['fL']
        for S in 'LR':
            pts = pitch_tr[S]
            if pts and t >= pts[0][0]:
                c[f'fr{S}'][0] = np.interp(t, [p[0] for p in pts], [p[1] for p in pts])
            if t >= T_LAND - 0.1: c[f'fr{S}'][1] = 4 if S == 'L' else -4
        if 0.62 <= t < T_OFF:   # push off the left toe
            u = (t - 0.62) / (T_OFF - 0.62); c['frL'][0] = 45 * u * u
        if T_OFF <= t <= T_APEX:
            u = (t - T_OFF) / (T_APEX - T_OFF); c['hips'][1] = 0.03 + (APEX_Y - 0.03) * (1 - (1 - u) ** 2)
            c['root'][2] = 1.04 + (1.52 - 1.04) * (1 - (1 - u) ** 1.6)
        if T_GO <= t <= T_LAND:
            u = (t - T_GO) / (T_LAND - T_GO); c['hips'][1] = HANG_Y - (HANG_Y - 0.0) * u * u
            c['root'][2] = 1.45 + (1.42 - 1.45) * u
    def path(t):
        if t <= 1.055: return SLAM
        d = t - 1.055
        if d <= 0.09: return SLAM + np.array([0, -2.6 * d - 0.5 * G_BALL * d * d, 0.05 * d])
        p0 = SLAM + np.array([0, -2.6 * 0.09 - 0.5 * G_BALL * 0.0081, 0.0045])
        return drop_and_bounce(p0, np.array([0, -1.4, 0.35]), 1.055 + 0.09)(t)
    return bake(tr, dur, ball_path=path, override=ovr)

# ---------------------------------------------------------------- locomotion cycles (in place; the game moves the root)
RUN_T = 0.5          # one full stride cycle (two steps)
STRIDE = 0.30        # foot travel during stance; native ground speed = STRIDE / (RUN_T * STANCE)
STANCE = 0.42
def legs_cycle(t, c, period=RUN_T, stride=STRIDE, lift=0.075, width=0.085):
    for S, sg, off in (('L', 1, 0.0), ('R', -1, 0.5)):
        ph = ((t / period) + off) % 1.0
        if ph < STANCE:
            u = ph / STANCE
            z = stride / 2 - stride * u; y = 0.0
            pitch = -8 * (1 - u) ** 3 + 28 * sstep_(0.7, 1.0, u)        # heel strike -> toe off
        else:
            u = (ph - STANCE) / (1 - STANCE); e = u * u * (3 - 2 * u)
            z = -stride / 2 + stride * e; y = lift * np.sin(np.pi * u) ** 0.8
            pitch = 28 * (1 - sstep_(0.0, 0.5, u)) - 8 * sstep_(0.7, 1.0, u)
        c[f'f{S}'] = np.array([sg * width, y, z]); c[f'fr{S}'] = np.array([pitch, sg * 3.0])
        c[f'fk{S}'] = np.array([sg * 0.1, 0, 1.0])
    ph = (t / period) % 1.0
    bob = np.cos(4 * np.pi * (ph - STANCE / 2)); sway = np.sin(2 * np.pi * ph)
    return ph, bob, sway

def run_body(t, c, r, arms=True, st=None):
    st = st or {}; L_ = st.get('lean', 0.0); SW = st.get('swing', 40.0); EL = st.get('elbow', 88.0); DN = st.get('down', 74.0); YW = st.get('yaw', 1.0)
    """legs + pelvis + torso + head for the run gait r (gait.Run). ph_L = 0 at left heel strike."""
    T = r.T; phL = (t / T) % 1.0; phR = (phL + 0.5) % 1.0
    for S, sg, ph in (('L', 1, phL), ('R', -1, phR)):
        z, lift, pitch = r.foot(ph)
        c[f'f{S}'] = np.array([sg * r.track, lift, z]); c[f'fr{S}'] = np.array([pitch, sg * 4.0]); c[f'frel{S}'] = np.array([0.0])
        c[f'fk{S}'] = np.array([sg * 0.08, 0.0, 1.0])
    w = 2 * np.pi * phL
    down = np.cos(2 * w - 2 * np.pi * r.s)                   # +1 at mid-stance of either foot (lowest), -1 in flight
    lat = np.cos(w - np.pi * r.s)                            # +1 when the left foot is mid-stance
    c['hips'] = np.array([0.008 * lat, r.hip_h - r.bob * (0.5 + 0.5 * down), 0.02])   # hips carried ahead of the feet
    # pelvis yaws so the swinging leg's hip goes forward; drops on the swing side; leans into the run
    yaw = 9 * YW * np.sin(w - np.pi * r.s)                        # + = left hip back (left leg in stance, pushing)
    c['hipsR'] = np.array([r.lean + 14 + L_ + 1.2 * down, -yaw, -1.8 * lat])
    c['spineR'] = np.array([5.0, yaw * 0.35, 0.7 * lat]); c['chestR'] = np.array([2.0 + 1.0 * down, yaw * 0.6, 0.5 * lat])
    lag = np.cos(2 * w - 2 * np.pi * r.s - 0.8)
    c['neckR'] = np.array([-8.0, -yaw * 0.6, -0.5 * lat]); c['headR'] = np.array([-24.0 - L_ - 1.0 * down + 0.6 * lag, -yaw * 0.5, -0.6 * lat])  # cancels the body lean + bounce: eyes level
    if arms:
        for S, sg in (('L', 1), ('R', -1)):
            a = -sg * np.sin(w - np.pi * r.s - 0.45)        # arms trail the legs slightly (loose, not robotic)        # arm forward when the opposite leg is forward; slight lag
            fwd = max(a, 0.0)
            back = max(-a, 0.0)
            c[f'hp{S}'] = np.array([sg * (0.15 - 0.03 * fwd - 0.02 * back), -0.09 + 0.13 * fwd + 0.03 * back, 0.04 + 0.16 * fwd - 0.17 * back])
            c[f'hn{S}'] = np.array([-sg * 0.9, -0.15, 0.25 * a]); c[f'hf{S}'] = np.array([sg * 0.15, 0.35 + 0.45 * fwd, 1.0])
            c[f'he{S}'] = np.array([sg * 0.12, -0.35, -1.0]); c[f'hw{S}'] = np.array([0.0]); c[f'hsp{S}'] = np.array([0.0])
            c[f'sh{S}'] = np.array([0, -8 * a, 0]); c[f'wm{S}'] = np.array([10.0])
            # shoulder swings the arm through ~95 deg, elbow stays bent ~85-100 deg (more bend in front)
            c[f'afk{S}'] = np.array([DN, 8 + SW * a, EL + 6 * fwd - 6 * back, -6.0, 1.0])
    c['ball'] = np.array([0, -0.6, -0.4])
    return phL

RUN_STYLES = {'Run': ({}, {}),
              'RunB': ({'bob': 0.012, 'track': 0.064}, {'lean': -7, 'swing': 30, 'elbow': 100, 'down': 66, 'yaw': 0.7}),   # upright glider, arms out
              'RunC': ({'bob': 0.026, 'track': 0.08}, {'lean': 6, 'swing': 52, 'elbow': 80, 'down': 78, 'yaw': 1.4})}      # hard charger, big pump
def run(name='Run'):
    from gait import Run
    g, st = RUN_STYLES[name]; r = Run(**g)
    return bake(build_track([(0, READY), (r.T, {})], loop=True), r.T, override=lambda t, c: run_body(t, c, r, st=st))

def dribble_run():
    """same legs/torso as Run (feet match ground speed), one bounce per stride, right hand rides the ball"""
    from gait import Run
    r = Run(); period = r.T
    from drib import Dribble
    d = Dribble(base=(-0.27, 0.17)); sc = d.T / period          # same physics as the standing dribble, retimed to the stride
    path = lambda t: d.ball(t * sc)[0]
    def ovr(t, c):
        run_body(t, c, r, arms=True)
        c['afkR'] = np.array([0, 0, 0, 0, 0.0])
        c['hipsR'][1] *= 0.5; c['chestR'][1] = c['chestR'][1] * 0.5 - 6; c['chestR'][2] += 6; c['spineR'][2] += 4; c['shR'] = np.array([0, 0, -6.0])
        p, n, f, _ = d.hand(t * sc)
        c['bw'] = np.array([1.0]); c['hspR'] = np.array([1.0]); c['hwR'] = np.array([0.0]); c['wmR'] = np.array([60.0])
        c['hpR'] = p; c['hnR'] = n; c['hfR'] = f; c['heR'] = np.array([-0.55, -0.35, -1.0])
    return bake(build_track([(0, READY), (period, {})], loop=True), period, ball_path=path, override=ovr)

DEF = {'fL': [0.17, 0, 0.03], 'frL': [6, 12], 'fR': [-0.17, 0, -0.02], 'frR': [6, -12], 'fkL': [0.35, 0, 1], 'fkR': [-0.35, 0, 1],
       'hips': [0, -0.10, 0], 'hipsR': [16, 0, 0], 'spineR': [6, 0, 0], 'chestR': [-2, 0, 0], 'neckR': [-8, 0, 0], 'headR': [-20, 0, 0],
       'ball': [0, -0.6, -0.4], 'hwL': [0], 'hwR': [0],
       'hpL': [0.27, 0.02, 0.10], 'hnL': [-0.2, -0.3, 1], 'hfL': [0.6, 0.8, 0.2], 'heL': [0.6, -0.8, -0.2],
       'hpR': [-0.27, 0.02, 0.10], 'hnR': [0.2, -0.3, 1], 'hfR': [-0.6, 0.8, 0.2], 'heR': [-0.6, -0.8, -0.2]}

def defend():
    k = [(0.0, DEF),
         (0.3, {'hips': [0.012, -0.105, 0], 'hipsR': [16, 0, -2], 'hpL': [0.28, 0.05, 0.11], 'hpR': [-0.26, 0.0, 0.09], 'headR': [-20, 4, 0]}),
         (0.6, {'hips': [0, -0.095, 0], 'hipsR': [16, 0, 0], 'hpL': [0.27, 0.02, 0.10], 'hpR': [-0.27, 0.02, 0.10], 'headR': [-20, 0, 0]}),
         (0.9, {'hips': [-0.012, -0.105, 0], 'hipsR': [16, 0, 2], 'hpL': [0.26, 0.0, 0.09], 'hpR': [-0.28, 0.05, 0.11], 'headR': [-20, -4, 0]}),
         (1.2, DEF)]
    return bake(build_track(k, loop=True), 1.2)

def block():
    T_OFF, T_APEX, T_LAND = 0.30, 0.56, 0.84; APEX = 0.36
    up = {'hpL': [0.15, 0.34, 0.07], 'hnL': [-0.1, 0, 1], 'hfL': [0, 1, 0.05], 'heL': [1, 0, -0.3],
          'hpR': [-0.15, 0.34, 0.07], 'hnR': [0.1, 0, 1], 'hfR': [0, 1, 0.05], 'heR': [-1, 0, -0.3]}
    k = [(0.0, DEF),
         (0.16, {'hips': [0, -0.15, 0], 'hipsR': [22, 0, 0], 'spineR': [10, 0, 0], 'headR': [-26, 0, 0],
                 'hpL': [0.22, -0.10, 0.12], 'hpR': [-0.22, -0.10, 0.12]}),
         (T_OFF, {'hips': [0, 0.02, 0], 'hipsR': [2, 0, 0], 'spineR': [-2, 0, 0], 'chestR': [-6, 0, 0], 'headR': [-18, 0, 0],
                  'frL': [40, 8], 'frR': [40, -8], 'fkL': [0.15, 0, 1], 'fkR': [-0.15, 0, 1], **up}),
         (T_APEX, {'chestR': [-8, 0, 0], 'headR': [-20, 0, 0]}),
         (T_LAND, {'hips': [0, 0.02, 0], 'frL': [10, 8], 'frR': [10, -8]}),
         (0.96, {'hips': [0, -0.13, 0], 'hipsR': [18, 0, 0], 'spineR': [8, 0, 0], 'headR': [-22, 0, 0], 'frL': [6, 12], 'frR': [6, -12],
                 'fkL': [0.35, 0, 1], 'fkR': [-0.35, 0, 1], 'hpL': [0.26, 0.06, 0.12], 'hpR': [-0.26, 0.06, 0.12]}, 'stop'),
         (1.2, DEF)]
    def air(t, c):
        if T_OFF < t < T_LAND:
            u = (t - T_OFF) / (T_LAND - T_OFF); h = 4 * APEX * u * (1 - u)
            c['hips'][1] = 0.02 + h
            for S in 'LR': c[f'f{S}'][1] = max(0.0, h - 0.03 * np.sin(np.pi * u))
    return bake(build_track(k), 1.2, override=air)

# ---------------------------------------------------------------- 3v3 additions
READYP = {**DEF, 'fL': [0.13, 0, 0.03], 'fR': [-0.13, 0, -0.01], 'frL': [0, 6], 'frR': [0, -6], 'fkL': [0.15, 0, 1], 'fkR': [-0.15, 0, 1],
          'hips': [0, -0.05, 0], 'hipsR': [8, 0, 0], 'spineR': [4, 0, 0], 'headR': [-10, 0, 0],
          'hpL': [0.18, -0.08, 0.10], 'hnL': [-0.8, 0, 0.6], 'hfL': [0.1, 0.2, 1], 'heL': [0.4, -0.5, -1],
          'hpR': [-0.18, -0.08, 0.10], 'hnR': [0.8, 0, 0.6], 'hfR': [-0.1, 0.2, 1], 'heR': [-0.4, -0.5, -1]}

def ready():
    k = [(0.0, READYP), (0.5, {'hips': [0, -0.065, 0], 'hpL': [0.18, -0.09, 0.11], 'hpR': [-0.18, -0.09, 0.11], 'headR': [-10, 5, 0]}),
         (1.0, {'hips': [0, -0.05, 0], 'headR': [-10, 0, 0]}), (1.5, {'hips': [0, -0.065, 0], 'headR': [-10, -5, 0]}), (2.0, READYP)]
    return bake(build_track(k, loop=True), 2.0)

def pass_():
    """two-hand chest pass: load into the chest, step in, punch both arms out at shoulder height, thumbs-down follow-through"""
    k = [(0.0, READY),
         (0.11, {'ball': [0, -0.005, 0.11], 'hips': [0, -0.065, -0.018], 'hipsR': [6, 0, 0], 'spineR': [2, 0, 0], 'chestR': [-6, 0, 0], 'headR': [-6, 0, 0],
                 'fkL': [0.2, 0, 1], 'fkR': [-0.2, 0, 1], 'heL': [1, -0.6, -0.2], 'heR': [-1, -0.6, -0.2]}),
         (0.22, {'ball': [0, 0.11, 0.21], 'hips': [0, -0.055, 0.035], 'hipsR': [10, 0, 0], 'spineR': [8, 0, 0], 'chestR': [6, 0, 0], 'headR': [-12, 0, 0],
                 'fL': [0.11, 0, 0.16], 'frL': [0, 4], 'heL': [0.8, -0.8, -0.2], 'heR': [-0.8, -0.8, -0.2]}),
         (0.29, {'hwL': [0], 'hwR': [0], 'bw': [0], 'ball': [0, 0.24, 0.40],
                 'hips': [0, -0.05, 0.05], 'hipsR': [12, 0, 0], 'spineR': [10, 0, 0], 'chestR': [8, 0, 0], 'headR': [-16, 0, 0],
                 'hpL': [0.06, 0.075, 0.30], 'hnL': [0.3, -0.8, 0.5], 'hfL': [0.5, -0.4, 0.8], 'heL': [1, -0.4, -0.2],
                 'hpR': [-0.06, 0.075, 0.30], 'hnR': [-0.3, -0.8, 0.5], 'hfR': [-0.5, -0.4, 0.8], 'heR': [-1, -0.4, -0.2]}),
         (0.48, {'hpL': [0.08, 0.06, 0.29], 'hpR': [-0.08, 0.06, 0.29], 'hips': [0, -0.048, 0.045]}),
         (0.75, READYP)]
    return bake(build_track(k), 0.75)

def steal():
    k = [(0.0, DEF),
         (0.12, {'hips': [-0.02, -0.12, 0], 'hpR': [-0.22, 0.04, 0.12]}),
         (0.30, {'hips': [-0.01, -0.15, 0.04], 'hipsR': [24, -12, 0], 'spineR': [12, 0, 0], 'chestR': [6, -14, 0], 'headR': [-26, 0, 0],
                 'fR': [-0.13, 0, 0.16], 'frR': [-6, -6],
                 'hpR': [-0.04, -0.28, 0.27], 'hnR': [0.3, -1, 0.1], 'hfR': [0.4, -0.3, 1], 'heR': [-1, 0.2, -0.3],
                 'hpL': [0.27, 0.06, -0.02]}),
         (0.42, {'hpR': [0.08, -0.26, 0.22], 'hnR': [0.5, -1, 0], 'hfR': [0.8, -0.3, 0.6]}),
         (0.8, DEF)]
    return bake(build_track(k), 0.8)

def slide(direction):
    """defensive shuffle toward the character's left (+1) or right (-1); feet never cross"""
    period, stride, stance = 0.5, 0.12, 0.45
    def ovr(t, c):
        for S, sg, off in (('L', 1, 0.0), ('R', -1, 0.5)):
            lead = (sg == direction)
            ph = ((t / period) + (0.0 if lead else 0.5)) % 1.0
            if ph < stance:
                u = ph / stance; dx = stride / 2 - stride * u; y = 0.0
            else:
                u = (ph - stance) / (1 - stance); e = u * u * (3 - 2 * u); dx = -stride / 2 + stride * e; y = 0.035 * np.sin(np.pi * u)
            c[f'f{S}'] = np.array([sg * 0.135 + direction * dx, y, 0.02 if S == 'L' else -0.01]); c[f'fr{S}'] = np.array([6, sg * 12])
            c[f'fk{S}'] = np.array([sg * 0.35, 0, 1])
        ph = (t / period) % 1.0; bob = np.cos(4 * np.pi * ph)
        c['hips'] = np.array([direction * 0.01 * np.sin(2 * np.pi * ph), -0.105 - 0.008 * bob, 0]); c['hipsR'] = np.array([16, 0, direction * 2])
        c['headR'] = np.array([-20, 0, 0])
        # active hands: the arms pump a little out of phase, chest leans into the slide
        w = np.sin(2 * np.pi * ph)
        c['hpL'] = np.array(c['hpL'], float) + [0, 0.025 * w, 0.01 * w]; c['hpR'] = np.array(c['hpR'], float) + [0, -0.025 * w, -0.01 * w]
        c['chestR'] = np.array([4, 0, direction * 5]); c['spineR'] = np.array([6, 0, direction * 2])
    return bake(build_track([(0, DEF), (period, {})], loop=True), period, override=ovr)

CLIPS = {'Idle': idle, 'Dribble': dribble, 'Shoot': shoot, 'Dunk': dunk,
         'Run': run, 'RunB': lambda: run('RunB'), 'RunC': lambda: run('RunC'), 'DribbleRun': dribble_run, 'Defend': defend, 'Block': block,
         'Ready': ready, 'Pass': pass_, 'Steal': steal, 'SlideL': lambda: slide(1), 'SlideR': lambda: slide(-1)}
if __name__ == '__main__':
    import sys; from pv import sheet
    name = sys.argv[1]; times = [float(x) for x in sys.argv[2].split(',')]
    fr, bl = CLIPS[name]()
    kw = eval(sys.argv[3]) if len(sys.argv) > 3 else {}
    sheet(fr, bl, times, f'pv_{name}.png', **kw)
