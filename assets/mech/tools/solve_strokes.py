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
STROKES={
 'diag_dn': (1.85,(-0.05,-1,0.05),(-0.6,-0.5,0.6),(0.6,-0.5,-0.6)),
 'backhand':(1.6,(0,-1,0.05),(0.7,-0.7,0.1),(-0.7,-0.7,0.1)),
 'cleave':  (2.0,(0,-0.9,0.35),(0,-0.25,1),(0,-0.6,-0.8)),
 'thrust':  (1.75,(0.03,-1,0.02),(0.03,-1,0.02),(0.03,-1,0.02)),
 'rising':  (1.5,(0,-1,0.05),(-0.5,-0.6,-0.6),(0.5,-0.6,0.6)),
 'sweep':   (1.5,(0,-1,0),(-0.9,-0.4,0),(0.9,-0.4,0)),
 'diag_dn2':(1.85,(0.05,-1,0.05),(0.6,-0.5,0.6),(-0.6,-0.5,-0.6)),
}
out={}
for name,(h,dc,ds,de) in STROKES.items():
    qc=solve(contact(h,dc),READY); hc,bc=blade(qc)
    if name=='thrust':
        qs=solve(lambda q:(8*blade(q)[1].angle(Vector(dc).normalized())+10*(blade(q)[0]-(hc+Vector((0,0.45,0)))).length+pen(q)+nat(q,qc)),qc); qe=qc
    else:
        qs=solve(sweep(ds,hc,qc),qc); qe=solve(sweep(de,hc,qc),qc)
    P=Vector((DX,DY,h)); miss=min(((hc+bc*BL*s)-P).length for s in (0.45,0.55,0.65,0.75,0.8))
    print(f"STROKE {name:9s} contact miss {miss*100:4.1f}cm dir off {math.degrees(bc.angle(Vector(dc).normalized())):4.1f}  qc {[round(x) for x in qc]}")
    out[name]={k:[round(x,1) for x in q] for k,q in (('start',qs),('contact',qc),('end',qe))}
json.dump(out,open(f'strokes_{sys.argv[-1]}.json','w'),indent=1)
