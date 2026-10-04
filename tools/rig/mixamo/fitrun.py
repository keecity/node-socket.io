import numpy as np, json, sys, fitpose as FP
from PIL import Image
from seg import PAL
p0 = [300, 0, 20, 10, 0, 20, -20, 0, -20, -60, -20, 30, 20, 60, 70, -10, 40]
t = FP.video_classes(30)
# camera scale: coarse search with a quick fit at each
best = None
for sc in range(330, 451, 20):
    p, s = FP.fit(p0, sc, t, iters=3)
    if best is None or s > best[0]: best = (s, sc, p)
s, sc, p = best
for sc2 in (sc - 10, sc - 5, sc + 5, sc + 10):
    p2, s2 = FP.fit(p, sc2, t, iters=4)
    if s2 > s: s, sc, p = s2, sc2, p2
p, s = FP.fit(p, sc, t, iters=6)
print('scale px/unit', sc, 'score', round(s, 3)); print(dict(zip(FP.PN, np.round(p, 1))))
json.dump({'sc': sc, 'p30': p.tolist()}, open('cam.json', 'w'))
r = FP.render(p, sc); tt = np.where(t < 0, 0, t)
Image.fromarray(np.hstack([PAL[tt], PAL[r], (FP.FR[30][::FP.DS, ::FP.DS][:FP.h, :FP.w] * 0.5 + PAL[r] * 0.5).astype(np.uint8)])).resize((213 * 3 * 3, 120 * 3), Image.NEAREST).save('fit30.png')
