"""
Procedural, spline-lofted track/drift coupe (FR-S / 86 inspired widebody).

Run:  python build_car.py            (needs `pip install bpy`)

Workflow (same idea as a "car spline" modelling tutorial):
  1. Side-profile splines (roofline, beltline, floor) + top-view width spline
  2. Cross-section splines at every station along the car (Catmull-Rom == Bezier)
  3. Loft the cross-sections into a quad-grid body shell
  4. Split the grid along panel lines -> body / front bumper / rear bumper / side skirts
  5. Swappable bumper & skirt *variants* are built on the same grid, so they always fit

Car axes while building: +X = front, +Y = left, +Z = up. The root empty rotates
the whole car so that it faces -Y (Blender's "front" convention).
"""
import bpy, bmesh, math, os, sys, bisect
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# =============================================================================
# 1. spline helpers
# =============================================================================
def clamp(v, a, b):
    return max(a, min(b, v))


def pchip_slopes(xs, ys):
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            h0, h1 = xs[i] - xs[i - 1], xs[i + 1] - xs[i]
            w1, w2 = 2 * h1 + h0, h1 + 2 * h0
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    return m


class Profile:
    """Monotone cubic Hermite spline y(x); also exportable as a Blender Bezier curve."""

    def __init__(self, pts):
        self.xs = [p[0] for p in pts]
        self.ys = [p[1] for p in pts]
        self.ms = pchip_slopes(self.xs, self.ys)

    def __call__(self, x):
        xs, ys, ms = self.xs, self.ys, self.ms
        i = clamp(bisect.bisect_right(xs, x) - 1, 0, len(xs) - 2)
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1])

    def bezier_points(self):
        out = []
        n = len(self.xs)
        for i in range(n):
            hl = (self.xs[i] - self.xs[i - 1]) / 3 if i > 0 else (self.xs[1] - self.xs[0]) / 3
            hr = (self.xs[i + 1] - self.xs[i]) / 3 if i < n - 1 else hl
            out.append(((self.xs[i], self.ys[i]),
                        (self.xs[i] - hl, self.ys[i] - self.ms[i] * hl),
                        (self.xs[i] + hr, self.ys[i] + self.ms[i] * hr)))
        return out


def cr_handles(P):
    """Catmull-Rom through P expressed as Bezier (exactly): returns [(co, hl, hr)]."""
    n = len(P)
    res = []
    for i in range(n):
        p0 = P[i - 1] if i > 0 else None
        p2 = P[i + 1] if i < n - 1 else None
        if p0 is None:
            m = (p2[0] - P[i][0], p2[1] - P[i][1])
        elif p2 is None:
            m = (P[i][0] - p0[0], P[i][1] - p0[1])
        else:
            m = ((p2[0] - p0[0]) / 2, (p2[1] - p0[1]) / 2)
        res.append((P[i], (P[i][0] - m[0] / 3, P[i][1] - m[1] / 3),
                    (P[i][0] + m[0] / 3, P[i][1] + m[1] / 3)))
    return res


def sample_cr(P, per=6):
    H = cr_handles(P)
    out = []
    for i in range(len(P) - 1):
        b0, b1, b2, b3 = P[i], H[i][2], H[i + 1][1], P[i + 1]
        for s in range(per):
            t = s / per
            u = 1 - t
            out.append((u ** 3 * b0[0] + 3 * u * u * t * b1[0] + 3 * u * t * t * b2[0] + t ** 3 * b3[0],
                        u ** 3 * b0[1] + 3 * u * u * t * b1[1] + 3 * u * t * t * b2[1] + t ** 3 * b3[1]))
    out.append(P[-1])
    return out


# =============================================================================
# 2. car definition (meters)
# =============================================================================
WHEELBASE_HALF = 1.285
TIRE_R = 0.335
X_TIP_F, X_TIP_R = 2.16, -2.14
X0_F, X0_R = 1.96, -1.96           # where the nose / tail starts to round off
ZONE_X = 1.70                      # bumper panel line (|x|)
STEP = 0.02
JC1, JC2 = 21, 27                  # panel-line ring indices (rocker / bumper)
SKIRT_A = 6
NSEG, PER = 9, 6
NRING = NSEG * PER + 1             # 55 rings per half section
LOOP = (NRING - 1) * 2             # 108 rings around the full section

ROOF = Profile([(-2.14, 0.92), (-2.05, 0.98), (-1.85, 0.985), (-1.5, 0.98), (-1.2, 0.99), (-1.0, 1.05),
                (-0.7, 1.17), (-0.4, 1.255), (-0.1, 1.27), (0.15, 1.22), (0.4, 1.04), (0.62, 0.87),
                (0.9, 0.83), (1.2, 0.815), (1.6, 0.765), (1.94, 0.67), (2.1, 0.61), (2.16, 0.57)])
BELT = Profile([(-2.14, 0.86), (-1.95, 0.92), (-1.5, 0.93), (-1.2, 0.92), (-0.9, 0.88), (-0.3, 0.86),
                (0.3, 0.855), (0.62, 0.84), (1.0, 0.79), (1.4, 0.76), (1.8, 0.66), (2.05, 0.585), (2.16, 0.53)])
WIDTH = Profile([(-2.14, 0.84), (-2.05, 0.90), (-1.85, 0.95), (-1.6, 0.975), (-1.285, 1.02), (-0.9, 0.965),
                 (-0.4, 0.93), (0.4, 0.93), (0.9, 0.965), (1.285, 1.02), (1.6, 0.98), (1.85, 0.95),
                 (2.05, 0.92), (2.16, 0.86)])
FLOOR = Profile([(-2.14, 0.26), (-2.0, 0.22), (-1.6, 0.20), (1.6, 0.20), (2.0, 0.22), (2.16, 0.26)])


def station_params(x):
    T = ROOF(x)
    B = min(BELT(x), T - 0.03)
    return WIDTH(x), B, T, FLOOR(x)


def half_section(x):
    w, B, T, ZB = station_params(x)
    d = T - B
    g = clamp((d - 0.06) / 0.28, 0, 1)
    wr = w * (0.84 - 0.16 * g)
    P = [(0.0, ZB), (0.55 * w, ZB), (0.93 * w, ZB + 0.02), (0.995 * w, ZB + 0.12),
         (w, 0.5 * (ZB + B)), (0.995 * w, B - 0.03),
         (w * (0.985 - 0.065 * g), B + 0.02 + 0.05 * g),
         (wr, B + d * (0.72 + 0.20 * g)),
         (wr * 0.55, B + d * 0.94),
         (0.0, T)]
    return P, g, wr


def taper(x):
    if x > X0_F:
        u = (x - X0_F) / (X_TIP_F - X0_F)
        return 0.74 + 0.26 * math.sqrt(max(1 - u ** 3, 0))
    if x < X0_R:
        u = (x - X0_R) / (X_TIP_R - X0_R)
        return 0.74 + 0.26 * math.sqrt(max(1 - u ** 3, 0))
    return 1.0


# ---- loft: full-loop sections at each station -------------------------------
XS = [X_TIP_R + STEP * i for i in range(int(round((X_TIP_F - X_TIP_R) / STEP)) + 1)]
NS = len(XS)
GRID = []          # GRID[i][k] -> Vector
STATION_INFO = []  # (g, wr)
for x in XS:
    P, g, wr = half_section(x)
    hs = sample_cr(P, PER)
    s = taper(x)
    zc = 0.5 * (P[0][1] + P[-1][1])
    ring = []
    for (y, z) in hs:
        ring.append(Vector((x, y * s, zc + (z - zc) * s)))
    for m in range(1, NRING - 1):
        y, z = hs[NRING - 1 - m]
        ring.append(Vector((x, -y * s, zc + (z - zc) * s)))
    assert len(ring) == LOOP
    GRID.append(ring)
    STATION_INFO.append((g, wr))


def quad_mid(i, k):
    a = GRID[i][k]; b = GRID[i + 1][k]; c = GRID[i + 1][(k + 1) % LOOP]; d = GRID[i][(k + 1) % LOOP]
    return (a + b + c + d) / 4


def zone_jc(xm):
    return JC2 if abs(xm) >= ZONE_X else JC1


def xmid(i):
    return 0.5 * (XS[i] + XS[i + 1])


# =============================================================================
# 3. materials
# =============================================================================
MAT = {}


def mk_mat(name, color, rough=0.5, metal=0.0, alpha=1.0, emit=None, spec=0.5, carbon=False, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.5
    if carbon:  # visible in .blend renders only (procedural); glTF gets the plain colour
        tc = nt.nodes.new("ShaderNodeTexCoord")
        ck = nt.nodes.new("ShaderNodeTexChecker")
        ck.inputs["Scale"].default_value = 260
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.15
        nt.links.new(tc.outputs["Object"], ck.inputs["Vector"])
        nt.links.new(ck.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    MAT[name] = m
    return m


def make_materials():
    mk_mat("Carbon", (0.022, 0.022, 0.026), rough=0.42, coat=0.15, carbon=True)
    mk_mat("CarbonMatte", (0.035, 0.035, 0.04), rough=0.55, carbon=True)
    mk_mat("Glass", (0.02, 0.03, 0.04), rough=0.05, alpha=0.45, spec=0.9)
    mk_mat("Tire", (0.015, 0.015, 0.015), rough=0.85)
    mk_mat("RimBlack", (0.02, 0.02, 0.022), rough=0.3, metal=0.6)
    mk_mat("Chrome", (0.85, 0.86, 0.9), rough=0.08, metal=1.0)
    mk_mat("Red", (0.75, 0.02, 0.02), rough=0.3, metal=0.2)
    mk_mat("DarkMesh", (0.005, 0.005, 0.006), rough=0.7)
    mk_mat("Steel", (0.35, 0.36, 0.38), rough=0.3, metal=1.0)
    mk_mat("LensDark", (0.03, 0.03, 0.04), rough=0.06, alpha=0.8)
    mk_mat("TailLight", (0.7, 0.02, 0.02), rough=0.15, emit=(0.6, 0.0, 0.0))
    mk_mat("Interior", (0.03, 0.03, 0.03), rough=0.9)
    mk_mat("Accent", (0.9, 0.35, 0.02), rough=0.4)


# =============================================================================
# 4. mesh builder
# =============================================================================
class MB:
    def __init__(s):
        s.v, s.f, s.m, s.sm, s.mats = [], [], [], [], []

    def mi(s, name):
        if name not in s.mats:
            s.mats.append(name)
        return s.mats.index(name)

    def add(s, verts, faces, mat, smooth=False):
        b = len(s.v)
        s.v += [tuple(v) for v in verts]
        mi = s.mi(mat)
        for f in faces:
            s.f.append([b + i for i in f]); s.m.append(mi); s.sm.append(smooth)

    def box(s, c, size, mat, rot=(0, 0, 0)):
        R = Euler(rot).to_matrix()
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        vs = [(sx * hx, sy * hy, sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        vs = [Vector(c) + R @ Vector(v) for v in vs]
        idx = {(sx, sy, sz): i for i, (sx, sy, sz) in enumerate([(a, b, c_) for a in (-1, 1) for b in (-1, 1) for c_ in (-1, 1)])}
        def q(*t): return [idx[k] for k in t]
        faces = [q((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1)),
                 q((1, -1, -1), (1, -1, 1), (1, 1, 1), (1, 1, -1)),
                 q((-1, -1, -1), (-1, -1, 1), (1, -1, 1), (1, -1, -1)),
                 q((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)),
                 q((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)),
                 q((-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1))]
        s.add(vs, faces, mat)

    def cyl(s, p0, p1, r, mat, seg=20, r1=None, smooth=True):
        p0, p1 = Vector(p0), Vector(p1)
        ax = (p1 - p0)
        L = ax.length
        q = ax.to_track_quat('Z', 'Y')
        vs = []
        r1 = r if r1 is None else r1
        for j in range(seg):
            a = 2 * math.pi * j / seg
            vs.append(p0 + q @ Vector((r * math.cos(a), r * math.sin(a), 0)))
        for j in range(seg):
            a = 2 * math.pi * j / seg
            vs.append(p0 + q @ Vector((r1 * math.cos(a), r1 * math.sin(a), L)))
        faces = [[j, (j + 1) % seg, seg + (j + 1) % seg, seg + j] for j in range(seg)]
        faces.append(list(reversed(range(seg))))
        faces.append([seg + j for j in range(seg)])
        s.add(vs, faces, mat, smooth)

    def sphere(s, c, radii, mat, rot=(0, 0, 0), seg=16, rings=10):
        R = Euler(rot).to_matrix()
        vs = []
        for r_ in range(rings + 1):
            th = math.pi * r_ / rings
            for j in range(seg):
                ph = 2 * math.pi * j / seg
                p = Vector((radii[0] * math.sin(th) * math.cos(ph), radii[1] * math.sin(th) * math.sin(ph), radii[2] * math.cos(th)))
                vs.append(Vector(c) + R @ p)
        faces = []
        for r_ in range(rings):
            for j in range(seg):
                a = r_ * seg + j; b = r_ * seg + (j + 1) % seg
                faces.append([a, b, b + seg, a + seg])
        s.add(vs, faces, mat, True)

    def prism_xy(s, poly, z0, z1, mat, chamfer=False):
        n = len(poly)
        vs = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
        faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
        faces.append(list(reversed(range(n))))
        faces.append([n + i for i in range(n)])
        s.add(vs, faces, mat)

    def extrude_y(s, poly_xz, y0, y1, mat, origin=(0, 0, 0), rot=(0, 0, 0), smooth=False):
        """extrude an XZ outline along Y (airfoil, fins, endplates ...)"""
        R = Euler(rot).to_matrix()
        n = len(poly_xz)
        vs = []
        for y in (y0, y1):
            for x, z in poly_xz:
                vs.append(Vector(origin) + R @ Vector((x, y, z)))
        faces = [[i, n + i, n + (i + 1) % n, (i + 1) % n] for i in range(n)]
        faces.append(list(reversed(range(n))))
        faces.append([n + i for i in range(n)])
        s.add(vs, faces, mat, smooth)

    def lathe(s, profile, mat, seg=48, center=(0, 0, 0), flip=False):
        """profile [(r, y)] closed loop, revolved about the Y axis"""
        n = len(profile)
        vs = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            for r, y in profile:
                vs.append(Vector(center) + Vector((r * math.cos(a), y, r * math.sin(a))))
        faces = []
        for j in range(seg):
            for i in range(n):
                a = j * n + i; b = j * n + (i + 1) % n
                c = ((j + 1) % seg) * n + (i + 1) % n; d = ((j + 1) % seg) * n + i
                faces.append([a, b, c, d] if not flip else [a, d, c, b])
        s.add(vs, faces, mat, True)

    def tube(s, pts, r, mat, seg=10):
        for a, b in zip(pts[:-1], pts[1:]):
            s.cyl(a, b, r, mat, seg)
            s.sphere(b, (r, r, r), mat, seg=seg, rings=6)


def to_object(name, mb, coll, solid=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(mb.v, [], mb.f)
    for n in mb.mats:
        me.materials.append(MAT[n])
    me.update()
    for p, mi, sm in zip(me.polygons, mb.m, mb.sm):
        p.material_index = mi
        p.use_smooth = sm
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if solid:
        md = ob.modifiers.new("Solidify", 'SOLIDIFY')
        md.thickness = solid
        md.offset = -1
        md.use_even_offset = True
        bpy.context.view_layer.objects.active = ob
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier="Solidify")
    return ob


def join(objs, name, coll):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def shell_mb(quads, mat_fn, caps=()):
    """turn selected grid quads into an MB. caps = [(station_index, [ring indices])] closes flat ends."""
    mb = MB()
    vmap = {}
    def vid(ii, kk):
        key = (ii, kk % LOOP)
        if key not in vmap:
            vmap[key] = len(mb.v); mb.v.append(tuple(GRID[ii][kk % LOOP]))
        return vmap[key]
    for (i, k) in quads:
        a, b, c, d = vid(i, k), vid(i + 1, k), vid(i + 1, k + 1), vid(i, k + 1)
        mb.f.append([a, d, c, b]); mb.m.append(mb.mi(mat_fn(i, k))); mb.sm.append(True)
    for (i, ks) in caps:
        ids = [vid(i, k) for k in ks]
        pts = [Vector(mb.v[j]) for j in ids]
        n = Vector((0, 0, 0))
        for p, q in zip(pts, pts[1:] + pts[:1]):
            n.x += (p.y - q.y) * (p.z + q.z); n.y += (p.z - q.z) * (p.x + q.x); n.z += (p.x - q.x) * (p.y + q.y)
        want = 1 if i == NS - 1 else -1
        if n.x * want < 0:
            ids.reverse()
        mb.f.append(ids); mb.m.append(mb.mi("Carbon")); mb.sm.append(False)
    return mb


def cap_body():
    r = list(range(JC2, LOOP - JC2 + 1))
    return [(NS - 1, r), (0, r)]


def cap_bumper(front):
    r = list(range(LOOP - JC2, LOOP)) + list(range(0, JC2 + 1))
    return [(NS - 1 if front else 0, r)]


def cap_box(front):
    """centre / half-extents of the flat bumper end face (for grille & exhaust placement)"""
    ring = GRID[NS - 1 if front else 0]
    pts = [ring[k] for k in list(range(LOOP - JC2, LOOP)) + list(range(0, JC2 + 1))]
    zs = [p.z for p in pts]; ys = [abs(p.y) for p in pts]
    return pts[0].x, min(zs), max(zs), max(ys)


def is_arch_wall(i):  # helper kept for clarity
    return False


# ---- quad selection ----------------------------------------------------------
def body_quads():
    q = []
    for i in range(NS - 1):
        jc = zone_jc(xmid(i))
        for k in range(jc, LOOP - jc):
            q.append((i, k))
    return q


def bumper_quads(front=True):
    q = []
    for i in range(NS - 1):
        xm = xmid(i)
        if (front and xm >= ZONE_X) or (not front and xm <= -ZONE_X):
            for k in list(range(0, JC2)) + list(range(LOOP - JC2, LOOP)):
                q.append((i, k))
    return q


def skirt_quads(xlim=0.86):
    q = []
    for i in range(NS - 1):
        if abs(xmid(i)) <= xlim:
            for k in range(SKIRT_A, JC1):
                q.append((i, k))
            for k in range(LOOP - JC1, LOOP - SKIRT_A):
                q.append((i, k))
    return q


def body_mat(i, k):
    g, wr = STATION_INFO[i]
    xm = xmid(i)
    r = min(k % LOOP, LOOP - 1 - (k % LOOP))
    seg = r // PER
    m = quad_mid(i, k)
    if g > 0.30:
        if seg == 6 and -0.90 <= xm <= 0.22:                 # side glass
            return "Glass"
        if seg in (7, 8) and (xm > 0.14 or xm < -0.55) and abs(m.y) < 0.80 * wr:   # windshield / rear glass
            return "Glass"
    if seg == 8 and xm > -0.5 and xm < 0.14:
        return "CarbonMatte"
    return "Carbon"


# =============================================================================
# 5. scene assembly
# =============================================================================
def new_coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def add_splines(coll):
    """Editable construction splines that the loft was sampled from."""
    def profile_curve(name, prof, plane):
        cu = bpy.data.curves.new(name, 'CURVE')
        cu.dimensions = '3D'
        sp = cu.splines.new('BEZIER')
        pts = prof.bezier_points()
        sp.bezier_points.add(len(pts) - 1)
        for bp, (co, hl, hr) in zip(sp.bezier_points, pts):
            f = (lambda p: (p[0], 0, p[1])) if plane == 'xz' else (lambda p: (p[0], p[1], 0))
            bp.co, bp.handle_left, bp.handle_right = f(co), f(hl), f(hr)
            bp.handle_left_type = bp.handle_right_type = 'FREE'
        ob = bpy.data.objects.new(name, cu)
        coll.objects.link(ob)
        return ob

    profile_curve("Spline_Roofline", ROOF, 'xz')
    profile_curve("Spline_Beltline", BELT, 'xz')
    profile_curve("Spline_Floorline", FLOOR, 'xz')
    profile_curve("Spline_TopView_HalfWidth", WIDTH, 'xy')
    for x in (-1.9, -1.285, -0.6, 0.0, 0.5, 1.0, 1.285, 1.9):
        P, g, wr = half_section(x)
        cu = bpy.data.curves.new(f"Spline_Section_{x:+.2f}", 'CURVE')
        cu.dimensions = '3D'
        sp = cu.splines.new('BEZIER')
        hs = cr_handles(P)
        sp.bezier_points.add(len(hs) - 1)
        for bp, (co, hl, hr) in zip(sp.bezier_points, hs):
            bp.co, bp.handle_left, bp.handle_right = (x, co[0], co[1]), (x, hl[0], hl[1]), (x, hr[0], hr[1])
            bp.handle_left_type = bp.handle_right_type = 'FREE'
        ob = bpy.data.objects.new(cu.name, cu)
        coll.objects.link(ob)


def mirror_y(mb):
    """duplicate everything in mb mirrored about y=0 (used for symmetric add-ons)."""
    n = len(mb.v)
    mb.v += [(x, -y, z) for (x, y, z) in mb.v]
    nf = len(mb.f)
    for f in range(nf):
        mb.f.append([i + n for i in reversed(mb.f[f])])
        mb.m.append(mb.m[f]); mb.sm.append(mb.sm[f])


def surf_z(x, y):
    """approximate body top height at (x, y) - used to seat add-ons on the hood."""
    w, B, T, ZB = station_params(x)
    return T - 0.045 * (abs(y) / (w * 0.85)) ** 2


# ---------------- front / rear bumpers -----------------------------------------
def _flat(quads_fn):
    return lambda i, k: "Carbon"


def front_bumper(kind):
    quads = bumper_quads(True)
    shell = to_object(f"FB_{kind}_shell", shell_mb(quads, _flat(None), cap_bumper(True)),
                      bpy.context.scene.collection, solid=0.012)
    xf, z0, z1, yh = cap_box(True)
    zc, hh = 0.5 * (z0 + z1), z1 - z0
    det = MB()
    if kind == "Stock":
        det.box((xf + 0.004, 0, z0 + 0.42 * hh), (0.02, yh * 1.10, hh * 0.34), "DarkMesh")       # lower intake
        det.box((xf + 0.004, 0, z0 + 0.82 * hh), (0.02, yh * 0.55, hh * 0.10), "DarkMesh")       # slim upper slot
        for sy in (-1, 1):
            det.box((xf - 0.02, sy * yh * 0.86, z0 + 0.38 * hh), (0.05, yh * 0.22, hh * 0.22), "DarkMesh")   # fog vents
        det.box((xf - 0.05, 0, z0 - 0.005), (0.16, yh * 1.5, 0.014), "Carbon")                   # small lip
        det.cyl((xf + 0.004, -yh * 0.62, zc + 0.06), (xf + 0.03, -yh * 0.62, zc + 0.06), 0.022, "Red", 16)
    elif kind == "Race":
        det.box((xf + 0.004, 0, z0 + 0.40 * hh), (0.02, yh * 1.35, hh * 0.52), "DarkMesh")       # huge intake
        det.box((xf - 0.03, 0, z0 + 0.42 * hh), (0.03, yh * 1.25, hh * 0.42), "Steel")           # intercooler core
        det.box((xf - 0.02, 0, z0 + 0.42 * hh), (0.03, yh * 1.20, hh * 0.36), "DarkMesh")
        plan = [(1.84, -0.96), (2.26, -0.90), (2.42, -0.52), (2.42, 0.52), (2.26, 0.90), (1.84, 0.96)]
        det.prism_xy(plan, 0.168, 0.186, "Carbon")                                            # splitter
        for sy in (-1, 1):
            for yy in (0.34, 0.66):
                det.cyl((2.10, sy * yy, 0.186), (2.10, sy * yy, 0.27), 0.009, "Steel", 8)
            for j, (yy, zz) in enumerate(((0.88, 0.27), (0.94, 0.33))):                       # dive planes
                det.box((2.02, sy * yy, zz), (0.22, 0.13, 0.006), "Carbon", rot=(sy * 0.50, 0, 0))
        det.cyl((xf + 0.004, -yh * 0.66, zc - 0.02), (xf + 0.06, -yh * 0.66, zc - 0.02), 0.014, "Red", 12)
        det.cyl((xf + 0.06, -yh * 0.66, zc - 0.02), (xf + 0.075, -yh * 0.66, zc - 0.02), 0.045, "Red", 20)
    elif kind == "Street":
        det.box((xf + 0.004, 0, z0 + 0.40 * hh), (0.02, yh * 0.95, hh * 0.32), "DarkMesh")
        for sy in (-1, 1):
            det.sphere((xf - 0.03, sy * yh * 0.78, z0 + 0.42 * hh), (0.05, 0.075, 0.06), "LensDark")      # fog lamps
        det.box((xf - 0.10, 0, z0 - 0.002), (0.28, yh * 1.75, 0.014), "Carbon")
        det.box((xf + 0.03, 0, z0 + 0.008), (0.03, yh * 1.75, 0.024), "Carbon")
    parts = [shell, to_object(f"FB_{kind}_det", det, bpy.context.scene.collection)]
    return join(parts, f"FrontBumper_{kind}", bpy.context.scene.collection)


def rear_bumper(kind):
    quads = bumper_quads(False)
    shell = to_object(f"RB_{kind}_shell", shell_mb(quads, _flat(None), cap_bumper(False)),
                      bpy.context.scene.collection, solid=0.012)
    xr, z0, z1, yh = cap_box(False)
    hh = z1 - z0
    det = MB()
    if kind == "Stock":
        det.box((xr - 0.004, 0, z0 + 0.30 * hh), (0.02, yh * 1.10, hh * 0.30), "DarkMesh")
        for sy in (-1, 1):
            det.cyl((xr + 0.06, sy * yh * 0.50, z0 + 0.30 * hh), (xr - 0.12, sy * yh * 0.50, z0 + 0.30 * hh), 0.045, "Steel", 20)
            det.cyl((xr - 0.115, sy * yh * 0.50, z0 + 0.30 * hh), (xr - 0.13, sy * yh * 0.50, z0 + 0.30 * hh), 0.032, "DarkMesh", 20)
    else:
        det.box((xr - 0.004, 0, z0 + 0.40 * hh), (0.02, yh * 1.35, hh * 0.55), "DarkMesh")
        plan = [(-1.72, -0.84), (-2.30, -0.90), (-2.30, 0.90), (-1.72, 0.84)]
        det.prism_xy(plan, 0.19, 0.205, "Carbon")                                              # diffuser floor
        for fy in (-0.66, -0.44, -0.22, 0.0, 0.22, 0.44, 0.66):
            det.extrude_y([(-1.74, 0.19), (-2.28, 0.19), (-2.28, 0.34), (-2.12, 0.31)], fy, fy + 0.012, "Carbon")
        for sy in (-1, 1):
            det.extrude_y([(-1.78, 0.19), (-2.32, 0.19), (-2.32, 0.42), (-2.08, 0.33)], sy * 0.90, sy * 0.90 + 0.012 * sy, "Carbon")
        det.box((xr - 0.05, 0, z0 - 0.01), (0.12, yh * 1.7, 0.012), "Carbon", rot=(0, 0.25, 0))    # lip
        det.cyl((xr + 0.06, 0.0, z0 + 0.32 * hh), (xr - 0.16, 0.0, z0 + 0.32 * hh), 0.06, "Steel", 24)
        det.cyl((xr - 0.155, 0.0, z0 + 0.32 * hh), (xr - 0.17, 0.0, z0 + 0.32 * hh), 0.045, "DarkMesh", 24)
    parts = [shell, to_object(f"RB_{kind}_det", det, bpy.context.scene.collection)]
    return join(parts, f"RearBumper_{kind}", bpy.context.scene.collection)


def side_skirts(kind):
    quads = skirt_quads()
    shell = to_object(f"SS_{kind}_shell", shell_mb(quads, lambda i, k: "Carbon"), bpy.context.scene.collection, solid=0.012)
    det = MB()
    for sy in (-1, 1):
        y_out = 1.0
        if kind == "Flat":
            plan = [(-0.90, sy * 0.70), (-0.90, sy * 1.03), (-0.55, sy * 1.06), (0.55, sy * 1.06), (0.90, sy * 1.03), (0.90, sy * 0.70)]
            det.prism_xy(plan if sy > 0 else list(reversed(plan)), 0.170, 0.186, "Carbon")
            for xe in (-0.90, 0.90):     # vertical end fins
                det.extrude_y([(xe - 0.06, 0.17), (xe + 0.06, 0.17), (xe + 0.02, 0.34), (xe - 0.02, 0.34)],
                              sy * 1.03 - (0.006 if sy > 0 else -0.006), sy * 1.03 + (0.006 if sy > 0 else -0.006), "Carbon")
        elif kind == "Wing":
            plan = [(-0.90, sy * 0.70), (-0.90, sy * 1.10), (-0.6, sy * 1.14), (0.6, sy * 1.14), (0.9, sy * 1.10), (0.9, sy * 0.70)]
            det.prism_xy(plan if sy > 0 else list(reversed(plan)), 0.165, 0.180, "Carbon")
            for xs_ in (-0.6, -0.3, 0.0, 0.3, 0.6):    # ground-effect strakes
                det.extrude_y([(xs_ - 0.09, 0.18), (xs_ + 0.09, 0.18), (xs_ + 0.05, 0.27), (xs_ - 0.05, 0.27)],
                              sy * 1.12 - (0.005 if sy > 0 else -0.005), sy * 1.12 + (0.005 if sy > 0 else -0.005), "Carbon")
    parts = [shell]
    if det.v:
        parts.append(to_object(f"SS_{kind}_det", det, bpy.context.scene.collection))
    return join(parts, f"SideSkirts_{kind}", bpy.context.scene.collection)


# ---------------- wheels ------------------------------------------------------
def wheel_mb():
    mb = MB()
    tire = [(0.232, -0.108), (0.262, -0.134), (0.312, -0.136), (0.332, -0.104), (0.337, -0.05), (0.337, 0.05),
            (0.332, 0.104), (0.312, 0.136), (0.262, 0.134), (0.232, 0.108)]
    mb.lathe(tire, "Tire")
    rim = [(0.055, 0.115), (0.11, 0.100), (0.215, 0.045), (0.226, -0.125), (0.205, -0.128), (0.20, 0.025),
           (0.10, 0.075), (0.055, 0.085)]
    mb.lathe(rim, "RimBlack")
    lip = [(0.222, 0.098), (0.236, 0.104), (0.244, 0.134), (0.226, 0.138)]
    mb.lathe(lip, "Chrome", seg=64)
    mb.cyl((0, 0.085, 0), (0, 0.122, 0), 0.05, "Chrome", 24)
    for n in range(5):                                                 # five spokes
        a = 2 * math.pi * n / 5
        c = (0.14 * math.cos(a), 0.088, 0.14 * math.sin(a))
        mb.box(c, (0.17, 0.02, 0.04), "RimBlack", rot=(0, -a, 0))
    mb.cyl((0, -0.02, 0), (0, 0.03, 0), 0.15, "Steel", 40)             # brake disc
    mb.box((0.06, 0.02, 0.10), (0.05, 0.06, 0.11), "Red", rot=(0, -0.9, 0))
    return mb


def build_wheels(coll):
    objs = []
    for name, x, y_off, flip in (("FL", WHEELBASE_HALF, 0.850, False), ("FR", WHEELBASE_HALF, -0.850, True),
                                 ("RL", -WHEELBASE_HALF, 0.860, False), ("RR", -WHEELBASE_HALF, -0.860, True)):
        ob = to_object(f"Wheel_{name}", wheel_mb(), coll)
        ob.location = (x, y_off, TIRE_R)
        ob.rotation_euler = (0, 0, 0 if not flip else math.pi)
        if flip:
            ob.rotation_euler = (0, 0, math.pi)
            ob.location = (x, y_off, TIRE_R)
        objs.append(ob)
    # wheel arch liners (dark half tubes)
    liner = MB()
    R = 0.398
    for cx in (WHEELBASE_HALF, -WHEELBASE_HALF):
        for sy in (-1, 1):
            n = 20
            vs, fs = [], []
            for j in range(n + 1):
                a = math.pi * j / n
                px, pz = cx + R * math.cos(a), 0.335 + R * math.sin(a)
                vs.append((px, sy * 0.60, pz)); vs.append((px, sy * 0.98, pz))
            for j in range(n):
                a, b, c, d = 2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2
                fs.append([a, b, c, d] if sy > 0 else [a, d, c, b])
            liner.add(vs, fs, "DarkMesh", True)
            # inner wall (half disc)
            base = [(cx, sy * 0.60, 0.335)] + [(cx + R * math.cos(math.pi * j / n), sy * 0.60, 0.335 + R * math.sin(math.pi * j / n)) for j in range(n + 1)]
            fs2 = [[0, j + 1, j + 2] if sy < 0 else [0, j + 2, j + 1] for j in range(n)]
            liner.add(base, fs2, "DarkMesh", False)
    objs.append(to_object("ArchLiners", liner, coll))
    return objs


# ---------------- details -----------------------------------------------------
def build_body_details(coll):
    d = MB()
    # hood vents
    for sy in (-1, 1):
        y = sy * 0.30
        z = surf_z(1.15, y)
        d.box((1.15, y, z + 0.008), (0.36, 0.20, 0.03), "Carbon")
        for j in range(5):
            d.box((1.02 + 0.065 * j, y, z + 0.026), (0.028, 0.15, 0.006), "DarkMesh", rot=(0, -0.3, 0))
    # headlights / tail lights
    for sy in (-1, 1):
        d.sphere((1.86, sy * 0.66, 0.665), (0.20, 0.15, 0.035), "LensDark", rot=(0, 0.28, sy * 0.30))
        d.sphere((1.90, sy * 0.66, 0.672), (0.09, 0.07, 0.038), "Chrome", rot=(0, 0.28, sy * 0.30))
        d.sphere((-2.00, sy * 0.68, 0.85), (0.045, 0.22, 0.05), "TailLight", rot=(0, 0, sy * -0.25))
        # mirrors
        d.sphere((0.42, sy * 0.99, 0.96), (0.06, 0.09, 0.045), "Carbon", rot=(0, 0, sy * 0.15))
        d.cyl((0.44, sy * 0.86, 0.90), (0.42, sy * 0.95, 0.955), 0.012, "Carbon", 8)
    # rear wing with swan-neck struts and endplates
    foil = [(0.15, -0.004), (0.11, 0.03), (0.0, 0.042), (-0.11, 0.022), (-0.15, -0.002), (-0.11, -0.012), (0.0, -0.004), (0.11, -0.006)]
    d.extrude_y(foil, -0.92, 0.92, "CarbonMatte", origin=(-2.02, 0, 1.31), rot=(0, -0.10, 0))
    flap = [(0.05, 0.0), (-0.06, 0.0), (-0.09, 0.03), (0.0, 0.05)]
    for sy in (-1, 1):
        d.extrude_y([(-0.17, -0.10), (0.17, -0.10), (0.17, 0.11), (-0.13, 0.08)], sy * 0.92, sy * 0.92 + 0.012 * sy, "Carbon",
                    origin=(-2.02, 0, 1.31))
        d.tube([(-1.80, sy * 0.36, 0.97), (-1.88, sy * 0.36, 1.12), (-1.98, sy * 0.36, 1.24), (-2.02, sy * 0.36, 1.285)], 0.011, "Carbon")
    d.box((-2.02, 0, 1.30), (0.02, 0.02, 0.02), "Carbon")
    # exposed roll cage tubes (bevelled splines converted to mesh)
    cage = MB()
    def tube(pts): cage.tube(pts, 0.014, "Steel")
    tube([(-0.35, -0.60, 0.30), (-0.35, -0.60, 1.10), (-0.35, 0.60, 1.10), (-0.35, 0.60, 0.30)])
    tube([(0.25, -0.62, 0.40), (0.30, -0.62, 1.05), (-0.35, -0.60, 1.10)])
    tube([(0.25, 0.62, 0.40), (0.30, 0.62, 1.05), (-0.35, 0.60, 1.10)])
    tube([(0.28, -0.62, 1.05), (0.28, 0.62, 1.05)])
    tube([(-0.35, -0.60, 0.65), (0.10, -0.66, 0.60), (0.25, -0.62, 0.40)])
    tube([(-0.35, 0.60, 0.65), (0.10, 0.66, 0.60), (0.25, 0.62, 0.40)])
    tube([(-0.35, -0.6, 1.10), (-0.9, -0.5, 0.60)])
    tube([(-0.35, 0.6, 1.10), (-0.9, 0.5, 0.60)])
    # cabin: floor, dash, seats, wheel
    for sy in (-1, 1):
        cage.box((-0.10, sy * 0.30, 0.42), (0.48, 0.42, 0.10), "Interior")
        cage.box((-0.32, sy * 0.30, 0.68), (0.10, 0.42, 0.55), "Interior", rot=(0, -0.15, 0))
    cage.box((0.42, 0, 0.62), (0.32, 1.50, 0.22), "Interior")
    cage.box((0.0, 0, 0.26), (1.8, 1.30, 0.02), "Interior")
    cage.lathe([(0.11, -0.012), (0.13, -0.012), (0.13, 0.012), (0.11, 0.012)], "Interior", seg=24, center=(0.36, -0.30, 0.80))
    parts = [to_object("Details", d, coll), to_object("Interior", cage, coll)]
    # under-tray
    ut = MB()
    ut.box((0.0, 0, 0.196), (3.40, 1.30, 0.02), "CarbonMatte")
    parts.append(to_object("Undertray", ut, coll))
    return parts


def build_body(coll):
    mb = shell_mb(body_quads(), body_mat, cap_body())
    ob = to_object("Body", mb, coll, solid=0.012)
    # wheel arches: boolean-cut with cylinders (clean edge, follows the flared fender)
    cut = MB()
    for cx in (WHEELBASE_HALF, -WHEELBASE_HALF):
        for sy in (-1, 1):
            cut.cyl((cx, sy * 0.45, 0.335), (cx, sy * 1.35, 0.335), 0.41, "Carbon", 64)
    co = to_object("ArchCutter", cut, coll)
    md = ob.modifiers.new("Arches", 'BOOLEAN')
    md.operation = 'DIFFERENCE'; md.object = co; md.solver = 'EXACT'
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="Arches")
    bpy.data.objects.remove(co)
    return ob


# ---------------- scene / render ---------------------------------------------
def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(os.environ.get('SAMPLES', 40))
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = int(os.environ.get('RESX', 1400)), int(os.environ.get('RESY', 800))
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.78, 0.78, 0.80, 1)
    bg.inputs[1].default_value = 0.45
    sc.world = w
    # studio floor
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    fl = bpy.context.active_object
    fl.name = "StudioFloor"
    m = bpy.data.materials.new("Floor"); m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.45, 0.47, 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
    fl.data.materials.append(m)
    for name, loc, energy, size in (("Key", (3.5, -5, 5.5), 900, 4), ("Fill", (-5, -2, 3), 350, 6), ("Rim", (0, 6, 4), 500, 4)):
        ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size
        lo = bpy.data.objects.new(name, ld); lo.location = loc
        bpy.context.scene.collection.objects.link(lo)
        d = Vector((0, 0, 0.5)) - Vector(loc)
        lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 45
    cam = bpy.data.objects.new("Camera", cam_d)
    bpy.context.scene.collection.objects.link(cam)
    sc.camera = cam
    return cam


def aim(cam, loc, target=(0, 0, 0.55), lens=45):
    cam.location = loc
    cam.data.lens = lens
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render(path, cam, loc, target=(0, 0, 0.6), lens=45, res=None):
    aim(cam, loc, target, lens)
    if res:
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = res
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    root = bpy.data.objects.new("Car_Root", None)
    bpy.context.scene.collection.objects.link(root)
    root.rotation_euler = (0, 0, -math.pi / 2)        # car faces -Y

    c_spl = new_coll("Construction_Splines")
    c_body = new_coll("Body")
    c_wheels = new_coll("Wheels")
    c_fb = new_coll("FrontBumpers"); c_rb = new_coll("RearBumpers"); c_ss = new_coll("SideSkirts")

    add_splines(c_spl)
    body = build_body(c_body)
    det = build_body_details(c_body)
    wheels = build_wheels(c_wheels)

    variants = {"FrontBumper": {}, "RearBumper": {}, "SideSkirts": {}}
    for k in ("Stock", "Race", "Street"):
        o = front_bumper(k); variants["FrontBumper"][k] = o
    for k in ("Stock", "Race"):
        o = rear_bumper(k); variants["RearBumper"][k] = o
    for k in ("Stock", "Flat", "Wing"):
        o = side_skirts(k); variants["SideSkirts"][k] = o
    for cat, coll in (("FrontBumper", c_fb), ("RearBumper", c_rb), ("SideSkirts", c_ss)):
        for k, o in variants[cat].items():
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)

    for o in [body, *det, *wheels] + [o for d in variants.values() for o in d.values()]:
        o.parent = root
    for o in c_spl.objects:
        o.parent = root
    c_spl.hide_viewport = True
    c_spl.hide_render = True

    cam = setup_scene()

    def show(fb, rb, ss):
        for cat, pick in (("FrontBumper", fb), ("RearBumper", rb), ("SideSkirts", ss)):
            for k, o in variants[cat].items():
                o.hide_viewport = o.hide_render = (k != pick)

    show("Race", "Race", "Flat")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "spline_car.blend"))

    if "--noexport" in args:
        return
    # ---- GLB export: full assembly + each swappable part on its own ------------
    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")

    def export(path, objs):
        for o in objs:
            o.hide_viewport = False
            o.hide_render = False
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        root.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                                  export_apply=True, export_yup=True)

    base = [body, *det, *wheels]
    export(os.path.join(OUT, "car_default.glb"), base + [variants["FrontBumper"]["Race"], variants["RearBumper"]["Race"], variants["SideSkirts"]["Flat"]])
    export(os.path.join(OUT, "car_base.glb"), base)
    for cat, d in variants.items():
        for k, o in d.items():
            export(os.path.join(OUT, f"{cat}_{k}.glb"), [o])

    if "--variants" in args:
        for fb in ("Stock", "Race", "Street"):
            show(fb, "Stock", "Stock")
            render(os.path.join(OUT, f"var_front_{fb}.png"), cam, (3.0, -4.6, 0.9), (0.0, -1.7, 0.4), 50, res=(700, 420))
        for rb in ("Stock", "Race"):
            show("Stock", rb, "Stock")
            render(os.path.join(OUT, f"var_rear_{rb}.png"), cam, (-3.0, 4.6, 0.9), (0.0, 1.7, 0.4), 50, res=(700, 420))
        for ss in ("Stock", "Flat", "Wing"):
            show("Stock", "Stock", ss)
            render(os.path.join(OUT, f"var_skirt_{ss}.png"), cam, (3.8, -1.6, 0.45), (0.0, 0.0, 0.3), 45, res=(700, 420))
    if "--render" in args:
        show("Race", "Race", "Flat")
        render(os.path.join(OUT, "preview_front34.png"), cam, (4.6, -5.3, 1.35), (0, -0.2, 0.62), 45)
        render(os.path.join(OUT, "preview_rear34.png"), cam, (-4.2, 5.2, 1.5), (0, 0.2, 0.62), 45)
        render(os.path.join(OUT, "preview_side.png"), cam, (7.5, 0.0, 0.7), (0, 0.0, 0.62), 60)
        show("Stock", "Stock", "Stock")
        render(os.path.join(OUT, "preview_stock34.png"), cam, (4.6, -5.3, 1.35), (0, -0.2, 0.62), 45)


if __name__ == "__main__":
    main()
