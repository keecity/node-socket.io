from build import *
blob = bytearray(); g = G.GLTF2(); g.asset = G.Asset(generator='rig script')
def add(arr, ctype, typ, target=None, mm=False):
    arr = np.ascontiguousarray(arr); 
    while len(blob) % 4: blob.append(0)
    off = len(blob); blob.extend(arr.tobytes())
    g.bufferViews.append(G.BufferView(buffer=0, byteOffset=off, byteLength=arr.nbytes, target=target))
    a = G.Accessor(bufferView=len(g.bufferViews)-1, componentType=ctype, count=len(arr), type=typ)
    if mm: a.min = arr.min(0).tolist() if arr.ndim > 1 else [float(arr.min())]; a.max = arr.max(0).tolist() if arr.ndim > 1 else [float(arr.max())]
    g.accessors.append(a); return len(g.accessors)-1
f32 = lambda a: np.asarray(a, np.float32)
# texture
while len(blob) % 4: blob.append(0)
off = len(blob); blob.extend(IMG); g.bufferViews.append(G.BufferView(buffer=0, byteOffset=off, byteLength=len(IMG)))
g.images = [G.Image(bufferView=0, mimeType=MIME)]; g.samplers = [G.Sampler()]; g.textures = [G.Texture(source=0, sampler=0)]
g.materials = [G.Material(name='player', pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorTexture=G.TextureInfo(index=0), metallicFactor=0, roughnessFactor=0.9), doubleSided=True),
               G.Material(name='ball', pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorFactor=[0.85, 0.36, 0.08, 1], metallicFactor=0, roughnessFactor=0.7)),
               G.Material(name='ballSeam', pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorFactor=[0.05, 0.03, 0.02, 1], metallicFactor=0, roughnessFactor=0.8))]
prim = G.Primitive(attributes=G.Attributes(POSITION=add(f32(P), 5126, 'VEC3', 34962, True), NORMAL=add(f32(N), 5126, 'VEC3', 34962),
        TEXCOORD_0=add(f32(U), 5126, 'VEC2', 34962), JOINTS_0=add(JOINTS, 5123, 'VEC4', 34962), WEIGHTS_0=add(WEIGHTS, 5126, 'VEC4', 34962)),
        indices=add(F.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963), material=0)
g.meshes.append(G.Mesh(name='player', primitives=[prim]))
# ball: sphere + 3 seam rings
def sphere(r, nu=24, nv=16):
    v = []; 
    for i in range(nv+1):
        th = np.pi*i/nv
        for j in range(nu+1): ph = 2*np.pi*j/nu; v.append([np.sin(th)*np.cos(ph), np.cos(th), np.sin(th)*np.sin(ph)])
    v = np.array(v); f = []
    for i in range(nv):
        for j in range(nu): a = i*(nu+1)+j; b = a+nu+1; f += [[a, b, a+1], [a+1, b, b+1]]
    return v*r, v, np.array(f)
def ring(r, axis, tr=0.004, nu=48, nv=6):
    v, n, f = [], [], []
    for i in range(nu):
        a = 2*np.pi*i/nu; c = np.array([np.cos(a), np.sin(a), 0])
        for j in range(nv):
            b = 2*np.pi*j/nv; d = np.cos(b)*c + np.sin(b)*np.array([0, 0, 1]); v.append(c*r + d*tr); n.append(d)
    for i in range(nu):
        for j in range(nv):
            a = i*nv+j; b = ((i+1) % nu)*nv+j; a2 = i*nv+(j+1) % nv; b2 = ((i+1) % nu)*nv+(j+1) % nv; f += [[a, b, a2], [a2, b, b2]]
    v, n = np.array(v), np.array(n); R = {'z': np.eye(3), 'x': qmat(qaxis('y', 90)), 'y': qmat(qaxis('x', 90))}[axis]
    return v@R.T, n@R.T, np.array(f)
bp = []
for k, (v, n, f) in enumerate([sphere(BALL_R)] + [ring(BALL_R*1.005, a) for a in 'xyz']):
    bp.append(G.Primitive(attributes=G.Attributes(POSITION=add(f32(v), 5126, 'VEC3', 34962, True), NORMAL=add(f32(n), 5126, 'VEC3', 34962)),
              indices=add(f.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963), material=0 if False else (1 if k == 0 else 2)))
g.meshes.append(G.Mesh(name='basketball', primitives=bp))
# nodes
for k in NAMES:
    g.nodes.append(G.Node(name=k, translation=LOCAL_T[k].tolist(), children=[IDX[c] for c in NAMES if J[c][0] == k]))
nb = len(NAMES)
IBM = np.stack([np.linalg.inv(fk({})[k]).T for k in NAMES]).astype(np.float32)
g.skins = [G.Skin(name='rig', joints=list(range(nb)), skeleton=0, inverseBindMatrices=add(IBM.reshape(nb, 16), 5126, 'MAT4'))]
g.nodes.append(G.Node(name='player_mesh', mesh=0, skin=0))
g.nodes.append(G.Node(name='basketball', mesh=1))
g.scenes = [G.Scene(nodes=[0, nb, nb+1])]; g.scene = 0
for name, (fr, balls, _) in CLIPS.items():
    t = add(f32(np.arange(len(fr))/FPS), 5126, 'SCALAR', None, True); an = G.Animation(name=name)
    def ch(node, path, data):
        an.samplers.append(G.AnimationSampler(input=t, output=add(f32(data), 5126, 'VEC4' if path == 'rotation' else 'VEC3'), interpolation='LINEAR'))
        an.channels.append(G.AnimationChannel(sampler=len(an.samplers)-1, target=G.AnimationChannelTarget(node=node, path=path)))
    for k in NAMES:
        qs = np.array([p[k] for p in fr])
        for i in range(1, len(qs)):
            if qs[i] @ qs[i-1] < 0: qs[i] = -qs[i]
        if np.abs(qs - [0, 0, 0, 1]).max() > 1e-5: ch(IDX[k], 'rotation', qs)
    ch(IDX['root'], 'translation', [p['_root'] for p in fr]); ch(IDX['hips'], 'translation', [LOCAL_T['hips'] + p['_hips'] for p in fr])
    B = np.array(balls); ch(nb+1, 'translation', B)
    # roll ball by distance travelled
    ang = 0; qs = []; q = np.array([0, 0, 0, 1.])
    for i in range(len(B)):
        if i: d = B[i]-B[i-1]; ax = np.cross([0, 1, 0], d); L = np.linalg.norm(ax)
        if i and L > 1e-6: q = qmul(np.r_[ax/L*np.sin(L/BALL_R/2), np.cos(L/BALL_R/2)], q)
        qs.append(q.copy())
    ch(nb+1, 'rotation', qs)
    g.animations.append(an)
g.buffers = [G.Buffer(byteLength=len(blob))]; g.set_binary_blob(bytes(blob)); g.save_binary('player_rigged.glb')
print('ok', len(blob))
