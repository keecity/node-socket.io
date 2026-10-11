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
    low=(Y<0.12)&(X[:,0]>ball[0]+0.04*H); zs=np.sort(X[low,2]); cuts=np.quantile(zs,[1/3,2/3])
    toes=[]
    for k in range(3):
        mk=low&(X[:,2]>=(cuts[k-1] if k else -9))&(X[:,2]<(cuts[k] if k<2 else 9)); tip=X[mk][np.argmax(X[mk,0])]
        base=np.array([ball[0],ball[1],X[mk,2].mean()]); toes.append((base,tip))
    segs=[(hip,knee),(knee,ankle),(ankle,ball)]+toes
    def segd(P,a,b):
        d=b-a; t=np.clip(((P-a)@d)/(d@d),0,1); return np.linalg.norm(P-(a+t[:,None]*d),axis=1)
    D=np.stack([segd(X,a,b) for a,b in segs],1)
    o=np.argsort(D,1); b1,b2=o[:,0],o[:,1]; d1=D[np.arange(len(X)),b1]; d2=D[np.arange(len(X)),b2]
    t=np.clip((d2-d1)/(0.06*H),0,1); w2=0.5*(1-t*t*(3-2*t))
    # toes: the generator sculpted them unevenly (one is a blob). Each toe is reshaped in its own frame (base -> tip) to the
    # median length and thickness of the three; the change fades out where the toe's weight hands over to the foot
    infl=np.zeros((len(X),3))
    for k in range(3):
        infl[:,k]=np.where(b1==3+k,1-w2,0)+np.where(b2==3+k,w2,0)
    stats=[]
    for k,(a0,tp) in enumerate(toes):
        ax=tp-a0; L=np.linalg.norm(ax); u=ax/L; m=infl[:,k]>0.5; R_=X[m]-a0; t=R_@u; rad=np.linalg.norm(R_-np.outer(t,u),axis=1)
        stats.append((L,np.median(rad)))
    Lm=np.median([q[0] for q in stats]); Rm=np.median([q[1] for q in stats])
    for k,(a0,tp) in enumerate(toes):
        L,Rk=stats[k]; u=(tp-a0)/L; R_=X-a0; t=R_@u; perp=R_-np.outer(t,u)
        Y_=a0+np.outer(t*Lm/L,u)+perp*(Rm/Rk); w_=infl[:,k][:,None]; X=X*(1-w_)+Y_*w_
        toes[k]=(a0,a0+u*Lm)
        print('  toe%d: length %.3f -> %.3f, thickness %.3f -> %.3f'%(k+1,L,Lm,Rk,Rm))
    X-=hip
    J=lambda p:np.round(np.asarray(p)-hip,5).tolist()
    types.append(dict(name=name,pos=np.round(X,5).ravel().tolist(),idx=T.ravel().tolist(),bi=np.stack([b1,b2],1).ravel().tolist(),bw=np.round(w2,4).tolist(),
        height=float(H),rad=float(np.median(np.abs(X[:,2]-X[:,2].mean()))),joints=dict(hip=J(hip),knee=J(knee),ankle=J(ankle),ball=J(ball),toes=[[J(a),J(b)] for a,b in toes])))
    print(name,'verts',len(X),'H %.3f knee %.2f ankle %.2f'%(H,yk,ya),'bones used',np.bincount(b1,minlength=6))
json.dump(dict(types=types,bones=BONES,note='whole legs, positions relative to the hip; bi/bw: two bones per vertex (index into bones), bw = weight of the second'),open('../leg.json','w'))
