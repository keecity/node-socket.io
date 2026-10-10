"""Add a new sheet of heads to the existing shared base: align at the jaw, wrap, keep the best fit, mirror-fix.
usage: add_heads.py <split.npy> <out prefix>"""
import sys; sys.path.insert(0,'/tmp/claude-0/-home-user-node-socket-io/16203f93-b1ad-5b15-91e7-2cd92cb90144/scratchpad/dino')
import numpy as np, time
from scipy.spatial import cKDTree
from wrap import wrap, prefit, sample
src,prefix=sys.argv[1],sys.argv[2]
B=np.load('base.npy',allow_pickle=True).item(); old=np.load('heads_aligned.npy',allow_pickle=True)
target=float(old[0]['jawLen']*old[0]['scale'])
V,F=B['v'],B['f']; M=V.copy(); M[:,2]*=-1; _,mi=cKDTree(V).query(M)
heads=np.load(src,allow_pickle=True); out=[]
for k,H in enumerate(heads):
    t=time.time(); L=H['L']; a=np.radians(L['upperAngle']); c,s=np.cos(-a),np.sin(-a); Rz=np.array([[c,-s,0],[s,c,0],[0,0,1]])
    Q=(H['P']-np.array([L['hinge'][0],L['hinge'][1],0]))@Rz.T
    jl=Q[Q[:,1]>-0.01][:,0].max(); Q*=target/jl
    H['Q']=Q; H['lowerAngle']=L['lowerAngle']-L['upperAngle']; H['scale']=target/jl; H['jawLen']=jl
    S,_=sample(Q,H['I'],0.003)
    best=None
    for name,V0 in (('direct',V),('prefit',prefit(V,Q))):
        X=wrap(V0,F,Q,H['I']); W,_=sample(X,F,0.003)
        e=cKDTree(W).query(S)[0].mean()+cKDTree(S).query(W)[0].mean()
        if best is None or e<best[0]: best=(e,name,X)
    X=best[2]; tw=cKDTree(sample(X,F,0.003)[0])
    err={sd:np.mean(tw.query(S[sg*S[:,2]>0.004])[0]) for sd,sg in (('left',1),('right',-1))}
    keep=min(err,key=err.get); sg=1 if keep=='left' else -1
    Y=X.copy(); src_side=sg*V[:,2]>0; mir=X[mi]*np.array([1,1,-1]); Y[~src_side]=mir[~src_side]; Y[np.abs(V[:,2])<1e-4,2]=0
    np.save(f'{prefix}{k}.npy',Y)
    print(f'head {k}: {best[1]} wrap, error {best[0]*1000:.2f} mm, kept {keep} side, gape {-H["lowerAngle"]:.1f}°, {time.time()-t:.0f}s',flush=True)
np.save(src.replace('_split','_aligned'),heads,allow_pickle=True)
