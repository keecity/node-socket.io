# Extract gait profiles from rigged animal GLBs (walk/run/idle clips).
# usage: python3 extract_gaits.py <folder of .glb files>   -> gaits.json (embed in index.html #gaits)
import sys,json,glob,re; sys.path.insert(0, __import__('os').path.dirname(__file__))
from gltf_fk import *
N=32
def euler_yx(R):  # yaw about Y, pitch about X (deg) of a delta rotation
    f=R@np.array([0,0,1.0]); yaw=np.degrees(np.arctan2(f[0],f[2])); pitch=np.degrees(np.arcsin(np.clip(-f[1],-1,1))); return yaw,pitch
out={}
for f in sorted(glob.glob(sys.argv[1] + '/*.glb')):
    animal=f.split('/')[-1].split('_')[0]
    j,acc,nodes,parent,name=setup(f)
    W0=world(nodes,parent,rest_trs(nodes))
    P=lambda W,k: W[name[k]][:3,3]
    legs={}
    for tag,pre in [('H',''),('F','front_')]:
        for s in 'LR':
            if pre+'thigh.'+s in name and pre+'foot.'+s in name:
                th,sh,ft=[P(W0,pre+b+'.'+s) for b in ['thigh','shin','foot']]
                legs[tag+s]=dict(hip=pre+'thigh.'+s,foot=pre+'foot.'+s,len=float(np.linalg.norm(th-sh)+np.linalg.norm(sh-ft)),hipY=float(th[1]))
    pelvis=nodes[parent[name['thigh.L']]]['name']
    chest=nodes[parent[name['front_thigh.L']]]['name'] if 'front_thigh.L' in name else None
    head='scull' if 'scull' in name else None
    clips={}
    for a in j['animations']:
        m=re.search(r'_(walk|run|idle)$',a['name'])
        if not m: continue
        kind=m.group(1)
        T=max(acc(a['samplers'][c['sampler']]['input'])[-1,0] for c in a['channels'])
        n=N if kind!='idle' else 96
        ts=np.linspace(0,T,n,endpoint=False)
        frames=[world(nodes,parent,pose(j,acc,nodes,a,t)[0]) for t in ts]
        hindLen=np.mean([legs[k]['len'] for k in legs if k[0]=='H'])
        L={}
        for k,lg in legs.items():
            fp=np.array([P(W,lg['foot']) for W in frames]); ln=lg['len']
            ground=fp[:,1].min()
            dy=(fp[:,1]-ground)/ln; z=fp[:,2]; dx=(z-z.mean())/ln
            # in an in-place loop a planted foot slides backward at body speed: stance = backward motion
            vel=(np.roll(dx,-1)-np.roll(dx,1))/2
            contact=(vel<0)&(dy<0.25)
            duty=float(contact.mean())
            sweep=float(-(vel[contact]).sum()) if contact.any() else 0
            # touchdown phase: first contact sample after a swing sample
            td=[i for i in range(n) if contact[i] and not contact[i-1]]
            L[k]=dict(dx=np.round(dx,4).tolist(),dy=np.round(dy,4).tolist(),duty=round(duty,3),sweep=round(sweep,4),touchdown=round(td[0]/n,3) if td else 0)
        def pt(k): return np.array([P(W,k) for W in frames])
        pel=pt(pelvis); pel0=P(W0,pelvis)
        body=dict(bob=np.round((pel[:,1]-pel[:,1].mean())/hindLen,4).tolist())
        if chest:
            ch=pt(chest); v=ch-pel; v0=P(W0,chest)-pel0
            pitch=np.degrees(np.arctan2(v[:,1],v[:,2]))-np.degrees(np.arctan2(v0[1],v0[2]))
            yaw=np.degrees(np.arctan2(v[:,0],v[:,2]))-np.degrees(np.arctan2(v0[0],v0[2]))
            body['pitch']=np.round(pitch-pitch.mean(),2).tolist(); body['yaw']=np.round(yaw-yaw.mean(),2).tolist()
        hl,hr=pt('thigh.L'),pt('thigh.R'); roll=np.degrees(np.arctan2(hl[:,1]-hr[:,1],np.abs(hl[:,0]-hr[:,0])+1e-6))
        body['roll']=np.round(roll-roll.mean(),2).tolist()
        if head:
            R0=W0[name[head]][:3,:3]; R0/=np.linalg.norm(R0[:,0])
            hy,hp=[],[]
            for W in frames:
                R=W[name[head]][:3,:3]; R=R/np.linalg.norm(R[:,0]); y,p=euler_yx(R@R0.T); hy.append(y); hp.append(p)
            hy=np.array(hy); hp=np.array(hp)
            body['headYaw']=np.round(hy-hy.mean(),2).tolist(); body['headPitch']=np.round(hp-hp.mean(),2).tolist()
        sweeps=[L[k]['sweep'] for k in L]; duties=[L[k]['duty'] for k in L]
        strideNorm=float(np.mean(sweeps)/max(np.mean(duties),1e-3))
        clips[kind]=dict(duration=round(float(T),3),legs=L,body=body,strideNorm=round(strideNorm,4),
                         speedNorm=round(strideNorm/float(T),4))
    out[animal]=dict(biped=not any(k[0]=='F' for k in legs),clips=clips)
    print(animal,'biped' if out[animal]['biped'] else 'quad',{k:(c['duration'],c['strideNorm'],c['speedNorm'],{l:(v['duty'],v['touchdown']) for l,v in c['legs'].items()}) for k,c in clips.items() if k!='idle'})
json.dump(out,open('gaits.json','w'),separators=(',',':'))
import os; print(os.path.getsize('gaits.json')//1024,'KB')
