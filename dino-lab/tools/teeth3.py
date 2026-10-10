"""Tooth library from the teeth sheet: 3 serrated fangs (top row) and 3 molars (bottom row). Each tooth is welded,
its loose serration bits re-attached, and put in a standard frame: base at the origin, pointing +y, curving toward +x,
height 1. Molars: origin where crown meets root (the roots go into the gum). Exported as teeth.json."""
import sys; sys.path.insert(0,'.')
import numpy as np, json
from glbio import load
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
P,N,UV,I,img=load('../in4/teeth.glb')
key=np.round(P/1e-5).astype(np.int64); _,wi,inv=np.unique(key,axis=0,return_index=True,return_inverse=True); inv=inv.ravel(); V=P[wi]; F=inv[I]
F=F[(F[:,0]!=F[:,1])&(F[:,1]!=F[:,2])&(F[:,0]!=F[:,2])]
A=coo_matrix((np.ones(len(F)*3),(np.r_[F[:,0],F[:,1],F[:,2]],np.r_[F[:,1],F[:,2],F[:,0]])),shape=(len(V),len(V)))
_,lab=connected_components(A,directed=False); sz=np.bincount(lab)
big=[l for l in np.unique(lab[F[:,0]]) if sz[l]>100]; owner={l:l for l in big}
bigv=np.flatnonzero(np.isin(lab,big)); tb=cKDTree(V[bigv])
for l in np.unique(lab[F[:,0]]):
    if l in owner: continue
    owner[l]=lab[bigv[tb.query(V[lab==l].mean(0))[1]]]          # serration bits join their tooth
teeth=[]
for l in sorted(big,key=lambda l:(-V[lab==l][:,1].mean(),V[lab==l][:,0].mean())):
    members=[k for k,o in owner.items() if o==l]; m=np.isin(lab,members)
    T=F[m[F[:,0]]]; vs=np.unique(T); rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); X=V[vs].copy(); T=rm[T]
    fang=X[:,1].mean()>0.33
    X-=[X[:,0].mean(),0,X[:,2].mean()]
    if fang:
        base=X[X[:,1]<X[:,1].min()+0.02].mean(0); X-=base
        tip=X[X[:,1].argmax()]; H=tip[1]
        if tip[0]<0: X[:,0]*=-1; T=T[:,::-1]                       # curve toward +x (mirror keeps it a valid tooth)
    else:
        # crown-root junction: where the cross-section is widest below the crown top
        ys=np.linspace(X[:,1].min(),X[:,1].max(),40); w=[np.ptp(X[np.abs(X[:,1]-y)<0.01][:,0]) if (np.abs(X[:,1]-y)<0.01).sum()>3 else 0 for y in ys]
        top=X[:,1].max(); cej=ys[int(np.argmax(w))]-0.25*(top-ys[int(np.argmax(w))])
        X-=[0,cej,0]; H=top-cej
    X/=H
    crown=X[X[:,1]>(0.3 if fang else 0.0)]
    teeth.append(dict(kind='fang' if fang else 'molar',sink=0.3 if fang else 0.0,width=float(np.ptp(crown[:,0])),
                      pos=np.round(X,5).ravel().tolist(),idx=T.ravel().tolist()))   # sink: height of the gum line on the tooth
    print(teeth[-1]['kind'],'verts',len(X),'tris',len(T),'bbox',X.min(0).round(2),X.max(0).round(2))
json.dump(dict(teeth=teeth,note='frame: base at origin, +y toward the tip / crown, curve toward +x, height 1'),open('/home/user/node-socket.io/dino-lab/teeth.json','w'))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from view import shade
fig,ax=plt.subplots(1,len(teeth),figsize=(4*len(teeth),5))
for a,t in zip(ax,teeth): shade(np.array(t['pos']).reshape(-1,3),np.array(t['idx']).reshape(-1,3),a,[0,1],2); a.axhline(0,color='r'); a.set_title(t['kind'])
plt.savefig('../in4/teeth_norm.png',dpi=50,bbox_inches='tight')
