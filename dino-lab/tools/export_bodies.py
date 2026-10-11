"""Write the mirrored bodies (and the untouched cylinder segment) to one GLB, a mesh/node per piece."""
import numpy as np, json, struct
B=np.load('bodies.npy',allow_pickle=True)
bufs=[];views=[];accs=[];meshes=[];nodes=[]
def add(arr,target,comp,typ,minmax=False):
    off=sum(len(b) for b in bufs); pad=(4-off%4)%4
    if pad: bufs.append(b'\0'*pad); off+=pad
    raw=arr.tobytes(); bufs.append(raw); views.append({'buffer':0,'byteOffset':off,'byteLength':len(raw),'target':target})
    a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr) if typ!='SCALAR' else arr.size,'type':typ}
    if minmax: a['min']=arr.min(0).tolist(); a['max']=arr.max(0).tolist()
    accs.append(a); return len(accs)-1
names=[]; k=0
for o in B:
    v=o['v'].astype(np.float32); f=o['f'].astype(np.uint32)
    fn=np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]]); n=np.zeros_like(v)
    for c in range(3): np.add.at(n,f[:,c],fn)
    n/=np.linalg.norm(n,axis=1,keepdims=True)+1e-12
    name='segment' if o['kind']=='segment' else f'body_{k}'; k+= o['kind']=='body'
    meshes.append({'name':name,'primitives':[{'attributes':{'POSITION':add(v,34962,5126,'VEC3',True),'NORMAL':add(n.astype(np.float32),34962,5126,'VEC3')},'indices':add(f.ravel(),34963,5125,'SCALAR'),'material':0}]})
    nodes.append({'name':name,'mesh':len(meshes)-1}); names.append(name)
gl={'asset':{'version':'2.0','generator':'dino-lab export_bodies.py'},'scene':0,'scenes':[{'nodes':list(range(len(nodes)))}],'nodes':nodes,'meshes':meshes,
    'materials':[{'name':'body','pbrMetallicRoughness':{'baseColorFactor':[0.55,0.48,0.36,1],'metallicFactor':0,'roughnessFactor':0.8}}],
    'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':sum(len(b) for b in bufs)}]}
js=json.dumps(gl).encode(); js+=b' '*((4-len(js)%4)%4); bn=b''.join(bufs); bn+=b'\0'*((4-len(bn)%4)%4)
open('../bodies_mirrored.glb','wb').write(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bn))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bn),0x004E4942)+bn)
print(names,(len(bn)+len(js))//1024,'KB')
