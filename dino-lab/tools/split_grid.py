"""Split a Tripo sheet of heads laid out in a grid (columns along x, rows along y), straighten each by symmetry.
usage: split_grid.py <in.glb> <cols> <rows> <out.npy>"""
import sys; sys.path.insert(0,'.')
from glbio import load
import numpy as np
from scipy.spatial import cKDTree
path,cols,rows,out=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),sys.argv[4]
P,N,UV,I,img=load(path)
n=len(P); par=np.arange(n)
def f(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in I: a,b,c=f(t[0]),f(t[1]),f(t[2]); par[b]=a; par[c]=a
r=np.array([f(i) for i in range(n)])
lo,hi=P.min(0),P.max(0)
cx=lo[0]+(np.arange(cols)+0.5)*(hi[0]-lo[0])/cols; cy=lo[1]+(np.arange(rows)+0.5)*(hi[1]-lo[1])/rows
cell={}
for k in np.unique(r):
    m=r==k; c=P[m].mean(0)
    # junk: a large piece with very few vertices (flat slab / plank), not part of any head
    ext=np.ptp(P[m],0).max()
    if m.sum()<=6 and ext>0.05: print('dropping junk piece:',m.sum(),'verts, extent %.3f'%ext); continue
    i=np.abs(cx-c[0]).argmin(); j=np.abs(cy-c[1]).argmin()
    cell.setdefault((rows-1-j)*cols+i,[]).append(m)          # numbered left-to-right, top-to-bottom
def mirror_err(Q):
    M=Q.copy(); M[:,2]*=-1; return np.mean(cKDTree(Q).query(M[::3])[0])
heads=[]
for idx in sorted(cell):
    keep=np.zeros(n,bool)
    for m in cell[idx]: keep|=m
    T=I[keep[I[:,0]]]; vs=np.unique(T); rm=-np.ones(n,int); rm[vs]=np.arange(len(vs))
    H=dict(P=P[vs].copy(),N=N[vs].copy(),UV=UV[vs].copy(),I=rm[T],cell=idx)
    # drop flat junk: pieces that are much wider than tall and far from the head's centre of mass
    Q=H['P']-np.median(H['P'],0); best=None
    for yaw in np.radians(np.arange(-180,180,2)):
        c,s=np.cos(yaw),np.sin(yaw); R=np.array([[c,0,s],[0,1,0],[-s,0,c]]); X=Q@R.T; X[:,2]-=X[:,2].mean()
        e=mirror_err(X)
        if best is None or e<best[0]: best=(e,yaw)
    e0,y0=best
    for yaw in y0+np.radians(np.arange(-2,2.01,0.25)):
        c,s=np.cos(yaw),np.sin(yaw); R=np.array([[c,0,s],[0,1,0],[-s,0,c]]); X=Q@R.T; X[:,2]-=X[:,2].mean(); e=mirror_err(X)
        if e<best[0]: best=(e,yaw)
    c,s=np.cos(best[1]),np.sin(best[1]); R=np.array([[c,0,s],[0,1,0],[-s,0,c]]); X=Q@R.T; X[:,2]-=X[:,2].mean()
    front=X[X[:,0]>np.percentile(X[:,0],80)]; back=X[X[:,0]<np.percentile(X[:,0],20)]
    if np.ptp(front[:,2])>np.ptp(back[:,2]): X[:,0]*=-1; X[:,2]*=-1; R=np.diag([-1,1,-1])@R
    H['P']=X; H['N']=H['N']@R.T; H['mirr']=best[0]
    print('head',idx,'verts',len(vs),'pieces',len(cell[idx]),'mirror error %.4f'%best[0],'size',np.ptp(X,0).round(3))
    heads.append(H)
np.save(out,np.array(heads,dtype=object),allow_pickle=True)
img.save(out.replace('.npy','_atlas.png'))
