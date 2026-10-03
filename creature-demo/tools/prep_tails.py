import json,struct,numpy as np,sys
f=sys.argv[1]; out=sys.argv[2]
d=open(f,'rb').read(); l=struct.unpack('<I',d[12:16])[0]; j=json.loads(d[20:20+l]); b=d[20+l+8:]
bv=j['bufferViews']; A=j['accessors']
def acc(i,n):
  a=A[i]; v=bv[a['bufferView']]; dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
  return np.frombuffer(b,dt,a['count']*n,v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n).astype(np.float64 if dt==np.float32 else np.int64)
prim=j['meshes'][0]['primitives'][0]
P=acc(prim['attributes']['POSITION'],3); N=acc(prim['attributes']['NORMAL'],3); I=acc(prim['indices'],1).reshape(-1,3)
# grid cell per vertex (4 cols x 4 rows): every triangle goes to the cell of its centroid
cx=np.array([-0.39,-0.14,0.11,0.36]); ry=np.array([0.58,0.42,0.25,0.07])
cen=P[I].mean(1)
col=np.abs(cen[:,0:1]-cx[None]).argmin(1); row=np.abs(cen[:,1:2]-ry[None]).argmin(1)
cell=row*4+col
tails=[]
for c in range(16):
  T=I[cell==c]
  # drop small disconnected fragments (stray bits from neighbouring cells)
  vs0=np.unique(T); par={v:v for v in vs0}
  def fd(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
  for tr in T: a0,b0,c0=fd(tr[0]),fd(tr[1]),fd(tr[2]); par[b0]=a0; par[c0]=a0
  rt=np.array([fd(tr[0]) for tr in T]); ids,cn=np.unique(rt,return_counts=True)
  # keep every real piece of the tail (many tails are several shells: segments, spikes, balls);
  # drop only specks and pieces far from the tail's main body
  main=ids[cn.argmax()]; mc=P[T[rt==main]].reshape(-1,3).mean(0)
  keep=[i for i,k in zip(ids,cn) if k>=60 and np.linalg.norm(P[T[rt==i]].reshape(-1,3).mean(0)[:2]-mc[:2])<0.14]
  T=T[np.isin(rt,keep)]
  vs=np.unique(T); remap=-np.ones(len(P),int); remap[vs]=np.arange(len(vs))
  p=P[vs].copy(); n=N[vs].copy(); t=remap[T]
  # principal axis; the two ends along it
  m=p.mean(0); U,S,Vt=np.linalg.svd(p-m,full_matrices=False); ax=Vt[0]
  s=(p-m)@ax; L=s.max()-s.min()
  ends=[]
  for sign in (1,-1):
    sel=(s*sign)>(s*sign).max()-0.1*L
    flat=np.linalg.norm(n[sel].mean(0))           # aligned normals → flat cut face
    rad=np.linalg.norm((p[sel]-p[sel].mean(0)) - np.outer((p[sel]-p[sel].mean(0))@ax,ax),axis=1).mean()
    ends.append(dict(sign=sign,c=p[sel].mean(0),flat=flat,rad=rad))
  # every root in this sheet sits at the upper-left of its cell (tips, clubs and balls hang lower-right)
  score=lambda e: -e['c'][0]+e['c'][1]
  root,tip=(ends[0],ends[1]) if score(ends[0])>score(ends[1]) else (ends[1],ends[0])
  # frame: x = root→tip chord, z = normal of the curl plane (least variance), y = z × x
  X=tip['c']-root['c']; chord=np.linalg.norm(X); X/=chord
  Z=Vt[2]-(Vt[2]@X)*X; Z/=np.linalg.norm(Z); Y=np.cross(Z,X)
  R=np.stack([X,Y,Z])                                # rows = new axes
  q=(p-root['c'])@R.T; nn=n@R.T
  # keep the natural droop: the tail's mass should sit below the chord (y<0); flip about x if not
  if q[:,1].mean()>0: q[:,1]*=-1; q[:,2]*=-1; nn[:,1]*=-1; nn[:,2]*=-1
  # tip slightly below root (droop ~25°) like the original kit tails
  a=np.radians(-25); Rz=np.array([[np.cos(a),-np.sin(a),0],[np.sin(a),np.cos(a),0],[0,0,1]])
  q=q@Rz.T; nn=nn@Rz.T
  q*=0.68                                            # one shared scale: tails keep their own relative lengths
  tails.append(dict(p=q,n=nn,t=t,flat=(round(root['flat'],2),round(tip['flat'],2)),cell=c))
  print('tail',c,'verts',len(q),'tris',len(t),'root/tip flatness',tails[-1]['flat'])
# pack: per tail header + int16 positions (bbox-quantised) + int8 normals + uint16 indices
blob=bytearray(); meta=[]
for tl in tails:
  p=tl['p']; mn=p.min(0); mx=p.max(0); sc=(mx-mn)/65535
  qp=np.round((p-mn)/np.maximum(sc,1e-12)).astype(np.uint16)
  qn=np.clip(np.round(tl['n']/np.linalg.norm(tl['n'],axis=1,keepdims=True)*127),-127,127).astype(np.int8)
  idx=tl['t'].astype(np.uint16)
  off=len(blob); blob+=qp.tobytes()
  while len(blob)%4: blob+=b'\0'
  noff=len(blob); blob+=qn.tobytes()
  while len(blob)%4: blob+=b'\0'
  ioff=len(blob); blob+=idx.tobytes()
  while len(blob)%4: blob+=b'\0'
  meta.append(dict(n=len(p),t=int(idx.size),off=off,noff=noff,ioff=ioff,min=mn.tolist(),scale=sc.tolist()))
hdr=json.dumps(meta).encode(); hdr+=b' '*((4-len(hdr)%4)%4)
open(out,'wb').write(struct.pack('<I',len(hdr))+hdr+bytes(blob))
print('packed',len(blob)//1024,'KB')
# preview: each normalised tail, root at origin (red dot)
import matplotlib;matplotlib.use('Agg');import matplotlib.pyplot as plt
fig,axs=plt.subplots(4,8,figsize=(24,10))
for i,tl in enumerate(tails):
  a1=axs[i//4][(i%4)*2]; a2=axs[i//4][(i%4)*2+1]
  a1.scatter(tl['p'][::2,0],tl['p'][::2,1],s=.2); a1.plot(0,0,'ro'); a1.set_aspect('equal'); a1.set_title(f'{i} side')
  a2.scatter(tl['p'][::2,0],tl['p'][::2,2],s=.2,c='g'); a2.plot(0,0,'ro'); a2.set_aspect('equal'); a2.set_title(f'{i} top')
plt.tight_layout(); plt.savefig('tails_norm.png',dpi=55)
