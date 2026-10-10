"""Far features (horns, frills, crests) as solid signed-distance patches pinned to the base.
Per species: residual clusters -> drop mouth-interior ones -> box around each -> the sculpt's signed distance
in that box (int8), plus an anchor base vertex so the patch follows the morphed head at incubation."""
import sys; sys.path.insert(0,'/tmp/claude-0/-home-user-node-socket-io/16203f93-b1ad-5b15-91e7-2cd92cb90144/scratchpad/dino')
import numpy as np, json, struct
from scipy.spatial import cKDTree
from scipy import ndimage, sparse
from scipy.sparse.csgraph import connected_components
from wrap import sample
VOX=0.0025; THR=0.010; PAD=0.024; Q8=VOX/8; ENV=0.020
B=np.load('base9.npy',allow_pickle=True).item(); F=B['f']; heads=np.load('heads2_aligned.npy',allow_pickle=True)
meta=[]; blob=bytearray()
for k,H in enumerate(heads):
    Y=np.load(f'wrap9_{k}.npy'); Q,I=H['Q'],H['I']
    W,wt=sample(Y,F,0.0015); tw=cKDTree(W)
    fn=np.cross(Y[F[:,1]]-Y[F[:,0]],Y[F[:,2]]-Y[F[:,0]]); fn/=np.linalg.norm(fn,axis=1,keepdims=True)+1e-12
    d,j=tw.query(Q); side=((Q-W[j])*fn[wt[j]]).sum(1); far=(d>THR)&(side>0.7*d)
    T=I[far[I].any(1)]
    boxes=[]; featpts=[]
    if len(T):
        A=sparse.coo_matrix((np.ones(len(T)*3),(np.r_[T[:,0],T[:,1],T[:,2]],np.r_[T[:,1],T[:,2],T[:,0]])),shape=(len(Q),len(Q)))
        nc,lab=connected_components(A,directed=False); used=np.unique(T)
        la=np.tan(np.radians(H['lowerAngle']))
        for c in np.unique(lab[used]):
            vs=used[lab[used]==c]; vs=vs[far[vs]]
            if len(vs)<12 or d[vs].max()<0.012: continue
            cen=Q[vs].mean(0)
            if cen[0]>-0.02 and cen[1]<0.005 and cen[1]>cen[0]*la-0.01: continue      # inside the mouth: tongue / palate
            boxes.append((Q[vs].min(0)-PAD,Q[vs].max(0)+PAD,cen))
            ft=I[np.isin(I,vs).all(1)]
            featpts.append(sample(Q,ft,0.0015)[0] if len(ft) else Q[vs])   # dense feature surface, not sparse vertices
    # merge overlapping boxes
    merged=[]
    for lo,hi,c in boxes:
        for m in merged:
            if np.all(lo<m[1]) and np.all(hi>m[0]): m[0]=np.minimum(m[0],lo); m[1]=np.maximum(m[1],hi); break
        else: merged.append([lo,hi])
    entry={'boxes':[]}
    if merged:
        # sculpt signed distance on a grid over the whole sculpt (flood-fill sign), then cut the boxes out
        S,_=sample(Q,I,0.0015); glo=Q.min(0)-0.02; ghi=Q.max(0)+0.02; dims=np.ceil((ghi-glo)/VOX).astype(int)+1
        G=np.stack(np.meshgrid(*[glo[a]+np.arange(dims[a])*VOX for a in range(3)],indexing='ij'),-1).reshape(-1,3)
        dd=cKDTree(S).query(G,workers=-1)[0].reshape(dims)
        lab,_=ndimage.label(dd>VOX*0.9)
        border=set(np.unique(np.r_[lab[0].ravel(),lab[-1].ravel(),lab[:,0].ravel(),lab[:,-1].ravel(),lab[:,:,0].ravel(),lab[:,:,-1].ravel()]))-{0}
        inside=~np.isin(lab,list(border))
        inside=ndimage.binary_opening(inside,iterations=1)          # drop paper-thin inner shells
        inside=ndimage.binary_fill_holes(inside)
        sdf=(ndimage.distance_transform_edt(~inside)-ndimage.distance_transform_edt(inside))*VOX
        tv=cKDTree(Y); fp=cKDTree(np.vstack(featpts))
        for lo,hi in merged:
            i0=np.clip(np.floor((lo-glo)/VOX).astype(int),0,dims-1); i1=np.clip(np.ceil((hi-glo)/VOX).astype(int),0,dims-1)
            sub=sdf[i0[0]:i1[0]+1,i0[1]:i1[1]+1,i0[2]:i1[2]+1]
            # keep the sculpt's solid only within ENV of the far feature itself (no jaws, no unrelated skin)
            g=np.stack(np.meshgrid(*[glo[a]+np.arange(i0[a],i1[a]+1)*VOX for a in range(3)],indexing='ij'),-1).reshape(-1,3)
            env=fp.query(g,workers=-1)[0].reshape(sub.shape)-ENV
            sub=np.maximum(sub,env)
            q=np.clip(np.round(sub/Q8),-127,127).astype(np.int8)
            org=glo+i0*VOX; cen=org+np.array(sub.shape)*VOX/2; av=int(tv.query(cen)[1])
            entry['boxes'].append(dict(origin=org.tolist(),dims=list(sub.shape),off=len(blob),anchor=av,anchorPos=Y[av].tolist()))
            blob+=q.transpose(2,1,0).tobytes()                   # x fastest
            while len(blob)%4: blob+=b'\0'
    meta.append(entry); print('species',k,'feature patches',len(entry['boxes']),[b['dims'] for b in entry['boxes']],flush=True)
hdr=json.dumps({'vox':VOX,'q':Q8,'species':meta}).encode(); hdr+=b' '*((4-len(hdr)%4)%4)
open('/home/user/node-socket.io/dino-lab/features.bin','wb').write(struct.pack('<I',len(hdr))+hdr+bytes(blob))
print('features.bin',(len(blob)+len(hdr))//1024,'KB')
