import numpy as np
def smooth(e0,e1,x): t=np.clip((x-e0)/(e1-e0),0,1); return t*t*(3-2*t)
def jaw_weights(V,lower_angle_deg):
    """1 = moves with the jaw. Split the gape along its bisector; fade to the skull behind the hinge."""
    b=np.radians(lower_angle_deg/2); n=np.array([-np.sin(b),np.cos(b),0])
    s=V@n                                     # signed distance from the bisector plane through the hinge
    w=1-smooth(-0.006,0.006,s)                 # below the bisector -> jaw
    w*=smooth(-0.06,-0.004,V[:,0])             # behind the hinge: throat skin follows partly
    return w
