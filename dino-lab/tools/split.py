import sys; sys.path.insert(0,'.')
from glbio import load
import numpy as np
from scipy.spatial import cKDTree
P,N,UV,I,img=load('../dino_in/heads.glb')
n=len(P); par=np.arange(n)
def f(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in I:
    a,b,c=f(t[0]),f(t[1]),f(t[2]); par[b]=a; par[c]=a
r=np.array([f(i) for i in range(n)])
# each piece goes to the head whose centre (x = -0.36, 0, +0.36) is nearest its centroid
centres=np.array([-0.36,0.0,0.36])
heads=[]
for h in range(3):
    keep=np.zeros(n,bool)
    for k in np.unique(r):
        m=r==k
        if np.abs(P[m,0].mean()-centres).argmin()==h: keep|=m
    T=I[keep[I[:,0]]]; vs=np.unique(T); rm=-np.ones(n,int); rm[vs]=np.arange(len(vs))
    heads.append(dict(P=P[vs].copy(),N=N[vs].copy(),UV=UV[vs].copy(),I=rm[T]))
    print('head',h,'verts',len(vs),'tris',len(T))
def mirror_err(Q):
    M=Q.copy(); M[:,2]*=-1
    d,_=cKDTree(Q).query(M[::3]); return np.mean(d)
for h,H in enumerate(heads):
    Q=H['P']-H['P'].mean(0); best=None
    for yaw in np.radians(np.arange(-180,180,2)):
        c,s=np.cos(yaw),np.sin(yaw); R=np.array([[c,0,s],[0,1,0],[-s,0,c]])
        X=Q@R.T; X[:,2]-=X[:,2].mean()
        e=mirror_err(X)
        if best is None or e<best[0]: best=(e,yaw)
    # refine
    e0,y0=best
    for yaw in y0+np.radians(np.arange(-2,2.01,0.25)):
        c,s=np.cos(yaw),np.sin(yaw); R=np.array([[c,0,s],[0,1,0],[-s,0,c]]); X=Q@R.T; X[:,2]-=X[:,2].mean(); e=mirror_err(X)
        if e<best[0]: best=(e,yaw)
    yaw=best[1]; c,s=np.cos(yaw),np.sin(yaw); R=np.array([[c,0,s],[0,1,0],[-s,0,c]])
    X=Q@R.T; X[:,2]-=X[:,2].mean()
    # two mirror-symmetric yaws exist 180° apart: snout must point +x. The snout is the narrow end -> lower half-width
    xs=X[:,0]; front=X[xs>np.percentile(xs,80)]; back=X[xs<np.percentile(xs,20)]
    if np.ptp(front[:,2])>np.ptp(back[:,2]): X[:,0]*=-1; X[:,2]*=-1; R=np.diag([-1,1,-1])@R
    H['P']=X; H['N']=H['N']@R.T; H['yaw']=np.degrees(yaw); H['mirr']=best[0]
    print('head',h,'yaw %.1f°'%H['yaw'],'mirror error %.4f'%best[0],'size',np.ptp(X,0).round(3))
np.save('heads_split.npy',np.array(heads,dtype=object),allow_pickle=True)
