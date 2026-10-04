import numpy as np, subprocess, json, sys
from PIL import Image, ImageDraw
import mixrig as M, retarget as R, fold as FD
RS = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])          # view from the character's right, forward = screen right
B = np.array([[o[1], o[2], o[3]] if o[1] is not None else [np.nan] * 3 for o in json.load(open('ball.json'))])
floor_px = R.FLOOR_PX; BR = R.BALL_R
def draw(V, ballp, S=300, half=0.6, cy=0.45):
    X = V @ RS.T; T = X[M.F]; im = Image.new('RGB', (S, S), (44, 46, 56)); d = ImageDraw.Draw(im); sc = S / (2 * half)
    tp = lambda p: ((p[0]) * sc + S / 2, S / 2 - (p[1] - cy) * sc)
    nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-12
    L = np.array([0.3, 0.6, 0.75]); L /= np.linalg.norm(L)
    items = [(T[i, :, 2].mean(), 'f', i) for i in range(len(T)) if nrm[i, 2] > 0]
    bp = RS @ ballp; items.append((bp[2], 'b', 0)); items.sort(key=lambda a: a[0])
    for z, k, i in items:
        if k == 'b':
            x, y = tp(bp); r = BR * sc; d.ellipse([x - r, y - r, x + r, y + r], fill=(205, 95, 35)); continue
        sh = 0.35 + 0.65 * max(0, nrm[i] @ L); d.polygon([tp(p) for p in T[i]], fill=(int(190 * sh), int(160 * sh), int(140 * sh)))
    d.line([(0, tp((0, 0, 0))[1]), (S, tp((0, 0, 0))[1])], fill=(200, 200, 200))
    return im
if __name__ == '__main__':
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 21; ks = list(range(start, start + 28, 4)); S = 300
    W = Image.new('RGB', (S * len(ks), S * 2))
    for j, f in enumerate(ks):
        u = f / FD.PER; loc, hips = R.pose(u); Wd = M.fk(loc, hips); V = M.skinned(Wd)
        W.paste(draw(V, R.ballp(u)), (S * j, S))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(f / 24), '-i', 'ref/run_dribble2.mp4', '-frames:v', '1', '-vf', f'crop=440:440:207:20,scale={S}:{S}', 'ref/r.png'])
        W.paste(Image.open('ref/r.png').convert('RGB'), (S * j, 0))
    W.save('cmp_new.png'); print('ball r units', round(BR, 3), 'floor px', round(floor_px, 1))
