"""Base-mesh projection for the separate parts: per part type the placed variant (part_*.b64.txt) is the base, wrapped onto
every other variant on the sheet, and each variant's paint is baked into the base's texture layout. Writes part_<type>.b64.txt
(base + one morph target per variant) and part_<type>_tex<k>.jpg. Body and tail have one variant and are left as they are."""
import sys; sys.path.insert(0,'.')
import numpy as np, base64, io
from scipy.spatial import cKDTree
from scipy import ndimage as ndi
from PIL import Image
from wrap import wrap, prefit, sample
from partcut import load, comps, glb
import json, struct
TS=2048
def variants(fn,lift):
    V,T,F,img,mime=load(fn);R=comps(V,F);u,c=np.unique(R,return_counts=True);o=u[np.argsort(-c)];big=[k for k in o if (R==k).sum()>=200]
    TEX=np.asarray(Image.open(io.BytesIO(img)).convert('RGB')).astype(np.float32);out=[]
    for k in big:
        m=R==k;lo,hi=V[m].min(0),V[m].max(0);keep=m.copy()
        for s in o:
            ms=R==s
            if s not in big and np.all(V[ms].mean(0)>lo-0.01) and np.all(V[ms].mean(0)<hi+0.01): keep|=ms
        Fk=F[keep[F].all(1)];used=np.unique(Fk);mp=-np.ones(len(V),int);mp[used]=np.arange(len(used));v=V[used].astype(float);c_=(v.min(0)+v.max(0))/2
        if lift: c_[1]=v[:,1].max()
        out.append(dict(Q=v-c_,UV=T[used],I=mp[Fk],TEX=TEX))
    return out,img,mime
def fit(base,h):
    # weld the base by position first: texture-seam duplicates must move together or the wrap tears the mesh open
    U,inv=np.unique(np.round(base['Q'],5),axis=0,return_inverse=True);inv=inv.ravel();FI=inv[base['I']]
    S,_=sample(h['Q'],h['I'],0.003);best=None
    for V0 in (U,prefit(U,h['Q'])):
        X=wrap(V0,FI,h['Q'],h['I'],iters=45)[inv];W_,_=sample(X,base['I'],0.003)
        e=cKDTree(W_).query(S)[0].mean()+cKDTree(S).query(W_)[0].mean()
        if best is None or e<best[0]: best=(e,X)
    return best[1],best[0]
def texlook(TEX,uv):
    x=np.clip((uv[:,0]%1)*TEX.shape[1],0,TEX.shape[1]-1).astype(int);y=np.clip((uv[:,1]%1)*TEX.shape[0],0,TEX.shape[0]-1).astype(int);return TEX[y,x]
def surf_uv(h,n=300000):
    P=h['Q'][h['I']];T=h['UV'][h['I']];ar=np.linalg.norm(np.cross(P[:,1]-P[:,0],P[:,2]-P[:,0]),axis=1);rng=np.random.default_rng(0)
    tri=rng.choice(len(P),n,p=ar/ar.sum());a,b=rng.random((2,n));fl=a+b>1;a[fl]=1-a[fl];b[fl]=1-b[fl];w=np.c_[1-a-b,a,b]
    return (P[tri]*w[:,:,None]).sum(1),(T[tri]*w[:,:,None]).sum(1)
for typ,src,lift in [('head','heads',False),('arm','arm',True),('leg','leg',True)]:
    H,img,mime=variants(f'../parts_src/{src}.glb',lift)
    if typ=='head':   # line every head up on its back end (where the neck attaches), not on its bounding box
        def back(q): x0=q[:,0].min();m=q[:,0]<x0+0.1*np.ptp(q[:,0]);return np.r_[x0,q[m,1].mean(),q[m,2].mean()]
        for h in H[1:]: h['Q']=h['Q']+(back(H[0]['Q'])-back(h['Q']))
    b=H[0];W=[b['Q']]
    for h in H[1:]: X,e=fit(b,h);W.append(X);print(typ,'variant',len(W)-1,'fit error %.4f'%e,flush=True)
    # bake: every texel of the base layout -> point on the base -> same point on variant k's wrap -> nearest sculpt point's paint
    # repack: the base part used only its corner of the shared sheet; stretch its layout over the whole texture
    UV0=b['UV'].copy();lo=UV0.min(0);b['UV']=((UV0-lo)/(UV0.max(0)-lo).max()*0.998+0.001).astype(np.float32)
    UVb=b['UV'][b['I']];ys,xs=np.mgrid[0:TS,0:TS];pix=np.c_[(xs.ravel()+0.5)/TS,(ys.ravel()+0.5)/TS];owner=-np.ones(TS*TS,int);bary=np.zeros((TS*TS,3))
    for t in range(len(UVb)):
        a,b_,c=UVb[t];lo=np.floor(np.minimum.reduce([a,b_,c])*TS).astype(int);hi=np.ceil(np.maximum.reduce([a,b_,c])*TS).astype(int)
        xx,yy=np.meshgrid(np.arange(max(lo[0],0),min(hi[0],TS)),np.arange(max(lo[1],0),min(hi[1],TS)));k=(yy*TS+xx).ravel()
        if not len(k): continue
        q=pix[k];d=(b_[1]-c[1])*(a[0]-c[0])+(c[0]-b_[0])*(a[1]-c[1])
        if abs(d)<1e-12: continue
        l1=((b_[1]-c[1])*(q[:,0]-c[0])+(c[0]-b_[0])*(q[:,1]-c[1]))/d;l2=((c[1]-a[1])*(q[:,0]-c[0])+(a[0]-c[0])*(q[:,1]-c[1]))/d;l3=1-l1-l2
        ins=(l1>=-0.02)&(l2>=-0.02)&(l3>=-0.02);owner[k[ins]]=t;bary[k[ins]]=np.c_[l1,l2,l3][ins]
    hit=owner>=0
    for k,h in enumerate(H):
        out=np.zeros((TS*TS,3),np.float32)
        if k==0: out[hit]=texlook(h['TEX'],(UV0[b['I'][owner[hit]]]*bary[hit][:,:,None]).sum(1))
        else:
            P3=(W[k][b['I'][owner[hit]]]*bary[hit][:,:,None]).sum(1);pts,uvs=surf_uv(h);_,ii=cKDTree(pts).query(P3,workers=-1);out[hit]=texlook(h['TEX'],uvs[ii])
        im=out.reshape(TS,TS,3);_,idx=ndi.distance_transform_edt(~hit.reshape(TS,TS),return_indices=True);im=im[idx[0],idx[1]]
        Image.fromarray(np.clip(im,0,255).astype(np.uint8)).save(f'../part_{typ}_tex{k}.jpg',quality=88)
    # glb with morph targets (texture: variant 0's bake)
    g=glb(b['Q'].astype(np.float32),b['UV'],b['I'],open(f'../part_{typ}_tex0.jpg','rb').read(),'image/jpeg')
    l=struct.unpack('<I',g[12:16])[0];j=json.loads(g[20:20+l]);bin_=g[20+l+8:].rstrip(b'\0') if False else g[20+l+8:]
    extra=b''.join((w-b['Q']).astype('<f4').tobytes() for w in W[1:]);off=len(bin_);bin_+=extra;n=len(b['Q'])
    for i in range(1,len(W)):
        j['bufferViews'].append({'buffer':0,'byteOffset':off+(i-1)*n*12,'byteLength':n*12});D=W[i]-b['Q']
        j['accessors'].append({'bufferView':len(j['bufferViews'])-1,'componentType':5126,'count':n,'type':'VEC3','min':D.min(0).tolist(),'max':D.max(0).tolist()})
    j['meshes'][0]['primitives'][0]['targets']=[{'POSITION':len(j['accessors'])-len(W)+i} for i in range(1,len(W))];j['meshes'][0]['weights']=[0]*(len(W)-1)
    j['buffers'][0]['byteLength']=len(bin_);js=json.dumps(j).encode();js+=b' '*(-len(js)%4)
    g=b'glTF'+struct.pack('<II',2,28+len(js)+len(bin_))+struct.pack('<I',len(js))+b'JSON'+js+struct.pack('<I',len(bin_))+b'BIN\0'+bin_
    open(f'../part_{typ}.b64.txt','w').write(base64.b64encode(g).decode());print(typ,len(H),'variants',len(g)//1024,'KB',flush=True)
