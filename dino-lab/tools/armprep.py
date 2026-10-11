"""Arm kit from the arm sheet: upper arm, forearm, hand, finger. Each piece in its own frame: origin at the joint end
(the proximal end's centre), +x toward the far end, y up as sculpted, z sideways; lengths in sheet units. arm.json."""
import sys; sys.path.insert(0,'.')
import numpy as np, json
from collections import Counter
R=np.load('../in6/arm_raw.npy',allow_pickle=True).item(); V,F,lab=R['v'],R['f'],R['lab']
def piece(l):
    m=lab==l; T=F[m[F[:,0]]]; T=T[(T[:,0]!=T[:,1])&(T[:,1]!=T[:,2])&(T[:,0]!=T[:,2])]; vs=np.unique(T); rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); return V[vs].copy(), rm[T]
out={}
for name,l in [('upper',1),('fore',5),('hand',3),('finger',4)]:
    X,T=piece(l)
    e=Counter(tuple(sorted(x)) for t in T for x in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0]))); open_=sum(1 for v in e.values() if v==1)
    x0,x1=X[:,0].min(),X[:,0].max(); Lx=x1-x0
    pe=X[X[:,0]<x0+0.04*Lx].mean(0); de=X[X[:,0]>x1-0.04*Lx].mean(0)
    if name=='hand': pe=X[X[:,0]<x0+0.08*Lx].mean(0); de=np.array([x1,pe[1],pe[2]])
    ax=de-pe; L=np.linalg.norm(ax); ux=ax/L; up=np.array([0,1.,0]); uy=up-ux*(up@ux); uy/=np.linalg.norm(uy); uz=np.cross(ux,uy)
    Q=(X-pe)@np.stack([ux,uy,uz]).T
    rad=float(np.median(np.hypot(Q[:,1],Q[:,2])))
    out[name]=dict(pos=np.round(Q,5).ravel().tolist(),idx=T.ravel().tolist(),len=float(L),rad=rad,
                   ymin=float(Q[:,1].min()),ymax=float(Q[:,1].max()),zmax=float(np.abs(Q[:,2]).max()))
    print(name,'verts',len(Q),'open edges',open_,'length %.3f radius %.3f y %.3f..%.3f'%(L,rad,Q[:,1].min(),Q[:,1].max()))
json.dump(dict(parts=out,note='frame: origin at the joint end, +x toward the far end, y up, z sideways; sheet units'),open('/home/user/node-socket.io/dino-lab/arm.json','w'))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from view import shade
fig,ax=plt.subplots(1,4,figsize=(28,6))
for a,(k,p) in zip(ax,out.items()):
    Q=np.array(p['pos']).reshape(-1,3); shade(Q,np.array(p['idx']).reshape(-1,3),a,[0,1],2); a.axvline(0,color='r'); a.set_title(k)
plt.savefig('../in6/arm_parts.png',dpi=35,bbox_inches='tight')
