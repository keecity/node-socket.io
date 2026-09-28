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
    B[f'Shoulder_{s}'] = ((cx + sgn * 0.15, 0.47, 2.10), (ax, 0.49, 2.10), 'Spine')
    B[f'UpperArm_{s}'] = ((ax, 0.49, 2.10), (ax, 0.485, 1.88), f'Shoulder_{s}')
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
    sh.location = (0.60 + 12.0 * S_SCALE, 0.41, 1.98 - 99.6 * S_SCALE)
    bpy.ops.object.select_all(action='DESELECT'); sh.select_set(True)
    bpy.context.view_layer.objects.active = sh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # the source shield is yawed ~29 deg in plan; turn it parallel to the body's
    # side (face straight out), pivoting on the grip so it stays in the fist
    SHIELD_YAW = 29.1
    pivot = Vector((0.576, 0.37, 1.30))
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
            pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0)
        pose_fn(f / frames * 2 * math.pi)
        for pb in rig.pose.bones:
            pb.keyframe_insert('location', frame=f + 1)
            pb.keyframe_insert('rotation_euler', frame=f + 1)
    act.frame_range = (1, frames + 1)
    return act

P = rig.pose.bones
# Bone-local axes (roll aligned forward): for bones pointing down, +X rotation
# swings the tail forward (-Y); for Hips/Spine/Head (pointing up), +X tips forward too.

FIST = {'Index': (60, 70, 50), 'Middle': (60, 70, 50), 'Ring': (60, 80),
        'Pinky': (60, 70, 50), 'Thumb': (20, 30, 30)}
GRIP_WRIST = (-5.7, -67.0, -0.8)   # solved: fist closes over the shield's grip bar
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
