import numpy as np, subprocess, sys
from PIL import Image
import mixrig as M, dribble_fit as DF, cmpnew as C
C.BR = 0.078
ks = list(range(0, 28, 4)); S = 300; W = Image.new('RGB', (S * len(ks), S * 2))
for j, k in enumerate(ks):
    l, h, r, b = DF.frame(k); V = M.skinned(M.fk(l, h))
    W.paste(C.draw(V, b, S=S, half=0.6, cy=0.45), (S * j, S))
    f = DF.K0 + k
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(f / 24), '-i', 'ref/run_dribble2.mp4', '-frames:v', '1', '-vf', f'crop=440:440:207:20,scale={S}:{S}', 'ref/r.png'])
    W.paste(Image.open('ref/r.png').convert('RGB'), (S * j, 0))
W.save('cmp_fit.png')
