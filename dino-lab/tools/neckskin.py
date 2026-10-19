"""Neck with the panel skin (parts_src/neck_skin.jpg: four lens-shaped panels side by side, each a quarter turn around the
neck, running along its length). Writes part_neck.b64.txt; vertices are split where the wrap closes."""
import sys; sys.path.insert(0,'.'); import numpy as np, base64
from partcut import pick, glb
V,T,F,img,mime=pick('../parts_src/neck.glb',0); V=(V-(V.min(0)+V.max(0))/2).astype(np.float32)
U,inv=np.unique(np.round(V,5),axis=0,return_inverse=True); F=inv.ravel()[F]; V=U.astype(np.float32)   # weld, then split on the wrap only
phi=np.arctan2(V[:,2],V[:,1])%(2*np.pi)
P=list(V); ph=list(phi); F=F.copy()
for t in range(len(F)):
    a=phi[F[t]]
    if a.max()-a.min()>np.pi:                       # triangle straddles the wrap: give its low side copies at +2pi
        for e in range(3):
            if a[e]<np.pi: P.append(V[F[t,e]]); ph.append(a[e]+2*np.pi); F[t,e]=len(P)-1
P=np.array(P,np.float32); ph=np.array(ph); u=P[:,0]+0.5
k=np.floor(ph/(np.pi/2)); a=ph/(np.pi/2)-k; vt=0.08+0.84*u
w=0.92*np.sqrt(np.clip(np.sin(np.pi*vt),0,1))
UV=np.c_[(k+0.5+(a-0.5)*w)/4, vt].astype(np.float32)
open('../parts_src/neck_skin.jpg','rb').read()
open('../part_neck.b64.txt','w').write(base64.b64encode(glb(P,UV,F,open('../parts_src/neck_skin.jpg','rb').read(),'image/jpeg')).decode()); print(len(V),'->',len(P))
