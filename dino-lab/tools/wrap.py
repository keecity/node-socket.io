import sys; sys.path.insert(0,'/tmp/claude-0/-home-user-node-socket-io/16203f93-b1ad-5b15-91e7-2cd92cb90144/scratchpad/dino')
import numpy as np
from scipy.spatial import cKDTree
from scipy import sparse

def tri_normals(P,I):
    n=np.cross(P[I[:,1]]-P[I[:,0]],P[I[:,2]]-P[I[:,0]]); return n/(np.linalg.norm(n,axis=1,keepdims=True)+1e-12)
def vert_normals(P,I):
    fn=np.cross(P[I[:,1]]-P[I[:,0]],P[I[:,2]]-P[I[:,0]]); vn=np.zeros_like(P)
    for k in range(3): np.add.at(vn,I[:,k],fn)
    return vn/(np.linalg.norm(vn,axis=1,keepdims=True)+1e-12)
def sample(P,I,step=0.0015):
    """dense samples on the target with the triangle they came from and that triangle's normal"""
    T=P[I]; e=np.max(np.linalg.norm(T-np.roll(T,1,1),axis=2),1); k=np.maximum(1,(e/step).astype(int))
    pts=[];tid=[]
    for kk in np.unique(k):
        idx=np.where(k==kk)[0]; u,v=np.meshgrid(np.linspace(0,1,kk+1),np.linspace(0,1,kk+1)); m=u+v<=1; u=u[m];v=v[m]
        q=T[idx,0][:,None]+u[None,:,None]*(T[idx,1]-T[idx,0])[:,None]+v[None,:,None]*(T[idx,2]-T[idx,0])[:,None]
        pts.append(q.reshape(-1,3)); tid.append(np.repeat(idx,len(u)))
    return np.vstack(pts),np.concatenate(tid)
def laplacian(nv,F):
    rows=np.concatenate([F[:,0],F[:,1],F[:,2],F[:,1],F[:,2],F[:,0]]); cols=np.concatenate([F[:,1],F[:,2],F[:,0],F[:,0],F[:,1],F[:,2]])
    A=sparse.coo_matrix((np.ones(len(rows)),(rows,cols)),shape=(nv,nv)).tocsr(); A.data[:]=1
    deg=np.asarray(A.sum(1)).ravel(); return sparse.diags(1/np.maximum(deg,1))@A
def wrap(V,F,TP,TI,iters=45,verbose=False):
    """non-rigid fit of mesh (V,F) onto target (TP,TI); returns new vertex positions"""
    S,stid=sample(TP,TI); SN=tri_normals(TP,TI)[stid]; tree=cKDTree(S)
    Lap=laplacian(len(V),F); X=V.copy()
    sub=np.random.default_rng(0).choice(len(S),min(len(S),120000),replace=False)
    for it in range(iters):
        t=it/(iters-1); N=vert_normals(X,F)
        # forward: nearest target sample facing the same way
        d,j=tree.query(X,k=8); ok=(SN[j]*N[:,None,:]).sum(2)>0.2
        jj=np.where(ok.any(1),j[np.arange(len(X)),ok.argmax(1)],j[:,0]); fwd=S[jj]-X
        # backward: target samples pull their nearest (compatible) base vertex -> grows into horns/frills
        bt=cKDTree(X); db,vb=bt.query(S[sub]); okb=(SN[sub]*N[vb]).sum(1)>0.2
        acc=np.zeros_like(X); cnt=np.zeros(len(X))
        np.add.at(acc,vb[okb],S[sub][okb]-X[vb[okb]]); np.add.at(cnt,vb[okb],1)
        bwd=np.where(cnt[:,None]>0,acc/np.maximum(cnt,1)[:,None],0)
        D=0.6*fwd+0.4*bwd*(cnt[:,None]>0)+0.4*fwd*(cnt[:,None]==0)
        # stiffness: smooth the displacement field, many passes early (rigid-ish), few late (detailed)
        passes=int(40*(1-t)**2)+2
        for _ in range(passes): D=0.5*D+0.5*(Lap@D)
        X=X+D*(0.5+0.4*t)
        if verbose and it%10==0: print('  iter',it,'mean fwd dist %.4f'%np.linalg.norm(fwd,axis=1).mean())
    # final settle: project onto the surface with light smoothing
    for _ in range(3):
        d,j=tree.query(X); D=S[j]-X
        for _ in range(2): D=0.5*D+0.5*(Lap@D)
        X=X+D
    return X

def prefit(V,TP,pct=97):
    """piecewise scale about the hinge (origin) so the base's extents match the target's:
    separate factors for front/back (x), above/below (y) and width (z); percentiles ignore horn tips"""
    X=V.copy()
    for ax in (0,1):
        for sgn in (1,-1):
            mb=sgn*V[:,ax]>0; mt=sgn*TP[:,ax]>0
            if mb.sum()<10 or mt.sum()<10: continue
            k=np.percentile(sgn*TP[mt,ax],pct)/np.percentile(sgn*V[mb,ax],pct)
            X[mb,ax]=V[mb,ax]*k
    k=np.percentile(np.abs(TP[:,2]),pct)/np.percentile(np.abs(V[:,2]),pct); X[:,2]=V[:,2]*k
    return X
