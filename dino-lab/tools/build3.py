"""Rigged GLB for the 9-species base: skin (skull, jaw in the cheek), one morph target per species. No UVs:
skin is procedural."""
import sys; sys.path.insert(0,'.')
import numpy as np, json, struct
from rig import jaw_weights, jaw_pivot
OUT='../dino_head_base_rigged.glb'
B=np.load('base3.npy',allow_pickle=True).item(); heads=np.load('heads3_aligned.npy',allow_pickle=True); RG=np.load('regions3.npy')
V0=B['v'].astype(np.float64); F=B['f'].astype(np.uint32); W=[np.load(f'wrap3n_{k}.npy') for k in range(len(heads))]
NAMES=[H['name'] for H in heads]
gapes=[float(-H['lowerAngle']) for H in heads]; restGape=float(np.median(gapes))
pivot=jaw_pivot(-restGape); jw=jaw_weights(V0,-restGape,pivot)
def vn(P):
    fn=np.cross(P[F[:,1]]-P[F[:,0]],P[F[:,2]]-P[F[:,0]]); n=np.zeros_like(P)
    for k in range(3): np.add.at(n,F[:,k],fn)
    return n/(np.linalg.norm(n,axis=1,keepdims=True)+1e-12)
bufs=[]; views=[]; accs=[]
def add(arr,target=None,comp=5126,typ='VEC3',minmax=False,norm=False):
    off=sum(len(b) for b in bufs); pad=(4-off%4)%4
    if pad: bufs.append(b'\0'*pad); off+=pad
    raw=arr.tobytes(); bufs.append(raw); v={'buffer':0,'byteOffset':off,'byteLength':len(raw)}
    if target: v['target']=target
    views.append(v); a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr) if typ!='SCALAR' else arr.size,'type':typ}
    if minmax: a['min']=arr.min(0).tolist(); a['max']=arr.max(0).tolist()
    if norm: a['normalized']=True
    accs.append(a); return len(accs)-1
aP=add(V0.astype(np.float32),34962,minmax=True); aN=add(vn(V0).astype(np.float32),34962)
j=np.zeros((len(V0),4),np.uint8); j[:,1]=1; w=np.zeros((len(V0),4),np.uint8); w[:,1]=np.round(jw*255); w[:,0]=255-w[:,1]
aJ=add(j,34962,5121,'VEC4'); aW=add(w,34962,5121,'VEC4',norm=True); aI=add(F.ravel(),34963,5125,'SCALAR')
regs={f'_REGION_{k}':add(np.c_[np.round(R*255),np.zeros(len(R))].astype(np.uint8),34962,5121,'VEC4',norm=True) for k,R in enumerate(RG)}
targets=[{'POSITION':add((Wk-V0).astype(np.float32),34962,minmax=True)} for Wk in W]
J=np.eye(4,dtype=np.float32); J[:3,3]=-pivot; aIBM=add(np.stack([np.eye(4,dtype=np.float32).T.ravel(),J.T.ravel()]),None,typ='MAT4')
gl={'asset':{'version':'2.0','generator':'dino-lab build3.py'},'scene':0,'scenes':[{'nodes':[0,1]}],
 'nodes':[{'name':'DinoHead','mesh':0,'skin':0},{'name':'skull','children':[2]},
          {'name':'jaw','translation':pivot.tolist(),'extras':{'restGapeDeg':restGape,'note':'joint inside the cheek; rotate about +z, negative opens'}}],
 'skins':[{'joints':[1,2],'inverseBindMatrices':aIBM,'skeleton':1}],
 'meshes':[{'name':'DinoHeadBase','primitives':[{'attributes':{'POSITION':aP,'NORMAL':aN,'JOINTS_0':aJ,'WEIGHTS_0':aW,**regs},'indices':aI,'targets':targets,'material':0}],
   'weights':[0]*len(W),'extras':{'targetNames':NAMES,'speciesGapes':gapes,'regions':'_REGION_k per species: r mouth, g keratin (beak, dome cap), b attachment site'}}],
 'materials':[{'name':'dinoSkin','pbrMetallicRoughness':{'baseColorFactor':[0.55,0.48,0.36,1],'metallicFactor':0,'roughnessFactor':0.7}}],
 'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':sum(len(b) for b in bufs)}]}
js=json.dumps(gl).encode(); js+=b' '*((4-len(js)%4)%4); bn=b''.join(bufs); bn+=b'\0'*((4-len(bn)%4)%4)
open(OUT,'wb').write(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bn))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bn),0x004E4942)+bn)
print('glb',(12+16+len(js)+len(bn))//1024,'KB; verts',len(V0),'rest gape %.1f'%restGape,'pivot',pivot.round(4))
