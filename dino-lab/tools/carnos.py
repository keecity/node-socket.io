"""Three carnosaurs (whole animals: head, neck, body, tail, legs, arms; low poly) from carnos_sculpts.glb, stacked on the
sheet. Main meshes only (teeth, claws and spikes are loose pieces that differ per animal). Each is mirrored so the legs
stand side by side; carno A is the base, wrapped onto B and C. Regions (torso, legs, arms, tail, neck, head) are
found on the base and softened over the mesh for region blending. Outputs carnos_base.glb and carnos_regions.json."""
import sys; sys.path.insert(0,'.')
import numpy as np, json, struct
from scipy.spatial import cKDTree
from scipy import ndimage
from skimage import measure
from wrap import sample, laplacian
from wrap import wrap, prefit
def mirror_map(V):
    M=V.copy(); M[:,2]*=-1; return cKDTree(V).query(M)[1]
def wrap_species(V,F,H):   # as in refine.py: best of a direct and a prefit wrap
    S,_=sample(H['Q'],H['I'],0.003); best=None
    for name,V0 in [('direct',V),('prefit',prefit(V,H['Q']))]:
        X=wrap(V0,F,H['Q'],H['I'],iters=45); W_,_=sample(X,F,0.003)
        e=cKDTree(W_).query(S)[0].mean()+cKDTree(S).query(W_)[0].mean()
        if best is None or e<best[0]: best=(e,X)
    return best[1],best[0]   # no mirror fix: the stride pose is not symmetric
b=open('../carnos_sculpts.glb','rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); B=b[20+l+8:]
def acc(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]; n={'SCALAR':1,'VEC3':3}[a['type']]; dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
    return np.frombuffer(B,dt,a['count']*n,bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
p=j['meshes'][0]['primitives'][0]; V=acc(p['attributes']['POSITION']).astype(float); F=acc(p['indices']).reshape(-1,3).astype(int)
U,inv=np.unique(np.round(V,5),axis=0,return_inverse=True); inv=inv.ravel(); F=inv[F]; V=U
F=F[(F[:,0]!=F[:,1])&(F[:,1]!=F[:,2])&(F[:,0]!=F[:,2])]
par=np.arange(len(V))
def f(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in F: a=f(t[0]); par[f(t[1])]=a; par[f(t[2])]=a
root=np.array([f(x) for x in range(len(V))]); comps,cnt=np.unique(root,return_counts=True)
mains=sorted([r for r,n in zip(comps,cnt) if n>2000],key=lambda r:V[root==r][:,1].min())     # bottom, middle, top on the sheet
from collections import Counter
H=[]
for name,r in zip(['carno A','carno B','carno C'],mains):
    m=root==r; vs=np.where(m)[0]; rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); I=rm[F[m[F[:,0]]]]; Q=V[vs].copy()
    Q-=[0,Q[:,1].min(),0.5*(Q[:,2].min()+Q[:,2].max())]
    keepT=Q[I].mean(1)[:,2]>0; I=I[keepT]; used=np.unique(I); rm=-np.ones(len(Q),int); rm[used]=np.arange(len(used)); Q=Q[used]; I=rm[I]
    e=Counter(tuple(sorted(x)) for t in I for x in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0]))); bnd=np.unique([v for k,c in e.items() if c==1 for v in k])
    seam=bnd[Q[bnd,2]<0.012]; Q[seam,2]=0
    mir=np.arange(len(Q))+len(Q); mir[seam]=seam
    I=np.vstack([I,mir[I][:,[0,2,1]]]); Q=np.vstack([Q,Q*[1,1,-1]])
    used=np.unique(I); rm=-np.ones(len(Q),int); rm[used]=np.arange(len(used)); Q=Q[used]; I=rm[I]
    H.append(dict(name=name,Q=Q,I=I)); print(name,'verts',len(Q),'size',np.ptp(Q,0).round(3))
v=H[0]['Q'].copy(); fb=H[0]['I'].copy(); print('base: carno A',len(v),'verts',flush=True)
W=[v.copy()]
for h in H[1:]:
    Y,e=wrap_species(v,fb,h); W.append(Y); print('wrap',h['name'],'error %.2f mm'%(e*1000),flush=True)
# regions on the base (rest shape): anything hanging below the belly's centre line is a limb (legs at the back,
# arms at the front, split by 2-means on where they hang from); in front of the narrowest point ahead of the
# chest is neck then head; behind the legs is tail; the rest is torso. One-hot labels, softened over the mesh
L=np.ptp(v[:,0]); x0=v[:,0].min(); nb=60; edges=np.linspace(x0,v[:,0].max(),nb+1); xb=np.clip(((v[:,0]-x0)/L*nb).astype(int),0,nb-1)
halfw=np.array([np.abs(v[xb==i,2]).max() if (xb==i).any() else 0 for i in range(nb)])
belly=np.array([v[(xb==i)&(np.abs(v[:,2])<0.25*halfw[i]+1e-9),1].min() if ((xb==i)&(np.abs(v[:,2])<0.25*halfw[i]+1e-9)).any() else 0 for i in range(nb)])
belly=np.maximum.accumulate(np.ones(1))*0+np.array([np.median(belly[max(0,i-2):i+3]) for i in range(nb)])
limb=v[:,1]<belly[xb]-0.01
att=v[limb&(v[:,1]>belly[xb]-0.04),0]; c2=np.quantile(att,[0.25,0.75])
for _ in range(30): lab=np.argmin(np.abs(att[:,None]-c2[None]),1); c2=np.array([att[lab==k].mean() for k in range(2)])
hipX,shX=np.sort(c2); split=0.5*(hipX+shX)
reg=np.zeros(len(v),int)                                                 # 0 torso 1 legs 2 arms 3 tail 4 neck 5 head
reg[limb&(v[:,0]<split)]=1; reg[limb&(v[:,0]>=split)]=2
legx=v[reg==1,0].min(); reg[(~limb)&(v[:,0]<legx-0.02)]=3
hgt=np.array([np.ptp(v[xb==i,1]) if (xb==i).any() else 9 for i in range(nb)])
front=[i for i in range(nb) if edges[i]>shX+0.03 and edges[i]<v[:,0].max()-0.06]; ni=min(front,key=lambda i:hgt[i]); neckX=edges[ni]
reg[(~limb)&(v[:,0]>neckX-0.05)]=4; reg[(~limb)&(v[:,0]>neckX+0.03)]=5
M=np.eye(6)[reg]; Lap=laplacian(len(v),fb)
for _ in range(8): M=Lap@M
M/=M.sum(1,keepdims=True)
print('regions:',{n:int((reg==k).sum()) for k,n in enumerate(['torso','legs','arms','tail','neck','head'])},'hip %.2f shoulder %.2f neck %.2f'%(hipX,shX,neckX))
np.save('/tmp/carnos_wrap.npy',dict(v=v,f=fb,W=W,H=H,reg=reg),allow_pickle=True)
json.dump(dict(regions=['torso','legs','arms','tail','neck','head'],mask=np.round(M,3).ravel().tolist()),open('../carnos_regions.json','w'))
# GLB: base + morph targets
V0=v.astype(np.float32); FF=fb.astype(np.uint32); bufs=[];views=[];accs=[]
def add(arr,target,comp,typ,minmax=False):
    off=sum(len(x) for x in bufs); pad=(4-off%4)%4
    if pad: bufs.append(b'\0'*pad); off+=pad
    raw=arr.tobytes(); bufs.append(raw); views.append({'buffer':0,'byteOffset':off,'byteLength':len(raw),'target':target})
    a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr) if typ!='SCALAR' else arr.size,'type':typ}
    if minmax: a['min']=arr.min(0).tolist(); a['max']=arr.max(0).tolist()
    accs.append(a); return len(accs)-1
aP=add(V0,34962,5126,'VEC3',True); aI=add(FF.ravel(),34963,5125,'SCALAR')
targets=[{'POSITION':add(w.astype(np.float32)-V0,34962,5126,'VEC3',True)} for w in W]
gl={'asset':{'version':'2.0','generator':'dino-lab carnos.py'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Carnos','mesh':0}],
 'meshes':[{'name':'CarnosBase','primitives':[{'attributes':{'POSITION':aP},'indices':aI,'targets':targets}],'weights':[0,0,0],'extras':{'targetNames':[h['name'] for h in H]}}],
 'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':sum(len(x) for x in bufs)}]}
js=json.dumps(gl).encode(); js+=b' '*((4-len(js)%4)%4); bn=b''.join(bufs); bn+=b'\0'*((4-len(bn)%4)%4)
open('../carnos_base.glb','wb').write(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bn))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bn),0x004E4942)+bn)
print('carnos_base.glb',(len(bn)+len(js))//1024,'KB')
