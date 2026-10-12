"""Full bodies (body + legs + arms in one sculpt) from fullbody_sculpts.glb: three bodies stacked on the sheet (heavy at
the bottom, then medium, then slim), each a main mesh plus its loose claws. The medium body also carries an extra
pair of loose toes (the two 352-vertex pieces), which are dropped. Each body is centred (z = 0 mirror plane, feet at
y = 0, neck end toward +x), a median-SDF base body is built, and the base is wrapped onto each sculpt so all three
share one topology. Outputs fullbody_base.glb (base + one morph target per body)."""
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
b=open('../fullbody_sculpts.glb','rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); B=b[20+l+8:]
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
mains=sorted([r for r,n in zip(comps,cnt) if n>4000],key=lambda r:V[root==r][:,1].min())     # bottom to top: heavy, medium, slim
H=[]
for name,r in zip(['heavy','medium','slim'],mains):
    X=V[root==r]; y0,y1=X[:,1].min(),X[:,1].max()
    keep=[r]+[q for q,n in zip(comps,cnt) if n<4000 and n!=352 and y0-0.02<V[root==q][:,1].min()<y0+0.1]   # its claws, not the extra toes
    m=np.isin(root,keep); vs=np.where(m)[0]; rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); I=rm[F[m[F[:,0]]]]; Q=V[vs].copy()
    Q-=[0.5*(Q[:,0].min()+Q[:,0].max()),Q[:,1].min(),0.5*(Q[:,2].min()+Q[:,2].max())]
    H.append(dict(name=name,Q=Q,I=I)); print(name,'verts',len(Q),'pieces',len(keep),'size',np.ptp(Q,0).round(3))
# the base is the medium sculpt itself (a median of the three would wash out the thin legs and arms)
v=H[1]['Q'].copy(); fb=H[1]['I'].copy()   # not mirrored: the bodies stand mid-stride, one leg forward, one back
print('base (medium sculpt)',len(v),'verts',len(fb),'tris',flush=True)
W=[]
for k,h in enumerate(H):
    if k==1: W.append(v.copy()); continue                 # the base is the medium body
    Y,e=wrap_species(v,fb,h); W.append(Y); print('wrap',h['name'],'error %.2f mm'%(e*1000),flush=True)
np.save('/tmp/fullbody_wrap.npy',dict(v=v,f=fb,W=W,H=H),allow_pickle=True)
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
gl={'asset':{'version':'2.0','generator':'dino-lab fullbody.py'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'FullBody','mesh':0}],
 'meshes':[{'name':'FullBodyBase','primitives':[{'attributes':{'POSITION':aP},'indices':aI,'targets':targets}],'weights':[0,0,0],'extras':{'targetNames':[h['name'] for h in H]}}],
 'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':sum(len(x) for x in bufs)}]}
js=json.dumps(gl).encode(); js+=b' '*((4-len(js)%4)%4); bn=b''.join(bufs); bn+=b'\0'*((4-len(bn)%4)%4)
open('../fullbody_base.glb','wb').write(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bn))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bn),0x004E4942)+bn)
print('fullbody_base.glb',(len(bn)+len(js))//1024,'KB')
