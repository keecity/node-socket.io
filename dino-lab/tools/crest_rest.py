import sys; sys.path.insert(0,'.')
import numpy as np
C=np.load('crest_raw.npy',allow_pickle=True).item(); V,F=C['v'],C['f']
heads=np.load('heads3_aligned.npy',allow_pickle=True); scale=float(heads[2]['scale'])
m=V.mean(0); _,_,Vt=np.linalg.svd(V-m,full_matrices=False); e3=Vt[2]
lo=V[V[:,1].argmin()]; hi=V[V[:,0].argmin()]
fx=lo-hi; fx-=e3*(fx@e3); fx/=np.linalg.norm(fx); up=np.array([0,1.,0]); fy=up-fx*(up@fx); fy-=e3*(fy@e3); fy/=np.linalg.norm(fy)
L0=(V-lo)@np.stack([fx,fy,np.cross(fx,fy)]).T; L0[:,2]-=np.median(L0[:,2]); L0*=scale
B=np.load('base3e.npy',allow_pickle=True).item(); Y=np.load('wrap3e_2.npy')
half=np.abs(L0[:,2]).max()
band=np.abs(Y[:,2])<half
def top(x): hv=Y[band&(np.abs(Y[:,0]-x)<0.008)]; return hv[:,1].max() if len(hv) else -1
def rest(x0, sink=0.006, touch=None, skip=0.05):
    touch = sink if touch is None else touch
    mid=np.flatnonzero(np.abs(B['v'][:,2])<0.004); cand=mid[np.abs(B['v'][mid,0]-x0)<0.012]
    a=int(cand[Y[cand,1].argmax()]); o=Y[a]-[0,sink,0]
    for deg in np.arange(-45,30,0.5):                       # swing down until the underside meets the skull
        t=np.radians(deg); R=np.array([[np.cos(t),-np.sin(t),0],[np.sin(t),np.cos(t),0],[0,0,1]]); X=L0@R.T+o
        pen=[top(x)-X[np.abs(X[:,0]-x)<0.008,1].min() for x in np.linspace(o[0]-skip,X[:,0].min(),25) if (np.abs(X[:,0]-x)<0.008).any() and top(x)>-1]
        if pen and max(pen)>=touch: return a,deg,X
    return a,deg,X
if __name__=='__main__':
    from view import shade
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    fig,ax=plt.subplots(1,3,figsize=(18,5))
    for i,x0 in enumerate([0.02,0.0,-0.02]):
        a,deg,X=rest(x0); print(x0,'anchor',a,'pitch',deg)
        A=ax[i]; shade(Y,B['f'],A,[0,1],2); shade(X,F,A,[0,1],2,np.tile([0.6,0.4,0.7],(len(F),1))); A.set_xlim(-0.5,0.3); A.set_ylim(-0.2,0.45); A.set_title(f'front end x {x0}, pitch {deg}')
    plt.savefig('../in3/crest_try3.png',dpi=40,bbox_inches='tight')
