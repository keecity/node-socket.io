"""Per species: the parts of the sculpt the wrapped base could not reach (residual pieces)."""
import sys; sys.path.insert(0,'.')
import numpy as np
from scipy.spatial import cKDTree
from scipy import sparse
from scipy.sparse.csgraph import connected_components
from wrap import sample
B=np.load('base9.npy',allow_pickle=True).item(); F=B['f']
H1=np.load('heads_aligned.npy',allow_pickle=True); H2=np.load('heads2_aligned.npy',allow_pickle=True)
species=[(H2[k],np.load(f'wrap9_{k}.npy')) for k in range(len(H2))]
THR=0.010; GROW=0.008
out=[]
for s,(H,Y) in enumerate(species):
    Q,I=H['Q'],H['I']; W,wt=sample(Y,F,0.0015); tw=cKDTree(W)
    fn=np.cross(Y[F[:,1]]-Y[F[:,0]],Y[F[:,2]]-Y[F[:,0]]); fn/=np.linalg.norm(fn,axis=1,keepdims=True)+1e-12
    d,j=tw.query(Q)                                    # sculpt vertex -> wrapped base distance
    side=((Q-W[j])*fn[wt[j]]).sum(1)                   # >0: outside the base (protrusion), <0: inner shell
    far=(d>THR)&(side>0.7*d)
    # grow into a margin that overlaps the base, so the fuse has something to blend into
    near_far=cKDTree(Q[far]).query(Q,distance_upper_bound=GROW)[0]<np.inf if far.any() else far
    keep=far|near_far
    T=I[keep[I].all(1)]
    if len(T)==0: out.append(None); print(s,'no residual'); continue
    vs=np.unique(T); rm=-np.ones(len(Q),int); rm[vs]=np.arange(len(vs)); T=rm[T]; P=Q[vs]; dd=d[vs]
    # connected pieces; drop specks (< 40 tris or max gap < 6 mm)
    A=sparse.coo_matrix((np.ones(len(T)*3),(np.r_[T[:,0],T[:,1],T[:,2]],np.r_[T[:,1],T[:,2],T[:,0]])),shape=(len(P),len(P)))
    nc,lab=connected_components(A,directed=False)
    good=[c for c in range(nc) if (lab==c).sum()>=20 and dd[lab==c].max()>0.012]
    mask=np.isin(lab,good); T=T[mask[T].all(1)]
    if len(T)==0: out.append(None); print(s,'no residual'); continue
    vs=np.unique(T); rm=-np.ones(len(P),int); rm[vs]=np.arange(len(vs))
    piece=dict(P=P[vs],I=rm[T],gap=dd[vs],pieces=len(good))
    out.append(piece); print(s,H.get('cell',s),'residual pieces',len(good),'tris',len(T),'max gap %.1f mm'%(dd[vs].max()*1000))
np.save('residuals9.npy',np.array(out,dtype=object),allow_pickle=True)
