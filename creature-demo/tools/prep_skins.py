# Cut the 4x4 skin atlases into clean 256px tiles and turn the height atlas into a normal-map atlas.
# usage: python3 prep_skins.py <colour atlas> <height atlas> <out dir>
import sys, numpy as np
from PIL import Image
col, hgt, out = sys.argv[1], sys.argv[2], sys.argv[3]
T, INSET = 256, 6
def tiles(path, mode):
    im = Image.open(path).convert(mode); W = im.size[0] / 4
    return [im.crop((int(c * W) + INSET, int(r * W) + INSET, int((c + 1) * W) - INSET, int((r + 1) * W) - INSET)).resize((T, T), Image.LANCZOS)
            for r in range(4) for c in range(4)]
ca, ha = Image.new('RGB', (T * 4, T * 4)), Image.new('RGB', (T * 4, T * 4))
for i, (c, h) in enumerate(zip(tiles(col, 'RGB'), tiles(hgt, 'L'))):
    x, y = (i % 4) * T, (i // 4) * T
    ca.paste(c, (x, y))
    z = np.asarray(h, dtype=np.float32) / 255.0
    z = z - np.asarray(h.resize((32, 32), Image.BILINEAR).resize((T, T), Image.BILINEAR), dtype=np.float32) / 255.0  # remove large-scale shading
    gx = (np.roll(z, -1, 1) - np.roll(z, 1, 1)) * 0.5; gy = (np.roll(z, -1, 0) - np.roll(z, 1, 0)) * 0.5
    k = 6.0
    n = np.dstack([-gx * k, gy * k, np.ones_like(z)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    ha.paste(Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)), (x, y))
ca.save(out + '/skins_color.webp', quality=86); ha.save(out + '/skins_normal.webp', quality=90)
print('ok')
