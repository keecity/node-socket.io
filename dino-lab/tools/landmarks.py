import numpy as np
def silhouette(P,I,res=0.002):
    lo=P[:,:2].min(0)-0.01; hi=P[:,:2].max(0)+0.01
    W,H=np.ceil((hi-lo)/res).astype(int)+1
    G=np.zeros((W,H),bool)
    T=P[I][:,:,:2]
    for t in T:
        e=max(np.linalg.norm(t[0]-t[1]),np.linalg.norm(t[0]-t[2]),np.linalg.norm(t[1]-t[2]))
        k=max(1,int(e/res*1.5))
        u,v=np.meshgrid(np.linspace(0,1,k+1),np.linspace(0,1,k+1)); m=u+v<=1
        q=t[0]+u[m][:,None]*(t[1]-t[0])+v[m][:,None]*(t[2]-t[0])
        ij=((q-lo)/res).round().astype(int); G[ij[:,0],ij[:,1]]=True
    return G,lo,res
def mouth(P,I):
    G,lo,res=silhouette(P,I)
    W,H=G.shape; rows=[]
    for i in range(W):
        col=G[i]; occ=np.where(col)[0]
        if len(occ)<2: continue
        # gaps between occupied runs
        midY=(np.median(np.where(G.any(0))[0]))
        gaps=[(occ[k],occ[k+1]) for k in range(len(occ)-1) if occ[k+1]-occ[k]>3 and occ[k+1]<=midY+5]   # mouth: lower half
        if not gaps: rows.append((i,None)); continue
        g=min(gaps,key=lambda g:g[0]); rows.append((i,g))   # lowest gap = the mouth
    # the mouth: longest run of consecutive columns that have a gap, ending at the front
    runs=[];cur=[]
    for i,g in rows:
        if g: cur.append((i,g))
        else:
            if cur: runs.append(cur); cur=[]
    if cur: runs.append(cur)
    runs=[r for r in runs if len(r)>=8] or runs
    run=max(runs,key=lambda r: sum(g[1]-g[0] for _,g in r))      # the biggest opening, not the longest sliver
    xs=np.array([lo[0]+i*res for i,_ in run]); top=np.array([lo[1]+g[1]*res for _,g in run]); bot=np.array([lo[1]+g[0]*res for _,g in run])
    # trace from the front of the mouth backwards; stop where the gap outline jumps (another opening joins in)
    j=len(xs)-1
    while j>0 and abs(top[j-1]-top[j])<0.008 and abs(bot[j-1]-bot[j])<0.008: j-=1
    xs,top,bot=xs[j:],top[j:],bot[j:]
    hinge=np.array([xs[0],(top[0]+bot[0])/2])
    # jaw lines over the middle of the mouth (avoid the curled tips)
    k=int(len(xs)*0.75)
    au=(top[k]-hinge[1])/(xs[k]-hinge[0]); al=(bot[k]-hinge[1])/(xs[k]-hinge[0])
    up=P[P[:,1]>hinge[1]+ (P[:,0]-hinge[0])*np.tan((np.arctan(au)+np.arctan(al))/2)]
    lw=P[P[:,1]<=hinge[1]+ (P[:,0]-hinge[0])*np.tan((np.arctan(au)+np.arctan(al))/2)]
    tipU=up[up[:,0].argmax()]; tipL=lw[lw[:,0].argmax()]
    return dict(hinge=hinge,upperAngle=np.degrees(np.arctan(au)),lowerAngle=np.degrees(np.arctan(al)),
                gape=np.degrees(np.arctan(au)-np.arctan(al)),tipU=tipU,tipL=tipL,xs=xs,top=top,bot=bot)
