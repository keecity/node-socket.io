"""Split the ID-coloured sheet: weld seam-split vertices, group pieces into grid cells, straighten each head by
symmetry. Keeps a per-vertex ID colour sampled from the texture (corner samples averaged)."""
import sys; sys.path.insert(0,'.')
from glbio import load
import numpy as np
from scipy.spatial import cKDTree
path,cols,rows,out=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),sys.argv[4]
P,N,UV,I,img=load(path)
a=np.asarray(img).astype(float)/255; h,w=a.shape[:2]
def tex(uv): return a[np.clip((uv[:,1]*h).astype(int),0,h-1),np.clip((uv[:,0]*w).astype(int),0,w-1)]
# per-corner colour: sample slightly toward the triangle centre so seams don't bleed
cuv=UV[I]; cen=cuv.mean(1,keepdims=True); C=tex((cuv*0.8+cen*0.2).reshape(-1,2)).reshape(-1,3,3)
# weld
key=np.round(P/1e-5).astype(np.int64); _,wi,inv=np.unique(key,axis=0,return_index=True,return_inverse=True); inv=inv.ravel()
V=P[wi]; F=inv[I]; F=F[(F[:,0]!=F[:,1])&(F[:,1]!=F[:,2])&(F[:,0]!=F[:,2])]
col=np.zeros((len(V),3)); cnt=np.zeros(len(V))
for k in range(3): np.add.at(col,inv[I[:,k]],C[:,k]); np.add.at(cnt,inv[I[:,k]],1)
col/=np.maximum(cnt,1)[:,None]
print('welded',len(P),'->',len(V))
n=len(V); par=np.arange(n)
def f(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in F: x,y,z=f(t[0]),f(t[1]),f(t[2]); par[y]=x; par[z]=x
r=np.array([f(i) for i in range(n)])
lo,hi=V.min(0),V.max(0)
cx=lo[0]+(np.arange(cols)+0.5)*(hi[0]-lo[0])/cols; cy=lo[1]+(np.arange(rows)+0.5)*(hi[1]-lo[1])/rows
cell={}; small=[]
for k in np.unique(r):
    m=r==k; c=V[m].mean(0)
    if m.sum()<200: small.append(m); continue                 # spots, bumps: attach to the nearest head below
    i=np.abs(cx-c[0]).argmin(); j=np.abs(cy-c[1]).argmin()
    cell.setdefault((rows-1-j)*cols+i,[]).append(m)
owner=-np.ones(n,int)
for idx,ms in cell.items():
    for m in ms: owner[m]=idx
big=np.flatnonzero(owner>=0); tb=cKDTree(V[big])
for m in small:
    d,j=tb.query(V[m]); cell[owner[big[j[d.argmin()]]]].append(m)
def mirror_err(Q):
    M=Q.copy(); M[:,2]*=-1; return np.mean(cKDTree(Q).query(M[::3])[0])
heads=[]
for idx in sorted(cell):
    keep=np.zeros(n,bool)
    for m in cell[idx]: keep|=m
    T=F[keep[F[:,0]]]; vs=np.unique(T); rm=-np.ones(n,int); rm[vs]=np.arange(len(vs))
    H=dict(P=V[vs].copy(),C=col[vs].copy(),I=rm[T],cell=idx)
    Q=H['P']-np.median(H['P'],0); best=None
    for yaw in np.radians(np.arange(-180,180,2)):
        c,s=np.cos(yaw),np.sin(yaw); R=np.array([[c,0,s],[0,1,0],[-s,0,c]]); X=Q@R.T; X[:,2]-=X[:,2].mean()
        e=mirror_err(X)
        if best is None or e<best[0]: best=(e,yaw)
    for yaw in best[1]+np.radians(np.arange(-2,2.01,0.25)):
        c,s=np.cos(yaw),np.sin(yaw); R=np.array([[c,0,s],[0,1,0],[-s,0,c]]); X=Q@R.T; X[:,2]-=X[:,2].mean(); e=mirror_err(X)
        if e<best[0]: best=(e,yaw)
    c,s=np.cos(best[1]),np.sin(best[1]); R=np.array([[c,0,s],[0,1,0],[-s,0,c]]); X=Q@R.T; X[:,2]-=X[:,2].mean()
    front=X[X[:,0]>np.percentile(X[:,0],80)]; back=X[X[:,0]<np.percentile(X[:,0],20)]
    if np.ptp(front[:,2])>np.ptp(back[:,2]): X[:,0]*=-1; X[:,2]*=-1
    H['P']=X; H['mirr']=best[0]
    print('cell',idx,'verts',len(vs),'tris',len(T),'pieces',len(cell[idx]),'mirror error %.4f'%best[0],'size',np.ptp(X,0).round(3))
    heads.append(H)
np.save(out,np.array(heads,dtype=object),allow_pickle=True)
