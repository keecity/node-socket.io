"""Arms only: legs, feet, torso, head, hips and camera stay exactly as in the v65 fit; only the dribble arm is re-solved."""
import numpy as np, json, fitpose as FP
cam = json.load(open('cam_v65.json')); sc = cam['sc']; base = json.load(open('fitseq_v65.json'))
FREE = [FP.PN.index(n) for n in ('uaR', 'faR', 'hdR')]
def fit_arm(p0, target, iters=5):
    p = np.array(p0, float); best = FP.score(p, sc, target); step = 14.0
    for it in range(iters):
        improved = True
        while improved:
            improved = False
            for i in FREE:
                for sgn in (1, -1):
                    q = p.copy(); q[i] += sgn * step; s = FP.score(q, sc, target)
                    if s > best + 1e-5: p, best, improved = q, s, True; break
        step *= 0.5
    return p, best
out = {}
for k in sorted(base, key=int):
    p, s = fit_arm(base[k], FP.video_classes(int(k))); out[k] = p.tolist()
    assert all(abs(p[i] - base[k][i]) < 1e-9 for i in range(len(p)) if i not in FREE)
json.dump(out, open('fitseq.json', 'w')); json.dump(cam, open('cam.json', 'w')); print('arms refit, legs untouched:', len(out), 'frames')
