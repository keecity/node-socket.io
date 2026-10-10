"""Eye zones: pick the eye anchor on the base (and its mirror), subdivide the triangles around both once so the
socket depth map has vertices to push. Wraps and region masks are carried to the new vertices by interpolation."""
import sys; sys.path.insert(0,'.')
import numpy as np
from scipy.spatial import cKDTree
from refine import subdivide
B=np.load('base3.npy',allow_pickle=True).item(); V,F=B['v'],B['f']; heads=np.load('heads3_aligned.npy',allow_pickle=True)
W=[np.load(f'wrap3n_{k}.npy') for k in range(len(heads))]; RG=list(np.load('regions3.npy'))
EYE=11132; M=V.copy(); M[:,2]*=-1; EYEM=int(cKDTree(V).query(M[EYE])[1])
R=0.065; cen=V[F].mean(1)
marked=np.flatnonzero((np.linalg.norm(cen-V[EYE],axis=1)<R)|(np.linalg.norm(cen-V[EYEM],axis=1)<R))
V2,F2,A,nm=subdivide(V,F,marked,W+RG)
W2,RG2=A[:len(W)],A[len(W):]
np.save('base3e.npy',dict(v=V2,f=F2,eye=EYE,eyeM=EYEM),allow_pickle=True)
for k,Y in enumerate(W2): np.save(f'wrap3e_{k}.npy',Y)
np.save('regions3e.npy',np.array(RG2))
print('eye anchors',EYE,EYEM,V[EYE].round(3),V[EYEM].round(3),'| subdivided',nm,'tris:',len(V),'->',len(V2),'verts')
