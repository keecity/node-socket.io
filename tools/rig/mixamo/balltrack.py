import cv2, numpy as np, json
cap = cv2.VideoCapture('ref/run_dribble2.mp4'); out = []; i = 0; prev = None
while True:
    ok, fr = cap.read()
    if not ok: break
    hsv = cv2.cvtColor(fr, cv2.COLOR_BGR2HSV)
    om = cv2.inRange(hsv, (3, 140, 80), (18, 255, 235)) > 0
    g = cv2.GaussianBlur(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY), (5, 5), 1.5)
    cs = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1.2, minDist=20, param1=90, param2=18, minRadius=34, maxRadius=56)
    best = None
    if cs is not None:
        yy, xx = np.mgrid[0:fr.shape[0], 0:fr.shape[1]]
        for x, y, r in cs[0][:40]:
            if y < 170: continue                     # the head is round and orange too
            disk = (xx - x) ** 2 + (yy - y) ** 2 < (r * 0.8) ** 2
            frac = om[disk].mean() if disk.any() else 0
            cont = 1 if prev is None else np.exp(-np.hypot(x - prev[0], y - prev[1]) / 90)
            sc = frac * (0.3 + cont)
            if best is None or sc > best[0]: best = (sc, x, y, r, frac)
    if best and best[4] > 0.5: prev = (best[1], best[2]); out.append([i, float(best[1]), float(best[2]), float(best[3]), float(best[4])])
    else: out.append([i, None, None, None, 0])
    i += 1
json.dump(out, open('ball.json', 'w'))
ys = np.array([o[2] if o[2] is not None else np.nan for o in out]); rs = np.array([o[3] if o[3] else np.nan for o in out])
print('found', np.isfinite(ys).sum(), '/', i, 'radius med', np.nanmedian(rs), 'p10/p90', np.nanpercentile(rs, [10, 90]))
print(' '.join(f'{k}:{int(ys[k]) if np.isfinite(ys[k]) else -1}' for k in range(0, 90)))
