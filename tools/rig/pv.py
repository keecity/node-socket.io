import sys, importlib
from anim import *
from render import texcols
from PIL import Image, ImageDraw, ImageFont
COL = texcols(U, F, IMG).astype(float)
IB = {k: np.linalg.inv(fk({})[k]) for k in NAMES}
def deform(q):
    M = fk(q); S = np.stack([M[k] @ IB[k] for k in NAMES])
    Ph = np.c_[P, np.ones(len(P))]; out = np.zeros((len(P), 3))
    for i in range(4): out += WEIGHTS[:, i:i+1] * np.einsum('nij,nj->ni', S[JOINTS[:, i]], Ph)[:, :3]
    return out
LIGHT = nrm([0.4, 0.8, 0.6])
def _sphere(nu=20, nv=12):
    v = []; f = []
    for i in range(nv + 1):
        th = np.pi * i / nv
        for j in range(nu + 1): ph = 2 * np.pi * j / nu; v.append([np.sin(th) * np.cos(ph), np.cos(th), np.sin(th) * np.sin(ph)])
    for i in range(nv):
        for j in range(nu): a = i * (nu + 1) + j; b = a + nu + 1; f += [[a, a + 1, b], [a + 1, b + 1, b]]
    return np.array(v), np.array(f)
SPH, SPF = _sphere()
def view_mat(name):
    return {'front': R3(), 'side': R3(('y', -90)), 'q34': R3(('y', -35), ('x', 12)), 'back': R3(('y', 180)), 'oside': R3(('y', 90))}[name]
def draw(Q, ball, name, box, S=320, label=None, rim=False):
    V = view_mat(name); X = Q @ V.T
    im = Image.new('RGB', (S, S), (46, 48, 60)); d = ImageDraw.Draw(im)
    cx, cy, half = box; sc = S / (2 * half)
    tp = lambda p: ((p[0] - cx) * sc + S / 2, S / 2 - (p[1] - cy) * sc)
    # floor line / grid
    for gz in np.arange(-1, 3.01, 0.25):
        a = V @ np.array([-0.6, 0, gz]); b = V @ np.array([0.6, 0, gz]); d.line([tp(a), tp(b)], fill=(70, 70, 80))
    tri = X[F]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    wn = fn @ V  # back to world
    shade = 0.45 + 0.55 * np.abs(wn @ LIGHT)
    cols = np.clip(COL * shade[:, None], 0, 255).astype(int)
    depth = tri[:, :, 2].mean(1)
    items = [(depth[i], 'f', i) for i in range(len(F))]
    if ball is not None:
        bt = (SPH * BALL_R + ball) @ V.T
        for i, f in enumerate(SPF):
            p = bt[f]; nn = np.cross(p[1]-p[0], p[2]-p[0])
            if nn[2] < 0: continue
            l = 0.5 + 0.5 * abs(nrm(SPH[f].mean(0)) @ LIGHT); seam = min(abs(SPH[f].mean(0))) < 0.06
            items.append((p[:, 2].mean(), 'b', (p, (int(25*l), int(12*l), int(6*l)) if seam else (int(225*l), int(110*l), int(35*l)))))
    if rim:
        for k in range(24):
            a = 2 * np.pi * k / 24; p = V @ (RIM + RIM_R * np.array([np.cos(a), 0, np.sin(a)]))
            items.append((p[2], 'r', p))
    items.sort(key=lambda it: it[0])
    for dz, kind, v in items:
        if kind == 'f': d.polygon([tp(X[j]) for j in F[v]], fill=tuple(cols[v]))
        elif kind == 'b':
            d.polygon([tp(p) for p in v[0]], fill=v[1])
        else:
            c = tp(v); d.ellipse([c[0]-2, c[1]-2, c[0]+2, c[1]+2], fill=(255, 90, 0))
    if label: d.text((6, 4), label, fill=(255, 255, 255))
    return im
def sheet(frames, balls, times, out, views=('front', 'side', 'q34'), box=(0, 0.45, 0.55), rim=False, follow=True, S=320):
    tiles = Image.new('RGB', (S * len(times), S * len(views)))
    for i, t in enumerate(times):
        f = min(int(round(t * FPS)), len(frames) - 1); Q = deform(frames[f])
        r = frames[f]['_root']
        for j, vname in enumerate(views):
            V = view_mat(vname); cen = V @ (np.array([0, box[1], 0]) + (r if follow else 0))
            tiles.paste(draw(Q, balls[f], vname, (cen[0], cen[1], box[2]), S, f'{t:.2f}s {vname}', rim), (S * i, S * j))
    tiles.save(out)
