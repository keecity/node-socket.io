"""Quadruped leg kit from quadruped_legs.glb: thigh, shin, foot (three separate pieces on the sheet, +x forward, y up; the
foot carries its toes). Same frames as legprep.py: origin at the joint end, +x toward the far end, 'ang' the sculpted axis
angle (deg); joint centres measured on the full pieces. quad.json."""
import numpy as np, json, struct, sys
b=open(sys.argv[1] if len(sys.argv)>1 else '../quadruped_legs.glb','rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); B=b[20+l+8:]
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
comps=sorted(np.unique(root),key=lambda r:V[root==r][:,0].mean())          # left to right on the sheet: thigh, shin, foot
dirs={'thigh':(0.3,-1),'shin':(0,-1),'foot':(1,0)}
out={}
for name,r in zip(['thigh','shin','foot'],comps):
    m=root==r; vs=np.where(m)[0]; rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); T=rm[F[m[F[:,0]]]]; X=V[vs]
    d=np.array([*dirs[name],0.]); d/=np.linalg.norm(d); s=X@d; lo,hi=s.min(),s.max(); L0=hi-lo
    pe=X[s<lo+0.06*L0].mean(0); de=X[s>hi-0.06*L0].mean(0)
    if name=='foot': pe=X[X[:,1]>X[:,1].max()-0.03].mean(0); de=np.array([X[:,0].max(),pe[1],pe[2]])   # ankle: top of the pad; far end: the toe tips, level
    ax=de-pe; L=np.linalg.norm(ax); ux=ax/L; up=np.array([0,1.,0]); uy=up-ux*(up@ux); uy/=np.linalg.norm(uy); uz=np.cross(ux,uy)
    Q=(X-pe)@np.stack([ux,uy,uz]).T; rad=float(np.median(np.hypot(Q[:,1],Q[:,2])))
    out[name]=dict(pos=np.round(Q,5).ravel().tolist(),idx=T.ravel().tolist(),len=float(L),rad=rad,ang=float(np.degrees(np.arctan2(ux[1],ux[0]))))
    print(name,'verts',len(Q),'len %.3f rad %.3f ang %.1f'%(L,rad,out[name]['ang']))
json.dump(dict(parts=out,note='quadruped leg kit; frames as leg.json'),open('../quad.json','w'))
