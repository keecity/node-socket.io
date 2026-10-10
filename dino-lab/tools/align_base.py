import sys; sys.path.insert(0,'/tmp/claude-0/-home-user-node-socket-io/16203f93-b1ad-5b15-91e7-2cd92cb90144/scratchpad/dino')
import numpy as np
from scipy.spatial import cKDTree
from scipy import ndimage
from skimage import measure
heads=np.load('heads_split.npy',allow_pickle=True)
# ---- 1. align by the jaw: hinge -> origin, upper jaw line -> +x, same upper-jaw length
lens=[]
for H in heads:
    L=H['L']; a=np.radians(L['upperAngle']); c,s=np.cos(-a),np.sin(-a); Rz=np.array([[c,-s,0],[s,c,0],[0,0,1]])
    Q=(H['P']-np.array([L['hinge'][0],L['hinge'][1],0]))@Rz.T
    up=Q[Q[:,1]>-0.01]; jl=up[:,0].max(); lens.append(jl)
    H['Q']=Q; H['NQ']=H['N']@Rz.T; H['lowerAngle']=L['lowerAngle']-L['upperAngle']; H['jawLen']=jl
target=float(np.mean(lens))
for H in heads:
    k=target/H['jawLen']; H['Q']*=k; H['scale']=k
    print('jaw length %.3f -> scale %.2f, lower jaw at %.1f°'%(H['jawLen'],k,H['lowerAngle']))
# ---- 2. generic base: average of the heads' signed distance fields
vox=0.0035
lo=np.min([H['Q'].min(0) for H in heads],0)-0.03; hi=np.max([H['Q'].max(0) for H in heads],0)+0.03
dims=np.ceil((hi-lo)/vox).astype(int)+1
gx,gy,gz=[lo[a]+np.arange(dims[a])*vox for a in range(3)]
G=np.stack(np.meshgrid(gx,gy,gz,indexing='ij'),-1).reshape(-1,3)
def sample_surface(P,I,step=0.0012):
    T=P[I]; out=[T.mean(1)]
    for t in T:
        e=max(np.linalg.norm(t[0]-t[1]),np.linalg.norm(t[0]-t[2]),np.linalg.norm(t[1]-t[2]))
        k=int(e/step)
        if k<1: continue
        u,v=np.meshgrid(np.linspace(0,1,k+1),np.linspace(0,1,k+1)); m=u+v<=1
        out.append(t[0]+u[m][:,None]*(t[1]-t[0])+v[m][:,None]*(t[2]-t[0]))
    return np.vstack(out)
fields=[]
for h,H in enumerate(heads):
    S=sample_surface(H['Q'],H['I']); H['S']=S
    d,_=cKDTree(S).query(G); d=d.reshape(dims)
    # outside = reachable from the grid boundary through voxels clear of the surface
    free=d>vox*0.9; lab,_=ndimage.label(free)
    border=set(np.unique(np.concatenate([lab[0].ravel(),lab[-1].ravel(),lab[:,0].ravel(),lab[:,-1].ravel(),lab[:,:,0].ravel(),lab[:,:,-1].ravel()])))-{0}
    outside=np.isin(lab,list(border))
    sdf=np.where(outside,d,-d); fields.append(sdf)
    print('head',h,'samples',len(S),'inside fraction %.3f'%(~outside).mean())
F=np.mean(fields,0)
v,f,_,_=measure.marching_cubes(F,0.0,spacing=(vox,vox,vox)); v+=lo
# keep the largest piece
n=len(v); par=np.arange(n)
def fd(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in f: a,b,c=fd(t[0]),fd(t[1]),fd(t[2]); par[b]=a; par[c]=a
r=np.array([fd(i) for i in range(n)]); u,c=np.unique(r,return_counts=True); keep=r==u[c.argmax()]
ft=f[keep[f[:,0]]]; vs=np.unique(ft); rm=-np.ones(n,int); rm[vs]=np.arange(len(vs)); v=v[vs]; f=rm[ft]
# Taubin smoothing
nb=[[] for _ in range(len(v))]
for a,b,c in f: nb[a]+= [b,c]; nb[b]+=[a,c]; nb[c]+=[a,b]
nb=[np.unique(x) for x in nb]
for it in range(12):
    lam=0.5 if it%2==0 else -0.53
    avg=np.array([v[x].mean(0) for x in nb]); v=v+lam*(avg-v)
print('base mesh',len(v),'verts',len(f),'tris')
np.save('base_raw.npy',dict(v=v,f=f,lo=lo,vox=vox),allow_pickle=True)
np.save('heads_aligned.npy',heads,allow_pickle=True)
