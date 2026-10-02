import sys; from clips import *; import pv
from pv import deform, draw
from PIL import Image
name = sys.argv[1]; half = float(sys.argv[2]); yc = float(sys.argv[3]); views = sys.argv[4].split(','); step = int(sys.argv[5]) if len(sys.argv) > 5 else 2
v0 = pv.view_mat; pv.view_mat = lambda k: {'rq': R3(('y', 40), ('x', 8)), 'rside': R3(('y', -90))}.get(k) if k in ('rq', 'rside') else v0(k)
fr, bl = CLIPS[name](); S = 360; frames = []
for f in range(0, len(fr) - 1, step):
    Q = deform(fr[f]); r = fr[f]['_root']; im = Image.new('RGB', (S * len(views), S))
    for i, v in enumerate(views):
        cen = pv.view_mat(v) @ (np.array([0, yc, 0]) + r); im.paste(draw(Q, bl[f], v, (cen[0], cen[1], half), S, None), (S * i, 0))
    frames.append(im)
frames[0].save(f'{name}.gif', save_all=True, append_images=frames[1:], duration=int(1000 * step / FPS), loop=0)
print(len(frames), 'frames')
