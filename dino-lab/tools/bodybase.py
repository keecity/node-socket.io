"""Bodies: align (front = the sheet's pointed end, turned to +x; centred; z = 0 is the mirror plane), median-SDF base
body, wrap the base onto each body (direct/prefit, mirror fix). Outputs body_aligned.npy, bodybase.npy, bodywrap_k.npy."""
import sys; sys.path.insert(0,'.')
import numpy as np
from scipy.spatial import cKDTree
from scipy import ndimage
from skimage import measure
from wrap import sample, laplacian
from refine import wrap_species
B=[o for o in np.load('bodies.npy',allow_pickle=True) if o['kind']=='body']
H=[]
for k,o in enumerate(B):
    Q=o['v'].copy(); Q[:,0]*=-1; Q[:,2]*=-1                                # turn 180 degrees about y: pointed end to +x
    Q-=[0.5*(Q[:,0].min()+Q[:,0].max()),0.5*(Q[:,1].min()+Q[:,1].max()),0]
    H.append(dict(Q=Q,I=o['f'])); print('body',k,'size',np.ptp(Q,0).round(3))
np.save('body_aligned.npy',np.array(H,dtype=object),allow_pickle=True)
vox=0.006; lo=np.min([h['Q'].min(0) for h in H],0)-0.04; hi=np.max([h['Q'].max(0) for h in H],0)+0.04
dims=np.ceil((hi-lo)/vox).astype(int)+1
G=np.stack(np.meshgrid(*[lo[a]+np.arange(dims[a])*vox for a in range(3)],indexing='ij'),-1).reshape(-1,3)
Fs=[]
for h in H:
    S,_=sample(h['Q'],h['I'],0.003); d=cKDTree(S).query(G,workers=-1)[0].reshape(dims)
    lab,_=ndimage.label(d>vox*0.9); border=set(np.unique(np.r_[lab[0].ravel(),lab[-1].ravel(),lab[:,0].ravel(),lab[:,-1].ravel(),lab[:,:,0].ravel(),lab[:,:,-1].ravel()]))-{0}
    Fs.append(np.where(np.isin(lab,list(border)),d,-d))
Fm=ndimage.gaussian_filter(np.median(Fs,0),1.2)
v,f,_,_=measure.marching_cubes(Fm,0.0,spacing=(vox,)*3); v+=lo
Lap=laplacian(len(v),f)
for it in range(30): v=v+(0.5 if it%2==0 else -0.53)*(Lap@v-v)
M=v.copy(); M[:,2]*=-1; _,mi=cKDTree(v).query(M); v=0.5*(v+np.c_[v[mi,0],v[mi,1],-v[mi,2]])
np.save('bodybase.npy',dict(v=v,f=f),allow_pickle=True); print('base body',len(v),'verts',len(f),'tris')
for k,h in enumerate(H):
    Y,e=wrap_species(v,f,h); np.save(f'bodywrap_{k}.npy',Y); print('wrap body',k,'error %.2f mm'%(e*1000),flush=True)
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from view import shade
fig,ax=plt.subplots(2,3,figsize=(30,12))
for k,h in enumerate(H):
    Y=np.load(f'bodywrap_{k}.npy'); shade(h['Q'],h['I'],ax[0,k],[0,1],2); shade(Y,f,ax[1,k],[0,1],2)
    ax[0,k].set_title(f'body {k} sculpt'); ax[1,k].set_title(f'base wrapped onto body {k}')
plt.savefig('../in5/bodywrap.png',dpi=35,bbox_inches='tight')
