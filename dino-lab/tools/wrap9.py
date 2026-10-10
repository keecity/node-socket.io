import sys; sys.path.insert(0,'.')
import numpy as np
from refine import wrap_species, heads
B=np.load('base9.npy',allow_pickle=True).item()
for k,H in enumerate(heads):
    Y,e=wrap_species(B['v'],B['f'],H); np.save(f'wrap9_{k}.npy',Y); print(k,'%.2f mm'%(e*1000),flush=True)
