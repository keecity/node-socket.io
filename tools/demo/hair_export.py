import numpy as np, pygltflib as G, mixrig as M
from load import load
P,N,U,F,IMG,MIME = load('hair.glb')
C = P[F].mean(1); col = np.clip(((C[:,0]+0.434)/0.868*4).astype(int),0,3); row = np.clip(((1-C[:,1])*5).astype(int),0,4)
Wh = M.fk()[M.ID['Head']]; inv = np.linalg.inv(Wh)
blob = bytearray(); g = G.GLTF2(); g.asset = G.Asset(generator='hair split')
def add(arr, ctype, typ, target=None, mm=False):
    arr = np.ascontiguousarray(arr)
    while len(blob) % 4: blob.append(0)
    off = len(blob); blob.extend(arr.tobytes()); g.bufferViews.append(G.BufferView(buffer=0, byteOffset=off, byteLength=arr.nbytes, target=target))
    a = G.Accessor(bufferView=len(g.bufferViews)-1, componentType=ctype, count=len(arr), type=typ)
    if mm: a.min = arr.min(0).tolist(); a.max = arr.max(0).tolist()
    g.accessors.append(a); return len(g.accessors)-1
while len(blob) % 4: blob.append(0)
off=len(blob); blob.extend(IMG); g.bufferViews.append(G.BufferView(buffer=0, byteOffset=off, byteLength=len(IMG)))
g.images=[G.Image(bufferView=0, mimeType=MIME)]; g.samplers=[G.Sampler()]; g.textures=[G.Texture(source=0, sampler=0)]
g.materials=[G.Material(name='hair', pbrMetallicRoughness=G.PbrMetallicRoughness(baseColorTexture=G.TextureInfo(index=0), metallicFactor=0, roughnessFactor=0.8), doubleSided=True)]
HEAD_W, HEAD_TOP, HEAD_Z = 0.30, 1.04, -0.035
for k in range(20):
    tri = F[(row*4+col)==k]; vid, inv_i = np.unique(tri, return_inverse=True); p = P[vid].copy(); f = inv_i.reshape(-1,3)
    lo, hi = p.min(0), p.max(0); s = HEAD_W / (hi[0]-lo[0])
    p = (p - [(lo[0]+hi[0])/2, hi[1], (lo[2]+hi[2])/2]) * s + [0, HEAD_TOP, HEAD_Z]
    pl = (np.c_[p, np.ones(len(p))] @ inv.T)[:, :3]; nl = N[vid] @ inv[:3,:3].T; nl /= np.linalg.norm(nl,axis=1)[:,None]+1e-9
    prim = G.Primitive(attributes=G.Attributes(POSITION=add(pl.astype(np.float32),5126,'VEC3',34962,True), NORMAL=add(nl.astype(np.float32),5126,'VEC3',34962), TEXCOORD_0=add(U[vid].astype(np.float32),5126,'VEC2',34962)),
                       indices=add(f.astype(np.uint32).ravel(),5125,'SCALAR',34963), material=0)
    g.meshes.append(G.Mesh(name=f'hair{k}', primitives=[prim])); g.nodes.append(G.Node(name=f'hair{k}', mesh=k))
g.scenes=[G.Scene(nodes=list(range(20)))]; g.scene=0
g.buffers=[G.Buffer(byteLength=len(blob))]; g.set_binary_blob(bytes(blob)); g.save_binary('hair_styles.glb'); print('ok', len(blob))
