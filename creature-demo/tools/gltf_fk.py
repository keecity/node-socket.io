import json,struct,numpy as np,glob,sys
def load(f):
    d=open(f,'rb').read(); l=struct.unpack('<I',d[12:16])[0]; j=json.loads(d[20:20+l]); b=d[20+l+8:]
    def acc(i):
        a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        dt={5126:np.float32,5123:np.uint16,5125:np.uint32,5121:np.uint8}[a['componentType']]
        off=bv.get('byteOffset',0)+a.get('byteOffset',0)
        arr=np.frombuffer(b,dt,a['count']*n,off).reshape(a['count'],n) if not bv.get('byteStride') else None
        return arr.astype(np.float64)
    return j,acc
def qmat(q):
    x,y,z,w=q; return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
def slerp(a,b,t):
    d=np.dot(a,b)
    if d<0: b=-b; d=-d
    if d>0.9995: r=a+(b-a)*t; return r/np.linalg.norm(r)
    th=np.arccos(d); return (np.sin((1-t)*th)*a+np.sin(t*th)*b)/np.sin(th)
def sample(times,vals,t,rot):
    if t<=times[0]: return vals[0]
    if t>=times[-1]: return vals[-1]
    i=np.searchsorted(times,t)-1; u=(t-times[i])/(times[i+1]-times[i])
    return slerp(vals[i],vals[i+1],u) if rot else vals[i]*(1-u)+vals[i+1]*u
def setup(f):
    j,acc=load(f); nodes=j['nodes']
    parent={c:i for i,n in enumerate(nodes) for c in n.get('children',[])}
    name={n.get('name'):i for i,n in enumerate(nodes)}
    return j,acc,nodes,parent,name
def world(nodes,parent,trs):
    W={}
    def g(i):
        if i in W: return W[i]
        t,r,s=trs[i]; M=np.eye(4); M[:3,:3]=qmat(r)*s; M[:3,3]=t
        W[i]=g(parent[i])@M if i in parent else M; return W[i]
    for i in range(len(nodes)): g(i)
    return W
def rest_trs(nodes):
    return {i:(np.array(n.get('translation',[0,0,0]),float),np.array(n.get('rotation',[0,0,0,1]),float),np.array(n.get('scale',[1,1,1]),float)) for i,n in enumerate(nodes)}
def pose(j,acc,nodes,anim,t):
    trs=rest_trs(nodes); trs={k:list(v) for k,v in trs.items()}
    for ch in anim['channels']:
        sm=anim['samplers'][ch['sampler']]; n=ch['target']['node']; p=ch['target']['path']
        T=acc(sm['input'])[:,0]; V=acc(sm['output'])
        k={'translation':0,'rotation':1,'scale':2}.get(p)
        if k is None: continue
        trs[n][k]=sample(T,V,t,k==1)
    return trs,
