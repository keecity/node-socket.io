import json,struct,numpy as np,io
from PIL import Image
def load(path):
    d=open(path,'rb').read(); l=struct.unpack('<I',d[12:16])[0]; j=json.loads(d[20:20+l]); b=d[20+l+8:]
    bv=j['bufferViews']; A=j['accessors']
    def acc(i):
        a=A[i]; v=bv[a['bufferView']]; n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
        dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
        return np.frombuffer(b,dt,a['count']*n,v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n).copy()
    p=j['meshes'][0]['primitives'][0]
    P=acc(p['attributes']['POSITION']).astype(float); N=acc(p['attributes']['NORMAL']).astype(float)
    UV=acc(p['attributes']['TEXCOORD_0']).astype(float); I=acc(p['indices']).reshape(-1,3).astype(np.int64)
    iv=bv[j['images'][0]['bufferView']]; img=Image.open(io.BytesIO(b[iv.get('byteOffset',0):iv.get('byteOffset',0)+iv['byteLength']])).convert('RGB')
    return P,N,UV,I,img
