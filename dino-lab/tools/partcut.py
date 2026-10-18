import json,struct,numpy as np,base64,sys
sys.path.insert(0,'.')
def load(fn):
    b=open(fn,'rb').read();l=struct.unpack('<I',b[12:16])[0];j=json.loads(b[20:20+l]);B=b[20+l+8:]
    def acc(i):
        a=j['accessors'][i];bv=j['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
        return np.frombuffer(B,dt,a['count']*n,bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
    p=j['meshes'][0]['primitives'][0];at=p['attributes']
    im=j['images'][0];bv=j['bufferViews'][im['bufferView']];img=B[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]
    return acc(at['POSITION']).astype(np.float32),acc(at['TEXCOORD_0']).astype(np.float32),acc(p['indices']).reshape(-1,3).astype(np.int64),img,im.get('mimeType','image/jpeg')
def comps(V,F):
    U,inv=np.unique(np.round(V,4),axis=0,return_inverse=True);inv=inv.ravel();F2=inv[F];par=np.arange(len(U))
    def f(x):
        r=x
        while par[r]!=r:r=par[r]
        while par[x]!=r:par[x],x=r,par[x]
        return r
    for t in F2: a=f(t[0]);par[f(t[1])]=a;par[f(t[2])]=a
    R=np.array([f(x) for x in range(len(U))])[inv];return R
def pick(fn,rank):
    V,T,F,img,mime=load(fn);R=comps(V,F);u,c=np.unique(R,return_counts=True);o=u[np.argsort(-c)]
    main=R==o[rank];lo,hi=V[main].min(0),V[main].max(0);keep=main.copy()
    for k in o:  # small bits (claws) sitting inside the chosen part's box
        m=R==k
        if k!=o[rank] and m.sum()<200 and np.all(V[m].mean(0)>lo-0.01) and np.all(V[m].mean(0)<hi+0.01): keep|=m
    Fk=F[keep[F].all(1)];used=np.unique(Fk);mp=-np.ones(len(V),int);mp[used]=np.arange(len(used))
    return V[used],T[used],mp[Fk],img,mime
def glb(V,T,F,img,mime):
    pos=V.astype('<f4').tobytes();uv=T.astype('<f4').tobytes();ix=F.astype('<u4').tobytes()
    pad=lambda b:b+b'\0'*(-len(b)%4);chunks=[pad(pos),pad(uv),pad(ix),pad(img)];offs=np.cumsum([0]+[len(x) for x in chunks])
    j={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],
     'meshes':[{'primitives':[{'attributes':{'POSITION':0,'TEXCOORD_0':1},'indices':2,'material':0}]}],
     'materials':[{'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':0.8}}],
     'textures':[{'source':0}],'images':[{'bufferView':3,'mimeType':mime}],'buffers':[{'byteLength':int(offs[-1])}],
     'bufferViews':[{'buffer':0,'byteOffset':int(offs[i]),'byteLength':len([pos,uv,ix,img][i])} for i in range(4)],
     'accessors':[{'bufferView':0,'componentType':5126,'count':len(V),'type':'VEC3','min':V.min(0).tolist(),'max':V.max(0).tolist()},
       {'bufferView':1,'componentType':5126,'count':len(V),'type':'VEC2'},{'bufferView':2,'componentType':5125,'count':F.size,'type':'SCALAR'}]}
    js=json.dumps(j).encode();js+=b' '*(-len(js)%4);bin=b''.join(chunks)
    return b'glTF'+struct.pack('<II',2,12+8+len(js)+8+len(bin))+struct.pack('<I',len(js))+b'JSON'+js+struct.pack('<I',len(bin))+b'BIN\0'+bin
if __name__=="__main__":
  out='../'
  for nm,rank in [('body',0),('head',0),('arm',0),('leg',0),('tail',0)]:
      V,T,F,img,mime=pick(f'../parts_src/{"heads" if nm=="head" else nm}.glb',rank)
      c=(V.min(0)+V.max(0))/2
      if nm in('arm','leg'): c[1]=V[:,1].max()   # pivot at the top (hip/shoulder)
      V=V-c;b=glb(V,T,F,img,mime);open(out+f'part_{nm}.b64.txt','w').write(base64.b64encode(b).decode())
      print(nm,len(V),len(F),V.min(0).round(2),V.max(0).round(2),len(b)//1024,'KB')
