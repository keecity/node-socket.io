import bpy, math, sys
from mathutils import Vector
from mathutils.geometry import intersect_line_line
bpy.ops.wm.open_mainfile(filepath="out/mech_rigged.blend")
rig=bpy.data.objects['MechRig']
for t in rig.animation_data.nla_tracks: t.mute=True
P=rig.pose.bones; B=rig.data.bones
DY=float(sys.argv[1]) if len(sys.argv)>1 else -1.9     # dummy centre, in front (-Y)
A=Vector((0.1,DY,0.5)); Bz=Vector((0.1,DY,2.4)); RAD=0.38
HITS={'Saber_Slash_Combo':[(0.15,0.31),(0.45,0.6),(0.84,1.0)],'Saber_Run_Slash':[(0.13,0.3)],'Saber_Boost_Slash':[(0.5,0.76)],
 'Saber_Air_Slash':[(0.26,0.43)],'Saber_Dash_Thrust':[(0.3,0.44)],'Saber_Rising_Slash':[(0.16,0.36)],'Saber_Wide_Sweep':[(0.28,0.48)],
 'Saber_Stab_Combo':[(0.1,0.26),(0.34,0.5)],'Saber_Cross_Cut':[(0.15,0.3),(0.46,0.64)],'Saber_Parry_Riposte':[(0.42,0.57)]}
BL=B['SaberBlade'].length
def segdist(p1,q1,p2,q2):
    best=1e9
    for i in range(21):
        p=p1.lerp(q1,i/20)
        # closest on axis
        ab=q2-p2; t=max(0,min(1,(p-p2).dot(ab)/ab.length_squared)); best=min(best,(p-(p2+ab*t)).length)
    return best
for c,wins in HITS.items():
    rig.animation_data.action=bpy.data.actions[c]; out=[]
    for (t0,t1) in wins:
        md=9
        for f in range(int(t0*30)+1,int(t1*30)+2):
            bpy.context.scene.frame_set(f); m=P['SaberBlade'].matrix
            h=m.translation; tip=h+m.to_3x3().col[1].normalized()*BL*P['SaberBlade'].scale.y
            md=min(md,segdist(h,tip,A,Bz))
        out.append("HIT" if md<RAD else f"miss({md-RAD:+.2f})")
    print(f"CONTACT {c:22s}", " ".join(out))
