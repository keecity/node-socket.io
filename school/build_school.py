"""Build "Riley's Big Day at The Itsy Bitsy Scholars" school front with a furnished interior.

usage: python3 build_school.py textures_dir out_dir      (needs: pip install bpy numpy pillow)
Blender space: +X right, -Y is the front of the building, +Z up.  1 unit = 1 metre.
"""
import sys, os, math, random
import numpy as np
import bpy, bmesh
from mathutils import Vector

TEX, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
random.seed(7)

# ---------------------------------------------------------------- geometry store
class Geo:
    def __init__(s): s.d = {}; s.loc = {}; s.smooth = set()
    def add(s, obj, mat, V, F, UV=None):
        g = s.d.setdefault((obj, mat), [[], [], []]); n = len(g[0])
        g[0].extend(V); g[1].extend([tuple(i + n for i in f) for f in F])
        g[2].extend(UV if UV is not None else [(0, 0)] * len(V))
G = Geo()

def box(obj, mat, x0, x1, y0, y1, z0, z1, uv=1.0, faces=None):
    """axis aligned box. `mat` may be a str or a dict {'-y': mat, ...} with 'all' as default."""
    if x1 < x0: x0, x1 = x1, x0
    if y1 < y0: y0, y1 = y1, y0
    if z1 < z0: z0, z1 = z1, z0
    P = {'+x': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], '-x': [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],
         '+y': [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
         '+z': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], '-z': [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)]}
    for k, quad in P.items():
        if faces and k not in faces: continue
        m = mat.get(k, mat.get('all')) if isinstance(mat, dict) else mat
        if m is None: continue
        ax = 'xyz'.index(k[1]); a, b = [i for i in range(3) if i != ax]
        UV = [(q[a] / uv, q[b] / uv) for q in quad]
        G.add(obj, m, quad, [(0, 1, 2, 3)], UV)

def obox(obj, mat, c, u, v, size):
    """oriented box: centre c, unit axes u,v (w = u x v), size (su,sv,sw)"""
    c = np.array(c, float); u = np.array(u, float); v = np.array(v, float); u /= np.linalg.norm(u); v = v - u * (u @ v); v /= np.linalg.norm(v)
    w = np.cross(u, v); su, sv, sw = size
    def p(i, j, k): return tuple(c + u * su / 2 * i + v * sv / 2 * j + w * sw / 2 * k)
    quads = [[p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)], [p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1)],
             [p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)], [p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)],
             [p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)], [p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), p(1, -1, -1)]]
    for q in quads: G.add(obj, mat, q, [(0, 1, 2, 3)], [(0, 0), (1, 0), (1, 1), (0, 1)])

def poly(obj, mat, pts, uv=None, flip=False):
    pts = [tuple(p) for p in pts]
    F = [tuple(range(len(pts)))]
    if flip: F = [tuple(reversed(F[0]))]
    G.add(obj, mat, pts, F, uv)

def cyl(obj, mat, cx, cy, z0, z1, r, seg=24, r1=None):
    r1 = r if r1 is None else r1
    top = [(cx + r1 * math.cos(2 * math.pi * i / seg), cy + r1 * math.sin(2 * math.pi * i / seg), z1) for i in range(seg)]
    bot = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg), z0) for i in range(seg)]
    for i in range(seg):
        j = (i + 1) % seg
        G.add(obj, mat, [bot[i], bot[j], top[j], top[i]], [(0, 1, 2, 3)])
    G.add(obj, mat, top, [tuple(range(seg))]); G.add(obj, mat, bot, [tuple(reversed(range(seg)))])

def cone(obj, mat, base, tip, r, seg=6):
    base = np.array(base, float); tip = np.array(tip, float); ax = tip - base; ax /= np.linalg.norm(ax)
    a = np.cross(ax, [0, 0, 1.0]);
    if np.linalg.norm(a) < 1e-3: a = np.cross(ax, [1.0, 0, 0])
    a /= np.linalg.norm(a); b = np.cross(ax, a)
    ring = [base + r * (a * math.cos(2 * math.pi * i / seg) + b * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    for i in range(seg):
        G.add(obj, mat, [ring[i], ring[(i + 1) % seg], tip], [(0, 1, 2)])

_ico = {}
def ico(sub):
    if sub not in _ico:
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        V = [tuple(v.co) for v in bm.verts]; F = [tuple(v.index for v in f.verts) for f in bm.faces]; bm.free(); _ico[sub] = (V, F)
    return _ico[sub]
def sphere(obj, mat, c, r, sub=2, squash=1.0, noise=0.0):
    V, F = ico(sub); c = np.array(c, float)
    out = []
    for v in V:
        v = np.array(v); s = 1 + noise * (math.sin(v[0] * 7.1 + 1.3) * math.cos(v[1] * 6.3) + math.sin(v[2] * 8.7)) / 3
        out.append(tuple(c + np.array([v[0], v[1], v[2] * squash]) * r * s))
    G.add(obj, mat, out, F); G.smooth.add(obj)

def star(obj, mat, cx, cy, cz, r, th=0.06):   # 5-point star in the XZ plane, facing -Y
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.45; a = math.radians(90 + i * 36)
        pts.append((cx + rr * math.cos(a), cz + rr * math.sin(a)))
    fr = [(x, cy, z) for x, z in pts]; bk = [(x, cy + th, z) for x, z in pts]
    G.add(obj, mat, fr + [(cx, cy, cz)], [(i, (i + 1) % 10, 10) for i in range(10)])
    G.add(obj, mat, bk + [(cx, cy + th, cz)], [((i + 1) % 10, i, 10) for i in range(10)])
    for i in range(10):
        j = (i + 1) % 10
        G.add(obj, mat, [fr[i], bk[i], bk[j], fr[j]], [(0, 1, 2, 3)])

def oriented_tile_grid(obj, mats, o, ud, sd, nrm, length, width, tw, th, thick, ov=0.05, jitter=0.012):
    """tiles laid on a plane: origin o, ud = along-eave dir, sd = down-slope dir (eave first), nrm = outward normal"""
    ud = np.array(ud, float); sd = np.array(sd, float); nrm = np.array(nrm, float)
    rows = int(length / (th - ov)); r = 0
    for r in range(rows):
        s0 = r * (th - ov)
        off = tw / 2 if r % 2 else 0
        n = int(width / tw) + 2
        for c in range(-1, n):
            x = c * tw + off
            if x + tw / 2 < 0 or x - tw / 2 > width: continue
            cen = o + ud * min(max(x, tw / 2 - 0.0), width - tw / 2 + 0.0) + sd * (s0 + th / 2) + nrm * (thick / 2 + random.uniform(0, jitter))
            obox(obj, random.choice(mats), cen, ud, sd, (tw - 0.03, th - 0.0, thick))

# ------------------------------------------------------------------ dimensions
W, T, D = 7.5, 0.25, 6.0      # half width, wall thickness, depth
F, H, CEIL = 0.3, 3.6, 3.4     # floor top, wall top, ceiling
BR = {'-y': 'brick', 'all': 'paint'}

# ============================================================ SHELL (exterior + walls)
def shell():
    o = 'Walls'
    # floor slab + interior floor layers
    box('Floor', 'concrete', -W, W, -0.1, D, 0.0, 0.24)
    box('Floor', 'floor_wood', -W + T, -2.6, T, D - T, 0.24, F, uv=1.4)
    box('Floor', 'floor_wood', 2.6, W - T, T, D - T, 0.24, F, uv=1.4)
    box('Floor', 'floor_tile', -2.6, 2.6, -0.02, D - T, 0.24, F, uv=2.0)
    # porch slab and steps
    box('Floor', 'concrete', -2.9, 2.9, -1.6, -0.1, 0.0, F)
    box('Floor', 'concrete', -3.1, 3.1, -2.2, -1.6, 0.0, 0.15)
    for s in (-1, 1):
        x0, x1 = (2.6, W) if s > 0 else (-W, -2.6)
        # front wall of the wing: brick outer skin, painted inner skin, openings for the window bank
        bx0, bx1 = (3.2, 6.9) if s > 0 else (-6.9, -3.2)
        zb, zt = 1.25, 2.75
        for (a, b, c, d) in [(x0, x1, F, zb), (x0, x1, zt, H), (x0, bx0, zb, zt), (bx1, x1, zb, zt)]:
            pm = 'paintR' if s > 0 else 'paintL'
            box(o, {'-y': 'brick', 'all': pm}, a, b, 0, 0.12, c, d, uv=1.0)
            box(o, pm, a, b, 0.12, T, c, d)
        # side wall + gable end
        sx0, sx1 = (W - T, W) if s > 0 else (-W, -W + T)
        face = '+x' if s > 0 else '-x'
        pm = 'paintR' if s > 0 else 'paintL'
        box(o, {face: 'brick', 'all': pm}, sx0, sx1, 0, D, F, H)
        zr = lambda y: 3.5 + (3.6 - abs(y - 3.0)) * (2.1 / 3.6)
        px = sx1 if s > 0 else sx0
        for yA, yB in ((0, 3.0), (3.0, 6.0)):
            pts = [(px, yA, H), (px, yB, H), (px, 3.0, 5.6)]
        tri = [(sx0, 0, H), (sx0, D, H), (sx0, 3.0, 5.55)], [(sx1, 0, H), (sx1, D, H), (sx1, 3.0, 5.55)]
        outer = tri[1] if s > 0 else tri[0]; inner = tri[0] if s > 0 else tri[1]
        poly(o, 'brick', outer, flip=(s < 0)); poly(o, pm, inner, flip=(s > 0))
        G.add(o, pm, [(sx0, 0, H), (sx1, 0, H), (sx1, 3.0, 5.55), (sx0, 3.0, 5.55)], [(0, 1, 2, 3)])
        G.add(o, pm, [(sx0, D, H), (sx0, 3.0, 5.55), (sx1, 3.0, 5.55), (sx1, D, H)], [(0, 1, 2, 3)])
        # partition between classroom and lobby, with a doorway
        p0, p1 = (2.35, 2.6) if s > 0 else (-2.6, -2.35)
        pf = {'+x': 'paintR', '-x': 'paint', 'all': 'paint'} if s > 0 else {'-x': 'paintL', '+x': 'paint', 'all': 'paint'}
        box(o, pf, p0, p1, T, 2.2, F, H); box(o, pf, p0, p1, 3.2, D - T, F, H); box(o, pf, p0, p1, 2.2, 3.2, 2.55, H)
        # cream trim: cornice band, plinth, window surround + sill, pilaster edge
        box('Trim', 'cream', x0, x1, -0.14, T, 3.28, H)
        box('Trim', 'cream', x0 - (0.0 if s > 0 else 0.0), x1, -0.1, 0.12, 0.0, 0.5)
        box('Trim', 'cream', bx0 - 0.12, bx0, -0.06, 0.15, zb - 0.12, zt + 0.15); box('Trim', 'cream', bx1, bx1 + 0.12, -0.06, 0.15, zb - 0.12, zt + 0.15)
        box('Trim', 'cream', bx0 - 0.12, bx1 + 0.12, -0.06, 0.15, zt, zt + 0.15)
        box('Trim', 'cream', bx0 - 0.2, bx1 + 0.2, -0.22, 0.15, zb - 0.14, zb)
        # windows: frame + 3 panes
        n = 3; span = (bx1 - bx0); mw = 0.09; pw = (span - mw * (n + 1)) / n
        for i in range(n + 1):
            xx = bx0 + i * (pw + mw); box('Windows', 'frame', xx, xx + mw, 0.04, 0.2, zb, zt)
        box('Windows', 'frame', bx0, bx1, 0.04, 0.2, zb, zb + 0.09); box('Windows', 'frame', bx0, bx1, 0.04, 0.2, zt - 0.09, zt)
        for i in range(n):
            xa = bx0 + mw + i * (pw + mw)
            box('Glass', 'glass', xa, xa + pw, 0.11, 0.115, zb + 0.09, zt - 0.09)
    # back wall
    for a, b, pm in ((-W, -2.6, 'paintL'), (-2.6, 2.6, 'paint'), (2.6, W, 'paintR')):
        box(o, {'+y': 'brick', '-y': pm, 'all': pm}, a, b, D - T, D, F, H)
    # ceiling and lights
    box('Ceiling', 'ceiling', -W + T, W - T, T, D - T, CEIL - 0.08, CEIL)
    for x in (-5.0, 5.0):
        for y in (1.7, 4.0): box('Ceiling', 'light', x - 0.5, x + 0.5, y - 0.3, y + 0.3, CEIL - 0.11, CEIL - 0.08)
    for y in (1.7, 4.0): box('Ceiling', 'light', -0.5, 0.5, y - 0.3, y + 0.3, CEIL - 0.11, CEIL - 0.08)
    # entry: wall with door opening, pilasters, entablature, pediment
    ow = 1.4
    for a, b in ((-2.6, -ow), (ow, 2.6)): box(o, {'-y': 'paintlight', 'all': 'paint'}, a, b, 0, T, F, 3.05)
    box(o, {'-y': 'cream', 'all': 'paint'}, -2.6, 2.6, 0, T, 3.05, H)
    for s in (-1, 1):
        a, b = (2.0, 2.6) if s > 0 else (-2.6, -2.0)
        box('Trim', 'cream', a, b, -1.5, 0.0, 0.0, 3.5)                       # pilaster / pier
        box('Trim', 'cream', a - 0.08, b + 0.08, -1.6, 0.0, 0.0, 0.5)          # base
        box('Trim', 'cream', a - 0.08, b + 0.08, -1.6, 0.0, 3.05, 3.15)        # capital
    box('Trim', 'cream', -2.75, 2.75, -1.62, 0.0, 3.15, 3.55)                  # entablature
    box('Trim', 'cream', -2.0, 2.0, -1.5, 0.0, 3.5, 3.55)
    box('Trim', 'cream', -ow - 0.12, ow + 0.12, -0.06, 0.15, 3.0, 3.15)         # door head trim
    # front of the pediment
    zp = 6.55
    poly('Pediment', 'cream', [(-2.75, -1.62, 3.55), (2.75, -1.62, 3.55), (0, -1.62, zp)])
    poly('Pediment', 'cream', [(2.75, -1.5, 3.55), (-2.75, -1.5, 3.55), (0, -1.5, zp)])
    # dark fascia trim on gable edges
    for s in (-1, 1):
        a = np.array([2.85 * s, -1.75, 3.5]); b = np.array([0, -1.75, zp + 0.25]); c = (a + b) / 2
        d = b - a; L = np.linalg.norm(d)
        obox('Trim', 'cream', c, [1, 0, 0] if False else d / L, [0, 1, 0], (L, 0.22, 0.2))

# ============================================================ ROOF
def roof():
    o = 'Roof'
    tiles = ['roof1', 'roof2', 'roof3']
    # main roof: ridge along x at y=3.0, z=5.6, eaves at y=-0.6 / 6.6, z=3.5
    L = math.hypot(3.6, 2.1); sd = np.array([0, 3.6, 2.1]) / L        # ridge is up-slope; eave dir from ridge going down
    ridge_z, ridge_y = 5.6, 3.0; xw = 2 * W + 0.9
    for side in (-1, 1):
        ydir = side * 3.6 / L; zdir = -2.1 / L
        down = np.array([0, ydir, zdir]); nrm = np.array([0, -zdir * side * -1 if False else 0, 0])
        nrm = np.array([0, side * (2.1 / L), 3.6 / L])
        origin_ridge = np.array([-xw / 2, ridge_y, ridge_z])
        # deck (slightly under tiles)
        c = origin_ridge + np.array([xw / 2, 0, 0]) + down * (L / 2 + 0.05) - nrm * 0.04
        obox(o, 'roofdeck', c, [1, 0, 0], down, (xw, L + 0.1, 0.1))
        oriented_tile_grid(o, tiles, origin_ridge, [1, 0, 0], down, nrm, L, xw, 0.55, 0.46, 0.06)
        # fascia at eave
        e = origin_ridge + down * L
        obox('Trim', 'cream', e + np.array([xw / 2, 0, 0]) + nrm * 0.0 - down * 0.02, [1, 0, 0], down, (xw, 0.1, 0.16))
    # ridge cap
    obox(o, 'roof1', np.array([0, ridge_y, ridge_z + 0.03]), [1, 0, 0], [0, 1, 0], (xw, 0.3, 0.14))
    # entry gable roof: ridge along y at x=0, z=6.8; eaves at x=+-3.0, z=3.5, from y=-1.75 back to y=2.4
    Le = math.hypot(3.0, 3.3); ylen = 4.2
    for side in (-1, 1):
        down = np.array([side * 3.0 / Le, 0, -3.3 / Le]); nrm = np.array([side * 3.3 / Le, 0, 3.0 / Le])
        origin = np.array([0, -1.75, 6.8]) 
        c = origin + np.array([0, ylen / 2, 0]) + down * (Le / 2 + 0.05) - nrm * 0.04
        obox(o, 'roofdeck', c, [0, 1, 0], down, (ylen, Le + 0.1, 0.1))
        oriented_tile_grid(o, tiles, origin, [0, 1, 0], down, nrm, Le, ylen, 0.55, 0.46, 0.06)
    obox(o, 'roof1', np.array([0, -1.75 + ylen / 2, 6.83]), [0, 1, 0], [1, 0, 0], (ylen, 0.3, 0.14))
    # closing triangle at the back of the entry roof (only seen from behind)
    poly(o, 'roofdeck', [(-3.0, 2.45, 3.5), (3.0, 2.45, 3.5), (0, 2.45, 6.8)])

# ============================================================ SIGN
def make_text(body, size, bevel=0.02, extr=0.05):
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = body; cu.size = size; cu.extrude = extr; cu.bevel_depth = bevel; cu.bevel_resolution = 1
    cu.resolution_u = 3; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('t', cu); bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    V = np.array([v.co[:] for v in me.vertices]); Fc = [tuple(p.vertices) for p in me.polygons]
    bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
    return V, Fc

def loose_parts(V, Fc):
    par = list(range(len(V)))
    def find(a):
        while par[a] != a: par[a] = par[par[a]]; a = par[a]
        return a
    for f in Fc:
        for i in f[1:]: par[find(i)] = find(f[0])
    groups = {}
    for fi, f in enumerate(Fc): groups.setdefault(find(f[0]), []).append(fi)
    return list(groups.values())

def text_mesh(obj, body, size, width, cx, cz, y, mats, outline=None, depth=0.06):
    """extruded text on the front of the sign; mats is a list cycled per glyph (merged by x-overlap)"""
    V, Fc = make_text(body, size)
    sc = width / (V[:, 0].max() - V[:, 0].min()); V = V * sc
    V[:, 0] -= (V[:, 0].max() + V[:, 0].min()) / 2; V[:, 1] -= (V[:, 1].max() + V[:, 1].min()) / 2
    def place(v, dy=0.0):   # text plane XY facing +Z  ->  XZ plane facing -Y
        return (cx + v[0], y + dy - v[2] * 1.0, cz + v[1])
    parts = loose_parts(V, Fc)
    spans = []
    for p in parts:
        idx = sorted({i for fi in p for i in Fc[fi]}); xs = V[idx, 0]; spans.append([xs.min(), xs.max(), [p]])
    spans.sort(key=lambda s: s[0]); merged = []
    for s in spans:
        if merged and s[0] < merged[-1][1] - 1e-6: merged[-1][1] = max(merged[-1][1], s[1]); merged[-1][2] += s[2]
        else: merged.append(s)
    for gi, (a, b, plist) in enumerate(merged):
        m = mats[gi % len(mats)]
        for p in plist:
            idx = sorted({i for fi in p for i in Fc[fi]}); mp = {i: k for k, i in enumerate(idx)}
            G.add(obj, m, [place(V[i]) for i in idx], [tuple(mp[i] for i in Fc[fi]) for fi in p])
    if outline:
        V2, F2 = make_text(body, size, bevel=0.055, extr=0.02)
        V2 = V2 * sc; V2[:, 0] -= (V[:, 0].max() * 0) ; 
        # re-center identically to the fill
        V2[:, 0] -= (V2[:, 0].max() + V2[:, 0].min()) / 2; V2[:, 1] -= (V2[:, 1].max() + V2[:, 1].min()) / 2
        G.add(obj, outline, [(cx + v[0], y + 0.03 - v[2], cz + v[1]) for v in V2], F2)

def sign():
    o = 'Sign'; yb = -2.02
    # cream board, rounded ends
    bw, bh, zc = 4.6, 1.45, 4.3
    pts = []
    for i in range(0, 41):
        a = math.pi * i / 40
    # rounded rectangle outline
    def rr(cx, cz, w, h, r, n=8):
        p = []
        for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            for k in range(n + 1):
                a = math.radians(a0 + 90 * k / n); p.append((cx + sx * (w / 2 - r) + r * math.cos(a) * 1, cz + sz * (h / 2 - r) + r * math.sin(a) * 1))
        return p
    ring = rr(0, zc, bw, bh, 0.28)
    # fix sign of corner offsets (cos/sin already quadrant-aware)
    ring = []
    for (cxs, czs, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(9):
            a = math.radians(a0 + 90 * k / 8); ring.append(((bw / 2 - 0.28) * cxs + 0.28 * math.cos(a), zc + (bh / 2 - 0.28) * czs + 0.28 * math.sin(a)))
    fr = [(x, yb, z) for x, z in ring]; bk = [(x, yb + 0.4, z) for x, z in ring]
    n = len(ring)
    G.add(o, 'boardcream', fr + [(0, yb, zc)], [(i, (i + 1) % n, n) for i in range(n)])
    G.add(o, 'boardcream', bk + [(0, yb + 0.4, zc)], [((i + 1) % n, i, n) for i in range(n)])
    for i in range(n): j = (i + 1) % n; G.add(o, 'boardcream', [fr[i], bk[i], bk[j], fr[j]], [(0, 1, 2, 3)])
    # coloured border ring around the board face
    ring2 = []
    for (cxs, czs, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(9):
            a = math.radians(a0 + 90 * k / 8); ring2.append(((bw / 2 - 0.28) * cxs + 0.36 * math.cos(a), zc + (bh / 2 - 0.28) * czs + 0.36 * math.sin(a)))
    for i in range(n):
        j = (i + 1) % n
        G.add(o, 'letter_purple', [(ring[i][0], yb - 0.015, ring[i][1]), (ring[j][0], yb - 0.015, ring[j][1]), (ring2[j][0], yb - 0.015, ring2[j][1]), (ring2[i][0], yb - 0.015, ring2[i][1])], [(0, 1, 2, 3)]) if False else None
    # stars
    for x, z, r in [(-2.05, 4.75, .2), (-1.55, 5.1, .17), (2.05, 4.75, .2), (1.55, 5.1, .17), (-2.25, 4.05, .16), (2.25, 4.05, .16)]:
        star(o, 'yellow', x, yb - 0.02, z, r, 0.07)
    cols = ['letter_red', 'letter_orange', 'letter_yellow', 'letter_green', 'letter_blue', 'letter_purple']
    text_mesh(o, "Riley's Big Day", 1.0, 3.9, 0, 4.62, yb - 0.02, cols, outline='outline')
    text_mesh(o, "AT", 1.0, 0.34, 0, 4.08, yb - 0.02, ['black'], depth=0.03)
    # banner: yellow ribbon with folded tails
    by = yb - 0.09; bz = 3.75; bwid = 3.7
    G.add(o, 'banner', [(-bwid / 2, by, bz - .24), (bwid / 2, by, bz - .24), (bwid / 2, by, bz + .24), (-bwid / 2, by, bz + .24)], [(0, 1, 2, 3)])
    for s in (-1, 1):
        x0 = s * bwid / 2; x1 = s * (bwid / 2 + 0.28)
        G.add(o, 'banner2', [(x0, by + 0.03, bz - .24), (x1, by + 0.03, bz - .3), (x1 - s * 0.1, by + 0.03, bz), (x1, by + 0.03, bz + .3 - .06), (x0, by + 0.03, bz + .24)], [(0, 1, 2, 3, 4)] if s < 0 else [(4, 3, 2, 1, 0)])
    text_mesh(o, "The Itsy Bitsy Scholars", 1.0, 3.1, 0, bz, by - 0.03, ['black'])
    # fanlight above the sign
    fy = -1.66; cz = 5.25; rr_ = 0.72
    G.add('Fanlight', 'sky', [(0, fy, cz)] + [(rr_ * math.cos(math.pi * i / 24), fy - 0.03, cz + rr_ * math.sin(math.pi * i / 24)) for i in range(25)],
          [(0, i + 1, i + 2) for i in range(24)], [(0.5, 0)] + [(0.5 + 0.5 * math.cos(math.pi * i / 24), 0.5 * math.sin(math.pi * i / 24) + .1) for i in range(25)])
    for i in range(25):
        a = math.pi * i / 24
    seg = 24
    for i in range(seg):
        a0 = math.pi * i / seg; a1 = math.pi * (i + 1) / seg
        pa = lambda a, r, dy: (r * math.cos(a), fy + dy, cz + r * math.sin(a))
        G.add('Fanlight', 'frame', [pa(a0, rr_, -0.05), pa(a1, rr_, -0.05), pa(a1, rr_ + .12, -0.05), pa(a0, rr_ + .12, -0.05)], [(0, 1, 2, 3)])
        G.add('Fanlight', 'cream', [pa(a0, rr_ + .12, -0.05), pa(a1, rr_ + .12, -0.05), pa(a1, rr_ + .12, 0.0), pa(a0, rr_ + .12, 0.0)], [(0, 1, 2, 3)])
    for k in range(1, 6):
        a = math.pi * k / 6
        obox('Fanlight', 'frame', np.array([0.39 * math.cos(a), fy - 0.06, cz + 0.39 * math.sin(a)]), [math.cos(a), 0, math.sin(a)], [0, 1, 0], (rr_, 0.03, 0.04))
    for r in (0.3,):
        pass

# ============================================================ DOORS
def doors():
    for s, name in ((-1, 'DoorL'), (1, 'DoorR')):
        lw, lh, th = 1.36, 2.72, 0.07
        # local coords: hinge at origin, leaf extends towards the centre (sign -s)
        d = -s
        def bx(x0, x1, z0, z1, y0=-th / 2, y1=th / 2, mat='doorwhite'):
            a, b = sorted((d * x0, d * x1)); box(name, mat, a, b, y0, y1, z0, z1)
        bx(0, lw, 0, 0.12); bx(0, lw, lh - 0.12, lh); bx(0, 0.12, 0, lh); bx(lw - 0.12, lw, 0, lh)
        bx(0.12, lw - 0.12, 0.95, 1.05)   # mid rail
        bx(0.12, lw - 0.12, 0.12, 0.95)   # solid lower panel
        a, b = sorted((d * 0.12, d * (lw - 0.12))); box('DoorGlass' + name[-1], 'glass', a, b, -0.008, 0.008, 1.05, lh - 0.12)
        hx = d * (lw - 0.2); box(name, 'metal', hx - 0.02, hx + 0.02, -th / 2 - 0.06, -th / 2, 0.85, 1.55)
        box(name, 'metal', hx - 0.02, hx + 0.02, th / 2, th / 2 + 0.06, 0.85, 1.55)
        G.loc[name] = (s * 1.36, 0.1, F); G.loc['DoorGlass' + name[-1]] = (s * 1.36, 0.1, F)
        G.parent = getattr(G, 'parent', {}); G.parent['DoorGlass' + name[-1]] = name
    # centre mullion frame (fixed)
    box('Windows', 'doorwhite', -1.5, -1.36, -0.05, 0.22, F, 3.05); box('Windows', 'doorwhite', 1.36, 1.5, -0.05, 0.22, F, 3.05)
    box('Windows', 'doorwhite', -1.5, 1.5, -0.05, 0.22, 2.98, 3.05)
    # transom glass over the doors
    box('Glass', 'glass', -1.36, 1.36, 0.1, 0.105, 3.05 - 0.07, 3.05)  # thin strip (door head gap)

# ============================================================ FURNITURE
def chair(x, y, face, col):
    o = 'Furniture'; z0 = F
    box(o, col, x - .17, x + .17, y - .17, y + .17, z0 + .26, z0 + .30)
    for dx in (-.14, .14):
        for dy in (-.14, .14): box(o, 'legmetal', x + dx - .015, x + dx + .015, y + dy - .015, y + dy + .015, z0, z0 + .26)
    by = y + (0.17 if face < 0 else -0.19)   # back on the side away from the table
    box(o, col, x - .17, x + .17, by, by + 0.02, z0 + .30, z0 + .55)
def table(x, y, col_top='tablewood'):
    o = 'Furniture'
    box(o, col_top, x - .6, x + .6, y - .4, y + .4, F + .48, F + .54)
    for dx in (-.55, .55):
        for dy in (-.35, .35): box(o, 'legmetal', x + dx - .025, x + dx + .025, y + dy - .025, y + dy + .025, F, F + .48)
def shelf_unit(x0, x1, y0, y1, h, levels=3, book_side=None, axis='y'):
    o = 'Furniture'
    box(o, 'shelfwhite', x0, x1, y0, y1, F, F + 0.04)
    box(o, 'shelfwhite', x0, x1, y0, y1, F + h - 0.04, F + h)
    zs = [F + h * i / levels for i in range(levels + 1)]
    for z in zs: box(o, 'shelfwhite', x0, x1, y0, y1, z, z + 0.035)
    return zs
def books(x0, x1, y0, y1, zs, along, rnd):
    cols = ['red', 'blue', 'yellow', 'green', 'purple', 'orange']
    for i in range(len(zs) - 1):
        z = zs[i] + 0.035; hh = (zs[i + 1] - zs[i]) - 0.07
        t = 0.0
        L = (x1 - x0) if along == 'x' else (y1 - y0)
        while t < L - 0.12:
            wbk = rnd.uniform(0.03, 0.06); h = rnd.uniform(0.6, 0.92) * hh; c = rnd.choice(cols)
            if along == 'x': box('Books', c, x0 + t, x0 + t + wbk, y0 + 0.03, y1 - 0.03, z, z + h)
            else: box('Books', c, x0 + 0.03, x1 - 0.03, y0 + t, y0 + t + wbk, z, z + h)
            t += wbk + 0.004
def poster(name, x, z, w, y, face='-y'):
    box('Posters', {'-y': name, 'all': 'paint'}, x - w / 2, x + w / 2, y - 0.02, y, z - w / 2, z + w / 2, faces=['-y'])

def interior():
    rnd = random.Random(5)
    ccols = ['red', 'blue', 'yellow', 'green']
    for s in (-1, 1):
        xc = 5.0 * s
        # tables + chairs, near the front so they read through the windows
        for k, (tx, ty) in enumerate([(xc - 1.15, 1.6), (xc + 1.15, 1.6), (xc, 3.0)]):
            table(tx, ty)
            for j, (cx, cy, fc) in enumerate([(tx - .25, ty - .62, 1), (tx + .25, ty - .62, 1), (tx - .25, ty + .62, -1), (tx + .25, ty + .62, -1)]):
                chair(cx, cy, fc, ccols[(k + j) % 4])
        # rug + blocks
        cyl('Furniture', 'rug1', xc, 4.35, F, F + .012, 0.95, 32); cyl('Furniture', 'rug2', xc, 4.35, F + .012, F + .022, 0.72, 32); cyl('Furniture', 'rug3', xc, 4.35, F + .022, F + .032, 0.45, 32)
        for i, (bx_, by_, c) in enumerate([(-.3, -.1, 'red'), (0.0, -.15, 'blue'), (.3, -.05, 'yellow'), (-.15, -.1, 'green')]):
            box('Furniture', c, xc + bx_ - .1, xc + bx_ + .1, 4.35 + by_ - .1, 4.35 + by_ + .1, F + .03, F + .23)
        box('Furniture', 'purple', xc - .1, xc + .1, 4.25, 4.45, F + .23, F + .43)
        # low bookcase along the back wall, posters above
        zs = shelf_unit(xc - 1.9, xc + 1.9, D - T - 0.4, D - T, 0.9, 2)
        books(xc - 1.9, xc + 1.9, D - T - 0.4, D - T, zs, 'x', rnd)
        pnames = ['poster_sun', 'poster_star'] if s < 0 else ['poster_abc', 'poster_art']
        poster(pnames[0], xc - 1.15, 2.05, 1.05, D - T - 0.001); poster(pnames[1], xc + 1.15, 2.05, 1.05, D - T - 0.001)
        # tall shelf on the outer side wall
        sx0, sx1 = (W - T - 0.4, W - T) if s > 0 else (-W + T, -W + T + 0.4)
        zs = shelf_unit(sx0, sx1, 2.6, 4.8, 1.7, 4)
        books(sx0, sx1, 2.6, 4.8, zs, 'y', rnd)
    # lobby: reception desk, rug, plants
    box('Furniture', 'blue', -1.4, 1.4, 4.5, 5.2, F, F + 1.0); box('Furniture', 'boardcream', -1.5, 1.5, 4.45, 5.25, F + 1.0, F + 1.06)
    box('Furniture', 'yellow', -1.4, 1.4, 4.44, 4.5, F + 0.5, F + 0.62)
    cyl('Furniture', 'rug1', 0, 2.4, F, F + .012, 1.1, 32); cyl('Furniture', 'rug2', 0, 2.4, F + .012, F + .022, 0.8, 32)
    poster('poster_star', 0, 2.3, 1.2, D - T - 0.001)
    for x in (-1.9, 1.9):
        cyl('Furniture', 'red', x, 1.0, F, F + .35, .22, 16); sphere('Furniture', 'leaf', (x, 1.0, F + .7), .35, 2, 1.2, 0.3)

# ============================================================ EXTERIOR PLANTS + BUNTING
def plants():
    rnd = random.Random(3)
    for s in (-1, 1):
        box('Plants', 'mulch', s * 2.7 if s > 0 else -8.0, 8.0 if s > 0 else -2.7, -1.35, -0.1, 0.0, 0.1)
    beds = []
    for s in (-1, 1):
        for x, r in ((6.15, .78), (4.0, .74)): beds.append((s * x, -0.85, r))
        beds.append((s * 5.05, -1.0, .42))
    for x, y, r in beds:
        z = 0.1 + r * 0.72
        sphere('Foliage', 'leaf', (x, y, z), r, 2, 0.85, 0.25)
        # flowers on the upper hemisphere
        for i in range(int(46 * r)):
            th = rnd.uniform(0, 2 * math.pi); ph = math.acos(rnd.uniform(0.05, 1.0)) * 0.95
            dirv = np.array([math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th) * 0.9 - 0.15, math.cos(ph)])
            dirv /= np.linalg.norm(dirv)
            p = np.array([x, y, z]) + dirv * np.array([r, r, r * 0.85]) * 1.02
            sphere('Foliage', rnd.choice(['flower_pink', 'flower_pink', 'flower_orange', 'flower_yellow', 'flower_red']), p, 0.06, 1, 1.0)
    # spiky plants at the ends and by the pilasters
    for x in (-7.4, -3.0, 3.0, 7.4):
        for k in range(7):
            a = math.radians(-70 + k * 23) + (0 if x > 0 else 0)
            base = np.array([x, -0.9, 0.1]); tip = base + np.array([0.5 * math.sin(a), -0.15 * math.cos(a) * 0 - 0.15 * abs(math.cos(a)), 0.55 + 0.1 * math.cos(a)])
            cone('Foliage', 'leaf2', base, tip, 0.08, 5)
    # pilaster lily pads: small round plants
    for x in (-3.45, 3.45):
        sphere('Foliage', 'leaf2', (x, -1.05, 0.28), 0.28, 2, 0.8, 0.2)
        for i in range(5):
            th = rnd.uniform(0, 6.28); sphere('Foliage', 'flower_orange', (x + 0.26 * math.cos(th) * 0.8, -1.05 - abs(0.26 * math.sin(th)) * 0.8, 0.4), 0.05, 1)

def bunting():
    o = 'Bunting'
    cols_l = ['blue', 'red', 'yellow', 'green', 'red']; cols_r = ['yellow', 'red', 'green', 'yellow', 'purple', 'blue']
    for s in (-1, 1):
        cols = cols_l if s < 0 else cols_r
        n = len(cols)
        xa, xb = s * 2.85, s * 7.6
        za, zb = 3.5, 3.0
        pts = []
        for i in range(61):
            t = i / 60; x = xa + (xb - xa) * t
            z = za + (zb - za) * t - 0.32 * 4 * t * (1 - t)
            pts.append(np.array([x, -0.25, z]))
        for i in range(60):
            a, b = pts[i], pts[i + 1]; c = (a + b) / 2; d = b - a; L = np.linalg.norm(d)
            obox(o, 'string', c, d / L, [0, 1, 0], (L, 0.02, 0.02))
        for k in range(n):
            t = (k + 0.5) / n; i = int(t * 60); p = pts[i]; q = pts[min(i + 1, 60)]
            d = (q - p) / np.linalg.norm(q - p); w = 0.5
            a = p - d * w / 2; b = p + d * w / 2; tip = p + np.array([0, -0.03, -0.52])
            G.add(o, cols[k], [tuple(a + [0, -0.03, 0]), tuple(b + [0, -0.03, 0]), tuple(tip)], [(0, 1, 2), (2, 1, 0)])
            G.add(o, cols[k], [tuple(a + [0, -0.03, 0]), tuple(b + [0, -0.03, 0]), tuple(tip)], [(2, 1, 0)])

# ============================================================ MATERIALS + OBJECTS
MATS = {
 'brick': dict(tex='brick.jpg', rough=.9), 'cream': dict(c=(.97, .90, .74), rough=.8), 'paintlight': dict(c=(.97, .90, .74), rough=.9),
 'paint': dict(c=(.99, .90, .70), rough=.95), 'paintL': dict(c=(1.0, .82, .38), rough=.95), 'paintR': dict(c=(.52, .78, .96), rough=.95), 'ceiling': dict(c=(.97, .97, .95), rough=.95), 'light': dict(c=(1, 1, .95), emit=3.0),
 'concrete': dict(c=(.86, .84, .80), rough=.9), 'floor_wood': dict(tex='wood.jpg', rough=.7), 'floor_tile': dict(tex='tile.jpg', rough=.5),
 'roof1': dict(c=(.66, .32, .17), rough=.8), 'roof2': dict(c=(.72, .38, .20), rough=.8), 'roof3': dict(c=(.60, .28, .15), rough=.8),
 'roofdeck': dict(c=(.45, .22, .12), rough=.9),
 'glass': dict(c=(.45, .68, .85), rough=.05, alpha=.14), 'frame': dict(c=(.97, .97, .97), rough=.5), 'doorwhite': dict(c=(.96, .96, .97), rough=.4),
 'metal': dict(c=(.75, .77, .8), rough=.3, metal=1.0), 'legmetal': dict(c=(.7, .72, .75), rough=.4, metal=.8),
 'leaf': dict(c=(.10, .52, .12), rough=.8), 'leaf2': dict(c=(.25, .68, .18), rough=.8), 'mulch': dict(c=(.30, .15, .08), rough=1),
 'flower_pink': dict(c=(.95, .35, .55), rough=.6), 'flower_orange': dict(c=(.98, .55, .2), rough=.6), 'flower_yellow': dict(c=(1, .85, .2), rough=.6), 'flower_red': dict(c=(.9, .15, .2), rough=.6),
 'red': dict(c=(.9, .15, .2), rough=.5), 'blue': dict(c=(.15, .4, .9), rough=.5), 'yellow': dict(c=(1, .82, .1), rough=.5), 'green': dict(c=(.2, .7, .25), rough=.5),
 'purple': dict(c=(.55, .2, .75), rough=.5), 'orange': dict(c=(1, .5, .1), rough=.5), 'black': dict(c=(.05, .04, .05), rough=.6),
 'boardcream': dict(c=(.98, .94, .82), rough=.6), 'banner': dict(c=(1, .84, .1), rough=.5), 'banner2': dict(c=(.9, .68, .05), rough=.5),
 'outline': dict(c=(.18, .05, .12), rough=.5),
 'letter_red': dict(c=(.9, .12, .2), rough=.4), 'letter_orange': dict(c=(1, .5, .05), rough=.4), 'letter_yellow': dict(c=(1, .85, .1), rough=.4),
 'letter_green': dict(c=(.15, .7, .2), rough=.4), 'letter_blue': dict(c=(.15, .4, .95), rough=.4), 'letter_purple': dict(c=(.55, .2, .8), rough=.4),
 'tablewood': dict(c=(.93, .78, .55), rough=.6), 'shelfwhite': dict(c=(.97, .95, .9), rough=.6),
 'rug1': dict(c=(.85, .2, .25), rough=1), 'rug2': dict(c=(.98, .8, .2), rough=1), 'rug3': dict(c=(.2, .55, .9), rough=1),
 'string': dict(c=(.1, .1, .1), rough=.8), 'sky': dict(tex='sky.jpg', rough=.3, emit_tex=.4),
 'poster_sun': dict(tex='poster_sun.jpg', rough=.6), 'poster_star': dict(tex='poster_star.jpg', rough=.6),
 'poster_abc': dict(tex='poster_abc.jpg', rough=.6), 'poster_art': dict(tex='poster_art.jpg', rough=.6),
}
# unlit-ish colourful flags use the same solid colours as the furniture ones (red/blue/yellow/green/purple)

def make_material(name):
    p = MATS[name]; m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = p.get('rough', .8); b.inputs['Metallic'].default_value = p.get('metal', 0.0)
    if 'tex' in p:
        img = bpy.data.images.load(os.path.join(TEX, p['tex'])); img.pack()
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if 'emit_tex' in p:
            nt.links.new(t.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = p['emit_tex']
    else:
        c = p['c']; b.inputs['Base Color'].default_value = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1)
    if 'emit' in p:
        c = p['c']; b.inputs['Emission Color'].default_value = (c[0], c[1], c[2], 1); b.inputs['Emission Strength'].default_value = p['emit']
    if 'alpha' in p:
        b.inputs['Alpha'].default_value = p['alpha']
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
        try: m.blend_method = 'BLEND'
        except Exception: pass
    m.use_backface_culling = False
    return m

def build_objects():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {}
    objs = {}
    for (obj, mat), (V, Fc, UV) in G.d.items():
        if mat not in mats: mats[mat] = make_material(mat)
    for obj in sorted({k[0] for k in G.d}):
        me = bpy.data.meshes.new(obj); allV, allF, allUV, fm = [], [], [], []
        order = []
        for (o2, mat), (V, Fc, UV) in G.d.items():
            if o2 != obj: continue
            if mat not in order: order.append(mat)
            n = len(allV); allV += V; allUV += UV
            for f in Fc: allF.append(tuple(i + n for i in f)); fm.append(order.index(mat))
        me.from_pydata(allV, [], allF)
        uvl = me.uv_layers.new(name='UVMap')
        for poly_ in me.polygons:
            for li in poly_.loop_indices: uvl.data[li].uv = allUV[me.loops[li].vertex_index]
        for mat in order: me.materials.append(mats[mat])
        me.polygons.foreach_set('material_index', fm)
        me.polygons.foreach_set('use_smooth', [obj in G.smooth] * len(me.polygons))
        me.update(); me.validate()
        ob = bpy.data.objects.new(obj, me); bpy.context.scene.collection.objects.link(ob)
        if obj in G.loc: ob.location = G.loc[obj]
        objs[obj] = ob
    for k, par in getattr(G, 'parent', {}).items():
        objs[k].parent = objs[par]; objs[k].location = (0, 0, 0)
    return objs

def animate(objs):
    sc = bpy.context.scene; sc.render.fps = 30
    for name, ang in (('DoorL', -100), ('DoorR', 100)):
        ob = objs[name]; ob.animation_data_create(); act = bpy.data.actions.new('DoorsOpen'); ob.animation_data.action = act
        for f, a in ((1, 0), (30, ang), (60, 0)):
            ob.rotation_euler = (0, 0, math.radians(a)); ob.keyframe_insert('rotation_euler', frame=f)
        ob.rotation_euler = (0, 0, 0)

if __name__ == '__main__':
    shell(); roof(); sign(); doors(); interior(); plants(); bunting()
    G.d[('Ground', 'ground')] = [[(-14, -12, -0.02), (14, -12, -0.02), (14, 10, -0.02), (-14, 10, -0.02)], [(0, 1, 2, 3)], [(0, 0)] * 4]
    MATS['ground'] = dict(c=(.86, .88, .82), rough=1)
    objs = build_objects(); animate(objs)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'riley_school.glb'), export_format='GLB', export_animation_mode='ACTIVE_ACTIONS',
                              export_yup=True, export_image_format='JPEG', export_jpeg_quality=88)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'riley_school.blend'))
    print('done', {k: len(v.data.vertices) for k, v in objs.items()})
