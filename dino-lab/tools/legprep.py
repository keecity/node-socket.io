"""Leg kit from biped_legs.glb: thigh, shin, foot, toe (four separate pieces laid out on the sheet, +x forward, y up).
Each piece in its own frame: origin at the joint end (proximal end's centre), +x toward the far end, y up, z sideways;
'ang' is the sculpted angle of that axis in the sheet's x-y plane (degrees), so the sculpted pose is the rest pose. leg.json."""
import numpy as np, json, struct, sys
from collections import Counter
FOOT_CUT=0.16
SHIN_SLIM=0.55
b=open(sys.argv[1] if len(sys.argv)>1 else '../biped_legs.glb','rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); B=b[20+l+8:]
def acc(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]; n={'SCALAR':1,'VEC3':3}[a['type']]; dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
    return np.frombuffer(B,dt,a['count']*n,bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
p=j['meshes'][0]['primitives'][0]; V=acc(p['attributes']['POSITION']).astype(float); F=acc(p['indices']).reshape(-1,3).astype(int)
U,inv=np.unique(np.round(V,5),axis=0,return_inverse=True); inv=inv.ravel(); F=inv[F]; V=U          # weld UV seams
F=F[(F[:,0]!=F[:,1])&(F[:,1]!=F[:,2])&(F[:,0]!=F[:,2])]
par=np.arange(len(V))
def f(x):
    while par[x]!=x: par[x]=par[par[x]]; x=par[x]
    return x
for t in F: a=f(t[0]); par[f(t[1])]=a; par[f(t[2])]=a
root=np.array([f(x) for x in range(len(V))])
def piece_of(test):
    for r in np.unique(root):
        m=root==r
        if test(V[m]): return m
# which piece is which, by where it sits on the sheet
parts={'thigh':lambda X:X[:,1].max()>0.7 and X[:,0].mean()<0, 'shin':lambda X:X[:,1].max()>0.7 and X[:,0].mean()>0,
       'foot':lambda X:X[:,1].max()<0.3 and X[:,0].mean()<0, 'toe':lambda X:X[:,1].max()<0.3 and X[:,0].mean()>0}
dirs={'thigh':(1,-1),'shin':(0,-1),'foot':(1,-0.7),'toe':(1,0)}          # rough proximal -> distal direction on the sheet
out={}
for name,test in parts.items():
    m=piece_of(test); vs=np.where(m)[0]; rm=-np.ones(len(V),int); rm[vs]=np.arange(len(vs)); T=rm[F[m[F[:,0]]]]; X=V[vs]
    d=np.array([*dirs[name],0.]); d/=np.linalg.norm(d); s=X@d; lo,hi=s.min(),s.max(); L0=hi-lo
    pe=X[s<lo+0.06*L0].mean(0); de=X[s>hi-0.06*L0].mean(0)
    if name=='foot': pe=X[X[:,1]>X[:,1].max()-0.03].mean(0)            # ankle: the top of the block
    ax=de-pe; L=np.linalg.norm(ax); ux=ax/L; up=np.array([0,1.,0]); uy=up-ux*(up@ux); uy/=np.linalg.norm(uy); uz=np.cross(ux,uy)
    Q=(X-pe)@np.stack([ux,uy,uz]).T; rad=float(np.median(np.hypot(Q[:,1],Q[:,2])))
    extra={}
    if name=='shin':
        # the lower shin carries a knob and an ankle flare that bulge out past the foot: past SHIN_SLIM of its length,
        # anything further than R0 from the shaft's centre line is pulled in (soft clamp, fading in over 10% of the length)
        m=np.abs(Q[:,0]-0.5*L)<0.02*L; cy,cz=(Q[m,1].min()+Q[m,1].max())/2,(Q[m,2].min()+Q[m,2].max())/2
        def jc(f):
            m=np.abs(Q[:,0]-f*L)<0.04*L; return [float((Q[m,1].min()+Q[m,1].max())/2),float((Q[m,2].min()+Q[m,2].max())/2)]
        extra={'jc0.04':jc(0.04),'jc0.86':jc(0.86)}
        R0=0.05; dy,dz=Q[:,1]-cy,Q[:,2]-cz; r=np.hypot(dy,dz)+1e-9
        fade=np.clip((Q[:,0]/L-SHIN_SLIM)/0.1,0,1); r2=np.where(r>R0,R0+(r-R0)*0.2,r); k=1+fade*(r2/r-1)
        Q=Q.copy(); Q[:,1]=cy+dy*k; Q[:,2]=cz+dz*k
        print('shin slimmed past %.0f%%: max radius below that now %.3f'%(SHIN_SLIM*100,np.hypot(Q[Q[:,0]>SHIN_SLIM*L,1]-cy,Q[Q[:,0]>SHIN_SLIM*L,2]-cz).max()))
    if name=='foot':
        # the foot block carries too much ankle column: cut it off above FOOT_CUT (sheet height) and cap the cut. The frame,
        # length and joint centres stay those of the full piece, so poses made before the trim still line up
        def jc(f):
            m=np.abs(Q[:,0]-f*L)<0.04*L; return [float((Q[m,1].min()+Q[m,1].max())/2),float((Q[m,2].min()+Q[m,2].max())/2)]
        extra={'jc0.04':jc(0.04),'jc0.86':jc(0.86)}
        keep=X[:,1]<=FOOT_CUT; T=T[keep[T].all(1)]
        e=Counter(tuple(sorted(x)) for t in T for x in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0])))
        nxt={}
        for t in T:
            for a_,b_ in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0])):
                if e[tuple(sorted((a_,b_)))]==1: nxt[b_]=a_          # boundary edge, walked against the face winding
        Q=list(map(list,Q))
        while nxt:
            v0=next(iter(nxt)); loop=[v0]
            while nxt.get(loop[-1]) is not None and nxt[loop[-1]]!=v0: loop.append(nxt.pop(loop[-1]))
            nxt.pop(loop[-1],None)
            if len(loop)<3: continue
            c=len(Q); Q.append(list(np.mean([Q[v] for v in loop],0)))
            T=np.vstack([T,[[loop[k],loop[(k+1)%len(loop)],c] for k in range(len(loop))]])
        Q=np.array(Q); used=np.unique(T); rm=-np.ones(len(Q),int); rm[used]=np.arange(len(used)); Q=Q[used]; T=rm[T]
        print('foot trimmed above y=%.2f: verts %d, cap loops closed'%(FOOT_CUT,len(Q)))
    out[name]=dict(pos=np.round(Q,5).ravel().tolist(),idx=T.ravel().tolist(),len=float(L),rad=rad,ang=float(np.degrees(np.arctan2(ux[1],ux[0]))),**extra)
    print(name,'verts',len(Q),'tris',len(T),'len %.3f rad %.3f ang %.1f'%(L,rad,out[name]['ang']))
json.dump(dict(parts=out,note='frame: origin at the joint end, +x toward the far end, y up, z sideways; ang = sculpted axis angle on the sheet (deg)'),open('../leg.json','w'))
