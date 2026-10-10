"""Package the shared-topology dino heads for the viewer and export a rigged GLB.
inputs (scratch): base.npy, wrap0-2.npy, uvs.npy, heads_aligned.npy, atlas.png"""
import sys; sys.path.insert(0,'/tmp/claude-0/-home-user-node-socket-io/16203f93-b1ad-5b15-91e7-2cd92cb90144/scratchpad/dino')
import numpy as np, json, struct, io
from PIL import Image
from rig import jaw_weights
OUT='/home/user/node-socket.io/dino-lab/'
B=np.load('base.npy',allow_pickle=True).item(); heads=np.load('heads_aligned.npy',allow_pickle=True); uvs=np.load('uvs.npy')
F=B['f'].astype(np.int64); V0=B['v']; W=[np.load(f'wrap{h}.npy') for h in range(3)]
gapes=[float(-H['lowerAngle']) for H in heads]; restGape=float(np.mean(gapes))
jw=jaw_weights(V0,-restGape)
NAMES=['Theropod','Ceratopsian','Ornithopod']
print('rest gape %.1f°'%restGape)

# ---- rigged GLB: unindexed corners (species UVs differ per corner), skin (skull, jaw), 3 morph targets, 3 UV sets
# merge corners that share a vertex and the same UVs in all three species (only true UV seams stay split)
UVc=np.concatenate([np.round(uvs[h].reshape(-1,2)*65535).astype(np.int64) for h in range(3)],1)
key=np.c_[F.ravel(),UVc]; uniq,inv=np.unique(key,axis=0,return_inverse=True); inv=inv.ravel()
C=uniq[:,0]; IDX=inv.reshape(-1,3).astype(np.uint32)
UVu=[np.zeros((len(uniq),2)) for _ in range(3)]
for h in range(3): UVu[h][inv]=uvs[h].reshape(-1,2)
print('glb vertices',len(C),'(from',F.size,'corners)')
P=V0[C].astype(np.float32)
def vnorm(P3,Fi):
    fn=np.cross(P3[Fi[:,1]]-P3[Fi[:,0]],P3[Fi[:,2]]-P3[Fi[:,0]]); vn=np.zeros_like(P3)
    for k in range(3): np.add.at(vn,Fi[:,k],fn)
    return (vn/(np.linalg.norm(vn,axis=1,keepdims=True)+1e-12))
N0=vnorm(V0,F)[C].astype(np.float32)
bufs=[]; views=[]; accs=[]
def add(arr,target=None,comp=5126,typ='VEC3',minmax=False):
    raw=arr.tobytes(); off=sum(len(b) for b in bufs)
    pad=(4-off%4)%4
    if pad: bufs.append(b'\0'*pad); off+=pad
    bufs.append(raw); v={'buffer':0,'byteOffset':off,'byteLength':len(raw)}
    if target: v['target']=target
    views.append(v); a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr),'type':typ}
    if minmax: a['min']=arr.min(0).tolist(); a['max']=arr.max(0).tolist()
    accs.append(a); return len(accs)-1
aP=add(P,34962,minmax=True); aN=add(N0,34962)
aUV=[add(np.c_[UVu[h][:,0],1-UVu[h][:,1]].astype(np.float32),34962,typ='VEC2') for h in range(3)]
aI=add(IDX.ravel(),34963,comp=5125,typ='SCALAR')
j=np.zeros((len(C),4),np.uint8); j[:,1]=1
w=np.zeros((len(C),4),np.uint8); w[:,1]=np.round(jw[C]*255); w[:,0]=255-w[:,1]
aJ=add(j,34962,comp=5121,typ='VEC4'); aW=add(w,34962,comp=5121,typ='VEC4'); accs[aW]['normalized']=True
targets=[]
for h in range(3):
    D=(W[h][C]-V0[C]).astype(np.float32); targets.append({'POSITION':add(D,34962,minmax=True)})
ibm=np.stack([np.eye(4,dtype=np.float32).T.ravel()]*2)
aIBM=add(ibm,None,typ='MAT4')
from glbio import load as _l
import json as _j
_d=open('../dino_in/heads.glb','rb').read(); _n=struct.unpack('<I',_d[12:16])[0]; _g=_j.loads(_d[20:20+_n]); _v=_g['bufferViews'][_g['images'][0]['bufferView']]
imgb=_d[20+_n+8+_v.get('byteOffset',0):20+_n+8+_v.get('byteOffset',0)+_v['byteLength']]
off=sum(len(b) for b in bufs); pad=(4-off%4)%4; bufs.append(b'\0'*pad); off+=pad; bufs.append(imgb); views.append({'buffer':0,'byteOffset':off,'byteLength':len(imgb)})
gl={'asset':{'version':'2.0','generator':'dino-lab build_data.py'},'scene':0,'scenes':[{'nodes':[0,1]}],
 'nodes':[{'name':'DinoHead','mesh':0,'skin':0},{'name':'skull','children':[2]},{'name':'jaw','rotation':[0,0,0,1],'extras':{'restGapeDeg':restGape,'hinge':'origin; rotate about +z, negative opens'}}],
 'skins':[{'joints':[1,2],'inverseBindMatrices':aIBM,'skeleton':1}],
 'meshes':[{'name':'DinoHeadBase','primitives':[{'attributes':{'POSITION':aP,'NORMAL':aN,'TEXCOORD_0':aUV[0],'TEXCOORD_1':aUV[1],'TEXCOORD_2':aUV[2],'JOINTS_0':aJ,'WEIGHTS_0':aW},'indices':aI,'targets':targets,'material':0}],
   'weights':[0,0,0],'extras':{'targetNames':NAMES,'speciesGapes':gapes}}],
 'materials':[{'name':'dinoAtlas','pbrMetallicRoughness':{'baseColorTexture':{'index':0,'texCoord':0},'metallicFactor':0,'roughnessFactor':0.7}}],
 'textures':[{'source':0}],'images':[{'bufferView':len(views)-1,'mimeType':'image/jpeg'}],
 'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':sum(len(b) for b in bufs)}]}
js=json.dumps(gl).encode(); js+=b' '*((4-len(js)%4)%4); bin_=b''.join(bufs); bin_+=b'\0'*((4-len(bin_)%4)%4)
glb=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bin_))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bin_),0x004E4942)+bin_
open(OUT+'dino_head_base_rigged.glb','wb').write(glb); print('glb',len(glb)//1024,'KB')
