"""Author the body animation set for the rigged character (model_v2_rigged.blend).

Legs are solved with analytic two-bone IK against planted foot targets, so feet do not slide:
stance feet move backwards at exactly the clip's travel speed, which a controller matches (see SPEEDS).
Upper body uses world-space targets with phase lag (overlap) and a stabilised head.

Clips (in place): Idle, Walk, Run, SitDown, SitIdle, StandUp, Wave, Jump  + face clips Blink, Talk, JawOpen, JawClose
usage: python3 add_locomotion.py model_v2_rigged.blend out_dir         (needs: pip install bpy numpy)
"""
import sys, os, math, json
import bpy
from mathutils import Vector, Quaternion

SRC, OUT = sys.argv[1], sys.argv[2]
NAME = sys.argv[3] if len(sys.argv) > 3 else 'model_v2_motion'
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
rig = bpy.data.objects['Armature']
FPS = 30; bpy.context.scene.render.fps = FPS
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
for pb in rig.pose.bones: pb.rotation_mode = 'QUATERNION'

BONES = rig.data.bones
HEAD = {b.name: b.head_local.copy() for b in BONES}
TAIL = {b.name: b.tail_local.copy() for b in BONES}
RM = {b.name: b.matrix_local.to_3x3() for b in BONES}
PAR = {b.name: (b.parent.name if b.parent else None) for b in BONES}
def depth(n): return 0 if PAR[n] is None else 1 + depth(PAR[n])
ORDER = sorted(HEAD, key=depth)
BODY = ['root', 'hips', 'spine', 'chest', 'neck', 'Bone001'] + [p + s for s in 'LR' for p in ('clavicle', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe')]
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
I = Quaternion()
def R(ax, deg): return Quaternion(ax, math.radians(deg))
def lerp(a, b, t): return a + (b - a) * t
def ss(t): t = min(1, max(0, t)); return t * t * (3 - 2 * t)
SG = {'L': 1, 'R': -1}                     # L is +X
L1 = {s: (HEAD['shin' + s] - HEAD['thigh' + s]).length for s in 'LR'}
L2 = {s: (HEAD['foot' + s] - HEAD['shin' + s]).length for s in 'LR'}
ANK = {s: HEAD['foot' + s].copy() for s in 'LR'}                       # ankle, foot flat on the floor
TOE_V = {s: HEAD['toe' + s] - HEAD['foot' + s] for s in 'LR'}          # ankle -> toe joint
print('leg lengths', L1, L2)

# ------------------------------------------------------------------------------------------ pose solver
def solve(P):
    """P: dict with
         root, hips : Vector world offsets
         W          : {bone: world-axis rotation}  (unspecified bones inherit the parent's rotation)
         feet       : {side: (ankle_target Vector, foot_pitch_deg, toe_bend_deg)}
       returns {bone: (relative quaternion, local location or None)}"""
    W = dict(P.get('W', {}))
    root_off, hips_off = P.get('root', Vector()), P.get('hips', Vector())
    Qh = W.get('hips', I)
    hips_head = HEAD['hips'] + root_off + hips_off
    for s, (tgt, pitch, toe) in P.get('feet', {}).items():
        hip = hips_head + Qh @ (HEAD['thigh' + s] - HEAD['hips'])
        a, b = L1[s], L2[s]
        d_vec = tgt - hip; d = min(max(d_vec.length, 0.35 * (a + b)), 0.9995 * (a + b)); u = d_vec.normalized()
        pole = (Vector((0.18 * SG[s], -1, 0)) + Vector()).normalized()     # knees forward, a touch outward
        v = (pole - u * pole.dot(u)).normalized()
        ca = (a * a - b * b + d * d) / (2 * d); h = math.sqrt(max(a * a - ca * ca, 0))
        knee = hip + u * ca + v * h; ank = hip + u * d
        W['thigh' + s] = (HEAD['shin' + s] - HEAD['thigh' + s]).rotation_difference(knee - hip)
        W['shin' + s] = (HEAD['foot' + s] - HEAD['shin' + s]).rotation_difference(ank - knee)
        W['foot' + s] = R(X, pitch)
        W['toe' + s] = R(X, pitch - toe)
    out, Wf = {}, {}
    for n in ORDER:
        qp = Wf.get(PAR[n], I) if PAR[n] else I
        qw = W.get(n, qp); Wf[n] = qw
        rel = qp.inverted() @ qw
        loc = None
        if n == 'root': loc = RM[n].inverted() @ root_off
        if n == 'hips': loc = RM[n].inverted() @ (qp.inverted() @ hips_off)
        out[n] = (RM[n].inverted() @ rel.to_matrix() @ RM[n]).to_quaternion(), loc
    return out

def upper(P, lean=0.0, yaw=0.0, roll=0.0, chest_lag_yaw=0.0, breath=0.0, look_yaw=0.0, look_pitch=0.0, look_roll=0.0, stab=0.85):
    """spine / chest / neck / head world rotations layered on top of the hips"""
    Qh = P['W'].get('hips', I)
    sp = Qh @ R(Z, -yaw * 0.45) @ R(X, lean * 0.5) @ R(Y, -roll * 0.5)
    ch = sp @ R(Z, -yaw * 0.55 + chest_lag_yaw) @ R(X, lean * 0.5 + breath * 1.2) @ R(Y, -roll * 0.4)
    head_free = ch @ R(X, -breath * 0.6)
    head_world = R(Z, look_yaw) @ R(X, look_pitch) @ R(Y, look_roll)            # stabilised gaze
    hd = head_free.slerp(head_world, stab)
    P['W'].update({'spine': sp, 'chest': ch, 'neck': ch.slerp(hd, 0.5), 'Bone001': hd})
    return ch

def arm(P, s, chest, down=74.0, swing=0.0, bend=14.0, twist=0.0, clav=12.0, wrist=6.0, lift_fwd=0.0):
    """down: degrees below T-pose; swing: + = backwards; bend: elbow flexion (hand forward); twist about the arm"""
    g = SG[s]
    cl = chest @ R(Y, g * clav)
    up = chest @ R(X, swing) @ R(Z, g * lift_fwd) @ R(Y, g * down) @ R(X, twist * g)
    fo = up @ R(Z, -g * bend)
    P['W'].update({'clavicle' + s: cl, 'upperarm' + s: up, 'forearm' + s: fo, 'hand' + s: fo @ R(Z, -g * wrist)})
    return up, fo

def planted(s, dx=0.0, dy=0.0, dz=0.0, pitch=0.0, toe=0.0):
    return (ANK[s] + Vector((dx, dy, dz)), pitch, toe)

# ------------------------------------------------------------------------------------------ keying
def key(sol, frame):
    for n in BODY:
        q, loc = sol[n]; pb = rig.pose.bones[n]
        prev = LASTQ.get(n)
        if prev is not None and prev.dot(q) < 0: q = -q                      # keep quaternion signs continuous
        LASTQ[n] = q
        pb.rotation_quaternion = q; pb.keyframe_insert('rotation_quaternion', frame=frame)
        if loc is not None: pb.location = loc; pb.keyframe_insert('location', frame=frame)
LASTQ = {}
def clip(name, nframes, fn, loop):
    for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
    act = bpy.data.actions.new(name); act.use_fake_user = True; rig.animation_data_create(); rig.animation_data.action = act
    LASTQ.clear()
    for f in range(nframes + 1):
        t = (f % nframes) / nframes if loop else f / FPS                     # loops end exactly on frame 0's pose
        key(solve(fn(t)), f + 1)

STRAIGHT = 0.9965
# ------------------------------------------------------------------------------------------ gait
def gait(ph, T, D, beta, lift, heel, lean, bob, drop, sway, yaw, roll, arm_sw, elbow, elbow_fwd, run=False):
    global STRAIGHT
    STRAIGHT = 0.985 if run else 0.9965
    P = {'W': {}, 'feet': {}}
    # pelvis
    zb = 0.0
    zb_extra = (bob * math.cos(4 * math.pi * (ph - beta / 2)) - drop) if run else -drop    # run: extra lift in flight
    xs = sway * math.cos(2 * math.pi * (ph - beta / 2))
    P['hips'] = Vector((xs, 0, zb))
    yw = -yaw * math.cos(2 * math.pi * ph); rl = -roll * math.cos(2 * math.pi * (ph - beta / 2))
    P['W']['hips'] = R(Z, yw) @ R(Y, rl) @ R(X, lean * 0.3)
    # feet
    for s, off in (('L', 0.0), ('R', 0.5)):
        p = (ph + off) % 1.0; span = D * beta
        if p < beta:                                                          # stance: planted, travels back at D/T
            q = p / beta; f = span * (0.5 - q); z = 0.0
            pitch = -9 * (1 - ss(q / 0.14)) if q < 0.14 else heel * ss((q - 0.7) / 0.3)
        else:                                                                 # swing
            q = (p - beta) / (1 - beta); e = 0.5 - 0.5 * math.cos(math.pi * q)
            f = span * (-0.5 + e); z = lift * math.sin(math.pi * q) ** (0.8 if run else 1.0)
            if run: f -= 0.05 * math.sin(math.pi * min(1, q * 1.6)) * (1 - q)     # heel kick
            pitch = heel * (1 - ss(q / 0.35)) - 9 * ss((q - 0.6) / 0.4)
        tgt = ANK[s] + Vector((0, -f, z))
        if pitch > 0:                                                         # heel lift pivots about the toe joint
            toe_pt = ANK[s] + Vector((0, -f, z)) + TOE_V[s]
            tgt = toe_pt - (R(X, pitch) @ TOE_V[s])
        P['feet'][s] = (tgt, pitch, pitch if pitch > 0 else 0.0)
    # hips ride on the legs: as high as the planted legs allow at a small knee bend (smooth-min over both feet)
    hip0 = HEAD['hips'].z
    reach = []
    for s in 'LR':
        tgt = P['feet'][s][0]; hipj = HEAD['thigh' + s]
        dxy = math.hypot(tgt.y - hipj.y, (tgt.x - hipj.x) - 0.0)
        Lr = (L1[s] + L2[s]) * STRAIGHT
        reach.append(tgt.z + math.sqrt(max(Lr * Lr - dxy * dxy, 1e-6)) + (hip0 - hipj.z))
    k = 400.0
    zmax = -math.log(sum(math.exp(-k * r) for r in reach)) / k                 # smooth min
    P['hips'].z = zmax - hip0 + zb_extra
    ch = upper(P, lean=lean, yaw=yw, roll=rl, chest_lag_yaw=-yaw * 0.4 * math.cos(2 * math.pi * (ph - 0.08)),
               breath=0.0, look_pitch=lean * 0.25 + (1.5 if run else 0.8) * math.cos(4 * math.pi * (ph - 0.1)), stab=0.8)
    for s, off in (('L', 0.0), ('R', 0.5)):
        c = math.cos(2 * math.pi * (ph + off - 0.07))                          # arm lags the opposite leg a little
        c2 = math.cos(2 * math.pi * (ph + off - 0.16))                         # elbow lags the shoulder
        arm(P, s, ch, down=74 if not run else 64, swing=arm_sw * c, bend=elbow + elbow_fwd * max(0, -c2), twist=-6 if run else 0)
    return P

WALK = dict(T=0.80, D=0.36, beta=0.60, lift=0.040, heel=16, lean=1.5, bob=0.0, drop=0.0015, sway=0.014, yaw=6, roll=3, arm_sw=16, elbow=12, elbow_fwd=14)
RUN = dict(T=0.46, D=0.66, beta=0.34, lift=0.09, heel=22, lean=7, bob=0.014, drop=0.004, sway=0.010, yaw=10, roll=3, arm_sw=38, elbow=72, elbow_fwd=20, run=True)
SPEEDS = {'Walk': WALK['D'] / WALK['T'], 'Run': RUN['D'] / RUN['T']}

# ------------------------------------------------------------------------------------------ standing / idle
def stand(t=0.0, shift=0.0, breath=0.0, look=(0, 0, 0), knees=0.0012, arms_=None):
    P = {'W': {}, 'feet': {}, 'hips': Vector((shift * 0.012, 0, -knees - 0.0006 * (1 + breath)))}
    P['W']['hips'] = R(Y, -shift * 2.5) @ R(Z, shift * 2)
    for s in 'LR': P['feet'][s] = planted(s)
    ch = upper(P, lean=-1.0, roll=-shift * 2.5, breath=breath, look_yaw=look[0], look_pitch=look[1], look_roll=look[2], stab=0.9)
    for s in 'LR':
        a = (arms_ or {}).get(s, {})
        arm(P, s, ch, **{**dict(down=75 + breath * 1.5, swing=-2 + 2 * shift * SG[s], bend=16 + breath * 2), **a})
    return P

def idle(ph):
    w = 2 * math.pi * ph
    shift = 0.8 * math.sin(w) ** 3                                           # settles onto one foot, then the other
    look = (14 * math.sin(w + 0.6) * ss(abs(math.sin(w + 0.6)) * 1.4), -3 + 3 * math.sin(2 * w), 3 * math.sin(w + 1.2))
    return stand(shift=shift, breath=math.sin(3 * w), look=look)

# ------------------------------------------------------------------------------------------ sit on the floor
def crouch(k=1.0):
    P = {'W': {}, 'feet': {}, 'hips': Vector((0, 0.035 * k, -0.15 * k))}
    P['W']['hips'] = R(X, 18 * k)
    for s in 'LR': P['feet'][s] = planted(s)
    ch = upper(P, lean=26 * k, look_pitch=-6 * k, stab=0.5)
    for s in 'LR': arm(P, s, ch, down=74 - 16 * k, swing=-28 * k, bend=22 + 20 * k)
    return P
def seated(breath=0.0, look=0.0):
    P = {'W': {}, 'feet': {}, 'hips': Vector((0, 0.045, -0.272))}
    P['W']['hips'] = R(X, -8)
    for s in 'LR': P['feet'][s] = (ANK[s] + Vector((SG[s] * 0.035, -0.235, -0.02)), -22, 0)
    ch = upper(P, lean=14 + breath, breath=breath, look_yaw=look, look_pitch=-8, stab=0.8)
    for s in 'LR': arm(P, s, ch, down=66, swing=-34, bend=58, twist=-10)
    return P
def blend(A, B, t):
    """blend two solved poses (quaternion slerp per bone, lerp locations)"""
    sa, sb = solve(A), solve(B); out = {}
    for n in sa:
        qa, la = sa[n]; qb, lb = sb[n]
        if qa.dot(qb) < 0: qb = -qb
        loc = None if la is None else la.lerp(lb, t)
        out[n] = (qa.slerp(qb, t), loc)
    return out
def sitdown(t):
    u = t / 1.2
    if u < 0.5: return ('BLEND', stand(), crouch(), ss(u / 0.5))
    return ('BLEND', crouch(), seated(), ss((u - 0.5) / 0.5))

# ------------------------------------------------------------------------------------------ wave
def wave(t):
    r = ss(t / 0.35) * (1 - ss((t - 1.95) / 0.35))
    wag = math.sin((t - 0.35) * 2 * math.pi * 2.4) * 22 * r
    P = stand(breath=math.sin(t * 4), look=(6 * r, 4 * r, 8 * r), knees=0.0012 + 0.002 * abs(math.sin(t * 5)) * r)
    ch = P['W']['chest']
    up, fo = arm(P, 'R', ch, down=75 * (1 - r) - 5 * r, swing=-22 * r, bend=16 * (1 - r), clav=12 - 14 * r)
    fo = up @ R(Y, 82 * r + wag) @ R(Z, 14 * r)                           # forearm up, hand wags from the elbow
    P['W']['forearmR'] = fo; P['W']['handR'] = fo @ R(Y, wag * 0.4)
    return P

# ------------------------------------------------------------------------------------------ jump (toddler hop)
def jump(t):
    H = 0.11; t0, t1 = 0.30, 0.62                                             # take-off, landing
    if t < t0:                                                                # anticipation
        k = ss(t / 0.26); P = crouch(0.7 * k)
        for s in 'LR': arm(P, s, P['W']['chest'], down=58, swing=40 * k, bend=20)
        return P
    if t < t1:                                                                # airborne
        q = (t - t0) / (t1 - t0); zr = 4 * H * q * (1 - q)
        P = {'W': {}, 'feet': {}, 'root': Vector((0, 0, zr)), 'hips': Vector((0, 0, -0.02))}
        P['W']['hips'] = R(X, 4)
        tuck = 0.05 * math.sin(math.pi * q)
        for s in 'LR': P['feet'][s] = (ANK[s] + Vector((0, 0.0, zr + tuck)), 12 * math.sin(math.pi * q), 0)
        ch = upper(P, lean=4, look_pitch=6 * math.sin(math.pi * q), stab=0.6)
        for s in 'LR': arm(P, s, ch, down=lerp(20, 45, q), swing=-45 + 25 * q, bend=25)
        return P
    k = 1 - ss((t - t1) / 0.36); P = crouch(0.75 * k)                         # land, absorb, recover
    for s in 'LR': arm(P, s, P['W']['chest'], down=lerp(75, 45, k), swing=-15 * k, bend=16 + 14 * k)
    return P

# ------------------------------------------------------------------------------------------ build clips
def clip_any(name, nframes, fn, loop=False):
    for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
    act = bpy.data.actions.new(name); act.use_fake_user = True; rig.animation_data_create(); rig.animation_data.action = act
    LASTQ.clear()
    for f in range(nframes + 1):
        t = (f % nframes) / nframes if loop else f / FPS
        P = fn(t)
        sol = blend(P[1], P[2], P[3]) if isinstance(P, tuple) else solve(P)
        key(sol, f + 1)

for n in [a.name for a in bpy.data.actions]: bpy.data.actions.remove(bpy.data.actions[n])
clip_any('Idle', 150, idle, loop=True)
clip_any('Walk', round(WALK['T'] * FPS), lambda ph: gait(ph, **WALK), loop=True)
clip_any('Run', round(RUN['T'] * FPS), lambda ph: gait(ph, **RUN), loop=True)
clip_any('SitDown', 36, sitdown)
clip_any('SitIdle', 150, lambda ph: seated(breath=math.sin(2 * math.pi * ph * 2), look=12 * math.sin(2 * math.pi * ph)), loop=True)
clip_any('StandUp', 36, lambda t: sitdown(1.2 - t))
clip_any('Wave', 69, wave)
clip_any('Jump', 30, jump)

# ---- face clips ------------------------------------------------------------------------------------------
def face_clip(name, tracks):
    for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
    act = bpy.data.actions.new(name); act.use_fake_user = True; rig.animation_data.action = act
    for bone, keys in tracks.items():
        for t, deg in keys:
            pb = rig.pose.bones[bone]; pb.rotation_quaternion = (RM[bone].inverted() @ R(X, deg).to_matrix() @ RM[bone]).to_quaternion()
            pb.keyframe_insert('rotation_quaternion', frame=int(round(t * FPS)) + 1)
BL, LOW, JO, JC = 93, 93, 12, -14
lid = {}
for sd in 'RL':
    lid['upperlid' + sd] = [(0, 0), (.06, BL), (.11, BL), (.22, 0)]; lid['lowerlid' + sd] = [(0, 0), (.06, -LOW), (.11, -LOW), (.22, 0)]
face_clip('Blink', lid)
face_clip('JawOpen', {'jaw': [(0, 0), (.25, JO), (.5, 0)]})
face_clip('JawClose', {'jaw': [(0, 0), (.25, JC), (.5, 0)]})
face_clip('Talk', {'jaw': [(0, 0), (.15, JO * .75), (.3, JC * .6), (.45, JO * .6), (.6, 0)]})

# ---- all keys linear (cubic-spline tangents overshoot badly on fast clips once exported to glTF) -----
for act in bpy.data.actions:
    fcs = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags: fcs += list(bag.fcurves)
    if not fcs and hasattr(act, 'fcurves'): fcs = list(act.fcurves)
    for fc in fcs:
        for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'

# ---- export -------------------------------------------------------------------------------------------------
for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
rig.animation_data.action = None
bpy.ops.object.mode_set(mode='OBJECT')
json.dump({k: round(v, 4) for k, v in SPEEDS.items()}, open(os.path.join(OUT, 'locomotion_speeds.json'), 'w'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, NAME + '.glb'), export_format='GLB', use_selection=True,
                          export_animation_mode='ACTIONS', export_apply=False, export_skins=True, export_yup=True,
                          export_force_sampling=False, export_image_format='JPEG', export_jpeg_quality=90)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, NAME + '.fbx'), use_selection=True, path_mode='COPY', embed_textures=True,
                         add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + '.blend'))
print('done', [a.name for a in bpy.data.actions], 'speeds', SPEEDS)
