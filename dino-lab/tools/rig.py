import numpy as np
def smooth(e0,e1,x): t=np.clip((x-e0)/(e1-e0),0,1); return t*t*(3-2*t)
def jaw_pivot(lower_angle_deg, back=0.07):
    """The jaw joint sits behind the mouth corner, inside the cheek, on the line that splits the gape.
    A pivot on that line maps the lower jaw line exactly onto the upper one when the jaw closes."""
    b=np.radians(lower_angle_deg/2)
    return np.array([-np.cos(b)*back, -np.sin(b)*back, 0.0])
def jaw_weights(V,lower_angle_deg,pivot):
    """1 = moves with the jaw: everything below the gape bisector, from the snout back to the joint in the
    cheek. The blend band widens toward the joint so the cheek skin stretches instead of tearing."""
    b=np.radians(lower_angle_deg/2); n=np.array([-np.sin(b),np.cos(b),0])
    s=V@n
    t=np.clip(-V[:,0]/max(-pivot[0],1e-6),0,1)                # 0 at the mouth corner, 1 at the joint
    band=0.006+0.016*t
    w=1-smooth(-band,band,s)
    w*=smooth(pivot[0]-0.03,pivot[0]+0.01,V[:,0])           # behind the joint: skull / neck
    return w
