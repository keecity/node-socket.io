import bpy, math, json, random, sys
from mathutils import Vector, Matrix, Euler
bpy.ops.wm.open_mainfile(filepath="out/mech_rigged.blend")
rig=bpy.data.objects['MechRig']; B=rig.data.bones
REL={b.name:(b.parent.matrix_local.inverted()@b.matrix_local) if b.parent else b.matrix_local.copy() for b in B}
ORDER=sorted(B,key=lambda b:len(b.parent_recursive))
BL=B['SaberBlade'].length; G=B['Hand_R'].matrix_local.inverted()@B['SaberGrip'].matrix_local
DY=float(sys.argv[-1]); DX=0.1
r=math.radians
def legs(tl,kl,tr,kr,al=3,ar=-4):
    return {'UpperLeg_L':(tl,0,al),'LowerLeg_L':(kl,0,0),'Foot_L':(-(tl+kl),0,0),'UpperLeg_R':(tr,0,ar),'LowerLeg_R':(kr,0,0),'Foot_R':(-(tr+kr),0,0)}
LUNGE=legs(26,-40,-12,-18)
def fk(pose):
    W={}
    for b in ORDER:
        n=b.name; par=W[b.parent.name] if b.parent else Matrix.Identity(4)
        W[n]=par@REL[n]@Euler(tuple(r(a) for a in pose.get(n,(0,0,0))),'XYZ').to_matrix().to_4x4()
    return W
def blade(q):
    pose=dict(LUNGE); pose['Spine']=(q[0],q[1],0); pose['Hips']=(0,q[2],0)
    pose['UpperArm_R']=(q[3],q[4],q[5]); pose['ForeArm_R']=(q[6],0,0); pose['Hand_R']=(q[7],0,0)
    W=fk(pose); m=W['Hand_R']@G
    return m.translation, m.to_3x3().col[1].normalized()
LIM=[(-5,25),(-40,40),(-20,20),(-40,170),(-15,15),(-90,50),(0,120),(-65,-10)]
def pen(q): return sum(max(0,lo-x,x-hi)**2 for x,(lo,hi) in zip(q,LIM))*0.05
def solve(cost,seed):
    best=None;rng=random.Random(2)
    for trial in range(40):
        x=[s+(rng.gauss(0,15) if trial else 0) for s in seed]; c=cost(x); st=10
        while st>0.05:
            imp=False
            for i in range(8):
                for d in (st,-st):
                    y=list(x);y[i]+=d;cy=cost(y)
                    if cy<c:x,c,imp=y,cy,True
            if not imp: st/=2
        if best is None or c<best[0]: best=(c,x)
    return best[1]
def nat(q,ref): return 0.002*sum((a-b)**2 for a,b in zip(q,ref))
READY=[5,-8,0,30,0,-14,70,-20]
def contact(h,d):
    P=Vector((DX,DY,h)); d=Vector(d).normalized()
    def cost(q):
        hp,bd=blade(q)
        # distance from target point to blade segment (pierce 45-80% down the blade)
        best=min(((hp+bd*BL*s)-P).length for s in (0.45,0.55,0.65,0.75,0.8))
        return 40*best+8*bd.angle(d)+pen(q)+nat(q,READY)
    return cost
def sweep(d,href,q0):
    d=Vector(d).normalized()
    def cost(q):
        hp,bd=blade(q)
        return 8*bd.angle(d)+6*max(0,(hp-href).length-0.45)+pen(q)+0.004*sum((a-b)**2 for a,b in zip(q,q0))
    return cost

CD=2.2                                   # clash distance (our units, ~0.64 demo units)
DY=-CD/2; DX=0.0
out={}
for name,(h,d,lean) in {'bind':(2.05,(-0.55,-0.35,0.76),0),'push':(2.0,(-0.5,-0.45,0.74),1)}.items():
    P0=Vector((DX,DY,h))
    def ccost(q):
        hp,bd=blade(q)
        best=min(((hp+bd*BL*s)-P0).length for s in (0.45,0.55,0.65,0.75))
        return 40*best+10*max(0,0.34-abs(bd.x))+10*max(0,0.35-bd.z)+4*max(0,bd.y+0.2)+pen(q)+nat(q,READY)
    qc=solve(ccost,READY); hc,bc=blade(qc)
    print("  blade dir", tuple(round(x,2) for x in bc))
    miss=min(((hc+bc*BL*s)-Vector((DX,DY,h))).length for s in (0.45,0.55,0.65,0.75,0.8))
    print(f"CLASH {name}: through midpoint within {miss*100:.1f} cm, blade dir off {math.degrees(bc.angle(Vector(d).normalized())):.0f} deg, q {[round(x) for x in qc]}")
    out[name]=[round(x,1) for x in qc]
json.dump(out,open('clash.json','w'),indent=1)
