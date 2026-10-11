"""Base tooth: one shared topology (a closed, stretched sphere) wrapped onto every tooth, so fangs and molars blend
per vertex by DNA, like the heads. All teeth share a frame: gum line at y=0 (fangs 40% up their height, molars at
the crown-root junction), width at the gum line = 1, +y toward the tip, curve toward +x."""
import sys; sys.path.insert(0,'.')
import numpy as np, json
from scipy.spatial import cKDTree
from wrap import wrap, prefit, sample
J=json.load(open('/home/user/node-socket.io/dino-lab/teeth.json'))
src=J.get('source',J['teeth'])
teeth=[]
for t in src:
    P=np.array(t['pos']).reshape(-1,3); I=np.array(t['idx']).reshape(-1,3)
    gum=0.4 if t['kind']=='fang' else 0.0
    P=P-[0,gum,0]
    band=P[(P[:,1]>0)&(P[:,1]<0.08*np.ptp(P[:,1]))]
    c=band.mean(0); P-= [c[0],0,c[2]]
    w=max(np.ptp(band[:,0]),np.ptp(band[:,2])); P/=w
    teeth.append(dict(kind=t['kind'],P=P,I=I,src=t))
    print(t['kind'],'gum width -> 1, above gum %.2f, root %.2f'%(P[:,1].max(),-P[:,1].min()))
# base: stretched sphere, rings uniform in height
LAT,LON=56,32
V=[[0,-1.3,0]]
for i in range(1,LAT):
    th=np.pi*i/LAT; y=-1.3*np.cos(th); r=0.5*np.sin(th)
    for j in range(LON): ph=2*np.pi*j/LON; V.append([r*np.cos(ph),y,r*np.sin(ph)])
V.append([0,1.3,0]); V=np.array(V)
F=[]
for j in range(LON): F.append([0,1+j,1+(j+1)%LON])
for i in range(LAT-2):
    a=1+i*LON; b=a+LON
    for j in range(LON): j2=(j+1)%LON; F+= [[a+j,b+j,b+j2],[a+j,b+j2,a+j2]]
top=len(V)-1; a=1+(LAT-2)*LON
for j in range(LON): F.append([a+j,top,a+(j+1)%LON])
F=np.array(F)
# outward winding check
c=V[F].mean(1); n=np.cross(V[F[:,1]]-V[F[:,0]],V[F[:,2]]-V[F[:,0]])
if (n*c).sum(1).mean()<0: F=F[:,::-1]
targets=[]
for t in teeth:
    best=None
    for V0 in (V,prefit(V,t['P'])):
        X=wrap(V0,F,t['P'],t['I'],iters=60)
        S,_=sample(t['P'],t['I'],0.01); W,_=sample(X,F,0.01)
        e=cKDTree(W).query(S)[0].mean()+cKDTree(S).query(W)[0].mean()
        if best is None or e<best[0]: best=(e,X)
    targets.append(best[1]); print(t['kind'],'wrap error %.3f (gum widths)'%best[0])
out=dict(base=dict(pos=np.round(V,5).ravel().tolist(),idx=F.ravel().tolist()),
         targets=[dict(kind=t['kind'],pos=np.round(X,5).ravel().tolist()) for t,X in zip(teeth,targets)],
         source=src,note='shared base tooth + one target per library tooth; frame: gum line y=0, gum width 1, +y to the tip, curve toward +x')
json.dump(out,open('/home/user/node-socket.io/dino-lab/teeth.json','w'))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from view import shade
fig,ax=plt.subplots(2,6,figsize=(30,10))
for k,(t,X) in enumerate(zip(teeth,targets)):
    shade(t['P'],t['I'],ax[0,k],[0,1],2); shade(X,F,ax[1,k],[0,1],2)
    for a in ax[:,k]: a.axhline(0,color='r'); a.set_xlim(-1.2,1.5); a.set_ylim(-1.8,2.6)
plt.savefig('../in4/toothbase.png',dpi=40,bbox_inches='tight')
