"""Adaptive refinement: wrap every species, find where the base falls short by a near amount (cheeks, ridges,
bosses), subdivide the base only there (symmetrically, crack-free), re-wrap, repeat.
Far gaps (horns, spikes, crests) are left for fused residual pieces."""
import sys; sys.path.insert(0,'.')
import numpy as np, time
from scipy.spatial import cKDTree
from wrap import wrap, prefit, sample
NEAR, FAR = 0.004, 0.012
heads=np.load('heads2_aligned.npy',allow_pickle=True)

def mirror_map(V):
    M=V.copy(); M[:,2]*=-1; return cKDTree(V).query(M)[1]

def wrap_species(V,F,H,init=None):
    S,_=sample(H['Q'],H['I'],0.003); best=None
    cands=[('direct',V),('prefit',prefit(V,H['Q']))] if init is None else [('warm',init)]
    for name,V0 in cands:
        X=wrap(V0,F,H['Q'],H['I'],iters=45 if init is None else 20); W,_=sample(X,F,0.003)
        e=cKDTree(W).query(S)[0].mean()+cKDTree(S).query(W)[0].mean()
        if best is None or e<best[0]: best=(e,X)
    X=best[1]; mi=mirror_map(V); tw=cKDTree(sample(X,F,0.003)[0])
    err={sd:np.mean(tw.query(S[sg*S[:,2]>0.004])[0]) for sd,sg in (('L',1),('R',-1))}
    sg=1 if err['L']<=err['R'] else -1
    Y=X.copy(); src=sg*V[:,2]>0; Y[~src]=(X[mi]*np.array([1,1,-1]))[~src]; Y[np.abs(V[:,2])<1e-4,2]=0
    return Y,best[0]

def near_error_tris(Y,F,H):
    """base triangles next to sculpt surface that sits NEAR..FAR outside (or inside) the wrapped base"""
    W,wt=sample(Y,F,0.0015); tw=cKDTree(W)
    fn=np.cross(Y[F[:,1]]-Y[F[:,0]],Y[F[:,2]]-Y[F[:,0]]); fn/=np.linalg.norm(fn,axis=1,keepdims=True)+1e-12
    d,j=tw.query(H['Q']); side=((H['Q']-W[j])*fn[wt[j]]).sum(1)
    sel=(d>NEAR)&(d<FAR)&(side>0.7*d)                     # real outward bulges only (inner shells excluded)
    t,c=np.unique(wt[j[sel]],return_counts=True)
    return t[c>=6]                                         # a cluster of sculpt points, not a stray sample

def subdivide(V,F,marked,attrs):
    """1->4 split of marked triangles, closure so no T-junctions; neighbours with one split edge are bisected.
    attrs: list of (n,k) arrays interpolated at edge midpoints (wrapped species positions)."""
    F=F.copy(); marked=set(marked.tolist())
    def edges(t): a,b,c=F[t]; return [tuple(sorted((a,b))),tuple(sorted((b,c))),tuple(sorted((c,a)))]
    from collections import defaultdict
    e2t=defaultdict(list)
    for t in range(len(F)):
        for e in edges(t): e2t[e].append(t)
    while True:
        split=set(e for t in marked for e in edges(t)); add=set()
        for e in split:
            for t in e2t[e]:
                if t not in marked and sum(x in split for x in edges(t))>=2: add.add(t)
        if not add: break
        marked|=add
    split=sorted(set(e for t in marked for e in edges(t)))
    mid={}; newV=[V]; newA=[[A] for A in attrs]; n=len(V)
    for e in split:
        mid[e]=n; n+=1; newV.append(((V[e[0]]+V[e[1]])/2)[None])
        for i,A in enumerate(attrs): newA[i].append(((A[e[0]]+A[e[1]])/2)[None])
    out=[]
    for t in range(len(F)):
        a,b,c=F[t]; ab,bc,ca=tuple(sorted((a,b))),tuple(sorted((b,c))),tuple(sorted((c,a)))
        if t in marked:
            m1,m2,m3=mid[ab],mid[bc],mid[ca]; out+= [[a,m1,m3],[m1,b,m2],[m3,m2,c],[m1,m2,m3]]
        else:
            s=[e in mid for e in (ab,bc,ca)]
            if s[0]: m=mid[ab]; out+=[[a,m,c],[m,b,c]]
            elif s[1]: m=mid[bc]; out+=[[a,b,m],[a,m,c]]
            elif s[2]: m=mid[ca]; out+=[[a,b,m],[m,b,c]]
            else: out.append([a,b,c])
    return np.vstack(newV),np.array(out),[np.vstack(x) for x in newA],len(marked)

if __name__=='__main__':
    B=np.load('base9.npy',allow_pickle=True).item(); V,F=B['v'],B['f']
    t0=time.time(); Ys=[];E=[]
    for k,H in enumerate(heads):
        Y,e=wrap_species(V,F,H); Ys.append(Y); E.append(e); print(f'pass 0 head {k}: error {e*1000:.2f} mm',flush=True)
    for p in range(1,3):
        mi=mirror_map(V); tri_of={tuple(sorted(t)):i for i,t in enumerate(F)}
        marks=set()
        for k,H in enumerate(heads): marks|=set(near_error_tris(Ys[k],F,H).tolist())
        # symmetric: also mark each marked triangle's mirror; grow one ring for a soft density change
        marks|={tri_of.get(tuple(sorted(mi[F[t]])),t) for t in list(marks)}
        marks=np.array(sorted(marks),dtype=int)
        if len(marks)==0: print('nothing left to refine'); break
        V,F,Ys,nm=subdivide(V,F,marks,Ys)
        print(f'pass {p}: refined {nm} triangles -> {len(V)} verts, {len(F)} tris',flush=True)
        for k,H in enumerate(heads):
            Y,e=wrap_species(V,F,H,init=Ys[k]); Ys[k]=Y; print(f'  head {k}: error {E[k]*1000:.2f} -> {e*1000:.2f} mm',flush=True); E[k]=e
    np.save('base9r.npy',dict(v=V,f=F),allow_pickle=True)
    for k,Y in enumerate(Ys): np.save(f'wrap9_{k}.npy',Y)
    print('done in %.0fs'%(time.time()-t0))
