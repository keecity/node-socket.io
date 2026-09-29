"""Add locomotion clips to model_v2_rigged.blend and re-export.

Clips are in place (no root motion); a controller moves the character.
Idle, Walk, Run, SitDown, SitIdle, StandUp, Wave, Jump  (Blink / Talk / Jaw* from the rig stay untouched)

usage: python3 add_locomotion.py model_v2_rigged.blend out_dir      (needs: pip install bpy numpy)
"""
import sys, os, math
import numpy as np
import bpy
from mathutils import Vector, Quaternion, Matrix

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
rig = bpy.data.objects['Armature']
FPS = 30; bpy.context.scene.render.fps = FPS
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
AX = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}
REST = {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}
for pb in rig.pose.bones: pb.rotation_mode = 'QUATERNION'

def rot(*steps):
    """world-space rotation from a list of (axis, degrees), applied in the order given"""
    q = Quaternion((1, 0, 0, 0))
    for ax, deg in steps:
        if abs(deg) > 1e-6: q = Quaternion(AX[ax], math.radians(deg)) @ q
    return q

def local_quat(bone, qw):          # world-space rotation about the bone's head -> the bone's own rotation channel
    R = REST[bone]; return (R.inverted() @ qw.to_matrix() @ R).to_quaternion()
def local_loc(bone, dw):
    return REST[bone].inverted() @ Vector(dw)

# ---- pose vocabulary ------------------------------------------------------------------
ARM_DOWN = 72
def arms(side, down=ARM_DOWN, swing=0.0, bend=8.0, raise_=0.0, twist=0.0):
    """side 'L' is +x.  swing: degrees about world X, positive = backwards.  bend: elbow flexion (forward)."""
    sgn = 1 if side == 'L' else -1
    up = rot(('y', sgn * down), ('x', swing))
    if raise_: up = rot(('y', -sgn * raise_), ('x', swing))
    fore = rot(('z', -sgn * bend))
    return {'upperarm' + side: up, 'forearm' + side: fore}

def leg(side, thigh=0.0, knee=0.0, foot=None, spread=0.0):
    sgn = 1 if side == 'L' else -1
    f = -(thigh + knee) if foot is None else foot
    return {'thigh' + side: rot(('y', sgn * -spread), ('x', thigh)), 'shin' + side: rot(('x', knee)), 'foot' + side: rot(('x', f))}

def body(hips_z=0.0, hips_x=0.0, hips_yaw=0.0, hips_pitch=0.0, spine_pitch=0.0, spine_twist=0.0, chest_pitch=0.0, head_pitch=0.0, head_yaw=0.0, head_roll=0.0, root_z=0.0):
    d = {'hips': rot(('z', hips_yaw), ('x', hips_pitch)), 'spine': rot(('x', spine_pitch), ('z', spine_twist)), 'chest': rot(('x', chest_pitch)),
         'Bone001': rot(('x', head_pitch), ('z', head_yaw), ('y', head_roll))}
    d['_hips_loc'] = (hips_x, 0, hips_z); d['_root_loc'] = (0, 0, root_z)
    return d

def merge(*ds):
    out = {}
    for d in ds: out.update(d)
    return out

def key_pose(pose, frame):
    for bone, q in pose.items():
        if bone == '_hips_loc':
            pb = rig.pose.bones['hips']; pb.location = local_loc('hips', q); pb.keyframe_insert('location', frame=frame)
        elif bone == '_root_loc':
            pb = rig.pose.bones['root']; pb.location = local_loc('root', q); pb.keyframe_insert('location', frame=frame)
        else:
            pb = rig.pose.bones[bone]; pb.rotation_quaternion = local_quat(bone, q); pb.keyframe_insert('rotation_quaternion', frame=frame)

def new_action(name):
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
    act = bpy.data.actions.new(name); act.use_fake_user = True; rig.animation_data.action = act
    return act

def make_clip(name, nframes, pose_fn, step=1, loop=False):
    """sample pose_fn on whole frames with linear keys.  loop clips get phase 0..1, others get seconds."""
    new_action(name)
    for f in list(range(0, nframes, step)) + [nframes]:
        key_pose(pose_fn(f / nframes if loop else f / FPS), f + 1)

# ---- rest / idle pose used at the start and end of every clip so crossfades are clean ----------------------------
def idle_pose(breath=0.0, sway=0.0, look=0.0):
    return merge(body(chest_pitch=breath * 1.2, head_yaw=look, head_pitch=-breath * .8, hips_x=sway * .006, hips_yaw=sway * 1.5, spine_twist=-sway),
                 arms('L', bend=8 + breath), arms('R', bend=8 + breath), leg('L', spread=2), leg('R', spread=2))

# ---- locomotion cycle -------------------------------------------------------------------------------------------
def gait(phase, A, K, arm, elbow, lean, bob, yaw, spread, run=False):
    p = 2 * math.pi * phase
    out = {}
    for side, off in (('L', 0.0), ('R', math.pi)):
        s = math.sin(p + off); c = math.cos(p + off)
        th = -A * s + (2 if not run else -4)
        knee = K * max(0.0, c) + (6 if not run else 10) * (1 if s < 0 else .3)
        out.update(leg(side, thigh=th, knee=knee, spread=spread))
        out.update(arms(side, swing=arm * s, bend=elbow + (arm * .35 * max(0, -s))))
    out.update(body(hips_z=-bob * (0.5 + 0.5 * math.cos(2 * p)) + (0.02 if run else 0), hips_x=0.01 * math.sin(p), hips_yaw=yaw * math.sin(p), spine_pitch=lean, spine_twist=-yaw * 1.2 * math.sin(p),
                    chest_pitch=lean * .5, head_pitch=-lean * .8 + .8 * math.cos(2 * p), head_yaw=-yaw * .4 * math.sin(p)))
    return out

FR = lambda n: [i / n for i in range(n + 1)]
make_clip('Idle', 120, lambda ph: idle_pose(breath=math.sin(2 * math.pi * ph), sway=0.5 * math.sin(2 * math.pi * ph), look=6 * math.sin(2 * math.pi * ph + 1.0)), step=2, loop=True)
make_clip('Walk', 30, lambda ph: gait(ph, 22, 40, 12, 12, 3, .012, 5, 6), loop=True)
make_clip('Run', 17, lambda ph: gait(ph, 42, 95, 38, 70, 12, .03, 8, 4, run=True), loop=True)

# ---- sitting on the floor: legs out in front, hands in lap -----------------------------------------------------------
def sit_pose(breath=0.0, look=0.0):
    return merge(body(hips_z=-0.285, spine_pitch=-2, chest_pitch=breath * 1.5, head_pitch=-4 - breath, head_yaw=look, hips_pitch=0),
                 leg('L', thigh=-88, knee=14, foot=-12, spread=12), leg('R', thigh=-88, knee=14, foot=-12, spread=12),
                 arms('L', swing=-30, bend=50, down=62), arms('R', swing=-30, bend=50, down=62))
def crouch_pose():
    return merge(body(hips_z=-0.15, spine_pitch=16, chest_pitch=8, head_pitch=-14),
                 leg('L', thigh=-62, knee=100, spread=8), leg('R', thigh=-62, knee=100, spread=8),
                 arms('L', swing=-30, bend=30, down=64), arms('R', swing=-30, bend=30, down=64))
def lerp_pose(a, b, t):
    out = {}
    for k in a:
        if k.startswith('_'): out[k] = tuple(np.array(a[k]) * (1 - t) + np.array(b[k]) * t)
        else: out[k] = a[k].slerp(b[k], t)
    return out
def sitdown(t):
    st, cr, se = idle_pose(), crouch_pose(), sit_pose()
    return lerp_pose(st, cr, t / 0.45) if t < 0.45 else lerp_pose(cr, se, min(1, (t - 0.45) / 0.55))
make_clip('SitDown', 30, sitdown)
make_clip('SitIdle', 120, lambda ph: sit_pose(breath=math.sin(2 * math.pi * ph), look=10 * math.sin(2 * math.pi * ph + .5)), step=2, loop=True)
make_clip('StandUp', 30, lambda t: sitdown(1.0 - t))

# ---- wave ---------------------------------------------------------------------------------------------------------------------
def wave(t):
    base = idle_pose(breath=math.sin(t * 5))
    r = min(1, t / 0.4) if t < 1.9 else max(0, (2.3 - t) / 0.4)          # raise / lower
    wv = math.sin((t - 0.4) * 2 * math.pi * 2.2) * 22 * r                # hand wag
    base['upperarmR'] = rot(('y', -72 * (1 - r) + 25 * r))                # from hanging to out and slightly up
    base['forearmR'] = rot(('y', 70 * r + wv))                           # elbow bent up, hand wags
    base['Bone001'] = rot(('z', 8 * r), ('x', -3 * r))
    return base
make_clip('Wave', 69, wave)

# ---- jump ---------------------------------------------------------------------------------------------------------------------
def jump(t):
    st = idle_pose(); cr = merge(crouch_pose()); air = merge(body(hips_z=0.0, spine_pitch=4, head_pitch=6, root_z=0.30),
        leg('L', thigh=-35, knee=70, spread=6), leg('R', thigh=-20, knee=55, spread=6), arms('L', swing=-40, down=30, bend=15), arms('R', swing=-40, down=30, bend=15))
    if t < .25: return lerp_pose(st, cr, t / .25)
    if t < .30: return lerp_pose(cr, air, (t - .25) / .05)
    if t < .55: return air if False else merge(air, {'_root_loc': (0, 0, 0.30 * math.sin(math.pi * (t - .30) / .25) ** 0.8 + 0.0)})
    if t < .70: return lerp_pose(merge(air, {'_root_loc': (0, 0, 0)}), cr, (t - .55) / .15)
    return lerp_pose(cr, st, (t - .70) / .20)
make_clip('Jump', 27, jump)

# ---- face clips (recreated here: reopening the .blend in Blender 5 drops the old actions from the exporter) ----------------
for n in ('Blink', 'Talk', 'JawOpen', 'JawClose'):
    if n in bpy.data.actions: bpy.data.actions.remove(bpy.data.actions[n])
def face_clip(name, tracks):
    new_action(name)
    for bone, keys in tracks.items():
        for t, deg in keys:
            pb = rig.pose.bones[bone]; pb.rotation_quaternion = local_quat(bone, rot(('x', deg))); pb.keyframe_insert('rotation_quaternion', frame=int(round(t * FPS)) + 1)
BL, LOW, JO, JC = 93, 93, 12, -14
lid = {}
for sd in 'RL':
    lid['upperlid' + sd] = [(0, 0), (.06, BL), (.11, BL), (.22, 0)]; lid['lowerlid' + sd] = [(0, 0), (.06, -LOW), (.11, -LOW), (.22, 0)]
face_clip('Blink', lid)
face_clip('JawOpen', {'jaw': [(0, 0), (.25, JO), (.5, 0)]})
face_clip('JawClose', {'jaw': [(0, 0), (.25, JC), (.5, 0)]})
face_clip('Talk', {'jaw': [(0, 0), (.15, JO * .75), (.3, JC * .6), (.45, JO * .6), (.6, 0)]})
for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)

# ---- finish ------------------------------------------------------------------------------------------------------------------------
for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
rig.animation_data.action = None
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'model_v2_motion.glb'), export_format='GLB', use_selection=True,
                          export_animation_mode='ACTIONS', export_apply=False, export_skins=True, export_yup=True,
                          export_force_sampling=False, export_image_format='JPEG', export_jpeg_quality=90)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, 'model_v2_motion.fbx'), use_selection=True, path_mode='COPY', embed_textures=True,
                         add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'model_v2_motion.blend'))
print('done', [a.name for a in bpy.data.actions])
