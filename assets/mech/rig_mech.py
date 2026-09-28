"""Rig mech-build-01.fbx as a two-legged humanoid and export for PlayCanvas.

Run with Blender's Python (bpy 4.2):  python rig_mech.py <src.fbx> <out_dir>

The mech is built from separate hard-surface parts, so each part is bound
100% to a single bone (no deformation), then all parts are joined into one
skinned mesh to keep draw calls down (one per material).
"""
import sys, os, math
import bpy, mathutils
from mathutils import Vector

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
    'SkirtFront_L': ['Object015'], 'SkirtFront_R': ['Object007'],
    'SkirtSide_L':  ['Object014'], 'SkirtSide_R':  ['Object013'],
    'SkirtBack':    ['Object009'],
    'UpperArm_L': ['Object017', 'Object003'],
    'ForeArm_L':  ['tripo_node_6aea384b.001', 'tripo_node_6aea384b002', 'tripo_node_6aea384b'],
    'Hand_L':     ['tripo_node_9dcdae07'],
    'UpperArm_R': ['Object023', 'Object020'],
    'ForeArm_R':  ['tripo_node_6aea384b007', 'tripo_node_6aea384b010', 'tripo_node_6aea384b006'],
    'Hand_R':     ['tripo_node_9dcdae010'],
    'UpperLeg_L': ['Object025'],
    'LowerLeg_L': ['tripo_node_3c441de2', 'Object024'],
    'Foot_L':     ['tripo_node_a834b1bb'],
    'UpperLeg_R': ['Object027'],
    'LowerLeg_R': ['tripo_node_3c441de004', 'Object026'],
    'Foot_R':     ['tripo_node_a834b1bb001'],
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
armx = {'L': centroid('tripo_node_9dcdae07').x + 0.01, 'R': centroid('tripo_node_9dcdae010').x - 0.01}
legx = {'L': (centroid('Object025').x + centroid('Object024').x) / 2,
        'R': (centroid('Object027').x + centroid('Object026').x) / 2}
skf = {'L': centroid('Object015'), 'R': centroid('Object007')}
sks = {'L': centroid('Object014'), 'R': centroid('Object013')}
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
    sgn = -1 if s == 'L' else 1
    B[f'Shoulder_{s}'] = ((cx + sgn * 0.15, 0.47, 2.10), (ax, 0.49, 2.10), 'Spine')
    B[f'UpperArm_{s}'] = ((ax, 0.49, 2.10), (ax, 0.485, 1.88), f'Shoulder_{s}')
    B[f'ForeArm_{s}']  = ((ax, 0.485, 1.88), (ax, 0.40, 1.44), f'UpperArm_{s}')
    B[f'Hand_{s}']     = ((ax, 0.40, 1.44), (ax, 0.34, 1.12), f'ForeArm_{s}')
    B[f'UpperLeg_{s}'] = ((lx, Y, 1.35), (lx, Y, 0.95), 'Hips')
    B[f'LowerLeg_{s}'] = ((lx, Y, 0.95), (lx, 0.43, 0.30), f'UpperLeg_{s}')
    B[f'Foot_{s}']     = ((lx, 0.43, 0.30), (lx, 0.0, 0.08), f'LowerLeg_{s}')
    B[f'SkirtFront_{s}'] = ((skf[s].x, 0.30, 1.55), (skf[s].x, 0.24, 1.25), 'Hips')
    B[f'SkirtSide_{s}']  = ((sks[s].x, 0.49, 1.60), (sks[s].x + sgn * 0.06, 0.49, 1.15), 'Hips')

arm_data = bpy.data.armatures.new('MechSkeleton')
rig = bpy.data.objects.new('MechRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, (h, t, _) in B.items():
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = Vector(h), Vector(t)
    eb.align_roll(Vector((0, -1, 0)))  # local Z faces forward on every bone
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

# --- 6. Rigid skinning: every vertex of a part -> its bone at weight 1.0
for o in meshes:
    # join() merges UV maps by name; parts use 4 different names, so unify them
    assert len(o.data.uv_layers) == 1, (o.name, len(o.data.uv_layers))
    o.data.uv_layers[0].name = 'UVMap'
    vg = o.vertex_groups.new(name=part_bone[o.name])
    vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')

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
    P['Head'].rotation_euler.x = rad(1.5 * math.sin(p - 0.6))      # nod trails the chest
    P['Head'].rotation_euler.y = rad(6 * math.sin(p))
    for s, sg in (('L', 1), ('R', -1)):
        P[f'Shoulder_{s}'].rotation_euler.z = rad(sg * -1.2 * br)  # shoulders lift on the breath
        P[f'UpperArm_{s}'].rotation_euler.x = rad(3 + 2 * math.sin(p))
        P[f'UpperArm_{s}'].rotation_euler.z = rad(sg * -3)
        P[f'ForeArm_{s}'].rotation_euler.x = rad(10 + 4 * math.sin(p - 0.4))
        P[f'Hand_{s}'].rotation_euler.x = rad(3 * math.sin(p - 0.9))
        P[f'Hand_{s}'].rotation_euler.y = rad(sg * 2 * math.sin(p - 0.5))
        P[f'SkirtFront_{s}'].rotation_euler.x = rad(1.2 * math.sin(p - 0.5))
        P[f'SkirtSide_{s}'].rotation_euler.z = rad(-sg * (1 + 0.8 * math.sin(p - 0.5)))
    P['SkirtBack'].rotation_euler.x = rad(-1.2 * math.sin(p - 0.5))

def walk(p):
    hit = math.cos(2 * p)                  # +1 at each foot strike (p = 0, pi)
    P['Hips'].location.y = -0.035 * (0.5 + 0.5 * hit)              # dip on each step
    P['Hips'].rotation_euler.x = rad(1.0 * hit)
    P['Hips'].rotation_euler.y = rad(2 * math.sin(p))              # hip twist
    P['Hips'].rotation_euler.z = rad(0.8 * math.cos(p))            # hip sway
    P['Spine'].rotation_euler.x = rad(4 + 1.5 * math.cos(2 * p - 0.5))  # lean forward + absorb
    P['Spine'].rotation_euler.y = rad(-3 * math.sin(p))            # counter twist
    P['Spine'].rotation_euler.z = rad(-0.6 * math.cos(p))
    # head bounce: nods after each strike, settles before the next
    P['Head'].rotation_euler.x = rad(-1 + 3 * math.cos(2 * p - 0.9))
    P['Head'].rotation_euler.y = rad(1.5 * math.sin(p))
    P['Head'].rotation_euler.z = rad(0.8 * math.sin(p - 0.4))
    for s, ph, sg in (('L', 0.0, 1), ('R', math.pi, -1)):
        q = p + ph
        thigh = 26 * math.sin(q)
        knee = -(6 + 45 * max(0.0, math.cos(q)) ** 1.5)          # bend while leg swings through
        P[f'UpperLeg_{s}'].rotation_euler.x = rad(thigh)
        P[f'LowerLeg_{s}'].rotation_euler.x = rad(knee)
        P[f'Foot_{s}'].rotation_euler.x = rad(-(thigh + knee) + 8 * math.sin(q))
        arm = -16 * math.sin(q)                                   # opposite to its own leg
        P[f'Shoulder_{s}'].rotation_euler.x = rad(0.25 * arm)     # shoulder rolls with the swing
        P[f'Shoulder_{s}'].rotation_euler.z = rad(sg * 1.5 * math.cos(2 * p - 0.6))  # drops on impact
        P[f'UpperArm_{s}'].rotation_euler.x = rad(arm)
        P[f'UpperArm_{s}'].rotation_euler.z = rad(sg * -2)
        fwd = -math.sin(q - 0.45)                                 # forearm lags the upper arm
        P[f'ForeArm_{s}'].rotation_euler.x = rad(15 + 13 * fwd + 2 * hit)
        P[f'Hand_{s}'].rotation_euler.x = rad(7 * -math.sin(q - 0.9))  # wrist follow-through
        P[f'Hand_{s}'].rotation_euler.y = rad(sg * 4 * math.cos(q))
        P[f'SkirtFront_{s}'].rotation_euler.x = rad(max(0.0, thigh) * 0.8 + 2 * math.cos(2 * p - 0.6))
        P[f'SkirtSide_{s}'].rotation_euler.x = rad(0.25 * thigh)
        P[f'SkirtSide_{s}'].rotation_euler.z = rad(-sg * (3 + 2.5 * (0.5 + 0.5 * math.cos(2 * p - 0.6))))
    P['SkirtBack'].rotation_euler.x = rad(-max(0.0, -26 * math.sin(p), -26 * math.sin(p + math.pi)) * 0.5
                                          - 2 * math.cos(2 * p - 0.6))

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
