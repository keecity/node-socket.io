"""Rig model.fbx (baby character with real eyeballs) using Blender's Python API.

usage: python3 rig_model.py model.fbx out_dir
Requires: pip install bpy numpy
Writes: out_dir/model_rigged.glb, model_rigged.fbx, model_rigged.blend
"""
import sys, os
import numpy as np
import bpy
import bmesh
from mathutils import Vector

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# ---- objects ------------------------------------------------------------
objs = [o for o in bpy.data.objects if o.type == 'MESH']
body = max(objs, key=lambda o: len(o.data.vertices))
eyes = sorted([o for o in objs if o is not body], key=lambda o: sum((o.matrix_world @ v.co).x for v in o.data.vertices) / len(o.data.vertices))
eyeR_obj, eyeL_obj = eyes            # character's right eye is at -X
body.name, eyeR_obj.name, eyeL_obj.name = 'Body', 'EyeR', 'EyeL'
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- material (the FBX lost the texture link) ---------------------------
img = bpy.data.images['base_color_texture']
print('texture', img.size[:], img.has_data)
import tempfile
img.filepath_raw = os.path.join(tempfile.mkdtemp(), 'basecolor.png'); img.file_format = 'PNG'
img.save(); img.reload(); img.pack()
mat = objs[0].data.materials[0]
mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    if n.type == 'TEX_IMAGE':
        nt.nodes.remove(n)
bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.9
bsdf.inputs['Metallic'].default_value = 0.0

# ---- helpers: work in glTF space (Y up, +Z forward) ----------------------
def to_gl(v): return np.array([v[0], v[2], -v[1]])
def to_bl(v): return Vector((v[0], -v[2], v[1]))

def world_verts(o): return np.array([to_gl(o.matrix_world @ v.co) for v in o.data.vertices])

VB = world_verts(body)
EC = {'R': world_verts(eyeR_obj).mean(0), 'L': world_verts(eyeL_obj).mean(0)}
print('eye centres', EC)

# islands of the body mesh (skin is the big one, hair/bows are loose pieces)
bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
comp = -np.ones(len(VB), int); nc = 0
for v in bm.verts:
    if comp[v.index] >= 0: continue
    st = [v]; comp[v.index] = nc
    while st:
        a = st.pop()
        for e in a.link_edges:
            w = e.other_vert(a)
            if comp[w.index] < 0: comp[w.index] = nc; st.append(w)
    nc += 1
skin_id = np.argmax(np.bincount(comp))
bm.free()

CX = -0.125                                   # body centre line
FX = (EC['R'][0] + EC['L'][0]) / 2            # face centre line
V3 = lambda x, y, z: np.array([x, y, z], float)

# ---- skeleton definition: name: (parent, head, tail) in glTF space -------
B = {}
def bone(n, p, h, t): B[n] = (p, h, t)
bone('root', None, V3(CX, 0, .05), V3(CX, .05, .05))
bone('hips', 'root', V3(CX, .36, .055), V3(CX, .44, .06))
bone('spine', 'hips', V3(CX, .44, .06), V3(CX, .52, .06))
bone('chest', 'spine', V3(CX, .52, .06), V3(CX, .585, .06))
bone('neck', 'chest', V3(CX, .585, .06), V3(FX, .635, .065))
bone('head', 'neck', V3(FX, .635, .065), V3(FX, .86, .08))
bone('jaw', 'head', V3(FX, .69, .07), V3(FX, .625, .17))
for s in 'RL':
    c = EC[s]
    bone('eye' + s, 'head', c, c + V3(0, 0, .05))
    bone('upperlid' + s, 'head', c, c + V3(0, .035, 0))
    bone('lowerlid' + s, 'head', c, c - V3(0, .035, 0))
AY, AZ = .556, .045
arm = {'R': [-.16, -.21, -.33, -.43, -.50], 'L': [-.09, -.04, .09, .21, .292]}
for s in 'RL':
    x = arm[s]
    bone('clavicle' + s, 'chest', V3(x[0], .565, .055), V3(x[1], AY, AZ))
    bone('upperarm' + s, 'clavicle' + s, V3(x[1], AY, AZ), V3(x[2], AY, AZ))
    bone('forearm' + s, 'upperarm' + s, V3(x[2], AY, AZ), V3(x[3], AY, AZ))
    bone('hand' + s, 'forearm' + s, V3(x[3], AY, AZ), V3(x[4], AY, AZ))
leg = {'R': -.20, 'L': -.05}
for s in 'RL':
    x = leg[s]
    bone('thigh' + s, 'hips', V3(x, .36, .06), V3(x, .19, .065))
    bone('shin' + s, 'thigh' + s, V3(x, .19, .065), V3(x, .055, .05))
    bone('foot' + s, 'shin' + s, V3(x, .055, .05), V3(x, .02, .12))
    bone('toe' + s, 'foot' + s, V3(x, .02, .12), V3(x, .01, .17))
names = list(B)

# ---- armature -----------------------------------------------------------
arm_data = bpy.data.armatures.new('Armature')
rig = bpy.data.objects.new('Armature', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
X = Vector((1, 0, 0))
for n in names:
    p, h, t = B[n]
    eb = arm_data.edit_bones.new(n)
    eb.head, eb.tail = to_bl(h), to_bl(t)
    if p: eb.parent = arm_data.edit_bones[p]
    if n in ('jaw', 'eyeR', 'eyeL') or n.startswith(('upperlid', 'lowerlid')):
        # local X axis = world X, so a rotation about X opens the jaw / closes a lid
        y = (eb.tail - eb.head).normalized()
        eb.align_roll(X.cross(y))
bpy.ops.object.mode_set(mode='OBJECT')

# ---- weights ------------------------------------------------------------
def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t * ab), axis=1)
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

body_bones = [n for n in names if n not in ('root', 'head', 'jaw') and not n.startswith(('eye', 'upperlid', 'lowerlid'))]
W = {}   # vertex index -> {bone: weight}
for i, p in enumerate(VB):
    if comp[i] != skin_id:
        W[i] = {'head': 1.0}; continue
    ws = {}
    for n in body_bones:
        side = 1 if n.endswith('L') else -1 if n.endswith('R') else 0
        if side and n.startswith(('clavicle', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe')):
            if side * (p[0] - CX) < -.03: continue
        ws[n] = 1.0 / (seg_dist(p[None], B[n][1], B[n][2])[0] + .006) ** 4
    tot = sum(ws.values()); ws = {k: v / tot for k, v in ws.items()}
    # jaw bone = the lower lip only (lip edge + the inside of the lower lip), not the chin or cheeks
    J = smooth(.612, .642, p[1]) * (1 - smooth(.658, .667, p[1])) * (1 - smooth(.030, .075, abs(p[0] - FX))) \
        * smooth(.100, .140, p[2])
    if p[1] > .60:
        h = smooth(.605, .645, p[1])
        ws = {k: v * (1 - h) for k, v in ws.items()}
        ws['head'] = ws.get('head', 0) + h
    if J > 0:
        ws = {k: v * (1 - J) for k, v in ws.items()}
        ws['jaw'] = ws.get('jaw', 0) + J
    # eyelids: the lid shell around each eyeball follows the lid bones
    for s in 'RL':
        q = p - EC[s]; d = np.linalg.norm(q)
        f = (1 - smooth(.050, .064, d)) * smooth(-.012, .0, q[2])      # only the front shell
        if f > 0:
            u = smooth(-.004, .012, q[1])                               # upper vs lower half
            ws = {k: v * (1 - f) for k, v in ws.items()}
            ws['upperlid' + s] = ws.get('upperlid' + s, 0) + f * u
            ws['lowerlid' + s] = ws.get('lowerlid' + s, 0) + f * (1 - u)
    W[i] = ws

def apply_weights(obj, weights):
    for n in names:
        if n not in obj.vertex_groups: obj.vertex_groups.new(name=n)
    for i, ws in weights.items():
        tot = sum(ws.values())
        for n, w in sorted(ws.items(), key=lambda kv: -kv[1])[:4]:
            if w / tot > 1e-3: obj.vertex_groups[n].add([i], w / tot, 'REPLACE')

apply_weights(body, W)
apply_weights(eyeR_obj, {i: {'eyeR': 1.0} for i in range(len(eyeR_obj.data.vertices))})
apply_weights(eyeL_obj, {i: {'eyeL': 1.0} for i in range(len(eyeL_obj.data.vertices))})
for o in (body, eyeR_obj, eyeL_obj):
    o.parent = rig
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = rig

# ---- animations ---------------------------------------------------------
rig.animation_data_create()
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'
FPS = 30; bpy.context.scene.render.fps = FPS
def make_action(name, tracks):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data.action = act
    for bn, keys in tracks.items():
        pb = rig.pose.bones[bn]
        for t, deg in keys:
            pb.rotation_euler = (np.radians(deg), 0, 0)
            pb.keyframe_insert('rotation_euler', frame=t * FPS + 1)
    return act
BL = 58
make_action('Blink', {'upperlidR': [(0, 0), (.06, BL), (.11, BL), (.22, 0)], 'upperlidL': [(0, 0), (.06, BL), (.11, BL), (.22, 0)],
                      'lowerlidR': [(0, 0), (.06, -8), (.11, -8), (.22, 0)], 'lowerlidL': [(0, 0), (.06, -8), (.11, -8), (.22, 0)]})
# The mouth is already open in the rest pose and only the lower lip is on the jaw bone, so the jaw is animated
# as a straight vertical move (metres, +down = more open) rather than a swing about a distant hinge, which
# would push the lip back into the teeth.
jaw_pb = rig.pose.bones['jaw']
jaw_rest = jaw_pb.bone.matrix_local.to_3x3()
def make_lip_action(name, keys):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data.action = act
    for t, down in keys:
        jaw_pb.location = jaw_rest.inverted() @ Vector((0, 0, -down))   # rest-space delta for a world-space vertical move
        jaw_pb.keyframe_insert('location', frame=t * FPS + 1)
    return act
make_lip_action('Talk', [(0, 0), (.15, .008), (.3, -.005), (.45, .006), (.6, 0)])
make_lip_action('JawOpen', [(0, 0), (.25, .010), (.5, 0)])
make_lip_action('JawClose', [(0, 0), (.25, -.010), (.5, 0)])
jaw_pb.location = (0, 0, 0)
for pb in rig.pose.bones: pb.rotation_euler = (0, 0, 0)
rig.animation_data.action = None
bpy.ops.object.mode_set(mode='OBJECT')

# ---- export -------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'model_rigged.glb'), export_format='GLB', use_selection=True,
                          export_animation_mode='ACTIONS', export_apply=False, export_skins=True, export_yup=True, export_force_sampling=False, export_image_format='JPEG', export_jpeg_quality=90)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, 'model_rigged.fbx'), use_selection=True, path_mode='COPY', embed_textures=True,
                         add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'model_rigged.blend'))
print('done')
