"""Filmstrip of N evenly spaced frames from one view + a timing graph of palm vs ball height."""
import sys; from clips import *; import pv
from pv import deform, draw
from PIL import Image, ImageDraw
name, view, n = sys.argv[1], sys.argv[2], int(sys.argv[3]); half = float(sys.argv[4]); yc = float(sys.argv[5])
v0 = pv.view_mat; pv.view_mat = lambda k: {'rq': R3(('y', 40), ('x', 8)), 'rside': R3(('y', -90))}.get(k) if k in ('rq', 'rside') else v0(k)
fr, bl = CLIPS[name](); N = len(fr) - 1; S = 260
idx = [round(i * N / n) for i in range(n)]
W = Image.new('RGB', (S * min(n, 8), S * ((n + 7) // 8) + 160), (30, 32, 40))
for k, f in enumerate(idx):
    Q = deform(fr[f]); r = fr[f]['_root']; cen = pv.view_mat(view) @ (np.array([0, yc, 0]) + r)
    W.paste(draw(Q, bl[f], view, (cen[0], cen[1], half), S, f'{f / FPS:.3f}'), (S * (k % 8), S * (k // 8)))
# graph: palm (R) and ball top heights
d = ImageDraw.Draw(W); y0 = S * ((n + 7) // 8) + 150; gx = lambda f: 10 + f / N * (W.width - 20); gy = lambda y: y0 - y * 330
pr = [palm_world(q, 'R')[1] for q in fr]; bt = [b[1] + BALL_R for b in bl]
for f in range(N):
    d.line([gx(f), gy(bt[f]), gx(f + 1), gy(bt[f + 1])], fill=(230, 120, 30), width=2)
    d.line([gx(f), gy(pr[f]), gx(f + 1), gy(pr[f + 1])], fill=(120, 200, 255), width=2)
d.text((10, y0 - 145), 'blue = palm height, orange = top of ball', fill=(200, 200, 200))
W.save(f'strip_{name}_{view}.png')
