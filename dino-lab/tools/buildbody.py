"""Body GLB: shared base body + one morph target per body sculpt (same scheme as the head)."""
import numpy as np, json, struct
B=np.load('bodybase.npy',allow_pickle=True).item(); V0=B['v'].astype(np.float32); F=B['f'].astype(np.uint32)
W=[np.load(f'bodywrap_{k}.npy').astype(np.float32) for k in range(3)]
bufs=[];views=[];accs=[]
def add(arr,target,comp,typ,minmax=False):
    off=sum(len(b) for b in bufs); pad=(4-off%4)%4
    if pad: bufs.append(b'\0'*pad); off+=pad
    raw=arr.tobytes(); bufs.append(raw); views.append({'buffer':0,'byteOffset':off,'byteLength':len(raw),'target':target})
    a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr) if typ!='SCALAR' else arr.size,'type':typ}
    if minmax: a['min']=arr.min(0).tolist(); a['max']=arr.max(0).tolist()
    accs.append(a); return len(accs)-1
aP=add(V0,34962,5126,'VEC3',True); aI=add(F.ravel(),34963,5125,'SCALAR')
targets=[{'POSITION':add(w-V0,34962,5126,'VEC3',True)} for w in W]
gl={'asset':{'version':'2.0','generator':'dino-lab buildbody.py'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'DinoBody','mesh':0}],
 'meshes':[{'name':'DinoBodyBase','primitives':[{'attributes':{'POSITION':aP},'indices':aI,'targets':targets,'material':0}],'weights':[0,0,0],
   'extras':{'targetNames':['Body A','Body B','Body C'],'frame':'x forward (neck end), y up, z = mirror plane, centred'}}],
 'materials':[{'name':'dinoSkin'}],'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':sum(len(b) for b in bufs)}]}
js=json.dumps(gl).encode(); js+=b' '*((4-len(js)%4)%4); bn=b''.join(bufs); bn+=b'\0'*((4-len(bn)%4)%4)
open('../dino_body_base.glb','wb').write(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bn))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bn),0x004E4942)+bn)
print('body glb',(len(bn)+len(js))//1024,'KB',len(V0),'verts')
