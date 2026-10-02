"""Every frame of a clip, one sheet per view, numbered."""
import sys; from clips import *; import pv
from pv import deform, draw
from PIL import Image
name, view = sys.argv[1], sys.argv[2]; half = float(sys.argv[3]); yc = float(sys.argv[4]); cols = int(sys.argv[5]) if len(sys.argv) > 5 else 10
v0 = pv.view_mat
pv.view_mat = lambda k: {'rq': R3(('y', 40), ('x', 8)), 'rside': R3(('y', -90)), 'cam': R3(('y', 148), ('x', 18)), 'back': R3(('y', 180))}.get(k) if k in ('rq', 'rside', 'cam', 'back') else v0(k)
fr, bl = CLIPS[name](); n = len(fr) - 1; S = 200
W = Image.new('RGB', (S * cols, S * ((n + cols - 1) // cols)), (30, 32, 40))
for f in range(n):
    Q = deform(fr[f]); r = fr[f]['_root']; cen = pv.view_mat(view) @ (np.array([0, yc, 0]) + r)
    W.paste(draw(Q, bl[f] if name not in ('Run',) else None, view, (cen[0], cen[1], half), S, f'{f}'), (S * (f % cols), S * (f // cols)))
W.save(f'all_{name}_{view}.png'); print(n, 'frames')
