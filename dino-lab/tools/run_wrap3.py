import sys; sys.path.insert(0,'.')
import numpy as np
from scipy.spatial import cKDTree
from wrap import wrap, prefit, sample
from transfer import transfer_uv
B=np.load('base.npy',allow_pickle=True).item(); heads=np.load('heads_aligned.npy',allow_pickle=True)
uvs=[]; report=[]
def err(X,F,H):
    S,_=sample(H['Q'],H['I'],0.003); W,_=sample(X,F,0.003)
    cov=cKDTree(W).query(S)[0]; fit=cKDTree(S).query(W)[0]
    return cov.mean()+fit.mean(), np.percentile(cov,99)
for h,H in enumerate(heads):
    best=None
    for name,V0 in (('direct',B['v']),('prefit',prefit(B['v'],H['Q']))):
        X=wrap(V0,B['f'],H['Q'],H['I']); e,e99=err(X,B['f'],H)
        print(f'head {h} {name}: mean error {e*1000:.2f} mm, 99th pct gap {e99*1000:.1f} mm')
        if best is None or e<best[0]: best=(e,name,X,e99)
    np.save(f'wrap{h}.npy',best[2]); uvs.append(transfer_uv(best[2],B['f'],H['Q'],H['I'],H['UV']))
    report.append((h,best[1],best[0],best[3])); print(f'  -> head {h} uses {best[1]}')
np.save('uvs.npy',np.array(uvs))
