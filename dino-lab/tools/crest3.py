"""Duckbill crest: the separate tube from the ID sheet, flattened onto the midline (its thinnest axis sideways),
low end forward. Its front end is sunk into the forehead (anchor vertex) so it can be fused there; the rest is swung down until it
just touches the skull behind. Exported for the viewer as crest.json (local frame, rotation already applied)."""
import sys; sys.path.insert(0,'.')
import numpy as np, json
from crest_rest import rest, L0, F
FRONT=0.025          # only the front end goes into the head (2.5 cm), so it can be fused there
a,deg,X=rest(0.0,FRONT,touch=0.003,skip=0.12)   # the rest swung down until it just touches the back of the skull
SINK=FRONT
t=np.radians(deg); L=L0@np.array([[np.cos(t),-np.sin(t),0],[np.sin(t),np.cos(t),0],[0,0,1]]).T
json.dump(dict(anchor=a,species=2,embed=SINK,pos=np.round(L,5).ravel().tolist(),idx=F.ravel().tolist(),
               note='local frame: x forward, y up, z sideways; origin = front end, placed at the anchor vertex minus embed along y'),
          open('/home/user/node-socket.io/dino-lab/crest.json','w'))
print('anchor',a,'pitch',deg,'verts',len(L))
