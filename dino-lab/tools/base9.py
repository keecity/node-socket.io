"""Generic base from the 9-head sheet only: averaged signed distance fields, smoothed, symmetric."""
import sys; sys.path.insert(0,'/tmp/claude-0/-home-user-node-socket-io/16203f93-b1ad-5b15-91e7-2cd92cb90144/scratchpad/dino')
import numpy as np
from scipy.spatial import cKDTree
from scipy import ndimage
from skimage import measure
from wrap import sample, laplacian
heads=np.load('heads2_aligned.npy',allow_pickle=True)
vox=0.004
lo=np.min([np.percentile(H['Q'],1,0) for H in heads],0)-0.03; hi=np.max([np.percentile(H['Q'],99,0) for H in heads],0)+0.03
dims=np.ceil((hi-lo)/vox).astype(int)+1
G=np.stack(np.meshgrid(*[lo[a]+np.arange(dims[a])*vox for a in range(3)],indexing='ij'),-1).reshape(-1,3)
F=[]
for k,H in enumerate(heads):
    S,_=sample(H['Q'],H['I'],0.002)
    d=cKDTree(S).query(G,workers=-1)[0].reshape(dims)
    lab,_=ndimage.label(d>vox*0.9)
    border=set(np.unique(np.r_[lab[0].ravel(),lab[-1].ravel(),lab[:,0].ravel(),lab[:,-1].ravel(),lab[:,:,0].ravel(),lab[:,:,-1].ravel()]))-{0}
    F.append(np.where(np.isin(lab,list(border)),d,-d)); print('field',k,flush=True)
# median, not mean: features only a few species have (horns, crests, spikes) drop out of the base
Fm=np.median(F,0)
Fm=ndimage.gaussian_filter(Fm,1.2)
v,f,_,_=measure.marching_cubes(Fm,0.0,spacing=(vox,)*3); v+=lo
n=len(v); par=np.arange(n)
def fd(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in f: a,b,c=fd(t[0]),fd(t[1]),fd(t[2]); par[b]=a; par[c]=a
r=np.array([fd(i) for i in range(n)]); u,c=np.unique(r,return_counts=True); keep=r==u[c.argmax()]
ft=f[keep[f[:,0]]]; vs=np.unique(ft); rm=-np.ones(n,int); rm[vs]=np.arange(len(vs)); v=v[vs]; f=rm[ft]
Lap=laplacian(len(v),f)
for it in range(40): v=v+(0.5 if it%2==0 else -0.53)*(Lap@v-v)
M=v.copy(); M[:,2]*=-1; _,mi=cKDTree(v).query(M); v=0.5*(v+np.c_[v[mi,0],v[mi,1],-v[mi,2]])
np.save('base9.npy',dict(v=v,f=f),allow_pickle=True); print('base9',len(v),'verts',len(f),'tris')
