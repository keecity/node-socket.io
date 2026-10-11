"""Neck segment profile: radius r(theta, t) of the ringed cylinder from the body sheet, caps trimmed, normalised to a
mean radius of 1. Saved as neck_segment.json (64 angles x 96 steps along the axis) for the viewer to sweep along a spline."""
import sys; sys.path.insert(0,'.')
import numpy as np, json
B=np.load('bodies.npy',allow_pickle=True); S=[o for o in B if o['kind']=='segment'][0]; V=S['v']
c=V.mean(0); X=V-c                                   # axis is y
y=X[:,1]; ang=np.arctan2(X[:,2],X[:,0]); r=np.hypot(X[:,0],X[:,2])
# trim caps: keep the stretch where the radius is near its full size
ys=np.linspace(y.min(),y.max(),200); rm=np.array([np.median(r[np.abs(y-v)<0.004]) if (np.abs(y-v)<0.004).sum()>5 else 0 for v in ys])
ok=ys[rm>0.93*rm.max()]; y0,y1=ok.min()+0.005,ok.max()-0.005
NA,NT=64,96; prof=np.zeros((NT,NA))
for i,t in enumerate(np.linspace(y0,y1,NT)):
    m=np.abs(y-t)<0.004; a=ang[m]; rr=r[m]
    for j,th in enumerate(np.linspace(-np.pi,np.pi,NA,endpoint=False)):
        d=np.abs((a-th+np.pi)%(2*np.pi)-np.pi); k=d<0.12
        prof[i,j]=rr[k].max() if k.any() else np.nan
prof=np.where(np.isnan(prof),np.nanmean(prof),prof)
from scipy import ndimage
prof=ndimage.gaussian_filter(prof,(1.2,1.0),mode='wrap')               # smooth the sampling steps
J=(-np.arange(NA))%NA; prof=0.5*(prof+prof[:,J])                      # left-right symmetric about angle 0 (the top)
prof/=prof.mean()
print('segment length %.3f, mean radius %.3f, profile range %.2f..%.2f'%(y1-y0,rm.max(),prof.min(),prof.max()))
json.dump(dict(na=NA,nt=NT,aspect=float((y1-y0)/rm.max()),r=np.round(prof,4).ravel().tolist(),
               note='radius / mean radius; rows along the axis (t 0..1), columns around (angle from +x toward +z)'),open('/home/user/node-socket.io/dino-lab/neck_segment.json','w'))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
plt.figure(figsize=(8,6)); plt.imshow(prof,aspect='auto',cmap='gray'); plt.colorbar(); plt.savefig('../in5/neck_profile.png',dpi=50)
