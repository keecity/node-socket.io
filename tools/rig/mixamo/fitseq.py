import numpy as np, json, fitpose as FP
from PIL import Image
from seg import PAL
cam = json.load(open('cam.json')); sc = cam['sc']; p = np.array(cam['p30'])
out = {}; rows = []
for k in range(30, 30 + 30):
    t = FP.video_classes(k)
    p, s = FP.fit(p, sc, t, iters=5); out[k] = p.tolist()
    if (k - 30) % 3 == 0:
        r = FP.render(p, sc); rows.append((FP.FR[k][::FP.DS, ::FP.DS][:FP.h, :FP.w] * 0.45 + PAL[r] * 0.55).astype(np.uint8))
    print(k, round(s, 3), flush=True)
json.dump(out, open('fitseq.json', 'w'))
Image.fromarray(np.vstack([np.hstack(rows[:5]), np.hstack(rows[5:10])])).resize((213 * 5 * 2, 120 * 2 * 2), Image.NEAREST).save('fitseq.png')
