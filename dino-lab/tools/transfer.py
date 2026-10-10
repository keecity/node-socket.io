import sys; sys.path.insert(0,'.')
import numpy as np
from scipy.spatial import cKDTree
from wrap import sample
def closest_on_tri(p,a,b,c):
    """vectorised closest point (barycentric) on triangles abc for points p (Ericson 5.1.5)"""
    ab=b-a; ac=c-a; ap=p-a
    d1=(ab*ap).sum(1); d2=(ac*ap).sum(1)
    bp=p-b; d3=(ab*bp).sum(1); d4=(ac*bp).sum(1)
    cp=p-c; d5=(ab*cp).sum(1); d6=(ac*cp).sum(1)
    va=d3*d6-d5*d4; vb=d5*d2-d1*d6; vc=d1*d4-d3*d2
    den=1/np.where(np.abs(va+vb+vc)<1e-20,1e-20,va+vb+vc); v=vb*den; w=vc*den
    # region tests (vertex / edge regions)
    r=np.stack([1-v-w,v,w],1)
    m=(d1<=0)&(d2<=0); r[m]=[1,0,0]
    m=(d3>=0)&(d4<=d3); r[m]=[0,1,0]
    m=(d6>=0)&(d5<=d6); r[m]=[0,0,1]
    m=(vc<=0)&(d1>=0)&(d3<=0)&~((d1<=0)&(d2<=0)); t=d1/np.where(d1-d3==0,1,d1-d3); r[m]=np.stack([1-t,t,0*t],1)[m]
    m=(vb<=0)&(d2>=0)&(d6<=0)&~((d1<=0)&(d2<=0)); t=d2/np.where(d2-d6==0,1,d2-d6); r[m]=np.stack([1-t,0*t,t],1)[m]
    m=(va<=0)&((d4-d3)>=0)&((d5-d6)>=0); t=(d4-d3)/np.where((d4-d3)+(d5-d6)==0,1,(d4-d3)+(d5-d6)); r[m]=np.stack([0*t,1-t,t],1)[m]
    return np.clip(r,0,1)
def islands(I,n):
    par=np.arange(n)
    def f(x):
        while par[x]!=x: par[x]=par[par[x]]; x=par[x]
        return x
    for t in I: a,b,c=f(t[0]),f(t[1]),f(t[2]); par[b]=a; par[c]=a
    return np.array([f(t[0]) for t in I])
def transfer_uv(X,F,TP,TI,TUV):
    S,stid=sample(TP,TI,0.0012); isl=islands(TI,len(TP)); sisl=isl[stid]
    tree=cKDTree(S)
    cen=X[F].mean(1); _,j=tree.query(cen); tri_isl=sisl[j]
    out=np.zeros((len(F),3,2))
    for k in np.unique(tri_isl):
        tris=np.where(tri_isl==k)[0]; m=sisl==k
        t2=cKDTree(S[m]); stk=stid[m]
        P=X[F[tris]].reshape(-1,3); _,jj=t2.query(P); tt=stk[jj]
        a,b,c=TP[TI[tt,0]],TP[TI[tt,1]],TP[TI[tt,2]]; bc=closest_on_tri(P,a,b,c)
        uv=bc[:,0:1]*TUV[TI[tt,0]]+bc[:,1:2]*TUV[TI[tt,1]]+bc[:,2:3]*TUV[TI[tt,2]]
        out[tris]=uv.reshape(-1,3,2)
    return out
