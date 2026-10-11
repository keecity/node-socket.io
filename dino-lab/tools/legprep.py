"""Biped leg kit from biped_legs.glb: three whole legs (slim, medium, heavy), each sculpted in one piece from hip to toes,
in left/right copies (the left ones, z > 0, are used; the right side is mirrored in the viewer). Sheet: +x forward, y up.
For each leg the joints are found from its side profile (hip, knee, ankle, ball, three toe tips) and every vertex gets its
two nearest bones (thigh, shin, foot, toe1..3) with a blend at the joints, so the viewer can pose it by skinning.
Positions are relative to the hip. leg.json."""
import numpy as np, json, struct, sys
b=open(sys.argv[1] if len(sys.argv)>1 else '../biped_legs.glb','rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); B=b[20+l+8:]
def acc(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]; n={'SCALAR':1,'VEC3':3}[a['type']]; dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
    return np.frombuffer(B,dt,a['count']*n,bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
p=j['meshes'][0]['primitives'][0]; V=acc(p['attributes']['POSITION']).astype(float); F=acc(p['indices']).reshape(-1,3).astype(int)
U,inv=np.unique(np.round(V,5),axis=0,return_inverse=True); inv=inv.ravel(); F=inv[F]; V=U
F=F[(F[:,0]!=F[:,1])&(F[:,1]!=F[:,2])&(F[:,0]!=F[:,2])]
par=np.arange(len(V))
def f(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in F: a=f(t[0]); par[f(t[1])]=a; par[f(t[2])]=a
root=np.array([f(x) for x in range(len(V))])
left=[r for r in np.unique(root) if V[root==r][:,2].mean()>0]
left=sorted(left,key=lambda r:V[root==r][:,0].mean())                     # slim, medium, heavy (left to right on the sheet)
BONES=['thigh','shin','foot','toe1','toe2','toe3']
def centre(X,m): return np.array([(X[m,0].min()+X[m,0].max())/2,(X[m,1].min()+X[m,1].max())/2,(X[m,2].min()+X[m,2].max())/2])
types=[]
for name,r in zip(['slim','medium','heavy'],left):
    m=root==r; vs=np.where(m)[0]; rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); T=rm[F[m[F[:,0]]]]; X=V[vs].copy()
    y0,y1=X[:,1].min(),X[:,1].max(); H=y1-y0; Y=(X[:,1]-y0)/H                 # height fraction
    hip=X[Y>0.9].mean(0); hip[1]=y0+0.9*H
    # knee: the height (40-75%) where the leg reaches furthest forward
    ys=np.linspace(0.4,0.75,36); front=[X[np.abs(Y-y)<0.02,0].max() for y in ys]; yk=ys[int(np.argmax(front))]; knee=centre(X,np.abs(Y-yk)<0.025)
    # ankle: the height (15-45%) where the back of the leg reaches furthest back (the heel)
    ys=np.linspace(0.15,0.45,31); back=[X[np.abs(Y-y)<0.02,0].min() for y in ys]; ya=ys[int(np.argmin(back))]; ankle=centre(X,np.abs(Y-ya)<0.025)
    # ball: low on the metatarsus, straight under the ankle's column
    col=(np.abs(Y-0.1)<0.03)&(np.abs(X[:,0]-ankle[0])<0.06*H*1.5); ball=centre(X,col) if col.any() else ankle-np.array([0,0.7*(ankle[1]-y0),0])
    # toes: the low front points, split into three by side position; tip = furthest forward of each
    # toes fan out from the ball: take the low points well out from the ball and split them into three by their angle
    # around it (1-D k-means on the angle); tip = the furthest point of each, base = the ball pushed a little that way
    low=(Y<0.15); d=X[:,[0,2]]-ball[[0,2]]; rr=np.hypot(d[:,0],d[:,1]); out=low&(rr>0.55*rr[low].max()); ang=np.arctan2(d[out,1],d[out,0])
    ca=np.quantile(ang,[1/6,1/2,5/6])
    for _ in range(50): lab=np.argmin(np.abs(ang[:,None]-ca[None]),1); ca=np.array([ang[lab==k].mean() for k in range(3)])
    toes=[]
    for k in np.argsort(ca):
        P_=X[out][lab==k]; dk=np.hypot(P_[:,0]-ball[0],P_[:,2]-ball[2]); tip=P_[np.argmax(dk)]
        dirk=np.array([np.cos(ca[k]),0,np.sin(ca[k])]); toes.append((ball+dirk*0.02*H,tip))
    segs=[(hip,knee),(knee,ankle),(ankle,ball)]+toes
    def segd(P,a,b):
        d=b-a; t=np.clip(((P-a)@d)/(d@d),0,1); return np.linalg.norm(P-(a+t[:,None]*d),axis=1)
    D=np.stack([segd(X,a,b) for a,b in segs],1)
    o=np.argsort(D,1); b1,b2=o[:,0],o[:,1]; d1=D[np.arange(len(X)),b1]; d2=D[np.arange(len(X)),b2]
    t=np.clip((d2-d1)/(0.06*H),0,1); w2=0.5*(1-t*t*(3-2*t))
    # toes: the generator made one toe a blob. Measure each toe (length, thickness), cut the one furthest from the others
    # off (capped), and copy the cleanest other toe onto its place, turned to its direction. The copy is kept as its own
    # closed piece (all on that toe's bone) and fused onto the foot in the viewer like every other join
    def toe_frame(k):
        a0,tp=toes[k]; L=np.linalg.norm(tp-a0); u=(tp-a0)/L; t=((X-a0)@u)/L; return a0,u,L,t
    st=[]
    for k in range(3):
        a0,u,L,t=toe_frame(k); m=(b1==3+k)&(t>0.2); rad=np.linalg.norm((X[m]-a0)-np.outer(t[m]*L,u),axis=1); st.append((L,np.median(rad)))
    st=np.array(st); med=np.median(st,0); dev=np.abs(st/med-1).sum(1); bad=int(np.argmax(dev)); good=min((k for k in range(3) if k!=bad),key=lambda k:dev[k])
    CUT=0.08                                                                 # fraction along the toe where it is cut
    def cap(T,Q):
        from collections import Counter
        e=Counter(tuple(sorted(x)) for tr in T for x in ((tr[0],tr[1]),(tr[1],tr[2]),(tr[2],tr[0]))); nxt={}
        for tr in T:
            for a_,b_ in ((tr[0],tr[1]),(tr[1],tr[2]),(tr[2],tr[0])):
                if e[tuple(sorted((a_,b_)))]==1: nxt[b_]=a_
        Q=list(map(list,Q)); T=[list(x) for x in T]
        while nxt:
            v0=next(iter(nxt)); loop=[v0]
            while nxt.get(loop[-1]) is not None and nxt[loop[-1]]!=v0: loop.append(nxt.pop(loop[-1]))
            nxt.pop(loop[-1],None)
            if len(loop)<3: continue
            c=len(Q); Q.append(list(np.mean([Q[v] for v in loop],0))); T+=[[loop[i],loop[(i+1)%len(loop)],c] for i in range(len(loop))]
        return np.array(T),np.array(Q)
    def sub(keep,T,Q):
        Tk=T[keep[T].all(1)]; used=np.unique(Tk); rm=-np.ones(len(Q),int); rm[used]=np.arange(len(used)); return rm[Tk],Q[used],used
    # the copy: the good toe past the cut, capped, turned and moved onto the bad toe's root
    ag,ug,Lg,tg=toe_frame(good); ab,ub,Lb,tb=toe_frame(bad)
    dg=np.linalg.norm((X-ag)-np.outer(tg*Lg,ug),axis=1); inside=(tg>-0.06)&(tg<1.15)&(dg<2.2*st[good][1])
    Tg,Qg,_=sub(inside,T,X)
    # keep only the toe itself: the largest connected piece of the selection (stray bits of foot surface become slivers)
    pr=np.arange(len(Qg))
    def fr(x):
        while pr[x]!=x: pr[x]=pr[pr[x]]; x=pr[x]
        return x
    for tr in Tg: r0=fr(tr[0]); pr[fr(tr[1])]=r0; pr[fr(tr[2])]=r0
    rt=np.array([fr(x) for x in range(len(Qg))]); big=np.bincount(rt).argmax(); Tg,Qg,_=sub(rt==big,Tg,Qg)
    # no cap on the copy: its open root is buried in the foot (a fan over that uneven edge makes spikes)
    v=np.cross(ug,ub); c_=ug@ub; Vx=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]]); Rm=np.eye(3)+Vx+Vx@Vx/(1+c_)
    Qc=(Qg-(ag+ug*CUT*Lg))@Rm.T+(ab+ub*CUT*Lb)
    # the leg without the bad toe (cut a little further out than the copy starts, so the copy overlaps the stump)
    db=np.linalg.norm((X-ab)-np.outer(tb*Lb,ub),axis=1); keep=~((tb>CUT+0.05)&(tb<1.2)&(db<3.2*st[bad][1])); T,X2,used=sub(keep,T,X); T,X2=cap(T,X2)
    nold=len(used); bi_=np.stack([b1,b2],1)[used]; bw_=w2[used]
    ncap=len(X2)-nold; bi_=np.vstack([bi_,np.full((ncap,2),3+bad)]); bw_=np.concatenate([bw_,np.zeros(ncap)])
    X=X2; b1,b2,w2=bi_[:,0],bi_[:,1],bw_
    toes[bad]=(ab,ab+ub*Lg)
    toe_copy=dict(pos=Qc,idx=Tg,bone=3+bad)
    print('  toe%d (length %.3f, thickness %.3f) replaced by a copy of toe%d (length %.3f, thickness %.3f)'%(bad+1,*st[bad],good+1,*st[good]))
    X-=hip
    J=lambda p:np.round(np.asarray(p)-hip,5).tolist()
    toe_copy['pos']=toe_copy['pos']-hip
    types.append(dict(name=name,toe=dict(pos=np.round(toe_copy['pos'],5).ravel().tolist(),idx=np.asarray(toe_copy['idx']).ravel().tolist(),bone=toe_copy['bone']),pos=np.round(X,5).ravel().tolist(),idx=np.asarray(T).ravel().tolist(),bi=np.stack([b1,b2],1).ravel().tolist(),bw=np.round(w2,4).tolist(),
        height=float(H),rad=float(np.median(np.abs(X[:,2]-X[:,2].mean()))),joints=dict(hip=J(hip),knee=J(knee),ankle=J(ankle),ball=J(ball),toes=[[J(a),J(b)] for a,b in toes])))
    print(name,'verts',len(X),'H %.3f knee %.2f ankle %.2f'%(H,yk,ya),'bones used',np.bincount(b1,minlength=6))
json.dump(dict(types=types,bones=BONES,note='whole legs, positions relative to the hip; bi/bw: two bones per vertex (index into bones), bw = weight of the second'),open('../leg.json','w'))
