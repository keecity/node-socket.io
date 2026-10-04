import numpy as np, mixrig as M, dribble_fit as DF
from PIL import Image, ImageDraw
from meshview import render
S = 213; W = Image.new('RGB', (8 * S, 2 * 240))
for j, k in enumerate(range(0, 28, 4)):
    l, h, r, b = DF.frame(k); V = M.skinned(M.fk(l, h))
    im = render(V, M.F, 'front', S=240, half=0.6, cy=0.5); d = ImageDraw.Draw(im)
    sc = 240 / 1.2; x, y = b[0] * sc + 120, 120 - (b[1] - 0.5) * sc; rr = 0.078 * sc
    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(210, 100, 35))
    W.paste(im.crop((13, 0, 13 + S, 240)), (S * j, 240))
W.paste(Image.open('ref/arms_front.png').convert('RGB'), (0, 0)); W.save('arms_front_cmp.png')
