"""Two-robot contact check: our mech vs a second copy facing it at game distance.
python versus.py <distance(our units)> ; reports per hit window: MESH (blade touches the
opponent's body mesh) and CAPSULE (game hurtbox: axis 0.12..0.80 demo units up, r 0.15+)."""
import bpy, sys, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
D=float(sys.argv[-1]); K=2.8/0.82                    # our units per demo unit
bpy.ops.wm.open_mainfile(filepath="out/mech_rigged.blend")
rig=bpy.data.objects['MechRig']; body=bpy.data.objects['MechBody']
for t in rig.animation_data.nla_tracks: t.mute=True
P=rig.pose.bones; BL=rig.data.bones['SaberBlade'].length
names={g.index:g.name for g in body.vertex_groups}
# opponent: our mesh in Battle_Idle, rotated 180 deg to face us, placed D in front (-Y)
rig.animation_data.action=bpy.data.actions['Battle_Idle']; bpy.context.scene.frame_set(1)
me=body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
skip={'Saber','SaberBlade','Gun','Winch','WinchHook','Pilot'}
Mo=Matrix.Translation((0,-D,0))@Matrix.Rotation(math.pi,4,'Z')
co=[Mo@v.co for v in me.vertices]
tris=[list(p.vertices) for p in me.polygons if names.get(body.data.vertices[p.vertices[0]].groups[0].group if body.data.vertices[p.vertices[0]].groups else -1,'') not in skip]
OPP=BVHTree.FromPolygons(co,tris)
ax0=Vector((0,-D,0.12*K)); ax1=Vector((0,-D,0.80*K)); CR=0.15*K
HITS={'Saber_Slash_Combo':[(0.15,0.31),(0.45,0.6),(0.84,1.0)],'Saber_Run_Slash':[(0.13,0.3)],'Saber_Boost_Slash':[(0.5,0.76)],
 'Saber_Air_Slash':[(0.26,0.43)],'Saber_Dash_Thrust':[(0.3,0.44)],'Saber_Rising_Slash':[(0.16,0.36)],'Saber_Wide_Sweep':[(0.28,0.48)],
 'Saber_Stab_Combo':[(0.1,0.26),(0.34,0.5)],'Saber_Cross_Cut':[(0.15,0.3),(0.46,0.64)],'Saber_Parry_Riposte':[(0.42,0.57)]}
def segaxis(a,b):
    best=9
    for i in range(21):
        p=a.lerp(b,i/20); ab=ax1-ax0; t=max(0,min(1,(p-ax0).dot(ab)/ab.length_squared)); best=min(best,(p-(ax0+ab*t)).length)
    return best
tot=0;hit=0
for c,wins in HITS.items():
    rig.animation_data.action=bpy.data.actions[c]; res=[]
    for t0,t1 in wins:
        mesh=False; cap=9
        for f in range(int(t0*30)+1,int(t1*30)+2):
            bpy.context.scene.frame_set(f); m=rig.matrix_world@P['SaberBlade'].matrix
            h=m.translation; d=m.to_3x3().col[1].normalized(); L=BL*P['SaberBlade'].scale.y
            if OPP.ray_cast(h,d,L)[0] is not None: mesh=True
            cap=min(cap,segaxis(h,h+d*L))
        ok=mesh or cap<CR; tot+=1; hit+=ok
        res.append(("HIT" if ok else "miss")+f"[mesh:{'y' if mesh else 'n'} cap:{cap-CR:+.2f}]")
    print(f"VS {c:22s}"," ".join(res))
print(f"VS TOTAL {hit}/{tot} at distance {D} ({D/K:.2f} demo units)")
