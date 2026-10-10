"""Symmetrise each species wrap: keep the side that fits its sculpt better and mirror it onto the other side.
The base is exactly symmetric, so every vertex has a mirror partner (mi)."""
import sys; sys.path.insert(0,'.')
import numpy as np
from scipy.spatial import cKDTree
from wrap import sample
from transfer import transfer_uv
B=np.load('base.npy',allow_pickle=True).item(); heads=np.load('heads_aligned.npy',allow_pickle=True)
V,F=B['v'],B['f']
M=V.copy(); M[:,2]*=-1; d,mi=cKDTree(V).query(M)
print('mirror pairing max error %.5f'%d.max())
uvs=[]
for h,H in enumerate(heads):
    X=np.load(f'wrap{h}.npy')
    S,_=sample(H['Q'],H['I'],0.003); W,_=sample(X,F,0.003); tw=cKDTree(W)
    err={}
    for side,sg in (('left',1),('right',-1)):
        s=S[sg*S[:,2]>0.004]; err[side]=np.mean(tw.query(s)[0])           # how well this side of the sculpt is covered
    keep=min(err,key=err.get); sg=1 if keep=='left' else -1
    Y=X.copy(); src=sg*V[:,2]>0                                            # vertices on the kept side
    mir=X[mi]*np.array([1,1,-1])
    Y[~src]=mir[~src]                                                      # other side = mirror of kept side
    mid=np.abs(V[:,2])<1e-4; Y[mid,2]=0                                    # midline exactly on the plane
    np.save(f'wrap{h}.npy',Y); uvs.append(transfer_uv(Y,F,H['Q'],H['I'],H['UV']))
    print(f'head {h}: left gap {err["left"]*1000:.2f} mm, right gap {err["right"]*1000:.2f} mm -> mirror {keep} side')
np.save('uvs.npy',np.array(uvs))
