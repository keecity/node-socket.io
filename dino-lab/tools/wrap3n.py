import sys; sys.path.insert(0,'.')
import numpy as np
from refine import wrap_species
heads=np.load('heads3_aligned.npy',allow_pickle=True)
B=np.load('base3.npy',allow_pickle=True).item()
for k,H in enumerate(heads):
    Y,e=wrap_species(B['v'],B['f'],H); np.save(f'wrap3n_{k}.npy',Y); print(k,H['name'],'%.2f mm'%(e*1000),flush=True)
