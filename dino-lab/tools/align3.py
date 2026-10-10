"""Jaw landmarks + alignment for the ID-coloured sheet. Same frame as before: hinge at the origin, upper jaw
along +x, scaled to a common upper-jaw length. Keeps ID colours and region classes."""
import sys; sys.path.insert(0,'.')
import numpy as np
from landmarks import mouth
from idclass import classify
NAMES=['Tyrant','Horned grazer','Duckbill','Horned hunter','Spiked hunter','Crested','Spiked brute','Dome-head','Beaked grazer']
old=np.load('heads2_aligned.npy',allow_pickle=True); target=float(old[0]['jawLen']*old[0]['scale'])
split=np.load('../in3/heads3_split.npy',allow_pickle=True)
heads=[]; parts=[]
for H in split:
    if H['cell']==7: parts.append(dict(name='Tube crest',P=H['P'],I=H['I'],C=H['C'])); continue
    L=mouth(H['P'],H['I']); a=np.radians(L['upperAngle']); c,s=np.cos(-a),np.sin(-a); Rz=np.array([[c,-s,0],[s,c,0],[0,0,1]])
    Q=(H['P']-np.array([L['hinge'][0],L['hinge'][1],0]))@Rz.T
    jl=Q[Q[:,1]>-0.01][:,0].max(); Q*=target/jl
    k,_=classify(H['C'])
    heads.append(dict(name=NAMES[len(heads)],Q=Q,I=H['I'],C=H['C'],R=k,L=L,lowerAngle=L['lowerAngle']-L['upperAngle'],scale=target/jl,jawLen=jl,cell=H['cell']))
    print(f'{heads[-1]["name"]:14s} gape {-heads[-1]["lowerAngle"]:5.1f}°  scale {target/jl:.3f}  verts {len(Q)}')
np.save('heads3_aligned.npy',np.array(heads,dtype=object),allow_pickle=True); np.save('parts3.npy',np.array(parts,dtype=object),allow_pickle=True)
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from view import shade
fig,ax=plt.subplots(1,9,figsize=(36,4.5))
for i,H in enumerate(heads):
    shade(H['Q'],H['I'],ax[i],[0,1],2,H['C'][H['I']].mean(1)); la=np.radians(H['lowerAngle'])
    ax[i].plot([0,0.25],[0,0],'c-'); ax[i].plot([0,0.25*np.cos(la)],[0,0.25*np.sin(la)],'y-'); ax[i].plot(0,0,'wo'); ax[i].set_title(H['name'])
    ax[i].set_xlim(-0.2,0.25); ax[i].set_ylim(-0.17,0.15)
plt.savefig('../in3/aligned3.png',dpi=50,bbox_inches='tight')
