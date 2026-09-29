"""Rig mech-build-01.fbx as a two-legged humanoid and export for PlayCanvas.

Run with Blender's Python (bpy 4.2):  python rig_mech.py <src.fbx> <out_dir>

The mech is built from separate hard-surface parts, so each part is bound
100% to a single bone (no deformation), then all parts are joined into one
skinned mesh to keep draw calls down (one per material).
"""
import sys, os, math
import bpy, mathutils
from mathutils import Vector, Matrix

SRC = sys.argv[1] if len(sys.argv) > 1 else "mech-build-01.fbx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
scene = bpy.context.scene
scene.render.fps = 30

meshes = [o for o in scene.objects if o.type == 'MESH']

# --- 1. Bake object transforms (several parts are mirrored with negative scale)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
mirrored = [o for o in meshes if o.matrix_world.determinant() < 0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# Baking a mirror leaves the face winding inside-out (engines backface-cull it).
# Flip the winding, and make the custom (smooth) normals agree with it again.
for o in mirrored:
    me = o.data
    me.flip_normals()
    cn = [Vector(c.vector) for c in me.corner_normals]
    agree = sum(cn[li].dot(p.normal) for p in me.polygons for li in p.loop_indices)
    if agree < 0:
        me.normals_split_custom_set([tuple(-v) for v in cn])
print("MIRRORED fixed", len(mirrored))

# --- 2. Drop exact duplicate parts stacked on top of each other
def coords(o):
    return [v.co.copy() for v in o.data.vertices]

def same_geo(a, b, tol=1e-4):
    if len(a.data.vertices) != len(b.data.vertices) or len(a.data.polygons) != len(b.data.polygons):
        return False
    if [m.name for m in a.data.materials] != [m.name for m in b.data.materials]:
        return False
    return all((p - q).length < tol for p, q in zip(coords(a), coords(b)))

kept, removed, alias = [], [], {}
for o in sorted(meshes, key=lambda o: o.name):
    dup = next((k for k in kept if same_geo(k, o)), None)
    if dup:
        removed.append((o.name, dup.name)); alias[o.name] = dup.name
        bpy.data.objects.remove(o)
    else:
        kept.append(o)
meshes = [o for o in scene.objects if o.type == 'MESH']
for r, keep in removed:
    print(f"DUPLICATE removed {r} (same as {keep})")

def centroid(name):
    o = bpy.data.objects[alias.get(name, name)]
    return sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)

# --- 3. Part -> bone assignment (names from the 3ds Max export)
PARTS = {
    'Hips':        ['tripo_node_8b432b89'],
    'Spine':       ['tripo_node_5486a718', 'Object001'],
    'Head':        ['Object005', 'Object002'],
    'SkirtFront_R': ['Object015'], 'SkirtFront_L': ['Object007'],
    'SkirtSide_R':  ['Object014'], 'SkirtSide_L':  ['Object013'],
    'SkirtBack':    ['Object009'],
    'UpperArm_R': ['Object017', 'Object003'],
    'ForeArm_R':  ['tripo_node_6aea384b.001', 'tripo_node_6aea384b002', 'tripo_node_6aea384b'],
    'Hand_R':     ['tripo_node_9dcdae07'],
    'UpperArm_L': ['Object023', 'Object020'],
    'ForeArm_L':  ['tripo_node_6aea384b007', 'tripo_node_6aea384b010', 'tripo_node_6aea384b006'],
    'Hand_L':     ['tripo_node_9dcdae010'],
    'UpperLeg_R': ['Object025'],
    'LowerLeg_R': ['tripo_node_3c441de2', 'Object024'],
    'Foot_R':     ['tripo_node_a834b1bb'],
    'UpperLeg_L': ['Object027'],
    'LowerLeg_L': ['tripo_node_3c441de004', 'Object026'],
    'Foot_L':     ['tripo_node_a834b1bb001'],
}
part_bone = {}
for bone, names in PARTS.items():
    for n in names:
        part_bone[alias.get(n, n)] = bone
unassigned = [o.name for o in meshes if o.name not in part_bone]
assert not unassigned, f"unassigned parts: {unassigned}"

# --- 4. Joint positions (Z up, mech faces -Y), measured from the parts
cx = centroid('tripo_node_5486a718').x
Y = 0.45
armx = {'R': centroid('tripo_node_9dcdae07').x + 0.01, 'L': centroid('tripo_node_9dcdae010').x - 0.01}
legx = {'R': (centroid('Object025').x + centroid('Object024').x) / 2,
        'L': (centroid('Object027').x + centroid('Object026').x) / 2}
skf = {'R': centroid('Object015'), 'L': centroid('Object007')}
sks = {'R': centroid('Object014'), 'L': centroid('Object013')}
skb = centroid('Object009')

SOCKET_OFF = {'L': (-0.248, 0.003, -0.035), 'R': (0.155, 0.015, -0.03)}
B = {  # name: (head, tail, parent)
    'Root':  ((cx, Y, 0.0), (cx, Y, 0.3), None),
    'Hips':  ((cx, Y, 1.40), (cx, Y, 1.60), 'Root'),
    'Spine': ((cx, Y, 1.60), (cx, Y, 2.25), 'Hips'),
    'Head':  ((cx, Y, 2.25), (cx, Y, 2.70), 'Spine'),
    'SkirtBack': ((skb.x, 0.68, 1.56), (skb.x, 0.80, 1.05), 'Hips'),
}
for s in 'LR':
    ax, lx = armx[s], legx[s]
    sgn = 1 if s == 'L' else -1          # mech faces -Y: its left is +X
    # upper-arm pivot at the centre of the shoulder socket (found by testing which
    # pivot keeps the shoulder armour seated on the torso through wide rotations)
    po = SOCKET_OFF[s]
    sock = (ax + po[0], 0.49 + po[1], 2.10 + po[2])
    B[f'Shoulder_{s}'] = ((cx + sgn * 0.15, 0.47, 2.10), sock, 'Spine')
    B[f'UpperArm_{s}'] = (sock, (sock[0], sock[1] - 0.005, sock[2] - 0.22), f'Shoulder_{s}')
    B[f'ForeArm_{s}']  = ((ax, 0.485, 1.88), (ax, 0.40, 1.44), f'UpperArm_{s}')
    B[f'Hand_{s}']     = ((ax, 0.40, 1.44), (ax, 0.34, 1.12), f'ForeArm_{s}')
    B[f'UpperLeg_{s}'] = ((lx, Y, 1.35), (lx, Y, 0.95), 'Hips')
    B[f'LowerLeg_{s}'] = ((lx, Y, 0.95), (lx, 0.43, 0.30), f'UpperLeg_{s}')
    B[f'Foot_{s}']     = ((lx, 0.43, 0.30), (lx, 0.0, 0.08), f'LowerLeg_{s}')
    B[f'SkirtFront_{s}'] = ((skf[s].x, 0.30, 1.55), (skf[s].x, 0.24, 1.25), 'Hips')
    B[f'SkirtSide_{s}']  = ((sks[s].x, 0.49, 1.60), (sks[s].x + sgn * 0.06, 0.49, 1.15), 'Hips')


# --- 4b. Fingers: each hand is a palm plus separate finger segments; chain them
from mathutils.kdtree import KDTree

def loose_parts(me):
    adj = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices; adj[a].append(b); adj[b].append(a)
    seen, parts = set(), []
    for i in range(len(me.vertices)):
        if i in seen: continue
        stack, comp = [i], []
        seen.add(i)
        while stack:
            x = stack.pop(); comp.append(x)
            for y in adj[x]:
                if y not in seen: seen.add(y); stack.append(y)
        parts.append(comp)
    return parts

def mean(vs): return sum(vs, Vector()) / len(vs)

def finger_rig(obj, side):
    import numpy as np
    me = obj.data
    P_ = [{'v': c, 'co': [me.vertices[i].co.copy() for i in c]} for c in loose_parts(me)]
    for q in P_:
        q['c'] = mean(q['co'])
        q['mn'] = Vector([min(c[i] for c in q['co']) for i in range(3)])
        q['mx'] = Vector([max(c[i] for c in q['co']) for i in range(3)])
    P_.sort(key=lambda q: -len(q['co']))
    palm, rest = P_[0], P_[1:]
    # small caps sitting inside a bigger segment ride with that segment
    segs = []
    for q in rest:
        host = next((h for h in segs if all(h['mn'][i] - 0.005 <= q['c'][i] <= h['mx'][i] + 0.005 for i in range(3))), None)
        if host: host['v'] += q['v']
        else: segs.append(q)
    pd = abs(palm['c'].x - cx)
    thumb = [q for q in segs if abs(q['c'].x - cx) < pd - 0.04 and q['mn'].z > palm['mn'].z - 0.05]
    fing = [q for q in segs if q not in thumb]
    def top(q): return mean([c for c in q['co'] if c.z > q['mx'].z - 0.02])
    def bot(q): return mean([c for c in q['co'] if c.z < q['mn'].z + 0.02])
    prox = sorted(fing, key=lambda q: -q['mx'].z)[:4]
    free = [q for q in fing if q not in prox]
    chains = [[q] for q in sorted(prox, key=lambda q: q['c'].y)]   # front (index) to back (pinky)
    grew = True
    while grew and free:
        grew = False
        for ch in chains:
            if not free: break
            b_ = bot(ch[-1]); best = min(free, key=lambda q: (top(q) - b_).length)
            if (top(best) - b_).length < 0.06:
                ch.append(best); free.remove(best); grew = True
    tch = []
    cur = palm['c']
    tfree = list(thumb)
    while tfree:
        nxt = min(tfree, key=lambda q: (q['c'] - cur).length); tch.append(nxt); tfree.remove(nxt); cur = nxt['c']
    for q in free:   # anything unchained joins the nearest segment
        near = min([s for ch in chains for s in ch], key=lambda s: (s['c'] - q['c']).length); near['v'] += q['v']
    # palm facing: thinnest axis of the palm plate, signed toward the side
    # the fingers already lean to (the open side of the hand)
    import numpy as np
    pc = np.array([c[:] for c in palm['co']]); pc -= pc.mean(0)
    palm_n = Vector(np.linalg.svd(pc, full_matrices=False)[2][2])
    lean = sum((bot(ch[-1]) - top(ch[0]) for ch in chains), Vector())
    if palm_n.dot(lean) < 0: palm_n = -palm_n
    out = []
    for name, ch in [('Thumb', tch)] + list(zip(['Index', 'Middle', 'Ring', 'Pinky'], chains)):
        prev = palm
        joints = []
        for k, q in enumerate(ch):
            # hinge on the segment's own long axis: centre of the end facing the
            # previous piece, inset a little so the knuckle rotates in place
            a = np.array([c[:] for c in q['co']]); m = a.mean(0)
            ax = Vector(np.linalg.svd(a - m, full_matrices=False)[2][0])
            if ax.dot(q['c'] - prev['c']) < 0: ax = -ax
            t = [(c - q['c']).dot(ax) for c in q['co']]
            t0, t1 = min(t), max(t); L = t1 - t0
            head = mean([c for c, tt in zip(q['co'], t) if tt < t0 + 0.15 * L]) + ax * 0.12 * L
            tail = mean([c for c, tt in zip(q['co'], t) if tt > t1 - 0.15 * L])
            joints.append((head, tail, q))
            prev = q
        d0 = (joints[0][1] - joints[0][0]).normalized()
        if name == 'Thumb':
            curl = palm['c'] - joints[0][0]
        else:
            curl = palm_n          # fold straight into the palm
        curl = (curl - d0 * curl.dot(d0)).normalized()
        for k, (h, t, q) in enumerate(joints):
            bn = f'{name}{k + 1}_{side}'
            par = f'Hand_{side}' if k == 0 else f'{name}{k}_{side}'
            out.append((bn, h, t, par, curl, q['v']))
    return out

FINGERS = {}   # side -> list of (bone, head, tail, parent, curl_dir, vertex indices)
HAND_OBJ = {'L': alias.get('tripo_node_9dcdae010', 'tripo_node_9dcdae010'),
            'R': alias.get('tripo_node_9dcdae07', 'tripo_node_9dcdae07')}
for sd, on in HAND_OBJ.items():
    FINGERS[sd] = finger_rig(bpy.data.objects[on], sd)
    print("FINGERS", sd, [(b, len(v)) for b, *_, v in FINGERS[sd]])
ROLL = {}
for sd, lst in FINGERS.items():
    for bn, h, t, par, curl, _ in lst:
        B[bn] = (tuple(h), tuple(t), par); ROLL[bn] = curl

arm_data = bpy.data.armatures.new('MechSkeleton')
rig = bpy.data.objects.new('MechRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, (h, t, _) in B.items():
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = Vector(h), Vector(t)
    eb.align_roll(ROLL.get(name, Vector((0, -1, 0))))  # local Z forward; fingers: Z toward the curl
    if name == 'Root':
        eb.align_roll(Vector((0, -1, 0)))
for name, (_, _, p) in B.items():
    if p:
        eb = arm_data.edit_bones[name]
        eb.parent = arm_data.edit_bones[p]
        eb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

# --- 5. Wire the leg normal map that the FBX importer dropped
legmat = bpy.data.materials.get('tripo_mat_3c441de2')
nimg = bpy.data.images.get('normalmap_texture')
if legmat and nimg:
    nt = legmat.node_tree
    nm = next(n for n in nt.nodes if n.type == 'NORMAL_MAP')
    if not nm.inputs['Color'].is_linked:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = nimg
        nimg.colorspace_settings.name = 'Non-Color'
        nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

# --- 5b. Shield on the left forearm (outer side, painted face out), like the reference
SHIELD = os.environ.get('MECH_SHIELD', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shield', 'shield_lowpoly.glb'))
SHIELD = SHIELD if os.path.exists(SHIELD) else None
if SHIELD:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=SHIELD)
    new = [o for o in bpy.data.objects if o not in before]
    sh = next(o for o in new if o.type == 'MESH')
    mw = sh.matrix_world.copy(); sh.parent = None; sh.matrix_world = mw
    for o in new:
        if o is not sh:
            bpy.data.objects.remove(o)
    # source is ~100 units tall (cm), face along +X, grip bar at the top (+Z)
    S_SCALE = 0.0155
    sh.scale = (S_SCALE,) * 3
    # placed so the grip bar on its back sits in the left fist (see GRIP_WRIST)
    SHIFT = Vector((0.030, -0.12, 0.079))   # forward so it sits beside, not behind, the forearm
    sh.location = Vector((0.60 + 12.0 * S_SCALE, 0.41, 1.98 - 99.6 * S_SCALE)) + SHIFT
    bpy.ops.object.select_all(action='DESELECT'); sh.select_set(True)
    bpy.context.view_layer.objects.active = sh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # the source shield is yawed ~29 deg in plan; turn it parallel to the body's
    # side (face straight out), pivoting on the grip so it stays in the fist
    SHIELD_YAW = 29.1
    pivot = Vector((0.576, 0.37, 1.30)) + SHIFT
    sh.data.transform(Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(SHIELD_YAW), 4, 'Z')
                      @ Matrix.Translation(-pivot))
    sh.name = 'Shield'
    meshes.append(sh); part_bone[sh.name] = 'ForeArm_L'

# --- 6. Rigid skinning: every vertex of a part -> its bone at weight 1.0
for o in meshes:
    # join() merges UV maps by name; parts use 4 different names, so unify them
    assert len(o.data.uv_layers) == 1, (o.name, len(o.data.uv_layers))
    o.data.uv_layers[0].name = 'UVMap'
    vg = o.vertex_groups.new(name=part_bone[o.name])
    vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    for sd, on in HAND_OBJ.items():
        if o.name == on:
            for bn, *_, vids in FINGERS[sd]:
                vg.remove(vids)
                o.vertex_groups.new(name=bn).add(vids, 1.0, 'REPLACE')

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
body = bpy.data.objects['tripo_node_5486a718']
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = body.data.name = 'MechBody'
body.parent = rig
mod = body.modifiers.new('Armature', 'ARMATURE')
mod.object = rig

# --- 6b. Beam saber: hilt stored on the shield's inner face, drawn by the right hand
FIST = {'Index': (60, 70, 50), 'Middle': (60, 70, 50), 'Ring': (60, 80),
        'Pinky': (60, 70, 50), 'Thumb': (20, 30, 30)}
SABER = bool(SHIELD)
BLADE_OFF = 0.001
if SABER:
    import bmesh
    # stored on the shield's inner front edge, tilted toward the right hand for a
    # cross-body draw (placement found by searching reachable, natural poses)
    HOLSTER = Vector((0.625, 0.131, 1.437))  # front edge of the shield's back (slid onto it below)
    HOLSTER_TILT = (14.4, 19.3)        # deg about X, Z: emitter up, leaning toward the right hand
    HOLSTER_ROLL = 113.5               # spin of the hilt about its own axis
    HS = 0.85                          # handle scale
    HILT_LEN, BLADE_LEN = 0.30 * HS, 1.45

    # right-fist socket: where the hilt sits when the fingers are closed
    bpy.context.view_layer.objects.active = rig
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    for f, angs in FIST.items():
        for k, a in enumerate(angs):
            rig.pose.bones[f'{f}{k + 1}_R'].rotation_euler.x = math.radians(a)
    bpy.context.view_layer.update()
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    gname = {g.index: g.name for g in body.vertex_groups}
    def gcen(ns):
        vs = [ev.vertices[v.index].co for v in body.data.vertices if v.groups and gname[v.groups[0].group] in ns]
        return sum(vs, Vector()) / len(vs)
    palmc = gcen({'Hand_R'})
    midc = gcen({'Index2_R', 'Middle2_R', 'Ring2_R', 'Pinky2_R'})
    g_ctr = (gcen({'Index1_R', 'Middle1_R', 'Ring1_R', 'Pinky1_R'}) + midc
             + gcen({'Index3_R', 'Middle3_R', 'Pinky3_R'}) + palmc) / 4
    g_y = (gcen({'Index1_R'}) - gcen({'Pinky1_R'})).normalized()        # blade leaves the thumb side
    g_z = (midc - palmc); g_z = (g_z - g_y * g_z.dot(g_y)).normalized()
    body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()

    def frame(o, y, z):
        x = y.cross(z).normalized(); z = x.cross(y).normalized()
        m = Matrix((x, y.normalized(), z)).transposed().to_4x4(); m.translation = o
        return m
    M_GRIP = frame(g_ctr, g_y, g_z)
    from mathutils import Euler
    hy = Euler((math.radians(HOLSTER_TILT[0]), 0, math.radians(HOLSTER_TILT[1]))).to_matrix() @ Vector((0, 0, 1))
    M_HOLST = frame(HOLSTER, hy, Vector((0, 1, 0))) @ Matrix.Rotation(math.radians(HOLSTER_ROLL), 4, 'Y')

    # model (local frame: +Y toward the emitter, origin at hilt centre)
    sm = bpy.data.meshes.new('Saber'); bm = bmesh.new()
    def cyl(y0, y1, r0, r1, mat, grp, seg=20):
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=y1 - y0)
        vs = res['verts']
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
        bmesh.ops.translate(bm, verts=vs, vec=(0, (y0 + y1) / 2, 0))
        for f in {f for v in vs for f in v.link_faces}:
            f.material_index = mat; f.smooth = True
        for v in vs: v[dl][grp] = 1.0
    dl = bm.verts.layers.deform.verify()
    h = HILT_LEN / 2
    cyl(-h, -h + 0.03 * HS, 0.036 * HS, 0.038 * HS, 0, 0)                  # pommel
    cyl(-h + 0.03 * HS, h - 0.07 * HS, 0.030 * HS, 0.030 * HS, 0, 0)       # grip
    for i in range(5):                                                     # grip rings
        y = -h + (0.05 + i * 0.035) * HS
        cyl(y, y + 0.012 * HS, 0.034 * HS, 0.034 * HS, 0, 0)
    cyl(h - 0.07 * HS, h - 0.02 * HS, 0.036 * HS, 0.040 * HS, 0, 0)        # guard
    cyl(h - 0.02 * HS, h, 0.040 * HS, 0.030 * HS, 1, 0)                    # emitter (unlit)
    cyl(h - 0.004, h + 0.004, 0.029 * HS, 0.027 * HS, 2, 1, 16)           # emitter glow: part of the blade
    cyl(h, h + BLADE_LEN - 0.08, 0.020, 0.018, 2, 1, 16)    # blade core
    cyl(h + BLADE_LEN - 0.08, h + BLADE_LEN, 0.018, 0.004, 2, 1, 16)
    cyl(h - 0.01, h + BLADE_LEN + 0.03, 0.048, 0.040, 3, 1, 16)   # glow shell
    bm.to_mesh(sm); bm.free()
    so = bpy.data.objects.new('Saber', sm); scene.collection.objects.link(so)
    so.vertex_groups.new(name='Saber'); so.vertex_groups.new(name='SaberBlade')
    sm.uv_layers.new(name='UVMap')
    def mat(name, base, metal, rough, emit=None, strength=0.0, alpha=1.0):
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*base, 1)
        b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
        if emit:
            b.inputs['Emission Color'].default_value = (*emit, 1)
            b.inputs['Emission Strength'].default_value = strength
        if alpha < 1:
            b.inputs['Alpha'].default_value = alpha
            m.surface_render_method = 'BLENDED'
        return m
    # handle colour: average of the shield texture over its back (inner) faces
    shm_i = [i for i, mt in enumerate(body.data.materials) if 'ff7b5edd' in mt.name][0]
    timg = next(n.image for n in body.data.materials[shm_i].node_tree.nodes    # the colour (sRGB) map
                if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB')
    W_, H_ = timg.size; px = timg.pixels[:]
    uvl = body.data.uv_layers['UVMap'].data; acc = [0.0, 0.0, 0.0]; nacc = 0
    for pp in body.data.polygons:
        if pp.material_index == shm_i and pp.normal.x < -0.6:
            for li in pp.loop_indices:
                u, v = uvl[li].uv
                ix = min(W_ - 1, max(0, int((u % 1) * W_))); iy = min(H_ - 1, max(0, int((v % 1) * H_)))
                k = (iy * W_ + ix) * 4
                for c in range(3):
                    acc[c] += px[k + c]
                nacc += 1
    srgb = [c / nacc for c in acc]
    to_lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    HILT_RGB = tuple(to_lin(c) for c in srgb) if timg.colorspace_settings.name == 'sRGB' and not timg.is_float else tuple(srgb)
    print("HILT colour from shield back (sRGB):", tuple(round(c, 3) for c in srgb))
    for m in (mat('SaberHilt', HILT_RGB, 0.0, 0.85),
              mat('SaberEmitter', tuple(c * 0.6 for c in HILT_RGB), 0.0, 0.8),
              mat('SaberBladeCore', (1.0, 0.85, 0.95), 0.0, 0.2, (1.0, 0.8, 0.92), 8.0),
              mat('SaberBladeGlow', (1.0, 0.15, 0.55), 0.0, 0.5, (1.0, 0.15, 0.55), 4.0, alpha=0.35)):
        sm.materials.append(m)
    sm.transform(M_HOLST)
    bpy.ops.object.select_all(action='DESELECT')
    so.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

    # bones: Saber (stored on the shield), SaberBlade (scale = ignite), SaberGrip (fist socket),
    
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    E = arm_data.edit_bones
    def bone(name, m, length, parent, deform=True):
        eb = E.new(name); eb.head = m.translation; eb.tail = m.translation + m.to_3x3().col[1] * length
        eb.align_roll(m.to_3x3().col[2]); eb.parent = E[parent]; eb.use_deform = deform
        return eb
    bone('Saber', M_HOLST, 0.15, 'ForeArm_L')
    mb = M_HOLST.copy(); mb.translation = M_HOLST @ Vector((0, HILT_LEN / 2, 0))
    bone('SaberBlade', mb, BLADE_LEN, 'Saber')
    bone('SaberGrip', M_GRIP, 0.15, 'Hand_R', deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')


# --- 6c. Gun (right hand) + head-vulcan muzzle sockets, placed from the source move set
MOVES_SRC = os.environ.get('MECH_MOVES', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'source_moves.glb'))
GUN_SRC = os.environ.get('MECH_GUN', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'gun', 'gun.glb'))
MOVES_OK = SABER and os.path.exists(MOVES_SRC)
if MOVES_OK:
    import json, struct
    import numpy as np
    from mathutils import Quaternion, Euler
    raw = open(MOVES_SRC, 'rb').read()
    jl = struct.unpack('<I', raw[12:16])[0]; GJ = json.loads(raw[20:20 + jl])
    bin_off = 20 + jl + 8
    def acc_data(i):
        a = GJ['accessors'][i]; bv = GJ['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bin_off + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(raw, dtype=np.float32, count=a['count'] * n, offset=off).reshape(a['count'], n)
    NODES = GJ['nodes']; NID = {n['name']: i for i, n in enumerate(NODES)}
    PARENT = {}
    for i, n in enumerate(NODES):
        for c in n.get('children', []): PARENT[c] = i
    def trs(i, T=None, R=None, S_=None):
        n = NODES[i]
        t = Vector(T if T is not None else n.get('translation', [0, 0, 0]))
        q = R if R is not None else n.get('rotation', [0, 0, 0, 1])
        s_ = S_ if S_ is not None else n.get('scale', [1, 1, 1])
        m = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
        for k in range(3): m.col[k] *= s_[k]
        m.translation = t
        return m
    CG = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # glTF (Y up) -> Blender (Z up)
    MIR = Matrix.Diagonal((-1, 1, 1, 1))
    # rest (bind) pose of the source
    _rw = {}
    def _rest(i):
        if i in _rw: return _rw[i]
        _rw[i] = (_rest(PARENT[i]) @ trs(i)) if i in PARENT else trs(i)
        return _rw[i]
    for i in range(len(NODES)): _rest(i)

    S_SC = rig.data.bones['Hips'].head_local.z / (CG @ _rest(NID['Pelvis']).translation).z
    def mapped(nm_src, nm_anchor_src, anchor_our, mirror=False):
        """source rest node -> our space: rotation mapped, position scaled around an anchor bone"""
        m = _rest(NID[nm_src]); a = _rest(NID[nm_anchor_src])
        if mirror: m = MIR @ m @ MIR; a = MIR @ a @ MIR
        lin = (CG @ m @ CG.inverted()).to_3x3()
        pos = rig.data.bones[anchor_our].head_local + (CG.to_3x3() @ (m.translation - a.translation)) * S_SC
        M = (lin * S_SC).to_4x4(); M.translation = pos
        return M
    HAS_GUN = os.path.exists(GUN_SRC)
    before = set(bpy.data.objects)
    if HAS_GUN:
        bpy.ops.import_scene.gltf(filepath=GUN_SRC)
        newo = [o for o in bpy.data.objects if o not in before]
        go = next(o for o in newo if o.type == 'MESH')
        mw = go.matrix_world.copy(); go.parent = None; go.matrix_world = mw
        for o in newo:
            if o is not go: bpy.data.objects.remove(o)
        bpy.context.view_layer.objects.active = go; bpy.ops.object.select_all(action='DESELECT'); go.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # mount by the gun's own geometry: its pistol grip (the part hanging below the
        # body, barrel toward -X, top +Z) goes through the right fist like the saber hilt,
        # top of the gun on the thumb side, barrel along the forearm
        gv = [v.co.copy() for v in go.data.vertices]
        zmin = min(c.z for c in gv); zmax = max(c.z for c in gv)
        low = [c for c in gv if c.z < zmin + 0.30 * (zmax - zmin)]
        gx = sum(c.x for c in low) / len(low)
        band = [c for c in gv if abs(c.x - gx) < 0.08 and c.z < zmin + 0.55 * (zmax - zmin)]
        GRIP_P = Vector((gx, sum(c.y for c in band) / len(band), zmin + 0.30 * (zmax - zmin)))
        Bn0 = rig.data.bones
        sgm = Bn0['SaberGrip'].matrix_local; hm = Bn0['Hand_R'].matrix_local
        up_w = sgm.to_3x3().col[1].normalized()                      # handle axis through the fist
        fwd_w = hm.to_3x3().col[1] - up_w * hm.to_3x3().col[1].dot(up_w)
        fwd_w.normalize()                                             # barrel along the forearm/hand
        side_w = up_w.cross(fwd_w)
        # gun local basis: barrel -X, up +Z, side = up x barrel
        Lg = Matrix((Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 0, 1)).cross(Vector((-1, 0, 0))))).transposed()
        Wg = Matrix((fwd_w, up_w, side_w)).transposed()
        GUN_SCALE = 1.45 * (hm.translation - Bn0['ForeArm_R'].matrix_local.translation).length / (max(c.x for c in gv) - min(c.x for c in gv))
        R3 = (Wg @ Lg.inverted()) * GUN_SCALE
        M_GUN = R3.to_4x4(); M_GUN.translation = sgm.translation - R3 @ GRIP_P
        print("GUN mount: grip", tuple(round(x, 3) for x in GRIP_P), "scale", round(GUN_SCALE, 3))
        go.data.transform(M_GUN)
        go.data.uv_layers[0].name = 'UVMap'
        go.vertex_groups.new(name='Gun').add(list(range(len(go.data.vertices))), 1.0, 'REPLACE')
        bpy.ops.object.select_all(action='DESELECT'); go.select_set(True); body.select_set(True)
        bpy.context.view_layer.objects.active = body; bpy.ops.object.join()
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    E = arm_data.edit_bones
    def sock(name, M, parent, length=0.1, deform=False):
        eb = E.new(name); r3 = M.to_3x3().normalized()
        eb.head = M.translation; eb.tail = M.translation + r3.col[1] * length
        eb.align_roll(r3.col[2]); eb.parent = E[parent]; eb.use_deform = deform
    if HAS_GUN:
        sock('Gun', M_GUN, 'Hand_R', 0.2, deform=True)
        mz = M_GUN @ Vector((min(c.x for c in gv), 0.0, zmin + 0.62 * (zmax - zmin)))
        sock('Gun_Muzzle', Matrix.Translation(mz) @ M_GUN.to_3x3().normalized().to_4x4(), 'Gun')
    for s in 'LR':     # muzzle points of the head vulcans (source flashes rest at scale 0: use position only)
        fl = mapped(f'HeadTurret_Flash.{s}', 'Head', 'Head')
        fwd = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))              # bone Y -> forward (-Y)
        sock(f'Vulcan_{s}', Matrix.Translation(fl.translation) @ fwd.to_4x4(), 'Head', 0.08)
    bpy.ops.object.mode_set(mode='OBJECT')

# --- 7. Animation clips (in place, loopable)
def rad(d): return math.radians(d)

def key_pose(action_name, frames, pose_fn):
    rig.animation_data_create()
    act = bpy.data.actions.new(action_name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    for f in range(frames + 1):
        for pb in rig.pose.bones:
            pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
        pose_fn(f / frames * 2 * math.pi)
        for pb in rig.pose.bones:
            pb.keyframe_insert('location', frame=f + 1)
            pb.keyframe_insert('rotation_euler', frame=f + 1)
            if pb.name in ('SaberBlade', 'Gun'):
                pb.keyframe_insert('scale', frame=f + 1)
    act.frame_range = (1, frames + 1)
    return act

P = rig.pose.bones
# Bone-local axes (roll aligned forward): for bones pointing down, +X rotation
# swings the tail forward (-Y); for Hips/Spine/Head (pointing up), +X tips forward too.

GRIP_WRIST = (-5.7, -67.0, -0.8)   # hand pose approved by the user; shield placed around it
RELAX = {'Index': (12, 18, 12), 'Middle': (16, 22, 14), 'Ring': (20, 26),
         'Pinky': (24, 28, 18), 'Thumb': (8, 10, 8)}

def fingers(side, pose, extra=0.0):
    for f, angs in pose.items():
        for k, a in enumerate(angs):
            P[f'{f}{k + 1}_{side}'].rotation_euler.x = rad(a + extra * (k + 1) / len(angs))

def hands(p, squeeze, relax_wave):
    # left: wrist locked on the grip, fingers tighten a touch on each impact
    # right: loose half-curl that breathes / flexes with the swing
    if SHIELD:
        P['Hand_L'].rotation_euler = tuple(rad(a) for a in GRIP_WRIST)
        fingers('L', FIST, squeeze)
    fingers('R', RELAX, relax_wave)
    if not SHIELD:
        fingers('L', RELAX, relax_wave)
    if SABER:
        P['SaberBlade'].scale = (BLADE_OFF,) * 3                  # stored: blade off
    if 'Gun' in P:
        P['Gun'].scale = (0.001,) * 3                             # gun only shows in the Gun clips

STAB = 0.9   # how much of the body's pitch the head cancels (1.0 = perfectly level)

def idle(p):
    br = 0.5 - 0.5 * math.cos(p)                                   # breath 0..1
    P['Hips'].location.y = -0.012 * br
    P['Hips'].rotation_euler.x = rad(0.6 * math.sin(p))
    P['Hips'].rotation_euler.z = rad(0.4 * math.sin(p + 0.7))
    P['UpperLeg_L'].rotation_euler.x = P['UpperLeg_R'].rotation_euler.x = rad(4 * br)
    P['LowerLeg_L'].rotation_euler.x = P['LowerLeg_R'].rotation_euler.x = rad(-8 * br)
    P['Foot_L'].rotation_euler.x = P['Foot_R'].rotation_euler.x = rad(4 * br)
    P['Spine'].rotation_euler.x = rad(-1.5 * math.sin(p))
    P['Spine'].rotation_euler.z = rad(-0.5 * math.sin(p + 0.7))
    body_pitch = P['Hips'].rotation_euler.x + P['Spine'].rotation_euler.x
    P['Head'].rotation_euler.x = -STAB * body_pitch + rad(0.5 * math.sin(p - 0.6))  # stabilized
    P['Head'].rotation_euler.y = rad(6 * math.sin(p))
    for s, sg in (('L', -1), ('R', 1)):
        P[f'Shoulder_{s}'].rotation_euler.z = rad(sg * -1.2 * br)  # shoulders lift on the breath
        P[f'UpperArm_{s}'].rotation_euler.x = rad(3 + 2 * math.sin(p))
        P[f'UpperArm_{s}'].rotation_euler.z = rad(sg * -3)
        P[f'ForeArm_{s}'].rotation_euler.x = rad(10 + 4 * math.sin(p - 0.4))
        P[f'Hand_{s}'].rotation_euler.x = rad(3 * math.sin(p - 0.9))
        P[f'Hand_{s}'].rotation_euler.y = rad(sg * 2 * math.sin(p - 0.5))
        P[f'SkirtFront_{s}'].rotation_euler.x = rad(1.2 * math.sin(p - 0.5))
        P[f'SkirtSide_{s}'].rotation_euler.z = rad(-sg * (1 + 0.8 * math.sin(p - 0.5)))
    P['SkirtBack'].rotation_euler.x = rad(-1.2 * math.sin(p - 0.5))
    hands(p, 1.5 * math.sin(p), 6 * math.sin(p - 0.8))

def walk(p):
    hit = math.cos(2 * p)                  # +1 at each foot strike (p = 0, pi)
    P['Hips'].location.y = -0.035 * (0.5 + 0.5 * hit)              # dip on each step
    P['Hips'].rotation_euler.x = rad(1.0 * hit)
    P['Hips'].rotation_euler.y = rad(2 * math.sin(p))              # hip twist
    P['Hips'].rotation_euler.z = rad(0.8 * math.cos(p))            # hip sway
    P['Spine'].rotation_euler.x = rad(4 + 1.5 * math.cos(2 * p - 0.5))  # lean forward + absorb
    P['Spine'].rotation_euler.y = rad(-3 * math.sin(p))            # counter twist
    P['Spine'].rotation_euler.z = rad(-0.6 * math.cos(p))
    # head stabilizer: counter-rotate (tilt up) against the hips + spine pitch so
    # the gaze stays level through the lean and the step bounce; only a small
    # residual nod that trails each strike is left
    body_pitch = P['Hips'].rotation_euler.x + P['Spine'].rotation_euler.x
    P['Head'].rotation_euler.x = -STAB * body_pitch + rad(0.6 * math.cos(2 * p - 1.2))
    P['Head'].rotation_euler.y = rad(1.5 * math.sin(p))
    P['Head'].rotation_euler.z = rad(0.4 * math.sin(p - 0.4))
    for s, ph, sg in (('L', 0.0, -1), ('R', math.pi, 1)):
        q = p + ph
        thigh = 26 * math.sin(q)
        knee = -(6 + 45 * max(0.0, math.cos(q)) ** 1.5)          # bend while leg swings through
        P[f'UpperLeg_{s}'].rotation_euler.x = rad(thigh)
        P[f'LowerLeg_{s}'].rotation_euler.x = rad(knee)
        P[f'Foot_{s}'].rotation_euler.x = rad(-(thigh + knee) + 8 * math.sin(q))
        heavy = s == 'L' and SHIELD                               # shield arm swings less
        arm = -16 * math.sin(q) * (0.45 if heavy else 1.0)        # opposite to its own leg
        P[f'Shoulder_{s}'].rotation_euler.x = rad(0.25 * arm)     # shoulder rolls with the swing
        P[f'Shoulder_{s}'].rotation_euler.z = rad(sg * 1.5 * math.cos(2 * p - 0.6))  # drops on impact
        P[f'UpperArm_{s}'].rotation_euler.x = rad(arm)
        P[f'UpperArm_{s}'].rotation_euler.z = rad(sg * -2)
        fwd = -math.sin(q - 0.45)                                 # forearm lags the upper arm
        if heavy:
            P[f'ForeArm_{s}'].rotation_euler.x = rad(14 + 4 * fwd + 1.5 * hit)
        else:
            P[f'ForeArm_{s}'].rotation_euler.x = rad(15 + 13 * fwd + 2 * hit)
        P[f'Hand_{s}'].rotation_euler.x = rad(7 * -math.sin(q - 0.9))  # wrist follow-through
        P[f'Hand_{s}'].rotation_euler.y = rad(sg * 4 * math.cos(q))
        P[f'SkirtFront_{s}'].rotation_euler.x = rad(max(0.0, thigh) * 0.8 + 2 * math.cos(2 * p - 0.6))
        P[f'SkirtSide_{s}'].rotation_euler.x = rad(0.25 * thigh)
        P[f'SkirtSide_{s}'].rotation_euler.z = rad(-sg * (3 + 2.5 * (0.5 + 0.5 * math.cos(2 * p - 0.6))))
    P['SkirtBack'].rotation_euler.x = rad(-max(0.0, -26 * math.sin(p), -26 * math.sin(p + math.pi)) * 0.5
                                          - 2 * math.cos(2 * p - 0.6))
    hands(p, 2.5 * (0.5 + 0.5 * math.cos(2 * p - 0.4)), 10 * math.sin(p + math.pi - 0.9))

acts = [key_pose('Idle', 60, idle), key_pose('Walk', 30, walk)]
# --- 7b. Saber clips: draw (baked from IK + a shield->hand handover), hold, walk, sheathe
if SABER:
    import json
    TUNE = json.loads(os.environ.get('SABER_TUNE', '{}'))
    def T(k, d): return TUNE.get(k, d)

    def smooth(a, b, t):
        t = min(1.0, max(0.0, (t - a) / (b - a))); return t * t * (3 - 2 * t)

    def capture(fn, *a):
        for pb in rig.pose.bones:
            pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
        fn(*a)
        return {pb.name: (pb.location.copy(), pb.rotation_euler.copy(), pb.scale.copy()) for pb in rig.pose.bones}

    def apply_mix(A, B, t):
        for pb in rig.pose.bones:
            la, ra, sa = A[pb.name]; lb, rb, sb = B[pb.name]
            pb.location = la.lerp(lb, t)
            pb.rotation_euler = tuple(x + (y - x) * t for x, y in zip(ra, rb))
            pb.scale = sa.lerp(sb, t)

    def ready(p=0.0, bob=0.0):
        # right arm: saber held up and forward; left arm: shield a little forward
        P['UpperArm_R'].rotation_euler = (rad(T('ua_x', 30) + 2 * math.sin(p)), 0, rad(T('ua_z', -14)))
        P['ForeArm_R'].rotation_euler = (rad(T('fa_x', 70) + 3 * math.sin(p - 0.5) + bob), rad(T('fa_y', 0)), 0)
        P['Hand_R'].rotation_euler = (rad(T('h_x', -20)), rad(T('h_y', 0)), rad(T('h_z', 0)))
        fingers('R', FIST, 1.5 * math.sin(p))
        P['SaberBlade'].scale = (1 + 0.04 * math.sin(9 * p), 1.0, 1 + 0.04 * math.sin(9 * p))  # hum

    def saber_idle(p):
        idle(p)
        P['UpperArm_L'].rotation_euler.x += rad(10); P['ForeArm_L'].rotation_euler.x += rad(20)
        ready(p)

    def saber_walk(p):
        walk(p)
        P['UpperArm_L'].rotation_euler.x = rad(10); P['ForeArm_L'].rotation_euler.x = rad(30)
        ready(p, bob=2.5 * math.cos(2 * p - 0.4))

    def reach():
        idle(0)
        P['Hips'].rotation_euler.y = rad(T('hip_twist', 0))   # hips stay square: feet don't slide
        P['Spine'].rotation_euler = (rad(T('sp_x', 10)), rad(T('sp_twist', 20)), 0)
        # cross-body draw: the shield stays sideways (face out, upright); the left arm
        # brings it in a little so the right hand can reach the hilt on its front edge
        P['Shoulder_L'].rotation_euler = (rad(T('shl_x', -6.8)), 0, rad(T('shl_z', -0.2)))
        P['UpperArm_L'].rotation_euler = (rad(T('ual_x', -14.2)), rad(T('ual_y', 58.6)), rad(T('ual_z', 5.5)))
        P['ForeArm_L'].rotation_euler.x = rad(T('fal_x', 57.6))
        P['Shoulder_R'].rotation_euler = (rad(T('shr_x', 9.9)), 0, rad(T('shr_z', -7.9)))
        fingers('R', {k: tuple(0 for _ in v) for k, v in FIST.items()})   # open hand
        P['SaberBlade'].scale = (BLADE_OFF,) * 3

    hold = P['Saber'].constraints.new('COPY_TRANSFORMS')
    hold.target = rig; hold.subtarget = 'SaberGrip'; hold.influence = 0.0

    POSE_IDLE0 = capture(idle, 0.0)
    POSE_REACH = capture(reach)

    # right arm for the grab: find a natural reach (small twists, elbow bending
    # forward) that brings the fist to the holster spot, then turn the stored hilt
    # to match that fist, so the handover is exact without contorting the wrist
    import random
    from mathutils import Euler
    rig.animation_data.action = None          # else the last clip re-poses the rig on update
    for n, (l, r_, sc) in POSE_REACH.items():
        P[n].location, P[n].rotation_euler, P[n].scale = l, r_, sc
    bpy.context.view_layer.update()
    Bn = rig.data.bones
    CH = ('UpperArm_R', 'ForeArm_R', 'Hand_R')
    rel = {b: Bn[b].parent.matrix_local.inverted() @ Bn[b].matrix_local for b in CH}
    base = P['Shoulder_R'].matrix.copy()
    g_loc = Bn['Hand_R'].matrix_local.inverted() @ Bn['SaberGrip'].matrix_local
    D = P['ForeArm_L'].matrix @ Bn['ForeArm_L'].matrix_local.inverted()     # shield motion
    Di = D.inverted()
    target = D @ HOLSTER
    print(f"GRAB dbg: shoulder->target {(P['UpperArm_R'].head - target).length:.3f} m, target {tuple(round(x, 3) for x in target)}, "
          f"fist at rest pose {tuple(round(x, 3) for x in (base @ rel['UpperArm_R'] @ rel['ForeArm_R'] @ rel['Hand_R'] @ g_loc).translation)}")
    def fk(a):
        m = base
        for i, b in enumerate(CH):
            m = m @ rel[b] @ Euler(a[3 * i:3 * i + 3], 'XYZ').to_matrix().to_4x4()
        return m @ g_loc
    def cost(a):
        m = fk(a)
        axis_rest = (Di.to_3x3() @ m.to_3x3().col[1]).normalized()      # hilt axis once stored
        return (float(os.environ.get('REACH_W', '300')) * (m.translation - target).length
                + 0.15 * (a[1] ** 2 + a[4] ** 2 + a[7] ** 2)             # twists
                + 0.03 * sum(x * x for x in a)
                + 0.5 * max(0.0, -a[3])                                  # elbow bends forward
                + 12 * abs(axis_rest.x)                                  # lies along the shield face
                + 25 * (1 - axis_rest.z))                                # upright on the shield
    from mathutils.bvhtree import BVHTree
    me_ = body.data
    shi = [i for i, mt in enumerate(me_.materials) if 'ff7b5edd' in mt.name][0]
    sh_bvh = BVHTree.FromPolygons([v.co for v in me_.vertices],
                                  [list(pp.vertices) for pp in me_.polygons if pp.material_index == shi])
    sg = {body.vertex_groups['Saber'].index, body.vertex_groups['SaberBlade'].index}
    hilt_idx = [v.index for v in me_.vertices if v.groups and v.groups[0].group == body.vertex_groups['Saber'].index]

    def reseat(C):
        global M_HOLST
        for v in me_.vertices:
            if v.groups and v.groups[0].group in sg:
                v.co = C @ v.co
        bpy.ops.object.mode_set(mode='EDIT')
        for bnm in ('Saber', 'SaberBlade'):
            eb = arm_data.edit_bones[bnm]; eb.matrix = C @ eb.matrix
        bpy.ops.object.mode_set(mode='OBJECT')
        M_HOLST = C @ M_HOLST

    def descend(a, c):
        step = 0.4
        while step > 1e-4:
            improved = False
            for i in range(9):
                for d_ in (step, -step):
                    b_ = list(a); b_[i] += d_; cb = cost(b_)
                    if cb < c: a, c, improved = b_, cb, True
            if not improved: step *= 0.5
        return a, c

    SINK = -0.015                     # hilt sits 1.5 cm into the shield's back (when sliding)
    SLIDE_TO_SHIELD = True            # slide onto the shield's inner face, then sink
    rng = random.Random(5); a = None
    for it in range(2):
        target = D @ HOLSTER
        if a is None:
            best = None
            for trial in range(120):
                x0 = [rng.uniform(-1.2, 1.2) for _ in range(9)]
                r_ = descend(x0, cost(x0))
                if best is None or r_[1] < best[1]: best = r_
            a = best[0]
        else:
            a = descend(a, cost(a))[0]
        m = fk(a)
        reseat((Di @ m) @ M_HOLST.inverted())            # stored hilt takes the fist's orientation
        print(f"HOLSTER pass {it}: grab err {(m.translation - target).length * 100:.2f} cm")
        if it == 0 and SLIDE_TO_SHIELD:
            # measured once while the hilt is still clear of the shield: slide along +X
            # until it rests on the inner face, then sink it SINK further
            gap = min(h for h in (sh_bvh.ray_cast(me_.vertices[i].co, Vector((1, 0, 0)), 1.0)[3]
                                  for i in hilt_idx) if h is not None)
            reseat(Matrix.Translation(Vector((gap - SINK, 0, 0))))
            HOLSTER = M_HOLST.translation.copy()
            print(f"HOLSTER: {gap * 100:.1f} cm to the shield, sunk {-SINK * 100:.1f} cm")
    # conform: lay the stored hilt exactly along the shield's long axis, then re-solve
    # the arm (from the current pose) to meet that exact orientation
    import numpy as np
    sv = np.array([me_.vertices[i].co[:] for pp in me_.polygons if pp.material_index == shi for i in pp.vertices])
    long_ax = Vector(np.linalg.svd(sv - sv.mean(0), full_matrices=False)[2][0])
    if long_ax.z < 0: long_ax = -long_ax
    cur_y = M_HOLST.to_3x3().col[1]
    rot = cur_y.rotation_difference(long_ax).to_matrix().to_4x4()
    piv = M_HOLST.translation.copy()
    reseat(Matrix.Translation(piv) @ rot @ Matrix.Translation(-piv))
    goalM = D @ M_HOLST; gq_ = goalM.to_quaternion()
    def cost_full(a_):
        m_ = fk(a_)
        return (4000 * (m_.translation - goalM.translation).length
                + 60 * m_.to_3x3().col[1].angle(goalM.to_3x3().col[1])      # axis only; spin is free
                + 0.1 * (a_[1] ** 2 + a_[4] ** 2 + a_[7] ** 2) + 0.02 * sum(x * x for x in a_))
    def desc2(a_, c_, step=0.3):
        while step > 1e-5:
            imp = False
            for i in range(9):
                for d_ in (step, -step):
                    b_ = list(a_); b_[i] += d_; cb = cost_full(b_)
                    if cb < c_: a_, c_, imp = b_, cb, True
            if not imp: step *= 0.5
        return a_, c_
    a2, c2 = desc2(list(a), cost_full(a))
    rng2 = random.Random(9)
    for trial in range(150):                         # global: many starts near natural poses
        x0 = [x + rng2.gauss(0, 0.6) for x in a]
        r2 = desc2(x0, cost_full(x0))
        if r2[1] < c2: a2, c2 = r2
    m2 = fk(a2); a = a2
    print(f"CONFORM: hilt along shield axis {tuple(round(x, 2) for x in long_ax)}; grab err "
          f"{(m2.translation - goalM.translation).length * 100:.2f} cm, "
          f"axis off {math.degrees(m2.to_3x3().col[1].angle(goalM.to_3x3().col[1])):.2f} deg")
    # the stored hilt stays exactly on the shield axis; the fist lands on its centre and
    # the remaining tilt is blended into the hand over the first frames of the pull
    for i, b in enumerate(CH):
        l, _, sc = POSE_REACH[b]; POSE_REACH[b] = (l, Euler(a[3 * i:3 * i + 3], 'XYZ'), sc)
    print(f"GRAB arm {[round(math.degrees(x)) for x in a]}")
    ax = M_HOLST.to_3x3().col[1]
    print(f"HOLSTER re-seated: axis {tuple(round(x, 2) for x in ax)}")

    POSE_READY = capture(saber_idle, 0.0)
    N_DRAW, GRAB = 46, 14

    def key_frames(name, n, fn):
        act = bpy.data.actions.new(name); act.use_fake_user = True
        rig.animation_data.action = act
        for f in range(n + 1):
            _, hi = fn(f)
            hold.influence = hi
            for pb in rig.pose.bones:
                for path in ('location', 'rotation_euler', 'scale'):
                    pb.keyframe_insert(path, frame=f + 1)
            hold.keyframe_insert('influence', frame=f + 1)
        act.frame_range = (1, n + 1)
        bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.pose.select_all(action='SELECT')
        bpy.ops.nla.bake(frame_start=1, frame_end=n + 1, only_selected=False, visual_keying=True,
                         clear_constraints=False, use_current_action=True, bake_types={'POSE'},
                         channel_types={'LOCATION', 'ROTATION', 'SCALE'})
        bpy.ops.object.mode_set(mode='OBJECT')
        for fc in [fc for fc in act.fcurves if 'constraints' in fc.data_path]:
            act.fcurves.remove(fc)
        return act

    def draw_frame(f):
        if f <= GRAB:                       # reach across, open hand, IK onto the hilt
            t = smooth(0, GRAB - 2, f); apply_mix(POSE_IDLE0, POSE_REACH, t)
            return smooth(0, GRAB - 2, f), 0.0
        # close the fist, hand over, pull out to the ready pose, ignite
        apply_mix(POSE_REACH, POSE_READY, smooth(GRAB + 3, 32, f))
        c = smooth(GRAB, GRAB + 3, f)
        for fn_, angs in FIST.items():
            for k, a in enumerate(angs):
                P[f'{fn_}{k + 1}_R'].rotation_euler.x = rad(a) * max(c, smooth(GRAB + 3, 32, f))
        ig = smooth(28, 34, f)
        s = BLADE_OFF + (1 - BLADE_OFF) * ig * (1 + 0.08 * math.sin(math.pi * ig))
        P['SaberBlade'].scale = (s, s, s)
        return 0.0, smooth(GRAB, GRAB + 6, f)

    def loop_frame(fn, n):
        def g(f):
            for pb in rig.pose.bones:
                pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
            fn(f / n * 2 * math.pi); return 0.0, 1.0
        return g

    a_draw = key_frames('SaberDraw', N_DRAW, draw_frame)
    a_idle = key_frames('SaberIdle', 60, loop_frame(saber_idle, 60))
    a_walk = key_frames('SaberWalk', 30, loop_frame(saber_walk, 30))
    a_sheathe = a_draw.copy(); a_sheathe.name = 'SaberSheathe'; a_sheathe.use_fake_user = True
    end = N_DRAW + 2
    for fc in a_sheathe.fcurves:                   # the draw, played backwards
        pts = [(end - k.co.x, k.co.y) for k in fc.keyframe_points]
        fc.keyframe_points.clear()
        fc.keyframe_points.add(len(pts))
        for k, (x, y) in zip(fc.keyframe_points, sorted(pts)):
            k.co = (x, y); k.interpolation = 'LINEAR'
    # handover check: fist and hilt should coincide at the grab frame
    rig.animation_data.action = a_draw; hold.influence = 0; scene.frame_set(GRAB + 1)
    bpy.context.view_layer.update()
    gw = rig.matrix_world @ P['SaberGrip'].matrix; sw = rig.matrix_world @ P['Saber'].matrix
    ang = math.degrees((gw.to_quaternion().rotation_difference(sw.to_quaternion())).angle)
    print(f"HANDOVER gap {(gw.translation - sw.translation).length * 100:.1f} cm, {ang:.1f} deg")
    P['Saber'].constraints.remove(hold)
    acts += [a_draw, a_idle, a_walk, a_sheathe]


# --- 7c. Game move set: hand-authored clips for this mech (names/order/timing match the game)
MOVES_SPEC = os.environ.get('MECH_MOVES_SPEC', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'moves_spec.py'))
if SABER and MOVES_OK and os.path.exists(MOVES_SPEC):
    import numpy as np, random
    from mathutils import Euler, Quaternion
    SPEC = {}
    exec(open(MOVES_SPEC).read(), SPEC)
    CLIPS_A, GAITS = SPEC['CLIPS'], SPEC['GAITS']
    Bn = rig.data.bones
    ORDER = sorted(Bn, key=lambda b: len(b.parent_recursive))
    REST_O = {b.name: b.matrix_local.copy() for b in Bn}
    REL = {b.name: (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local.copy() for b in Bn}
    FINGER_BONES = [f'{f}{k + 1}_{s}' for f, a in FIST.items() for k in range(len(a)) for s in 'LR']
    # sole / knee points used to keep the mech on the ground
    gname = {g.index: g.name for g in body.vertex_groups}
    SOLE = {}
    for bn_ in ('Foot_L', 'Foot_R', 'LowerLeg_L', 'LowerLeg_R'):
        vs = [v.co.copy() for v in body.data.vertices if v.groups and gname[v.groups[0].group] == bn_]
        vs.sort(key=lambda c: c.z)
        pick = vs[:40] if bn_.startswith('Foot') else vs[:12]
        SOLE[bn_] = [REST_O[bn_].inverted() @ c for c in pick]
    D2R = math.radians

    def full(p):
        """fill a key pose with defaults"""
        q = {k: v for k, v in p.items()}
        q.setdefault('fistR', 0.4); q.setdefault('blade', 0.0); q.setdefault('saber', 0); q.setdefault('gun', 0)
        q.setdefault('lift', 0.0)
        return q

    def fk(pose, hips_off=Vector()):
        W = {}
        for b in ORDER:
            nm = b.name
            par = W[b.parent.name] if b.parent else Matrix.Identity(4)
            e = pose.get(nm, (0, 0, 0))
            basis = Euler(tuple(D2R(a) for a in e), 'XYZ').to_matrix().to_4x4()
            if nm == 'Hips': basis.translation = Vector((hips_off.x, hips_off.z, -hips_off.y))
            W[nm] = par @ REL[nm] @ basis
        return W

    def ground_off(pose, lift):
        W = fk(pose)
        low = min((W[b] @ c).z for b, pts in SOLE.items() for c in pts[::4])   # pts are bone-local
        return Vector((0, 0, -low + lift))

    G_LOC = REST_O['Hand_R'].inverted() @ REST_O['SaberGrip']
    _W0 = fk({})
    _m = _W0['UpperArm_R']
    for _b in ('UpperArm_R', 'ForeArm_R', 'Hand_R'):
        pass
    REACH = 0.82 * ((REST_O['ForeArm_R'].translation - REST_O['UpperArm_R'].translation).length
                    + (REST_O['Hand_R'].translation - REST_O['ForeArm_R'].translation).length
                    + (REST_O['SaberGrip'].translation - REST_O['Hand_R'].translation).length)
    print("REACH", round(REACH, 3))
    CHR = ('UpperArm_R', 'ForeArm_R', 'Hand_R')

    def solve_saber(pose, ground, prev=None, restarts=25, cw=1.2):
        """arm angles that put the hilt at pos with the blade along dir"""
        pos, d = pose['sab']
        pos = Vector(pos); d = Vector(d).normalized()
        off = ground_off(pose, pose.get('lift', 0)) if ground else Vector((0, 0, pose.get('lift', 0)))
        W = fk(pose, off)
        base = W['Shoulder_R']
        sh = W['UpperArm_R'].translation
        pos = pos + off                           # spec positions are relative to the grounded mech
        v = pos - sh
        if v.length > REACH: pos = sh + v.normalized() * REACH   # keep targets inside the arm's reach
        def fkarm(a):
            m = base
            for i, b in enumerate(CHR):
                m = m @ REL[b] @ Euler(a[3 * i:3 * i + 3], 'XYZ').to_matrix().to_4x4()
            return m @ G_LOC
        def cost(a):
            m = fkarm(a)
            return (60 * (m.translation - pos).length + 40 * m.to_3x3().col[1].angle(d)
                    + 1.5 * (a[1] ** 2 + a[4] ** 2 + a[7] ** 2) + 0.8 * (a[6] ** 2 + a[8] ** 2)
                    + 0.05 * sum(x * x for x in a) + 0.6 * max(0.0, -a[3])
                    + 200 * max(0.0, math.sqrt(a[6] ** 2 + a[7] ** 2 + a[8] ** 2) - 0.52) ** 2   # wrist <= ~30 deg
                    + (cw * sum((x - y) ** 2 for x, y in zip(a, prev)) if prev else 0.0))
        def descend(a, c):
            step = 0.3
            while step > 2e-4:
                imp = False
                for i in range(9):
                    for dd in (step, -step):
                        b_ = list(a); b_[i] += dd; cb = cost(b_)
                        if cb < c: a, c, imp = b_, cb, True
                if not imp: step *= 0.5
            return a, c
        seed = list(prev) if prev else [D2R(x) for b in CHR for x in pose.get(b, (0, 0, 0))]
        best = descend(seed, cost(seed)); rng = random.Random(3)
        for _ in range(restarts):
            x0 = [s + rng.gauss(0, 0.25 if prev else 0.7) for s in seed]
            r_ = descend(x0, cost(x0))
            if r_[1] < best[1]: best = r_
        a = best[0]; m = fkarm(a)
        err = ((m.translation - pos).length, math.degrees(m.to_3x3().col[1].angle(d)))
        out = dict(pose)
        for i, b in enumerate(CHR): out[b] = tuple(math.degrees(x) for x in a[3 * i:3 * i + 3])
        return out, err

    def gait(kind, u):
        p2 = 2 * math.pi * u
        base = SPEC['M'](SPEC['SH_READY'], SPEC['R_GUARD'], {'Spine': (5, -6, 0), 'Head': (-3, 5, 0)})
        pose = dict(base)
        hit = math.cos(2 * p2)
        if kind in ('fwd', 'back', 'run'):
            sgn = 1 if kind != 'back' else -1
            amp, kn, lean, bob = (40, 85, 14, 0.07) if kind == 'run' else (26, 45, 4, 0.035)
            for s, ph in (('L', 0.0), ('R', math.pi)):
                q = sgn * p2 + ph
                th = amp * math.sin(q)
                kneeb = -(8 + kn * max(0.0, math.cos(q)) ** 1.5)
                pose[f'UpperLeg_{s}'] = (th, 0, 3 if s == 'L' else -4)
                pose[f'LowerLeg_{s}'] = (kneeb, 0, 0)
                pose[f'Foot_{s}'] = (-(th + kneeb) + 8 * math.sin(q), 0, 0)
            arm = -(28 if kind == 'run' else 10) * math.sin(sgn * p2 + math.pi)
            pose['UpperArm_R'] = (22 + arm, 0, -12); pose['ForeArm_R'] = (78 + 0.4 * arm, 0, 0)
            ua, fa = SPEC['SH_READY']['UpperArm_L'], SPEC['SH_READY']['ForeArm_L']
            pose['UpperArm_L'] = (ua[0] - 0.25 * arm, ua[1], ua[2]); pose['ForeArm_L'] = fa
            pose['Spine'] = (5 + lean + 1.5 * hit, -6 - 3 * math.sin(p2) * sgn, 0)
            pose['Head'] = (-3 - 0.9 * (lean + 1.5 * hit), 5 + 1.5 * math.sin(p2), 0)
            pose['Hips'] = (1.0 * hit + (6 if kind == 'run' else 0), 2 * math.sin(p2) * sgn, 0.8 * math.cos(p2))
            pose['lift'] = (bob * (0.5 + 0.5 * math.cos(2 * p2)) if kind == 'run' else 0) - (0 if kind == 'run' else bob * (0.5 + 0.5 * hit))
        else:   # strafe: sidestep toward the mech's left (L) or right (R)
            sg = 1 if kind == 'L' else -1
            for s, ph in (('L', 0.0), ('R', math.pi)):
                q = p2 + ph
                lift_ = max(0.0, math.sin(q))
                ab = 9 * math.sin(p2 + (0 if s == 'L' else math.pi)) * sg
                pose[f'UpperLeg_{s}'] = (10 + 22 * lift_, 0, (3 if s == 'L' else -4) + ab)
                pose[f'LowerLeg_{s}'] = (-16 - 40 * lift_, 0, 0)
                pose[f'Foot_{s}'] = (6 + 18 * lift_, 0, -ab)
            pose['Hips'] = (2, 0, 3 * math.sin(2 * p2) * sg)
            pose['Spine'] = (5, -6, -2 * math.sin(2 * p2) * sg)
            pose['lift'] = -0.02 * (0.5 + 0.5 * hit)
        pose['fistR'] = 1
        return pose

    def author(name):
        if name in GAITS:
            dur, kind = GAITS[name]; keys = None; loop = True; fx = None; ground = True
        else:
            c = CLIPS_A[name]; dur, keys, loop, fx, ground = c['dur'], c['keys'], c['loop'], c['fx'], c['ground']
            solved = []; prev_arm = None
            for t, p in keys:
                p = full(p)
                if 'sab' not in p and p.get('saber'):
                    prev_arm = [D2R(x) for b in CHR for x in p.get(b, (0, 0, 0))]
                if 'sab' not in p and p.get('saber'):
                    off_ = ground_off(p, p.get('lift', 0)) if ground else Vector((0, 0, p.get('lift', 0)))
                    g_ = fk(p, off_)['SaberGrip']
                    p['_sab'] = (g_.translation - off_, g_.to_3x3().col[1].normalized())
                if 'sab' in p:
                    p['_sab'] = (Vector(p['sab'][0]), Vector(p['sab'][1]).normalized())
                    p, err = solve_saber(p, ground, prev_arm)   # continuous with the previous key
                    prev_arm = [D2R(x) for b in CHR for x in p[b]]
                    if err[0] > 0.03 or err[1] > 8:
                        print(f"  sab {name} t={t}: miss {err[0] * 100:.1f} cm / {err[1]:.0f} deg")
                solved.append((t, p))
            keys = solved
        n = max(2, round(dur * 30))
        act = bpy.data.actions.new(name); act.use_fake_user = True
        curves = {}
        prev = {}
        arm_prev = None
        for f in range(n + 1):
            t = min(dur, f / 30.0); u = t / dur
            if keys is None:
                pose = full(gait(kind, u))
            else:
                k = max(i for i, (tk, _) in enumerate(keys) if tk <= t + 1e-9) if t >= keys[0][0] else 0
                if k >= len(keys) - 1:
                    pose = dict(keys[-1][1])
                    if '_sab' in pose and arm_prev:
                        pa, da = pose['_sab']; pose['sab'] = (tuple(pa), tuple(da))
                        pose, _ = solve_saber(pose, ground, arm_prev, restarts=0, cw=25.0)
                        pose.pop('sab', None)
                else:
                    (t0, A), (t1, B) = keys[k], keys[k + 1]
                    w = (t - t0) / max(1e-6, t1 - t0); w = w * w * (3 - 2 * w)
                    pose = {}
                    for kk in set(A) | set(B):
                        if kk in ('sab', '_sab'): continue
                        a_ = A.get(kk, (0, 0, 0) if kk not in ('fistR', 'blade', 'saber', 'gun', 'lift') else full({})[kk])
                        b_ = B.get(kk, (0, 0, 0) if kk not in ('fistR', 'blade', 'saber', 'gun', 'lift') else full({})[kk])
                        if kk in ('saber', 'gun'): pose[kk] = max(a_, b_) if (a_ and b_) or w < 0.5 else b_
                        elif isinstance(a_, tuple): pose[kk] = tuple(x + (y - x) * w for x, y in zip(a_, b_))
                        else: pose[kk] = a_ + (b_ - a_) * w
                    if '_sab' in A and '_sab' in B:
                        pa, da = A['_sab']; pb, db = B['_sab']
                        dd = (da * (1 - w) + db * w)
                        if dd.length < 1e-3: dd = db
                        pose['sab'] = (tuple(pa.lerp(pb, w)), tuple(dd.normalized()))
                        pose, _ = solve_saber(pose, ground, arm_prev, restarts=0 if arm_prev else 8, cw=25.0)
                        pose.pop('sab', None)
                if fx: fx(u, pose)
                if pose.get('saber', 0) > 0.5: arm_prev = [D2R(x) for b in CHR for x in pose.get(b, (0, 0, 0))]
            # skirts follow the thighs, left hand holds the shield grip
            for s in 'LR':
                th = pose.get(f'UpperLeg_{s}', (0, 0, 0))
                pose[f'SkirtFront_{s}'] = (max(0.0, th[0]) * 0.8, 0, 0)
                pose[f'SkirtSide_{s}'] = (0.25 * th[0], 0, (1 if s == 'L' else -1) * (3 + max(0.0, abs(th[2]) - 3) * 0.5))
            back = min(pose.get('UpperLeg_L', (0, 0, 0))[0], pose.get('UpperLeg_R', (0, 0, 0))[0])
            pose['SkirtBack'] = (-max(0.0, -back) * 0.5, 0, 0)
            pose['Hand_L'] = GRIP_WRIST
            fr = pose.get('fistR', 0.4)
            for fb, angs in FIST.items():
                for kk, a in enumerate(angs):
                    pose[f'{fb}{kk + 1}_L'] = (a, 0, 0)
                    pose[f'{fb}{kk + 1}_R'] = (RELAX[fb][kk] + (a - RELAX[fb][kk]) * fr, 0, 0)
            hip = Vector(pose.get('hips', (0, 0, 0)))
            off = (ground_off(pose, pose.get('lift', 0)) if (keys is None or ground) else Vector((0, 0, pose.get('lift', 0)))) + hip
            W = fk(pose, off)
            held = pose.get('saber', 0) > 0.5
            if held:
                W['Saber'] = W['SaberGrip'].copy(); W['SaberBlade'] = W['Saber'] @ REL['SaberBlade']
            for b in ORDER:
                nm = b.name
                par = W[b.parent.name] if b.parent else Matrix.Identity(4)
                basis = (par @ REL[nm]).inverted() @ W[nm]
                loc = basis.translation; e = basis.to_euler('XYZ', prev.get(nm, Euler())); prev[nm] = e
                sc = (1, 1, 1)
                if nm == 'SaberBlade': sc = (max(BLADE_OFF, pose.get('blade', 0) if held else 0),) * 3
                if nm == 'Gun': sc = (1.0 if pose.get('gun', 0) > 0.5 else 0.001,) * 3
                if nm == 'Saber' and not held: loc, e = Vector(), Euler()
                for path, vals in (('location', loc), ('rotation_euler', e), ('scale', sc)):
                    for kk in range(3):
                        curves.setdefault((nm, path, kk), []).append((f + 1, vals[kk]))
        for (nm, path, kk), pts in curves.items():
            fc = act.fcurves.new(f'pose.bones["{nm}"].{path}', index=kk, action_group=nm)
            fc.keyframe_points.add(len(pts))
            fc.keyframe_points.foreach_set('co', [c for pt in pts for c in pt])
            for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
        act.frame_range = (1, n + 1)
        return act

    GAME_ORDER = [a['name'] for a in GJ['animations']]
    OURS = {'Idle': 'Idle', 'Saber_Draw': 'SaberDraw', 'Saber_Idle': 'SaberIdle', 'Saber_Sheathe': 'SaberSheathe'}
    by_name = {a.name: a for a in acts}
    final = []
    for nm in GAME_ORDER:
        if nm in OURS:
            a = by_name[OURS[nm]]; a.name = nm; final.append(a)
        else:
            final.append(author(nm)); print("AUTHORED", nm)
    by_name['Walk'].name = 'Walk'; final.append(by_name['Walk'])
    by_name['SaberWalk'].name = 'Saber_Walk'; final.append(by_name['SaberWalk'])
    acts = final

for a in acts:  # push to NLA so both export as separate clips
    tr = rig.animation_data.nla_tracks.new(); tr.name = a.name
    tr.strips.new(a.name, 1, a)
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0)
scene.frame_set(1)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'mech_rigged.blend'))

# --- 8. Export
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True); body.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'mech_rigged.glb'), export_format='GLB',
    use_selection=True, export_yup=True, export_skins=True,
    export_animations=True, export_animation_mode='NLA_TRACKS',
    export_anim_single_armature=True, export_force_sampling=True,
    export_def_bones=False, export_image_format='AUTO')
bpy.ops.export_scene.fbx(
    filepath=os.path.join(OUT, 'mech_rigged.fbx'), use_selection=True,
    add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True,
    bake_anim_use_nla_strips=False, path_mode='COPY', embed_textures=True,
    armature_nodetype='NULL')
print("BONES", len(arm_data.bones), "VERTS", len(body.data.vertices), "MATS", len(body.data.materials))
