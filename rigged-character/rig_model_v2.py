"""Finish the rig on model_v2.fbx.

Keeps the head/jaw bones and their vertex weights exactly as authored (Bone001 = head, jaw), and adds
the body skeleton, eye bones and eyelid bones.  Only body vertices below the chin (z < 0.595) and the
skin ring around each eye get new weights.

usage: python3 rig_model_v2.py model_v2.fbx out_dir      (needs: pip install bpy numpy)
"""
import sys, os, tempfile
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix

SRC, OUT = sys.argv[1], sys.argv[2]
NAME = sys.argv[3] if len(sys.argv) > 3 else 'model_v2_rigged'
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# ---- find the parts ------------------------------------------------------
old_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
body = max(meshes, key=lambda o: len(o.data.vertices))
eye_objs = sorted([o for o in meshes if o is not body], key=lambda o: (o.matrix_world @ Vector(o.bound_box[0])).x)
eyeR_obj, eyeL_obj = eye_objs                     # the character's right eye is the smaller-x one
body.name, eyeR_obj.name, eyeL_obj.name = 'Body', 'EyeR', 'EyeL'

# ---- read the authored bones + weights before touching anything -----------
old_bones = {b.name: (old_arm.matrix_world @ b.head_local, old_arm.matrix_world @ b.tail_local, b.parent.name if b.parent else None)
             for b in old_arm.data.bones}
gname = {g.index: g.name for g in body.vertex_groups}
orig_w = [{gname[g.group]: g.weight for g in v.groups if g.weight > 0} for v in body.data.vertices]

# ---- bake transforms so meshes live in plain world space -------------------
for o in (body, eyeR_obj, eyeL_obj):
    o.modifiers.clear()
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
bpy.data.objects.remove(old_arm)
bpy.ops.object.select_all(action='DESELECT')
for o in (body, eyeR_obj, eyeL_obj): o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- texture (the FBX lost the material link) -----------------------------
img = bpy.data.images['base_color_texture']
img.filepath_raw = os.path.join(tempfile.mkdtemp(), 'basecolor.png'); img.file_format = 'PNG'; img.save(); img.reload(); img.pack()
mat = body.data.materials[0]; mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    if n.type == 'TEX_IMAGE': nt.nodes.remove(n)
bsdf = nt.nodes['Principled BSDF']; tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.9; bsdf.inputs['Metallic'].default_value = 0.0

VB = np.array([v.co[:] for v in body.data.vertices])
EC = {'R': np.array(eyeR_obj.data.vertices[0].co) * 0, 'L': None}
EC = {s: np.mean([v.co[:] for v in o.data.vertices], axis=0) for s, o in (('R', eyeR_obj), ('L', eyeL_obj))}
CX = (EC['R'][0] + EC['L'][0]) / 2                       # face centre line; the authored bones sat at x = 0
print('centre x', CX, 'eyes', EC)

# islands: skin/clothes is the big one, hair/bows are loose pieces and stay on the head
key = np.round(VB, 5); _, winv = np.unique(key, axis=0, return_inverse=True); winv = winv.ravel()
par = list(range(winv.max() + 1))
def find(a):
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
for p in body.data.polygons:
    vs = p.vertices
    for i in vs[1:]: par[find(winv[i])] = find(winv[vs[0]])
lab = np.array([find(i) for i in winv]); big = np.bincount(lab).argmax(); is_big = lab == big
# loose pieces that sit on the body (shoe details etc.) follow the body; hair / bows near the head stay on the head bone
cz = {l: VB[lab == l][:, 2].mean() for l in np.unique(lab)}
is_body = np.array([l == big or cz[l] < 0.5 for l in lab])
print('body islands:', sum(1 for l in cz if l != big and cz[l] < 0.5), 'extra loose pieces')

# ---- skeleton (Blender space: X right, -Y front, Z up) ---------------------
B = {}
def bone(n, p, h, t): B[n] = (p, np.array(h, float), np.array(t, float))
YB = .735
bone('root', None, (CX, YB, 0), (CX, YB, .08))
bone('hips', 'root', (CX, YB, .36), (CX, YB, .43))
bone('spine', 'hips', (CX, YB, .43), (CX, .74, .50))
bone('chest', 'spine', (CX, .74, .50), (CX, .745, .555))
bone('neck', 'chest', (CX, .745, .555), (CX, .736, .634))
# authored bones, shifted onto the character's centre line
shift = np.array([CX, 0, 0])
for n, (h, t, p) in old_bones.items():
    bone(n, 'neck' if p is None else p, np.array(h) + shift, np.array(t) + shift)
for s in 'RL':
    c = EC[s]
    bone('eye' + s, 'Bone001', c, c + (0, -.05, 0))
    bone('upperlid' + s, 'Bone001', c, c + (0, 0, .035))
    bone('lowerlid' + s, 'Bone001', c, c - (0, 0, .035))
AYc, AZc = .762, .546
SHZ = .556                                  # shoulder pivot sits in the upper half of the arm, not on its axis
# measured from the mesh cross-sections; the model's left arm is ~6 cm longer than the right
arms = {'R': [.415, .345, .255, .180, .079], 'L': [.468, .54, .66, .765, .866]}
for s in 'RL':
    x = arms[s]
    bone('clavicle' + s, 'chest', (x[0], .752, .552), (x[1], AYc, SHZ))
    bone('upperarm' + s, 'clavicle' + s, (x[1], AYc, SHZ), (x[2], AYc, AZc))
    bone('forearm' + s, 'upperarm' + s, (x[2], AYc, AZc), (x[3], AYc, AZc))
    bone('hand' + s, 'forearm' + s, (x[3], AYc, AZc), (x[4], AYc, AZc))
legx = {'R': .374, 'L': .508}
# shoe landmarks measured from the sole: heel (back, +Y) and toe tip (front, -Y); toe hinge at the ball (70 % heel -> tip)
SHOE = {}
for s in 'RL':
    side = (VB[:, 0] < CX) if s == 'R' else (VB[:, 0] > CX)
    sole = VB[side & is_body & (VB[:, 2] < 0.03)]
    heel, tip = sole[:, 1].max(), sole[:, 1].min()
    SHOE[s] = dict(heel=heel, tip=tip, ball=heel - 0.70 * (heel - tip))
    print('shoe', s, {k: round(float(v), 3) for k, v in SHOE[s].items()})
for s in 'RL':
    x = legx[s]
    bone('thigh' + s, 'hips', (x, .723, .36), (x, .723, .19))
    bone('shin' + s, 'thigh' + s, (x, .723, .19), (x, .73, .07))
    bone('foot' + s, 'shin' + s, (x, .73, .07), (x, SHOE[s]['ball'], .025))
    bone('toe' + s, 'foot' + s, (x, SHOE[s]['ball'], .025), (x, SHOE[s]['tip'] + .007, .02))
names = list(B)

arm_data = bpy.data.armatures.new('Armature'); rig = bpy.data.objects.new('Armature', arm_data)
bpy.context.scene.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
X = Vector((1, 0, 0))
for n in names:
    p, h, t = B[n]
    eb = arm_data.edit_bones.new(n); eb.head, eb.tail = Vector(h), Vector(t)
    if p: eb.parent = arm_data.edit_bones[p]
for n in names:                                        # local X = world X so rotations about X open/close things
    eb = arm_data.edit_bones[n]; y = (eb.tail - eb.head).normalized(); eb.align_roll(X.cross(y))
bpy.ops.object.mode_set(mode='OBJECT')

# ---- weights ---------------------------------------------------------------
def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(p - (a + t * ab))
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
body_bones = [n for n in names if n in ('hips', 'spine', 'chest', 'neck') or n.startswith(('clavicle', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe'))]
# ---- body weights: Blender bone-heat skinning on a copy of the mesh, body bones + head bone only
tmp = body.copy(); tmp.data = body.data.copy(); tmp.vertex_groups.clear(); bpy.context.scene.collection.objects.link(tmp)
# weld UV-seam splits and drop loose pieces so the heat solver sees one closed-ish surface
bm = bmesh.new(); bm.from_mesh(tmp.data); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not is_big[v.index]], context='VERTS')
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(tmp.data); bm.free()
heat_bones = set(body_bones) | {'Bone001'}
for b in arm_data.bones: b.use_deform = b.name in heat_bones
bpy.ops.object.select_all(action='DESELECT'); tmp.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
hn = {g.index: g.name for g in tmp.vertex_groups}
hw = [{hn[g.group]: g.weight for g in v.groups if g.weight > 1e-4} for v in tmp.data.vertices]
from mathutils.kdtree import KDTree
kd = KDTree(len(tmp.data.vertices))
for v in tmp.data.vertices: kd.insert(v.co, v.index)
kd.balance()
heat = [hw[kd.find(Vector(p))[1]] if is_big[i] else {} for i, p in enumerate(VB)]
bpy.data.objects.remove(tmp); 
for b in arm_data.bones: b.use_deform = True
# verts heat could not reach (loose pieces): copy the nearest weighted vertex on the main surface
ok = np.array([bool(h) and is_big[i] for i, h in enumerate(heat)])
src = np.where(ok)[0]
print('heat: weighted', ok.sum(), 'of', len(heat))
SG_ = {'L': 1, 'R': -1}
new_w = []
for i, p in enumerate(VB):
    w = dict(orig_w[i])
    if is_body[i] and p[2] < 0.595 and 'jaw' not in w:
        h = heat[i] if ok[i] else heat[src[np.argmin(np.linalg.norm(VB[src] - p, axis=1))]]
        tot = sum(h.values()) or 1.0; hh = smooth(.555, .595, p[2])       # hand over to the authored head weights at the chin
        w = {k: v / tot * (1 - hh) for k, v in h.items()}
        w['Bone001'] = w.get('Bone001', 0) + hh
        # shoes are rigid: foot bone, toe box hinged at the ball, shin only above the shoe collar
        if p[2] < 0.105:
            sd = 'L' if p[0] > CX else 'R'
            sw = smooth(0.072, 0.100, p[2])
            b_ = SHOE[sd]['ball']; tw = smooth(b_ + 0.035, b_ - 0.005, p[1]) * (1 - smooth(0.035, 0.06, p[2]))   # front of the shoe, low down
            w = {'shin' + sd: sw, 'foot' + sd: (1 - sw) * (1 - tw), 'toe' + sd: (1 - sw) * tw}
        # shoulders: one wide, smooth chest -> arm blend so the whole sleeve travels with the arm
        for sd in 'LR':
            a = SG_[sd] * (p[0] - B['upperarm' + sd][1][0])                 # distance out along the arm from the pivot
            if a < -0.06 or p[2] < 0.47: continue
            gate = 1.0 if a > 0.01 else smooth(0.50, 0.535, p[2])           # keep the torso side under the armpit on the chest
            wa = smooth(-0.055, 0.045, a) * gate
            if wa <= 0: continue
            chain = {k: v for k, v in w.items() if k[:-1] in ('upperarm', 'forearm', 'hand') and k.endswith(sd)}
            ct = sum(chain.values())
            chain = {k: v / ct for k, v in chain.items()} if ct > 0.05 else {'upperarm' + sd: 1.0}
            if a < 0.045: chain = {'upperarm' + sd: 1.0}                    # the shoulder cap belongs to the upper arm only
            rest = 1 - wa
            w = {'chest': rest * 0.65, 'clavicle' + sd: rest * 0.35}
            for k, v in chain.items(): w[k] = w.get(k, 0) + wa * v
    new_w.append(w)

# ---- eyelid caps: skin-coloured shells that sit inside the socket and swing shut ------------------
uvl = body.data.uv_layers[0]
vuv = {}
for l in body.data.loops: vuv.setdefault(l.vertex_index, uvl.data[l.index].uv[:])
cap_uv = {}
for s_ in 'RL':                                        # a plain skin texel from the cheek under each eye
    target = EC[s_] + np.array([0, -.03, -.04]); cand = np.where(is_big)[0]
    cap_uv[s_] = vuv[cand[np.argmin(np.linalg.norm(VB[cand] - target, axis=1))]]
OPEN_UP, OPEN_LO, RCAP = np.radians(88), np.radians(88), 0.0385
def lid_verts(s_, upper):
    na, nr = 21, 10; out = []; F_ = []
    for ia, a_ in enumerate(np.linspace(-np.radians(68), np.radians(68), na)):
        edge = (OPEN_UP if upper else OPEN_LO) * (0.78 + 0.22 * np.cos(a_ / np.radians(68) * np.pi / 2))
        for t in np.linspace(0, 1, nr):
            phi = edge + t * (np.radians(172) - edge); phi = phi if upper else -phi
            d = np.array([np.sin(a_), -np.cos(a_) * np.cos(phi), np.cos(a_) * np.sin(phi)])   # x, front(-y), up(z)
            out.append(EC[s_] + d * RCAP)
    for i in range(na - 1):
        for j in range(nr - 1):
            a0 = i * nr + j; b0 = a0 + nr
            F_ += [(a0, b0, a0 + 1), (a0 + 1, b0, b0 + 1)] if upper else [(a0, a0 + 1, b0), (a0 + 1, b0 + 1, b0)]
    return out, F_
lids_me = bpy.data.meshes.new('Lids'); LV, LF, LW, LUV = [], [], [], []
for s_ in 'RL':
    for upper in (True, False):
        v_, f_ = lid_verts(s_, upper); n0 = len(LV)
        LV += [tuple(v) for v in v_]; LF += [tuple(i + n0 for i in f) for f in f_]
        LW += [{('upperlid' if upper else 'lowerlid') + s_: 1.0}] * len(v_); LUV += [cap_uv[s_]] * len(v_)
lids_me.from_pydata(LV, [], LF); lids_me.update()
lids_uv = lids_me.uv_layers.new(name='UVMap')
for p_ in lids_me.polygons:
    for li in p_.loop_indices: lids_uv.data[li].uv = LUV[lids_me.loops[li].vertex_index]
lids_me.polygons.foreach_set('use_smooth', [True] * len(lids_me.polygons))
lids_me.materials.append(mat)
lids_obj = bpy.data.objects.new('Lids', lids_me); bpy.context.scene.collection.objects.link(lids_obj)

def apply_weights(obj, weights):
    for vg in list(obj.vertex_groups): obj.vertex_groups.remove(vg)
    for n in names: obj.vertex_groups.new(name=n)
    for i, ws in enumerate(weights):
        tot = sum(ws.values())
        for n, v in sorted(ws.items(), key=lambda kv: -kv[1])[:4]:
            if v / tot > 1e-3: obj.vertex_groups[n].add([i], v / tot, 'REPLACE')
apply_weights(body, new_w)
apply_weights(eyeR_obj, [{'eyeR': 1.0}] * len(eyeR_obj.data.vertices))
apply_weights(eyeL_obj, [{'eyeL': 1.0}] * len(eyeL_obj.data.vertices))
apply_weights(lids_obj, LW)
for o in (body, eyeR_obj, eyeL_obj, lids_obj):
    o.parent = rig; m = o.modifiers.new('Armature', 'ARMATURE'); m.object = rig

# ---- animations --------------------------------------------------------------
rig.animation_data_create(); bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'
FPS = 30; bpy.context.scene.render.fps = FPS
def make_action(name, tracks):
    act = bpy.data.actions.new(name); act.use_fake_user = True; rig.animation_data.action = act
    for bn, keys in tracks.items():
        pb = rig.pose.bones[bn]
        for t, deg in keys:
            pb.rotation_euler = (np.radians(deg), 0, 0); pb.keyframe_insert('rotation_euler', frame=t * FPS + 1)
BL = float(os.environ.get('BLINK_DEG', 93)); LOW = float(os.environ.get('LOWER_DEG', 93)); JO = float(os.environ.get('JAW_OPEN', 12)); JC = float(os.environ.get('JAW_CLOSE', -14))
lid = {'upperlidR': [(0, 0), (.06, BL), (.11, BL), (.22, 0)], 'upperlidL': [(0, 0), (.06, BL), (.11, BL), (.22, 0)],
       'lowerlidR': [(0, 0), (.06, -LOW), (.11, -LOW), (.22, 0)], 'lowerlidL': [(0, 0), (.06, -LOW), (.11, -LOW), (.22, 0)]}
make_action('Blink', lid)
make_action('JawOpen', {'jaw': [(0, 0), (.25, JO), (.5, 0)]})
make_action('JawClose', {'jaw': [(0, 0), (.25, JC), (.5, 0)]})
make_action('Talk', {'jaw': [(0, 0), (.15, JO * .75), (.3, JC * .6), (.45, JO * .6), (.6, 0)]})
for pb in rig.pose.bones: pb.rotation_euler = (0, 0, 0)
rig.animation_data.action = None
bpy.ops.object.mode_set(mode='OBJECT')

# ---- export ---------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, NAME + '.glb'), export_format='GLB', use_selection=True,
                          export_animation_mode='ACTIONS', export_apply=False, export_skins=True, export_yup=True,
                          export_force_sampling=False, export_image_format='JPEG', export_jpeg_quality=90)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, NAME + '.fbx'), use_selection=True, path_mode='COPY', embed_textures=True,
                         add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + '.blend'))
print('done', len(names), 'bones')
