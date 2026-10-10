"""Carry each species' ID regions onto the shared base through its wrap: mouth (pink), keratin (yellow/orange:
beaks, dome caps), attachment sites (green). One mask set per species on the base's vertices; the viewer mixes
them by DNA and cuts them at 0.5 for crisp edges."""
import sys; sys.path.insert(0,'.')
import numpy as np, colorsys
from scipy.spatial import cKDTree
from wrap import sample, laplacian
B=np.load('base3.npy',allow_pickle=True).item(); V,F=B['v'],B['f']; heads=np.load('heads3_aligned.npy',allow_pickle=True)
Mv=V.copy(); Mv[:,2]*=-1; mi=cKDTree(V).query(Mv)[1]; Lap=laplacian(len(V),F)
def onehot(C):
    hsv=np.array([colorsys.rgb_to_hsv(*c) for c in C]); h=hsv[:,0]*360; s=hsv[:,1]>0.3
    mouth=s&((h>=335)|(h<28)); ker=s&(h>=28)&(h<66); site=s&(h>=66)&(h<170)
    return np.c_[mouth,ker,site].astype(float)
out=[]
for k,H in enumerate(heads):
    Y=np.load(f'wrap3n_{k}.npy'); O=onehot(H['C'])
    S,st=sample(H['Q'],H['I'],0.0015)
    _,j=cKDTree(S).query(Y); M=O[H['I'][st[j]]].mean(1)          # the sculpt triangle under each base vertex
    for it in range(2): M=0.5*M+0.5*(Lap@M)                       # soften single-vertex noise
    M=0.5*(M+M[mi])                                               # symmetric
    out.append(np.clip(M,0,1)); print(H['name'],'mouth %.1f%%  keratin %.1f%%  sites %.1f%%'%tuple((M>0.5).mean(0)*100))
np.save('regions3.npy',np.array(out),allow_pickle=True)
