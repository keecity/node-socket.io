"""Bodies from the body sheet are sculpted on +z only. Each is rebuilt as a solid whose -z half mirrors the +z half:
signed distance field of the piece, F(x,y,z) <- F(x,y,|z - zc|) about its centre plane, remeshed (marching cubes),
light Taubin smoothing. Output: bodies.npy (list of dict v,f) and a preview."""
import sys; sys.path.insert(0,'.')
import numpy as np
from glbio import load
from scipy.spatial import cKDTree
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from skimage import measure
from wrap import sample, laplacian
P,N,UV,I,img=load(sys.argv[1] if len(sys.argv)>1 else 'body.glb')
key=np.round(P/1e-5).astype(np.int64); _,wi,inv=np.unique(key,axis=0,return_index=True,return_inverse=True); inv=inv.ravel(); V=P[wi]; F=inv[I]
F=F[(F[:,0]!=F[:,1])&(F[:,1]!=F[:,2])&(F[:,0]!=F[:,2])]
A=coo_matrix((np.ones(len(F)*3),(np.r_[F[:,0],F[:,1],F[:,2]],np.r_[F[:,1],F[:,2],F[:,0]])),shape=(len(V),len(V)))
_,lab=connected_components(A,directed=False); sz=np.bincount(lab)
pieces=[l for l in np.unique(lab[F[:,0]]) if sz[l]>200]
out=[]
for l in sorted(pieces,key=lambda l:-V[lab==l][:,1].mean()):
    m=lab==l; T=F[m[F[:,0]]]; vs=np.unique(T); rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); X=V[vs].copy(); T=rm[T]
    if np.ptp(X[:,0]) < 0.3: print('piece',l,'is the cylinder, kept as is'); out.append(dict(v=X,f=T,kind='segment')); continue
    zc=0.5*(X[:,2].min()+X[:,2].max()); X[:,2]-=zc
    vox=0.003; lo=X.min(0)-0.02; lo[2]=0; hi=X.max(0)+0.02; hi[2]=max(hi[2],-X[:,2].min())+0.02
    dims=np.ceil((hi-lo)/vox).astype(int)+1
    G=np.stack(np.meshgrid(*[lo[a]+np.arange(dims[a])*vox for a in range(3)],indexing='ij'),-1).reshape(-1,3)
    S,_=sample(X,T,0.0015); d=cKDTree(S).query(G,workers=-1)[0].reshape(dims)
    labs,_=ndimage.label(d>vox*0.9)
    border=set(np.unique(np.r_[labs[0].ravel(),labs[-1].ravel(),labs[:,0].ravel(),labs[:,-1].ravel(),labs[:,:,-1].ravel()]))-{0}
    Fd=np.where(np.isin(labs,list(border)),d,-d)                         # z>=0 half only (the detailed side)
    full=np.concatenate([Fd[:,:,:0:-1],Fd],axis=2)                        # mirrored about z=0
    # blend across the mirror plane: smooth more along z near z=0 (where the two halves meet at an angle)
    soft=ndimage.gaussian_filter(full,(0.8,0.8,3.0)); zz=np.abs(np.arange(full.shape[2])-(dims[2]-1))*vox
    wz=np.clip(1-zz/0.02,0,1)[None,None,:]; full=ndimage.gaussian_filter(full,0.6)*(1-wz)+soft*wz
    v,f,_,_=measure.marching_cubes(full,0.0,spacing=(vox,)*3); v+=[lo[0],lo[1],-(dims[2]-1)*vox]
    # keep the largest piece only (drops thin slivers)
    A2=coo_matrix((np.ones(len(f)*3),(np.r_[f[:,0],f[:,1],f[:,2]],np.r_[f[:,1],f[:,2],f[:,0]])),shape=(len(v),len(v)))
    _,l2=connected_components(A2,directed=False); keep=l2==np.bincount(l2).argmax(); ft=f[keep[f[:,0]]]; us=np.unique(ft); r2=-np.ones(len(v),int); r2[us]=np.arange(len(us)); v=v[us]; f=r2[ft]
    Lap=laplacian(len(v),f)
    for it in range(10): v=v+(0.5 if it%2==0 else -0.53)*(Lap@v-v)
    out.append(dict(v=v,f=f,kind='body')); print('piece',l,'mirrored body',len(v),'verts','size',np.ptp(v,0).round(3))
np.save('bodies.npy',np.array(out,dtype=object),allow_pickle=True)
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from view import shade
B=[o for o in out if o['kind']=='body']
fig,ax=plt.subplots(len(B),3,figsize=(27,8*len(B)))
for r,o in enumerate(B):
    shade(o['v'],o['f'],ax[r,0],[0,1],2); shade(o['v'],o['f'],ax[r,1],[0,2],1); shade(o['v'],o['f'],ax[r,2],[2,1],0)
plt.savefig('../in5/bodies_mirrored.png',dpi=35,bbox_inches='tight')
