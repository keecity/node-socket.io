from clips import *
import sys
from pv import deform, draw, view_mat
from PIL import Image
name = sys.argv[1]; ts = [float(x) for x in sys.argv[2].split(',')]; half = float(sys.argv[3]) if len(sys.argv) > 3 else 0.36
yc = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
fr, bl = CLIPS[name]()
S = 300; W = Image.new('RGB', (S * len(ts), S * 3))
for i, t in enumerate(ts):
    f = min(int(round(t * FPS)), len(fr) - 1); Q = deform(fr[f]); r = fr[f]['_root'] + np.array([0, fr[f]['_hips'][1], 0])
    for j, v in enumerate(['front', 'q34', 'side']):
        cen = view_mat(v) @ (np.array([0, yc, 0]) + r)
        W.paste(draw(Q, bl[f], v, (cen[0], cen[1], half), S, f'{name} {t}s {v}', rim=(name == 'Dunk')), (S * i, S * j))
W.save(f'cu_{name}.png')
