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
from collections import Counter
from PIL import Image
import io
def load_sheet(path, names, minverts):
    """the animals on one sheet (largest pieces, bottom to top), each centred, mirrored, with its paint per triangle corner"""
    b=open(path,'rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); B=b[20+l+8:]
    def acc(i):
        a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]; n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]; dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
        return np.frombuffer(B,dt,a['count']*n,bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
    p=j['meshes'][0]['primitives'][0]; V=acc(p['attributes']['POSITION']).astype(float); F=acc(p['indices']).reshape(-1,3).astype(int)
    UVall=acc(p['attributes']['TEXCOORD_0']).astype(float); FU=F.copy()
    U,inv=np.unique(np.round(V,5),axis=0,return_inverse=True); inv=inv.ravel(); F=inv[F]; V=U
    ok=(F[:,0]!=F[:,1])&(F[:,1]!=F[:,2])&(F[:,0]!=F[:,2]); F=F[ok]; FU=FU[ok]
    im=j['images'][0]; bv=j['bufferViews'][im['bufferView']]
    TEX=np.asarray(Image.open(io.BytesIO(B[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']])).convert('RGB')).astype(np.float32)
    par=np.arange(len(V))
    def f(x):
        while par[x]!=x: par[x]=par[par[x]]; x=par[x]
        return x
    for t in F: a=f(t[0]); par[f(t[1])]=a; par[f(t[2])]=a
    root=np.array([f(x) for x in range(len(V))]); comps,cnt=np.unique(root,return_counts=True)
    mains=sorted([r for r,n in zip(comps,cnt) if n>minverts],key=lambda r:V[root==r][:,1].min())
    out=[]
    for name,r in zip(names,mains):
        m=root==r; vs=np.where(m)[0]; rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); tm=m[F[:,0]]; I=rm[F[tm]]; IU=FU[tm]; Q=V[vs].copy()
        Q-=[0,Q[:,1].min(),0.5*(Q[:,2].min()+Q[:,2].max())]
        keepT=Q[I].mean(1)[:,2]>0; I=I[keepT]; IU=IU[keepT]; used=np.unique(I); rm=-np.ones(len(Q),int); rm[used]=np.arange(len(used)); Q=Q[used]; I=rm[I]
        e=Counter(tuple(sorted(x)) for t in I for x in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0]))); bnd=np.unique([v for k,c in e.items() if c==1 for v in k])
        seam=bnd[Q[bnd,2]<0.012]; Q[seam,2]=0
        mir=np.arange(len(Q))+len(Q); mir[seam]=seam
        I=np.vstack([I,mir[I][:,[0,2,1]]]); IU=np.vstack([IU,IU[:,[0,2,1]]]); Q=np.vstack([Q,Q*[1,1,-1]])   # the mirrored side reuses the same paint
        used=np.unique(I); rm=-np.ones(len(Q),int); rm[used]=np.arange(len(used)); Q=Q[used]; I=rm[I]
        out.append(dict(name=name,Q=Q,I=I,UVc=UVall[IU],TEX=TEX)); print(name,'verts',len(Q),'size',np.ptp(Q,0).round(3))
    return out
# carnosaurs A, B, C (bottom, middle, top of the first sheet); T. rex and Triceratops (top, bottom of the second)
H=load_sheet('../carnos_sculpts.glb',['carno A','carno B','carno C'],2000)
H+=load_sheet('../tricarno_sculpts.glb',['triceratops','t. rex'],2500)[::-1]
# regions (rest shape): anything hanging below the belly's centre line is a limb (legs at the back, arms at the front,
# split by 2-means on where they hang from); in front of the narrowest point ahead of the chest is neck then head;
# behind the legs is tail; the rest is torso
def find_regions(v):
    L=np.ptp(v[:,0]); x0=v[:,0].min(); nb=60; edges=np.linspace(x0,v[:,0].max(),nb+1); xb=np.clip(((v[:,0]-x0)/L*nb).astype(int),0,nb-1)
    halfw=np.array([np.abs(v[xb==i,2]).max() if (xb==i).any() else 0 for i in range(nb)])
    belly=np.array([v[(xb==i)&(np.abs(v[:,2])<0.25*halfw[i]+1e-9),1].min() if ((xb==i)&(np.abs(v[:,2])<0.25*halfw[i]+1e-9)).any() else 0 for i in range(nb)])
    belly=np.array([np.median(belly[max(0,i-2):i+3]) for i in range(nb)])
    limb=v[:,1]<belly[xb]-0.01
    att=v[limb&(v[:,1]>belly[xb]-0.04),0]; c2=np.quantile(att,[0.25,0.75])
    for _ in range(30): lab=np.argmin(np.abs(att[:,None]-c2[None]),1); c2=np.array([att[lab==k].mean() for k in range(2)])
    hipX,shX=np.sort(c2); split=0.5*(hipX+shX)
    reg=np.zeros(len(v),int)                                             # 0 torso 1 legs 2 arms 3 tail 4 neck 5 head
    reg[limb&(v[:,0]<split)]=1; reg[limb&(v[:,0]>=split)]=2
    legx=v[reg==1,0].min(); reg[(~limb)&(v[:,0]<legx-0.02)]=3
    hgt=np.array([np.ptp(v[xb==i,1]) if (xb==i).any() else 9 for i in range(nb)])
    front=[i for i in range(nb) if edges[i]>shX+0.03 and edges[i]<v[:,0].max()-0.06]; ni=min(front,key=lambda i:hgt[i]); neckX=edges[ni]
    reg[(~limb)&(v[:,0]>neckX-0.05)]=4; reg[(~limb)&(v[:,0]>neckX+0.03)]=5
    return reg,(hipX,shX,neckX)
def side_key(reg,v):   # limbs are matched side by side (left leg to left leg), the rest by region alone
    return np.where((reg==1)|(reg==2),reg+10*(v[:,2]>0),reg)
# limb correction after the ordinary wrap: where neighbouring limbs sit close, the wrap can snap an arm onto a leg (or one
# leg onto the other), leaving strands. Limb vertices are re-fitted to the same limb on the same side of the animal
# (when the animal's limbs are found), with their offsets lightly smoothed; everything else keeps its wrap
def fix_limbs(v,fb,regb,X,h):
    regt,_=find_regions(h['Q']); S,_=sample(h['Q'],h['I'],0.002); _,nv_=cKDTree(h['Q']).query(S); kt=side_key(regt,h['Q'])[nv_]; kb=side_key(regb,v)
    limbk=[k for k in np.unique(kb) if k%10 in (1,2) and (kt==k).sum()>200]
    if not limbk: return X,0
    trees={k:cKDTree(S[kt==k]) for k in limbk}; Lap=laplacian(len(v),fb); lm=np.isin(kb,limbk)
    for it in range(30):
        T=X.copy()
        for k,tr in trees.items(): m=kb==k; _,ii=tr.query(X[m]); T[m]=S[kt==k][ii]
        X=np.where(lm[:,None],X+0.5*(T-X),X); D=X-v; D2=0.7*D+0.3*(Lap@D); X=np.where(lm[:,None],v+D2,X)
    return X,len(limbk)
v=H[0]['Q'].copy(); fb=H[0]['I'].copy(); print('base: carno A',len(v),'verts',flush=True)
reg,(hipX,shX,neckX)=find_regions(v)
M=np.eye(6)[reg]; Lap=laplacian(len(v),fb)
for _ in range(8): M=Lap@M
M/=M.sum(1,keepdims=True)
print('regions:',{n:int((reg==k).sum()) for k,n in enumerate(['torso','legs','arms','tail','neck','head'])},'hip %.2f shoulder %.2f neck %.2f'%(hipX,shX,neckX))
W=[v.copy()]
for h in H[1:]:
    Y,e=wrap_species(v,fb,h); Y,nl=fix_limbs(v,fb,reg,Y,h); W.append(Y); print('wrap',h['name'],'error %.2f mm'%(e*1000),'limbs re-fitted',nl,flush=True)
# bake each animal's paint into A's texture layout: rasterise A's triangles in texture space; each texel is a point on the
# shared mesh, the same point on animal k (its wrap), the nearest point of animal k's sculpt, its texture coords, its colour
TS=2048
def surf_uv(h,n=400000):   # dense surface samples of a sculpt with their texture coords
    P=h['Q'][h['I']]; T=h['UVc']; ar=np.linalg.norm(np.cross(P[:,1]-P[:,0],P[:,2]-P[:,0]),axis=1); tri=np.random.default_rng(0).choice(len(P),n,p=ar/ar.sum())
    a,bb=np.random.default_rng(1).random((2,n)); fl=a+bb>1; a[fl]=1-a[fl]; bb[fl]=1-bb[fl]; w=np.c_[1-a-bb,a,bb]
    return (P[tri]*w[:,:,None]).sum(1),(T[tri]*w[:,:,None]).sum(1)
look=[None]+[surf_uv(h) for h in H[1:]]; trees=[None]+[cKDTree(q[0]) for q in look[1:]]
UVA=H[0]['UVc']                                                           # A's texture coords per triangle corner
ys,xs=np.mgrid[0:TS,0:TS]; pix=np.c_[(xs.ravel()+0.5)/TS,(ys.ravel()+0.5)/TS]
owner=-np.ones(TS*TS,int); bary=np.zeros((TS*TS,3))
for t in range(len(fb)):
    a,b_,c=UVA[t]; lo=np.floor(np.minimum.reduce([a,b_,c])*TS).astype(int); hi=np.ceil(np.maximum.reduce([a,b_,c])*TS).astype(int)
    xx,yy=np.meshgrid(np.arange(max(lo[0],0),min(hi[0],TS)),np.arange(max(lo[1],0),min(hi[1],TS))); k=(yy*TS+xx).ravel()
    if not len(k): continue
    q=pix[k]; d=(b_[1]-c[1])*(a[0]-c[0])+(c[0]-b_[0])*(a[1]-c[1])
    if abs(d)<1e-12: continue
    l1=((b_[1]-c[1])*(q[:,0]-c[0])+(c[0]-b_[0])*(q[:,1]-c[1]))/d; l2=((c[1]-a[1])*(q[:,0]-c[0])+(a[0]-c[0])*(q[:,1]-c[1]))/d; l3=1-l1-l2
    inside=(l1>=-0.02)&(l2>=-0.02)&(l3>=-0.02); owner[k[inside]]=t; bary[k[inside]]=np.c_[l1,l2,l3][inside]
hit=owner>=0; print('texels covered %.0f%%'%(100*hit.mean()),flush=True)
def sample(TEX,uv):   # nearest sample of a sheet's texture
    x=np.clip((uv[:,0]%1)*TEX.shape[1],0,TEX.shape[1]-1).astype(int); y=np.clip((uv[:,1]%1)*TEX.shape[0],0,TEX.shape[0]-1).astype(int); return TEX[y,x]
for k in range(len(H)):
    out=np.zeros((TS*TS,3),np.float32)
    if k==0: out[hit]=sample(H[0]['TEX'],pix[hit])
    else:
        tri=fb[owner[hit]]; P3=(W[k][tri]*bary[hit][:,:,None]).sum(1); _,ii=trees[k].query(P3,workers=-1); out[hit]=sample(H[k]['TEX'],look[k][1][ii])
    img=out.reshape(TS,TS,3)
    # bleed colour a few texels past each patch so filtering never picks up black
    from scipy import ndimage as ndi
    _,idx=ndi.distance_transform_edt(~hit.reshape(TS,TS),return_indices=True); img=img[idx[0],idx[1]]
    Image.fromarray(np.clip(img,0,255).astype(np.uint8)).save(f'../carnos_tex_{"ABCDE"[k]}.jpg',quality=88); print('baked',H[k]['name'],flush=True)
np.save('/tmp/carnos_wrap.npy',dict(v=v,f=fb,W=W,H=H,reg=reg),allow_pickle=True)
json.dump(dict(regions=['torso','legs','arms','tail','neck','head'],mask=np.round(M,3).ravel().tolist()),open('../carnos_regions.json','w'))
# GLB: base + morph targets
# split vertices where the texture layout has a seam: one vertex per (position, texture coords) pair
keyuv=np.round(UVA.reshape(-1,2),5); pairs=np.c_[fb.reshape(-1),keyuv]; up,inv2=np.unique(pairs,axis=0,return_inverse=True); inv2=inv2.ravel()
src=up[:,0].astype(int); UVout=up[:,1:].astype(np.float32); FF=inv2.reshape(-1,3).astype(np.uint32)
V0=v[src].astype(np.float32); W=[w[src] for w in W]; Msplit=M[src]
json.dump(dict(regions=['torso','legs','arms','tail','neck','head'],mask=np.round(Msplit,3).ravel().tolist()),open('../carnos_regions.json','w'))
print('split for texture seams:',len(v),'->',len(V0),'vertices',flush=True)
bufs=[];views=[];accs=[]
def add(arr,target,comp,typ,minmax=False):
    off=sum(len(x) for x in bufs); pad=(4-off%4)%4
    if pad: bufs.append(b'\0'*pad); off+=pad
    raw=arr.tobytes(); bufs.append(raw); views.append({'buffer':0,'byteOffset':off,'byteLength':len(raw),'target':target})
    a={'bufferView':len(views)-1,'componentType':comp,'count':len(arr) if typ!='SCALAR' else arr.size,'type':typ}
    if minmax: a['min']=arr.min(0).tolist(); a['max']=arr.max(0).tolist()
    accs.append(a); return len(accs)-1
aP=add(V0,34962,5126,'VEC3',True); aT=add(UVout,34962,5126,'VEC2'); aI=add(FF.ravel(),34963,5125,'SCALAR')
targets=[{'POSITION':add(w.astype(np.float32)-V0,34962,5126,'VEC3',True)} for w in W]   # one per animal (A's is zero)
gl={'asset':{'version':'2.0','generator':'dino-lab carnos.py'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Carnos','mesh':0}],
 'meshes':[{'name':'CarnosBase','primitives':[{'attributes':{'POSITION':aP,'TEXCOORD_0':aT},'indices':aI,'targets':targets}],'weights':[0]*len(W),'extras':{'targetNames':[h['name'] for h in H]}}],
 'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':sum(len(x) for x in bufs)}]}
js=json.dumps(gl).encode(); js+=b' '*((4-len(js)%4)%4); bn=b''.join(bufs); bn+=b'\0'*((4-len(bn)%4)%4)
open('../carnos_base.glb','wb').write(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bn))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bn),0x004E4942)+bn)
print('carnos_base.glb',(len(bn)+len(js))//1024,'KB')
